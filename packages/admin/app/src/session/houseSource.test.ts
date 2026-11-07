// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import Nav from '../Nav.tsx'
import App from '../App.tsx'
import type { VisibilityView } from '../api.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, resource } from '../test/data.ts'
import { ViewAsProvider, useViewer } from '../viewAs/ViewAs.tsx'
import { FIXTURE_SOURCE, canSee } from '../viewAs/visibility.ts'
import { houseSource } from './houseSource.ts'

// L5 spec §11.2: the Hub's VisibilitySource from GET /api/visibility. Placeholder tree eip155:42220:13: Top, Council and
// Ops under it, Stewards under Council.
const CELO = 'eip155:42220'
const hat = (levels: string) => `${CELO}:0x0000000d${levels.padEnd(56, '0')}`
const TOP = hat(''), COUNCIL = hat('0001'), OPS = hat('0002'), STEWARDS = hat('00010001')
const VIEW: VisibilityView = {
  tree: [
    { hat: TOP, name: 'Top', above: [] },
    { hat: COUNCIL, name: 'Council', above: [TOP] },
    { hat: STEWARDS, name: 'Stewards', above: [COUNCIL, TOP] },
    { hat: OPS, name: 'Ops', above: [TOP] },
  ],
  worn: [STEWARDS],
  levels: ['public', 'members', `hat:${STEWARDS}`, 'role:stewards'],
  config: { collections: {}, defaults: {} },
  writable: ['projects'],
}

describe('houseSource (L5 spec §11.2)', () => {
  const src = houseSource(VIEW)

  it('visibilityOf reads item.visibility, then facts.visibility, else members', () => {
    expect(src.visibilityOf({ visibility: 'public', facts: { visibility: `hat:${OPS}` } })).toEqual({ level: 'public' })
    expect(src.visibilityOf({ facts: { visibility: 'public' } })).toEqual({ level: 'public' })
    expect(src.visibilityOf({ visibility: 'members' })).toEqual({ level: 'members' })
    expect(src.visibilityOf({ facts: {} })).toEqual({ level: 'members' })
    expect(src.visibilityOf(null)).toEqual({ level: 'members' })
  })

  it('hat:<ref> gets the tree\'s name; role:ops reads as a hat named ops', () => {
    expect(src.visibilityOf({ visibility: `hat:${OPS}` })).toEqual({ level: 'hat', hat: OPS, name: 'Ops' })
    expect(src.visibilityOf({ visibility: 'role:ops' })).toEqual({ level: 'hat', hat: 'role:ops', name: 'ops' })
    // A hat the tree does not list is named by its ref.
    const other = hat('0003')
    expect(src.visibilityOf({ visibility: `hat:${other}` })).toEqual({ level: 'hat', hat: other, name: other })
  })

  it('hatsAbove and hats() follow the tree\'s order', () => {
    expect(src.hats()).toEqual([{ hat: TOP, name: 'Top' }, { hat: COUNCIL, name: 'Council' }, { hat: STEWARDS, name: 'Stewards' }, { hat: OPS, name: 'Ops' }])
    expect(src.hatsAbove(STEWARDS)).toEqual([COUNCIL, TOP])
    expect(src.hatsAbove(TOP)).toEqual([])
    // A Stewards wearer sees a Council-level thing only through a hat above; an Ops one is in another branch.
    expect(canSee({ as: 'hat', hat: COUNCIL, name: 'Council' }, src.visibilityOf({ visibility: `hat:${STEWARDS}` }), src)).toBe(true)
    expect(canSee({ as: 'hat', hat: OPS, name: 'Ops' }, src.visibilityOf({ visibility: `hat:${STEWARDS}` }), src)).toBe(false)
  })

  it('worn() is the session\'s', () => {
    expect(src.worn()).toEqual([STEWARDS])
    expect(houseSource({ ...VIEW, worn: [] }).worn()).toEqual([])
  })

  it('an org without a tree: its roles are the hats, and the roles held are worn', () => {
    const roles = houseSource({ ...VIEW, tree: [], worn: [], levels: ['public', 'members', 'role:ops', 'role:council'] })
    expect(roles.hats()).toEqual([{ hat: 'role:ops', name: 'ops' }, { hat: 'role:council', name: 'council' }])
    expect(roles.worn()).toEqual(['role:ops', 'role:council'])
    expect(canSee({ as: 'hat', hat: 'role:ops', name: 'ops' }, roles.visibilityOf({ visibility: 'role:ops' }), roles)).toBe(true)
  })
})

function PreviewPublic() {
  const { setViewer } = useViewer()
  return createElement('button', { type: 'button', onClick: () => setViewer({ as: 'public' }) }, 'preview')
}

describe('previewing as Public on the real source (the L4c "Public preview" case, rerun with houseSource)', () => {
  it('hides members\' records: only what the gate marked public is counted', async () => {
    // The gate marks every item with its level (§9.5); facts carry none, so the fixture source would read all as members.
    fetchRoutes({
      ...baseRoutes(),
      'GET /api/changes': changeView(),
      'GET /api/resources': [
        resource({ id: 'module:m', kind: 'module', board: 'systems', source: null, visibility: 'members' } as never),
        resource({ id: 'system:safe', kind: 'system', board: 'systems', source: null, visibility: 'public' } as never),
        resource({ id: 'system:pool', kind: 'system', board: 'systems', source: null, visibility: 'members' } as never),
      ],
      'GET /api/registries': [],
      'GET /api/governance': { model: null, description: null, rules: [], decisions: [], problems: [] },
      'GET /api/proposals': [],
    })
    renderAt(createElement(ViewAsProvider, { source: houseSource(VIEW), children: [createElement(Nav, { key: 'nav' }), createElement(PreviewPublic, { key: 'p' })] }))
    const house = () => screen.getByRole('navigation', { name: 'Hub' })
    expect(await within(house()).findByRole('link', { name: 'Systems, 2' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'preview' }))
    expect(within(house()).getByRole('link', { name: 'Systems, 1' })).toBeTruthy()
  })
})

describe('the Hub reads with the real source once GET /api/visibility answers (App)', () => {
  it('the fixtures until the view loads, then the tree\'s hats in the View as menu', async () => {
    const routes = fetchRoutes({
      ...baseRoutes(),
      'GET /api/resources': [], 'GET /api/registries': [], 'GET /api/proposals': [],
      'GET /api/governance': { model: null, description: null, rules: [], decisions: [], problems: [] },
      'GET /api/visibility': VIEW,
    })
    const { calls } = routes
    renderAt(createElement(App), '/activity')
    await waitFor(() => expect(calls.some(c => c.path === '/api/visibility')).toBe(true))
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    fireEvent.click(screen.getAllByRole('button', { name: /^View as/ })[0]!)
    expect(screen.getByRole('menuitemradio', { name: 'Stewards' })).toBeTruthy()
    expect(screen.queryByRole('menuitemradio', { name: 'Treasurer' })).toBeNull() // the fixture tree's, gone
    expect(FIXTURE_SOURCE.hats().map(h => h.name)).toContain('Treasurer')
  })
})
