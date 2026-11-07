import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import { parse } from 'yaml'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git, SOLO } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { readRegistry } from '../../server/registry.ts'
import { baseOf } from '../../server/changes/canonical.ts'
import { parseTrailers } from '../../lib/trailers.mjs'
import { validateRepo } from '../../lib/data-validate.mjs'

// The seal where a change is decided (DAO-OS L1, Review Focus 1 and 5): a receipt staged with nulls is committed with
// who, the day, the decision and the hash of each record as committed. Every test builds a throwaway repository under the
// temp directory (makeChangeRepo), with synthetic members ana, bruno and carla (and bot, an agent), copied from
// proposals.ratify.test.ts. The clock is injected for the proposal routes, anchored near the real now.
const MEMBERS = `schema_version: "2.0"
members:
  - { id: ana, name: Ana, kind: person, handles: { git: ["ana@example.test"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
  - { id: carla, name: Carla, kind: person, handles: { git: ["carla@example.test"] } }
  - { id: bot, name: Bot, kind: agent, handles: { git: ["bot@example.test"] } }
`
// bruno decides; ana proposes. The rule covers the class records, which is the board's and the receipt's both
// (so the receipt's own class never changes the outcome asserted here).
const gov = (rule: string) =>
  `schema_version: "2.0"\ngovernance:\n  model: "consensus"\n  roles:\n    maintainer: { members: [bruno] }\n    member: { all: true }\n  rules:\n    ${rule}\n  decisions: []\n`
const APPROVE = gov('- { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }')

const FRAMEWORK = fileURLToPath(new URL('../../../../', import.meta.url))
/** A whole second two minutes before the real now: the clock the tests start from. */
const BASE = Math.floor(Date.now() / 1000) * 1000 - 120_000

const BOARD = { op: 'create', record: 'boards:desk', value: { name: 'Desk', layout: 'flow', blocks: [] } }
const RECEIPT = {
  op: 'create', record: 'library:board-desk',
  value: {
    entry: 'board:desk', version: '1.0.0', shelf: 'framework',
    created: [{ record: 'boards:desk', base: null }],
    status: 'installed', by: null, at: null, decision: null, removed: null,
  },
}
const RENAME = { op: 'update', record: 'boards:desk', set: { name: 'Front desk' } }

let repo: string
let app: Hono
let clock: Date
beforeEach(() => { clock = new Date(BASE) })
afterEach(() => removeFixtureRepo(repo))

/** The members and the rules in one commit, over a history with no rules yet, so validate:governance judges no
 *  fixture commit: only what the platform writes. */
function setup(governance: string) {
  repo = makeChangeRepo(null)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'governance.yaml'), governance)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: synthetic members and their rules"')
  app = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => clock }))
}
const as = (who: string) => { git(repo, `config user.email ${who}@example.test`) }
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const tick = (s = 60) => { clock = new Date(clock.getTime() + s * 1000) }
const sha = (rev = 'HEAD') => git(repo, `rev-parse ${rev}`).trim()
const day = (d: Date) => d.toISOString().slice(0, 10)
async function ok(res: Response, status = 200): Promise<Record<string, any>> {
  const body = await res.json()
  expect(res.status, JSON.stringify(body)).toBe(status)
  return body
}
const stage = async (ops: unknown[]) => ok(await app.request('/api/changes/ops', json({ ops })))
const board = () => readRegistry(repo, 'boards').entries!.find(e => e.id === 'desk')!
const receiptOp = (ops: { record: string }[]) => ops.find(o => o.record === 'library:board-desk') as unknown as { value: Record<string, any> }
const errorsOf = () => validateRepo(repo).filter((p: { level: string }) => p.level === 'error')

describe('Apply seals the receipt (Review Focus 1: an add edited in the tray)', () => {
  it('one commit holds the board and its receipt, decided by the rule and the change, and hashing the board as committed', async () => {
    setup(SOLO)
    as('bruno')
    await stage([BOARD, RECEIPT])
    await stage([RENAME])
    const T = sha()
    const before = day(new Date())
    const applied = await ok(await app.request('/api/changes/apply', json({})))
    const after = day(new Date())

    // one commit, on the trunk's tip, writing the board and the receipt and nothing else
    expect(applied.commit).toBe(sha())
    expect(sha('HEAD^')).toBe(T)
    expect(git(repo, `diff --name-only ${T} HEAD`).trim().split('\n').sort()).toEqual(['data/boards.yaml', 'data/library.yaml'])

    const trailers = parseTrailers(git(repo, 'log -1 --format=%B'))
    expect(trailers.actor).toBe('bruno')
    expect(trailers.rule).toBeTruthy()
    expect(trailers.change).toMatch(/^chg_/)
    const receipt = parse(git(repo, 'show HEAD:data/library.yaml')).installed[0]
    expect(receipt).toMatchObject({ id: 'board-desk', by: 'bruno', status: 'installed', removed: null })
    expect(receipt.decision).toEqual({ rule: trailers.rule, change: trailers.change })
    expect([before, after]).toContain(receipt.at)

    // the base is the board as read back from the file: renamed, so an immediate removal reads it "as added"
    expect(board().name).toBe('Front desk')
    expect(receipt.created).toEqual([{ record: 'boards:desk', base: baseOf(board()) }])
    expect(receipt.created[0].base).not.toBe(baseOf({ id: 'desk', ...BOARD.value }))
    expect(errorsOf()).toEqual([])
  })
})

describe('Propose seals the receipt with the proposal (Review Focus 5)', () => {
  async function proposeAdd(): Promise<string> {
    as('ana')
    await stage([BOARD, RECEIPT])
    return String((await ok(await app.request('/api/proposals', json({ title: 'Add the desk board' })), 201)).id)
  }
  const entry = (id: string) => readLedger(repo).entries.find(e => String(e.id) === id)!

  it('propose → approve → ratify: the merge holds the ledger receipt byte for byte, the row names the proposal, and validate:governance --strict passes', async () => {
    setup(APPROVE)
    const id = await proposeAdd()
    const proposed = entry(id).ops as unknown as { record: string; value: Record<string, any> }[]
    const boardOp = proposed.find(o => o.record === 'boards:desk')!
    const sealed = receiptOp(proposed).value
    expect(sealed).toMatchObject({ by: 'ana', at: day(clock), decision: { proposal: id }, status: 'installed', removed: null })
    expect(sealed.decision).toEqual({ proposal: id })
    expect(sealed.created).toEqual([{ record: 'boards:desk', base: baseOf(boardOp.value) }])

    tick(); as('bruno')
    await ok(await app.request(`/api/proposals/${id}/events`, json({ kind: 'approve' })))
    tick()
    await ok(await app.request(`/api/proposals/${id}/ratify`, json({})))

    const merged = parse(git(repo, 'show HEAD:data/library.yaml')).installed
    expect(merged).toEqual([sealed])
    expect(merged[0].created[0].base).toBe(baseOf(board()))
    const rows = parse(git(repo, 'show HEAD:data/governance.yaml')).governance.decisions
    expect(rows.filter((r: { proposal?: string }) => r.proposal === id)).toHaveLength(1)

    const run = spawnSync(process.execPath, ['scripts/validate-governance.mjs', repo, '--strict'], { cwd: FRAMEWORK, encoding: 'utf8' })
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(errorsOf()).toEqual([])
  })

  it('Revise seals again: the board renamed, the receipt holds the new base and the same proposal', async () => {
    setup(APPROVE)
    const id = await proposeAdd()
    const first = receiptOp(entry(id).ops as unknown as { record: string }[]).value
    tick()
    // the author loads the proposal into the tray, renames the board there, and sends the tray back
    const loaded = await ok(await app.request(`/api/proposals/${id}/load`, json({})))
    expect(loaded.revises).toBe(id)
    const tray = await stage([RENAME])
    await ok(await app.request(`/api/proposals/${id}/revise`, json({ ops: tray.ops })))

    const revised = entry(id).ops as unknown as { record: string; value: Record<string, any> }[]
    const boardOp = revised.find(o => o.record === 'boards:desk')!
    expect(boardOp.value.name).toBe('Front desk')
    const again = receiptOp(revised).value
    expect(again.decision).toEqual({ proposal: id })
    expect(again.by).toBe('ana')
    expect(again.created).toEqual([{ record: 'boards:desk', base: baseOf(boardOp.value) }])
    expect(again.created[0].base).not.toBe(first.created[0].base)
  })

  it('Revise seals with the day it was proposed (R-6): a day later, unchanged is refused UNCHANGED; renamed, it keeps the original at', async () => {
    setup(APPROVE)
    const id = await proposeAdd()
    const proposedOn = day(clock)
    expect(receiptOp(entry(id).ops as unknown as { record: string }[]).value.at).toBe(proposedOn)
    tick(86_400)
    expect(day(clock)).not.toBe(proposedOn)

    const loaded = await ok(await app.request(`/api/proposals/${id}/load`, json({})))
    const unchanged = await ok(await app.request(`/api/proposals/${id}/revise`, json({ ops: loaded.ops })), 409)
    expect(unchanged.code).toBe('UNCHANGED')

    const tray = await stage([RENAME])
    await ok(await app.request(`/api/proposals/${id}/revise`, json({ ops: tray.ops })))
    const revised = entry(id).ops as unknown as { record: string; value: Record<string, any> }[]
    expect(revised.find(o => o.record === 'boards:desk')!.value.name).toBe('Front desk')
    expect(receiptOp(revised).value.at).toBe(proposedOn)
  })
})
