/** The gate, read-only: the dry read and the plan are the real selection computed in memory, and every one of these
 *  calls leaves the instance byte for byte as it was. */
import { afterEach, describe, expect, it } from 'vitest'
import { dryRead, previewEntry, publishPlan } from '../../../server/knowledge/gate.ts'
import { FIXTURE_NOW, makeKmsInstance, type FixtureInstance } from './fixture.ts'

let instance: FixtureInstance | null = null
afterEach(() => { instance?.cleanup(); instance = null })

describe('dryRead — the selection, run in memory', () => {
  it('counts the canon, the selection and the reasons, from the fixture', async () => {
    instance = makeKmsInstance()
    const read = await dryRead(instance.dir, { now: FIXTURE_NOW })
    expect(read.counts).toEqual({ canon: 8, selected: 6, internal: 1, awaiting: 1, withheld: 0 })
    expect(read.kinds.map(k => [k.schema, k.writes])).toEqual([
      ['concept-lineage', 1], ['encyclopedia-entry', 2], ['option-entry', 1], ['resource', 1], ['source-system', 1],
    ])
  })

  it('names the broken reference with the fix kms gives it', async () => {
    instance = makeKmsInstance()
    const read = await dryRead(instance.dir, { now: FIXTURE_NOW })
    expect(read.broken).toEqual([{ slug: 'no-such-note', type: 'encyclopedia-entry', entry: 'living-mulch', fix: 'No entry with this name. Fix the reference or publish the entry.' }])
  })

  it('lists the peer as it reads, and says in its own words that nothing was written', async () => {
    instance = makeKmsInstance()
    const read = await dryRead(instance.dir, { now: FIXTURE_NOW })
    expect(read.peers).toEqual([{ name: 'atproto', state: 'failed' }])
    expect(read.writes).toContain('Nothing has been written')
  })

  it('writes nothing: a dry read is a read', async () => {
    instance = makeKmsInstance()
    const before = instance.snapshot()
    await dryRead(instance.dir, { now: FIXTURE_NOW })
    await publishPlan(instance.dir, { now: FIXTURE_NOW })
    await previewEntry(instance.dir, 'encyclopedia-entry', 'living-mulch', { now: FIXTURE_NOW })
    expect(instance.snapshot()).toEqual(before)
  })
})

describe('publishPlan — what a run would do, and the command that does it', () => {
  it('counts what joins, what stays and what leaves, against the manifest', async () => {
    instance = makeKmsInstance()
    const plan = await publishPlan(instance.dir, { now: FIXTURE_NOW })
    expect(plan.ok).toBe(true)
    expect(plan.refused).toBeNull()
    // seed-saving is selected and was never written (a peer's entry is a row); the two unselected objects are in it.
    expect(plan.counts).toMatchObject({ joins: 1, unchanged: 5, leaves: 2, withheld: 0 })
    expect(plan.command).toBe('org-os-kms publish --apply')
    expect(plan.classes).toEqual(['publication'])
  })

  it('names the families of files, never a total only a run can know', async () => {
    instance = makeKmsInstance()
    const plan = await publishPlan(instance.dir, { now: FIXTURE_NOW })
    expect(plan.calls.map(c => c.what)).toEqual([
      'One index, and a page per kind',
      'A page and an API object per selected entry',
      'The records peers read',
      'The knowledge manifest and the search index',
    ])
    expect(plan.calls[0]!.where).toContain('public/index.html')
    expect(JSON.stringify(plan)).not.toMatch(/\d+ files/)
  })

  it('carries the report a run would give back, so the payload is not a black box', async () => {
    instance = makeKmsInstance()
    const plan = await publishPlan(instance.dir, { now: FIXTURE_NOW })
    expect(plan.report).toMatchObject({ gate: { passed: 6, rejected: 0 }, static: { status: 'planned', dir: 'public' }, atproto: { created: 1, deleted: 2 } })
    expect(plan.from[0]).toContain('kms selectPublic')
  })

  it('refuses where kms refuses: a canon publishes nothing itself', async () => {
    instance = makeKmsInstance()
    const { appendFileSync } = await import('node:fs')
    appendFileSync(`${instance.dir}/kms.yaml`, 'planes:\n  public:\n    instance: example-dao-public\n')
    const plan = await publishPlan(instance.dir, { now: FIXTURE_NOW })
    expect(plan.ok).toBe(false)
    expect(plan.refused).toContain('this instance is a canon')
    expect(plan.refused).toContain('example-dao-public')
  })
})

describe('previewEntry — the projected object, exactly', () => {
  it('answers the face the commons renders, with its related rows and its credit', async () => {
    instance = makeKmsInstance()
    const { entry } = await previewEntry(instance.dir, 'encyclopedia-entry', 'living-mulch', { now: FIXTURE_NOW })
    expect(entry.published).toBe(true)
    expect(entry.title).toBe('Living mulch')
    expect(entry.lead).toContain('A cover crop kept growing')
    expect(entry.related.map(r => r.slug)).toEqual(['cover-cropping', 'seed-saving'])
    expect(entry.cite).toBe('Credit the Example DAO Seed Library, CC BY.')
    expect(JSON.stringify(entry)).not.toContain('ask about the neighbour')
  })

  it('answers the API twin as kms projects it: the private fields are gone', async () => {
    instance = makeKmsInstance()
    const { json } = await previewEntry(instance.dir, 'encyclopedia-entry', 'living-mulch', { now: FIXTURE_NOW })
    expect(json).toMatchObject({ title: 'Living mulch', public_use: 'reviewed-for-guidance' })
    expect(json).not.toHaveProperty('notes')
  })

  it('has no face for an entry the commons does not show, and says why', async () => {
    instance = makeKmsInstance()
    await expect(previewEntry(instance.dir, 'encyclopedia-entry', 'staff-handbook', { now: FIXTURE_NOW }))
      .rejects.toThrow(/No published entry encyclopedia-entry\/staff-handbook/)
  })
})
