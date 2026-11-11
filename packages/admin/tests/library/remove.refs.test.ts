import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeSyntheticRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'

// L1-E8's case, now pinned: a System another record names (a board block) is listed on its removal preview.
const SHELF = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'test-shelf')
let repo: string
let app: Hono
afterEach(() => removeFixtureRepo(repo))
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
async function ok(res: Response): Promise<Record<string, any>> {
  const body = await res.json()
  expect(res.status, JSON.stringify(body)).toBe(200)
  return body
}

describe('a created System a board block names', () => {
  it('the removal preview lists the board', async () => {
    repo = makeSyntheticRepo()
    writeFileSync(join(repo, 'federation.yaml'), `identity:\n  name: Test org\n  slug: test-org\nlibrary:\n  shelves:\n    - { path: ${SHELF} }\n`)
    git(repo, 'add federation.yaml')
    git(repo, 'commit -qm "fixture: the test shelf"')
    app = createApp(repo)
    await ok(await app.request('/api/library/system%3Atest-link/add', json('POST', { config: { id: 'test-link', name: 'Test link', url: 'https://dao.example.org' } })))
    await ok(await app.request('/api/changes/apply', json('POST', {})))
    await ok(await app.request('/api/changes/ops', json('POST', { ops: [{ op: 'create', record: 'boards:test-desk', value: { id: 'test-desk', name: 'Desk', layout: 'flow', blocks: [{ id: 'link', type: 'system', source: { system: 'test-link' } }] } }] })))
    await ok(await app.request('/api/changes/apply', json('POST', {})))
    const p = await (await app.request('/api/library/receipts/system-test-link/removal')).json()
    expect(p.records).toEqual([{ record: 'systems:test-link', state: 'as added', referrers: ['boards:test-desk'] }])
  })
})

describe('a created System governance.yaml names', () => {
  it('the removal preview lists the rule that names it', async () => {
    repo = makeSyntheticRepo()
    writeFileSync(join(repo, 'federation.yaml'), `identity:\n  name: Test org\n  slug: test-org\nlibrary:\n  shelves:\n    - { path: ${SHELF} }\n`)
    git(repo, 'add federation.yaml')
    git(repo, 'commit -qm "fixture: the test shelf"')
    app = createApp(repo)
    await ok(await app.request('/api/library/system%3Atest-link/add', json('POST', { config: { id: 'test-link', name: 'Test link', url: 'https://dao.example.org' } })))
    await ok(await app.request('/api/changes/apply', json('POST', {})))
    writeFileSync(join(repo, 'data', 'governance.yaml'), 'governance:\n  model: consent\n  rules:\n    - id: treasury\n      decide: { by: system, system: test-link }\n')
    git(repo, 'add data/governance.yaml')
    git(repo, 'commit -qm "fixture: a rule decided by the System"')
    const p = await (await app.request('/api/library/receipts/system-test-link/removal')).json()
    expect(p.records[0].referrers).toEqual(['governance.yaml:rules[0].decide.system'])
  })
})
