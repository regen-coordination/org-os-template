import type { ProposalView, Resource } from '../../api.ts'
import { recordHref } from '../../hrefs.ts'
import { driverOf, safeHref } from '../../systems/DriverView.tsx'
import { ageText } from '../../time.ts'
import { chainsDisagreeing, emptyHats, firstGoodChain, list, num, pendingSignatures, readNote, record, signaturesNotRead, str, systemFacts, type ChainRead } from '../rows/systemState.ts'

/** What a need is about (§9.4): each draws its own glyph on the tile. */
export type NeedKind = 'proposal' | 'signature' | 'empty-hat' | 'failed-read' | 'chains-disagree' | 'overdue'

/** One Needs you item (§9.4): what waits, where it opens, the meta line's parts (id, route or chains, meter,
 *  context), its deadline, and the map nodes it concerns (G-7 ids: `system:<id>`, a hat's ref), so attention on the
 *  map matches Needs you one to one (§8.5). `facts` are its source Resource's, for the viewer's filter (§6.3). */
export interface NeedItem {
  id: string; kind: NeedKind; title: string; href: string; external?: boolean; ref?: string; route?: string; chains?: string[]
  /** How many of `chains` agree, when they do not all (a chain disagreement's clay chip). */
  agree?: number
  meter?: { done: number; of: number; yours?: number; words: string }; context?: string; deadline?: string | null; youActed?: boolean; nodes: string[]
  facts?: Record<string, unknown>
}

const unique = (xs: string[]) => [...new Set(xs)]

/** A System's name as a sentence says it: "the Treasury" ("The …" to start one). */
function the(name: string, start = false): string {
  if (/^the /i.test(name)) return start ? name[0]!.toUpperCase() + name.slice(1) : name
  return `${start ? 'The' : 'the'} ${name}`
}

/** The rule result that counts approvals (pending, with a `for` tally against a number needed), if any. */
function approvals(v: ProposalView): { for: string[]; needed: number } | null {
  for (const part of v.evaluation.parts) {
    const ev = part.evaluation
    if (ev.state !== 'pending' || !Array.isArray(ev.tally.for) || num(ev.tally.needed) === null) continue
    return { for: ev.tally.for.map(String), needed: ev.tally.needed! }
  }
  return null
}

/** What an overdue proposal's meta line says: its window closed and it waits on a person. */
const OVERDUE_CONTEXT = 'The window closed; a person decides what happens'

/** An open proposal as a need: waiting on the actor's approval (`needsYou`), else one they approved that waits on
 *  others; past its closing, a waiting one is overdue. Null when it waits on neither. */
function proposalNeed(v: ProposalView, actor: string | null, facts: Record<string, unknown>, now: Date): NeedItem | null {
  if (v.state !== 'open') return null
  const tally = approvals(v)
  // you acted: you approved and nothing more is wanted of you (a rule that still wants you keeps it waiting on you)
  const acted = !v.needsYou && actor !== null && tally !== null && tally.for.includes(actor)
  if (!v.needsYou && !acted) return null
  const deadline = v.evaluation.closesAt
  const overdue = v.needsYou && deadline !== null && new Date(deadline).getTime() < now.getTime()
  const meter = tally === null ? undefined : {
    done: tally.for.length, of: tally.needed, ...(acted ? { yours: 1 } : {}),
    words: `${tally.for.length} of ${tally.needed}${acted ? ' · you approved' : ' approved'}`,
  }
  const id = String(v.id)
  return {
    id: `proposal:${id}`, kind: overdue ? 'overdue' : 'proposal', title: String(v.title), href: recordHref(`proposal:${id}`), ref: id,
    ...(v.rules[0]?.sentence ? { route: v.rules[0].sentence } : {}),
    ...(meter ? { meter } : {}),
    ...(overdue ? { context: OVERDUE_CONTEXT } : {}),
    deadline, ...(v.needsYou ? {} : { youActed: true }),
    // while it waits on you, the proposal's own node, where a map draws it, then the Systems its ops touch: a map lights
    // what Needs you counts (walk 2026-11-04); one you approved lights only what it would change, as before
    nodes: unique([...(v.needsYou ? [`proposal:${id}`] : []), ...(v.ops as unknown[]).flatMap(op => { const m = /^systems:(.+)$/.exec(String((op as { record?: unknown }).record)); return m ? [`system:${m[1]}`] : [] })]),
    facts,
  }
}

/** The signatures an attached proposal's latest reading counts, for the one transaction waiting on a Safe: from the
 *  latest `system` event, at the current rev, of a proposal whose latest attach names this System, when the reading
 *  is of that attached transaction, the attach is of the nonce that waits (when both are known), and it carries
 *  `confirmations` and `required`. */
function signedMeter(system: string, nonce: number | null, proposals: ProposalView[]): NeedItem['meter'] | undefined {
  for (const v of proposals) {
    if (v.state !== 'open') continue
    const current = (v.events as unknown as Record<string, unknown>[]).filter(e => e.rev === v.rev)
    const attached = record(current.filter(e => e.kind === 'attach').at(-1)?.ref)
    if (attached.system !== system) continue
    const attachedNonce = num(record(attached.payload).nonce)
    if (nonce !== null && attachedNonce !== null && attachedNonce !== nonce) continue
    const reading = current.filter(e => e.kind === 'system').at(-1)
    if (reading === undefined || record(reading.ref).id !== attached.id) continue
    const done = num(reading.confirmations)
    const of = num(reading.required)
    if (done !== null && of !== null) return { done, of, words: `${done} of ${of} signed` }
  }
  return undefined
}

/** Which chain disagrees, and how: "Gnosis lists 9 owners", "Base needs 3 signatures". */
function disagreement(chains: ChainRead[], base: ChainRead | undefined): string | undefined {
  const c = chains[0]
  if (!c || !base) return undefined
  const where = c.network ?? c.chain
  if (c.count !== base.count) return `${where} lists ${c.count} owners`
  if (c.threshold !== base.threshold && c.threshold !== null) return `${where} needs ${c.threshold} signatures`
  return `${where} lists other owners`
}

/** A System's needs: a failed read (and nothing else from a read that failed), signatures waiting, chains that
 *  disagree, hats with no wearer. Each opens the System's page, but a signature opens the Safe app. */
function systemNeeds(r: Resource, proposals: ProposalView[], now: Date): NeedItem[] {
  const read = driverOf(r)
  const f = systemFacts(r)
  if (f.kind === 'link' || read === null) return []
  const page = recordHref(r.id)
  const base = { href: page, nodes: [r.id], facts: r.facts }
  if (!read.ok) {
    return [{
      ...base, id: `failed-read:${r.id}`, kind: 'failed-read', title: `${the(r.name, true)} couldn’t be read`, chains: f.chains,
      context: read.readAt ? `last good read ${ageText(read.readAt, now)}` : 'not read yet',
    }]
  }
  const out: NeedItem[] = []
  const pending = pendingSignatures(r)
  if (pending > 0) {
    const section = read.sections.find(s => s.title === 'Waiting on signers')
    const nonce = pending === 1 ? section?.rows[0]?.cells.map(c => /^#(\d+)$/.exec(String(c))?.[1]).find(Boolean) : undefined
    const waitingOn = list(read.facts.chains).filter(c => (num(c.pending) ?? 0) > 0).map(c => str(c.chain)).filter((c): c is string => c !== null)
    const href = safeHref(read.open?.url)
    // a meter is one transaction's: drawn only while one waits
    const meter = pending === 1 ? signedMeter(String(r.source?.entityId ?? r.id.replace(/^system:/, '')), nonce ? Number(nonce) : null, proposals) : undefined
    out.push({
      ...base, id: `signature:${r.id}`, kind: 'signature',
      title: nonce ? `Sign nonce ${nonce} on ${the(r.name)}` : `Sign ${pending} ${pending === 1 ? 'transaction' : 'transactions'} on ${the(r.name)}`,
      ...(href ? { href, external: true } : {}), chains: waitingOn.length > 0 ? waitingOn : f.chains,
      ...(meter ? { meter } : {}), ...(section?.note ? { context: section.note } : {}),
    })
  }
  // Read from the chain while the service did not answer: what waits on the signers is not known there, so the Safe is
  // flagged as not fully read, as its failed read was before (L7 fix r1 M1), never taken for nothing to sign.
  const unread = signaturesNotRead(r)
  if (unread.length > 0) {
    out.push({ ...base, id: `partial-read:${r.id}`, kind: 'failed-read', title: `${the(r.name, true)} couldn’t be read in full`, chains: unread,
      context: `${readNote(r) ?? 'Read from the chain'}; signatures waiting are not known` })
  }
  const split = chainsDisagreeing(r)
  if (split.length > 0) {
    const context = disagreement(split, firstGoodChain(r))
    out.push({ ...base, id: `chains-disagree:${r.id}`, kind: 'chains-disagree', title: `${the(r.name, true)} disagrees across chains`,
      chains: f.chains, agree: f.agree, ...(context ? { context } : {}) })
  }
  const empty = emptyHats(r)
  if (empty.length > 0) {
    const names = empty.map(h => str(h.details) ?? str(h.pretty) ?? String(h.id)).join(', ')
    out.push({ ...base, id: `empty-hat:${r.id}`, kind: 'empty-hat',
      title: `${empty.length} ${empty.length === 1 ? 'hat has' : 'hats have'} no wearer`, chains: f.chains, context: names,
      nodes: empty.map(h => String(h.id)) })
  }
  return out
}

/** A registry the Hub could not read (the records adapter's warning card, `absent:records:<registry>`: a file that
 *  cannot be parsed, or one git tracks that the working tree lost) as a failed read, opening the registry's page:
 *  Needs you says it, not only its collection's block (operator, C12). A quiet card (a source simply not here) is no
 *  need. */
function registryNeed(r: Resource): NeedItem[] {
  const registry = /^absent:records:(.+)$/.exec(r.id)?.[1]
  if (r.kind !== 'absent' || registry === undefined || !r.attention) return []
  return [{
    id: `failed-read:${r.id}`, kind: 'failed-read', title: `${r.name} couldn’t be read`, href: `/all/${encodeURIComponent(registry)}`,
    context: r.attention.text.replace(/^cannot be read: /, ''), nodes: [], facts: r.facts,
  }]
}

/** Needs you's items (§9.4) from what the Hub reads: the Systems' Resources (each with its driver's read), the
 *  registries that could not be read, and the open proposals (`needsYou`, `evaluation`), for `actor` (null: no member,
 *  so nothing they approved). Proposals first, then each System's, then each unread registry, in the order given;
 *  `orderNeeds` orders them. A signature need is listed for every member until L5 knows who signs (brief B3). */
export function needsFrom(resources: Resource[], proposals: ProposalView[], actor: string | null, now: Date): NeedItem[] {
  const byId = new Map(resources.map(r => [r.id, r]))
  const fromProposals = proposals.flatMap(v => {
    const item = proposalNeed(v, actor, byId.get(`proposal:${v.id}`)?.facts ?? {}, now)
    return item ? [item] : []
  })
  const fromSystems = resources.filter(r => r.kind === 'system').flatMap(r => systemNeeds(r, proposals, now))
  const fromRegistries = resources.flatMap(registryNeed)
  return [...fromProposals, ...fromSystems, ...fromRegistries]
}

/** Which of the four bands an item falls in (§9.4): overdue, waiting on you, failed reads, waiting on others. A
 *  waiting item whose deadline has passed is overdue, however long ago it was made. */
function band(item: NeedItem, now: Date): number {
  if (item.youActed) return 3
  const passed = item.deadline != null && new Date(item.deadline).getTime() < now.getTime()
  if (item.kind === 'overdue' || passed) return 0
  return item.kind === 'failed-read' ? 2 : 1
}

/** Needs you's order (§9.4): overdue (oldest deadline first), then waiting on you by deadline, then failed reads,
 *  then waiting on others; within a band dated before undated, ties by title. A new array. */
export function orderNeeds(items: NeedItem[], now: Date): NeedItem[] {
  const when = (i: NeedItem) => (i.deadline ? new Date(i.deadline).getTime() : Number.POSITIVE_INFINITY)
  return [...items].sort((a, b) => band(a, now) - band(b, now) || when(a) - when(b) || a.title.localeCompare(b.title, 'en'))
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** "5 days", "1 day", "6 hours", "1 minute": a span in its largest whole unit, rounded. */
function span(ms: number): string {
  const [n, unit] = ms >= DAY ? [Math.round(ms / DAY), 'day'] : ms >= HOUR ? [Math.round(ms / HOUR), 'hour'] : [Math.max(1, Math.round(ms / 60_000)), 'minute']
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

/** A deadline as a row's trailing words: "Closes in 5 days", or "Closed 2 days ago", late (clay). */
export function closingText(deadline: string, now: Date): { text: string; late: boolean } {
  const ms = new Date(deadline).getTime() - now.getTime()
  return ms >= 0 ? { text: `Closes in ${span(ms)}`, late: false } : { text: `Closed ${span(-ms)} ago`, late: true }
}

/** An item's trailing words (§9.4): "Waiting on others" once you acted; else its deadline ("Closes in 5 days", or
 *  "Closed 2 days ago", late, in clay); else the link-out ("Open in Safe ↗"); else "Look →". `when`: these words are
 *  a span of time from now, so the route shots mask them (`data-volatile`) — a deadline's count moves every day. */
export function trailingText(item: NeedItem, now: Date): { text: string; late: boolean; when: boolean } {
  if (item.youActed) return { text: 'Waiting on others', late: false, when: false }
  if (item.deadline) return { ...closingText(item.deadline, now), when: true }
  if (item.external) return { text: 'Open in Safe ↗', late: false, when: false }
  return { text: 'Look →', late: false, when: false }
}
