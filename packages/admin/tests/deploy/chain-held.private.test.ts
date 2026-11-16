// L7 gap B1 beside the private store (after gap A, PF-R226): a field the chain holds of a deployed System is judged the
// same whether git or the private store keeps it. A write that the split would stage in the store (a field the policy
// keeps above members, a System kept private whole) is refused at POST /api/changes/ops when it changes what the chain
// holds, with the same sentence, before anything is staged; a notes edit of the same System stages as before. Every test
// builds a throwaway repository and private store; no network.
import { describe, it, expect, afterEach } from 'vitest'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { git, makeSyntheticRepo } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import type { PrivateStore } from '../../server/private/store.ts'
import { CHAIN_HELD_SENTENCE } from '../../lib/chain-held.mjs'
import { grantOps, hideInStore, json, restrictInStore } from './fixtures/hub.ts'
import { CHAIN_HELD_HIDDEN } from '../../server/deploy/private-flip.ts'
import { readFileSync } from 'node:fs'

const SEPOLIA = 'eip155:11155111'
const HAT = (n: number) => `${SEPOLIA}:0x0000002a000${n}${'0'.repeat(52)}`
const A = (n: number) => `0x${'0'.repeat(38)}a${n}`
const TREE = {
  id: 'side-roles', kind: 'hats-tree', name: 'Side roles', chain: SEPOLIA, address: '42', driver: 'hats-tree',
  deployment: { status: 'deployed', read_back: '2026-11-05' },
  hats: [{ key: 'council', hat: HAT(1), role: 'decides', wearers: [`${SEPOLIA}:${A(1)}`] }],
}
const SAFE = {
  id: 'side-safe', kind: 'safe', name: 'Side Safe', chain: SEPOLIA, address: '0x1111111111111111111111111111111111111111', driver: 'safe',
  deployment: { status: 'deployed', read_back: '2026-11-05' },
}

let repo: string | undefined
let kept: { store: PrivateStore; done: () => void } | undefined
afterEach(() => { kept?.done(); kept = undefined; if (repo) removeFixtureRepo(repo); repo = undefined })

async function setUp(keep: (r: string) => Promise<{ store: PrivateStore; done: () => void }>): Promise<Hono> {
  repo = makeSyntheticRepo()
  writeSystems(repo)
  grantOps(repo)
  kept = await keep(repo)
  const store = kept.store
  return createApp(repo, undefined, { privateStore: () => store })
}
function writeSystems(r: string): void {
  writeFileSync(join(r, 'data', 'systems.yaml'), stringify({ schema_version: '1.0', systems: [TREE, SAFE] }))
  git(r, 'add data/systems.yaml')
  git(r, 'commit -qm "fixture: a deployed tree and Safe"')
}
async function stageOps(app: Hono, ops: unknown[]): Promise<{ status: number; body: Record<string, any> }> {
  const res = await app.request('/api/changes/ops', json('POST', { ops }))
  return { status: res.status, body: await res.json() }
}
const held = (record: string, field: string) => ({ record, field, message: CHAIN_HELD_SENTENCE(field) })
async function nothingStaged(app: Hono) {
  const ch = await (await app.request('/api/changes')).json()
  expect(ch.ops).toEqual([])
  expect(ch.private ?? []).toEqual([])
  expect(kept!.store.staged(ch.id ?? 'none')).toEqual([])
}

describe('a chain-held field kept in the store is refused as one in git (B1, after gap A)', () => {
  it('a deployed tree\'s hats kept at role:ops: a wearer added by hand is refused 422, nothing staged; its notes stage', async () => {
    const app = await setUp(r => restrictInStore(r, ['hats']))
    const hats = [{ ...TREE.hats[0], wearers: [`${SEPOLIA}:${A(1)}`, `${SEPOLIA}:${A(2)}`] }]
    const refused = await stageOps(app, [{ op: 'update', record: 'systems:side-roles', set: { hats } }])
    expect(refused.status, JSON.stringify(refused.body)).toBe(422)
    expect(refused.body.errors).toEqual([held('systems:side-roles', 'hats')])
    await nothingStaged(app)
    const notes = await stageOps(app, [{ op: 'update', record: 'systems:side-roles', set: { notes: 'The side council.' } }])
    expect(notes.status, JSON.stringify(notes.body)).toBe(200)
    expect(notes.body.ops.map((o: { record: string }) => o.record)).toEqual(['systems:side-roles'])
  })

  it('a deployed Safe kept private whole: its address is refused 422, nothing staged; its notes stage in the store', async () => {
    const app = await setUp(r => hideInStore(r, ['side-safe']))
    const refused = await stageOps(app, [{ op: 'update', record: 'systems:side-safe', set: { address: '0x2222222222222222222222222222222222222222' } }])
    expect(refused.status, JSON.stringify(refused.body)).toBe(422)
    expect(refused.body.errors).toEqual([held('systems:side-safe', 'address')])
    await nothingStaged(app)
    const notes = await stageOps(app, [{ op: 'update', record: 'systems:side-safe', set: { notes: 'Kept for the side work.' } }])
    expect(notes.status, JSON.stringify(notes.body)).toBe(200)
    expect((notes.body.private as { op: Record<string, any> }[]).map(p => p.op)).toEqual([
      expect.objectContaining({ op: 'update-record', collection: 'systems', id: 'side-safe', set: { notes: 'Kept for the side work.' } }),
    ])
  })
})

describe('a System the store holds as deployed, written in git (review I-1, M-3)', () => {
  it('probe P4: `deployment` kept at role:ops; a hand edit of the Safe\'s address and driver, all of it for git, is 422, nothing staged', async () => {
    const app = await setUp(r => restrictInStore(r, ['deployment']))
    const refused = await stageOps(app, [{ op: 'update', record: 'systems:side-safe', set: { address: '0x2222222222222222222222222222222222222222', driver: 'link' } }])
    expect(refused.status, JSON.stringify(refused.body)).toBe(422)
    expect(refused.body.errors).toEqual([held('systems:side-safe', 'driver'), held('systems:side-safe', 'address')])
    await nothingStaged(app)
    const notes = await stageOps(app, [{ op: 'update', record: 'systems:side-safe', set: { notes: 'Kept for the side work.' } }])
    expect(notes.status, JSON.stringify(notes.body)).toBe(200)
  })

  it('Apply judges the whole again: a git edit staged while the System was not deployed is 422 once the store holds it deployed, nothing written', async () => {
    repo = makeSyntheticRepo()
    const { deployment: _d, ...handSafe } = SAFE
    writeFileSync(join(repo, 'data', 'systems.yaml'), stringify({ schema_version: '1.0', systems: [TREE, handSafe] }))
    git(repo, 'add data/systems.yaml')
    git(repo, 'commit -qm "fixture: a tree and a Safe registered by hand"')
    grantOps(repo)
    kept = await restrictInStore(repo, ['deployment'])
    const store = kept.store
    const app = createApp(repo, undefined, { privateStore: () => store })
    const staged = await stageOps(app, [{ op: 'update', record: 'systems:side-safe', set: { address: '0x2222222222222222222222222222222222222222' } }])
    expect(staged.status, JSON.stringify(staged.body)).toBe(200)
    // Another change, applied since, read the Safe back: the store now holds its deployment.
    await store.putField({ registry: 'systems', record: 'side-safe', field: 'deployment', visibility: 'role:ops', value: { status: 'deployed', read_back: '2026-11-07' } }, 'test', null)
    const head = git(repo, 'rev-parse HEAD')
    const res = await app.request('/api/changes/apply', json('POST', {}))
    expect(res.status, await res.clone().text()).toBe(422)
    expect((await res.json()).errors).toEqual([held('systems:side-safe', 'address')])
    expect(git(repo, 'rev-parse HEAD')).toBe(head)
    expect(readFileSync(join(repo, 'data', 'systems.yaml'), 'utf8')).toContain('0x1111111111111111111111111111111111111111')
  })

  it('M-3 in the store: a System kept private whole that the change made deployed: a later hand edit of its address is 422', async () => {
    repo = makeSyntheticRepo()
    const { deployment: _d, ...handSafe } = SAFE
    writeFileSync(join(repo, 'data', 'systems.yaml'), stringify({ schema_version: '1.0', systems: [TREE, handSafe] }))
    git(repo, 'add data/systems.yaml')
    git(repo, 'commit -qm "fixture: a tree and a Safe registered by hand"')
    grantOps(repo)
    kept = await hideInStore(repo, ['side-safe'])
    const store = kept.store
    const app = createApp(repo, undefined, { privateStore: () => store })
    const flip = await stageOps(app, [{ op: 'update', record: 'systems:side-safe', set: { deployment: { status: 'deployed', read_back: '2026-11-07' } } }])
    expect(flip.status, JSON.stringify(flip.body)).toBe(200)
    const refused = await stageOps(app, [{ op: 'update', record: 'systems:side-safe', set: { address: '0x2222222222222222222222222222222222222222' } }])
    expect(refused.status, JSON.stringify(refused.body)).toBe(422)
    expect(refused.body.errors).toEqual([held('systems:side-safe', 'address')])
  })
})

// Walk fix wave 2 (Rule 4, found in wave 1): the chain-held refusal names its record and field, and so says the System is
// deployed. A stager not admitted to the System's deployment status (kept in the store above them) is told one sentence
// that names no record, field or deployed state (CHAIN_HELD_HIDDEN), at stage and at Apply; an admitted one is told the
// field, as before (the tests above).
describe('the chain-held refusal to a stager not admitted to the deployment (walk fix wave 2, Rule 4)', () => {
  const namesNothing = (body: unknown) => {
    const text = JSON.stringify(body)
    for (const word of ['side-safe', 'side-roles', 'address', 'driver', 'deploy', 'chain holds']) expect(text).not.toContain(word)
  }

  it('`deployment` kept at role:ops, the stager not ops: a hand edit of the address is refused in one sentence naming nothing; nothing staged', async () => {
    repo = makeSyntheticRepo()
    writeSystems(repo)
    kept = await restrictInStore(repo, ['deployment'])
    const store = kept.store
    const app = createApp(repo, undefined, { privateStore: () => store })
    const refused = await stageOps(app, [{ op: 'update', record: 'systems:side-safe', set: { address: '0x2222222222222222222222222222222222222222', driver: 'link' } }])
    expect(refused.status, JSON.stringify(refused.body)).toBe(422)
    expect(refused.body.errors).toEqual([{ record: '', field: '', message: CHAIN_HELD_HIDDEN }])
    namesNothing(refused.body)
    await nothingStaged(app)
    // A field that is not the chain's stages as before.
    expect((await stageOps(app, [{ op: 'update', record: 'systems:side-safe', set: { notes: 'Kept for the side work.' } }])).status).toBe(200)
  })

  it('a deployed Safe kept private whole at role:ops, the stager not ops: an edit of its address names nothing of it', async () => {
    repo = makeSyntheticRepo()
    writeSystems(repo)
    kept = await hideInStore(repo, ['side-safe'])
    const store = kept.store
    const app = createApp(repo, undefined, { privateStore: () => store })
    const refused = await stageOps(app, [{ op: 'update', record: 'systems:side-safe', set: { address: '0x2222222222222222222222222222222222222222' } }])
    expect(refused.status).toBeGreaterThanOrEqual(400)
    for (const word of ['address', 'deploy', 'chain holds']) expect(JSON.stringify(refused.body)).not.toContain(word)
    await nothingStaged(app)
  })

  it('at Apply: the store came to hold the System deployed since it was staged; the stager not ops is told the same sentence, nothing written', async () => {
    repo = makeSyntheticRepo()
    const { deployment: _d, ...handSafe } = SAFE
    writeFileSync(join(repo, 'data', 'systems.yaml'), stringify({ schema_version: '1.0', systems: [TREE, handSafe] }))
    git(repo, 'add data/systems.yaml')
    git(repo, 'commit -qm "fixture: a tree and a Safe registered by hand"')
    kept = await restrictInStore(repo, ['deployment'])
    const store = kept.store
    const app = createApp(repo, undefined, { privateStore: () => store })
    expect((await stageOps(app, [{ op: 'update', record: 'systems:side-safe', set: { address: '0x2222222222222222222222222222222222222222' } }])).status).toBe(200)
    await store.putField({ registry: 'systems', record: 'side-safe', field: 'deployment', visibility: 'role:ops', value: { status: 'deployed', read_back: '2026-11-07' } }, 'test', null)
    const head = git(repo, 'rev-parse HEAD')
    const res = await app.request('/api/changes/apply', json('POST', {}))
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(422)
    expect(body.errors).toEqual([{ record: '', field: '', message: CHAIN_HELD_HIDDEN }])
    namesNothing(body)
    expect(git(repo, 'rev-parse HEAD')).toBe(head)
  })
})
