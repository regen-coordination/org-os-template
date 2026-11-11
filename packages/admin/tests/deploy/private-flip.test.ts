// L7 gap A, the private flip (PF-R191 and PF-R221 closed by PF-R226): POST /api/deploy/read-back runs its flip through
// the split every other write uses (`splitOps`, as /api/changes/ops does), so a System kept in the private store, or a
// field of one the policy restricts or the store holds, reads back. Its part above members is staged in the store,
// never in git (Rule 4); the flip stays one change of the actor's, applied under the org's rules with one Apply; the
// membership tree and the lockout are judged on the whole (git and the store). What the split cannot carry is refused
// before anything is staged: a value kept above members the flip would copy into git, a field the store holds with no
// level in the policy, a field the actor may not write. Every test builds a throwaway repository and private store; the
// chain is the recorded node of fixtures/readings.ts (no network).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { git } from '../changes/fixtures.ts'
import { readRegistry } from '../../server/registry.ts'
import { validateRepo } from '../../lib/data-validate.mjs'
import { hatRef } from '../../lib/hats.mjs'
import { RESTRICTED_SUBJECT } from '../../server/private/ops.ts'
import type { PrivateStore, PrivateTransaction } from '../../server/private/store.ts'
import { COUNCIL, GATE, LAST_TOP, SAFE, SEPOLIA, STAGES } from './fixtures/readings.ts'
import {
  FAST, KEPT_PRIVATE, KEPT_PRIVATE_FIELD, NOT_ADMITTED_FLIP, NOTHING_COMPOSED, SAFE_ID, TREE_ID, commitSystems, composedRepo, deployApp, grantOps,
  hideFieldsInStore, hideInStore, json, restrictInStore,
} from './fixtures/hub.ts'

let repo: string | undefined
let kept: { store: PrivateStore; done: () => void } | undefined
afterEach(() => { kept?.done(); kept = undefined; if (repo) removeFixtureRepo(repo); repo = undefined })

const TREE = String(LAST_TOP + 1)
const NAME_THE_TREE = (n: number) => `Name the membership tree in data/governance.yaml first: this change would make ${n} deployed hats trees, and the Hub would no longer know which one holds the org's roles.`

async function call(app: Hono, path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const res = await app.request(path, method === 'GET' ? undefined : json(method, body ?? {}))
  return { status: res.status, body: await res.json() }
}
const readBackNow = (app: Hono) => call(app, '/api/deploy/read-back', 'POST', {})
const change = async (app: Hono) => (await call(app, '/api/changes')).body
const applyNow = (app: Hono) => call(app, '/api/changes/apply', 'POST')
const systemsOf = (r: string) => (readRegistry(r, 'systems').entries ?? []) as Record<string, any>[]
const errorsOf = (r: string) => validateRepo(r).filter((p: { level: string }) => p.level === 'error')
/** Everything git holds, every commit's message and diff. */
const history = (r: string) => git(r, 'log -p --format=%B')
/** The keys each git op of the actor's change sets on a System. */
const gitKeys = (ch: Record<string, any>) => Object.fromEntries((ch.ops as { record: string; set?: object; value?: object }[]).map(o => [o.record, Object.keys(o.set ?? o.value ?? {})]))
/** The private part of the actor's change, as their tray shows it. */
const privateOps = (ch: Record<string, any>) => ((ch.private ?? []) as { op: Record<string, any> }[]).map(p => p.op)
/** What is said whenever nothing may be staged: the change empty, and nothing in the store's staged table. */
async function nothingStaged(app: Hono, store?: PrivateStore) {
  const ch = await change(app)
  expect(ch.ops).toEqual([])
  expect(ch.private ?? []).toEqual([])
  if (store) expect(store.staged(ch.id ?? 'none')).toEqual([])
}

/** The test council's Safe without the rule its on_deploy names it in: its governance edit names no System. */
function onDeployRolesOnly(r: string): void {
  const path = join(r, 'data', 'systems.yaml')
  const doc = parse(readFileSync(path, 'utf8'))
  delete doc.systems.find((x: { id: string }) => x.id === SAFE_ID).deployment.on_deploy.rules
  writeFileSync(path, stringify(doc))
  git(r, 'add data/systems.yaml')
  git(r, 'commit -qm "fixture: an on_deploy with roles only"')
}

describe('the flip through the split: a restricted field (the final review\'s probe)', () => {
  // PF-R226: the split takes the addresses out of git, as /api/changes/ops would; what that leaves in git is a deployed
  // System without the address its schema requires, and a tree git can no longer place for the membership. The change
  // engine refuses it, so nothing is staged and no address reaches git or an error (carried: a restricted required field).
  it('systems.address at role:ops, read back by an actor admitted to it: the split keeps the addresses out of git and the change engine refuses what is left; nothing staged', async () => {
    repo = await composedRepo()
    grantOps(repo)
    kept = await restrictInStore(repo, ['address'])
    const head = git(repo, 'rev-parse HEAD').trim()
    const { app: hub } = deployApp(repo, STAGES.all.readings, FAST, { store: kept.store })
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(422)
    expect(body.errors).toEqual(expect.arrayContaining([
      { record: `systems:${SAFE_ID}`, field: 'address', message: "must have required property 'address'" },
      { record: `systems:${TREE_ID}`, field: 'address', message: "must have required property 'address'" },
    ]))
    expect(JSON.stringify(body.errors).toLowerCase()).not.toContain(SAFE.toLowerCase().slice(2))
    // the admitted actor is told what was found, the addresses included
    expect(body.readBack.systems.find((x: { id: string }) => x.id === SAFE_ID).found.address).toBe(`${SEPOLIA}:${SAFE}`)
    await nothingStaged(hub, kept.store)
    expect(git(repo, 'rev-parse HEAD').trim()).toBe(head)
    expect(history(repo).toLowerCase()).not.toContain(SAFE.toLowerCase().slice(2))
  })

  it('an actor who reads the whole composition but may not write the restricted address is refused in words naming no field; nothing staged', async () => {
    repo = await composedRepo()
    kept = await restrictInStore(repo, ['address'])
    const { app: hub } = deployApp(repo, STAGES.all.readings, FAST, { store: kept.store })
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(409)
    expect([body.code, body.error]).toEqual(['NOT_ADMITTED', NOT_ADMITTED_FLIP])
    // invisible means absent: what the chain shows for a field they may not read is not in the answer either
    expect(JSON.stringify(body)).not.toMatch(/address|role:ops/)
    expect(JSON.stringify(body).toLowerCase()).not.toContain(SAFE.toLowerCase().slice(2))
    // the gaps review's I-4: the gate names its Safe on the chain, so it is kept with the Safe's address
    expect(body.readBack.systems.find((x: { id: string }) => x.id === SAFE_ID).found).toEqual({})
    await nothingStaged(hub, kept.store)
  })
})

describe('the flip through the split: a System kept whole in the private store', () => {
  it('a tree kept at role:ops reads back and applies: its flip in the store, nothing of it in git', async () => {
    repo = await composedRepo()
    grantOps(repo)
    kept = await hideInStore(repo, [TREE_ID])
    const { app: hub } = deployApp(repo, STAGES.hats.readings, FAST, { store: kept.store })
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(200)
    const ch = await change(hub)
    expect(ch.ops).toEqual([])
    const [flip, ...more] = privateOps(ch)
    expect(more).toEqual([])
    expect(flip).toMatchObject({ op: 'update-record', collection: 'systems', id: TREE_ID, set: { address: TREE, deployment: { status: 'deployed' } } })
    expect(flip!.set.hats.find((h: { key: string }) => h.key === 'council').hat).toBe(hatRef(SEPOLIA, COUNCIL))

    const head = git(repo, 'rev-parse HEAD').trim()
    const applied = await applyNow(hub)
    expect(applied.status, JSON.stringify(applied.body)).toBe(200)
    expect(git(repo, 'log -1 --format=%s').trim()).toBe(RESTRICTED_SUBJECT)
    expect(git(repo, `diff --stat ${head} HEAD`).trim()).toBe('')
    expect(history(repo)).not.toContain(hatRef(SEPOLIA, COUNCIL))
    const tree = kept.store.record('systems', TREE_ID) as { visibility: string; body: Record<string, any> }
    expect([tree.visibility, tree.body.deployment.status, tree.body.address]).toEqual(['role:ops', 'deployed', TREE])
  })

  it('a tree kept at role:ops when all of it reads deployed: the governance would carry its hat into git, so KEPT_PRIVATE; nothing staged', async () => {
    repo = await composedRepo()
    grantOps(repo)
    kept = await hideInStore(repo, [TREE_ID])
    const { app: hub } = deployApp(repo, STAGES.all.readings, FAST, { store: kept.store })
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(409)
    expect([body.code, body.error]).toEqual(['KEPT_PRIVATE', KEPT_PRIVATE])
    await nothingStaged(hub, kept.store)
  })

  it('a tree kept at members whose hat the governance would source a role from: git holds no membership tree to read it in, so the change engine refuses; nothing staged', async () => {
    repo = await composedRepo()
    kept = await hideInStore(repo, [TREE_ID], 'members')
    const { app: hub } = deployApp(repo, STAGES.all.readings, FAST, { store: kept.store })
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(422)
    expect(body.errors).toEqual([{ record: 'governance:governance', field: '', message: expect.stringContaining('this org has no membership tree to read it in') }])
    await nothingStaged(hub, kept.store)
  })

  it('a Safe kept at role:ops and the governance its flip adds land with one Apply: the Safe in the store, the governance and the tree in git', async () => {
    repo = await composedRepo()
    grantOps(repo)
    onDeployRolesOnly(repo)
    kept = await hideInStore(repo, [SAFE_ID])
    const { app: hub } = deployApp(repo, STAGES.all.readings, FAST, { store: kept.store })
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(200)
    const ch = await change(hub)
    expect(Object.keys(gitKeys(ch))).toEqual([`systems:${TREE_ID}`, 'governance:governance'])
    expect(ch.ops.find((o: { record: string }) => o.record === 'governance:governance').set.roles.council).toEqual({ hat: hatRef(SEPOLIA, COUNCIL) })
    expect(privateOps(ch)).toEqual([expect.objectContaining({ op: 'update-record', collection: 'systems', id: SAFE_ID })])

    const head = git(repo, 'rev-parse HEAD').trim()
    const applied = await applyNow(hub)
    expect(applied.status, JSON.stringify(applied.body)).toBe(200)
    expect(git(repo, 'rev-list --count HEAD').trim()).toBe(String(Number(git(repo, `rev-list --count ${head}`).trim()) + 1))
    const safe = kept.store.record('systems', SAFE_ID) as { body: Record<string, any> }
    expect([safe.body.deployment.status, safe.body.address, safe.body.signer_gate.address]).toEqual(['deployed', SAFE, GATE])
    expect(history(repo).toLowerCase()).not.toContain(SAFE.toLowerCase().slice(2))
    expect(history(repo).toLowerCase()).not.toContain(GATE.toLowerCase().slice(2))
    expect(await call(hub, '/api/deploy')).toEqual({ status: 409, body: { code: 'NOTHING_COMPOSED', error: NOTHING_COMPOSED } })
  })

  it('a Safe kept in the store that the governance\'s rule names is refused as any rule naming a System git does not hold; nothing staged', async () => {
    repo = await composedRepo()
    grantOps(repo)
    kept = await hideInStore(repo, [SAFE_ID])
    const { app: hub } = deployApp(repo, STAGES.all.readings, FAST, { store: kept.store })
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(422)
    expect(body.errors).toContainEqual({ record: 'governance:governance', field: '', message: `rule "treasury": decide.system names "${SAFE_ID}", and data/systems.yaml has no system by that id` })
    await nothingStaged(hub, kept.store)
  })
})

describe('the flip through the split: fields the store holds', () => {
  it('deployment kept at role:ops for every System: the flip writes it to the store, the governance its on_deploy adds lands in git; nothing reads composed after', async () => {
    repo = await composedRepo()
    grantOps(repo)
    kept = await restrictInStore(repo, ['deployment'])
    const { app: hub } = deployApp(repo, STAGES.all.readings, FAST, { store: kept.store })
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(200)
    const ch = await change(hub)
    expect(gitKeys(ch)).toEqual({
      [`systems:${SAFE_ID}`]: ['address', 'signer_gate'],
      [`systems:${TREE_ID}`]: ['address', 'hats', 'roles'],
      'governance:governance': ['roles', 'rules'],
    })
    expect(privateOps(ch).map(o => [o.field.record, o.field.field, o.field.value.status])).toEqual([[SAFE_ID, 'deployment', 'deployed'], [TREE_ID, 'deployment', 'deployed']])
    const head = git(repo, 'rev-parse HEAD').trim()
    expect((await applyNow(hub)).status).toBe(200)
    expect(git(repo, `log -p --format=%B ${head}..HEAD`)).not.toMatch(/deployment|read_back/)
    for (const id of [SAFE_ID, TREE_ID]) expect(kept.store.fields('systems', id).find(f => f.field === 'deployment')!.value).toMatchObject({ status: 'deployed' })
    expect((await call(hub, '/api/deploy')).body.code).toBe('NOTHING_COMPOSED')
  })

  it('hats and roles kept at role:ops: the tree\'s hats land in the store, never hats: [] in git; once all is deployed the governance would carry a kept hat, so KEPT_PRIVATE', async () => {
    repo = await composedRepo()
    grantOps(repo)
    kept = await restrictInStore(repo, ['hats', 'roles'])
    const { app: hub, world } = deployApp(repo, STAGES.hats.readings, FAST, { store: kept.store })
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(200)
    const ch = await change(hub)
    expect(gitKeys(ch)).toEqual({ [`systems:${TREE_ID}`]: ['address', 'deployment'] })
    const hats = privateOps(ch).find(o => o.field.field === 'hats')!.field.value
    expect(hats.find((h: { key: string }) => h.key === 'council').hat).toBe(hatRef(SEPOLIA, COUNCIL))
    expect((await applyNow(hub)).status).toBe(200)
    expect(history(repo)).not.toContain(hatRef(SEPOLIA, COUNCIL))
    expect(history(repo)).not.toMatch(/hats: \[\]/)

    world.node = STAGES.all.readings
    const last = await readBackNow(hub)
    expect(last.status, JSON.stringify(last.body)).toBe(409)
    expect([last.body.code, last.body.error]).toEqual(['KEPT_PRIVATE', KEPT_PRIVATE])
    await nothingStaged(hub, kept.store)
  })

  it('hats kept at role:ops and roles not: the tree\'s roles would carry its hat refs into git, so KEPT_PRIVATE; nothing staged', async () => {
    repo = await composedRepo()
    grantOps(repo)
    kept = await restrictInStore(repo, ['hats'])
    const { app: hub } = deployApp(repo, STAGES.hats.readings, FAST, { store: kept.store })
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(409)
    expect([body.code, body.error]).toEqual(['KEPT_PRIVATE', KEPT_PRIVATE])
    await nothingStaged(hub, kept.store)
  })

  for (const [id, field] of [[SAFE_ID, 'deployment'], [TREE_ID, 'hats']] as const) {
    it(`a ${field} the store holds with no level in the policy is refused naming no field (the split would write git under it); nothing staged`, async () => {
      repo = await composedRepo()
      kept = await hideFieldsInStore(repo, [[id, field]])
      const committed = readFileSync(join(repo, 'data', 'systems.yaml'), 'utf8')
      const { app: hub } = deployApp(repo, STAGES.all.readings, FAST, { store: kept.store })
      const { status, body } = await readBackNow(hub)
      expect(status, JSON.stringify(body)).toBe(409)
      expect([body.code, body.error]).toEqual(['KEPT_PRIVATE', KEPT_PRIVATE_FIELD])
      expect(body.error).not.toContain(field)
      await nothingStaged(hub, kept.store)
      expect(readFileSync(join(repo, 'data', 'systems.yaml'), 'utf8')).toBe(committed)
    })
  }
})

// PF-R184 stands: a viewer who reads part of the composition is refused PART_HIDDEN before the chain is read
// (tests/deploy/readback.test.ts, a System kept at role:ops); one who reads none of it is told nothing is composed.
describe('the flip through the split: who may read it back', () => {
  it('a viewer not admitted to the deployment the store keeps for every System reads no composition at all: NOTHING_COMPOSED, nothing read or staged', async () => {
    repo = await composedRepo()
    kept = await restrictInStore(repo, ['deployment'])
    const { app: hub, world } = deployApp(repo, STAGES.all.readings, FAST, { store: kept.store })
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(409)
    // invisible means absent (PF-R172): with every deployment kept from them, nothing they read is composed
    expect(body).toEqual({ code: 'NOTHING_COMPOSED', error: NOTHING_COMPOSED })
    expect(world.methods).toEqual([])
    await nothingStaged(hub, kept.store)
  })
})

describe('the flip through the split: judged on the whole, through the actor\'s change', () => {
  // The gaps review's I-3 (replaces gap A's "a deployed tree kept in the store counts for the membership tree"): the Hub
  // reads the membership tree from git (PF-R228), so the membership check is git's; a tree the store keeps is never
  // counted, whoever reads back.
  for (const admitted of [true, false]) {
    it(`a deployed tree kept in the store is not counted for the membership tree (an actor ${admitted ? '' : 'not '}admitted to it): the composed tree's flip stages, nothing of the hidden tree said`, async () => {
      repo = await composedRepo()
      if (admitted) grantOps(repo)
      commitSystems(repo, [{ id: 'side-tree', kind: 'hats-tree', driver: 'hats-tree', name: 'Hidden side roles', chain: SEPOLIA, address: '7' }])
      kept = await hideInStore(repo, ['side-tree'])
      const { app: hub } = deployApp(repo, STAGES.hats.readings, FAST, { store: kept.store })
      const { status, body } = await readBackNow(hub)
      expect(status, JSON.stringify(body)).toBe(200)
      expect((body.staged as { record: string }[]).map(o => o.record)).toEqual([`systems:${TREE_ID}`])
      const text = JSON.stringify(body)
      expect(text).not.toMatch(/side-tree|Hidden side roles|membership tree|deployed hats trees|role:ops/)
      expect(text).not.toContain(NAME_THE_TREE(2))
    })
  }

  it('a private edit the actor staged on a field the flip sets differently is refused, the change as it was; one on a field it does not set is kept', async () => {
    repo = await composedRepo()
    grantOps(repo)
    kept = await hideInStore(repo, [TREE_ID])
    const { app: hub } = deployApp(repo, STAGES.hats.readings, FAST, { store: kept.store })
    const own = await call(hub, '/api/changes/ops', 'POST', { ops: [{ op: 'update', record: `systems:${TREE_ID}`, set: { name: 'Council roles' } }] })
    expect(own.status, JSON.stringify(own.body)).toBe(200)
    expect((await readBackNow(hub)).status).toBe(200)
    const flip = privateOps(await change(hub))
    expect(flip).toHaveLength(1)
    expect(flip[0]!.set).toMatchObject({ name: 'Council roles', deployment: { status: 'deployed' } })

    expect((await hub.request('/api/changes', { method: 'DELETE' })).status).toBe(204)
    const other = await call(hub, '/api/changes/ops', 'POST', { ops: [{ op: 'update', record: `systems:${TREE_ID}`, set: { address: '9' } }] })
    expect(other.status, JSON.stringify(other.body)).toBe(200)
    const before = await change(hub)
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(409)
    expect(body.code).toBe('CHANGE_EDITS')
    expect(privateOps(await change(hub))).toEqual(privateOps(before))
  })
})

describe('the flip\'s one Apply: never half (git and the store)', () => {
  async function staged() {
    repo = await composedRepo()
    grantOps(repo)
    onDeployRolesOnly(repo)
    kept = await hideInStore(repo, [SAFE_ID])
    const { app: hub } = deployApp(repo, STAGES.all.readings, FAST, { store: kept.store })
    expect((await readBackNow(hub)).status).toBe(200)
    return { hub, store: kept.store, head: git(repo, 'rev-parse HEAD').trim(), before: await change(hub) }
  }
  const composed = (store: PrivateStore) => (store.record('systems', SAFE_ID)!.body as Record<string, any>).deployment.status === 'composed'
  const gitTree = (r: string) => systemsOf(r).find(x => x.id === TREE_ID)!.deployment.status

  it('git refusing the commit after the store wrote: the store rolls back; neither applied, the change kept whole', async () => {
    const { hub, store, head, before } = await staged()
    const hook = join(repo!, '.git', 'hooks', 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\necho "hook says no" >&2\nexit 1\n', { mode: 0o755 })
    const res = await applyNow(hub)
    expect(res.status).not.toBe(200)
    expect(git(repo!, 'rev-parse HEAD').trim()).toBe(head)
    expect(gitTree(repo!)).toBe('composed')
    expect(composed(store)).toBe(true)
    const after = await change(hub)
    expect([after.ops, privateOps(after)]).toEqual([before.ops, privateOps(before)])
    rmSync(hook)
    expect((await applyNow(hub)).status).toBe(200)
    expect([gitTree(repo!), composed(store)]).toEqual(['deployed', false])
  })

  it('the store failing before git runs: nothing committed; neither applied, the change kept whole', async () => {
    const { hub, store, head, before } = await staged()
    const within = store.within.bind(store)
    store.within = (async () => { throw new Error('disk I/O error') }) as never
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await applyNow(hub)
    errors.mockRestore()
    expect([res.status, res.body.code]).toEqual([503, 'PRIVATE_STORE'])
    expect(JSON.stringify(res.body)).not.toContain('disk I/O')
    expect(git(repo!, 'rev-parse HEAD').trim()).toBe(head)
    expect(composed(store)).toBe(true)
    const after = await change(hub)
    expect([after.ops, privateOps(after)]).toEqual([before.ops, privateOps(before)])
    store.within = within
    expect((await applyNow(hub)).status).toBe(200)
    expect([gitTree(repo!), composed(store)]).toEqual(['deployed', false])
  })

  it('the store failing to commit after git committed (L5 §10.3\'s window): 503 naming the commit, the private part kept in the change, never lost; Apply again lands it', async () => {
    const { hub, store } = await staged()
    const within = store.within.bind(store)
    store.within = (async (fn: (t: PrivateTransaction) => Promise<unknown>) => {
      const t = await store.begin()
      try { await fn(t) } catch (err) { t.rollback(); throw err }
      t.rollback()
      throw new Error('disk I/O error')
    }) as never
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await applyNow(hub)
    errors.mockRestore()
    expect([res.status, res.body.code, res.body.commit]).toEqual([503, 'PRIVATE_STORE', git(repo!, 'rev-parse HEAD').trim()])
    expect(composed(store)).toBe(true)
    const kept = await change(hub)
    expect(kept.ops).toEqual([])
    expect(privateOps(kept)).toEqual([expect.objectContaining({ op: 'update-record', id: SAFE_ID })])
    store.within = within
    expect((await applyNow(hub)).status).toBe(200)
    expect(composed(store)).toBe(false)
  })
})
