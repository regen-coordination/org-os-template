import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { createApp } from '../server/app.ts'

let repo: string
let app: ReturnType<typeof createApp>
beforeEach(() => { repo = makeFixtureRepo(); app = createApp(repo) })
afterEach(() => removeFixtureRepo(repo))

const json = (method: string, body: unknown) => ({
  method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
})
const lastCommit = () => execSync('git log -1 --pretty=%s', { cwd: repo }).toString().trim()

describe('GET /api/status', () => {
  it('returns org identity and git state', async () => {
    const res = await app.request('/api/status')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ org: 'Fixture Org', branch: 'main', dirty: false })
  })
})

describe('GET /api/registries', () => {
  it('lists registries', async () => {
    const list = await (await app.request('/api/registries')).json()
    expect(list).toContainEqual({ name: 'projects', kind: 'collection', count: 1 })
  })
})

describe('GET /api/registries/:name', () => {
  it('returns entries', async () => {
    const reg = await (await app.request('/api/registries/projects')).json()
    expect(reg.entries[0].id).toBe('proj-001')
  })
  it('404s unknown registries', async () => {
    expect((await app.request('/api/registries/nope')).status).toBe(404)
  })
})

describe('GET /api/schemas/:name', () => {
  it('serves the JSON schema', async () => {
    const schema = await (await app.request('/api/schemas/projects')).json()
    expect(schema.$id).toBe('orgos://registry/projects')
  })
})

describe('PUT /api/registries/:name/:id', () => {
  it('validates, writes, and commits', async () => {
    const res = await app.request('/api/registries/projects/proj-001',
      json('PUT', { id: 'proj-001', title: 'Renamed', status: 'develop', type: 'program', lead: 'ana' }))
    expect(res.status).toBe(200)
    expect(lastCommit()).toBe('admin(projects): update proj-001')
  })
  it('422s with field errors and does not commit', async () => {
    const before = lastCommit()
    const res = await app.request('/api/registries/projects/proj-001',
      json('PUT', { id: 'proj-001', status: 'launched' }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.errors[0].field).toBe('status')
    expect(lastCommit()).toBe(before)
  })
  it('403s writes to document registries', async () => {
    expect((await app.request('/api/registries/finances/x', json('PUT', { id: 'x' }))).status).toBe(403)
  })
  it('422s and does not commit when body id differs from URL id', async () => {
    const before = lastCommit()
    const res = await app.request('/api/registries/members/luiz',
      json('PUT', { id: 'luiz-renamed', name: 'Luiz', role: 'Core Steward', layer: 'core', status: 'active', joined: '2023-01-15' }))
    expect(res.status).toBe(422)
    expect((await res.json()).errors[0].field).toBe('id')
    expect(lastCommit()).toBe(before)
  })
  it('serializes concurrent writes to the same entity without losing an edit', async () => {
    const base = { id: 'proj-001', title: 'X', type: 'program', lead: 'luiz', contributors: ['ana'], tags: ['nodes'] }
    await Promise.all([
      app.request('/api/registries/projects/proj-001', json('PUT', { ...base, status: 'develop' })),
      app.request('/api/registries/projects/proj-001', json('PUT', { ...base, status: 'archive' })),
    ])
    // Both edits must be committed as two distinct commits, not one lost-update.
    const count = execSync('git rev-list --count HEAD', { cwd: repo }).toString().trim()
    expect(Number(count)).toBe(3) // fixture-initial + 2 writes
  })
})

describe('POST /api/registries/:name', () => {
  it('creates and commits', async () => {
    const res = await app.request('/api/registries/ideas',
      json('POST', { id: 'idea-001', title: 'Toolkit', status: 'surfaced' }))
    expect(res.status).toBe(201)
    expect(lastCommit()).toBe('admin(ideas): create idea-001')
  })
  it('409s duplicate ids', async () => {
    expect((await app.request('/api/registries/projects', json('POST', { id: 'proj-001' }))).status).toBe(409)
  })
})

describe('DELETE /api/registries/:name/:id', () => {
  it('deletes and commits', async () => {
    const res = await app.request('/api/registries/members/ana', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(lastCommit()).toBe('admin(members): delete ana')
  })
  it('404s a missing entity', async () => {
    expect((await app.request('/api/registries/members/ghost', { method: 'DELETE' })).status).toBe(404)
  })
})
