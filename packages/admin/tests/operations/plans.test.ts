import { describe, it, expect } from 'vitest'
import { Plans, PLAN_TTL_MS } from '../../server/operations/plans.ts'

const rec = { op: 'role.seat', resource: 'role:a', params: {}, cmd: 'node', args: ['x'], writes: [], timeoutMs: 1000 }

describe('Plans', () => {
  it('gives a nonce that can be taken once', () => {
    const plans = new Plans()
    const nonce = plans.issue(rec)
    expect(nonce).toMatch(/^[0-9a-f]{48}$/)
    expect(plans.take(nonce)).toEqual(rec)
    expect(() => plans.take(nonce)).toThrow(/already used or has expired/)
  })

  it('refuses an expired, unknown or missing nonce', () => {
    let t = 0
    const plans = new Plans(PLAN_TTL_MS, () => t)
    const nonce = plans.issue(rec)
    t = PLAN_TTL_MS + 1
    expect(() => plans.take(nonce)).toThrow(/already used or has expired/)
    expect(() => plans.take('f'.repeat(48))).toThrow(/already used or has expired/)
    expect(() => plans.take(undefined)).toThrow(/already used or has expired/)
    expect(PLAN_TTL_MS).toBe(120_000)
  })
})
