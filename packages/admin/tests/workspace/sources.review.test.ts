import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { privateReads } from '../../server/private/reads.ts'
import { readConfig } from '../../server/visibility/config.ts'
import { gateRegistry, Levels, MAINTAINERS } from '../../server/visibility/gate.ts'
import { fromOf, sourcesFor, withFromMarks } from '../../server/workspace/sources.ts'
import { SystemReader } from '../../server/systems/reader.ts'
import type { Driver, DriverRead } from '../../server/systems/driver.ts'
import type { Viewer } from '../../lib/visibility.mjs'

// DAO-OS L6 §10, the review of Tasks 13 and 14 (platform full): the cost of `?from` on a collection the store holds, what
// Sources says of an import a viewer may read nothing of, and the System reader's cache as Sources reads it. Fresh
// temporary repositories (makeChangeRepo) and stores in temp folders of their own; placeholders only; no network.

const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const AT_OPS = `hat:${OPS}`
const AT_COUNCIL = `hat:${COUNCIL}`
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const TASKS = `schema_version: "2.0"
tasks:
  - { id: t-plain, title: Write the agenda, status: todo }
  - id: t-imported
    title: Water the garden
    status: doing
    from: { source: notion, id: "0123456789abcdef0123456789abcdef", exported: "2026-08-12" }
`
const OPS_LEAD: Viewer = { kind: 'member', id: 'steward-a', hats: [OPS], roles: [] }

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed by the test */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})
const temp = (tag: string): string => { const d = mkdtempSync(join(tmpdir(), tag)); cleanup.push(d); return d }

async function world(files: Record<string, string> = {}): Promise<{ repo: string; store: PrivateStore }> {
  const repo = makeChangeRepo(GOVERNANCE)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), `visibility:\n  defaults: { contact: "${AT_OPS}" }\n`)
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(repo, rel), text)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture"')
  const store = await openPrivateStore(repo, { dir: temp('sources-review-') }); stores.push(store)
  return { repo, store }
}
const levelsOf = (repo: string, store: PrivateStore) => new Levels(repo, readConfig(repo), MAINTAINERS, privateReads(() => store))

describe('I3: `?from` on a collection the store holds (Tasks 13–14 review)', () => {
  it('3000 private records are marked within a bound well under a second', async () => {
    const w = await world()
    await w.store.putCollection({ id: 'big-private', visibility: AT_OPS, definition: { id: 'big-private', name: 'Big', fields: [{ id: 'title', type: 'text' }] } }, 'steward-a')
    await w.store.tx(tx => {
      for (let i = 0; i < 3000; i++) tx.putRecord({ collection: 'big-private', id: `r-${i}`, visibility: AT_OPS, body: { title: `Row ${i}`, note: 'x'.repeat(200) }, rev: '' }, 'steward-a', null)
    })
    const levels = levelsOf(w.repo, w.store)
    const answer = gateRegistry(OPS_LEAD, w.repo, 'big-private', levels)
    expect(answer.entries).toHaveLength(3000)
    const t = performance.now()
    const marked = await withFromMarks(answer, 'big-private', { repo: w.repo, store: w.store, viewer: OPS_LEAD, levels, reads: {} })
    const ms = performance.now() - t
    expect(marked.entries!.filter(e => e.fromMark)).toHaveLength(3000)
    expect(ms).toBeLessThan(750)
  }, 60_000)

  it('the marks equal the one-by-one judgement\'s, for git and store records alike', async () => {
    const w = await world({ 'data/tasks.yaml': TASKS })
    await w.store.putRecord({ collection: 'tasks', id: 't-payroll', visibility: AT_OPS, body: { title: 'Payroll run', status: 'todo' }, rev: '' }, 'steward-a', null)
    await w.store.putRecord({ collection: 'tasks', id: 't-council', visibility: AT_COUNCIL, body: { title: 'Council only', status: 'todo' }, rev: '' }, 'steward-a', null)
    await w.store.putCollection({ id: 'small-private', visibility: AT_OPS, definition: { id: 'small-private', name: 'Small', fields: [{ id: 'title', type: 'text' }] } }, 'steward-a')
    for (const id of ['a', 'b']) await w.store.putRecord({ collection: 'small-private', id, visibility: AT_OPS, body: { title: id, from: { source: 'notion', id: `${id.repeat(32)}`, exported: '2026-08-12' } }, rev: '' }, 'steward-a', null)
    for (const registry of ['tasks', 'small-private']) {
      const levels = levelsOf(w.repo, w.store)
      const answer = gateRegistry(OPS_LEAD, w.repo, registry, levels)
      const fast = await withFromMarks(answer, registry, { repo: w.repo, store: w.store, viewer: OPS_LEAD, levels, reads: {} })
      const slow = await Promise.all((answer.entries ?? []).map(e => fromOf({ registry, id: String(e.id), from: e.from }, { repo: w.repo, store: w.store, viewer: OPS_LEAD, reads: {} })))
      expect(fast.entries!.map(e => e.fromMark ?? null)).toEqual(slow)
      expect(slow.filter(Boolean).length).toBeGreaterThan(1)
    }
  })
})

describe('M4: an import a viewer may read nothing of (Tasks 13–14 review)', () => {
  it('is absent from Sources for them, and there for a viewer who may read its items', async () => {
    const w = await world({ 'data/imports.yaml': 'imports:\n  - { id: imp_private000000000, source: fileverse, export: "2026-10-01", at: "2026-10-01T10:00:00.000Z", by: steward-a, created: { pages: 1, records: 0, collections: 0 }, updated: 0, kept: 0, not_carried: [], blobs: {} }\n' })
    const mark = { source: 'fileverse', id: 'steward-doc', exported: '2026-10-01', doc: 'steward-doc' }
    await w.store.putRecord({ collection: 'pages', id: 'p-aaaaaaaaaaaa', visibility: AT_OPS, body: { title: 'steward-doc', parent: null, order: 1000, markdown: '', from: mark }, rev: '' }, 'steward-a', null)
    const outsider: Viewer = { kind: 'member', id: 'steward-c', hats: [], roles: [] }
    const theirs = await sourcesFor(w.repo, outsider, { reader: null, store: w.store })
    expect(theirs.filter(s => s.kind === 'import')).toEqual([])
    expect(JSON.stringify(theirs)).not.toContain('imp_private')
    const ours = await sourcesFor(w.repo, OPS_LEAD, { reader: null, store: w.store })
    expect(ours.filter(s => s.kind === 'import')).toEqual([
      { id: 'import:imp_private000000000', kind: 'import', name: 'Fileverse', supplies: [{ what: 'pages', count: 1, href: '/workspace' }], read: { at: '2026-10-01', state: 'aged' } },
    ])
  })
})

describe('M5: the System reader\'s cache as Sources reads it (Tasks 13–14 review)', () => {
  const NOW = new Date('2026-10-30T12:00:00Z')
  const BOX = { id: 'box', kind: 'probe', name: 'Box', driver: 'probe', address: '0x01' }
  /** A driver with no hosts (nothing kept on disk) whose reads wait for the test to let them go. */
  function gated() {
    const waiting: ((read: DriverRead) => void)[] = []
    const driver: Driver = { name: 'probe', hosts: [], read: () => new Promise<DriverRead>(done => { waiting.push(done) }) }
    const read = (n: number): DriverRead => ({ ok: true, readAt: NOW.toISOString(), facts: { n }, sections: [{ title: 'Rows', rows: [{ cells: [String(n)] }] }], open: null })
    return { driver, release: (n: number) => waiting.shift()!(read(n)) }
  }

  it('keeps the last good read apart from the TTL cache, shown with its state during a re-read; a read under another config is not current', async () => {
    const g = gated()
    const reader = new SystemReader({ repo: '/nonexistent', now: () => NOW, drivers: [g.driver] })
    const first = reader.read(BOX); g.release(1); await first
    expect(reader.cached('box', BOX)).toMatchObject({ ok: true, facts: { n: 1 }, state: 'fresh' })
    // The tick forgets the TTL cache; a re-read is under way: the last good read is still what Sources shows.
    reader.expire()
    const again = reader.read(BOX)
    expect(reader.cached('box', BOX)).toMatchObject({ ok: true, facts: { n: 1 }, state: 'reading' })
    g.release(2); await again
    expect(reader.cached('box', BOX)).toMatchObject({ facts: { n: 2 }, state: 'fresh' })
    // The entry edited (another address): the read cached under the old one is not this System's now.
    expect(reader.cached('box', { ...BOX, address: '0x02' })).toBeNull()
  })

  it('Sources shows a System read under its config now, and nothing for one read under an older config', async () => {
    const g = gated()
    const reader = new SystemReader({ repo: '/nonexistent', now: () => NOW, drivers: [g.driver] })
    const w = await world({ 'data/systems.yaml': `schema_version: "2.0"\nsystems:\n  - { id: box, kind: probe, name: Box, driver: probe, address: "0x01" }\n` })
    const raw = { id: 'box', kind: 'probe', name: 'Box', driver: 'probe', address: '0x01' }
    const first = reader.read(raw); g.release(7); await first
    const box = async () => (await sourcesFor(w.repo, OPS_LEAD, { reader, store: w.store })).find(s => s.id === 'system:box')!
    expect(await box()).toMatchObject({ supplies: [{ what: 'Rows', count: 1 }], read: { state: 'fresh' } })
    writeFileSync(join(w.repo, 'data', 'systems.yaml'), `schema_version: "2.0"\nsystems:\n  - { id: box, kind: probe, name: Box, driver: probe, address: "0x02" }\n`)
    git(w.repo, 'commit -qam "systems: box moved"')
    expect(await box()).toMatchObject({ supplies: [], read: { at: null, state: expect.not.stringMatching(/^fresh$/) } })
  })
})
