import { describe, it, expect } from 'vitest'
import { HOUSE_SECTIONS, INSTANCE_LINKS, countText, houseCounts, sectionOf } from './sections.ts'
import { FIXTURE_SOURCE, canSee, type Viewer } from '../viewAs/visibility.ts'

const eyes = (viewer: Viewer) => <T,>(items: T[]) => items.filter(i => canSee(viewer, FIXTURE_SOURCE.visibilityOf(i), FIXTURE_SOURCE))

describe('the house sections (§5.2)', () => {
  it('are the nine, in the house spec’s order, with their routes and g-keys', () => {
    expect(HOUSE_SECTIONS.map(s => [s.id, s.label, s.href, s.key])).toEqual([
      ['home', 'Home', '/', 'h'], ['needs', 'Needs you', '/needs', 'n'], ['proposals', 'Proposals', '/governance/proposals', 'p'],
      ['systems', 'Systems', '/systems', 's'], ['roles', 'Roles', '/roles', 'r'], ['treasury', 'Treasury', '/b/treasury', 't'],
      ['workspace', 'Workspace', '/workspace', 'w'], ['library', 'Library', '/library', 'l'], ['changes', 'Changes', '/changes', 'c'],
    ])
  })

  it('the Instance group holds 0.6’s org-os boards (C-8)', () => {
    expect(INSTANCE_LINKS.map(l => l.label)).toEqual(['Crew', 'Fleet', 'Modules', 'Sources', 'Activity', 'All records', 'Boards'])
  })

  it('knows which section a path is in: Home’s board, the Proposals tabs, a Workspace collection', () => {
    expect(sectionOf('/')).toBe('home')
    expect(sectionOf('/b/home')).toBe('home')
    expect(sectionOf('/governance/decisions')).toBe('proposals')
    expect(sectionOf('/governance/proposals/DR-2026-010')).toBe('proposals')
    expect(sectionOf('/b/projects', [{ id: 'projects', label: 'Projects', href: '/b/projects' }])).toBe('workspace')
    expect(sectionOf('/b/treasury?select=x')).toBe('treasury')
    expect(sectionOf('/library/board%3Aonboarding')).toBe('library')
    expect(sectionOf('/activity')).toBeNull()
  })

  it('places a record page in the section of its kind (E-64): a System in Systems, a proposal in Proposals, a collection’s record in Workspace', () => {
    expect(sectionOf('/r/system/treasury')).toBe('systems')
    expect(sectionOf('/r/proposal/p-2026-10-17-001')).toBe('proposals')
    expect(sectionOf('/r/project/proj-001?edit=1')).toBe('workspace')
    expect(sectionOf('/r/person/steward-a')).toBe('workspace')
    expect(sectionOf('/r/meetings/m-1')).toBe('workspace')
    expect(sectionOf('/r/module/org-os-demo')).toBeNull() // the Instance group's, no section of the Hub
    expect(sectionOf('/r/project%3Ax')).toBeNull()
  })
})

describe('countText', () => {
  it('draws nothing for zero, the number up to 99, and 99+ past it', () => {
    expect(countText(0)).toBeNull()
    expect(countText(1)).toBe('1')
    expect(countText(99)).toBe('99')
    expect(countText(100)).toBe('99+')
    expect(countText(120)).toBe('99+')
  })
})

describe('houseCounts: counts are of what the viewer may see (rule 7)', () => {
  const lists = {
    resources: [
      { kind: 'system', attention: { level: 'warn' } }, { kind: 'system', attention: { level: 'alert' } },
      { kind: 'project', attention: { level: 'warn' } }, { kind: 'system', facts: { visibility: 'public' } },
    ],
    open: [{ needsYou: false }, { needsYou: false, facts: { visibility: 'public' } }],
    // Needs you's items (E-34): what the sidebar counts is what /needs lists
    needs: [{ kind: 'signature', facts: {} }, { kind: 'failed-read', facts: {} }, { kind: 'proposal', facts: {} }],
    staged: 1,
  }

  it('you count everything', () => {
    expect(houseCounts(lists, eyes({ as: 'you' }), true)).toEqual({ needs: 3, proposals: 2, systems: 3, changes: 1 })
  })

  it('previewing as Public, only what anyone may read is counted, and no staged change', () => {
    expect(houseCounts(lists, eyes({ as: 'public' }), false)).toEqual({ needs: 0, proposals: 1, systems: 1, changes: 0 })
  })
})
