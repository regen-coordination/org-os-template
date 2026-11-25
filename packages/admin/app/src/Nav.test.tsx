// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import Nav from './Nav.tsx'
import ReadOnlyNotice from './ReadOnly.tsx'
import { fetchRoutes } from './test/fetchRoutes.ts'
import { renderAt } from './test/render.tsx'
import { baseRoutes, changeView, resource } from './test/data.ts'
import { proposalView } from './test/fixtures/proposals.ts'
import { ViewAsProvider, useViewer } from './viewAs/ViewAs.tsx'

const warn = { level: 'warn' as const, text: 'x' }, alert = { level: 'alert' as const, text: 'x' }
const gov = { model: null, description: null, rules: [], decisions: [], problems: [] }
const op = (record: string) => ({ op: 'set', record, field: 'status', value: 'x', before: 'y' })
const house = () => screen.getByRole('navigation', { name: 'Hub' })

function PreviewPublic() {
  const { setViewer } = useViewer()
  return <button type="button" onClick={() => setViewer({ as: 'public' })}>preview</button>
}

const routes = (over: Record<string, unknown> = {}) => fetchRoutes({
  ...baseRoutes(),
  'GET /api/changes': changeView({ ops: [op('project:p'), op('project:q')] as never }),
  'GET /api/resources': [
    resource({ id: 'project:p', attention: warn }), resource({ id: 'project:q' }),
    resource({ id: 'module:m', kind: 'module', board: 'systems', attention: alert, source: null }),
    resource({ id: 'system:safe', kind: 'system', board: 'systems', source: null, facts: { visibility: 'public' } }),
  ],
  'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 2 }, { name: 'meetings', kind: 'collection', count: 0 }],
  'GET /api/governance': gov,
  'GET /api/proposals': [proposalView({ id: 'p-1' }), proposalView({ id: 'p-2', needsYou: true }), proposalView({ id: 'p-3', state: 'withdrawn', derived: 'withdrawn' })],
  ...over,
})

describe('Nav: the house sidebar on 0.6’s queries (§5.2)', () => {
  it('counts what needs you, the open proposals, the Systems and the staged ops', async () => {
    routes()
    renderAt(<ViewAsProvider><Nav /></ViewAsProvider>)
    // needs: Needs you's items (E-34) — the one proposal waiting on you; a record's own attention is not one now
    // (ledger C6: 0.6 counted records with attention too)
    expect(await within(house()).findByRole('link', { name: 'Needs you, 1' })).toBeTruthy()
    expect(await within(house()).findByRole('link', { name: 'Proposals, 2' })).toBeTruthy()
    expect(within(house()).getByRole('link', { name: 'Systems, 1' })).toBeTruthy()
    expect(await within(house()).findByRole('link', { name: 'Changes, 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fixture Org' })).toBeTruthy()
  })

  it('previewing as Public counts only what anyone may read, and no staged change', async () => {
    routes()
    renderAt(<ViewAsProvider><Nav /><PreviewPublic /></ViewAsProvider>)
    await within(house()).findByRole('link', { name: 'Needs you, 1' })
    fireEvent.click(screen.getByRole('button', { name: 'preview' }))
    // the walk review's G1: a preview reads every answer again, for the previewed viewer, before it counts
    expect(await within(house()).findByRole('link', { name: 'Systems, 1' })).toBeTruthy()
    expect(within(house()).getByRole('link', { name: 'Needs you' })).toBeTruthy()
    expect(within(house()).getByRole('link', { name: 'Proposals' })).toBeTruthy()
    expect(within(house()).getByRole('link', { name: 'Changes' })).toBeTruthy()
  })

  it('Workspace holds the 0.6 collections that have records, in Workspace order, while one of them is current', async () => {
    routes()
    renderAt(<ViewAsProvider><Nav /></ViewAsProvider>, '/b/projects')
    const projects = await within(house()).findByRole('link', { name: 'Projects' })
    expect(projects.getAttribute('href')).toBe('/b/projects')
    expect(projects.getAttribute('aria-current')).toBe('page')
    // design pass 2026-11-04: a collection whose file the server lists, with nothing in it, is listed with its dashed
    // dot (it was left out); one whose file is not here is not listed
    expect(within(house()).getByRole('link', { name: 'Meetings, empty' }).querySelector('.side-dot')).not.toBeNull()
    expect(within(house()).queryByRole('link', { name: /^Funding/ })).toBeNull()
    const names = within(house()).getAllByRole('link').map(a => a.getAttribute('aria-label'))
    // DAO-OS L6 Task 19: then Sources (§15)
    expect(names.slice(names.indexOf('Workspace') + 1, names.indexOf('Library'))).toEqual(['Meetings, empty', 'Projects', 'Sources'])
  })

  // walk I15, D1: each word once in the sidebar; Meetings opens the collection, where "Record a meeting" lives
  it('Meetings opens /c/meetings, the collection, not its board; no label is listed twice', async () => {
    routes()
    renderAt(<ViewAsProvider><Nav /></ViewAsProvider>, '/c/meetings')
    const meetings = await within(house()).findByRole('link', { name: /^Meetings/ })
    expect(meetings.getAttribute('href')).toBe('/c/meetings')
    expect(meetings.getAttribute('aria-current')).toBe('page')
    const labels = within(house()).getAllByRole('link').map(a => a.querySelector('.side-l')?.textContent)
    expect(new Set(labels).size).toBe(labels.length)
  })

  // DAO-OS L6 Task 19
  it('lists Sources under Workspace after its collections, current on /sources; absent previewing as Public', async () => {
    routes()
    const { unmount } = renderAt(<ViewAsProvider><Nav /></ViewAsProvider>, '/sources')
    const sources = await within(house()).findByRole('link', { name: 'Sources' })
    expect(sources.getAttribute('href')).toBe('/sources')
    expect(sources.getAttribute('aria-current')).toBe('page')
    expect(within(house()).getByRole('link', { name: 'Workspace' }).classList.contains('on')).toBe(true)
    unmount()
    routes()
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><Nav /></ViewAsProvider>, '/workspace')
    await within(house()).findByRole('link', { name: 'Systems, 1' })
    expect(within(house()).queryByRole('link', { name: 'Sources' })).toBeNull()
  })

  it('lists no empty collection while previewing as Public', async () => {
    routes()
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><Nav /></ViewAsProvider>, '/workspace')
    await within(house()).findByRole('link', { name: 'Systems, 1' }) // the resources are read
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Proposals' })).toBeTruthy()) // and the proposals
    expect(within(house()).queryByRole('link', { name: /^Projects/ })).toBeNull()
    expect(within(house()).queryByRole('link', { name: /^Meetings/ })).toBeNull()
  })

  it('the Instance group holds the org-os boards with records, and Activity, All records, Boards', async () => {
    routes()
    renderAt(<ViewAsProvider><Nav /></ViewAsProvider>)
    const toggle = await within(house()).findByRole('button', { name: 'Instance' })
    fireEvent.click(toggle)
    const names = within(house()).getAllByRole('link').map(a => a.getAttribute('aria-label'))
    expect(names.slice(names.indexOf('Modules'))).toEqual(['Modules', 'Activity', 'All records', 'Boards'])
    expect(names).not.toContain('Crew') // no crew records
  })

  it('marks Library while one of its entries is open, and Proposals on a proposal’s page', async () => {
    routes()
    const { unmount } = renderAt(<ViewAsProvider><Nav /></ViewAsProvider>, '/library/board%3Aonboarding')
    expect((await within(house()).findByRole('link', { name: 'Library' })).getAttribute('aria-current')).toBe('page')
    unmount()
    renderAt(<ViewAsProvider><Nav /></ViewAsProvider>, '/governance/proposals/p-2')
    expect((await within(house()).findByRole('link', { name: 'Proposals, 2' })).getAttribute('aria-current')).toBe('page')
  })

  it('a git actor\'s identity is 0.6\'s: the member\'s name, no address, no hat id (no session)', async () => {
    routes({ 'GET /api/actor': { id: 'steward-a', name: 'Steward A', kind: 'person' } })
    const { container } = renderAt(<ViewAsProvider><Nav /></ViewAsProvider>)
    expect(await screen.findByRole('button', { name: /^Steward A/ })).toBeTruthy()
    expect(container.querySelector('.who-s')).toBeNull()
  })

  it('a signed-in member\'s identity is the session\'s: the lowest worn hat, the short address and its hat id; the menu lists the hats', async () => {
    const CELO = 'eip155:42220'
    const TOP = `${CELO}:0x0000000d${'0'.repeat(56)}`, COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
    const ACCOUNT = `${CELO}:0x00000000000000000000000000000000000000a1`
    routes({
      'GET /api/actor': { id: ACCOUNT, name: 'Council · 0x0000…00a1', kind: 'person', via: 'siwe', account: ACCOUNT, hats: [TOP, COUNCIL], reading: { block: 1, readAt: '' } },
      'GET /api/session': { mode: 'local', signedIn: true, actor: ACCOUNT, account: ACCOUNT, expiresAt: '2026-10-31T10:00:00.000Z',
        hats: [{ hat: TOP, name: 'Top' }, { hat: COUNCIL, name: 'Council' }] },
    })
    const { container } = renderAt(<ViewAsProvider><Nav /></ViewAsProvider>)
    const who = await screen.findByRole('button', { name: /^Council/ })
    expect(container.querySelector('.who-t')!.textContent).toBe('Council')
    expect(container.querySelector('.who-s')!.textContent).toBe('0x0000…00a1 · hat 0x0000000d.0001')
    fireEvent.click(who)
    expect(screen.getAllByRole('menuitem').map(i => i.textContent).slice(0, 2)).toEqual(['Top', 'Council'])
  })

  it('a session with no hats says "No hats" only for a reading that exists; unread (I1) or past the grace, "Hats not read"', async () => {
    const ACCOUNT = 'eip155:42220:0x00000000000000000000000000000000000000a1'
    const IN = { mode: 'local', signedIn: true, actor: ACCOUNT, account: ACCOUNT, expiresAt: '2026-10-31T10:00:00.000Z', hats: [] }
    const band = 'Your hats could not be read for an hour; you see what anyone sees until they can be.'
    for (const [session, said] of [[IN, 'No hats'], [{ ...IN, unread: true, band }, 'Hats not read'], [{ ...IN, stale: true, band }, 'Hats not read']] as const) {
      routes({ 'GET /api/actor': { id: ACCOUNT, name: ACCOUNT, kind: 'person' }, 'GET /api/session': session })
      const { container, unmount } = renderAt(<ViewAsProvider><Nav /></ViewAsProvider>)
      await waitFor(() => expect(container.querySelector('.who-t')?.textContent).toBe(said))
      unmount()
    }
  })

  // R2 (plan §5): a member signed in by an emailed link (0.6.1): a person id, no wallet, no hats. The identity is their
  // name, as the server says it (their member name) and as their comments are signed, with their Roles; no address.
  it('a member signed in by an emailed link: their name and their Roles, no address, no hat; the read-only band says nothing', async () => {
    const ID = 'example-org:person:example-steward'
    routes({
      'GET /api/actor': { id: ID, name: 'Example Steward', kind: 'person', via: 'email', roles: ['steward'], nodes: [] },
      'GET /api/session': { mode: 'hosted', signedIn: true, via: 'email', actor: ID, viewer: 'member', expiresAt: '2026-10-31T10:00:00.000Z',
        person: { id: ID, name: 'Example Steward', roles: ['network-member', 'steward'], nodes: [] }, signIn: null, methods: ['email'], instanceWrites: 'on' },
    })
    const { container } = renderAt(<ViewAsProvider><Nav /><ReadOnlyNotice /></ViewAsProvider>)
    const who = await screen.findByRole('button', { name: /^Example Steward/ })
    await waitFor(() => expect(container.querySelector('.who-t')!.textContent).toBe('Example Steward'))
    expect(container.querySelector('.who-s')!.textContent).toBe('Network Member · Steward')
    expect(container.textContent).not.toMatch(/0x|No hats|Hats not read/)
    expect(container.querySelector('.band-ro')).toBeNull()
    fireEvent.click(who)
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(expect.arrayContaining(['Network Member', 'Steward']))
  })

  // refi-dao-os network app B3/B4: a Guest signed in with a Bluesky or Certified account has no account address, no
  // hats and no Roles: the frame draws their handle and the word Guest, never a wallet's face.
  it('a Guest signed in with a network account: their handle and Guest, no address, no hats', async () => {
    const DID = 'did:plc:gggggggggggggggggggggggg'
    routes({
      'GET /api/actor': null,
      'GET /api/session': { mode: 'hosted', signedIn: true, via: 'atproto', guest: { did: DID, handle: 'guest.bsky.social' }, roles: [],
        viewer: 'public', expiresAt: '2026-12-19T10:00:00.000Z', signIn: null, methods: ['email', 'atproto'], instanceWrites: 'on' },
    })
    const { container } = renderAt(<ViewAsProvider><Nav /></ViewAsProvider>)
    await waitFor(() => expect(container.querySelector('.who-t')?.textContent).toBe('guest.bsky.social'))
    expect(container.querySelector('.who-s')!.textContent).toBe('Guest')
    expect(container.textContent).not.toMatch(/0x|No hats|Hats not read/)
  })

  it('a member signed in by an emailed link finds their Bluesky or Certified account in the identity menu', async () => {
    const ID = 'example-org:person:example-steward'
    routes({
      'GET /api/actor': { id: ID, name: 'Example Steward', kind: 'person', via: 'email', roles: ['steward'], nodes: [] },
      'GET /api/session': { mode: 'hosted', signedIn: true, via: 'email', actor: ID, viewer: 'member', expiresAt: '2026-10-31T10:00:00.000Z',
        person: { id: ID, name: 'Example Steward', roles: ['steward'], nodes: [] }, signIn: null, methods: ['email', 'atproto'], instanceWrites: 'on' },
    })
    renderAt(<ViewAsProvider><Nav /></ViewAsProvider>)
    fireEvent.click(await screen.findByRole('button', { name: /^Example Steward/ }))
    const item = screen.getByRole('menuitem', { name: 'Bluesky or Certified account' })
    expect(item.getAttribute('href')).toBe('/account-links')
  })

  it('the identity is who git says you are', async () => {
    routes({ 'GET /api/actor': { id: 'steward-a', name: 'Steward A', kind: 'person' } })
    renderAt(<ViewAsProvider><Nav /></ViewAsProvider>)
    expect(await screen.findByRole('button', { name: /^Steward A/ })).toBeTruthy()
  })
})
