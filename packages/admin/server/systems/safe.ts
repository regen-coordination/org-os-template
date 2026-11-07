import { str, list } from '../resources/util.ts'
import { READ_TIMEOUT_MS, UpstreamHttpError, isForeignRef, type ActionSpec, type ChainReading, type Driver, type DriverContext, type DriverRead, type DriverSection, type FetchLike, type OutcomeReading, type Prepared, type PreparedAction, type PreparedStep, type SafePayload, type SystemRef, type TxInput } from './driver.ts'
import { safeTxHash, dataHash, chainIdOf, hashableVersion, ZERO_ADDRESS, SAFE_MIN_VERSION, NONCE_MOVED } from '../../lib/safe-tx.mjs'
import { caip10, checksumAddress, isAddress, parseCaip2 } from '../../lib/caip.mjs'
import { encodeCall } from '../../lib/abi.mjs'
import { CHAINS, chainInfo } from './chains.ts'
import { readSafeOnChain, isSafeRead, type NotASafe, type SafeOnChainRead } from './safe-rpc.ts'
import { TRANSFER_PAGES, newestFirst, readTransfers, type Transfer } from './safe-transfers.ts'

/** Reads a Safe from the Safe Transaction Service, without a key. It never posts, never asks for or
 *  stores a key, and never touches signing (spec §7.3). It also prepares a transaction (its payload and
 *  hash, for a signer to put in the Safe app) and reads one transaction's outcome (P2 spec §3.11). */
export const SAFE_HOST = 'api.safe.global'

/** CAIP-2 chain → the service's network name (which the Safe app also uses): every chain in `CHAINS` that has a Safe
 *  Transaction Service slug (each checked with GET /tx-service/<slug>/api/v1/about/ on 2026-10-29). */
export const NETWORKS: Record<string, { slug: string; name: string; native: string }> = Object.fromEntries(
  Object.entries(CHAINS).flatMap(([chain, c]) => (c.safe === null ? [] : [[chain, { slug: c.safe, name: c.name, native: c.native }]])),
)

/** How loudly a chain (or a signer) that disagrees with the first chain read is shown. A different owner set or threshold
 *  on a Safe that should be the same everywhere is something a person must look at, not a footnote. */
export const DISAGREE_LEVEL = 'alert' as const

/** The keyless API answers 429 to a burst, so requests go one at a time, at least this far apart. */
export const SAFE_REQUEST_GAP_MS = 1_000
/** How long to wait before the one retry of a 429 that names no Retry-After. */
export const SAFE_RETRY_DEFAULT_MS = 2_000
/** A retry that must wait longer than this is not attempted. */
export const SAFE_RETRY_MAX_MS = 5_000
/** Time a request itself needs; a retry must leave this much of the read's limit. */
const REQUEST_MARGIN_MS = 1_500
/** Transactions asked for in the one list call: up to 20 waiting, and the latest 5 executed. */
export const SAFE_TX_LIMIT = 25
const SHOWN_WAITING = 20
const SHOWN_EXECUTED = 5

/** `fetch`, with the Safe Transaction Service API key as a bearer token on requests to SAFE_HOST and to no other host
 *  (L7 Q95). The key is a header only: never in a URL, so no error, note or log that names a URL can carry it. */
export function withSafeApiKey(fetch: FetchLike, key: string): FetchLike {
  return (url, init) => (new URL(url).hostname === SAFE_HOST ? fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${key}` } }) : fetch(url, init))
}

export const safeApi = (slug: string) => `https://${SAFE_HOST}/tx-service/${slug}/api`
export const safeAppUrl = (slug: string, address: string) => `https://app.safe.global/home?safe=${slug}:${address}`
export const safeTxUrl = (slug: string, address: string, safeTxHash: string) =>
  `https://app.safe.global/transactions/tx?safe=${slug}:${address}&id=multisig_${address}_${safeTxHash}`
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** Base units as a number a person reads: at most four decimals, trailing zeros dropped. */
export function formatUnits(raw: string, decimals: number): string {
  let n: bigint
  try { n = BigInt(raw) } catch { return raw }
  const negative = n < 0n
  if (negative) n = -n
  const unit = 10n ** BigInt(decimals)
  const fraction = (n % unit).toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '')
  return `${negative ? '-' : ''}${n / unit}${fraction ? `.${fraction}` : ''}`
}

/** How long ago, short: "4 min", "30 h", "12 d"; '' when the time cannot be read. */
export function ago(iso: string | null | undefined, now: Date): string {
  const t = iso ? Date.parse(iso) : Number.NaN
  if (Number.isNaN(t)) return ''
  const minutes = Math.max(0, Math.floor((now.getTime() - t) / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} d`
}

interface SafeInfo { address: string; nonce: string | number; threshold: number; owners: string[]; version?: string | null }
interface Page<T> { count: number; results: T[] }
interface Balance { tokenAddress: string | null; token: { symbol?: string; decimals?: number } | null; balance: string }
interface MultisigTx {
  safeTxHash: string; nonce: number; to: string; value: string; data?: string | null
  dataDecoded?: { method?: string } | null; confirmationsRequired: number; confirmations?: { owner: string }[] | null
  submissionDate: string; executionDate: string | null; isSuccessful: boolean | null
  /** Once executed: the block and the chain's transaction hash. */
  blockNumber?: number | null; transactionHash?: string | null
  operation?: number; safeTxGas?: string | number; baseGas?: string | number; gasPrice?: string | number
  gasToken?: string; refundReceiver?: string
}

/** The member whose handles.address holds `owner` on this chain (a bare 0x address on any chain). */
export function signerName(owner: string, chain: string, members: Record<string, unknown>[]): string | null {
  for (const m of members) {
    const handles = (m.handles && typeof m.handles === 'object' ? m.handles : {}) as Record<string, unknown>
    for (const value of list(handles.address)) {
      const parts = value.split(':')
      const address = parts.at(-1) ?? ''
      const onChain = parts.length === 3 ? `${parts[0]}:${parts[1]}` : null
      if (address.toLowerCase() === owner.toLowerCase() && (onChain === null || onChain === chain)) return str(m.name) ?? String(m.id)
    }
  }
  return null
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** The Safe's transfers on one chain in the window (safe-transfers.ts), asked after every chain's own reads through the
 *  getter's `once` (the gap, no retry: C12 review I-3): null when they could not be read, or not read whole, so the Safe's
 *  read still stands, inside its time, and nothing says a window was quiet, or whole, that was not. */
async function transfersOn(get: Getter, at: { api: string; address: string; chain: string; native: string }, ctx: DriverContext): Promise<Transfer[] | null> {
  try {
    return await readTransfers(get.once, at, ctx.now(), () => ctx.timeLeftMs?.() ?? Infinity, SAFE_REQUEST_GAP_MS + REQUEST_MARGIN_MS)
  } catch { return null }
}

/** A paced getter: a call retries a 429 once; `once` never does (for what the read can go without). */
type Getter = ((url: string) => Promise<unknown>) & { once(url: string): Promise<unknown> }

/** GETs one after another: a gap before every request but the first (whichever way it is asked), and one retry of a
 *  429 unless asked `once`. */
function sequential(ctx: DriverContext): Getter {
  const sleep = ctx.sleep ?? defaultSleep
  let first = true
  const send = async (url: string, retry: boolean): Promise<unknown> => {
    if (!first) await sleep(SAFE_REQUEST_GAP_MS)
    first = false
    try { return await ctx.fetchJson(url) } catch (err) {
      if (!(err instanceof UpstreamHttpError) || err.status !== 429) throw err
      const wait = Math.max(err.retryAfterMs ?? SAFE_RETRY_DEFAULT_MS, SAFE_REQUEST_GAP_MS)
      // Still a 429, so a read that can read the chain instead (fromChain) knows the service did not answer.
      const limited = new UpstreamHttpError(`${SAFE_HOST} is rate-limiting this read (${err.message}); it will be read again shortly`, 429, err.retryAfterMs)
      if (!retry || wait > SAFE_RETRY_MAX_MS || wait + REQUEST_MARGIN_MS > (ctx.timeLeftMs?.() ?? Infinity)) throw limited
      await sleep(wait)
      try { return await ctx.fetchJson(url) } catch (again) {
        if (again instanceof UpstreamHttpError && again.status === 429) throw limited
        throw again
      }
    }
  }
  return Object.assign((url: string) => send(url, true), { once: (url: string) => send(url, false) })
}

/** The service's answers a read from the chain stands in for (L7-D15): a Safe it has not indexed (404, a fork's
 *  included) and its keyless quota (403, 429). Any other failure is the service's own, and stands. */
export const CHAIN_FALLBACK_STATUSES: readonly number[] = [403, 404, 429]
/** What a read from the chain says about itself, in facts.note and beside its rows. */
export const chainNote = (status: number) => `Read from the chain: the Safe Transaction Service did not answer (${status})`

/** The status of a service failure a read from the chain may stand in for; null for any other failure. */
function fallbackStatus(err: unknown): number | null {
  return err instanceof UpstreamHttpError && CHAIN_FALLBACK_STATUSES.includes(err.status) ? err.status : null
}

/** The Safe on `chain` read from the chain, in place of a service that failed with `err`. Null when `err` is not one
 *  a read from the chain stands in for, when this context reads no chain, or when the chain could not be read either:
 *  the caller keeps the service's failure then. On a 403 or 429 the service's failure also stands unless the chain is
 *  definite (a Safe read, or no code at the address): a contract that does not answer a Safe's views says less than the
 *  service would have (fix r1 M2). On a 404 the service has no such Safe, so what the chain says is said. */
async function fromChain(err: unknown, ctx: DriverContext, chain: string, address: string): Promise<{ read: SafeOnChainRead | NotASafe; status: number } | null> {
  const status = fallbackStatus(err)
  if (status === null || !ctx.postJson || !ctx.rpcUrl?.(chain)) return null
  let read: SafeOnChainRead | NotASafe
  try { read = await readSafeOnChain(ctx, chain, address) } catch { return null }
  if (status !== 404 && !isSafeRead(read) && !read.missing) return null
  return { read, status }
}

/** A read from the chain as the service's SafeInfo, for prepare. */
const infoFrom = (r: SafeOnChainRead): SafeInfo => ({ address: r.address, nonce: r.nonce, threshold: r.threshold, owners: r.owners, version: r.version })

/** One chain's Safe as read from the chain: its signers, and what the chain says of the Safe itself. Waiting
 *  transactions and balances are the service's to say, so they are not here; the note says why. */
function chainRead(r: SafeOnChainRead, net: (typeof NETWORKS)[string], status: number, ctx: DriverContext): DriverRead {
  const note = chainNote(status)
  /** What a view gave: an address, 'none' for an empty slot, or 'not known' for a view the Safe did not answer. */
  const said = (v: string | null, field: NonNullable<SafeOnChainRead['unknown']>[number]) => v ?? (r.unknown?.includes(field) ? 'not known' : 'none')
  return {
    ok: true,
    readAt: ctx.now().toISOString(),
    facts: {
      chain: r.chain, network: net.name, address: r.address, account: caip10(r.chain, r.address), shortAddress: shortAddress(r.address),
      threshold: r.threshold, owners: r.owners.length, nonce: r.nonce, version: r.version, source: 'chain', note,
      modules: r.modules === null ? null : r.modules.map(m => caip10(r.chain, m)), guard: r.guard, fallbackHandler: r.fallbackHandler, singleton: r.singleton, block: r.block,
    },
    sections: [
      { title: 'Signers', note: `${r.threshold} of ${r.owners.length} needed`,
        rows: r.owners.map(owner => ({ cells: [owner, signerName(owner, r.chain, ctx.members) ?? '—'] })) },
      { title: 'Safe', note,
        rows: [
          { cells: ['Version', r.version] }, { cells: ['Nonce', String(r.nonce)] },
          { cells: ['Modules', r.modules === null ? 'not known' : r.modules.length === 0 ? 'none' : r.modules.join(', ')] },
          { cells: ['Guard', said(r.guard, 'guard')] }, { cells: ['Fallback handler', said(r.fallbackHandler, 'fallbackHandler')] },
          { cells: ['Block', String(r.block)] },
        ] },
    ],
    open: { url: safeAppUrl(net.slug, r.address), embeddable: false },
  }
}

/** One chain, as 0.6 read it (plus `account`, and its transfers in the window: `transfers`); from the chain when the
 *  service does not answer (L7-D15). */
async function readOne(system: Record<string, unknown>, ctx: DriverContext): Promise<DriverRead> {
  const { chain, net, address } = safeOf(system)
  const api = safeApi(net.slug)
  const get = sequential(ctx)
  let info: SafeInfo, balances: Page<Balance>, all: (MultisigTx & { isExecuted?: boolean })[]
  try {
    info = (await get(`${api}/v1/safes/${address}/`)) as SafeInfo
    balances = (await get(`${api}/v2/safes/${address}/balances/`)) as Page<Balance>
    // One list holds both: the service orders it by nonce, newest first, waiting and executed together.
    all = ((await get(`${api}/v1/safes/${address}/multisig-transactions/?limit=${SAFE_TX_LIMIT}`)) as Page<MultisigTx & { isExecuted?: boolean }>).results ?? []
  } catch (err) {
    const fallback = await fromChain(err, ctx, chain, address)
    if (fallback === null) throw err
    if (!isSafeRead(fallback.read)) throw new Error(fallback.read.error)
    return chainRead(fallback.read, net, fallback.status, ctx)
  }
  const nonce = Number(info.nonce)
  const pending = { results: all.filter(tx => !tx.isExecuted && tx.nonce >= nonce).sort((a, b) => a.nonce - b.nonce).slice(0, SHOWN_WAITING) }
  const executed = { results: all.filter(tx => tx.isExecuted).sort((a, b) => b.nonce - a.nonce).slice(0, SHOWN_EXECUTED) }
  const transfers = await transfersOn(get, { api, address, chain, native: net.native }, ctx)
  const now = ctx.now()
  const summary = (tx: MultisigTx) => {
    const method = tx.dataDecoded?.method ?? (tx.data && tx.data !== '0x' ? 'contract call' : 'transfer')
    const value = tx.value && tx.value !== '0' ? ` · ${formatUnits(tx.value, 18)} ${net.native}` : ''
    return `${method} → ${shortAddress(tx.to)}${value}`
  }
  /** A link only for a real Safe transaction hash: it is put into a URL the client will open. */
  const txHref = (tx: MultisigTx) => (/^0x[0-9a-fA-F]{64}$/.test(String(tx.safeTxHash)) ? { href: safeTxUrl(net.slug, address, tx.safeTxHash) } : {})
  const waiting = pending.results
  const sections: DriverSection[] = [
    {
      title: 'Waiting on signers',
      note: waiting.length === 0 ? 'nothing waiting' : `${info.threshold} of ${info.owners.length} signatures needed`,
      rows: waiting.map(tx => ({
        cells: [`#${tx.nonce}`, summary(tx), `${tx.confirmations?.length ?? 0} of ${info.threshold} signatures`, ago(tx.submissionDate, now)],
        attention: 'alert' as const,
        ...txHref(tx),
      })),
    },
    {
      title: 'Balances',
      note: `${balances.results.length} ${balances.results.length === 1 ? 'token' : 'tokens'}`,
      rows: balances.results.map(b => ({
        cells: [b.token?.symbol ?? (b.tokenAddress ? shortAddress(b.tokenAddress) : net.native), formatUnits(b.balance, b.token?.decimals ?? 18)],
      })),
    },
    {
      title: 'Signers',
      note: `${info.threshold} of ${info.owners.length} needed`,
      rows: info.owners.map(owner => ({ cells: [owner, signerName(owner, chain, ctx.members) ?? '—'] })),
    },
    {
      title: 'Executed',
      note: `the latest ${executed.results.length}`,
      rows: executed.results.map(tx => ({
        cells: [`#${tx.nonce}`, summary(tx), ago(tx.executionDate, now), tx.isSuccessful === false ? 'failed' : 'ok'],
        ...txHref(tx),
      })),
    },
  ]
  return {
    ok: true,
    readAt: now.toISOString(),
    facts: {
      chain, network: net.name, address, account: caip10(chain, address), shortAddress: shortAddress(address), threshold: info.threshold,
      owners: info.owners.length, nonce, pending: waiting.length, version: info.version ?? null,
      transfers: transfers === null ? null : newestFirst(transfers),
    },
    sections,
    open: { url: safeAppUrl(net.slug, address), embeddable: false },
  }
}

type ExecutedTx = MultisigTx & { isExecuted?: boolean }
interface ChainRead {
  chain: string; net: (typeof NETWORKS)[string]; address: string
  info?: SafeInfo; balances?: Balance[]; waiting?: MultisigTx[]; executed?: ExecutedTx[]
  nonce?: number; error?: string; missing?: boolean
  /** Read from the chain, because the service did not answer with this status (L7-D15). */
  fromChain?: number
  /** The chain's transfers in the window; null when they could not be read. */
  transfers?: Transfer[] | null
}

/** One chain of a several-chain Safe. A chain that answers 404 for the Safe, or whose requests fail, is a row, not a throw. */
async function readChain(system: Record<string, unknown>, chain: string, get: (url: string) => Promise<unknown>, ctx: DriverContext): Promise<ChainRead> {
  const { net, address } = safeOf(system, chain)
  const api = safeApi(net.slug)
  const out: ChainRead = { chain, net, address }
  try {
    let info: SafeInfo, balances: Page<Balance>, all: ExecutedTx[]
    try {
      info = (await get(`${api}/v1/safes/${address}/`)) as SafeInfo
      balances = (await get(`${api}/v2/safes/${address}/balances/`)) as Page<Balance>
      all = ((await get(`${api}/v1/safes/${address}/multisig-transactions/?limit=${SAFE_TX_LIMIT}`)) as Page<ExecutedTx>).results ?? []
    } catch (err) {
      const fallback = await fromChain(err, ctx, chain, address)
      if (fallback !== null) {
        const r = fallback.read
        if (!isSafeRead(r)) return { ...out, missing: true, error: r.error }
        return { ...out, info: infoFrom(r), nonce: r.nonce, balances: [], waiting: [], executed: [], fromChain: fallback.status }
      }
      if (err instanceof UpstreamHttpError && err.status === 404) return { ...out, missing: true, error: `no Safe at this address on ${net.name}` }
      throw err
    }
    const nonce = safeNonce(info)
    return {
      ...out, info, nonce, balances: balances.results ?? [],
      waiting: all.filter(tx => !tx.isExecuted && tx.nonce >= nonce).sort((a, b) => a.nonce - b.nonce).slice(0, SHOWN_WAITING),
      executed: all.filter(tx => tx.isExecuted).sort((a, b) => b.nonce - a.nonce).slice(0, SHOWN_EXECUTED),
    }
  } catch (err) {
    return { ...out, error: err instanceof Error ? err.message : String(err) }
  }
}

/** One Safe on several chains, read one request at a time through one getter (so the gap holds across chains). A chain
 *  that disagrees with the first chain read is `DISAGREE_LEVEL`; one that failed or holds no Safe is `warn`. */
async function readMany(system: Record<string, unknown>, ctx: DriverContext): Promise<DriverRead> {
  const chains = chainsOf(system)
  const get = sequential(ctx)
  const reads: ChainRead[] = []
  for (const chain of chains) reads.push(await readChain(system, chain, get, ctx))
  const good = reads.filter(r => r.info)
  if (good.length === 0) throw new Error(reads[0]!.error ?? 'nothing could be read')
  // the transfers last, once every chain's own reads are in (C12 review I-3). A chain read from the chain is not asked:
  // its service did not answer, and transfers are the service's to say (L7-D15), so they are not known (null)
  for (const r of good) r.transfers = r.fromChain !== undefined ? null
    : await transfersOn(get, { api: safeApi(r.net.slug), address: r.address, chain: r.chain, native: r.net.native }, ctx)
  const now = ctx.now()
  const base = good[0]!
  const { address } = base
  const ownersOf = (r: ChainRead) => r.info!.owners.map(o => o.toLowerCase()).sort().join(',')
  const disagrees = (r: ChainRead) => r.info !== undefined && (ownersOf(r) !== ownersOf(base) || r.info.threshold !== base.info!.threshold)
  const disagreeing = good.filter(disagrees)
  const failed = reads.filter(r => !r.info)

  const summary = (tx: MultisigTx, native: string) => {
    const method = tx.dataDecoded?.method ?? (tx.data && tx.data !== '0x' ? 'contract call' : 'transfer')
    const value = tx.value && tx.value !== '0' ? ` · ${formatUnits(tx.value, 18)} ${native}` : ''
    return `${method} → ${shortAddress(tx.to)}${value}`
  }
  const txHref = (r: ChainRead, tx: MultisigTx) => (/^0x[0-9a-fA-F]{64}$/.test(String(tx.safeTxHash)) ? { href: safeTxUrl(r.net.slug, r.address, tx.safeTxHash) } : {})

  const chainRows: DriverSection['rows'] = reads.map(r => {
    const common = { href: safeAppUrl(r.net.slug, r.address), refs: [caip10(r.chain, r.address)] }
    if (!r.info) return { cells: [r.net.name, r.missing ? r.error! : `read failed: ${r.error}`], attention: 'warn' as const, ...common }
    return {
      cells: [r.net.name, `${r.info.threshold} of ${r.info.owners.length}`, `nonce ${r.nonce}`, r.fromChain !== undefined ? 'read from the chain' : `${r.waiting!.length} waiting`],
      ...(disagrees(r) ? { attention: DISAGREE_LEVEL } : {}), ...common,
    }
  })
  const notRead = failed.length ? `; not read: ${failed.map(r => r.net.name).join(', ')}` : ''
  const fromChainNames = good.filter(r => r.fromChain !== undefined).map(r => r.net.name)
  const onChain = fromChainNames.length ? `; read from the chain: ${fromChainNames.join(', ')}` : ''
  const chainsNote = disagreeing.length ? `chains disagree: ${disagreeing.map(r => r.net.name).join(', ')}${notRead}${onChain}` : `all ${good.length} chains agree${notRead}${onChain}`

  const waitingRows = good.flatMap(r => r.waiting!.map(tx => ({
    cells: [r.net.name, `#${tx.nonce}`, summary(tx, r.net.native), `${tx.confirmations?.length ?? 0} of ${r.info!.threshold} signatures`, ago(tx.submissionDate, now)],
    attention: 'alert' as const, ...txHref(r, tx),
  })))

  const balanceRows = good.flatMap(r => r.balances!.map(b => ({
    cells: [r.net.name, b.token?.symbol ?? (b.tokenAddress ? shortAddress(b.tokenAddress) : r.net.native), formatUnits(b.balance, b.token?.decimals ?? 18)],
  })))

  // Owners in first-seen order, each with the chains it sits on.
  const seen = new Map<string, { owner: string; on: ChainRead[] }>()
  for (const r of good) for (const o of r.info!.owners) {
    const key = o.toLowerCase()
    const entry = seen.get(key) ?? { owner: checksumAddress(o), on: [] }
    entry.on.push(r); seen.set(key, entry)
  }
  const signerRows = [...seen.values()].map(({ owner, on }) => {
    const everywhere = on.length === good.length
    return {
      cells: [owner, signerName(owner, on[0]!.chain, ctx.members) ?? '—', everywhere ? 'all chains' : on.map(r => r.net.name).join(', ')],
      ...(everywhere ? {} : { attention: DISAGREE_LEVEL }), refs: [caip10(chains[0]!, owner)],
    }
  })

  const executed = good.flatMap(r => r.executed!.map(tx => ({ r, tx })))
    .sort((a, b) => Date.parse(b.tx.executionDate ?? '') - Date.parse(a.tx.executionDate ?? '') || 0).slice(0, SHOWN_EXECUTED)
  const executedRows = executed.map(({ r, tx }) => ({
    cells: [r.net.name, `#${tx.nonce}`, summary(tx, r.net.native), ago(tx.executionDate, now), tx.isSuccessful === false ? 'failed' : 'ok'],
    ...txHref(r, tx),
  }))

  const pending = good.reduce((n, r) => n + r.waiting!.length, 0)
  const sections: DriverSection[] = [
    { title: 'Chains', note: chainsNote, rows: chainRows },
    { title: 'Waiting on signers', note: pending === 0 ? 'nothing waiting' : `${pending} waiting across ${good.length} chains`, rows: waitingRows },
    { title: 'Balances', note: `${balanceRows.length} ${balanceRows.length === 1 ? 'balance' : 'balances'} on ${good.length} chains`, rows: balanceRows },
    { title: 'Signers', note: `${seen.size} ${seen.size === 1 ? 'signer' : 'signers'}; ${base.info!.threshold} of ${base.info!.owners.length} needed on ${base.net.name}`, rows: signerRows },
    { title: 'Executed', note: `the latest ${executedRows.length}`, rows: executedRows },
  ]
  return {
    ok: true,
    readAt: now.toISOString(),
    facts: {
      chain: chains[0]!, address, account: caip10(chains[0]!, address), shortAddress: shortAddress(address), network: NETWORKS[chains[0]!]!.name,
      threshold: base.info!.threshold, owners: base.info!.owners.length, nonce: base.nonce!, version: base.info!.version ?? null,
      pending, agree: disagreeing.length === 0 && failed.length === 0,
      // every chain's, or null when a chain could not give them whole, or its Safe could not be read (a chain with no
      // Safe has none): a partial flow is never drawn as the window (C12 review I-1)
      transfers: reads.some(r => !r.info && !r.missing) || good.some(r => r.transfers == null) ? null : newestFirst(good.flatMap(r => r.transfers!)),
      chains: reads.map(r => ({
        chain: r.chain, network: r.net.name, account: caip10(r.chain, r.address), ok: r.info !== undefined,
        ...(r.info
          ? { threshold: r.info.threshold, owners: r.info.owners.map(o => caip10(r.chain, o)), nonce: r.nonce!, version: r.info.version ?? null,
              // A chain read from the chain does not say what waits: no `pending`, which a reader takes as not known (fix r1 M1).
              ...(r.fromChain !== undefined ? { source: 'chain', note: chainNote(r.fromChain) } : { pending: r.waiting!.length }) }
          : { error: r.error }),
      })),
    },
    sections,
    open: { url: safeAppUrl(NETWORKS[chains[0]!]!.slug, address), embeddable: false },
  }
}

/** Where a Safe's owners list starts (OwnerManager's SENTINEL_OWNERS): the "previous owner" of the first owner. */
export const SENTINEL_OWNERS = '0x0000000000000000000000000000000000000001'

const OWNER = { name: 'owner', label: 'Owner', type: 'address' } as const
const THRESHOLD = { name: 'threshold', label: 'Signatures needed', type: 'uint' } as const
const CHAINS_PARAM = { name: 'chains', label: 'Chains', type: 'chains', optional: true } as const

/** What a Safe's owners can change about the Safe itself, each one Safe transaction per chain to the Safe (spec Q-L2-2:
 *  class governance). Default chains: every one of the Safe's chains; default threshold: the chain's own. */
export const SAFE_ACTIONS: ActionSpec[] = [
  { id: 'add-owner', label: 'Add an owner', class: 'governance', params: [OWNER, { ...THRESHOLD, optional: true }, CHAINS_PARAM] },
  { id: 'remove-owner', label: 'Remove an owner', class: 'governance', params: [OWNER, { ...THRESHOLD, optional: true }, CHAINS_PARAM] },
  { id: 'change-threshold', label: 'Change the signatures needed', class: 'governance', params: [THRESHOLD, CHAINS_PARAM] },
]

export const safe: Driver = {
  name: 'safe',
  // The service, then every chain's public RPC host: a read from the chain when the service cannot answer (L7-D15).
  hosts: [SAFE_HOST, ...new Set(Object.values(CHAINS).flatMap(c => (c.safe !== null && c.rpc ? [c.rpc] : [])))],
  minGapMs: SAFE_REQUEST_GAP_MS,
  /** Three requests a chain and up to TRANSFER_PAGES of transfers, each after the gap: the first three are 0.6's 8 s. */
  timeoutMs(system) {
    let n = 1
    try { n = chainsOf(system).length } catch { /* read() says why */ }
    return READ_TIMEOUT_MS + (n * (3 + TRANSFER_PAGES) - 3) * (SAFE_REQUEST_GAP_MS + 500)
  },
  async read(system, ctx): Promise<DriverRead> {
    return chainsOf(system).length === 1 ? readOne(system, ctx) : readMany(system, ctx)
  },


  /** The treasury transaction of 0.6, on one of the Safe's chains (`chain`; absent: the record's `chain`). */
  async prepare(system, { proposal, tx, chain }, ctx): Promise<Prepared> {
    if (!proposal.classes.includes('treasury')) {
      return { ok: false, error: `prepare makes a Safe transaction for a treasury proposal; this one is of class ${proposal.classes.join(', ') || '(none)'}.` }
    }
    return prepareSafeTx(system, chain ?? str(system.chain) ?? '', tx, ctx)
  },

  actions: SAFE_ACTIONS,

  async prepareAction(system, input, ctx): Promise<PreparedAction> {
    return prepareOwnerAction(system, input.action, input.params, ctx)
  },

  /** The outcome of an attached Safe transaction, read on its chain; with `also`, of every step on its own chain. */
  async outcome(system, ref, ctx): Promise<OutcomeReading> {
    if (isForeignRef(ref)) throw new Error(`a Safe reads a Safe transaction hash, not a ${ref.payload.kind} ref`)
    const chains = chainsOf(system)
    const steps: Step[] = [{ chain: ref.chain ?? str(system.chain) ?? '', id: ref.id, payload: ref.payload }, ...(Array.isArray(ref.also) ? ref.also : [])]
    for (const step of steps) if (!chains.includes(step.chain)) throw new Error(notOnChain(step.chain, chains))
    const get = sequential(ctx)
    if (steps.length === 1) {
      // One transaction reads as 0.6 and L2 read it: the block and transaction hash are said per chain only.
      const { block: _block, txHash: _txHash, ...reading } = await outcomeOn(system, steps[0]!, get, ctx.opened)
      return reading
    }
    const read: { net: string; step: Step; reading: StepReading }[] = []
    for (const step of steps) read.push({ net: NETWORKS[step.chain]!.name, step, reading: await outcomeOn(system, step, get, ctx.opened) })
    // Each chain's own reading, beside the aggregate (L7 §11.2).
    const each: ChainReading[] = read.map(({ step, reading: r }) => ({
      chain: step.chain, id: step.id, outcome: r.outcome, ...(r.executed ? { executed: true as const } : {}), detail: r.detail,
      ...(r.confirmations !== undefined ? { confirmations: r.confirmations } : {}), ...(r.required !== undefined ? { required: r.required } : {}),
      ...(r.block !== undefined ? { block: r.block } : {}), ...(r.txHash !== undefined ? { txHash: r.txHash } : {}),
    }))
    const names = (rs: typeof read) => [...new Set(rs.map(r => r.net))].join(', ')
    for (const outcome of ['failed', 'mismatch'] as const) {
      const first = read.find(r => r.reading.outcome === outcome)
      if (first) return { ok: true, outcome, detail: `on ${first.net}: ${first.reading.detail}`, chains: each }
    }
    const waiting = read.filter(r => r.reading.outcome !== 'executed')
    if (waiting.length === 0) return { ok: true, outcome: 'executed', detail: `executed on every chain: ${names(read)}`, chains: each }
    // Executed everywhere, success not yet known on some: pending to the evaluator, executed to a card (§11.1).
    if (waiting.every(r => r.reading.executed)) {
      return { ok: true, outcome: 'pending', executed: true, detail: `executed on every chain; not yet known whether it succeeded on ${names(waiting)}`, chains: each }
    }
    return {
      ok: true, outcome: 'pending', detail: `waiting on ${names(waiting)}`,
      ...(read.every(r => r.reading.submitted === false) ? { submitted: false as const } : {}), chains: each,
    }
  },
}

/** One Safe transaction of an attached ref: its chain (always named here), its hash and the payload the hash commits to. */
type Step = { chain: string; id: string; payload: SystemRef['payload'] }
/** One step's reading, with the block and the chain's transaction hash once executed (the service's `blockNumber` and
 *  `transactionHash`). */
type StepReading = Extract<OutcomeReading, { ok: true }> & { block?: number; txHash?: string }

/** The outcome of one Safe transaction on one chain, read only after checking that what the service describes is what
 *  was prepared (0.6's reading, on `step.chain`). */
async function outcomeOn(system: Record<string, unknown>, step: Step, get: (url: string) => Promise<unknown>, opened: string): Promise<StepReading> {
  const { chain, net, address } = safeOf(system, step.chain)
  const ref = step
  if (typeof ref.id !== 'string' || !SAFE_TX_HASH.test(ref.id)) throw new Error(`"${String(ref.id)}" is not a Safe transaction hash`)
  const chainId = chainIdOf(chain)
  if (chainId === null) throw new Error(`chain ${chain} has no EIP-155 chain id, so the transaction read cannot be checked against the attached hash`)
  const api = safeApi(net.slug)
  /** Whether the Safe's nonce has moved past `prepared`: then a transaction for it can never execute (LOW-6). */
  const nonceMoved = async (prepared: number) => safeNonce((await get(`${api}/v1/safes/${address}/`)) as SafeInfo) > prepared
  const mismatch = (detail: string): StepReading => ({ ok: true, outcome: 'mismatch', detail })

  let tx: MultisigTx & { isExecuted?: boolean }
  try {
    tx = (await get(`${api}/v1/multisig-transactions/${ref.id}/`)) as MultisigTx & { isExecuted?: boolean }
  } catch (err) {
    if (!(err instanceof UpstreamHttpError) || err.status !== 404) throw err
    if (await nonceMoved(ref.payload.nonce)) return mismatch(NONCE_MOVED)
    return { ok: true, outcome: 'pending', submitted: false, detail: `transaction ${ref.id} is not in the Safe Transaction Service yet: a signer adds it in the Safe app, with the payload the proposal prepared` }
  }

  // M6: only the transaction the proposal committed to counts.
  if (String(tx.safeTxHash).toLowerCase() !== ref.id.toLowerCase()) {
    return mismatch(`${NOT_PREPARED}: the Safe answered for ${String(tx.safeTxHash)}, and the proposal attached ${ref.id}`)
  }
  if (String(tx.to).toLowerCase() !== String(ref.payload.to).toLowerCase()) return mismatch(`${NOT_PREPARED}: its to differs`)
  if (!sameAmount(tx.value, ref.payload.value)) return mismatch(`${NOT_PREPARED}: its value differs`)
  if (dataHash(tx.data ?? null) !== String(ref.payload.data_hash).toLowerCase()) return mismatch(`${NOT_PREPARED}: its data differs`)
  // The service's own safeTxHash field is not trusted: the hash is computed again from every field it describes, on
  // this Safe and chain, so a gas refund, an operation or a nonce the payload did not hold cannot pass as the one prepared.
  let own: string
  try {
    own = safeTxHash({
      chainId, safe: address, to: tx.to, value: tx.value, data: tx.data ?? null, operation: tx.operation as number,
      safeTxGas: tx.safeTxGas ?? 0, baseGas: tx.baseGas ?? 0, gasPrice: tx.gasPrice ?? 0,
      gasToken: tx.gasToken ?? ZERO_ADDRESS, refundReceiver: tx.refundReceiver ?? ZERO_ADDRESS, nonce: tx.nonce,
    })
  } catch (err) {
    return mismatch(`${NOT_PREPARED}: the Safe's answer cannot be hashed (${err instanceof Error ? err.message : String(err)})`)
  }
  if (own !== ref.id.toLowerCase()) return mismatch(`${NOT_PREPARED}: the transaction the Safe describes hashes to ${own}, not to the attached ${ref.id}`)
  if (!(Date.parse(tx.submissionDate) >= Date.parse(opened))) {
    return mismatch(`${NOT_PREPARED}: it was put in the Safe on ${tx.submissionDate}, before the proposal opened on ${opened}. ` +
      'Withdraw the proposal and propose again, or revise it to prepare a new transaction.')
  }

  const signatures = { confirmations: tx.confirmations?.length ?? 0, required: tx.confirmationsRequired }
  if (tx.isExecuted) {
    const onChain = {
      ...(Number.isSafeInteger(tx.blockNumber) ? { block: tx.blockNumber as number } : {}),
      ...(typeof tx.transactionHash === 'string' && SAFE_TX_HASH.test(tx.transactionHash) ? { txHash: tx.transactionHash.toLowerCase() } : {}),
    }
    if (tx.isSuccessful === true) return { ok: true, outcome: 'executed', ...signatures, detail: `executed on ${tx.executionDate}`, ...onChain }
    if (tx.isSuccessful === false) return { ok: true, outcome: 'failed', ...signatures, detail: `executed on ${tx.executionDate}, and the transaction failed`, ...onChain }
    // Executed; success not known yet (L7 §11.1): pending to the evaluator, never ready to a card.
    return { ok: true, outcome: 'pending', executed: true, ...signatures, detail: `executed on ${tx.executionDate}; the Safe does not say yet whether it succeeded`, ...onChain }
  }
  if (await nonceMoved(tx.nonce)) return mismatch(NONCE_MOVED)
  return { ok: true, outcome: 'pending', ...signatures, detail: `${signatures.confirmations} of ${signatures.required} signatures` }
}

/**
 * The Safe transaction that carries `tx` on `chain`, one of the Safe's chains (`chainsOf`): its payload with the Safe's
 * nonce on that chain plus `nonceOffset` (several transactions of one action on one chain take consecutive nonces,
 * L2-R8), its hash on that chain's id, and the Safe app link. The nonce and version are read from the Safe Transaction
 * Service unless `info` gives them. The ref names its chain only when it is not the record's `chain`, so a 0.6 ref is
 * unchanged. Reads only; posts nothing. A refusal is `ok: false`; a read that fails throws.
 */
export async function prepareSafeTx(target: Record<string, unknown>, chain: string, tx: TxInput, ctx: DriverContext,
  opts: { nonceOffset?: number; info?: { nonce: string | number; version?: string | null } } = {}): Promise<Prepared> {
  const chains = chainsOf(target)
  if (!chains.includes(chain)) return { ok: false, error: notOnChain(chain, chains) }
  const { net, address } = safeOf(target, chain)
  const chainId = chainIdOf(chain)
  if (chainId === null) return { ok: false, error: `chain ${chain} has no EIP-155 chain id, so no Safe transaction hash can be computed for it.` }
  const fields = { to: tx.to, value: tx.value, data: tx.data ?? '0x', operation: tx.operation }
  try { safeTxHash({ chainId, safe: address, ...fields, nonce: 0 }) } catch (err) {
    return { ok: false, error: `Not prepared: ${err instanceof Error ? err.message : String(err)}.` }
  }
  let info = opts.info
  if (!info) {
    const read = await infoOn(target, chain, sequential(ctx), ctx)
    if (!read.ok) return read
    info = read.info
  }
  const version = typeof info.version === 'string' ? info.version : null
  if (!hashableVersion(version)) {
    return { ok: false, error: version !== null && /^\d+\.\d+\.\d+/.test(version)
      ? `This Safe is version ${version}, older than ${SAFE_MIN_VERSION}: its transaction hash has no chain id, so the platform prepares none. Prepare the transaction in the Safe app.`
      : `The Safe Transaction Service does not say this Safe's version${version === null ? '' : ` in a form the platform reads ("${version}")`}, so its transaction hash cannot be computed. Prepare the transaction in the Safe app.` }
  }
  const nonce = safeNonce(info) + (opts.nonceOffset ?? 0)
  const payload: SafePayload = {
    ...fields, value: String(fields.value), safeTxGas: '0', baseGas: '0', gasPrice: '0', gasToken: ZERO_ADDRESS, refundReceiver: ZERO_ADDRESS, nonce,
  }
  const ref: SystemRef = {
    system: String(target.id), id: safeTxHash({ chainId, safe: address, ...payload }),
    ...(chain !== str(target.chain) ? { chain } : {}),
    payload: { to: payload.to, value: payload.value, data_hash: dataHash(payload.data), operation: payload.operation, nonce },
  }
  return { ok: true, payload, ref, link: safeAppUrl(net.slug, address) }
}

/** One Safe as the service describes it on one chain. */
type SafeOnChain = { ok: true; chain: string; net: (typeof NETWORKS)[string]; address: string; info: SafeInfo }

/** The Safe `target` on `chain`, read once from the service, or from the chain when the service does not answer
 *  (403, 404, 429) and the context reads the chain (L7-D15). No code there is a refusal naming the chain; when the chain
 *  cannot be read either, the service's failure is thrown. */
async function infoOn(target: Record<string, unknown>, chain: string, get: (url: string) => Promise<unknown>, ctx: DriverContext): Promise<{ ok: true; info: SafeInfo } | { ok: false; error: string }> {
  const { net, address } = safeOf(target, chain)
  try {
    return { ok: true, info: (await get(`${safeApi(net.slug)}/v1/safes/${address}/`)) as SafeInfo }
  } catch (err) {
    const fallback = await fromChain(err, ctx, chain, address)
    if (fallback === null) throw err
    return isSafeRead(fallback.read) ? { ok: true, info: infoFrom(fallback.read) } : { ok: false, error: fallback.read.error }
  }
}

/** The Safe `target` on `chain` (infoOn); a service 404 the chain could not stand in for is a refusal naming the chain
 *  (the service has no Safe at this address there), any other failure throws. */
async function readSafeOn(target: Record<string, unknown>, chain: string, get: (url: string) => Promise<unknown>, ctx: DriverContext): Promise<SafeOnChain | { ok: false; error: string }> {
  const { net, address } = safeOf(target, chain)
  try {
    const read = await infoOn(target, chain, get, ctx)
    return read.ok ? { ok: true, chain, net, address, info: read.info } : read
  } catch (err) {
    if (err instanceof UpstreamHttpError && err.status === 404) return { ok: false, error: `no Safe at this address on ${net.name}` }
    throw err
  }
}

/** The owners the service gave, or a thrown sentence (a failed read): never an empty list in place of a missing one. */
function ownersOf(info: SafeInfo, where: string): string[] {
  if (!Array.isArray(info.owners)) throw new Error(`the Safe Transaction Service gave no list of owners for this Safe on ${where}`)
  return info.owners
}

/** The threshold the service gave, as a whole number of 1 or more, or a thrown sentence (a failed read). */
function thresholdOf(info: SafeInfo, where: string): number {
  const raw = info.threshold as unknown
  if (raw === undefined || raw === null) throw new Error(`the Safe Transaction Service gave no threshold for this Safe on ${where}`)
  const n = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : Number.NaN
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`the Safe Transaction Service gave the threshold ${JSON.stringify(raw)} for this Safe on ${where}, which is not a threshold`)
  return n
}

/**
 * Several Safe transactions of one action from the Safe `target`, in the order given: each chain's Safe read once (one
 * GET per chain, so its nonce cannot move between two steps' reads), and the steps on one chain given consecutive nonces
 * from it (L2-R8). A chain the record does not list, or where the service has no Safe, is a refusal; a read that fails
 * throws. Reads only; posts nothing.
 */
export async function prepareSafeTxs(target: Record<string, unknown>, txs: { chain: string; tx: TxInput }[], ctx: DriverContext):
  Promise<{ ok: true; prepared: Extract<Prepared, { ok: true }>[] } | { ok: false; error: string }> {
  const chains = chainsOf(target)
  const off = txs.find(t => !chains.includes(t.chain))
  if (off) return { ok: false, error: notOnChain(off.chain, chains) }
  const get = sequential(ctx)
  const infos = new Map<string, SafeInfo>()
  const offsets = new Map<string, number>()
  const prepared: Extract<Prepared, { ok: true }>[] = []
  for (const { chain, tx } of txs) {
    let info = infos.get(chain)
    if (!info) {
      const read = await readSafeOn(target, chain, get, ctx)
      if (!read.ok) return read
      info = read.info
      infos.set(chain, info)
    }
    const nonceOffset = offsets.get(chain) ?? 0
    offsets.set(chain, nonceOffset + 1)
    const one = await prepareSafeTx(target, chain, tx, ctx, { info, nonceOffset })
    if (!one.ok) return one
    prepared.push(one)
  }
  return { ok: true, prepared }
}

/** The ref an author attaches for steps that are all Safe transactions of one Safe: the first step's ref, with the
 *  others in `also`, each naming its chain. Null when a step is not a Safe transaction, or the steps span two Safes. */
export function safeAttach(steps: PreparedStep[]): SystemRef | null {
  if (steps.length === 0 || steps.some(s => s.safe === null)) return null
  const [first, ...rest] = steps as (PreparedStep & { safe: NonNullable<PreparedStep['safe']> })[]
  if (rest.some(s => s.safe.ref.system !== first!.safe.ref.system)) return null
  if (rest.length === 0) return first!.safe.ref
  return { ...first!.safe.ref, also: rest.map(s => ({ chain: s.call.chain, id: s.safe.ref.id, payload: s.safe.ref.payload })) }
}

/** add-owner, remove-owner, change-threshold: the Safe read on each chosen chain, every refusal made before anything is
 *  prepared, then one Safe transaction per chain with the info that was read. */
async function prepareOwnerAction(system: Record<string, unknown>, action: string, params: Record<string, unknown>, ctx: DriverContext): Promise<PreparedAction> {
  const spec = SAFE_ACTIONS.find(a => a.id === action)
  if (!spec) return { ok: false, error: `the safe driver has no action "${action}" (its actions: ${SAFE_ACTIONS.map(a => a.id).join(', ')})` }
  const all = chainsOf(system)
  const asked = Array.isArray(params.chains) ? (params.chains as string[]) : all
  const off = asked.find(c => !all.includes(c))
  if (off !== undefined) return { ok: false, error: notOnChain(off, all) }
  const chosen = all.filter(c => asked.includes(c))
  const owner = typeof params.owner === 'string' ? checksumAddress(params.owner) : null
  const given = params.threshold === undefined ? null : BigInt(String(params.threshold))

  const get = sequential(ctx)
  const reads: SafeOnChain[] = []
  for (const chain of chosen) {
    const read = await readSafeOn(system, chain, get, ctx)
    if (!read.ok) return read
    reads.push(read)
  }

  const planned: { r: (typeof reads)[number]; data: string; summary: string }[] = []
  for (const r of reads) {
    const where = r.net.name
    const owners = ownersOf(r.info, where).map(o => checksumAddress(o))
    const current = BigInt(thresholdOf(r.info, where))
    const index = owner === null ? -1 : owners.findIndex(o => o.toLowerCase() === owner.toLowerCase())
    const bounds = (t: bigint, count: number) =>
      t < 1n || t > BigInt(count) ? `a threshold of ${t} cannot be: on ${where} it must be from 1 to ${count}` : null
    const said = (t: bigint, count: number) => `${t === current ? 'keep' : 'now'} ${t} of ${count}`
    if (action === 'add-owner') {
      if (index >= 0) return { ok: false, error: `${owner} is already an owner of this Safe on ${where}` }
      const count = owners.length + 1
      const t = given ?? current
      const bad = bounds(t, count)
      if (bad) return { ok: false, error: bad }
      planned.push({ r, data: encodeCall('addOwnerWithThreshold(address,uint256)', [owner, t]), summary: `add owner ${shortAddress(owner!)}, ${said(t, count)}` })
    } else if (action === 'remove-owner') {
      if (index < 0) return { ok: false, error: `${owner} is not an owner of this Safe on ${where}` }
      const count = owners.length - 1
      if (count === 0) return { ok: false, error: `${owner} is the only owner of this Safe on ${where}; a Safe keeps at least one` }
      const t = given ?? (current > BigInt(count) ? BigInt(count) : current)
      const bad = bounds(t, count)
      if (bad) return { ok: false, error: bad }
      const prev = index === 0 ? SENTINEL_OWNERS : owners[index - 1]!
      planned.push({ r, data: encodeCall('removeOwner(address,address,uint256)', [prev, owner, t]), summary: `remove owner ${shortAddress(owner!)}, ${said(t, count)}` })
    } else {
      const t = given!
      const bad = bounds(t, owners.length)
      if (bad) return { ok: false, error: bad }
      // A chain already at this threshold needs no transaction.
      if (t === current) continue
      planned.push({ r, data: encodeCall('changeThreshold(uint256)', [t]), summary: `change the threshold from ${current} to ${t} of ${owners.length}` })
    }
  }
  if (planned.length === 0) return { ok: false, error: `the threshold is already ${given} on every chosen chain` }

  const steps: PreparedStep[] = []
  for (const { r, data, summary } of planned) {
    const safeAccount = caip10(r.chain, r.address)
    const prepared = await prepareSafeTx(system, r.chain, { to: checksumAddress(r.address), value: '0', data, operation: 0 }, ctx, { info: r.info })
    if (!prepared.ok) return prepared
    steps.push({
      call: { chain: r.chain, to: safeAccount, value: '0', data, operation: 0, summary },
      signer: { kind: 'safe', account: safeAccount },
      safe: { payload: prepared.payload, ref: prepared.ref, link: prepared.link },
    })
  }
  return { ok: true, action, steps, draft: null, link: steps[0]!.safe!.link, attach: safeAttach(steps) }
}

const SAFE_TX_HASH = /^0x[0-9a-fA-F]{64}$/
/** What a reading says when the transaction read is not the one the proposal committed to (spec §3.11, M6). */
const NOT_PREPARED = 'this transaction is not the one the proposal prepared'

/** The system record's network and address, or a thrown sentence. `chain` defaults to the record's own. */
function safeOf(system: Record<string, unknown>, onChain?: string): { chain: string; net: (typeof NETWORKS)[string]; address: string } {
  const chain = onChain ?? str(system.chain)
  const net = chain && Object.hasOwn(NETWORKS, chain) ? NETWORKS[chain] : undefined
  if (!chain || !net) throw new Error(unknownChain(chain))
  const address = str(system.address)
  if (!address || !isAddress(address)) throw new Error(`"${address ?? ''}" is not a Safe address`)
  return { chain, net, address }
}

/** A chain the Safe record does not list. */
const notOnChain = (chain: string, chains: string[]) => `${chain} is not one of this Safe's chains (${chains.join(', ')})`

const unknownChain = (chain: string | null | undefined) =>
  `no Safe Transaction Service network is known for chain ${chain ?? '(none given)'} (known: ${Object.keys(NETWORKS).join(', ')})`

/** The chains a record reads: its `chain`, then its `chains`, without repeats. Throws a sentence for an entry that is not
 *  CAIP-2 or that has no Safe Transaction Service. */
export function chainsOf(system: Record<string, unknown>): string[] {
  const first = str(system.chain)
  if (!first || !Object.hasOwn(NETWORKS, first)) throw new Error(unknownChain(first))
  const out = [first]
  for (const c of list(system.chains)) {
    if (!parseCaip2(c)) throw new Error(`"${c}" is not a CAIP-2 chain id (like eip155:42220)`)
    if (!chainInfo(c)?.safe) throw new Error(unknownChain(c))
    if (!out.includes(c)) out.push(c)
  }
  return out
}

/** The Safe's nonce as the service gives it (a string), or a thrown sentence. */
function safeNonce(info: Pick<SafeInfo, 'nonce'>): number {
  const nonce = Number(info.nonce)
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error(`the Safe Transaction Service gave the nonce ${JSON.stringify(info.nonce)}, which is not a nonce`)
  return nonce
}

/** Two amounts in base units, as the same integer. */
function sameAmount(a: unknown, b: unknown): boolean {
  const [x, y] = [String(a), String(b)]
  return /^\d+$/.test(x) && /^\d+$/.test(y) && BigInt(x) === BigInt(y)
}
