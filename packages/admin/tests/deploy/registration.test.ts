// DAO-OS L7 Task 14 through the routes (spec §8.2 step 9, §8.5, §9): a composed daoURI registration is step 9 of the
// plan, `setText` on the ENS name's resolver, prepared for the name's owner (an account step: the Hub never signs);
// once the text record reads identity.daoURI it reads back deployed and flips live. Throwaway repositories; the chain
// is the recorded node with the ENS answers of fixtures/readings.ts `withEns`. No network.
import { describe, it, expect, afterEach } from 'vitest'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { readRegistry } from '../../server/registry.ts'
import { validateRepo } from '../../lib/data-validate.mjs'
import { checksumAddress } from '../../lib/caip.mjs'
import { namehash } from '../../lib/ens.mjs'
import { REGISTRATION_RECORD, RESOLVER, SEPOLIA, STAGES, withEns } from './fixtures/readings.ts'
import { commitSystems, composedRepo, deployApp, json } from './fixtures/hub.ts'

let repo: string | undefined
afterEach(() => { if (repo) removeFixtureRepo(repo); repo = undefined })

const REG_ID = 'test-dao-registration'
const URI = 'https://dao.example.org/.well-known/dao.json'
const call = async (app: Hono, path: string, method = 'GET', body?: unknown) => {
  const res = await app.request(path, method === 'GET' ? undefined : json(method, body ?? {}))
  return { status: res.status, body: await res.json() as Record<string, any> }
}
const regStep = (plan: Record<string, any>) => plan.steps.find((s: { id: string }) => s.id === 'registration:daouri')

async function regRepo(daoURI: string | null = URI): Promise<string> {
  const r = await composedRepo()
  commitSystems(r, [REGISTRATION_RECORD], daoURI ? { daoURI } : undefined)
  return r
}

describe('Register the daoURI in GET /api/deploy (L7 Task 14)', () => {
  it('is an account step to the name\'s resolver, with the explorer link; the reads are eth_call only', async () => {
    repo = await regRepo()
    const { app, world } = deployApp(repo, withEns(STAGES.nothing.readings))
    const { status, body } = await call(app, '/api/deploy')
    expect(status, JSON.stringify(body)).toBe(200)
    const s = regStep(body)
    expect(s).toMatchObject({ system: REG_ID, title: 'Register the daoURI', status: 'ready', signer: { kind: 'account' } })
    expect(s.step.call.to).toBe(`${SEPOLIA}:${checksumAddress(RESOLVER)}`)
    expect(s.step.signer).toEqual({ kind: 'account', account: '' })
    expect(s.link).toBe(`https://eth-sepolia.blockscout.com/address/${checksumAddress(RESOLVER)}`)
    expect(new Set(world.methods)).toEqual(new Set(['eth_blockNumber', 'eth_call', 'eth_getCode']))
  })

  it('waits for identity.daoURI when federation.yaml has none', async () => {
    repo = await regRepo(null)
    const { app } = deployApp(repo, withEns(STAGES.nothing.readings))
    expect(regStep((await call(app, '/api/deploy')).body).waits).toBe('Waits for identity.daoURI in federation.yaml: the address the name registers.')
  })

  // fix M-1 (Tasks 13/14 review): the node findResolver answers is the name's namehash, or nothing of it is proven
  it('waits, in words, when findResolver answers another node than the name\'s namehash', async () => {
    repo = await regRepo()
    const other = `0x${'11'.repeat(32)}`
    const { app } = deployApp(repo, withEns(STAGES.nothing.readings, { node: other }))
    const s = regStep((await call(app, '/api/deploy')).body)
    expect(s.status).toBe('waits')
    expect(s.waits).toBe(`Waits for the ENS name to be read: the Universal Resolver answered the node ${other} for test-dao.eth, not its namehash ${namehash('test-dao.eth')}`)
  })

  // final L7 review M-2: a daouri text that cannot be decoded is the read's error (step 9 waits), never "no text"
  for (const [what, answer] of [['an answer that is not (bytes, address)', '0xdeadbeef'], ['bytes that are not a string', `0x${'00'.repeat(31)}40${'00'.repeat(12)}${'e5'.padStart(40, '0')}${'00'.repeat(31)}02abcd${'00'.repeat(30)}`]] as const) {
    it(`waits, in words, when the daouri text cannot be decoded (${what}); the read-back keeps it pending`, async () => {
      repo = await regRepo()
      const { app } = deployApp(repo, withEns(STAGES.all.readings, { textAnswer: answer }))
      const s = regStep((await call(app, '/api/deploy')).body)
      expect(s.status).toBe('waits')
      expect(s.waits).toBe('Waits for the ENS name to be read: the daouri text record of test-dao.eth could not be decoded')
      const rb = await call(app, '/api/deploy/read-back', 'POST', {})
      expect(rb.status, JSON.stringify(rb.body)).toBe(200)
      expect(rb.body.readBack.systems.find((x: { id: string }) => x.id === REG_ID).status).toBe('pending')
    })
  }

  it('waits on a resolver that takes no text records, with the plan\'s sentence', async () => {
    repo = await regRepo()
    const { app } = deployApp(repo, withEns(STAGES.nothing.readings, { takesText: false }))
    expect(regStep((await call(app, '/api/deploy')).body).waits).toBe('This name\'s resolver does not take text records; set daouri in the ENS app.')
  })
})

describe('Register the daoURI in POST /api/deploy/read-back (L7 Task 14)', () => {
  it('a text record equal to identity.daoURI reads back deployed and flips live, with its chain; applied, it validates', async () => {
    repo = await regRepo()
    const { app } = deployApp(repo, withEns(STAGES.all.readings, { text: URI }))
    const { status, body } = await call(app, '/api/deploy/read-back', 'POST', {})
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body.readBack.systems.find((x: { id: string }) => x.id === REG_ID)).toEqual({ id: REG_ID, status: 'deployed', found: { text: URI }, differs: [] })
    const op = body.staged.find((o: { record: string }) => o.record === `systems:${REG_ID}`)
    expect(op.set).toMatchObject({ chain: SEPOLIA, deployment: { status: 'deployed' } })
    const applied = await call(app, '/api/changes/apply', 'POST', {})
    expect(applied.status, JSON.stringify(applied.body)).toBe(200)
    expect(validateRepo(repo).filter((p: { level: string }) => p.level === 'error')).toEqual([])
    const reg = (readRegistry(repo, 'systems').entries as Record<string, any>[]).find(x => x.id === REG_ID)!
    expect(reg).toMatchObject({ ens: 'test-dao.eth', chain: SEPOLIA, deployment: { status: 'deployed' } })
  })

  it('another text stays pending, never a mismatch, and holds nothing else back', async () => {
    repo = await regRepo()
    const { app } = deployApp(repo, withEns(STAGES.all.readings, { text: 'https://elsewhere.example.org/dao.json' }))
    const { status, body } = await call(app, '/api/deploy/read-back', 'POST', {})
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body.readBack.systems.find((x: { id: string }) => x.id === REG_ID).status).toBe('pending')
    expect(body.staged.map((o: { record: string }) => o.record).sort()).toEqual(['governance:governance', 'systems:test-dao-roles', 'systems:test-dao-safe'])
  })
})
