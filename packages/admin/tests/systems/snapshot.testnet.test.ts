// DAO-OS L7 Task 13 (spec §8.4): the snapshot-space driver chooses its hub by network. A Sepolia space (its URL on
// testnet.snapshot.box, or composed with `deployment.network: eip155:11155111`) is read on the testnet hub,
// https://testnet.hub.snapshot.org (snapshot.js src/constants.json, spec §3); every other space on hub.snapshot.org.
// The answers are recorded in the shape of the hub's GraphQL `space` query (synthetic: `test-dao.eth`, invented names).
// No network.
import { describe, it, expect } from 'vitest'
import { SNAPSHOT_HUB, SNAPSHOT_TESTNET_HUB, hubFor, snapshotLink, snapshotSpace, spaceOf } from '../../server/systems/snapshot.ts'
import { guardedPost, type DriverContext, type FetchLike } from '../../server/systems/driver.ts'

const NOW = new Date('2026-11-06T12:00:00Z')
const TESTNET = { id: 'test-dao-votes', kind: 'snapshot-space', url: 'https://testnet.snapshot.box/#/s:test-dao.eth', driver: 'snapshot-space' }
const SPACE = {
  data: {
    space: {
      id: 'test-dao.eth', name: 'Test DAO', network: '11155111', symbol: 'VOTE', admins: [], moderators: [], members: [],
      voting: { delay: 0, period: 259200, quorum: 0, type: null, privacy: 'any' },
      strategies: [{ name: 'erc1155-balance-of', network: '11155111' }], validation: { name: 'any' }, filters: { minScore: 0, onlyMembers: true },
    },
    active: [], pending: [], closed: [],
  },
}

function world() {
  const seen: { url: string; body: { query: string; variables?: unknown } }[] = []
  const fetch: FetchLike = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body!) })
    return { ok: true, status: 200, json: async () => SPACE }
  }
  const ctx = (): DriverContext => ({
    fetchJson: async () => { throw new Error('no GET') },
    postJson: guardedPost(snapshotSpace, fetch, new AbortController().signal),
    now: () => NOW, members: [],
  })
  return { seen, ctx }
}

describe('hubFor (L7 Task 13)', () => {
  it('is the testnet hub for a testnet.snapshot.box URL or a Sepolia network, the main hub otherwise', () => {
    expect(SNAPSHOT_TESTNET_HUB).toBe('https://testnet.hub.snapshot.org/graphql')
    expect(hubFor(TESTNET)).toBe(SNAPSHOT_TESTNET_HUB)
    expect(hubFor({ space: 'test-dao.eth', deployment: { status: 'composed', network: 'eip155:11155111' } })).toBe(SNAPSHOT_TESTNET_HUB)
    expect(hubFor({ url: 'https://snapshot.box/#/s:example-dao.eth' })).toBe(SNAPSHOT_HUB)
    expect(hubFor({ space: 'example-dao.eth', deployment: { status: 'composed', network: 'eip155:1' } })).toBe(SNAPSHOT_HUB)
    expect(hubFor({ url: 'https://evil.example.org/testnet.snapshot.box' })).toBe(SNAPSHOT_HUB)
  })

  it('the driver declares both hubs', () => {
    expect(snapshotSpace.hosts).toEqual(['hub.snapshot.org', 'testnet.hub.snapshot.org'])
  })
})

describe('a testnet space', () => {
  it('names its space from a testnet.snapshot.box URL, and links there', () => {
    expect(spaceOf(TESTNET)).toBe('test-dao.eth')
    expect(snapshotLink('test-dao.eth', undefined, TESTNET)).toBe('https://testnet.snapshot.box/#/s:test-dao.eth')
    expect(snapshotLink('example-dao.eth')).toBe('https://snapshot.box/#/s:example-dao.eth')
  })

  it('is read with one query to the testnet hub, on Sepolia', async () => {
    const w = world()
    const read = await snapshotSpace.read(TESTNET, w.ctx())
    expect(w.seen.map(s => s.url)).toEqual([SNAPSHOT_TESTNET_HUB])
    expect(w.seen[0]!.body.query.startsWith('query ')).toBe(true)
    expect(w.seen[0]!.body.variables).toEqual({ s: 'test-dao.eth' })
    expect(read.ok).toBe(true)
    expect(read.facts).toMatchObject({ space: 'test-dao.eth', name: 'Test DAO', chain: 'eip155:11155111', strategies: ['erc1155-balance-of'] })
    expect(read.open).toEqual({ url: 'https://testnet.snapshot.box/#/s:test-dao.eth', embeddable: false })
  })
})
