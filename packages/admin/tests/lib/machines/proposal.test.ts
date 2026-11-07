import { describe, it, expect } from 'vitest'
import { transition, enabled, walk } from '../../../lib/machines/run.mjs'
import { verify } from '../../../lib/machines/verify.mjs'
import { proposal, proposalGuards } from '../../../lib/machines/proposal.mjs'
import { eventPermission, revOf } from '../../../lib/proposals.mjs'
import { resolveRoles } from '../../../lib/rules.mjs'

// ana and bruno are maintainers (the deciders); carla is a plain member and the author; dora a member.
const MEMBERS = [{ id: 'ana' }, { id: 'bruno' }, { id: 'carla' }, { id: 'dora' }, { id: 'crew-engineer', kind: 'agent' }]
const book = resolveRoles({ roles: { maintainer: { members: ['ana', 'bruno'] }, member: { all: true } } }, MEMBERS)
const known = MEMBERS.map(m => m.id)
const OPS = [{ op: 'update', record: 'projects:alpha', set: { stage: 'develop' }, base: null }]
const RECORDS = { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } }
const SAFE = { id: 'treasury', applies_to: ['treasury'], propose: 'member', decide: { by: 'system', method: 'system', system: 'treasury-safe' } }

/** The context a route builds: the proposal, its rule snapshot, the roles now, the evaluation's outcome. */
const context = (over: Record<string, unknown> = {}) => {
  const rules = (over.rules as unknown[]) ?? [RECORDS]
  const events = (over.events as unknown[]) ?? []
  const author = (over.author as string) ?? 'carla'
  return { author, method: 'approve', outcome: 'pending', rules, book, known,
    proposal: { author, rev: revOf(OPS), events, rules }, ...over }
}
const send = (state: string, type: string, by: string, ctx = context(), extra: Record<string, unknown> = {}) =>
  transition(proposal, proposalGuards, state, { type, by, ...extra }, ctx)
const OPEN = ['approving', 'objecting', 'voting', 'stale']
const FINAL = ['ratified', 'rejected', 'withdrawn', 'expired']

describe('the proposal machine, amended (P2 Task 4)', () => {
  it('is well formed: every state reachable, no dead end that is not final, every edge able to fire', () => {
    expect(verify(proposal)).toEqual([])
    expect(walk(proposal).deadEnds).toEqual([])
  })

  it('names the events P2 writes', () => {
    expect(proposal.events).toEqual(['APPROVE', 'OBJECT', 'VOTE', 'COMMENT', 'RETRACT', 'ATTACH', 'SYSTEM', 'REVISE', 'TRUNK_MOVED', 'REPLAYED', 'RATIFY', 'REJECT', 'WITHDRAW', 'EXPIRE'])
    expect(walk(proposal).states).toEqual(['approving', 'objecting', 'voting', 'stale', 'ratified', 'rejected', 'withdrawn', 'expired'])
  })

  describe('no clock closes a proposal (P2-R3: ratifying and rejecting are a person’s act)', () => {
    // Review MEDIUM-A: WINDOW_CLOSED went to `rejected` whatever the outcome and to `ratified` for anyone.
    // The evaluator reads the clock; a person writes RATIFY or REJECT, and the guards ask who and what the rule says.
    it('has no WINDOW_CLOSED event and no state takes one', () => {
      expect(proposal.events).not.toContain('WINDOW_CLOSED')
      for (const s of Object.keys(proposal.states)) expect(Object.keys(proposal.states[s]!.on ?? {}), s).not.toContain('WINDOW_CLOSED')
    })
    it.each(['objecting', 'voting'])('in %s, WINDOW_CLOSED moves nothing, for any outcome and any actor', state => {
      for (const outcome of ['pending', 'expired', 'failed', 'met']) {
        for (const by of ['ana', 'carla', 'dora', undefined]) {
          const r = transition(proposal, proposalGuards, state, { type: 'WINDOW_CLOSED', by }, context({ outcome, method: state === 'voting' ? 'vote' : 'consent' }))
          expect(r, `${state} ${outcome} ${by}`).toMatchObject({ ok: false })
        }
      }
    })
    it.each(['objecting', 'voting'])('in %s, a person who may ratify still closes a met rule, and a failed one with REJECT', state => {
      const method = state === 'voting' ? 'vote' : 'consent'
      expect(send(state, 'RATIFY', 'ana', context({ outcome: 'met', method }))).toMatchObject({ ok: true, state: 'ratified' })
      expect(send(state, 'REJECT', 'ana', context({ outcome: 'failed', method }))).toMatchObject({ ok: true, state: 'rejected' })
      expect(send(state, 'REJECT', 'ana', context({ outcome: 'pending', method }))).toMatchObject({ ok: false })
    })
  })

  describe('the self-loop events', () => {
    it.each(['COMMENT', 'RETRACT', 'REVISE'])('%s is in every open state', type => {
      for (const s of OPEN) expect(Object.keys(proposal.states[s]!.on ?? {}), `${s} ${type}`).toContain(type)
    })
    it.each(['ATTACH', 'SYSTEM'])('%s is in every open state but stale', type => {
      for (const s of OPEN.filter(s => s !== 'stale')) expect(Object.keys(proposal.states[s]!.on ?? {}), `${s} ${type}`).toContain(type)
      expect(Object.keys(proposal.states.stale!.on ?? {})).not.toContain(type)
    })
    it.each(['COMMENT', 'RETRACT', 'ATTACH', 'SYSTEM', 'REVISE'])('%s is in no final state', type => {
      for (const s of FINAL) expect(Object.keys(proposal.states[s]!.on ?? {}), `${s} ${type}`).not.toContain(type)
    })
    it('a comment, a retract of one’s own event, and an attach loop in place and change nothing', () => {
      const events = [{ id: 'e-1', at: '2026-10-18T11:00:00Z', by: 'dora', kind: 'comment', text: 'hi' }]
      expect(send('approving', 'COMMENT', 'dora')).toMatchObject({ ok: true, state: 'approving' })
      expect(send('objecting', 'RETRACT', 'dora', context({ events }), { of: 'e-1' })).toMatchObject({ ok: true, state: 'objecting' })
      expect(send('voting', 'ATTACH', 'carla', context({ rules: [SAFE, RECORDS] }))).toMatchObject({ ok: true, state: 'voting' })
      // a proposal no system decides takes no attach (fix round 1 of Task 15): the machine, `can` and the route agree
      expect(send('voting', 'ATTACH', 'carla')).toMatchObject({ ok: false, guard: 'mayWrite', reason: expect.stringMatching(/waits on no outside system/) })
      expect(send('approving', 'SYSTEM', 'system:treasury-safe')).toMatchObject({ ok: true, state: 'approving' })
    })
    it('REVISE loops for the author; from stale it goes to the sub-state the lead rule gives', () => {
      expect(send('approving', 'REVISE', 'carla')).toMatchObject({ ok: true, state: 'approving' })
      expect(send('stale', 'REVISE', 'carla', context({ method: 'consent' }))).toMatchObject({ ok: true, state: 'objecting' })
      expect(send('stale', 'REVISE', 'carla', context({ method: 'vote' }))).toMatchObject({ ok: true, state: 'voting' })
      expect(send('stale', 'REVISE', 'carla', context({ method: 'approve' }))).toMatchObject({ ok: true, state: 'approving' })
      expect(send('approving', 'REVISE', 'dora')).toMatchObject({ ok: false, guard: 'mayWrite', reason: expect.stringMatching(/only the author/) })
    })
  })

  describe('REPLAYED (spec §3.5: replay is mechanical, any known actor; a stale one needs the author’s choice)', () => {
    it.each(['approving', 'objecting', 'voting'])('in %s it loops for any known member, an agent included, and for nobody else', s => {
      for (const by of ['dora', 'ana', 'carla', 'crew-engineer']) expect(send(s, 'REPLAYED', by, context({ trunkMoved: true })), `${s} ${by}`).toMatchObject({ ok: true, state: s })
      expect(send(s, 'REPLAYED', 'zed', context({ trunkMoved: true }))).toMatchObject({ ok: false, guard: 'mayWrite', reason: expect.stringMatching(/not a member/) })
    })
    // Final review I4: mechanical replay is a fixed point; it is offered only when the trunk changed an ops file since the base.
    it.each(['approving', 'objecting', 'voting'])('in %s it is refused when the trunk changed none of the ops\' files since the base', s => {
      expect(send(s, 'REPLAYED', 'dora')).toMatchObject({ ok: false, guard: 'trunkMoved', reason: 'Already on the trunk: nothing to replay.' })
      expect(send(s, 'REPLAYED', 'dora', context({ trunkMoved: false }))).toMatchObject({ ok: false, guard: 'trunkMoved' })
    })
    it('in stale it takes the author with a choice, and moves to the sub-state the lead rule gives', () => {
      expect(send('stale', 'REPLAYED', 'carla', context(), { choose: 'mine' })).toMatchObject({ ok: true, state: 'approving' })
      expect(send('stale', 'REPLAYED', 'carla', context({ method: 'consent' }), { choose: 'theirs' })).toMatchObject({ ok: true, state: 'objecting' })
      expect(send('stale', 'REPLAYED', 'carla', context({ method: 'vote' }), { choose: 'mine' })).toMatchObject({ ok: true, state: 'voting' })
    })
    it('in stale it refuses the author without a choice, and anyone else with one, in words', () => {
      expect(send('stale', 'REPLAYED', 'carla')).toMatchObject({ ok: false, guard: 'authorChooses', reason: expect.stringMatching(/Keep mine or Take theirs/) })
      expect(send('stale', 'REPLAYED', 'carla', context(), { choose: 'both' })).toMatchObject({ ok: false, guard: 'authorChooses' })
      for (const by of ['ana', 'dora']) {
        expect(send('stale', 'REPLAYED', by, context(), { choose: 'mine' }), by).toMatchObject({ ok: false, guard: 'authorChooses', reason: expect.stringMatching(/only its author/) })
      }
    })
  })

  describe('stale accepts only what a stale proposal may take (spec §3.5)', () => {
    it('COMMENT, RETRACT, WITHDRAW, REPLAYED, REVISE, TRUNK_MOVED and EXPIRE, nothing else', () => {
      expect(Object.keys(proposal.states.stale!.on ?? {}).sort()).toEqual(['COMMENT', 'EXPIRE', 'REPLAYED', 'RETRACT', 'REVISE', 'TRUNK_MOVED', 'WITHDRAW'])
    })
    it('refuses an approval, in the state’s own words', () => {
      const r = send('stale', 'APPROVE', 'bruno')
      expect(r).toMatchObject({ ok: false })
      expect(r.ok ? '' : r.reason).toMatch(/trunk moved/)
    })
  })

  describe('APPROVE (the contract of spec §3.2: guard and eventPermission give the same answer)', () => {
    it('a decider who is not the author is accepted', () => {
      expect(send('approving', 'APPROVE', 'bruno')).toMatchObject({ ok: true, state: 'approving' })
    })
    it('the author is refused with the notAuthor sentence when no rule names them with self_approve', () => {
      const ctx = context({ author: 'bruno' })
      const r = send('approving', 'APPROVE', 'bruno', ctx)
      expect(r).toMatchObject({ ok: false, guard: 'mayJudge' })
      const asked = eventPermission('approve', { actor: 'bruno', proposal: ctx.proposal as never, rules: ctx.rules as never, book, known })
      expect(r.ok ? null : r.reason).toBe(asked)
      expect(asked).toMatch(/cannot approve their own proposal/)
      expect(proposalGuards.notAuthor!(ctx, { type: 'APPROVE', by: 'bruno' })).toBe(asked)
    })
    const A = { ...RECORDS, id: 'a', self_approve: true }
    const B = { ...RECORDS, id: 'b' }
    it('with [A (self_approve), B] and the author in both `by`: accepted, and eventPermission agrees', () => {
      const ctx = context({ author: 'bruno', rules: [A, B] })
      expect(send('approving', 'APPROVE', 'bruno', ctx)).toMatchObject({ ok: true })
      expect(eventPermission('approve', { actor: 'bruno', proposal: ctx.proposal as never, rules: ctx.rules as never, book, known })).toBeNull()
    })
    it('with [A (self_approve), B] and the author in B’s `by` only: refused, and eventPermission agrees', () => {
      const wideB = { ...B, decide: { by: 'member', method: 'approve', count: 1 } }
      const ctx = context({ author: 'carla', rules: [A, wideB] })
      const r = send('approving', 'APPROVE', 'carla', ctx)
      expect(r).toMatchObject({ ok: false })
      expect(r.ok ? null : r.reason).toBe(eventPermission('approve', { actor: 'carla', proposal: ctx.proposal as never, rules: ctx.rules as never, book, known }))
    })
  })

  describe('OBJECT and VOTE need a decider who is a person (mayJudge)', () => {
    it.each(['OBJECT', 'VOTE'])('%s: a decider is accepted; a non-decider and an agent are refused with a sentence', type => {
      for (const s of ['approving', 'objecting', 'voting']) {
        if (!Object.hasOwn(proposal.states[s]!.on ?? {}, type)) continue
        expect(send(s, type, 'ana'), `${s} ${type}`).toMatchObject({ ok: true })
        const stranger = send(s, type, 'dora')
        expect(stranger).toMatchObject({ ok: false, guard: 'mayJudge' })
        expect(stranger.ok ? '' : stranger.reason).toMatch(/does not hold the maintainer role/)
        const agent = send(s, type, 'crew-engineer')
        expect(agent.ok ? '' : agent.reason).toMatch(/agent/)
      }
    })
    it('every state that takes an approval, an objection or a vote has them guarded', () => {
      for (const [name, def] of Object.entries(proposal.states)) {
        for (const type of ['APPROVE', 'OBJECT', 'VOTE']) {
          const t = def.on?.[type]
          if (t === undefined) continue
          expect(JSON.stringify(t), `${name} ${type}`).toContain('mayJudge')
        }
      }
    })
  })

  describe('closings', () => {
    it('EXPIRE needs pastDue (the guard that was missing): a pending proposal cannot be expired by anyone', () => {
      expect(send('approving', 'EXPIRE', 'carla', context({ outcome: 'pending' }))).toMatchObject({ ok: false, guard: 'pastDue' })
      expect(send('approving', 'EXPIRE', 'carla', context({ outcome: 'expired' }))).toMatchObject({ ok: true, state: 'expired' })
      expect(send('stale', 'EXPIRE', 'carla', context({ outcome: 'expired' }))).toMatchObject({ ok: true, state: 'expired' })
      expect(send('stale', 'EXPIRE', 'carla', context({ outcome: 'pending' }))).toMatchObject({ ok: false, guard: 'pastDue' })
    })
    it('REJECT needs ruleFailed, in every open state that can fail (vote and system can; approve and consent only wait)', () => {
      for (const s of ['approving', 'objecting', 'voting']) {
        expect(send(s, 'REJECT', 'carla', context({ outcome: 'pending' })), s).toMatchObject({ ok: false, guard: 'ruleFailed' })
        expect(send(s, 'REJECT', 'carla', context({ outcome: 'failed' })), s).toMatchObject({ ok: true, state: 'rejected' })
      }
      expect(send('stale', 'REJECT', 'carla', context({ outcome: 'failed' }))).toMatchObject({ ok: false })
    })
    it('RATIFY needs ruleMet and mayRatify: the rule met, and the author or a decider, a person', () => {
      for (const s of ['approving', 'objecting', 'voting']) {
        expect(send(s, 'RATIFY', 'carla', context({ outcome: 'pending' })), s).toMatchObject({ ok: false, guard: 'ruleMet' })
        expect(send(s, 'RATIFY', 'carla', context({ outcome: 'met' })), `${s} author`).toMatchObject({ ok: true, state: 'ratified' })
        expect(send(s, 'RATIFY', 'bruno', context({ outcome: 'met' })), `${s} decider`).toMatchObject({ ok: true, state: 'ratified' })
        const stranger = send(s, 'RATIFY', 'dora', context({ outcome: 'met' }))
        expect(stranger, `${s} stranger`).toMatchObject({ ok: false, guard: 'mayRatify' })
        expect(stranger.ok ? '' : stranger.reason).toMatch(/only the author or one of the people who decide/)
        expect(send(s, 'RATIFY', 'crew-engineer', context({ outcome: 'met', author: 'crew-engineer' })), `${s} agent`).toMatchObject({ ok: false, guard: 'mayRatify' })
      }
      expect(send('stale', 'RATIFY', 'carla', context({ outcome: 'met' }))).toMatchObject({ ok: false })
    })
    // Review MEDIUM-1: only RATIFY's mayRatify was pinned; REJECT's could be deleted with every test still passing.
    it.each(['approving', 'objecting', 'voting'])('REJECT in %s needs mayRatify: a non-decider and an agent are refused on a failed rule', s => {
      const method = s === 'voting' ? 'vote' : s === 'objecting' ? 'consent' : 'approve'
      const stranger = send(s, 'REJECT', 'dora', context({ outcome: 'failed', method }))
      expect(stranger, `${s} stranger`).toMatchObject({ ok: false, guard: 'mayRatify' })
      expect(stranger.ok ? '' : stranger.reason).toMatch(/only the author or one of the people who decide/)
      expect(send(s, 'REJECT', 'crew-engineer', context({ outcome: 'failed', method, author: 'crew-engineer' })), `${s} agent`).toMatchObject({ ok: false, guard: 'mayRatify' })
      // the guard refuses the person, not the closing: a decider still closes the same failed rule
      expect(send(s, 'REJECT', 'ana', context({ outcome: 'failed', method })), `${s} decider`).toMatchObject({ ok: true, state: 'rejected' })
    })
    it('WITHDRAW is the author’s alone', () => {
      expect(send('approving', 'WITHDRAW', 'dora')).toMatchObject({ ok: false, guard: 'byAuthor', reason: 'only its author can withdraw a proposal' })
      expect(send('approving', 'WITHDRAW', 'carla')).toMatchObject({ ok: true, state: 'withdrawn' })
    })
  })

  describe('the guards call eventPermission and do not write its table again', () => {
    const KINDS: [string, string][] = [['APPROVE', 'approve'], ['OBJECT', 'object'], ['VOTE', 'vote'], ['COMMENT', 'comment'], ['ATTACH', 'attach'], ['REVISE', 'revise']]
    it.each(KINDS)('%s: refused or accepted exactly as eventPermission answers, for every actor', (type, kind) => {
      for (const actor of ['ana', 'bruno', 'carla', 'dora', 'crew-engineer', 'zed']) {
        const ctx = context()
        const asked = eventPermission(kind, { actor, proposal: ctx.proposal as never, rules: ctx.rules as never, book, known })
        const r = send(type === 'VOTE' ? 'voting' : 'approving', type, actor, ctx) // a vote is written in the state that takes votes
        if (asked === null) expect(r.ok, `${type} ${actor}`).toBe(true)
        else expect(r.ok ? null : r.reason, `${type} ${actor}`).toBe(asked)
      }
    })
    it('every guard returns a sentence on refusal, never a bare false', () => {
      for (const [name, guard] of Object.entries(proposalGuards)) {
        const r = guard(context({ outcome: 'pending', method: 'vote' }), { type: 'X', by: 'zed' })
        expect(r === true || (typeof r === 'string' && r.length > 3), name).toBe(true)
      }
    })
    it('a guard that needs the proposal and was not given it says so, loudly', () => {
      expect(() => proposalGuards.mayJudge!({ outcome: 'met' }, { type: 'APPROVE', by: 'ana' })).toThrow(/needs the proposal/)
    })
  })

  it('enabled() sends an event as `{ type }` alone, so with no actor named every guarded event is off and only the server’s TRUNK_MOVED is on', () => {
    const ctx = context()
    expect([...enabled(proposal, proposalGuards, 'approving', ctx)].sort()).toEqual(['TRUNK_MOVED'])
  })
})
