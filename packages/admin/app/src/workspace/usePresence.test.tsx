// @vitest-environment jsdom
// DAO-OS L6 Task 18: presence on a page (§8.4) — beats while open, stops on leave, the bar shows who else is there, and
// an event for another target changes nothing here.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes } from '../test/data.ts'
import { PAGE_NODES, pageReadOf } from '../test/fixtures/house/workspace.ts'
import { handleEvent } from '../events.ts'
import PagePage from './PagePage.tsx'
import { PRESENCE_BEAT_MS } from './usePresence.ts'

const ID = 'treasury-3c4d'
const TARGET = `page:${ID}`
const BODY = 'The treasury is one Safe at the same address on seven chains.\n'
const OTHER = { handle: 'steward-b', role: 'Steward B', editing: true }

beforeEach(() => { sessionStorage.clear() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); sessionStorage.clear() })

function routes(over: Record<string, unknown> = {}) {
  return fetchRoutes({
    ...baseRoutes(),
    'GET /api/pages': PAGE_NODES,
    [`GET /api/pages/${ID}`]: pageReadOf(ID, { visibility: 'members' }),
    'GET /api/presence': { [TARGET]: [] },
    'POST /api/presence': { target: TARGET, people: [OTHER] },
    'POST /api/reads': { target: TARGET, at: '2026-10-31T09:00:00.000Z', read: 0 },
    [`POST /api/pages/${ID}/sessions`]: { session: 'ses_1', base: 'b0', markdown: BODY },
    'PUT /api/sessions/ses_1': { save: 'direct' },
    'POST /api/sessions/ses_1/close': { commit: null },
    ...over,
  })
}
/** Polls `ok` on real time (setTimeout is not faked here). */
async function until(ok: () => boolean, ms = 4000) {
  for (const end = Date.now() + ms; !ok(); ) {
    if (Date.now() > end) throw new Error('timed out')
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  }
}
const beats = (calls: { method: string; path: string; body: unknown }[]) => calls.filter(c => c.method === 'POST' && c.path === '/api/presence')

describe('presence on a page (§8.4, Task 18)', () => {
  it('beats every 20 s while open and stops on leave; the editor bar shows who else is editing', async () => {
    expect(PRESENCE_BEAT_MS).toBe(20000) // the spec's constant, as server/workspace/presence.ts has it
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    // the server answers the same people to a beat and to a read
    const { calls } = routes({ 'GET /api/presence': { [TARGET]: [OTHER] } })
    const ui = renderAt(<PagePage id={ID} />, `/p/${ID}`)
    // the first beat as soon as the page is open, then `editing` once the session is (polled on real time: vi.waitFor
    // would move the faked interval on)
    await until(() => (beats(calls).at(-1)?.body as { editing?: boolean } | undefined)?.editing === true)
    await until(() => screen.queryByRole('img', { name: 'Steward B is editing' }) !== null)
    const before = beats(calls).length
    await act(async () => { vi.advanceTimersByTime(PRESENCE_BEAT_MS - 1) })
    expect(beats(calls)).toHaveLength(before)
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(beats(calls)).toHaveLength(before + 1)
    await act(async () => { vi.advanceTimersByTime(PRESENCE_BEAT_MS) })
    expect(beats(calls)).toHaveLength(before + 2)
    expect(beats(calls).at(-1)!.body).toEqual({ target: TARGET, editing: true })
    // left: no beat after (the server lets the entry lapse)
    ui.unmount()
    await act(async () => { vi.advanceTimersByTime(3 * PRESENCE_BEAT_MS) })
    expect(beats(calls)).toHaveLength(before + 2)
  })

  it('a hidden tab stops beating and beats at once when shown again (fix round 1)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let hidden = false
    const hiddenProp = vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    const { calls } = routes({ 'GET /api/presence': { [TARGET]: [OTHER] } })
    renderAt(<PagePage id={ID} />, `/p/${ID}`)
    await until(() => (beats(calls).at(-1)?.body as { editing?: boolean } | undefined)?.editing === true)
    const before = beats(calls).length
    hidden = true
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { vi.advanceTimersByTime(3 * PRESENCE_BEAT_MS) })
    expect(beats(calls)).toHaveLength(before)
    hidden = false
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await until(() => beats(calls).length === before + 1)
    await act(async () => { vi.advanceTimersByTime(PRESENCE_BEAT_MS) })
    expect(beats(calls)).toHaveLength(before + 2)
    hiddenProp.mockRestore()
  })

  it('a reader who may not write beats as reading', async () => {
    const { calls } = routes({ [`GET /api/pages/${ID}`]: pageReadOf(ID, { visibility: 'members', mode: 'none' }) })
    renderAt(<PagePage id={ID} />, `/p/${ID}`)
    await vi.waitFor(() => expect(beats(calls).length).toBeGreaterThanOrEqual(1), { timeout: 4000 })
    expect(beats(calls).every(b => (b.body as { editing: boolean }).editing === false)).toBe(true)
  })

  it('a `presence` event for a page not shown is ignored', async () => {
    const { calls } = routes({ 'POST /api/presence': { target: TARGET, people: [] } })
    const { qc } = renderAt(<PagePage id={ID} />, `/p/${ID}`)
    await screen.findByRole('textbox', { name: 'How the treasury is run · page body' }, { timeout: 4000 })
    await vi.waitFor(() => expect(beats(calls).length).toBeGreaterThanOrEqual(1))
    const reads = () => calls.filter(c => c.method === 'GET' && c.path.startsWith('/api/presence')).length
    const was = reads()
    act(() => handleEvent({ type: 'presence', target: 'page:another-9f9f', people: [{ handle: 'steward-c', role: 'Steward C' }] }, qc))
    await new Promise(r => setTimeout(r, 50))
    expect(reads()).toBe(was)
    expect(screen.queryByRole('img', { name: /Steward C/ })).toBeNull()
    // this page's own event reads who is here again: from the server, not from the event
    act(() => handleEvent({ type: 'presence', target: TARGET, people: [{ handle: 'steward-c', role: 'Steward C' }] }, qc))
    await vi.waitFor(() => expect(reads()).toBe(was + 1))
    expect(screen.queryByRole('img', { name: /Steward C/ })).toBeNull()
  })
})
