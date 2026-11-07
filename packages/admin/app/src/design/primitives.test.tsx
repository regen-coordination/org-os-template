// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Note } from './Note.tsx'
import { heard } from '../test/notes.ts'
import { MARK_WORD, StatusMark } from './StatusMark.tsx'
import { Menu } from './Menu.tsx'
import { Tabs } from './Tabs.tsx'
import { Empty, EmptyWhen } from './Empty.tsx'

describe('Note', () => {
  // C10 (ledger; E-81, §13): an error is a clay note, not an alert. role="alert" is the compose canvas's refused
  // connection and the tray's failed Apply and Propose only (legacy.test.ts holds that).
  it('says each state in its own words: a note, a clay line, or a plain faint line', () => {
    const { rerender, container } = render(<Note state="unavailable">No crew: scripts/crew.mjs is missing</Note>)
    expect(screen.getByRole('note').textContent).toBe('No crew: scripts/crew.mjs is missing')
    rerender(<Note state="notYet">Arrives with P2.</Note>)
    expect(screen.getByRole('note').textContent).toBe('Arrives with P2.')
    rerender(<Note state="error">the graph is down</Note>)
    expect(container.querySelector('p.note-error')!.textContent).toBe('the graph is down')
    expect(screen.queryByRole('alert')).toBeNull()
    rerender(<Note state="loading">Loading…</Note>)
    expect(container.querySelector('p')!.className).toBe('note note-loading')
    expect(screen.queryByRole('alert')).toBeNull()
    rerender(<Note state="empty">Nothing needs you.</Note>)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('leads each state with its glyph (§7.4): dashed circle, spinner, alert, clock, info', () => {
    const glyph = { empty: 'svg', loading: '.spin', error: 'svg', unavailable: 'svg', notYet: 'svg' } as const
    for (const state of ['empty', 'loading', 'error', 'unavailable', 'notYet'] as const) {
      const { container, unmount } = render(<Note state={state}>words</Note>)
      const p = container.querySelector('p')!
      expect(p.className).toBe(`note note-${state}`)
      expect(p.firstElementChild!.matches(glyph[state])).toBe(true)
      expect(p.firstElementChild!.getAttribute('aria-hidden')).toBe('true')
      unmount()
    }
  })

  it('puts an action after the sentence, outside its words', () => {
    render(<Note state="empty" action={<a href="/new/projects">New</a>}>No projects yet.</Note>)
    expect(screen.getByRole('link', { name: 'New' }).closest('.note-act')).not.toBeNull()
    expect(screen.getByText('No projects yet.', { exact: false })).toBeTruthy()
  })

  it('an error says its sentence once through the polite region, as it appears and when it changes; quiet where the page says it (C11 I-1)', () => {
    const ear = heard()
    try {
      const { rerender } = render(<Note state="error" action={<button type="button">Try again</button>}>Couldn’t load proposals.</Note>)
      rerender(<Note state="error" action={<button type="button">Try again</button>}>Couldn’t load proposals.</Note>)
      expect(ear.said).toEqual(['Couldn’t load proposals.']) // the action is not said, and a redraw says nothing again
      rerender(<Note state="error">The server is down.</Note>)
      expect(ear.said).toEqual(['Couldn’t load proposals.', 'The server is down.'])
      rerender(<Note state="loading">Loading…</Note>)
      rerender(<Note state="empty">Nothing here.</Note>)
      rerender(<Note state="error" quiet>Said by the page already.</Note>)
      expect(ear.said).toHaveLength(2)
    } finally { ear.stop() }
  })

  it('keeps Empty and EmptyWhen as they were (Absent is gone with its callers, C10)', () => {
    const { container, rerender } = render(<Empty>Nothing needs you.</Empty>)
    expect(container.querySelector('p.note-empty')!.textContent).toBe('Nothing needs you.')
    rerender(<EmptyWhen query={{ isPending: true, error: null }}>No projects yet.</EmptyWhen>)
    expect(screen.getByText('Loading…')).toBeTruthy()
    rerender(<EmptyWhen query={{ isPending: false, error: new Error('x') }}>No projects yet.</EmptyWhen>)
    expect(container.textContent).toBe('')
  })
})

describe('StatusMark', () => {
  it('draws a shape and says a word, never colour alone', () => {
    for (const mark of ['needs', 'staged', 'stale', 'running', 'failed', 'aged', 'done'] as const) {
      const { container, unmount } = render(<StatusMark mark={mark} />)
      expect(container.querySelector(`.smark.smark-${mark} .smark-shape[aria-hidden="true"]`)).toBeTruthy()
      expect(container.textContent).toBe(MARK_WORD[mark])
      unmount()
    }
  })

  it('says a label in place of its word when given one', () => {
    render(<StatusMark mark="staged" label="2 staged" />)
    expect(screen.getByText('2 staged')).toBeTruthy()
  })
})

describe('Menu', () => {
  it('opens on its button, and closes on a choice, on Escape and on a click outside', () => {
    const pick = vi.fn()
    render(<><Menu label="More actions"><button type="button" onClick={pick}>Delete</button></Menu><p>outside</p></>)
    const btn = screen.getByRole('button', { name: 'More actions' })
    expect(btn.textContent).toBe('')
    expect(btn.querySelector('svg.i')).not.toBeNull()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(pick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    fireEvent.click(btn)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Delete' }), { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    fireEvent.click(btn)
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('marks the Escape it acts on as handled, so nothing under it acts too', () => {
    render(<Menu label="More actions"><button type="button">Delete</button></Menu>)
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(fireEvent.keyDown(screen.getByRole('button', { name: 'Delete' }), { key: 'Escape' })).toBe(false)
  })
})

describe('Tabs', () => {
  it('is a tablist: the chosen tab selected and focusable, arrows move and wrap', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Tabs label="Show" value="a" onChange={onChange} tabs={[{ id: 'a', label: 'Cards' }, { id: 'b', label: 'Blocks' }]} />)
    const a = screen.getByRole('tab', { name: 'Cards' })
    expect(screen.getByRole('tablist', { name: 'Show' })).toBeTruthy()
    expect(a.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Blocks' }).getAttribute('tabindex')).toBe('-1')
    fireEvent.keyDown(a, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('b')
    rerender(<Tabs label="Show" value="b" onChange={onChange} tabs={[{ id: 'a', label: 'Cards' }, { id: 'b', label: 'Blocks' }]} />)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Blocks' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('a')
    fireEvent.click(screen.getByRole('tab', { name: 'Cards' }))
    expect(onChange).toHaveBeenLastCalledWith('a')
  })
})
