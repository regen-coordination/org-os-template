import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))

describe('/api/library', () => {
  it('lists the framework shelf', async () => {
    const res = await createApp(repo).request('/api/library')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sources).toEqual(['framework'])
    expect(body.entries.map((e: { id: string }) => e.id)).toContain('board:treasury-council')
    expect(JSON.stringify(body)).not.toContain('"installs"') // the list carries a summary, not the values
  })
  it('answers one entry, and its preview', async () => {
    const app = createApp(repo)
    const one = await (await app.request('/api/library/board%3Aonboarding')).json()
    expect(one).toMatchObject({ id: 'board:onboarding', shelf: 'board' })
    const p = await app.request('/api/library/board%3Aonboarding/preview')
    expect(p.status).toBe(200)
    expect((await p.json()).adds[0].record).toBe('boards:onboarding')
  })
  it('answers an unknown entry with a 404 that says where the list is', async () => {
    const res = await createApp(repo).request('/api/library/board%3Anope/preview')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No library entry "board:nope". GET /api/library lists the entries.' })
  })
  it('adds by POST …/add alone: every other write verb is the API catch-all 404', async () => {
    const app = createApp(repo)
    const send = (method: string, path: string, body: string | undefined = '{}') =>
      app.request(path, { method, headers: { 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : body })
    // The add route answers: a body that is not an object is its 400, not the catch-all.
    const added = await send('POST', '/api/library/board%3Aonboarding/add', '[]')
    expect(added.status).toBe(400)
    expect((await added.json()).error).toMatch(/^The body must be/)
    const writes = [['POST', '/api/library'], ['POST', '/api/library/board%3Aonboarding'], ['PUT', '/api/library/board%3Aonboarding'],
      ['DELETE', '/api/library/board%3Aonboarding'], ['POST', '/api/library/board%3Aonboarding/preview'],
      ['PUT', '/api/library/board%3Aonboarding/add'], ['DELETE', '/api/library/board%3Aonboarding/add']] as const
    for (const [method, path] of writes) {
      const res = await send(method, path)
      expect(res.status, `${method} ${path}`).toBe(404)
      expect((await res.json()).error, `${method} ${path}`).toMatch(/^No such API address/)
    }
  })
})
