// Walk fix wave 4 (Rule 4; wave 3's carry): a System's Resource carries what its driver read of the chain (`facts.driver`,
// `composed` among it) and the attention drawn from it. To a member from whom one of the System's chain fields is kept
// (its address, its deployment, …: `keptFrom`, the one filter the deploy plan and Read back are told through) the
// Resource carries none of it, nor the kept field's own fact: not on GET /api/resources, a resource's page, the maps, the
// Sources page or the cached reads the from mark is drawn from. A member admitted to them is told the read as it is.
// Every test builds a throwaway repository and private store; the drivers are stubs with no hosts (no network).
import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { git, makeSyntheticRepo } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { ResourceStore } from '../../server/resources/index.ts'
import { mountResources } from '../../server/resources/routes.ts'
import { runCommand } from '../../server/resources/run.ts'
import { SystemReader } from '../../server/systems/reader.ts'
import type { Driver } from '../../server/systems/driver.ts'
import { cachedReads } from '../../server/workspace/sources.ts'
import { chainKept } from '../../server/deploy/private-flip.ts'
import { Levels } from '../../server/visibility/gate.ts'
import type { PrivateStore } from '../../server/private/store.ts'
import { grantOps, hideFieldsInStore, restrictInStore } from '../deploy/fixtures/hub.ts'

const SEPOLIA = 'eip155:11155111'
const SAFE_ADDRESS = '0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe'
/** What the stub Safe driver says it found: an owner, a balance and a transaction waiting, none of which a member not
 *  admitted to the Safe's address may be told. */
const OWNER = '0x0000000000000000000000000000000000000ab1'
/** The System entries the stub drivers were asked to read (walk wave 5: what an admitted member's read is made from). */
const asked: Record<string, unknown>[] = []
const safeDriver: Driver = {
  name: 'safe', hosts: [],
  async read(s, ctx) {
    asked.push(s as Record<string, unknown>)
    return {
      ok: true, readAt: ctx.now().toISOString(),
      facts: { address: SAFE_ADDRESS, owners: 1, threshold: 1, ownerList: [OWNER], pending: 1 },
      sections: [{ title: 'Waiting on signers', rows: [{ cells: ['#7', 'Pay 0.5 ETH'], attention: 'warn' }] }],
      open: { url: `https://app.safe.global/home?safe=sep:${SAFE_ADDRESS}`, embeddable: false },
    }
  },
}
const treeDriver: Driver = {
  name: 'hats-tree', hosts: [],
  async read(s, ctx) { asked.push(s as Record<string, unknown>); return { ok: true, readAt: ctx.now().toISOString(), facts: { tree: 42, hats: [{ id: 'x', supply: 0, active: true }] }, sections: [], open: null } },
}
const SAFE = { id: 'side-safe', kind: 'safe', name: 'Side Safe', chain: SEPOLIA, address: SAFE_ADDRESS, driver: 'safe', deployment: { status: 'deployed', read_back: '2026-11-05' } }
const TREE = { id: 'side-roles', kind: 'hats-tree', name: 'Side roles', chain: SEPOLIA, driver: 'hats-tree', deployment: { status: 'composed', salt: '1' } }

let repo: string | undefined
let kept: { store: PrivateStore; done: () => void } | undefined
afterEach(() => { kept?.done(); kept = undefined; if (repo) removeFixtureRepo(repo); repo = undefined; asked.length = 0 })

type Keep = 'policy-in-git' | 'policy-in-store' | 'store-only'
/** A deployed Safe and a composed tree; `systems.address` and `systems.deployment` kept at role:ops by `keep`:
 *  `policy-in-git` the policy names them while git still holds the values (a policy narrowed by hand: the record page
 *  already shows them restricted); `policy-in-store` the policy names them and the values moved to the store, as a
 *  narrowing does; `store-only` the store holds them at role:ops with no level in the policy. `admitted`: bruno holds ops. */
async function setUp(keep: Keep, o: { admitted?: boolean } = {}) {
  repo = makeSyntheticRepo()
  writeFileSync(join(repo, 'data', 'systems.yaml'), stringify({ schema_version: '1.0', systems: [SAFE, TREE] }))
  git(repo, 'add data/systems.yaml')
  git(repo, 'commit -qm "fixture: a deployed Safe and a composed tree"')
  if (o.admitted) grantOps(repo)
  if (keep === 'policy-in-git') {
    writeFileSync(join(repo, 'data', 'visibility.yaml'), 'visibility:\n  collections:\n    systems:\n      fields: { address: "role:ops", deployment: "role:ops" }\n')
    git(repo, 'add data/visibility.yaml')
    git(repo, 'commit -qm "fixture: the chain fields kept at role:ops"')
  } else if (keep === 'policy-in-store') {
    kept = await restrictInStore(repo, ['address', 'deployment'])
  } else {
    kept = await hideFieldsInStore(repo, [['side-safe', 'address'], ['side-safe', 'deployment'], ['side-roles', 'deployment']], 'role:ops')
  }
  const reader = new SystemReader({ repo, now: () => new Date('2026-11-07T09:00:00Z'), drivers: [safeDriver, treeDriver] })
  const store = kept?.store
  const access = store ? () => store : undefined
  // the server gives the resource store the one private store (serve.ts), as it gives the app
  const resources = new ResourceStore({ repo, now: () => new Date(), run: runCommand, lastOk: () => null, systems: reader, ...(access ? { privateStore: access } : {}) })
  const r = repo
  const app: Hono = createApp(r, (a, ctx) => mountResources(a, resources, r, { privateStore: ctx.privateStore }), { ...(access ? { privateStore: access } : {}), systems: reader })
  return { app, reader, resources }
}

const get = async (app: Hono, path: string) => {
  const res = await app.request(path)
  expect(res.status, path).toBe(200)
  return res.json() as Promise<any>
}
const systemsOf = (nodes: { id: string }[]) => nodes.filter(n => n.id.startsWith('system:')) as { id: string; attention: unknown; facts: Record<string, unknown> }[]

/** Nothing a driver read, nor `composed`, nor the kept address, in `body`. */
function saysNoChain(body: unknown): void {
  const text = JSON.stringify(body).toLowerCase()
  expect(text).not.toContain(SAFE_ADDRESS.slice(2))
  expect(text).not.toContain(OWNER.slice(2))
  expect(text).not.toContain('composed')
  expect(text).not.toContain('waiting on signers')
  expect(text).not.toContain('app.safe.global')
}

describe('a System to a member not admitted to systems.address and systems.deployment (walk wave 4, Rule 4)', () => {
  for (const keep of ['policy-in-git', 'policy-in-store', 'store-only'] as const) {
    it(`(${keep}) GET /api/resources, a resource's page and the maps carry no driver read, attention or kept fact`, async () => {
      const { app } = await setUp(keep)
      const all = await get(app, '/api/resources')
      const systems = systemsOf(all)
      expect(systems.map(n => n.id).sort()).toEqual(['system:side-roles', 'system:side-safe'])
      for (const n of systems) {
        expect(n.facts.driver).toBeUndefined()
        expect(n.facts.address ?? null).toBeNull()
        expect(n.attention).toBeNull()
      }
      saysNoChain(systems)
      saysNoChain(await get(app, `/api/resources/${encodeURIComponent('system:side-safe')}`))
      saysNoChain(systemsOf((await get(app, '/api/graph/systems')).nodes))
      saysNoChain(systemsOf((await get(app, '/api/graph/organization')).nodes))
    })
  }

  it('the Sources page and the cached reads the from mark draws hold no read of either System', async () => {
    const { app, reader } = await setUp('policy-in-store')
    await get(app, '/api/resources') // the reader now holds both reads
    const sources = await get(app, '/api/sources')
    const safe = sources.find((s: { id: string }) => s.id === 'system:side-safe')
    expect(safe).toMatchObject({ supplies: [], read: { at: null, state: 'unknown' } })
    saysNoChain(sources.filter((s: { id: string }) => s.id.startsWith('system:')))
    const viewer = { kind: 'member' as const, id: 'bruno', hats: [], roles: [] }
    const store = kept!.store
    const lv = new Levels(repo!)
    expect(cachedReads(viewer, lv, reader, chainKept(repo!, lv.config, () => store, viewer))).toEqual({})
  })

  it('a store that cannot answer keeps every chain read from every member', async () => {
    const { reader } = await setUp('store-only', { admitted: true })
    await new ResourceStore({ repo: repo!, now: () => new Date(), run: runCommand, lastOk: () => null, systems: reader }).graph()
    const viewer = { kind: 'member' as const, id: 'bruno', hats: [], roles: ['ops'] }
    const down = () => { throw new Error('the store is down') }
    const kept = chainKept(repo!, new Levels(repo!).config, down, viewer)
    expect(kept('side-safe').size).toBeGreaterThan(0)
    expect(kept('side-roles').size).toBeGreaterThan(0)
  })
})

describe('a member admitted to them (walk wave 4)', () => {
  it('is told the read as it is: the Safe\'s facts, its attention, the composed tree', async () => {
    const { app } = await setUp('policy-in-git', { admitted: true })
    const systems = systemsOf(await get(app, '/api/resources'))
    const safe = systems.find(n => n.id === 'system:side-safe')!
    expect(safe.facts.driver).toMatchObject({ ok: true, facts: { address: SAFE_ADDRESS } })
    expect(safe.attention).toEqual({ level: 'warn', text: 'Waiting on signers: 1' })
    expect(systems.find(n => n.id === 'system:side-roles')!.facts.driver).toMatchObject({ ok: true, facts: { composed: true } })
  })

  it('in the store too: the Sources page lists what the Safe\'s read supplies', async () => {
    const { app } = await setUp('policy-in-store', { admitted: true })
    await get(app, '/api/resources')
    const safe = (await get(app, '/api/sources')).find((s: { id: string }) => s.id === 'system:side-safe')
    expect(safe.supplies).toEqual([{ what: 'Waiting on signers', count: 1 }])
  })
})

// Walk fix wave 5 (wave 4's carry): an admitted member's System was read from git's entry alone, so a System whose
// `deployment` or `address` moved to the store was read as deployed (the composed tree's driver asked) and the Safe read
// with no address, for everyone. It is read with the store's chain fields laid over git's; the gate (wave 4) still keeps
// that read, and the kept fields, from a member not admitted (the cases above).
describe('a System whose chain fields the store keeps, read for a member admitted to them (walk wave 5)', () => {
  for (const keep of ['policy-in-store', 'store-only'] as const) {
    it(`(${keep}) is read from the store's values: the Safe at its address, the tree composed`, async () => {
      const { app } = await setUp(keep, { admitted: true })
      const systems = systemsOf(await get(app, '/api/resources'))
      const safe = systems.find(n => n.id === 'system:side-safe')!
      expect(safe.facts.address).toBe(SAFE_ADDRESS)
      expect(safe.facts.driver).toMatchObject({ ok: true, facts: { address: SAFE_ADDRESS } })
      expect(systems.find(n => n.id === 'system:side-roles')!.facts.driver).toMatchObject({ ok: true, facts: { composed: true } })
      expect(asked.find(a => a.id === 'side-safe')).toMatchObject({ address: SAFE_ADDRESS, deployment: { status: 'deployed' } })
      expect(asked.some(a => a.id === 'side-roles')).toBe(false)
    })
  }
})
