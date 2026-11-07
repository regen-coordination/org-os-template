// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderAt } from '../../test/render.tsx'
import { fetchRoutes } from '../../test/fetchRoutes.ts'
import Views from './Views.tsx'
import { errorNote } from '../../test/notes.ts'

describe('/parts/views', () => {
  it('draws the view header, the Tasks table and its states, the list and the from mark, from fixtures alone', async () => {
    const { calls } = fetchRoutes({})
    renderAt(<Views />, '/parts/views')
    // the header: five views and a saved one; two chips; + Filter; the sort; New task
    const tabs = screen.getAllByRole('tablist', { name: /^Views of Tasks/ })
    expect(within(tabs[0]!).getAllByRole('tab').map(t => t.textContent)).toEqual(['Table', 'Board', 'Calendar', 'List', 'Map', 'My open tasks'])
    expect(screen.getAllByRole('button', { name: 'New task' })).toHaveLength(2)
    // the working table: its chips filter it, and removing them lets the rest back
    const tasks = screen.getByRole('table', { name: 'Tasks' })
    expect(within(tasks).getAllByRole('row')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Project is Node kit' }))
    expect(within(screen.getByRole('table', { name: 'Tasks' })).getAllByRole('row')).toHaveLength(6)
    // the grouped table: group rows, a staged and a saving cell, an overdue date, checkboxes
    const grouped = screen.getByRole('grid', { name: 'Tasks by status' })
    expect(within(grouped).getAllByRole('rowheader').map(h => h.firstChild!.textContent)).toEqual(['Doing', 'To do'])
    expect(within(grouped).getByText('Saving')).toBeTruthy()
    expect(within(grouped).getByText('Staged')).toBeTruthy()
    expect(within(grouped).getByText('overdue')).toBeTruthy()
    expect(within(grouped).getAllByRole('checkbox')).toHaveLength(6)
    // the states every view shares
    expect(screen.getByRole('region', { name: 'Loading Tasks' })).toBeTruthy()
    expect(screen.getByText('No tasks yet.')).toBeTruthy()
    expect(screen.getByText('No tasks match these filters.')).toBeTruthy()
    expect(errorNote().textContent).toBe('Couldn’t load Tasks: the server didn’t answer. Try again')
    // the list, and the from mark in its four forms
    expect(within(screen.getByRole('list', { name: 'Tasks as a list' })).getAllByRole('listitem')).toHaveLength(5)
    expect([...document.querySelectorAll('.pg-state .from')].map(m => m.textContent)).toEqual([
      'from data/projects.yaml · read 2 min ago', 'from org-os · data/meetings.yaml · read 1 h ago',
      'from Treasury · couldn’t read · last 2 h ago', 'from Notion · exported 12 Aug',
    ])
    await new Promise(r => setTimeout(r, 50))
    expect(calls).toEqual([])
  })

  it('the lifted card’s ghost is inert and hidden, as the board draws it: a placeholder, not a card (C11, 1.4.3 incidental)', () => {
    fetchRoutes({})
    renderAt(<Views />, '/parts/views')
    const ghost = document.querySelector('.kcard-ghost')!
    expect(ghost.hasAttribute('inert')).toBe(true)
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
  })
})
