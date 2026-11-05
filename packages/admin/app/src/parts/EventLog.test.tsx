// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { EARLIER_RESTRICTED, EventLog } from './EventLog.tsx'
import { eventFixtures, PROPOSAL_NOW } from '../test/fixtures/proposals.ts'
import { renderAt } from '../test/render.tsx'
import { ageText } from '../time.ts'

const REV = 'a1b2c3d4e5f6'
const draw = (events = eventFixtures) => renderAt(<EventLog events={events} rev={REV} now={PROPOSAL_NOW} />)
const item = (id: string) => document.querySelector(`[data-event="${id}"]`) as HTMLElement

describe('EventLog', () => {
  it('is a named list with one item per event', () => {
    draw()
    const list = screen.getByRole('list', { name: 'Events' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(eventFixtures.length)
  })

  it('says each kind of event in words', () => {
    draw()
    expect(item('e-a').textContent).toContain('carla commented')
    expect(item('e-b').textContent).toContain('ana approved')
    expect(item('e-c').textContent).toContain('bruno objected')
    expect(item('e-e').textContent).toContain('carla voted yes')
    expect(item('e-f').textContent).toContain('bruno abstained')
    expect(item('e-g').textContent).toContain('bruno took back their objection')
    expect(item('e-h').textContent).toContain('carla revised the proposal')
    expect(item('e-i').textContent).toContain('the proposal was re-based on the trunk')
    expect(item('e-j').textContent).toContain('carla attached transaction 0xabc123 on safe')
    expect(item('e-k').textContent).toContain('safe reported executed')
    expect(item('e-l').textContent).toContain('ana ratified it')
    expect(item('e-m').textContent).toContain('carla withdrew it')
    expect(item('e-n').textContent).toContain('ana rejected it')
    expect(item('e-o').textContent).toContain('it expired')
  })

  it("shows an objection's argument and a comment's text as written", () => {
    draw()
    expect(within(item('e-c')).getByText('It harms the aim: members would lose their say.')).toBeTruthy()
    expect(within(item('e-a')).getByText('Opened for review.')).toBeTruthy()
    expect(within(item('e-m')).getByText('No longer needed.')).toBeTruthy()
    expect(within(item('e-k')).getByText('executed with 2 of 2 confirmations')).toBeTruthy()
  })

  it('says an objection to an earlier version no longer holds, and one taken back was taken back', () => {
    draw()
    expect(item('e-d').textContent).toContain('about an earlier version, answered')
    expect(item('e-c').textContent).toContain('taken back')
    expect(item('e-b').textContent).not.toContain('taken back')
  })

  it('gives each event its time as words and as a datetime', () => {
    draw()
    const t = item('e-a').querySelector('time')!
    expect(t.getAttribute('datetime')).toBe(eventFixtures[0]!.at)
    expect(t.textContent).toBe(ageText(eventFixtures[0]!.at, PROPOSAL_NOW)) // 30 h back: a date (C-28)
    expect(t.textContent).toMatch(/^1[56] Oct$/)
  })

  it('is drawn as a comment thread is: a monogram, who did what, when, and the text under it (§14.1, C3)', () => {
    draw()
    const e = item('e-c')
    expect(e.className).toBe('thread-i evt evt-object')
    expect(e.querySelector('.cmt > .av')!.textContent).toBe('BR')
    expect(e.querySelector('.cmt-who')!.textContent).toBe('bruno objected')
    expect(e.querySelector('.cmt-b')!.textContent).toBe('It harms the aim: members would lose their say.')
    // what a System reported takes the Systems glyph, not a monogram
    expect(item('e-k').querySelector('.cmt > .av svg')).toBeTruthy()
  })

  it('says so when there is nothing yet', () => {
    draw([])
    expect(screen.getByText('No events yet.')).toBeTruthy()
  })

  it('announces an event that arrives, once, through the live region, and none that were there', () => {
    const first = eventFixtures.slice(0, 2)
    const { rerender } = draw(first)
    expect(screen.getByTestId('live').textContent).toBe('')
    rerender(<EventLog events={eventFixtures.slice(0, 3)} rev={REV} now={PROPOSAL_NOW} />)
    expect(screen.getByTestId('live').textContent).toBe('bruno objected: It harms the aim: members would lose their say.')
    rerender(<EventLog events={eventFixtures.slice(0, 3)} rev={REV} now={PROPOSAL_NOW} />)
    expect(screen.getByTestId('live').textContent).toBe('bruno objected: It harms the aim: members would lose their say.')
  })

  it('an earlier revision that wrote restricted data says its restricted part is not kept for it (R-L5-final.2)', () => {
    const at = PROPOSAL_NOW.toISOString()
    const placeholder = { op: 'private', ref: 'prv_00000000000000a1', class: 'members', digest: `sha256:${'d'.repeat(64)}` }
    const revise = (id: string, rev: string, ops: unknown[]) => ({ id, at, by: 'carla', kind: 'revise', rev, ops }) as never
    draw([revise('r-old', 'old0', [placeholder]), revise('r-plain', 'old1', [{ op: 'update', record: 'projects:p1', set: { title: 'x' } }]), revise('r-now', REV, [placeholder])])
    expect(item('r-old').textContent).toContain(`(${EARLIER_RESTRICTED})`)
    expect(item('r-plain').textContent).not.toContain(EARLIER_RESTRICTED)
    expect(item('r-now').textContent).not.toContain(EARLIER_RESTRICTED)
  })
})

