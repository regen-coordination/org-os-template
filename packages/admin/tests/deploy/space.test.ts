// DAO-OS L7 Task 13 through the routes (spec §8.2 step 8, §8.4, §9): a composed Snapshot space is step 8 of the plan,
// prepared as settings and links; the testnet hub is only ever asked a query (nothing is posted), and a space the hub
// returns with the composed name, network and strategies reads back deployed and flips live. Throwaway repositories;
// the chain is the recorded node, the hub a recorded answer (fixtures/hub.ts). No network.
import { describe, it, expect, afterEach } from 'vitest'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { readRegistry } from '../../server/registry.ts'
import { validateRepo } from '../../lib/data-validate.mjs'
import { checksumAddress } from '../../lib/caip.mjs'
import { DEPLOYMENTS } from '../../lib/deployments.mjs'
import { COUNCIL, RPC_HOST, SEPOLIA, SPACE_RECORD, STAGES } from './fixtures/readings.ts'
import { DEPLOY_DRIVER } from '../../server/deploy/prepare.ts'
import { spaceDiffers } from '../../lib/deploy/space.mjs'
import { NOTHING_COMPOSED, TESTNET_HUB_HOST, commitSystems, composedRepo, deployApp, json } from './fixtures/hub.ts'

let repo: string | undefined
afterEach(() => { if (repo) removeFixtureRepo(repo); repo = undefined })

const SPACE_ID = 'test-dao-votes'
const call = async (app: Hono, path: string, method = 'GET', body?: unknown) => {
  const res = await app.request(path, method === 'GET' ? undefined : json(method, body ?? {}))
  return { status: res.status, body: await res.json() as Record<string, any> }
}
const spaceStep = (plan: Record<string, any>) => plan.steps.find((s: { id: string }) => s.id === 'space:settings')
const PASTED = {
  id: 'test-dao.eth', name: 'Test DAO', network: '11155111', symbol: 'VOTE',
  strategies: [{ name: 'erc1155-balance-of', network: '11155111', params: { symbol: 'VOTE', address: checksumAddress(DEPLOYMENTS[SEPOLIA]!.hats.address), tokenId: BigInt(COUNCIL).toString(), decimals: 0 } }],
  filters: { minScore: 0, onlyMembers: true },
  voting: { delay: 0, period: 259200, quorum: 0, type: null },
  admins: [],
}

async function spaceRepo(): Promise<string> {
  const r = await composedRepo()
  commitSystems(r, [SPACE_RECORD])
  return r
}

describe('the Snapshot space in GET /api/deploy (L7 Task 13)', () => {
  it('waits for the council hat, then is ready with the settings and links; the hub is only asked a query', async () => {
    repo = await spaceRepo()
    const { app, world } = deployApp(repo, STAGES.top.readings)
    const before = await call(app, '/api/deploy')
    expect(before.status, JSON.stringify(before.body)).toBe(200)
    expect(before.body.composed).toContain(SPACE_ID)
    expect(spaceStep(before.body)).toMatchObject({ system: SPACE_ID, title: 'The Snapshot space', status: 'waits', signer: { kind: 'account' } })

    world.node = STAGES.hats.readings
    const ready = spaceStep((await call(app, '/api/deploy')).body)
    expect(ready.status).toBe('ready')
    expect(ready.step).toBeUndefined() // nothing to sign: settings to paste
    expect(ready.draft.settings.strategies[0].params.tokenId).toBe(BigInt(COUNCIL).toString())
    expect(ready.draft.links.create).toBe('https://testnet.snapshot.box/#/create')
    expect(ready.link).toBe('https://testnet.snapshot.box/#/create')

    expect(world.hub.length).toBeGreaterThan(0)
    for (const body of world.hub) {
      expect(body.query.trimStart().startsWith('query ')).toBe(true)
      expect(body.query).not.toMatch(/mutation/i)
      expect(body.variables).toEqual({ s: 'test-dao.eth' })
    }
  })
})

describe('the Snapshot space in POST /api/deploy/read-back (L7 Task 13)', () => {
  it('a space the hub returns as composed reads back deployed and flips live beside the Safe and the tree; applied, nothing is composed', async () => {
    repo = await spaceRepo()
    const { app, world } = deployApp(repo, STAGES.all.readings)
    world.space = PASTED
    const { status, body } = await call(app, '/api/deploy/read-back', 'POST', {})
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body.readBack.systems.find((x: { id: string }) => x.id === SPACE_ID)).toEqual({
      id: SPACE_ID, status: 'deployed', found: { space: 'https://testnet.snapshot.box/#/s:test-dao.eth' }, differs: [],
    })
    const op = body.staged.find((o: { record: string }) => o.record === `systems:${SPACE_ID}`)
    expect(op.set.deployment).toMatchObject({ status: 'deployed', network: SEPOLIA })
    expect(op.set.deployment.read_back).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(body.staged.some((o: { record: string }) => o.record === 'governance:governance')).toBe(true)

    const applied = await call(app, '/api/changes/apply', 'POST', {})
    expect(applied.status, JSON.stringify(applied.body)).toBe(200)
    expect(validateRepo(repo).filter((p: { level: string }) => p.level === 'error')).toEqual([])
    const space = (readRegistry(repo, 'systems').entries as Record<string, any>[]).find(x => x.id === SPACE_ID)!
    expect(space.deployment.status).toBe('deployed')
    expect(await call(app, '/api/deploy')).toEqual({ status: 409, body: { code: 'NOTHING_COMPOSED', error: NOTHING_COMPOSED } })
  })

  it('a space not on the hub yet stays pending and does not hold back the Safe, the tree or the governance', async () => {
    repo = await spaceRepo()
    const { app } = deployApp(repo, STAGES.all.readings)
    const { status, body } = await call(app, '/api/deploy/read-back', 'POST', {})
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body.readBack.systems.find((x: { id: string }) => x.id === SPACE_ID).status).toBe('pending')
    expect(body.staged.map((o: { record: string }) => o.record).sort()).toEqual(['governance:governance', 'systems:test-dao-roles', 'systems:test-dao-safe'])
  })

  it('a space the hub holds otherwise is a mismatch: nothing staged', async () => {
    repo = await spaceRepo()
    const hub = deployApp(repo, STAGES.all.readings)
    hub.world.space = { ...PASTED, name: 'Other DAO' }
    const { status, body } = await call(hub.app, '/api/deploy/read-back', 'POST', {})
    expect(status, JSON.stringify(body)).toBe(409)
    expect(body.code).toBe('MISMATCH')
    expect(body.error).toContain('the space on the Snapshot hub is named "Other DAO", not "Test DAO"')
  })

  // final L7 review M-1: who may propose and how the space votes are part of the match, not only its name and strategies
  it('a space that lets anyone propose is a mismatch: nothing staged', async () => {
    repo = await spaceRepo()
    const hub = deployApp(repo, STAGES.all.readings)
    hub.world.space = { ...PASTED, filters: { minScore: 0, onlyMembers: false } }
    const { status, body } = await call(hub.app, '/api/deploy/read-back', 'POST', {})
    expect(status, JSON.stringify(body)).toBe(409)
    expect(body.code).toBe('MISMATCH')
    expect(body.error).toContain('the space lets anyone propose, not only its members')
    expect((await call(hub.app, '/api/changes')).body.ops).toEqual([])
  })

  it('the deploy reads declare the testnet hub beside the node, and nothing else', () => {
    expect(DEPLOY_DRIVER.hosts).toEqual([RPC_HOST, TESTNET_HUB_HOST])
  })
})

// final L7 review M-1: spaceDiffers compares the filters the draft always sets (onlyMembers, minScore), and the admins
// and voting where the draft sets them.
describe('spaceDiffers: filters, admins and voting (final review M-1)', () => {
  const STRATEGY = PASTED.strategies[0]!
  const draft = (settings: Record<string, unknown> = {}) => ({
    network: SEPOLIA, space: 'test-dao.eth', links: { name: '', create: '', space: '' },
    settings: { name: 'Test DAO', network: '11155111', symbol: 'VOTE', strategies: [STRATEGY], filters: { onlyMembers: true, minScore: 0 }, ...settings },
  })
  const found = (o: Record<string, unknown> = {}) => ({ name: 'Test DAO', network: '11155111', strategies: [STRATEGY], filters: { minScore: 0, onlyMembers: true }, ...o })

  it('matches when the filters are the draft\'s and it sets no admins or voting', () => {
    expect(spaceDiffers(draft() as never, found() as never)).toEqual([])
  })

  it('a space that lets anyone propose, or reads no filters, is a mismatch', () => {
    expect(spaceDiffers(draft() as never, found({ filters: { minScore: 0, onlyMembers: false } }) as never)).toEqual(['the space lets anyone propose, not only its members'])
    expect(spaceDiffers(draft() as never, found({ filters: undefined }) as never)).toEqual(['the space lets anyone propose, not only its members'])
  })

  it('another minimum score is a mismatch', () => {
    expect(spaceDiffers(draft() as never, found({ filters: { minScore: 5, onlyMembers: true } }) as never)).toEqual(['the space asks a proposer for a score of 5, not 0'])
  })

  it('the admins are compared where the draft sets them, in any order and case', () => {
    const a = '0x00000000000000000000000000000000000000A1'
    const b = '0x00000000000000000000000000000000000000A2'
    expect(spaceDiffers(draft() as never, found({ admins: [a] }) as never)).toEqual([])
    expect(spaceDiffers(draft({ admins: [a, b] }) as never, found({ admins: [b.toLowerCase(), a] }) as never)).toEqual([])
    expect(spaceDiffers(draft({ admins: [a] }) as never, found({ admins: [a, b] }) as never)).toEqual([`the space's admins are ${a}, ${b}, not ${a}`])
    expect(spaceDiffers(draft({ admins: [a] }) as never, found() as never)).toEqual([`the space's admins are none, not ${a}`])
  })

  it('the voting is compared key by key where the draft sets it', () => {
    const voting = { delay: 0, period: 259200, quorum: 0 }
    expect(spaceDiffers(draft() as never, found({ voting: { delay: 3600, period: 1, quorum: 9 } }) as never)).toEqual([])
    expect(spaceDiffers(draft({ voting }) as never, found({ voting: { ...voting, type: null } }) as never)).toEqual([])
    expect(spaceDiffers(draft({ voting }) as never, found({ voting: { delay: null, period: 259200, quorum: null } }) as never)).toEqual([])
    expect(spaceDiffers(draft({ voting }) as never, found({ voting: { delay: 0, period: 3600, quorum: 0 } }) as never)).toEqual(["the space's voting period is 3600, not 259200"])
    expect(spaceDiffers(draft({ voting: { ...voting, type: 'single-choice' } }) as never, found({ voting: { ...voting, type: 'approval' } }) as never))
      .toEqual(["the space's voting type is approval, not single-choice"])
    expect(spaceDiffers(draft({ voting }) as never, found() as never)).toEqual(["the space's voting period is none, not 259200"])
  })
})
