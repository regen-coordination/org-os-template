import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { listRegistries, readRegistry } from '../server/registry.ts'

let repo: string
beforeAll(() => { repo = makeFixtureRepo() })
afterAll(() => removeFixtureRepo(repo))

describe('listRegistries', () => {
  it('lists present registries with kind and count', () => {
    const list = listRegistries(repo)
    const members = list.find(r => r.name === 'members')
    expect(members).toEqual({ name: 'members', kind: 'collection', count: 2 })
    const finances = list.find(r => r.name === 'finances')
    expect(finances).toEqual({ name: 'finances', kind: 'document', count: null })
    expect(list.find(r => r.name === 'events')).toBeUndefined() // file absent
  })
})

describe('readRegistry', () => {
  it('reads a collection registry as entries', () => {
    const reg = readRegistry(repo, 'projects')
    expect(reg.kind).toBe('collection')
    expect(reg.entries).toHaveLength(1)
    expect(reg.entries![0]).toMatchObject({ id: 'proj-001', lead: 'luiz' })
  })
  it('reads a document registry as an object', () => {
    const reg = readRegistry(repo, 'finances')
    expect(reg.kind).toBe('document')
    expect((reg.document as any).treasury.chain).toBe('optimism')
  })
  it('throws NotFound for unknown registry names', () => {
    expect(() => readRegistry(repo, 'nope')).toThrowError(/unknown registry/i)
  })
})
