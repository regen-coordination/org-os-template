// DAO-OS L7 Task 12 (spec §4.3, §9; Review Focus 2 and 4): POST /api/deploy/read-back reads every composed System's
// predictions and stages what the chain holds as live Systems, in the actor's change: never applied here, judged by the
// org's rules like any change. A tree's top hat is recorded as soon as it reads done (the tree stays composed); a tree's
// wearers stay in its record until its gate's claim reads done (PF-R145); the template's governance is added once every
// on-chain System is deployed (P1). Every test builds a throwaway repository; the chain is the recorded node of
// fixtures/readings.ts (no network).
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { git } from '../changes/fixtures.ts'
import { readRegistry } from '../../server/registry.ts'
import { validateRepo } from '../../lib/data-validate.mjs'
import { ON_DEPLOY_KEPT, readBack } from '../../server/deploy/readback.ts'
import { planDeployment } from '../../lib/deploy/plan.mjs'
import { caip10, checksumAddress } from '../../lib/caip.mjs'
import { hatRef, prettyHatId, topHatId, treeRef } from '../../lib/hats.mjs'
import { A1, A2, A9, COUNCIL, GATE, LAST_TOP, SAFE, SEPOLIA, STAGES, SYSTEMS, TOP, composition } from './fixtures/readings.ts'
import { FAST, NOTHING_COMPOSED, PART_HIDDEN, SAFE_ID, TREE_ID, commitSystems, composedRepo, deployApp, hideInStore, json } from './fixtures/hub.ts'
import { membershipTree } from '../../lib/rules.mjs'

let repo: string | undefined
let hidden: Awaited<ReturnType<typeof hideInStore>> | undefined
afterEach(() => { hidden?.done(); hidden = undefined; if (repo) removeFixtureRepo(repo); repo = undefined })

const TREE = String(LAST_TOP + 1)

async function call(app: Hono, path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const res = await app.request(path, method === 'GET' ? undefined : json(method, body ?? {}))
  return { status: res.status, body: await res.json() }
}
const readBackNow = (app: Hono, body: unknown = {}) => call(app, '/api/deploy/read-back', 'POST', body)
const change = async (app: Hono) => (await call(app, '/api/changes')).body
const systemsOf = (r: string) => (readRegistry(r, 'systems').entries ?? []) as Record<string, any>[]
const errorsOf = (r: string) => validateRepo(r).filter((p: { level: string }) => p.level === 'error')

/** The deploy app on the recorded chain at `stage`. */
const app = (r: string, stage: keyof typeof STAGES) => deployApp(r, STAGES[stage].readings)

describe('POST /api/deploy/read-back (L7 Task 12)', () => {
  it('all deployed: the Safe and the tree flip live, the governance is added, staged in the actor\'s change; applied, nothing is composed', async () => {
    repo = await composedRepo()
    const { app: hub, reader } = app(repo, 'all')
    const head = git(repo, 'rev-parse HEAD')
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body.readBack.systems).toEqual([
      { id: SAFE_ID, status: 'deployed', found: { address: caip10(SEPOLIA, SAFE), gate: caip10(SEPOLIA, GATE) }, differs: [] },
      { id: TREE_ID, status: 'deployed', found: { top: hatRef(SEPOLIA, TOP), tree: TREE, 'hats.council': hatRef(SEPOLIA, COUNCIL) }, differs: [] },
    ])
    const ops = body.staged as { op: string; record: string; set: Record<string, any> }[]
    expect(ops.map(o => [o.op, o.record])).toEqual([['update', `systems:${SAFE_ID}`], ['update', `systems:${TREE_ID}`], ['update', 'governance:governance']])
    const [safe, tree, gov] = ops
    expect(safe!.set).toEqual({
      address: SAFE, deployment: { status: 'deployed', read_back: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      signer_gate: { hats: [`${TREE_ID}/council`], threshold: { type: 'absolute', min: 2, target: 2 }, claimable_for: true, address: GATE },
    })
    // a deployed hat keeps { key, hat, role } (P9); the map's `roles` say the same layer by ref (PF-R130)
    expect(tree!.set).toEqual({
      address: TREE, deployment: { status: 'deployed', read_back: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      hats: [{ key: 'council', hat: hatRef(SEPOLIA, COUNCIL), role: 'decides' }], roles: { [hatRef(SEPOLIA, COUNCIL)]: 'decides' },
    })
    expect(gov!.set.roles).toEqual({ council: { hat: hatRef(SEPOLIA, COUNCIL) } })
    expect(gov!.set.rules.at(-1)).toEqual({ id: 'treasury', applies_to: ['treasury'], propose: 'council', decide: { by: 'system', system: SAFE_ID } })
    // never composed with an address (PF-R165)
    for (const o of ops) expect(o.set.deployment?.status === 'composed' && o.set.address !== undefined).toBe(false)
    // staged, not applied: the org's rules decide it
    expect(git(repo, 'rev-parse HEAD')).toBe(head)
    expect((await change(hub)).ops.map((o: { record: string }) => o.record)).toEqual(ops.map(o => o.record))

    const applied = await call(hub, '/api/changes/apply', 'POST')
    expect(applied.status, JSON.stringify(applied.body)).toBe(200)
    expect(errorsOf(repo)).toEqual([])
    expect(await call(hub, '/api/deploy')).toEqual({ status: 409, body: { code: 'NOTHING_COMPOSED', error: NOTHING_COMPOSED } })
    // the Safe and the tree are read live through their drivers on the recorded chain
    const [s, t] = [systemsOf(repo).find(x => x.id === SAFE_ID)!, systemsOf(repo).find(x => x.id === TREE_ID)!]
    expect(s.deployment).toEqual({ status: 'deployed', read_back: expect.any(String) })
    const safeRead = await reader.read(s)
    expect(safeRead.ok, safeRead.error).toBe(true)
    const treeRead = await reader.read(t)
    expect(treeRead.ok, treeRead.error).toBe(true)
    expect(treeRead.facts).toMatchObject({ ref: treeRef(SEPOLIA, TREE), topHat: hatRef(SEPOLIA, TOP) })
  })

  it('partly deployed: the top hat minted is recorded on the tree, which stays composed; nothing else, and no governance', async () => {
    repo = await composedRepo()
    const { app: hub, world } = app(repo, 'top')
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body.readBack.systems.map((x: { id: string; status: string }) => [x.id, x.status])).toEqual([[SAFE_ID, 'pending'], [TREE_ID, 'pending']])
    const before = systemsOf(repo).find(x => x.id === TREE_ID)!.deployment
    expect(body.staged).toEqual([{ op: 'update', record: `systems:${TREE_ID}`, set: { deployment: { ...before, top: { ...before.top, hat: hatRef(SEPOLIA, TOP) } } } }])
    // the server's refusal of a deployed System written back to composed (PF-R165) takes it: applied, the plan reads that id
    expect((await call(hub, '/api/changes/apply', 'POST')).status).toBe(200)
    world.node = STAGES.top.readings
    const plan = (await call(hub, '/api/deploy')).body
    expect(plan.steps.map((s: { id: string; status: string }) => [s.id, s.status]).slice(0, 4)).toEqual([['safe:create', 'done'], ['tree:top', 'done'], ['tree:hats', 'ready'], ['tree:wearers', 'ready']])
  })

  it('a tree deployed before its gate keeps its wearers until "Register the signers" reads done, then drops them (PF-R145)', async () => {
    repo = await composedRepo()
    const { app: hub, world } = app(repo, 'hats')
    const first = await readBackNow(hub)
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body.staged.map((o: { record: string }) => o.record)).toEqual([`systems:${TREE_ID}`])
    const wearers = systemsOf(repo).find(x => x.id === TREE_ID)!.hats[0].wearers
    expect(first.body.staged[0].set.hats).toEqual([{ key: 'council', hat: hatRef(SEPOLIA, COUNCIL), role: 'decides', wearers }])
    expect((await call(hub, '/api/changes/apply', 'POST')).status).toBe(200)
    expect(errorsOf(repo)).toEqual([])
    // the gate is planned on the deployed tree, its signers the wearers kept
    const plan = (await call(hub, '/api/deploy')).body
    expect(plan.composed).toEqual([SAFE_ID])
    expect(plan.steps.map((s: { id: string; system: string; status: string }) => [s.id, s.system, s.status])).toEqual([
      ['safe:create', SAFE_ID, 'done'], ['gate:deploy', SAFE_ID, 'ready'], ['gate:wire', SAFE_ID, 'waits'], ['gate:claim', SAFE_ID, 'waits'],
    ])
    // all of it on chain now: the Safe flips, the tree's wearers go, the governance is added
    world.node = STAGES.all.readings
    const last = await readBackNow(hub)
    expect(last.status, JSON.stringify(last.body)).toBe(200)
    expect(last.body.staged.map((o: { record: string }) => o.record)).toEqual([`systems:${SAFE_ID}`, `systems:${TREE_ID}`, 'governance:governance'])
    expect(last.body.staged[1].set).toEqual({ hats: [{ key: 'council', hat: hatRef(SEPOLIA, COUNCIL), role: 'decides' }] })
    expect((await call(hub, '/api/changes/apply', 'POST')).status).toBe(200)
    expect(errorsOf(repo)).toEqual([])
    expect((await call(hub, '/api/deploy')).body.code).toBe('NOTHING_COMPOSED')
  })

  it('nothing deployed yet: every System pending, nothing staged', async () => {
    repo = await composedRepo()
    const { app: hub } = app(repo, 'nothing')
    const { status, body } = await readBackNow(hub)
    expect(status).toBe(200)
    expect(body).toMatchObject({ staged: [], readBack: { systems: [{ id: SAFE_ID, status: 'pending' }, { id: TREE_ID, status: 'pending' }] } })
    expect((await change(hub)).ops).toEqual([])
  })

  // Review Focus 2 (ruling P2)
  it('a top hat minted by someone else is a mismatch and step 2 is prepared again', async () => {
    repo = await composedRepo()
    const { app: hub } = app(repo, 'frontRun')
    const ran = [{ step: 'tree:top', system: TREE_ID, predicts: [{ kind: 'hat', value: hatRef(SEPOLIA, TOP) }, { kind: 'tree', value: treeRef(SEPOLIA, TREE) }] }]
    const { status, body } = await readBackNow(hub, { ran })
    expect(status, JSON.stringify(body)).toBe(409)
    const sentence = `the Safe wears no top hat at ${prettyHatId(TOP)}; another top hat took it — prepare again`
    expect(body.code).toBe('MISMATCH')
    expect(body.readBack.systems.find((x: { id: string }) => x.id === TREE_ID)).toEqual({ id: TREE_ID, status: 'mismatch', found: {}, differs: [sentence] })
    expect(body.error).toContain(sentence)
    expect((await change(hub)).ops).toEqual([])
    const next = topHatId(LAST_TOP + 2)
    const top = (await call(hub, '/api/deploy')).body.steps.find((s: { id: string }) => s.id === 'tree:top')
    expect(top).toMatchObject({ status: 'ready', predicts: [{ kind: 'hat', value: hatRef(SEPOLIA, next) }, { kind: 'tree', value: treeRef(SEPOLIA, String(LAST_TOP + 2)) }] })
  })

  it('a System the chain shows otherwise is a mismatch, and nothing is staged', async () => {
    repo = await composedRepo()
    const { app: hub } = app(repo, 'taken')
    const { status, body } = await readBackNow(hub)
    expect(status).toBe(409)
    expect(body.readBack.systems.find((x: { id: string }) => x.id === TREE_ID)).toMatchObject({ status: 'mismatch', differs: [expect.stringMatching(/is worn by another account, not the Safe$/)] })
    expect((await change(hub)).ops).toEqual([])
  })

  // Review Focus 4 (ruling P3): the engine's L5 check on the projected governance
  it('a flip that leaves nobody able to propose is refused', async () => {
    repo = await composedRepo()
    // the only proposer has no git handle and a wallet on another chain: once the Sepolia tree is the only one deployed,
    // it is the membership tree, and her wallet does not count (L5 §7.6)
    writeFileSync(join(repo, 'data', 'governance.yaml'), `schema_version: "2.0"
governance:
  model: steward-council
  roles:
    stewards: { members: [ana] }
  rules:
    - id: members
      applies_to: [records, members, governance, identity, systems, treasury, operations, publication]
      propose: stewards
      decide: { by: stewards, method: direct }
`)
    const members = readFileSync(join(repo, 'data', 'members.yaml'), 'utf8')
      .replace('    joined: "2025-02-01"\n', '    joined: "2025-02-01"\n    handles:\n      wallet: "eip155:1:0x00000000000000000000000000000000000000a5"\n')
    writeFileSync(join(repo, 'data', 'members.yaml'), members)
    git(repo, 'add data/governance.yaml data/members.yaml')
    git(repo, 'commit -qm "fixture: the only proposer has a wallet on another chain"')
    const { app: hub } = app(repo, 'all')
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(422)
    expect(body.errors.map((e: { message: string }) => e.message)).toContain(
      'rule members: nobody can propose under it. The stewards role has no member with a git or wallet handle and is not sourced from a hat. ' +
      "Add a handle first (the owner's claim: §8.1).")
    expect((await change(hub)).ops).toEqual([])
  })

  it('an on_deploy role the governance holds otherwise: the Systems flip, the Safe keeps its on_deploy, and the read-back says why (walk G4)', async () => {
    repo = await composedRepo()
    writeFileSync(join(repo, 'data', 'governance.yaml'), readFileSync(join(repo, 'data', 'governance.yaml'), 'utf8').replace('  model: "solo-maintainer"\n', '  model: "solo-maintainer"\n  roles:\n    council: { members: [bruno] }\n'))
    git(repo, 'add data/governance.yaml')
    git(repo, 'commit -qm "fixture: a council role written by hand"')
    const kept = systemsOf(repo).find(x => x.id === SAFE_ID)!.deployment.on_deploy
    expect(kept).toBeTruthy()
    const { app: hub } = app(repo, 'all')
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body.note).toBe(ON_DEPLOY_KEPT('role council is already written.'))
    const ops = body.staged as { record: string; set: Record<string, any> }[]
    expect(ops.map(o => o.record)).toEqual([`systems:${SAFE_ID}`, `systems:${TREE_ID}`])
    expect(ops[0]!.set.deployment).toEqual({ status: 'deployed', read_back: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), on_deploy: kept })
    expect(ops[1]!.set.deployment).toMatchObject({ status: 'deployed' })
    expect((await change(hub)).ops.map((o: { record: string }) => o.record)).toEqual(ops.map(o => o.record))
    // Applied, the records are valid, and nothing is left composed.
    const applied = await call(hub, '/api/changes/apply', 'POST')
    expect(applied.status, JSON.stringify(applied.body)).toBe(200)
    expect(errorsOf(repo)).toEqual([])
  })

  it('an on_deploy role the governance already holds as it is is accepted: the rest of the governance is added (walk G4)', async () => {
    repo = await composedRepo()
    writeFileSync(join(repo, 'data', 'governance.yaml'), readFileSync(join(repo, 'data', 'governance.yaml'), 'utf8').replace('  model: "solo-maintainer"\n',
      `  model: "solo-maintainer"\n  roles:\n    council: { hat: "${hatRef(SEPOLIA, COUNCIL)}" }\n`))
    git(repo, 'add data/governance.yaml')
    git(repo, 'commit -qm "fixture: the council role as the read-back writes it"')
    const { app: hub } = app(repo, 'all')
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body.note).toBeUndefined()
    const ops = body.staged as { record: string; set: Record<string, any> }[]
    expect(ops.map(o => o.record)).toEqual([`systems:${SAFE_ID}`, `systems:${TREE_ID}`, 'governance:governance'])
    expect(ops[0]!.set.deployment).toEqual({ status: 'deployed', read_back: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    const gov = ops[2]!.set
    // The role is held as it is: not written again; the rule is added.
    expect(gov.roles).toBeUndefined()
    expect(gov.rules.at(-1)).toEqual({ id: 'treasury', applies_to: ['treasury'], propose: 'council', decide: { by: 'system', system: SAFE_ID } })
    const applied = await call(hub, '/api/changes/apply', 'POST')
    expect(applied.status, JSON.stringify(applied.body)).toBe(200)
    expect(errorsOf(repo)).toEqual([])
  })

  it('a read the node fails answers 502; a body that is not {ran} is a 400; nothing composed is NOTHING_COMPOSED', async () => {
    repo = await composedRepo()
    const { app: hub, world } = app(repo, 'all')
    expect((await readBackNow(hub, { ran: [{ step: 'tree:top' }] })).status).toBe(400)
    expect(world.methods).toEqual([])
    world.node = { ...STAGES.all.readings, calls: {} }
    expect((await readBackNow(hub)).status).toBe(502)
    removeFixtureRepo(repo)
    repo = await composedRepo({ add: false })
    expect(await readBackNow(app(repo, 'all').app)).toEqual({ status: 409, body: { code: 'NOTHING_COMPOSED', error: NOTHING_COMPOSED } })
  })
})

// Fix wave I1 (PF-R184): a read-back is made by someone who may read the whole composition; a partial view is refused
// before the chain is read, naming nothing hidden, and stages nothing.
describe('POST /api/deploy/read-back: only the whole composition is read back', () => {
  for (const onDeploy of [true, false]) {
    it(`a viewer who may read the gated Safe and not its tree is refused, nothing read or staged (${onDeploy ? 'with' : 'without'} on_deploy)`, async () => {
      repo = await composedRepo()
      if (!onDeploy) {
        const path = join(repo, 'data', 'systems.yaml')
        const doc = parse(readFileSync(path, 'utf8'))
        delete doc.systems.find((x: { id: string }) => x.id === SAFE_ID).deployment.on_deploy
        writeFileSync(path, stringify(doc))
        git(repo, 'add data/systems.yaml'); git(repo, 'commit -qm "fixture: no on_deploy"')
      }
      hidden = await hideInStore(repo, [TREE_ID])
      const { app: hub, world } = deployApp(repo, STAGES.safe.readings, FAST, { store: hidden.store })
      const { status, body } = await readBackNow(hub)
      expect(status, JSON.stringify(body)).toBe(409)
      expect(body).toEqual({ code: 'PART_HIDDEN', error: PART_HIDDEN })
      expect(JSON.stringify(body)).not.toContain(TREE_ID)
      expect(world.methods).toEqual([])
      expect((await change(hub)).ops).toEqual([])
    })
  }

  it('a viewer who may read the tree and not the gated Safe that wears its top hat is refused, nothing staged', async () => {
    repo = await composedRepo()
    hidden = await hideInStore(repo, [SAFE_ID])
    const { app: hub, world } = deployApp(repo, STAGES.all.readings, FAST, { store: hidden.store })
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(409)
    expect(body).toEqual({ code: 'PART_HIDDEN', error: PART_HIDDEN })
    expect(JSON.stringify(body)).not.toContain(SAFE_ID)
    expect(world.methods).toEqual([])
    expect((await change(hub)).ops).toEqual([])
  })
})

// L7 gap A (PF-R226) replaced PF-R191's and final review I-2's refusals (a System kept in the store, a field the policy
// restricts or the store holds): the flip goes through the split. Its tests are tests/deploy/private-flip.test.ts.

// Fix wave I2: the flip is made through the actor's own change, inside the lock; what they staged is kept, or the
// read-back is refused when the two set one field differently.
describe('POST /api/deploy/read-back: through the actor\'s change', () => {
  it('a governance role the actor staged is kept beside the one the flip adds', async () => {
    repo = await composedRepo()
    const { app: hub } = app(repo, 'all')
    const staged = await call(hub, '/api/changes/ops', 'POST', { ops: [{ op: 'update', record: 'governance:governance', set: { roles: { stewards: { members: ['bruno'] } } } }] })
    expect(staged.status, JSON.stringify(staged.body)).toBe(200)
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(200)
    const gov = (await change(hub)).ops.find((o: { record: string }) => o.record === 'governance:governance')
    expect(gov.set.roles).toEqual({ stewards: { members: ['bruno'] }, council: { hat: hatRef(SEPOLIA, COUNCIL) } })
  })

  it('a Systems edit the actor staged on a field the flip sets differently is refused, the change as it was', async () => {
    repo = await composedRepo()
    const { app: hub } = app(repo, 'all')
    const committed = systemsOf(repo).find(x => x.id === SAFE_ID)!
    const staged = await call(hub, '/api/changes/ops', 'POST', { ops: [{ op: 'update', record: `systems:${SAFE_ID}`, set: { deployment: { ...committed.deployment, salt: '2' } } }] })
    expect(staged.status, JSON.stringify(staged.body)).toBe(200)
    const before = (await change(hub)).ops
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(409)
    expect(body.code).toBe('CHANGE_EDITS')
    expect(body.error).toBe(`Your changes already edit systems:${SAFE_ID}: apply, propose or discard them, then read back.`)
    expect((await change(hub)).ops).toEqual(before)
  })

  it('a Systems edit on a field the flip does not set is kept', async () => {
    repo = await composedRepo()
    const { app: hub } = app(repo, 'all')
    const staged = await call(hub, '/api/changes/ops', 'POST', { ops: [{ op: 'update', record: `systems:${SAFE_ID}`, set: { name: 'Test DAO treasury' } }] })
    expect(staged.status, JSON.stringify(staged.body)).toBe(200)
    expect((await readBackNow(hub)).status).toBe(200)
    const safe = (await change(hub)).ops.find((o: { record: string }) => o.record === `systems:${SAFE_ID}`)
    expect(safe.set).toMatchObject({ name: 'Test DAO treasury', address: SAFE, deployment: { status: 'deployed' } })
  })
})

// Final L7 review I-1: a flip that makes a second deployed hats tree, with governance.membership.tree unnamed, would
// leave the Hub without a membership tree (lib/rules.mjs `membershipTree`: none when several and none is named), so the
// org's wallets and hat-sourced roles would no longer be read in any tree. `validateChange` refuses it on every path
// (stage, Propose, Revise, Apply's backstop; a ratify's rebuild runs Apply's); naming the tree first lets it through.
const NAME_THE_TREE = (n: number) => `Name the membership tree in data/governance.yaml first: this change would make ${n} deployed hats trees, and the Hub would no longer know which one holds the org's roles.`
const COUNCIL_TREE = { id: 'council-tree', kind: 'hats-tree', driver: 'hats-tree', name: 'Council', chain: SEPOLIA, address: '7' }
const treeOf = (r: string) => {
  const gov = (parse(readFileSync(join(r, 'data', 'governance.yaml'), 'utf8')) as { governance?: Record<string, unknown> }).governance ?? null
  return membershipTree(gov, systemsOf(r))
}

describe('a second deployed hats tree while the membership tree is unnamed (final review I-1)', () => {
  it('the read-back that flips the composed tree beside a deployed one is refused, nothing staged; the membership tree stays', async () => {
    repo = await composedRepo()
    commitSystems(repo, [COUNCIL_TREE])
    expect(treeOf(repo)).toEqual({ id: 'council-tree', tree: `${SEPOLIA}:7` })
    const { app: hub } = app(repo, 'hats')
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(422)
    expect(body.errors).toEqual([{ record: `systems:${TREE_ID}`, field: '', message: NAME_THE_TREE(2) }])
    expect(JSON.stringify(body.errors)).not.toContain('council-tree')
    expect((await change(hub)).ops).toEqual([])
    expect(treeOf(repo)).toEqual({ id: 'council-tree', tree: `${SEPOLIA}:7` })
  })

  it('a second deployed tree staged by hand is refused the same way', async () => {
    repo = await composedRepo()
    commitSystems(repo, [COUNCIL_TREE])
    const { app: hub } = app(repo, 'hats')
    const staged = await call(hub, '/api/changes/ops', 'POST', { ops: [{ op: 'create', record: 'systems:other-tree', value: { ...COUNCIL_TREE, id: 'other-tree', name: 'Other', address: '9' } }] })
    expect(staged.status, JSON.stringify(staged.body)).toBe(422)
    expect(staged.body.errors).toEqual([{ record: 'systems:other-tree', field: '', message: NAME_THE_TREE(2) }])
    expect((await change(hub)).ops).toEqual([])
  })

  it('with governance.membership.tree named, the flip stages', async () => {
    repo = await composedRepo()
    commitSystems(repo, [COUNCIL_TREE])
    writeFileSync(join(repo, 'data', 'governance.yaml'), readFileSync(join(repo, 'data', 'governance.yaml'), 'utf8').replace('  model: "solo-maintainer"\n', '  model: "solo-maintainer"\n  membership:\n    tree: council-tree\n'))
    git(repo, 'add data/governance.yaml')
    git(repo, 'commit -qm "fixture: the membership tree named"')
    const { app: hub } = app(repo, 'hats')
    const { status, body } = await readBackNow(hub)
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body.staged.map((o: { record: string }) => o.record)).toEqual([`systems:${TREE_ID}`])
    const applied = await call(hub, '/api/changes/apply', 'POST', {})
    expect(applied.status, JSON.stringify(applied.body)).toBe(200)
    expect(treeOf(repo)).toEqual({ id: 'council-tree', tree: `${SEPOLIA}:7` })
  })
})

// Fix wave M4 (PF-R185): `read_back` is the house's record day, the UTC day of the read-back's clock, as a receipt's
// `at` and a decision row's date are written.
describe('POST /api/deploy/read-back: the read_back day', () => {
  it('is the UTC day of the clock', async () => {
    repo = await composedRepo()
    const { app: hub } = deployApp(repo, STAGES.all.readings, FAST, { now: () => new Date('2026-11-06T02:30:00Z') })
    const { body } = await readBackNow(hub)
    expect(body.staged[0].set.deployment.read_back).toBe('2026-11-06')
  })
})

describe('readBack (spec §9 matches)', () => {
  it('a Safe whose owners or threshold differ from the composed ones is a mismatch, saying what the chain shows', () => {
    const state = structuredClone(STAGES.all.state)
    state.safes[SAFE_ID]!.read = { ...state.safes[SAFE_ID]!.read!, owners: [A1, A2], threshold: 1 }
    const rb = readBack(composition(), state)
    expect(rb.systems.find(x => x.id === SAFE_ID)).toMatchObject({ status: 'mismatch', differs: [
      expect.stringMatching(/^the Safe's owners are .*, not the composed /), 'the Safe\'s threshold is 1, not the composed 2',
    ] })
  })

  it('a gate that does not take a composed signer hat is a mismatch', () => {
    const state = structuredClone(STAGES.all.state)
    state.gates[SAFE_ID]!.signerHats = []
    expect(readBack(composition(), state).systems.find(x => x.id === SAFE_ID)).toMatchObject({ status: 'mismatch', differs: [`the gate does not take ${prettyHatId(COUNCIL)} as a signer hat`] })
  })

  // Fix wave I1 (b): a System is deployed only when every step expected of it is planned and reads done
  it('a gated Safe whose tree is not in the composition is pending with only "Create the Safe" done', () => {
    const onlySafe = composition([SYSTEMS[0]!])
    for (const stage of ['safe', 'all'] as const) {
      expect(readBack(onlySafe, STAGES[stage].state).systems).toEqual([{ id: SAFE_ID, status: 'pending', found: { address: caip10(SEPOLIA, SAFE) }, differs: [] }])
    }
  })

  it('a tree whose wearing Safe is not in the composition is pending', () => {
    const rb = readBack(composition([SYSTEMS[1]!]), STAGES.all.state)
    expect(rb.systems.map(x => [x.id, x.status])).toEqual([[TREE_ID, 'pending']])
  })

  it('a System a planner problem names stays pending', () => {
    // the third owner wears none of the gate's signer hats: every step reads done, and the planner says so (fix M1)
    const systems = structuredClone(SYSTEMS)
    const council = (systems[1] as { hats: { key: string; wearers: string[] }[] }).hats.find(h => h.key === 'council')!
    council.wearers = council.wearers.slice(0, 2)
    const c = composition(systems)
    expect(planDeployment(c, STAGES.all.state).steps.every((st: { status: string }) => st.status === 'done')).toBe(true)
    const rb = readBack(c, STAGES.all.state)
    expect(rb.systems.map(x => [x.id, x.status])).toEqual([[SAFE_ID, 'pending'], [TREE_ID, 'deployed']])
  })

  // Fix wave M2: the chain's other modules are a mismatch; modules or a guard the read could not take are not proven
  it('an ungated Safe with a module or a guard is a mismatch', () => {
    const systems = structuredClone(SYSTEMS)
    delete (systems[0] as Record<string, unknown>).signer_gate
    const rb = readBack(composition([systems[0]!]), STAGES.wired.state)
    expect(rb.systems[0]).toMatchObject({ id: SAFE_ID, status: 'mismatch', differs: [`the Safe has another module, ${checksumAddress(GATE)}`, `the Safe's guard is ${checksumAddress(GATE)}, which was not composed`] })
  })

  it('a gated Safe with a module besides its gate is a mismatch', () => {
    const state = structuredClone(STAGES.all.state)
    state.safes[SAFE_ID]!.read = { ...state.safes[SAFE_ID]!.read!, modules: [GATE, A9] }
    expect(readBack(composition(), state).systems.find(x => x.id === SAFE_ID)).toMatchObject({ status: 'mismatch', differs: [`the Safe has another module, ${checksumAddress(A9)}`] })
  })

  it('an ungated Safe whose modules or guard the read could not take is pending', () => {
    const systems = structuredClone(SYSTEMS)
    delete (systems[0] as Record<string, unknown>).signer_gate
    for (const field of ['modules', 'guard'] as const) {
      const state = structuredClone(STAGES.safe.state)
      state.safes[SAFE_ID]!.read = { ...state.safes[SAFE_ID]!.read!, unknown: [field] }
      expect(readBack(composition([systems[0]!]), state).systems[0]!.status).toBe('pending')
    }
  })
})
