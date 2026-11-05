// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Switch } from 'wouter'
import App from '../App.tsx'
import ProposalPage from './Proposal.tsx'
import Governance from './Governance.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, refuse, resource } from '../test/data.ts'
import { PROPOSAL_NOW, RESULTS, result, proposalDetail } from '../test/fixtures/proposals.ts'
import { RETURN_DECIDED } from '../test/fixtures/house/governance.ts'
import { TREASURY_SYSTEM } from '../test/fixtures/house/systems.ts'
import { expectNoWriteControls } from '../test/publicPreview.tsx'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { api, type ProposalDetail } from '../api.ts'
import { ageText } from '../time.ts'

// The proposal page (0.6 P2 spec §3.14): a head, then Decision rule, Changes, Events, System and Actions. What the
// page offers is the server's `can`, and a disabled action says the server's `cannot` sentence; the page decides
// nothing itself. Synthetic members ana, bruno, carla; the clock is PROPOSAL_NOW.

const ID = 'p-2026-10-16-001'
const PATH = `/governance/proposals/${ID}`
const iso = (hours: number) => new Date(PROPOSAL_NOW.getTime() + hours * 3_600_000).toISOString()
const actor = (id: string) => ({ id, name: id, kind: 'person' })
const SYSTEM_RULE = { id: 'treasury', applies_to: ['treasury'], decide: { by: 'system', system: 'treasury-safe' } }

/** Every disabled action's sentence, as the server words them for carla on carla's approve proposal. */
const CANNOT = {
  approve: '"carla" wrote this proposal and cannot approve their own proposal.',
  vote: "That can't be done now: Open: waiting for approvals.",
  retract: 'a retract names no event: say which one to take back.',
  attach: 'this proposal waits on no outside system, so there is nothing to attach: people decide it.',
  system: 'only the server writes a system event, from an outside system it read.',
  ratify: 'its rule is not met yet', reject: 'its rule has not failed', expire: 'its time has not run out yet',
}

function serve(detail: ProposalDetail, who = 'carla', more: Record<string, unknown> = {}) {
  return fetchRoutes(baseRoutes({
    'GET /api/actor': actor(who),
    [`GET /api/proposals/${detail.id}`]: detail,
    'GET /api/proposals': [detail],
    ...more,
  }))
}
// renderAt's PanelProvider holds the page's live region.
const page = (path = PATH) => renderAt(<Switch><Route path="/governance/proposals/:id">{p => <ProposalPage id={p.id} />}</Route></Switch>, path)
const section = (name: string) => screen.findByRole('region', { name })
const actions = async () => within(await section('Actions'))
/** The record header: where the one primary for this viewer is (§9.1). */
// the loaded page's record header (its id line): the first frame draws the heading too (§6.2)
const head = async () => { await waitFor(() => expect(document.querySelector('header.rh .rh-id')).not.toBeNull()); return within(document.querySelector('header.rh') as HTMLElement) }
/** A button's description, every id it names joined (its own `describedby` and an unavailable reason's tooltip). */
const described = (el: HTMLElement) => (el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map(id => document.getElementById(id)?.textContent ?? '').join(' ')
const body = (calls: { method: string; path: string; body: unknown }[], path: string) => calls.filter(c => c.method === 'POST' && c.path === path).map(c => c.body)

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(PROPOSAL_NOW) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('the proposal page', () => {
  it('says "wearer list partial" only beside the rules the server names as partial (Task 9 M3)', async () => {
    const parts = [
      { rule: { id: 'records', applies_to: ['records'], decide: { by: 'maintainer', method: 'approve' } }, evaluation: result({}) },
      { rule: { id: 'people', applies_to: ['members'], decide: { by: 'council', method: 'approve' } }, evaluation: result({}) },
    ]
    serve(proposalDetail({ id: ID, partial: true, partialRules: ['people'],
      evaluation: { state: 'pending', missing: 'needs 1 more approval', closesAt: null, parts } as never,
      rules: [{ direct: false, sentence: 'a maintainer approves', source: 's' }, { direct: false, sentence: 'one of the council approves', source: 's' }] }))
    page()
    const rules = within(await screen.findByRole('list', { name: 'Rules' })).getAllByRole('listitem')
    expect(rules.map(r => within(r).queryByText('wearer list partial') !== null)).toEqual([false, true])
  })

  // C7 (ledger): "the head says id · author · opened · branch, then the five sections in order" — the head is the record
  // header (§9.1), the five sections are the main column's, and the path, the route and the touches are in the aside.
  it('App routes /governance/proposals/:id to it: the record header, the sections in order, and the aside', async () => {
    vi.stubGlobal('WebSocket', class { onmessage = null; close() {} })
    serve(proposalDetail({ id: ID, can: ['comment', 'withdraw', 'revise'], cannot: CANNOT, rationale: 'The garden needs a lead who is there on Saturdays.',
      evaluation: { state: 'pending', missing: 'needs 1 more approval from a maintainer', closesAt: iso(51),
        parts: [{ rule: { id: 'r1', applies_to: ['records'], decide: { by: 'maintainer', method: 'approve' } }, evaluation: result({ closesAt: iso(51) }) },
          { rule: SYSTEM_RULE, evaluation: result({ missing: 'waits on treasury-safe', tally: {}, closesAt: null }) }] } as never,
      rules: [{ direct: false, sentence: 'two maintainers approve', source: 's' }, { direct: false, sentence: 'the system treasury-safe decides', source: 's' }] } as never))
    renderAt(<App />, PATH)
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Move the garden seat to the board' })
    expect(h1.textContent).toBe('Move the garden seat to the board')
    const rh = h1.closest('header.rh') as HTMLElement
    expect(rh.querySelector('.rh-id')!.textContent).toBe(ID)
    expect(rh.querySelector('.smark-word')!.textContent).toBe('Approving')
    expect(rh.querySelector('.rh-route')!.textContent).toBe('two maintainers approve')
    expect(within(rh).getByText('Members')).toBeTruthy() // the visibility marker
    expect([...rh.querySelectorAll('.rh-m')].map(m => m.textContent)).toEqual([`opened ${ageText(iso(-30), PROPOSAL_NOW)} by carla`, expect.stringMatching(/^Closes in /), `proposal/${ID}`])
    // R9 (fix wave): `opened … ago` is a function of now, like the closing count beside it, so both are marked for the
    // route shots to mask; the author and the branch are not.
    expect([...rh.querySelectorAll('[data-volatile]')].map(m => m.textContent))
      .toEqual([`opened ${ageText(iso(-30), PROPOSAL_NOW)}`, expect.stringMatching(/^Closes in /)])
    // carla wrote it and may not approve it: Approve is her primary, held, with the server's reason
    const approve = within(rh).getByRole('button', { name: 'Approve' })
    expect(approve.getAttribute('aria-disabled')).toBe('true')
    expect(described(approve)).toContain(CANNOT.approve)
    // the body, in prose
    expect(within(await section('Rationale')).getByText('The garden needs a lead who is there on Saturdays.')).toBeTruthy()
    const names = screen.getAllByRole('region').map(r => r.getAttribute('aria-label')).filter(n => ['Decision rule', 'Changes', 'Events', 'System', 'Actions'].includes(n ?? ''))
    expect(names).toEqual(['Decision rule', 'System', 'Changes', 'Events', 'Actions'])
    const aside = screen.getByRole('complementary', { name: 'About this proposal' })
    expect(within(aside).getByRole('list', { name: 'Path' })).toBeTruthy()
    const about = within(aside).getByRole('group', { name: 'Route and touches' })
    expect(within(about).getByText('two maintainers approve · the system treasury-safe decides')).toBeTruthy()
    expect(within(about).getByRole('link', { name: 'projects:garden' }).getAttribute('href')).toBe('/r/project/garden')
  })

  it('names a record it touches by the record, as its page heads it; the key while there is no record to name (walk 2026-11-04, L4c-fix 8)', async () => {
    const garden = resource({ id: 'project:garden', name: 'Garden seat', source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'garden' } })
    serve(proposalDetail({ id: ID }), 'carla', { 'GET /api/resources': [garden],
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'garden', title: 'Garden seat' }] } })
    renderAt(<ProposalPage id={ID} />, PATH)
    const about = await screen.findByRole('group', { name: 'Route and touches' })
    expect((await within(about).findByRole('link', { name: 'Garden seat' })).getAttribute('href')).toBe('/r/project/garden')
  })

  it('names a touched record whose name the file restricts "<hat> only", never the name (review I-3, D-12)', async () => {
    const garden = resource({ id: 'project:garden', name: 'Garden seat', source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'garden' } })
    serve(proposalDetail({ id: ID }), 'carla', { 'GET /api/resources': [garden],
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'garden', title: 'Garden seat', restricted: { name: 'hat:ops' } }] } })
    renderAt(<ProposalPage id={ID} />, PATH)
    const about = await screen.findByRole('group', { name: 'Route and touches' })
    expect((await within(about).findByRole('link', { name: 'Ops only' })).getAttribute('href')).toBe('/r/project/garden')
    expect(about.textContent).not.toContain('Garden seat')
  })

  it('Decision rule: each rule with its status, what is missing, the tally and the clock in words; the overall line says what holds it', async () => {
    serve(proposalDetail({ id: ID, lead: result({ closesAt: iso(51) }) }))
    page()
    const rule = within(await section('Decision rule'))
    expect(rule.getByRole('group', { name: 'waiting: two maintainers approve' })).toBeTruthy()
    // one deadline, said once (walk 2026-11-04, L4c-fix 12): the header's "Closes in 2 days"; the one rule's clock
    // is the same deadline, so it is not said again in another form
    expect(document.querySelector('header.rh')!.textContent).toContain('Closes in 2 days')
    expect(rule.queryByText(/^closes in /)).toBeNull()
    expect(rule.getByText('for ana')).toBeTruthy()
    // one rule: what it waits on is said on its line, and the overall line does not say it again
    expect(rule.getByText('needs 1 more approval from a maintainer')).toBeTruthy()
    expect(rule.getByRole('status').textContent).toBe('')
    expect(screen.queryByText(/closesAt|T\d\d:\d\d:\d\dZ/)).toBeNull() // no raw keys or ISO dates
  })

  it('a met rule reads "Ready to ratify"; Ratify appears only then, and sends nothing the page computed', async () => {
    const { calls } = serve(proposalDetail({ id: ID, lead: RESULTS.met, can: ['comment', 'ratify'], cannot: { ...CANNOT, ratify: undefined } as never,
      evaluation: { state: 'met', missing: '', closesAt: null, parts: [{ rule: { id: 'r1', applies_to: ['records'], decide: { by: 'maintainer', method: 'approve' } }, evaluation: RESULTS.met }] } as never }),
    'carla', { [`POST /api/proposals/${ID}/ratify`]: { ...proposalDetail({ id: ID }), state: 'ratified', commit: 'abcdef1234567' } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    page()
    expect((await within(await section('Decision rule')).findByRole('status')).textContent).toBe('Ready to ratify.')
    // C7 (ledger): Ratify is the record header's one primary (§9.1), no longer in Actions
    expect((await actions()).queryByRole('button', { name: 'Ratify' })).toBeNull()
    fireEvent.click((await head()).getByRole('button', { name: 'Ratify' }))
    await waitFor(() => expect(body(calls, `/api/proposals/${ID}/ratify`)).toEqual([{}]))
    expect(await (await actions()).findByText('Ratified as commit abcdef1.')).toBeTruthy()
  })

  it('a ratify marks the generated-files answer out of date, so Governance shows the line without a reload', async () => {
    let behind = false
    serve(proposalDetail({ id: ID, lead: RESULTS.met, can: ['comment', 'ratify'], cannot: { ...CANNOT, ratify: undefined } as never,
      evaluation: { state: 'met', missing: '', closesAt: null, parts: [{ rule: { id: 'r1', applies_to: ['records'], decide: { by: 'maintainer', method: 'approve' } }, evaluation: RESULTS.met }] } as never }),
    'carla', {
      [`POST /api/proposals/${ID}/ratify`]: () => { behind = true; return { ...proposalDetail({ id: ID }), state: 'ratified', commit: 'abcdef1234567' } },
      'GET /api/generated': () => ({ behind }), 'GET /api/governance': { model: 'consensus', description: null, rules: [], decisions: [], problems: [] },
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { qc, rerender } = page()
    await qc.fetchQuery({ queryKey: ['generated'], queryFn: api.generated })
    expect(qc.getQueryData(['generated'])).toEqual({ behind: false })
    fireEvent.click((await head()).getByRole('button', { name: 'Ratify' }))
    expect(await screen.findByText('Ratified as commit abcdef1.')).toBeTruthy()
    rerender(<Governance part="rules" />)
    expect(await screen.findByText('Generated files are behind the data: run npm run generate:schemas and commit .well-known/.')).toBeTruthy()
  })

  it('no Ratify while the rule is not met, even if a stale `can` held it', async () => {
    serve(proposalDetail({ id: ID, can: ['comment', 'ratify'], cannot: CANNOT }))
    page()
    await actions()
    expect(screen.queryByRole('button', { name: 'Ratify' })).toBeNull()
  })

  it('the actions are exactly `can`: each enabled one is in it, and each disabled one has the server’s sentence as its accessible description', async () => {
    serve(proposalDetail({ id: ID, can: ['object', 'comment', 'withdraw', 'revise'], cannot: CANNOT }))
    page()
    const a = await actions()
    const enabled = (name: string) => (a.getByRole('button', { name }) as HTMLButtonElement).disabled === false
    expect(['Object…', 'Comment…', 'Withdraw', 'Revise'].map(enabled)).toEqual([true, true, true, true])
    const said = (name: string) => {
      const b = a.getByRole('button', { name }) as HTMLButtonElement
      expect(b.disabled).toBe(true)
      return document.getElementById(b.getAttribute('aria-describedby') ?? '')?.textContent
    }
    // the server's sentence as it is, made a sentence (it is written to follow a colon)
    // C7 (ledger): Approve is the header's primary, held (aria-disabled) with the reason as its description (E-57)
    const approve = (await head()).getByRole('button', { name: 'Approve' })
    expect(approve.getAttribute('aria-disabled')).toBe('true')
    expect(described(approve)).toContain(CANNOT.approve)
    expect(a.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(said('Retract')).toBe('A retract names no event: say which one to take back.')
    expect(said('Close as rejected')).toBe('Its rule has not failed.')
    expect(said('Close as expired')).toBe('Its time has not run out yet.')
    // the vote is a radio group, disabled with its sentence
    const vote = a.getByRole('radiogroup', { name: 'Vote' })
    // C7 (ledger): each choice is the house's radio (design/inputs Choice), named by its label; it carries no value
    expect(within(vote).getAllByRole('radio').map(r => r.closest('label')!.textContent)).toEqual(['yes', 'no', 'abstain'])
    expect(within(vote).getAllByRole('radio').every(r => (r as HTMLInputElement).disabled)).toBe(true)
    expect(document.getElementById(vote.getAttribute('aria-describedby') ?? '')?.textContent).toBe(CANNOT.vote)
    // Replay is shown only when the server offers it
    expect(a.queryByRole('button', { name: 'Replay' })).toBeNull()
  })

  it('Object… will not send without its text: it says so under the field and focuses it; with it, it sends the objection and focus returns to Object…', async () => {
    const { calls } = serve(proposalDetail({ id: ID, can: ['object', 'comment'], cannot: CANNOT }), 'bruno',
      { [`POST /api/proposals/${ID}/events`]: proposalDetail({ id: ID }) })
    page()
    fireEvent.click((await actions()).getByRole('button', { name: 'Object…' }))
    const box = screen.getByRole('textbox', { name: 'Your objection' })
    const send = screen.getByRole('button', { name: 'Send objection' }) as HTMLButtonElement
    fireEvent.click(send)
    fireEvent.change(box, { target: { value: '   ' } })
    fireEvent.click(send)
    expect(body(calls, `/api/proposals/${ID}/events`)).toEqual([])
    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(box.getAttribute('aria-describedby')!)?.textContent).toBe('Say what harm it does before you send the objection.')
    expect(document.activeElement).toBe(box)
    fireEvent.change(box, { target: { value: 'It harms the aim: members would lose their say.' } })
    expect(box.getAttribute('aria-invalid')).toBeNull()
    fireEvent.click(send)
    await waitFor(() => expect(body(calls, `/api/proposals/${ID}/events`)).toEqual([{ kind: 'object', text: 'It harms the aim: members would lose their say.' }]))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Object…' })))
  })

  it('Vote is a radio group: the choice is sent as the ballot', async () => {
    const { calls } = serve(proposalDetail({ id: ID, method: 'vote', can: ['vote', 'comment'], cannot: CANNOT }), 'bruno',
      { [`POST /api/proposals/${ID}/events`]: proposalDetail({ id: ID }) })
    page()
    const a = await actions()
    const vote = a.getByRole('radiogroup', { name: 'Vote' })
    const send = a.getByRole('button', { name: 'Send vote' }) as HTMLButtonElement
    fireEvent.click(send) // nothing chosen yet: said, not sent
    expect(body(calls, `/api/proposals/${ID}/events`)).toEqual([])
    expect(document.getElementById(vote.getAttribute('aria-describedby')!)?.textContent).toBe('Choose yes, no or abstain first.')
    fireEvent.click(within(vote).getByRole('radio', { name: 'no' }))
    fireEvent.click(send)
    await waitFor(() => expect(body(calls, `/api/proposals/${ID}/events`)).toEqual([{ kind: 'vote', vote: 'no' }]))
  })

  it('Retract says what it takes back, and names that event', async () => {
    const { calls } = serve(proposalDetail({ id: ID, can: ['retract', 'comment'], cannot: CANNOT,
      events: [{ id: 'e-1', at: iso(-3), by: 'bruno', kind: 'approve', rev: 'a1b2c3d4e5f6' }] as never }), 'bruno',
    { [`POST /api/proposals/${ID}/events`]: proposalDetail({ id: ID }) })
    page()
    const button = (await actions()).getByRole('button', { name: 'Retract' })
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe('Takes back your approval, written 3\u00a0h ago.')
    fireEvent.click(button)
    await waitFor(() => expect(body(calls, `/api/proposals/${ID}/events`)).toEqual([{ kind: 'retract', of: 'e-1' }]))
  })

  it('a refusal is the server’s sentence, said where the action is', async () => {
    serve(proposalDetail({ id: ID, can: ['approve'], cannot: CANNOT }), 'bruno', {
      [`POST /api/proposals/${ID}/events`]: refuse(409, { code: 'REFUSED', machine: 'proposal', state: 'approving', event: 'APPROVE', reason: 'its rule moved on', error: 'its rule moved on' }),
    })
    page()
    fireEvent.click((await head()).getByRole('button', { name: 'Approve' }))
    // C7 (ledger, E-58): an error note in Actions, said once through the polite region; no alert
    const note = (await (await actions()).findByText('its rule moved on')).closest('.note-error')!
    expect(note.getAttribute('role')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('its rule moved on'))
  })

  it('Revise loads the ops into the author’s tray (POST …/load) and says where they went; a tray that holds another change is refused in words', async () => {
    const loaded = changeView({ id: 'chg_9', actor: 'carla', revises: ID, ops: [{ op: 'update', record: 'projects:garden', set: { lead: 'ana' }, base: 'h1', before: { id: 'garden' } }] as never })
    const { calls } = serve(proposalDetail({ id: ID, can: ['comment', 'revise', 'withdraw'], cannot: CANNOT }), 'carla',
      { [`POST /api/proposals/${ID}/load`]: loaded })
    const r = page()
    fireEvent.click((await actions()).getByRole('button', { name: 'Revise' }))
    expect((await screen.findByText(/Its ops are in your Changes tray/)).textContent).toBe('Its ops are in your Changes tray: change them there, then press Update proposal.')
    expect(body(calls, `/api/proposals/${ID}/load`)).toEqual([{}])
    expect(r.qc.getQueryData(['changes'])).toEqual(loaded)
  })

  it('Revise refused: the tray’s sentence', async () => {
    serve(proposalDetail({ id: ID, can: ['revise'], cannot: CANNOT }), 'carla', {
      [`POST /api/proposals/${ID}/load`]: refuse(409, { code: 'TRAY_HOLDS', error: 'Not loaded: your tray already holds a different change (one op), and proposal p-2026-10-16-001\'s ops would mix with it: apply, propose or discard it first. Nothing was changed.' }),
    })
    page()
    fireEvent.click((await actions()).getByRole('button', { name: 'Revise' }))
    expect((await screen.findByText(/apply, propose or discard it first/)).closest('.note-error')).toBeTruthy()
  })

  it('the unmeetable rule’s Withdraw, when the server does not offer it, says why like every other action', async () => {
    const missing = 'cannot be met: only 1 maintainer other than the author, and the rule asks for 2. Withdraw it, or change the rule'
    const lead = result({ missing, blocked: 'unmeetable' } as never)
    serve(proposalDetail({ id: ID, lead, can: ['comment'], cannot: { ...CANNOT, withdraw: 'the proposal is being closed elsewhere' },
      evaluation: { state: 'pending', missing, closesAt: iso(120), blocked: 'unmeetable', parts: [{ rule: { id: 'r1', applies_to: ['records'], decide: { by: 'maintainer', method: 'approve', count: 2 } }, evaluation: lead }] } as never }))
    page()
    const button = within(await section('Decision rule')).getByRole('button', { name: 'Withdraw' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toBe('The proposal is being closed elsewhere.')
  })

  it('an unmeetable approve rule says so, and offers its author Withdraw right there', async () => {
    const missing = 'cannot be met: only 1 maintainer other than the author, and the rule asks for 2. Withdraw it, or change the rule'
    const lead = result({ missing, blocked: 'unmeetable' } as never)
    const { calls } = serve(proposalDetail({ id: ID, lead, can: ['comment', 'withdraw', 'revise'], cannot: CANNOT,
      evaluation: { state: 'pending', missing, closesAt: iso(120), blocked: 'unmeetable', parts: [{ rule: { id: 'r1', applies_to: ['records'], decide: { by: 'maintainer', method: 'approve', count: 2 } }, evaluation: lead }] } as never }),
    'carla', { [`POST /api/proposals/${ID}/events`]: proposalDetail({ id: ID, state: 'withdrawn', derived: 'withdrawn' }) })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    page()
    const rule = within(await section('Decision rule'))
    expect(rule.getByRole('status').textContent).toBe(`Cannot be met: only 1 maintainer other than the author, and the rule asks for 2. Withdraw it, or change the rule.`)
    fireEvent.click(rule.getByRole('button', { name: 'Withdraw' }))
    await waitFor(() => expect(body(calls, `/api/proposals/${ID}/events`)).toEqual([{ kind: 'withdraw' }]))
  })
})

describe('Changes', () => {
  it('draws each op as the tray does: the record linked, the field, the old value struck, the new one', async () => {
    serve(proposalDetail({ id: ID }))
    page()
    const ch = within(await section('Changes'))
    expect(ch.getByRole('link', { name: 'projects:garden' }).getAttribute('href')).toBe('/r/project/garden')
    // C7 (ledger): a field change row (§9.3) of the record's group, not a table row: label, the old struck → the new
    const rows = ch.getByRole('group', { name: 'Changes to projects:garden' })
    expect(rows.querySelector('dt')!.textContent).toBe('lead')
    const value = rows.querySelector('dd')!
    expect(within(value).getByText('carla').closest('s')).toBeTruthy()
    expect(within(value).getByText('ana').closest('s')).toBeNull()
  })

  it('a stale op shows what the trunk holds now, and Keep mine / Take theirs to the author alone', async () => {
    const stale = proposalDetail({ id: ID, stale: [0], derived: 'stale', can: ['comment', 'replay', 'withdraw', 'revise'], cannot: CANNOT,
      current: [{ id: 'garden', title: 'Garden seat', lead: 'bruno' }] })
    const { calls } = serve(stale, 'carla', { [`POST /api/proposals/${ID}/replay`]: proposalDetail({ id: ID }) })
    page()
    const ch = within(await section('Changes'))
    // C7 (ledger): the stale row is clay with the stale mark's words (§9.3), not "on the trunk now: …"
    expect(ch.getByText('now bruno on the trunk').closest('dd')!.className).toBe('stale')
    fireEvent.click(ch.getByRole('button', { name: 'Keep mine' }))
    await waitFor(() => expect(body(calls, `/api/proposals/${ID}/replay`)).toEqual([{ choose: 'mine' }]))
    expect(ch.getByRole('button', { name: 'Take theirs' })).toBeTruthy()
    // Replay is not offered as a plain action while the proposal is stale: the choice is the author's
    expect((await actions()).queryByRole('button', { name: 'Replay' })).toBeNull()
  })

  it('to anyone but the author a stale op shows its value now, and no choice', async () => {
    serve(proposalDetail({ id: ID, stale: [0], derived: 'stale', can: ['comment'], cannot: { ...CANNOT, replay: 'only its author can replay a stale proposal' },
      current: [{ id: 'garden', title: 'Garden seat', lead: 'bruno' }] }), 'bruno')
    page()
    const ch = within(await section('Changes'))
    expect(ch.getByText('now bruno on the trunk')).toBeTruthy()
    expect(ch.queryByRole('button', { name: 'Keep mine' })).toBeNull()
    expect(ch.queryByRole('button', { name: 'Take theirs' })).toBeNull()
  })

  it('Replay is offered when the server offers it, outside stale, and sends no choice', async () => {
    const { calls } = serve(proposalDetail({ id: ID, can: ['comment', 'replay'], cannot: CANNOT }), 'ana',
      { [`POST /api/proposals/${ID}/replay`]: proposalDetail({ id: ID }) })
    page()
    fireEvent.click((await actions()).getByRole('button', { name: 'Replay' }))
    await waitFor(() => expect(body(calls, `/api/proposals/${ID}/replay`)).toEqual([{}]))
  })

  it('a Replay that moved nothing (commit null) says so', async () => {
    serve(proposalDetail({ id: ID, can: ['comment', 'replay'], cannot: CANNOT }), 'ana',
      { [`POST /api/proposals/${ID}/replay`]: { ...proposalDetail({ id: ID }), commit: null } })
    page()
    fireEvent.click((await actions()).getByRole('button', { name: 'Replay' }))
    expect(await screen.findByText('Already on the trunk: nothing to replay.')).toBeTruthy()
    expect(screen.queryByText('Replayed on the trunk.')).toBeNull()
  })

  it('a Replay that moved the branch says it was replayed', async () => {
    serve(proposalDetail({ id: ID, can: ['comment', 'replay'], cannot: CANNOT }), 'ana',
      { [`POST /api/proposals/${ID}/replay`]: { ...proposalDetail({ id: ID }), commit: 'abc1234def' } })
    page()
    fireEvent.click((await actions()).getByRole('button', { name: 'Replay' }))
    expect(await screen.findByText('Replayed on the trunk.')).toBeTruthy()
  })

  it('Show the diff reads the detail’s diff; a ratified proposal’s empty diff is said in words', async () => {
    serve(proposalDetail({ id: ID }))
    const first = page()
    fireEvent.click(within(await section('Changes')).getByRole('button', { name: 'Show the diff' }))
    const well = screen.getByRole('figure', { name: `git diff <trunk>...proposal/${ID}` }).querySelector('pre')!
    expect(well.textContent).toContain('+    lead: "ana"')
    expect(well.className).toBe('gov-well') // the diff in a Mono well
    first.unmount()
    serve(proposalDetail({ id: ID, state: 'ratified', derived: 'ratified', diff: '', lead: RESULTS.met }))
    page()
    fireEvent.click(within(await section('Changes')).getByRole('button', { name: 'Show the diff' }))
    expect(screen.getByText(`No diff to show: proposal ${ID} is ratified, so its changes are on the trunk and its branch adds nothing to it.`)).toBeTruthy()
  })
})

describe('Events', () => {
  it('the log is keyed by proposal: moving to another proposal does not announce its whole log as new', async () => {
    const other = 'p-2026-10-16-002'
    serve(proposalDetail({ id: ID }), 'carla', {
      [`GET /api/proposals/${other}`]: proposalDetail({ id: other, title: 'Another', events: [{ id: 'e-b1', at: iso(-3), by: 'bruno', kind: 'object', rev: 'a1b2c3d4e5f6', text: 'No.' }] as never }),
    })
    const r = page()
    expect(await within(await section('Events')).findByText('carla commented')).toBeTruthy()
    // read before (a proposal visited earlier): the page draws it at once, with no Loading… in between to reset the log
    await r.qc.fetchQuery({ queryKey: ['proposal', other], queryFn: () => api.proposal(other) })
    act(() => { r.loc.navigate(`/governance/proposals/${other}`) })
    expect(await within(await section('Events')).findByText('bruno objected')).toBeTruthy()
    expect(screen.getByTestId('live').textContent).toBe('')
  })
})

describe('System', () => {
  const attach = { id: 'e-9', at: iso(-6), by: 'carla', kind: 'attach', rev: 'a1b2c3d4e5f6', ref: { system: 'treasury-safe', id: '0xabc123', payload: { to: '0x1', value: '5', data_hash: '0xd', operation: 0, nonce: 4 } } }
  const reading = (outcome: string, text: string) => ({ id: 'e-10', at: iso(-2), by: 'system:treasury-safe', kind: 'system', rev: 'a1b2c3d4e5f6', outcome, ref: attach.ref, text })
  const systemDetail = (events: unknown[], over: Partial<ProposalDetail> = {}) => proposalDetail({ id: ID, events: events as never, can: ['comment', 'attach'], cannot: CANNOT,
    evaluation: { state: 'pending', missing: 'waits on treasury-safe', closesAt: null, parts: [{ rule: SYSTEM_RULE, evaluation: result({ missing: 'waits on treasury-safe', tally: {}, closesAt: null }) }] } as never,
    rules: [{ direct: false, sentence: 'the system treasury-safe decides', source: 's' }],
    check: (events as { kind: string }[]).some(e => e.kind === 'attach') ? true : 'Nothing is attached to read yet.', ...over })

  it('shows the attached reference and the last reading with its age; Check now reads again and shows its attention', async () => {
    const { calls } = serve(systemDetail([attach, reading('pending', '1 of 2 confirmations')]), 'carla', {
      [`POST /api/proposals/${ID}/check`]: { ...systemDetail([attach, reading('pending', '1 of 2 confirmations')]), appended: false, reading: { ok: false, error: 'timed out' }, attention: { level: 'warn', text: 'read failed: timed out' } },
    })
    page()
    const sys = within(await section('System'))
    // C7: the attached Safe transaction is the prepared-transaction card (§9.6), and the line under it names it
    expect(sys.getByRole('region', { name: 'Prepared transaction' })).toBeTruthy()
    expect(sys.getByText('0xabc123', { selector: 'code' })).toBeTruthy()
    expect(sys.getByText(/^treasury-safe read pending, 2 h ago: 1 of 2 confirmations$/)).toBeTruthy()
    fireEvent.click(sys.getByRole('button', { name: 'Check now' }))
    await waitFor(() => expect(body(calls, `/api/proposals/${ID}/check`)).toEqual([{}]))
    expect(await sys.findByText('read failed: timed out')).toBeTruthy()
  })

  it('a mismatch reading is said in words, with what the author can do', async () => {
    serve(systemDetail([attach, reading('mismatch', 'this transaction is not the one the proposal prepared: its value differs')]))
    page()
    const sys = within(await section('System'))
    expect(sys.getByText(/this transaction is not the one the proposal prepared: its value differs/)).toBeTruthy()
    expect(sys.getByText('It cannot decide this proposal as it stands: withdraw the proposal and propose again, or revise it and attach a new transaction.')).toBeTruthy()
  })

  it('nothing attached yet: Prepare transaction reads the hash and the Safe link (read-only), and Attach sends what prepare gave', async () => {
    const ref = attach.ref
    const { calls } = serve(systemDetail([]), 'carla', {
      [`POST /api/proposals/${ID}/prepare`]: { payload: { to: '0x1', value: '5', data: '0x', operation: 0, nonce: 4 }, safeTxHash: '0xabc123', appLink: 'https://app.safe.global/home?safe=eth:0x2', ref },
      [`POST /api/proposals/${ID}/events`]: systemDetail([attach]),
    })
    page()
    const sys = within(await section('System'))
    expect(sys.getByText(/^No transaction is attached yet\./)).toBeTruthy()
    fireEvent.change(sys.getByRole('textbox', { name: 'to' }), { target: { value: '0x1' } })
    fireEvent.change(sys.getByRole('textbox', { name: 'value' }), { target: { value: '5' } })
    fireEvent.click(sys.getByRole('button', { name: 'Prepare transaction' }))
    await waitFor(() => expect(body(calls, `/api/proposals/${ID}/prepare`)).toEqual([{ to: '0x1', value: '5', data: '0x', operation: 0 }]))
    // C7 (ledger): what prepare gave is the prepared-transaction card; its Open in Safe leads with the external glyph
    const card = await sys.findByRole('region', { name: 'Prepared transaction' })
    expect(within(card).getByText('Prepared transaction')).toBeTruthy()
    const link = within(card).getByRole('link', { name: 'Open in Safe (opens in a new tab)' })
    expect(link.textContent).toBe('Open in Safe (opens in a new tab)')
    expect(link.getAttribute('href')).toBe('https://app.safe.global/home?safe=eth:0x2')
    expect(link.getAttribute('rel')).toContain('noopener')
    fireEvent.click(sys.getByRole('button', { name: 'Attach' }))
    await waitFor(() => expect(body(calls, `/api/proposals/${ID}/events`)).toEqual([{ kind: 'attach', ref }]))
  })

  it('Check now is enabled from the view’s `check`; when nothing is attached it says so', async () => {
    serve(systemDetail([]))
    page()
    const sys = within(await section('System'))
    const button = sys.getByRole('button', { name: 'Check now' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Nothing is attached to read yet.')
  })

  it('a check that found nothing attached says so, not "nothing changed"', async () => {
    const { calls } = serve(systemDetail([attach]), 'carla', {
      [`POST /api/proposals/${ID}/check`]: { ...systemDetail([]), appended: false, reading: null },
    })
    page()
    const sys = within(await section('System'))
    fireEvent.click(sys.getByRole('button', { name: 'Check now' }))
    await waitFor(() => expect(body(calls, `/api/proposals/${ID}/check`)).toEqual([{}]))
    expect(await sys.findByText('Nothing is attached to read yet.')).toBeTruthy()
    expect(sys.queryByText('Read: nothing changed.')).toBeNull()
  })

  it('Prepare transaction is enabled from `can` (attach), and says the server’s sentence when it is not', async () => {
    serve(systemDetail([], { can: ['comment'], cannot: { ...CANNOT, attach: '"bruno" may not propose a treasury change' } }), 'bruno')
    page()
    const sys = within(await section('System'))
    const button = sys.getByRole('button', { name: 'Prepare transaction' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toBe('"bruno" may not propose a treasury change.')
  })

  it('no System section when no rule waits on a system', async () => {
    serve(proposalDetail({ id: ID }))
    page()
    await section('Actions')
    expect(screen.queryByRole('region', { name: 'System' })).toBeNull()
  })
})

describe('a closed proposal', () => {
  it('says how it closed, and offers no action', async () => {
    serve(proposalDetail({ id: ID, state: 'withdrawn', derived: 'withdrawn', closed: { at: iso(-72), by: 'carla', decision: null } as never }))
    page()
    expect((await within(await section('Decision rule')).findByRole('status')).textContent).toBe('Withdrawn by its author. Its branch is kept.')
    const a = await actions()
    expect(a.queryAllByRole('button')).toEqual([])
  })
})

describe('the proposal page in the house (C7)', () => {
  it('a proposal about restricted data shows the server’s title, its rule, its state and the note — no Changes, records, diff or rationale (rule 8, E-49)', async () => {
    const note = 'This proposal changes a restricted collection: what it changes is shown only to those admitted to it.'
    serve({ ...proposalDetail({ id: ID, title: 'A change to a restricted collection', ops: [] as never, diff: null, note, current: [] }), restricted: true } as ProposalDetail, 'bruno')
    page()
    expect((await screen.findByRole('heading', { level: 1, name: 'A change to a restricted collection' })).textContent).toBe('A change to a restricted collection')
    expect(screen.getByText(note).closest('.note')).toBeTruthy()
    expect(within(await section('Decision rule')).getByRole('group', { name: 'waiting: two maintainers approve' })).toBeTruthy()
    expect(document.querySelector('header.rh .rh-route')!.textContent).toBe('two maintainers approve')
    expect(screen.queryByRole('region', { name: 'Changes' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Rationale' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show the diff' })).toBeNull()
    expect(screen.queryByText('projects:garden')).toBeNull()
    expect(screen.queryByTestId('minimap')).toBeNull()
    const aside = screen.getByRole('complementary', { name: 'About this proposal' })
    expect([...aside.querySelectorAll('dt')].map(d => d.textContent)).toEqual(['Route']) // no Touches
    expect(await section('Events')).toBeTruthy()
  })

  // V5 (fix round 4): the small map was given no entryOf, so the proposal's own restricted name and a touched
  // record's printed raw in it (rule 3, E-70). It reads their file entries now, and waits, so neither flashes.
  it('masks a name the file marks restricted on its small map: the proposal and the record it touches read "Ops only" (E-70)', async () => {
    const garden = resource({ id: 'project:garden', name: 'Garden seat',
      source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'garden' } })
    const own = resource({ id: `proposal:${ID}`, kind: 'proposal', name: 'Move the garden seat to the board', status: 'approving',
      source: { path: 'data/proposals.yaml', editable: false, registry: 'proposals', entityId: ID } })
    serve(proposalDetail({ id: ID }), 'carla', {
      'GET /api/resources': [own, garden],
      'GET /api/registries/proposals': { name: 'proposals', kind: 'collection', schemaVersion: '2.0',
        entries: [{ id: ID, restricted: { name: 'hat:ops' } }] },
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0',
        entries: [{ id: 'garden', restricted: { name: 'hat:ops' } }] },
    })
    page()
    const aside = await screen.findByRole('complementary', { name: 'About this proposal' })
    const small = await within(aside).findByRole('group', { name: 'What Ops only touches' })
    const mini = within(small).getByTestId('minimap')
    expect(mini.querySelector('.mini-n.is-me')!.textContent).toBe('Ops only')
    expect(mini.querySelector('.mini-n:not(.is-me)')!.textContent).toBe('Ops only')
    // the raw names are nowhere in the map: not its text, not a link's accessible name
    expect(mini.textContent).not.toContain('Move the garden seat to the board')
    expect(mini.textContent).not.toContain('Garden seat')
    expect(within(small).queryByRole('link', { name: /Garden seat|Move the garden seat/ })).toBeNull()
    expect([...mini.querySelectorAll('[aria-label]')].map(el => el.getAttribute('aria-label')).join(' '))
      .not.toMatch(/Garden seat|Move the garden seat/)
  })

  // C7 review M-5: an approve rule waits and the viewer may approve, so Approve would be the primary but for the preview
  it('previewing as Members draws the proposal and no action: no primary, no Actions, no Check now or Prepare (C-23)', async () => {
    const garden = resource({ id: 'project:garden', source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'garden' } })
    serve(proposalDetail({ id: ID, can: ['approve', 'object', 'comment', 'withdraw', 'revise', 'attach'], cannot: {},
      evaluation: { state: 'pending', missing: 'needs 1 more approval from a maintainer', closesAt: null,
        parts: [{ rule: { id: 'r1', applies_to: ['records'], decide: { by: 'maintainer', method: 'approve' } }, evaluation: result({ closesAt: null }) },
          { rule: SYSTEM_RULE, evaluation: result({ missing: 'waits on treasury-safe', tally: {}, closesAt: null }) }] } as never,
      rules: [{ direct: false, sentence: 'two maintainers approve', source: 's' }, { direct: false, sentence: 'the system treasury-safe decides', source: 's' }] }),
    'steward-b', { 'GET /api/resources': [garden] })
    renderAt(<ViewAsProvider initial={{ as: 'members' }}><Switch><Route path="/governance/proposals/:id">{p => <ProposalPage id={p.id} />}</Route></Switch></ViewAsProvider>, PATH)
    expect((await screen.findByRole('heading', { level: 1, name: 'Move the garden seat to the board' })).textContent).toBe('Move the garden seat to the board')
    expect(await section('System')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Actions' })).toBeNull()
    expect(document.querySelector('header.rh .rh-acts')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expectNoWriteControls()
  })

  it('says how many of the attach’s chains the ledger holds unreadably, under the cards (E-53)', async () => {
    const ref = { system: 'treasury-safe', id: '0xabc123', payload: { to: '0x1', value: '5', data_hash: '0xd', operation: 0, nonce: 4 }, also: [{ chain: 'eip155:100', id: '0xdef' }] }
    serve(proposalDetail({ id: ID, can: ['comment'], cannot: CANNOT, check: true,
      events: [{ id: 'e-9', at: iso(-6), by: 'carla', kind: 'attach', rev: 'a1b2c3d4e5f6', ref }] as never,
      evaluation: { state: 'pending', missing: 'waits on treasury-safe', closesAt: null, parts: [{ rule: SYSTEM_RULE, evaluation: result({ missing: 'waits on treasury-safe', tally: {}, closesAt: null }) }] } as never,
      rules: [{ direct: false, sentence: 'the system treasury-safe decides', source: 's' }] }))
    page()
    const sys = within(await section('System'))
    expect(sys.getAllByRole('region', { name: 'Prepared transaction' })).toHaveLength(1)
    expect(sys.getByText('1 of this change’s chains could not be read from the ledger and are not shown.')).toBeTruthy()
  })

  it('draws no prepared card, and no System section, for a viewer who cannot see the Safe System (E-54)', async () => {
    const ref = { system: 'treasury-safe', id: '0xabc123', payload: { to: '0x1', value: '5', data_hash: '0xd', operation: 0, nonce: 4 } }
    const safe = resource({ id: 'system:treasury-safe', kind: 'system', board: 'systems', name: 'Treasury', facts: { visibility: 'hat:treasury' }, source: null })
    const garden = resource({ id: 'project:garden', source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'garden' } })
    serve(proposalDetail({ id: ID, can: ['comment'], cannot: CANNOT, check: true,
      events: [{ id: 'e-9', at: iso(-6), by: 'carla', kind: 'attach', rev: 'a1b2c3d4e5f6', ref }] as never,
      evaluation: { state: 'pending', missing: 'waits on treasury-safe', closesAt: null, parts: [{ rule: SYSTEM_RULE, evaluation: result({ missing: 'waits on treasury-safe', tally: {}, closesAt: null }) }] } as never,
      rules: [{ direct: false, sentence: 'the system treasury-safe decides', source: 's' }] }), 'carla', { 'GET /api/resources': [safe, garden] })
    renderAt(<ViewAsProvider initial={{ as: 'members' }}><Switch><Route path="/governance/proposals/:id">{p => <ProposalPage id={p.id} />}</Route></Switch></ViewAsProvider>, PATH)
    await section('Changes')
    expect(screen.queryByRole('region', { name: 'Prepared transaction' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'System' })).toBeNull()
    expect(screen.queryByText('0xabc123')).toBeNull()
  })

  it('makes Open in Safe the primary while a prepared transaction waits on signers', async () => {
    const detail = { ...RETURN_DECIDED, diff: '', current: [null, null] } as unknown as ProposalDetail
    serve(detail, 'council-steward', { 'GET /api/resources': [TREASURY_SYSTEM] })
    page(`/governance/proposals/${String(detail.id)}`)
    const rh = await head()
    const link = rh.getByRole('link', { name: 'Open in Safe (opens in a new tab)' })
    expect(link.getAttribute('href')).toMatch(/^https:\/\/app\.safe\.global\/transactions\/tx\?safe=celo:/)
    expect(rh.queryByRole('button', { name: 'Approve' })).toBeNull()
    // one ink primary on the page: the card's own Open in Safe is secondary while the header carries it (§7.1, review I-3)
    expect(document.querySelectorAll('.btn.primary')).toHaveLength(1)
    const card = screen.getByRole('region', { name: 'Prepared transaction' })
    expect(within(card).getByRole('link', { name: 'Open in Safe (opens in a new tab)' }).className).toContain('secondary')
    // and the path in the aside is the gallery's: signing now, the read back waiting, the Hub watching for it
    const path = within(screen.getByRole('list', { name: 'Path' }))
    expect(path.getByText('Signed in the Safe').closest('li')!.className).toBe('tl-step tl-current')
    expect(path.getByText(/^The Hub watches /)).toBeTruthy()
  })

  it('keeps focus on Approve when, once approved, it cannot be sent again (E-57)', async () => {
    let approved = false
    const view = () => proposalDetail({ id: ID, can: approved ? ['comment', 'retract'] : ['approve', 'comment'],
      cannot: approved ? { approve: 'you approved it already' } : {} })
    serve(view(), 'bruno', { [`GET /api/proposals/${ID}`]: () => view(), [`POST /api/proposals/${ID}/events`]: () => { approved = true; return view() } })
    page()
    const approve = (await head()).getByRole('button', { name: 'Approve' })
    approve.focus()
    fireEvent.click(approve)
    await waitFor(() => expect(approve.getAttribute('aria-disabled')).toBe('true'))
    expect(screen.getByRole('button', { name: 'Approve' })).toBe(approve)
    expect(document.activeElement).toBe(approve)
    expect(described(approve)).toContain('You approved it already.')
  })

  it('holds Ratify while Approve is still being sent: a Ratify that would be dropped asks nothing, and once Approve answers it goes through (C8 fix I-2)', async () => {
    // Approve's write reaches the trunk; the watcher's refetch shows the rule met before Approve's own answer arrives.
    let met = false
    let answer!: () => void
    const view = () => met
      ? proposalDetail({ id: ID, lead: RESULTS.met, can: ['comment', 'ratify', 'retract'], cannot: { ...CANNOT, ratify: undefined } as never })
      : proposalDetail({ id: ID, can: ['approve', 'comment'], cannot: {} })
    const { calls } = serve(view(), 'bruno', {
      [`GET /api/proposals/${ID}`]: () => view(),
      [`POST /api/proposals/${ID}/events`]: () => new Promise(r => { answer = () => r(new Response(JSON.stringify(view()))) }),
      [`POST /api/proposals/${ID}/ratify`]: { ...proposalDetail({ id: ID }), state: 'ratified', commit: 'abcdef1234567' },
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { qc } = page()
    fireEvent.click((await head()).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(body(calls, `/api/proposals/${ID}/events`)).toHaveLength(1))
    met = true
    await act(async () => { await qc.invalidateQueries({ queryKey: ['proposal', ID] }) })
    const ratify = await (await head()).findByRole('button', { name: 'Ratify' })
    expect(ratify.getAttribute('aria-disabled')).toBe('true')
    expect(described(ratify)).toContain('Wait: the last action is still being sent.')
    fireEvent.click(ratify)
    expect(confirm).not.toHaveBeenCalled()
    expect(body(calls, `/api/proposals/${ID}/ratify`)).toEqual([])
    await act(async () => { answer() })
    expect(await (await actions()).findByText('Approved.', { exact: true })).toBeTruthy()
    await waitFor(() => expect(ratify.getAttribute('aria-disabled')).toBeNull())
    fireEvent.click(ratify)
    expect(confirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(body(calls, `/api/proposals/${ID}/ratify`)).toEqual([{}]))
  })

  it('previewed as Members, an admitted full view with private ops is drawn in its restricted form (rule 8, review I-1)', async () => {
    const garden = resource({ id: 'project:garden', source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'garden' } })
    const full = { ...proposalDetail({ id: ID, title: 'Pay the Q3 stipends', rationale: 'The quarter closed.' } as never),
      private: [{ ref: 'payroll:q3', class: 'records', op: { op: 'update' } }] } as unknown as ProposalDetail
    serve(full, 'steward-a', { 'GET /api/resources': [garden] })
    renderAt(<ViewAsProvider initial={{ as: 'members' }}><Switch><Route path="/governance/proposals/:id">{p => <ProposalPage id={p.id} />}</Route></Switch></ViewAsProvider>, PATH)
    expect((await screen.findByRole('heading', { level: 1, name: 'A change to a restricted collection' })).textContent).toBe('A change to a restricted collection')
    expect(screen.getByText('This proposal changes a restricted collection: what it changes is shown only to those admitted to it.')).toBeTruthy()
    expect(screen.queryByText('Pay the Q3 stipends')).toBeNull()
    expect(screen.queryByText('The quarter closed.')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Changes' })).toBeNull()
  })
})

// --- DAO-OS L6 Task 16b (R-L6-SUGGEST), ported by C11 fix round 1: a suggested page edit is a proposal holding one
// `file` op (L6 §11.2). Before the port the page crashed on it: Touches read `op.record`, which a file op has not.
describe('a proposal holding a file op (a suggested page edit)', () => {
  it('draws without failing: Touches links the page by its path, and the diff is there on request', async () => {
    const diff = '--- a/pages/handbook-1a2b.md\n+++ b/pages/handbook-1a2b.md\n-The handbook starts here.\n+The handbook starts here. Suggested.\n'
    serve(proposalDetail({ id: ID, title: 'Edit to Handbook', diff, current: [null],
      ops: [{ op: 'file', path: 'pages/handbook-1a2b.md', text: '---\nid: handbook-1a2b\n---\nThe handbook starts here. Suggested.\n', base: 'b0' }] as never }))
    page()
    expect((await screen.findByRole('heading', { level: 1, name: 'Edit to Handbook' })).textContent).toBe('Edit to Handbook')
    const about = within(screen.getByRole('complementary', { name: 'About this proposal' })).getByRole('group', { name: 'Route and touches' })
    expect(within(about).getByRole('link', { name: 'pages/handbook-1a2b.md' }).getAttribute('href')).toBe('/p/handbook-1a2b')
    const changes = within(await section('Changes'))
    expect(changes.queryByText(/undefined/)).toBeNull()
    fireEvent.click(changes.getByRole('button', { name: 'Show the diff' }))
    expect(changes.getByText(/\+The handbook starts here\. Suggested\./)).toBeTruthy()
  })
})
