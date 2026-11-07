import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { createEntry, readLedger } from '../../server/proposals/ledger.ts'
import { SystemReader } from '../../server/systems/reader.ts'
import { safe } from '../../server/systems/safe.ts'
import { hatsTree, HATS_ACTIONS } from '../../server/systems/hats.ts'
import { snapshotSpace } from '../../server/systems/snapshot.ts'
import { link } from '../../server/systems/link.ts'
import type { FetchLike, ForeignRef } from '../../server/systems/driver.ts'
import { revOf } from '../../lib/proposals.mjs'
import { topHatId, childHatId, hatRef, VIEW_HAT_TYPES } from '../../lib/hats.mjs'
import { encodeArgs, selector } from '../../lib/abi.mjs'
import { checksumAddress } from '../../lib/caip.mjs'
import { safeTxHash } from '../../lib/safe-tx.mjs'

// A proposal that waits on a driver other than a Safe (DAO-OS L2, Task 12; rulings K1–K3): a Snapshot vote, a hat, and
// the typed actions prepared from a proposal's page. Every test builds a throwaway repository (makeChangeRepo) with
// synthetic members ana, bruno and carla, a synthetic Snapshot space (example-dao.eth, the Task 9 fixtures' shape), the
// synthetic Hats tree 13 on Celo (Task 8's fake contract), a synthetic Safe (Task 4's Celo fixture, nonce 9) and a link.
// The routes get a real SystemReader over one fake fetch; nothing touches the network.

const CELO = 'eip155:42220'
const SAFE_ADDR = '0x5aFE00000000000000000000000000000000C0De'
const HATS = '0x3bc1A0Ad72417f2d411118085256fC53CBdDd137'
const ZERO = '0x0000000000000000000000000000000000000000'
const A = (n: number) => `0x${'0'.repeat(38)}a${n}`
const TOP = topHatId(13), C1 = childHatId(TOP, 1)
const VOTE = `0x${'4'.repeat(64)}`
const POOL = '0x00000000000000000000000000000000000000b0'
const SAFE_INFO = (JSON.parse(readFileSync(new URL('../systems/fixtures/safe-chains/celo.json', import.meta.url), 'utf8')) as { info: Record<string, unknown> }).info
const PASSED = (JSON.parse(readFileSync(new URL('../systems/fixtures/snapshot/proposal-passed.json', import.meta.url), 'utf8')) as { data: { proposal: Record<string, unknown> } }).data.proposal

const MEMBERS = `schema_version: "2.0"
members:
  - { id: ana, name: Ana, kind: person, handles: { git: ["ana@example.test"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
  - { id: carla, name: Carla, kind: person, handles: { git: ["carla@example.test"] } }
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: dao-votes, kind: snapshot-space, name: Votes, url: "https://snapshot.box/#/s:example-dao.eth", driver: snapshot-space }
  - { id: dao-hats, kind: hats-tree, name: Roles, chain: "${CELO}", address: "13", driver: hats-tree }
  - { id: treasury, kind: safe, name: Treasury, chain: "${CELO}", address: "${SAFE_ADDR}", driver: safe }
  - { id: forum, kind: link, name: Forum, url: "https://forum.example.test", driver: link }
  - { id: grants-pool, kind: gardens-pool, name: Grants pool, chain: "${CELO}", address: "${POOL}", driver: gardens-pool }
`
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    member: { all: true }
  rules:
    - { id: votes, applies_to: [records], propose: member, decide: { by: system, system: dao-votes, passes: { choice: "For" } } }
    - { id: roles, applies_to: [governance], propose: member, decide: { by: system, system: dao-hats } }
    - { id: pay, applies_to: [treasury], propose: member, decide: { by: system, system: treasury } }
    - { id: talk, applies_to: [identity], propose: member, decide: { by: system, system: forum } }
    - { id: unnamed, applies_to: [operations], propose: member, decide: { by: system, system: dao-votes } }
    - { id: grants, applies_to: [members], propose: member, decide: { by: system, system: grants-pool } }
  decisions: []
`
const rule = (id: string, cls: string, system: string, extra: Record<string, unknown> = {}) =>
  ({ id, applies_to: [cls], propose: 'member', decide: { by: 'system', method: 'system', system, ...extra } })
const VOTES = rule('votes', 'records', 'dao-votes', { passes: { choice: 'For' } })
const ROLES = rule('roles', 'governance', 'dao-hats')
const PAY = rule('pay', 'treasury', 'treasury')
const TALK = rule('talk', 'identity', 'forum')
const UNNAMED = rule('unnamed', 'operations', 'dao-votes')
const GRANTS = rule('grants', 'members', 'grants-pool')

const NOW = new Date('2026-10-29T12:00:00Z')
const P1 = 'p-2026-10-29-001', P2 = 'p-2026-10-29-002'

let repo: string
let app: Hono
let clock: Date
/** What the fake chain says: "<address lowercase>|<hat id>" pairs. */
let wears: Set<string>
let admins: Set<string>
/** Every request the fake answered. */
let seen: { method: string; url: string }[]

const word = (data: string, i: number) => data.slice(10 + 64 * i, 74 + 64 * i)
const yes = (b: boolean) => '0x' + (b ? '1' : '0').padStart(64, '0')
function hatsAnswer(data: string): string | null {
  const sel = data.slice(0, 10)
  const id = (i: number) => '0x' + word(data, i), addr = (i: number) => '0x' + word(data, i).slice(24)
  if (sel === selector('viewHat(uint256)')) {
    return id(0) === C1
      ? encodeArgs(VIEW_HAT_TYPES, ['Stewards', 5, 2, `0x${'0'.repeat(38)}70`, `0x${'0'.repeat(38)}71`, '', 0, true, true])
      : encodeArgs(VIEW_HAT_TYPES, ['', 0, 0, ZERO, ZERO, '', 0, false, true])
  }
  if (sel === selector('isWearerOfHat(address,uint256)')) return yes(wears.has(`${addr(0)}|${id(1)}`))
  if (sel === selector('isEligible(address,uint256)')) return yes(true)
  if (sel === selector('isAdminOfHat(address,uint256)')) return yes(admins.has(`${addr(0)}|${id(1)}`))
  return null
}
const fetch: FetchLike = async (url, init) => {
  seen.push({ method: init.method, url })
  if (init.method === 'GET') {
    return url === `https://api.safe.global/tx-service/celo/api/v1/safes/${SAFE_ADDR}/`
      ? { ok: true, status: 200, json: async () => SAFE_INFO } : { ok: false, status: 404, json: async () => ({ detail: 'Not found.' }) }
  }
  const body = JSON.parse(init.body!)
  if (url === 'https://hub.snapshot.org/graphql') {
    // The vote was posted an hour after the proposals opened, and closed with For ahead.
    const created = Math.floor(NOW.getTime() / 1000) + 3600
    return { ok: true, status: 200, json: async () => ({ data: { proposal: body.variables.id === VOTE ? { ...PASSED, created } : null } }) }
  }
  const replies = (body as { id: number; method: string; params: [{ to: string; data: string }] }[]).map(r => {
    if (r.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: r.id, result: '0x4d9410e' }
    const hit = r.params[0].to.toLowerCase() === HATS.toLowerCase() ? hatsAnswer(r.params[0].data) : null
    return hit === null ? { jsonrpc: '2.0', id: r.id, error: { code: 3, message: 'execution reverted' } } : { jsonrpc: '2.0', id: r.id, result: hit }
  })
  return { ok: true, status: 200, json: async () => replies }
}

async function open(id: string, r: ReturnType<typeof rule>, author = 'ana') {
  const entry = {
    id, title: 'A change', author, classes: [r.applies_to[0]], rules: [r], state: 'open',
    opened: clock.toISOString().replace('.000Z', 'Z'), rev: revOf([]), base: null, branch: null, ops: [], events: [], closed: null,
  }
  await createEntry(repo, entry, { actor: author, rule: `${r.id}/system` }, { now: () => clock, startBranch: 'main' })
}

beforeEach(async () => {
  clock = new Date(NOW); wears = new Set(); admins = new Set([`${SAFE_ADDR.toLowerCase()}|${C1}`]); seen = []
  repo = makeChangeRepo(GOVERNANCE)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: synthetic members, a Snapshot space, a Hats tree, a Safe and a link"')
  const systems = new SystemReader({
    repo, fetch, now: () => clock, sleep: async () => {}, outcomeTtlMs: 0,
    drivers: [link, { ...safe, minGapMs: 0 }, { ...hatsTree, minGapMs: 0 }, { ...snapshotSpace, minGapMs: 0 }],
  })
  app = createApp(repo, (a, c) => mountProposals(a, { repo, withLock: c.withLock, startBranch: 'main', now: () => clock, systems }))
})
afterEach(() => { removeFixtureRepo(repo) })

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const as = (who: string) => { git(repo, `config user.email ${who}@example.test`) }
const send = (who: string, body: unknown, id = P1) => { as(who); return app.request(`/api/proposals/${id}/events`, json(body)) }
const attach = (ref: unknown, id = P1, who = 'ana') => send(who, { kind: 'attach', ref }, id)
const check = (id = P1) => { as('bruno'); return app.request(`/api/proposals/${id}/check`, json({})) }
const prepare = (body: unknown, id = P1) => { as('ana'); return app.request(`/api/proposals/${id}/prepare`, json(body)) }
const events = (id = P1) => readLedger(repo).entries.find(e => e.id === id)!.events
const commits = () => Number(git(repo, 'rev-list --count HEAD').trim())
const tick = (s = 60) => { clock = new Date(clock.getTime() + s * 1000) }
const vote = (payload: Record<string, unknown> = { kind: 'snapshot-proposal', choice: 'For' }) => ({ system: 'dao-votes', id: VOTE, payload })
const wearer = (account: string, hat = C1) => ({ system: 'dao-hats', id: hatRef(CELO, hat), payload: { kind: 'hats-wearer', wearer: `${CELO}:${account}` } })

describe('a proposal that waits on a Snapshot vote', () => {
  it('records the attach; a check appends executed for the passed vote; the proposal is met', async () => {
    await open(P1, VOTES)
    tick()
    const res = await attach(vote())
    expect(res.status).toBe(200)
    expect(events().at(-1)).toMatchObject({ kind: 'attach', by: 'ana', ref: { system: 'dao-votes', id: VOTE, payload: { kind: 'snapshot-proposal', choice: 'For' } } })
    tick()
    const before = commits()
    const view = await (await check()).json()
    expect(commits()).toBe(before + 1)
    expect(events().at(-1)).toMatchObject({ kind: 'system', by: 'system:dao-votes', outcome: 'executed', text: '"For" won', ref: { id: VOTE } })
    expect(view).toMatchObject({ appended: true, reading: { ok: true, outcome: 'executed' }, evaluation: { state: 'met' } })
  })

  it('takes the passing choice from the rule: a ref without one is filled; another choice is refused', async () => {
    await open(P1, VOTES)
    tick()
    const before = commits()
    const other = await attach(vote({ kind: 'snapshot-proposal', choice: 'Against' }))
    expect(other.status).toBe(409)
    expect(await other.json()).toMatchObject({ code: 'ATTACH', error: 'Not attached: rule votes passes on "For", not "Against". Nothing was written.' })
    expect(commits()).toBe(before)
    expect((await attach(vote({ kind: 'snapshot-proposal' }))).status).toBe(200)
    expect((events().at(-1)!.ref as ForeignRef).payload).toEqual({ kind: 'snapshot-proposal', choice: 'For' })
    tick()
    expect((await attach({ system: 'dao-votes', id: VOTE })).status).toBe(200)
    expect((events().at(-1)!.ref as ForeignRef).payload).toEqual({ kind: 'snapshot-proposal', choice: 'For' })
  })

  it('a rule on a Snapshot space that names no passing choice refuses the attach', async () => {
    await open(P1, UNNAMED)
    tick()
    const res = await attach(vote())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ATTACH', error: 'Not attached: rule unnamed names no passing choice (decide.passes.choice). Nothing was written.' })
    expect(events()).toEqual([])
  })

  it('the same vote on a second proposal is 409 ATTACHED_ELSEWHERE', async () => {
    await open(P1, VOTES)
    await open(P2, VOTES, 'carla')
    tick()
    expect((await attach(vote())).status).toBe(200)
    const before = commits()
    const res = await attach({ ...vote(), id: VOTE.toUpperCase().replace('0X', '0x') }, P2, 'carla')
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ATTACHED_ELSEWHERE', error: expect.stringContaining(P1) })
    expect(commits()).toBe(before)
  })

  it('one vote decides at most one proposal: a second proposal attaching it with another passing choice is 409 ATTACHED_ELSEWHERE', async () => {
    await open(P1, VOTES)
    await open(P2, rule('against', 'records', 'dao-votes', { passes: { choice: 'Against' } }), 'carla')
    tick()
    expect((await attach(vote())).status).toBe(200)
    const before = commits()
    const res = await attach(vote({ kind: 'snapshot-proposal', choice: 'Against' }), P2, 'carla')
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ATTACHED_ELSEWHERE', error: expect.stringContaining(P1) })
    expect(commits()).toBe(before)
    expect(events(P2)).toEqual([])
  })

  it('a ref the driver refuses is 409 ATTACH with the driver\'s sentence', async () => {
    await open(P1, VOTES)
    tick()
    const res = await attach({ system: 'dao-votes', id: 'not-a-vote', payload: { kind: 'snapshot-proposal' } })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ATTACH',
      error: 'Not attached: "id" is not a Snapshot proposal id (0x and 64 hex digits, or an IPFS id starting Qm): "not-a-vote". Nothing was written.' })
  })
})

describe('a proposal that waits on a hat', () => {
  it('records a hats-wearer ref; a check reads pending, then executed once the wearer wears the hat', async () => {
    await open(P1, ROLES)
    tick()
    expect((await attach(wearer(A(3)))).status).toBe(200)
    expect(events().at(-1)).toMatchObject({ kind: 'attach', ref: { system: 'dao-hats', id: hatRef(CELO, C1), payload: { kind: 'hats-wearer', wearer: `${CELO}:${checksumAddress(A(3))}` } } })
    tick()
    expect(await (await check()).json()).toMatchObject({ appended: true, reading: { outcome: 'pending' }, evaluation: { state: 'pending' } })
    wears.add(`${A(3).toLowerCase()}|${C1}`)
    tick()
    expect(await (await check()).json()).toMatchObject({ appended: true, reading: { outcome: 'executed' }, evaluation: { state: 'met' } })
    expect(events().filter(e => e.kind === 'system').map(e => e.outcome)).toEqual(['pending', 'executed'])
  })

  it('two proposals may wait on one hat for different wearers, never for the same one', async () => {
    await open(P1, ROLES)
    await open(P2, ROLES, 'carla')
    tick()
    expect((await attach(wearer(A(3)))).status).toBe(200)
    const same = await attach(wearer(A(3).toUpperCase().replace('0X', '0x')), P2, 'carla')
    expect(same.status).toBe(409)
    expect(await same.json()).toMatchObject({ code: 'ATTACHED_ELSEWHERE', error: expect.stringContaining(P1) })
    expect((await attach(wearer(A(4)), P2, 'carla')).status).toBe(200)
    expect(events(P2).at(-1)).toMatchObject({ kind: 'attach', ref: { payload: { wearer: `${CELO}:${checksumAddress(A(4))}` } } })
  })

  it('a bad payload is 409 ATTACH with the driver\'s sentence; nothing is written', async () => {
    await open(P1, ROLES)
    tick()
    const before = commits()
    const res = await attach({ system: 'dao-hats', id: hatRef(CELO, C1), payload: { kind: 'hats-wearer', wearer: 'nobody' } })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ATTACH', error: `Not attached: the wearer must be a CAIP-10 account (${CELO}:0x…): "nobody". Nothing was written.` })
    expect(commits()).toBe(before)
  })
})

describe('a proposal that waits on a Gardens pool proposal', () => {
  it('records the pool proposal through the same attach; the same one on a second proposal is 409 ATTACHED_ELSEWHERE', async () => {
    await open(P1, GRANTS)
    await open(P2, GRANTS, 'carla')
    tick()
    const ref = { system: 'grants-pool', id: `${POOL}-3`, payload: { kind: 'gardens-proposal' } }
    expect((await attach(ref)).status).toBe(200)
    expect(events().at(-1)).toMatchObject({ kind: 'attach', ref })
    const res = await attach(ref, P2, 'carla')
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ATTACHED_ELSEWHERE', error: expect.stringContaining(P1) })
    expect((await attach({ ...ref, id: `${POOL}-4` }, P2, 'carla')).status).toBe(200)
  })
})

describe('a proposal that waits on a system whose driver reads no outcomes', () => {
  it('an attach to a link system is 409 naming the driver', async () => {
    await open(P1, TALK)
    tick()
    const res = await attach({ system: 'forum', id: 'thread-1', payload: { kind: 'link' } })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ATTACH', error: 'Not attached: forum is read by the link driver, which reads no outcomes. Nothing was written.' })
    expect(events()).toEqual([])
  })
})

describe('POST /api/proposals/:id/prepare with an action', () => {
  const MINT = { system: 'dao-hats', action: 'mint-hat', params: { hat: C1, wearer: A(3) }, via: 'treasury' }
  const unchanged = async (fn: () => Promise<void>) => {
    const head = git(repo, 'rev-parse HEAD'), status = git(repo, 'status --porcelain')
    await fn()
    expect(git(repo, 'rev-parse HEAD')).toBe(head)
    expect(git(repo, 'status --porcelain')).toBe(status)
  }

  it('mint-hat on a governance proposal, signed by the treasury Safe: one step carrying a Safe transaction, and the hat ref to attach', async () => {
    await open(P1, ROLES)
    await unchanged(async () => {
      const res = await prepare(MINT)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toMatchObject({ ok: true, action: 'mint-hat', draft: null, attach: wearer(checksumAddress(A(3))) })
      expect(body.steps).toHaveLength(1)
      const [step] = body.steps
      expect(step.signer).toEqual({ kind: 'safe', account: `${CELO}:${SAFE_ADDR}` })
      expect(step.call).toMatchObject({ chain: CELO, to: `${CELO}:${HATS}`, value: '0', operation: 0 })
      expect(step.safe.payload).toMatchObject({ to: HATS, value: '0', data: step.call.data, operation: 0, nonce: 9 })
      expect(step.safe.ref).toMatchObject({ system: 'treasury', id: safeTxHash({ chainId: 42220, safe: SAFE_ADDR, ...step.safe.payload }) })
    })
    // reads only: GETs to the Safe service and JSON-RPC reads; nothing is sent anywhere else
    expect(seen.every(s => s.method === 'GET' ? s.url.startsWith('https://api.safe.global/') : s.url === 'https://forno.celo.org/')).toBe(true)
  })

  it('the prepared attach is what the attach accepts', async () => {
    await open(P1, ROLES)
    const prepared = await (await prepare(MINT)).json()
    tick()
    expect((await attach(prepared.attach)).status).toBe(200)
  })

  it('refuses, in words and with nothing written: a records proposal names the class; an unknown via or system is named', async () => {
    await open(P1, ROLES)
    await open(P2, VOTES)
    await unchanged(async () => {
      const cls = await prepare(MINT, P2)
      expect(cls.status).toBe(409)
      expect(await cls.json()).toEqual({ code: 'NOT_PREPARED', error: 'Not prepared: "mint-hat" is an action of class governance; this proposal is of class records.' })
      const via = await prepare({ ...MINT, via: 'nope' })
      expect(via.status).toBe(409)
      expect(await via.json()).toMatchObject({ code: 'NOT_PREPARED', error: expect.stringContaining('"nope"') })
      const sys = await prepare({ ...MINT, system: 'nope' })
      expect(sys.status).toBe(409)
      expect(await sys.json()).toMatchObject({ code: 'NOT_PREPARED', error: expect.stringContaining('"nope"') })
      // the driver's own refusal: the treasury Safe is no admin of the hat
      admins.clear()
      const notAdmin = await prepare(MINT)
      expect(notAdmin.status).toBe(409)
      expect(await notAdmin.json()).toEqual({ code: 'NOT_PREPARED', error: `Not prepared: ${SAFE_ADDR} is not an admin of 0x0000000d.0001.` })
    })
  })

  it('a read that fails is 502 naming the system; nothing is written', async () => {
    await open(P1, ROLES)
    await unchanged(async () => {
      const broken = new SystemReader({ repo, fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }), now: () => clock, sleep: async () => {},
        drivers: [{ ...hatsTree, minGapMs: 0 }, { ...safe, minGapMs: 0 }] })
      app = createApp(repo, (a, c) => mountProposals(a, { repo, withLock: c.withLock, startBranch: 'main', now: () => clock, systems: broken }))
      const failed = await prepare(MINT)
      expect(failed.status).toBe(502)
      expect((await failed.json()).error).toMatch(/^Not prepared: dao-hats could not be read \(.*503.*\)\. Nothing was sent; try again\.$/)
    })
  })

  it('a refusal that already starts "Not prepared:" (a Safe transaction the via Safe cannot hash) says it once', async () => {
    await open(P1, ROLES)
    const standIn = { prepareAction: async () => ({ ok: false as const, error: 'Not prepared: "data" is not hex.' }) }
    app = createApp(repo, (a, c) => mountProposals(a, { repo, withLock: c.withLock, startBranch: 'main', now: () => clock, systems: standIn as never }))
    const res = await prepare(MINT)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 'NOT_PREPARED', error: 'Not prepared: "data" is not hex.' })
  })

  it('a body that is neither a transaction nor an action, or both, is 400', async () => {
    await open(P1, ROLES)
    expect((await prepare({ system: 'dao-hats', params: {} })).status).toBe(400)
    expect((await prepare({ ...MINT, params: 'x' })).status).toBe(400)
    expect((await prepare({ ...MINT, via: 3 })).status).toBe(400)
    expect((await prepare({ ...MINT, to: HATS, value: '0', operation: 0 })).status).toBe(400)
  })

  it('0.6\'s transaction body still prepares a treasury transaction, on the record\'s chain or one it names', async () => {
    await open(P1, PAY)
    const tx = { to: '0x00000000000000000000000000000000000a11ce', value: '250000000000000000', operation: 0 }
    const res = await prepare(tx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.payload).toMatchObject({ ...tx, nonce: 9 })
    expect(body.safeTxHash).toBe(safeTxHash({ chainId: 42220, safe: SAFE_ADDR, ...body.payload }))
    const off = await prepare({ ...tx, chain: 'eip155:10' })
    expect(off.status).toBe(409)
    expect((await off.json()).error).toContain('eip155:10 is not one of this Safe\'s chains')
    expect((await prepare({ ...tx, chain: 10 })).status).toBe(400)
  })
})

describe('GET /api/systems/:id/actions', () => {
  it('lists a driver\'s actions; none for a driver with none; 404 for an id not in data/systems.yaml', async () => {
    const hats = await app.request('/api/systems/dao-hats/actions')
    expect(hats.status).toBe(200)
    const body = await hats.json()
    expect(body.actions.map((a: { id: string }) => a.id)).toEqual(['mint-hat', 'transfer-hat', 'create-child', 'change-details'])
    expect(body).toEqual({ actions: JSON.parse(JSON.stringify(HATS_ACTIONS)) })
    expect(await (await app.request('/api/systems/forum/actions')).json()).toEqual({ actions: [] })
    expect((await app.request('/api/systems/nope/actions')).status).toBe(404)
  })
})
