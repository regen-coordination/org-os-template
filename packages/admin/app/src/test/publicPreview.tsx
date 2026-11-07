/** The *Public preview of a members-only instance* case (Review Focus 1, E-44): previewed as Public, Home, /systems and
 *  Treasury show their empty states, no counts, no map nodes, no write control, and the tray hidden. The case takes
 *  its `VisibilitySource` as a parameter so L5 Task 20 reruns it on the real source (houseSource): the instance is the
 *  house fixtures with no `visibility` of their own anywhere, which every source must read as members-only. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { ClaimPlan, ClaimStatus, WizardDef } from '../api.ts'
import Nav from '../Nav.tsx'
import Tray from '../changes/Tray.tsx'
import { BoardPage } from '../boards/Board.tsx'
import Systems from '../pages/Systems.tsx'
import Governance from '../pages/Governance.tsx'
import ProposalPage from '../pages/Proposal.tsx'
import Library from '../pages/Library.tsx'
import ClaimHandle from '../wizards/ClaimHandle.tsx'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import type { VisibilitySource } from '../viewAs/visibility.ts'
import { fetchRoutes } from './fetchRoutes.ts'
import { renderAt } from './render.tsx'
import { flowEnv } from './flowEnv.ts'
import { baseRoutes } from './data.ts'
import { libraryList, preview as libraryPreview } from './fixtures/library.ts'
import { FIXED_NOW } from './fixtures/parts.ts'
import { ACTOR, PROPOSALS, PROPOSAL_RESOURCES } from './fixtures/house/governance.ts'
import { SYSTEMS } from './fixtures/house/systems.ts'
import { STAGED } from './fixtures/house/tray.ts'

/** A control that writes: one that stages, saves, applies or moves (C-23). None may be drawn while previewing. Named
 *  by what it does, not one by one: the verbs a write is said with in the Hub, and the addresses that open a write. */
const WRITE_WORDS = /^(\+ ?)?(Arrange|Copy to yours|New\b|Add\b|Edit\b|Save\b|Stage\b|Review\b|Apply\b|Propose\b|Discard\b|Update proposal|Approve|Object|Ratify|Prepare|Sign\b|Move\b|Done\b|Auto-layout|Read now|Sync|Share|Remove\b)/
const WRITE_HREF = /[?&](edit|op)=|^\/new\//

/** No control that writes is drawn (C-23): no button or link named by a write's verb, none that opens a write, nothing
 *  draggable. Shared with the pages' own preview cases (the proposal page's, C7). */
export function expectNoWriteControls(): void {
  const controls = [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]
  const nameOf = (el: HTMLElement) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim()
  expect(controls.filter(el => WRITE_WORDS.test(nameOf(el))).map(nameOf)).toEqual([])
  expect(controls.filter(el => WRITE_HREF.test(el.getAttribute('href') ?? '')).map(nameOf)).toEqual([])
  expect(document.querySelector('.react-flow__node.draggable, [draggable="true"]')).toBeNull()
}

/** Defines the case's tests, on `source`, under `name`. Strip the instance of any `visibility` the source would read:
 *  `members` (a source's own way of saying it) is what the instance is. */
export function describePublicPreview(name: string, source: VisibilitySource): void {
  const members = <T,>(xs: T[]): T[] => xs.map(x => {
    const r = structuredClone(x) as { facts?: Record<string, unknown>; visibility?: unknown }
    delete r.visibility
    if (r.facts) delete r.facts.visibility
    return r as T
  })
  const routes = () => fetchRoutes({
    ...baseRoutes({ 'GET /api/actor': { id: ACTOR, name: 'Council steward', kind: 'person' }, 'GET /api/changes': STAGED }),
    'GET /api/resources': members([...SYSTEMS, ...PROPOSAL_RESOURCES]), 'GET /api/proposals': members(PROPOSALS), 'GET /api/jobs': [],
    'GET /api/registries': [{ name: 'systems', kind: 'collection', count: SYSTEMS.length }],
    'GET /api/governance': { model: null, description: null, rules: [], problems: [],
      decisions: [{ date: '2026-10-15', id: 'DR-2026-011', title: 'Return the pools to the treasury', status: 'executed', group: null, where: 'governance.yaml' }] },
  })
  const preview = (page: ReactElement, path: string) => renderAt(
    <ViewAsProvider source={source} initial={{ as: 'public' }}><Nav />{page}<Tray /></ViewAsProvider>, path)
  /** No count beside a section, no node, no write control, and no tray. */
  const nothingOfTheMembers = () => {
    const nav = screen.getByRole('navigation', { name: 'Hub' })
    for (const s of ['Needs you', 'Proposals', 'Systems', 'Changes']) expect(within(nav).getByRole('link', { name: s })).toBeTruthy()
    expect(document.querySelector('[data-node-id]')).toBeNull()
    expectNoWriteControls()
    expect(screen.queryByRole('region', { name: 'Changes' })).toBeNull()
    // and no count beside any section's head: every region is named without " · <n>" (Review Focus 1)
    expect(screen.queryAllByRole('region').map(r => r.getAttribute('aria-label') ?? document.getElementById(r.getAttribute('aria-labelledby') ?? '')?.textContent ?? '')
      .filter(n => / · \d+$/.test(n))).toEqual([])
  }

  describe(name, () => {
    beforeEach(() => { flowEnv(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(FIXED_NOW); routes() })
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

    it('Home: nothing waits, no System, nothing recent — and nothing of the members', async () => {
      preview(<BoardPage id="home" />, '/')
      expect(await screen.findByRole('heading', { level: 1, name: 'Nothing waits on you.' })).toBeTruthy()
      const needs = await screen.findByRole('region', { name: 'Needs you' })
      expect(within(needs).getByText('Nothing waits on you.')).toBeTruthy()
      const systems = await screen.findByRole('region', { name: 'Systems' })
      expect(await within(systems).findByText('No Systems here yet.')).toBeTruthy()
      fireEvent.click(within(systems).getByRole('tab', { name: 'Map' }))
      expect(within(systems).getByText('No Systems here yet.')).toBeTruthy()
      const recently = await screen.findByRole('region', { name: 'Recently' })
      expect(await within(recently).findByText('Nothing decided or executed yet.')).toBeTruthy()
      nothingOfTheMembers()
    })

    it('/systems: no System, on the list or the map', async () => {
      preview(<Systems />, '/systems')
      expect(await screen.findByRole('heading', { level: 1, name: 'Systems' })).toBeTruthy()
      expect(await screen.findByText('No Systems here yet.')).toBeTruthy()
      fireEvent.click(screen.getByRole('tab', { name: 'Map' }))
      expect(screen.getByText('No Systems here yet.')).toBeTruthy()
      nothingOfTheMembers()
    })

    it('Treasury: no Safe header, no balance, no prepared transaction, no decision that moved money', async () => {
      preview(<BoardPage id="treasury" />, '/b/treasury')
      expect(await screen.findByRole('heading', { level: 1, name: 'Treasury' })).toBeTruthy()
      await waitFor(() => expect(screen.getByText('No balances read yet: the Treasury’s Safe is read from data/systems.yaml.')).toBeTruthy())
      expect(document.querySelector('.rh-sys')).toBeNull()
      expect(await screen.findByText('No prepared transaction waits on signers.')).toBeTruthy()
      expect(screen.getByRole('region', { name: 'Waiting on signers' })).toBeTruthy() // its exact name: no "· 0"
      expect(screen.queryByText(/The Hub never signs/)).toBeNull()
      expect(await screen.findByText('No decision has moved money yet.')).toBeTruthy()
      nothingOfTheMembers()
    })

    it('Proposals: none open, Open 0, no Sync or Share; a proposal’s page is not shown (E-50)', async () => {
      preview(<Governance part="proposals" />, '/governance/proposals')
      expect(await screen.findByText(/^None open\./)).toBeTruthy()
      await waitFor(() => expect(screen.getByRole('tab', { name: /^Open/ }).textContent).toBe('Open 0'))
      nothingOfTheMembers()
    })

    it('Proposals’ Decided and Rules: no decision, no rule, no governance.yaml well (C7 review I-2, fail closed)', async () => {
      const { rerender } = preview(<Governance part="decisions" />, '/governance/decisions')
      expect(await screen.findByText('Previewing as Public, no decision is shown.')).toBeTruthy()
      expect(screen.queryByText('Return the pools to the treasury')).toBeNull()
      await waitFor(() => expect(screen.getByRole('tab', { name: /^Decided/ }).textContent).toBe('Decided 0'))
      nothingOfTheMembers()
      rerender(<ViewAsProvider source={source} initial={{ as: 'public' }}><Nav /><Governance part="rules" /><Tray /></ViewAsProvider>)
      expect(await screen.findByText('Previewing as Public, the rules in force are not shown.')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Show governance.yaml' })).toBeNull()
      nothingOfTheMembers()
    })

    it('a proposal’s page, previewed as Public, draws nothing of it', async () => {
      const id = String(PROPOSALS[0]!.id)
      fetchRoutes({ ...baseRoutes({ 'GET /api/actor': { id: ACTOR, name: 'Council steward', kind: 'person' } }),
        'GET /api/resources': members([...SYSTEMS, ...PROPOSAL_RESOURCES]), [`GET /api/proposals/${id}`]: { ...members(PROPOSALS)[0], diff: null, current: [] } })
      preview(<ProposalPage id={id} />, `/governance/proposals/${id}`)
      expect(await screen.findByText('Previewing as Public, this proposal is not shown.')).toBeTruthy()
      expect(screen.queryByText(String(PROPOSALS[0]!.title))).toBeNull()
      nothingOfTheMembers()
    })

    // C6/A1 (fix wave): a preview draws no write control anywhere — the library drew "Add — stage a change", and a
    // receipt's Remove.
    it('a library entry’s preview: what adding would do, and no Add and no Remove', async () => {
      fetchRoutes({ ...baseRoutes(),
        'GET /api/library': libraryList(), 'GET /api/library/board%3Atreasury-council/preview': libraryPreview() })
      preview(<Library id="board:treasury-council" />, '/library/board%3Atreasury-council')
      expect(await screen.findByText(/^Adding stages one change\./)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Add — stage a change' })).toBeNull()
      expect(screen.getByRole('link', { name: 'Close preview' })).toBeTruthy()
      nothingOfTheMembers()
    })

    // C6/A1 (fix wave): a wizard's review drew "This is me" and "Save and leave" under the band. R1: the draft those
    // controls would keep is a PUT to the server; a preview makes none, so no draft file is written either.
    it('a wizard’s review: the line it would write, and neither This is me nor Save and leave', async () => {
      const { calls } = fetchRoutes({ ...baseRoutes({ 'GET /api/actor': { unknown: 'steward-a@example.org' } }),
        'GET /api/bootstrap/claim': CLAIM_STATUS, 'GET /api/wizards/claim-handle/draft': null,
        'PUT /api/wizards/claim-handle/draft': () => ({ saved: 'now' }), 'POST /api/bootstrap/claim/plan': CLAIM_PLAN })
      preview(<ClaimHandle def={CLAIM} />, '/wizards/claim-handle')
      fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
      fireEvent.click(screen.getByRole('radio', { name: /Steward A/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      expect(await screen.findByRole('heading', { level: 2, name: 'Check the line' })).toBeTruthy()
      expect(await screen.findByText(/git: steward-a@example\.org/, { selector: '.wiz-log *, .wiz-log' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'This is me' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Save and leave' })).toBeNull()
      nothingOfTheMembers()
      // The only write a wizard makes before its last step is the draft (`PUT /api/wizards/<id>/draft`, which writes
      // `<state>/wizards/<id>-1.json`): a preview makes neither, so no draft file is written. (The POST beside it is
      // the plan the review reads; the server writes nothing for it.)
      expect(calls.filter(c => c.path === '/api/wizards/claim-handle/draft' && c.method !== 'GET')).toEqual([])
    })
  })
}

const CLAIM: WizardDef = {
  id: 'claim-handle', title: 'Claim your handle', summary: 'Tell this app which member you are.',
  intro: { body: 'No member holds your address yet.', writes: 'Nothing. You choose, and you see the exact line, before anything is written.' },
  steps: [{ id: 'who', title: 'Which member are you?', ask: 'Pick the member that is you.', writes: 'Nothing yet. The next screen shows the exact line.' }],
  review: { title: 'Check the line', ask: 'This is the line that will be written.', writes: 'One line in data/members.yaml, and one commit that records it.' },
  done: { title: 'You are {member}', body: 'This page is editable now.' },
}
const CLAIM_STATUS: ClaimStatus = {
  available: true, refusal: null, address: 'steward-a@example.org', rule: 'bootstrap/claim', canCreate: false,
  candidates: [{ id: 'steward-a', name: 'Steward A' }],
}
const CLAIM_PLAN: ClaimPlan = {
  nonce: 'n'.repeat(48), expiresInMs: 120000,
  review: {
    address: 'steward-a@example.org', file: 'data/members.yaml', lines: ['      git: steward-a@example.org'],
    member: { id: 'steward-a', name: 'Steward A', created: false },
    commit: { message: 'admin(members): claim the git handle for steward-a', trailers: { 'Org-Actor': 'unknown <steward-a@example.org>', 'Org-Rule': 'bootstrap/claim' } },
    note: 'This file is committed. If this repository is public, the address becomes public.',
    cmd: 'node', args: ['claim-handle.mjs', '--member', 'steward-a'], writes: ['data/members.yaml'], timeoutMs: 10000, network: false,
  },
}
