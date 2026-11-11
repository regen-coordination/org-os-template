// DAO-OS L7 Task 11 (spec §8.1–§8.3): GET /api/deploy reads the committed composition and the chain, and answers the
// plan, each step prepared for its signer: an account step as its call and the explorer page of `to`, a Safe step as
// the Safe transaction that carries it (L2's prepareSafeTx, the nonce read from the chain). It writes nothing, takes no
// lock and never sends. Every test builds a throwaway repository; the chain is the recorded node of
// fixtures/readings.ts (no network), the Safe Transaction Service and the explorer answer 404 (as on a fork).
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { SystemReader } from '../../server/systems/reader.ts'
import { CHAINS } from '../../server/systems/chains.ts'
import { DEPLOY_DRIVER, type DeployPlan } from '../../server/deploy/prepare.ts'
import { mountDeploy } from '../../server/deploy/routes.ts'
import { FAST, NOTHING_COMPOSED, PART_HIDDEN_PLAN, SAFE_ID, STAGED_ONLY, TREE_ID, composedRepo, deployApp, hideInStore, json } from './fixtures/hub.ts'
import { DEPLOYMENTS } from '../../lib/deployments.mjs'
import { encodeCall } from '../../lib/abi.mjs'
import { caip10, checksumAddress } from '../../lib/caip.mjs'
import { HATS_SIGNATURES } from '../../lib/hats.mjs'
import { safeTxHash } from '../../lib/safe-tx.mjs'
import { RPC_HOST, SAFE, SEPOLIA, STAGES, callKey, readings } from './fixtures/readings.ts'

const D = DEPLOYMENTS[SEPOLIA]!

let repo: string | undefined
afterEach(() => { if (repo) removeFixtureRepo(repo); repo = undefined })

async function plan(app: Hono, status = 200): Promise<DeployPlan & Record<string, any>> {
  const res = await app.request('/api/deploy')
  const body = await res.json()
  expect(res.status, JSON.stringify(body)).toBe(status)
  return body
}
const statuses = (p: DeployPlan) => p.steps.map(s => [s.id, s.system, s.status])

const EXPECTED_TOP = ['done', 'done', 'ready', 'ready', 'waits', 'waits', 'waits']
const order = (st: string[]) => [
  ['safe:create', SAFE_ID, st[0]], ['tree:top', TREE_ID, st[1]], ['tree:hats', TREE_ID, st[2]], ['tree:wearers', TREE_ID, st[3]],
  ['gate:deploy', SAFE_ID, st[4]], ['gate:wire', SAFE_ID, st[5]], ['gate:claim', SAFE_ID, st[6]],
]

describe('GET /api/deploy (L7 Task 11)', () => {
  const EXPECTED: Record<string, string[]> = {
    nothing: ['ready', 'waits', 'waits', 'waits', 'waits', 'waits', 'waits'],
    safe: ['done', 'ready', 'waits', 'waits', 'waits', 'waits', 'waits'],
    top: ['done', 'done', 'ready', 'ready', 'waits', 'waits', 'waits'],
    hats: ['done', 'done', 'done', 'done', 'ready', 'waits', 'waits'],
    gate: ['done', 'done', 'done', 'done', 'done', 'ready', 'waits'],
    wired: ['done', 'done', 'done', 'done', 'done', 'done', 'ready'],
    all: ['done', 'done', 'done', 'done', 'done', 'done', 'done'],
  }
  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`${name}: each step answers the status the chain gives it, keyed by step and System`, async () => {
      repo = await composedRepo()
      const { app } = deployApp(repo, STAGES[name as keyof typeof STAGES].readings)
      const p = await plan(app)
      expect(p.chain).toBe(SEPOLIA)
      expect(p.composed).toEqual([SAFE_ID, TREE_ID])
      expect(statuses(p)).toEqual(order(expected))
      expect(p.problems).toEqual([])
      expect(Number.isNaN(Date.parse(p.readAt))).toBe(false)
      // only a ready step carries what its signer runs
      for (const s of p.steps) expect(s.step !== undefined).toBe(s.status === 'ready')
    })
  }

  it('an account step carries its call, an account signer to be chosen, and the explorer page of `to`', async () => {
    repo = await composedRepo()
    const { app } = deployApp(repo, STAGES.nothing.readings)
    const create = (await plan(app)).steps[0]!
    expect(create.title).toBe('Create the Safe')
    expect(create.predicts).toEqual([{ kind: 'address', value: caip10(SEPOLIA, SAFE) }])
    expect(create.step).toMatchObject({
      call: { chain: SEPOLIA, to: caip10(SEPOLIA, D.safe.proxyFactory), value: '0', operation: 0 },
      signer: { kind: 'account', account: '' }, safe: null,
    })
    expect(create.step!.call.data.slice(0, 10)).toBe('0x1688f0b9') // createProxyWithNonce(address,bytes,uint256)
    expect(create.step!.call.summary).toContain(SAFE)
    expect(create.link).toBe(`https://${CHAINS[SEPOLIA]!.explorer}/address/${checksumAddress(D.safe.proxyFactory)}`)
  })

  it('a Safe step is the Safe transaction that carries it: its ref id the safeTxHash on chain 11155111, one wave on consecutive nonces', async () => {
    repo = await composedRepo()
    const { app } = deployApp(repo, STAGES.top.readings)
    const p = await plan(app)
    const hats = p.steps.find(s => s.id === 'tree:hats')!, wearers = p.steps.find(s => s.id === 'tree:wearers')!
    for (const [s, nonce] of [[hats, 0], [wearers, 1]] as const) {
      const safe = s.step!.safe!
      expect(s.step!.signer).toEqual({ kind: 'safe', account: caip10(SEPOLIA, SAFE) })
      expect(safe.payload).toMatchObject({ to: checksumAddress(D.hats.address), value: '0', operation: 0, nonce, data: s.step!.call.data })
      expect(safe.ref.id).toBe(safeTxHash({ chainId: 11155111, safe: SAFE, ...safe.payload }))
      expect(safe.ref).toMatchObject({ system: SAFE_ID, payload: { nonce, operation: 0 } })
      expect(safe.link).toContain(SAFE)
      expect(s.link).toBe(safe.link)
    }
    expect(hats.step!.call.data.slice(0, 10)).toBe(encodeCall(HATS_SIGNATURES.batchCreateHats, [[], [], [], [], [], [], []]).slice(0, 10))
  })

  it('the wiring is one Safe transaction to MultiSendCallOnly, operation 1, and warns of the window before the claim', async () => {
    repo = await composedRepo()
    const { app } = deployApp(repo, STAGES.gate.readings)
    const wire = (await plan(app)).steps.find(s => s.id === 'gate:wire')!
    expect(wire.step!.safe!.payload).toMatchObject({ to: checksumAddress(D.safe.multiSendCallOnly), operation: 1, nonce: 2 })
    expect(wire.differs?.[0]).toMatch(/^Between this step and "Register the signers"/)
  })

  it('prepare writes nothing: the files, HEAD and the actor\'s change are as they were', async () => {
    repo = await composedRepo()
    const { app } = deployApp(repo, STAGES.top.readings)
    const head = git(repo, 'rev-parse HEAD'), files = git(repo, 'status --porcelain'), systems = readFileSync(join(repo, 'data', 'systems.yaml'), 'utf8')
    const before = await (await app.request('/api/changes')).json()
    await plan(app)
    expect(git(repo, 'rev-parse HEAD')).toBe(head)
    expect(git(repo, 'status --porcelain')).toBe(files)
    expect(readFileSync(join(repo, 'data', 'systems.yaml'), 'utf8')).toBe(systems)
    expect((await (await app.request('/api/changes')).json()).ops).toEqual(before.ops)
  })

  it('a composition only staged answers STAGED_ONLY, and nothing is read from the chain', async () => {
    repo = await composedRepo({ apply: false })
    const { app, world } = deployApp(repo, STAGES.nothing.readings)
    expect(await plan(app, 409)).toEqual({ code: 'STAGED_ONLY', error: STAGED_ONLY })
    expect(world.methods).toEqual([])
  })

  it('nothing composed answers NOTHING_COMPOSED, and nothing is read from the chain', async () => {
    repo = await composedRepo({ add: false })
    const { app, world } = deployApp(repo, STAGES.nothing.readings)
    expect(await plan(app, 409)).toEqual({ code: 'NOTHING_COMPOSED', error: NOTHING_COMPOSED })
    expect(world.methods).toEqual([])
  })

  it('with the composition committed and a canvas edit staged, the plan is the committed one', async () => {
    repo = await composedRepo()
    const { app } = deployApp(repo, STAGES.nothing.readings)
    const committed = parse(readFileSync(join(repo, 'data', 'systems.yaml'), 'utf8')).systems.find((s: { id: string }) => s.id === SAFE_ID)
    const staged = await app.request('/api/changes/ops', json('POST', { ops: [{ op: 'update', record: `systems:${SAFE_ID}`, set: { deployment: { ...committed.deployment, salt: '2' } } }] }))
    expect(staged.status, await staged.clone().text()).toBe(200)
    const create = (await plan(app)).steps[0]!
    expect(create.predicts).toEqual([{ kind: 'address', value: caip10(SEPOLIA, SAFE) }])
  })

  it('a read the node fails answers 502, naming the node\'s host only', async () => {
    repo = await composedRepo()
    const failing = readings({}, 1)
    failing.errors.push(callKey(D.hats.address, encodeCall(HATS_SIGNATURES.lastTopHatId, [])))
    const { app } = deployApp(repo, failing)
    const body = await plan(app, 502)
    expect(body.code).toBe('READ_FAILED')
    expect(body.error).toContain(RPC_HOST)
    expect(body.error).not.toContain('rpc.example.org')
    expect(body.error).not.toContain('0123456789abcdef')
  })

  it('the deploy reads run as the `deploy` pseudo-driver: Sepolia\'s RPC host only, paced as the hats-tree driver reads it', async () => {
    expect(DEPLOY_DRIVER.name).toBe('deploy')
    expect(DEPLOY_DRIVER.hosts).toEqual([CHAINS[SEPOLIA]!.rpc, 'testnet.hub.snapshot.org']) // the Snapshot testnet hub since L7 Task 13
    expect(DEPLOY_DRIVER.minGapMs).toBeGreaterThanOrEqual(250)
    repo = await composedRepo()
    const { app, world } = deployApp(repo, STAGES.nothing.readings, DEPLOY_DRIVER)
    const started = Date.now()
    expect(statuses(await plan(app))).toEqual(order(EXPECTED.nothing!))
    const posts = world.methods.filter(m => m === 'eth_blockNumber').length
    expect(Date.now() - started).toBeGreaterThanOrEqual((posts - 1) * DEPLOY_DRIVER.minGapMs - 50)
  }, 30_000)
})

describe('invisible means absent (PF-R158): the plan is made from the records the viewer may read', () => {
  // The hidden Systems are kept in the private store at `role:ops` (a role nobody holds), the deploy routes reading
  // them through privateReads(privateStore) (L5 §10): a level above members is never written into git.
  let hidden: Awaited<ReturnType<typeof hideInStore>> | undefined
  afterEach(() => { hidden?.done(); hidden = undefined })

  it('a composition the viewer may read only part of is refused in words naming nothing hidden, before anything is read (PF-R184)', async () => {
    repo = await composedRepo()
    hidden = await hideInStore(repo, [TREE_ID])
    const { app, world } = deployApp(repo, STAGES.top.readings, FAST, { store: hidden.store })
    const p = await plan(app, 409)
    expect(p).toEqual({ code: 'PART_HIDDEN', error: PART_HIDDEN_PLAN })
    expect(JSON.stringify(p)).not.toContain(TREE_ID)
    expect(world.methods).toEqual([])
  })

  it('a System kept private that the viewer may read is planned with the rest', async () => {
    repo = await composedRepo()
    hidden = await hideInStore(repo, [TREE_ID], 'members')
    const { app } = deployApp(repo, STAGES.top.readings, FAST, { store: hidden.store })
    const p = await plan(app)
    expect(p.composed).toEqual([SAFE_ID, TREE_ID])
    expect(statuses(p)).toEqual(order(EXPECTED_TOP))
  })

  it('a composition the viewer may not read at all answers as nothing composed, before anything is read', async () => {
    repo = await composedRepo()
    hidden = await hideInStore(repo, [SAFE_ID, TREE_ID])
    const { app, world } = deployApp(repo, STAGES.nothing.readings, FAST, { store: hidden.store })
    expect(await plan(app, 409)).toEqual({ code: 'NOTHING_COMPOSED', error: NOTHING_COMPOSED })
    expect(world.methods).toEqual([])
  })

  it('the public is refused, as every members\' read', async () => {
    repo = await composedRepo()
    const reader = new SystemReader({ repo })
    const { withRequest } = await import('../../server/request.ts')
    const pub = createApp(repo, (a, ctx) => mountDeploy(a, { repo: repo!, systems: reader, withLock: ctx.withLock, privateStore: ctx.privateStore, notify: () => {}, driver: FAST }),
      { request: withRequest({ repo, hosted: true, membership: null }) })
    const res = await pub.request('/api/deploy')
    expect(res.status).toBe(401)
  })
})
