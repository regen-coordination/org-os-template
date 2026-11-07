import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REGISTRIES, registryDef } from '../server/registries.ts'
import { REGISTRIES as TABLE } from '../lib/registries.mjs'
import { listRegistries, readRegistry } from '../server/registry.ts'
import { createApp } from '../server/app.ts'
import { classOf } from '../lib/change-classes.mjs'
import { makeFixtureRepo, removeFixtureRepo, PACKAGE_SCHEMAS, SYSTEMS_YAML } from './fixtures.ts'

describe('the registry list', () => {
  it('is one list: server/registries.ts gives lib/registries.mjs its types', () => expect(REGISTRIES).toBe(TABLE))
  it('holds boards, a collection under `boards:` (P4 §5.1)', () => {
    expect(registryDef('boards')).toEqual({ name: 'boards', topKey: 'boards', kind: 'collection' })
  })
  it('holds systems, a collection under `systems:` (F1 §3.4)', () => {
    expect(registryDef('systems')).toEqual({ name: 'systems', topKey: 'systems', kind: 'collection' })
  })
  it('holds proposals, a ledger collection under `proposals:` (P2 §3.1): only its own routes write it', () => {
    expect(registryDef('proposals')).toEqual({ name: 'proposals', topKey: 'proposals', kind: 'collection', ledger: true })
    expect(REGISTRIES.filter(r => r.ledger).map(r => r.name)).toEqual(['proposals'])
  })
  it('holds library, the receipts: a records collection under `installed:` after proposals, not a ledger (DAO-OS L1)', () => {
    expect(registryDef('library')).toEqual({ name: 'library', topKey: 'installed', kind: 'collection' })
    expect(registryDef('library').ledger).toBeUndefined()
    expect(REGISTRIES.map(r => r.name).slice(-3)).toEqual(['proposals', 'library', 'visibility'])
    expect(classOf({ registry: 'library' })).toBe('records')
  })
  it('gives every registry a schema of its own', () => {
    for (const def of REGISTRIES) expect(existsSync(join(PACKAGE_SCHEMAS, `${def.name}.schema.json`)), def.name).toBe(true)
  })
})

describe('data/systems.yaml through the admin', () => {
  let repo: string
  beforeEach(() => { repo = makeFixtureRepo() })
  afterEach(() => removeFixtureRepo(repo))

  it('is not listed while the file is absent', () => expect(listRegistries(repo).find(r => r.name === 'systems')).toBeUndefined())
  it('reads its entries once the file is there', async () => {
    writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS_YAML)
    expect(listRegistries(repo)).toContainEqual({ name: 'systems', kind: 'collection', count: 1 })
    expect(readRegistry(repo, 'systems').entries![0]).toMatchObject({ id: 'treasury-safe', kind: 'safe' })
    const res = await createApp(repo).request('/api/registries/systems')
    expect(res.status).toBe(200)
    expect((await res.json()).schemaVersion).toBe('1.0')
  })
})
