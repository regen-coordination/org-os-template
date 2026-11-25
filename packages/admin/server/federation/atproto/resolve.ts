// atproto resolution (network N2 Task 3): DID → DID document → its own PDS, and handle ↔ DID, both ways.
//
// Every read goes through `guardedJson` (remote.ts): https, a DNS-public host, no redirect, 10 s, a size cap checked
// before parsing. On top of those guards:
//   - a DID document must name the DID it was asked for (`id`), and its PDS must be a public https address;
//   - a handle is accepted only when the DID it points at names it back.
// Each DID is resolved to its own PDS (R26): there is no one PDS for every account, as kms's connector assumes.
// No atproto SDK and no signature checks: N2 trusts a record as its PDS serves it (decision, 2026-11-22).
import { isPublicUrl } from '../../../lib/federation/peers.mjs'
import { guardedJson, TIMEOUT_MS, type GuardDeps } from '../remote.ts'
import { networkResolveTxt } from '../../net.ts'

/** What a DID document may weigh: 64 KB. */
export const DID_DOC_MAX_BYTES = 64 * 1024
/** What a handle host's `/.well-known/atproto-did` answer may weigh: it holds one DID. */
export const HANDLE_ANSWER_MAX_BYTES = 2048
export const PLC_DIRECTORY = 'https://plc.directory'

export interface ResolveDeps extends GuardDeps {
  /** The job's signal: aborting it cancels the reads. */
  signal?: AbortSignal
  /** The TXT records of a DNS name. Default: `networkResolveTxt` (DNS; refuses under a test run). */
  resolveTxt?: (name: string) => Promise<string[][]>
}
export type Resolved = { pds: string; handle: string | null }
export type Problem = { problem: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Top-level domains a handle or a did:web host may not use: local, reserved or not on the public DNS. */
const RESERVED_TLDS = new Set(['alt', 'arpa', 'example', 'internal', 'invalid', 'local', 'localhost', 'onion'])

/** A public DNS name, lowercased, or null: labels of letters, digits and hyphens, at least two, the last one starting
 *  with a letter (so no IP address), and no reserved top-level domain. */
function hostName(v: string): string | null {
  const h = v.toLowerCase()
  if (h.length > 253 || !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/.test(h)) return null
  return RESERVED_TLDS.has(h.slice(h.lastIndexOf('.') + 1)) ? null : h
}

/** A handle as typed (`@Alice.Example.org.`) in its one form (`alice.example.org`), or null when it is not a handle. */
export function normalHandle(input: unknown): string | null {
  if (typeof input !== 'string') return null
  return hostName(input.trim().replace(/^@/, '').replace(/\.$/, ''))
}

/** Where a DID's document is read: `did:plc:<id>` from the PLC directory, `did:web:<host>` from the host's well-known
 *  file. A did:web with a path or a port, a malformed did:plc, and any other method are null. */
export function didDocUrl(did: string): string | null {
  if (typeof did !== 'string') return null
  if (/^did:plc:[a-z2-7]{24}$/.test(did)) return `${PLC_DIRECTORY}/${did}`
  const web = /^did:web:([A-Za-z0-9.-]+)$/.exec(did)
  const host = web ? hostName(web[1]) : null
  return host === null ? null : `https://${host}/.well-known/did.json`
}

/** A DID's PDS (its `#atproto_pds` service, a public https address) and the handle its document claims (the first
 *  `at://` entry of `alsoKnownAs`; checked both ways only by `resolveHandle`). */
export async function resolveDid(did: string, deps: ResolveDeps): Promise<Resolved | Problem> {
  const url = didDocUrl(did)
  if (url === null) return { problem: `Not read: "${did}" is not a did:plc or did:web identifier this can resolve.` }
  const got = await guardedJson(url, deps, { maxBytes: DID_DOC_MAX_BYTES, signal: deps.signal })
  if ('problem' in got) return got
  const doc = 'json' in got ? got.json : null
  const where = new URL(url).hostname
  if (!isObj(doc)) return { problem: `Not read: what ${where} answered for ${did} is not a DID document.` }
  if (doc.id !== did) return { problem: `Not read: the document ${where} answered for ${did} is for another DID.` }

  const services = Array.isArray(doc.service) ? doc.service : []
  const entry = services.find(s => isObj(s) && (s.id === '#atproto_pds' || s.id === `${did}#atproto_pds`) && s.type === 'AtprotoPersonalDataServer')
  if (!isObj(entry) || typeof entry.serviceEndpoint !== 'string') return { problem: `Not read: the DID document of ${did} names no PDS.` }
  const endpoint = entry.serviceEndpoint.trim()
  if (!isPublicUrl(endpoint)) return { problem: `Not read: the PDS of ${did} is not a public https address.` }

  const aka = Array.isArray(doc.alsoKnownAs) ? doc.alsoKnownAs : []
  let handle: string | null = null
  for (const a of aka) {
    if (typeof a !== 'string' || !a.startsWith('at://')) continue
    handle = normalHandle(a.slice('at://'.length))
    if (handle !== null) break
  }
  return { pds: endpoint.replace(/\/+$/, ''), handle }
}

const noNetwork = (err: unknown): boolean => /no network in tests/.test(String((err as Error)?.message))

/** The `did=` values of `_atproto.<handle>`'s TXT records, read with the same time limit and signal as a fetch. */
async function txtDids(handle: string, deps: ResolveDeps): Promise<string[] | 'cancelled'> {
  if (deps.signal?.aborted) return 'cancelled'
  let timer: NodeJS.Timeout | undefined
  let onAbort: (() => void) | undefined
  const stop = new Promise<'stopped'>(resolve => {
    timer = setTimeout(() => resolve('stopped'), TIMEOUT_MS)
    onAbort = () => resolve('stopped')
    deps.signal?.addEventListener('abort', onAbort, { once: true })
  })
  try {
    const asked = (deps.resolveTxt ?? networkResolveTxt)(`_atproto.${handle}`)
    asked.catch(() => {}) // an answer that comes after the time limit is dropped, a failure too
    const records = await Promise.race([asked, stop])
    if (records === 'stopped') return deps.signal?.aborted ? 'cancelled' : []
    const dids = records.map(chunks => chunks.join('')).filter(t => t.startsWith('did=')).map(t => t.slice(4).trim())
    return [...new Set(dids)]
  } catch (err) {
    if (noNetwork(err)) throw err
    return []
  } finally {
    clearTimeout(timer)
    if (onAbort) deps.signal?.removeEventListener('abort', onAbort)
  }
}

/** A handle's DID: from `https://<handle>/.well-known/atproto-did`, else from the TXT record `_atproto.<handle>`. It is
 *  accepted only when that DID's document names the handle back. */
export async function resolveHandle(input: string, deps: ResolveDeps): Promise<{ did: string } | Problem> {
  const handle = normalHandle(input)
  if (handle === null) return { problem: `Not read: "${input}" is not a handle.` }

  let did: string | null = null
  const got = await guardedJson(`https://${handle}/.well-known/atproto-did`, deps, { maxBytes: HANDLE_ANSWER_MAX_BYTES, as: 'text', signal: deps.signal })
  if ('text' in got && didDocUrl(got.text.trim()) !== null) did = got.text.trim()
  if (did === null) {
    const dids = await txtDids(handle, deps)
    if (dids === 'cancelled') return { problem: 'Not read: it was cancelled.' }
    if (dids.length > 1) return { problem: `Not read: ${handle} names more than one DID.` }
    if (dids.length === 0 || didDocUrl(dids[0]) === null) return { problem: `Not read: ${handle} does not name a DID.` }
    did = dids[0]
  }

  const doc = await resolveDid(did, deps)
  if ('problem' in doc) return doc
  if (doc.handle !== handle) return { problem: `Not read: ${did} does not name ${handle} back.` }
  return { did }
}
