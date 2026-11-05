import { describe, it, expect } from 'vitest'
import { namedIn, pathOf } from './path.ts'

describe('pathOf: the top bar’s path (§5.5)', () => {
  it('a proposal is under Proposals, named by the names it is given', () => {
    expect(pathOf('/governance/proposals/DR-2026-010', { 'DR-2026-010': 'DR-2026-010' })).toEqual([
      { label: 'Proposals', href: '/governance/proposals' },
      { label: 'DR-2026-010', href: '/governance/proposals/DR-2026-010' },
    ])
  })

  it('Home is Home, at / and at its board', () => {
    expect(pathOf('/', {})).toEqual([{ label: 'Home', href: '/' }])
    expect(pathOf('/b/home', {})).toEqual([{ label: 'Home', href: '/' }])
  })

  it('the Proposals tabs sit under Proposals', () => {
    expect(pathOf('/governance/decisions', {})).toEqual([
      { label: 'Proposals', href: '/governance/proposals' }, { label: 'Decisions', href: '/governance/decisions' },
    ])
  })

  it('a Workspace collection sits under Workspace; a record of its kind under both', () => {
    expect(pathOf('/b/projects', {})).toEqual([{ label: 'Workspace', href: '/workspace' }, { label: 'Projects', href: '/b/projects' }])
    expect(pathOf('/r/project/proj-001', { 'project:proj-001': 'Node Onboarding Program' })).toEqual([
      { label: 'Workspace', href: '/workspace' }, { label: 'Projects', href: '/b/projects' },
      { label: 'Node Onboarding Program', href: '/r/project/proj-001' },
    ])
  })

  it('names a record by its kind and id, never by a bare id another kind shares (E-64)', () => {
    const names = { 'project:p1': 'Seed Library', 'person:p1': 'Steward A', p1: 'A board' }
    expect(pathOf('/r/project/p1', names).at(-1)).toEqual({ label: 'Seed Library', href: '/r/project/p1' })
    expect(pathOf('/r/person/p1', names).at(-1)).toEqual({ label: 'Steward A', href: '/r/person/p1' })
    expect(pathOf('/r/idea/p1', names).at(-1)).toEqual({ label: 'p1', href: '/r/idea/p1' })
    expect(pathOf('/r/person/github%3Aa%20b', { 'person:github:a b': 'Odd One' }).at(-1)!.label).toBe('Odd One')
  })

  it('a System’s record sits under Systems, a proposal’s record under Proposals (E-64)', () => {
    expect(pathOf('/r/system/treasury', { 'system:treasury': 'Treasury' })).toEqual([
      { label: 'Systems', href: '/systems' }, { label: 'Treasury', href: '/r/system/treasury' },
    ])
    expect(pathOf('/governance/proposals/p-1', { 'proposal:p-1': 'Fund the kit' }).at(-1)!.label).toBe('Fund the kit')
  })

  it('a library entry sits under Library, its id decoded when no name is given; the query is dropped', () => {
    expect(pathOf('/library/board%3Aonboarding?x=1', {})).toEqual([
      { label: 'Library', href: '/library' }, { label: 'board:onboarding', href: '/library/board%3Aonboarding' },
    ])
  })

  it('an Instance board or page is named as the Instance group names it', () => {
    expect(pathOf('/all/projects', {})).toEqual([{ label: 'All records', href: '/all' }, { label: 'projects', href: '/all/projects' }])
    expect(pathOf('/activity', {})).toEqual([{ label: 'Activity', href: '/activity' }])
  })

  it('a /parts group is named as the parts index names it', () => {
    expect(pathOf('/parts/frame', {})).toEqual([{ label: 'Parts', href: '/parts' }, { label: 'The frame', href: '/parts/frame' }])
  })

  it('anything else is its last part, named or decoded', () => {
    expect(pathOf('/b/organization', { organization: 'Organization' })).toEqual([{ label: 'Organization', href: '/b/organization' }])
    expect(pathOf('/wizards/claim-handle', {})).toEqual([{ label: 'claim-handle', href: '/wizards/claim-handle' }])
  })
})

// D-12: the one record whose name the path may print, so the caller reads that record's entry for the gate's marker.
describe('namedIn: the record the path names', () => {
  it('is a record page’s resource id, a proposal’s, else nothing', () => {
    expect(namedIn('/r/project/p%201?edit=1')).toBe('project:p 1')
    expect(namedIn('/governance/proposals/DR-2026-010/')).toBe('proposal:DR-2026-010')
    expect(namedIn('/b/projects')).toBeNull()
    expect(namedIn('/')).toBeNull()
  })
})
