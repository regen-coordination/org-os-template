// @vitest-environment jsdom
// packages/admin/app/src/blocks/kanban.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createEvent, fireEvent as rtlFire, screen, waitFor, within } from '@testing-library/react'
import { BlockFrame, blockType } from './index.ts'
import { groupCards, moveOps, stagedValue, OTHER } from './kanban.tsx'
import { renderAt } from '../test/render.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { SYSTEMS_UNREAD, baseRoutes, changeView, entryPlacedSafe, refuse, resource } from '../test/data.ts'

// jsdom has no PointerEvent: the init's pointerId, buttons and coordinates are dropped, so they are set on the event itself.
const fireEvent = Object.assign((el: Element | Document, ev: Event) => rtlFire(el, ev), rtlFire) as typeof rtlFire
for (const name of ['pointerDown', 'pointerMove', 'pointerUp', 'pointerCancel'] as const) {
  fireEvent[name] = ((el: Element, init: { pointerId?: number; buttons?: number; clientX?: number; clientY?: number } = {}) => {
    const ev = createEvent[name](el, init)
    Object.defineProperty(ev, 'clientX', { value: init.clientX ?? 0 })
    Object.defineProperty(ev, 'clientY', { value: init.clientY ?? 0 })
    Object.defineProperty(ev, 'pointerId', { value: init.pointerId })
    Object.defineProperty(ev, 'buttons', { value: init.buttons ?? 0 })
    return rtlFire(el, ev)
  }) as never
}
const p = (id: string, status: string | null, entityId: string | null = id) => resource({ id: `project:${id}`, name: id.toUpperCase(), status,
  source: entityId === null ? null : { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId } })
const cfg = { title: 'Pipeline', source: { kind: 'project' }, view: { group: 'status', columns: ['idea', 'active', 'done'] } }
const column = (name: string) => screen.getByRole('list', { name })

describe('a kanban tile’s facts (walk 2026-11-04, L4c-fix 8)', () => {
  it('names a project’s lead by their member record, as the record page does', async () => {
    const led = resource({ id: 'project:a', name: 'A', status: 'idea', facts: { lead: 'steward-a' }, source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'a' } })
    const person = resource({ id: 'person:steward-a', kind: 'person', name: 'Steward A', source: { path: 'data/members.yaml', editable: true, registry: 'members', entityId: 'steward-a' } })
    fetchRoutes(baseRoutes({ 'GET /api/resources': [led, person],
      'GET /api/registries/members': { name: 'members', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'steward-a', name: 'Steward A' }] },
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'a', lead: 'steward-a' }] } }))
    renderAt(<BlockFrame def={blockType('kanban')!} cfg={cfg} id="k" />)
    await waitFor(() => expect([...document.querySelectorAll('.kcard-fact')].map(f => f.textContent)).toContain('Steward A'))
    expect([...document.querySelectorAll('.kcard-fact')].map(f => f.textContent)).not.toContain('steward-a')
  })

  it('reads a lead whose member name the file restricts "<hat> only", never the name (review I-3, D-12)', async () => {
    const led = resource({ id: 'project:a', name: 'A', status: 'idea', facts: { lead: 'steward-a' }, source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'a' } })
    const person = resource({ id: 'person:steward-a', kind: 'person', name: 'Steward A', source: { path: 'data/members.yaml', editable: true, registry: 'members', entityId: 'steward-a' } })
    fetchRoutes(baseRoutes({ 'GET /api/resources': [led, person],
      'GET /api/registries/members': { name: 'members', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'steward-a', name: 'Steward A', restricted: { name: 'hat:ops' } }] },
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'a', lead: 'steward-a' }] } }))
    renderAt(<BlockFrame def={blockType('kanban')!} cfg={cfg} id="k" />)
    await waitFor(() => expect([...document.querySelectorAll('.kcard-fact')].map(f => f.textContent)).toContain('Ops only'))
    expect(document.body.textContent).not.toContain('Steward A')
  })
})

describe('kanban helpers', () => {
  it('groups by the field, and keeps a value no column holds in the trailing other column (Review Focus 3)', () => {
    const g = groupCards([p('a', 'idea'), p('b', 'archive'), p('c', 'done')], 'status', ['idea', 'active', 'done'], r => r.status)
    expect([...g.keys()]).toEqual(['idea', 'active', 'done', OTHER])
    expect(g.get(OTHER)!.map(r => r.id)).toEqual(['project:b'])
  })
  it('leaves out the other column when nothing is in it', () => {
    expect([...groupCards([p('a', 'idea')], 'status', ['idea'], r => r.status).keys()]).toEqual(['idea'])
  })
  it('moves by staging the group field on the record', () => {
    expect(moveOps(p('a', 'idea'), 'status', 'done')).toEqual([{ op: 'update', record: 'projects:a', set: { status: 'done' } }])
    expect(moveOps(p('x', 'idea', null), 'status', 'done')).toEqual([])
  })
  it('reads a staged value before the file\'s', () => {
    const view = changeView({ ops: [{ op: 'update', record: 'projects:a', set: { status: 'done' }, base: 'h', before: { status: 'idea' } }] })
    expect(stagedValue(p('a', 'idea'), 'status', view)).toBe('done')
    expect(stagedValue(p('b', 'idea'), 'status', view)).toBeUndefined()
  })
})

describe('a column named other', () => {
  it('keeps its own cards, and the overflow bucket stays apart', () => {
    const g = groupCards([p('a', 'other'), p('b', 'archive')], 'status', ['idea', 'other'], r => r.status)
    expect(g.get('other')!.map(r => r.id)).toEqual(['project:a'])
    expect(g.get(OTHER)!.map(r => r.id)).toEqual(['project:b'])
  })
})

describe('the kanban block', () => {
  let calls: { method: string; path: string; body: unknown }[]
  beforeEach(() => {
    ({ calls } = fetchRoutes(baseRoutes({
      'GET /api/resources': [p('a', 'idea'), p('b', 'archive'), p('x', 'idea', null)],
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: null, entries: [] },
      'POST /api/changes/ops': changeView({ ops: [{ op: 'update', record: 'projects:a', set: { status: 'active' }, base: 'h', before: { status: 'idea' } }] }),
    })))
  })
  const draw = () => renderAt(<BlockFrame def={blockType('kanban')!} id="k" cfg={cfg} />)

  it('draws a column per value, and the other column for the rest', async () => {
    draw()
    await screen.findByRole('list', { name: 'idea' })
    expect(within(column('idea')).getByText('A')).toBeTruthy()
    expect(within(column('other')).getByText('B')).toBeTruthy()
  })

  // L4c C2 (ledger): the 0.6 "Move … to" select became the board card's Move to… menu (§10.2, E-9).
  const moveTo = async (name: string, column: string) => {
    fireEvent.click(await screen.findByRole('button', { name: `Move to… ${name}` }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: column }))
  }

  it('moves a card with Move to…, staging exactly one op', async () => {
    draw()
    await moveTo('A', 'active')
    await waitFor(() => expect(calls.filter(c => c.method === 'POST')).toHaveLength(1))
    expect(calls.find(c => c.method === 'POST')!.body).toEqual({ ops: [{ op: 'update', record: 'projects:a', set: { status: 'active' } }] })
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('Moved A to active.'))
  })

  it('moves a card by keyboard: Space lifts it, the arrows carry it, Space drops it', async () => {
    draw()
    const card = (await screen.findByText('A')).closest('[data-card]') as HTMLElement
    card.focus()
    fireEvent.keyDown(card, { key: ' ' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    fireEvent.keyDown(document.activeElement!, { key: ' ' })
    await waitFor(() => expect(calls.find(c => c.method === 'POST')!.body).toEqual({ ops: [{ op: 'update', record: 'projects:a', set: { status: 'active' } }] }))
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('Moved A to active.'))
  })

  it('offers no other column as a target, and moves a card out of it', async () => {
    draw()
    const items = (name: string) => within(screen.getByRole('menu', { name: `Move to… ${name}` })).getAllByRole('menuitemradio')
    fireEvent.click(await screen.findByRole('button', { name: 'Move to… A' }))
    expect(items('A').map(o => o.textContent)).toEqual(['idea', 'active', 'done'])
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Move to… A' }), { key: 'Escape' })
    // the column a card is in is its checked item; no card is moved into "other"
    fireEvent.click(screen.getByRole('button', { name: 'Move to… B' }))
    expect(items('B').map(o => o.textContent)).toEqual(['idea', 'active', 'done', 'other'])
    expect(items('B')[3]!.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(items('B')[0]!)
    await waitFor(() => expect(calls.find(c => c.method === 'POST')!.body).toEqual({ ops: [{ op: 'update', record: 'projects:b', set: { status: 'idea' } }] }))
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('Moved B to idea.'))
  })

  it('cannot move a record with no id in its file, and says why', async () => {
    draw()
    fireEvent.click(await screen.findByRole('button', { name: 'Move to… X' }))
    const items = screen.getAllByRole('menuitemradio')
    expect(items.every(i => i.getAttribute('aria-disabled') === 'true')).toBe(true)
    expect(items[0]!.textContent).toContain('This record has no id in its file, so it cannot be moved here.')
    const card = screen.getByText('X').closest('[data-card]') as HTMLElement
    card.focus()
    fireEvent.keyDown(card, { key: ' ' })
    expect(screen.getByTestId('live').textContent).toBe('X can’t be moved: This record has no id in its file, so it cannot be moved here.')
  })

  it('draws a move staged in your change as a staged move, in its new column', async () => {
    fetchRoutes(baseRoutes({
      'GET /api/resources': [p('a', 'idea')],
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: null, entries: [] },
      'GET /api/changes': changeView({ ops: [{ op: 'update', record: 'projects:a', set: { status: 'done' }, base: 'h', before: { status: 'idea' } }] }),
    }))
    draw()
    await waitFor(() => expect(within(column('done')).queryByText('A')).toBeTruthy())
    const card = within(column('done')).getByText('A').closest('[data-card]') as HTMLElement
    expect(card.className).toContain('kcard-staged')
    expect(within(card).getByText('Staged move')).toBeTruthy()
  })

  // A2 (fix wave): a restricted `name` must not print its value — on the card, nor in the Move to… menu named by it.
  it('draws a restricted name as "Ops only" on its card, and names its Move to… menu so too (rule 3, E-70)', async () => {
    fetchRoutes(baseRoutes({
      'GET /api/resources': [p('a', 'idea')],
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: null, entries: [{ id: 'a', restricted: { name: 'hat:ops' } }] },
    }))
    draw()
    const card = (await screen.findByRole('button', { name: 'Move to… Ops only' })).closest('[data-card]') as HTMLElement
    expect(card.querySelector('.kcard-t')!.textContent).toBe('Ops only')
    expect(card.querySelector('.kcard-t .vis-field')).not.toBeNull()
    expect(card.textContent).not.toContain('A')
    expect(screen.queryByText('A')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Move to… A' })).toBeNull()
  })

  // R2 (fix wave): the tile's facts read the same file entry its title does, so a restricted field does not print one
  // line under the masked name (rule 3, E-70).
  it('draws a restricted role as "Ops only" in a card’s facts, and the field beside it as it is', async () => {
    const person = resource({ id: 'person:a', kind: 'person', name: 'A', status: 'active', facts: { role: 'Council steward', layer: 'core' },
      source: { path: 'data/members.yaml', editable: true, registry: 'members', entityId: 'a' } })
    fetchRoutes(baseRoutes({
      'GET /api/resources': [person],
      'GET /api/registries/members': { name: 'members', kind: 'collection', schemaVersion: null, entries: [{ id: 'a', restricted: { role: 'hat:ops' } }] },
    }))
    renderAt(<BlockFrame def={blockType('kanban')!} id="k" cfg={{ title: 'Crew', source: { kind: 'person' }, view: { group: 'status', columns: ['active'] } }} />)
    const card = (await screen.findByRole('button', { name: 'Move to… A' })).closest('[data-card]') as HTMLElement
    const facts = card.querySelector('.kcard-f')!
    expect(facts.textContent).toContain('Ops only')
    expect(facts.querySelector('.vis-field')).not.toBeNull()
    expect(facts.textContent).toContain('core') // a field the viewer is admitted to still prints
    expect(card.textContent).not.toContain('Council steward')
    expect(screen.queryByText('Council steward')).toBeNull()
  })

  // D-12 (operator, 2026-11-04; C9's final-review carry): the column a card stood in told the value of its group field
  // though the viewer is not admitted to it — a restricted status read by where the card is (rule 3, E-70).
  it('puts a card whose group field is restricted in "other", never in its value’s column, and does not move it', async () => {
    fetchRoutes(baseRoutes({
      'GET /api/resources': [p('a', 'idea')],
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: null, entries: [{ id: 'a', restricted: { status: 'hat:ops' } }] },
    }))
    draw()
    await screen.findByRole('list', { name: 'other' })
    expect(within(column('other')).getByText('A')).toBeTruthy()
    expect(within(column('idea')).queryByText('A')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Move to… A' }))
    const items = screen.getAllByRole('menuitemradio')
    expect(items.every(i => i.getAttribute('aria-disabled') === 'true')).toBe(true)
    expect(items[0]!.textContent).toContain('Its status is Ops only, so it cannot be moved here.')
  })

  it('says "Staged" on a card whose staged change is not its move', async () => {
    fetchRoutes(baseRoutes({
      'GET /api/resources': [p('a', 'idea')],
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: null, entries: [] },
      'GET /api/changes': changeView({ ops: [{ op: 'update', record: 'projects:a', set: { lead: 'ops-lead' }, base: 'h', before: { lead: null } }] }),
    }))
    draw()
    await waitFor(() => expect(within(column('idea')).queryByText('Staged')).toBeTruthy())
    const card = within(column('idea')).getByText('A').closest('[data-card]') as HTMLElement
    expect(card.className).not.toContain('kcard-staged')
    expect(within(card).queryByText('Staged move')).toBeNull()
  })

  it('announces a refused move and leaves the card where it was', async () => {
    fetchRoutes(baseRoutes({
      'GET /api/resources': [p('a', 'idea')],
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: null, entries: [] },
      'POST /api/changes/ops': refuse(422, { errors: [{ record: 'projects:a', field: 'status', message: 'status must be one of idea, active, done' }] }),
    }))
    const { container } = draw()
    await moveTo('A', 'done')
    await waitFor(() => expect(container.querySelector('.kb-refused')!.textContent).toBe('Not moved: status must be one of idea, active, done'))
    expect(screen.getByTestId('live').textContent).toBe('Not moved: status must be one of idea, active, done')
    expect(within(column('idea')).getByText('A')).toBeTruthy()
  })

  it('drags a card to a column with the pointer', async () => {
    draw()
    const card = (await screen.findByText('A')).closest('[data-card]') as HTMLElement
    const target = column('done')
    document.elementFromPoint = () => target   // jsdom has no layout, so the column under the pointer is given
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(card, { clientX: 40, clientY: 0, pointerId: 1, buttons: 1 })
    fireEvent.pointerUp(card, { clientX: 40, clientY: 0, pointerId: 1 })
    await waitFor(() => expect(calls.find(c => c.method === 'POST')!.body).toEqual({ ops: [{ op: 'update', record: 'projects:a', set: { status: 'done' } }] }))
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('Moved A to done.'))
  })

  const grab = async () => {
    const card = (await screen.findByText('A')).closest('[data-card]') as HTMLElement
    document.elementFromPoint = () => column('done')
    return card
  }
  const staged = () => calls.filter(c => c.method === 'POST')

  it('stages nothing after a pointercancel, even if the pointer moves and lifts again', async () => {
    draw()
    const card = await grab()
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(card, { clientX: 40, clientY: 0, pointerId: 1, buttons: 1 })
    fireEvent.pointerCancel(card, { pointerId: 1 })
    fireEvent.pointerMove(card, { clientX: 50, clientY: 0, pointerId: 1, buttons: 0 })
    fireEvent.pointerUp(card, { clientX: 50, clientY: 0, pointerId: 1 })
    await new Promise(r => setTimeout(r, 20))
    expect(staged()).toHaveLength(0)
  })

  it('stages nothing after Escape during a drag', async () => {
    draw()
    const card = await grab()
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(card, { clientX: 40, clientY: 0, pointerId: 1, buttons: 1 })
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.pointerUp(card, { clientX: 40, clientY: 0, pointerId: 1 })
    await new Promise(r => setTimeout(r, 20))
    expect(staged()).toHaveLength(0)
  })

  it('ignores moves from another pointer or with no button down', async () => {
    draw()
    const card = await grab()
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(card, { clientX: 40, clientY: 0, pointerId: 2, buttons: 1 })
    fireEvent.pointerMove(card, { clientX: 40, clientY: 0, pointerId: 1, buttons: 0 })
    fireEvent.pointerUp(card, { clientX: 40, clientY: 0, pointerId: 1 })
    await new Promise(r => setTimeout(r, 20))
    expect(staged()).toHaveLength(0)
  })

  it('does not start a drag from a press on the Move to… button or the name link', async () => {
    draw()
    await grab()
    for (const el of [await screen.findByRole('button', { name: 'Move to… A' }), screen.getByRole('link', { name: 'A' })]) {
      fireEvent.pointerDown(el, { clientX: 0, clientY: 0, pointerId: 1, buttons: 1 })
      fireEvent.pointerMove(el, { clientX: 40, clientY: 0, pointerId: 1, buttons: 1 })
      fireEvent.pointerUp(el, { clientX: 40, clientY: 0, pointerId: 1 })
    }
    await new Promise(r => setTimeout(r, 20))
    expect(staged()).toHaveLength(0)
  })

  it('stages once when two moves come in a row', async () => {
    draw()
    await screen.findByRole('button', { name: 'Move to… A' })
    // both in the same tick: the first is still being staged when the second comes
    for (const column of ['active', 'done']) {
      fireEvent.click(screen.getByRole('button', { name: 'Move to… A' }))
      fireEvent.click(screen.getByRole('menuitemradio', { name: column }))
    }
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('Moved A to active.'))
    expect(staged()).toHaveLength(1)
  })
})

// review I-2's follow-up: a board over a section that sorts systems by their data/systems.yaml entry waits for it
describe('a kanban over the treasury', () => {
  for (const [what, answer] of SYSTEMS_UNREAD) {
    it(`draws no empty board while data/systems.yaml ${what}: loading, then the read's error`, async () => {
      const { calls } = fetchRoutes(baseRoutes({ 'GET /api/resources': [entryPlacedSafe], 'GET /api/registries/systems': answer }))
      renderAt(<BlockFrame def={blockType('kanban')!} id="k" cfg={{ title: 'Treasury', source: { section: 'treasury' }, view: { group: 'status', columns: ['active'] } }} />)
      await waitFor(() => expect(calls.some(c => c.path === '/api/resources')).toBe(true))
      await new Promise(r => setTimeout(r, 30))
      const block = document.querySelector('[data-block="k"]')!
      expect(block.getAttribute('data-state')).toBe(what === 'could not be read' ? 'error' : 'loading')
      if (what === 'could not be read') expect(block.textContent).toContain('data/systems.yaml cannot be read')
    })
  }
})
