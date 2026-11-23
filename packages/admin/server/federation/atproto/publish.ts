// Publishing this org's own link records (network N2 Task 7): the one place N2 WRITES to atproto.
//
// What is published is decided by federation.yaml as committed on the trunk, never by the records (R24, review focus
// 8): `planLinks` (lib/federation/links.mjs) turns it into creates, deletes and a profile change, and this file applies
// them through kms's own XRPC client and session (kms is reached through server/knowledge/kms.ts only, R-35).
//
// Every write is confirmed (R16): `federation.publish-links` plans from the cache only (ruling R6: the plan never
// fetches), then its job re-reads, re-plans and writes. Before anything is written, the identity must line up (focus
// 9): the trunk's `identity.did`, kms.yaml's `atproto.did`, the app password in the server's environment, the PDS the
// DID's document names, and a lexicon that isn't a placeholder on a live account (ruling R10: the guard is built here,
// kms is unchanged). A run that would withdraw every record refuses (R25, ruling R2: only when nothing is wanted and two
// or more would go, so a node can still leave its only network).
//
// kms's client sends no signal and follows redirects as its fetch does. So the fetch it is handed is wrapped here
// (ruling R9): https to a DNS-public host only, `redirect: 'error'`, the job's signal, a time limit and a size cap.
//
// The app password is read from the environment, never written, never returned; every error passes through a scrub.
// A private peer, or one without a public https url, never gets a record and is never named: it is counted (R3, R24).
// No file in the repository changes (R20): the network and a receipt under stateDir are all this writes.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LINK_NSID, PROFILE_NSID, isDid, planLinks } from '../../../lib/federation/links.mjs'
import { HttpError } from '../../errors.ts'
import { kms as loadKms, kmsPresence, type Kms } from '../../knowledge/kms.ts'
import { networkLookup, isPublicAddress } from '../../net.ts'
import { runCommand } from '../../resources/run.ts'
import { stateDir } from '../../state.ts'
import { nodePeerIO } from '../../federation-io.ts'
import { byFiles, selfAddressesOf } from '../link-state.ts'
import { notPublicHttps, TIMEOUT_MS } from '../remote.ts'
import { readTrunkFederation } from '../trunk.ts'
import { atprotoCache, readRepo, type Reading } from './read.ts'
import { resolveDid } from './resolve.ts'
import type { FetchLike } from '../../systems/driver.ts'
import type { Resource, Runner } from '../../resources/types.ts'
import type { InProcess, Operation } from '../../operations/catalogue.ts'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Every refusal and failure, word for word. */
export const SENTENCES = Object.freeze({
  noDid: "Set this instance's DID first (identity.did).",
  kmsMismatch: "kms.yaml's atproto account isn't this instance's DID.",
  noPassword: "Put the app password in the server's environment (ATPROTO_APP_PASSWORD).",
  pdsMismatch: "This DID's PDS isn't the one kms.yaml names.",
  privatePds: "This instance's PDS isn't on a public address, so nothing is written to it: a PDS on a private network is refused.",
  placeholder: "The network's lexicon isn't set yet (example.*), so nothing is written to a live account.",
  /** R25, ruling R2 (no override exists, and there is no per-record withdraw). */
  massDelete: (n: number) => `This would remove every published link at once (${n}). Nothing was written.`,
  checkFirst: 'Check the links first.',
  staleSelf: "The last check of this instance's records failed. Check the links again.",
  swap: 'Your profile changed elsewhere. Check again, then publish.',
  nothing: 'Nothing to publish.',
  cancelled: 'Not published: it was cancelled.',
  /** A cancel after some writes went through: counts only. */
  cancelledAfter: (created: number, deleted: number, profile: boolean) =>
    `Cancelled after some writes went through: ${plural(created, 'link', 'links')} published, ${deleted} withdrawn${profile ? ', the profile updated' : ''}. Check the links to see the rest.`,
  profileUnread: "Your profile record couldn't be read, so it was left as it is.",
  loginMismatch: "The app password signs in to another account than this instance's DID, so nothing was written.",
  recordChanged: 'This record changed elsewhere, so it was left. Check again, then publish.',
  unplannable: "Publishing can't be planned here right now. Check the links, then try again.",
})

/** What one write answer may weigh: 256 KB. */
export const WRITE_MAX_BYTES = 256 * 1024

export interface PublishDeps {
  /** The one network call. Default in the catalogue: `networkFetch`, which refuses under a test run. */
  fetch: FetchLike
  /** Every address a host resolves to. Default: `networkLookup` (refuses under a test run). */
  lookup?: (host: string) => Promise<string[]>
  /** The server's environment: the app password is `ATPROTO_APP_PASSWORD` there. */
  env: Record<string, string | undefined>
  /** kms's functions; default, loaded through server/knowledge/kms.ts. */
  kms?: Pick<Kms, 'loadKmsConfig' | 'createClient'>
  now?: Date
  /** Only tests and the acceptance script set it: lets an `example.*` collection be written (ruling R10). */
  allowPlaceholderLexicons?: boolean
  /** The job's signal. */
  signal?: AbortSignal
  /** The branch the server started on, for the trunk. */
  startBranch?: string
  /** Runs `git remote -v` for this instance's own addresses (the files readings). Default: `runCommand`. */
  run?: Runner
  /** What the operator confirmed (the plan's writes, `confirmedOf`): the job writes only when its fresh plan is the same. */
  confirmed?: Confirmed
}

/** The writes a plan holds, by identity: the create keys, the delete uris, and the profile's networks (null: none). */
export interface Confirmed { create: string[]; delete: string[]; profile: string | null }

/** `uri` is null for a record another client keyed (its key could name a peer): such a record is counted, never printed. */
export interface Failure { action: 'create' | 'delete' | 'profile'; uri: string | null; error: string }
export type Withheld = { private: number; noUrl: number; noDid: number; noRelation: number; undecided: number }
export interface PublishResult { applied: { created: number; deleted: number; profile: boolean }; failures: Failure[]; withheld: Withheld; profileWithheld: boolean }
/** `created`/`deleted`: uris whose key is ours (`linkKey`'s shape, or `self`); `otherDeleted`: records another client
 *  keyed that were withdrawn, counted only. */
export interface Receipt { at: string; did: string; created: string[]; deleted: string[]; otherDeleted: number; profileCid: string | null }

/** A record key this publisher writes: `linkKey`'s 16 base32 characters, or the profile's `self`. Another key could have
 *  been chosen by another client, and could name a peer, so it is never printed or kept in the receipt. */
export const isOwnKey = (uri: string): boolean => /\/([a-z2-7]{16}|self)$/.test(uri)

type Plan = ReturnType<typeof planLinks>
type Account = { did: unknown; pds: unknown; handle: unknown }

/** A refusal at one step of the publish sequence: `sentence` is what the person reads. */
class Refused extends Error {
  constructor(readonly step: number, readonly sentence: string) { super(sentence) }
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const noNetwork = (err: unknown): boolean => /no network in tests/.test(message(err))
/** Every error a person may read passes through here: the app password becomes ***. */
const scrubber = (password: string | undefined) => (text: string): string => (password ? String(text).split(password).join('***') : String(text))
const originOf = (u: unknown): string | null => {
  if (typeof u !== 'string') return null
  try { const x = new URL(u); return x.protocol === 'https:' ? x.origin : null } catch { return null }
}
const placeholderCollections = (): boolean => [LINK_NSID, PROFILE_NSID].some(c => c.startsWith('example.'))

// ── the receipt (a cache for drawing the page; the PDS is the truth) ──────────────────────────────────────────────

export const receiptPath = (repo: string): string => join(stateDir(repo), 'federation', 'published.json')

export function readReceipt(repo: string): Receipt | null {
  try {
    const v = JSON.parse(readFileSync(receiptPath(repo), 'utf8')) as Record<string, unknown>
    const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(s => typeof s === 'string')
    if (typeof v.at !== 'string' || typeof v.did !== 'string' || !strings(v.created) || !strings(v.deleted)) return null
    return { at: v.at, did: v.did, created: v.created, deleted: v.deleted, otherDeleted: typeof v.otherDeleted === 'number' ? v.otherDeleted : 0,
      profileCid: typeof v.profileCid === 'string' ? v.profileCid : null }
  } catch { return null }
}

function writeReceipt(repo: string, receipt: Receipt): void {
  const path = receiptPath(repo)
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(receipt, null, 2))
  renameSync(tmp, path)
}

// ── the guarded fetch kms writes through (ruling R9) ──────────────────────────────────────────────────────────────

type KmsInit = { method?: string; headers?: Record<string, string>; body?: string }

/** A fetch for kms's `createClient`: https to a DNS-public host only (an IP literal, localhost, or a host resolving to a
 *  private address is refused before any request), `redirect: 'error'` (a 3xx is refused, never followed), the job's
 *  signal, a 10 s limit over the whole call, and a 256 KB cap on the answer. kms's client calls it as
 *  `fetchImpl(url, { method, headers, body })`. `scrub`, when given, is applied to every answer before kms reads it, so
 *  an answer that echoes the app password can't carry it (or a prefix of it, in a JSON parse error) into kms's errors. */
export function guardedWriteFetch(fetch: FetchLike, opts: { lookup?: (host: string) => Promise<string[]>; signal?: AbortSignal; timeoutMs?: number;
  scrub?: (text: string) => string } = {}) {
  const limit = opts.timeoutMs ?? TIMEOUT_MS
  return async (url: string, init: KmsInit = {}) => {
    let u: URL
    try { u = new URL(url) } catch { throw new Error('Not published: that is not an address.') }
    const host = u.hostname.toLowerCase().replace(/\.$/, '')
    if (notPublicHttps(u)) throw new Error(`Not published: ${host || 'that address'} is not a public https address.`)
    const outer = opts.signal
    if (outer?.aborted) throw new Error(SENTENCES.cancelled)

    const ac = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ac.abort() }, limit)
    const onOuter = () => ac.abort()
    outer?.addEventListener('abort', onOuter, { once: true })
    const stopped = new Promise<never>((_, reject) => {
      const stop = () => reject(new Error('stopped'))
      if (ac.signal.aborted) stop()
      else ac.signal.addEventListener('abort', stop, { once: true })
    })
    stopped.catch(() => {})
    const run = <T>(p: Promise<T>): Promise<T> => Promise.race([p, stopped])
    const interrupted = () => new Error(timedOut ? `Not published: ${host} took longer than ${limit / 1000} seconds.` : SENTENCES.cancelled)
    try {
      let addresses: string[]
      try { addresses = await run((opts.lookup ?? networkLookup)(host)) } catch (err) {
        if (ac.signal.aborted) throw interrupted()
        if (noNetwork(err)) throw new Error((opts.scrub ?? String)(message(err)))
        throw new Error(`Not published: ${host} could not be found.`)
      }
      if (addresses.length === 0) throw new Error(`Not published: ${host} could not be found.`)
      if (!addresses.every(isPublicAddress)) throw new Error(`Not published: ${host} resolves to a private address, and a PDS on a private network is refused.`)

      let res: Awaited<ReturnType<FetchLike>>
      try {
        res = await run(fetch(u.href, {
          method: init.method === 'POST' ? 'POST' : 'GET', headers: { ...(init.headers ?? {}) },
          ...(init.body !== undefined ? { body: init.body } : {}), redirect: 'error', signal: ac.signal,
        }))
      } catch (err) {
        if (ac.signal.aborted) throw interrupted()
        if (noNetwork(err)) throw new Error((opts.scrub ?? String)(message(err)))
        throw new Error(`Not published: ${host} could not be reached.`)
      }
      if (res.status >= 300 && res.status < 400) throw new Error(`Not published: ${host} answered with a redirect, which is never followed.`)
      const tooBig = () => new Error(`Not published: ${host} sent more than ${WRITE_MAX_BYTES / 1024} KB.`)
      const length = Number(res.headers?.get('content-length'))
      if (Number.isFinite(length) && length > WRITE_MAX_BYTES) throw tooBig()
      let text: string
      try { text = res.text ? await run(res.text()) : JSON.stringify(await run(res.json())) } catch {
        throw ac.signal.aborted ? interrupted() : new Error(`Not published: ${host}'s answer could not be read.`)
      }
      if (Buffer.byteLength(text, 'utf8') > WRITE_MAX_BYTES) throw tooBig()
      if (opts.scrub) text = opts.scrub(text)
      return { ok: res.ok, status: res.status, headers: res.headers, text: async () => text, json: async () => JSON.parse(text) as unknown }
    } finally {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onOuter)
    }
  }
}

// ── the steps ────────────────────────────────────────────────────────────────────────────────────────────────────

interface Prepared {
  did: string
  account: Account
  api: Pick<Kms, 'loadKmsConfig' | 'createClient'>
  reading: Reading
  plan: Plan
}

type Mode = { live: boolean; password: boolean; lexicon: boolean }

/** kms's functions, or a refusal with kms's own sentence. */
async function kmsApi(repo: string, deps: PublishDeps): Promise<Pick<Kms, 'loadKmsConfig' | 'createClient'>> {
  if (deps.kms) return deps.kms
  const got = await loadKms(repo)
  if (!got.ok) throw new Refused(3, got.reason)
  return got.kms
}

/** Steps 1–9 of a publish, in order. `live`: step 5 resolves the DID and step 7 reads the records now (the confirmed
 *  job); otherwise both come from the cache of the last check (the plan, which never fetches: ruling R6). `password`
 *  and `lexicon` turn steps 4 and 6 on (the self card's facts leave them to `unavailable`, which knows the deps). */
async function prepare(repo: string, deps: PublishDeps, mode: Mode): Promise<Prepared> {
  const now = deps.now ?? new Date()
  // 1. federation.yaml on the trunk.
  const trunk = await readTrunkFederation(repo, deps.startBranch)
  if ('problem' in trunk) throw new Refused(1, trunk.problem)
  const { fed } = trunk
  // 2. This instance's DID.
  const did = fed.identity.did
  if (!isDid(did)) throw new Refused(2, SENTENCES.noDid)
  // 3. kms.yaml's account is this DID.
  const api = await kmsApi(repo, deps)
  let config: any
  try { config = api.loadKmsConfig(repo) } catch (err) { throw new Refused(3, `kms.yaml can't be read: ${message(err)}`) }
  const at = config?.atproto && typeof config.atproto === 'object' ? config.atproto as Record<string, unknown> : {}
  const account: Account = { did: at.did, pds: at.pds, handle: at.handle }
  if (account.did !== did) throw new Refused(3, SENTENCES.kmsMismatch)
  // 4. The app password, in the server's environment.
  if (mode.password && !deps.env.ATPROTO_APP_PASSWORD) throw new Refused(4, SENTENCES.noPassword)
  // 5. The DID's document names the PDS kms.yaml names.
  const cache = atprotoCache(repo)
  let reading: Reading | null = null
  if (mode.live) {
    const doc = await resolveDid(did, { fetch: deps.fetch, lookup: deps.lookup, signal: deps.signal })
    if ('problem' in doc) throw new Refused(5, doc.problem)
    if (originOf(doc.pds) === null || originOf(doc.pds) !== originOf(account.pds)) throw new Refused(5, SENTENCES.pdsMismatch)
    await requirePublicPds(doc.pds, deps)
  } else {
    const entry = cache.get(did)
    if (!entry?.reading) throw new Refused(5, SENTENCES.checkFirst)
    // A check that failed after the last good reading: the reading is stale (the repo may have passed the page cap), so
    // it must not drive a delete (Task 3: didDoc ignores lastProblem, so it is looked at here).
    if (entry.lastProblem && Date.parse(entry.lastProblem.at) >= Date.parse(entry.reading.fetchedAt)) throw new Refused(5, SENTENCES.staleSelf)
    const doc = cache.didDoc(did, now)
    if (!doc) throw new Refused(5, SENTENCES.checkFirst)
    if (originOf(doc.pds) === null || originOf(doc.pds) !== originOf(account.pds)) throw new Refused(5, SENTENCES.pdsMismatch)
    reading = entry.reading
  }
  // 6. No placeholder lexicon on a live account (ruling R10).
  if (mode.lexicon && !deps.allowPlaceholderLexicons && placeholderCollections()) throw new Refused(6, SENTENCES.placeholder)
  // 7. Our own records, read back: the PDS is the truth.
  if (mode.live) {
    const got = await readRepo(did, { fetch: deps.fetch, lookup: deps.lookup, signal: deps.signal, now })
    cache.put(did, got, now)
    if ('problem' in got) throw new Refused(7, got.problem)
    reading = got
  }
  // 8. The plan, from the trunk's federation.yaml and what both sides' files say (R4, Task 4's contract).
  const self = await selfAddressesOf(repo, deps.run ?? runCommand)
  const plan = planLinks({
    fed, selfDid: did, ownRecords: reading!.links, ownProfile: reading!.profile, profileUnread: Boolean(reading!.unreadProfile), now,
    where: { base: repo, io: nodePeerIO }, byFiles: byFiles(repo, fed, self),
  })
  // 9. Never every record in one run (R25, ruling R2).
  if (plan.wanted.length === 0 && plan.delete.length >= 2) throw new Refused(9, SENTENCES.massDelete(plan.delete.length))
  return { did, account, api, reading: reading!, plan }
}

/** Refuses a PDS whose host is not DNS-public before anything is written to it (ruling R9). */
async function requirePublicPds(pds: string, deps: PublishDeps): Promise<void> {
  let u: URL
  try { u = new URL(pds) } catch { throw new Refused(5, SENTENCES.privatePds) }
  if (notPublicHttps(u)) throw new Refused(5, SENTENCES.privatePds)
  let addresses: string[]
  try { addresses = await (deps.lookup ?? networkLookup)(u.hostname.toLowerCase().replace(/\.$/, '')) } catch (err) {
    if (noNetwork(err)) throw new Error(scrubber(deps.env.ATPROTO_APP_PASSWORD)(message(err)))
    throw new Refused(5, `Not published: ${u.hostname} could not be found.`)
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) throw new Refused(5, SENTENCES.privatePds)
}

const countOf = (plan: Plan): number => plan.create.length + plan.delete.length + (plan.profile ? 1 : 0)
const keptPrivate = (w: Withheld): string => {
  const k = w.private + w.noUrl
  return k > 0 ? ` ${plural(k, 'peer is', 'peers are')} kept private.` : ''
}

const unreadNote = (withheld: boolean): string => (withheld ? ` ${SENTENCES.profileUnread}` : '')

/** The plan in one sentence: counts only, never a name. */
export function planSentence(plan: Plan): string {
  return `Publish ${plural(plan.create.length, 'link', 'links')} and withdraw ${plan.delete.length}${plan.profile ? ', and update the profile' : ''}.${keptPrivate(plan.withheld)}${unreadNote(plan.profileWithheld)}`
}

/** The writes of a plan by identity, for the job to compare against what it plans fresh. */
export function confirmedOf(plan: Plan): Confirmed {
  return {
    create: plan.create.map(c => c.rkey).sort(),
    delete: plan.delete.map(d => d.uri).sort(),
    profile: plan.profile ? JSON.stringify((plan.profile.record as { networks?: unknown }).networks ?? []) : null,
  }
}

/** What differs between what the operator confirmed and what the job would write now, in words; null when nothing. */
export function changedSince(confirmed: Confirmed, now: Confirmed): string | null {
  const parts: string[] = []
  const list = (label: string, a: string[], b: string[]) => {
    if (a.length === b.length && a.every((x, i) => x === b[i])) return
    parts.push(a.length === b.length ? `${label}: ${b.length}, but not the same ones` : `${label}: ${a.length} → ${b.length}`)
  }
  list('links to publish', confirmed.create, now.create)
  list('links to withdraw', confirmed.delete, now.delete)
  if (confirmed.profile !== now.profile) {
    parts.push(confirmed.profile === null ? 'profile update: no → yes' : now.profile === null ? 'profile update: yes → no' : 'profile update: other networks')
  }
  return parts.length === 0 ? null
    : `Not published: what's on atproto changed since you confirmed (${parts.join('; ')}). Nothing was written. Check the plan again, then publish.`
}

/** `federation.publish-links`'s plan: steps 1–9 from the cache, never a fetch (ruling R6). A refusal is a 409 before
 *  any nonce: `Not published: <sentence>`. Nothing to do is one too. */
export async function planPublish(repo: string, deps: PublishDeps): Promise<{ summary: string; plan: Plan }> {
  let prepared: Prepared
  try { prepared = await prepare(repo, deps, { live: false, password: true, lexicon: true }) } catch (err) {
    if (err instanceof Refused) throw new HttpError(409, `Not published: ${err.sentence}`)
    throw err
  }
  if (countOf(prepared.plan) === 0) throw new HttpError(409, `Not published: ${SENTENCES.nothing}${unreadNote(prepared.plan.profileWithheld)}`)
  return { summary: planSentence(prepared.plan), plan: prepared.plan }
}

/** The in-process body of the confirmed job: steps 1–9 live; then, when `deps.confirmed` is given, the fresh plan must
 *  be the one confirmed (else nothing is written and the sentence says what changed); then the writes through kms's
 *  session, then the receipt. Failures are per record and never stop the rest; a cancel stops between records. Every
 *  error is scrubbed. */
export async function publishLinks(repo: string, deps: PublishDeps): Promise<PublishResult> {
  const password = deps.env.ATPROTO_APP_PASSWORD
  const scrub = scrubber(password)
  try {
    const { did, account, api, reading, plan } = await prepare(repo, deps, { live: true, password: true, lexicon: true })
    // R16: the operator confirmed what gets written. When the fresh plan differs, nothing is written; they confirm again.
    if (deps.confirmed) {
      const changed = changedSince(deps.confirmed, confirmedOf(plan))
      if (changed !== null) throw new Refused(10, changed)
    }
    const applied = { created: 0, deleted: 0, profile: false }
    if (countOf(plan) === 0) return { applied, failures: [], withheld: plan.withheld, profileWithheld: plan.profileWithheld }

    const now = deps.now ?? new Date()
    const guarded = guardedWriteFetch(deps.fetch, { lookup: deps.lookup, signal: deps.signal, scrub })
    // kms's deleteRecord sends no swapRecord, and kms is not changed (R10): the fetch handed to it adds the cid each
    // planned delete was read at, so a record changed since the read is left, never deleted blind.
    const deleteSwaps = new Map(plan.delete.map(d => [d.uri.slice(d.uri.lastIndexOf('/') + 1), d.cid]))
    const fetchImpl = (url: string, init: KmsInit = {}) => {
      if (url.endsWith('/xrpc/com.atproto.repo.deleteRecord') && typeof init.body === 'string') {
        const body = JSON.parse(init.body) as Record<string, unknown>
        const cid = body.collection === LINK_NSID && typeof body.rkey === 'string' ? deleteSwaps.get(body.rkey) : undefined
        if (cid !== undefined && body.swapRecord === undefined) return guarded(url, { ...init, body: JSON.stringify({ ...body, swapRecord: cid }) })
      }
      return guarded(url, init)
    }
    const client = api.createClient({ pds: String(account.pds), fetchImpl })
    const session = await client.login({ identifier: typeof account.handle === 'string' && account.handle !== '' ? account.handle : did, password })
    if (session?.did !== did) throw new Refused(11, SENTENCES.loginMismatch)

    const failures: Failure[] = []
    const created: string[] = []
    const deleted: string[] = []
    let otherDeleted = 0
    const shown = (uri: string): string | null => (isOwnKey(uri) ? uri : null)
    let profileCid: string | null = reading.profile?.cid ?? null
    const uriOf = (collection: string, rkey: string) => `at://${did}/${collection}/${rkey}`
    const stop = () => deps.signal?.aborted === true

    for (const c of plan.create) {
      if (stop()) break
      const uri = uriOf(LINK_NSID, c.rkey)
      try {
        const r = await client.putRecord({ repo: did, collection: LINK_NSID, rkey: c.rkey, record: c.record })
        created.push(typeof r?.uri === 'string' ? r.uri : uri)
      } catch (err) { failures.push({ action: 'create', uri: shown(uri), error: scrub(message(err)) }) }
    }
    for (const d of plan.delete) {
      if (stop()) break
      const rkey = d.uri.slice(d.uri.lastIndexOf('/') + 1)
      try {
        await client.deleteRecord({ repo: did, collection: LINK_NSID, rkey })
        if (isOwnKey(d.uri)) deleted.push(d.uri)
        else otherDeleted += 1
      } catch (err) {
        const swap = (err as { error?: unknown })?.error === 'InvalidSwap'
        failures.push({ action: 'delete', uri: shown(d.uri), error: swap ? SENTENCES.recordChanged : scrub(message(err)) })
      }
    }
    if (plan.profile && !stop()) {
      const uri = uriOf(PROFILE_NSID, 'self')
      try {
        const r = await client.putRecord({ repo: did, collection: PROFILE_NSID, rkey: 'self', record: plan.profile.record, swapRecord: plan.profile.swapRecord })
        if (typeof r?.cid === 'string') profileCid = r.cid
        applied.profile = true
      } catch (err) {
        const swap = (err as { error?: unknown })?.error === 'InvalidSwap'
        failures.push({ action: 'profile', uri, error: swap ? SENTENCES.swap : scrub(message(err)) })
      }
    }
    applied.created = created.length
    applied.deleted = deleted.length + otherDeleted
    writeReceipt(repo, { at: now.toISOString(), did, created, deleted, otherDeleted, profileCid })
    // The cache is what the page and the next plan read: read the records back after writing.
    atprotoCache(repo).put(did, await readRepo(did, { fetch: deps.fetch, lookup: deps.lookup, signal: deps.signal, now }), now)
    if (stop()) {
      throw new Error(applied.created + applied.deleted > 0 || applied.profile
        ? SENTENCES.cancelledAfter(applied.created, applied.deleted, applied.profile) : SENTENCES.cancelled)
    }
    return { applied, failures, withheld: plan.withheld, profileWithheld: plan.profileWithheld }
  } catch (err) {
    throw new Error(scrub(err instanceof Refused ? err.sentence : message(err)))
  }
}

/** What the job's log says: counts and failures, never a peer's name. Any failure fails the job, after the rest. */
export function publishOutput(result: PublishResult): string {
  const { created, deleted, profile } = result.applied
  const head = created + deleted === 0 && !profile && result.failures.length === 0 ? SENTENCES.nothing
    : `Published ${plural(created, 'link', 'links')} and withdrew ${deleted}${profile ? ', and updated the profile' : ''}.`
  const text = `${head}${keptPrivate(result.withheld)}${unreadNote(result.profileWithheld)}`
  const where = (f: Failure) => f.uri ?? 'a record another client keyed'
  if (result.failures.length > 0) throw new Error([text, ...result.failures.map(f => `Not done (${f.action}) ${where(f)}: ${f.error}`)].join('\n'))
  return `${text}\n`
}

// ── the self card's facts, and when Publish is unavailable (ruling R11) ──────────────────────────────────────────

export interface PublishFacts {
  /** The last publish, from the receipt, or null. */
  published: { at: string; created: number; deleted: number } | null
  /** Writes the plan holds now (links to create and withdraw, and a profile change), or null when it can't be planned. */
  toPublish: number | null
  /** The first refusal of the plan's steps that don't depend on the server's deps, with its step, or null. */
  publishBlocked: { step: number; sentence: string } | null
}

/** The self card's publish facts, from the trunk and the cache. Never fetches, never throws. */
export async function publishFacts(repo: string, opts: { run?: Runner; now?: Date; startBranch?: string } = {}): Promise<PublishFacts> {
  const r = readReceipt(repo)
  const published = r ? { at: r.at, created: r.created.length, deleted: r.deleted.length } : null
  try {
    const p = await prepare(repo, { fetch: noFetch, env: {}, run: opts.run, now: opts.now, startBranch: opts.startBranch }, { live: false, password: false, lexicon: false })
    return { published, toPublish: countOf(p.plan), publishBlocked: null }
  } catch (err) {
    return { published, toPublish: null, publishBlocked: err instanceof Refused ? { step: err.step, sentence: err.sentence } : null }
  }
}
const noFetch: FetchLike = async () => { throw new Error('the self card never fetches') }

/** Why Publish can't run on this card, or null: kms's own sentence without kms; then the first refusal of steps 2–4
 *  and 6 (and the cache steps, from the card); then `Nothing to publish.` */
export function publishUnavailable(r: Resource, repo: string, deps: Pick<PublishDeps, 'env' | 'allowPlaceholderLexicons'>): string | null {
  if (r.facts.self !== true) return "offered on this instance's own card"
  const present = kmsPresence(repo)
  if (!present.ok) return present.reason
  const gates: { step: number; sentence: string }[] = []
  const blocked = r.facts.publishBlocked as { step?: unknown; sentence?: unknown } | null | undefined
  if (blocked && typeof blocked.step === 'number' && typeof blocked.sentence === 'string') gates.push({ step: blocked.step, sentence: blocked.sentence })
  if (!deps.env.ATPROTO_APP_PASSWORD) gates.push({ step: 4, sentence: SENTENCES.noPassword })
  if (!deps.allowPlaceholderLexicons && placeholderCollections()) gates.push({ step: 6, sentence: SENTENCES.placeholder })
  gates.sort((a, b) => a.step - b.step)
  if (gates.length > 0) return gates[0].sentence
  if (r.facts.toPublish === 0) return SENTENCES.nothing
  // The card couldn't work the plan out (an unexpected error, not a refusal): never offer a Publish that can't be planned.
  if (typeof r.facts.toPublish !== 'number') return SENTENCES.unplannable
  return null
}

/** `federation.publish-links`, with the deps it reaches the network through (the catalogue passes the real ones). */
export function publishLinksOperation(deps: PublishDeps): Operation {
  return {
    id: 'federation.publish-links', kinds: ['instance'], label: () => 'Publish links', effect: 'changes', network: true,
    timeoutMs: 300_000, params: { type: 'object', additionalProperties: false }, refreshes: 'fleet',
    unavailable: (r, repo) => publishUnavailable(r, repo, deps),
    plan: async (_r, _p, repo, ctx): Promise<InProcess> => {
      const d: PublishDeps = { ...deps, startBranch: ctx?.startBranch ?? deps.startBranch }
      const { summary, plan } = await planPublish(repo, d)
      const confirmed = confirmedOf(plan)
      return { summary, inProcess: async (at, signal) => publishOutput(await publishLinks(at, { ...d, signal, confirmed })) }
    },
  }
}

