// The wizard definitions and their drafts over HTTP (wizards spec §5.3): the draft lives outside any
// repository, discarding deletes only that file, and nothing is written to the instance.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountWizards } from '../../server/wizards/routes.ts'
import { stateDir } from '../../server/state.ts'

let repo: string
let home: string
let app: ReturnType<typeof createApp>
beforeEach(() => {
  repo = makeFixtureRepo()
  home = mkdtempSync(join(tmpdir(), 'wizard-state-'))
  process.env.ORG_OS_ADMIN_HOME = home
  app = createApp(repo, a => mountWizards(a, { repo }))
})
afterEach(() => { removeFixtureRepo(repo); rmSync(home, { recursive: true, force: true }) })

const send = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })

describe('GET /api/wizards', () => {
  it('lists the wizards, and gives one whole', async () => {
    const list = await (await send('GET', '/api/wizards')).json()
    expect(list.map((w: { id: string }) => w.id)).toContain('claim-handle')
    expect(list.find((w: { id: string }) => w.id === 'claim-handle')).toEqual({ id: 'claim-handle', title: 'Claim your handle', summary: expect.any(String) })
    const one = await (await send('GET', '/api/wizards/claim-handle')).json()
    expect(one.steps[0]).toMatchObject({ id: 'who', writes: expect.stringMatching(/Nothing yet/) })
    expect(one.review.writes).toMatch(/data\/members\.yaml/)
  })

  it('answers an unknown wizard with a sentence', async () => {
    const res = await send('GET', '/api/wizards/nope')
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/No wizard "nope"/)
  })
})

describe('the draft', () => {
  const draft = { index: 0, answers: { who: 'ana' } }

  it('is saved outside the repository, read back, and discarded: only that file', async () => {
    const none = await send('GET', '/api/wizards/claim-handle/draft')
    expect(none.status).toBe(200) // no draft is an empty answer, not a red 404 in the console (LOW 2)
    expect(await none.json()).toBeNull()
    const saved = await (await send('PUT', '/api/wizards/claim-handle/draft', draft)).json()
    expect(saved).toMatchObject({ index: 0, answers: { who: 'ana' }, saved: expect.any(String) })
    const file = join(stateDir(repo), 'wizards', 'claim-handle-1.json')
    expect(existsSync(file)).toBe(true)
    expect(file.startsWith(repo)).toBe(false)
    expect(await (await send('GET', '/api/wizards/claim-handle/draft')).json()).toEqual(saved)
    expect((await send('DELETE', '/api/wizards/claim-handle/draft')).status).toBe(200)
    expect(readdirSync(join(stateDir(repo), 'wizards'))).toEqual([])
    expect(await (await send('GET', '/api/wizards/claim-handle/draft')).json()).toBeNull()
    expect((await send('DELETE', '/api/wizards/claim-handle/draft')).status).toBe(200) // idempotent
  })

  it('leaves the instance exactly as it was', async () => {
    await send('PUT', '/api/wizards/claim-handle/draft', draft)
    expect(execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('')
  })

  it('refuses a draft that is not an index and answers, and one that is too large', async () => {
    for (const bad of [null, [], { index: -1, answers: {} }, { index: 1.5, answers: {} }, { index: 0 }, { index: 0, answers: [] }, { index: 0, answers: 'x' }]) {
      const res = await send('PUT', '/api/wizards/claim-handle/draft', bad)
      expect(res.status, JSON.stringify(bad)).toBe(400)
      expect((await res.json()).error).toMatch(/draft is/)
    }
    const big = await send('PUT', '/api/wizards/claim-handle/draft', { index: 0, answers: { x: 'y'.repeat(20_000) } })
    expect(big.status).toBe(413)
  })

  it('cannot be aimed at another file: the id must be a wizard that exists', async () => {
    for (const id of ['..%2F..%2Fevil', 'nope', '%2e%2e']) {
      const res = await send('PUT', `/api/wizards/${id}/draft`, draft)
      expect(res.status, id).toBe(404)
    }
    expect(existsSync(join(stateDir(repo), 'wizards'))).toBe(false)
  })
})
