// A fake atproto network for tests (network N2 Task 3): a PLC directory, did:web hosts, handle hosts and any number of
// PDS hosts, all answered by one injected `fetch`, with the `lookup` and `resolveTxt` that go with it. No test touches
// the network: every atproto call a test makes goes through these three.
//
// It serves what N2 reads and writes:
//   - `https://plc.directory/<did>`: a DID document for every did:plc account, pointing at the account's own host;
//   - `https://<host>/.well-known/did.json`: the same for a did:web account;
//   - `https://<handle>/.well-known/atproto-did`, and the TXT record `_atproto.<handle>`: the account's DID;
//   - on each PDS host, for the accounts it holds: `com.atproto.repo.listRecords` (paged by `cursor`),
//     `com.atproto.server.createSession` (checks the password), `com.atproto.repo.putRecord` (honours `swapRecord`: a
//     stale cid answers 400 InvalidSwap) and `com.atproto.repo.deleteRecord`.
// A host answers only for the accounts it holds, so a test that reads two accounts on two hosts proves that each DID
// is resolved to its own PDS.
//
// A test can make a host misbehave: resolve to a private address, redirect, never answer, send too much, answer for
// another DID, or be down; and it can change a DID document by hand.
import { createHash } from 'node:crypto'
import type { FetchLike } from '../server/systems/driver.ts'

export interface FakeAccount { handle: string; password: string }
export interface FakeNetworkOptions {
  /** PDS hosts by their url (`https://pds-one.example.com`), each with the accounts it holds, by DID. */
  hosts: Record<string, { accounts: Record<string, FakeAccount> }>
  /** Hand-written DID documents served for a did:web DID at `https://<host>/.well-known/did.json`, by DID. */
  didWeb?: Record<string, unknown>
  /** The most records one listRecords page holds (the caller's `limit` can lower it). Default 100. */
  pageSize?: number
}
export interface FakeWrite { host: string; nsid: string; body: Record<string, unknown> }
export interface FakeRecord { uri: string; cid: string; value: Record<string, unknown> }
export interface FakeRequest { method: string; url: string }
/** How a host misbehaves: a 302, an answer that never comes, a 300 KB body, or listRecords answers whose records name
 *  another DID's repository. */
export type Misbehaviour = 'redirect' | 'slow' | 'oversized' | { answerFor: string }

export interface FakeNetwork {
  fetch: FetchLike
  lookup: (host: string) => Promise<string[]>
  resolveTxt: (name: string) => Promise<string[][]>
  /** Every write a PDS accepted or refused: createSession (its password replaced by ***), putRecord, deleteRecord. */
  writes: FakeWrite[]
  /** Every request, in order. */
  requests: FakeRequest[]
  /** The records `did` holds in `collection`, sorted by key. */
  records: (did: string, collection: string) => FakeRecord[]
  /** Puts a record straight into a repository (not a write: it is not logged). Answers its uri and cid. */
  seed: (did: string, collection: string, rkey: string, value: Record<string, unknown>) => { uri: string; cid: string }
  /** Every request to `host` fails as an unreachable host does. */
  setDown: (host: string, down?: boolean) => void
  /** What `lookup(host)` answers from now on. */
  resolveTo: (host: string, addresses: string[]) => void
  /** Makes `host` misbehave (null: behave again). */
  misbehave: (host: string, how: Misbehaviour | null) => void
  /** Changes the DID document served for `did`: a function of the document it would serve. */
  editDidDoc: (did: string, edit: ((doc: Record<string, any>) => unknown) | null) => void
  /** Sets the TXT records answered for `name` (`_atproto.<handle>`); null goes back to the default. */
  setTxt: (name: string, records: string[][] | null) => void
}

/** A did:plc identifier of the right shape (24 base32 characters), made from `seed`. */
export function plcDid(seed: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  const bytes = createHash('sha256').update(seed).digest()
  let id = ''
  for (let i = 0; i < 24; i++) id += alphabet[bytes[i] & 31]
  return `did:plc:${id}`
}

/** A public address for each fake host (documentation-free, globally routable). */
const PUBLIC_ADDRESS = '93.184.216.34'
const cidOf = (value: unknown): string => `bafyrei${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 40)}`

interface Answer { status: number; body: string; headers?: Record<string, string> }
const json = (status: number, value: unknown): Answer => ({ status, body: JSON.stringify(value) })
const xrpcError = (status: number, error: string, message: string): Answer => json(status, { error, message })

export function makeFakeNetwork(opts: FakeNetworkOptions): FakeNetwork {
  const pageSize = opts.pageSize ?? 100
  /** did → { host (the PDS url's host), pds (its url), account } */
  const accounts = new Map<string, { host: string; pds: string; account: FakeAccount }>()
  for (const [pds, { accounts: held }] of Object.entries(opts.hosts)) {
    const host = new URL(pds).host
    for (const [did, account] of Object.entries(held)) accounts.set(did, { host, pds: pds.replace(/\/+$/, ''), account })
  }
  const repos = new Map<string, Map<string, Map<string, FakeRecord>>>() // did → collection → rkey → record
  const sessions = new Map<string, string>() // token → did
  const down = new Set<string>()
  const addresses = new Map<string, string[]>()
  const misbehaving = new Map<string, Misbehaviour>()
  const docEdits = new Map<string, (doc: Record<string, any>) => unknown>()
  const txt = new Map<string, string[][]>()
  const writes: FakeWrite[] = []
  const requests: FakeRequest[] = []

  const collectionOf = (did: string, collection: string): Map<string, FakeRecord> => {
    let r = repos.get(did)
    if (!r) { r = new Map(); repos.set(did, r) }
    let c = r.get(collection)
    if (!c) { c = new Map(); r.set(collection, c) }
    return c
  }
  const store = (did: string, collection: string, rkey: string, value: Record<string, unknown>): FakeRecord => {
    const rec = { uri: `at://${did}/${collection}/${rkey}`, cid: cidOf({ did, collection, rkey, value }), value }
    collectionOf(did, collection).set(rkey, rec)
    return rec
  }
  const sorted = (did: string, collection: string): FakeRecord[] =>
    [...collectionOf(did, collection).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, r]) => r)

  const didDoc = (did: string): unknown => {
    const a = accounts.get(did)
    let doc: unknown = a ? {
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: did,
      alsoKnownAs: [`at://${a.account.handle}`],
      verificationMethod: [],
      service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: a.pds }],
    } : opts.didWeb?.[did]
    if (doc === undefined) return undefined
    const edit = docEdits.get(did)
    if (edit) doc = edit(structuredClone(doc) as Record<string, any>)
    return doc
  }
  const didOfHandle = (handle: string): string | null => {
    for (const [did, a] of accounts) if (a.account.handle === handle) return did
    return null
  }
  const knownHosts = (): Set<string> => {
    const hosts = new Set(['plc.directory'])
    for (const [did, a] of accounts) {
      hosts.add(a.host); hosts.add(a.account.handle)
      if (did.startsWith('did:web:')) hosts.add(did.slice('did:web:'.length))
    }
    for (const did of Object.keys(opts.didWeb ?? {})) if (did.startsWith('did:web:')) hosts.add(did.slice('did:web:'.length))
    return hosts
  }

  const sessionDid = (headers: Record<string, string>): string | null => {
    const auth = Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1]
    const m = /^Bearer (.+)$/.exec(auth ?? '')
    return m ? sessions.get(m[1]) ?? null : null
  }

  const pds = (host: string, u: URL, method: string, headers: Record<string, string>, body: Record<string, unknown>): Answer => {
    const nsid = u.pathname.replace(/^\/xrpc\//, '')
    const held = (did: unknown): boolean => typeof did === 'string' && accounts.get(did)?.host === host
    if (method === 'GET' && nsid === 'com.atproto.repo.listRecords') {
      const repo = u.searchParams.get('repo') ?? ''
      const collection = u.searchParams.get('collection') ?? ''
      if (!held(repo)) return xrpcError(400, 'InvalidRequest', `Could not find repo: ${repo}`)
      const limit = Math.min(pageSize, Math.max(1, Number(u.searchParams.get('limit') ?? 50) || 50))
      const all = sorted(repo, collection)
      const cursor = u.searchParams.get('cursor')
      const start = cursor === null ? 0 : all.findIndex(r => r.uri.split('/').pop()! > cursor)
      const page = start < 0 ? [] : all.slice(start, start + limit)
      const more = start >= 0 && start + limit < all.length
      const how = misbehaving.get(host)
      const other = how && typeof how === 'object' ? how.answerFor : null
      const records = page.map(r => (other ? { ...r, uri: r.uri.replace(`at://${repo}/`, `at://${other}/`) } : r))
      return json(200, { records, ...(more ? { cursor: page[page.length - 1].uri.split('/').pop() } : {}) })
    }
    if (method === 'POST' && nsid === 'com.atproto.server.createSession') {
      writes.push({ host, nsid, body: { ...body, ...(body.password !== undefined ? { password: '***' } : {}) } })
      const id = String(body.identifier ?? '')
      const did = id.startsWith('did:') ? id : didOfHandle(id)
      const a = did ? accounts.get(did) : undefined
      if (!did || !a || a.host !== host || a.account.password !== body.password) return xrpcError(401, 'AuthenticationRequired', 'Invalid identifier or password')
      const token = `jwt-${createHash('sha256').update(`${did}:${sessions.size}`).digest('hex').slice(0, 16)}`
      sessions.set(token, did)
      return json(200, { accessJwt: token, refreshJwt: `${token}-r`, did, handle: a.account.handle })
    }
    if (method === 'POST' && (nsid === 'com.atproto.repo.putRecord' || nsid === 'com.atproto.repo.deleteRecord')) {
      writes.push({ host, nsid, body })
      const who = sessionDid(headers)
      if (who === null) return xrpcError(401, 'AuthenticationRequired', 'Authentication Required')
      if (body.repo !== who || !held(who)) return xrpcError(400, 'InvalidRequest', 'Not your repository')
      const collection = String(body.collection ?? '')
      const rkey = String(body.rkey ?? '')
      const current = collectionOf(who, collection).get(rkey)
      if (body.swapRecord !== undefined && body.swapRecord !== (current?.cid ?? null)) return xrpcError(400, 'InvalidSwap', 'Record was at another cid')
      if (nsid === 'com.atproto.repo.deleteRecord') {
        collectionOf(who, collection).delete(rkey)
        return json(200, {})
      }
      const rec = store(who, collection, rkey, (body.record ?? {}) as Record<string, unknown>)
      return json(200, { uri: rec.uri, cid: rec.cid })
    }
    return xrpcError(501, 'MethodNotImplemented', `Method Not Implemented: ${nsid}`)
  }

  const answer = (u: URL, method: string, headers: Record<string, string>, body: Record<string, unknown>): Answer => {
    const host = u.host
    if (host === 'plc.directory' && method === 'GET') {
      const did = decodeURIComponent(u.pathname.slice(1))
      const doc = did.startsWith('did:plc:') ? didDoc(did) : undefined
      return doc === undefined ? json(404, { message: `DID not registered: ${did}` }) : json(200, doc)
    }
    if (u.pathname === '/.well-known/did.json' && method === 'GET') {
      const doc = didDoc(`did:web:${host}`)
      if (doc !== undefined) return json(200, doc)
    }
    if (u.pathname === '/.well-known/atproto-did' && method === 'GET') {
      const did = didOfHandle(host)
      if (did !== null) return { status: 200, body: `${did}\n`, headers: { 'content-type': 'text/plain' } }
    }
    if (u.pathname.startsWith('/xrpc/') && [...accounts.values()].some(a => a.host === host)) return pds(host, u, method, headers, body)
    return { status: 404, body: 'Not Found', headers: { 'content-type': 'text/plain' } }
  }

  const fetch: FetchLike = async (url, init) => {
    const method = (init as { method?: string }).method ?? 'GET'
    requests.push({ method, url })
    const u = new URL(url)
    const host = u.host
    if (u.protocol !== 'https:') throw new TypeError('only https is fetched')
    if (down.has(host) || !knownHosts().has(host)) throw new Error(`connect ECONNREFUSED ${host}`)
    const how = misbehaving.get(host)
    const signal = (init as { signal?: AbortSignal }).signal
    if (how === 'slow') {
      return new Promise((_, reject) => {
        if (signal?.aborted) return reject(new Error('aborted'))
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    }
    let a: Answer
    if (how === 'redirect') a = { status: 302, body: '', headers: { location: 'https://elsewhere.example.net/' } }
    else if (how === 'oversized') a = json(200, { records: [], pad: 'x'.repeat(300 * 1024) })
    else {
      const raw = (init as { body?: unknown }).body
      let body: Record<string, unknown> = {}
      if (typeof raw === 'string' && raw !== '') { try { body = JSON.parse(raw) as Record<string, unknown> } catch { body = {} } }
      a = answer(u, method, init.headers ?? {}, body)
    }
    const headers: Record<string, string> = { 'content-type': 'application/json', ...a.headers, 'content-length': String(Buffer.byteLength(a.body)) }
    return {
      ok: a.status >= 200 && a.status < 300,
      status: a.status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      text: async () => a.body,
      json: async () => JSON.parse(a.body) as unknown,
    }
  }

  const lookup = async (host: string): Promise<string[]> => {
    const h = host.toLowerCase()
    const set = addresses.get(h)
    if (set) return set
    if (knownHosts().has(h)) return [PUBLIC_ADDRESS]
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
  }

  const resolveTxt = async (name: string): Promise<string[][]> => {
    const set = txt.get(name)
    if (set) return set
    const m = /^_atproto\.(.+)$/.exec(name)
    const did = m ? didOfHandle(m[1]) : null
    if (did === null) throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND' })
    return [[`did=${did}`]]
  }

  return {
    fetch, lookup, resolveTxt, writes, requests,
    records: (did, collection) => sorted(did, collection),
    seed: (did, collection, rkey, value) => { const r = store(did, collection, rkey, value); return { uri: r.uri, cid: r.cid } },
    setDown: (host, isDown = true) => { if (isDown) down.add(host); else down.delete(host) },
    resolveTo: (host, list) => { addresses.set(host.toLowerCase(), list) },
    misbehave: (host, how) => { if (how === null) misbehaving.delete(host); else misbehaving.set(host, how) },
    editDidDoc: (did, edit) => { if (edit === null) docEdits.delete(did); else docEdits.set(did, edit) },
    setTxt: (name, records) => { if (records === null) txt.delete(name); else txt.set(name, records) },
  }
}
