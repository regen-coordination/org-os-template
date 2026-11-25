// The hub's writer (network N2 Task 9): one commit of `data/federation-requests.yaml`, `data/invites.yaml` and
// `federation.yaml`, the files a hub's own acts on a join request touch. The proposals ledger's writers are bound to
// `data/proposals.yaml`, so this follows its `commitLedger` step for step: the trunk and the files are guarded, each
// data file is validated against its schema, nothing stricter than members enters git, one commit, and on any failure
// every file's bytes are put back and the index with them. Callers hold the repository's write lock.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { guardFiles } from '../changes/apply.ts'
import { HttpError } from '../errors.ts'
import { entriesFromText } from '../registry.ts'
import { commitDataPaths, restageDataPaths, type GitIdent } from '../git.ts'
import { guardTrunk } from '../proposals/ledger.ts'
import { assertGitSafe } from '../private/guard.ts'
import { readConfig } from '../visibility/config.ts'
import { validateEntry } from '../../lib/data-validate.mjs'
import type { TrailerValues } from '../../lib/trailers.mjs'

/** The files a hub writes, and the registry each data file is checked against (null: not a registry). */
const HUB_FILES: Record<string, string | null> = {
  'data/federation-requests.yaml': 'federation-requests',
  'data/invites.yaml': 'invites',
  'federation.yaml': null,
}

export interface HubFile { rel: string; text: string }
export interface HubWriteOptions { startBranch?: string }

const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).trim().split('\n')[0]

/** The 422 for a file that would not hold what its schema allows; nothing has been written yet. */
function refuseIfInvalid(f: HubFile): void {
  const registry = HUB_FILES[f.rel]
  if (registry === undefined) throw new HttpError(400, `Not written: ${f.rel} is not a file the hub writes.`)
  if (registry === null) {
    let doc: unknown
    try { doc = parse(f.text) } catch (err) { throw new HttpError(422, `Not written: ${f.rel} would not be valid YAML (${firstLine(err)}). Nothing was written.`) }
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) throw new HttpError(422, `Not written: ${f.rel} would not be a mapping. Nothing was written.`)
    return
  }
  let entries: Record<string, unknown>[]
  try { entries = entriesFromText(f.text, registry) } catch (err) {
    throw new HttpError(422, `Not written: ${f.rel} could not be read back (${firstLine(err)}). Nothing was written.`)
  }
  const errors: { field: string; message: string }[] = []
  for (const entry of entries) {
    for (const p of validateEntry(registry, entry)) if (p.level === 'error') errors.push({ field: `${String(entry.id ?? '?')}.${p.path}`, message: p.message })
  }
  if (errors.length > 0) {
    throw Object.assign(new HttpError(422, `Not written: ${f.rel} would not hold valid entries (${errors[0].field}: ${errors[0].message}). Nothing was written.`), { errors })
  }
}

/** Writes `files` and commits them once, with `trailers`. Either it ends in that one commit or every file is as it was,
 *  in the tree and in the index. */
export async function writeHubFiles(repo: string, files: HubFile[], message: string, trailers: TrailerValues, ident?: GitIdent, opts: HubWriteOptions = {}): Promise<{ commit: string }> {
  if (files.length === 0) throw new HttpError(400, 'Not written: there is nothing to write.')
  const rels = files.map(f => f.rel)
  if (new Set(rels).size !== rels.length) throw new HttpError(400, 'Not written: a file is named twice.')
  for (const f of files) if (HUB_FILES[f.rel] === undefined) throw new HttpError(400, `Not written: ${f.rel} is not a file the hub writes.`)
  // 1. the trunk, then the files: a file with edits not committed would be committed along with these
  await guardTrunk(repo, opts.startBranch)
  await guardFiles(repo, rels)
  // 2. each file as it would be
  for (const f of files) refuseIfInvalid(f)
  const before = files.map(f => { const p = join(repo, f.rel); return { rel: f.rel, path: p, bytes: existsSync(p) ? readFileSync(p) : null } })
  // 3. nothing stricter than members enters git; only what this write adds is refused
  assertGitSafe(repo, files.map(f => ({ path: f.rel, text: f.text })), readConfig(repo),
    before.flatMap(b => (b.bytes ? [{ path: b.rel, text: b.bytes.toString('utf8') }] : [])))
  // 4. one commit; 5. on failure, every file put back
  let step: 'write' | 'commit' = 'write'
  try {
    for (const f of files) writeFileSync(join(repo, f.rel), f.text)
    step = 'commit'
    return { commit: await commitDataPaths(repo, rels, message, trailers, { ident }) }
  } catch (err) {
    const lost: string[] = []
    for (const b of before) {
      try { if (b.bytes) writeFileSync(b.path, b.bytes); else rmSync(b.path, { force: true }) } catch { lost.push(b.rel) }
    }
    let staged = ''
    // One path at a time: a new file that never reached the index is no pathspec git knows, and that is not a failure.
    for (const b of before) {
      await restageDataPaths(repo, [b.rel]).catch(() => {
        if (b.bytes) staged = ' The git index may still hold the refused change: run `git status` in the repository.'
      })
    }
    const why = step === 'commit' ? `git refused the commit to ${rels.join(', ')}` : `${rels.join(', ')} could not be written`
    throw new HttpError(503,
      `Not saved: ${why} (${firstLine(err)}). ${lost.length > 0 ? `${lost.join(', ')} could not be put back: \`git diff HEAD\` shows what they hold now.` : 'Nothing was changed.'} ` +
      `If another git command was running in this repository, try again; if a commit hook refused it, the reason above is the hook's.${staged}`)
  }
}
