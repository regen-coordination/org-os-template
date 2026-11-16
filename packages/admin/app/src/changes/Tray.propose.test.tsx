// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { OPEN_CHANGES, OPEN_PROPOSE } from '../keys/useHouseKeys.ts'
import Tray from './Tray.tsx'
import ProposePanel, { summarize } from './ProposePanel.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, refuse } from '../test/data.ts'
import type { ChangeView } from '../api.ts'
import { staleStays } from './rows.ts'

afterEach(() => vi.unstubAllGlobals())

const SENTENCE = 'Rule "records" needs 1 approval from the maintainer, so it cannot be applied alone. Propose it instead.'
const op = { op: 'update' as const, record: 'projects:garden-seat', set: { stage: 'develop' }, base: 'h', before: { stage: 'discovery' } }
const needsProposal = (over: Partial<ChangeView> = {}) => changeView({
  ops: [op], classes: ['records'],
  rule: { direct: false, proposable: true, sentence: SENTENCE, source: 'data/governance.yaml: records' }, ...over,
})
const view = (over: Record<string, unknown> = {}) => ({ id: 'p-2026-10-26-001', title: 'T', branchState: 'built', derived: 'approving', ...over })
const mount = () => renderAt(<><Tray /><ProposePanel /></>)
const tray = () => screen.findByRole('region', { name: 'Changes' })

describe('Tray: Propose', () => {
  it('offers Apply, and no Propose, when the change is direct', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': changeView({ ops: [op], classes: ['records'] }) }))
    mount()
    const t = await tray()
    expect((within(t).getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(false)
    expect(within(t).queryByRole('button', { name: 'Propose' })).toBeNull()
  })

  it('offers Propose with the rule\'s sentence when the change is not direct and may be proposed', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': needsProposal() }))
    mount()
    const t = await tray()
    expect((within(t).getByRole('button', { name: 'Propose' }) as HTMLButtonElement).disabled).toBe(false)
    expect(within(t).getByText(SENTENCE)).toBeTruthy()
    expect(within(t).queryByRole('button', { name: 'Apply' })).toBeNull()
  })

  it('disables the button with mayPropose\'s sentence when this member may not propose', async () => {
    const no = '"carla" does not hold the maintainer role, which rule "records" asks of whoever proposes.'
    fetchRoutes(baseRoutes({ 'GET /api/changes': needsProposal({ rule: { direct: false, proposable: false, sentence: no, source: 'data/governance.yaml: records' } }) }))
    mount()
    const t = await tray()
    expect((within(t).getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(t).getByText(no)).toBeTruthy()
    expect(within(t).queryByRole('button', { name: 'Propose' })).toBeNull()
  })

  it('holds Propose while a record is stale: the bar offers only Review, the panel\'s Propose is disabled', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': needsProposal({ stale: [0], current: [{ stage: 'execute' }] }) }))
    mount()
    const t = await tray()
    expect(within(t).getAllByRole('button').map(b => b.textContent)).toEqual(['Review'])
    fireEvent.click(within(t).getByRole('button', { name: 'Review' }))
    const panel = within(t).getByRole('group', { name: 'Your change' })
    expect((within(panel).getByRole('button', { name: 'Propose' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('one stale op does not hold Propose for the rest: the panel says it stays in the tray, and the title is the rest\'s (walk G6)', async () => {
    const tags = { op: 'update' as const, record: 'projects:seed-swap', set: { tags: ['season-two'] }, base: 'k', before: { tags: [] } }
    const two = needsProposal({ ops: [op, tags], stale: [0], current: [{ stage: 'execute' }, { tags: [] }] })
    fetchRoutes(baseRoutes({ 'GET /api/changes': two }))
    mount()
    const t = await tray()
    fireEvent.click(within(t).getByRole('button', { name: 'Review' }))
    const foot = within(within(t).getByRole('group', { name: 'Your change' })).getByRole('button', { name: 'Propose' }) as HTMLButtonElement
    expect(foot.disabled).toBe(false)
    fireEvent.click(foot)
    const panel = await screen.findByRole('complementary', { name: 'Propose' })
    expect(within(panel).getByText(staleStays(1))).toBeTruthy()
    expect((within(panel).getByLabelText('Title') as HTMLInputElement).value).toBe('Update projects:seed-swap')
  })

  it('Update proposal, which sends the change whole, waits while any op is stale (walk G6)', async () => {
    const tags = { op: 'update' as const, record: 'projects:seed-swap', set: { tags: ['season-two'] }, base: 'k', before: { tags: [] } }
    fetchRoutes(baseRoutes({ 'GET /api/changes': needsProposal({ ops: [op, tags], stale: [0], current: [{ stage: 'execute' }, { tags: [] }], revises: 'p-1' } as Partial<ChangeView>) }))
    mount()
    const t = await tray()
    fireEvent.click(within(t).getByRole('button', { name: 'Review' }))
    const foot = within(within(t).getByRole('group', { name: 'Your change' })).getByRole('button', { name: 'Update proposal' }) as HTMLButtonElement
    expect(foot.disabled).toBe(true)
  })

  it('shows Update proposal for a change that revises, and sends the ops without `before`, then clears the change', async () => {
    const revising = needsProposal({ revises: 'p-2026-10-26-001' } as Partial<ChangeView>)
    const { calls } = fetchRoutes(baseRoutes({
      'GET /api/changes': revising, 'POST /api/proposals/p-2026-10-26-001/revise': view({ commit: 'abc1234' }), 'DELETE /api/changes': new Response(null, { status: 204 }),
    }))
    mount()
    const t = await tray()
    expect(within(t).queryByRole('button', { name: 'Propose' })).toBeNull()
    fireEvent.click(within(t).getByRole('button', { name: 'Update proposal' }))
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.path === '/api/changes')).toBe(true))
    expect(calls.find(c => c.path.endsWith('/revise'))?.body).toEqual({ ops: [{ op: 'update', record: 'projects:garden-seat', set: { stage: 'develop' }, base: 'h' }] })
    expect(await screen.findByText('Proposal p-2026-10-26-001 updated.')).toBeTruthy()
  })

  it('an updated proposal marks the generated-files answer out of date', async () => {
    fetchRoutes(baseRoutes({
      'GET /api/changes': needsProposal({ revises: 'p-1' } as Partial<ChangeView>),
      'POST /api/proposals/p-1/revise': view({ commit: 'abc1234' }), 'DELETE /api/changes': new Response(null, { status: 204 }),
    }))
    const { qc } = mount()
    qc.setQueryData(['generated'], { behind: false })
    fireEvent.click(within(await tray()).getByRole('button', { name: 'Update proposal' }))
    await screen.findByText('Proposal p-1 updated.')
    expect(qc.getQueryState(['generated'])!.isInvalidated).toBe(true)
  })

  it('keeps every op when an update is refused, and says why', async () => {
    const { calls } = fetchRoutes(baseRoutes({
      'GET /api/changes': needsProposal({ revises: 'p-1' } as Partial<ChangeView>),
      'POST /api/proposals/p-1/revise': refuse(409, { code: 'UNCHANGED', error: 'Not revised: these are the ops proposal p-1 already holds.' }),
    }))
    mount()
    fireEvent.click(within(await tray()).getByRole('button', { name: 'Update proposal' }))
    expect(await screen.findByText('Not revised: these are the ops proposal p-1 already holds.')).toBeTruthy()
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
  })
})

describe('Tray: house:open-propose (DAO-OS L7 Task 17, the compose canvas’s Propose)', () => {
  it('opens the Propose panel when the change may be proposed', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': needsProposal() }))
    mount()
    await tray()
    act(() => { window.dispatchEvent(new Event(OPEN_PROPOSE)) })
    expect(await screen.findByRole('complementary', { name: 'Propose' })).toBeTruthy()
  })

  it('opens the tray instead when the change is applied, not proposed, so its Apply and rule are seen', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': changeView({ ops: [op], classes: ['records'] }) }))
    mount()
    const t = await tray()
    act(() => { window.dispatchEvent(new Event(OPEN_PROPOSE)) })
    expect(await within(t).findByRole('group', { name: 'Your change' })).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'Propose' })).toBeNull()
  })
})

describe('Propose panel', () => {
  const open = async (v: ChangeView = needsProposal()) => {
    const routes = fetchRoutes(baseRoutes({ 'GET /api/changes': v, 'POST /api/proposals': new Response(JSON.stringify(view()), { status: 201 }) }))
    mount()
    const opener = within(await tray()).getByRole('button', { name: 'Propose' })
    opener.focus()
    fireEvent.click(opener)
    const panel = await screen.findByRole('complementary', { name: 'Propose' })
    return { ...routes, panel, opener }
  }

  it('opens in the right slot with a title defaulting to a summary, and the deciding rules as sentences', async () => {
    const { panel } = await open()
    expect((within(panel).getByLabelText('Title') as HTMLInputElement).value).toBe('Update projects:garden-seat')
    expect(within(panel).getByText(SENTENCE)).toBeTruthy()
  })

  it('says under its fields that what it writes goes to git, where every member reads it; it is wide enough for two columns (E-48, E-55)', async () => {
    const { panel } = await open()
    expect(within(panel).getByText('The title, rationale and statement are written to the repository with the proposal: every member can read them.')).toBeTruthy()
    expect(panel.className).toBe('panel-right panel-form')
    // the fields are the house's inputs (design/inputs), not raw ones
    expect(within(panel).getByLabelText('Title').className).toBe('input')
    expect(within(panel).getByLabelText('Rationale').className).toBe('input prose')
  })

  it('needs a rationale for a governance change, forces the decision on, and sends nothing until both are written', async () => {
    const { panel, calls } = await open(needsProposal({ classes: ['governance'] }))
    // the rationale says it is required before any send (C7 I-4, WCAG 3.3.2)
    expect(within(panel).getByLabelText('Rationale').getAttribute('aria-required')).toBe('true')
    const record = within(panel).getByRole('checkbox', { name: 'Record as a decision' }) as HTMLInputElement
    expect([record.checked, record.disabled]).toEqual([true, true])
    fireEvent.click(within(panel).getByRole('button', { name: 'Propose' }))
    expect(await within(panel).findByText('Say why this is worth deciding: a rationale is required for governance and identity changes.')).toBeTruthy()
    expect(calls.some(c => c.method === 'POST')).toBe(false)
    fireEvent.change(within(panel).getByLabelText('Rationale'), { target: { value: 'The rule is too loose.' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Propose' }))
    expect(await within(panel).findByText('Write the decision, as it will stand in DECISIONS.md.')).toBeTruthy()
    fireEvent.change(within(panel).getByLabelText('Decision'), { target: { value: 'Two approvals.' } })
    fireEvent.change(within(panel).getByLabelText('Why'), { target: { value: 'Safer.' } })
    fireEvent.change(within(panel).getByLabelText('Scope'), { target: { value: 'governance' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Propose' }))
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toEqual({
      title: 'Update projects:garden-seat', rationale: 'The rule is too loose.',
      statement: { title: 'Update projects:garden-seat', decision: 'Two approvals.', why: 'Safer.', scope: 'governance' },
    }))
  })

  it('lets a records change go without a rationale or a statement, and says the proposal is open', async () => {
    const { panel, calls } = await open()
    expect((within(panel).getByRole('checkbox', { name: 'Record as a decision' }) as HTMLInputElement).checked).toBe(false)
    expect(within(panel).getByLabelText('Rationale').hasAttribute('aria-required')).toBe(false)
    expect(within(panel).queryByLabelText('Decision')).toBeNull()
    fireEvent.click(within(panel).getByRole('button', { name: 'Propose' }))
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toEqual({ title: 'Update projects:garden-seat' }))
    const link = await within(panel).findByRole('link', { name: 'p-2026-10-26-001' })
    expect(link.getAttribute('href')).toBe('/governance/proposals/p-2026-10-26-001')
  })

  it('⌘↵ (or Ctrl+↵) in a field proposes, as the button does: a keyboard path past the fields (C11 keyboard walk)', async () => {
    const { panel, calls } = await open()
    const title = within(panel).getByLabelText('Title')
    fireEvent.change(title, { target: { value: 'Seat the garden' } })
    fireEvent.keyDown(title, { key: 'Enter' })
    expect(calls.some(c => c.method === 'POST')).toBe(false) // Enter alone does not send
    fireEvent.keyDown(title, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toEqual({ title: 'Seat the garden' }))
  })

  it('puts a 422\'s field errors under their fields, in --attn, and keeps the form', async () => {
    const { panel } = await open(needsProposal({ classes: ['records'] }))
    fetchRoutes(baseRoutes({
      'GET /api/changes': needsProposal(),
      'POST /api/proposals': refuse(422, { errors: [{ field: 'rationale', message: 'must be plain text' }, { field: 'statement.why', message: 'is required' }] }),
    }))
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Record as a decision' }))
    fireEvent.change(within(panel).getByLabelText('Decision'), { target: { value: 'D' } })
    fireEvent.change(within(panel).getByLabelText('Why'), { target: { value: 'W' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Propose' }))
    const rationale = await within(panel).findByText('must be plain text')
    expect(rationale.className).toContain('err')
    expect(within(panel).getByLabelText('Rationale').getAttribute('aria-describedby')).toBe(rationale.id)
    expect(within(panel).getByLabelText('Rationale').getAttribute('aria-invalid')).toBe('true')
    expect(within(panel).getByText('is required').id).toBe(within(panel).getByLabelText('Why').getAttribute('aria-describedby'))
    expect((within(panel).getByLabelText('Decision') as HTMLTextAreaElement).value).toBe('D')
  })

  it('says a 403 or 409 in the server\'s sentence', async () => {
    const { panel } = await open()
    fetchRoutes(baseRoutes({ 'GET /api/changes': needsProposal(), 'POST /api/proposals': refuse(403, { reason: '"carla" does not hold the maintainer role.', error: '"carla" does not hold the maintainer role.' }) }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Propose' }))
    expect((await within(panel).findByRole('alert')).textContent).toBe('"carla" does not hold the maintainer role.')
  })

  it('closes on Escape and returns focus to Propose', async () => {
    const { opener } = await open()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Propose' })).toBeNull())
    expect(document.activeElement).toBe(opener)
  })

  it('re-reads the change and the proposals once opened', async () => {
    const { panel, calls } = await open()
    fireEvent.click(within(panel).getByRole('button', { name: 'Propose' }))
    await within(panel).findByRole('link', { name: 'p-2026-10-26-001' })
    await waitFor(() => expect(calls.filter(c => c.method === 'GET' && c.path === '/api/changes').length).toBeGreaterThan(1))
  })
})

describe('Propose from the open tray', () => {
  it('folds the panel first (its scrim would cover the proposal), and Esc in the proposal returns to the bar\'s Propose', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': needsProposal() }))
    mount()
    const t = await tray()
    const barPropose = within(t).getByRole('button', { name: 'Propose' })
    fireEvent.click(within(t).getByRole('button', { name: 'Review' }))
    const panel = within(t).getByRole('group', { name: 'Your change' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Propose' }))
    await screen.findByRole('complementary', { name: 'Propose' })
    expect(within(t).queryByRole('group', { name: 'Your change' })).toBeNull()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Propose' })).toBeNull())
    expect(document.activeElement).toBe(barPropose)
  })
})

describe('Propose panel focus', () => {
  it('moves focus to the news when the proposal opens, since the Propose button is gone', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': needsProposal(), 'POST /api/proposals': new Response(JSON.stringify(view()), { status: 201 }) }))
    mount()
    fireEvent.click(within(await tray()).getByRole('button', { name: 'Propose' }))
    const panel = await screen.findByRole('complementary', { name: 'Propose' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Propose' }))
    const news = await within(panel).findByRole('status')
    await waitFor(() => expect(document.activeElement).toBe(news))
  })
})

describe('fix round 1', () => {
  const described = (el: HTMLElement) => el.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)?.textContent).join(' ')

  it('a disabled Apply is described by the rule\'s sentence', async () => {
    const no = '"carla" does not hold the maintainer role, which rule "records" asks of whoever proposes.'
    fetchRoutes(baseRoutes({ 'GET /api/changes': needsProposal({ rule: { direct: false, proposable: false, sentence: no, source: 's' } }) }))
    mount()
    expect(described(within(await tray()).getByRole('button', { name: 'Apply' }))).toBe(no)
  })

  const STALE = '1 op changed on the trunk — choose what stands'
  /** The panel, opened with Review: while stale the bar holds no primary, and the foot's is held. */
  const panelOf = async () => {
    const t = await tray()
    fireEvent.click(within(t).getByRole('button', { name: 'Review' }))
    return within(t).getByRole('group', { name: 'Your change' })
  }
  it('a stale Propose and a stale Update proposal are described by the stale sentence', async () => {
    const stale = { stale: [0], current: [{ stage: 'execute' }] }
    fetchRoutes(baseRoutes({ 'GET /api/changes': needsProposal(stale) }))
    const a = mount()
    expect(described(within(await panelOf()).getByRole('button', { name: 'Propose' }))).toBe(STALE)
    a.unmount()
    fetchRoutes(baseRoutes({ 'GET /api/changes': needsProposal({ ...stale, revises: 'p-1' } as Partial<ChangeView>) }))
    mount()
    expect(described(within(await panelOf()).getByRole('button', { name: 'Update proposal' }))).toBe(STALE)
  })

  const openGov = async () => {
    const routes = fetchRoutes(baseRoutes({ 'GET /api/changes': needsProposal({ classes: ['governance'] }), 'POST /api/proposals': new Response(JSON.stringify(view()), { status: 201 }) }))
    mount()
    fireEvent.click(within(await tray()).getByRole('button', { name: 'Propose' }))
    const panel = await screen.findByRole('complementary', { name: 'Propose' })
    return { ...routes, panel }
  }

  it('a missing rationale marks the Rationale field, described by the sentence, and focuses it', async () => {
    const { panel, calls } = await openGov()
    fireEvent.click(within(panel).getByRole('button', { name: 'Propose' }))
    const field = within(panel).getByLabelText('Rationale')
    const sentence = 'Say why this is worth deciding: a rationale is required for governance and identity changes.'
    await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'))
    expect(described(field)).toBe(sentence)
    expect(within(panel).getByText(sentence).className).toContain('err')
    expect(document.activeElement).toBe(field)
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('the refusal goes away when the field is edited', async () => {
    const { panel } = await openGov()
    fireEvent.click(within(panel).getByRole('button', { name: 'Propose' }))
    const field = within(panel).getByLabelText('Rationale')
    await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'))
    fireEvent.change(field, { target: { value: 'because' } })
    expect(field.getAttribute('aria-invalid')).toBeNull()
    expect(within(panel).queryByText(/Say why this is worth deciding/)).toBeNull()
  })

  it('after the proposal opens, Close puts focus on the page, not on a gone opener', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': needsProposal(), 'POST /api/proposals': new Response(JSON.stringify(view()), { status: 201 }) }))
    renderAt(<><main id="main" tabIndex={-1}>page</main><Tray /><ProposePanel /></>)
    fireEvent.click(within(await tray()).getByRole('button', { name: 'Propose' }))
    const panel = await screen.findByRole('complementary', { name: 'Propose' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Propose' }))
    await within(panel).findByRole('status')
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Propose' })).toBeNull())
    expect(document.activeElement).toBe(document.getElementById('main'))
  })

  it('closes the panel when the change is emptied while it is open', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': needsProposal() }))
    const { qc } = mount()
    fireEvent.click(within(await tray()).getByRole('button', { name: 'Propose' }))
    await screen.findByRole('complementary', { name: 'Propose' })
    qc.setQueryData(['changes'], changeView())
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Propose' })).toBeNull())
  })
})

describe('Expanding the tray beside a proposal being written (L4a final review I-4)', () => {
  it('g c (house:open-changes) keeps the Propose panel and its typed title, and moves focus into it', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': needsProposal() }))
    mount()
    const t = await tray()
    fireEvent.click(within(t).getByRole('button', { name: 'Propose' }))
    const panel = await screen.findByRole('complementary', { name: 'Propose' })
    const title = within(panel).getByLabelText('Title') as HTMLInputElement
    fireEvent.change(title, { target: { value: 'Move the garden seat to develop' } })
    within(t).getByRole('button', { name: 'Review' }).focus()
    act(() => { window.dispatchEvent(new Event(OPEN_CHANGES)) })
    const still = screen.getByRole('complementary', { name: 'Propose' })
    expect((within(still).getByLabelText('Title') as HTMLInputElement).value).toBe('Move the garden seat to develop')
    expect(within(t).queryByRole('group', { name: 'Your change' })).toBeNull()
    expect(document.activeElement).toBe(within(still).getByLabelText('Title'))
  })
})

// L6 Task 21 (the acceptance walk, PF-R111): a move into the repository staged from a record's or a private page's control
// is a change with a private part only (`ops: []`, `private: [...]`). The tray counts it, lists it as typed (to the one who
// staged it), and offers Propose or Apply for it; Propose's suggested title names no private record, since the title is
// written to git at once.
describe('Tray: a change holding only a private part', () => {
  const MOVE = { ref: 'stg-1', class: 'workspace', op: { op: 'move-to-git' as const, collection: 'tasks', id: 't-secret', level: 'members' as const, digest: 'sha256:held' } }
  const PUBLISH = 'Rule "publish" needs 1 approval from the council, so it cannot be applied alone. Propose it instead.'
  const onlyPrivate = (over: Partial<ChangeView> = {}) => changeView({
    ops: [], classes: ['workspace', 'publication'], private: [MOVE],
    rule: { direct: false, proposable: true, sentence: PUBLISH, source: 'data/governance.yaml rules: publish' }, ...over,
  })

  it('is counted and listed, and offers Propose; the suggested title names no private record', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': onlyPrivate() }))
    mount()
    const t = await tray()
    expect(within(t).getByText('1 staged op')).toBeTruthy()
    expect(t.querySelector('.tray-line')!.textContent).toBe(`tasks:t-secret · moved into the repository, at members · ${PUBLISH}`)
    fireEvent.click(within(t).getByRole('button', { name: 'Review' }))
    const panel = within(t).getByRole('group', { name: 'Your change' })
    const rows = within(within(panel).getByRole('list', { name: 'Staged ops' })).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.textContent).toContain('tasks:t-secret')
    expect(rows[0]!.textContent).toContain('moved into the repository, at members')
    expect(within(panel).getByText('1 op · 1 record')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Propose' }))
    const form = await screen.findByRole('complementary', { name: 'Propose' })
    const title = (within(form).getByLabelText('Title') as HTMLInputElement).value
    expect(title).toBe('A change to a restricted collection')
    expect(title).not.toContain('t-secret')
  })

  it('offers Apply when the rule lets its author decide alone', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': onlyPrivate({ rule: { direct: true, sentence: 'you alone (solo maintainer)', source: 'implied by model: solo-maintainer' } }) }))
    mount()
    const t = await tray()
    expect((within(t).getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a private entry the store could not read back is still counted, and said as such', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': onlyPrivate({ private: [{ ...MOVE, op: null }] }) }))
    mount()
    const t = await tray()
    expect(within(t).getByText('1 staged op')).toBeTruthy()
    expect(t.querySelector('.tray-line')!.textContent).toContain('A private change (the private store could not be read)')
  })
})

describe('the suggested title (walk M6)', () => {
  const widen = [{ op: 'file', path: 'pages/atlas-0001.md', text: '---\nvisibility: public\n---\n', base: 'h1' }] as unknown as ChangeView['ops']
  it('a page made public, with a private record moved into the repository: says it publishes, names nothing private', () => {
    const title = summarize(widen, { classes: ['publication', 'workspace'], restricted: true })
    expect(title).toBe('Publish pages/atlas-0001.md, and a change to a restricted collection')
    expect(title).not.toMatch(/t-payroll|tasks/)
  })
  it('an edit that publishes nothing still reads "Edit"; without a private part, nothing is added', () => {
    expect(summarize(widen, { classes: ['workspace'] })).toBe('Edit pages/atlas-0001.md')
    expect(summarize(widen)).toBe('Edit pages/atlas-0001.md')
  })
})
