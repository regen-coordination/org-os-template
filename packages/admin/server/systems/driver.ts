/** What a system's driver read. Binding shapes: the interfaces contract, "Systems". */
export interface DriverSection {
  title: string; note?: string
  rows: { cells: string[]; attention?: 'warn' | 'alert'; href?: string
    /** CAIP-10 accounts and hat refs the row is about, for the client's address chip. */ refs?: string[] }[]
}
/** Where one system's reads stand (lib/machines/reading.mjs). */
export type ReadingState = 'unknown' | 'reading' | 'fresh' | 'aged' | 'failed'
export interface DriverRead { ok: boolean; readAt: string | null; error?: string; facts: Record<string, unknown>; sections: DriverSection[]; open: { url: string; embeddable: boolean } | null; state?: ReadingState }

import { CHAINS } from './chains.ts'

/** What a driver is handed. It never sees a raw fetch: `fetchJson` reaches only its declared hosts. */
export interface DriverContext {
  /** GET a URL on one of the driver's hosts and parse its JSON. Throws on a refused host, a
   *  non-2xx answer, an answer that is not JSON, or the read's timeout. */
  fetchJson: (url: string) => Promise<unknown>
  /** POST a JSON body to one of the driver's declared hosts (https, default port, no credentials, no redirect) and parse the JSON answer.
   *  Only reads go out: a JSON-RPC request or batch whose every method is in READ_RPC_METHODS, or a GraphQL query with no mutation or
   *  subscription. Anything else is refused before a request is made. Absent only in contexts 0.6 tests build by hand. */
  postJson?: (url: string, body: unknown) => Promise<unknown>
  /** The RPC URL for a chain: the one configured (ORG_OS_RPC), else the public host in CHAINS, else null. */
  rpcUrl?: (chain: string) => string | null
  now: () => Date
  /** data/members.yaml's entries, to name signers and voters. */
  members: Record<string, unknown>[]
  /** Wait, unless the read is cut off meanwhile (then it rejects). Absent: a plain timer. */
  sleep?: (ms: number) => Promise<void>
  /** Milliseconds left of the read's time limit. Absent: no limit is known. */
  timeLeftMs?: () => number
}

/** A read's time limit unless its driver declares another (`Driver.timeoutMs`) or the reader is given one. */
export const READ_TIMEOUT_MS = 8_000

/** How long a failed read is kept before the next one goes to the driver again. */
export const FAILED_READ_TTL_MS = 60_000

/** A non-2xx answer from a system's host (not the server's own HttpError, which answers requests), with what a driver may act on: the status and any Retry-After. */
export class UpstreamHttpError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs: number | null) { super(message) }
}

/** Retry-After as milliseconds: whole seconds or an HTTP date; null when absent or unreadable. */
export function retryAfterMs(value: string | null | undefined): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now())
}
/** What a proposal attaches for a `system` rule (P2 spec §3.11): the system, the outside id (a Safe's `safeTxHash`), and
 *  the payload that id commits to. `data_hash` is Keccak-256 of the call data; `operation` and `nonce` are in the hash. */
export interface SystemRef {
  system: string; id: string
  /** CAIP-2: the chain the transaction is on. Absent: the system record's `chain` (so a 0.6 ref reads as it did). */
  chain?: string
  payload: { to: string; value: string; data_hash: string; operation: number; nonce: number }
  /** The other chains' Safe transactions of the same change, one attach for all of them (each names its chain). The
   *  outcome is executed only when every one is. Absent: one transaction, as in 0.6. */
  also?: { chain: string; id: string; payload: SystemRef['payload'] }[]
}
/** What a proposal attaches for a system that is not a Safe: the system, the outside id and what that id is expected to show.
 *  `payload.kind` says which driver reads it. */
export interface ForeignRef {
  system: string; id: string
  payload:
    | { kind: 'snapshot-proposal'; choice: string /* the label of the choice that must pass */ }
    | { kind: 'hats-wearer'; wearer: string /* CAIP-10 */ }
    | { kind: 'hats-hat'; details: string /* the details the proposal prepared */; existing?: true /* a hat that already exists: its details are being changed */ }
    | { kind: 'gardens-proposal' }
}
/** What a proposal attaches and an outcome is read for: a Safe transaction, or a ref of another system. */
export type OutcomeRef = SystemRef | ForeignRef
/** A ref of another system than a Safe: its payload names a `kind`. */
export const isForeignRef = (ref: OutcomeRef): ref is ForeignRef => 'kind' in ref.payload

/** One chain's reading of an attach that spans several chains (DAO-OS L7 §11.2): the step's chain and Safe transaction
 *  hash, its own outcome, and once executed the block and the chain's transaction hash, as the outside service gives them. */
export interface ChainReading {
  chain: string; id: string; outcome: 'pending' | 'executed' | 'failed' | 'mismatch'; detail: string
  confirmations?: number; required?: number
  /** Executed, and whether it succeeded is not known yet (as `OutcomeReading.executed`). */
  executed?: true
  block?: number; txHash?: string
}

/** An outside outcome as read (§3.11). `mismatch` is a transaction that is not the one the proposal prepared: the
 *  evaluator reads it as pending. A read that could not be made is `ok: false`, and is attention, never a throw. */
export type OutcomeReading =
  | { ok: true; outcome: 'pending' | 'executed' | 'failed' | 'mismatch'; detail: string; confirmations?: number; required?: number
      /** false: the outside service has not seen the transaction yet (a Safe's 404). Answered, never recorded. */
      submitted?: false
      /** Executed on chain, and the service does not say yet whether it succeeded (L7 §11.1). `outcome` stays `pending`,
       *  so the evaluator, which reads the outcome only, does not change (L2-R5); a card reads it as executed, never ready. */
      executed?: true
      /** Each chain's own reading, when the attach spans several chains (L7 §11.2). */
      chains?: ChainReading[] }
  | { ok: false; error: string }

/** The transaction a treasury proposal asks for: what a signer will put in the Safe. */
export interface TxInput { to: string; value: string; data: string; operation: 0 | 1 }
/** The full Safe payload: the transaction, its gas and refund fields (zero), and the Safe's nonce it is for. */
export interface SafePayload extends TxInput { safeTxGas: string; baseGas: string; gasPrice: string; gasToken: string; refundReceiver: string; nonce: number }
/** What `prepare` yields: the payload, the ref an `attach` records (its id the hash of the payload), and where a signer
 *  opens it. It never sends anything: submitting is a signer's act in the Safe app. */
export type Prepared = { ok: true; payload: SafePayload; ref: SystemRef; link: string } | { ok: false; error: string }

/** One input of an action, as a form asks for it and `readParams` (actions.ts) reads it. */
export interface ActionParam { name: string; label: string; optional?: boolean
  type: 'address' | 'addresses' | 'uint' | 'string' | 'text' | 'strings' | 'hat' | 'chains' | 'datetime' }
/** An action a driver can prepare. `class` is the proposal class it needs; null: any class. */
export interface ActionSpec { id: string; label: string; class: string | null; params: ActionParam[] }
/** One contract call a signer makes. Never sent by the house. `chain` is CAIP-2 and always given; `to` is CAIP-10. */
export interface Call { chain: string; to: string; value: string; data: string; operation: 0 | 1; summary: string }
/** Who signs a call. */
export type Signer =
  | { kind: 'safe'; account: string }      // a Safe signs (CAIP-10)
  | { kind: 'wearer'; hat: string }        // a wearer of this hat (a hat ref) signs from their wallet
  | { kind: 'account'; account: string }   // this account signs (CAIP-10)
/** One step of a prepared action: the call, who signs it, and, when a Safe signs, the Safe transaction that carries it. */
export interface PreparedStep { call: Call; signer: Signer; safe: { payload: SafePayload; ref: SystemRef; link: string } | null }
/** A Snapshot proposal, drafted for an author to publish from their own wallet. */
export interface SnapshotDraft { space: string; type: string; title: string; body: string; choices: string[]; start: number; end: number; discussion: string }
/** What `prepareAction` yields. `attach` is the ref the author attaches (for a Safe's steps: the first step's ref with the
 *  rest in `also`); null when there is nothing to attach. A refusal is `ok: false`; a read that could not be made adds
 *  `failed: true`. Nothing is ever signed or sent. */
export type PreparedAction =
  | { ok: true; action: string; steps: PreparedStep[]; draft: SnapshotDraft | null; link: string | null; attach: OutcomeRef | null }
  | { ok: false; error: string; failed?: true }
/** What a driver's `prepareAction` is handed: the action, its parameters as `readParams` read them, and the Safe that
 *  signs (its CAIP-10 account on the target's chain), if one was chosen. */
export interface ActionInput { action: string; params: Record<string, unknown>; via: { account: string } | null }

export interface Driver {
  name: string
  hosts: string[]
  /** Least time between two requests to one host, across all reads. */
  minGapMs?: number
  /** How long one read of this system may take, when 8 s is not enough (e.g. a Safe on seven chains). */
  timeoutMs?(system: Record<string, unknown>): number
  read(system: Record<string, unknown>, ctx: DriverContext): Promise<DriverRead>
  /** For rules with method `system`: the outcome of the attached reference, read only after checking that what was
   *  read is what the proposal committed to (`opened` is the proposal's). May throw; the reader turns a throw into
   *  `ok: false`. */
  outcome?(system: Record<string, unknown>, ref: OutcomeRef, ctx: DriverContext & { opened: string }): Promise<OutcomeReading>
  /** For a driver whose refs are not Safe transactions: check the raw ref an author attaches, with no network. `ref` is the
   *  ref as the driver will read it (ids lowercased, accounts in CAIP-10). A refusal is a sentence. */
  checkRef?(system: Record<string, unknown>, raw: unknown): { ok: true; ref: ForeignRef } | { ok: false; error: string }
  /** The artifact a proposal's action needs (architecture §4.8): for a Safe, the payload, its hash and the app link.
   *  Reads only; posts nothing. */
  prepare?(system: Record<string, unknown>, input: { proposal: { classes: readonly string[] }; tx: TxInput; chain?: string }, ctx: DriverContext): Promise<Prepared>
  /** The actions this driver prepares. */
  actions?: ActionSpec[]
  /** Prepare one of `actions` (the reader has checked the class and read the parameters). Reads only; posts nothing. */
  prepareAction?(system: Record<string, unknown>, input: ActionInput, ctx: DriverContext): Promise<PreparedAction>
}

/** The one network call a driver can cause. `globalThis.fetch` is one; tests pass fakes. */
export type FetchLike = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; redirect: 'error'; signal: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; json(): Promise<unknown> }>

/** The URL checks both doors share: https, no other port, no login in the address, and a host the driver declared
 *  (`hosts` is what is allowed: the declared hosts, plus configured RPC hosts for an RPC-reading driver). */
function checkedUrl(driver: Pick<Driver, 'name' | 'hosts'>, allowed: readonly string[], url: string): URL {
  let u: URL
  try { u = new URL(url) } catch { throw new Error(`refused: "${url}" is not an address`) }
  // Default port and no credentials: a declared host name must not be reachable on another port
  // or carry a login in the address.
  if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '' || !allowed.includes(u.hostname)) {
    throw new Error(`refused: the ${driver.name} driver declared ${driver.hosts.length > 0 ? driver.hosts.join(', ') : 'no hosts'}, not ${u.protocol}//${u.host}`)
  }
  return u
}

/** Send one request and parse its JSON answer; the failures a person reads. A GET names the host and the path (the
 *  declared hosts are fixed public ones); a POST names the host only, never a path or query, because a configured RPC
 *  URL (ORG_OS_RPC) may carry a key there. */
async function exchange(fetch: FetchLike | undefined, signal: AbortSignal, u: URL, method: 'GET' | 'POST', body?: string): Promise<unknown> {
  // A driver that keeps going after the time limit never issues another request.
  signal.throwIfAborted()
  if (!fetch) throw new Error('this reader was given no network access')
  const headers: Record<string, string> = body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' }
  let res: Awaited<ReturnType<FetchLike>>
  try {
    res = await fetch(u.href, body === undefined ? { method, headers, redirect: 'error', signal } : { method, headers, body, redirect: 'error', signal })
  } catch (err) {
    if (signal.aborted) throw err
    // fetch says only "fetch failed"; what happened (a name not found, a refused connection) is its cause.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : null
    throw new Error(`${u.host} could not be reached (${unkeyed(cause ?? (err instanceof Error ? err.message : String(err)))})`)
  }
  const what = method === 'GET' ? ` for ${u.pathname}` : ''
  if (!res.ok) throw new UpstreamHttpError(`${u.host} answered ${res.status}${what}`, res.status, retryAfterMs(res.headers?.get('retry-after')))
  try { return await res.json() } catch { throw new Error(`${u.host} did not answer JSON${what}`) }

  /** A library's own message with the address, the path and the query taken out (a POST's), the host left. */
  function unkeyed(text: string): string {
    if (method === 'GET') return text
    const parts = [u.href, `${u.pathname}${u.search}`, u.search, u.pathname].filter(p => p !== '' && p !== '/')
    return parts.reduce((t, p) => t.split(p).join(p === u.href ? u.host : '…'), text)
  }
}

/** The fetch a driver is handed: https only, to a host it declared, GET, and no redirect, so an
 *  answer cannot send it anywhere else. */
export function guardedFetch(driver: Pick<Driver, 'name' | 'hosts'>, fetch: FetchLike | undefined, signal: AbortSignal): (url: string) => Promise<unknown> {
  return async (url: string) => exchange(fetch, signal, checkedUrl(driver, driver.hosts, url), 'GET')
}

/** JSON-RPC methods that only read. */
export const READ_RPC_METHODS: readonly string[] = ['eth_call', 'eth_blockNumber', 'eth_chainId', 'eth_getCode']

/** null when `body` is a read; otherwise the sentence that refuses it. */
export function readOnlyBody(body: unknown): string | null {
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
  const rpc = (r: unknown) => isObject(r) && ('method' in r || 'jsonrpc' in r)
  if (Array.isArray(body) ? body.length > 0 && body.every(rpc) : rpc(body)) {
    for (const r of (Array.isArray(body) ? body : [body]) as Record<string, unknown>[]) {
      // A request carries only JSON-RPC's own keys: a GraphQL host ignores `method` and would run a `query` beside it.
      const extra = Object.keys(r).find(k => !['jsonrpc', 'id', 'method', 'params'].includes(k))
      if (extra !== undefined) return `refused: a JSON-RPC request carries only jsonrpc, id, method and params, not "${extra}"`
      if (typeof r.method !== 'string' || !READ_RPC_METHODS.includes(r.method)) {
        return `refused: the JSON-RPC method ${JSON.stringify(r.method)} is not a read (only ${READ_RPC_METHODS.join(', ')} go out)`
      }
    }
    return null
  }
  if (isObject(body) && typeof body.query === 'string') {
    const extra = Object.keys(body).find(k => !['query', 'variables', 'operationName'].includes(k))
    if (extra !== undefined) return `refused: a GraphQL request carries only query, variables and operationName, not "${extra}"`
    // One left-to-right pass, so whichever token starts first wins: a `"""` inside a comment cannot open a block string.
    const bare = body.query.replace(/"""(?:\\"""|[\s\S])*?"""|"(?:[^"\\\n]|\\.)*"|#[^\n]*/g, ' ')
    const m = /\b(mutation|subscription)\b/.exec(bare)
    return m ? `refused: a GraphQL ${m[1]} is not a read` : null
  }
  return 'refused: only a JSON-RPC read or a GraphQL query goes out'
}

/** POST for a driver: the same address checks as `guardedFetch`, then only a read (`readOnlyBody`) goes out, as JSON, with
 *  no redirect. `rpc` is the configured RPC URLs (ORG_OS_RPC): their hosts are allowed for a driver that declares a
 *  public RPC host from CHAINS, and for no other. */
export function guardedPost(driver: Pick<Driver, 'name' | 'hosts'>, fetch: FetchLike | undefined, signal: AbortSignal, rpc?: Record<string, string>): (url: string, body: unknown) => Promise<unknown> {
  const readsChains = driver.hosts.some(h => Object.values(CHAINS).some(c => c.rpc === h))
  const allowed = readsChains && rpc ? [...driver.hosts, ...Object.values(rpc).map(u => new URL(u).hostname)] : driver.hosts
  return async (url: string, body: unknown) => {
    const u = checkedUrl(driver, allowed, url)
    // Check exactly what is sent: a toJSON or getter cannot answer differently the second time.
    const text = JSON.stringify(body)
    if (text === undefined) throw new Error('refused: only a JSON-RPC read or a GraphQL query goes out')
    const refusal = readOnlyBody(JSON.parse(text))
    if (refusal) throw new Error(refusal)
    return exchange(fetch, signal, u, 'POST', text)
  }
}
