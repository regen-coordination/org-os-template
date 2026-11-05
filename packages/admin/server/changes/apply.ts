import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registryDef } from '../registries.ts'
import { parseForWrite, entriesFromText, updatedText, createdText, deletedText } from '../registry.ts'
import { commitDataPaths, restageDataPaths, uncommittedDataPaths, hiddenDataPaths, type GitIdent } from '../git.ts'
import { assertGitSafe } from '../private/guard.ts'
import { readConfig } from '../visibility/config.ts'
import { HttpError } from '../errors.ts'
import type { Referrer } from '../schema.ts'
import type { TrailerValues } from '../../lib/trailers.mjs'
import { parseRecord, notDeleted } from './records.ts'
import { entryErrors, deleteRefs, idErrors, project, validateChange, named, ledgerErrors, currentEntries } from './stage.ts'
import type { RecordError, StageOp } from './types.ts'

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
}

/** One registry file this apply touches: its bytes before (null: no file yet) and its text as the ops leave it. */
interface Source { registry: string; rel: string; path: string; before: Buffer | null; text: string }

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
export async function applyOps(repo: string, ops: StageOp[], opts: ApplyOptions): Promise<{ commit: string | null }> {
  if (ops.length === 0) throw new Refusal(400, { error: 'Nothing is staged: the change holds no ops to apply.', code: 'EMPTY' })
  // A record that names no collection or no id says nothing about which file to guard.
  const malformed = idErrors(ops, () => [])
  if (malformed.length > 0) throw new StageRefusal(malformed)
  const registries = [...new Set(ops.map(op => parseRecord(op.record).registry))]
  const ledgered = ledgerErrors(ops)
  if (ledgered.length > 0) throw new StageRefusal(ledgered)
  const rels = registries.map(r => `data/${r}.yaml`)

  // 1. The reviewed save's guards, over every file this apply writes.
  await guardFiles(repo, rels)
  await opts.precheck?.()

  // 2. Each file as it is now; one the YAML library cannot rewrite is refused for what is wrong with it.
  //    A registry with no file yet starts from its canonical top key (spec §7.1 apply, step 8).
  const sources = new Map<string, Source>()
  for (const registry of registries) {
    const rel = `data/${registry}.yaml`
    const path = join(repo, rel)
    const before = existsSync(path) ? readFileSync(path) : null
    const text = before ? before.toString('utf8') : `${registryDef(registry).topKey}: []\n`
    const onlyDeletes = ops.every(op => parseRecord(op.record).registry !== registry || op.op === 'delete')
    parseForWrite(text, registry, onlyDeletes ? 'deleted' : 'saved')
    sources.set(registry, { registry, rel, path, before, text })
  }
  // A registry this apply does not write is read from its file, strictly: a receipt's removal asks whether
  // a record it names is still there, in a file the change may not touch (lib/receipts.mjs), and a file
  // that will not parse is the writes' own 409, not an empty list.
  const entriesOf = (registry: string) => {
    const s = sources.get(registry)
    return s ? entriesFromText(s.text, registry) : currentEntries(repo, registry, true)
  }
  // The same files before the ops: a receipt is judged against the state the change starts from (a removal
  // is accepted on a receipt installed before it, not on the receipt as the change leaves it).
  const original = new Map([...sources].map(([registry, s]) => [registry, s.text]))
  const entriesBefore = (registry: string) => {
    const text = original.get(registry)
    return text !== undefined ? entriesFromText(text, registry) : currentEntries(repo, registry, true)
  }

  // An op aimed at an entry with no id, or at an id several entries share, cannot say which entry it means.
  const ambiguous = idErrors(ops, entriesOf)
  if (ambiguous.length > 0) throw new StageRefusal(ambiguous)
  // An entry's id is what every reference to it names, so an update or a replace never changes it
  // (onto an id another entry holds, it would also leave two entries sharing one).
  const renames = ops.flatMap((op): RecordError[] => {
    const { id } = parseRecord(op.record)
    const sent = op.op === 'replace' ? [op.value.id] : op.op === 'update' && Object.hasOwn(op.set, 'id') ? [op.set.id] : []
    return sent.some(value => String(value) !== id) ? [{ record: op.record, field: 'id', message: ID_FIXED }] : []
  })
  if (renames.length > 0) throw new StageRefusal(renames)

  // 3. The entries as the change leaves them; every entry it writes validates against them.
  const projected = project(entriesOf, ops)
  const errors = entryErrors(repo, ops, projected)
  if (errors.length > 0) throw new StageRefusal(errors)

  // 4. Each op on its file's text, in order, through the reviewed splice and its exact-write check.
  for (const op of ops) {
    const { registry, id } = parseRecord(op.record)
    const s = sources.get(registry)!
    if (op.op === 'delete') {
      const refs = deleteRefs(repo, op, projected)
      if (refs.length > 0) throw new Referred(op.record, refs, notDeleted(registry, id, refs))
      s.text = deletedText(s.text, registry, id)
    } else if (op.op === 'create') {
      s.text = createdText(s.text, registry, op.value)
    } else if (op.op === 'replace') {
      s.text = updatedText(s.text, registry, id, op.value)
    } else {
      const now = entriesFromText(s.text, registry).find(e => named(e, id))
      if (!now) throw new Error(`entity not found: ${id}`)
      s.text = updatedText(s.text, registry, id, { ...now, ...op.set })
    }
  }
  const changed = [...sources.values()].filter(s => s.before === null || s.text !== s.before.toString('utf8'))
  if (changed.length === 0) {
    return { commit: opts.emptySubject === undefined ? null : await commitEmpty(repo, { ...opts, message: opts.emptySubject, precheck: undefined }) }
  }

  // 5. Every file about to be written, whole: it reads cleanly, and the whole change, judged against
  //    the texts as written (the backstop), names nothing that is not there and writes no entry
  //    that does not validate.
  for (const s of changed) parseForWrite(s.text, s.registry, 'saved')
  // Nothing stricter than members enters git (L5 spec §10.5): every text about to be committed, before anything is written.
  assertGitSafe(repo, changed.map(s => ({ path: s.rel, text: s.text })), readConfig(repo))
  const again = validateChange(repo, ops, undefined, entriesOf, entriesBefore)
  if (again.length > 0) throw new StageRefusal(again)

  // 6. Write all, then one commit. On any failure every file goes back to its bytes before, and the
  //    index with it (the reviewed save's restore, over every touched file).
  const write = opts.write ?? ((path: string, text: string) => writeFileSync(path, text))
  let step: 'write' | 'commit' = 'write'
  try {
    for (const s of changed) write(s.path, s.text)
    step = 'commit'
    // The last step in this try: commitDataPaths throws only when no commit was made, so the put-back
    // below never runs over a change git already holds.
    return { commit: await commitDataPaths(repo, changed.map(s => s.rel), opts.message, opts.trailers, { ident: opts.ident }) }
  } catch (err) {
    const lost: string[] = []
    for (const s of changed) {
      try { if (s.before) writeFileSync(s.path, s.before); else rmSync(s.path, { force: true }) } catch { lost.push(s.rel) }
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
    const files = listed(changed.map(s => s.rel))
    const why = step === 'commit' ? `git refused the commit to ${files} (${firstLine(err)})` : `${files} could not be written (${firstLine(err)})`
    const back = lost.length === 0
      ? `Nothing was changed in the ${changed.length === 1 ? 'file' : 'files'}.`
      : `${listed(lost)} could not be put back: \`git diff HEAD -- ${lost[0]}\` shows what it holds now.`
    throw new HttpError(503,
      `Not saved: ${why}. ${back} If another git command was running in this repository, try again; ` +
      `if a commit hook refused it, the reason above is the hook's.${staged}`)
  }
}

/**
 * The commit of a change whose git part changes no file (L5 spec §10.3: "otherwise an empty commit … with the usual
 * trailers"): after `precheck`, one empty commit with `message` and `trailers`, by `ident`. A refusal is the 503 Apply
 * answers for a refused commit; no file was touched. Callers hold the repository's write lock.
 */
export async function commitEmpty(repo: string, opts: ApplyOptions): Promise<string> {
  await opts.precheck?.()
  try {
    return await commitDataPaths(repo, [], opts.message, opts.trailers, { ident: opts.ident, allowEmpty: true })
  } catch (err) {
    throw new HttpError(503,
      `Not saved: git refused the commit (${firstLine(err)}). Nothing was changed in the files. If another git command was running in this repository, ` +
      'try again; if a commit hook refused it, the reason above is the hook\'s.')
  }
}
