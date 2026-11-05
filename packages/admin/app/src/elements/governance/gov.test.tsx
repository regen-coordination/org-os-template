// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderAt } from '../../test/render.tsx'
import { FIXED_NOW } from '../../test/fixtures/parts.ts'
import { ACTOR, PREPARED_IN, PREPARED_RETURN, RECORDS_RATIFIED, RETURN_DECIDED, RETURN_POOLS } from '../../test/fixtures/house/governance.ts'
import { DataList } from '../rows/DataList.tsx'
import { Timeline } from './Timeline.tsx'
import { ProposalRow } from './ProposalRow.tsx'
import { timelineOf } from './timeline.ts'

const STEPS = timelineOf(RETURN_DECIDED, [PREPARED_RETURN], ACTOR)

describe('Timeline (§9.5)', () => {
  it('an <ol> whose items carry their state as words', () => {
    renderAt(<Timeline steps={STEPS} label="Path of p-2026-10-17-001" />)
    const list = screen.getByRole('list', { name: 'Path of p-2026-10-17-001' })
    expect(list.tagName).toBe('OL')
    const items = within(list).getAllByRole('listitem')
    expect(items.map(li => li.querySelector('.tl-t')!.textContent)).toEqual([
      'Proposed', 'Council approvals', 'Decided', 'Transaction prepared', 'Signed in the Safe', 'Read back',
    ])
    // the state in words, before the title, for a screen reader; the marker is decoration
    expect(items.map(li => li.querySelector('.sr-only')!.textContent)).toEqual(['Done: ', 'Done: ', 'Done: ', 'Done: ', 'Now: ', 'Waiting: '])
    for (const li of items) expect(li.querySelector('.tl-mk')!.getAttribute('aria-hidden')).toBe('true')
    expect(items.map(li => li.className)).toEqual(['tl-step tl-done', 'tl-step tl-done', 'tl-step tl-done', 'tl-step tl-done', 'tl-step tl-current', 'tl-step tl-waiting'])
  })

  it("each step's second line: the meter with its words, then the line; the signed step says signers sign in the Safe app", () => {
    renderAt(<Timeline steps={STEPS} />)
    const items = screen.getAllByRole('listitem')
    expect(items[1]!.querySelector('.meter')!.getAttribute('aria-hidden')).toBe('true')
    expect(items[1]!.querySelectorAll('.meter > i.you')).toHaveLength(1)
    expect(items[1]!.querySelector('.tl-s')!.textContent).toBe('4 of 4 · you approved')
    expect(items[4]!.querySelector('.tl-s')!.textContent).toBe('2 of 4 · signers sign in the Safe app, never here')
    expect(items[0]!.querySelector('.tl-s')!.textContent).toBe('14 Oct 2026 · treasury-steward')
  })

  it('draws a done step with a check, a failed one with a cross, and a not-needed one with no glyph', () => {
    const failed = timelineOf(RETURN_DECIDED, [PREPARED_IN.replaced!], null).find(s => s.id === 'read-back')!
    const skip = timelineOf(RECORDS_RATIFIED, [], null).find(s => s.id === 'prepared')!
    renderAt(<Timeline steps={[STEPS[0]!, failed, skip]} />)
    const [done, fail, none] = screen.getAllByRole('listitem')
    expect(done!.querySelector('.tl-mk svg')).toBeTruthy()
    expect(fail!.className).toBe('tl-step tl-failed')
    expect(fail!.textContent).toBe('Failed: Read back: replacedNonce 18 was used by another transaction. Prepare again.')
    expect(none!.className).toBe('tl-step tl-not-needed')
    expect(none!.querySelector('.tl-mk svg')).toBeNull()
    expect(none!.textContent).toBe('Not needed: No transaction neededThis decision changes records only')
  })

  it('compact: 10px dots joined by lines, and one phrase', () => {
    const { container } = renderAt(<Timeline steps={STEPS} compact />)
    expect(container.querySelector('ol')).toBeNull()
    const dots = container.querySelector('.tlc-dots')!
    expect(dots.getAttribute('aria-hidden')).toBe('true')
    expect([...dots.querySelectorAll('i')].map(i => i.className)).toEqual(['d', 'd', 'd', 'd', 'n', ''])
    expect([...dots.querySelectorAll('b')].map(b => b.className)).toEqual(['d', 'd', 'd', 'd', ''])
    expect(container.querySelector('.tlc-l')!.textContent).toBe('Signing · 2 of 4')
  })
})

describe('ProposalRow', () => {
  it('a data row: the id in Mono, the title, the route, the compact timeline and the meter; one link to the proposal', () => {
    renderAt(<DataList label="Proposals"><ProposalRow view={RETURN_POOLS} now={FIXED_NOW} /></DataList>)
    const row = screen.getByRole('link')
    expect(row.getAttribute('href')).toBe('/r/proposal/p-2026-10-17-001')
    expect(row.querySelector('.drow-t')!.textContent).toBe('Return the Gardens pools to the treasury')
    const second = row.querySelector('.drow-s')!
    expect(second.querySelector('.prow-id')!.textContent).toBe('p-2026-10-17-001')
    expect(second.querySelector('.prow-route')!.textContent).toBe('four Council stewards approve')
    expect(second.querySelector('.tlc-l')!.textContent).toBe('Approving · 2 of 4')
    expect(second.querySelector('.meter-l')!.textContent).toBe('2 of 4 approved')
    // it waits on this member: the needs mark, the deadline at the end
    expect(row.querySelector('.drow-end')!.textContent).toBe('Closes in 5 daysNeeds you')
  })

  it('a decided proposal reads its timeline from the ledger: signing, with the transaction’s count', () => {
    renderAt(<DataList label="Proposals"><ProposalRow view={RETURN_DECIDED} now={FIXED_NOW} /></DataList>)
    const row = screen.getByRole('link')
    expect(row.querySelector('.tlc-l')!.textContent).toBe('Signing · 2 of 4')
    expect(row.querySelector('.meter-l')!.textContent).toBe('2 of 4 signed')
  })

  it('a ratified one: decided, no meter, its decision date at the end and the done mark', () => {
    renderAt(<DataList label="Proposals"><ProposalRow view={RECORDS_RATIFIED} now={FIXED_NOW} /></DataList>)
    const row = screen.getByRole('link')
    expect(row.querySelector('.tlc-l')!.textContent).toBe('Decided')
    expect(row.querySelector('.meter')).toBeNull()
    expect(row.querySelector('.drow-end')!.textContent).toBe('15 OctDecided')
  })

  it('passes the actor: their approval is the meter’s moss segment, "you approved" (E-51)', () => {
    const waiting = { ...RETURN_POOLS, evaluation: { ...RETURN_POOLS.evaluation, parts: [{ ...RETURN_POOLS.evaluation.parts[0]!,
      evaluation: { ...RETURN_POOLS.evaluation.parts[0]!.evaluation, tally: { for: ['steward-a', ACTOR], needed: 4 } } }] } } as typeof RETURN_POOLS
    renderAt(<DataList label="Proposals"><ProposalRow view={waiting} now={FIXED_NOW} actor={ACTOR} /></DataList>)
    const words = screen.getByText('2 of 4 · you approved')
    expect(words.closest('.prow-yours')).toBeTruthy()
    expect(words.closest('.meter-w')!.querySelector('.meter i.you')).toBeTruthy()
  })

  it('draws a proposal about restricted data in its restricted form: the server’s title, the lock and the rule, nothing it changes (E-49)', () => {
    const restricted = { ...RETURN_POOLS, title: 'A change to a restricted collection', ops: [], restricted: true } as unknown as typeof RETURN_POOLS
    renderAt(<DataList label="Proposals"><ProposalRow view={restricted} now={FIXED_NOW} /></DataList>)
    const row = screen.getByRole('link', { name: /A change to a restricted collection/ })
    expect(row.className).toContain('prow-restricted')
    expect(row.querySelector('.drow-s svg')).toBeTruthy() // the lock, before the route
    expect(within(row).getByText('four Council stewards approve')).toBeTruthy()
    expect(row.textContent).not.toMatch(/network-projects|local-starter/)
  })
})
