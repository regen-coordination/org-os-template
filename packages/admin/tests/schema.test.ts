import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { loadSchema, validateEntity } from '../server/schema.ts'

let repo: string
beforeAll(() => { repo = makeFixtureRepo() })
afterAll(() => removeFixtureRepo(repo))

describe('loadSchema', () => {
  it('loads a registry schema by name', () => {
    expect(loadSchema('projects').$id).toBe('orgos://registry/projects')
  })
  it('falls back to the generic schema for registries without one', () => {
    expect(loadSchema('__missing__').$id).toBe('orgos://registry/_generic')
  })
})

describe('validateEntity', () => {
  it('accepts a valid entity', () => {
    const r = validateEntity(repo, 'projects', { id: 'p2', title: 'X', status: 'idea', type: 'program', lead: 'ana' })
    expect(r.valid).toBe(true)
  })
  it('reports enum violations with a field path', () => {
    // members.status is a closed vocabulary. members.layer is not, since 0.6
    // (an instance uses words of its own), nor projects.status: real data
    // proved every instance defines its own words (see tests/real-data.test.ts).
    const r = validateEntity(repo, 'members', { id: 'm2', status: 'wizard' })
    expect(r.valid).toBe(false)
    expect(r.errors).toContainEqual(expect.objectContaining({ field: 'status' }))
  })
  it('accepts an instance-defined member layer', () => {
    expect(validateEntity(repo, 'members', { id: 'm3', layer: 'dao-global' }).valid).toBe(true)
  })
  it('a warning never refuses a save', () => {
    expect(validateEntity(repo, 'systems', { id: 's1', kind: 'notion-db', name: 'Notes', url: 'https://notion.example/x' }))
      .toEqual({ valid: true, errors: [] })
  })
  it('accepts an instance-defined project status', () => {
    const r = validateEntity(repo, 'projects', { id: 'p3', status: 'Discovery' })
    expect(r.valid).toBe(true)
  })
  it('reports a broken member reference', () => {
    const r = validateEntity(repo, 'projects', { id: 'p2', status: 'idea', lead: 'ghost' })
    expect(r.valid).toBe(false)
    expect(r.errors[0]!.message).toMatch(/no member with id "ghost"/i)
  })
  it('checks array references element-wise', () => {
    const r = validateEntity(repo, 'projects', { id: 'p2', status: 'idea', contributors: ['ana', 'ghost'] })
    expect(r.valid).toBe(false)
    expect(r.errors[0]!.field).toBe('contributors')
  })
  it('allows null references', () => {
    const r = validateEntity(repo, 'projects', { id: 'p2', status: 'idea', lead: null, funding_source: null })
    expect(r.valid).toBe(true)
  })
  it('skips referential checks when the target registry file is absent', () => {
    // fixture has no funding-opportunities.yaml
    const r = validateEntity(repo, 'projects', { id: 'p2', status: 'idea', funding_source: 'fund-001' })
    expect(r.valid).toBe(true)
  })
})

describe('the ids a write is checked against', () => {
  it('never hold "undefined" or "": an entry with no id is not an id', () => {
    const own = makeFixtureRepo()
    try {
      writeFileSync(join(own, 'data', 'members.yaml'), 'members:\n  - name: "No id"\n  - id: ""\n    name: "Empty id"\n  - id: "ana"\n')
      expect(validateEntity(own, 'projects', { id: 'p9', status: 'idea', lead: 'undefined' }).errors)
        .toContainEqual({ field: 'lead', message: 'no member with id "undefined" in members' })
      expect(validateEntity(own, 'projects', { id: 'p9', status: 'idea', lead: '' }).errors)
        .toContainEqual({ field: 'lead', message: 'no member with id "" in members' })
      expect(validateEntity(own, 'projects', { id: 'p9', status: 'idea', lead: 'ana' }).valid).toBe(true)
    } finally { removeFixtureRepo(own) }
  })
})
