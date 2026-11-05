import { describe, it, expect } from 'vitest'
import type { ProposalView } from '../../api.ts'
import { proposalView, proposalViews, RESULTS } from '../../test/fixtures/proposals.ts'
import { ACTOR, ADD_SIGNER, PAY_KIT, PREPARED_IN, PREPARED_RETURN, RECORDS_RATIFIED, RETURN_DECIDED } from '../../test/fixtures/house/governance.ts'
import type { PreparedView } from './prepared.ts'
import { compactPhrase, timelineOf, type Step } from './timeline.ts'

const NEVER_HERE = 'signers sign in the Safe app, never here'
const GNOSIS = 'eip155:100'
const byId = (steps: Step[]) => Object.fromEntries(steps.map(s => [s.id, s])) as Record<Step['id'], Step>
const states = (steps: Step[]) => steps.map(s => s.state)
/** A step's line as text: a string, or the text of the nodes it holds. */
function text(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  return text((node as { props?: { children?: unknown } }).props?.children)
}
/** A treasury proposal from the 0.6 fixtures, approving: one of two approvals in (ana's). */
const approving = proposalView({ id: 'p-2026-10-16-009', classes: ['treasury'] })
const onGnosis = (tx: PreparedView, over: Partial<PreparedView> = {}): PreparedView => ({ ...tx, safe: { ...tx.safe, chain: GNOSIS }, nonce: 7, ...over })

describe('timelineOf (§9.5, CC-10)', () => {
  it('an approving proposal: proposed done, approvals current with the meter, the rest waiting', () => {
    const steps = timelineOf(approving, [], null)
    expect(steps.map(s => s.id)).toEqual(['proposed', 'approvals', 'decided', 'prepared', 'signed', 'read-back'])
    expect(states(steps)).toEqual(['done', 'current', 'waiting', 'waiting', 'waiting', 'waiting'])
    const s = byId(steps)
    expect(s.approvals.title).toBe('Maintainer approvals')
    expect(s.approvals.meter).toEqual({ done: 1, of: 2, words: '1 of 2 approved' })
    expect(text(s.proposed.line)).toBe('16 Oct 2026 · carla')
  })

  it('your approval makes approvals `yours`: the moss segment and "you approved"', () => {
    const s = byId(timelineOf(ADD_SIGNER, [], ACTOR))
    expect(s.approvals.state).toBe('yours')
    expect(s.approvals.meter).toEqual({ done: 2, of: 4, yours: 1, words: '2 of 4 · you approved' })
    // another member sees the step current, with no segment of theirs
    expect(byId(timelineOf(ADD_SIGNER, [], 'steward-b')).approvals.state).toBe('current')
  })

  it('a ratified records-only proposal: prepared is `not-needed` with "No transaction needed — this decision changes records only"', () => {
    const ratified = proposalViews.find(v => v.state === 'ratified')!
    expect(ratified.classes).toEqual(['records'])
    const steps = timelineOf(ratified, [], null)
    const s = byId(steps)
    expect(s.prepared.state).toBe('not-needed')
    expect(`${s.prepared.title} — ${text(s.prepared.line)}`).toBe('No transaction needed — This decision changes records only')
    expect(states(steps)).toEqual(['done', 'done', 'done', 'not-needed', 'not-needed', 'not-needed'])
    expect(compactPhrase(steps)).toBe('Decided')
  })

  it('records only, while still open: prepared is not needed already', () => {
    expect(byId(timelineOf(proposalView({ id: 'p-2026-10-16-010' }), [], null)).prepared.state).toBe('not-needed')
  })

  it('Decided is done when every rule a person decides is met, though the Safe rule waits (CC-10)', () => {
    expect(RETURN_DECIDED.state).toBe('open')
    const s = byId(timelineOf(RETURN_DECIDED, [PREPARED_RETURN], ACTOR))
    expect(s.approvals.state).toBe('done')
    expect(s.approvals.meter).toEqual({ done: 4, of: 4, yours: 1, words: '4 of 4 · you approved' })
    expect(s.decided.state).toBe('done')
    expect(text(s.decided.line)).toBe('16 Oct 2026 · rule met')
    expect(s.prepared.state).toBe('done')
    expect(text(s.prepared.line)).toBe('Nonce 18 on Celo')
    expect(s.signed.state).toBe('current')
    expect(s['read-back'].state).toBe('waiting')
    expect(text(s['read-back'].line)).toBe('The Hub watches Celo for the result')
  })

  it('a ratified proposal names its decision in its Decided line', () => {
    const line = byId(timelineOf(RECORDS_RATIFIED, [], ACTOR)).decided.line
    expect(text(line)).toBe('15 Oct 2026 · rule met · gov-20261015-001')
  })

  it('a proposal a system decides alone needs no approvals: Decided waits on nothing a person does', () => {
    const s = byId(timelineOf(PAY_KIT, [PREPARED_RETURN], null))
    expect(s.approvals.state).toBe('not-needed')
    expect(s.decided.state).toBe('done')
  })

  it("the signed step's line always contains \"signers sign in the Safe app, never here\"", () => {
    const cases: [ProposalView, PreparedView[]][] = [
      [approving, []], [RETURN_DECIDED, [PREPARED_RETURN]], [RETURN_DECIDED, [PREPARED_IN.executed!]], [RETURN_DECIDED, [PREPARED_IN.replaced!]],
      [RECORDS_RATIFIED, []], [RETURN_DECIDED, [PREPARED_RETURN, onGnosis(PREPARED_RETURN)]],
    ]
    for (const [view, prepared] of cases) expect(text(byId(timelineOf(view, prepared, null)).signed.line)).toContain(NEVER_HERE)
  })

  it('signing on one chain: the meter, "2 of 4"; ready and executed: signed done', () => {
    const signing = byId(timelineOf(RETURN_DECIDED, [PREPARED_RETURN], null)).signed
    expect(signing.meter).toEqual({ done: 2, of: 4, words: '2 of 4' })
    expect(byId(timelineOf(RETURN_DECIDED, [PREPARED_IN.ready!], null)).signed.state).toBe('done')
    expect(byId(timelineOf(RETURN_DECIDED, [PREPARED_IN.ready!], null))['read-back'].state).toBe('current')
    const executed = byId(timelineOf(RETURN_DECIDED, [PREPARED_IN.executed!], null))
    expect(executed.signed.state).toBe('done')
    expect(executed['read-back'].state).toBe('done')
    expect(text(executed['read-back'].line)).toBe('Executed on Celo · matched what was prepared')
  })

  it('a replaced nonce: read-back `failed` with "Read back: replaced — nonce 18 was used by another transaction. Prepare again."', () => {
    const steps = timelineOf(RETURN_DECIDED, [PREPARED_IN.replaced!], null)
    const s = byId(steps)
    expect(s['read-back'].state).toBe('failed')
    expect(`${s['read-back'].title} — ${text(s['read-back'].line)}`).toBe('Read back: replaced — Nonce 18 was used by another transaction. Prepare again.')
    // nothing is left to sign on a used nonce: the step waits, not current
    expect(s.signed.state).toBe('waiting')
    expect(compactPhrase(steps)).toBe('Read back: replaced')
  })

  it('a failed execution and a mismatch fail the read back, each in its words; stale fails Prepared', () => {
    const failed = byId(timelineOf(RETURN_DECIDED, [PREPARED_IN['executed-failed']!], null))['read-back']
    expect([failed.state, failed.title, text(failed.line)]).toEqual(['failed', 'Read back: the transaction failed',
      'Executed on Celo, and the transaction failed. Nothing it would have moved has moved.'])
    const mismatch = byId(timelineOf(RETURN_DECIDED, [PREPARED_IN.mismatch!], null))['read-back']
    expect([mismatch.state, mismatch.title, text(mismatch.line)]).toEqual(['failed', 'Read back: not what was prepared',
      'Not the transaction the proposal prepared: its data differs.'])
    const stale = byId(timelineOf(RETURN_DECIDED, [PREPARED_IN.stale!], null))
    expect([stale.prepared.state, text(stale.prepared.line)]).toEqual(['failed', 'The proposal changed after this was prepared. Prepare again.'])
    expect(stale.signed.state).toBe('waiting')
  })

  it('a stale or preparing transaction has nothing to read back yet: Read back promises no watch (B4 review M-1)', () => {
    for (const tx of [PREPARED_IN.stale!, PREPARED_IN.preparing!]) {
      const read = byId(timelineOf(RETURN_DECIDED, [tx], null))['read-back']
      expect([read.state, text(read.line)], tx.state).toEqual(['waiting', 'Nothing to read back yet'])
    }
    // one chain stale beside another signing: nothing on any chain is read back until it is prepared again
    expect(text(byId(timelineOf(RETURN_DECIDED, [PREPARED_RETURN, onGnosis(PREPARED_IN.stale!)], null))['read-back'].line)).toBe('Nothing to read back yet')
  })

  it('a failed read keeps the last state (B5-7) and says so on the read back', () => {
    const s = byId(timelineOf(RETURN_DECIDED, [PREPARED_IN['read-failed']!], null))
    expect(s.signed.state).toBe('current')
    expect(s.signed.meter).toEqual({ done: 2, of: 4, words: '2 of 4' })
    expect(text(s['read-back'].line)).toBe('Couldn’t read the Safe; the last reading stands')
  })

  it('several chains (L2-C3): executed only when every one is, failed if any is, else current naming the chains still waiting', () => {
    const exec = PREPARED_IN.executed!
    const both = byId(timelineOf(RETURN_DECIDED, [exec, onGnosis(exec)], null))
    expect([both.signed.state, both['read-back'].state]).toEqual(['done', 'done'])
    expect(text(both['read-back'].line)).toBe('Executed on Celo, Gnosis · matched what was prepared')

    const one = byId(timelineOf(RETURN_DECIDED, [exec, onGnosis(PREPARED_RETURN)], null))
    expect(one.signed.state).toBe('current')
    expect(one.signed.meter).toBeUndefined()
    expect(text(one.signed.line)).toBe(`Waiting on Gnosis · ${NEVER_HERE}`)
    expect(one['read-back'].state).toBe('waiting')
    expect(text(one['read-back'].line)).toBe('The Hub watches Gnosis for the result')

    const signedBoth = byId(timelineOf(RETURN_DECIDED, [exec, onGnosis(PREPARED_IN.ready!)], null))
    expect(signedBoth.signed.state).toBe('done')
    expect(signedBoth['read-back'].state).toBe('current')
    expect(text(signedBoth['read-back'].line)).toBe('The Hub watches Gnosis for the result')

    const bad = byId(timelineOf(RETURN_DECIDED, [exec, onGnosis(PREPARED_IN.replaced!)], null))['read-back']
    expect([bad.state, bad.title, text(bad.line)]).toEqual(['failed', 'Read back: replaced', 'On Gnosis: Nonce 7 was used by another transaction. Prepare again.'])
    expect(text(byId(timelineOf(RETURN_DECIDED, [PREPARED_RETURN, onGnosis(PREPARED_RETURN)], null)).prepared.line)).toBe('Nonce 18 on Celo · nonce 7 on Gnosis')
  })

  it('a treasury proposal with nothing prepared yet: Prepared waits, then is current once decided', () => {
    expect(byId(timelineOf(approving, [], null)).prepared.state).toBe('waiting')
    const decided = { ...RETURN_DECIDED, events: (RETURN_DECIDED.events as unknown[]).slice(0, 7) } as ProposalView
    const s = byId(timelineOf(decided, [], null))
    expect([s.prepared.state, text(s.prepared.line)]).toEqual(['current', 'Waiting to be prepared'])
    expect(byId(timelineOf(decided, [PREPARED_IN.preparing!], null)).prepared.state).toBe('current')
  })

  it('a closed proposal that was not decided fails at its approvals, in the word for how it closed', () => {
    const rejected = byId(timelineOf(proposalViews.find(v => v.state === 'rejected')!, [], null))
    expect([rejected.approvals.state, rejected.approvals.title]).toEqual(['failed', 'Rejected'])
    expect(text(rejected.approvals.line)).toBe(RESULTS.failed.missing)
    expect(rejected.decided.state).toBe('waiting')
    const withdrawn = timelineOf(proposalViews.find(v => v.state === 'withdrawn')!, [], null)
    expect(compactPhrase(withdrawn)).toBe('Withdrawn')
  })

  it('a treasury proposal closed without approval needs nothing after it: no step promises a transaction (B4 review M-2)', () => {
    for (const state of ['rejected', 'withdrawn', 'expired']) {
      const closed = { ...proposalViews.find(v => v.state === state)!, classes: ['treasury'] } as ProposalView
      for (const prepared of [[], [PREPARED_RETURN]]) {
        const s = byId(timelineOf(closed, prepared, null))
        expect([s.prepared.state, s.signed.state, s['read-back'].state], state).toEqual(['not-needed', 'not-needed', 'not-needed'])
        expect(s.prepared.line, state).toBeUndefined()
        expect(s['read-back'].line, state).toBeUndefined()
        // the signed step still says where signers sign (§9.5)
        expect(text(s.signed.line)).toBe(NEVER_HERE)
      }
    }
  })
})

describe('compactPhrase', () => {
  it('"Signing · 2 of 4": the step under way and its count', () => {
    expect(compactPhrase(timelineOf(RETURN_DECIDED, [PREPARED_RETURN], ACTOR))).toBe('Signing · 2 of 4')
  })
  it('approving, your step included; done once read back', () => {
    expect(compactPhrase(timelineOf(approving, [], null))).toBe('Approving · 1 of 2')
    expect(compactPhrase(timelineOf(ADD_SIGNER, [], ACTOR))).toBe('Approving · 2 of 4')
    expect(compactPhrase(timelineOf(RETURN_DECIDED, [PREPARED_IN.executed!], null))).toBe('Done')
    expect(compactPhrase(timelineOf(RETURN_DECIDED, [PREPARED_IN.ready!], null))).toBe('Reading back')
  })
})
