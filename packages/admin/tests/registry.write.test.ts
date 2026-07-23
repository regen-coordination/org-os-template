import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
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
      type: 'program', lead: 'luiz', contributors: ['ana'], tags: ['nodes', 'onboarding'],
    })
    const text = read('projects')
    expect(text).toContain('# IDEA lifecycle: idea -> develop -> execute -> archive')
    expect(text).toContain('status: "archive"')
    expect(readRegistry(repo, 'projects').entries![0]!.status).toBe('archive')
  })
  it('preserves inline comments on untouched entries', () => {
    updateEntity(repo, 'members', 'luiz', {
      id: 'luiz', name: 'Luiz Fernando', role: 'Core Steward',
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
      type: 'program', lead: 'luiz', contributors: ['ana'], tags: ['nodes', 'onboarding'],
    })
    const text = read('projects')
    expect(text).toContain('contributors: ["ana"]')       // not `[ "ana" ]`
    expect(text).toContain('tags: ["nodes", "onboarding"]')
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
