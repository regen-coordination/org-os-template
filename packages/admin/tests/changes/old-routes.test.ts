// Scripts and the old forms call these routes. They keep their success contract; underneath, each is
// a one-op change applied at once under exactly Apply's checks, and its commit carries the platform's
// trailers. A tight system has no back door around the tray.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { makeFixtureRepo, removeFixtureRepo, PROJECTS_YAML } from '../fixtures.ts'
import { makeChangeRepo, git, CONSENSUS } from './fixtures.ts'
import { createApp } from '../../server/app.ts'
import { parseTrailers } from '../../lib/trailers.mjs'

let repo: string
let app: Hono
afterEach(() => removeFixtureRepo(repo))
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const EDIT = { id: 'proj-001', title: 'Renamed', status: 'develop', type: 'program', lead: 'ana' }
const trailers = () => parseTrailers(git(repo, 'log -1 --format=%B'))
const commits = () => Number(git(repo, 'rev-list --count HEAD').trim())
const projects = () => readFileSync(join(repo, 'data', 'projects.yaml'), 'utf8')

describe('the old write routes, as one-op changes', () => {
  it('a PUT commits under its old subject, with the trailers of a private change', async () => {
    repo = makeFixtureRepo(); app = createApp(repo)
    expect((await app.request('/api/registries/projects/proj-001', json('PUT', EDIT))).status).toBe(200)
    expect(git(repo, 'log -1 --format=%s').trim()).toBe('admin(projects): update proj-001')
    expect(trailers()).toMatchObject({ actor: 'steward-a', rule: 'solo/direct', change: expect.stringMatching(/^chg_/) })
  })

  it('a members write records the members class', async () => {
    repo = makeFixtureRepo(); app = createApp(repo)
    const ana = { id: 'ana', name: 'Ana Silva', role: 'Steward', layer: 'contributor', status: 'active', joined: '2025-02-01' }
    expect((await app.request('/api/registries/members/ana', json('PUT', ana))).status).toBe(200)
    expect(trailers()).toMatchObject({ rule: 'solo/direct' })
  })

  it("never touches the actor's tray", async () => {
    repo = makeFixtureRepo(); app = createApp(repo)
    await app.request('/api/changes/ops', json('POST', { ops: [{ op: 'update', record: 'members:ana', set: { role: 'Steward' } }] }))
    expect((await app.request('/api/registries/projects/proj-001', json('PUT', EDIT))).status).toBe(200)
    const view = await (await app.request('/api/changes')).json()
    expect(view.ops.map((o: { record: string }) => o.record)).toEqual(['members:ana'])
  })

  it('a POST to a registry with no file yet creates the file', async () => {
    repo = makeFixtureRepo(); app = createApp(repo)
    const res = await app.request('/api/registries/events', json('POST', { id: 'launch', title: 'Launch' }))
    expect(res.status).toBe(201)
    expect(readFileSync(join(repo, 'data', 'events.yaml'), 'utf8')).toBe('events:\n  - id: launch\n    title: Launch\n')
    expect(git(repo, 'status --porcelain')).toBe('')
  })
})

describe('the old write routes refuse what Apply refuses', () => {
  it('an actor git cannot match: 403 with the reason, on every write, nothing written', async () => {
    repo = makeFixtureRepo(); app = createApp(repo)
    git(repo, 'config user.email stranger@local')
    const sentence = 'Read-only: your git email `stranger@local` matches no member in `data/members.yaml`.'
    for (const res of [
      await app.request('/api/registries/projects/proj-001', json('PUT', EDIT)),
      await app.request('/api/registries/ideas', json('POST', { id: 'i1', title: 'T', status: 'surfaced' })),
      await app.request('/api/registries/projects/proj-001', { method: 'DELETE' }),
    ]) {
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ reason: sentence, error: sentence })
    }
    expect(projects()).toBe(PROJECTS_YAML)
    expect(commits()).toBe(1)
  })

  it('a rule that is not direct: 403 with the consensus sentence, nothing written', async () => {
    repo = makeChangeRepo(CONSENSUS); app = createApp(repo)
    const res = await app.request('/api/registries/projects/proj-001', json('PUT', EDIT))
    expect(res.status).toBe(403)
    expect((await res.json()).reason).toBe('Fixture Org decides changes by consensus, and data/governance.yaml writes no rule for it, so nothing can be proposed until a rule is written.')
    expect(projects()).toBe(PROJECTS_YAML)
    expect(commits()).toBe(2)
  })

  it('a dirty target file: 409 with the reviewed sentence, code DIRTY and its path', async () => {
    repo = makeFixtureRepo(); app = createApp(repo)
    writeFileSync(join(repo, 'data', 'projects.yaml'), `${PROJECTS_YAML}  - id: "WIP"\n`)
    const res = await app.request('/api/registries/projects/proj-001', json('PUT', EDIT))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: expect.stringMatching(/^Not saved: data\/projects\.yaml has changes that are not committed yet/), code: 'DIRTY', paths: ['data/projects.yaml'],
    })
  })
})

describe('the old POST without an id', () => {
  it('answers a plain sentence about the missing id, not record syntax', async () => {
    repo = makeFixtureRepo(); app = createApp(repo)
    const res = await app.request('/api/registries/ideas', json('POST', { title: 'No id' }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ errors: [{ field: 'id', message: 'a new entry needs an `id`' }] })
    expect(commits()).toBe(1)
  })
})
