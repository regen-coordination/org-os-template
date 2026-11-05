import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { readRegistry, updateEntity, createEntity, deleteEntity } from '../server/registry.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))

const read = (name: string) => readFileSync(join(repo, 'data', `${name}.yaml`), 'utf8')

describe('updateEntity', () => {
  it('changes only the edited field and preserves comments', () => {
    updateEntity(repo, 'projects', 'proj-001', {
      id: 'proj-001', title: 'Node Onboarding Program', status: 'archive',
      type: 'program', lead: 'steward-a', contributors: ['ana'], tags: ['nodes', 'onboarding'],
    })
    const text = read('projects')
    expect(text).toContain('# IDEA lifecycle: idea -> develop -> execute -> archive')
    expect(text).toContain('status: "archive"')
    expect(readRegistry(repo, 'projects').entries![0]!.status).toBe('archive')
  })
  it('preserves inline comments on untouched entries', () => {
    updateEntity(repo, 'members', 'steward-a', {
      id: 'steward-a', name: 'Steward A', role: 'Core Steward',
      layer: 'core', status: 'inactive', joined: '2023-01-15',
    })
    expect(read('members')).toContain('# prefers async comms')
  })
  it('drops keys removed from the entity', () => {
    updateEntity(repo, 'projects', 'proj-001', { id: 'proj-001', title: 'Trimmed', status: 'idea', type: 'program' })
    const entry = readRegistry(repo, 'projects').entries![0]!
    expect(entry).not.toHaveProperty('lead')
  })
  it('throws for a missing id', () => {
    expect(() => updateEntity(repo, 'projects', 'ghost', { id: 'ghost' })).toThrowError(/not found/i)
  })
  it('does not reformat untouched flow-style arrays (minimal diff)', () => {
    updateEntity(repo, 'projects', 'proj-001', {
      id: 'proj-001', title: 'Node Onboarding Program', status: 'archive',
      type: 'program', lead: 'steward-a', contributors: ['ana'], tags: ['nodes', 'onboarding'],
    })
    const text = read('projects')
    expect(text).toContain('contributors: ["ana"]')       // not `[ "ana" ]`
    expect(text).toContain('tags: ["nodes", "onboarding"]')
  })
})

// A file written by hand, in a style the YAML library would not choose: the
// list is not indented under its key, comments are aligned, one line is long.
const HAND_STYLE = `schema_version: "2.0"
members:
# --- core ---
- id: "steward-a"
  name:   "Steward A"     # aligned comment
  bio: "A long line that the library would fold at eighty columns if it were allowed to re-wrap text that nobody asked it to touch."
  status: "active"

# on leave until March
- id: "ana"
  name: "Ana Silva"
  status: "active"
- {id: "flo", name: "Flow Style", status: "active"}
`

describe('a hand-styled file keeps every line the edit did not touch', () => {
  const path = () => join(repo, 'data', 'members.yaml')
  beforeEach(() => writeFileSync(path(), HAND_STYLE))
  const lines = () => read('members').split('\n')
  const hand = HAND_STYLE.split('\n')

  it('update: one changed field is one changed line, and its comment stays', () => {
    updateEntity(repo, 'members', 'steward-a', { id: 'steward-a', name: 'St. A', bio: readRegistry(repo, 'members').entries![0]!.bio, status: 'active' })
    const after = lines()
    expect(after.filter((l, i) => l !== hand[i])).toEqual(['  name: "St. A" # aligned comment'])
    expect(after).toHaveLength(hand.length)
  })
  it('update: a removed field takes only its own line', () => {
    updateEntity(repo, 'members', 'ana', { id: 'ana', name: 'Ana Silva' })
    expect(read('members')).toBe(HAND_STYLE.replace('  name: "Ana Silva"\n  status: "active"\n', '  name: "Ana Silva"\n'))
  })
  it('update: a list value is written at the entity\'s own indentation', () => {
    updateEntity(repo, 'members', 'ana', { id: 'ana', name: 'Ana Silva', status: 'active', tags: ['a', 'b'] })
    expect(read('members')).toBe(HAND_STYLE.replace(
      '  name: "Ana Silva"\n  status: "active"\n', '  name: "Ana Silva"\n  status: "active"\n  tags:\n    - a\n    - b\n'))
    expect(readRegistry(repo, 'members').entries![1]!.tags).toEqual(['a', 'b'])
  })
  it('update: a flow-style entity is still saved correctly', () => {
    updateEntity(repo, 'members', 'flo', { id: 'flo', name: 'Flo', status: 'active' })
    expect(readRegistry(repo, 'members').entries).toEqual([
      expect.objectContaining({ id: 'steward-a', name: 'Steward A' }),
      { id: 'ana', name: 'Ana Silva', status: 'active' },
      { id: 'flo', name: 'Flo', status: 'active' },
    ])
  })
  it('delete: takes the entity and the comment above it, nothing else', () => {
    deleteEntity(repo, 'members', 'ana')
    expect(read('members')).toBe(HAND_STYLE.replace(
      '\n# on leave until March\n- id: "ana"\n  name: "Ana Silva"\n  status: "active"\n', '\n'))
  })
  it('create: appends after the last entry at the list\'s indentation', () => {
    writeFileSync(path(), HAND_STYLE.replace('- {id: "flo", name: "Flow Style", status: "active"}\n', ''))
    createEntity(repo, 'members', { id: 'new', name: 'New' })
    expect(read('members')).toBe(HAND_STYLE.replace('- {id: "flo", name: "Flow Style", status: "active"}\n', '- id: new\n  name: New\n'))
  })
})

describe('createEntity', () => {
  it('appends to an empty flow-style collection as block style', () => {
    createEntity(repo, 'ideas', { id: 'idea-001', title: 'Toolkit', status: 'surfaced' })
    const entries = readRegistry(repo, 'ideas').entries!
    expect(entries).toHaveLength(1)
    expect(read('ideas')).toContain('- id: idea-001')
  })
  it('rejects duplicate ids', () => {
    expect(() => createEntity(repo, 'projects', { id: 'proj-001' })).toThrowError(/already exists/i)
  })
  it('rejects entities without an id', () => {
    expect(() => createEntity(repo, 'projects', { title: 'No id' })).toThrowError(/id/i)
  })
})

describe('deleteEntity', () => {
  it('removes the entry and keeps file comments', () => {
    deleteEntity(repo, 'members', 'ana')
    expect(readRegistry(repo, 'members').entries).toHaveLength(1)
    expect(read('members')).toContain('# Members Registry')
  })
})
