import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readGovernance } from '../../lib/governance-read.mjs'
import { membershipTree } from '../../lib/rules.mjs'
import { addressOf, caip10, parseCaip10 } from '../../lib/caip.mjs'
import { hatRef, parseHatRef, prettyHatId } from '../../lib/hats.mjs'
import { isMap } from '../../lib/yaml-util.mjs'
import type { HatAct } from '../../lib/hat-readings.mjs'
import { readRegistry } from '../registry.ts'
import type { SystemReader } from '../systems/reader.ts'
import { FAILED_READ_TTL_MS } from '../systems/driver.ts'
import { SESSION_TTL_MS } from './sessions.ts'

/** A read older than this is refreshed in the background (L5 spec §5.2): a hat taken off narrows reads within it. */
export const HATS_FRESH_MS = 300_000
/** A session whose last good reading is older than this reads as public until a reading succeeds (§5.2). */
export const HATS_GRACE_MS = 3_600_000

/** A kept reading older than this is dropped: no session lives longer than SESSION_TTL_MS, and past the grace a
 *  reading answers nothing anyway. */
export const KEPT_MAX_MS = SESSION_TTL_MS + HATS_GRACE_MS

/** §4.3's sentence: the tree could not be read. Never "not a member" (Review Focus 3). */
export const TREE_UNREADABLE = 'The Hats tree could not be read, so membership is not known. Try again.'
/** §5.2's band for a session past HATS_GRACE_MS. */
export const GRACE_BAND = 'Your hats could not be read for an hour; you see what anyone sees until they can be.'
/** §5.2's sentence for an act whose reading failed. */
export const actUnreadable = (hat: string) => `The Hats tree could not be read, so it is not known that you still wear ${hat}. Nothing was written.`

type System = Record<string, unknown>
export interface MembershipTree { system: System; chain: string; ref: string }
export interface ReadForRead { hats: string[]; block: number; readAt: string; stale: boolean }
export type Refused = { ok: false; error: string }
/** Why an act under a hat was refused (`actFor`): the tree could not be read (a 502), the hat is not worn now, there is
 *  no tree, the hat is no hat ref, or the account is not on the tree's chain (403s). */
export type ActRefusalCode = 'HATS_UNREADABLE' | 'NOT_WORN' | 'NO_TREE' | 'NOT_A_HAT' | 'NOT_ON_CHAIN'
export type ActRefused = Refused & { code: ActRefusalCode }

interface Kept { hats: string[]; block: number; readAt: string; at: number }

/** Membership read from the DAO's Hats tree (L5 spec §5), through `SystemReader.wearer`/`wearers`.
 *  It keeps each account's last good reading. A read (`forRead`) answers that reading and never waits on the network,
 *  refreshing it in the background once it is older than `HATS_FRESH_MS`; an act (`forAct`, `actFor`) reads now (the
 *  reader keeps a reading `OUTCOME_TTL_MS`, 30 s) and refuses when the read fails. The tree is read from
 *  data/governance.yaml and data/systems.yaml at each call, so an edit to either is seen at once. */
export class Membership {
  private readonly kept = new Map<string, Kept>()
  private readonly inflight = new Set<string>()
  /** When a background read last failed, per account: none is started again before FAILED_READ_TTL_MS. */
  private readonly failedAt = new Map<string, number>()
  private readonly repo: string
  private readonly reader: Pick<SystemReader, 'wearer' | 'wearers'>
  private readonly now: () => Date

  constructor(o: { repo: string; reader: Pick<SystemReader, 'wearer' | 'wearers'>; now: () => Date }) {
    this.repo = o.repo
    this.reader = o.reader
    this.now = o.now
  }

  /** The membership tree (§5.1): its System record, its CAIP-2 chain and its tree ref; null when the org has none,
   *  or when data/systems.yaml cannot be read. */
  tree(): MembershipTree | null {
    const systems = this.systems()
    const found = membershipTree(this.governance(), systems)
    if (!found) return null
    const system = systems.find(s => String(s.id) === found.id)
    if (!system) return null
    return { system, chain: String(system.chain), ref: found.tree }
  }

  /** The account's last good reading, for a read; never awaits the network. Null before a first reading (one is
   *  started) or for an account that is not on the tree's chain. Older than `HATS_FRESH_MS`, a reading is refreshed
   *  in the background and still answered; older than `HATS_GRACE_MS`, it answers no hats and `stale: true`, so the
   *  session reads as public until a reading succeeds. */
  forRead(account: string): ReadForRead | null {
    const tree = this.tree()
    const id = tree ? accountOn(tree.chain, account) : null
    if (!tree || !id) return null
    const k = this.kept.get(id)
    const age = k ? this.now().getTime() - k.at : Infinity
    if (age >= HATS_FRESH_MS) this.refresh(tree, id)
    if (!k) return null
    if (age >= HATS_GRACE_MS) return { hats: [], block: k.block, readAt: k.readAt, stale: true }
    return { hats: k.hats, block: k.block, readAt: k.readAt, stale: false }
  }

  /** A reading for an act: no older than the reader's `OUTCOME_TTL_MS`, read now when needed, and kept for reads. */
  async forAct(account: string): Promise<{ ok: true; hats: string[]; block: number; readAt: string } | Refused> {
    const r = await this.readNow(account)
    return r.ok ? { ok: true, hats: r.hats, block: r.block, readAt: r.readAt } : r
  }

  /** What an act under `hat` records (§7.2): the account's fresh reading, which must show the hat worn, and the
   *  hat's wearer list (`complete: false` when that list is partial or could not be read). Refused, writing nothing,
   *  when the tree cannot be read or the hat is not worn now (Review Focus 2). */
  async actFor(account: string, hat: string): Promise<HatAct | ActRefused> {
    const parsed = parseHatRef(hat)
    if (!parsed) return { ok: false, code: 'NOT_A_HAT', error: `${hat} is not a hat ref (eip155:<chain id>:0x followed by 64 hex digits).` }
    const ref = hatRef(parsed.chain, parsed.hatId)
    const read = await this.readNow(account)
    if (!read.ok) {
      if (read.error === TREE_UNREADABLE) return { ok: false, code: 'HATS_UNREADABLE', error: actUnreadable(this.hatName(ref)) }
      return { ...read, code: this.tree() ? 'NOT_ON_CHAIN' : 'NO_TREE' }
    }
    if (!read.hats.includes(ref)) {
      return { ok: false, code: 'NOT_WORN', error: `You do not wear ${this.hatName(ref)} now (read at block ${read.block}), so you cannot act under it. Nothing was written.` }
    }
    const w = await this.reader.wearers(read.tree.system, ref)
    return {
      hat: ref, account: read.id, block: read.block, readAt: read.readAt,
      wearers: w.ok ? w.wearers : [], complete: w.ok ? w.complete : false,
    }
  }

  /** Reads `account` now on the membership tree, keeping a good reading for reads; answers the tree and id it used. */
  private async readNow(account: string): Promise<{ ok: true; tree: MembershipTree; id: string; hats: string[]; block: number; readAt: string } | Refused> {
    const tree = this.tree()
    if (!tree) return { ok: false, error: 'This organisation names no Hats tree for its membership, so there are no hats to act under.' }
    const id = accountOn(tree.chain, account)
    if (!id) return { ok: false, error: `${account} is not an address on ${tree.chain}, the chain of the membership tree.` }
    const r = await this.reader.wearer(tree.system, id)
    if (!r.ok) return { ok: false, error: TREE_UNREADABLE }
    this.keep(id, r)
    return { ok: true, tree, id, hats: r.hats, block: r.block, readAt: r.readAt }
  }

  /** A hat's name for people: the governance role sourced from exactly that hat, else its pretty id. */
  hatName(hat: string): string {
    const parsed = parseHatRef(hat)
    if (!parsed) return hat
    const ref = hatRef(parsed.chain, parsed.hatId)
    const roles = this.governance()?.roles
    if (isMap(roles)) {
      for (const [id, def] of Object.entries(roles)) {
        const p = isMap(def) ? parseHatRef(def.hat) : null
        if (p && hatRef(p.chain, p.hatId) === ref) return id
      }
    }
    return prettyHatId(parsed.hatId)
  }

  /** Keeps a good reading for reads, only for an account that wears a hat or already has a kept reading (a member
   *  whose hats were taken off is narrowed, not forgotten): a sign-in by anyone else leaves nothing behind. Readings
   *  older than `KEPT_MAX_MS` are dropped at each keep, so the map holds the members seen within a session's life. */
  private keep(id: string, r: { hats: string[]; block: number; readAt: string }): void {
    const now = this.now().getTime()
    for (const [k, v] of this.kept) if (now - v.at >= KEPT_MAX_MS) this.kept.delete(k)
    for (const [k, at] of this.failedAt) if (now - at >= FAILED_READ_TTL_MS) this.failedAt.delete(k)
    if (r.hats.length === 0 && !this.kept.has(id)) return
    const read = Date.parse(r.readAt)
    this.kept.set(id, { hats: r.hats, block: r.block, readAt: r.readAt, at: Number.isNaN(read) ? now : read })
  }

  /** One background read per account at a time, and none again within FAILED_READ_TTL_MS of one that failed: a tree
   *  that is down is not asked at every request. A failure keeps the last good reading. */
  private refresh(tree: MembershipTree, id: string): void {
    const failed = this.failedAt.get(id)
    if (this.inflight.has(id) || (failed !== undefined && this.now().getTime() - failed < FAILED_READ_TTL_MS)) return
    this.inflight.add(id)
    void this.reader.wearer(tree.system, id).then(
      r => {
        if (r.ok) { this.failedAt.delete(id); this.keep(id, r) } else this.failedAt.set(id, this.now().getTime())
      },
      () => { this.failedAt.set(id, this.now().getTime()) /* the reader never rejects */ },
    ).finally(() => this.inflight.delete(id))
  }

  private governance(): Record<string, unknown> | null {
    const path = join(this.repo, 'data', 'governance.yaml')
    try {
      return (readGovernance(existsSync(path) ? readFileSync(path, 'utf8') : null) as { governance: Record<string, unknown> | null }).governance
    } catch { return null }
  }

  private systems(): System[] {
    try {
      return existsSync(join(this.repo, 'data', 'systems.yaml')) ? (readRegistry(this.repo, 'systems').entries ?? []) as System[] : []
    } catch { return [] }
  }
}

/** The CAIP-10 id of `account` (a bare address or CAIP-10) on `chain`; null for what is no address or is on another
 *  chain. */
export function accountOn(chain: string, account: string): string | null {
  const p = parseCaip10(account)
  if (p) return p.chain === chain ? `${p.chain}:${p.address}` : null
  try { return caip10(chain, addressOf(account)) } catch { return null }
}
