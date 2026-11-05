import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'

let repo: string
afterEach(() => removeFixtureRepo(repo))
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('a board through the change engine', () => {
  it('refuses a bad board at stage time, under its record and field', async () => {
    repo = makeChangeRepo()
    const app = createApp(repo)
    const res = await app.request('/api/changes/ops', json('POST', { ops: [{ op: 'create', record: 'boards:x', value: {
      id: 'x', name: 'X', layout: 'grid', blocks: [{ id: 'a', type: 'note', text: '', place: { col: 1, span: 2, row: 1 } }] } }] }))
    expect(res.status).toBe(422)
    expect((await res.json()).errors).toEqual([{ record: 'boards:x', field: 'blocks', message: 'board "x": block "a": span 2 is under the minimum of 3' }])
  })

  it('creates data/boards.yaml on Apply, one commit under records/direct', async () => {
    repo = makeChangeRepo()
    const app = createApp(repo)
    const staged = await app.request('/api/changes/ops', json('POST', { ops: [{ op: 'create', record: 'boards:team', value: {
      id: 'team', name: 'Team', audience: 'members', layout: 'flow', blocks: [{ id: 'n', type: 'note', text: 'Hi' }] } }] }))
    expect(staged.status).toBe(200)
    expect((await staged.json()).classes).toEqual(['records'])
    const applied = await app.request('/api/changes/apply', json('POST', {}))
    expect(applied.status).toBe(200)
    expect(readFileSync(join(repo, 'data', 'boards.yaml'), 'utf8')).toMatch(/boards:\n\s*- id: team/)
  })
})
