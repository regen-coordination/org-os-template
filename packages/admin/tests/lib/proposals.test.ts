import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import {
  PROPOSAL_STATES, EVENT_KINDS, CLOCK_SKEW_MS, proposalId, eventId, revOf, liveEvents, leadMethod, derivedState,
  checkProposals, eventPermission,
} from '../../lib/proposals.mjs'
import { sha256Hex } from '../../lib/sha256.mjs'
import { resolveRoles } from '../../lib/rules.mjs'
import { classOf, CHANGE_CLASSES } from '../../lib/change-classes.mjs'

// Synthetic: members ana, bruno, carla (plan: global constraints).
const MEMBERS = [
  { id: 'ana', name: 'Ana' }, { id: 'bruno', name: 'Bruno' }, { id: 'carla', name: 'Carla' },
  { id: 'crew-engineer', name: 'Engineer seat', kind: 'agent' },
]
const GOVERNANCE = { roles: { maintainer: { members: ['ana', 'bruno'] }, member: { all: true } } }
const book = resolveRoles(GOVERNANCE, MEMBERS)
const ctx = (over = {}) => ({
  members: MEMBERS, governance: GOVERNANCE, systems: null, classes: CHANGE_CLASSES,
  classOf: (registry: string) => classOf({ registry }), ...over,
})

// Task 1 keeps its rules off `self_approve` and `expires`, which Task 2 adds to the rule vocabulary (LOW-2).
const RECORDS = { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } }
const BASE = 'a'.repeat(64)
const OPS = [
  { op: 'update', record: 'projects:alpha', set: { stage: 'develop' }, base: BASE },
  { op: 'create', record: 'relationships:beta', value: { id: 'beta', partner: 'Beta' }, base: null },
]
const proposal = (over: Record<string, unknown> = {}) => ({
  id: 'p-2026-10-18-001', title: 'Move one project', author: 'carla', classes: ['records'], rules: [RECORDS],
  state: 'open', opened: '2026-10-18T10:02:00-03:00', rev: revOf(OPS), ops: OPS, events: [], closed: null, ...over,
})
const ev = (over: Record<string, unknown> = {}) => ({ id: 'e-a-01', at: '2026-10-18T11:00:00-03:00', by: 'bruno', kind: 'approve', rev: revOf(OPS), ...over })
const messages = (entries: unknown[], over = {}) => checkProposals(entries as never, ctx(over) as never).map(p => p.message)

describe('sha256Hex (the pure hash a rev is made of; lib has no node:* import)', () => {
  it.each(['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'ação, 日本語, 🌱'.repeat(20)])('equals node:crypto on %j', text => {
    expect(sha256Hex(text)).toBe(createHash('sha256').update(text).digest('hex'))
  })
})

describe('ids', () => {
  // Final review I5: two clones proposing on the same UTC day before either Share is fetched counted the same NNN. The id
  // is the day's counter, then 4 lowercase hex of a random draw: p-YYYY-MM-DD-NNN-xxxx.
  const r = (n: number) => () => n / 65536
  it('proposalId counts the day: -001, then -002; another day starts again; a random suffix follows the counter', () => {
    expect(proposalId('2026-10-18', [], r(0xbeef))).toBe('p-2026-10-18-001-beef')
    expect(proposalId('2026-10-18', [{ id: 'p-2026-10-18-001-beef' }], r(0x0a0b))).toBe('p-2026-10-18-002-0a0b')
    expect(proposalId('2026-10-18', ['p-2026-10-18-001-aaaa', 'p-2026-10-18-002-bbbb', 'p-2026-10-17-009-cccc'], r(1))).toBe('p-2026-10-18-003-0001')
    expect(proposalId('2026-10-19', [{ id: 'p-2026-10-18-001-beef' }], r(0xffff))).toBe('p-2026-10-19-001-ffff')
    expect(proposalId('2026-10-18', [])).toMatch(/^p-2026-10-18-001-[0-9a-f]{4}$/)
  })
  it('proposalId counts ids of the old shape (no suffix) too', () => {
    expect(proposalId('2026-10-18', ['p-2026-10-18-001', 'p-2026-10-18-002'], r(5))).toBe('p-2026-10-18-003-0005')
  })
  it('proposalId takes the date as an ISO timestamp too (its first ten characters), and never reuses a gap', () => {
    expect(proposalId('2026-10-18T23:30:00-03:00', [{ id: 'p-2026-10-18-001-0000' }], r(2))).toBe('p-2026-10-18-002-0002')
    expect(proposalId('2026-10-18', [{ id: 'p-2026-10-18-003-0000' }], r(2))).toBe('p-2026-10-18-004-0002') // after the highest, so a deleted one is not reissued
  })
  it('eventId is e-<time in base 36>-<2 hex>, and two draws differ', () => {
    const id = eventId(Date.UTC(2026, 9, 18, 14, 0, 0), () => 0.5)
    expect(id).toBe(`e-${Date.UTC(2026, 9, 18, 14, 0, 0).toString(36)}-80`)
    expect(eventId(1, () => 0)).toMatch(/^e-1-00$/)
    expect(eventId(1, () => 0.999)).toMatch(/^e-1-ff$/)
    expect(eventId(new Date(0))).toMatch(/^e-0-[0-9a-f]{2}$/)
  })
})

describe('revOf', () => {
  it('is 12 hex', () => expect(revOf(OPS)).toMatch(/^[0-9a-f]{12}$/))
  it('is the same after a base change (a re-base never changes it, P2-R7)', () => {
    const rebased = OPS.map(o => ({ ...o, base: o.base === null ? null : 'b'.repeat(64), before: { stage: 'x' } }))
    expect(revOf(rebased)).toBe(revOf(OPS))
  })
  it('is different after a change to a set value', () => {
    const edited = [{ ...OPS[0], set: { stage: 'closed' } }, OPS[1]]
    expect(revOf(edited)).not.toBe(revOf(OPS))
  })
  it('does not depend on the order keys were written in', () => {
    const shuffled = [{ set: { stage: 'develop' }, record: 'projects:alpha', op: 'update' }, { value: { partner: 'Beta', id: 'beta' }, record: 'relationships:beta', op: 'create' }]
    expect(revOf(shuffled)).toBe(revOf(OPS))
  })
  it('is sha-256 of the canonical JSON of the ops without base and before, first 12 hex', () => {
    const canonical = '[{"op":"update","record":"projects:alpha","set":{"stage":"develop"}},{"op":"create","record":"relationships:beta","value":{"id":"beta","partner":"Beta"}}]'
    expect(revOf(OPS)).toBe(createHash('sha256').update(canonical).digest('hex').slice(0, 12))
  })
})

describe('liveEvents', () => {
  const rev = revOf(OPS)
  const old = 'f'.repeat(12)
  it('drops a retracted event and keeps the retract', () => {
    const p = proposal({ events: [ev({ id: 'e-1' }), ev({ id: 'e-2', by: 'ana', kind: 'retract', of: 'e-1', at: '2026-10-18T11:05:00-03:00' })] })
    expect(liveEvents(p as never).map(e => e.id)).toEqual(['e-2'])
  })
  it('drops an approve and a vote of an older rev, keeps a comment of any rev', () => {
    const p = proposal({ events: [
      ev({ id: 'e-1', rev: old }), ev({ id: 'e-2', kind: 'vote', vote: 'yes', rev: old }),
      ev({ id: 'e-3', kind: 'comment', text: 'ok', rev: old }), ev({ id: 'e-4' }), ev({ id: 'e-5', kind: 'vote', vote: 'no' }),
    ] })
    expect(liveEvents(p as never).map(e => e.id)).toEqual(['e-3', 'e-4', 'e-5'])
  })
  it('marks an objection of an older rev answered, and leaves a current one blocking', () => {
    const p = proposal({ events: [
      ev({ id: 'e-1', kind: 'object', text: 'no', rev: old }), ev({ id: 'e-2', kind: 'object', text: 'still no', rev }),
    ] })
    const [a, b] = liveEvents(p as never)
    expect(a).toMatchObject({ id: 'e-1', answered: true })
    expect(b!.answered).toBeFalsy()
  })
  it('orders by at, then id, and does not change the proposal it was given', () => {
    const events = [ev({ id: 'e-b', at: '2026-10-18T12:00:00-03:00' }), ev({ id: 'e-z', at: '2026-10-18T11:00:00-03:00' }), ev({ id: 'e-a', at: '2026-10-18T11:00:00-03:00' })]
    const p = proposal({ events })
    expect(liveEvents(p as never).map(e => e.id)).toEqual(['e-a', 'e-z', 'e-b'])
    expect(p.events.map((e: { id: string }) => e.id)).toEqual(['e-b', 'e-z', 'e-a'])
    expect(liveEvents(p as never)[0]).not.toBe(events[2]) // copies: the answered mark never reaches the ledger's data
  })
  it('compares the times as instants, across offsets', () => {
    const p = proposal({ events: [ev({ id: 'e-1', at: '2026-10-18T10:30:00+00:00' }), ev({ id: 'e-2', at: '2026-10-18T09:45:00-01:00' })] })
    expect(liveEvents(p as never).map(e => e.id)).toEqual(['e-1', 'e-2']) // 10:30Z, then 09:45-01:00 which is 10:45Z (as text, e-2 would sort first)
  })
})

describe('leadMethod and derivedState', () => {
  const rule = (method: string, id = method) => ({ id, applies_to: [id], propose: 'member', decide: { by: 'maintainer', method } })
  it('the lead rule is the most demanding method: vote, consent, system, approve', () => {
    expect(leadMethod([rule('approve'), rule('vote')] as never)).toBe('vote')
    expect(leadMethod([rule('approve'), rule('consent')] as never)).toBe('consent')
    expect(leadMethod([rule('approve'), rule('system')] as never)).toBe('system')
    expect(leadMethod([rule('direct'), rule('approve')] as never)).toBe('approve')
    expect(leadMethod([rule('direct')] as never)).toBe('direct')
  })
  it('an open proposal reads stale, objecting, voting or approving', () => {
    expect(derivedState(proposal({ rules: [rule('approve')] }) as never, { stale: true })).toBe('stale')
    expect(derivedState(proposal({ rules: [rule('consent')] }) as never, { stale: false })).toBe('objecting')
    expect(derivedState(proposal({ rules: [rule('vote'), rule('approve')] }) as never, { stale: false })).toBe('voting')
    expect(derivedState(proposal({ rules: [rule('approve')] }) as never, { stale: false })).toBe('approving')
    expect(derivedState(proposal({ rules: [rule('direct')] }) as never, { stale: false })).toBe('approving')
    expect(derivedState(proposal({ rules: [rule('system')] }) as never, { stale: false })).toBe('approving')
  })
  it('a closed proposal reads its stored state, stale or not', () => {
    for (const state of ['ratified', 'rejected', 'withdrawn', 'expired']) {
      expect(derivedState(proposal({ state }) as never, { stale: true })).toBe(state)
    }
  })
  it('the five stored states are the five of architecture §4.4', () => expect(PROPOSAL_STATES).toEqual(['open', 'ratified', 'rejected', 'withdrawn', 'expired']))
})

describe('checkProposals', () => {
  it('passes the spec’s §3.1 example verbatim (it names a real collection, relationships, and a 64-hex base: LOW-5)', () => {
    const spec = readFileSync(fileURLToPath(new URL('../../../../docs/superpowers/specs/2026-10-18-org-os-0.6-p2-proposals-design.md', import.meta.url)), 'utf8')
    const block = /### 3\.1 The ledger[\s\S]*?```yaml\n([\s\S]*?)```/.exec(spec)?.[1]
    expect(block, 'the §3.1 example is in the spec').toBeDefined()
    const doc = parse(block!) as { proposals: unknown[] }
    expect(doc.proposals).toHaveLength(1)
    expect(checkProposals(doc.proposals as never, ctx({ members: [...MEMBERS] }) as never)).toEqual([])
  })
  it('passes a good proposal with events', () => {
    const events = [ev({ id: 'e-1' }), ev({ id: 'e-2', by: 'ana', kind: 'object', text: 'This harms the aim.' }), ev({ id: 'e-3', kind: 'retract', of: 'e-2' }),
      ev({ id: 'e-4', by: 'carla', kind: 'comment', text: 'Thanks.' }), ev({ id: 'e-5', kind: 'vote', vote: 'abstain' })]
    expect(messages([proposal({ events })])).toEqual([])
  })
  it('passes a closed proposal that carries `closed`, and `system:<id>` as the writer of a system event', () => {
    const closed = { at: '2026-10-19T10:00:00-03:00', by: 'bruno', decision: 'gov-20261019-001' }
    expect(messages([proposal({ state: 'ratified', closed })])).toEqual([])
    expect(messages([proposal({ events: [ev({ id: 'e-s', by: 'system:treasury-safe', kind: 'system', outcome: 'executed' })] })], { systems: [{ id: 'treasury-safe' }] })).toEqual([])
  })
  it('an empty or absent ledger has nothing to say', () => {
    expect(messages([])).toEqual([])
  })
  it.each([
    ['a duplicate id', [proposal(), proposal()], /id "p-2026-10-18-001" is used twice/],
    ['a state outside the five', [proposal({ state: 'draft' })], /state "draft" is not one of open, ratified, rejected, withdrawn, expired/],
    ['a closed proposal without `closed`', [proposal({ state: 'rejected', closed: null })], /rejected but has no `closed`/],
    ['an open proposal that carries `closed`', [proposal({ closed: { at: '2026-10-19T10:00:00-03:00', by: 'bruno' } })], /is open but carries `closed`/],
    ['rules that fail the rule shape', [proposal({ rules: [{ ...RECORDS, decide: { by: 'maintainer', method: 'approve', count: 'two' } }] })], /count must be a whole number/],
    ['rules that name no role', [proposal({ rules: [{ ...RECORDS, propose: 'nobody' }] })], /roles defines none/],
    ['no rules at all', [proposal({ rules: [] })], /holds no rules/],
    ['classes that do not cover the ops', [proposal({ classes: ['members'] })], /op on projects:alpha is class records, which `classes` does not list/],
    ['an author who is not a member', [proposal({ author: 'zed' })], /author "zed" is not a member/],
    ['an event by a non-member', [proposal({ events: [ev({ by: 'zed' })] })], /event e-a-01: "zed" is not a member/],
    ['an object with no text', [proposal({ events: [ev({ kind: 'object' })] })], /event e-a-01: an objection needs its text/],
    ['a comment with no text', [proposal({ events: [ev({ kind: 'comment' })] })], /event e-a-01: a comment needs its text/],
    ['a vote without yes, no or abstain', [proposal({ events: [ev({ kind: 'vote', vote: 'maybe' })] })], /event e-a-01: a vote is yes, no or abstain/],
    ['a vote with no value', [proposal({ events: [ev({ kind: 'vote' })] })], /event e-a-01: a vote is yes, no or abstain/],
    ['a retract of an unknown event', [proposal({ events: [ev({ kind: 'retract', of: 'e-nope' })] })], /event e-a-01: retracts "e-nope", which is not an event of this proposal/],
    ['a retract with no target', [proposal({ events: [ev({ kind: 'retract' })] })], /event e-a-01: a retract names the event it takes back/],
    ['a duplicate event id', [proposal({ events: [ev(), ev()] })], /event id "e-a-01" is used twice/],
    ['an event kind nobody wrote', [proposal({ events: [ev({ kind: 'shout' })] })], /event e-a-01: kind "shout" is not one of/],
    ['an event with no time', [proposal({ events: [ev({ at: 'yesterday' })] })], /event e-a-01: "yesterday" is not a time/],
    ['a system event by a person', [proposal({ events: [ev({ kind: 'system', outcome: 'executed' })] })], /event e-a-01: a system event is written by system:<id>/],
    ['a system event from a system the instance does not hold', [proposal({ events: [ev({ by: 'system:nope', kind: 'system' })] })], /event e-a-01: no system "nope"/],
  ])('refuses %s', (_name, entries, pattern) => {
    expect(messages(entries as never, { systems: [{ id: 'treasury-safe' }] }).join('\n')).toMatch(pattern as RegExp)
  })
  it('names the proposal and the field in each problem, as an error', () => {
    const [p] = checkProposals([proposal({ events: [ev({ kind: 'object' })] })] as never, ctx() as never)
    expect(p).toMatchObject({ id: 'p-2026-10-18-001', path: 'events.e-a-01', level: 'error' })
  })
  it('skips what it was not given to know: no members, no classOf', () => {
    expect(messages([proposal({ author: 'zed', classes: ['members'] })], { members: null, classOf: undefined })).toEqual([])
  })
  // DAO-OS L5 ruling P8: the §7.6 check judges the live data/governance.yaml only, never the rules a proposal froze.
  it('frozen rules whose propose role holds nobody with a handle raise no "nobody can propose" error (ruling P8)', () => {
    const noHandles = [{ id: 'steward-a', name: 'Steward A' }, { id: 'steward-b', name: 'Steward B' }]
    const governance = { roles: { maintainer: { members: ['steward-a', 'steward-b'] }, member: { all: true } } }
    const found = checkProposals([proposal({ author: 'steward-a', events: [] })] as never, ctx({ members: noHandles, governance }) as never)
    expect(found).toEqual([])
  })
  it('does not demand that `rev` equal the ops’ rev: the spec example’s rev is an example', () => {
    expect(messages([proposal({ rev: '3f9a1c20b7de' })])).toEqual([])
  })
})

describe('eventPermission (the one place §3.2’s table is written)', () => {
  const rules = [RECORDS]
  // carla authored the proposal; ana and bruno are maintainers (the deciders); carla is a plain member.
  type Over = { proposal?: Record<string, unknown>, rules?: unknown[], of?: string }
  const ask = (kind: string, actor: string, over: Over = {}) =>
    eventPermission(kind, { actor, proposal: proposal(over.proposal ?? {}) as never, rules: (over.rules ?? rules) as never, book, known: MEMBERS.map(m => m.id), of: over.of })

  it('knows every kind the ledger holds', () => {
    expect(EVENT_KINDS).toEqual(['approve', 'object', 'vote', 'comment', 'retract', 'revise', 'replay', 'attach', 'system', 'withdraw', 'reject', 'expire', 'ratify'])
    expect(CLOCK_SKEW_MS).toBe(600000)
    expect(ask('dance', 'ana')).toMatch(/"dance" is not a kind of event/)
  })

  describe('approve (the contract of spec §3.2)', () => {
    it('a decider who is not the author: allowed', () => expect(ask('approve', 'bruno')).toBeNull())
    it('a person in no rule’s `by`: refused', () => expect(ask('approve', 'carla', { proposal: { author: 'ana' } })).toMatch(/does not hold the maintainer role/))
    it('the author, with no rule setting self_approve: refused, in the notAuthor sentence', () => {
      expect(ask('approve', 'bruno', { proposal: { author: 'bruno' } })).toMatch(/cannot approve their own proposal/)
    })
    const A = { ...RECORDS, id: 'a', self_approve: true }
    const B = { ...RECORDS, id: 'b' }
    const Bwide = { ...B, decide: { by: 'member', method: 'approve', count: 1 } } // everyone in `member` decides here: carla too
    it('the author with [A (self_approve), B] and in both `by`: allowed', () => {
      expect(ask('approve', 'bruno', { proposal: { author: 'bruno' }, rules: [A, B] })).toBeNull()
    })
    it('the author with [A (self_approve), B] and in B’s `by` only: refused', () => {
      // carla is the author and a decider of Bwide (the member role) but not of A (maintainers only)
      expect(ask('approve', 'carla', { proposal: { author: 'carla' }, rules: [A, Bwide] })).toMatch(/cannot approve their own proposal/)
    })
    it('the author, in A’s `by` which sets self_approve: allowed even though another rule does not', () => {
      const wide = { ...A, decide: { by: 'member', method: 'approve', count: 1 } }
      expect(ask('approve', 'carla', { proposal: { author: 'carla' }, rules: [wide, B] })).toBeNull()
    })
    it('an agent is never a decider', () => expect(ask('approve', 'crew-engineer', { proposal: { author: 'ana' } })).toMatch(/agent/))
  })

  it('object and vote: only a decider; the author may vote', () => {
    expect(ask('object', 'ana')).toBeNull()
    expect(ask('object', 'carla', { proposal: { author: 'ana' } })).toMatch(/does not hold the maintainer role/)
    expect(ask('vote', 'bruno')).toBeNull()
    expect(ask('vote', 'carla', { proposal: { author: 'ana' } })).toMatch(/does not hold the maintainer role/)
    expect(ask('vote', 'ana', { proposal: { author: 'ana' } })).toBeNull() // only approve excludes the author
    expect(ask('vote', 'crew-engineer', { proposal: { author: 'ana' } })).toMatch(/agent/)
  })
  it('comment: any known member, an agent included; nobody else', () => {
    expect(ask('comment', 'carla')).toBeNull()
    expect(ask('comment', 'crew-engineer')).toBeNull()
    expect(ask('comment', 'zed')).toMatch(/not a member/)
  })
  it('retract: the author of the event it names, and not a retract', () => {
    const events = [ev({ id: 'e-1', by: 'bruno' }), ev({ id: 'e-2', by: 'ana', kind: 'retract', of: 'e-9' })]
    expect(ask('retract', 'bruno', { of: 'e-1', proposal: { events } })).toBeNull()
    expect(ask('retract', 'ana', { of: 'e-1', proposal: { events } })).toMatch(/only the person who wrote an event can take it back/)
    expect(ask('retract', 'ana', { of: 'e-nope', proposal: { events } })).toMatch(/no event "e-nope"/)
    expect(ask('retract', 'ana', { of: 'e-2', proposal: { events } })).toMatch(/cannot be taken back/)
    expect(ask('retract', 'ana', { proposal: { events } })).toMatch(/names no event/)
  })
  it('revise and withdraw: the author', () => {
    for (const kind of ['revise', 'withdraw']) {
      expect(ask(kind, 'carla'), kind).toBeNull()
      expect(ask(kind, 'ana'), kind).toMatch(/only the author/)
    }
  })
  it('attach: a member who may propose under a rule of the snapshot, on a proposal a system decides', () => {
    const SAFE = { id: 'treasury', applies_to: ['treasury'], propose: 'member', decide: { by: 'system', method: 'system', system: 'treasury-safe' } }
    expect(ask('attach', 'carla', { rules: [SAFE] })).toBeNull() // the member role proposes
    expect(ask('attach', 'carla', { rules: [SAFE, RECORDS] })).toBeNull()
    const narrow = [{ ...SAFE, propose: 'maintainer' }]
    expect(ask('attach', 'ana', { rules: narrow })).toBeNull()
    expect(ask('attach', 'carla', { rules: narrow })).toMatch(/does not hold the maintainer role/)
  })
  it('attach: nobody, on a proposal no rule of which waits on an outside system (fix round 1 of Task 15)', () => {
    for (const who of ['carla', 'ana']) expect(ask('attach', who)).toBe('this proposal waits on no outside system, so there is nothing to attach: people decide it.')
  })
  it('system: the server only', () => {
    expect(ask('system', 'system:treasury-safe')).toBeNull()
    expect(ask('system', 'ana')).toMatch(/only the server/)
  })
  it('replay: any known actor, or the server', () => {
    expect(ask('replay', 'carla')).toBeNull()
    expect(ask('replay', 'system:server')).toBeNull()
    expect(ask('replay', 'zed')).toMatch(/not a member/)
  })
  it('ratify, reject, expire: the author or a decider, a person', () => {
    for (const kind of ['ratify', 'reject', 'expire']) {
      expect(ask(kind, 'carla'), kind).toBeNull() // the author
      expect(ask(kind, 'bruno'), kind).toBeNull() // a decider
      expect(ask(kind, 'crew-engineer', { proposal: { author: 'crew-engineer' } }), kind).toMatch(/agent/)
    }
    expect(ask('ratify', 'zed')).toMatch(/not a member/)
    // under a rule decided by a system there are no deciders: only the author ratifies
    const bySystem = [{ ...RECORDS, decide: { by: 'system', method: 'system', system: 's' } }]
    expect(ask('ratify', 'ana', { rules: bySystem })).toMatch(/only the author or one of the people who decide/)
    expect(ask('ratify', 'carla', { rules: bySystem })).toBeNull()
  })
})
