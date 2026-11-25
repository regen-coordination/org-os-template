// atproto reading (network N2 Task 3): a DID's link and profile records, read from its own PDS, cached under stateDir.
//
// `readRepo` resolves the DID to its PDS (resolve.ts) and lists two collections there with the unauthenticated
// `com.atproto.repo.listRecords`, every page through `guardedJson`. A record whose uri is not in that DID's repository
// and that collection refuses the whole reading: a PDS answering for another repository is not believed at all. A
// record whose value does not parse is skipped and counted, never fatal. Every record keeps its `uri` and `cid` (R5):
// a delete needs the key, the profile's swap needs the cid.
//
// Reads happen only inside the confirmed `federation.check-links` (R16), which this file's `checkLinksAndRecords` runs.
// The cache lives outside the repository, so the check changes no file.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LINK_NSID, PROFILE_NSID, parseLinkRecord, parseProfileRecord, type LinkRecord, type ProfileRecord } from '../../../lib/federation/links.mjs'
import { readFederation, isDid } from '../../../lib/federation/read.mjs'
import { isPublishedPeer } from '../../../lib/standards/federation.mjs'
import { readYamlObject } from '../../resources/util.ts'
import { stateDir } from '../../state.ts'
import { guardedJson, checkLinks, readPeerFiles, type CheckPart } from '../remote.ts'
import { didDocUrl, normalHandle, resolveDid, resolveHandle, type Problem, type ResolveDeps } from './resolve.ts'

export type { LinkRecord, ProfileRecord }

/** What one listRecords page may weigh: 256 KB. */
export const LIST_MAX_BYTES = 256 * 1024
/** The most pages read per collection; a repository with more is refused, never read in part. */
export const MAX_PAGES = 10
/** The records asked for per page. */
export const PAGE_LIMIT = 100
/** How long a reading's DID document (its PDS and handle) is answered from the cache to readers that do not fetch. */
export const DID_DOC_TTL_MS = 24 * 3600_000

export interface RecordOf<T> { uri: string; cid: string; value: T }
/** One DID's records as its own PDS served them. `handle` is what its DID document claims; it is checked both ways only
 *  by a check that looked the handle up (`atprotoCache.didOfHandle`). */
export interface Reading {
  did: string
  pds: string
  handle: string | null
  profile: RecordOf<ProfileRecord> | null
  /** A profile `self` is there but did not parse (another client's shape, say): its uri and cid. It is never written
   *  over blind (Task 7). Absent in readings cached before it existed. */
  unreadProfile?: { uri: string; cid: string } | null
  links: RecordOf<LinkRecord>[]
  /** Records whose value did not parse (links, and a profile `self`). */
  skipped: number
  /** The Certified organization profile's urls, when this reading listed that collection (`ReadDeps.organization`):
   *  null when it has no `self` record. Absent when it wasn't listed; the cache then keeps the last one listed. */
  organization?: { urls: string[]; readAt: string } | null
  fetchedAt: string
}
export interface ReadDeps extends ResolveDeps {
  now?: Date
  /** Also list `app.certified.actor.organization` (key self): only for a DID a confirmed check looks up by itself, so
   *  its profile can tie it to a peer's address (Task 12). */
  organization?: boolean
}

/** A Certified organization profile, key `self`: its `urls[]` (each `{ url }`) say which addresses the org is. */
export const ORGANIZATION_NSID = 'app.certified.actor.organization'
/** The most urls kept from one organization profile, and the longest url kept. */
const ORG_URLS_MAX = 50
const ORG_URL_LEN = 2048

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** An atproto record key. */
const RKEY = /^[A-Za-z0-9._:~-]{1,512}$/

/** Every record of `collection` in `did`'s repository on `pds`, page by page through `cursor`. */
async function listAll(pds: string, did: string, collection: string, deps: ReadDeps): Promise<{ records: RecordOf<unknown>[] } | Problem> {
  const host = new URL(pds).hostname
  const prefix = `at://${did}/${collection}/`
  const notList = { problem: `Not read: ${host} did not answer a list of records.` }
  const records: RecordOf<unknown>[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ repo: did, collection, limit: String(PAGE_LIMIT) })
    if (cursor !== null) query.set('cursor', cursor)
    const got = await guardedJson(`${pds}/xrpc/com.atproto.repo.listRecords?${query}`, deps, { maxBytes: LIST_MAX_BYTES, signal: deps.signal })
    if ('problem' in got) return got
    const body = 'json' in got ? got.json : null
    if (!isObj(body) || !Array.isArray(body.records)) return notList
    for (const r of body.records) {
      if (!isObj(r)) return notList
      const { uri, cid } = r
      if (typeof uri !== 'string' || !uri.startsWith(prefix)) return { problem: `Not read: ${host} answered for another repository.` }
      const rkey = uri.slice(prefix.length)
      if (!RKEY.test(rkey) || rkey === '.' || rkey === '..') return { problem: `Not read: ${host} answered for another repository.` }
      if (typeof cid !== 'string' || cid === '' || !('value' in r)) return notList
      records.push({ uri, cid, value: r.value })
    }
    const next = body.cursor
    if (next === undefined || next === null || next === '') return { records }
    if (typeof next !== 'string' || next.length > 1024) return notList
    if (seen.has(next)) return { problem: `Not read: ${host} repeated a page.` }
    seen.add(next)
    cursor = next
  }
  return { problem: `Not read: ${did} has more records than this reads (${MAX_PAGES} pages).` }
}

/** `did`'s link records and its profile `self`, read from its own PDS. */
export async function readRepo(did: string, deps: ReadDeps): Promise<Reading | Problem> {
  const doc = await resolveDid(did, deps)
  if ('problem' in doc) return doc
  const links = await listAll(doc.pds, did, LINK_NSID, deps)
  if ('problem' in links) return links
  const profiles = await listAll(doc.pds, did, PROFILE_NSID, deps)
  if ('problem' in profiles) return profiles

  let skipped = 0
  const parsed: RecordOf<LinkRecord>[] = []
  for (const r of links.records) {
    const value = parseLinkRecord(r.value)
    if (value === null) skipped += 1
    else parsed.push({ uri: r.uri, cid: r.cid, value })
  }
  let profile: RecordOf<ProfileRecord> | null = null
  let unreadProfile: { uri: string; cid: string } | null = null
  const self = profiles.records.find(r => r.uri === `at://${did}/${PROFILE_NSID}/self`)
  if (self) {
    const value = parseProfileRecord(self.value)
    if (value === null) { skipped += 1; unreadProfile = { uri: self.uri, cid: self.cid } }
    else profile = { uri: self.uri, cid: self.cid, value }
  }
  const reading: Reading = { did, pds: doc.pds, handle: doc.handle, profile, unreadProfile, links: parsed, skipped, fetchedAt: (deps.now ?? new Date()).toISOString() }
  if (deps.organization) {
    const orgs = await listAll(doc.pds, did, ORGANIZATION_NSID, deps)
    if ('problem' in orgs) return orgs
    const own = orgs.records.find(r => r.uri === `at://${did}/${ORGANIZATION_NSID}/self`)
    reading.organization = own ? { urls: organizationUrls(own.value), readAt: reading.fetchedAt } : null
  }
  return reading
}

/** The `urls[].url` strings of an organization profile's value, capped; anything else in it is ignored. */
function organizationUrls(value: unknown): string[] {
  const list = isObj(value) && Array.isArray(value.urls) ? value.urls : []
  const out: string[] = []
  for (const e of list) {
    if (out.length >= ORG_URLS_MAX) break
    const url = isObj(e) ? e.url : undefined
    if (typeof url === 'string' && url.trim() !== '' && url.length <= ORG_URL_LEN) out.push(url.trim())
  }
  return out
}

export interface CacheEntry { did: string; reading: Reading | null; lastProblem: { at: string; text: string } | null }

const isReading = (v: unknown, did: string): v is Reading =>
  isObj(v) && v.did === did && typeof v.pds === 'string' && typeof v.fetchedAt === 'string' && Array.isArray(v.links) && typeof v.skipped === 'number'

/** What was last read on atproto, outside the repository: `join(stateDir(repo), 'federation', 'atproto')`, one file per
 *  DID keyed by the sha256 of the DID, and handle → DID beside it under `handles/`, keyed by the sha256 of the handle.
 *  A reading stays until the next confirmed check succeeds. A failed read never overwrites it: it records `lastProblem`. */
export function atprotoCache(repo: string) {
  const dir = join(stateDir(repo), 'federation', 'atproto')
  const key = (s: string) => createHash('sha256').update(s).digest('hex')
  const didFile = (did: string) => join(dir, `${key(did)}.json`)
  const handleFile = (handle: string) => join(dir, 'handles', `${key(handle)}.json`)
  const load = (path: string): unknown => { try { return JSON.parse(readFileSync(path, 'utf8')) as unknown } catch { return null } }
  const save = (path: string, value: unknown): void => {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(value))
    renameSync(tmp, path)
  }
  const get = (did: string): CacheEntry | null => {
    const v = load(didFile(did))
    if (!isObj(v) || v.did !== did) return null
    const reading = isReading(v.reading, did) ? v.reading : null
    const p = v.lastProblem
    const lastProblem = isObj(p) && typeof p.at === 'string' && typeof p.text === 'string' ? { at: p.at, text: p.text } : null
    return reading === null && lastProblem === null ? null : { did, reading, lastProblem }
  }
  return {
    get,
    /** A reading replaces the last one and clears `lastProblem`; a problem is kept beside the last good reading. */
    put(did: string, got: Reading | Problem, now: Date = new Date()): void {
      const before = get(did)?.reading ?? null
      // A reading that didn't list the organization profile keeps the last one a confirmed lookup listed, with the date it
      // was really read (`readAt`), never this reading's: binding refuses a listing older than the DID-document TTL.
      const carried = !('problem' in got) && got.organization === undefined && before?.organization !== undefined
        ? { ...got, organization: before.organization } : got
      const entry: CacheEntry = 'problem' in carried
        ? { did, reading: before, lastProblem: { at: now.toISOString(), text: carried.problem } }
        : { did, reading: carried, lastProblem: null }
      save(didFile(did), entry)
    },
    /** The PDS and handle of `did`'s last reading, while it is less than 24 hours old; for readers that must not fetch. */
    didDoc(did: string, now: Date = new Date()): { pds: string; handle: string | null; fetchedAt: string } | null {
      const r = get(did)?.reading
      if (!r) return null
      const age = now.getTime() - Date.parse(r.fetchedAt)
      return Number.isFinite(age) && age >= 0 && age < DID_DOC_TTL_MS ? { pds: r.pds, handle: r.handle, fetchedAt: r.fetchedAt } : null
    },
    /** Keeps handle → DID. Only a check that resolved the handle both ways writes it. */
    putHandle(handle: string, did: string, now: Date = new Date()): void {
      const h = normalHandle(handle)
      if (h !== null) save(handleFile(h), { handle: h, did, checkedAt: now.toISOString() })
    },
    /** The DID a handle was last checked to be, both ways, or null. */
    didOfHandle(handle: string): { did: string; checkedAt: string } | null {
      const h = normalHandle(handle)
      if (h === null) return null
      const v = load(handleFile(h))
      return isObj(v) && v.handle === h && typeof v.did === 'string' && typeof v.checkedAt === 'string' ? { did: v.did, checkedAt: v.checkedAt } : null
    },
  }
}
export type AtprotoCache = ReturnType<typeof atprotoCache>

export const ONE_AT_A_TIME = 'Look up one thing at a time: an address, a DID or a handle.'

/** What a `federation.check-links` looks up, from its params: one address, one DID, one handle, or everything. */
export function lookupTarget(params: Record<string, unknown>): { kind: 'address' | 'did' | 'handle'; value: string } | { kind: 'all' } | Problem {
  const given = (['address', 'did', 'handle'] as const).flatMap(kind => {
    const v = params[kind]
    return typeof v === 'string' && v.trim() !== '' ? [{ kind, value: v.trim() }] : []
  })
  if (given.length > 1) return { problem: ONE_AT_A_TIME }
  if (given.length === 0) return { kind: 'all' }
  const one = given[0]
  if (one.kind === 'did' && didDocUrl(one.value) === null) return { problem: `"${one.value}" is not a did:plc or did:web identifier this can resolve.` }
  if (one.kind === 'handle') {
    const h = normalHandle(one.value)
    if (h === null) return { problem: `"${one.value}" is not a handle.` }
    return { kind: 'handle', value: h }
  }
  return one
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
/** One reading in a few words for the job's output. */
const said = (got: Reading | Problem): string => {
  if ('problem' in got) return got.problem
  const skipped = got.skipped > 0 ? `, ${plural(got.skipped, 'record', 'records')} skipped` : ''
  return `read (${plural(got.links.length, 'link', 'links')}, ${got.profile ? 'a profile' : 'no profile'}${skipped}).`
}

/** Every peer with a `did`, and this instance's `identity.did`: each DID read once, cached, and said by peer name. A
 *  peer that is private, or has no public https url (a sibling folder, say), is still read but only counted: its name,
 *  its DID and its problem are never written in the output (as `isPublishedPeer` decides for federation.json). */
async function readEveryRecord(repo: string, deps: ReadDeps, signal: AbortSignal, now: Date): Promise<CheckPart> {
  const fed = readFederation(readYamlObject(join(repo, 'federation.yaml')))
  const selfDid = isDid(fed.identity.did) ? fed.identity.did : null
  const targets = [
    ...(selfDid !== null ? [{ label: 'This instance', did: selfDid, private: false }] : []),
    ...fed.peers.filter(p => p.did !== null).map(p => ({ label: p.name, did: p.did as string, private: !isPublishedPeer(p) })),
  ]
  const cache = atprotoCache(repo)
  const results = new Map<string, Reading | Problem>()
  for (const t of targets) {
    if (results.has(t.did)) continue
    if (signal.aborted) throw new Error('Not read: it was cancelled.')
    const got = await readRepo(t.did, deps)
    cache.put(t.did, got, now)
    results.set(t.did, got)
  }
  const lines: string[] = []
  let privateRead = 0
  let privateFailed = 0
  for (const t of targets) {
    const got = results.get(t.did) as Reading | Problem
    if (t.private) { if ('problem' in got) privateFailed += 1; else privateRead += 1; continue }
    lines.push(`${t.label} on atproto: ${said(got)}`)
  }
  const why = '(private, or without a public https url)'
  if (privateRead > 0) lines.push(`${plural(privateRead, 'private peer was', 'private peers were')} read on atproto ${why}.`)
  if (privateFailed > 0) lines.push(`${plural(privateFailed, 'private peer', 'private peers')} could not be read on atproto ${why}.`)
  const read = [...results.values()].filter(r => !('problem' in r)).length
  return { lines, attempted: results.size, read }
}

/** `federation.check-links`: with `address`, that one hub's federation.json (remote.ts); with `handle`, the handle
 *  resolved both ways, kept as handle → DID, and its DID's records read; with `did`, its records read and its handle
 *  checked both ways; with nothing, every peer's federation.json (URL-only peers) and every DID's records. Writes only
 *  the caches, under stateDir. A per-DID failure is a line in the output; the job fails only when nothing was read. */
export async function checkLinksAndRecords(repo: string, params: Record<string, unknown>, deps: ResolveDeps, signal: AbortSignal, now: Date = new Date()): Promise<string> {
  const target = lookupTarget(params)
  if ('problem' in target) throw new Error(target.problem)
  const d: ReadDeps = { ...deps, signal, now }
  // A DID or a handle looked up by itself is one under consideration: its organization profile is listed too (Task 12).
  const one: ReadDeps = { ...d, organization: true }
  const cache = atprotoCache(repo)

  if (target.kind === 'address') return checkLinks(repo, { address: target.value }, deps, signal, now)

  if (target.kind === 'handle') {
    const got = await resolveHandle(target.value, d)
    if ('problem' in got) throw new Error(got.problem)
    cache.putHandle(target.value, got.did, now)
    const reading = await readRepo(got.did, one)
    cache.put(got.did, reading, now)
    return `${target.value} is ${got.did}.\nIts records: ${said(reading)}\n`
  }

  if (target.kind === 'did') {
    const reading = await readRepo(target.value, one)
    cache.put(target.value, reading, now)
    if ('problem' in reading) throw new Error(reading.problem)
    const lines = [`${target.value}: ${said(reading)}`]
    if (reading.handle === null) lines.push('Its DID document names no handle.')
    else {
      const back = await resolveHandle(reading.handle, d)
      if ('did' in back && back.did === target.value) {
        cache.putHandle(reading.handle, target.value, now)
        lines.push(`Its handle is ${reading.handle}, both ways.`)
      } else if ('did' in back) lines.push(`Its handle ${reading.handle} does not point back to it, so it is not kept.`)
      else lines.push(`Its handle ${reading.handle} could not be checked both ways, so it is not kept. ${back.problem}`)
    }
    return `${lines.join('\n')}\n`
  }

  const files = await readPeerFiles(repo, deps, signal, now)
  const records = await readEveryRecord(repo, d, signal, now)
  const lines = [...files.lines, ...records.lines]
  if (lines.length === 0) return 'No peer has only a url or a DID, and this instance has no DID: nothing to look up.\n'
  if (files.attempted + records.attempted > 0 && files.read + records.read === 0) throw new Error(lines.join('\n'))
  return `${lines.join('\n')}\n`
}
