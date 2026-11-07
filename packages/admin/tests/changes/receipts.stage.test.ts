import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeSyntheticRepo, git } from './fixtures.ts'
import { createApp } from '../../server/app.ts'
import { readRegistry } from '../../server/registry.ts'

// Review Focus 2, half an add: the tray never holds a receipt without the records it names.
// Every test builds a throwaway repository under the temp directory (makeSyntheticRepo).
let repo: string
let app: Hono
beforeEach(() => { repo = makeSyntheticRepo(); app = createApp(repo) })
afterEach(() => removeFixtureRepo(repo))

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const stageOps = (ops: unknown[]) => app.request('/api/changes/ops', json('POST', { ops }))
const view = async () => (await app.request('/api/changes')).json()

const NAMES = 'library:board-onboarding names boards:onboarding, which this change does not create. Take the add out as a whole: remove its receipt op too, or discard the change.'
const BOARD = { op: 'create', record: 'boards:onboarding', value: { name: 'Onboarding', layout: 'flow', blocks: [] } }
const RECEIPT = {
  op: 'create', record: 'library:board-onboarding',
  value: {
    entry: 'board:onboarding', version: '1.0.0', shelf: 'framework',
    created: [{ record: 'boards:onboarding', base: null }],
    status: 'installed', by: null, at: null, decision: null, removed: null,
  },
}

describe('a receipt in the tray', () => {
  it('is refused alone: it names a record the change does not create', async () => {
    const res = await stageOps([RECEIPT])
    expect(res.status).toBe(422)
    expect((await res.json()).errors).toEqual([{ record: 'library:board-onboarding', field: '', message: NAMES }])
    expect((await view()).ops).toEqual([])
  })

  it('stages with the records it names', async () => {
    const res = await stageOps([BOARD, RECEIPT])
    expect(res.status).toBe(200)
    expect((await res.json()).ops.map((o: { record: string }) => o.record)).toEqual(['boards:onboarding', 'library:board-onboarding'])
  })

  it('keeps its record: taking the board out alone is refused, and the change still holds both', async () => {
    expect((await stageOps([BOARD, RECEIPT])).status).toBe(200)
    const res = await app.request('/api/changes/ops/0', { method: 'DELETE' })
    expect(res.status).toBe(422)
    expect((await res.json()).errors).toEqual([{ record: 'library:board-onboarding', field: '', message: NAMES }])
    expect((await view()).ops.map((o: { record: string }) => o.record)).toEqual(['boards:onboarding', 'library:board-onboarding'])
  })

  it('can be taken out by itself, and the board stays', async () => {
    expect((await stageOps([BOARD, RECEIPT])).status).toBe(200)
    const res = await app.request('/api/changes/ops/1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect((await res.json()).ops.map((o: { record: string }) => o.record)).toEqual(['boards:onboarding'])
  })
})

describe('a removal at Apply', () => {
  it('reads a record already gone from a file the change does not write (the apply backstop)', async () => {
    // A sealed receipt whose board was deleted by hand: the removal stages only the receipt update.
    writeFileSync(join(repo, 'data', 'library.yaml'), `schema_version: "1.0"
installed:
  - id: board-onboarding
    entry: board:onboarding
    version: 1.0.0
    shelf: framework
    created:
      - { record: boards:onboarding, base: ${'a'.repeat(64)} }
    status: installed
    by: bruno
    at: 2026-10-29
    decision: { rule: records/direct, change: chg_x }
    removed: null
`)
    git(repo, 'add data/library.yaml')
    git(repo, 'commit -qm "fixture: a receipt"')
    const removal = { op: 'update', record: 'library:board-onboarding', set: { status: 'removed', removed: { by: 'bruno', at: '2026-10-29', decision: { rule: 'records/direct', change: 'chg_y' } } } }
    expect((await stageOps([removal])).status).toBe(200)
    const res = await app.request('/api/changes/apply', json('POST', {}))
    expect(res.status).toBe(200)
    expect(readRegistry(repo, 'library').entries![0]).toMatchObject({ id: 'board-onboarding', status: 'removed' })
  })
})
