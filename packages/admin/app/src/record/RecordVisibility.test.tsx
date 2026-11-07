// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { VisibilityView } from '../api.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, refuse } from '../test/data.ts'
import { proposalView } from '../test/fixtures/proposals.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { houseSource } from '../session/houseSource.ts'
import { RecordVisibility } from './RecordVisibility.tsx'
import { useChanges } from '../changes/useChanges.ts'

/** The record page's wiring: its own change's ops on this record, and the tray's stage. */
function OnPage({ entry, onError }: { entry: Record<string, unknown>; onError(s: string | null): void }) {
  const changes = useChanges()
  return <RecordVisibility registry="projects" id="p1" entry={entry} onError={onError}
    staged={(changes.view?.ops ?? []).filter(o => o.record === 'projects:p1')} stage={changes.stage} />
}

// L5 spec §9.7, §9.8, §11.4: the visibility control's caller on a record. Who sees it is GET /api/visibility's `writable`
// (Q77: the server's narrowing predicate); a narrowing posts POST /api/visibility/narrow, asking first with §9.7's sentence
// when the thing leaves git; a widening is staged as a publication through the tray.
const CELO = 'eip155:42220'
const hat = (levels: string) => `${CELO}:0x0000000d${levels.padEnd(56, '0')}`
const TOP = hat(''), COUNCIL = hat('0001'), OPS = hat('0002')
const LEAVES_GIT = "It leaves the repository from now on. Its earlier versions stay in the repository's history, which members could already read."
const VIEW: VisibilityView = {
  tree: [{ hat: TOP, name: 'Top', above: [] }, { hat: COUNCIL, name: 'Council', above: [TOP] }, { hat: OPS, name: 'Ops', above: [TOP] }],
  worn: [OPS], levels: ['public', 'members', `hat:${OPS}`], config: { collections: {}, defaults: {} }, writable: ['projects'],
}
const ENTRY = { id: 'p1', title: 'Project one', visibility: 'members' }

function draw(o: { view?: VisibilityView; entry?: Record<string, unknown>; previewing?: boolean; routes?: Record<string, unknown> } = {}) {
  const view = o.view ?? VIEW
  const net = fetchRoutes({ ...baseRoutes(), 'GET /api/visibility': view, 'GET /api/proposals': [], ...o.routes })
  const onError = vi.fn()
  const out = renderAt(
    <ViewAsProvider source={houseSource(view)} initial={o.previewing ? { as: 'members' } : undefined}>
      <OnPage entry={o.entry ?? ENTRY} onError={onError} />
    </ViewAsProvider>)
  return { ...out, ...net, onError }
}
const control = (name: RegExp = /^Members/) => screen.findByRole('button', { name })
const choose = async (name: string, from?: RegExp) => {
  fireEvent.click(await control(from))
  fireEvent.click(screen.getByRole('menuitemradio', { name }))
}
const posted = (calls: { method: string; path: string; body: unknown }[], path: string) => calls.filter(c => c.method === 'POST' && c.path === path)

describe('who is drawn the control (§9.8, Q77)', () => {
  it('a member who may write the collection gets the control; one who may not, the marker alone', async () => {
    draw()
    expect((await control()).getAttribute('aria-haspopup')).toBe('menu')
  })

  it('the marker alone, no control, when GET /api/visibility does not list the collection as writable', async () => {
    const { container } = draw({ view: { ...VIEW, writable: [] } })
    await waitFor(() => expect(container.querySelector('.vis')?.textContent).toBe('Members'))
    expect(screen.queryByRole('button', { name: /^Members/ })).toBeNull()
  })

  it('the marker alone while previewing (nothing can be changed there)', async () => {
    const { container } = draw({ previewing: true })
    await waitFor(() => expect(container.querySelector('.vis')?.textContent).toBe('Members'))
    expect(screen.queryByRole('button', { name: /^Members/ })).toBeNull()
  })
})

describe('the control\'s writes (§11.4)', () => {
  it('a narrowing that leaves git asks with the §9.7 sentence before posting; Cancel posts nothing', async () => {
    const { calls } = draw({ routes: { 'POST /api/visibility/narrow': { commit: 'c1', moved: true } } })
    await choose('Hat: Ops')
    const dialog = screen.getByRole('dialog', { name: 'Narrow to Hat: Ops?' })
    expect(dialog.textContent).toContain(LEAVES_GIT)
    expect(posted(calls, '/api/visibility/narrow')).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posted(calls, '/api/visibility/narrow')).toEqual([])
    await choose('Hat: Ops')
    fireEvent.click(screen.getByRole('button', { name: 'Narrow to Hat: Ops' }))
    await waitFor(() => expect(posted(calls, '/api/visibility/narrow').map(c => c.body)).toEqual([{ target: { registry: 'projects', id: 'p1' }, level: `hat:${OPS}` }]))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a narrowing that stays in git (public → members) posts at once, with no question', async () => {
    const { calls } = draw({ entry: { ...ENTRY, visibility: 'public' }, routes: { 'POST /api/visibility/narrow': { commit: 'c1', moved: false } } })
    await choose('Members', /^Public/)
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(posted(calls, '/api/visibility/narrow').map(c => c.body)).toEqual([{ target: { registry: 'projects', id: 'p1' }, level: 'members' }]))
  })

  it('a refused narrowing is said in the server\'s words', async () => {
    const sentence = 'You cannot change projects, so you cannot narrow it: "steward-a" does not hold the ops role, which rule "people" asks of whoever proposes. Nothing was written.'
    const { onError } = draw({ entry: { ...ENTRY, visibility: 'public' }, routes: { 'POST /api/visibility/narrow': refuse(403, { code: 'MAY_NOT_WRITE', error: sentence }) } })
    await choose('Members', /^Public/)
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith(sentence))
  })

  it('a widening stages and the control reads "Members → Public, proposed"', async () => {
    let staged = changeView()
    const { calls } = draw({ routes: {
      'GET /api/changes': () => staged,
      'POST /api/changes/ops': (init: RequestInit | undefined) => {
        const { ops } = JSON.parse(String(init!.body)) as { ops: Record<string, unknown>[] }
        staged = changeView({ ops: ops.map(op => ({ ...op, base: 'h1', before: ENTRY })) as never, classes: ['records', 'publication'] })
        return staged
      },
    } })
    await choose('Public')
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(posted(calls, '/api/changes/ops').map(c => c.body)).toEqual([{ ops: [{ op: 'update', record: 'projects:p1', set: { visibility: 'public' } }] }]))
    expect(posted(calls, '/api/visibility/narrow')).toEqual([])
    const b = await screen.findByRole('button', { name: 'Members → Public, proposed' })
    expect(b.querySelector('.vis-to')!.textContent).toBe('Public, proposed')
  })

  it('an open proposal that widens it reads as proposed too, for a reader who may not change it', async () => {
    const open = proposalView({ id: 'p-9', author: 'steward-b', ops: [{ op: 'update', record: 'projects:p1', set: { visibility: 'public' }, base: 'h1' }] as never })
    const { container } = draw({ view: { ...VIEW, writable: [] }, routes: { 'GET /api/proposals': [open] } })
    await waitFor(() => expect(container.querySelector('.vis')?.textContent).toBe('Members → Public, proposed'))
  })

  it('a private record is offered only hats: it does not move into the repository from here (R-L5-16.8)', async () => {
    draw({ entry: { ...ENTRY, visibility: `hat:${OPS}` } })
    fireEvent.click(await control(/^Hat: Ops/))
    expect(screen.queryByRole('menuitemradio', { name: 'Public' })).toBeNull()
    expect(screen.queryByRole('menuitemradio', { name: 'Members' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'Hat: Ops' })).toBeTruthy()
    await act(async () => {})
  })
})
