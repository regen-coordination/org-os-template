import { describe, it, expect } from 'vitest'
import { observationsOf, standing, actorIdOf, walletsOf } from '../../lib/hat-readings.mjs'

// Placeholders only (L5 global constraints). Hat ids and the EIP-55 forms of the addresses are written out by hand:
// Council is tree 13 (0x0000000d), level 1, child 1; Ops is Council's child 1. The checksummed addresses were
// computed with @noble/hashes keccak_256, not with lib/caip.mjs.
const COUNCIL = 'eip155:42220:0x0000000d00010000000000000000000000000000000000000000000000000000'
const OPS = 'eip155:42220:0x0000000d00010001000000000000000000000000000000000000000000000000'
const lower = (n: string) => `eip155:42220:0x00000000000000000000000000000000000000${n}`
const A1 = 'eip155:42220:0x00000000000000000000000000000000000000A1'
const A2 = 'eip155:42220:0x00000000000000000000000000000000000000A2'
const A3 = 'eip155:42220:0x00000000000000000000000000000000000000A3'
const A4 = 'eip155:42220:0x00000000000000000000000000000000000000a4'

const as = (over: Record<string, unknown> = {}) => ({ hat: COUNCIL, account: lower('a1'), block: 100, readAt: '2026-10-29T10:00:00Z', ...over })
const proposal = (over: Record<string, unknown> = {}) => ({ id: 'p-2026-10-29-001', events: [], closed: null, ...over })

describe('observationsOf (L5 spec §7.3)', () => {
  it('a proposal with no recorded `as` has no observations', () => {
    expect(observationsOf(proposal())).toEqual([])
    expect(observationsOf(null)).toEqual([])
    expect(observationsOf(proposal({ events: [{ id: 'e-1', by: 'steward-a', kind: 'approve' }] }))).toEqual([])
  })
  it('each `as` says its own account wears its hat, at its block and read time', () => {
    expect(observationsOf(proposal({ opened_as: as() }))).toEqual([
      { hat: COUNCIL, account: A1, wears: true, block: 100, at: '2026-10-29T10:00:00Z' },
    ])
  })
  it('reads opened_as, every event`s as, closed.as and closed.checked, in that order', () => {
    const p = proposal({
      opened_as: as(),
      events: [{ id: 'e-1', kind: 'approve', as: as({ account: lower('a2'), block: 110, readAt: '2026-10-29T10:10:00Z' }) }, { id: 'e-2', kind: 'comment' }],
      closed: {
        at: '2026-10-29T11:00:00Z', by: 'steward-a',
        as: as({ hat: OPS, account: lower('a3'), block: 120, readAt: '2026-10-29T11:00:00Z' }),
        checked: [{ account: lower('a2'), hat: COUNCIL, wears: false, block: 121, readAt: '2026-10-29T11:00:01Z' }],
      },
    })
    expect(observationsOf(p)).toEqual([
      { hat: COUNCIL, account: A1, wears: true, block: 100, at: '2026-10-29T10:00:00Z' },
      { hat: COUNCIL, account: A2, wears: true, block: 110, at: '2026-10-29T10:10:00Z' },
      { hat: OPS, account: A3, wears: true, block: 120, at: '2026-10-29T11:00:00Z' },
      { hat: COUNCIL, account: A2, wears: false, block: 121, at: '2026-10-29T11:00:01Z' },
    ])
  })
  it('each listed wearer wears the hat too', () => {
    const obs = observationsOf(proposal({ opened_as: as({ wearers: [lower('a1'), lower('a2')], complete: false }) }))
    expect(obs.filter(o => o.wears).map(o => o.account).sort()).toEqual([A1, A2])
    expect(obs.filter(o => !o.wears)).toEqual([])
  })
  it('a complete list adds "wears: false" for every other account observed in the proposal', () => {
    const p = proposal({
      opened_as: as({ wearers: [lower('a1'), lower('a2')], complete: true }),
      events: [{ id: 'e-1', kind: 'comment', as: as({ hat: OPS, account: lower('a3'), block: 90 }) }],
      closed: { at: '2026-10-29T11:00:00Z', by: 'steward-a', checked: [{ account: lower('a4'), hat: OPS, wears: true, block: 91, readAt: '2026-10-29T11:00:00Z' }] },
    })
    const falses = observationsOf(p).filter(o => !o.wears)
    expect(falses).toEqual([
      { hat: COUNCIL, account: A3, wears: false, block: 100, at: '2026-10-29T10:00:00Z' },
      { hat: COUNCIL, account: A4, wears: false, block: 100, at: '2026-10-29T10:00:00Z' },
    ])
  })
  it('an incomplete list adds no "wears: false" (Review Focus 5)', () => {
    const p = proposal({
      opened_as: as({ wearers: [lower('a1')], complete: false }),
      events: [{ id: 'e-1', kind: 'approve', as: as({ account: lower('a2'), block: 90 }) }],
    })
    expect(observationsOf(p).filter(o => !o.wears)).toEqual([])
  })
  it('a complete list never takes the hat off the account that read it', () => {
    const obs = observationsOf(proposal({ opened_as: as({ wearers: [lower('a2')], complete: true }) }))
    expect(obs).toContainEqual({ hat: COUNCIL, account: A1, wears: true, block: 100, at: '2026-10-29T10:00:00Z' })
    expect(obs.filter(o => !o.wears)).toEqual([])
  })
  it('a "complete" list holding an entry that is no account is read as incomplete', () => {
    const p = proposal({
      opened_as: as({ wearers: [lower('a1'), 'not an account'], complete: true }),
      events: [{ id: 'e-1', kind: 'approve', as: as({ account: lower('a2'), block: 90 }) }],
    })
    expect(observationsOf(p).filter(o => !o.wears)).toEqual([])
  })
  it('writes hat refs and accounts in one form: lowercase hat id, EIP-55 address', () => {
    const [o] = observationsOf(proposal({ opened_as: as({ hat: COUNCIL.toUpperCase().replace('EIP155', 'eip155').replace('0X', '0x') }) }))
    expect(o.hat).toBe(COUNCIL)
    expect(o.account).toBe(A1)
  })
  it.each([
    ['no hat', { hat: undefined }],
    ['a hat that is no hat ref', { hat: 'council' }],
    ['no account', { account: undefined }],
    ['an account that is no CAIP-10 id', { account: '0x00000000000000000000000000000000000000a1' }],
    ['no block', { block: undefined }],
    ['a block that is no whole number', { block: '100' }],
    ['no read time', { readAt: undefined }],
  ])('skips an `as` with %s', (_name, over) => {
    expect(observationsOf(proposal({ opened_as: as(over) }))).toEqual([])
  })
  it('skips a checked row without its own wears', () => {
    const closed = { at: '2026-10-29T11:00:00Z', by: 'steward-a', checked: [{ account: lower('a2'), hat: COUNCIL, block: 121, readAt: '2026-10-29T11:00:01Z' }] }
    expect(observationsOf(proposal({ closed }))).toEqual([])
  })
})

describe('standing', () => {
  const o = (over: Record<string, unknown>) => ({ hat: COUNCIL, account: A1, wears: true, block: 100, at: '2026-10-29T10:00:00Z', ...over })
  it('keeps the observation with the highest block for each hat and account', () => {
    const map = standing([o({ wears: true, block: 100 }), o({ wears: false, block: 101 }), o({ account: A2 })])
    expect(map.get(`${COUNCIL}|${A1}`)).toEqual(o({ wears: false, block: 101 }))
    expect(map.get(`${COUNCIL}|${A2}`)).toEqual(o({ account: A2 }))
    expect(map.size).toBe(2)
  })
  it('a later "wears: false" (higher block) removes an earlier "wears: true", whatever the order written', () => {
    expect(standing([o({ wears: false, block: 200 }), o({ wears: true, block: 150 })]).get(`${COUNCIL}|${A1}`)?.wears).toBe(false)
  })
  it('at the same block, the latest read time stands', () => {
    const map = standing([o({ wears: true, at: '2026-10-29T10:05:00Z' }), o({ wears: false, at: '2026-10-29T10:00:00Z' })])
    expect(map.get(`${COUNCIL}|${A1}`)?.wears).toBe(true)
  })
  it('compares read times as times, not as text', () => {
    const map = standing([o({ wears: true, at: '2026-10-29T10:00:00Z' }), o({ wears: false, at: '2026-10-29T09:00:00-03:00' })])
    expect(map.get(`${COUNCIL}|${A1}`)?.wears).toBe(false)
  })
  it('keeps hats apart', () => {
    const map = standing([o({ wears: true }), o({ hat: OPS, wears: false, block: 300 })])
    expect(map.get(`${COUNCIL}|${A1}`)?.wears).toBe(true)
    expect(map.get(`${OPS}|${A1}`)?.wears).toBe(false)
  })
})

describe('actorIdOf (L5 spec §6.3)', () => {
  const members = [
    { id: 'steward-a', name: 'Steward A', handles: { wallet: [lower('a1')] } },
    { id: 'steward-b', name: 'Steward B', handles: { wallet: lower('a2') } },
    { id: 'steward-c', name: 'Steward C', handles: { wallet: [lower('a2')] } },
    { id: 'ops-lead', name: 'Ops lead', handles: { wallet: ['eip155:1:0x00000000000000000000000000000000000000a3'] } },
  ]
  it('an account listed in handles.wallet of one member is that member', () => {
    expect(actorIdOf(A1, members)).toBe('steward-a')
    expect(actorIdOf(lower('a1'), members)).toBe('steward-a')
  })
  it('an account listed by two members is its CAIP-10 id: which of them acts is not guessed', () => {
    expect(actorIdOf(lower('a2'), members)).toBe(A2)
  })
  it('an account no member lists is its CAIP-10 id', () => {
    expect(actorIdOf(lower('a4'), members)).toBe(A4)
    expect(actorIdOf(lower('a4'), [])).toBe(A4)
  })
  it('a wallet on another chain is another account', () => {
    expect(actorIdOf(lower('a3'), members)).toBe(A3)
  })
})

describe('walletsOf', () => {
  it('reads one CAIP-10 id or a list, in one form, and drops what is not one', () => {
    expect(walletsOf({ id: 'steward-a', handles: { wallet: lower('a1') } })).toEqual([A1])
    expect(walletsOf({ id: 'steward-a', handles: { wallet: [lower('a1'), A1, '0x00000000000000000000000000000000000000a2', 7] } })).toEqual([A1])
    expect(walletsOf({ id: 'steward-a' })).toEqual([])
    expect(walletsOf(null)).toEqual([])
  })
})
