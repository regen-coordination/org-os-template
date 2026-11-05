import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { stateDir, fileSafe } from '../state.ts'
import { str } from '../resources/util.ts'
import type { Attention } from '../resources/types.ts'
import { FAILED_READ_TTL_MS, READ_TIMEOUT_MS, guardedFetch, guardedPost, type ActionSpec, type Driver, type DriverContext, type DriverRead, type FetchLike, type OutcomeReading, type OutcomeRef, type Prepared, type PreparedAction, type PreparedStep, type ReadingState, type SystemRef } from './driver.ts'
import { readParams } from './actions.ts'
import { chainsOf, prepareSafeTxs, safeAttach, withSafeApiKey } from './safe.ts'
import { addressOf, caip10, sameAccount } from '../../lib/caip.mjs'
import { transition } from '../../lib/machines/run.mjs'
import { reading } from '../../lib/machines/reading.mjs'
import { CHAINS } from './chains.ts'
import { inTree, normalHatId, parseHatRef, treeIdOf } from '../../lib/hats.mjs'
import { HostPacer } from './pacer.ts'
import { DRIVERS } from './drivers.ts'
import { readWearer, readWearers, type HatFact, type WearerReading, type WearersReading } from './hats.ts'

export const READ_TTL_MS = 5 * 60_000
/** Defined with the driver contract (a driver's own limit is built on it); exported here too, where 0.6 kept it. */
export { READ_TIMEOUT_MS }
/** How long a read may wait, behind other reads of the same host, for its first request to go out. */
export const QUEUE_LIMIT_MS = 60_000
/** How long a good outcome reading is kept: long enough that a page opening and a *Check now* ask once. */
export const OUTCOME_TTL_MS = 30_000

export interface SystemReaderOptions {
  repo: string
  /** Absent: drivers that need the network report that they had none. Only the server passes one. */
  fetch?: FetchLike
  now?: () => Date
  drivers?: Driver[]
  ttlMs?: number
  /** How long a failed read stands before the driver is asked again. */
  failedTtlMs?: number
  timeoutMs?: number
  queueLimitMs?: number
  /** How long a good outcome reading is kept. */
  outcomeTtlMs?: number
  /** Configured RPC URLs by CAIP-2 chain (ORG_OS_RPC, `parseRpcConfig`), used instead of the public hosts. */
  rpc?: Record<string, string>
  /** A Safe Transaction Service API key (ORG_OS_SAFE_API_KEY), sent as a bearer token to that service's host only, so
   *  its quota is the key's and not the keyless one (L7 Q95). Never in git, errors, notes or logs. */
  safeApiKey?: string
  /** The wait a driver asks for between its own requests. Absent: a timer the read's time limit cuts off. Tests pass one
   *  that returns at once. */
  sleep?: (ms: number) => Promise<void>
}

type System = Record<string, unknown>
/** A Safe transaction the safe driver would not prepare (a refusal in words, not a failed read). */
class Refused extends Error {}
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** A wearer read that gave no reading: a refusal (`ok: false`), or a read that could not be made (`failed: true`). */
export type WearerRefusal = { ok: false; error: string; failed?: true }

/** Reads systems through their drivers: cached per system for five minutes, the last good read of
 *  a networked system kept on disk, every read limited to eight seconds from its first request (time
 *  spent waiting behind other reads of the same host does not count, up to a minute). It never
 *  rejects: a failure is a read with `ok: false`, carrying the last good read so the page can show
 *  its age. */
export class SystemReader {
  private cache = new Map<string, { key: string; at: number; read: DriverRead }>()
  private inflight = new Map<string, { key: string; promise: Promise<DriverRead> }>()
  private pacer = new HostPacer()
  private states = new Map<string, ReadingState>()
  private outcomes = new Map<string, { at: number; reading: OutcomeReading }>()
  private wearerReadings = new Map<string, { at: number; reading: WearerReading | WearersReading }>()
  constructor(private opts: SystemReaderOptions) {}

  /** Whether any system's latest read failed. */
  hasFailedRead(): boolean { return [...this.cache.values()].some(c => !c.read.ok) }

  /** Forget the failed reads only, so the next `read` of those systems goes to the driver. */
  expireFailed(): void { for (const [id, c] of this.cache) if (!c.read.ok) this.cache.delete(id) }

  /** Forget every cached read, so the next `read` of each system goes to its driver. The tick
   *  calls this: a tick that landed a few ms inside the TTL would otherwise be served from the cache
   *  and the page would go up to two periods without a fresh read. The last good read on disk stays. */
  expire(): void { this.cache.clear() }

  /** One step of the reading machine for this system. Every event the reader sends is legal from
   *  every state it can be in, so a refusal (none expected) leaves the state as it was. */
  private move(id: string, type: 'READ' | 'GOT' | 'FAILED' | 'TTL_PASSED'): void {
    const r = transition(reading, {}, this.states.get(id) ?? 'unknown', { type }, null)
    if (r.ok) this.states.set(id, r.state as ReadingState)
  }

  /** Where this system's reads stand. A fresh read whose cache entry is gone or past the TTL reads
   *  as aged (P4a ruling 8). */
  stateOf(systemId: string): ReadingState {
    const s = this.states.get(systemId) ?? 'unknown'
    if (s !== 'fresh') return s
    const hit = this.cache.get(systemId)
    if (!hit || this.now().getTime() - hit.at >= (this.opts.ttlMs ?? READ_TTL_MS)) {
      this.move(systemId, 'TTL_PASSED')
      return 'aged'
    }
    return 'fresh'
  }

  private now(): Date { return (this.opts.now ?? (() => new Date()))() }

  async read(system: System, members: Record<string, unknown>[] = []): Promise<DriverRead> {
    const id = String(system.id)
    // An edited entry, or a signer's new address, is read again at once.
    const key = JSON.stringify([system, members.map(m => (m.handles as Record<string, unknown> | undefined)?.address ?? null)])
    const at = this.now().getTime()
    const hit = this.cache.get(id)
    if (hit && hit.key === key && at - hit.at < (hit.read.ok ? (this.opts.ttlMs ?? READ_TTL_MS) : (this.opts.failedTtlMs ?? FAILED_READ_TTL_MS))) return hit.read
    // One read per system at a time: a caller that comes while it runs shares it, so the system is
    // asked once, and only that read is cached (a later-finishing failure cannot cover a good read).
    const flying = this.inflight.get(id)
    if (flying && flying.key === key) return flying.promise
    const mine = { key } as { key: string; promise: Promise<DriverRead> }
    this.move(id, 'READ')
    mine.promise = (async () => {
      try {
        const read = await this.readNow(system, members)
        // A read overtaken by one of an edited entry is answered to its callers but not cached,
        // and does not move the state: the read that is cached does.
        if (this.inflight.get(id) === mine) {
          this.cache.set(id, { key, at, read })
          this.move(id, read.ok ? 'GOT' : 'FAILED')
        }
        return read
      } finally {
        if (this.inflight.get(id) === mine) this.inflight.delete(id)
      }
    })()
    this.inflight.set(id, mine)
    return mine.promise
  }

  private async readNow(system: System, members: Record<string, unknown>[]): Promise<DriverRead> {
    const drivers = this.opts.drivers ?? DRIVERS
    const name = str(system.driver) ?? 'link'
    const driver = drivers.find(d => d.name === name)
    if (!driver) return this.failed(system, `no driver named "${name}" is installed (there are: ${drivers.map(d => d.name).join(', ')})`)
    if (driver.hosts.length > 0 && !this.opts.fetch) return this.failed(system, 'this reader was given no network access')
    try {
      const read = await this.drive(driver, members, ctx => driver.read(system, ctx), system)
      if (!read.ok) return this.failed(system, read.error ?? 'the driver reported a failed read')
      if (driver.hosts.length > 0) this.keep(system, read)
      return read
    } catch (err) {
      return this.failed(system, message(err))
    }
  }

  /**
   * The outcome of `ref` as the system's driver reads it (P2 spec §3.11), on the same terms as a read: its declared
   * hosts only, paced with every other read of the host, eight seconds from its first request. A good reading is kept
   * for `outcomeTtlMs`, so a page that opens and a *Check now* right after ask once. Never rejects: a failure is
   * `ok: false`, which the caller shows as attention. Nothing is written here.
   */
  async outcome(system: System, ref: OutcomeRef, opened: string): Promise<OutcomeReading> {
    const drivers = this.opts.drivers ?? DRIVERS
    const name = str(system.driver) ?? 'link'
    const driver = drivers.find(d => d.name === name)
    if (!driver) return { ok: false, error: `no driver named "${name}" is installed (there are: ${drivers.map(d => d.name).join(', ')})` }
    if (!driver.outcome) return { ok: false, error: `the ${name} driver reads no outcomes` }
    if (driver.hosts.length > 0 && !this.opts.fetch) return { ok: false, error: 'this reader was given no network access' }
    const key = JSON.stringify([system, ref, opened])
    const at = this.now().getTime()
    const hit = this.outcomes.get(key)
    if (hit && at - hit.at < (this.opts.outcomeTtlMs ?? OUTCOME_TTL_MS)) return hit.reading
    try {
      const reading = await this.drive(driver, [], ctx => driver.outcome!(system, ref, { ...ctx, opened }), system)
      if (reading.ok) {
        for (const [k, kept] of this.outcomes) if (at - kept.at >= (this.opts.outcomeTtlMs ?? OUTCOME_TTL_MS)) this.outcomes.delete(k)
        this.outcomes.set(key, { at, reading })
      }
      return reading
    } catch (err) {
      return { ok: false, error: message(err) }
    }
  }

  /**
   * The transaction a proposal's action asks for, prepared by the system's driver (P2 spec §3.11 "Prepare"): the payload,
   * its hash and the app link, with what the driver reads (a Safe's nonce and version) read on the same terms as a read:
   * its declared hosts only, paced, eight seconds. Never cached: the nonce is read each time. A driver's own refusal is
   * `ok: false`; a read that could not be made is `ok: false` with `failed: true`. Posts nothing, writes nothing.
   */
  async prepare(system: System, input: Parameters<NonNullable<Driver['prepare']>>[1]): Promise<Prepared | { ok: false; error: string; failed: true }> {
    const drivers = this.opts.drivers ?? DRIVERS
    const name = str(system.driver) ?? 'link'
    const driver = drivers.find(d => d.name === name)
    if (!driver) return { ok: false, error: `no driver named "${name}" is installed (there are: ${drivers.map(d => d.name).join(', ')})` }
    if (!driver.prepare) return { ok: false, error: `the ${name} driver prepares no transactions` }
    if (driver.hosts.length > 0 && !this.opts.fetch) return { ok: false, failed: true, error: 'this reader was given no network access' }
    try {
      return await this.drive(driver, [], ctx => driver.prepare!(system, input, ctx), system)
    } catch (err) {
      return { ok: false, failed: true, error: message(err) }
    }
  }

  /** The driver of a `hats-tree` system, or why there is none: a refusal, or (no network) a read that cannot be made.
   *  Nothing is requested. */
  private hatsDriver(system: System): Driver | WearerRefusal {
    const drivers = this.opts.drivers ?? DRIVERS
    const driver = str(system.driver) === 'hats-tree' ? drivers.find(d => d.name === 'hats-tree') : undefined
    if (!driver) return { ok: false, error: `"${String(system.id)}" is not a Hats tree read by the hats-tree driver` }
    if (!this.opts.fetch) return { ok: false, failed: true, error: 'this reader was given no network access' }
    return driver
  }

  /** A good wearer reading is kept `outcomeTtlMs`, keyed by what was asked. */
  private async keptWearerRead<T extends WearerReading | WearersReading>(key: string, driver: Driver, system: System, run: (ctx: DriverContext) => Promise<T>): Promise<T | WearerRefusal> {
    const ttl = this.opts.outcomeTtlMs ?? OUTCOME_TTL_MS
    const at = this.now().getTime()
    const hit = this.wearerReadings.get(key)
    if (hit && at - hit.at < ttl) return hit.reading as T
    try {
      const reading = await this.drive(driver, [], run, system)
      for (const [k, kept] of this.wearerReadings) if (at - kept.at >= ttl) this.wearerReadings.delete(k)
      this.wearerReadings.set(key, { at, reading })
      return reading
    } catch (err) {
      return { ok: false, failed: true, error: message(err) }
    }
  }

  /** Which hats of the tree `account` wears now, by `isWearerOfHat` on chain. The hats are those of the system's cached
   *  read (read first when there is none). Refuses, in words and without a request, a system that is not a Hats tree
   *  and an account that is not an address (a bare 0x address or CAIP-10). The cached read is used whatever its age, so a
   *  hat made since is not asked about until the tree is read again. A refusal is a plain `ok: false`; a read that
   *  could not be made (the tree unreadable, the network failing, no network) adds `failed: true`. Never rejects. */
  async wearer(system: System, account: string): Promise<WearerReading | WearerRefusal> {
    const driver = this.hatsDriver(system)
    if (!('name' in driver)) return driver
    let who: string
    try { who = addressOf(account) } catch { return { ok: false, error: `${String(account)} is not an address (0x and 40 hex digits)` } }
    let read = this.cache.get(String(system.id))?.read
    if (!read || !read.ok) read = await this.read(system)
    if (!read.ok) return { ok: false, failed: true, error: `the tree could not be read: ${read.error ?? 'no reason given'}` }
    const hats = ((read.facts.hats ?? []) as HatFact[]).map(h => h.id)
    return this.keptWearerRead(JSON.stringify(['wearer', system, who.toLowerCase()]), driver, system, ctx => readWearer(system, who, hats, ctx))
  }

  /** The holders of `hat` that the explorer lists, and which of them wear it now. Refuses a system that is not a Hats
   *  tree and a hat outside it (`hat` a hat ref or a bare hat id), in words and without a request. A refusal is a plain
   *  `ok: false`; a read that could not be made adds `failed: true`. Never rejects. */
  async wearers(system: System, hat: string): Promise<WearersReading | WearerRefusal> {
    const driver = this.hatsDriver(system)
    if (!('name' in driver)) return driver
    const tree = treeIdOf(system.address)
    const parsed = parseHatRef(hat)
    const id = parsed ? parsed.hatId : normalHatId(hat)
    if (tree === null || id === null || (parsed && parsed.chain !== system.chain) || !inTree(id, tree)) {
      return { ok: false, error: `${String(hat)} is not a hat of tree ${String(system.address)} on ${String(system.chain)}` }
    }
    return this.keptWearerRead(JSON.stringify(['wearers', system, id]), driver, system, ctx => readWearers(system, hat, ctx))
  }

  /** The actions a system's driver prepares; none for a driver that prepares none, or none installed. */
  actionsOf(system: System): ActionSpec[] {
    const drivers = this.opts.drivers ?? DRIVERS
    const name = str(system.driver) ?? 'link'
    return drivers.find(d => d.name === name)?.actions ?? []
  }

  /**
   * An action on `system`, prepared by its driver for a proposal (DAO-OS L2): the class and the parameters checked here,
   * the driver run on the same terms as a read, then every step that the Safe `via` signs and that the driver left
   * without a Safe transaction wrapped in one, under the safe driver (its host and pacing), with consecutive nonces per
   * chain. `attach` is the driver's, or, when every step is a Safe transaction of one Safe, the first step's ref with
   * the rest in `also`. A refusal is `ok: false`; a read that could not be made adds `failed: true`. Never cached;
   * nothing is signed, sent or written.
   */
  async prepareAction(system: System, input: { proposal: { classes: readonly string[] }; action: string; params: unknown }, via: System | null): Promise<PreparedAction> {
    const drivers = this.opts.drivers ?? DRIVERS
    const name = str(system.driver) ?? 'link'
    const driver = drivers.find(d => d.name === name)
    if (!driver) return { ok: false, error: `no driver named "${name}" is installed (there are: ${drivers.map(d => d.name).join(', ')})` }
    if (!driver.prepareAction) return { ok: false, error: `the ${name} driver prepares no actions` }
    const specs = driver.actions ?? []
    const spec = specs.find(a => a.id === input.action)
    if (!spec) return { ok: false, error: `the ${name} driver has no action "${input.action}" (its actions: ${specs.map(a => a.id).join(', ') || 'none'})` }
    if (spec.class !== null && !input.proposal.classes.includes(spec.class)) {
      return { ok: false, error: `"${spec.id}" is an action of class ${spec.class}; this proposal is of class ${input.proposal.classes.join(', ') || '(none)'}` }
    }
    const read = readParams(spec, input.params)
    if (!read.ok) return read

    let signer: { account: string } | null = null
    let safeDriver: Driver | undefined
    if (via) {
      const viaId = String(via.id)
      safeDriver = drivers.find(d => d.name === 'safe')
      if (str(via.driver) !== 'safe' || !safeDriver) return { ok: false, error: `"${viaId}" is not a Safe read by the safe driver, so it cannot sign` }
      const chain = str(system.chain)
      let chains: string[]
      try { chains = chainsOf(via) } catch (err) { return { ok: false, error: `the Safe "${viaId}" cannot sign: ${message(err)}` } }
      if (!chain || !chains.includes(chain)) return { ok: false, error: `the Safe "${viaId}" is not on ${chain ?? '(no chain)'} (its chains: ${chains.join(', ')})` }
      try { signer = { account: caip10(chain, addressOf(String(via.address))) } } catch (err) { return { ok: false, error: `the Safe "${viaId}" cannot sign: ${message(err)}` } }
    }

    const networked = driver.hosts.length > 0 || (safeDriver !== undefined && safeDriver.hosts.length > 0)
    if (networked && !this.opts.fetch) return { ok: false, failed: true, error: 'this reader was given no network access' }
    let prepared: PreparedAction
    try {
      prepared = await this.drive(driver, [], ctx => driver.prepareAction!(system, { action: spec.id, params: read.params, via: signer }, ctx), system)
    } catch (err) {
      return { ok: false, failed: true, error: message(err) }
    }
    if (!prepared.ok || !via || !safeDriver) return prepared

    // The steps the Safe signs, each on its own chain, wrapped in Safe transactions with consecutive nonces per chain.
    const viaAddress = String(via.address)
    const signs = (s: PreparedStep) => s.safe === null && s.signer.kind === 'safe' && sameAccount(s.signer.account, caip10(s.call.chain, addressOf(viaAddress)))
    if (!prepared.steps.some(signs)) return prepared
    let steps: PreparedStep[]
    try {
      steps = await this.drive(safeDriver, [], async ctx => {
        // Each chain's Safe is read once for all its steps (prepareSafeTxs), so their nonces are n, n+1, … of one reading.
        const signed = prepared.steps.filter(signs)
        const txs = signed.map(s => ({ chain: s.call.chain, tx: { to: addressOf(s.call.to), value: s.call.value, data: s.call.data, operation: s.call.operation } }))
        const wrapped = await prepareSafeTxs(via, txs, ctx)
        if (!wrapped.ok) throw new Refused(wrapped.error)
        let i = 0
        return prepared.steps.map(step => {
          if (!signs(step)) return step
          const w = wrapped.prepared[i++]!
          return { ...step, safe: { payload: w.payload, ref: w.ref, link: w.link } }
        })
      }, via)
    } catch (err) {
      return err instanceof Refused ? { ok: false, error: err.message } : { ok: false, failed: true, error: message(err) }
    }
    return { ...prepared, steps, attach: prepared.attach ?? safeAttach(steps) }
  }

  /** Run one driver call with the network it may have: `guardedFetch` to its declared hosts, paced per host, cut off
   *  at the read's time limit (which starts when its first request leaves the queue). Throws what the call throws, or
   *  the time limit's sentence. */
  private async drive<T>(driver: Driver, members: Record<string, unknown>[], run: (ctx: DriverContext) => Promise<T>, system: System = {}): Promise<T> {
    const declared = driver.timeoutMs?.(system)
    const timeoutMs = this.opts.timeoutMs ?? (typeof declared === 'number' && Number.isFinite(declared) && declared > 0 ? declared : READ_TIMEOUT_MS)
    const queueLimitMs = this.opts.queueLimitMs ?? QUEUE_LIMIT_MS
    const controller = new AbortController()
    let fail!: (err: Error) => void
    const failure = new Promise<never>((_, reject) => { fail = err => { controller.abort(); reject(err) } })
    // A paced driver's requests wait their turn behind other reads of the same host. The read's
    // limit starts when its first request leaves that queue; until then only the queue limit runs.
    const paced = this.opts.fetch && driver.minGapMs ? this.opts.fetch : null
    let started: number | null = null
    let limit: NodeJS.Timeout | undefined
    let queued: NodeJS.Timeout | undefined
    /** The host the read's first request waits on, once it has asked: a driver that declares several hosts (the Safe's
     *  service and its chains' RPC hosts) names the one it waited behind. */
    let waitingOn: string | null = null
    const startLimit = () => {
      if (started !== null) return
      started = Date.now()
      clearTimeout(queued)
      limit = setTimeout(() => fail(new Error(`no answer within ${timeoutMs / 1000} s`)), timeoutMs)
    }
    if (paced) {
      queued = setTimeout(() => fail(new Error(
        `${waitingOn ?? driver.hosts.join(', ')} is busy: this read waited ${queueLimitMs / 1000} s behind other reads without its turn, ` +
        'so nothing was sent; it will be read again shortly')), queueLimitMs)
    } else startLimit()
    const given = this.opts.sleep
    const sleep = given
      ? async (ms: number) => { controller.signal.throwIfAborted(); await given(ms); controller.signal.throwIfAborted() }
      : (ms: number) => new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, ms)
        controller.signal.addEventListener('abort', () => { clearTimeout(t); reject(controller.signal.reason) }, { once: true })
      })
    const queue = paced ? this.pacer.wrap(paced, driver.minGapMs!, startLimit) : null
    const pacedFetch: FetchLike | undefined = queue
      ? (url, init) => { if (started === null) waitingOn = new URL(url).host; return queue(url, init) }
      : this.opts.fetch
    const fetch = pacedFetch && this.opts.safeApiKey ? withSafeApiKey(pacedFetch, this.opts.safeApiKey) : pacedFetch
    const rpc = this.opts.rpc
    const rpcUrl = (chain: string): string | null => {
      if (rpc && Object.hasOwn(rpc, chain)) return rpc[chain]
      const host = Object.hasOwn(CHAINS, chain) ? CHAINS[chain].rpc : null
      return host ? `https://${host}` : null
    }
    const timeLeftMs = () => timeoutMs - (started === null ? 0 : Date.now() - started)
    try {
      return await Promise.race([
        run({ fetchJson: guardedFetch(driver, fetch, controller.signal), postJson: guardedPost(driver, fetch, controller.signal, rpc), rpcUrl, now: () => this.now(), members, sleep, timeLeftMs }),
        failure,
      ])
    } finally {
      clearTimeout(limit)
      clearTimeout(queued)
    }
  }

  private file(system: System): string { return join(stateDir(this.opts.repo), 'systems', `${fileSafe(String(system.id))}.json`) }

  /** The last good read, written whole then renamed. A cache, not a record: a failure to keep it is not reported. */
  private keep(system: System, read: DriverRead): void {
    try {
      const file = this.file(system)
      mkdirSync(join(file, '..'), { recursive: true })
      const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
      writeFileSync(tmp, JSON.stringify({ key: JSON.stringify(system), read }))
      renameSync(tmp, file)
    } catch { /* see above */ }
  }

  private lastGood(system: System): DriverRead | null {
    try {
      const file = this.file(system)
      if (!existsSync(file)) return null
      const kept = JSON.parse(readFileSync(file, 'utf8')) as { key?: string; read?: DriverRead }
      return kept.key === JSON.stringify(system) && kept.read ? kept.read : null
    } catch { return null }
  }

  private failed(system: System, error: string): DriverRead {
    const last = this.lastGood(system)
    return last ? { ...last, ok: false, error } : { ok: false, readAt: null, error, facts: {}, sections: [], open: null }
  }
}

/** The attention a read raises on its system: a failed read warns; otherwise the first section
 *  with alert rows, then the first with warn rows. */
export function systemAttention(read: DriverRead): Attention | null {
  if (!read.ok) return { level: 'warn', text: `read failed: ${read.error ?? 'no reason given'}` }
  for (const level of ['alert', 'warn'] as const) {
    for (const s of read.sections) {
      const n = s.rows.filter(r => r.attention === level).length
      if (n > 0) return { level, text: `${s.title}: ${n}` }
    }
  }
  return null
}
