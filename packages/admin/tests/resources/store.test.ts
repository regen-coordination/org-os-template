import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo, REAL_REPO } from '../fixtures.ts'
import { ResourceStore, readResources, ADAPTERS } from '../../server/resources/index.ts'
import { runCommand } from '../../server/resources/run.ts'
import type { Adapter, AdapterContext } from '../../server/resources/types.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))
const ctx = (): AdapterContext => ({ repo, now: () => new Date(), run: runCommand, lastOk: () => null })

const counting = (name: string, watch: string[], reads: { n: number }, fail = false): Adapter => ({
  name, board: 'systems', title: name.toUpperCase(), watch,
  async read() {
    reads.n++
    if (fail) throw new Error('boom')
    return { nodes: [{ id: `module:${name}-${reads.n}`, kind: 'module', board: 'systems', name, status: null, attention: null, changed: null, facts: {}, source: null }], edges: [] }
  },
})

describe('ResourceStore', () => {
  it('reads each adapter once, and again only after a path it watches changed', async () => {
    const a = { n: 0 }, b = { n: 0 }
    const store = new ResourceStore(ctx(), [counting('a', ['modules'], a), counting('b', ['data/instances.yaml'], b)])
    await store.graph(); await store.graph()
    expect([a.n, b.n]).toEqual([1, 1])
    expect(store.invalidate('modules/x/module.yaml')).toBe(true)
    expect(store.invalidate('data/instances.yaml')).toBe(true)
    expect(store.invalidate('data/instances.yaml.bak')).toBe(false)
    expect(store.invalidate('docs/readme.md')).toBe(false)
    await store.graph()
    expect([a.n, b.n]).toEqual([2, 2])
    expect(store.watchPaths()).toEqual(['modules', 'data/instances.yaml'])
  })

  it('turns an adapter that throws into its absence card', async () => {
    const store = new ResourceStore(ctx(), [counting('records', ['data'], { n: 0 }, true)])
    const g = await store.graph()
    expect(g.nodes).toEqual([expect.objectContaining({ id: 'absent:records', attention: { level: 'warn', text: 'RECORDS could not be read: boom' } })])
  })

  it('refresh names the resources that changed, appeared or went (Review Focus 3)', async () => {
    const store = new ResourceStore(ctx(), ADAPTERS)
    expect(await store.refresh()).toEqual(expect.arrayContaining(['person:steward-a', 'project:proj-001']))
    expect(await store.refresh()).toEqual([])
    rmSync(join(repo, 'data', 'members.yaml'))
    store.invalidate('data/members.yaml')
    expect((await store.refresh()).sort()).toEqual(['absent:records:members', 'person:ana', 'person:steward-a'])
    // The file is tracked in git yet gone from the tree: that is said, not left as silence.
    const g = await store.graph()
    expect(g.nodes.find(n => n.id === 'absent:records:members')?.attention?.text).toMatch(/missing from the working tree/)
    writeFileSync(join(repo, 'data', 'projects.yaml'), 'projects:\n  - id: a\n    lead: *nowhere\n')
    store.invalidate('data/projects.yaml')
    expect((await store.refresh()).sort()).toEqual(['absent:records:projects', 'project:proj-001'])
  })

  it('recomputes time-based attention once its adapter is invalidated, as the server\'s clock tick does', async () => {
    writeFileSync(join(repo, 'data', 'funding-opportunities.yaml'),
      'funding_opportunities:\n  - id: grant\n    title: Grant\n    status: researching\n    deadline: "2026-10-20"\n')
    let now = new Date(2026, 9, 16, 12)
    const store = new ResourceStore({ ...ctx(), now: () => now }, ADAPTERS)
    await store.refresh()
    const text = async () => (await store.graph()).nodes.find(n => n.id === 'funding:grant')?.attention?.text
    expect(await text()).toBe('deadline in 4 days')
    now = new Date(2026, 9, 19, 12)
    expect(await text()).toBe('deadline in 4 days') // cached: no file changed
    store.invalidateAdapter('records')
    expect(await store.refresh()).toEqual(['funding:grant'])
    expect(await text()).toBe('deadline in 1 day')
  })

  it('liveSeats is true only while a seat has a live agent', async () => {
    const seat = (state: string | null): Adapter => ({ name: 'crew', board: 'systems', title: 'Crew', watch: [],
      async read() { return { nodes: [{ id: 's', kind: 'seat', board: 'systems', name: 's', status: 'seated', attention: null, changed: null, facts: { state }, source: null }], edges: [] } } })
    const live = new ResourceStore(ctx(), [seat('idle')]); await live.refresh()
    const gone = new ResourceStore(ctx(), [seat(null)]); await gone.refresh()
    expect([live.liveSeats(), gone.liveSeats()]).toEqual([true, false])
  })

  it('keeps an invalidation that arrives while an adapter is being read', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const reads = { n: 0 }
    const slow: Adapter = { name: 'slow', board: 'systems', title: 'Slow', watch: ['x'],
      async read() { reads.n++; if (reads.n === 1) await gate; return { nodes: [], edges: [] } } }
    const store = new ResourceStore(ctx(), [slow])
    const first = store.graph()
    await new Promise(r => setTimeout(r, 10))
    store.invalidateAdapter('slow')
    release(); await first
    await store.graph()
    expect(reads.n).toBe(2)
  })

  it('overlapping refreshes report a change exactly once in total', async () => {
    const store = new ResourceStore(ctx(), ADAPTERS)
    await store.refresh()
    rmSync(join(repo, 'data', 'members.yaml'))
    store.invalidate('data/members.yaml')
    const both = await Promise.all([store.refresh(), store.refresh()])
    expect(both.flat().sort()).toEqual(['absent:records:members', 'person:ana', 'person:steward-a'])
  })

  it('readResources reads this repository whole', async () => {
    const g = await readResources(REAL_REPO)
    expect(g.nodes.some(n => n.kind === 'project')).toBe(true)
    expect(g.nodes.some(n => n.kind === 'module')).toBe(true)
    expect(g.nodes.some(n => n.kind === 'instance')).toBe(true)
  })
})
