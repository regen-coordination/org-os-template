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

  it('Apply and Keep mine / Take theirs make every file read by the source editor stale (T19 review I3)', async () => {
    fetchRoutes({
      'GET /api/changes': () => changeView({ ops: [op] }),
      'POST /api/changes/ops/0/rebase': () => changeView(),
      'POST /api/changes/apply': () => ({ commit: 'abc1234' }),
    })
    function Acts() {
      const c = useChanges()
      return <><button onClick={() => void c.rebase(0, 'theirs')}>rebase</button><button onClick={() => void c.apply()}>apply</button></>
    }
    const { qc } = renderAt(<Acts />)
    for (const act of ['rebase', 'apply']) {
      qc.setQueryData(['file', 'data/governance.yaml'], { path: 'data/governance.yaml', text: '', base: 'b1', class: 'governance', editor: 'rules+source' })
      fireEvent.click(screen.getByText(act))
      await waitFor(() => expect(qc.getQueryState(['file', 'data/governance.yaml'])!.isInvalidated).toBe(true))
    }
  })
})
