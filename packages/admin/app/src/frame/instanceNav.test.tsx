// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { Sidebar } from './Sidebar.tsx'
import { currentNavItem, resolveNav, type HouseCounts, type Identity } from './sections.ts'
import { isIconName } from '../design/Icon.tsx'
import { renderAt } from '../test/render.tsx'
import type { InstanceNav } from '../api.ts'

const ORG = { name: 'Example DAO', mark: null }
const WHO: Identity = { hatName: 'A person', address: null, hatId: null, hats: [] }
const COUNTS: HouseCounts = { needs: 3, proposals: 1, systems: 0, changes: 2 }
const NAV: InstanceNav = {
  groups: [
    { label: null, items: [{ section: 'home', label: 'Dashboard' }, { section: 'needs' }] },
    { label: 'Governance', items: [
      { label: 'Decided', href: '/governance/decisions', audience: ['steward'] },
      { section: 'roles', label: 'Council', audience: ['steward'] },
      { label: 'Funds', href: 'https://old.example.org/funds', audience: ['steward'] },
    ] },
    { label: 'Network', items: [{ label: 'Local Nodes', href: '/b/nodes', icon: 'pin' }, { label: 'People', href: '/b/people', audience: ['steward', 'node-lead'] }] },
  ],
  more: null,
}
const nav = (roles: string[] | null) => resolveNav(NAV, roles, isIconName)
const hub = () => screen.getByRole('navigation', { name: 'Hub' })
const labels = (el: HTMLElement) => within(el).getAllByRole('link').map(a => a.querySelector('.side-l')?.textContent)

describe('resolveNav', () => {
  it('is null with no nav: the house draws its own sections', () => {
    expect(resolveNav(null, null, isIconName)).toBeNull()
    expect(resolveNav({ groups: [], more: null }, ['steward'], isIconName)).toBeNull()
  })
  it('draws a Steward every item, and puts the sections the file does not name under More', () => {
    const r = nav(['steward'])!
    expect(r.groups.map(g => g.items.map(i => i.label))).toEqual([['Dashboard', 'Needs you'], ['Decided', 'Council', 'Funds'], ['Local Nodes', 'People']])
    expect(r.more).toEqual({ label: 'More', sections: expect.any(Array) })
    expect(r.more.sections.map(s => s.id)).toEqual(['proposals', 'systems', 'treasury', 'workspace', 'library', 'changes'])
  })
  it('draws a Network Member only what is for everyone, drops a group left empty, and keeps Council out of More', () => {
    const r = nav(['network-member'])!
    expect(r.groups.map(g => g.label)).toEqual([null, 'Network'])
    expect(r.groups[1]!.items.map(i => i.label)).toEqual(['Local Nodes'])
    expect(r.more.sections.map(s => s.id)).not.toContain('roles')
  })
  it('draws a person with no Role the same as a Network Member, and a member with no Roles at all (git, wallet) everything', () => {
    expect(nav([])!.groups.map(g => g.label)).toEqual([null, 'Network'])
    expect(nav(null)!.groups.flatMap(g => g.items).map(i => i.label)).toContain('Funds')
  })
  it('marks another site external, and keeps an icon only when the house draws it', () => {
    const items = nav(null)!.groups.flatMap(g => g.items)
    expect(items.find(i => i.label === 'Funds')).toMatchObject({ kind: 'link', external: true })
    expect(items.find(i => i.label === 'Local Nodes')).toMatchObject({ icon: 'pin' })
    expect(resolveNav({ groups: [{ label: null, items: [{ label: 'X', href: '/x', icon: 'no-such-icon' }] }], more: null }, null, isIconName)!.groups[0]!.items[0])
      .toMatchObject({ icon: null })
  })
})

describe('currentNavItem', () => {
  it('prefers the longest link in the house over the section the path belongs to', () => {
    const r = nav(null)!
    expect(currentNavItem('/governance/decisions', r)?.label).toBe('Decided')
    expect(currentNavItem('/roles', r)?.label).toBe('Council')
    expect(currentNavItem('/', r)?.label).toBe('Dashboard')
    expect(currentNavItem('/b/nodes/extra', r)?.label).toBe('Local Nodes')
    expect(currentNavItem('/somewhere-else', r)).toBeNull()
  })
})

describe('the sidebar with an instance nav', () => {
  const side = (roles: string[] | null) => <Sidebar org={ORG} counts={COUNTS} identity={WHO} nav={nav(roles)} />
  it('draws the groups under their headings in place of the nine sections, a section keeping its count', () => {
    renderAt(side(['steward']), '/')
    expect(within(hub()).getByRole('group', { name: 'Governance' })).toBeTruthy()
    expect(labels(within(hub()).getByRole('group', { name: 'Network' }))).toEqual(['Local Nodes', 'People'])
    expect(within(hub()).getByRole('link', { name: 'Needs you, 3' })).toBeTruthy()
    expect(within(hub()).getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBe('page')
    expect(within(hub()).queryByRole('link', { name: /^Proposals/ })).toBeNull()
  })
  it('opens another site in a new tab and says so', () => {
    renderAt(side(['steward']), '/')
    const funds = within(hub()).getByRole('link', { name: 'Funds (opens in a new tab)' })
    expect(funds.getAttribute('href')).toBe('https://old.example.org/funds')
    expect(funds.getAttribute('target')).toBe('_blank')
    expect(funds.getAttribute('rel')).toBe('noopener noreferrer')
  })
  it('keeps the sections it did not name under More, collapsed, each with its count', () => {
    renderAt(side(['steward']), '/')
    const more = within(hub()).getByRole('button', { name: 'More' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(more)
    expect(within(hub()).getByRole('link', { name: 'Changes, 2' })).toBeTruthy()
    expect(within(hub()).getByRole('link', { name: 'Proposals, 1' })).toBeTruthy()
  })
  it('marks the current item once', () => {
    renderAt(side(['steward']), '/governance/decisions')
    const current = within(hub()).getAllByRole('link').filter(a => a.getAttribute('aria-current') === 'page')
    expect(current.map(a => a.textContent)).toEqual(['Decided'])
  })
  it('draws a Network Member no Governance group', () => {
    renderAt(side(['network-member']), '/')
    expect(within(hub()).queryByRole('group', { name: 'Governance' })).toBeNull()
    expect(within(hub()).queryByRole('link', { name: /Funds/ })).toBeNull()
  })
  it('draws the nine sections as before when the instance carries no nav', () => {
    renderAt(<Sidebar org={ORG} counts={COUNTS} identity={WHO} nav={null} />, '/')
    expect(within(hub()).getByRole('link', { name: /^Proposals/ })).toBeTruthy()
    expect(within(hub()).queryByRole('button', { name: 'More' })).toBeNull()
  })
})
