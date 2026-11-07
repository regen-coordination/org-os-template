import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { hatsTree, readWearer, readWearers, HATS_MAX, HOLDER_PAGES } from '../../server/systems/hats.ts'
import { SystemReader, systemAttention } from '../../server/systems/reader.ts'
import { guardedFetch, guardedPost, READ_RPC_METHODS, type DriverContext, type FetchLike } from '../../server/systems/driver.ts'
import { CHAINS } from '../../server/systems/chains.ts'
import { topHatId, childHatId, hatRef, treeRef } from '../../lib/hats.mjs'
import { encodeArgs } from '../../lib/abi.mjs'
import { VIEW_HAT_TYPES } from '../../lib/hats.mjs'

// Synthetic fixtures in the recorded shapes (tests/systems/fixtures/hats-celo/): viewHat answers (the top hat's is the answer
// Hats v1 gave for tree 13 on Celo, the decode vector of tests/lib/abi.test.ts), isWearerOfHat answers, and Blockscout
// token-holder pages (shape recorded from celo.blockscout.com 2026-10-29).
const DIR = new URL('./fixtures/hats-celo/', import.meta.url)
const load = <T>(file: string): T => JSON.parse(readFileSync(new URL(file, DIR), 'utf8')) as T
const CALLS = load<Record<string, string>>('calls.json')
const CELO = 'eip155:42220', OP = 'eip155:10'
const SYSTEM = { id: 'hats', kind: 'hats-tree', chain: CELO, address: '13', driver: 'hats-tree' }
const NOW = new Date('2026-10-29T12:00:00Z')
const BLOCK = 0x4d9410e
const TOP = topHatId(13), C1 = childHatId(TOP, 1), C2 = childHatId(TOP, 2), C3 = childHatId(TOP, 3), G = childHatId(C1, 1)
const A = (n: number) => `0x${'0'.repeat(38)}a${n}`
const CS = (n: number) => ({ 1: '0x00000000000000000000000000000000000000A1', 2: '0x00000000000000000000000000000000000000A2', 3: '0x00000000000000000000000000000000000000A3', 4: '0x00000000000000000000000000000000000000a4', 9: '0x00000000000000000000000000000000000000A9', 5: '0x00000000000000000000000000000000000000A5' } as Record<number, string>)[n]
const DEC = (id: string) => BigInt(id).toString()
const HOLDER_FILES: Record<string, string> = { [DEC(TOP)]: '13.json', [DEC(C1)]: '13.1.json', [DEC(G)]: '13.1.1.json', [DEC(C3)]: '13.3.json' }

type Seen = { method: 'GET' | 'POST'; url: string; body?: any }
function world(over: { calls?: Record<string, string>; chainCalls?: boolean } = {}) {
  const seen: Seen[] = []
  const calls = over.calls ?? CALLS
  const fetch: FetchLike = async (url, init) => {
    if (init.method === 'GET') {
      seen.push({ method: 'GET', url })
      const m = /^https:\/\/([^/]+)\/api\/v2\/tokens\/0x3bc1A0Ad72417f2d411118085256fC53CBdDd137\/instances\/(\d+)\/holders(\?(.*))?$/.exec(url)
      const file = m ? (m[4] ? HOLDER_FILES[m[2]]?.replace('.json', '.page2.json') : HOLDER_FILES[m[2]]) : undefined
      return { ok: !!file, status: file ? 200 : 404, json: async () => (file ? load(`holders/${file}`) : {}) }
    }
    const body = JSON.parse(init.body!)
    seen.push({ method: 'POST', url, body })
    const answer = [...body].reverse().map((r: any) => {
      if (r.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: r.id, result: '0x' + BLOCK.toString(16) }
      const hit = calls[`${r.params[0].to.toLowerCase()}|${r.params[0].data}`]
      return hit === undefined ? { jsonrpc: '2.0', id: r.id, error: { code: 3, message: 'execution reverted' } } : { jsonrpc: '2.0', id: r.id, result: hit }
    })
    return { ok: true, status: 200, json: async () => answer }
  }
  const ctx = (members: Record<string, unknown>[] = []): DriverContext => ({
    fetchJson: guardedFetch(hatsTree, fetch, new AbortController().signal),
    postJson: guardedPost(hatsTree, fetch, new AbortController().signal),
    rpcUrl: chain => (CHAINS[chain]?.rpc ? `https://${CHAINS[chain].rpc}/` : null),
    now: () => NOW, members,
  })
  const gets = () => seen.filter(s => s.method === 'GET')
  const posts = () => seen.filter(s => s.method === 'POST')
  return { seen, fetch, ctx, gets, posts }
}

describe('the hats-tree driver', () => {
  it('declares its name, pace, limit and hosts', () => {
    expect(hatsTree.name).toBe('hats-tree')
    expect(hatsTree.minGapMs).toBe(250)
    expect(hatsTree.timeoutMs!({})).toBe(20_000)
    expect(HATS_MAX).toBe(256)
    expect(HOLDER_PAGES).toBe(4)
    for (const c of Object.values(CHAINS)) { expect(hatsTree.hosts).toContain(c.rpc); if (c.explorer) expect(hatsTree.hosts).toContain(c.explorer) }
  })

  it('walks the tree level by level', async () => {
    const w = world()
    const read = await hatsTree.read(SYSTEM, w.ctx())
    expect(read.ok).toBe(true)
    const posts = w.posts()
    expect(posts).toHaveLength(3)
    for (const p of posts) {
      expect(p.url).toBe('https://forno.celo.org/')
      for (const r of p.body) expect(READ_RPC_METHODS).toContain(r.method)
    }
    expect(posts.map(p => p.body.length - 1)).toEqual([1, 3, 1])
    const facts = read.facts as any
    expect(facts.hats.map((h: any) => h.pretty)).toEqual(['0x0000000d', '0x0000000d.0001', '0x0000000d.0001.0001', '0x0000000d.0002', '0x0000000d.0003'])
    expect(facts.hats[1].admin).toBe(facts.hats[0].id)
    expect(facts.hats[0].admin).toBeNull()
    expect(facts.hats[0].id).toBe(hatRef(CELO, TOP))
    expect(facts.topHat).toBe(hatRef(CELO, TOP))
    expect(facts).toMatchObject({ chain: CELO, tree: 13, ref: treeRef(CELO, 13), block: BLOCK })
    expect(read.readAt).toBe(NOW.toISOString())
    expect(read.open).toEqual({ url: 'https://app.hatsprotocol.xyz/trees/42220/13', embeddable: false })
  })

  // The top hat's answer in calls.json is recorded: eth_call viewHat(0x0000000d00…00) on the Hats v1 contract,
  // https://forno.celo.org, block 81343851, 2026-10-29 (the VIEW_HAT_13 vector of tests/lib/abi.test.ts). The other hats are synthetic.
  it('reads each hat as the contract answered (the recorded top hat, then the synthetic ones)', async () => {
    const read = await hatsTree.read(SYSTEM, world().ctx())
    const [top, c1, , c2, c3] = (read.facts as any).hats
    expect(top).toMatchObject({
      level: 0, maxSupply: 1, supply: 1, lastHatId: 3, mutable: false, active: true, eligibility: null, toggle: null,
      details: 'ipfs://bafkreifjnow53ggd4gcfsqv624mqnkgkqc5oluee5cncpdbhk7xphl4t3m',
      imageURI: 'ipfs://bafkreidkxp4m4gkp3vpoq3r4pe7tdpqingewdqdnxlpom756qrgvzniufu',
    })
    expect(c1).toMatchObject({ level: 1, maxSupply: 5, supply: 2, mutable: true })
    expect(c2).toMatchObject({ maxSupply: 3, supply: 0 })
    expect(c3).toMatchObject({ eligibility: `${CELO}:0x00000000000000000000000000000000000000e1`, toggle: `${CELO}:0x0000000000000000000000000000000000000070` })
  })

  it('an empty hat is attention', async () => {
    const read = await hatsTree.read(SYSTEM, world().ctx())
    const roles = read.sections.find(s => s.title === 'Roles')!
    expect(roles.rows.map(r => r.attention)).toEqual([undefined, undefined, undefined, 'warn', undefined])
    expect(roles.rows[3].cells.slice(0, 3)).toEqual(['0x0000000d.0002', 'Convenors', '0 of 3'])
    expect(roles.rows[3].refs).toEqual([hatRef(CELO, C2)])
    expect(systemAttention(read)).toEqual({ level: 'warn', text: 'Roles: 1' })
  })

  it('shows details cut at 60 characters and a holders summary with names', async () => {
    const members = [{ id: 'ana', name: 'ana', handles: { address: A(1) } }]
    const read = await hatsTree.read(SYSTEM, world().ctx(members))
    const rows = read.sections[0].rows
    expect(rows[4].cells[1]).toHaveLength(60)
    expect(rows[4].cells[1].endsWith('…')).toBe(true)
    expect(rows[1].cells).toEqual(['0x0000000d.0001', 'Stewards: keep the commons running', '2 of 5', 'ana, 0x0000…00A2'])
    expect(rows[2].cells[3]).toBe('0x0000…00a4')
    expect(rows[3].cells[3]).toBe('—')
  })

  it('lists holders from the explorer, paged, and only for worn hats', async () => {
    const w = world()
    const read = await hatsTree.read(SYSTEM, w.ctx())
    const gets = w.gets()
    expect(gets).toHaveLength(5)
    for (const g of gets) expect(new URL(g.url).host).toBe('celo.blockscout.com')
    expect(gets.some(g => g.url.includes(DEC(C2)))).toBe(false)
    expect(gets.filter(g => g.url.includes(DEC(C1))).map(g => g.url.endsWith('?items_count=50&value=1'))).toEqual([false, true])
    const hats = (read.facts as any).hats
    expect(hats.map((h: any) => h.holders)).toEqual([
      [`${CELO}:${CS(9)}`], [`${CELO}:${CS(1)}`, `${CELO}:${CS(2)}`], [`${CELO}:${CS(4)}`], [], [`${CELO}:${CS(3)}`]])
    const wearers = read.sections.find(s => s.title === 'Wearers')!
    expect(wearers.note).toBe('static holders from celo.blockscout.com; membership is checked on chain')
    expect(wearers.rows).toHaveLength(5)
    expect(wearers.rows[1]).toEqual({ cells: ['0x0000000d.0001', CS(1), '—'], refs: [`${CELO}:${CS(1)}`, hatRef(CELO, C1)] })
  })

  it('stops following pages after HOLDER_PAGES', async () => {
    const w = world()
    const fetch2: FetchLike = async (url, init) => {
      if (init.method === 'GET' && url.includes(DEC(C1))) {
        w.seen.push({ method: 'GET', url })
        return { ok: true, status: 200, json: async () => ({ items: [{ address: { hash: A(1), is_contract: false }, token_id: DEC(C1), value: '1' }], next_page_params: { items_count: 50, value: '1' } }) }
      }
      return w.fetch(url, init)
    }
    const ctx: DriverContext = { ...w.ctx(), fetchJson: guardedFetch(hatsTree, fetch2, new AbortController().signal), postJson: guardedPost(hatsTree, fetch2, new AbortController().signal) }
    await hatsTree.read(SYSTEM, ctx)
    expect(w.gets().filter(g => g.url.includes(DEC(C1)))).toHaveLength(HOLDER_PAGES)
  })

  describe('a silent explorer, a spent time budget, and cut lists', () => {
    const wrapped = (w: ReturnType<typeof world>, over: (url: string, init: Parameters<FetchLike>[1]) => ReturnType<FetchLike> | null, clock?: { t: number }): DriverContext => {
      const f: FetchLike = async (url, init) => over(url, init) ?? w.fetch(url, init)
      return {
        ...w.ctx(), fetchJson: guardedFetch(hatsTree, f, new AbortController().signal), postJson: guardedPost(hatsTree, f, new AbortController().signal),
        ...(clock ? { now: () => new Date(NOW.getTime() + clock.t) } : {}),
      }
    }
    const wearersOf = (read: Awaited<ReturnType<typeof hatsTree.read>>) => read.sections.find(s => s.title === 'Wearers')!

    for (const [what, answer] of [
      ['a non-2xx answer', async () => ({ ok: false, status: 500, json: async () => ({}) })],
      ['a bad shape', async () => ({ ok: true, status: 200, json: async () => ({ nothing: true }) })],
      ['a thrown fetch', async () => { throw new Error('socket closed') }],
    ] as const) {
      it(`${what} for one hat's holders leaves the tree read ok and that hat's holders null`, async () => {
        const w = world()
        const ctx = wrapped(w, url => (url.includes(`/instances/${DEC(C1)}/`) ? (answer() as any) : null))
        const read = await hatsTree.read(SYSTEM, ctx)
        expect(read.ok).toBe(true)
        const hats = (read.facts as any).hats
        expect(hats[1].holders).toBeNull()
        expect(hats[1].holdersComplete).toBe(false)
        expect(hats[0].holders).toEqual([`${CELO}:${CS(9)}`])
        expect(hats[0].holdersComplete).toBe(true)
        const section = wearersOf(read)
        expect(section.note).toContain('holders not listed for 1 hat(s): celo.blockscout.com did not answer')
        expect(section.rows.some(r => r.attention === 'warn')).toBe(true)
        expect(systemAttention(read)).toEqual({ level: 'warn', text: expect.stringMatching(/^(Roles|Wearers): \d+$/) })
      })
    }

    it('stops fetching holders 12 s after the read began, and says the explorer is read at 4 requests a second', async () => {
      const w = world()
      const clock = { t: 0 }
      const ctx = wrapped(w, (_url, init) => { if (init.method === 'GET') clock.t += 5_000; return null }, clock)
      const read = await hatsTree.read(SYSTEM, ctx)
      expect(read.ok).toBe(true)
      const hats = (read.facts as any).hats
      expect(hats.map((h: any) => h.holders === null)).toEqual([false, false, true, false, true])
      expect(w.gets()).toHaveLength(3)
      expect(wearersOf(read).note).toContain('holders not listed for 2 hat(s): the explorer is read at 4 requests a second')
    })

    it('holdersComplete is true for a fully listed hat, an unworn one, and false for a cut list or no explorer', async () => {
      const read = await hatsTree.read(SYSTEM, world().ctx())
      expect((read.facts as any).hats.map((h: any) => h.holdersComplete)).toEqual([true, true, true, true, true])
      const w = world()
      const endless = wrapped(w, url => (url.includes(`/instances/${DEC(C1)}/`)
        ? (async () => ({ ok: true, status: 200, json: async () => ({ items: [{ address: { hash: A(1) } }, { address: { hash: A(2) } }], next_page_params: { items_count: 50 } }) }))() : null))
      const cut = await hatsTree.read(SYSTEM, endless)
      const hats = (cut.facts as any).hats
      expect(hats[1].holdersComplete).toBe(false)
      expect(hats[1].holders).toHaveLength(2)
      expect(cut.sections[0].rows[1].cells[3]).toBe('0x0000…00A1, 0x0000…00A2 or more')
      expect(cut.sections[0].rows[0].cells[3]).toBe('0x0000…00A9')
      const none = await hatsTree.read({ ...SYSTEM, chain: OP }, world().ctx())
      expect((none.facts as any).hats.every((h: any) => h.holdersComplete === false)).toBe(true)
    })

    it('a cut list of more than three holders ends in "+n or more"', async () => {
      const w = world()
      const five = Array.from({ length: 5 }, (_, i) => ({ address: { hash: `0x${'0'.repeat(38)}b${i}` } }))
      const ctx = wrapped(w, url => (url.includes(`/instances/${DEC(C1)}/`)
        ? (async () => ({ ok: true, status: 200, json: async () => ({ items: five, next_page_params: { items_count: 50 } }) }))() : null))
      const read = await hatsTree.read(SYSTEM, ctx)
      expect(read.sections[0].rows[1].cells[3]).toMatch(/ \+2 or more$/)
    })
  })

  it('names the modules: eligibility and toggle', async () => {
    const read = await hatsTree.read(SYSTEM, world().ctx())
    const modules = read.sections.find(s => s.title === 'Modules')!
    expect(modules.rows.map(r => r.cells)).toEqual([
      ['0x0000000d.0003', 'eligibility', '0x0000…00e1'],
      ['0x0000000d.0003', 'toggle', '0x0000…0070'],
    ])
  })

  it('no explorer, no list, said plainly', async () => {
    const w = world()
    const read = await hatsTree.read({ ...SYSTEM, chain: OP }, w.ctx())
    expect(read.ok).toBe(true)
    expect(w.gets()).toHaveLength(0)
    const wearers = read.sections.find(s => s.title === 'Wearers')!
    expect(wearers.note).toBe('wearers are not listed on Optimism: no keyless source answers there')
    expect(wearers.rows).toEqual([])
    expect((read.facts as any).hats.every((h: any) => h.holders === null)).toBe(true)
    expect(w.posts()[0].url).toBe('https://optimism-rpc.publicnode.com/')
  })

  it('refuses what is not a tree, with a sentence and no request', async () => {
    for (const bad of [{ address: 'x' }, { chain: 'eip155:999' }, { chain: 'toString' }, { address: '0' }]) {
      const w = world()
      await expect(hatsTree.read({ ...SYSTEM, ...bad }, w.ctx())).rejects.toThrow(/tree|chain/i)
      expect(w.seen).toHaveLength(0)
    }
    // C12 (Q66): the sentence says the Hub
    await expect(hatsTree.read({ ...SYSTEM, chain: 'eip155:999' }, world().ctx())).rejects.toThrow(/^a Hats tree is read on chains this Hub knows \(.*\); eip155:999 is not one of them$/)
  })

  it('stops at 256 hats', async () => {
    const calls = { ...CALLS }
    const key = Object.keys(calls).find(k => k.endsWith(`|${hatsViewData(TOP)}`))!
    calls[key] = encodeArgs(VIEW_HAT_TYPES, ['x', 1, 1, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', '', 300, false, true])
    await expect(hatsTree.read(SYSTEM, world({ calls }).ctx())).rejects.toThrow('the tree has more than 256 hats; the platform reads trees up to 256')
  })

  it('a reverted child or a child with max supply 0 is a failed read naming the hat', async () => {
    const reverted = { ...CALLS }
    delete reverted[Object.keys(reverted).find(k => k.endsWith(`|${hatsViewData(C2)}`))!]
    await expect(hatsTree.read(SYSTEM, world({ calls: reverted }).ctx())).rejects.toThrow(/0x0000000d\.0002/)
    const unmade = { ...CALLS }
    unmade[Object.keys(unmade).find(k => k.endsWith(`|${hatsViewData(C2)}`))!] = encodeArgs(VIEW_HAT_TYPES, ['', 0, 0, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', '', 0, true, true])
    await expect(hatsTree.read(SYSTEM, world({ calls: unmade }).ctx())).rejects.toThrow(/0x0000000d\.0002/)
  })
})

import { encodeCall } from '../../lib/abi.mjs'
import { HATS_SIGNATURES } from '../../lib/hats.mjs'
function hatsViewData(id: string) { return encodeCall(HATS_SIGNATURES.viewHat, [BigInt(id)]) }

describe('wearer reads', () => {
  it('readWearer: the hats an account wears, checked on chain', async () => {
    const w = world()
    const all = [TOP, C1, C2, C3, G].map(h => hatRef(CELO, h))
    const r = await readWearer(SYSTEM, A(1), all, w.ctx())
    expect(r).toEqual({ ok: true, system: 'hats', chain: CELO, account: `${CELO}:${CS(1)}`, hats: [hatRef(CELO, C1)], block: BLOCK, readAt: NOW.toISOString() })
    expect(w.posts()).toHaveLength(1)
    expect(w.posts()[0].body[0].method).toBe('eth_blockNumber')
    expect((await readWearer(SYSTEM, A(5), all, world().ctx())).hats).toEqual([])
  })

  it('readWearer refuses a hat outside the tree and an account that is not an address, with no request', async () => {
    const w = world()
    await expect(readWearer(SYSTEM, A(1), [hatRef(CELO, topHatId(14))], w.ctx())).rejects.toThrow(/not in tree 13/)
    await expect(readWearer(SYSTEM, 'nobody', [hatRef(CELO, TOP)], w.ctx())).rejects.toThrow(/not an address/)
    expect(w.seen).toHaveLength(0)
  })

  it('readWearers: explorer holders, then the wearers among them by isWearerOfHat', async () => {
    const w = world()
    const r = await readWearers(SYSTEM, hatRef(CELO, C1), w.ctx())
    expect(r).toEqual({
      ok: true, system: 'hats', hat: hatRef(CELO, C1), holders: [`${CELO}:${CS(1)}`, `${CELO}:${CS(2)}`], wearers: [`${CELO}:${CS(1)}`],
      complete: true, block: BLOCK, readAt: NOW.toISOString(),
    })
    expect(w.gets()).toHaveLength(2)
  })

  it('readWearers off Celo, Ethereum and Sepolia: incomplete, no holders, no GET', async () => {
    const w = world()
    const r = await readWearers({ ...SYSTEM, chain: OP }, hatRef(OP, C1), w.ctx())
    expect(r).toMatchObject({ ok: true, complete: false, holders: [], wearers: [] })
    expect(w.gets()).toHaveLength(0)
  })

  it('readWearers is incomplete when pages remain after HOLDER_PAGES', async () => {
    const w = world()
    const endless: FetchLike = async (url, init) => {
      if (init.method === 'GET') return { ok: true, status: 200, json: async () => ({ items: [], next_page_params: { items_count: 50 } }) }
      return w.fetch(url, init)
    }
    const ctx: DriverContext = { ...w.ctx(), fetchJson: guardedFetch(hatsTree, endless, new AbortController().signal) }
    const r = await readWearers(SYSTEM, hatRef(CELO, C1), ctx)
    expect(r.complete).toBe(false)
  })
})

describe('the reader\'s wearer and wearers', () => {
  let repo: string
  beforeEach(() => { repo = makeFixtureRepo() })
  afterEach(() => removeFixtureRepo(repo))
  const mk = () => { const w = world(); return { w, reader: new SystemReader({ repo, fetch: w.fetch, now: () => NOW, drivers: [hatsTree], sleep: async () => {} }) } }

  it('wearer takes the hats from the cached read and keeps a good reading 30 s per (system, account)', async () => {
    const { w, reader } = mk()
    await reader.read(SYSTEM)
    const before = w.seen.length
    const one = await reader.wearer(SYSTEM, A(1))
    expect(one).toMatchObject({ ok: true, hats: [hatRef(CELO, C1)], block: BLOCK })
    expect(w.seen.length).toBe(before + 1)
    expect(await reader.wearer(SYSTEM, A(1))).toEqual(one)
    expect(w.seen.length).toBe(before + 1)
    await reader.wearer(SYSTEM, A(5))
    expect(w.seen.length).toBe(before + 2)
  })

  it('wearer reads the system first when there is no cached read', async () => {
    const { w, reader } = mk()
    const r = await reader.wearer(SYSTEM, A(9))
    expect(r).toMatchObject({ ok: true, hats: [hatRef(CELO, TOP)] })
    expect(w.posts().length).toBe(4)
  })

  it('wearers keeps a good reading per (system, hat)', async () => {
    const { w, reader } = mk()
    const r = await reader.wearers(SYSTEM, hatRef(CELO, C1))
    expect(r).toMatchObject({ ok: true, complete: true, wearers: [`${CELO}:${CS(1)}`] })
    const n = w.seen.length
    expect(await reader.wearers(SYSTEM, hatRef(CELO, C1))).toEqual(r)
    expect(w.seen.length).toBe(n)
  })

  it('refuses before reading: a Safe, a bad account, a hat of another tree', async () => {
    const { w, reader } = mk()
    const safe = { id: 's', kind: 'safe', chain: CELO, address: A(1), driver: 'safe' }
    expect((await reader.wearer(safe, A(1))).ok).toBe(false)
    const bad = await reader.wearer(SYSTEM, 'nobody')
    expect(bad).toMatchObject({ ok: false })
    expect((bad as any).error).toMatch(/not an address/)
    const other = await reader.wearers(SYSTEM, hatRef(CELO, topHatId(14)))
    expect(other).toMatchObject({ ok: false })
    expect((await reader.wearers(safe, hatRef(CELO, C1))).ok).toBe(false)
    expect(w.seen).toHaveLength(0)
  })

  it('a refusal is a plain ok:false; a read that could not be made adds failed: true (M2)', async () => {
    const { reader } = mk()
    const safe = { id: 's', kind: 'safe', chain: CELO, address: A(1), driver: 'safe' }
    for (const r of [await reader.wearer(safe, A(1)), await reader.wearer(SYSTEM, 'nobody'), await reader.wearers(SYSTEM, hatRef(CELO, topHatId(14)))]) {
      expect(r.ok).toBe(false)
      expect(r).not.toHaveProperty('failed')
    }
    // the tree cannot be read: the network answers 503
    const down: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) })
    const broken = new SystemReader({ repo, fetch: down, now: () => NOW, drivers: [hatsTree], sleep: async () => {} })
    const tree = await broken.wearer(SYSTEM, A(1))
    expect(tree).toMatchObject({ ok: false, failed: true, error: expect.stringMatching(/^the tree could not be read: .*503/) })
    // the tree was read, then the network fails during the wearer read
    const w = world()
    let up = true
    const flaky: FetchLike = async (url, init) => (up ? w.fetch(url, init) : down(url, init))
    const later = new SystemReader({ repo, fetch: flaky, now: () => NOW, drivers: [hatsTree], sleep: async () => {} })
    await later.read(SYSTEM)
    up = false
    expect(await later.wearer(SYSTEM, A(1))).toMatchObject({ ok: false, failed: true, error: expect.stringContaining('503') })
    expect(await later.wearers(SYSTEM, hatRef(CELO, C1))).toMatchObject({ ok: false, failed: true, error: expect.stringContaining('503') })
    // no network at all is a read that could not be made, not a refusal
    const offline = new SystemReader({ repo, now: () => NOW, drivers: [hatsTree], sleep: async () => {} })
    expect(await offline.wearer(SYSTEM, A(1))).toMatchObject({ ok: false, failed: true, error: 'this reader was given no network access' })
  })
})
