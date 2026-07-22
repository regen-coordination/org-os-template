import { describe, it, expect, beforeAll } from 'vitest'
import { scanSources } from '../src/scan.ts'
import { buildSlugIndex } from '../src/resolver.ts'
import { renderNote, type RenderedNote } from '../src/markdown.ts'
import { buildWikilinkGraph, mergeGraphs } from '../src/graph/merge.ts'
import { convertNetworkx } from '../src/graph/convert.ts'
import { fixtureConfig, FIXTURE_ROOT } from './fixtures/config.ts'
import fs from 'node:fs/promises'; import path from 'node:path'

let notes: Awaited<ReturnType<typeof scanSources>>; let rendered: Map<string, RenderedNote>
beforeAll(async () => {
  notes = await scanSources(fixtureConfig(), FIXTURE_ROOT)
  const index = buildSlugIndex(notes)
  rendered = new Map()
  for (const n of notes) rendered.set(n.slug, await renderNote(n, index, { base: '/' }))
})

describe('graph merge', () => {
  it('builds note nodes + wikilink edges', () => {
    const g = buildWikilinkGraph(notes, rendered)
    expect(g.hasNode('note:alpha/pooling')).toBe(true)
    expect(g.hasEdge('note:alpha/pooling', 'note:alpha/mutual-credit')).toBe(true)
    expect(g.getNodeAttribute('note:alpha/pooling', 'kind')).toBe('note')
  })
  it('merges semantic + wikilink graphs, bridging via sourceFile match', async () => {
    const raw = JSON.parse(await fs.readFile(path.join(FIXTURE_ROOT, 'vault/graph.json'), 'utf8'))
    const semantic = convertNetworkx(raw, 'alpha')
    const merged = mergeGraphs([semantic], buildWikilinkGraph(notes, rendered), notes)
    // semantic node whose source_file matches a scanned note gets slug attr → clickable
    expect(merged.getNodeAttribute('alpha:commitment-pooling', 'slug')).toBe('alpha/pooling')
    expect(merged.order).toBeGreaterThanOrEqual(7)   // 2 semantic + 5 notes
  })
})
