import { describe, it, expect, beforeAll } from 'vitest'
import { scanSources } from '../src/scan.ts'
import { buildSlugIndex } from '../src/resolver.ts'
import { renderNote, type RenderedNote } from '../src/markdown.ts'
import { buildBacklinkIndex, buildLinkReport } from '../src/backlinks.ts'
import { fixtureConfig, FIXTURE_ROOT } from './fixtures/config.ts'

let rendered: Map<string, RenderedNote>; let notes: Awaited<ReturnType<typeof scanSources>>
beforeAll(async () => {
  notes = await scanSources(fixtureConfig(), FIXTURE_ROOT)
  const index = buildSlugIndex(notes)
  rendered = new Map()
  for (const n of notes) rendered.set(n.slug, await renderNote(n, index, { base: '/' }))
})

describe('backlinks', () => {
  it('collects backlinks with source context', () => {
    const bl = buildBacklinkIndex(notes, rendered)
    expect(bl.get('alpha/mutual-credit')!.map(b => b.fromSlug)).toEqual(['alpha/pooling'])
    expect(bl.get('alpha/pooling')!.map(b => b.fromSlug)).toEqual(['beta/unicode-cafe'])
  })
  it('builds a report of missing + ambiguous links', () => {
    const report = buildLinkReport(notes, rendered)
    expect(report.missing).toEqual([{ from: 'alpha/pooling', target: 'Nowhere' }])
    expect(report.ambiguous).toEqual([])
  })
})
