import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { ResourceStore } from '../../server/resources/index.ts'
import { mountResources } from '../../server/resources/routes.ts'
import { runCommand } from '../../server/resources/run.ts'

let repo: string
let app: ReturnType<typeof createApp>
beforeEach(() => {
  repo = makeFixtureRepo()
  const store = new ResourceStore({ repo, now: () => new Date(), run: runCommand, lastOk: () => null })
  app = createApp(repo, a => mountResources(a, store, repo))
})
afterEach(() => removeFixtureRepo(repo))

describe('graph routes', () => {
  it('GET /api/graph/organization draws the records', async () => {
    const res = await app.request('/api/graph/organization')
    expect(res.status).toBe(200)
    const view = await res.json()
    expect(view.board).toBe('organization')
    expect(view.nodes.map((n: { id: string }) => n.id)).toEqual(expect.arrayContaining(['project:proj-001', 'person:steward-a', 'person:ana']))
    expect(view.edges).toContainEqual({ from: 'project:proj-001', to: 'person:steward-a', kind: 'lead' })
  })

  it("GET /api/graph/systems shows each missing source as a card saying why, and this instance's own card", async () => {
    const view = await (await app.request('/api/graph/systems')).json()
    expect(view.nodes.map((n: { id: string }) => n.id).sort()).toEqual(['absent:crew', 'absent:modules', 'absent:sources', 'instance:fixture-org'])
  })

  it('an unknown board is a 404 in words; an unknown board filter a 400', async () => {
    const res = await app.request('/api/graph/elsewhere')
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/the boards are organization and systems/)
    expect((await app.request('/api/resources?board=elsewhere')).status).toBe(400)
  })

  it('GET /api/resources filters by board and kind', async () => {
    const people = await (await app.request('/api/resources?board=organization&kind=person')).json()
    expect(people.map((n: { id: string }) => n.id).sort()).toEqual(['person:ana', 'person:steward-a'])
  })

  it('GET /api/resources/:id answers the resource, its edges and its neighbours', async () => {
    const res = await app.request(`/api/resources/${encodeURIComponent('person:ana')}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.resource.id).toBe('person:ana')
    expect(body.edges).toEqual([{ from: 'project:proj-001', to: 'person:ana', kind: 'member' }])
    expect(body.neighbours.map((n: { id: string }) => n.id)).toEqual(['project:proj-001'])
    expect((await app.request('/api/resources/person%3Anobody')).status).toBe(404)
  })

  it('round-trips ids that need encoding: colons, spaces, slashes (Review Focus 1)', async () => {
    writeFileSync(join(repo, 'data', 'members.yaml'), 'members:\n  - id: "github:a b/c"\n    name: Odd Id\n')
    writeFileSync(join(repo, 'data', 'projects.yaml'), 'projects: []\n')
    const res = await app.request(`/api/resources/${encodeURIComponent('person:github:a b/c')}`)
    expect(res.status).toBe(200)
    expect((await res.json()).resource.name).toBe('Odd Id')
  })

  it('still answers an unknown /api/ address with a 404', async () => {
    expect((await app.request('/api/nothing-here')).status).toBe(404)
  })
})

describe('layout routes', () => {
  const put = (body: unknown) => ({ method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  it('stores dragged positions per board, refuses bad ones, and resets', async () => {
    expect(await (await app.request('/api/layout/systems')).json()).toEqual({})
    expect((await app.request('/api/layout/systems', put({ 'module:a': { x: 1, y: 2 } }))).status).toBe(200)
    expect(await (await app.request('/api/layout/systems')).json()).toEqual({ 'module:a': { x: 1, y: 2 } })
    const bad = await app.request('/api/layout/systems', put({ 'module:a': { x: 'left' } }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toMatch(/"module:a"/)
    expect((await app.request('/api/layout/systems', { method: 'DELETE' })).status).toBe(200)
    expect(await (await app.request('/api/layout/systems')).json()).toEqual({})
    expect((await app.request('/api/layout/elsewhere')).status).toBe(404)
  })
})
