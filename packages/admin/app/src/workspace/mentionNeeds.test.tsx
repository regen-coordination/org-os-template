// @vitest-environment jsdom
// DAO-OS L6 Task 18: mentions as rows of Needs you (§8.3, §15) — the server's unread notifications beside 0.6's attention;
// opening the target marks them read, and the row goes.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import { handleEvent } from '../events.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes } from '../test/data.ts'
import { PAGE_NODES, pageReadOf } from '../test/fixtures/house/workspace.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { FIXTURE_SOURCE } from '../viewAs/visibility.ts'
import Needs from '../pages/Needs.tsx'
import PagePage from './PagePage.tsx'
import { mentionNeeds, targetHref } from './mentionNeeds.ts'
import { entryHref } from '../hrefs.ts'

const ID = 'treasury-3c4d'
const TARGET = `page:${ID}`
const BODY = 'The treasury is one Safe at the same address on seven chains.\n'
const NOW = new Date('2026-10-31T09:00:00.000Z')
const row = (over: Record<string, unknown> = {}) => ({
  id: 'ntf_1', kind: 'mention', target: TARGET, title: 'How the treasury is run', by: { handle: 'steward-b', role: 'Steward B' },
  at: '2026-10-31T08:55:00.000Z', read: false, text: 'Steward B mentioned you on How the treasury is run', source: 'comment:cmt_1',
  visibility: 'members', ...over,
})

beforeEach(() => { sessionStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear() })

describe('mentions in Needs you (§8.3, Task 18)', () => {
  it('a mention row appears in Needs you and opening the page clears it', async () => {
    let read = false
    const { calls } = fetchRoutes({
      ...baseRoutes(),
      'GET /api/resources': [], 'GET /api/proposals': [],
      'GET /api/notifications': () => [row({ read })],
      'POST /api/reads': () => { read = true; return { target: TARGET, at: NOW.toISOString(), read: 1 } },
      'GET /api/pages': PAGE_NODES,
      [`GET /api/pages/${ID}`]: pageReadOf(ID, { visibility: 'members' }),
      'GET /api/presence': {}, 'POST /api/presence': { target: TARGET, people: [] },
      [`POST /api/pages/${ID}/sessions`]: { session: 'ses_1', base: 'b0', markdown: BODY },
      'POST /api/sessions/ses_1/close': { commit: null },
    })
    const ui = renderAt(<Needs />, '/needs')
    const list = await screen.findByRole('list', { name: 'Needs you' })
    const link = within(list).getByRole('link', { name: /Steward B mentioned you on How the treasury is run/ })
    expect(link.getAttribute('href')).toBe(`/p/${ID}`)
    expect(calls.filter(c => c.path === '/api/reads')).toHaveLength(0)

    // the page opened beside it: its notifications are marked read, and Needs you reads them again
    ui.rerender(<><Needs /><PagePage id={ID} /></>)
    await vi.waitFor(() => expect(calls.filter(c => c.method === 'POST' && c.path === '/api/reads')[0]?.body).toEqual({ target: TARGET }))
    expect(await screen.findByText('Nothing waits on you.')).toBeTruthy()
    expect(screen.queryByText(/mentioned you on/)).toBeNull()
  })

  it('a mention that arrives while its page is open is marked read (fix round 1)', async () => {
    let rows: ReturnType<typeof row>[] = []
    const { calls } = fetchRoutes({
      ...baseRoutes(),
      'GET /api/notifications': () => rows,
      'POST /api/reads': () => { const n = rows.filter(r => !r.read).length; rows = rows.map(r => ({ ...r, read: true })); return { target: TARGET, at: NOW.toISOString(), read: n } },
      'GET /api/pages': PAGE_NODES,
      [`GET /api/pages/${ID}`]: pageReadOf(ID, { visibility: 'members' }),
      'GET /api/presence': {}, 'POST /api/presence': { target: TARGET, people: [] },
      [`POST /api/pages/${ID}/sessions`]: { session: 'ses_1', base: 'b0', markdown: BODY },
      'POST /api/sessions/ses_1/close': { commit: null },
    })
    const { qc } = renderAt(<PagePage id={ID} />, `/p/${ID}`)
    const reads = () => calls.filter(c => c.method === 'POST' && c.path === '/api/reads')
    await vi.waitFor(() => expect(reads()).toHaveLength(1))
    // a mention is told while the page is open: the server's `conversation` event makes the notifications stale
    rows = [row()]
    act(() => handleEvent({ type: 'conversation', target: TARGET }, qc))
    await vi.waitFor(() => expect(reads()).toHaveLength(2))
    await vi.waitFor(() => expect((qc.getQueryData(['notifications']) as { read: boolean }[] | undefined)?.every(n => n.read)).toBe(true))
  })

  it('reads only unread rows, each opening its target, and a preview drops one it may not see', async () => {
    const rows = [
      row(),
      row({ id: 'ntf_2', read: true, text: 'Steward C mentioned you on Old notes' }),
      row({ id: 'ntf_3', target: 'record:tasks:count-the-signers', title: 'Count the signers', text: 'Steward C mentioned you on Count the signers', visibility: 'hat:ops' }),
    ]
    const items = mentionNeeds(rows as never, NOW)
    expect(items.map(i => [i.kind, i.title, i.href])).toEqual([
      ['mention', 'Steward B mentioned you on How the treasury is run', `/p/${ID}`],
      ['mention', 'Steward C mentioned you on Count the signers', entryHref('tasks', 'count-the-signers')],
    ])
    expect(targetHref('record:tasks:count-the-signers')).toBe(entryHref('tasks', 'count-the-signers'))
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources': [], 'GET /api/proposals': [], 'GET /api/notifications': rows })
    renderAt(<ViewAsProvider source={FIXTURE_SOURCE} initial={{ as: 'members' }}><Needs /></ViewAsProvider>, '/needs')
    const list = await screen.findByRole('list', { name: 'Needs you' })
    expect(within(list).getAllByRole('link').map(a => a.querySelector('.need-t')!.textContent)).toEqual(['Steward B mentioned you on How the treasury is run'])
  })
})
