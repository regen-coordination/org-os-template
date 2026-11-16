// @vitest-environment jsdom
// DAO-OS L6 Task 16 (coordinator ruling on merge M2's Record.tsx concern): a viewer who may not change a record's
// visibility still sees the level in flight — "Members → Public, proposed" — beside the record header's marker, when an
// open proposal they may see (the server answers only those) widens it.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import type { VisibilityView } from '../api.ts'
import { page, projectRoutes } from '../test/record.tsx'
import { proposalView } from '../test/fixtures/proposals.ts'

afterEach(() => vi.unstubAllGlobals())

const VIEW: VisibilityView = { tree: [], worn: [], levels: ['public', 'members'], config: { collections: {}, defaults: {} }, writable: [] }
const widening = proposalView({ id: 'p-2026-10-30-001', ops: [{ op: 'update', record: 'projects:p1', set: { visibility: 'public' }, base: 'h1' }] as never })

describe('the record header’s marker, for a viewer who may not change the level', () => {
  it('reads "Members → Public, proposed" while an open proposal widens the record', async () => {
    projectRoutes({ 'GET /api/visibility': VIEW, 'GET /api/proposals': [widening] })
    const { container } = page('/r/project/p1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Seed Library' })).toBeTruthy()
    await waitFor(() => expect(container.querySelector('header.rh .vis')?.textContent).toBe('Members → Public, proposed'))
    expect(container.querySelector('header.rh .vis-to')!.textContent).toBe('Public, proposed')
    expect(screen.queryByRole('button', { name: /^Members/ })).toBeNull() // the marker, not the control
  })

  it('reads the level alone with nothing in flight, or a proposal that is closed', async () => {
    projectRoutes({ 'GET /api/visibility': VIEW, 'GET /api/proposals': [{ ...widening, state: 'ratified' }] })
    const { container } = page('/r/project/p1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Seed Library' })).toBeTruthy()
    await waitFor(() => expect(container.querySelector('header.rh .vis')?.textContent).toBe('Members'))
  })
})

// DAO-OS L6 Task 20 review M4: while a move of the record into the repository is staged, an edit would leave the move stale
// (its digest pins the record): Edit is not drawn, and a note says why.
describe('a record whose move is staged (M4)', () => {
  it('draws no Edit and says the move would go stale', async () => {
    const moving = { ops: [], private: [{ ref: 'stg-1', class: 'records', op: { op: 'move-to-git', collection: 'projects', id: 'p1', level: 'members' } }],
      classes: ['records'], rule: { direct: true, sentence: '', source: '' }, stale: [], current: [], state: 'staged', id: 'chg_1', actor: 'steward-a', created: '', updated: '' }
    projectRoutes({ 'GET /api/visibility': VIEW, 'GET /api/changes': moving })
    page('/r/project/p1')
    expect(await screen.findByText('A move of this record into the repository is staged: an edit now would leave the move stale. Apply or discard it first.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('K5: draws no Edit while an open proposal holds the move, and names the proposal', async () => {
    const moving = proposalView({ id: 'p-9', ops: [{ op: 'private', ref: 'stg-1', class: 'records', publication: true }] as never,
      private: [{ ref: 'stg-1', class: 'records', op: { op: 'move-to-git', collection: 'projects', id: 'p1', level: 'members' } }] } as never)
    projectRoutes({ 'GET /api/visibility': VIEW, 'GET /api/proposals': [moving] })
    page('/r/project/p1')
    expect(await screen.findByText('A move of this record into the repository is proposed in p-9: an edit now would leave the move stale. Decide or withdraw the proposal first.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('draws Edit with no move staged', async () => {
    projectRoutes({ 'GET /api/visibility': VIEW })
    page('/r/project/p1')
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy()
  })
})
