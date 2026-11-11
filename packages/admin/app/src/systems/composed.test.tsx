// @vitest-environment jsdom
// A composed System is a plan, not the org's own (whole-platform walk I1, I2; review G3). The walk composed a Test DAO (its
// Safe in the treasury's section, its Hats tree) beside the org's deployed Treasury Safe and Hats tree: the Treasury
// headlined the undeployed Safe, Roles showed the composed tree, Needs you said the composed Safe "couldn't be read in
// full" while Home counted it among the Systems read. The server already says `facts.composed` in the read; these read it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import type { Resource } from '../api.ts'
import { isComposedRead, systemState } from '../elements/rows/systemState.ts'
import { needsFrom } from '../elements/needs/needs.ts'
import { systemsRead } from '../blocks/needs.tsx'
import { mainSafeOfResources } from '../map/fromRecords.ts'
import { mainSafeOf, type MapItem } from '../map/layers.ts'
import Roles from '../pages/Roles.tsx'
import Needs from '../pages/Needs.tsx'
import { BoardPage } from '../boards/Board.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes } from '../test/data.ts'
import { FIXED_NOW } from '../test/fixtures/parts.ts'
import { ACTOR } from '../test/fixtures/house/governance.ts'
import { ROLES, TREASURY_SYSTEM } from '../test/fixtures/house/systems.ts'
import { COMPOSED_SAFE, COMPOSED_SAFE_RESOURCE, COMPOSED_TREE, COMPOSED_TREE_RESOURCE } from '../test/fixtures/house/composed.ts'

/** The org's own tree, which the systems adapter marks as the membership tree (governance.membership.tree). */
const ORG_TREE: Resource = ROLES
/** The same tree when no membership tree is known (several deployed trees, none named). */
const UNMARKED_TREE: Resource = { ...ROLES, facts: Object.fromEntries(Object.entries(ROLES.facts).filter(([k]) => k !== 'membership')) }
/** The walk's order: the composed Test DAO first, then what the org runs. */
const WALK = [COMPOSED_SAFE_RESOURCE, COMPOSED_TREE_RESOURCE, TREASURY_SYSTEM, ORG_TREE]
const DEPLOYED = [TREASURY_SYSTEM, ORG_TREE]
/** As the walk had it for the Treasury: the org's tree signs for no Safe here, so nothing points at the Treasury, while the
 *  composed tree signs for the composed Safe (and "Test DAO Safe" goes before "Treasury" by name). */
const TREASURY_WALK = [COMPOSED_SAFE_RESOURCE, COMPOSED_TREE_RESOURCE, TREASURY_SYSTEM]
const ENTRIES = { name: 'systems', kind: 'collection', schemaVersion: '2.0', entries: [
  COMPOSED_SAFE, COMPOSED_TREE,
  { id: 'treasury', kind: 'safe', name: 'Treasury', section: 'organization/treasury' },
  { id: 'roles', kind: 'hats-tree', name: 'Roles', section: 'organization/roles' },
] }
const entryOf = (r: Resource) => ENTRIES.entries.find(e => e.id === r.source?.entityId) as Record<string, unknown> | undefined ?? null
const routes = (over: Record<string, unknown> = {}) => fetchRoutes({
  ...baseRoutes({ 'GET /api/actor': { id: ACTOR, name: 'Council steward', kind: 'person' } }),
  'GET /api/resources': WALK, 'GET /api/proposals': [], 'GET /api/jobs': [], 'GET /api/registries': [],
  'GET /api/registries/systems': ENTRIES,
  'GET /api/governance': { model: null, description: null, rules: [], decisions: [], problems: [] }, ...over,
})
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(FIXED_NOW) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('isComposedRead', () => {
  it('is the read the server answers for a composed System, and nothing else', () => {
    expect(isComposedRead(COMPOSED_SAFE_RESOURCE)).toBe(true)
    expect(isComposedRead(COMPOSED_TREE_RESOURCE)).toBe(true)
    expect(isComposedRead(TREASURY_SYSTEM)).toBe(false)
    expect(ORG_TREE.facts.membership).toBe(true)
    expect(isComposedRead(ORG_TREE)).toBe(false)
    // a failed read says nothing of composition
    expect(isComposedRead({ ...COMPOSED_SAFE_RESOURCE, facts: { ...COMPOSED_SAFE_RESOURCE.facts, driver: { ok: false, readAt: null, facts: { composed: true }, sections: [], open: null } } })).toBe(false)
  })
})

describe('a composed System reads as a draft (I2)', () => {
  it('its state is "Not deployed", a draft, never "Not fully read" or "Up to date"', () => {
    expect(systemState(COMPOSED_SAFE_RESOURCE)).toEqual({ mark: 'draft', words: 'Not deployed' })
    expect(systemState(COMPOSED_TREE_RESOURCE)).toEqual({ mark: 'draft', words: 'Not deployed' })
  })

  it('raises no need: Needs you is what the deployed Systems raise', () => {
    const now = FIXED_NOW
    const needs = needsFrom(WALK, [], ACTOR, now)
    expect(needs.flatMap(n => n.nodes)).not.toContain(COMPOSED_SAFE_RESOURCE.id)
    expect(needs.flatMap(n => n.nodes)).not.toContain(COMPOSED_TREE_RESOURCE.id)
    expect(needs).toEqual(needsFrom(DEPLOYED, [], ACTOR, now))
  })

  it('is left out of how the Systems were read (Home’s line and Needs you’s)', () => {
    expect(systemsRead(WALK)).toEqual(systemsRead(DEPLOYED))
  })
})

describe('the main Safe is never a composed one (I1)', () => {
  it('the Treasury’s Safe, though the composed Safe sits in the treasury’s section and more edges point at it', () => {
    expect(mainSafeOfResources(TREASURY_WALK, entryOf)?.id).toBe(TREASURY_SYSTEM.id)
  })

  it('a map with only a composed Safe has no main Safe', () => {
    const items: MapItem[] = [{ id: 'system:test-dao-safe', kind: 'safe', name: 'Test DAO Safe', section: 'organization/treasury', composed: true }]
    expect(mainSafeOf(items, [])).toBeNull()
  })
})

describe('the walk’s pages keep the org’s own (I1, I2)', () => {
  it('/b/treasury heads the board with the Treasury, not the composed Test DAO Safe', async () => {
    routes({ 'GET /api/resources': TREASURY_WALK })
    renderAt(<BoardPage id="treasury" />, '/b/treasury')
    const head = await waitFor(() => { const h = document.querySelector('header.rh-sys'); expect(h).not.toBeNull(); return h as HTMLElement })
    expect(within(head).getByRole('heading', { level: 1, name: 'Treasury' })).toBeTruthy()
  })

  it('/roles draws the membership tree, not the first hats-tree (the composed one)', async () => {
    routes()
    renderAt(<Roles />, '/roles')
    expect(await screen.findByRole('tree', { name: 'Roles in Roles' })).toBeTruthy()
    expect(screen.queryByText(/Test DAO roles/)).toBeNull()
  })

  it('/roles with no membership tree named draws a deployed tree, never a composed one', async () => {
    routes({ 'GET /api/resources': [COMPOSED_SAFE_RESOURCE, COMPOSED_TREE_RESOURCE, TREASURY_SYSTEM, UNMARKED_TREE] })
    renderAt(<Roles />, '/roles')
    expect(await screen.findByRole('tree', { name: 'Roles in Roles' })).toBeTruthy()
  })

  it('Home and Needs you agree: the same items, none of the composed Test DAO, and the Systems line counts the deployed ones', async () => {
    routes()
    const home = renderAt(<BoardPage id="home" />)
    const region = await screen.findByRole('region', { name: /^Needs you/ })
    await waitFor(() => expect(home.container.querySelector('.greet-s')!.textContent).toMatch(/2 Systems, none failing/))
    const homeTitles = [...region.querySelectorAll('.need-t')].map(t => t.textContent)
    expect(homeTitles.join(' ')).not.toMatch(/Test DAO/)
    home.unmount()
    renderAt(<Needs />, '/needs')
    const list = await screen.findByRole('list', { name: 'Needs you' })
    const titles = [...list.querySelectorAll('.need-t')].map(t => t.textContent)
    expect(titles).toEqual(homeTitles)
  })
})
