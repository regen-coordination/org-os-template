import { describe, it, expect } from 'vitest'
import { SECTIONS, routeOfRegistry, sectionById, sectionCount, sectionOf, sectionRows, type SystemEntries } from './sections.ts'
import { splitId, RESOURCE_KINDS } from './kinds.ts'
import { SECTION_IDS, RECORD_KINDS } from '../../lib/board-query.mjs'
import type { Resource } from './api.ts'

const res = (id: string, over: Partial<Resource> = {}): Resource =>
  ({ id, kind: splitId(id).kind, board: 'systems', name: id, status: null, attention: null, changed: null, facts: {}, source: null, ...over })
const sys = (id: string) => res(`system:${id}`, { source: { path: 'data/systems.yaml', editable: true, registry: 'systems', entityId: id } })
const systems: SystemEntries = new Map([
  ['safe', { id: 'safe', kind: 'safe', section: 'organization/treasury' }],
  ['kms', { id: 'kms', kind: 'kms-connector' }],
  ['docs', { id: 'docs', kind: 'docs', section: 'organization/docs' }],
])

describe('sections', () => {
  it('places systems by their systems.yaml entry', () => {
    expect(sectionOf(sys('safe'), systems)?.id).toBe('treasury')
    expect(sectionOf(sys('kms'), systems)?.id).toBe('sources')
    expect(sectionOf(sys('docs'), systems)?.id).toBe('systems')
  })

  it('falls back to the facts when the entry is not to hand', () => {
    expect(sectionOf(res('system:x', { facts: { section: 'organization/treasury' } }), new Map())?.id).toBe('treasury')
  })

  it('puts each resource kind in one section, and absences in none', () => {
    expect(sectionOf(res('seat:s'), systems)?.id).toBe('crew')
    expect(sectionOf(res('role:r'), systems)?.id).toBe('crew')
    expect(sectionOf(res('connector:c'), systems)?.id).toBe('sources')
    expect(sectionOf(res('absent:crew'), systems)).toBeUndefined()
  })

  it('counts a registry-only section from the registry summary', () => {
    expect(sectionCount(sectionById('meetings')!, [], [{ name: 'meetings', kind: 'collection', count: 4 }], systems)).toBe(4)
    expect(sectionCount(sectionById('treasury')!, [sys('safe'), sys('docs')], [], systems)).toBe(1)
  })

  it('sends an old /r/<registry> address to its section, or to All records', () => {
    expect(routeOfRegistry('members')).toBe('/b/people')
    expect(routeOfRegistry('funding-opportunities')).toBe('/b/funding')
    expect(routeOfRegistry('assets')).toBe('/all/assets')
  })

  it('gives every section a route of its own and an Empty line', () => {
    const routes = SECTIONS.map(s => s.route)
    expect(new Set(routes).size).toBe(routes.length)
    for (const s of SECTIONS) expect(s.empty.length).toBeGreaterThan(10)
  })

  // the design pass (2026-11-04): every section a person adds to explains itself; the Instance group's (filled by
  // scripts, with no New) keep their one line
  it('gives every section a person adds to its plate’s words, and each System section what connecting gives', () => {
    for (const s of SECTIONS) {
      if (s.newRegistry === undefined) { expect(s.words, s.id).toBeUndefined(); continue }
      const w = s.words!
      expect(w, s.id).toBeDefined()
      for (const t of [w.about, w.noun, w.nouns, w.lead, w.why, w.first]) expect(t.length, s.id).toBeGreaterThan(2)
      expect(w.example.length, s.id).toBeGreaterThan(0)
      expect(w.example.length, s.id).toBeLessThanOrEqual(3)
      expect(w.columns).toHaveLength(3)
      expect(JSON.stringify(w), s.id).not.toMatch(/house/i) // the Hub's words (Q66)
    }
    expect(SECTIONS.filter(s => s.words?.connect).map(s => s.id)).toEqual(['treasury', 'sources', 'systems'])
  })

  it('never lists a resource with no id, whatever the server sent (contract C-6)', () => {
    const noId = res('project:', { kind: 'project', board: 'organization', source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: '' } })
    const ok = res('project:p', { kind: 'project', board: 'organization', source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'p' } })
    expect(sectionRows(sectionById('projects')!, [noId, ok], systems)).toEqual([ok])
    expect(sectionOf(noId, systems)).toBeUndefined()
  })
})

describe("the board lib knows the client's sections and kinds", () => {
  it('SECTION_IDS is SECTIONS, in order', () => expect([...SECTION_IDS]).toEqual(SECTIONS.map(s => s.id)))
  it('RECORD_KINDS is RESOURCE_KINDS', () => expect([...RECORD_KINDS].sort()).toEqual([...RESOURCE_KINDS].sort()))
})
