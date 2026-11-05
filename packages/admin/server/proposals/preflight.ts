// packages/admin/server/proposals/preflight.ts
//
// The preflight every closing of a proposal shares (0.6 P2 spec §3.8 step 1): ratify, reject, expire and withdraw all
// refuse, in words and before anything is written, unless no tracked file has uncommitted changes, no merge is in
// progress, HEAD is the trunk, the ledger can be read and holds the proposal open, the files the closing writes are
// tracked and not hidden, the last fetch is fresh and shows nothing new, and the clock is not behind the ledger. Only the
// verb and the reason a clean tree matters differ, so they are parameters.

import { HttpError } from '../errors.ts'
import { Refusal } from '../changes/apply.ts'
import { assertTracked, hiddenMergePaths, mergeInProgress, trackedChanges } from '../git.ts'
import { guardClock, guardTrunk, readLedger, resolveTrunk } from './ledger.ts'
import { guardFetched } from './propose.ts'
import type { Proposal } from '../../lib/proposals.mjs'

export interface PreflightWords {
  /** "Not ratified", "Not closed": opens every refusal. */
  not: string
  /** "a proposal is ratified": `guardFetched`'s act. */
  act: string
  /** Why a clean tree matters here: "a ratify starts from a clean tree, because its one undo, ...". */
  clean: string
  /** What the files being untracked costs here: "Ratify writes it, and git merge --abort cannot restore ...". */
  untracked: string
}

const refuse = (code: string, error: string, more: Record<string, unknown> = {}): Refusal => new Refusal(409, { code, error, ...more })
const firstLine = (err: unknown): string => (err instanceof Error ? err.message : String(err)).trim().split('\n')[0] ?? ''
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** Refuse or answer the ledger as read and the open proposal `id`. `files` names the files the closing writes, given the
 *  entry. `hosted` (L5 spec §3): "Sync first" does not apply. */
export async function closingPreflight(repo: string, id: string, now: Date, words: PreflightWords,
  files: (entry: Proposal) => string[], startBranch?: string, hosted = false): Promise<{ entry: Proposal; entries: Proposal[] }> {
  const nothing = 'Nothing was written.'
  const dirty = await trackedChanges(repo)
  if (dirty.length > 0) {
    throw refuse('DIRTY', `${words.not}: ${dirty[0]} has changes that are not committed${dirty.length > 1 ? ` (and ${plural(dirty.length - 1, 'other file')})` : ''}, ` +
      `and ${words.clean} Commit or discard them (\`git status\` lists them), then try again. ${nothing}`, { paths: dirty })
  }
  if (await mergeInProgress(repo)) {
    throw refuse('MERGE_IN_PROGRESS', `${words.not}: a merge is already in progress in this repository. Finish it or undo it with git yourself (\`git status\` says which), then try again. ${nothing}`)
  }
  await guardTrunk(repo, startBranch)
  const read = readLedger(repo)
  if (read.problems.length > 0) throw refuse('LEDGER', `${words.not}: ${read.problems[0]}`)
  const entry = read.entries.find(e => String(e.id) === id)
  if (!entry) throw new HttpError(404, `The ledger has no proposal ${id}.`)
  if (entry.state !== 'open') {
    const closed = entry.closed as { at?: string; by?: string } | null | undefined
    throw refuse('CLOSED', `${words.not}: proposal ${id} is already ${entry.state}${closed?.by ? ` (by ${closed.by}${closed.at ? `, ${closed.at}` : ''})` : ''}. ${nothing}`)
  }
  const written = files(entry)
  try { await assertTracked(repo, written) } catch (err) {
    throw refuse('UNTRACKED', `${words.not}: ${firstLine(err)} ${words.untracked} Add and commit it, then try again. ${nothing}`)
  }
  const [hidden] = await hiddenMergePaths(repo, written)
  if (hidden) {
    throw refuse('DIRTY', `${words.not}: ${hidden.path} is marked ${hidden.flag} in git, so git does not say whether it holds changes that are not committed. ` +
      `Run \`git update-index --no-${hidden.flag} ${hidden.path}\`, commit or discard what \`git diff HEAD -- ${hidden.path}\` then shows, and try again. ${nothing}`)
  }
  await guardFetched(repo, await resolveTrunk(repo, startBranch), now, words.act, { hosted })
  guardClock(read.entries, now)
  return { entry, entries: read.entries }
}
