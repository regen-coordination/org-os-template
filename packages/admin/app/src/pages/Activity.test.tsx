// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import Activity from './Activity.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, refuse, resource } from '../test/data.ts'
import { findErrorNote } from '../test/notes.ts'

describe('Activity', () => {
  it('lists every operation run, newest first, with its resource and result', async () => {
    const created = new Date(2026, 9, 16, 22, 14).toISOString()
    fetchRoutes({ ...baseRoutes(),
      'GET /api/resources': [resource({ id: 'module:a', kind: 'module', name: 'org-os-buzz', source: null })],
      'GET /api/jobs': [{ id: 'j1', op: 'module.checks', resource: 'module:a', label: 'Re-run checks', cmd: null, args: [], writes: [], status: 'finished-with-surprises',
        created, started: created, ended: created, exitCode: 0, changed: ['stray.md'], surprises: ['stray.md'], sentence: 'Finished, and changed files it does not declare: stray.md.' }] })
    renderAt(<Activity />)
    // C9 (§14.1): a list view of events — one data row per run, opening the record it ran on
    const list = await screen.findByRole('list', { name: 'Activity' })
    expect(list.closest('.dlist')).not.toBeNull()
    const row = within(list).getByRole('link', { name: /Re-run checks/ })
    expect(row.className).toContain('drow')
    expect(row.getAttribute('href')).toBe('/r/module/a')
    expect(row.querySelector('.drow-t')!.textContent).toBe('Re-run checks')
    expect(row.querySelector('.drow-s')!.textContent).toContain('org-os-buzz')
    expect(row.querySelector('time')!.textContent).toBe('2026-10-16 22:14')
    expect(row.querySelector('time')!.getAttribute('dateTime')).toBe(created)
    // the result is the job's status mark, in words (C8: jobs.tsx's running status)
    expect(screen.getByText('Finished with surprises').closest('.smark-failed')).not.toBeNull()
    expect(screen.getByText('Finished, and changed files it does not declare: stray.md.')).toBeTruthy()
  })

  it('says so when nothing has run, and says why when the list cannot be read', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources': [], 'GET /api/jobs': [] })
    renderAt(<Activity />)
    expect(await screen.findByText('No operations have run yet.')).toBeTruthy()
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources': [], 'GET /api/jobs': refuse(500, { error: 'the job store cannot be read' }) })
    const again = renderAt(<Activity />)
    expect((await findErrorNote(again.container)).textContent).toContain('the job store cannot be read')
  })
})

describe('Activity while loading', () => {
  it('shows Loading… and not the empty sentence until the jobs answer', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const { fn } = fetchRoutes({ ...baseRoutes(), 'GET /api/resources': [], 'GET /api/jobs': [] })
    vi.stubGlobal('fetch', async (i: RequestInfo | URL, init?: RequestInit) => { if (String(i).includes('/api/jobs')) await gate; return fn(i, init) })
    renderAt(<Activity />)
    expect(await screen.findByRole('region', { name: 'Loading Activity' })).toBeTruthy()
    expect(screen.queryByText('No operations have run yet.')).toBeNull()
    release()
    expect(await screen.findByText('No operations have run yet.')).toBeTruthy()
  })
})
