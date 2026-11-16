import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { knowledgeFileDef, registriesOf, registryDef, registryFileOf, type RegistryDef } from '../registries.ts'
import { parseForWrite, entriesFromText, updatedText, createdText, deletedText, knowledgeEntries } from '../registry.ts'
import { assertWritablePath, commitPaths, restageDataPaths, uncommittedDataPaths, hiddenDataPaths, type GitIdent } from '../git.ts'
import { assertGitSafe, gitSafetyProblems } from '../private/guard.ts'
import { commitPolicy, readConfig } from '../visibility/config.ts'
import { HttpError } from '../errors.ts'
import type { Referrer } from '../schema.ts'
import type { TrailerValues } from '../../lib/trailers.mjs'
import { parseRecord, notDeleted } from './records.ts'
import { entryErrors, deleteRefs, idErrors, project, validateChange, named, ledgerErrors, governanceShapeErrors, currentEntries, knowledgeOpErrors, classesOf } from './stage.ts'
import { governanceEntries, writeGovernanceBlocks } from './governance-edit.ts'
import { applyToText, judgeCanonWrite, type FieldValue } from '../knowledge/canon-text.ts'
import { kindOfFile, knowledgeIdParts } from '../../lib/workspace/knowledge.mjs'
import { formatLevel, restrictedFields } from '../../lib/visibility.mjs'
import type { RecordError, StageOp } from './types.ts'
import { fileOpErrors, heldFileErrors, isFileOp, isRecordOp, mixedFileErrors } from '../workspace/files.ts'
import { goneOfFiles, targetsGone } from '../workspace/gone.ts'

/** Entries the change would write that do not validate: answered 422 `{ errors }` (app.ts's
 *  onError already answers an HttpError carrying `errors` that way). */
export class StageRefusal extends HttpError {
  constructor(public errors: RecordError[]) {
    super(422, `Not saved: the change has ${errors.length} ${errors.length === 1 ? 'error' : 'errors'}. Nothing was written.`)
  }
}

/** A delete other entries still name. The message is the reviewed sentence, and 409 is the
 *  status the old DELETE route has always answered it with; the tray answers it as a 422. */
export class Referred extends HttpError {
  constructor(public record: string, public refs: Referrer[], message: string) { super(409, message) }
}

/** A refusal answered as `status` with `body` as its whole JSON body; nothing was written. Its
 *  message and code are the body's `error` (else `reason`) and `code`, so a handler that knows
 *  only HttpError still answers the sentence and the code. */
export class Refusal extends HttpError {
  declare status: 400 | 401 | 403 | 409 | 422 | 500 | 502 | 503
  /** 422, 500 and 503 are ratify's (spec §3.8): a tree that would not validate, an undo that did not restore, a failed write or commit.
   *  401 and 502 are L5's: a write with no actor in hosted mode (§13), an act whose Hats reading failed (§5.2). */
  constructor(status: 400 | 401 | 403 | 409 | 422 | 500 | 502 | 503, public body: Record<string, unknown>) {
    super(status, String(body.error ?? body.reason ?? 'refused'), typeof body.code === 'string' ? body.code : undefined)
  }
}

export interface ApplyOptions {
  message: string
  trailers: TrailerValues
  /** Runs after the file guards and before anything is read for writing. The change routes
   *  re-check bases and the rule here (spec §7.1 apply, step 3); it throws a Refusal to stop. */
  precheck?: () => void | Promise<void>
  /** How a file is written. Tests pass one that fails. */
  write?: (path: string, text: string) => void
  /** Who authors and commits the one commit (L5 spec §6.4: the house for a signed-in actor, `commitIdent`); absent, git's
   *  configured identity, as 0.6. */
  ident?: GitIdent
  /** The change has a private part (L5 spec §10.3): when its git part changes no file, the commit is still made, empty,
   *  with this subject (`RESTRICTED_SUBJECT`) and the trailers. */
  emptySubject?: string
  /** Files written as bytes beside the ops (DAO-OS L6 §9, Task 12: an import's attachments under pages/assets/): each path
   *  one the server may write, under the same guards, in the same commit, put back with the rest on a failure. */
  assets?: { path: string; bytes: Buffer }[]
}

/** One registry file this apply touches: its bytes before (null: no file yet) and its text as the ops leave it. A registry
 *  spread over several files (knowledge, L6 §7.5) has a source per file, its `def` that file's (`knowledgeFileDef`). */
interface Source { registry: string; def: RegistryDef; rel: string; path: string; before: Buffer | null; text: string }
/** One file a file op writes whole (L6 §11.2): its bytes before (null: no file yet) and its text (null: deleted). */
interface FileSource { rel: string; path: string; before: Buffer | null; text: string | null }

const ID_FIXED = "an entry's id cannot be changed here; create a new entry and delete this one"
const listed = (paths: string[]) => (paths.length <= 1 ? (paths[0] ?? '') : `${paths.slice(0, -1).join(', ')} and ${paths.at(-1)}`)
const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).trim().split('\n')[0]

/**
 * The reviewed save's guards over the files a write is about to commit (spec §7.1 apply, step 1): a file git
 * has been told not to look at, or one with changes that are not committed, would be committed along with the
 * write, so the write is refused (409 `DIRTY`, `paths` naming every such file). The sentence names the first
 * file. Shared by Apply and the proposal ledger, so neither is a way around the other.
 */
export async function guardFiles(repo: string, rels: string[]): Promise<void> {
  const hiddenAll = await hiddenDataPaths(repo, rels)
  const dirtyAll = await uncommittedDataPaths(repo, rels)
  const paths = [...new Set([...hiddenAll.map(h => h.path), ...dirtyAll])]
  const [hidden] = hiddenAll
  if (hidden) {
    throw new Refusal(409, { code: 'DIRTY', paths, error:
      `Not saved: ${hidden.path} is marked ${hidden.flag} in git, so git does not say whether it holds changes that are not committed, ` +
      `and this save would commit them along with yours. Nothing was written. ` +
      `Run \`git update-index --no-${hidden.flag} ${hidden.path}\`, commit or discard what \`git diff HEAD -- ${hidden.path}\` then shows, and save again.` })
  }
  const [dirty] = dirtyAll
  if (dirty) {
    throw new Refusal(409, { code: 'DIRTY', paths, error:
      `Not saved: ${dirty} has changes that are not committed yet, and this save would commit them along with yours. ` +
      `Nothing was written. Commit those changes or discard them (\`git diff HEAD -- ${dirty}\` shows them), then save again.` })
  }
}

/**
 * Every op applied in memory with the reviewed splice and its exact-write check, every touched
 * file checked whole and the whole change validated against the texts about to be written, then
 * all written and committed once, with trailers. Either it ends in that one commit or every file
 * is as it was, in the tree and in the index. Callers hold the repository's write lock.
 */
export async function applyOps(repo: string, all: StageOp[], opts: ApplyOptions): Promise<{ commit: string | null }> {
  if (all.length === 0) throw new Refusal(400, { error: 'Nothing is staged: the change holds no ops to apply.', code: 'EMPTY' })
  // A file op (L6 §11.2) writes its file whole, beside the registry sources: the same guards, one write, one commit, the same
  // put-back. It is never beside record ops on its own file.
  const ops = all.filter(isRecordOp)
  const fileOps = all.filter(isFileOp)
  const mixed = mixedFileErrors(repo, all)
  if (mixed.length > 0) throw new StageRefusal(mixed)
  // A record that names no collection or no id says nothing about which file to guard. The records are read against the
  // instance's own registry list (L6 §7.1), and each registry's file is its def's.
  const defs = registriesOf(repo)
  const malformed = idErrors(ops, () => [], defs)
  if (malformed.length > 0) throw new StageRefusal(malformed)
  const ledgered = [...ledgerErrors(ops, defs), ...governanceShapeErrors(ops)]
  if (ledgered.length > 0) throw new StageRefusal(ledgered)
  // A knowledge op is a field edit of its entry (Task 10), at apply as at stage; on a canon kms reads alike (PF-R2).
  const fieldsOnly = knowledgeOpErrors(ops, defs, repo, 'Nothing was written.')
  if (fieldsOnly.length > 0) throw new StageRefusal(fieldsOnly)
  const defOf = (registry: string) => registryDef(registry, repo)
  // The file each record op writes: its registry's, or knowledge's per kind (`registryFileOf(def, id)`).
  const fileOfOp = (record: string): string => { const { registry, id } = parseRecord(record, defs); return registryFileOf(defOf(registry), id) }
  const spread = (registry: string): boolean => defOf(registry).filesGlob !== undefined
  // A file op whose path the server may not write is refused in words, before any write (§11.3); an ignored, untracked or
  // linked path, or the store's place, as an ungoverned one (T19 review I1, PF-R83).
  const unwritable = await heldFileErrors(repo, fileOps)
  if (unwritable.length > 0) throw new StageRefusal(unwritable)
  const recordRels = [...new Set(ops.map(op => fileOfOp(op.record)))]
  const assetsIn = opts.assets ?? []
  for (const a of assetsIn) {
    try { assertWritablePath(repo, a.path) } catch (err) {
      throw new StageRefusal([{ record: a.path, field: 'path', message: `${(err instanceof Error ? err.message : String(err)).replace(/^guardrail: /, 'Not saved: ')} Nothing was written.` }])
    }
  }
  const rels = [...recordRels, ...fileOps.map(op => op.path), ...assetsIn.map(a => a.path)]

  // 1. The reviewed save's guards, over every file this apply writes.
  await guardFiles(repo, rels)
  await opts.precheck?.()

  // 2. Each file as it is now; one the YAML library cannot rewrite is refused for what is wrong with it.
  //    A registry with no file yet starts from its canonical top key (spec §7.1 apply, step 8).
  //    Keyed by file: a registry has one, knowledge one per kind (L6 §7.5); a canon file that is not there names no entry.
  const sources = new Map<string, Source>()
  for (const rel of recordRels) {
    const registry = parseRecord(ops.find(op => fileOfOp(op.record) === rel)!.record, defs).registry
    const def = spread(registry) ? knowledgeFileDef(rel) : defOf(registry)
    const path = join(repo, rel)
    const before = existsSync(path) ? readFileSync(path) : null
    if (before === null && spread(registry)) {
      const missing = ops.filter(op => fileOfOp(op.record) === rel)
      throw new StageRefusal(missing.map(op => ({ record: op.record, field: '', message: `${rel} is not in the repository, so it holds no entry ${parseRecord(op.record, defs).id}. Nothing was written.` })))
    }
    // data/governance.yaml is edited in place (L7-D10); it has no list to start from.
    if (registry === 'governance' && before === null) {
      throw new StageRefusal([{ record: 'governance:governance', field: '', message: 'data/governance.yaml does not exist, so its roles and rules are not edited here.' }])
    }
    const text = before ? before.toString('utf8') : `${def.topKey}: ${def.shape === 'map' ? '{}' : '[]'}\n`
    const onlyDeletes = ops.every(op => fileOfOp(op.record) !== rel || op.op === 'delete')
    parseForWrite(text, def, onlyDeletes ? 'deleted' : 'saved')
    sources.set(rel, { registry, def, rel, path, before, text })
  }
  /** The sources of `registry`: its file's, or knowledge's files'. */
  const sourcesOf = (registry: string): Source[] => [...sources.values()].filter(s => s.registry === registry)
  // Each file op's file as it is now, checked whole again (§11.2: at stage and again at apply).
  const fileErrors = fileOps.flatMap(op => fileOpErrors(repo, op))
  if (fileErrors.length > 0) throw new StageRefusal(fileErrors)
  const files: FileSource[] = fileOps.map(op => {
    const path = join(repo, op.path)
    return { rel: op.path, path, before: existsSync(path) ? readFileSync(path) : null, text: op.text }
  })
  // A registry this apply does not write is read from its file, strictly: a receipt's removal asks whether
  // a record it names is still there, in a file the change may not touch (lib/receipts.mjs), and a file
  // that will not parse is the writes' own 409, not an empty list.
  // Knowledge's records are read across its files, each source's text where the apply holds one (L6 §7.5).
  const entriesOf = (registry: string) => {
    if (spread(registry)) return knowledgeEntries(repo, true, rel => sources.get(rel)?.text)
    const [s] = sourcesOf(registry)
    if (s) return registry === 'governance' ? governanceEntries(s.text) : entriesFromText(s.text, s.def)
    return currentEntries(repo, registry, true)
  }
  // The same files before the ops: a receipt is judged against the state the change starts from (a removal
  // is accepted on a receipt installed before it, not on the receipt as the change leaves it).
  const original = new Map([...sources].map(([rel, s]) => [rel, s.text]))
  const entriesBefore = (registry: string) => {
    if (spread(registry)) return knowledgeEntries(repo, true, rel => original.get(rel))
    const [s] = sourcesOf(registry)
    if (s) return registry === 'governance' ? governanceEntries(original.get(s.rel)!) : entriesFromText(original.get(s.rel)!, s.def)
    return currentEntries(repo, registry, true)
  }

  // An op aimed at an entry with no id, or at an id several entries share, cannot say which entry it means.
  const ambiguous = idErrors(ops, entriesOf, defs)
  if (ambiguous.length > 0) throw new StageRefusal(ambiguous)
  // An entry's id is what every reference to it names, so an update or a replace never changes it
  // (onto an id another entry holds, it would also leave two entries sharing one).
  const renames = ops.flatMap((op): RecordError[] => {
    const { id } = parseRecord(op.record, defs)
    const sent = op.op === 'replace' ? [op.value.id] : op.op === 'update' && Object.hasOwn(op.set, 'id') ? [op.set.id] : []
    return sent.some(value => String(value) !== id) ? [{ record: op.record, field: 'id', message: ID_FIXED }] : []
  })
  if (renames.length > 0) throw new StageRefusal(renames)

  // 3. The entries as the change leaves them; every entry it writes validates against them.
  const projected = project(entriesOf, ops, defs)
  const errors = entryErrors(repo, ops, projected)
  if (errors.length > 0) throw new StageRefusal(errors)

  // 4. Each op on its file's text, in order, through the reviewed splice and its exact-write check.
  for (const op of ops) {
    const { registry, id } = parseRecord(op.record, defs)
    const s = sources.get(fileOfOp(op.record))!
    if (spread(registry)) {
      // A canon edit (Task 10): the commons' own in-place writer, which changes the lines of the fields it sets and no other,
      // and refuses an edit it could only make by rewriting others or dropping a comment (kms-admin R-43, R-58). null clears.
      const { type, slug } = knowledgeIdParts(id)!
      if (op.op === 'update') s.text = applyToText(s.text, type, slug, op.set as Record<string, FieldValue>)
      continue
    }
    if (registry === 'governance' && op.op === 'update') {
      // Only the roles and rules blocks change; every other byte of the file stays (governance-edit.ts).
      try { s.text = writeGovernanceBlocks(s.text, op.set) } catch (err) {
        throw new StageRefusal([{ record: op.record, field: '', message: firstLine(err) }])
      }
    } else if (op.op === 'delete') {
      const refs = deleteRefs(repo, op, projected)
      if (refs.length > 0) throw new Referred(op.record, refs, notDeleted(registry, id, refs))
      s.text = deletedText(s.text, s.def, id)
    } else if (op.op === 'create') {
      s.text = createdText(s.text, s.def, op.value)
    } else if (op.op === 'replace') {
      s.text = updatedText(s.text, s.def, id, op.value)
    } else {
      const now = entriesFromText(s.text, s.def).find(e => named(e, id))
      if (!now) throw new Error(`entity not found: ${id}`)
      s.text = updatedText(s.text, s.def, id, { ...now, ...op.set })
    }
  }
  // A canon file is judged whole, before against after (PF-R3): only the entries its ops name move, and the commons' floor
  // grows only by them, and only when the change is a publication (its classes as the tray judges them, `classesOf`).
  let publication: boolean | undefined
  for (const s of sources.values()) {
    if (!spread(s.registry)) continue
    const type = kindOfFile(s.rel)!
    const slugs = new Set(ops.filter(op => fileOfOp(op.record) === s.rel).map(op => knowledgeIdParts(parseRecord(op.record, defs).id)!.slug))
    judgeCanonWrite(original.get(s.rel)!, s.text, type, slugs, () => (publication ??= classesOf(all, repo).includes('publication')))
  }
  const changedRecords = [...sources.values()].filter(s => s.before === null || s.text !== s.before.toString('utf8'))
  const changedFiles = files.filter(f => (f.text === null ? f.before !== null : f.before === null || f.text !== f.before.toString('utf8')))
  const changedAssets = assetsIn.map(a => {
    const path = join(repo, a.path)
    return { rel: a.path, path, before: existsSync(path) ? readFileSync(path) : null, bytes: a.bytes }
  }).filter(a => a.before === null || !a.before.equals(a.bytes))
  const changed: { rel: string; path: string; before: Buffer | null; text: string | null; bytes?: Buffer }[] = [...changedRecords, ...changedFiles, ...changedAssets.map(a => ({ ...a, text: null }))]
  if (changed.length === 0) {
    return { commit: opts.emptySubject === undefined ? null : await commitEmpty(repo, { ...opts, message: opts.emptySubject, precheck: undefined }) }
  }

  // 5. Every file about to be written, whole: it reads cleanly, and the whole change, judged against
  //    the texts as written (the backstop), names nothing that is not there and writes no entry
  //    that does not validate.
  for (const s of changedRecords) parseForWrite(s.text, s.def, 'saved')
  // Nothing stricter than members enters git (L5 spec §10.5): every text about to be committed, before anything is written.
  // A file edited whole (L6 §11.2) is judged against itself as it was: what it already held is not refused again, as at stage.
  // Judged under the stricter of the policy now and the one this commit leaves (Task 11 review I-4): a value typed beside a
  // narrowing of its field in the same change was split under the older policy, so it is the person's input, told 422.
  const was = readConfig(repo)
  const policy = commitPolicy(repo, all)
  const beforeOf = (f: FileSource) => (f.before === null ? [] : [{ path: f.rel, text: f.before.toString('utf8') }])
  if (policy !== was) {
    const narrowed = [
      ...changedRecords.flatMap(s => narrowedHere(repo, [{ path: s.rel, text: s.text }], [], was, policy).map(p => ({ record: `${s.registry}:${p.record}`, field: p.field, message: p.message }))),
      ...changedFiles.flatMap(f => (f.text === null ? [] : narrowedHere(repo, [{ path: f.rel, text: f.text }], beforeOf(f), was, policy)
        .map(p => ({ record: f.rel, field: p.field, message: p.message })))),
    ]
    if (narrowed.length > 0) throw new StageRefusal(narrowed)
  }
  assertGitSafe(repo, changedRecords.map(s => ({ path: s.rel, text: s.text })), policy)
  for (const f of changedFiles) {
    if (f.text !== null) assertGitSafe(repo, [{ path: f.rel, text: f.text }], policy, beforeOf(f))
  }
  const again = validateChange(repo, all, undefined, entriesOf, entriesBefore)
  if (again.length > 0) throw new StageRefusal(again)

  // 6. Write all, then one commit. On any failure every file goes back to its bytes before, and the
  //    index with it (the reviewed save's restore, over every touched file).
  // A registry's first file may sit in a folder git does not have yet (data/collections/, L6 §7.3); so may a file op's.
  const write = opts.write ?? ((path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) })
  let step: 'write' | 'commit' = 'write'
  try {
    for (const s of changed) {
      if (s.bytes !== undefined) { mkdirSync(dirname(s.path), { recursive: true }); writeFileSync(s.path, s.bytes) } else if (s.text === null) rmSync(s.path, { force: true }); else write(s.path, s.text)
    }
    step = 'commit'
    // The last step in this try: commitPaths throws only when no commit was made, so the put-back
    // below never runs over a change git already holds.
    const made = await commitPaths(repo, changed.map(s => s.rel), opts.message, opts.trailers, { ident: opts.ident })
    // DAO-OS L6 R-9a (Task 9): a page or record this commit deletes takes its conversation with it (queued, never awaited).
    try { targetsGone(repo, goneOfFiles(repo, changed.filter(c => c.bytes === undefined))) } catch { /* the commit stands */ }
    return { commit: made }
  } catch (err) {
    const lost: string[] = []
    for (const s of changed) {
      try {
        if (s.before) { mkdirSync(dirname(s.path), { recursive: true }); writeFileSync(s.path, s.before) } else rmSync(s.path, { force: true })
      } catch { lost.push(s.rel) }
    }
    let staged = ''
    const tracked = changed.filter(s => s.before !== null).map(s => s.rel)
    if (tracked.length > 0) {
      await restageDataPaths(repo, tracked).catch(() => {
        staged = ' The git index may still hold the refused change: run `git status` in the repository.'
      })
    }
    // A new file: `add` records its removal if the refused commit had staged it; if it never was, there is nothing to put back.
    for (const s of changed.filter(c => c.before === null)) await restageDataPaths(repo, [s.rel]).catch(() => {})
    const names = listed(changed.map(s => s.rel))
    const why = step === 'commit' ? `git refused the commit to ${names} (${firstLine(err)})` : `${names} could not be written (${firstLine(err)})`
    const back = lost.length === 0
      ? `Nothing was changed in the ${changed.length === 1 ? 'file' : 'files'}.`
      : `${listed(lost)} could not be put back: \`git diff HEAD -- ${lost[0]}\` shows what it holds now.`
    throw new HttpError(503,
      `Not saved: ${why}. ${back} If another git command was running in this repository, try again; ` +
      `if a commit hook refused it, the reason above is the hook's.${staged}`)
  }
}

/** What a value typed beside a narrowing of its field in the same change is told (Task 11 review I-4), at Apply
 *  (`Not applied`), Propose (`Not proposed`) and Revise (`Not revised`, L6 carries K1). */
export const NARROWED_HERE = (problem: string, verb = 'Not applied') =>
  `${verb}: ${problem}, and this change narrows it. Stage the narrowing on its own first, then the value: it then goes to the private store. Nothing was written.`

/**
 * Propose's and Revise's reading of PF-R15 (L6 carries K1): the values `ops` write that the stricter of the policy now and
 * the one their own edit of data/visibility.yaml leaves (`commitPolicy`) restricts, and the policy now does not, each with
 * its sentence (`NARROWED_HERE`), so such a value never sits in a ledger op. A record op is judged by the fields it writes
 * (in its registry's file, as `gitSafetyProblems` names them); a file op by its text, as Apply judges it, less what the file
 * already holds. Empty when the ops do not narrow the policy. A field the policy now restricts is `refuseNarrowed`'s.
 */
export function narrowedHereErrors(repo: string, ops: readonly StageOp[], verb: string): RecordError[] {
  const was = readConfig(repo)
  const policy = commitPolicy(repo, ops)
  if (policy === was) return []
  const defs = registriesOf(repo)
  const held = (v: unknown) => v !== undefined && v !== null
  const out: RecordError[] = []
  for (const op of ops) {
    if (isFileOp(op)) {
      if (op.text === null || op.path === 'data/visibility.yaml') continue
      const path = join(repo, op.path)
      const before = existsSync(path) ? [{ path: op.path, text: readFileSync(path, 'utf8') }] : []
      for (const p of narrowedHere(repo, [{ path: op.path, text: op.text }], before, was, policy, verb)) out.push({ record: op.path, field: p.field, message: p.message })
      continue
    }
    if (!isRecordOp(op) || op.op === 'delete') continue
    let parsed: { registry: string; id: string }
    try { parsed = parseRecord(op.record, defs) } catch { continue }
    const written = (op.op === 'update' ? op.set : op.value) as Record<string, unknown>
    const before = restrictedFields(was, parsed.registry)
    for (const [field, level] of Object.entries(restrictedFields(policy, parsed.registry))) {
      if (Object.hasOwn(before, field) || !held(written?.[field])) continue
      const file = registryFileOf(registryDef(parsed.registry, repo), parsed.id)
      out.push({ record: op.record, field, message: NARROWED_HERE(
        `${file} would hold the ${field} of ${parsed.id}, which data/visibility.yaml restricts to ${formatLevel(level)}; it belongs in the private store`, verb) })
    }
  }
  return out
}

/** The problems `files` hold under `policy` (the stricter one) that they do not hold under `was`, nor held `before`, each
 *  with its sentence (`NARROWED_HERE`). */
function narrowedHere(repo: string, files: { path: string; text: string }[], before: { path: string; text: string }[],
  was: ReturnType<typeof readConfig>, policy: ReturnType<typeof readConfig>, verb = 'Not applied'): { record: string; field: string; message: string }[] {
  const key = (p: { path: string; record: string; field: string }) => JSON.stringify([p.path, p.record, p.field])
  const known = new Set([...gitSafetyProblems(repo, files, was), ...gitSafetyProblems(repo, before, policy)].map(key))
  return gitSafetyProblems(repo, files, policy).filter(p => !known.has(key(p))).map(p => ({ record: p.record, field: p.field, message: NARROWED_HERE(p.message, verb) }))
}

/**
 * The commit of a change whose git part changes no file (L5 spec §10.3: "otherwise an empty commit … with the usual
 * trailers"): after `precheck`, one empty commit with `message` and `trailers`, by `ident`. A refusal is the 503 Apply
 * answers for a refused commit; no file was touched. Callers hold the repository's write lock.
 */
export async function commitEmpty(repo: string, opts: ApplyOptions): Promise<string> {
  await opts.precheck?.()
  try {
    return await commitPaths(repo, [], opts.message, opts.trailers, { ident: opts.ident, allowEmpty: true })
  } catch (err) {
    throw new HttpError(503,
      `Not saved: git refused the commit (${firstLine(err)}). Nothing was changed in the files. If another git command was running in this repository, ` +
      'try again; if a commit hook refused it, the reason above is the hook\'s.')
  }
}
