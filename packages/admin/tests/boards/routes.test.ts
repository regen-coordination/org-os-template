import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo, BOARDS_YAML as FIXTURE_BOARDS } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'

// The fixture's board is id "treasury", which is also a built-in; the list test needs an instance-only one.
const BOARDS_YAML = FIXTURE_BOARDS.replace('id: "treasury"', 'id: "council"')

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))

describe('GET /api/boards', () => {
  it('lists every board', async () => {
    writeFileSync(join(repo, 'data', 'boards.yaml'), BOARDS_YAML)
    const res = await createApp(repo).request('/api/boards')
    expect(res.status).toBe(200)
    const ids = (await res.json()).map((b: { id: string }) => b.id)
    expect(ids[0]).toBe('home')
    expect(ids.at(-1)).toBe('council')
  })
  it('answers one board, or a 404 that says where the list is', async () => {
    const app = createApp(repo)
    expect((await (await app.request('/api/boards/home')).json()).name).toBe('{org}')
    const miss = await app.request('/api/boards/nope')
    expect(miss.status).toBe(404)
    expect(await miss.json()).toEqual({ error: 'No board "nope". GET /api/boards lists the boards.' })
  })
  it("answers a built-in board as it ships, even where the instance's board overrides it (final review M-3)", async () => {
    writeFileSync(join(repo, 'data', 'boards.yaml'), FIXTURE_BOARDS)
    const app = createApp(repo)
    expect((await (await app.request('/api/boards/treasury')).json()).name).toBe('Treasury & council')
    const res = await app.request('/api/boards/treasury/builtin')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'treasury', name: 'Treasury', origin: 'builtin', overrides: false })
    const miss = await app.request('/api/boards/council/builtin')
    expect(miss.status).toBe(404)
    expect(await miss.json()).toEqual({ error: 'No built-in board "council". GET /api/boards lists the boards.' })
  })
  it('answers an unreadable file with a 409 and no code', async () => {
    writeFileSync(join(repo, 'data', 'boards.yaml'), 'boards:\n  - id: a\n    name: [unclosed\n')
    const res = await createApp(repo).request('/api/boards')
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBeUndefined()
    expect(typeof body.error).toBe('string')
  })
})
