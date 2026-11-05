import { describe, it, expect } from 'vitest'
import type { ProposalView, Resource } from '../../api.ts'
import { FIXED_NOW } from '../../test/fixtures/parts.ts'
import { COUNCIL_SAFE, GARDEN, ROLES, SYSTEMS, TREASURY_SYSTEM, VOTES, hatRefOf } from '../../test/fixtures/house/systems.ts'
import {
  ACTOR, ADD_SIGNER, CLOSE_CALL, NEEDS_SYSTEMS, PAY_KIT, PROPOSALS, PROPOSAL_RESOURCES, RETURN_POOLS, TREASURY_SPLIT,
} from '../../test/fixtures/house/governance.ts'
import { needsFrom, orderNeeds, trailingText, type NeedItem } from './needs.ts'

const NOW = new Date('2026-10-29T12:00:00Z')
const DAY = 86_400_000
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString()
const need = (over: Partial<NeedItem> & { title: string }): NeedItem => ({ id: over.title, kind: 'proposal', href: '/', nodes: [], ...over })
const titles = (items: NeedItem[]) => items.map(i => i.title)
const one = (items: NeedItem[], kind: NeedItem['kind'], id?: string) => {
  const found = items.filter(i => i.kind === kind && (id === undefined || i.id.endsWith(id)))
  expect(found, `${kind} ${id ?? ''}`).toHaveLength(1)
  return found[0]!
}

describe('orderNeeds (§9.4)', () => {
  it('overdue (oldest deadline first), then waiting on you by deadline, then failed reads, then waiting on others', () => {
    const items = [
      need({ title: 'others', youActed: true, deadline: at(1) }),
      need({ title: 'failed', kind: 'failed-read' }),
      need({ title: 'you, later', deadline: at(9) }),
      need({ title: 'overdue, newer', kind: 'overdue', deadline: at(-1) }),
      need({ title: 'you, sooner', kind: 'signature', deadline: at(2) }),
      need({ title: 'overdue, older', kind: 'overdue', deadline: at(-4) }),
    ]
    expect(titles(orderNeeds(items, NOW))).toEqual(['overdue, older', 'overdue, newer', 'you, sooner', 'you, later', 'failed', 'others'])
  })

  it('ties and missing deadlines: ties by title; no deadline after dated within a group', () => {
    const items = [
      need({ title: 'B undated', kind: 'empty-hat' }),
      need({ title: 'Zeta', deadline: at(3) }),
      need({ title: 'A undated', kind: 'chains-disagree' }),
      need({ title: 'Alpha', deadline: at(3) }),
      need({ title: 'Overdue B', kind: 'overdue', deadline: at(-2) }),
      need({ title: 'Overdue A', kind: 'overdue', deadline: at(-2) }),
      need({ title: 'Failed B', kind: 'failed-read' }),
      need({ title: 'Failed A', kind: 'failed-read' }),
      need({ title: 'Others undated', youActed: true }),
      need({ title: 'Others dated', youActed: true, deadline: at(20) }),
    ]
    expect(titles(orderNeeds(items, NOW))).toEqual([
      'Overdue A', 'Overdue B', 'Alpha', 'Zeta', 'A undated', 'B undated', 'Failed A', 'Failed B', 'Others dated', 'Others undated',
    ])
  })

  it('a waiting-on-you item whose deadline has passed since it was made is overdue; one you acted on stays with the others', () => {
    const items = [need({ title: 'later', deadline: at(1) }), need({ title: 'passed', deadline: at(-1) }), need({ title: 'acted', youActed: true, deadline: at(-3) })]
    expect(titles(orderNeeds(items, NOW))).toEqual(['passed', 'later', 'acted'])
  })

  it('leaves its input as it was', () => {
    const items = [need({ title: 'b', youActed: true }), need({ title: 'a' })]
    orderNeeds(items, NOW)
    expect(titles(items)).toEqual(['b', 'a'])
  })
})

describe('trailingText (§9.4), now 2026-10-29T12:00Z', () => {
  it('a deadline ahead: "Closes in 5 days"', () => {
    expect(trailingText(need({ title: 't', deadline: at(5) }), NOW)).toEqual({ text: 'Closes in 5 days', late: false, when: true })
  })
  it('a deadline past: "Closed 2 days ago", late', () => {
    expect(trailingText(need({ title: 't', kind: 'overdue', deadline: at(-2) }), NOW)).toEqual({ text: 'Closed 2 days ago', late: true, when: true })
  })
  it('one day, and under a day in hours', () => {
    expect(trailingText(need({ title: 't', deadline: at(1) }), NOW).text).toBe('Closes in 1 day')
    expect(trailingText(need({ title: 't', deadline: at(0.25) }), NOW).text).toBe('Closes in 6 hours')
    expect(trailingText(need({ title: 't', deadline: at(-1 / 24) }), NOW)).toEqual({ text: 'Closed 1 hour ago', late: true, when: true })
  })
  it('a link-out: "Open in Safe ↗"', () => {
    expect(trailingText(need({ title: 't', kind: 'signature', external: true, href: 'https://app.safe.global/' }), NOW)).toEqual({ text: 'Open in Safe ↗', late: false, when: false })
  })
  it('else "Look →"', () => {
    expect(trailingText(need({ title: 't', kind: 'failed-read' }), NOW)).toEqual({ text: 'Look →', late: false, when: false })
  })
  it('waiting on others: "Waiting on others", whatever its deadline', () => {
    expect(trailingText(need({ title: 't', youActed: true, deadline: at(-2) }), NOW)).toEqual({ text: 'Waiting on others', late: false, when: false })
  })
})

describe('needsFrom: the items, from the Systems’ Resources and the open proposals (brief B3)', () => {
  const all = () => needsFrom([...NEEDS_SYSTEMS, ...PROPOSAL_RESOURCES], PROPOSALS, ACTOR, FIXED_NOW)

  it('a proposal with needsYou → kind proposal, its route and meter words "2 of 4 approved"', () => {
    const item = one(all(), 'proposal', String(RETURN_POOLS.id))
    expect(item).toMatchObject({
      id: `proposal:${RETURN_POOLS.id}`, title: 'Return the Gardens pools to the treasury', href: `/r/proposal/${RETURN_POOLS.id}`, ref: RETURN_POOLS.id,
      route: 'four Council stewards approve', deadline: RETURN_POOLS.evaluation.closesAt,
      meter: { done: 2, of: 4, words: '2 of 4 approved' },
      // its own node first, so the map lights the proposal that waits on you as Needs you lists it (walk 2026-11-04, L4c-fix 4)
      nodes: [`proposal:${RETURN_POOLS.id}`, 'system:network-projects', 'system:local-starter'],
    })
    expect(item.youActed).toBeFalsy()
    expect(item.external).toBeFalsy()
    expect(item.meter!.yours).toBeUndefined()
    // it carries its Resource's facts, for the viewer's filter (CC-14)
    expect(item.facts).toEqual(PROPOSAL_RESOURCES.find(r => r.id === `proposal:${RETURN_POOLS.id}`)!.facts)
  })

  it('a Safe resource whose read has a waiting transaction → kind signature, an external link to the Safe app', () => {
    const item = one(needsFrom([TREASURY_SYSTEM], [], ACTOR, FIXED_NOW), 'signature')
    const read = TREASURY_SYSTEM.facts.driver as { open: { url: string } }
    expect(item).toMatchObject({
      id: 'signature:system:treasury', title: 'Sign nonce 18 on the Treasury', href: read.open.url, external: true,
      chains: ['eip155:42220'], context: '1 waiting across 7 chains', nodes: ['system:treasury'],
    })
    expect(item.href).toMatch(/^https:\/\/app\.safe\.global\//)
    // no proposal attaches its transaction: no meter
    expect(item.meter).toBeUndefined()
    expect(item.facts).toBe(TREASURY_SYSTEM.facts)
  })

  it('the signature’s meter comes from an attached proposal’s latest reading: "2 of 4 signed"', () => {
    const item = one(needsFrom([TREASURY_SYSTEM], [PAY_KIT], ACTOR, FIXED_NOW), 'signature')
    expect(item.meter).toEqual({ done: 2, of: 4, words: '2 of 4 signed' })
    // a reading without the counts gives no meter
    const bare = structuredClone(PAY_KIT) as ProposalView & { events: Record<string, unknown>[] }
    for (const e of bare.events) { delete e.confirmations; delete e.required }
    expect(one(needsFrom([TREASURY_SYSTEM], [bare], ACTOR, FIXED_NOW), 'signature').meter).toBeUndefined()
  })

  // B3 fix 1 (review M-2): the meter is one transaction's, so it is drawn only for the one that waits.
  it('no signature meter when several transactions wait, or when the reading is of another nonce than the one waiting', () => {
    const two = structuredClone(TREASURY_SYSTEM)
    ;(two.facts.driver as { facts: Record<string, unknown> }).facts.pending = 2
    const item = one(needsFrom([two], [PAY_KIT], ACTOR, FIXED_NOW), 'signature')
    expect(item.title).toBe('Sign 2 transactions on the Treasury')
    expect(item.meter).toBeUndefined()
    const other = structuredClone(PAY_KIT) as ProposalView & { events: { ref?: { payload?: { nonce: number } } }[] }
    for (const e of other.events) if (e.ref?.payload) e.ref.payload.nonce = 17
    expect(one(needsFrom([TREASURY_SYSTEM], [other], ACTOR, FIXED_NOW), 'signature').meter).toBeUndefined()
  })

  it('a signature need is listed for every member until L5 knows who signs', () => {
    expect(one(needsFrom([TREASURY_SYSTEM], [], 'steward-b', FIXED_NOW), 'signature').title).toBe('Sign nonce 18 on the Treasury')
  })

  it('a failed read → failed-read, linking to the System’s page, with its last good read', () => {
    const item = one(needsFrom([GARDEN], [], ACTOR, FIXED_NOW), 'failed-read')
    expect(item).toMatchObject({
      id: 'failed-read:system:garden', title: 'The Example DAO Garden couldn’t be read', href: '/r/system/garden', chains: ['eip155:42220'],
      context: 'last good read 2 h ago', nodes: ['system:garden'],
    })
    expect(item.external).toBeFalsy()
  })

  // C12 (operator): a registry the Hub cannot read is a failed item in Needs you, not only a warning on its block.
  it('a registry that cannot be read → failed-read, opening the registry, with why; a lost one too; a quiet absence is none', () => {
    const card = (key: string, name: string, attention: Resource['attention'], facts: Record<string, unknown> = {}): Resource =>
      ({ id: `absent:${key}`, kind: 'absent', board: 'organization', name, status: 'absent', attention, changed: null, facts, source: null })
    const broken = card('records:members', 'data/members.yaml', { level: 'warn', text: 'cannot be read: bad indentation of a mapping entry (3:5)' })
    const lost = card('records:knowledge-gaps', 'data/knowledge-gaps.yaml', { level: 'warn', text: 'is in git but missing from the working tree — restore it before saving anything' })
    const quiet = card('crew', 'Crew', null, { why: 'scripts/crew.mjs is missing' })
    const adapter = card('modules', 'Modules', { level: 'warn', text: 'Modules could not be read: EACCES' })
    const items = needsFrom([broken, lost, quiet, adapter], [], ACTOR, FIXED_NOW)
    expect(items).toEqual([
      { id: 'failed-read:absent:records:members', kind: 'failed-read', title: 'data/members.yaml couldn’t be read', href: '/all/members',
        context: 'bad indentation of a mapping entry (3:5)', nodes: [], facts: {} },
      { id: 'failed-read:absent:records:knowledge-gaps', kind: 'failed-read', title: 'data/knowledge-gaps.yaml couldn’t be read', href: '/all/knowledge-gaps',
        context: 'is in git but missing from the working tree — restore it before saving anything', nodes: [], facts: {} },
    ])
    // it orders with the Systems' failed reads: after what waits on you, before what waits on others
    const ordered = orderNeeds([...all(), items[0]!], FIXED_NOW)
    const at = ordered.findIndex(i => i.id === items[0]!.id)
    expect(ordered.slice(0, at).every(i => i.kind !== 'failed-read' || i.title.localeCompare(items[0]!.title, 'en') < 0)).toBe(true)
    expect(ordered.slice(at + 1).some(i => i.youActed)).toBe(true)
  })

  it('a proposal the actor approved that is still open → youActed, "you approved" in moss', () => {
    const item = one(all(), 'proposal', String(ADD_SIGNER.id))
    expect(item.youActed).toBe(true)
    expect(item.meter).toEqual({ done: 2, of: 4, yours: 1, words: '2 of 4 · you approved' })
    expect(item.nodes).toEqual(['system:treasury'])
  })

  // B3 fix 1 (review M-3): still waiting on you (another rule wants you) says no "you approved" and draws no moss.
  it('a proposal that needs you, though you are in its tally, reads as waiting on you', () => {
    const both = { ...RETURN_POOLS, evaluation: { ...RETURN_POOLS.evaluation, parts: RETURN_POOLS.evaluation.parts.map(p =>
      ({ ...p, evaluation: { ...p.evaluation, tally: { for: ['steward-a', ACTOR], needed: 4 } } })) } } as ProposalView
    const item = one(needsFrom([], [both], ACTOR, FIXED_NOW), 'proposal')
    expect(item.youActed).toBeFalsy()
    expect(item.meter).toEqual({ done: 2, of: 4, words: '2 of 4 approved' })
  })

  it('a waiting-on-you proposal past its closing → overdue', () => {
    const item = one(all(), 'overdue', String(CLOSE_CALL.id))
    expect(item).toMatchObject({ title: 'Close the spring call for local nodes', deadline: CLOSE_CALL.evaluation.closesAt, ref: CLOSE_CALL.id, nodes: [`proposal:${CLOSE_CALL.id}`, 'system:roles'] })
    expect(trailingText(item, FIXED_NOW)).toEqual({ text: 'Closed 2 days ago', late: true, when: true })
  })

  it('chains that disagree → chains-disagree (the B2 condition), saying which chain differs', () => {
    const item = one(needsFrom([TREASURY_SPLIT], [], ACTOR, FIXED_NOW), 'chains-disagree')
    expect(item).toMatchObject({
      id: 'chains-disagree:system:treasury', title: 'The Treasury disagrees across chains', href: '/r/system/treasury', agree: 6,
      context: 'Gnosis lists 9 owners', nodes: ['system:treasury'],
    })
    expect(item.chains).toHaveLength(7)
    // the agreeing Treasury has none
    expect(needsFrom([TREASURY_SYSTEM], [], ACTOR, FIXED_NOW).filter(i => i.kind === 'chains-disagree')).toEqual([])
  })

  it('empty hats → one item per tree, its nodes the hats’ refs', () => {
    const item = one(needsFrom([ROLES], [], ACTOR, FIXED_NOW), 'empty-hat')
    expect(item).toMatchObject({
      id: 'empty-hat:system:roles', title: '3 hats have no wearer', href: '/r/system/roles', chains: ['eip155:42220'],
      context: 'Regional coordinator, Comms, Local node 2', nodes: [hatRefOf(2, 3), hatRefOf(2, 4), hatRefOf(3, 2)],
    })
  })

  it('nothing for what waits on no one: an up-to-date System, a link, a closed proposal, an open one the actor has no part in', () => {
    const closed = { ...RETURN_POOLS, id: 'p-2026-10-01-001', state: 'ratified', needsYou: false } as ProposalView
    const unrelated = { ...ADD_SIGNER, id: 'p-2026-10-02-001', needsYou: false,
      evaluation: { ...ADD_SIGNER.evaluation, parts: ADD_SIGNER.evaluation.parts.map(p => ({ ...p, evaluation: { ...p.evaluation, tally: { for: ['steward-a'], needed: 4 } } })) } } as ProposalView
    const ops = SYSTEMS.find(r => r.id === 'system:ops-wallet')!
    expect(needsFrom([VOTES, ops], [closed, unrelated, PAY_KIT], ACTOR, FIXED_NOW)).toEqual([])
    // no actor: nothing they approved
    expect(needsFrom([], [ADD_SIGNER], null, FIXED_NOW)).toEqual([])
  })

  it('every item carries its source Resource’s facts (CC-14), and a hidden one keeps its visibility', () => {
    const hidden: Resource = { ...GARDEN, facts: { ...GARDEN.facts, visibility: 'hat:treasury' } }
    expect(one(needsFrom([hidden], [], ACTOR, FIXED_NOW), 'failed-read').facts).toMatchObject({ visibility: 'hat:treasury' })
    for (const item of all()) expect(item.facts, item.id).toBeDefined()
  })

  it('the /parts set: one of each kind, in order', () => {
    expect(orderNeeds(all(), FIXED_NOW).map(i => [i.kind, i.title])).toEqual([
      ['overdue', 'Close the spring call for local nodes'],
      ['proposal', 'Return the Gardens pools to the treasury'],
      ['empty-hat', '3 hats have no wearer'],
      ['signature', 'Sign nonce 18 on the Treasury'],
      ['chains-disagree', 'The Treasury disagrees across chains'],
      ['failed-read', 'The Example DAO Garden couldn’t be read'],
      ['proposal', 'Add a Treasury signer'],
    ])
  })

  // L7 fix r1 M1: during a quota outage a Safe is read from the chain, which does not say what waits; Needs keeps
  // flagging it as not fully read, as it flagged the failed read before, and never as nothing to sign.
  it('a Safe read from the chain → a failed-read item "couldn’t be read in full", naming the chains, with the read\'s note', () => {
    const fromChain = structuredClone(COUNCIL_SAFE)
    const d = fromChain.facts.driver as { state: string; facts: Record<string, unknown> }
    d.state = 'fresh'; delete d.facts.pending
    d.facts.source = 'chain'; d.facts.note = 'Read from the chain: the Safe Transaction Service did not answer (429)'
    const items = needsFrom([fromChain], [], ACTOR, FIXED_NOW)
    expect(items).toEqual([expect.objectContaining({
      id: 'partial-read:system:council-safe', kind: 'failed-read', title: 'The Council Safe couldn’t be read in full', chains: ['eip155:42220'],
      context: 'Read from the chain: the Safe Transaction Service did not answer (429); signatures waiting are not known',
    })])
    // a Safe the service read whole has no such item
    expect(needsFrom([COUNCIL_SAFE], [], ACTOR, FIXED_NOW).filter(i => i.id.startsWith('partial-read:'))).toEqual([])
  })
})
