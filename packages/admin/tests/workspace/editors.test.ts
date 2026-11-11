// DAO-OS L6 spec §11.1 (F-L3-3): every governed file has a path. The table is walked against the class table, the
// registry list and a file list shaped like the pilot's (tests/fixtures/pilot-tree.txt, placeholders only).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EDITORS, editorFor, editorRowFor } from '../../lib/workspace/editors.mjs'
import { governedClassOf } from '../../lib/change-classes.mjs'
import { REGISTRIES, registryFileOf } from '../../lib/registries.mjs'

const TABLE = JSON.parse(readFileSync(new URL('../../../../schemas/change-classes.json', import.meta.url), 'utf8')) as
  { map: { registry?: string; path?: string; class: string }[] }
const PILOT = readFileSync(fileURLToPath(new URL('../fixtures/pilot-tree.txt', import.meta.url)), 'utf8')
  .split('\n').map(l => l.trim()).filter(l => l !== '' && !l.startsWith('#'))

/** A path a class row stands for: a registry's file, or the row's path with `**` filled in. */
const sampleOf = (r: { registry?: string; path?: string }): string =>
  r.registry !== undefined ? (r.registry === '*' ? 'data/an-instance-file.yaml' : `data/${r.registry}.yaml`) : r.path!.replace(/\*\*$/, 'x/y.md')

describe('every governed file has an editor (F-L3-3)', () => {
  it('every governed path of the pilot-shaped tree and every row of schemas/change-classes.json and REGISTRIES has an editor', () => {
    const governed = PILOT.filter(p => governedClassOf(p) !== null)
    expect(governed.length).toBeGreaterThan(40)
    const paths = [...governed, ...TABLE.map.map(sampleOf), ...REGISTRIES.map(d => registryFileOf(d)), 'data/proposals.yaml', 'DECISIONS.md']
    const missing = paths.filter(p => editorFor(p) === null)
    expect(missing).toEqual([])
  })
  it("each row's class is the class the table gives its files", () => {
    for (const p of PILOT) {
      const row = editorRowFor(p)
      if (row === null) continue
      expect(row.class, p).toBe(governedClassOf(p))
    }
  })
  it('a file no rule governs has no editor', () => {
    for (const p of ['README.md', 'skills/meeting-processor/SKILL.md', 'knowledge/regen-finance.md', 'docs/adr/0001-house.md', 'scripts/sync.mjs']) {
      expect(governedClassOf(p), p).toBeNull()
      expect(editorFor(p), p).toBeNull()
    }
  })
  it('.well-known/dao.json is generated, data/proposals.yaml ledger, DECISIONS.md ratify, data/horizon.yaml source, data/governance.yaml rules+source', () => {
    expect(editorFor('.well-known/dao.json')).toBe('generated')
    expect(editorFor('data/proposals.yaml')).toBe('ledger')
    expect(editorFor('DECISIONS.md')).toBe('ratify')
    expect(editorFor('data/horizon.yaml')).toBe('source')
    expect(editorFor('data/governance.yaml')).toBe('rules+source')
  })
  it('the rest of the spec table, row by row', () => {
    expect(editorFor('data/members.yaml')).toBe('record')
    expect(editorFor('data/projects.yaml')).toBe('record')
    expect(editorFor('data/tasks.yaml')).toBe('record')
    expect(editorFor('data/collections/circles.yaml')).toBe('record')
    expect(editorFor('data/kb/claim.yaml')).toBe('knowledge') // PF-R1: the commons' entry page, as F-7's own-routes row
    expect(editorFor('data/systems.yaml')).toBe('record')
    expect(editorFor('data/boards.yaml')).toBe('board')
    expect(editorFor('data/library.yaml')).toBe('library')
    expect(editorFor('data/visibility.yaml')).toBe('visibility+source')
    expect(editorFor('data/collections.yaml')).toBe('collections+source')
    expect(editorFor('data/finances.yaml')).toBe('source')
    expect(editorFor('data/imports.yaml')).toBe('source')
    expect(editorFor('IDENTITY.md')).toBe('source')
    expect(editorFor('federation.yaml')).toBe('source')
    expect(editorFor('pages/handbook-3f2a.md')).toBe('page')
    expect(editorFor('pages/assets/handbook-3f2a/diagram.png')).toBe('page')
    expect(editorFor('memory/2026-10-30.md')).toBe('source')
    expect(editorFor('docs/agent-plans/agent-a-week.md')).toBe('source')
  })
  it('a path that climbs or is absolute matches no row', () => {
    for (const p of ['../data/members.yaml', 'data/../IDENTITY.md', '/etc/x', '', 'data/sub/x.yaml']) expect(editorFor(p), p).toBeNull()
    expect(editorFor('./IDENTITY.md')).toBe('source')
  })
  it('the table is frozen', () => {
    expect(Object.isFrozen(EDITORS)).toBe(true)
    expect(Object.isFrozen(EDITORS[0])).toBe(true)
  })
})
