import { describe, it, expect } from 'vitest'
import { hatsTree, HATS_ACTIONS } from '../../server/systems/hats.ts'
import { safe } from '../../server/systems/safe.ts'
import { SystemReader } from '../../server/systems/reader.ts'
import { guardedFetch, guardedPost, type DriverContext, type FetchLike, type ForeignRef } from '../../server/systems/driver.ts'
import { CHAINS } from '../../server/systems/chains.ts'
import { HATS_SIGNATURES, topHatId, childHatId, hatRef, VIEW_HAT_TYPES } from '../../lib/hats.mjs'
import { decodeResult, encodeArgs, encodeCall, selector } from '../../lib/abi.mjs'
import { checksumAddress } from '../../lib/caip.mjs'
import { safeTxHash } from '../../lib/safe-tx.mjs'

// Hats `add-role` on an existing tree (DAO-OS L7 §10, Q67 phase 2): a new hat under an admin hat and its first wearers,
// one Safe transaction the admin Safe signs (the two calls through MultiSendCallOnly, OQ-1), or two calls the admin
// hat's wearers sign. No test touches the
// network: one fake answers forno.celo.org's JSON-RPC from recorded answers shaped like a Celo tree, and
// api.safe.global's Safe info for a placeholder Safe. The tree id 0x00000021 and every account are placeholders. The
// contract's checks and its id scheme are those of Hats.sol @ cccb71a (createHat, getNextId, mintHat, batchMintHats;
// HatsIdUtilities.buildHatId).

const CELO = 'eip155:42220'
const HATS = '0x3bc1A0Ad72417f2d411118085256fC53CBdDd137'
const SAFE = checksumAddress('0x0000000000000000000000000000000000005afe')
const TREE = '0x00000021'
const SYSTEM = { id: 'council-tree', kind: 'hats-tree', chain: CELO, address: TREE, driver: 'hats-tree' }
const VIA = { id: 'council-safe', kind: 'safe', name: 'Council', chain: CELO, address: SAFE, driver: 'safe' }
const NOW = new Date('2026-10-30T12:00:00Z')
const A = (n: number) => checksumAddress(`0x${'0'.repeat(38)}a${n}`)
const ZERO = '0x0000000000000000000000000000000000000000'
const TOP = topHatId(TREE), COUNCIL = childHatId(TOP, 1)
/** The Council hat has made two children, so the next one is .0001.0003 (getNextId: lastHatId + 1). */
const CHILD = childHatId(COUNCIL, 3)
const PRETTY = '0x00000021.0001.0003'
const ELIG = `0x${'0'.repeat(38)}70`, TOGGLE = `0x${'0'.repeat(38)}71`
const governance = { proposal: { classes: ['governance'] } }
const SAFE_INFO = {
  address: SAFE, nonce: '4', threshold: 2, owners: [A(1), A(2), A(3)], masterCopy: `0x${'0'.repeat(38)}a0`, modules: [],
  fallbackHandler: `0x${'0'.repeat(38)}f0`, guard: ZERO, moduleGuard: ZERO, version: '1.4.1+L2',
}

interface HatState { details: string; max: number; supply: number; last?: number; mutable?: boolean }
const BASE: Record<string, HatState> = {
  [TOP]: { details: 'Test DAO', max: 1, supply: 1, last: 1 },
  [COUNCIL]: { details: 'Council', max: 1, supply: 1, last: 2, mutable: true },
}

/** What the chain says. `wears`, `admins`, `ineligible`: "<address lowercase>|<hat id>" pairs. */
function world(over: { hats?: Record<string, HatState>; wears?: string[]; admins?: string[]; ineligible?: string[] } = {}) {
  const hats: Record<string, HatState> = { ...BASE, ...over.hats }
  const wears = new Set(over.wears ?? []), ineligible = new Set(over.ineligible ?? [])
  const admins = new Set(over.admins ?? [`${SAFE.toLowerCase()}|${CHILD}`])
  const seen: { method: 'GET' | 'POST'; url: string }[] = []
  const word = (data: string, i: number) => data.slice(10 + 64 * i, 74 + 64 * i)
  const idAt = (data: string, i: number) => '0x' + word(data, i)
  const addrAt = (data: string, i: number) => '0x' + word(data, i).slice(24)
  const yes = (b: boolean) => '0x' + (b ? '1' : '0').padStart(64, '0')
  const answer = (data: string): string | null => {
    const sel = data.slice(0, 10)
    if (sel === selector('viewHat(uint256)')) {
      const h = hats[idAt(data, 0)]
      return h
        ? encodeArgs(VIEW_HAT_TYPES, [h.details, h.max, h.supply, ELIG, TOGGLE, '', h.last ?? 0, h.mutable ?? false, true])
        : encodeArgs(VIEW_HAT_TYPES, ['', 0, 0, ZERO, ZERO, '', 0, false, false])
    }
    if (sel === selector('isWearerOfHat(address,uint256)')) return yes(wears.has(`${addrAt(data, 0)}|${idAt(data, 1)}`))
    if (sel === selector('isEligible(address,uint256)')) return yes(!ineligible.has(`${addrAt(data, 0)}|${idAt(data, 1)}`))
    if (sel === selector('isAdminOfHat(address,uint256)')) return yes(admins.has(`${addrAt(data, 0)}|${idAt(data, 1)}`))
    return null
  }
  const fetch: FetchLike = async (url, init) => {
    if (init.method === 'GET') {
      seen.push({ method: 'GET', url })
      return url === `https://api.safe.global/tx-service/celo/api/v1/safes/${SAFE}/`
        ? { ok: true, status: 200, json: async () => SAFE_INFO } : { ok: false, status: 404, json: async () => ({}) }
    }
    seen.push({ method: 'POST', url })
    const body = JSON.parse(init.body!)
    const replies = (body as { id: number; method: string; params: [{ to: string; data: string }] }[]).map(r => {
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
  const prepare = (params: Record<string, unknown>, via: typeof VIA | null = VIA) => reader().prepareAction(SYSTEM, { ...governance, action: 'add-role', params }, via)
  return { seen, ctx, prepare, gets: () => seen.filter(s => s.method === 'GET') }
}
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r)}`); return r as Extract<T, { ok: true }> }
const refused = <T extends { ok: boolean }>(r: T): string => { if (r.ok) throw new Error(`expected a refusal: ${JSON.stringify(r)}`); return (r as unknown as { error: string }).error }
const S = (a: string) => { const c = checksumAddress(a); return `${c.slice(0, 6)}…${c.slice(-4)}` }
const wearing = (account: string, hat: string) => `${account.toLowerCase()}|${hat}`
const ROLE = { admin: '0x00000021.0001', details: 'Stewards', maxSupply: 3, wearers: [A(1), A(2), A(3)], eligibility: ELIG, toggle: TOGGLE }

describe('the add-role action and its signatures', () => {
  it('is a governance action of the hats-tree driver with the planned inputs', () => {
    const spec = HATS_ACTIONS.find(a => a.id === 'add-role')!
    expect(spec).toMatchObject({ label: 'Add a role: a new hat and its first wearers', class: 'governance' })
    expect(spec.params.map(p => `${p.name}:${p.type}${p.optional ? '?' : ''}`)).toEqual([
      'admin:hat', 'details:text', 'maxSupply:uint', 'wearers:addresses', 'eligibility:address', 'toggle:address', 'mutable:string?', 'imageURI:string?'])
  })
  it('HATS_SIGNATURES holds the batch calls and lastTopHatId, as Hats.sol @ cccb71a declares them', () => {
    expect(HATS_SIGNATURES.batchMintHats).toBe('batchMintHats(uint256[],address[])')
    expect(HATS_SIGNATURES.batchCreateHats).toBe('batchCreateHats(uint256[],string[],uint32[],address[],address[],bool[],string[])')
    expect(HATS_SIGNATURES.lastTopHatId).toBe('lastTopHatId()')
  })
})

describe('add-role via the admin Safe', () => {
  // OQ-1 (PF-R192, replacing "two Safe transactions on nonces n and n+1"): one Safe transaction, so that no other hat is
  // created under the admin between the two calls: the child id cannot move between them; a move before execution reads
  // as a mismatch (PF-R200, the hats-role outcome below). The Safe delegatecalls
  // MultiSendCallOnly 1.4.1 (outer operation 1), whose inner calls (operation 0) go to Hats. Its address is the canonical
  // one on every chain the driver reads (safe-deployments @ ca9cb0d2 src/assets/v1.4.1/multi_send_call_only.json).
  const CALL_ONLY = '0x9641d764fc13c8B624c04430C7356C1C7C8102e2'
  /** multiSend(bytes)'s packed transactions: operation (1) ‖ to (20) ‖ value (32) ‖ data length (32) ‖ data. */
  const unpack = (data: string) => {
    expect(data.slice(0, 10)).toBe(selector('multiSend(bytes)'))
    const [packed] = decodeResult(['bytes'], '0x' + data.slice(10)) as [string]
    const out: { operation: number; to: string; value: bigint; data: string }[] = []
    for (let at = 2; at < packed.length;) {
      const operation = parseInt(packed.slice(at, at + 2), 16); at += 2
      const to = '0x' + packed.slice(at, at + 40); at += 40
      const value = BigInt('0x' + packed.slice(at, at + 64)); at += 64
      const length = Number(BigInt('0x' + packed.slice(at, at + 64))); at += 64
      out.push({ operation, to, value, data: '0x' + packed.slice(at, at + 2 * length) }); at += 2 * length
    }
    return out
  }

  it('one Safe transaction, operation 1 to MultiSendCallOnly: createHat, then batchMintHats of the predicted child to every wearer', async () => {
    const w = world()
    const r = ok(await w.prepare(ROLE))
    expect(r).toMatchObject({ action: 'add-role', draft: null, link: 'https://app.hatsprotocol.xyz/trees/42220/33' })
    expect(r.steps).toHaveLength(1)
    const [step] = r.steps as [typeof r.steps[0]]
    expect(step.call).toMatchObject({ chain: CELO, to: `${CELO}:${CALL_ONLY}`, value: '0', operation: 1 })
    const [create, mint] = unpack(step.call.data)
    expect(create).toEqual({ operation: 0, to: HATS.toLowerCase(), value: 0n,
      data: encodeCall('createHat(uint256,string,uint32,address,address,bool,string)', [BigInt(COUNCIL), 'Stewards', 3, ELIG, TOGGLE, true, '']) })
    expect(mint!.operation).toBe(0)
    expect(mint!.to).toBe(HATS.toLowerCase())
    expect(mint!.data.slice(0, 10)).toBe(selector('batchMintHats(uint256[],address[])'))
    const [ids, wearers] = decodeResult(['uint256[]', 'address[]'], '0x' + mint!.data.slice(10)) as [string[], string[]]
    expect(ids).toEqual([CHILD, CHILD, CHILD].map(id => BigInt(id).toString()))
    expect(wearers.map(a => a.toLowerCase())).toEqual([A(1), A(2), A(3)].map(a => a.toLowerCase()))
    expect(step.call.summary).toBe(`create hat ${PRETTY} under 0x00000021.0001, then mint ${PRETTY} to ${S(A(1))}, ${S(A(2))}, ${S(A(3))}: one Safe transaction (MultiSendCallOnly ${CALL_ONLY})`)
    expect(step.signer).toEqual({ kind: 'safe', account: `${CELO}:${SAFE}` })
    expect(step.safe!.payload).toMatchObject({ to: CALL_ONLY, data: step.call.data, operation: 1, nonce: 4 })
    expect(step.safe!.ref.id).toBe(safeTxHash({ chainId: 42220, safe: SAFE, ...step.safe!.payload }))
    expect(r.attach).toEqual({ system: 'council-tree', id: hatRef(CELO, CHILD),
      payload: { kind: 'hats-role', details: 'Stewards', wearers: [A(1), A(2), A(3)].map(a => `${CELO}:${a}`) } })
    expect(hatsTree.checkRef!(SYSTEM, r.attach)).toEqual({ ok: true, ref: r.attach })
    expect(w.gets()).toHaveLength(1)
  })

  it('without via: two calls the admin hat\'s wearers sign, no Safe transaction', async () => {
    const w = world()
    const r = ok(await w.prepare({ ...ROLE, mutable: 'false', imageURI: 'ipfs://x' }, null))
    expect(r.steps).toHaveLength(2)
    expect(r.steps[0]!.call.data).toBe(encodeCall('createHat(uint256,string,uint32,address,address,bool,string)', [BigInt(COUNCIL), 'Stewards', 3, ELIG, TOGGLE, false, 'ipfs://x']))
    for (const s of r.steps) {
      expect(s.signer).toEqual({ kind: 'wearer', hat: hatRef(CELO, COUNCIL) })
      expect(s.safe).toBeNull()
    }
    expect(w.gets()).toHaveLength(0)
  })
})

describe('add-role refusals, before anything is prepared', () => {
  const cases: { what: string; over?: Parameters<typeof world>[0]; params: Record<string, unknown>; says: string | RegExp }[] = [
    { what: 'more wearers than maxSupply', params: { ...ROLE, maxSupply: 2 }, says: '3 wearers, and the hat has room for 2' },
    { what: 'a wearer listed twice', params: { ...ROLE, wearers: [A(1), A(2), A(1).toLowerCase()] }, says: `${S(A(1))} is listed twice` },
    { what: 'an ineligible wearer', over: { ineligible: [wearing(A(2), CHILD)] }, params: ROLE, says: `${S(A(2))} is not eligible for ${PRETTY}` },
    { what: 'a Safe that is not an admin', over: { admins: [] }, params: ROLE, says: `${SAFE} is not an admin of ${PRETTY}` },
    // create-child's own
    { what: 'a zero eligibility module', params: { ...ROLE, eligibility: ZERO }, says: /eligibility.*zero/ },
    { what: 'a zero toggle module', params: { ...ROLE, toggle: ZERO }, says: /toggle.*zero/ },
    { what: 'a max supply of 0', params: { ...ROLE, maxSupply: 0 }, says: /"maxSupply".*at least 1/ },
    { what: 'an admin that does not exist', params: { ...ROLE, admin: childHatId(TOP, 9) }, says: /0x00000021\.0009 does not exist/ },
    { what: 'an admin of another tree', params: { ...ROLE, admin: topHatId(13) }, says: /not in tree 33/ },
    { what: 'an admin with 65535 children', over: { hats: { [COUNCIL]: { details: 'Council', max: 1, supply: 1, last: 65535 } } }, params: ROLE, says: /has no room for another child/ },
  ]
  for (const c of cases) {
    it(`${c.what}: a sentence, no Safe read`, async () => {
      const w = world(c.over)
      const r = await w.prepare(c.params)
      if (typeof c.says === 'string') expect(refused(r)).toBe(c.says); else expect(refused(r)).toMatch(c.says)
      expect(r).not.toHaveProperty('failed')
      expect(w.gets()).toHaveLength(0)
    })
  }
})

describe('the hats-role outcome', () => {
  const ref: ForeignRef = { system: 'council-tree', id: hatRef(CELO, CHILD), payload: { kind: 'hats-role', details: 'Stewards', wearers: [A(1), A(2), A(3)].map(a => `${CELO}:${a}`) } }
  const out = (w: ReturnType<typeof world>) => hatsTree.outcome!(SYSTEM, ref, { ...w.ctx(), opened: '2026-10-30T11:00:00Z' })
  // Created, the hat is the Council's third child: its lastHatId reads 3, and the hat is its newest (the gaps review's M-2).
  const made = { [CHILD]: { details: 'Stewards', max: 3, supply: 3, mutable: true }, [COUNCIL]: { ...BASE[COUNCIL]!, last: 3 } }
  const all = [A(1), A(2), A(3)].map(a => wearing(a, CHILD))

  it('the hat exists with those details and every wearer wears it: executed', async () => {
    expect(await out(world({ hats: made, wears: all }))).toEqual({ ok: true, outcome: 'executed', detail: `${PRETTY} exists and its 3 wearers wear it`, exists: true, newest: true })
  })
  it('one wearer does not wear it yet: pending, naming who', async () => {
    expect(await out(world({ hats: made, wears: all.slice(0, 2) }))).toEqual({ ok: true, outcome: 'pending', detail: `${S(A(3))} does not wear ${PRETTY} yet`, exists: true, newest: true })
  })
  it('created, and another hat made under the admin since: not its newest (M-2)', async () => {
    expect(await out(world({ hats: { ...made, [COUNCIL]: { ...BASE[COUNCIL]!, last: 4 } }, wears: all }))).toMatchObject({ outcome: 'executed', exists: true, newest: false })
  })
  it('not created yet: pending', async () => {
    expect(await out(world())).toEqual({ ok: true, outcome: 'pending', detail: `${PRETTY} is not created yet`, exists: false })
  })
  // fix I-3 (PF-R200): the bundle closes the gap between the two calls, not between prepare and execution. While the hat
  // is not created, the outcome also reads the admin's lastHatId: moved past the predicted child - 1 (here 2), another
  // hat was created under the admin, and executing would create another id than the one the mint names.
  it('not created yet and the admin\'s lastHatId unmoved: pending', async () => {
    expect(await out(world({ hats: { [COUNCIL]: { details: 'Council', max: 1, supply: 1, last: 2, mutable: true } } })))
      .toEqual({ ok: true, outcome: 'pending', detail: `${PRETTY} is not created yet`, exists: false })
  })
  it('not created yet and the admin\'s lastHatId moved past it: mismatch, prepare it again', async () => {
    expect(await out(world({ hats: { [COUNCIL]: { details: 'Council', max: 1, supply: 1, last: 3, mutable: true } } })))
      .toEqual({ ok: true, outcome: 'mismatch', detail: 'Another hat was created under the admin since this was prepared: prepare it again.', exists: false })
  })
  it('other details at that id: mismatch', async () => {
    expect(await out(world({ hats: { [CHILD]: { details: 'Scribes', max: 3, supply: 0 } }, wears: all })))
      .toEqual({ ok: true, outcome: 'mismatch', detail: 'another hat took this id; prepare again', exists: true })
  })
})

describe('checkRef reads a hats-role payload', () => {
  const good = { system: 'council-tree', id: hatRef(CELO, CHILD), payload: { kind: 'hats-role', details: 'Stewards', wearers: [`${CELO}:${A(1)}`, `${CELO}:${A(2)}`] } }
  const check = (raw: unknown) => hatsTree.checkRef!(SYSTEM, raw)
  it('accepts it, wearers in CAIP-10 checksum form', () => {
    expect(check(good)).toEqual({ ok: true, ref: good })
    expect(check({ ...good, payload: { ...good.payload, wearers: [`${CELO}:${A(1).toLowerCase()}`, `${CELO}:${A(2)}`] } })).toEqual({ ok: true, ref: good })
  })
  it('refuses with a sentence', () => {
    const bad: [string, unknown, RegExp][] = [
      ['details that are not text', { ...good, payload: { ...good.payload, details: 7 } }, /details/],
      ['no wearers', { ...good, payload: { ...good.payload, wearers: [] } }, /wearers/],
      ['a bare address', { ...good, payload: { ...good.payload, wearers: [A(1)] } }, /CAIP-10/],
      ['a wearer on another chain', { ...good, payload: { ...good.payload, wearers: [`eip155:10:${A(1)}`] } }, /eip155:42220/],
      ['a wearer twice', { ...good, payload: { ...good.payload, wearers: [`${CELO}:${A(1)}`, `${CELO}:${A(1).toLowerCase()}`] } }, /twice/],
    ]
    for (const [what, raw, says] of bad) {
      const r = check(raw)
      expect(r.ok, what).toBe(false)
      expect((r as { error: string }).error, what).toMatch(says)
    }
  })
})
