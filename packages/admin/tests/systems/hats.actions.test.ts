import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { hatsTree, HATS_ACTIONS } from '../../server/systems/hats.ts'
import { safe } from '../../server/systems/safe.ts'
import { SystemReader } from '../../server/systems/reader.ts'
import { guardedFetch, guardedPost, type DriverContext, type FetchLike, type ForeignRef } from '../../server/systems/driver.ts'
import { readParams } from '../../server/systems/actions.ts'
import { CHAINS } from '../../server/systems/chains.ts'
import { topHatId, childHatId, hatRef, prettyHatId, VIEW_HAT_TYPES } from '../../lib/hats.mjs'
import { encodeArgs, encodeCall, selector } from '../../lib/abi.mjs'
import { checksumAddress } from '../../lib/caip.mjs'
import { safeTxHash } from '../../lib/safe-tx.mjs'

// Hats actions (DAO-OS L2, Task 8): prepared and checked as the Hats v1 contract checks them, never sent. No test touches
// the network: one fake answers forno.celo.org's JSON-RPC from a synthetic tree, and api.safe.global's Safe info (from the
// Task 4 fixture, nonce 9 on Celo). The contract's own reverts are those of Hats.sol @ cccb71a (mintHat: AllHatsWorn,
// AlreadyWearingHat, NotEligible, HatNotActive; transferHat: Immutable, NotHatWearer; createHat: ZeroAddress, MaxLevelsReached;
// changeHatDetails: Immutable; every write: NotAdmin).

const CELO = 'eip155:42220'
const HATS = '0x3bc1A0Ad72417f2d411118085256fC53CBdDd137'
const SAFE_ADDR = '0x5aFE00000000000000000000000000000000C0De'
const SYSTEM = { id: 'hats', kind: 'hats-tree', chain: CELO, address: '13', driver: 'hats-tree' }
const VIA = { id: 'council', kind: 'safe', name: 'Council', chain: CELO, address: SAFE_ADDR, driver: 'safe' }
const NOW = new Date('2026-10-29T12:00:00Z')
const A = (n: number) => `0x${'0'.repeat(38)}a${n}`
const ZERO = '0x0000000000000000000000000000000000000000'
const TOP = topHatId(13), C1 = childHatId(TOP, 1), G = childHatId(C1, 1), C2 = childHatId(TOP, 2), C3 = childHatId(TOP, 3), C4 = childHatId(TOP, 4)
const governance = { proposal: { classes: ['governance'] } }
const safeInfo = (JSON.parse(readFileSync(new URL('./fixtures/safe-chains/celo.json', import.meta.url), 'utf8')) as { info: unknown }).info

interface HatState { details?: string; max: number; supply: number; eligibility?: string; toggle?: string; image?: string; last?: number; mutable?: boolean; active?: boolean }
function deep(levels: number): string { let id = TOP; for (let i = 0; i < levels; i++) id = childHatId(id, 1); return id }
const L13 = deep(13), L14 = deep(14)
const BASE: Record<string, HatState> = {
  [TOP]: { details: 'Top', max: 1, supply: 1, last: 4, mutable: false },
  [C1]: { details: 'Stewards', max: 5, supply: 2, last: 1, mutable: true, eligibility: `0x${'0'.repeat(38)}70`, toggle: `0x${'0'.repeat(38)}71` },
  [G]: { details: 'Guests', max: 2, supply: 2, mutable: true },
  [C2]: { details: 'Convenors', max: 3, supply: 0, mutable: true },
  [C3]: { details: 'Paused', max: 3, supply: 0, mutable: true, active: false },
  [C4]: { details: 'Fixed', max: 3, supply: 1, mutable: false },
  [L13]: { details: 'Deep', max: 1, supply: 0, last: 0, mutable: true },
  [L14]: { details: 'Deepest', max: 1, supply: 0, last: 0, mutable: true },
}

/** What the chain says. `wears`, `eligible`, `admins`: "<address lowercase>|<hat id>" pairs. */
function world(over: { hats?: Record<string, Partial<HatState>>; wears?: string[]; eligible?: string[]; admins?: string[]; noRpc?: boolean } = {}) {
  const hats: Record<string, HatState> = { ...BASE }
  for (const [id, h] of Object.entries(over.hats ?? {})) hats[id] = { ...(hats[id] ?? { max: 0, supply: 0 }), ...h }
  const wears = new Set(over.wears ?? []), eligible = new Set(over.eligible ?? [A(3), A(4)].map(a => `${a.toLowerCase()}|*`)), admins = new Set(over.admins ?? [])
  const seen: { method: 'GET' | 'POST'; url: string; body?: any }[] = []
  const word = (data: string, i: number) => data.slice(10 + 64 * i, 74 + 64 * i)
  const idAt = (data: string, i: number) => '0x' + word(data, i)
  const addrAt = (data: string, i: number) => '0x' + word(data, i).slice(24)
  const yes = (b: boolean) => '0x' + (b ? '1' : '0').padStart(64, '0')
  const answer = (data: string): string | null => {
    const sel = data.slice(0, 10)
    if (sel === selector('viewHat(uint256)')) {
      const h = hats[idAt(data, 0)] ?? { max: 0, supply: 0 }
      return encodeArgs(VIEW_HAT_TYPES, [h.details ?? '', h.max, h.supply, h.eligibility ?? ZERO, h.toggle ?? ZERO, h.image ?? '', h.last ?? 0, h.mutable ?? false, h.active ?? true])
    }
    if (sel === selector('isWearerOfHat(address,uint256)')) return yes(wears.has(`${addrAt(data, 0)}|${idAt(data, 1)}`))
    if (sel === selector('isEligible(address,uint256)')) return yes(eligible.has(`${addrAt(data, 0)}|${idAt(data, 1)}`) || eligible.has(`${addrAt(data, 0)}|*`))
    if (sel === selector('isAdminOfHat(address,uint256)')) return yes(admins.has(`${addrAt(data, 0)}|${idAt(data, 1)}`))
    return null
  }
  const fetch: FetchLike = async (url, init) => {
    if (init.method === 'GET') {
      seen.push({ method: 'GET', url })
      return url === `https://api.safe.global/tx-service/celo/api/v1/safes/${SAFE_ADDR}/`
        ? { ok: true, status: 200, json: async () => safeInfo } : { ok: false, status: 404, json: async () => ({}) }
    }
    const body = JSON.parse(init.body!)
    seen.push({ method: 'POST', url, body })
    const replies = [...body].reverse().map((r: any) => {
      if (r.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: r.id, result: '0x4d9410e' }
      const hit = r.params[0].to.toLowerCase() === HATS.toLowerCase() ? answer(r.params[0].data) : null
      return hit === null ? { jsonrpc: '2.0', id: r.id, error: { code: 3, message: 'execution reverted' } } : { jsonrpc: '2.0', id: r.id, result: hit }
    })
    return { ok: true, status: 200, json: async () => replies }
  }
  const ctx = (): DriverContext => ({
    fetchJson: guardedFetch(hatsTree, fetch, new AbortController().signal), postJson: guardedPost(hatsTree, fetch, new AbortController().signal),
    rpcUrl: chain => (CHAINS[chain]?.rpc ? `https://${CHAINS[chain].rpc}/` : null), now: () => NOW, members: [], sleep: async () => {},
  })
  const reader = () => new SystemReader({ repo: '/nonexistent', fetch, drivers: [{ ...hatsTree, minGapMs: 0 }, { ...safe, minGapMs: 0 }], now: () => NOW, sleep: async () => {} })
  const prepare = (action: string, params: Record<string, unknown>, via: typeof VIA | null = null, proposal = governance) =>
    reader().prepareAction(SYSTEM, { ...proposal, action, params }, via)
  return { seen, fetch, ctx, reader, prepare, posts: () => seen.filter(s => s.method === 'POST'), gets: () => seen.filter(s => s.method === 'GET') }
}
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r)}`); return r as Extract<T, { ok: true }> }
const refused = <T extends { ok: boolean }>(r: T): string => { if (r.ok) throw new Error(`expected a refusal: ${JSON.stringify(r)}`); return (r as unknown as { error: string }).error }
const S = (a: string) => { const c = checksumAddress(a); return `${c.slice(0, 6)}…${c.slice(-4)}` }
const wearing = (account: string, hat: string) => `${account.toLowerCase()}|${hat}`
const SAFE_ADMIN = (hat: string) => wearing(SAFE_ADDR, hat)

describe('HATS_ACTIONS', () => {
  it('four actions, all of class governance, with the planned inputs', () => {
    expect(hatsTree.actions).toBe(HATS_ACTIONS)
    expect(HATS_ACTIONS.map(a => [a.id, a.class])).toEqual([['mint-hat', 'governance'], ['transfer-hat', 'governance'], ['create-child', 'governance'], ['change-details', 'governance']])
    const params = (id: string) => HATS_ACTIONS.find(a => a.id === id)!.params.map(p => `${p.name}:${p.type}${p.optional ? '?' : ''}`)
    expect(params('mint-hat')).toEqual(['hat:hat', 'wearer:address'])
    expect(params('transfer-hat')).toEqual(['hat:hat', 'from:address', 'to:address'])
    expect(params('create-child')).toEqual(['admin:hat', 'details:text', 'maxSupply:uint', 'eligibility:address', 'toggle:address', 'mutable:string?', 'imageURI:string?'])
    expect(params('change-details')).toEqual(['hat:hat', 'details:text'])
    expect(new SystemReader({ repo: '/x', drivers: [hatsTree] }).actionsOf(SYSTEM)).toBe(HATS_ACTIONS)
  })
})

describe('the hat parameter', () => {
  const spec = { id: 's', label: 's', class: null, params: [{ name: 'p', label: 'P', type: 'hat' as const }] }
  const read = (v: unknown) => readParams(spec, { p: v })
  it('takes full hex, the pretty form, decimal and a hat ref, and answers one canonical form', () => {
    expect(read(C1)).toEqual({ ok: true, params: { p: C1 } })
    expect(read(C1.toUpperCase().replace('0X', '0x'))).toEqual({ ok: true, params: { p: C1 } })
    expect(read('0x0000000d.0001')).toEqual({ ok: true, params: { p: C1 } })
    expect(read(BigInt(C1).toString())).toEqual({ ok: true, params: { p: C1 } })
    expect(read(` ${hatRef(CELO, C1)} `)).toEqual({ ok: true, params: { p: hatRef(CELO, C1) } })
  })
  it('refuses the rest with a sentence naming the param', () => {
    for (const bad of ['0x0d.0001', 'hat', '', 7, { a: 1 }, 'eip155:42220:0x12']) {
      const r = read(bad)
      expect(r.ok).toBe(false)
      expect((r as { error: string }).error).toMatch(/^"p" /)
    }
  })
})

describe('mint-hat', () => {
  const id131 = BigInt(C1)
  it('via the Safe that is an admin: one step, a Safe transaction on the Safe\'s Celo nonce, reads only', async () => {
    const w = world({ admins: [SAFE_ADMIN(C1)] })
    const r = ok(await w.prepare('mint-hat', { hat: '0x0000000d.0001', wearer: A(3) }, VIA))
    expect(r.steps).toHaveLength(1)
    const s = r.steps[0]!
    expect(s.call).toMatchObject({ chain: CELO, to: `${CELO}:${HATS}`, value: '0', operation: 0, data: encodeCall('mintHat(uint256,address)', [id131, A(3)]) })
    expect(s.call.summary).toBe(`mint 0x0000000d.0001 to ${S(A(3))}`)
    expect(s.signer).toEqual({ kind: 'safe', account: `${CELO}:${SAFE_ADDR}` })
    expect(s.safe!.payload).toMatchObject({ to: HATS, data: s.call.data, nonce: 9 })
    expect(s.safe!.ref.id).toBe(safeTxHash({ chainId: 42220, safe: SAFE_ADDR, ...s.safe!.payload }))
    expect(r.link).toBe('https://app.hatsprotocol.xyz/trees/42220/13')
    expect(r).toMatchObject({ action: 'mint-hat', draft: null })
    for (const p of w.posts()) expect(p.url).toBe('https://forno.celo.org/')
    for (const g of w.gets()) expect(g.url.startsWith('https://api.safe.global/')).toBe(true)
    expect(w.gets()).toHaveLength(1)
  })

  it('without via, the wearers of the admin hat sign', async () => {
    const w = world()
    const r = ok(await w.prepare('mint-hat', { hat: C1, wearer: A(3) }))
    expect(r.steps[0]!.signer).toEqual({ kind: 'wearer', hat: hatRef(CELO, TOP) })
    expect(r.steps[0]!.safe).toBeNull()
    expect(w.gets()).toHaveLength(0)
    // a top hat is administered by its own wearer
    const top = ok(await world({ hats: { [TOP]: { supply: 0 } } }).prepare('mint-hat', { hat: TOP, wearer: A(3) }))
    expect(top.steps[0]!.signer).toEqual({ kind: 'wearer', hat: hatRef(CELO, TOP) })
  })

  it('attaches the hat ref with the wearer as CAIP-10', async () => {
    const r = ok(await world().prepare('mint-hat', { hat: C1, wearer: A(3).toLowerCase() }))
    expect(r.attach).toEqual({ system: 'hats', id: hatRef(CELO, C1), payload: { kind: 'hats-wearer', wearer: `${CELO}:${A(3).replace('a3', 'A3')}` } })
  })
})

describe('the contract\'s own refusals, before anything is prepared', () => {
  const VIA_ADMIN = [C1, TOP, G, C3, C4, L13, childHatId(C1, 2), L14].map(SAFE_ADMIN)
  const cases: { what: string; over?: Parameters<typeof world>[0]; action: string; params: Record<string, unknown>; says: RegExp | string }[] = [
    { what: 'a hat that is not created', action: 'mint-hat', params: { hat: childHatId(TOP, 9), wearer: A(3) }, says: /0x0000000d\.0009 does not exist|not created/ },
    { what: 'a full hat', action: 'mint-hat', params: { hat: G, wearer: A(3) }, says: /0x0000000d\.0001\.0001 has all of its 2 hats worn/ },
    { what: 'an inactive hat', action: 'mint-hat', params: { hat: C3, wearer: A(3) }, says: /0x0000000d\.0003 is not active/ },
    { what: 'an ineligible wearer', action: 'mint-hat', params: { hat: C1, wearer: A(8) }, says: `${S(A(8))} is not eligible for 0x0000000d.0001` },
    { what: 'an already-worn hat', over: { wears: [wearing(A(3), C1)] }, action: 'mint-hat', params: { hat: C1, wearer: A(3) }, says: `${S(A(3))} already wears 0x0000000d.0001` },
    { what: 'a hat of tree 14', action: 'mint-hat', params: { hat: topHatId(14), wearer: A(3) }, says: /not in tree 13/ },
    { what: 'a hat of another chain', action: 'mint-hat', params: { hat: hatRef('eip155:10', C1), wearer: A(3) }, says: /eip155:10, not eip155:42220/ },
    { what: 'a transfer of an immutable hat', over: { wears: [wearing(A(4), C4)] }, action: 'transfer-hat', params: { hat: C4, from: A(4), to: A(3) }, says: /0x0000000d\.0004 is immutable/ },
    { what: 'a transfer from someone who does not wear it', action: 'transfer-hat', params: { hat: C1, from: A(4), to: A(3) }, says: `${S(A(4))} does not wear 0x0000000d.0001` },
    { what: 'a transfer to a wearer', over: { wears: [wearing(A(4), C1), wearing(A(3), C1)] }, action: 'transfer-hat', params: { hat: C1, from: A(4), to: A(3) }, says: `${S(A(3))} already wears` },
    { what: 'a transfer to an ineligible account', over: { wears: [wearing(A(4), C1)] }, action: 'transfer-hat', params: { hat: C1, from: A(4), to: A(8) }, says: `${S(A(8))} is not eligible` },
    { what: 'a create-child with a zero toggle', action: 'create-child', params: { admin: C1, details: 'x', maxSupply: 1, eligibility: A(5), toggle: ZERO }, says: /toggle.*zero/ },
    { what: 'a create-child with a zero eligibility', action: 'create-child', params: { admin: C1, details: 'x', maxSupply: 1, eligibility: ZERO, toggle: A(5) }, says: /eligibility.*zero/ },
    { what: 'details of 7001 characters', action: 'create-child', params: { admin: C1, details: 'a'.repeat(7001), maxSupply: 1, eligibility: A(5), toggle: A(5) }, says: /"details" is 7001 bytes/ },
    { what: 'a parent at level 14', action: 'create-child', params: { admin: L14, details: 'x', maxSupply: 1, eligibility: A(5), toggle: A(5) }, says: /level 14 .* cannot have children/ },
    { what: 'non-ASCII details of 7002 bytes (3501 characters)', action: 'create-child', params: { admin: C1, details: 'é'.repeat(3501), maxSupply: 1, eligibility: A(5), toggle: A(5) }, says: /"details" is 7002 bytes/ },
    { what: 'a parent with 65535 children made', over: { hats: { [C2]: { last: 65535 } } }, action: 'create-child', params: { admin: C2, details: 'x', maxSupply: 1, eligibility: A(5), toggle: A(5) }, says: /0x0000000d.0002 has no room for another child \(65535 are made\)/ },
    { what: 'a transfer of an inactive hat', over: { wears: [wearing(A(4), C3)] }, action: 'transfer-hat', params: { hat: C3, from: A(4), to: A(3) }, says: '0x0000000d.0003 is not active' },
    { what: 'a change to the details the hat already has', action: 'change-details', params: { hat: C1, details: 'Stewards' }, says: '0x0000000d.0001 already reads these details' },
    { what: 'a max supply above 2^32-1', action: 'create-child', params: { admin: C1, details: 'x', maxSupply: '4294967296', eligibility: A(5), toggle: A(5) }, says: /"maxSupply" .*4294967295/ },
    { what: 'a max supply of 0', action: 'create-child', params: { admin: C1, details: 'x', maxSupply: 0, eligibility: A(5), toggle: A(5) }, says: /"maxSupply".*at least 1/ },
    { what: 'a mutable flag that is neither true nor false', action: 'create-child', params: { admin: C1, details: 'x', maxSupply: 1, eligibility: A(5), toggle: A(5), mutable: 'yes' }, says: /"mutable".*true.*false/ },
    { what: 'new details on an immutable hat', action: 'change-details', params: { hat: C4, details: 'x' }, says: /0x0000000d\.0004 is immutable/ },
    { what: 'a hat outside the tree', action: 'change-details', params: { hat: topHatId(14), details: 'x' }, says: /not in tree 13/ },
  ]
  for (const c of cases) {
    it(`${c.what}: a sentence, nothing prepared`, async () => {
      const w = world({ admins: VIA_ADMIN, ...c.over })
      const r = await w.prepare(c.action, c.params, VIA)
      if (typeof c.says === 'string') expect(refused(r)).toContain(c.says); else expect(refused(r)).toMatch(c.says)
      expect(r).not.toHaveProperty('failed')
      expect(w.gets()).toHaveLength(0)
    })
  }

  it('a via Safe that is not an admin: "<via> is not an admin of <pretty>", no Safe read', async () => {
    for (const [action, params, pretty] of [
      ['mint-hat', { hat: C1, wearer: A(3) }, '0x0000000d.0001'],
      ['transfer-hat', { hat: C1, from: A(4), to: A(3) }, '0x0000000d.0001'],
      ['change-details', { hat: C1, details: 'x' }, '0x0000000d.0001'],
      ['create-child', { admin: C1, details: 'x', maxSupply: 1, eligibility: A(5), toggle: A(5) }, '0x0000000d.0001.0002'],
    ] as const) {
      const w = world({ wears: [wearing(A(4), C1)] })
      expect(refused(await w.prepare(action, params, VIA))).toBe(`${SAFE_ADDR} is not an admin of ${pretty}`)
      expect(w.gets()).toHaveLength(0)
    }
  })

  it('a top hat may be renamed though it is immutable', async () => {
    const w = world({ admins: [SAFE_ADMIN(TOP)] })
    const r = ok(await w.prepare('change-details', { hat: TOP, details: 'The commons' }, VIA))
    expect(r.steps[0]!.call.data).toBe(encodeCall('changeHatDetails(uint256,string)', [BigInt(TOP), 'The commons']))
  })

  it('a read the node cannot answer is a failed read, not a refusal', async () => {
    const w = world()
    const broken: FetchLike = async (url, init) => (init.method === 'POST' ? { ok: false, status: 502, json: async () => ({}) } : w.fetch(url, init))
    const r = await new SystemReader({ repo: '/nonexistent', fetch: broken, drivers: [{ ...hatsTree, minGapMs: 0 }], now: () => NOW, sleep: async () => {} })
      .prepareAction(SYSTEM, { ...governance, action: 'mint-hat', params: { hat: C1, wearer: A(3) } }, null)
    expect(r).toMatchObject({ ok: false, failed: true })
  })

  it('an action of another class is refused by the reader before any read', async () => {
    const w = world()
    const r = await w.prepare('mint-hat', { hat: C1, wearer: A(3) }, null, { proposal: { classes: ['members'] } })
    expect(refused(r)).toMatch(/class governance/)
    expect(w.seen).toHaveLength(0)
  })
})

describe('transfer-hat', () => {
  it('prepares transferHat and attaches the wearer it goes to', async () => {
    const w = world({ wears: [wearing(A(4), C1)], admins: [SAFE_ADMIN(C1)] })
    const r = ok(await w.prepare('transfer-hat', { hat: C1, from: A(4), to: A(3) }, VIA))
    expect(r.steps[0]!.call.data).toBe(encodeCall('transferHat(uint256,address,address)', [BigInt(C1), A(4), A(3)]))
    expect(r.steps[0]!.call.summary).toBe(`transfer 0x0000000d.0001 from ${S(A(4))} to ${S(A(3))}`)
    expect(r.steps[0]!.safe).not.toBeNull()
    expect(r.attach).toEqual({ system: 'hats', id: hatRef(CELO, C1), payload: { kind: 'hats-wearer', wearer: `${CELO}:${A(3).replace('a3', 'A3')}` } })
  })
  it('a revoked (ineligible) holder can be moved from: the contract checks the stored balance', async () => {
    const w = world({ admins: [SAFE_ADMIN(C1)] }) // A(8) wears nothing by isWearerOfHat and is not eligible: revoked
    const r = ok(await w.prepare('transfer-hat', { hat: C1, from: A(8), to: A(3) }, VIA))
    expect(r.steps[0]!.call.summary).toBe(`transfer 0x0000000d.0001 from ${S(A(8))} to ${S(A(3))}; the contract checks ${S(A(8))}'s stored balance`)
    expect(r.steps[0]!.call.data).toBe(encodeCall('transferHat(uint256,address,address)', [BigInt(C1), A(8), A(3)]))
  })
  it('a top hat moves though it is immutable', async () => {
    const w = world({ wears: [wearing(A(4), TOP)] })
    const r = ok(await w.prepare('transfer-hat', { hat: TOP, from: A(4), to: A(3) }))
    expect(r.steps[0]!.signer).toEqual({ kind: 'wearer', hat: hatRef(CELO, TOP) })
  })
})

describe('non-ASCII details', () => {
  it('7000 bytes of two-byte characters are accepted', async () => {
    const r = ok(await world().prepare('change-details', { hat: C1, details: 'é'.repeat(3500) }))
    expect(r.steps[0]!.call.summary).toBe('change the details of 0x0000000d.0001')
  })
})

describe('create-child', () => {
  const params = { admin: '0x0000000d.0001', details: 'Scribes', maxSupply: 3, eligibility: A(5), toggle: A(6) }
  it('predicts the new id from the admin\'s lastHatId', async () => {
    const w = world({ admins: [SAFE_ADMIN(childHatId(C1, 2))] })
    const r = ok(await w.prepare('create-child', params, VIA))
    const child = childHatId(C1, 2)
    expect(r.steps[0]!.call.summary).toBe('create hat 0x0000000d.0001.0002 under 0x0000000d.0001')
    expect(r.steps[0]!.call.data).toBe(encodeCall('createHat(uint256,string,uint32,address,address,bool,string)', [BigInt(C1), 'Scribes', 3, A(5), A(6), true, '']))
    expect(r.steps[0]!.safe).not.toBeNull()
    expect(r.attach).toEqual({ system: 'hats', id: hatRef(CELO, child), payload: { kind: 'hats-hat', details: 'Scribes' } })
    const checked = hatsTree.checkRef!(SYSTEM, r.attach)
    expect(checked).toEqual({ ok: true, ref: r.attach })
  })
  it('mutable false and an image are passed to the contract; without via the admin hat\'s wearers sign', async () => {
    const r = ok(await world().prepare('create-child', { ...params, mutable: 'false', imageURI: 'ipfs://x' }))
    expect(r.steps[0]!.call.data).toBe(encodeCall('createHat(uint256,string,uint32,address,address,bool,string)', [BigInt(C1), 'Scribes', 3, A(5), A(6), false, 'ipfs://x']))
    expect(r.steps[0]!.signer).toEqual({ kind: 'wearer', hat: hatRef(CELO, C1) })
  })
  it('a level-13 admin may have a child at level 14', async () => {
    const r = ok(await world().prepare('create-child', { ...params, admin: L13 }))
    expect(r.steps[0]!.call.summary).toContain(prettyHatId(L14))
  })
})

describe('change-details', () => {
  it('attaches the existing hat with the new details', async () => {
    const r = ok(await world().prepare('change-details', { hat: C1, details: 'Stewards of the commons' }))
    expect(r.steps[0]!.call.summary).toBe('change the details of 0x0000000d.0001')
    expect(r.attach).toEqual({ system: 'hats', id: hatRef(CELO, C1), payload: { kind: 'hats-hat', details: 'Stewards of the commons', existing: true } })
  })
})

describe('outcomes', () => {
  const out = (w: ReturnType<typeof world>, ref: ForeignRef) => hatsTree.outcome!(SYSTEM, ref, { ...w.ctx(), opened: '2026-10-29T11:00:00Z' })
  const wearerRef = (hat: string, wearer: string): ForeignRef => ({ system: 'hats', id: hatRef(CELO, hat), payload: { kind: 'hats-wearer', wearer: `${CELO}:${wearer}` } })
  const hatRefOf = (hat: string, details: string, existing = false): ForeignRef =>
    ({ system: 'hats', id: hatRef(CELO, hat), payload: { kind: 'hats-hat', details, ...(existing ? { existing: true as const } : {}) } })
  const A3C = '0x00000000000000000000000000000000000000A3'

  it('a worn hat is executed, an unworn one pending', async () => {
    const w = world({ wears: [wearing(A3C, C1)] })
    expect(await out(w, wearerRef(C1, A3C))).toEqual({ ok: true, outcome: 'executed', detail: `${S(A(3))} wears 0x0000000d.0001` })
    expect(w.posts()).toHaveLength(1)
    expect(await out(world(), wearerRef(C1, A3C))).toMatchObject({ ok: true, outcome: 'pending' })
  })
  it('a created hat is executed; unmade, pending; the id taken by other details, mismatch', async () => {
    const child = childHatId(C1, 2)
    expect(await out(world({ hats: { [child]: { details: 'Scribes', max: 3, supply: 0 } } }), hatRefOf(child, 'Scribes'))).toEqual({ ok: true, outcome: 'executed', detail: '0x0000000d.0001.0002 exists' })
    expect(await out(world(), hatRefOf(child, 'Scribes'))).toEqual({ ok: true, outcome: 'pending', detail: '0x0000000d.0001.0002 is not created yet' })
    expect(await out(world({ hats: { [child]: { details: 'Other', max: 1, supply: 0 } } }), hatRefOf(child, 'Scribes'))).toEqual({ ok: true, outcome: 'mismatch', detail: 'another hat took this id; prepare again' })
  })
  it('an existing hat renamed: executed when the details match, pending when not, never a mismatch', async () => {
    expect(await out(world(), hatRefOf(C1, 'Stewards', true))).toEqual({ ok: true, outcome: 'executed', detail: '0x0000000d.0001 reads the new details' })
    expect(await out(world(), hatRefOf(C1, 'New', true))).toEqual({ ok: true, outcome: 'pending', detail: '0x0000000d.0001 still has other details' })
  })
  it('a Safe transaction ref, a Snapshot ref or a hat of another tree is not read here', async () => {
    const w = world()
    await expect(hatsTree.outcome!(SYSTEM, { system: 'hats', id: '0x1', payload: { to: HATS, value: '0', data_hash: '0x', operation: 0, nonce: 1 } }, { ...w.ctx(), opened: '' })).rejects.toThrow(/Hats tree reads/)
    await expect(out(w, { system: 'hats', id: hatRef(CELO, C1), payload: { kind: 'snapshot-proposal', choice: 'For' } })).rejects.toThrow(/Hats tree reads/)
    await expect(out(w, wearerRef(topHatId(14), A3C))).rejects.toThrow(/not in tree 13/)
    expect(w.seen).toHaveLength(0)
  })
  it('a Safe reads a Safe transaction hash, not a foreign ref', async () => {
    await expect(safe.outcome!(VIA, { system: 'council', id: hatRef(CELO, C1), payload: { kind: 'gardens-proposal' } }, { ...world().ctx(), opened: '' })).rejects.toThrow('a Safe reads a Safe transaction hash')
  })
})

describe('checkRef', () => {
  const good = { system: 'hats', id: hatRef(CELO, C1), payload: { kind: 'hats-wearer', wearer: `${CELO}:${A(3).replace('a3', 'A3')}` } }
  const check = (raw: unknown) => hatsTree.checkRef!(SYSTEM, raw)
  it('accepts the refs an author attaches and returns them normalised', () => {
    expect(check(good)).toEqual({ ok: true, ref: good })
    expect(check({ ...good, id: hatRef(CELO, C1).toUpperCase().replace('EIP155', 'eip155').replace(/0X/, '0x') })).toMatchObject({ ok: true, ref: { id: hatRef(CELO, C1) } })
    const renamed = { system: 'hats', id: hatRef(CELO, C1), payload: { kind: 'hats-hat', details: 'x', existing: true } }
    expect(check(renamed)).toEqual({ ok: true, ref: renamed })
    expect(check({ ...renamed, payload: { kind: 'hats-hat', details: 'x' } })).toMatchObject({ ok: true })
  })
  it('refuses with a sentence', () => {
    const bad: [string, unknown, RegExp][] = [
      ['not an object', 'hat', /ref/],
      ['another system', { ...good, system: 'other' }, /system/],
      ['a hat of another tree', { ...good, id: hatRef(CELO, topHatId(14)) }, /not in tree 13/],
      ['a hat of another chain', { ...good, id: hatRef('eip155:10', C1) }, /eip155:10/],
      ['an id that is not a hat ref', { ...good, id: C1 }, /hat ref/],
      ['a wearer on another chain', { ...good, payload: { kind: 'hats-wearer', wearer: `eip155:10:${A(3)}` } }, /eip155:42220/],
      ['a wearer that is a bare address', { ...good, payload: { kind: 'hats-wearer', wearer: A(3) } }, /CAIP-10/],
      ['details that are not text', { ...good, payload: { kind: 'hats-hat', details: 7 } }, /details/],
      ['existing: false', { ...good, payload: { kind: 'hats-hat', details: 'x', existing: false } }, /existing/],
      ['existing: "yes"', { ...good, payload: { kind: 'hats-hat', details: 'x', existing: 'yes' } }, /existing/],
      ['a payload kind of another system', { ...good, payload: { kind: 'snapshot-proposal', choice: 'For' } }, /hats-wearer|hats-hat/],
      ['no payload', { system: 'hats', id: good.id }, /payload/],
    ]
    for (const [what, raw, says] of bad) {
      const r = check(raw)
      expect(r.ok, what).toBe(false)
      expect((r as { error: string }).error, what).toMatch(says)
    }
  })
})
