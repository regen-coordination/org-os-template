import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'

/** What the repository looked like at one moment: the commit HEAD names ('' when there is none),
 *  and every path git reports as changed or untracked, with a hash of its content. Two snapshots
 *  taken around a job say what the job changed, including further edits to a file that was
 *  already dirty — which `git status` alone cannot — and any commit the job made. Reads only. */
export interface Snapshot { head: string; files: Map<string, string> }

const HEAD_MOVED = 'HEAD moved '

export async function snapshot(repo: string): Promise<Snapshot> {
  const git = simpleGit(repo)
  // A repository with no commit yet has no HEAD to name; that is recorded as '' rather than failing.
  const head = await git.raw(['rev-parse', 'HEAD']).then(s => s.trim(), () => '')
  const status = await git.status(['--untracked-files=all'])
  const files = new Map<string, string>()
  for (const f of status.files) {
    let hash = 'gone'
    try {
      const path = join(repo, f.path)
      hash = statSync(path).isFile() ? createHash('sha1').update(readFileSync(path)).digest('hex') : 'not-a-file'
    } catch { /* deleted: 'gone' */ }
    files.set(f.path, hash)
  }
  return { head, files }
}

export function changedBetween(before: Snapshot, after: Snapshot): string[] {
  const out = new Set<string>()
  for (const [path, hash] of after.files) if (before.files.get(path) !== hash) out.add(path)
  for (const path of before.files.keys()) if (!after.files.has(path)) out.add(path) // was dirty, now as committed
  // A commit moves HEAD even when the files it holds are clean at both ends, so it is reported on its own.
  if (before.head !== after.head) {
    const short = (h: string) => (h ? h.slice(0, 7) : 'none')
    out.add(`${HEAD_MOVED}${short(before.head)} → ${short(after.head)}`)
  }
  return [...out].sort()
}

/** The changed paths that no declared write covers. A write ending in `/` covers a folder;
 *  `.` covers the whole repository (an ingest into a store at the repository root). A HEAD move
 *  is never covered by a write: a job that commits did something its declaration does not name. */
export function outside(paths: string[], writes: string[]): string[] {
  const covered = (p: string) => writes.includes('.') || writes.some(w => (w.endsWith('/') ? p.startsWith(w) : p === w))
  return paths.filter(p => p.startsWith(HEAD_MOVED) || !covered(p))
}
