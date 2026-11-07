import { describe, it, expect, afterEach, vi } from 'vitest'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo } from '../fixtures.ts'
import { Membership, HATS_FRESH_MS, HATS_GRACE_MS, KEPT_MAX_MS } from '../../server/session/membership.ts'
import { SESSION_TTL_MS } from '../../server/session/sessions.ts'
import { FAILED_READ_TTL_MS } from '../../server/systems/driver.ts'
import type { WearerReading, WearersReading } from '../../server/systems/hats.ts'
import type { WearerRefusal } from '../../server/systems/reader.ts'

// L5 spec §5: membership read from the Hats tree through an injected reader (no network in tests, ruling S13).

const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
// EIP-55 of …a1 and …a2, computed apart from lib/caip.mjs (keccak-256 of the lower-case hex, @noble/hashes): the letter is upper case.
const A1 = '0x00000000000000000000000000000000000000a1'
const A1_ID = `${CELO}:0x00000000000000000000000000000000000000A1`
const A2_ID = `${CELO}:0x00000000000000000000000000000000000000A2`
const T0 = new Date('2026-10-29T10:00:00.000Z')

const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "steward-council"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
`

const READ_FAILED = 'The Hats tree could not be read, so membership is not known. Try again.'

const cleanup: string[] = []
afterEach(() => { for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true }) })

function repo(o: { systems?: string | null; governance?: string } = {}): string {
  const r = makeFixtureRepo(); cleanup.push(r)
  if (o.systems !== null) writeFileSync(join(r, 'data', 'systems.yaml'), o.systems ?? SYSTEMS)
  if (o.governance) writeFileSync(join(r, 'data', 'governance.yaml'), o.governance)
  return r
}

const reading = (account: string, hats: string[], at: Date, block = 100): WearerReading =>
  ({ ok: true, system: 'hats-main', chain: CELO, account, hats, block, readAt: at.toISOString() })
const FAILED: WearerRefusal = { ok: false, failed: true, error: 'the tree could not be read: rpc down' }

/** A reader whose answers the test changes as it goes. */
function fakeReader(first: (account: string) => WearerReading | WearerRefusal) {
  const state = { answer: first, wearers: (hat: string): WearersReading | WearerRefusal => ({ ok: true, system: 'hats-main', hat, wearers: [A1_ID, A2_ID], holders: [A1_ID, A2_ID], complete: true, block: 101, readAt: T0.toISOString() }) }
  const reader = {
    wearer: vi.fn(async (_system: Record<string, unknown>, account: string) => state.answer(account)),
    wearers: vi.fn(async (_system: Record<string, unknown>, hat: string) => state.wearers(hat)),
  }
  return { reader, state }
}

function setup(o: { governance?: string; systems?: string | null } = {}) {
  let clock = T0
  const { reader, state } = fakeReader(account => reading(account, [COUNCIL], clock))
  const m = new Membership({ repo: repo(o), reader, now: () => clock })
  return { m, reader, state, at: (d: Date) => { clock = d }, now: () => clock }
}
const later = (ms: number) => new Date(T0.getTime() + ms)
const settle = () => new Promise(r => setTimeout(r, 0))

describe('Membership.tree (spec §5.1)', () => {
  it('is the only hats-tree System, with its chain and tree ref', () => {
    const { m } = setup()
    expect(m.tree()).toEqual({
      system: { id: 'hats-main', kind: 'hats-tree', name: 'Hats', chain: CELO, address: '13', driver: 'hats-tree' },
      chain: CELO, ref: 'eip155:42220:13',
    })
  })
  it('is null when the org has no tree', () => {
    expect(setup({ systems: null }).m.tree()).toBeNull()
  })
})

describe('Membership.forRead (spec §5.2: reads never wait on the network)', () => {
  it('has nothing before a first reading, and schedules one without awaiting it', async () => {
    const { m, reader } = setup()
    expect(m.forRead(A1)).toBeNull()
    expect(reader.wearer).toHaveBeenCalledTimes(1)
    await settle()
    expect(m.forRead(A1)).toEqual({ hats: [COUNCIL], block: 100, readAt: T0.toISOString(), stale: false })
  })

  it('never calls the reader while the reading is fresh', async () => {
    const { m, reader, at } = setup()
    await m.forAct(A1)
    reader.wearer.mockClear()
    at(later(HATS_FRESH_MS - 1))
    expect(m.forRead(A1)).toEqual({ hats: [COUNCIL], block: 100, readAt: T0.toISOString(), stale: false })
    expect(m.forRead(A1_ID)?.hats).toEqual([COUNCIL]) // the same account, as CAIP-10
    expect(reader.wearer).not.toHaveBeenCalled()
  })

  it('answers the kept reading when it is stale, and reads again in the background, once', async () => {
    const { m, reader, state, at } = setup()
    await m.forAct(A1)
    reader.wearer.mockClear()
    at(later(HATS_FRESH_MS))
    state.answer = account => reading(account, [], later(HATS_FRESH_MS), 200) // the hat was taken off on chain
    expect(m.forRead(A1)).toEqual({ hats: [COUNCIL], block: 100, readAt: T0.toISOString(), stale: false })
    expect(m.forRead(A1)?.hats).toEqual([COUNCIL])
    expect(reader.wearer).toHaveBeenCalledTimes(1) // one read under way, not one per request
    await settle()
    expect(m.forRead(A1)).toEqual({ hats: [], block: 200, readAt: later(HATS_FRESH_MS).toISOString(), stale: false }) // narrowed
  })

  it('keeps the last good reading when a background read fails, and past HATS_GRACE_MS reads as public (Review Focus 3)', async () => {
    const { m, state, at } = setup()
    await m.forAct(A1)
    state.answer = () => FAILED
    at(later(HATS_FRESH_MS + 1))
    m.forRead(A1); await settle()
    expect(m.forRead(A1)).toEqual({ hats: [COUNCIL], block: 100, readAt: T0.toISOString(), stale: false })
    at(later(HATS_GRACE_MS + 1))
    expect(m.forRead(A1)).toEqual({ hats: [], block: 100, readAt: T0.toISOString(), stale: true })
  })

  it('after a failed background read, starts no other before FAILED_READ_TTL_MS (fix round 1)', async () => {
    const { m, reader, state, at } = setup()
    await m.forAct(A1)
    reader.wearer.mockClear()
    state.answer = () => FAILED
    at(later(HATS_FRESH_MS))
    m.forRead(A1); await settle()
    expect(reader.wearer).toHaveBeenCalledTimes(1)
    at(later(HATS_FRESH_MS + FAILED_READ_TTL_MS - 1))
    m.forRead(A1); m.forRead(A1); await settle()
    expect(reader.wearer).toHaveBeenCalledTimes(1)
    at(later(HATS_FRESH_MS + FAILED_READ_TTL_MS))
    m.forRead(A1); await settle()
    expect(reader.wearer).toHaveBeenCalledTimes(2)
  })

  it('keeps nothing for an account that wears no hat, and drops readings older than a session can live (fix round 1)', async () => {
    expect(KEPT_MAX_MS).toBe(SESSION_TTL_MS + HATS_GRACE_MS)
    const { m, state, at } = setup()
    state.answer = account => reading(account, [], T0)
    expect(await m.forAct(A2_ID)).toMatchObject({ ok: true, hats: [] })
    state.answer = account => reading(account, [COUNCIL], T0)
    await m.forAct(A1)
    const before = m.forRead(A2_ID) // nothing kept: null, and a read is started
    expect(before).toBeNull()
    at(later(KEPT_MAX_MS))
    state.answer = account => reading(account, [COUNCIL], later(KEPT_MAX_MS))
    await m.forAct(A2_ID) // keeping a reading drops the old ones
    state.answer = () => FAILED
    expect(m.forRead(A1)).toBeNull() // dropped, not answered as stale
  })

  it('is null for an account on another chain, or no tree', () => {
    expect(setup().m.forRead(`eip155:1:${A1}`)).toBeNull()
    expect(setup({ systems: null }).m.forRead(A1)).toBeNull()
  })
})

describe('Membership.forAct (spec §5.2: an act reads now)', () => {
  it('reads through the reader and answers the reading', async () => {
    const { m, reader } = setup()
    expect(await m.forAct(A1)).toEqual({ ok: true, hats: [COUNCIL], block: 100, readAt: T0.toISOString() })
    expect(reader.wearer).toHaveBeenCalledWith(expect.objectContaining({ id: 'hats-main' }), A1_ID)
  })
  it('says the tree could not be read, never "not a member"', async () => {
    const { m, state } = setup()
    state.answer = () => FAILED
    expect(await m.forAct(A1)).toEqual({ ok: false, error: READ_FAILED })
  })
})

describe('Membership.actFor (spec §5.2, §7.2)', () => {
  it('answers the HatAct an act records, with the wearer list', async () => {
    const { m, reader } = setup({ governance: GOVERNANCE })
    expect(await m.actFor(A1, COUNCIL)).toEqual({
      hat: COUNCIL, account: A1_ID, block: 100, readAt: T0.toISOString(), wearers: [A1_ID, A2_ID], complete: true,
    })
    expect(reader.wearers).toHaveBeenCalledWith(expect.objectContaining({ id: 'hats-main' }), COUNCIL)
  })

  it('re-reads and refuses a hat taken off on chain, and reads narrow with it (Review Focus 2)', async () => {
    const { m, state, at } = setup({ governance: GOVERNANCE })
    await m.forAct(A1)
    at(later(60_000)) // within HATS_FRESH_MS: a read would still answer the old hats
    state.answer = account => reading(account, [], later(60_000), 150)
    expect(await m.actFor(A1, COUNCIL)).toEqual({ ok: false, code: 'NOT_WORN', error: 'You do not wear council now (read at block 150), so you cannot act under it. Nothing was written.' })
    expect(m.forRead(A1)?.hats).toEqual([])
  })

  it('refuses with the §5.2 sentence when the tree cannot be read', async () => {
    const { m, state } = setup({ governance: GOVERNANCE })
    state.answer = () => FAILED
    expect(await m.actFor(A1, COUNCIL)).toEqual({ ok: false, code: 'HATS_UNREADABLE', error: 'The Hats tree could not be read, so it is not known that you still wear council. Nothing was written.' })
  })

  it('records an incomplete list when the wearers cannot be read', async () => {
    const { m, state } = setup({ governance: GOVERNANCE })
    state.wearers = () => FAILED
    expect(await m.actFor(A1, COUNCIL)).toEqual({ hat: COUNCIL, account: A1_ID, block: 100, readAt: T0.toISOString(), wearers: [], complete: false })
  })

  it('names a hat no role is sourced from by its id', async () => {
    const { m, state } = setup({ governance: GOVERNANCE })
    state.answer = account => reading(account, [COUNCIL], T0)
    expect(m.hatName(OPS)).toBe('0x0000000d.0002')
    expect(await m.actFor(A1, OPS)).toEqual({ ok: false, code: 'NOT_WORN', error: 'You do not wear 0x0000000d.0002 now (read at block 100), so you cannot act under it. Nothing was written.' })
  })
})
