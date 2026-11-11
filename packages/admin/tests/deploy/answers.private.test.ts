// The gaps review's I-4 (Rule 4, PF-R226): every answer of GET /api/deploy and POST /api/deploy/read-back says to a
// viewer not admitted to `systems.address` nothing the policy keeps from them: no predicted Safe or gate address, hat
// id or tree, no Safe signer account, Safe-app link or prepared call naming them, no `differs` naming what the chain
// shows; a step whose every reading is hidden still shows as a step with its status. The plan, the 200, MISMATCH, the
// 409s and the 422 are each asked. An actor admitted to it is told the plan as it is. Every test builds a throwaway
// repository and private store; the chain is the recorded node of fixtures/readings.ts (no network).
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { git } from '../changes/fixtures.ts'
import { prettyHatId } from '../../lib/hats.mjs'
import type { PrivateStore } from '../../server/private/store.ts'
import { COUNCIL, GATE, SAFE, STAGES, TOP } from './fixtures/readings.ts'
import { FAST, NOT_ADMITTED_FLIP, SAFE_ID, TREE_ID, composedRepo, deployApp, grantOps, json, restrictInStore } from './fixtures/hub.ts'

let repo: string | undefined
let kept: { store: PrivateStore; done: () => void } | undefined
afterEach(() => { kept?.done(); kept = undefined; if (repo) removeFixtureRepo(repo); repo = undefined })

async function call(app: Hono, path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const res = await app.request(path, method === 'GET' ? undefined : json(method, body ?? {}))
  return { status: res.status, body: await res.json() }
}
const readBackNow = (app: Hono) => call(app, '/api/deploy/read-back', 'POST', {})

/** Every value the deployment predicts or finds for the composition: its Safe, its gate, its top hat and council hat. */
const HIDDEN = [SAFE, GATE, TOP, COUNCIL].map(h => h.toLowerCase().slice(2))
function saysNothingKept(body: unknown): void {
  const text = JSON.stringify(body).toLowerCase()
  for (const h of HIDDEN) expect(text).not.toContain(h)
  expect(text).not.toContain(prettyHatId(TOP).toLowerCase())
  expect(text).not.toMatch(/app\.safe\.global|"account":"eip155/)
}
/** Each System's read-back row: its id and status, nothing found, nothing it differs by. */
const bare = (body: Record<string, any>) => body.readBack.systems.map((x: Record<string, unknown>) => ({ id: x.id, found: x.found, differs: x.differs }))

/** The test council composed and applied; data/visibility.yaml keeps `systems.address` at role:ops; `admitted`: bruno
 *  holds ops. */
async function hub(stage: keyof typeof STAGES, o: { admitted?: boolean; before?: (r: string) => void } = {}) {
  repo = await composedRepo()
  if (o.admitted) grantOps(repo)
  o.before?.(repo)
  kept = await restrictInStore(repo, ['address'])
  return deployApp(repo, STAGES[stage].readings, FAST, { store: kept.store }).app
}

describe('GET /api/deploy to a viewer not admitted to systems.address (I-4)', () => {
  for (const stage of ['nothing', 'hats', 'all'] as const) {
    it(`at "${stage}": every step shows with its status and no values`, async () => {
      const { status, body } = await call(await hub(stage), '/api/deploy')
      expect(status, JSON.stringify(body)).toBe(200)
      expect(body.steps.length).toBeGreaterThan(0)
      for (const st of body.steps) {
        expect(st).toMatchObject({ id: expect.any(String), system: expect.any(String), status: expect.any(String), predicts: [] })
        expect(st.step ?? null).toBeNull()
        expect(st.link ?? null).toBeNull()
        expect(st.differs ?? null).toBeNull()
      }
      saysNothingKept(body)
    })
  }

  it('an actor admitted to it is told the plan as it is', async () => {
    const { status, body } = await call(await hub('hats', { admitted: true }), '/api/deploy')
    expect(status, JSON.stringify(body)).toBe(200)
    expect(JSON.stringify(body).toLowerCase()).toContain(SAFE.toLowerCase().slice(2))
    expect(body.steps.some((s: { predicts: unknown[] }) => s.predicts.length > 0)).toBe(true)
  })
})

describe('POST /api/deploy/read-back to a viewer not admitted to systems.address (I-4)', () => {
  it('200 with nothing new staged: the Safe pending, nothing found said', async () => {
    const { status, body } = await readBackNow(await hub('safe'))
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body.staged).toEqual([])
    expect(bare(body)).toEqual([{ id: SAFE_ID, found: {}, differs: [] }, { id: TREE_ID, found: {}, differs: [] }])
    saysNothingKept(body)
  })

  it('409 MISMATCH: the System named, nothing the chain shows said', async () => {
    const { status, body } = await readBackNow(await hub('taken'))
    expect(status, JSON.stringify(body)).toBe(409)
    expect(body.code).toBe('MISMATCH')
    expect(body.error).toBe(`Not staged: ${TREE_ID}: the chain shows something other than what was composed.`)
    expect(body.readBack.systems.find((x: { id: string }) => x.id === TREE_ID)).toEqual({ id: TREE_ID, status: 'mismatch', found: {}, differs: [] })
    expect(JSON.stringify(body)).not.toMatch(/worn by/)
    saysNothingKept(body)
  })

  it('409 NOT_ADMITTED: no gate, top hat or hat said beside the kept address', async () => {
    const { status, body } = await readBackNow(await hub('all'))
    expect(status, JSON.stringify(body)).toBe(409)
    expect([body.code, body.error]).toEqual(['NOT_ADMITTED', NOT_ADMITTED_FLIP])
    expect(bare(body)).toEqual([{ id: SAFE_ID, found: {}, differs: [] }, { id: TREE_ID, found: {}, differs: [] }])
    saysNothingKept(body)
  })

  it('409 CHANGE_EDITS: the same', async () => {
    const app = await hub('hats')
    const staged = await call(app, '/api/changes/ops', 'POST', { ops: [{ op: 'update', record: `systems:${TREE_ID}`, set: { notes: 'Council roles.', deployment: { status: 'composed', salt: '1' } } }] })
    expect(staged.status, JSON.stringify(staged.body)).toBe(200)
    const { status, body } = await readBackNow(app)
    expect(status, JSON.stringify(body)).toBe(409)
    expect(body.code).toBe('CHANGE_EDITS')
    expect(bare(body).every((x: { found: object }) => Object.keys(x.found).length === 0)).toBe(true)
    saysNothingKept(body)
  })

  it('422 (the lockout): no top hat, hat or tree said beside a redacted tree', async () => {
    const app = await hub('all', {
      before: r => {
        writeFileSync(join(r, 'data', 'governance.yaml'), `schema_version: "2.0"
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
        const members = readFileSync(join(r, 'data', 'members.yaml'), 'utf8')
          .replace('    joined: "2025-02-01"\n', '    joined: "2025-02-01"\n    handles:\n      wallet: "eip155:1:0x00000000000000000000000000000000000000a5"\n')
        writeFileSync(join(r, 'data', 'members.yaml'), members)
        git(r, 'add data/governance.yaml data/members.yaml')
        git(r, 'commit -qm "fixture: the only proposer has a wallet on another chain"')
      },
    })
    const { status, body } = await readBackNow(app)
    expect(status, JSON.stringify(body)).toBe(422)
    expect(body.errors.map((e: { message: string }) => e.message).join(' ')).toMatch(/nobody can propose/)
    expect(bare(body)).toEqual([{ id: SAFE_ID, found: {}, differs: [] }, { id: TREE_ID, found: {}, differs: [] }])
    saysNothingKept(body)
  })
})
