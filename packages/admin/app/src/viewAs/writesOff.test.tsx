// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import Tray from '../changes/Tray.tsx'
import ProposePanel from '../changes/ProposePanel.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView } from '../test/data.ts'

// Lane 3 Task 11 (C1): while the Hub's writes are off, the client offers no write. It reads the switch from the status
// the frame already holds (GET /api/status says `instanceWrites: 'off'`), and asks the server nothing more for it.

afterEach(() => vi.unstubAllGlobals())

const SENTENCE = 'Rule "records" needs 1 approval from the maintainer, so it cannot be applied alone. Propose it instead.'
const op = { op: 'update' as const, record: 'projects:garden-seat', set: { stage: 'develop' }, base: 'h', before: { stage: 'discovery' } }
const needsProposal = changeView({ ops: [op], classes: ['records'], rule: { direct: false, proposable: true, sentence: SENTENCE, source: 'data/governance.yaml: records' } })

function mount(status: Record<string, unknown>) {
  const { calls } = fetchRoutes(baseRoutes({ 'GET /api/changes': needsProposal }))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['status'], status)
  renderAt(<><Tray /><ProposePanel /></>, '/', { queryClient })
  return calls
}

describe('the UI while writes are off (Lane 3 Task 11)', () => {
  it('the UI hides write controls when instanceWrites is off', async () => {
    const calls = mount({ org: 'Example Org', branch: 'main', dirty: false, instanceWrites: 'off' })
    await waitFor(() => expect(calls.some(c => c.path === '/api/changes')).toBe(true))
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByRole('region', { name: 'Changes' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Propose' })).toBeNull()
    expect(calls.filter(c => c.path === '/api/status')).toEqual([])
  })

  it('with writes on (no instanceWrites in the status), the same change offers the tray and Propose', async () => {
    mount({ org: 'Example Org', branch: 'main', dirty: false })
    expect(await screen.findByRole('region', { name: 'Changes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Propose' })).toBeTruthy()
  })
})
