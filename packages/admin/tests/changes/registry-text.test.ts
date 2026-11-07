// The change engine applies ops in memory before it writes anything. These are the reviewed
// write path's edits as text in, text out: the same splice, the same exact-write check.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo, MEMBERS_YAML, PROJECTS_YAML } from '../fixtures.ts'
import {
  updatedText, createdText, deletedText, entriesFromText, parseForWrite,
  updateEntity, createEntity, deleteEntity,
} from '../../server/registry.ts'
import { validateEntity, referrers } from '../../server/schema.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))
const read = (name: string) => readFileSync(join(repo, 'data', `${name}.yaml`), 'utf8')
const PROJECT = { id: 'proj-001', title: 'Renamed', status: 'execute', type: 'program', lead: 'steward-a', contributors: ['ana'], tags: ['nodes', 'onboarding'] }

describe('the write path as text: the same edits, nothing written', () => {
  it('updatedText returns what updateEntity writes, and leaves the file alone', () => {
    const text = updatedText(PROJECTS_YAML, 'projects', 'proj-001', PROJECT)
    expect(text).toBe(PROJECTS_YAML.replace('title: "Node Onboarding Program"', 'title: "Renamed"'))
    expect(read('projects')).toBe(PROJECTS_YAML)
    updateEntity(repo, 'projects', 'proj-001', PROJECT)
    expect(read('projects')).toBe(text)
  })

  it('updatedText returns the text itself when nothing differs', () => {
    const same = { ...PROJECT, title: 'Node Onboarding Program' }
    expect(updatedText(PROJECTS_YAML, 'projects', 'proj-001', same)).toBe(PROJECTS_YAML)
  })

  it('createdText appends one entry after the last and keeps the comments', () => {
    expect(createdText(MEMBERS_YAML, 'members', { id: 'carla', name: 'Carla' }))
      .toBe(`${MEMBERS_YAML}  - id: carla\n    name: Carla\n`)
    expect(() => createdText(MEMBERS_YAML, 'members', { id: 'ana' })).toThrow('entity already exists: ana')
  })

  it('createdText from a registry with no file yet starts at its canonical top key', () => {
    expect(createdText('funding_opportunities: []\n', 'funding-opportunities', { id: 'f1', title: 'F' }))
      .toBe('funding_opportunities:\n  - id: f1\n    title: F\n')
  })

  it('deletedText removes the entry; a missing one says so', () => {
    expect(deletedText(MEMBERS_YAML, 'members', 'ana')).toBe(MEMBERS_YAML.slice(0, MEMBERS_YAML.indexOf('  - id: "ana"')))
    expect(() => deletedText(MEMBERS_YAML, 'members', 'ghost')).toThrow('entity not found: ghost')
  })

  it('parseForWrite refuses a dangling alias in the reviewed words', () => {
    expect(() => parseForWrite('projects:\n  - id: a\n    name: *nope\n', 'projects', 'deleted'))
      .toThrow(/Not deleted: data\/projects\.yaml cannot be read, so this app will not rewrite it: at line 3, column 11, \*nope/)
  })

  it('entriesFromText reads entries as GET does', () => {
    expect(entriesFromText(PROJECTS_YAML, 'projects')).toEqual([
      { id: 'proj-001', title: 'Node Onboarding Program', status: 'execute', type: 'program', lead: 'steward-a', contributors: ['ana'], tags: ['nodes', 'onboarding'] },
    ])
    expect(entriesFromText('funding_opportunities: []\n', 'funding-opportunities')).toEqual([])
  })

  it('the file writes still write', () => {
    createEntity(repo, 'members', { id: 'carla', name: 'Carla' })
    expect(read('members')).toBe(`${MEMBERS_YAML}  - id: carla\n    name: Carla\n`)
    deleteEntity(repo, 'members', 'carla')
    expect(read('members')).toBe(MEMBERS_YAML)
  })

  it('a numeric id is addressable: the text twins find it by its string', () => {
    const src = 'projects:\n  - id: 42\n    title: A\n'
    expect(updatedText(src, 'projects', '42', { id: 42, title: 'B' })).toBe('projects:\n  - id: 42\n    title: B\n')
    expect(deletedText(src, 'projects', '42')).toBe('projects: []\n')
    expect(() => createdText(src, 'projects', { id: '42', title: 'C' })).toThrow('entity already exists: 42')
  })
})

describe('references read through an overlay', () => {
  it('a reference to an entry the overlay holds passes', () => {
    const project = { ...PROJECT, lead: 'carla' }
    expect(validateEntity(repo, 'projects', project).errors.map(e => e.field)).toEqual(['lead'])
    const overlay = (r: string) => (r === 'members' ? [{ id: 'steward-a' }, { id: 'ana' }, { id: 'carla' }] : undefined)
    expect(validateEntity(repo, 'projects', project, overlay).valid).toBe(true)
  })

  it('referrers read through the overlay', () => {
    expect(referrers(repo, 'members', 'ana').map(r => r.field)).toEqual(['contributors'])
    const overlay = (r: string) => (r === 'projects' ? [{ ...PROJECT, contributors: [] }] : undefined)
    expect(referrers(repo, 'members', 'ana', overlay)).toEqual([])
  })

  it('a referrer with no id is named by its position, never "undefined"', () => {
    const overlay = (r: string) => (r === 'projects' ? [{ id: 'p1', contributors: [] }, { title: 'x', contributors: ['ana'] }] : undefined)
    expect(referrers(repo, 'members', 'ana', overlay)).toEqual([{ registry: 'projects', id: '#2', field: 'contributors' }])
    writeFileSync(join(repo, 'data', 'projects.yaml'), 'projects:\n  - title: x\n    contributors: [ana]\n')
    expect(referrers(repo, 'members', 'ana')).toEqual([{ registry: 'projects', id: '#1', field: 'contributors' }])
  })

  it('a numeric id in the overlay satisfies a reference to its string', () => {
    const overlay = (r: string) => (r === 'members' ? [{ id: 7 }] : undefined)
    expect(validateEntity(repo, 'projects', { ...PROJECT, lead: '7', contributors: [] }, overlay).valid).toBe(true)
  })
})
