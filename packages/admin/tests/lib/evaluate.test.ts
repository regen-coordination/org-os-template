import { describe, it, expect } from 'vitest'
import { evaluate, evaluateAll } from '../../lib/evaluate.mjs'
import { checkProposals, revOf } from '../../lib/proposals.mjs'
import { resolveRoles } from '../../lib/rules.mjs'
import { CHANGE_CLASSES, classOf } from '../../lib/change-classes.mjs'

// Fixed dates only; the clock is injected. Members are synthetic.
const MEMBERS = [
  { id: 'ana' }, { id: 'bruno' }, { id: 'carla' }, { id: 'dora' }, { id: 'crew-engineer', kind: 'agent' },
]
const GOVERNANCE = { roles: { maintainer: { members: ['ana', 'bruno', 'carla'] }, member: { all: true } } }
const book = resolveRoles(GOVERNANCE, MEMBERS)

const OPENED = Date.parse('2026-10-01T10:00:00Z')
const H = 3600e3
const D = 24 * H
/** An ISO time `ms` after the proposal opened. */
const t = (ms: number) => new Date(OPENED + ms).toISOString()
const OPS = [{ op: 'update', record: 'projects:alpha', set: { stage: 'develop' }, base: null }]
const REV = revOf(OPS)
const OLD = '000000000000'

const rule = (decide: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  ({ id: 'r', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', ...decide }, ...over })
const APPROVE = (count = 1, over = {}) => rule({ method: 'approve', count }, over)
const CONSENT = rule({ method: 'consent', window: 'P7D' })
const VOTE = (extra = {}) => rule({ method: 'vote', window: 'P3D', quorum: 2, threshold: 0.5, ...extra })

let n = 0
const ev = (kind: string, by: string, atMs: number, over: Record<string, unknown> = {}) =>
  ({ id: `e-${++n}`, at: t(atMs), by, kind, rev: REV, ...over })
const approve = (by: string, atMs = H, over = {}) => ev('approve', by, atMs, over)
const object = (by: string, atMs = H, over = {}) => ev('object', by, atMs, { text: 'This harms the aim.', ...over })
const vote = (by: string, v: string, atMs = H, over = {}) => ev('vote', by, atMs, { vote: v, ...over })
const proposal = (events: unknown[] = [], over: Record<string, unknown> = {}) =>
  ({ author: 'dora', opened: t(0), rev: REV, events, ...over })
const run = (r: unknown, events: unknown[] = [], now = H * 2, over: Record<string, unknown> = {}) =>
  evaluate({ rule: r as never, proposal: proposal(events, over) as never, book, now: OPENED + now })

describe('approve', () => {
  it('count 1, no approval: pending, and says what is missing', () => {
    const e = run(APPROVE())
    expect(e.state).toBe('pending')
    expect(e.missing).toBe('needs 1 more approval from a maintainer other than the author')
    expect(e.tally).toMatchObject({ for: [], needed: 1 })
  })
  it('count 1, one approval from a decider: met', () => {
    const e = run(APPROVE(), [approve('bruno')])
    expect(e.state).toBe('met')
    expect(e.tally.for).toEqual(['bruno'])
  })
  it('count 2: one approval waits, the second meets it; the plural is right', () => {
    expect(run(APPROVE(2)).missing).toBe('needs 2 more approvals from a maintainer other than the author')
    const one = run(APPROVE(2), [approve('bruno')])
    expect(one.state).toBe('pending')
    expect(one.missing).toBe('needs 1 more approval from a maintainer other than the author')
    expect(run(APPROVE(2), [approve('bruno'), approve('carla', 2 * H)], 3 * H).state).toBe('met')
  })
  it('one person approving twice counts once', () => {
    expect(run(APPROVE(2), [approve('bruno'), approve('bruno', 2 * H)], 3 * H).state).toBe('pending')
  })
  it('an approval from someone who does not decide, or an agent, is not counted', () => {
    expect(run(APPROVE(), [approve('dora', H, {}), approve('crew-engineer', 2 * H)], 3 * H).state).toBe('pending')
  })
  it('the author’s approval is ignored (four eyes, P2-R2)', () => {
    const e = run(APPROVE(), [approve('ana')], 2 * H, { author: 'ana' })
    expect(e.state).toBe('pending')
    expect(e.tally.for).toEqual([])
  })
  it('an objection by a decider holds it open, naming the role and the way out', () => {
    const e = run(APPROVE(), [approve('bruno'), object('carla', 2 * H)], 3 * H)
    expect(e.state).toBe('pending')
    expect(e.missing).toBe('held open by an objection from a maintainer: answer it with a revision, or ask them to withdraw it')
    expect(e.tally.objecting).toEqual(['carla'])
  })
  it('an objection by someone who does not decide is a comment: it blocks nothing', () => {
    expect(run(APPROVE(), [approve('bruno'), object('dora', 2 * H)], 3 * H).state).toBe('met')
  })
  it('retracting the objection releases it; retracting the approval takes it away', () => {
    const o = object('carla', 2 * H)
    const released = [approve('bruno'), o, ev('retract', 'carla', 3 * H, { of: o.id })]
    expect(run(APPROVE(), released, 4 * H).state).toBe('met')
    const a = approve('bruno')
    expect(run(APPROVE(), [a, ev('retract', 'bruno', 2 * H, { of: a.id })], 3 * H).state).toBe('pending')
  })
  it('a revision clears approvals (they carry the old rev) and answers an objection', () => {
    const revised = [approve('bruno', H, { rev: OLD }), object('carla', 2 * H, { rev: OLD })]
    const e = run(APPROVE(), revised, 4 * H)
    expect(e.state).toBe('pending')
    expect(e.missing).toBe('needs 1 more approval from a maintainer other than the author') // the old objection no longer holds
    expect(run(APPROVE(), [...revised, approve('carla', 3 * H)], 4 * H).state).toBe('met')
  })
  it('an approval for another rev counts for nothing', () => {
    expect(run(APPROVE(), [approve('bruno', H, { rev: 'ffffffffffff' })]).state).toBe('pending')
  })
  it('a role changed after opening: an approver who left `by` no longer counts', () => {
    const left = resolveRoles({ roles: { maintainer: { members: ['ana', 'carla'] } } }, MEMBERS)
    const e = evaluate({ rule: APPROVE() as never, proposal: proposal([approve('bruno')]) as never, book: left, now: 2 * H + OPENED })
    expect(e.state).toBe('pending')
  })
  it('an unmeetable `count`: pending, blocked, in words (spec §3.6 pinned case)', () => {
    expect(run(APPROVE(2), [], 2 * H, { author: 'ana' }).blocked).toBeUndefined() // three deciders minus the author: two eligible, meetable
    const two = resolveRoles({ roles: { maintainer: { members: ['ana', 'bruno'] } } }, MEMBERS)
    const u = evaluate({ rule: APPROVE(2) as never, proposal: proposal([], { author: 'ana' }) as never, book: two, now: OPENED + 2 * H })
    expect(u.state).toBe('pending')
    expect(u.blocked).toBe('unmeetable')
    expect(u.missing).toBe('cannot be met: only 1 maintainer other than the author, and the rule asks for 2. Withdraw it, or change the rule')
    const none = resolveRoles({ roles: { maintainer: { members: ['ana'] } } }, MEMBERS)
    const z = evaluate({ rule: APPROVE(1) as never, proposal: proposal([], { author: 'ana' }) as never, book: none, now: OPENED + 2 * H })
    expect(z.blocked).toBe('unmeetable')
    expect(z.missing).toContain('only 0 maintainers other than the author, and the rule asks for 1')
  })
})

describe('self_approve (M-4)', () => {
  const solo = resolveRoles({ roles: { maintainer: { members: ['ana'] } } }, MEMBERS)
  const alone = (r: unknown, events: unknown[]) =>
    evaluate({ rule: r as never, proposal: proposal(events, { author: 'ana' }) as never, book: solo, now: OPENED + 2 * H })
  it('true: the author’s own approval counts (count 1, the author the only decider)', () => {
    const e = alone(APPROVE(1, { self_approve: true }), [approve('ana')])
    expect(e.state).toBe('met')
    expect(e.tally.for).toEqual(['ana'])
  })
  it('false or absent: it does not, and the rule can never be met', () => {
    const e = alone(APPROVE(1), [approve('ana')])
    expect(e.state).toBe('pending')
    expect(e.blocked).toBe('unmeetable')
  })
  it('true, not yet approved: the sentence does not say "other than the author"', () => {
    expect(alone(APPROVE(1, { self_approve: true }), []).missing).toBe('needs 1 more approval from a maintainer')
  })
  it('with two rules, one setting it: the author’s approval counts toward that rule and not the other', () => {
    const A = APPROVE(1, { id: 'a', self_approve: true })
    const B = APPROVE(1, { id: 'b' })
    const p = proposal([approve('bruno')], { author: 'bruno', rules: [A, B] })
    const all = evaluateAll({ proposal: p as never, book, now: OPENED + 2 * H })
    expect(all.parts.map(x => [x.rule.id, x.evaluation.state])).toEqual([['a', 'met'], ['b', 'pending']])
    expect(all.state).toBe('pending')
    expect(all.parts[1]!.evaluation.missing).toContain('other than the author')
    expect(all.parts[0]!.evaluation.tally.for).toEqual(['bruno'])
  })
  it('a snapshot holding self_approve and expires passes checkProposals (the test Task 1 leaves here)', () => {
    const entry = { id: 'p-2026-10-18-001', title: 'x', author: 'dora', classes: ['records'], state: 'open', opened: t(0), rev: REV, ops: OPS,
      events: [], closed: null, rules: [{ id: 'records', applies_to: ['records'], propose: 'member', self_approve: true, expires: 'P14D', decide: { by: 'maintainer', method: 'approve', count: 1 } }] }
    const found = checkProposals([entry] as never, { members: MEMBERS, governance: GOVERNANCE, systems: null, classes: CHANGE_CLASSES, classOf: r => classOf({ registry: r }) })
    expect(found).toEqual([])
  })
})

describe('consent', () => {
  const WINDOW = 7 * D
  it('one second before the window ends: pending, and says when it closes', () => {
    const e = run(CONSENT, [], WINDOW - 1000)
    expect(e.state).toBe('pending')
    expect(e.missing).toBe('the objection window closes in less than a minute')
    expect(e.closesAt).toBe(t(WINDOW))
  })
  it('exactly at the end: met (the boundary is inclusive)', () => {
    expect(run(CONSENT, [], WINDOW).state).toBe('met')
  })
  it('after the end: met; closesAt is null once decided', () => {
    const e = run(CONSENT, [], WINDOW + H)
    expect(e.state).toBe('met')
    expect(e.closesAt).toBeNull()
  })
  it('says the time left in the largest units', () => {
    expect(run(CONSENT, [], 4 * D + 21 * H).missing).toBe('the objection window closes in 2 days 3 hours')
    expect(run(CONSENT, [], 6 * D + 23 * H + 30 * 60e3).missing).toBe('the objection window closes in 30 minutes')
    expect(run(CONSENT, [], 6 * D).missing).toBe('the objection window closes in 1 day')
  })
  it('an objection from a decider holds it open, also after the window', () => {
    const e = run(CONSENT, [object('bruno', D)], WINDOW + D)
    expect(e.state).toBe('pending')
    expect(e.missing).toContain('held open by an objection from a maintainer')
  })
  it('an objection from someone who does not decide is a comment', () => {
    expect(run(CONSENT, [object('dora', D)], WINDOW + D).state).toBe('met')
  })
  it('a revision restarts the window', () => {
    const revise = ev('revise', 'dora', 3 * D)
    expect(run(CONSENT, [revise], 7 * D).state).toBe('pending')
    expect(run(CONSENT, [revise], 7 * D).missing).toBe('the objection window closes in 3 days')
    expect(run(CONSENT, [revise], 10 * D).state).toBe('met')
  })
  it('approvals mean nothing under consent', () => {
    expect(run(CONSENT, [approve('bruno')], D).state).toBe('pending')
  })
})

describe('vote', () => {
  const WINDOW = 3 * D
  it('before the window ends and before everyone voted: pending, with the count', () => {
    const e = run(VOTE(), [vote('ana', 'yes'), vote('bruno', 'yes', 2 * H)], D)
    expect(e.state).toBe('pending')
    expect(e.missing).toBe('voting closes in 2 days; 2 of 3 have voted, quorum is 2')
    expect(e.closesAt).toBe(t(WINDOW))
  })
  it('a vote that has not closed is pending even when the count already settles it', () => {
    expect(run(VOTE(), [vote('ana', 'yes'), vote('bruno', 'yes', 2 * H)], D).state).toBe('pending')
  })
  it('every decider voted: closed early, decided', () => {
    const e = run(VOTE(), [vote('ana', 'yes'), vote('bruno', 'yes', 2 * H), vote('carla', 'no', 3 * H)], D)
    expect(e.state).toBe('met')
    expect(e.closesAt).toBeNull()
    expect(e.tally).toMatchObject({ for: ['ana', 'bruno'], against: ['carla'], abstain: [] })
  })
  it('after the window: quorum counts abstentions, the share does not', () => {
    // 1 yes + 1 abstain: quorum 2 reached, share 1/1
    expect(run(VOTE(), [vote('ana', 'yes'), vote('bruno', 'abstain', 2 * H)], WINDOW + H).state).toBe('met')
    // 1 yes, 1 no, 1 abstain at threshold 0.5: share 1/2, met; if abstentions were in the denominator it would be 1/3
    expect(run(VOTE(), [vote('ana', 'yes'), vote('bruno', 'no', 2 * H), vote('carla', 'abstain', 3 * H)], WINDOW + H).state).toBe('met')
    // 1 yes and 2 abstentions: share 1/1
    expect(run(VOTE(), [vote('ana', 'yes'), vote('bruno', 'abstain', 2 * H), vote('carla', 'abstain', 3 * H)], WINDOW + H).state).toBe('met')
  })
  it('threshold: exactly at the boundary meets, just under fails', () => {
    const half = [vote('ana', 'yes'), vote('bruno', 'no', 2 * H)]
    expect(run(VOTE({ threshold: 0.5 }), half, WINDOW + H).state).toBe('met')
    expect(run(VOTE({ threshold: 0.51 }), half, WINDOW + H).state).toBe('failed')
    const two3 = [vote('ana', 'yes'), vote('bruno', 'yes', 2 * H), vote('carla', 'no', 3 * H)]
    expect(run(VOTE({ threshold: 0.66 }), two3, WINDOW + H).state).toBe('met')
    expect(run(VOTE({ threshold: 0.67 }), two3, WINDOW + H).state).toBe('failed')
  })
  it('every ballot an abstention, quorum reached: failed, "nobody voted for or against" (M7)', () => {
    const e = run(VOTE(), [vote('ana', 'abstain'), vote('bruno', 'abstain', 2 * H)], WINDOW + H)
    expect(e.state).toBe('failed')
    expect(e.missing).toBe('nobody voted for or against')
  })
  it('quorum unmet when the window ends: expired, not failed (P2-R10)', () => {
    const e = run(VOTE(), [vote('ana', 'yes')], WINDOW + H)
    expect(e.state).toBe('expired')
    expect(e.missing).toBe('the vote closed without a quorum: 1 of the 2 needed voted')
  })
  it('the latest vote per member wins', () => {
    const e = run(VOTE(), [vote('ana', 'no'), vote('ana', 'yes', 2 * H), vote('bruno', 'yes', 3 * H)], WINDOW + H)
    expect(e.state).toBe('met')
    expect(e.tally.against).toEqual([])
  })
  it('a vote for an old rev is ignored', () => {
    expect(run(VOTE(), [vote('ana', 'yes', H, { rev: OLD }), vote('bruno', 'yes', 2 * H)], WINDOW + H).state).toBe('expired')
  })
  it('a vote at the window’s end is not counted (M7): the boundary is the end, exclusive', () => {
    const e = run(VOTE(), [vote('ana', 'yes', WINDOW - H), vote('bruno', 'yes', WINDOW)], WINDOW + H)
    expect(e.state).toBe('expired') // only one ballot counted: below quorum 2
    expect(e.tally.for).toEqual(['ana'])
  })
  it('a vote written after every decider voted is not counted: the outcome cannot flip once closed (M7)', () => {
    const settled = [vote('ana', 'yes'), vote('bruno', 'yes', 2 * H), vote('carla', 'yes', 3 * H)]
    const flip = [...settled, vote('carla', 'no', 4 * H), vote('bruno', 'no', 5 * H)]
    const e = run(VOTE({ threshold: 0.9 }), flip, 6 * H)
    expect(e.state).toBe('met')
    expect(e.tally.against).toEqual([])
  })
  it('a non-decider’s vote is not counted', () => {
    expect(run(VOTE(), [vote('dora', 'yes'), vote('ana', 'yes', 2 * H)], WINDOW + H).state).toBe('expired')
  })
  it('refuses a vote of "maybe" with a sentence, never met', () => {
    expect(() => run(VOTE(), [vote('ana', 'maybe')], WINDOW + H)).toThrow(/vote of "maybe"/)
  })
})

describe('system', () => {
  const SYS = { id: 'treasury', applies_to: ['treasury'], propose: 'maintainer', decide: { by: 'system', system: 'treasury-safe' } }
  const attach = ev('attach', 'ana', H, { ref: { system: 'treasury-safe', id: '0xabc', payload: {} } })
  const sys = (outcome: string, atMs: number, extra = {}) => ev('system', 'system:treasury-safe', atMs, { outcome, ref: { system: 'treasury-safe', id: '0xabc' }, ...extra })
  it('no attach: waiting, and says what to do', () => {
    expect(run(SYS).missing).toBe('waiting for the system treasury-safe: no transaction attached yet')
  })
  it('attached, nothing read yet', () => {
    expect(run(SYS, [attach], 2 * H).missing).toBe('waiting for the system treasury-safe: transaction 0xabc is attached and not executed yet')
  })
  it('a pending reading says the signatures', () => {
    const e = run(SYS, [attach, sys('pending', 2 * H, { confirmations: 1, required: 2 })], 3 * H)
    expect(e.state).toBe('pending')
    expect(e.missing).toBe('transaction 0xabc: 1 of 2 signatures')
  })
  it('executed: met; failed: failed; the latest reading wins', () => {
    expect(run(SYS, [attach, sys('executed', 2 * H)], 3 * H).state).toBe('met')
    expect(run(SYS, [attach, sys('failed', 2 * H)], 3 * H).state).toBe('failed')
    expect(run(SYS, [attach, sys('executed', 2 * H), sys('failed', 3 * H)], 4 * H).state).toBe('failed')
  })
  it('a mismatch is pending, in words', () => {
    const e = run(SYS, [attach, sys('mismatch', 2 * H)], 3 * H)
    expect(e.state).toBe('pending')
    expect(e.missing).toBe('this transaction is not the one the proposal prepared')
  })
  // Final review D156: the reading is the current rev's, as currentAttach reads the attach: an executed reading of an old
  // rev's transaction does not meet a revised proposal.
  it('an attach and an executed reading of an old rev do not count for the current rev', () => {
    const old = { rev: 'aaaaaaaaaaaa' }
    const e = run(SYS, [ev('attach', 'ana', H, { ...old, ref: { system: 'treasury-safe', id: '0xold', payload: {} } }), sys('executed', 2 * H, old)], 3 * H)
    expect(e.state).toBe('pending')
    expect(e.missing).toBe('waiting for the system treasury-safe: no transaction attached yet')
    // the current rev's own attach and reading still decide
    expect(run(SYS, [ev('attach', 'ana', H, { ...old, ref: { system: 'treasury-safe', id: '0xold', payload: {} } }), sys('executed', 2 * H, old), attach, sys('pending', 3 * H)], 4 * H).missing)
      .toBe('transaction 0xabc is attached and not executed yet')
    expect(run(SYS, [sys('failed', 2 * H, old), attach, sys('executed', 3 * H)], 4 * H).state).toBe('met')
  })
  it('"by: system" with no method is method system (as `normalise` reads it)', () => {
    expect(run({ ...SYS }, [attach, sys('executed', 2 * H)], 3 * H).state).toBe('met')
  })
})

describe('direct (P2-R4): approve with count 1', () => {
  const DIRECT = rule({ method: 'direct' })
  it('any one decider’s approval is the decision', () => {
    expect(run(DIRECT).state).toBe('pending')
    expect(run(DIRECT, [approve('carla')]).state).toBe('met')
  })
  it('the author’s own approval does not count either', () => {
    expect(run(DIRECT, [approve('ana')], 2 * H, { author: 'ana' }).state).toBe('pending')
  })
})

describe('time to live (P2-R11, M7)', () => {
  const EXPIRY = 30 * D
  it('P30D by default: pending before, expired at, and says when it ends', () => {
    const before = run(APPROVE(), [], EXPIRY - 1000)
    expect(before.state).toBe('pending')
    expect(before.closesAt).toBe(t(EXPIRY))
    expect(run(APPROVE(), [], EXPIRY).state).toBe('expired')
  })
  it('a rule may say expires: P14D', () => {
    expect(run(APPROVE(1, { expires: 'P14D' }), [], 14 * D - 1000).state).toBe('pending')
    expect(run(APPROVE(1, { expires: 'P14D' }), [], 14 * D).state).toBe('expired')
  })
  it('the clock starts at the latest revision', () => {
    const revise = ev('revise', 'dora', 10 * D)
    expect(run(APPROVE(1, { expires: 'P14D' }), [revise], 20 * D).state).toBe('pending')
    expect(run(APPROVE(1, { expires: 'P14D' }), [revise], 24 * D).state).toBe('expired')
  })
  it('met before the expiry stays met after it (expiry must not revoke a decision reached in time)', () => {
    const r = APPROVE(1, { expires: 'P14D' })
    expect(run(r, [approve('bruno', 14 * D - 1000)], 20 * D).state).toBe('met')
  })
  it('an event at or after the expiry instant is ignored: it neither rescues nor blocks', () => {
    const r = APPROVE(1, { expires: 'P14D' })
    expect(run(r, [approve('bruno', 14 * D)], 15 * D).state).toBe('expired') // too late to rescue
    expect(run(r, [approve('bruno', 10 * D), object('carla', 15 * D)], 20 * D).state).toBe('met') // too late to block
  })
  it('expires applies to consent and vote as well, ending them early', () => {
    expect(run(rule({ method: 'consent', window: 'P7D' }, { expires: 'P3D' }), [], 4 * D).state).toBe('expired')
  })
})

describe('evaluateAll (P2-R1: every rule must be met)', () => {
  const A = APPROVE(1, { id: 'a' })
  const B = rule({ method: 'consent', window: 'P1D' }, { id: 'b' })
  const all = (rules: unknown[], events: unknown[], now: number, over = {}) =>
    evaluateAll({ proposal: proposal(events, { rules, ...over }) as never, book, now: OPENED + now })
  it('all met: met, closesAt null', () => {
    const r = all([A, B], [approve('bruno')], 2 * D)
    expect(r.state).toBe('met')
    expect(r.closesAt).toBeNull()
  })
  it('one pending: pending, and the sentence names the rule that holds', () => {
    const r = all([A, B], [approve('bruno')], 12 * H)
    expect(r.state).toBe('pending')
    expect(r.missing).toBe('rule "b": the objection window closes in 12 hours')
    expect(r.closesAt).toBe(t(D))
  })
  it('one event is counted in every rule where the actor decides', () => {
    const C = APPROVE(1, { id: 'c' })
    const r = all([A, C], [approve('bruno')], 2 * H)
    expect(r.state).toBe('met')
    expect(r.parts.map(p => p.evaluation.tally.for)).toEqual([['bruno'], ['bruno']])
  })
  it('one failed: failed; one expired: expired; failed wins over expired', () => {
    const V = VOTE({}) as object
    const failing = [vote('ana', 'no'), vote('bruno', 'no', 2 * H), vote('carla', 'no', 3 * H)]
    expect(all([A, { ...V, id: 'v' }], failing, 4 * H).state).toBe('failed')
    expect(all([A, { ...(APPROVE(1, { expires: 'P1D' }) as object), id: 'x' }], [], 2 * D).state).toBe('expired')
    expect(all([{ ...(APPROVE(1, { expires: 'P1D' }) as object), id: 'x' }, { ...V, id: 'v' }], failing, 2 * D).state).toBe('failed')
  })
  it('pending with one unmeetable rule is blocked', () => {
    const two = resolveRoles({ roles: { maintainer: { members: ['ana', 'bruno'] } } }, MEMBERS)
    const r = evaluateAll({ proposal: proposal([], { author: 'ana', rules: [APPROVE(2, { id: 'a' })] }) as never, book: two, now: OPENED + H })
    expect(r.state).toBe('pending')
    expect(r.blocked).toBe('unmeetable')
  })
  it('a snapshot with no rule is refused with a sentence', () => {
    expect(() => all([], [], H)).toThrow(/no rules/)
  })
})

describe('inputs that must fail (never `met` by accident)', () => {
  it('an unknown method throws a sentence', () => {
    expect(() => run(rule({ method: 'shout' }))).toThrow(/method "shout"/)
    expect(() => run({ id: 'r', applies_to: ['records'], decide: { by: 'maintainer' } })).toThrow(/names no method/)
  })
  it('no clock, no answer: the function never reads the time itself', () => {
    expect(() => evaluate({ rule: APPROVE() as never, proposal: proposal() as never, book, now: undefined as never })).toThrow(/now/)
  })
  it('accepts a Date or a number of milliseconds as the clock', () => {
    expect(evaluate({ rule: CONSENT as never, proposal: proposal() as never, book, now: new Date(OPENED + 7 * D) }).state).toBe('met')
    expect(evaluate({ rule: CONSENT as never, proposal: proposal() as never, book, now: OPENED + 7 * D }).state).toBe('met')
  })
})

// Review MEDIUM-B: a window that ends at or after the expiry used to go pending, then expired, then met.
describe('a window that outlasts the expiry (spec §3.6: an expired proposal does not become decidable again)', () => {
  const TOO_LONG = [
    ['consent', rule({ method: 'consent', window: 'P14D' }, { expires: 'P7D' })],
    ['vote', rule({ method: 'vote', window: 'P14D', quorum: 2, threshold: 0.5 }, { expires: 'P7D' })],
  ] as const
  it.each(TOO_LONG)('%s: pending before the expiry, expired at it and after it, never met', (_m, r) => {
    const before = run(r, [], 4 * D)
    expect(before.state).toBe('pending')
    expect(before.closesAt).toBe(t(7 * D))
    for (const at of [7 * D, 8 * D, 16 * D, 40 * D]) expect(run(r, [], at).state, `at ${at / D} days`).toBe('expired')
  })
  it('consent says so in words while it waits: the window cannot close before the expiry', () => {
    const e = run(TOO_LONG[0][1], [], 4 * D)
    expect(e.blocked).toBe('unmeetable')
    expect(e.missing).toMatch(/objection window.*ends after the proposal expires/)
  })
  it('a window that ends exactly at the expiry is still too long', () => {
    expect(run(rule({ method: 'consent', window: 'P7D' }, { expires: 'P7D' }), [], 7 * D).state).toBe('expired')
  })
  it('a vote with its quorum but not the whole electorate is expired at the expiry, not met when the window ends', () => {
    const r = TOO_LONG[1][1]
    const ballots = [vote('ana', 'yes', D), vote('bruno', 'yes', 2 * D)]
    expect(run(r, ballots, 4 * D).state).toBe('pending')
    for (const at of [8 * D, 15 * D, 40 * D]) expect(run(r, ballots, at).state, `at ${at / D} days`).toBe('expired')
  })
  it('a vote the whole electorate finished in time stays met past the expiry', () => {
    const r = TOO_LONG[1][1]
    const ballots = [vote('ana', 'yes', D), vote('bruno', 'yes', 2 * D), vote('carla', 'no', 3 * D)]
    for (const at of [4 * D, 8 * D, 16 * D]) expect(run(r, ballots, at).state, `at ${at / D} days`).toBe('met')
  })
  it('a vote whose window outlasts the expiry says the proposal expires first', () => {
    expect(run(TOO_LONG[1][1], [vote('ana', 'yes', D)], 4 * D).missing).toMatch(/expires in 3 days/)
  })
  it('a window shorter than the expiry is unchanged', () => {
    expect(run(rule({ method: 'consent', window: 'P7D' }, { expires: 'P14D' }), [], 8 * D).state).toBe('met')
  })
})
