import { describe, it, expect } from 'vitest'
import { intakeOutcome } from '../../lib/federation/intake.mjs'
import { makeInvite } from '../../lib/federation/invite.mjs'

const random = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 5 + 1) % 256)
const NOW = '2026-11-22T10:00:00.000Z'
const join = (o: Record<string, unknown> = {}) => ({ policy: 'open-with-approval', types: [], asks: [], where: null, decision: null, ...o }) as never
const req = (o: Record<string, unknown> = {}) => ({
  from: { name: 'Mesa', type: 'LocalNode', url: 'https://github.com/m/m' }, answers: {}, ...o,
}) as never

describe('intakeOutcome', () => {
  it('refuses with no join block, or a closed one', () => {
    const closed = { kind: 'refuse', reason: "This network isn't taking requests." }
    expect(intakeOutcome(null, req(), [], NOW)).toEqual(closed)
    expect(intakeOutcome(join({ policy: 'closed' }), req(), [], NOW)).toEqual(closed)
  })
  it('refuses a type the network does not take, naming the ones it does', () => {
    expect(intakeOutcome(join({ types: ['Hub', 'DAO'] }), req(), [], NOW))
      .toEqual({ kind: 'refuse', reason: 'This network takes Hub, DAO.' })
    expect(intakeOutcome(join({ types: ['LocalNode'] }), req(), [], NOW)).toEqual({ kind: 'propose' })
  })
  it('refuses a missing ask', () => {
    const j = join({ asks: ['operator', 'portal'] })
    expect(intakeOutcome(j, req({ answers: { operator: '@a', portal: '  ' } }), [], NOW)).toEqual({ kind: 'refuse', reason: 'Answer "portal".' })
    expect(intakeOutcome(j, req({ answers: { operator: '@a', portal: 'https://x.org' } }), [], NOW)).toEqual({ kind: 'propose' })
  })
  it('an ask named like an inherited property is read as unanswered, never thrown on', () => {
    for (const ask of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const j = join({ asks: [ask] })
      expect(() => intakeOutcome(j, req({ answers: {} }), [], NOW)).not.toThrow()
      expect(intakeOutcome(j, req({ answers: {} }), [], NOW)).toEqual({ kind: 'refuse', reason: `Answer "${ask}".` })
    }
    expect(intakeOutcome(join({ asks: ['constructor'] }), req({ answers: JSON.parse('{"constructor":"yes"}') }), [], NOW)).toEqual({ kind: 'propose' })
  })
  it('invite policy: without a match refuses, with one accepts by invite', () => {
    const { record, token } = makeInvite({ name: 'Mesa', type: 'LocalNode', network: 'n', expires: '2026-12-22', random })
    const j = join({ policy: 'invite' })
    expect(intakeOutcome(j, req(), [record], NOW))
      .toEqual({ kind: 'refuse', reason: "This network joins by invite. This invite doesn't match." })
    expect(intakeOutcome(j, req({ invite: 'nope' }), [record], NOW))
      .toEqual({ kind: 'refuse', reason: "This network joins by invite. This invite doesn't match." })
    expect(intakeOutcome(j, req({ invite: token }), [record], NOW)).toEqual({ kind: 'accept', by: 'invite', invite: record })
    expect(intakeOutcome(j, req({ invite: token }), [{ ...record, used_by: 'r' }], NOW))
      .toEqual({ kind: 'refuse', reason: 'This network joins by invite. This invite has been used.' })
  })
  it('open-with-approval proposes', () => {
    expect(intakeOutcome(join(), req(), [], NOW)).toEqual({ kind: 'propose' })
  })
  it('open accepts by its standing decision, and proposes without one', () => {
    expect(intakeOutcome(join({ policy: 'open', decision: 'LD-7' }), req(), [], NOW)).toEqual({ kind: 'accept', by: 'standing', decision: 'LD-7' })
    expect(intakeOutcome(join({ policy: 'open' }), req(), [], NOW)).toEqual({ kind: 'propose' })
  })
})
