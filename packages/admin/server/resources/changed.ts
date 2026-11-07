import { createHash } from 'node:crypto'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import { parseDocument, isSeq, isMap, LineCounter } from 'yaml'
import { registryDef, resolveTopKey } from '../registries.ts'
import type { Changed } from './types.ts'

// This module only reads git: `blame` and `log`. It sits outside server/git.ts because that
// file's vocabulary is the write path's, and nothing here may grow into a write.

export interface BlameLine { sha: string; author: string; time: number }

const UNCOMMITTED = '0'.repeat(40)

/** `git blame --porcelain` → one record per line of the file, in file order. Metadata is
 *  printed only the first time a commit appears, so it is remembered per commit. */
export function parseBlame(porcelain: string): BlameLine[] {
  const meta = new Map<string, { author: string; time: number }>()
  const lines: BlameLine[] = []
  let sha = ''
  for (const row of porcelain.split('\n')) {
    const head = /^([0-9a-f]{40}) \d+ \d+/.exec(row)
    if (head) { sha = head[1]!; if (!meta.has(sha)) meta.set(sha, { author: '', time: 0 }); continue }
    const m = meta.get(sha)
    if (!m) continue
    if (row.startsWith('author ')) m.author = row.slice('author '.length)
    else if (row.startsWith('author-time ')) m.time = Number(row.slice('author-time '.length))
    else if (row.startsWith('\t')) lines.push({ sha, author: m.author, time: m.time })
  }
  return lines
}

const cache = new Map<string, { key: string; changes: Map<string, Changed> }>()

/** The commit HEAD points at, or '' when there is none. Read-only. */
async function headOf(repo: string): Promise<string> {
  try { return (await simpleGit(repo).raw(['rev-parse', 'HEAD'])).trim() } catch { return '' }
}

/** Commits newest first, mapped to their position; empty when there are none. Read-only. */
async function commitOrder(repo: string): Promise<Map<string, number>> {
  const rank = new Map<string, number>()
  try {
    const shas = (await simpleGit(repo).raw(['rev-list', 'HEAD'])).split('\n').filter(Boolean)
    shas.forEach((sha, i) => rank.set(sha, i))
  } catch { /* no commits yet: times alone decide */ }
  return rank
}

/** For each entity of a collection registry: the newest commit that touched one of its lines,
 *  or "not committed yet" when one of its lines differs from the last commit. Kept per file
 *  content and HEAD, so blame runs again when the file or the history changes. */
export async function entityChanges(repo: string, registry: string): Promise<Map<string, Changed>> {
  const rel = `data/${registry}.yaml`
  const path = join(repo, rel)
  if (!existsSync(path)) return new Map()
  const src = readFileSync(path, 'utf8')
  const slot = `${repo}\0${rel}`
  // HEAD is part of the key: committing the same bytes that were just read as uncommitted
  // changes the answer without changing the file.
  const head = await headOf(repo)
  const key = createHash('sha1').update(src).update('\0').update(head).digest('hex')
  const hit = cache.get(slot)
  if (hit && hit.key === key) return hit.changes

  let blame: BlameLine[] = []
  try { blame = parseBlame(await simpleGit(repo).raw(['blame', '--porcelain', '--', rel])) } catch { /* untracked: no history */ }
  // Git stamps times in whole seconds, so two commits made in the same second tie on time.
  // The commit order breaks that tie, and is read only when a tie actually comes up.
  let order: Map<string, number> | null = null
  const positionOf = async (sha: string): Promise<number> => {
    if (!order) order = await commitOrder(repo)
    return order.get(sha) ?? Infinity
  }
  const newer = async (a: BlameLine, b: BlameLine): Promise<boolean> => a.time !== b.time
    ? a.time > b.time
    : (await positionOf(a.sha)) < (await positionOf(b.sha))

  const lines = new LineCounter()
  const doc = parseDocument(src, { lineCounter: lines })
  const seq = doc.get(resolveTopKey(k => doc.has(k), registryDef(registry)), true)
  const changes = new Map<string, Changed>()
  if (isSeq(seq)) {
    const mtime = statSync(path).mtime.toISOString()
    for (const item of seq.items) {
      if (!isMap(item) || !item.range) continue
      const id = item.get('id')
      if (id === undefined || id === null) continue
      const first = lines.linePos(item.range[0]).line
      const last = lines.linePos(Math.max(item.range[0], item.range[1] - 1)).line
      let best: BlameLine | null = null
      for (let n = first; n <= last; n++) {
        const line = blame[n - 1]
        if (!line) continue
        if (line.sha === UNCOMMITTED) { best = line; break }
        if (!best || await newer(line, best)) best = line
      }
      if (!best) continue
      changes.set(String(id), best.sha === UNCOMMITTED
        ? { at: mtime, by: 'not committed yet' }
        : { at: new Date(best.time * 1000).toISOString(), by: best.author })
    }
  }
  cache.set(slot, { key, changes })
  return changes
}

/** The last commit that touched `rel` (a file or `.`), or null when it has none. */
export async function lastCommit(repo: string, rel: string): Promise<Changed | null> {
  try {
    const out = (await simpleGit(repo).raw(['log', '-1', '--format=%aI%x09%an', '--', rel])).trim()
    if (!out) return null
    const [at, by] = out.split('\t')
    return { at: at!, by: by ?? '' }
  } catch { return null }
}
