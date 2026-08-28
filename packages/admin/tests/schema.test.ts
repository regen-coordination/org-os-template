import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
    const r = validateEntity(repo, 'projects', { id: 'p2', status: 'launched' })
    expect(r.valid).toBe(false)
    expect(r.errors).toContainEqual(expect.objectContaining({ field: 'status' }))
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
