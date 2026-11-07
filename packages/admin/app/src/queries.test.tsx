// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { useSystemsRead } from './queries.ts'
import { fetchRoutes } from './test/fetchRoutes.ts'
import { renderAt } from './test/render.tsx'
import { baseRoutes } from './test/data.ts'

/** Where one reader's read of data/systems.yaml stands, in words. */
function Probe({ name }: { name: string }) {
  const { entries, pending, error } = useSystemsRead()
  const said = pending ? 'pending' : error ? `error: ${error.message}` : `read: ${entries.size}`
  return <p data-testid={name}>{said}</p>
}

afterEach(() => vi.unstubAllGlobals())

describe('useSystemsRead', () => {
  it('keeps a failed read for a reader that mounts later, until its refetch succeeds (DP-51, deferred minor 1)', async () => {
    let calls = 0
    let answer: (r: Response) => void = () => {}
    fetchRoutes({ ...baseRoutes(), 'GET /api/registries/systems': () => {
      calls++
      if (calls === 1) return new Response(JSON.stringify({ error: 'data/systems.yaml cannot be read' }), { status: 500 })
      return new Promise<Response>(r => { answer = r })
    } })
    const { rerender } = renderAt(<><Probe name="a" /></>)
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('error: data/systems.yaml cannot be read'))
    // a reader that mounts now sets off a refetch: while it is out, neither reader draws the empty answer
    rerender(<><Probe name="a" /><Probe name="b" /></>)
    await waitFor(() => expect(calls).toBe(2))
    expect(screen.getByTestId('b').textContent).toBe('error: data/systems.yaml cannot be read')
    expect(screen.getByTestId('a').textContent).toBe('error: data/systems.yaml cannot be read')
    answer(new Response(JSON.stringify({ name: 'systems', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'safe', section: 'organization/treasury' }] })))
    await waitFor(() => expect(screen.getByTestId('b').textContent).toBe('read: 1'))
    expect(screen.getByTestId('a').textContent).toBe('read: 1')
  })
})
