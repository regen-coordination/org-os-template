// packages/admin/tests/deploy/fixtures/hub.ts
//
// The Hub the deploy routes are tested on (L7 Tasks 11, 12): a throwaway synthetic repository with the test shelf, the
// test council template added and applied, and the app with the deploy routes reading the chain from a recorded node
// (fixtures/readings.ts). The Safe Transaction Service and the explorer answer 404, as on a fork. No network.
import { expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import { parse, stringify } from 'yaml'
import { openPrivateStore, type PrivateStore } from '../../../server/private/store.ts'
import { makeSyntheticRepo, git } from '../../changes/fixtures.ts'
import { createApp } from '../../../server/app.ts'
import { SystemReader } from '../../../server/systems/reader.ts'
import type { FetchLike } from '../../../server/systems/driver.ts'
import { DEPLOY_DRIVER } from '../../../server/deploy/prepare.ts'
import { mountDeploy } from '../../../server/deploy/routes.ts'
import { OWNERS, nodeFetch, type Readings } from './readings.ts'

const SHELF = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'library', 'fixtures', 'test-shelf')
/** The deploy reads unpaced, so that a test does not wait 250 ms between requests (one test runs them paced). */
export const FAST = { ...DEPLOY_DRIVER, minGapMs: 0 }
export const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
export const NOTHING_COMPOSED = 'Nothing is composed. Add a DAO template or compose on the canvas first.'
export const STAGED_ONLY = 'Apply or propose the composition first; deployments are prepared from what was decided.'
export const PART_HIDDEN = 'Part of this composition is not yours to read: someone who can read all of it reads it back.'
export const PART_HIDDEN_PLAN = 'Part of this composition is not yours to read: someone who can read all of it prepares it.'
/** L7 gap A (PF-R226): what the split cannot carry. A value kept above members the flip would copy into git (a
 *  governance placeholder, a tree's `roles` keyed by kept hats); a field the store holds with no level in the policy. */
export const KEPT_PRIVATE = 'This read-back would copy a value kept outside the repository into what the repository holds, and the repository keeps nothing stricter than members. Nothing was staged.'
export const KEPT_PRIVATE_FIELD = 'Part of a System of this composition is held outside the repository with no level in data/visibility.yaml, so its read-back has nowhere to be written: give it its level there first. Nothing was staged.'
/** L7 gap A: the flip writes a field kept at a level the actor is not admitted to. */
export const NOT_ADMITTED_FLIP = 'Part of what this read-back writes is kept at a level you are not admitted to, so you cannot write it: someone admitted to it reads it back. Nothing was staged.'
export const SAFE_ID = 'test-dao-safe'
export const TREE_ID = 'test-dao-roles'

/** A synthetic repository with the test shelf; `template:test-council` added (three owners, two to sign) and, unless
 *  `apply` is false, applied: the composition is the trunk's. */
export async function composedRepo(o: { add?: boolean; apply?: boolean } = {}): Promise<string> {
  const r = makeSyntheticRepo()
  writeFileSync(join(r, 'federation.yaml'), `identity:\n  name: Test DAO\n  slug: test-dao\nlibrary:\n  shelves:\n    - { path: ${SHELF} }\n`)
  git(r, 'add federation.yaml')
  git(r, 'commit -qm "fixture: the test shelf"')
  if (o.add === false) return r
  const lib = createApp(r)
  const added = await lib.request('/api/library/template%3Atest-council/add', json('POST', { config: { owners: OWNERS, threshold: 2 } }))
  expect(added.status, await added.clone().text()).toBe(200)
  if (o.apply !== false) {
    const applied = await lib.request('/api/changes/apply', json('POST', {}))
    expect(applied.status, await applied.clone().text()).toBe(200)
  }
  return r
}

/** The Snapshot testnet hub's host (L7 Task 13): a POST to it is answered from `world.space`. */
export const TESTNET_HUB_HOST = 'testnet.hub.snapshot.org'

/** GETs answer 404 (the Safe Transaction Service, the explorer); POSTs are the recorded node `world.node`, switchable
 *  between requests, every RPC method asked logged in `world.methods`; a POST to the Snapshot testnet hub answers its
 *  `space` query with `world.space` (null: no such space), every body sent there logged in `world.hub`. */
export function worldFetch(start: Readings) {
  const world = { node: start, methods: [] as string[], space: null as unknown, hub: [] as { query: string; variables?: unknown }[] }
  const fetch: FetchLike = async (url, init) => {
    if (init.method === 'GET') return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
    if (new URL(url).host === TESTNET_HUB_HOST) {
      world.hub.push(JSON.parse(init.body ?? 'null'))
      return { ok: true, status: 200, json: async () => ({ data: { space: world.space } }) }
    }
    return nodeFetch(world.node, world.methods)(url, init)
  }
  return { world, fetch }
}

/** `records` added to the committed data/systems.yaml (a composed Snapshot space, a composed registration). */
export function commitSystems(r: string, records: Record<string, unknown>[], identity?: Record<string, unknown>): void {
  const path = join(r, 'data', 'systems.yaml')
  const doc = parse(readFileSync(path, 'utf8')) as { systems: Record<string, unknown>[] }
  doc.systems.push(...structuredClone(records))
  writeFileSync(path, stringify(doc))
  git(r, 'add data/systems.yaml')
  if (identity) {
    const fed = join(r, 'federation.yaml')
    const f = parse(readFileSync(fed, 'utf8')) as { identity: Record<string, unknown> }
    f.identity = { ...f.identity, ...identity }
    writeFileSync(fed, stringify(f))
    git(r, 'add federation.yaml')
  }
  git(r, 'commit -qm "fixture: more composed Systems"')
}

/** The Hub's app with the deploy routes, reading the chain from `start` (see worldFetch); `o.store`, the private store
 *  the routes read through (`privateReads`), or `o.access`, the way to it (one that may throw: a store that is down);
 *  `o.now`, the read-back's clock. */
export function deployApp(r: string, start: Readings, driver = FAST, o: { store?: PrivateStore; access?: () => PrivateStore; now?: () => Date } = {}) {
  const { world, fetch } = worldFetch(start)
  const reader = new SystemReader({ repo: r, fetch, sleep: async () => {} })
  const store = o.store
  const access = o.access ?? (store ? () => store : undefined)
  const app: Hono = createApp(r, (a, ctx) => mountDeploy(a, {
    repo: r, systems: reader, withLock: ctx.withLock, privateStore: ctx.privateStore, notify: () => {}, driver, ...(o.now ? { now: o.now } : {}),
  }), access ? { privateStore: access } : {})
  return { app, world, reader }
}

/** The named Systems moved out of git into a fresh private store at `level` (L5 §10: a level above members is kept
 *  there, never in git), the removal committed. `done()` closes the store and removes its folder. */
export async function hideInStore(r: string, ids: string[], level = 'role:ops'): Promise<{ store: PrivateStore; done: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-private-'))
  const store = await openPrivateStore(r, { dir })
  const path = join(r, 'data', 'systems.yaml')
  const doc = parse(readFileSync(path, 'utf8')) as { systems: Record<string, unknown>[] }
  for (const s of doc.systems.filter(x => ids.includes(String(x.id)))) {
    const { id, ...body } = s
    await store.putRecord({ collection: 'systems', id: String(id), visibility: level, body, rev: '' }, 'test', null)
  }
  doc.systems = doc.systems.filter(x => !ids.includes(String(x.id)))
  writeFileSync(path, stringify(doc))
  git(r, 'add data/systems.yaml')
  git(r, 'commit -qm "fixture: Systems kept in the private store"')
  return { store, done: () => { try { store.close() } catch { /* closed */ } rmSync(dir, { recursive: true, force: true }) } }
}

/** The named fields of committed Systems moved out of git into a fresh private store at `level` (L5 §10), the removal
 *  committed. `done()` closes the store and removes its folder. */
export async function hideFieldsInStore(r: string, fields: [id: string, field: string][], level = 'members'): Promise<{ store: PrivateStore; done: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-private-'))
  const store = await openPrivateStore(r, { dir })
  const path = join(r, 'data', 'systems.yaml')
  const doc = parse(readFileSync(path, 'utf8')) as { systems: Record<string, unknown>[] }
  for (const [id, field] of fields) {
    const s = doc.systems.find(x => String(x.id) === id)!
    await store.putField({ registry: 'systems', record: id, field, visibility: level, value: s[field] }, 'test', null)
    delete s[field]
  }
  writeFileSync(path, stringify(doc))
  git(r, 'add data/systems.yaml')
  git(r, 'commit -qm "fixture: System fields kept in the private store"')
  return { store, done: () => { try { store.close() } catch { /* closed */ } rmSync(dir, { recursive: true, force: true }) } }
}

/** The test actor (bruno) given the governance role `ops`, committed: admitted to what is kept at `role:ops`. */
export function grantOps(r: string): void {
  const path = join(r, 'data', 'governance.yaml')
  const text = readFileSync(path, 'utf8')
  writeFileSync(path, text.replace('  model: "solo-maintainer"\n', '  model: "solo-maintainer"\n  roles:\n    ops:\n      members: [bruno]\n'))
  git(r, 'add data/governance.yaml')
  git(r, 'commit -qm "fixture: bruno holds ops"')
}

/** data/visibility.yaml keeping the named Systems fields at `level`, and, as a narrowing does (L5 §9.7), the values
 *  git held for them moved into a fresh private store at that level; both committed. `done()` closes the store and
 *  removes its folder. */
export async function restrictInStore(r: string, fields: string[], level = 'role:ops'): Promise<{ store: PrivateStore; done: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-private-'))
  const store = await openPrivateStore(r, { dir })
  writeFileSync(join(r, 'data', 'visibility.yaml'), `visibility:\n  collections:\n    systems:\n      fields: { ${fields.map(f => `${f}: "${level}"`).join(', ')} }\n`)
  const path = join(r, 'data', 'systems.yaml')
  const doc = parse(readFileSync(path, 'utf8')) as { systems: Record<string, unknown>[] }
  for (const s of doc.systems) {
    for (const field of fields) {
      if (s[field] === undefined || s[field] === null) continue
      await store.putField({ registry: 'systems', record: String(s.id), field, visibility: level, value: s[field] }, 'test', null)
      delete s[field]
    }
  }
  writeFileSync(path, stringify(doc))
  git(r, 'add data/systems.yaml data/visibility.yaml')
  git(r, 'commit -qm "fixture: Systems fields kept in the private store"')
  return { store, done: () => { try { store.close() } catch { /* closed */ } rmSync(dir, { recursive: true, force: true }) } }
}
