// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { WizardFrame, type WizardFrameProps } from './WizardFrame.tsx'
import { errorNote } from '../test/notes.ts'

const base = (over: Partial<WizardFrameProps> = {}): WizardFrameProps => ({
  title: 'Claim your handle', steps: ['Which member are you?'], view: 'step', index: 0,
  heading: 'Which member are you?', ask: 'Pick the member that is you.', writes: 'Nothing yet. The next screen shows the exact line.',
  status: 'Step 1 of 1, then the review. Nothing is written yet.',
  actions: { next: { label: 'Continue', onClick: () => {} }, cancel: { label: 'Close', onClick: () => {} } },
  ...over,
})
const doRender = (over: Partial<WizardFrameProps> = {}, children: React.ReactNode = <p>body</p>) => render(<WizardFrame {...base(over)}>{children}</WizardFrame>)
const compose = (over: Partial<WizardFrameProps> = {}) => base({
  title: 'Compose a DAO', steps: ['Template', 'Network', 'Signers', 'Votes'], index: 2, count: { at: 3, of: 5 },
  heading: 'Who signs for the treasury?', ask: 'Signers are whoever wears the hat you choose.', writes: 'systems.yaml · roles.signers (not deployed)',
  actions: { cancel: { label: 'Save and leave', onClick: () => {} }, back: { label: 'Back', onClick: () => {} }, next: { label: 'Continue', onClick: () => {} } },
  ...over,
})

describe('WizardFrame (§11.3): one decision per screen, and what it writes, always', () => {
  it('shows the steps as a rail that names the current one, and the review last', () => {
    doRender({ steps: ['Which member are you?', 'Another'], index: 1 })
    const items = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem')
    expect(items.map(li => li.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Which member are you?'), expect.stringContaining('Another'), expect.stringContaining('Review')]))
    expect(items).toHaveLength(3)
    expect(items.map(li => li.getAttribute('aria-current'))).toEqual([null, 'step', null])
    expect(items[0]!.getAttribute('aria-label')).toBe('Which member are you?, done')
  })

  it('draws each step’s marker: done an ink disc with a check, current an ink ring with its number, ahead a ring with its number', () => {
    render(<WizardFrame {...compose()}><p>body</p></WizardFrame>)
    const items = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem')
    expect(items.map(li => li.className)).toEqual(['wiz-step done', 'wiz-step done', 'wiz-step current', 'wiz-step', 'wiz-step'])
    const dots = items.map(li => li.querySelector('.wiz-dot')!)
    expect(dots.every(d => d.getAttribute('aria-hidden') === 'true')).toBe(true)
    expect(dots.map(d => (d.querySelector('svg') ? '✓' : d.textContent))).toEqual(['✓', '✓', '3', '4', '5'])
  })

  it('heads the body with the eyebrow "<wizard> · 3 of 5" and the question as the screen’s heading', () => {
    render(<WizardFrame {...compose()}><p>body</p></WizardFrame>)
    const r = screen.getByRole('region', { name: 'Compose a DAO' })
    expect(r.querySelector('.wiz-k')!.textContent).toBe('Compose a DAO · 3 of 5')
    expect(within(r).getByRole('heading', { level: 2, name: 'Who signs for the treasury?' }).className).toContain('wiz-h')
    expect(within(r).getByText('Signers are whoever wears the hat you choose.').className).toContain('wiz-ask')
  })

  it('has the narrow top line "<step> · step 3 of 5" the sheet shows in place of the rail under 560px', () => {
    render(<WizardFrame {...compose()}><p>body</p></WizardFrame>)
    expect(document.querySelector('.wiz-top')!.textContent).toBe('Signers · step 3 of 5')
  })

  it('counts from the steps when no count is given: the review is the last step', () => {
    doRender({ view: 'review' })
    expect(document.querySelector('.wiz-k')!.textContent).toBe('Claim your handle · 2 of 2')
    expect(document.querySelector('.wiz-top')!.textContent).toBe('Review · step 2 of 2')
  })

  it('says the wizard and where it ended on the narrow top line once done, closed or not yet started', () => {
    for (const [view, line] of [['intro', 'Claim your handle · 2 steps'], ['done', 'Claim your handle · Done'], ['closed', 'Claim your handle · Closed']] as const) {
      const { unmount } = doRender({ view })
      expect(document.querySelector('.wiz-top')!.textContent, view).toBe(line)
      unmount()
    }
  })

  it('says what the step writes, in the “This screen writes” well, in every view', () => {
    for (const view of ['intro', 'step', 'review', 'running', 'done', 'failed', 'closed'] as const) {
      const { unmount } = doRender({ view, writes: `writes for ${view}` })
      const well = screen.getByRole('group', { name: 'What this writes' })
      expect(well.textContent).toBe(`This screen writes${`writes for ${view}`}`)
      expect(well.className).toContain('wiz-writes')
      unmount()
    }
  })

  it('announces the machine\'s sentence politely', () => {
    doRender({ status: 'Review. Nothing is written until you confirm.', view: 'review' })
    expect(screen.getByRole('status').textContent).toBe('Review. Nothing is written until you confirm.')
  })

  it('shows a refusal as a clay note, with the guard\'s own sentence (E-27)', () => {
    doRender({ refusal: 'Choose who you are first.' })
    const alert = errorNote()
    expect(alert.textContent).toContain('Choose who you are first.')
    expect(alert.className).toContain('note-error')
  })

  it('marks the review current at review, running and failed, and every step done at the end', () => {
    for (const view of ['review', 'running', 'failed'] as const) {
      const { unmount } = doRender({ view })
      const items = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem')
      expect(items.at(-1)!.getAttribute('aria-current'), view).toBe('step')
      unmount()
    }
    doRender({ view: 'done' })
    const items = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem')
    expect(items.map(li => li.getAttribute('aria-current'))).toEqual([null, null])
    expect(items.every(li => /, done$/.test(li.getAttribute('aria-label') ?? ''))).toBe(true)
  })

  it('runs as lines of progress: a spinner on the line still running, a check on the lines done', () => {
    doRender({ view: 'running', heading: 'Writing', lines: [{ text: 'Checked against the schema', done: true }, { text: 'Staging 6 records…' }] })
    const lines = within(screen.getByRole('list', { name: 'Progress' })).getAllByRole('listitem')
    expect(lines.map(l => [l.textContent, !!l.querySelector('.spin'), !!l.querySelector('svg')])).toEqual([
      ['Checked against the schema', false, true], ['Staging 6 records…', true, false],
    ])
  })

  it('ends done on a moss tile beside what was done, and failed on a clay tile, with their own actions', () => {
    const { unmount } = doRender({ view: 'done', heading: 'Staged as one change', ask: 'Council consent decides it.', actions: {} }, <a href="/changes">Propose</a>)
    const done = document.querySelector('.wiz-out')!
    expect(done.querySelector('.ktile-moss')).toBeTruthy()
    expect(within(done as HTMLElement).getByRole('heading', { level: 2, name: 'Staged as one change' })).toBeTruthy()
    expect(within(done as HTMLElement).getByText('Council consent decides it.')).toBeTruthy()
    expect(within(done as HTMLElement).getByRole('link', { name: 'Propose' })).toBeTruthy()
    unmount()
    const again = vi.fn(), review = vi.fn()
    doRender({ view: 'failed', heading: 'Nothing was written', refusal: 'systems.yaml has uncommitted edits.',
      actions: { next: { label: 'Try again', onClick: again }, back: { label: 'Back to review', onClick: review } } })
    const failed = document.querySelector('.wiz-out')! as HTMLElement
    expect(failed.querySelector('.ktile-attn')).toBeTruthy()
    expect(within(failed).getByRole('heading', { level: 2, name: 'Nothing was written' })).toBeTruthy()
    expect(errorNote(failed).textContent).toContain('systems.yaml has uncommitted edits.')
    fireEvent.click(within(failed).getByRole('button', { name: 'Try again' }))
    fireEvent.click(within(failed).getByRole('button', { name: 'Back to review' }))
    expect([again.mock.calls.length, review.mock.calls.length]).toEqual([1, 1])
  })

  it('runs its buttons, and a disabled one does nothing', () => {
    const next = vi.fn(); const back = vi.fn(); const cancel = vi.fn()
    doRender({ actions: { next: { label: 'Continue', onClick: next }, back: { label: 'Back', onClick: back }, cancel: { label: 'Close', onClick: cancel } } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect([next, back, cancel].map(f => f.mock.calls.length)).toEqual([1, 1, 1])
    const off = vi.fn()
    doRender({ actions: { next: { label: 'Create', onClick: off, disabled: true } } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Create' })[0]!)
    expect(off).not.toHaveBeenCalled()
  })

  it('lays the foot out as §11.3 draws it: Save and leave (ghost) first, then Back, then Continue (primary) last', () => {
    render(<WizardFrame {...compose()}><p>body</p></WizardFrame>)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['Save and leave', 'Back', 'Continue'])
    expect(buttons.map(b => b.className.split(' ')[1])).toEqual(['ghost', 'secondary', 'primary'])
    expect(buttons[0]!.closest('.wiz-foot')).toBeTruthy()
    expect(buttons[2]!.closest('.wiz-end')).toBe(buttons[1]!.closest('.wiz-end'))
  })

  // the stepped new-record form (spec 2026-11-04 §3, Option B) draws on this frame: its last step, its Skip, its one live region
  it('names the last step as the flow calls it: "Check" in place of "Review"', () => {
    doRender({ steps: ['What it is', 'Who'], view: 'review', last: 'Check' })
    const items = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem')
    expect(items.map(li => li.querySelector('.wiz-step-t')!.textContent)).toEqual(['What it is', 'Who', 'Check'])
    expect(document.querySelector('.wiz-top')!.textContent).toBe('Check · step 3 of 3')
  })

  it('draws Skip between Back and Next, a secondary that runs its own action', () => {
    const skip = vi.fn()
    render(<WizardFrame {...compose({ actions: { cancel: { label: 'Cancel', onClick: () => {} }, back: { label: 'Back', onClick: () => {} }, skip: { label: 'Skip', onClick: skip }, next: { label: 'Next', onClick: () => {} } } })}><p>body</p></WizardFrame>)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['Cancel', 'Back', 'Skip', 'Next'])
    expect(buttons[2]!.className.split(' ')[1]).toBe('secondary')
    expect(buttons[2]!.closest('.wiz-end')).toBe(buttons[3]!.closest('.wiz-end'))
    fireEvent.click(buttons[2]!)
    expect(skip).toHaveBeenCalledTimes(1)
  })

  it('draws no live region of its own when the page speaks through its one region (no status given)', () => {
    doRender({ status: undefined })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('moves focus to the heading when the view or step changes, not when it first draws', () => {
    const { rerender } = doRender({ view: 'intro', heading: 'Intro' })
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 2 }))
    rerender(<WizardFrame {...base({ view: 'step', heading: 'Which member are you?' })}><p>body</p></WizardFrame>)
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Which member are you?' }))
  })
})
