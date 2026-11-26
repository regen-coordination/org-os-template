/** The canon read, against a temp instance built from the repo's own fixture: the lanes, the entry's checks and
 *  references, the peers' read states, and — the point of a read — that nothing on disk changed. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { previewEntry, publishPlan } from '../../../server/knowledge/gate.ts'
import { readEntry, readKnowledge } from '../../../server/knowledge/read.ts'
import { FIXTURE_NOW, makeBareRepo, makeKmsInstance, type FixtureInstance } from './fixture.ts'

let instance: FixtureInstance | null = null
afterEach(() => { instance?.cleanup(); instance = null })

describe('readKnowledge — the collection', () => {
  it('answers the fixture’s eight entries in four lanes, six published', async () => {
    instance = makeKmsInstance()
    const view = await readKnowledge(instance.dir, { now: FIXTURE_NOW })
    expect(view.configured).toBe(true)
    expect(view.instance).toBe('Example DAO Commons')
    expect(view.did).toBe('did:plc:exampledao')
    expect(view.sentence).toBe('Field notes and practice from the Example DAO growers.')
    expect(view.counts).toMatchObject({ entries: 8, published: 6, awaiting: 1, internal: 1, draft: 0, kinds: 6, sources: 1 })
    expect(view.lanes.map(l => [l.id, l.count])).toEqual([['draft', 0], ['awaiting', 1], ['published', 6], ['internal', 1]])
  })

  it('names each row’s reason, so the standline’s second line is the data’s', async () => {
    instance = makeKmsInstance()
    const view = await readKnowledge(instance.dir, { now: FIXTURE_NOW })
    const row = (slug: string) => view.lanes.flatMap(l => l.rows).find(r => r.slug === slug)!
    expect(row('seed-swap-notes')).toMatchObject({ lane: 'awaiting', why: 'raw · written with AI help', type: 'claim-evidence' })
    expect(row('staff-handbook')).toMatchObject({ lane: 'internal', why: 'public use: internal only' })
    expect(row('living-mulch')).toMatchObject({ lane: 'published', why: 'in the selection' })
    expect(row('living-mulch').id).toBe('encyclopedia-entry/living-mulch')
    expect(row('living-mulch').pageHref).toBe('k/encyclopedia-entry/id-living-mulch.html')
  })

  it('holds the fixture’s own dates, and the days between them and the clock it is given', async () => {
    instance = makeKmsInstance()
    const view = await readKnowledge(instance.dir, { now: FIXTURE_NOW })
    const living = view.lanes.flatMap(l => l.rows).find(r => r.slug === 'living-mulch')!
    expect(living.updated).toBe('2026-10-20')
    expect(living.updatedDays).toBe(9)
  })

  it('counts the kinds the canon holds, with the glyph kms gives each', async () => {
    instance = makeKmsInstance()
    const view = await readKnowledge(instance.dir, { now: FIXTURE_NOW })
    expect(view.kinds.find(k => k.schema === 'encyclopedia-entry')).toMatchObject({ count: 3, label: 'Encyclopedia entry', glyph: 'book' })
    expect(view.kinds.find(k => k.schema === 'source-system')).toMatchObject({ count: 1, glyph: 'db' })
  })

  it('reads the peer from its sidecar: one failure, nine days old, with the error kept', async () => {
    instance = makeKmsInstance()
    const view = await readKnowledge(instance.dir, { now: FIXTURE_NOW })
    expect(view.peers).toEqual([
      { id: 'connector:atproto', name: 'atproto', relation: 'connector', detail: 'did:plc:hillsidepeer', state: 'failed', ageDays: 9, error: 'timeout' },
    ])
    expect(view.counts.peers).toBe(1)
  })

  it('says what decides: no rule of its own here, so the floor alone', async () => {
    instance = makeKmsInstance()
    const view = await readKnowledge(instance.dir, { now: FIXTURE_NOW })
    expect(view.rule.module).toBeNull()
    expect(view.rule.sentence).toContain('the floor decides what may be public')
    expect(view.plane).toMatchObject({ dir: 'public', pages: true, atproto: true })
  })

  it('walks the canon’s own files rather than inventing a store', async () => {
    instance = makeKmsInstance()
    const view = await readKnowledge(instance.dir, { now: FIXTURE_NOW })
    expect(view.files.map(f => f.path)).toEqual(['kms.yaml', 'data/kb/', 'data/kms-reads.json', 'data/kms-cursors.json', 'public/'])
    expect(view.files.find(f => f.path === 'data/kms-reads.json')!.what).toBe('1 failure recorded')
    expect(view.files.find(f => f.path === 'public/')!.state).toBe('not written yet')
  })

  it('in a canon, reads the public plane where the canon names it: repos/<plane>, by the plane’s own kms.yaml', async () => {
    instance = makeKmsInstance()
    const kmsPath = join(instance.dir, 'kms.yaml')
    const canon = parse(readFileSync(kmsPath, 'utf8'))
    writeFileSync(kmsPath, stringify({ ...canon, planes: { public: { instance: 'example-dao-public' } } }))
    const { mkdirSync } = await import('node:fs')
    const plane = join(instance.dir, 'repos', 'example-dao-public')
    mkdirSync(join(plane, 'site', '.well-known'), { recursive: true })
    writeFileSync(join(plane, 'kms.yaml'), stringify({
      instance: 'example-dao-public', adapter: 'repo-data', target: '.',
      publish: { static: true, static_dir: 'site', base_url: 'http://127.0.0.1:1', pages: true },
      planes: { role: 'public', canon: 'Example DAO Commons' },
    }))
    writeFileSync(join(plane, 'site', '.well-known', 'knowledge.json'), '{}')
    const view = await readKnowledge(instance.dir, { now: FIXTURE_NOW })
    expect(view.plane).toMatchObject({ dir: 'repos/example-dao-public/site', pages: true, static: true, atproto: false, lastRun: '0 d ago' })
    expect(view.files.at(-1)).toMatchObject({ path: 'repos/example-dao-public/site/', state: 'written 0 d ago' })
  })

  it('writes nothing: every byte on disk is the byte it was', async () => {
    instance = makeKmsInstance()
    const before = instance.snapshot()
    await readKnowledge(instance.dir, { now: FIXTURE_NOW })
    await readEntry(instance.dir, 'encyclopedia-entry', 'living-mulch', { now: FIXTURE_NOW })
    expect(instance.snapshot()).toEqual(before)
  })

  it('answers one sentence, not a broken page, when this repository has no canon', async () => {
    const bare = makeBareRepo()
    try {
      const view = await readKnowledge(bare.dir, { now: FIXTURE_NOW })
      expect(view.configured).toBe(false)
      // kms's code is here (it is this package's sibling); the *instance* is not set up, and that is the sentence.
      expect(view.reason).toContain('the commons is not set up here')
      expect(view.lanes).toEqual([])
      expect(view.rule.sentence).toContain('nothing decides')
    } finally { bare.cleanup() }
  })

  it('answers one sentence when kms is here but the instance has no kms.yaml', async () => {
    instance = makeKmsInstance()
    const { rmSync } = await import('node:fs')
    rmSync(`${instance.dir}/kms.yaml`)
    const view = await readKnowledge(instance.dir, { now: FIXTURE_NOW })
    expect(view.configured).toBe(false)
    expect(view.reason).toContain('the commons is not set up here')
  })
})

describe('readEntry — one entry, as the record draws it', () => {
  it('puts the broken reference and the internal one on the record, with the fix in words', async () => {
    instance = makeKmsInstance()
    const view = await readEntry(instance.dir, 'encyclopedia-entry', 'living-mulch', { now: FIXTURE_NOW })
    expect(view.row).toMatchObject({ title: 'Living mulch', lane: 'published' })
    const refs = view.references
    expect(refs.map(r => r.slug)).toEqual(['cover-cropping', 'staff-handbook', 'seed-saving', 'no-such-note'])
    expect(refs.find(r => r.slug === 'staff-handbook')).toMatchObject({ internal: true })
    expect(refs.find(r => r.slug === 'no-such-note')).toMatchObject({ broken: true, href: null })
    expect(view.checks.find(c => c.field === 'references')).toMatchObject({ mark: { shape: 'needs' }, note: '1 points at nothing' })
  })

  it('shows the private fields with “not published”, and the public face without them', async () => {
    instance = makeKmsInstance()
    const view = await readEntry(instance.dir, 'encyclopedia-entry', 'living-mulch', { now: FIXTURE_NOW })
    const notes = view.provenance.find(p => p.field === 'notes')!
    expect(notes).toMatchObject({ published: false })
    expect(notes.value).toContain('ask about the neighbour')
    expect(view.publicFace.published).toBe(true)
    expect(view.publicFace.related.map(r => r.slug)).toEqual(['cover-cropping', 'seed-saving'])
    expect(JSON.stringify(view.publicFace)).not.toContain('ask about the neighbour')
    expect(view.publicFace.cite).toBe('Credit the Example DAO Seed Library, CC BY.')
  })

  it('names the paths a publication writes, from the manifest’s own AT URI', async () => {
    instance = makeKmsInstance()
    const view = await readEntry(instance.dir, 'encyclopedia-entry', 'living-mulch', { now: FIXTURE_NOW })
    const value = (label: string) => view.goes.find(g => g.label.toLowerCase() === label.toLowerCase())?.value
    expect(value('page')).toBe('public/k/encyclopedia-entry/id-living-mulch.html')
    expect(value('API')).toBe('public/api/encyclopedia-entry/id-living-mulch.json')
    expect(value('AT Proto')).toBe('at://did:plc:exampledao/org.exampledao.encyclopedia-entry/id-living-mulch')
    expect(view.file).toBe('data/kb/encyclopedia-entry.yaml')
  })

  it('says why an internal entry is not in the commons, without pretending it is', async () => {
    instance = makeKmsInstance()
    const view = await readEntry(instance.dir, 'encyclopedia-entry', 'staff-handbook', { now: FIXTURE_NOW })
    expect(view.row.lane).toBe('internal')
    expect(view.publicFace.published).toBe(false)
    expect(view.publicFace.reason).toContain('internal')
    // No face for what the commons will not show: none of its words travel under the "what the commons shows" band.
    expect(view.publicFace).toMatchObject({ lead: '', body: [], about: [], related: [], cite: null, atUri: null })
    expect(JSON.stringify(view.publicFace)).not.toContain('How the crew works')
  })

  it('says no record for an internal entry, even when an earlier run left its AT URI in the manifest (walk M8)', async () => {
    instance = makeKmsInstance()
    const view = await readEntry(instance.dir, 'encyclopedia-entry', 'staff-handbook', { now: FIXTURE_NOW })
    expect(view.row.lane).toBe('internal')
    expect(view.row.atUri).toBeNull()
    const record = view.checks.find(c => c.field === 'record')!
    expect(record.mark.word).not.toBe('Published')
    expect(JSON.stringify(view.checks)).not.toContain('at://')
    expect(view.goes.find(g => g.label === 'AT Proto')?.value).toBe('not published')
  })

  it('refuses an entry that is not in the canon, in one sentence', async () => {
    instance = makeKmsInstance()
    await expect(readEntry(instance.dir, 'encyclopedia-entry', 'no-such-entry', { now: FIXTURE_NOW }))
      .rejects.toThrow(/No entry encyclopedia-entry\/no-such-entry/)
  })
})

/** One entry of the fixture changed on disk, through the same YAML the fixture wrote. */
function setEntry(dir: string, schema: string, slug: string, fields: Record<string, unknown>): void {
  const file = join(dir, 'data/kb', `${schema}.yaml`)
  const doc = parse(readFileSync(file, 'utf8')) as { entries: Record<string, Record<string, unknown>> }
  doc.entries[slug] = { ...(doc.entries[slug] ?? {}), ...fields }
  writeFileSync(file, stringify(doc))
}

describe('review fixes: what a run would publish is said where the steward reads (2026-11-04)', () => {
  it('an entry awaiting review that the floor selects says a run publishes it unreviewed, and the plan counts it', async () => {
    instance = makeKmsInstance()
    setEntry(instance.dir, 'claim-evidence', 'seed-swap-notes', { public_use: 'reviewed-for-guidance' })
    const view = await readKnowledge(instance.dir, { now: FIXTURE_NOW })
    const row = view.lanes.flatMap(l => l.rows).find(r => r.slug === 'seed-swap-notes')!
    expect(row.lane).toBe('awaiting')
    expect(row.why).toContain('a run publishes it unreviewed')
    const plan = await publishPlan(instance.dir, { now: FIXTURE_NOW })
    expect(plan.counts.awaiting).toBe(1)
    expect(plan.counts.internal).toBe(1)
  })

  it('matches the selection by the entry, not by its slug: a namesake in another kind stays where it is', async () => {
    instance = makeKmsInstance()
    // A draft resource that shares living-mulch's slug: the published encyclopedia entry must not lift it.
    setEntry(instance.dir, 'resource', 'living-mulch', { title: 'Living mulch (a link)', type: 'resource', public_use: 'not-public-yet', maturity: 'raw' })
    const view = await readKnowledge(instance.dir, { now: FIXTURE_NOW })
    const rows = view.lanes.flatMap(l => l.rows).filter(r => r.slug === 'living-mulch')
    expect(rows.find(r => r.type === 'encyclopedia-entry')!.lane).toBe('published')
    expect(rows.find(r => r.type === 'resource')!.lane).toBe('awaiting')
    expect(rows.find(r => r.type === 'resource')!.why).not.toContain('selected')
    const entry = await readEntry(instance.dir, 'resource', 'living-mulch', { now: FIXTURE_NOW })
    expect(entry.checks.find(c => c.field === 'your rule')!.value).toBe('Not selected')
    expect(entry.checks.find(c => c.field === 'your rule')!.note).toBe('not in the selection: its public use is not public yet') // walk D5
  })
})

describe('a canon-shaped instance with no plane role: kms-admin shows what publish would publish (kms canon gate)', () => {
  it('a draft with public use ok-with-caveat under a card that claims its corpus is not shown as published; a reviewed one is', async () => {
    instance = makeKmsInstance()
    // The fixture's card claims nothing; this one claims its checkout, so kms's selectPublic runs the canon gate too.
    setEntry(instance.dir, 'source-system', 'seed-library', { url: 'https://github.com/example-dao/seed-library', origin_prefixes: ['repos/seed-library/'] })
    const lineage = 'repos/seed-library/notes/x.md'
    setEntry(instance.dir, 'resource', 'draft-note', { title: 'Draft note', type: 'resource', public_use: 'ok-with-caveat', maturity: 'draft', source_lineage: lineage })
    setEntry(instance.dir, 'resource', 'reviewed-note', { title: 'Reviewed note', type: 'resource', public_use: 'ok-with-caveat', maturity: 'reviewed', source_lineage: lineage })
    const view = await readKnowledge(instance.dir, { now: FIXTURE_NOW })
    const row = (slug: string) => view.lanes.flatMap(l => l.rows).find(r => r.slug === slug)!
    expect(row('reviewed-note').lane).toBe('published')
    expect(row('draft-note').lane).not.toBe('published')
    expect(row('draft-note').why).not.toBe('in the selection')
    await expect(previewEntry(instance.dir, 'resource', 'draft-note', { now: FIXTURE_NOW })).rejects.toThrow(/No published entry resource\/draft-note/)
  })
})
