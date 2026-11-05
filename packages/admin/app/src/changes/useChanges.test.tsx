// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useChanges } from './useChanges.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { changeView } from '../test/data.ts'

const op = { op: 'update' as const, record: 'projects:p1', set: { status: 'execute' }, base: 'h', before: { id: 'p1', status: 'develop' } }
function Probe() {
  const c = useChanges()
  return <>
    <span data-testid="n">{c.view ? String(c.view.ops.length) : '-'}</span>
    <button onClick={() => void c.stage([{ op: 'update', record: 'projects:p1', set: { status: 'execute' } }])}>stage</button>
    <button onClick={() => void c.discard()}>discard</button>
  </>
}

describe('useChanges', () => {
  it("stages ops and keeps the server's answer as the change; discard re-reads it", async () => {
    let held = changeView()
    const { calls } = fetchRoutes({
      'GET /api/changes': () => held,
      'POST /api/changes/ops': () => { held = changeView({ ops: [op] }); return held },
      'DELETE /api/changes': () => { held = changeView(); return new Response(null, { status: 204 }) },
    })
    renderAt(<Probe />)
    await waitFor(() => expect(screen.getByTestId('n').textContent).toBe('0'))
    fireEvent.click(screen.getByText('stage'))
    await waitFor(() => expect(screen.getByTestId('n').textContent).toBe('1'))
    expect(calls.filter(c => c.path === '/api/changes')).toHaveLength(1) // the stage answer is the change: no refetch
    fireEvent.click(screen.getByText('discard'))
    await waitFor(() => expect(screen.getByTestId('n').textContent).toBe('0'))
  })
})
