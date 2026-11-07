import type { DriverRead, Resource } from '../../api.ts'
import type { Mark } from '../../design/StatusMark.tsx'
import { driverOf, safeHref } from '../../systems/DriverView.tsx'

/** Where a System's address is shown: a chip (a Safe, a Gardens community or pool), a Mono id (a Hats tree:
 *  `42220 / 13`), or the host it lives at (a Snapshot space: `snapshot.box`). */
export type SystemAddress = { chip: string } | { mono: string } | { host: string }

/** What a System's row and record header show, read from its Resource (the systems adapter's facts, the driver's
 *  read in `facts.driver`). */
export interface SystemFacts {
  kind: string
  /** CAIP-2: a Safe's chains as its driver read them, else the entry's one chain (or the read's). */
  chains: string[]
  /** How many of `chains` agree with the first good chain (for the chain chip): a chain that failed to read is a
   *  warning, not a disagreement, and is not counted against it. */
  agree: number
  address: SystemAddress | null
  /** The fact that says how it is governed: "4 of 8 signers", "13 hats", "42 members". */
  governs: string | null
  read: DriverRead | null
  /** The System's own link-out, when its read gives an http(s) address. */
  open: { label: string; href: string } | null
}

/** Readers for driver facts, whose shapes the client does not trust: a non-empty string, a finite number, an object,
 *  a list of objects — else null, `{}`, `[]`. Needs you reads the same facts with them. */
export const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
export const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(record) : [])

/** One chain of a several-chain Safe, as the safe driver reports it in `facts.chains`: its network's name, its
 *  threshold, its owners (by address, sorted, joined) and how many there are. */
export interface ChainRead { chain: string; network: string | null; ok: boolean; threshold: number | null; owners: string; count: number }
function chainsOf(facts: Record<string, unknown>): ChainRead[] | null {
  if (!Array.isArray(facts.chains)) return null
  return list(facts.chains).flatMap(c => {
    const chain = str(c.chain)
    if (chain === null) return []
    // owners are CAIP-10, each chain's own prefix: compared by address, in any case
    const all = Array.isArray(c.owners) ? c.owners.map(o => String(o).split(':').pop()!.toLowerCase()) : []
    return [{ chain, network: str(c.network), ok: c.ok === true, threshold: num(c.threshold), owners: [...all].sort().join(','), count: all.length }]
  })
}
/** The good chains that differ from the first good one, on threshold or owners. */
function disagreeing(chains: ChainRead[]): ChainRead[] {
  const good = chains.filter(c => c.ok)
  const base = good[0]
  return base ? good.filter(c => c.threshold !== base.threshold || c.owners !== base.owners) : []
}

const ADDRESSED = new Set(['safe', 'gardens-community', 'gardens-pool'])
const OPEN_LABEL: Record<string, string> = {
  safe: 'Open in Safe', 'hats-tree': 'Open in Hats', 'snapshot-space': 'Open in Snapshot', 'gardens-community': 'Open in Gardens', 'gardens-pool': 'Open in Gardens',
}
const hostOf = (url: string | null): string | null => {
  if (url === null) return null
  try { return new URL(url).host || null } catch { return null }
}

/** A System's kind (E-37): its entry's `kind` as the adapter passed it on, else the Resource's status, else
 *  `system`. Its row, its header, its state and the map all read the kind through this one helper. */
export function systemKind(r: Resource): string {
  return str(r.facts.kind) ?? str(r.status) ?? 'system'
}

/** A System's facts for its row and record header (B2): its kind, its chains and how many agree, its address in the
 *  form its kind is known by, the governing fact, the driver's read and the link-out. */
export function systemFacts(r: Resource): SystemFacts {
  const f = r.facts
  const read = driverOf(r)
  const df = read?.facts ?? {}
  const kind = systemKind(r)
  const perChain = kind === 'safe' ? chainsOf(df) : null
  const one = str(f.chain) ?? str(df.chain)
  const chains = perChain ? perChain.map(c => c.chain) : one ? [one] : []
  const agree = perChain ? chains.length - disagreeing(perChain).length : chains.length

  const address = (() => {
    const bare = str(f.address)
    if (kind === 'hats-tree') {
      const tree = num(df.tree) ?? bare
      const id = one?.split(':')[1]
      return tree !== null && id ? { mono: `${id} / ${tree}` } : null
    }
    if (kind === 'snapshot-space') {
      const host = hostOf(str(f.url) ?? str(read?.open?.url))
      return host ? { host } : null
    }
    const chip = (ADDRESSED.has(kind) ? str(df.address) : null) ?? bare
    if (chip) return { chip }
    const host = hostOf(str(f.url))
    return host ? { host } : null
  })()

  const governs = (() => {
    if (kind === 'safe' && num(df.threshold) !== null && num(df.owners) !== null) return `${df.threshold} of ${df.owners} signers`
    if (kind === 'hats-tree' && Array.isArray(df.hats)) return `${df.hats.length} ${df.hats.length === 1 ? 'hat' : 'hats'}`
    if (kind === 'gardens-community' && num(df.members) !== null) return `${df.members} ${df.members === 1 ? 'member' : 'members'}`
    return null
  })()

  const href = safeHref(read?.open?.url)
  return { kind, chains, agree, address, governs, read, open: href ? { label: OPEN_LABEL[kind] ?? 'Open', href } : null }
}

/** A good read's driver facts, for a System of `kind`: null when it is another kind, was never read, or failed. */
function goodFacts(r: Resource, kind: string): Record<string, unknown> | null {
  if (systemKind(r) !== kind) return null
  const read = driverOf(r)
  return read !== null && read.ok ? read.facts : null
}

/** The chains of a Safe that disagree (L2-C8): the read says `agree: false`, and these good chains differ from the
 *  first good one on threshold or owners. Empty when they agree, a chain merely failed, or it is no Safe. Systems'
 *  "Chains disagree" and Needs you's chain disagreement are this one condition. */
export function chainsDisagreeing(r: Resource): ChainRead[] {
  const df = goodFacts(r, 'safe')
  const perChain = df ? chainsOf(df) : null
  return df?.agree === false && perChain ? disagreeing(perChain) : []
}

/** The first good chain of a Safe's read: what a disagreement is measured against. */
export function firstGoodChain(r: Resource): ChainRead | undefined {
  const df = goodFacts(r, 'safe')
  return (df ? chainsOf(df) ?? [] : []).find(c => c.ok)
}

/** How many transactions are known to wait on a Safe's signers (the read's `pending`); 0 for any other System. A read
 *  that does not say (a Safe read from the chain) is not "nothing waits": `signaturesNotRead` names where it is not known. */
export function pendingSignatures(r: Resource): number {
  const df = goodFacts(r, 'safe')
  return Math.max(0, (df ? num(df.pending) : null) ?? 0)
}

/** The chains of a good Safe read where what waits on the signers is not known: the read gives no `pending` for them
 *  (they were read from the chain while the Safe Transaction Service did not answer, L7-D15). [] when every chain read
 *  says, or it is no Safe. A failed chain is not here: it is not read at all. */
export function signaturesNotRead(r: Resource): string[] {
  const df = goodFacts(r, 'safe')
  if (!df) return []
  if (Array.isArray(df.chains)) return list(df.chains).filter(c => c.ok === true && num(c.pending) === null).map(c => str(c.chain)).filter((c): c is string => c !== null)
  if (num(df.pending) !== null) return []
  const chain = str(df.chain) ?? str(r.facts.chain)
  return chain ? [chain] : []
}

/** What a Safe read from the chain says of itself (its note), for the words beside "not fully read". */
export function readNote(r: Resource): string | null {
  const df = goodFacts(r, 'safe')
  if (!df) return null
  return str(df.note) ?? list(df.chains).map(c => str(c.note)).find((n): n is string => n !== null) ?? null
}

/** A Hats tree's active hats that no one wears (`supply` 0), as the driver read them; none for any other System. */
export function emptyHats(r: Resource): Record<string, unknown>[] {
  const df = goodFacts(r, 'hats-tree')
  return df ? list(df.hats).filter(h => h.active === true && h.supply === 0) : []
}

/** A System's one state, as a mark and its words (§9.2), from its driver's facts. The first that holds wins: a link
 *  is never read; a failed read; a read in flight; a Safe whose good chains disagree; signatures waiting; active hats
 *  with no wearer; a change proposed against it (`proposed`, its words); an old read; else up to date. A System
 *  nothing has read yet is open, "Not read yet". */
export function systemState(r: Resource, opts: { proposed?: string } = {}): { mark: Mark; words: string } {
  if (systemKind(r) === 'link') return { mark: 'closed', words: 'Linked, not read' }
  const read = driverOf(r)
  if (read === null) return { mark: 'open', words: 'Not read yet' }
  if (!read.ok) return { mark: 'failed', words: 'Couldn’t read' }
  if (read.state === 'reading') return { mark: 'running', words: 'Reading…' }
  if (chainsDisagreeing(r).length > 0) return { mark: 'needs', words: 'Chains disagree' }
  const pending = pendingSignatures(r)
  if (pending > 0) return { mark: 'needs', words: `${pending} to sign` }
  // A Safe read from the chain does not say what waits: not "Up to date" (L7 fix r1 M1).
  if (signaturesNotRead(r).length > 0) return { mark: 'failed', words: 'Not fully read' }
  const empty = emptyHats(r).length
  if (empty > 0) return { mark: 'needs', words: `${empty} empty ${empty === 1 ? 'hat' : 'hats'}` }
  if (opts.proposed !== undefined) return { mark: 'staged', words: opts.proposed }
  if (read.state === 'aged') return { mark: 'aged', words: 'Old read' }
  return { mark: 'ok', words: 'Up to date' }
}
