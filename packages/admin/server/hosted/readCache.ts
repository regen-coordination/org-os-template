// packages/admin/server/hosted/readCache.ts
//
// A long-running hosted Hub reads the same files on every request (L9 spec §7.6, carry 9): the visibility policy, the
// registries the gate judges by. A file that has not changed is not parsed again. The cache is stat-keyed, as
// `emailReader` is (request.ts): a reading is kept under the file's inode, mtime, ctime and size, and a file that differs
// in any of them is read again.
//
// The cache must never let a stale reading widen what the public sees, so a reading is kept only when the file could not
// have changed unseen since (the "racy" files of git's index): a file changed within `RACY_MS` of the read may be
// written again within the same tick of the file system's clock, with the same size, and keep every key. Such a file is
// read through on every request until it is older than that. Anything the cache cannot vouch for is read through: a file
// it cannot stat, one whose keys moved while it was read, one too fresh to trust. The server's own writes change the
// files, and with them the keys, so the cache never outlives a write (§7.6).

import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

/** What the cache keys a file on. `ctimeMs` and `dev` are optional (an injected stat may leave them out). `ctimeMs`, when
 *  given, is part of the key and of the freshness rule, so a file whose mtime was set back still reads as changed; `dev`
 *  tells apart two files of the same inode number on different devices (a volume mounted over the data folder). */
export interface FileStat { ino: number; mtimeMs: number; size: number; ctimeMs?: number; dev?: number }

/** How old a file's last change must be, when it is read, for the reading to be kept: wider than the coarsest file
 *  system clock met (2 s) and a little skew. A file changed more recently is read again on every request. */
export const RACY_MS = 3000

/** The default stat: a regular file's keys, or null (missing, not a file, not readable). */
function statFile(path: string): FileStat | null {
  try {
    const st = statSync(path)
    return st.isFile() ? { dev: st.dev, ino: st.ino, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, size: st.size } : null
  } catch { return null }
}

const keyOf = (st: FileStat) => `${st.dev ?? ''}:${st.ino}:${st.mtimeMs}:${st.ctimeMs ?? ''}:${st.size}`
/** The file's last change, its content's or (when known) its metadata's. */
const changedAt = (st: FileStat) => Math.max(st.mtimeMs, st.ctimeMs ?? st.mtimeMs)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Parse = (text: string) => any

/** Readings of files, each kept under the keys of the file it was read from, one per parser. A parser is told apart by
 *  its identity: pass the same function (one defined once, not a fresh arrow per call) to be answered from the cache. */
export class ReadCache {
  private readonly kept = new Map<string, { key: string; values: Map<Parse, unknown> }>()
  private readonly stat: (p: string) => FileStat | null
  private readonly now: () => number

  constructor(o: { stat?: (p: string) => FileStat | null; now?: () => number } = {}) {
    this.stat = o.stat ?? statFile
    this.now = o.now ?? (() => Date.now())
  }

  /** `parse` of the file at `path`: kept while the file is unchanged, else read again. A file that cannot be read throws
   *  as `readFileSync` does; a parse that throws is not kept. */
  get<T>(path: string, parse: (text: string) => T): T {
    const readAt = this.now()
    const before = this.stat(path)
    const key = before ? keyOf(before) : null
    const was = this.kept.get(path)
    if (was && key !== null && was.key === key && was.values.has(parse)) return was.values.get(parse) as T
    if (was && was.key !== key) this.kept.delete(path)

    const value = parse(readFileSync(path, 'utf8'))

    // Kept only when the file was settled when read (older than RACY_MS) and its keys did not move while it was.
    const after = this.stat(path)
    if (before && after && keyOf(after) === key && changedAt(before) < readAt - RACY_MS) {
      const held = this.kept.get(path)
      if (held && held.key === key) held.values.set(parse, value)
      else this.kept.set(path, { key: key!, values: new Map<Parse, unknown>([[parse, value]]) })
    } else {
      this.kept.delete(path)
    }
    return value
  }

  /** How many files have a kept reading (for tests and for a look at memory). */
  get size(): number { return this.kept.size }
}

/** At most this many repositories keep a cache in one process; the oldest asked is let go past it. A server serves one;
 *  a test process makes many temporary ones. */
const MAX_REPOS = 32
const caches = new Map<string, ReadCache>()

/** The read cache of `repo`: one per repository, process-wide. */
export function readCacheFor(repo: string): ReadCache {
  const at = resolve(repo)
  let cache = caches.get(at)
  if (cache) {
    caches.delete(at); caches.set(at, cache) // most recently asked last
    return cache
  }
  cache = new ReadCache()
  caches.set(at, cache)
  while (caches.size > MAX_REPOS) caches.delete(caches.keys().next().value!)
  return cache
}

/** `value` and everything in it frozen: a reading shared by every request must not be changed by one of them. */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const v of Object.values(value)) deepFreeze(v)
  return value
}
