import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decisionRowFor } from '../../lib/decision-row.mjs'

// The row of a decided proposal, from the proposal and the evaluation that decided it. The root validator imports this
// module (Task 14a), so it may import no `node:*` module and nothing from `server/`.
const rule = { id: 'records', decide: { by: 'maintainer', method: 'vote', window: 'PT1M' } }
const proposal = { id: 'p-1', title: 'Move one project', rules: [rule] } as never
const evaluation = (tally: Record<string, unknown>) => ({ state: 'failed', missing: '', parts: [{ rule, evaluation: { tally } }] }) as never

describe('decisionRowFor', () => {
  it('a rejection: status equals outcome, the method is the lead rule’s, the summary counts the ballots', () => {
    expect(decisionRowFor(proposal, evaluation({ for: ['ana'], against: ['bruno', 'carla'], abstain: [] }), { id: 'gov-20261027-001', date: '2026-10-27', outcome: 'rejected' })).toEqual({
      id: 'gov-20261027-001', proposal: 'p-1', rule: 'records', method: 'vote', outcome: 'rejected', status: 'rejected',
      by: ['ana'], date: '2026-10-27', title: 'Move one project', summary: '1 yes, 2 no, 0 abstaining.',
    })
  })
  it('a lapse under an objection says so, in each method; a lapse with none says nobody decided', () => {
    const at = { id: 'g', date: '2026-10-27', outcome: 'expired' } as const
    const of = (method: string, tally: Record<string, unknown>) => {
      const r = { id: 'records', decide: { by: 'maintainer', method } }
      return decisionRowFor({ id: 'p-1', title: 't', rules: [r] } as never, { state: 'expired', missing: '', parts: [{ rule: r, evaluation: { tally } }] } as never, at).summary
    }
    expect(of('approve', { for: [], objecting: ['carla'] })).toBe('0 approvals; held by an objection (carla) until it expired.')
    expect(of('approve', { for: ['ana'], objecting: ['carla', 'bruno'] })).toBe('1 approval (ana); held by an objection (carla and bruno) until it expired.')
    expect(of('approve', { for: [], objecting: [] })).toBe('0 approvals; nobody decided it before it expired.')
    expect(of('consent', { objecting: ['carla'] })).toBe('held by an objection (carla) until it expired.')
    expect(of('consent', { objecting: [] })).toBe('the objection window did not close before it expired.')
    expect(of('system', {})).toBe('the system had not executed it before it expired.')
    expect(of('vote', { for: ['ana'], against: [], abstain: [] })).toBe('1 yes, 0 no, 0 abstaining; it expired without a decision.')
  })
  it('refuses rules that name no method', () => {
    expect(() => decisionRowFor({ id: 'p-2', title: 't', rules: [{ id: 'x' }] } as never, evaluation({}), { id: 'g', date: '2026-10-27', outcome: 'expired' })).toThrow(/name no method/)
  })
  it('imports no node module and nothing from server/', () => {
    const src = readFileSync(new URL('../../lib/decision-row.mjs', import.meta.url), 'utf8')
    expect(src).not.toMatch(/from ['"]node:/)
    expect(src).not.toMatch(/^import .*server\//m)
  })
})
