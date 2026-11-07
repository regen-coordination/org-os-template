import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { createEntry, readLedger, updateEntry } from '../../server/proposals/ledger.ts'
import { safe } from '../../server/systems/safe.ts'
import { guardedFetch, type FetchLike, type OutcomeReading, type SystemRef } from '../../server/systems/driver.ts'
import { parseTrailers } from '../../lib/trailers.mjs'
import { revOf } from '../../lib/proposals.mjs'
import { safeTxHash, dataHash } from '../../lib/safe-tx.mjs'

// A proposal that waits on a Safe (0.6 P2 spec §3.11, §3.15; P2-R12): `attach` through POST …/events, and POST …/check,
// which reads the Safe and appends a `system` event when the reading changed. Every test builds a throwaway repository
// under the temp directory (makeChangeRepo), with synthetic members ana, bruno and carla and a synthetic Safe. The Safe
// Transaction Service is a fake answering the recorded fixtures of safe.outcome.test.ts; nothing touches the network.

const MEMBERS = `schema_version: "2.0"
members:
  - { id: ana, name: Ana, kind: person, handles: { git: ["ana@example.test"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
  - { id: carla, name: Carla, kind: person, handles: { git: ["carla@example.test"] } }
`
const ADDR = '0x5afe000000000000000000000000000000005afe'
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: treasury-safe, kind: safe, name: Treasury, chain: "eip155:42220", address: "${ADDR}", driver: safe }
`
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [bruno, carla] }
    member: { all: true }
  rules:
    - { id: treasury, applies_to: [treasury], propose: member, decide: { by: system, system: treasury-safe } }
    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const TREASURY_RULE = { id: 'treasury', applies_to: ['treasury'], propose: 'member', decide: { by: 'system', method: 'system', system: 'treasury-safe' } }
const RECORDS_RULE = { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } }

const DIR = new URL('./fixtures/safe-outcome/', import.meta.url)
const load = (file: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(file, DIR), 'utf8'))
const API = 'https://api.safe.global/tx-service/celo/api'
const INFO = `${API}/v1/safes/${ADDR}/`
const HASH = '0xb654430c2746c667a0b73282191427a86062e8a20e2e6724371fd853abc52008'
const SYSTEM = { id: 'treasury-safe', kind: 'safe', name: 'Treasury', chain: 'eip155:42220', address: ADDR, driver: 'safe' }
const TX = { to: '0x00000000000000000000000000000000000a11ce', value: '250000000000000000', data: '0x', operation: 0 as const }
const NOW = new Date('2026-10-18T12:00:00Z')
const ID = 'p-2026-10-18-001'

let repo: string
let app: Hono
let clock: Date
/** What the fake service answers: url → body. */
let routes: Record<string, unknown>
/** When set, the read fails with this error, as the reader reports a failure. */
let failing: string | null

const fetch: FetchLike = async url => {
  const body = routes[url]
  return body === undefined ? { ok: false, status: 404, json: async () => ({ detail: 'Not found.' }) } : { ok: true, status: 200, json: async () => body }
}
const ctx = () => ({ fetchJson: guardedFetch(safe, fetch, new AbortController().signal), now: () => clock, members: [], sleep: async () => {} })
/** The reader the routes get: the real Safe driver over the fake service, without the reader's pacing. */
const systems = {
  async outcome(system: Record<string, unknown>, ref: SystemRef, opened: string): Promise<OutcomeReading> {
    if (failing !== null) return { ok: false, error: failing }
    return safe.outcome!(system, ref, { ...ctx(), opened })
  },
}
const serve = (tx: string) => { routes = { [INFO]: load('safe.json'), [`${API}/v1/multisig-transactions/${HASH}/`]: load(tx) } }

/** A proposal opened by `author` directly in the ledger: a treasury action holds no ops (the transaction is its content). */
async function open(id: string, rule: Record<string, unknown> = TREASURY_RULE, author = 'ana') {
  const entry = {
    id, title: 'Pay the venue', author, classes: [String((rule.applies_to as string[])[0])], rules: [rule], state: 'open',
    opened: clock.toISOString().replace('.000Z', 'Z'), rev: revOf([]), base: null, branch: null, ops: [], events: [], closed: null,
  }
  await createEntry(repo, entry, { actor: author, rule: `${String(rule.id)}/${String((rule.decide as { method: string }).method)}` }, { now: () => clock, startBranch: 'main' })
}

beforeEach(async () => {
  clock = new Date(NOW); failing = null; serve('tx-pending.json')
  repo = makeChangeRepo(GOVERNANCE)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: synthetic members and a synthetic Safe"')
  app = createApp(repo, (a, c) => mountProposals(a, { repo, withLock: c.withLock, startBranch: 'main', now: () => clock, systems }))
  await open(ID)
})
afterEach(() => { removeFixtureRepo(repo) })

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const as = (who: string) => { git(repo, `config user.email ${who}@example.test`) }
const send = (who: string, body: unknown, id = ID) => { as(who); return app.request(`/api/proposals/${id}/events`, json(body)) }
const check = (who = 'bruno', id = ID) => { as(who); return app.request(`/api/proposals/${id}/check`, json({})) }
const events = (id = ID) => readLedger(repo).entries.find(e => e.id === id)!.events
const commits = () => Number(git(repo, 'rev-list --count HEAD').trim())
const tick = (s = 60) => { clock = new Date(clock.getTime() + s * 1000) }
const attached = async () => { expect((await send('ana', { kind: 'attach', ref: await prepared() })).status).toBe(200); tick() }
async function prepared(tx: Record<string, unknown> = TX): Promise<SystemRef> {
  const p = await safe.prepare!(SYSTEM, { proposal: { classes: ['treasury'] }, tx: tx as never }, ctx())
  if (!p.ok) throw new Error(p.error)
  return p.ref
}

describe('attach (POST …/events, kind attach)', () => {
  it('stores the ref when its id is the hash prepare gives for its payload: one commit, by the member', async () => {
    const ref = await prepared()
    expect(ref.id).toBe(HASH)
    tick()
    const before = commits()
    const res = await send('ana', { kind: 'attach', ref })
    expect(res.status).toBe(200)
    expect(commits()).toBe(before + 1)
    expect(events().at(-1)).toMatchObject({ kind: 'attach', by: 'ana', ref, rev: revOf([]) })
    expect(parseTrailers(git(repo, 'log -1 --format=%B HEAD'))).toEqual({ actor: 'ana', rule: 'treasury/system', proposal: ID })
    const view = await res.json()
    expect(view.evaluation.missing).toBe(`waiting for the system treasury-safe: transaction ${HASH} is attached and not executed yet`)
  })

  it('refuses a ref whose id is not the hash of its payload, or names another system, and writes nothing', async () => {
    const ref = await prepared()
    const before = commits()
    for (const wrong of [
      { ...ref, payload: { ...ref.payload, value: '1' } },
      { ...ref, payload: { ...ref.payload, nonce: 9 } },
      { ...ref, id: `0x${'ab'.repeat(32)}` },
    ]) {
      const res = await send('ana', { kind: 'attach', ref: wrong })
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ code: 'ATTACH', error: expect.stringContaining('is not the hash') })
    }
    const other = await send('ana', { kind: 'attach', ref: { ...ref, system: 'other-safe' } })
    expect(other.status).toBe(409)
    expect((await other.json()).error).toContain('other-safe')
    expect(commits()).toBe(before)
    expect(events()).toEqual([])
  })

  it('a body without a ref, or a ref that is not one, is 400', async () => {
    expect((await send('ana', { kind: 'attach' })).status).toBe(400)
    expect((await send('ana', { kind: 'attach', ref: 'x' })).status).toBe(400)
    expect((await send('ana', { kind: 'attach', ref: { system: 'treasury-safe', id: HASH } })).status).toBe(400)
  })

  it('refuses a hash already attached to another proposal', async () => {
    const ref = await prepared()
    expect((await send('ana', { kind: 'attach', ref })).status).toBe(200)
    await open('p-2026-10-18-002', TREASURY_RULE, 'carla')
    tick()
    const before = commits()
    const res = await send('carla', { kind: 'attach', ref }, 'p-2026-10-18-002')
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ATTACHED_ELSEWHERE', error: expect.stringContaining(ID) })
    expect(commits()).toBe(before)
  })

  it('a second attach replaces the first only while no system event exists', async () => {
    const first = await prepared()
    expect((await send('ana', { kind: 'attach', ref: first })).status).toBe(200)
    const second = await prepared({ ...TX, value: '300000000000000000' })
    tick()
    expect((await send('ana', { kind: 'attach', ref: second })).status).toBe(200)
    expect(events().filter(e => e.kind === 'attach').map(e => (e.ref as SystemRef).id)).toEqual([first.id, second.id])
    // now read: the Safe answers for the second one
    routes = { [INFO]: load('safe.json'), [`${API}/v1/multisig-transactions/${second.id}/`]: { ...load('tx-pending.json'), safeTxHash: second.id, value: '300000000000000000' } }
    tick()
    expect((await check()).status).toBe(200)
    expect(events().at(-1)).toMatchObject({ kind: 'system', outcome: 'pending' })
    tick()
    const res = await send('ana', { kind: 'attach', ref: first })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ATTACHED' })
  })
})

describe('POST /api/proposals/:id/check', () => {

  it('appends a system event, by system:<id>, when the reading changed; the evaluation reads it', async () => {
    await attached()
    const before = commits()
    const res = await check()
    expect(res.status).toBe(200)
    expect(commits()).toBe(before + 1)
    expect(git(repo, 'diff --name-only HEAD~1 HEAD').trim()).toBe('data/proposals.yaml')
    expect(events().at(-1)).toMatchObject({
      kind: 'system', by: 'system:treasury-safe', outcome: 'pending', confirmations: 1, required: 2, text: '1 of 2 signatures',
      ref: { system: 'treasury-safe', id: HASH }, rev: revOf([]),
    })
    expect(parseTrailers(git(repo, 'log -1 --format=%B HEAD'))).toEqual({ actor: 'system:treasury-safe', rule: 'treasury/system', proposal: ID })
    const view = await res.json()
    expect(view).toMatchObject({ id: ID, appended: true, commit: git(repo, 'rev-parse HEAD').trim(), reading: { ok: true, outcome: 'pending' } })
    expect(view.evaluation).toMatchObject({ state: 'pending', missing: `transaction ${HASH}: 1 of 2 signatures` })
  })

  it('two checks with the same reading append one event', async () => {
    await attached()
    expect((await check()).status).toBe(200)
    const before = commits()
    tick()
    const res = await check('carla')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ appended: false, commit: null, reading: { outcome: 'pending' } })
    expect(commits()).toBe(before)
    expect(events().filter(e => e.kind === 'system')).toHaveLength(1)
  })

  it('the evaluation of the system rule follows the latest event: pending, then executed is met', async () => {
    await attached()
    expect((await (await check()).json()).evaluation.state).toBe('pending')
    serve('tx-executed.json'); tick()
    const view = await (await check()).json()
    expect(view).toMatchObject({ appended: true, evaluation: { state: 'met' } })
    expect(events().filter(e => e.kind === 'system').map(e => e.outcome)).toEqual(['pending', 'executed'])
  })

  it('a failed transaction is failed', async () => {
    await attached()
    serve('tx-failed.json')
    expect((await (await check()).json()).evaluation.state).toBe('failed')
  })

  it('a mismatch is recorded, and is pending with its sentence', async () => {
    await attached()
    // another transaction took nonce 8: the Safe is at 9, and the prepared one can never execute
    serve('tx-pending.json'); routes[INFO] = { ...load('safe.json'), nonce: '9' }
    const view = await (await check()).json()
    expect(events().at(-1)).toMatchObject({ kind: 'system', outcome: 'mismatch', text: "the Safe's nonce changed; revise the proposal to prepare again" })
    expect(view.evaluation).toMatchObject({ state: 'pending', missing: 'this transaction is not the one the proposal prepared' })
  })

  it('a failed read appends nothing and raises attention', async () => {
    await attached()
    failing = 'no answer within 8 s'
    const before = commits()
    const res = await check()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ appended: false, commit: null, attention: { level: 'warn', text: 'read failed: no answer within 8 s' } })
    expect(commits()).toBe(before)
  })

  it('with nothing attached it reads nothing and appends nothing', async () => {
    const before = commits()
    const res = await check()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ appended: false, commit: null, reading: null, evaluation: { missing: 'waiting for the system treasury-safe: no transaction attached yet' } })
    expect(commits()).toBe(before)
  })

  it('a proposal that waits on no system is 409; one not in the ledger is 404; an unknown actor is 403', async () => {
    await open('p-2026-10-18-002', RECORDS_RULE)
    const res = await check('bruno', 'p-2026-10-18-002')
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('waits on no outside system')
    expect((await check('bruno', 'p-2026-10-18-009')).status).toBe(404)
    git(repo, 'config user.email stranger@example.test')
    expect((await app.request(`/api/proposals/${ID}/check`, json({}))).status).toBe(403)
  })
})

describe('the attach lock, the revision and a final reading (fix round 1)', () => {
  const revise = async (rev: string) => {
    await updateEntry(repo, ID, { fields: { rev }, event: { kind: 'revise' } }, { actor: 'ana', rule: 'treasury/system' }, { now: () => clock, startBranch: 'main' })
    tick()
  }

  it('a reading of a transaction not in the Safe yet is answered and not recorded, and does not lock the attach', async () => {
    const first = await prepared()
    expect((await send('ana', { kind: 'attach', ref: first })).status).toBe(200)
    routes = { [INFO]: load('safe.json') } // the service has not seen it: 404
    tick()
    const before = commits()
    const res = await check()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ appended: false, commit: null, reading: { ok: true, outcome: 'pending', submitted: false } })
    expect(commits()).toBe(before)
    expect(events().filter(e => e.kind === 'system')).toEqual([])
    tick()
    const second = await prepared({ ...TX, value: '300000000000000000' })
    expect((await send('ana', { kind: 'attach', ref: second })).status).toBe(200)
  })

  it('a real reading locks the attach for the current rev; after a revision a new attach is accepted, and the check reads it', async () => {
    const first = await prepared()
    expect((await send('ana', { kind: 'attach', ref: first })).status).toBe(200)
    serve('tx-pending.json'); routes[INFO] = { ...load('safe.json'), nonce: '9' }
    tick()
    expect((await (await check()).json()).reading).toMatchObject({ outcome: 'mismatch' })
    expect(events().at(-1)).toMatchObject({ kind: 'system', outcome: 'mismatch', rev: revOf([]) })
    // the lock holds on the same rev
    tick()
    const again = await send('ana', { kind: 'attach', ref: await prepared({ ...TX, value: '1' }) })
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ code: 'ATTACHED' })
    // a revision: the author prepares again with the Safe's current nonce, and attaches it
    await revise('abcdef012345')
    // the revision cleared the attach: a check now reads nothing for the old transaction
    const cleared = await (await check()).json()
    expect(cleared).toMatchObject({ appended: false, reading: null, evaluation: { state: 'pending' } })
    routes = { [INFO]: { ...load('safe.json'), nonce: '9' } }
    // an attach on the new rev, unread, is still replaceable: the old rev's reading locks nothing here
    tick()
    expect((await send('ana', { kind: 'attach', ref: await prepared({ ...TX, value: '7' }) })).status).toBe(200)
    const fresh = await prepared()
    expect(fresh.payload.nonce).toBe(9)
    tick()
    const res = await send('ana', { kind: 'attach', ref: fresh })
    expect(res.status).toBe(200)
    expect(events().at(-1)).toMatchObject({ kind: 'attach', rev: 'abcdef012345', ref: { id: fresh.id } })
    // the old rev's reading no longer speaks for this rev: the check reads the new attach and records it
    routes[`${API}/v1/multisig-transactions/${fresh.id}/`] = { ...load('tx-pending.json'), safeTxHash: fresh.id, nonce: 9 }
    tick()
    const view = await (await check()).json()
    expect(view).toMatchObject({ appended: true, reading: { outcome: 'pending', confirmations: 1 } })
    expect(events().at(-1)).toMatchObject({ kind: 'system', outcome: 'pending', rev: 'abcdef012345', ref: { id: fresh.id } })
  })

  it('after an executed reading, a later different reading appends nothing: execution is final', async () => {
    await attached()
    serve('tx-executed.json')
    expect((await (await check()).json()).appended).toBe(true)
    for (const later of ['tx-pending.json', 'tx-failed.json']) {
      serve(later); tick()
      const before = commits()
      const view = await (await check()).json()
      expect(view).toMatchObject({ appended: false, commit: null, evaluation: { state: 'met' } })
      expect(commits()).toBe(before)
    }
    expect(events().filter(e => e.kind === 'system').map(e => e.outcome)).toEqual(['executed'])
  })

  it('a failed execution is final too', async () => {
    await attached()
    serve('tx-failed.json')
    expect((await (await check()).json()).appended).toBe(true)
    serve('tx-executed.json'); tick()
    expect(await (await check()).json()).toMatchObject({ appended: false, evaluation: { state: 'failed' } })
    expect(events().filter(e => e.kind === 'system').map(e => e.outcome)).toEqual(['failed'])
  })
})

describe('a system event posted by a normal request', () => {
  it('is refused with the sentence of the one table, whatever the body says about who wrote it', async () => {
    const before = commits()
    for (const body of [
      { kind: 'system', outcome: 'executed', ref: { system: 'treasury-safe', id: HASH } },
      { kind: 'system', outcome: 'executed', by: 'system:treasury-safe', ref: { system: 'treasury-safe', id: HASH } },
    ]) {
      const res = await send('bruno', body)
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ code: 'REFUSED', event: 'SYSTEM', reason: 'only the server writes a system event, from an outside system it read.' })
    }
    expect(commits()).toBe(before)
    // and the hash the rule waits on, attached by hand, is the same function prepare runs
    expect(safeTxHash({ chainId: 42220, safe: ADDR, ...TX, nonce: 8 })).toBe(HASH)
  })
})

describe('a Safe on several chains (DAO-OS L2: a ref names its chain; one attach covers a change on several chains)', () => {
  // The synthetic seven-chain Safe of tests/systems/fixtures/safe-chains (Task 4), as a second system the governance
  // class waits on; the treasury Safe gains Ethereum as a second chain.
  const ADDR7 = '0x5aFE00000000000000000000000000000000C0De'
  const CHAINS7 = ['eip155:1', 'eip155:10', 'eip155:42161', 'eip155:100', 'eip155:137', 'eip155:8453']
  const COUNCIL = { id: 'council-safe', kind: 'safe', name: 'Council', chain: 'eip155:42220', address: ADDR7, driver: 'safe', chains: CHAINS7 }
  const COUNCIL_RULE = { id: 'council', applies_to: ['governance'], propose: 'member', decide: { by: 'system', method: 'system', system: 'council-safe' } }
  const NEW = '0x00000000000000000000000000000000000000B1'
  const NEW2 = '0x00000000000000000000000000000000000000b2'
  const SLUGS: Record<string, string> = { 'eip155:42220': 'celo', 'eip155:1': 'eth', 'eip155:10': 'oeth', 'eip155:42161': 'arb1', 'eip155:100': 'gno', 'eip155:137': 'pol', 'eip155:8453': 'base' }
  const chainsFetch: FetchLike = async url => {
    for (const [, slug] of Object.entries(SLUGS)) {
      if (url === `https://api.safe.global/tx-service/${slug}/api/v1/safes/${ADDR7}/`) {
        const info = JSON.parse(readFileSync(new URL(`../systems/fixtures/safe-chains/${slug}.json`, import.meta.url), 'utf8')).info
        return { ok: true, status: 200, json: async () => info }
      }
    }
    return { ok: false, status: 404, json: async () => ({ detail: 'Not found.' }) }
  }
  const councilCtx = () => ({ fetchJson: guardedFetch(safe, chainsFetch, new AbortController().signal), now: () => clock, members: [], sleep: async () => {} })
  async function addOwner(owner: string, chains?: string[]): Promise<SystemRef> {
    const r = await safe.prepareAction!(COUNCIL, { action: 'add-owner', params: { owner, ...(chains ? { chains } : {}) }, via: null }, councilCtx())
    if (!r.ok || !r.attach) throw new Error(r.ok ? 'no attach' : r.error)
    return r.attach as SystemRef
  }
  /** A treasury-safe transaction hashed on `chainId`, naming `chain`. */
  const onChain = (chainId: number, chain: string): SystemRef => {
    const payload = { to: TX.to, value: TX.value, data_hash: dataHash('0x'), operation: 0, nonce: 3 }
    return { system: 'treasury-safe', chain, payload,
      id: safeTxHash({ chainId, safe: ADDR, to: payload.to, value: payload.value, dataHash: payload.data_hash, operation: 0, nonce: 3 }) }
  }

  beforeEach(() => {
    writeFileSync(join(repo, 'data', 'systems.yaml'), `schema_version: "2.0"
systems:
  - { id: treasury-safe, kind: safe, name: Treasury, chain: "eip155:42220", address: "${ADDR}", driver: safe, chains: ["eip155:1"] }
  - { id: council-safe, kind: safe, name: Council, chain: "eip155:42220", address: "${ADDR7}", driver: safe, chains: [${CHAINS7.map(c => `"${c}"`).join(', ')}] }
`)
    writeFileSync(join(repo, 'data', 'governance.yaml'), GOVERNANCE.replace('  decisions: []', '    - { id: council, applies_to: [governance], propose: member, decide: { by: system, system: council-safe } }\n  decisions: []'))
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the Safes on several chains"')
  })

  it('a ref on another of the Safe\'s chains is recorded; a chain that is not one of its chains is 409 ATTACH', async () => {
    tick()
    const eth = onChain(1, 'eip155:1')
    const before = commits()
    const notOne = await send('ana', { kind: 'attach', ref: onChain(10, 'eip155:10') })
    expect(notOne.status).toBe(409)
    expect(await notOne.json()).toMatchObject({ code: 'ATTACH', error: expect.stringContaining('eip155:10') })
    // hashed on Celo but naming Ethereum: not the hash of its payload there
    const wrong = await send('ana', { kind: 'attach', ref: { ...onChain(42220, 'eip155:1') } })
    expect(wrong.status).toBe(409)
    expect(await wrong.json()).toMatchObject({ code: 'ATTACH', error: expect.stringContaining('is not the hash') })
    expect(commits()).toBe(before)
    const res = await send('ana', { kind: 'attach', ref: eth })
    expect(res.status).toBe(200)
    expect(events().at(-1)).toMatchObject({ kind: 'attach', ref: { system: 'treasury-safe', id: eth.id, chain: 'eip155:1', payload: eth.payload } })
    // a ref without a chain is the record's chain, as in 0.6
    const hashed = onChain(42220, 'eip155:42220')
    const celo = { system: hashed.system, id: hashed.id, payload: hashed.payload }
    tick()
    expect((await send('ana', { kind: 'attach', ref: celo })).status).toBe(200)
    expect(events().at(-1)!.ref).not.toHaveProperty('chain')
  })

  it('one attach covers an add-owner on seven chains: every step is checked on its own chain, and the ref is recorded whole', async () => {
    const ref = await addOwner(NEW)
    expect(ref.also!.map(a => a.chain)).toEqual(CHAINS7)
    await open('p-2026-10-18-002', COUNCIL_RULE, 'carla')
    tick()
    const before = commits()
    // a step whose id is not its payload's hash on its chain, or a step on a chain the Safe is not on, is refused
    const forged = { ...ref, also: ref.also!.map((a, i) => (i === 1 ? { ...a, payload: { ...a.payload, nonce: a.payload.nonce + 1 } } : a)) }
    const r1 = await send('carla', { kind: 'attach', ref: forged }, 'p-2026-10-18-002')
    expect(r1.status).toBe(409)
    expect(await r1.json()).toMatchObject({ code: 'ATTACH', error: expect.stringContaining('eip155:10') })
    const offChain = { ...ref, also: [...ref.also!, { ...ref.also![0]!, chain: 'eip155:11155111' }] }
    const r2 = await send('carla', { kind: 'attach', ref: offChain }, 'p-2026-10-18-002')
    expect(r2.status).toBe(409)
    expect(await r2.json()).toMatchObject({ code: 'ATTACH', error: expect.stringContaining('eip155:11155111') })
    expect((await send('carla', { kind: 'attach', ref: { ...ref, also: [{ chain: 'eip155:1', id: ref.also![0]!.id }] } }, 'p-2026-10-18-002')).status).toBe(400)
    expect(commits()).toBe(before)
    const res = await send('carla', { kind: 'attach', ref }, 'p-2026-10-18-002')
    expect(res.status).toBe(200)
    expect(events('p-2026-10-18-002').at(-1)).toMatchObject({ kind: 'attach', by: 'carla', ref })
    expect((events('p-2026-10-18-002').at(-1)!.ref as SystemRef).also).toHaveLength(6)
  })

  it('a second proposal attaching a ref whose also holds an id already attached is 409 ATTACHED_ELSEWHERE', async () => {
    const ref = await addOwner(NEW)
    await open('p-2026-10-18-002', COUNCIL_RULE, 'carla')
    tick()
    expect((await send('carla', { kind: 'attach', ref }, 'p-2026-10-18-002')).status).toBe(200)
    await open('p-2026-10-18-003', COUNCIL_RULE, 'bruno')
    tick()
    const before = commits()
    // another change on Celo, carrying the first one's Ethereum step
    const other = await addOwner(NEW2, ['eip155:42220'])
    const mixed = { ...other, also: [ref.also![0]!] }
    const res = await send('bruno', { kind: 'attach', ref: mixed }, 'p-2026-10-18-003')
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ATTACHED_ELSEWHERE', error: expect.stringContaining('p-2026-10-18-002') })
    // and the Ethereum step on its own, as a plain ref: the same transaction
    const { chain, id, payload } = ref.also![1]!
    const alone = await send('bruno', { kind: 'attach', ref: { system: 'council-safe', id, chain, payload } }, 'p-2026-10-18-003')
    expect(alone.status).toBe(409)
    expect(await alone.json()).toMatchObject({ code: 'ATTACHED_ELSEWHERE' })
    expect(commits()).toBe(before)
    // the other change alone is its own transaction
    expect((await send('bruno', { kind: 'attach', ref: other }, 'p-2026-10-18-003')).status).toBe(200)
  })

  it('a ref that names one transaction twice (its own id again in also) is 409 ATTACH, and nothing is written', async () => {
    const ref = await addOwner(NEW, ['eip155:42220', 'eip155:1'])
    await open('p-2026-10-18-002', COUNCIL_RULE, 'carla')
    tick()
    const before = commits()
    const twice = { ...ref, also: [...ref.also!, { chain: 'eip155:42220', id: ref.id, payload: ref.payload }] }
    const res = await send('carla', { kind: 'attach', ref: twice }, 'p-2026-10-18-002')
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ATTACH', error: `Not attached: transaction ${ref.id} is named twice in this ref. Nothing was written.` })
    expect(commits()).toBe(before)
    expect(events('p-2026-10-18-002')).toEqual([])
  })
})
