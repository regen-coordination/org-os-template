// DAO-OS L6 Task 20 review M3: an op is a level in flight only when it gives a level other than the thing's own; an
// unrelated staged op that restates the level does not hide an open proposal's widening.
import { describe, it, expect } from 'vitest'
import { inFlightOf } from './levelInFlight.ts'
import { proposalView } from '../test/fixtures/proposals.ts'

const PAGE = { page: 'handbook-1a2b', path: 'pages/handbook-1a2b.md' }
const file = (visibility: string) => ({ op: 'file' as const, path: PAGE.path, text: `---\nid: handbook-1a2b\ntitle: Handbook\nvisibility: ${visibility}\n---\nBody.\n`, base: 'b0' })

describe('inFlightOf (M3)', () => {
  it('your staged op that restates the level is passed over for an open proposal that changes it', () => {
    const open = proposalView({ id: 'p-7', derived: 'approving', ops: [file('public')] as never })
    expect(inFlightOf(PAGE, [file('members')], [], [open], 'members')).toEqual({ level: 'public', move: false, proposal: { id: 'p-7', derived: 'approving' } })
  })
  it('a staged op that changes the level is read first', () => {
    const open = proposalView({ id: 'p-7', derived: 'approving', ops: [file('public')] as never })
    expect(inFlightOf(PAGE, [file('public')], [], [open], 'members')).toEqual({ level: 'public', move: false })
  })
  it('nothing in flight when every op restates the level', () => {
    expect(inFlightOf(PAGE, [file('members')], [], [], 'members')).toBeNull()
  })
})
