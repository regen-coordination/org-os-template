// Reading another instance's public files, guarded (network N2 Task 2).
//
// `guardedJson` is the one reader every network read goes through: another instance's federation.json here, and the
// DID documents, handle answers and XRPC calls of Task 3. Its guards are the same for every caller:
//   - https, no login in the address, a real host name (no IP literal, no localhost or .local/.internal name);
//   - every address the host resolves to must be public (loopback, private, link-local, CGNAT, unique-local, v4 and v6);
//   - `redirect: 'error'`, a 10 s timeout over the whole read, the caller's signal, and a size cap checked on the
//     bytes before anything is parsed.
// It checks the HOST, never `isPublicUrl` on the whole address: an atproto read carries a query string, which
// `isPublicUrl` refuses. It differs from `guardedFetch`/`guardedText` (systems/driver.ts), which allow only the hosts a
// driver declared; an address typed by an operator or found in a peer's file has no declared host, so it is judged by
// what it resolves to instead.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { isPublicUrl } from '../../lib/federation/peers.mjs'
import { readFederation } from '../../lib/federation/read.mjs'
import { stateDir } from '../state.ts'
import { networkLookup, isPublicAddress } from '../net.ts'

export { isPublicAddress }
import { readYamlObject } from '../resources/util.ts'
import type { FetchLike } from '../systems/driver.ts'

export const TIMEOUT_MS = 10_000
/** What a federation.json may weigh: 256 KB. */
export const FEDERATION_MAX_BYTES = 256 * 1024
export const FEDERATION_SPEC = 'org-os/federation/1'

export interface GuardDeps {
  fetch: FetchLike
  /** Every address a host resolves to. Default: `networkLookup` (DNS; refuses under a test run). */
  lookup?: (host: string) => Promise<string[]>
}
export interface GuardOptions {
  maxBytes: number
  /** The Accept header. Default: application/json (text mode: text/plain). */
  accept?: string
  /** `json` (default) parses the body after the size check; `text` returns it as it came. */
  as?: 'json' | 'text'
  /** The job's signal: aborting it cancels the read. */
  signal?: AbortSignal
}
export type Guarded = { json: unknown } | { text: string } | { problem: string }

const kb = (bytes: number): number => Math.max(1, Math.round(bytes / 1024))

/** Whether an address fails the host rules every guarded call shares: https, no login in it, a real host name (no IP
 *  literal, no localhost or .local/.internal name). The publisher's write guard (atproto/publish.ts) uses it too. */
export function notPublicHttps(u: URL): boolean {
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  return u.protocol !== 'https:' || u.username !== '' || u.password !== '' || host === '' || isIP(host.replace(/^\[|\]$/g, '')) !== 0
    || !host.includes('.') || host === 'localhost' || /\.(localhost|local|internal)$/.test(host)
}

/** GET `url` under the guards above. Never throws: a refusal is `{ problem }`, a sentence a person reads. */
export async function guardedJson(url: string, deps: GuardDeps, opts: GuardOptions): Promise<Guarded> {
  let u: URL
  try { u = new URL(url) } catch { return { problem: 'Not read: that is not an address.' } }
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  const label = host === '' ? 'that address' : host
  if (notPublicHttps(u)) return { problem: `Not read: ${label} is not a public https address.` }
  const outer = opts.signal
  if (outer?.aborted) return { problem: 'Not read: it was cancelled.' }

  const ac = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ac.abort() }, TIMEOUT_MS)
  const onOuter = () => ac.abort()
  outer?.addEventListener('abort', onOuter)
  /** Rejects when the read is stopped, so a body that never ends cannot hold it. */
  const stopped = new Promise<never>((_, reject) => {
    const stop = () => reject(new Error('stopped'))
    if (ac.signal.aborted) stop()
    else ac.signal.addEventListener('abort', stop)
  })
  stopped.catch(() => {})
  const run = <T>(p: Promise<T>): Promise<T> => Promise.race([p, stopped])
  const interrupted = (): { problem: string } => ({ problem: timedOut ? `Not read: ${label} took longer than ${TIMEOUT_MS / 1000} seconds.` : 'Not read: it was cancelled.' })
  try {
    let addresses: string[]
    try { addresses = await run((deps.lookup ?? networkLookup)(host)) } catch (err) {
      if (ac.signal.aborted) return interrupted()
      if (/no network in tests/.test(String((err as Error)?.message))) throw err
      return { problem: `Not read: ${label} could not be found.` }
    }
    if (addresses.length === 0) return { problem: `Not read: ${label} could not be found.` }
    if (!addresses.every(isPublicAddress)) return { problem: `Not read: ${label} does not resolve to a public address.` }

    const as = opts.as ?? 'json'
    const accept = opts.accept ?? (as === 'text' ? 'text/plain, */*' : 'application/json')
    let res: Awaited<ReturnType<FetchLike>>
    try { res = await run(deps.fetch(u.href, { method: 'GET', headers: { accept }, redirect: 'error', signal: ac.signal })) } catch (err) {
      if (ac.signal.aborted) return interrupted()
      if (/no network in tests/.test(String((err as Error)?.message))) throw err
      return { problem: `Not read: ${label} could not be reached.` }
    }
    if (!res.ok) return { problem: `Not read: ${label} answered ${res.status}.` }
    const tooBig = { problem: `Not read: ${label} sent more than ${kb(opts.maxBytes)} KB.` }
    const length = Number(res.headers?.get('content-length'))
    if (Number.isFinite(length) && length > opts.maxBytes) return tooBig
    let text: string
    try {
      if (!res.text) return { problem: `Not read: ${label} could not be read as text.` }
      text = await run(res.text())
    } catch {
      return ac.signal.aborted ? interrupted() : { problem: `Not read: ${label} could not be read.` }
    }
    if (Buffer.byteLength(text, 'utf8') > opts.maxBytes) return tooBig
    if (as === 'text') return { text }
    try { return { json: JSON.parse(text) as unknown } } catch { return { problem: `Not read: ${label} did not answer JSON.` } }
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuter)
  }
}

/** The address a federation.json is read from, or null. `https://host` and a `/.well-known/federation.json` url map to
 *  the host's well-known file; `https://github.com/<o>/<r>` to the raw file at HEAD. */
export function wellKnownUrlOf(address: string): string | null {
  if (typeof address !== 'string') return null
  const t = address.trim()
  if (!isPublicUrl(t)) return null
  const u = new URL(t)
  const path = u.pathname.replace(/\/+$/, '')
  if (u.hostname.toLowerCase() === 'github.com') {
    const m = /^\/([^/]+)\/([^/]+)$/.exec(path)
    if (!m) return null
    return `https://raw.githubusercontent.com/${m[1]}/${m[2].replace(/\.git$/i, '')}/HEAD/.well-known/federation.json`
  }
  if (path === '') return `https://${u.host}/.well-known/federation.json`
  if (path === '/.well-known/federation.json') return `https://${u.host}${path}`
  return null
}

/** Another instance's federation.json: read under the guards, and it must carry `spec: 'org-os/federation/1'`. */
export async function fetchFederationJson(address: string, deps: GuardDeps, signal?: AbortSignal): Promise<{ doc: Record<string, unknown> } | { problem: string }> {
  const url = wellKnownUrlOf(address)
  if (url === null) return { problem: `Not read: "${address}" is not a public https address.` }
  const got = await guardedJson(url, deps, { maxBytes: FEDERATION_MAX_BYTES, signal })
  if ('problem' in got) return got
  const doc = 'json' in got ? got.json : null
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc) || (doc as Record<string, unknown>).spec !== FEDERATION_SPEC) {
    return { problem: `Not read: ${new URL(url).hostname} does not publish ${FEDERATION_SPEC}.` }
  }
  return { doc: doc as Record<string, unknown> }
}

export interface Cached { fetched_at: string; doc: Record<string, unknown> }

/** What was last read from other instances, outside the repository (under `stateDir`), keyed by the sha256 of the
 *  well-known url (`wellKnownUrlOf(address)`), never of the address as typed. */
export function remoteCache(repo: string) {
  const dir = join(stateDir(repo), 'federation', 'remote')
  const file = (url: string) => join(dir, `${createHash('sha256').update(url).digest('hex')}.json`)
  return {
    get(url: string): Cached | null {
      try {
        const v = JSON.parse(readFileSync(file(url), 'utf8')) as Partial<Cached>
        return typeof v.fetched_at === 'string' && typeof v.doc === 'object' && v.doc !== null ? { fetched_at: v.fetched_at, doc: v.doc } : null
      } catch { return null }
    },
    put(url: string, doc: Record<string, unknown>, now: Date = new Date()): void {
      mkdirSync(dir, { recursive: true })
      const tmp = `${file(url)}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify({ url, fetched_at: now.toISOString(), doc }))
      renameSync(tmp, file(url))
    },
  }
}

/** What one part of a check did: its lines for the job's output, how many reads it tried and how many succeeded. */
export interface CheckPart { lines: string[]; attempted: number; read: number }

/** Every peer that has a url and no folder here: its federation.json read and cached. A peer that is private, or whose
 *  url is not a public https address, is counted and never named. */
export async function readPeerFiles(repo: string, deps: GuardDeps, signal: AbortSignal, now: Date = new Date()): Promise<CheckPart> {
  const cache = remoteCache(repo)
  const peers = readFederation(readYamlObject(join(repo, 'federation.yaml'))).peers.filter(p => p.url !== null && p.ref === null)
  const open = peers.filter(p => !p.private && wellKnownUrlOf(p.url as string) !== null)
  const hidden = peers.length - open.length
  const lines: string[] = []
  let read = 0
  for (const p of open) {
    const url = wellKnownUrlOf(p.url as string) as string
    const got = await fetchFederationJson(p.url as string, deps, signal)
    if ('problem' in got) { lines.push(`${p.name}: ${got.problem}`); continue }
    cache.put(url, got.doc, now)
    read += 1
    lines.push(`${p.name}: read.`)
  }
  if (hidden > 0) lines.push(`The federation.json of ${hidden} private ${hidden === 1 ? 'peer was' : 'peers was'} not read (private, or without a public https url).`)
  return { lines, attempted: open.length, read }
}

/** `federation.check-links`, its federation.json part: with `address`, look that one hub up (and fail with the sentence
 *  when it is refused); without, every peer that has a url and no folder here (`readPeerFiles`). Writes only the cache.
 *  The operation itself runs `checkLinksAndRecords` (atproto/read.ts), which adds the atproto reads. */
export async function checkLinks(repo: string, params: Record<string, unknown>, deps: GuardDeps, signal: AbortSignal, now: Date = new Date()): Promise<string> {
  const address = typeof params.address === 'string' && params.address.trim() !== '' ? params.address.trim() : null
  if (address !== null) {
    const got = await fetchFederationJson(address, deps, signal)
    if ('problem' in got) throw new Error(got.problem)
    remoteCache(repo).put(wellKnownUrlOf(address) as string, got.doc, now)
    return `Read ${typeof got.doc.name === 'string' ? got.doc.name : address}.\n`
  }
  const part = await readPeerFiles(repo, deps, signal, now)
  if (part.lines.length === 0) return 'No peer has only a url: nothing to look up.\n'
  if (part.attempted > 0 && part.read === 0) throw new Error(part.lines.join('\n'))
  return `${part.lines.join('\n')}\n`
}
