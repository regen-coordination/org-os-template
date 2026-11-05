// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import Roles, { rolesOf } from './Roles.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, refuse } from '../test/data.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { FIXED_NOW } from '../test/fixtures/parts.ts'
import { ROLES, SYSTEMS, TREASURY_SYSTEM, VOTES, hatRefOf } from '../test/fixtures/house/systems.ts'

const routes = (resources = SYSTEMS) => fetchRoutes({ ...baseRoutes(), 'GET /api/resources': resources })
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(FIXED_NOW) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('rolesOf: the role tree from the reads (E-40)', () => {
  it('says what a hat does from the chain: the signer hat "signs 4 of 8", the top hat "held by the Safe"', () => {
    const tree = rolesOf(ROLES, SYSTEMS)
    expect(tree).toHaveLength(1)
    expect(tree[0]!.id).toBe(hatRefOf())
    expect(tree[0]!.does).toBe('top hat · held by the Safe')
    const council = tree[0]!.children.find(n => n.id === hatRefOf(1))!
    expect(council.children.find(n => n.id === hatRefOf(1, 1))!.does).toBe('signs 4 of 8')
    expect(council.does).toBe('')
  })

  it('has no hats for a tree whose read failed', () => {
    const failed = { ...ROLES, facts: { ...ROLES.facts, driver: { ...(ROLES.facts.driver as object), ok: false } } }
    expect(rolesOf(failed, SYSTEMS)).toEqual([])
  })
})

describe('/roles', () => {
  it('draws the Hats tree System’s role tree, with the tree’s read as its from mark', async () => {
    routes()
    renderAt(<Roles />, '/roles')
    const tree = await screen.findByRole('tree', { name: 'Roles in Roles' })
    expect(within(tree).getByText('Treasury signer')).toBeTruthy()
    expect(document.querySelector('.rh-meta .from')!.textContent).toMatch(/^from Roles · read 4.min ago/)
  })

  it("says why the records could not be read, in its note and once through the page's polite region (§13, C11)", async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources': refuse(500, { error: 'The records could not be read.' }) })
    renderAt(<Roles />, '/roles')
    expect((await screen.findByText('The records could not be read.')).closest('.note-error')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('The records could not be read.'))
  })

  it('without a Hats tree: "No Hats tree yet." and the way to add one', async () => {
    routes([TREASURY_SYSTEM, VOTES])
    renderAt(<Roles />, '/roles')
    expect(await screen.findByText('No Hats tree yet.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add one from the Library.' }).getAttribute('href')).toBe('/library')
    expect(screen.queryByRole('tree')).toBeNull()
  })

  it('previewing as a hat that may not see the tree, there is no tree to draw (E-39)', async () => {
    const hidden = { ...ROLES, facts: { ...ROLES.facts, visibility: 'hat:treasury' } }
    routes([TREASURY_SYSTEM, hidden])
    renderAt(<ViewAsProvider initial={{ as: 'hat', hat: 'ops', name: 'Ops' }}><Roles /></ViewAsProvider>, '/roles')
    expect(await screen.findByText('No Hats tree yet.')).toBeTruthy()
    expect(screen.queryByRole('tree')).toBeNull()
    expect(screen.queryByText('Treasury signer')).toBeNull()
  })
})
