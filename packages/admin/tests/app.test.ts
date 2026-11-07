import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
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
  it('answers an empty registry, not a 404, for a known one whose file is not in this instance (LOW 2)', async () => {
    expect(existsSync(join(repo, 'data', 'systems.yaml'))).toBe(false)
    const res = await app.request('/api/registries/systems')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'systems', kind: 'collection', schemaVersion: null, entries: [] })
    rmSync(join(repo, 'data', 'governance.yaml'), { force: true })
    expect(await (await app.request('/api/registries/governance')).json()).toEqual({ name: 'governance', kind: 'document', schemaVersion: null, document: {} })
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
      // `lead` must reference a real member — a constraint that survives
      // (projects.status no longer has an enum; see tests/real-data.test.ts).
      json('PUT', { id: 'proj-001', status: 'Discovery', lead: 'ghost' }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.errors[0].field).toBe('lead')
    expect(lastCommit()).toBe(before)
  })
  it('403s writes to document registries', async () => {
    expect((await app.request('/api/registries/finances/x', json('PUT', { id: 'x' }))).status).toBe(403)
  })
  it('422s and does not commit when body id differs from URL id', async () => {
    const before = lastCommit()
    const res = await app.request('/api/registries/members/steward-a',
      json('PUT', { id: 'steward-a-renamed', name: 'Steward A', role: 'Core Steward', layer: 'core', status: 'active', joined: '2023-01-15' }))
    expect(res.status).toBe(422)
    expect((await res.json()).errors[0].field).toBe('id')
    expect(lastCommit()).toBe(before)
  })
  it('serializes concurrent writes to the same entity without losing an edit', async () => {
    const base = { id: 'proj-001', title: 'X', type: 'program', lead: 'steward-a', contributors: ['ana'], tags: ['nodes'] }
    await Promise.all([
      app.request('/api/registries/projects/proj-001', json('PUT', { ...base, status: 'develop' })),
      app.request('/api/registries/projects/proj-001', json('PUT', { ...base, status: 'archive' })),
    ])
    // Both edits must be committed as two distinct commits, not one lost-update.
    const count = execSync('git rev-list --count HEAD', { cwd: repo }).toString().trim()
    expect(Number(count)).toBe(3) // fixture-initial + 2 writes
  })
})

// "Never partial writes": a save ends in a commit, or in a refusal with the
// file exactly as it was. Before this guard the lock was per registry, so
// saves to different registries ran git side by side, collided on
// .git/index.lock, answered 500 and left the file changed with no commit.
describe('every save ends in a commit or leaves nothing behind', () => {
  const commits = () => Number(execSync('git rev-list --count HEAD', { cwd: repo }).toString().trim())
  const dirty = () => execSync('git status --porcelain', { cwd: repo }).toString().trim()

  it('simultaneous saves to different registries are each committed', async () => {
    const member = { id: 'steward-a', name: 'Steward A', layer: 'core', status: 'active', joined: '2023-01-15', handles: { git: ['admin-test@local'] } }
    const project = { id: 'proj-001', title: 'X', type: 'program', lead: 'steward-a' }
    const requests = [0, 1, 2, 3].flatMap(n => [
      app.request('/api/registries/members/steward-a', json('PUT', { ...member, role: `role ${n}` })),
      app.request('/api/registries/projects/proj-001', json('PUT', { ...project, status: `s${n}` })),
      app.request('/api/registries/ideas', json('POST', { id: `idea-${n}`, title: 'T', status: 'surfaced' })),
    ])
    const statuses = (await Promise.all(requests)).map(r => r.status)
    expect(statuses.filter(s => s >= 300)).toEqual([])
    expect(dirty()).toBe('')
    expect(commits()).toBe(1 + 12)
  })

  it('a save git cannot commit is refused in words and the file is put back', async () => {
    const path = join(repo, 'data', 'projects.yaml')
    const before = readFileSync(path, 'utf8')
    // What another git process holding the repository looks like.
    writeFileSync(join(repo, '.git', 'index.lock'), '')
    const res = await app.request('/api/registries/projects/proj-001',
      json('PUT', { id: 'proj-001', title: 'Renamed', status: 'develop', type: 'program', lead: 'ana' }))
    rmSync(join(repo, '.git', 'index.lock'))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/not saved.*nothing was changed.*try again/is)
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(dirty()).toBe('')
    expect(commits()).toBe(1)
  })

  it('a save the repository\'s commit hook refuses is put back, in the file and in the index', async () => {
    const path = join(repo, 'data', 'projects.yaml')
    const before = readFileSync(path, 'utf8')
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "hook says no" >&2\nexit 1\n', { mode: 0o755 })
    // A project nothing refers to: a member a project names cannot be deleted (write-safety.test.ts).
    const res = await app.request('/api/registries/projects/proj-001', { method: 'DELETE' })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/not saved.*hook says no/is)
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(dirty()).toBe('')
    expect(commits()).toBe(1)
  })

  it('a save whose commit landed stays saved when HEAD cannot be read afterwards', async () => {
    const path = join(repo, 'data', 'projects.yaml')
    // A post-commit hook points HEAD at a ref that does not exist: the commit is made, reading HEAD then fails.
    writeFileSync(join(repo, '.git', 'hooks', 'post-commit'), '#!/bin/sh\ngit symbolic-ref HEAD refs/heads/nowhere\n', { mode: 0o755 })
    const res = await app.request('/api/registries/projects/proj-001', { method: 'DELETE' })
    expect(res.status).toBe(200)
    execSync('git symbolic-ref HEAD refs/heads/main', { cwd: repo })
    expect(lastCommit()).toBe('admin(projects): delete proj-001')
    expect(readFileSync(path, 'utf8')).not.toContain('proj-001')
    expect(dirty()).toBe('')
    expect(commits()).toBe(2)
  })

  it('a save that changes nothing answers 200 and makes no commit', async () => {
    const project = (await (await app.request('/api/registries/projects')).json()).entries[0]
    const res = await app.request('/api/registries/projects/proj-001', json('PUT', project))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(project)
    expect(commits()).toBe(1)
  })
})

// A body the server cannot read is the caller's mistake (400), not the
// server's (500), and the answer says what a body must be.
describe('a write whose body is not a JSON object answers 400 in words', () => {
  const raw = (method: string, body: string) => ({ method, body, headers: { 'content-type': 'application/json' } })
  for (const [label, body] of [
    ['malformed JSON', '{bad'], ['an empty body', ''], ['a list', '[1, 2]'], ['a string', '"x"'], ['null', 'null'],
  ] as const) {
    it(`PUT with ${label}`, async () => {
      const before = lastCommit()
      const res = await app.request('/api/registries/projects/proj-001', raw('PUT', body))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/body must be a JSON object/i)
      expect(lastCommit()).toBe(before)
    })
  }
  it('POST with malformed JSON', async () => {
    const res = await app.request('/api/registries/ideas', raw('POST', '{"id": "x",'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/body must be a JSON object/i)
  })
  it('POST without an id says so, and is not a server error', async () => {
    const res = await app.request('/api/registries/ideas', raw('POST', '{"title": "No id"}'))
    expect(res.status).toBe(422)
    expect((await res.json()).errors).toContainEqual(expect.objectContaining({ field: 'id' }))
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
    const res = await app.request('/api/registries/projects/proj-001', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(lastCommit()).toBe('admin(projects): delete proj-001')
  })
  it('404s a missing entity', async () => {
    expect((await app.request('/api/registries/members/ghost', { method: 'DELETE' })).status).toBe(404)
  })
})
