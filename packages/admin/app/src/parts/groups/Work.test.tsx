// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderAt } from '../../test/render.tsx'
import { fetchRoutes } from '../../test/fetchRoutes.ts'
import Work from './Work.tsx'

describe('/parts/work', () => {
  it('draws the editor beside its thread, the toolbar, the menus, the save states and the previews, from fixtures alone', async () => {
    const { calls } = fetchRoutes({})
    renderAt(<Work />, '/parts/work')
    // the editor: its bar, its body with every block and affordance, its thread beside it
    expect(screen.getAllByRole('navigation', { name: 'Page path' })).toHaveLength(3)
    expect(screen.getAllByRole('heading', { level: 3, name: 'How the treasury is run' })).toHaveLength(2)
    expect(screen.getByRole('group', { name: 'Treasury · Safe' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Tasks · view' })).toBeTruthy()
    for (const cls of ['ed-callout', 'ed-cur', 'ed-sel', 'ed-cmt']) expect(document.querySelector(`.${cls}`), cls).not.toBeNull()
    const thread = document.getElementById('pg-work-thread')!
    expect(within(thread).getByRole('heading', { level: 2 }).textContent).toBe('Comments · 2 open')
    // the toggle closes the thread and opens it again
    const toggle = screen.getAllByRole('button', { name: 'Comments, 2' })[0]!
    fireEvent.click(toggle)
    expect(document.getElementById('pg-work-thread')).toBeNull()
    fireEvent.click(toggle)
    expect(document.getElementById('pg-work-thread')).not.toBeNull()
    // the toolbar, the slash menu and the mention picker
    expect(screen.getByRole('toolbar', { name: 'Format' })).toBeTruthy()
    expect(within(screen.getByRole('listbox', { name: 'Insert · /' })).getAllByRole('option')).toHaveLength(6)
    expect(within(screen.getByRole('listbox', { name: 'Mention' })).getAllByRole('option', { name: /can’t see this page/ })).toHaveLength(1)
    // every save state, and the four kinds of write side by side
    for (const s of ['direct', 'saving', 'staged', 'conflict', 'offline']) expect(document.querySelector(`.save-${s}`), s).not.toBeNull()
    expect([...document.querySelectorAll('.pg-state .pg-cap')].map(c => c.textContent)).toEqual(expect.arrayContaining([
      'Governed record', 'Workspace write, direct', 'Workspace write, needs approval', 'Conversation',
    ]))
    // the thread as a sheet, drawn in place
    expect(document.querySelector('dialog.thread-sheet.thread-sheet-inline[open]')).not.toBeNull()
    // previewing: the level is a marker and the thread has no composer
    expect(document.querySelectorAll('.ed-bar .vis-ctl')).toHaveLength(2)
    expect(screen.getAllByRole('textbox')).toHaveLength(3)
    await new Promise(r => setTimeout(r, 50))
    expect(calls).toEqual([])
  })
})
