import type { ProposalView, Resource } from '../../api.ts'
import type { PreparedStep } from '../../../../server/systems/driver.ts'
import { driverOf, safeHref } from '../../systems/DriverView.tsx'
import { list, num, record, str } from '../rows/systemState.ts'
import { caip10, nativeUnit, unitsToDecimal } from '../atoms/chain.ts'
import { NONCE_MOVED } from '../../../../lib/safe-tx.mjs'

/** Where a prepared transaction stands (§9.6's table). `replaced`: another transaction took its nonce (the reading's
 *  NONCE_MOVED mismatch); `stale`: it was prepared for an earlier revision (L7 §11.3). The table's last row, a failed
 *  read of the Safe, is not a state of its own: the card keeps its last state, and `readFailed` lays the failed read
 *  over it (fix I-1). */
export type PreparedState = 'preparing' | 'unsigned' | 'partly-signed' | 'ready' | 'executed' | 'mismatch' | 'replaced' | 'stale'

/** An amount in base units, as the chain holds it (CC-8); the card writes it with unitsToDecimal and formatAmount. */
export interface PreparedAmount { raw: string; unit: string; decimals: number }
/** One call of the transaction: its title in plain words, from and to as CAIP-10 accounts, what it moves. */
export interface PreparedCall { title: string; from: string; to: string; amount?: PreparedAmount }

/** One prepared Safe transaction, on one chain (L2-C3, CC-9): the card's view-model. `signed` of `of` is the
 *  signature count (`yours`, the viewer's own); `total` is the sum's plain words ("Back to the treasury"), the
 *  card adding the calls' amounts itself; the payload keeps the call data, or only its hash as the ledger does.
 *  `outcome` is the read back: when, and the block and transaction hash when known; `failed` is an execution that
 *  failed on chain; `differs`, what a mismatch found. `rev` says which revision is current and which was prepared
 *  (stale). `readFailed` is a read of the Safe that failed, over whatever state the card keeps; `failedAge` is then
 *  the time of the last good reading, when there was one. */
export interface PreparedView {
  state: PreparedState
  safe: { name: string; address: string; chain: string }
  nonce: number; signed: number; of: number; yours?: number
  calls: PreparedCall[]
  total: string
  payload: { to: string; toName?: string; value: string; operation: 0 | 1; data?: string; dataHash?: string; safeTxHash: string }
  openHref: string
  /** `known: false`: executed, and whether it succeeded is not known yet (L7 §11.1). */
  outcome?: { block?: string; txHash?: string; readAt: string; differs?: string[]; failed?: boolean; known?: false }
  rev?: { current: number; prepared: number }
  readFailed?: boolean
  failedAge?: string
}

/** A server's detail as the card says it: a sentence, its first letter capital, ending with a full stop. */
export function sentence(text: string): string {
  const t = text.trim()
  if (t === '') return t
  const s = t[0]!.toUpperCase() + t.slice(1)
  return /[.!?]$/.test(s) ? s : `${s}.`
}

/** The total's words when nothing more is known than that the calls add up. */
const TOTAL = 'Total'

/** A Safe's read on one chain, from its Resource: its threshold, its account there, and the Safe app's page of it.
 *  A Safe on several chains reads each in `facts.driver.facts.chains[]`; a one-chain Safe in its own facts. */
function safeOn(safe: { facts?: Record<string, unknown> } | undefined, chain: string): { threshold: number; address: string; home: string | null } {
  const facts = record(safe?.facts)
  const read = safe && 'facts' in safe ? driverOf(safe as Resource) : null
  const own = record(read?.facts)
  const there = list(own.chains).find(c => c.chain === chain)
  const account = str(there?.account)
  const address = account?.split(':').at(-1) ?? str(own.address) ?? str(facts.address) ?? ''
  const threshold = num(there?.threshold) ?? num(own.threshold) ?? 0
  const row = read?.sections.find(s => s.title === 'Chains')?.rows.find(r => account !== null && (r.refs ?? []).includes(account))
  return { threshold, address, home: safeHref(row?.href) ?? safeHref(read?.open?.url) }
}

/** The Safe app's page of one transaction, from the app's page of the Safe (`…/home?safe=celo:0x…`). */
function txHref(home: string | null, safeTxHash: string): string {
  const m = home === null ? null : /^https:\/\/app\.safe\.global\/home\?safe=([a-z0-9-]+):(0x[0-9a-fA-F]{40})$/.exec(home)
  return m ? `https://app.safe.global/transactions/tx?safe=${m[1]}:${m[2]}&id=multisig_${m[2]}_${safeTxHash}` : home ?? ''
}

/** What a call's value moves, in the chain's native unit; nothing when it moves none. */
function nativeAmount(value: string, chain: string): PreparedAmount | undefined {
  return /^\d+$/.test(value) && BigInt(value) > 0n ? { raw: value, unit: nativeUnit(chain), decimals: 18 } : undefined
}

/** The state a count of signatures puts a transaction in. */
function bySignatures(signed: number, of: number): PreparedState {
  if (signed <= 0) return 'unsigned'
  return of > 0 && signed >= of ? 'ready' : 'partly-signed'
}

/** The cards L2's prepare reply makes (CC-9): one per step a Safe signs, each a Safe transaction on its chain,
 *  unsigned, its call from `step.call` (summary, to, value). The threshold comes from the Safe's Resource when given
 *  (`safe` may be the Resource itself), else it is not known (0). */
export function preparedFromSteps(steps: PreparedStep[], safe: { name: string; facts?: Record<string, unknown> }): PreparedView[] {
  return steps.flatMap(step => {
    if (step.safe === null) return []
    const { call, safe: tx } = step
    const on = safeOn(safe, call.chain)
    const from = step.signer.kind === 'wearer' ? '' : step.signer.account
    const amount = nativeAmount(call.value, call.chain)
    const view: PreparedView = {
      state: 'unsigned', safe: { name: safe.name, address: from.split(':').at(-1) || on.address, chain: call.chain }, nonce: tx.payload.nonce,
      signed: 0, of: on.threshold,
      calls: [{ title: call.summary, from, to: call.to, ...(amount ? { amount } : {}) }],
      total: TOTAL,
      payload: { to: tx.payload.to, value: tx.payload.value, operation: tx.payload.operation, data: tx.payload.data, safeTxHash: tx.ref.id },
      openHref: safeHref(tx.link) ?? '',
    }
    return [view]
  })
}

type LedgerEvent = Record<string, unknown>
interface Step { chain: string; id: string; payload: { to: string; value: string; data_hash: string; operation: number; nonce: number } }

/** The current attach of a proposal (the latest at its rev), and its Safe reference. */
function currentAttach(view: ProposalView): { attach: LedgerEvent | undefined; ref: Record<string, unknown> } {
  const attach = (view.events as unknown as LedgerEvent[]).filter(e => e.rev === view.rev && e.kind === 'attach').at(-1)
  return { attach, ref: record(attach?.ref) }
}
/** An `also` entry the cards can read: a chain, an id, and a payload with a nonce. */
const readable = (s: Record<string, unknown>) => str(s.chain) !== null && str(s.id) !== null && num(record(s.payload).nonce) !== null

/** How many of the current attach's other chains (`also`) the ledger holds in a shape no card can be read from, so
 *  `preparedFromProposal` leaves them out (E-53): the page says so under the cards, for a signer must not miss a
 *  chain. 0 when nothing is attached, or every chain is read. */
export function alsoSkipped(view: ProposalView): number {
  const { attach, ref } = currentAttach(view)
  if (attach === undefined || preparedFromProposal(view).length === 0) return 0
  return list(ref.also).filter(s => !readable(s)).length // `list` reads a non-object entry as {}: unreadable
}

/** The ledger's cards for a proposal (CC-9): the current attach (the latest at the proposal's rev) and its `also`,
 *  one per chain, each in the state the latest `system` reading of that attach puts it in — its own chain's entry of
 *  the reading's `chains` when there is one, else the aggregate (L7 §11.2). A failed read (the view's attention) keeps
 *  that state, its outcome and its count, and marks the read failed, with the last reading's time. With no attach at
 *  the current rev, the latest one of an earlier rev is drawn `stale` (L7 §11.3). [] when nothing is attached, or the
 *  ref is not a Safe's. */
export function preparedFromProposal(view: ProposalView, safe?: Resource): PreparedView[] {
  const all = view.events as unknown as LedgerEvent[]
  const attach = all.filter(e => e.kind === 'attach' && e.rev === view.rev).at(-1) ?? all.filter(e => e.kind === 'attach').at(-1)
  const ref = record(attach?.ref)
  const first = record(ref.payload)
  if (attach === undefined || 'kind' in first || typeof ref.id !== 'string' || num(first.nonce) === null) return []
  const stale = attach.rev !== view.rev
  const facts = record(safe?.facts)
  const chain0 = str(ref.chain) ?? str(facts.chain) ?? ''
  // An `also` entry without a chain, an id or a payload with a nonce is skipped (final M-2): ProposalRow maps every
  // row through here, so one bad ledger entry must not take down the proposals list. `alsoSkipped` counts them.
  const also = list(ref.also).filter(readable)
  const steps = [{ chain: chain0, id: ref.id, payload: first }, ...also].map(s => s as unknown as Step)
  const reading = all.filter(e => e.kind === 'system' && e.rev === attach.rev && record(e.ref).id === ref.id).at(-1)
  const rev = stale ? revisions(all, attach, view.rev) : undefined

  return steps.map(step => {
    const on = safeOn(safe, step.chain)
    // This card's own chain's reading when the reading has one, else the aggregate (0.6 and L2 readings).
    const own = list(reading?.chains).find(c => c.chain === step.chain && String(c.id).toLowerCase() === step.id.toLowerCase())
    const r: Record<string, unknown> | undefined = own ?? reading
    const text = own ? own.detail : reading?.text
    const counted = num(r?.confirmations)
    const of = num(r?.required) ?? on.threshold
    const signed = counted ?? 0
    const readAt = String(reading?.at ?? '')
    const onChain = { ...(num(own?.block) !== null ? { block: String(own!.block) } : {}), ...(str(own?.txHash) ? { txHash: String(own!.txHash) } : {}) }
    let state: PreparedState = bySignatures(signed, of)
    let outcome: PreparedView['outcome']
    if (r?.outcome === 'executed') { state = 'executed'; outcome = { readAt, ...onChain } }
    else if (r?.outcome === 'failed') { state = 'executed'; outcome = { readAt, ...onChain, failed: true } }
    // Executed, success not known yet: executed, never ready (L7 §11.1).
    else if (r?.outcome === 'pending' && r.executed === true) { state = 'executed'; outcome = { readAt, ...onChain, known: false } }
    else if (r?.outcome === 'mismatch') {
      state = String(text ?? '').includes(NONCE_MOVED) ? 'replaced' : 'mismatch'
      outcome = { readAt, differs: [sentence(String(text ?? ''))] }
    }
    // Prepared for an earlier revision: stale, unless it was executed on chain meanwhile (that stays what it is).
    if (stale && state !== 'executed') state = 'stale'
    const from = on.address ? caip10(step.chain, on.address) : ''
    const amount = nativeAmount(String(step.payload.value), step.chain)
    const tx: PreparedView = {
      state, safe: { name: safe?.name ?? String(ref.system ?? ''), address: on.address, chain: step.chain }, nonce: step.payload.nonce, signed, of,
      calls: [{ title: String(view.title), from, to: caip10(step.chain, String(step.payload.to)), ...(amount ? { amount } : {}) }],
      total: TOTAL,
      payload: { to: String(step.payload.to), value: String(step.payload.value), operation: step.payload.operation === 1 ? 1 : 0, dataHash: String(step.payload.data_hash), safeTxHash: step.id },
      openHref: txHref(on.home, step.id),
      ...(outcome ? { outcome } : {}),
      ...(rev ? { rev } : {}),
      ...(view.attention ? { readFailed: true, ...(reading?.at ? { failedAge: String(reading.at) } : {}) } : {}),
    }
    return tx
  })
}

/** The revisions a stale card names: the current one and the one its attach was prepared for, counted from the
 *  opening (1) by the ledger's `revise` events. Undefined when the ledger holds no revise to count by. */
function revisions(events: LedgerEvent[], attach: LedgerEvent, current: unknown): PreparedView['rev'] {
  const revises = events.filter(e => e.kind === 'revise')
  if (revises.length === 0) return undefined
  const prepared = events.slice(0, events.indexOf(attach)).filter(e => e.kind === 'revise').length + 1
  const now = revises.length + 1
  return now > prepared && revises.at(-1)!.rev === current ? { current: now, prepared } : undefined
}

/** The calls' amounts added up per unit (and decimals), exactly, in the order the units first appear: the total
 *  strip's sums, as decimal strings. Calls that move nothing are left out. */
export function totalsOf(calls: PreparedCall[]): { value: string; unit: string; decimals: number }[] {
  const sums = new Map<string, { raw: bigint; unit: string; decimals: number }>()
  for (const c of calls) {
    if (!c.amount || !/^-?\d+$/.test(c.amount.raw)) continue
    const key = `${c.amount.unit}\u0000${c.amount.decimals}`
    const was = sums.get(key)
    sums.set(key, { raw: (was?.raw ?? 0n) + BigInt(c.amount.raw), unit: c.amount.unit, decimals: c.amount.decimals })
  }
  return [...sums.values()].map(s => ({ value: unitsToDecimal(s.raw.toString(), s.decimals), unit: s.unit, decimals: s.decimals }))
}

/** The payload as Copy payload gives it: what a signer checks in the Safe app, as JSON. */
export function payloadJson(tx: PreparedView): string {
  const p = tx.payload
  return JSON.stringify({ to: p.to, value: p.value, ...(p.data !== undefined ? { data: p.data } : { dataHash: p.dataHash }), operation: p.operation, nonce: tx.nonce, safeTxHash: p.safeTxHash }, null, 2)
}
