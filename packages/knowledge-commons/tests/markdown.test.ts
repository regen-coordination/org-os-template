import { describe, it, expect, beforeAll } from 'vitest'
import { scanSources, type NoteFile } from '../src/scan.ts'
import { buildSlugIndex, type SlugIndex } from '../src/resolver.ts'
import { renderNote } from '../src/markdown.ts'
import { fixtureConfig, FIXTURE_ROOT } from './fixtures/config.ts'

let notes: NoteFile[]; let index: SlugIndex
beforeAll(async () => { notes = await scanSources(fixtureConfig(), FIXTURE_ROOT); index = buildSlugIndex(notes) })

describe('renderNote', () => {
  it('renders resolved wikilinks as internal anchors with data-preview', async () => {
    const pooling = notes.find(n => n.slug === 'alpha/pooling')!
    const r = await renderNote(pooling, index, { base: '/' })
    expect(r.html).toContain('<a href="/alpha/mutual-credit" class="kc-wikilink" data-slug="alpha/mutual-credit">Mutual Credit</a>')
    expect(r.html).toContain('href="/alpha/guide/reserve-ratio#math"')
    expect(r.html).toContain('>the math</a>')
  })
  it('renders missing links as dead spans and records them', async () => {
    const pooling = notes.find(n => n.slug === 'alpha/pooling')!
    const r = await renderNote(pooling, index, { base: '/' })
    expect(r.html).toContain('<span class="kc-deadlink" title="not in the commons (yet)">Nowhere</span>')
    expect(r.links.filter(l => l.status === 'missing').map(l => l.target)).toEqual(['Nowhere'])
  })
  it('extracts headings with ids and a plain-text excerpt', async () => {
    const rr = notes.find(n => n.slug === 'alpha/guide/reserve-ratio')!
    const r = await renderNote(rr, index, { base: '/' })
    expect(r.headings).toEqual([{ depth: 2, text: 'Math', id: 'math' }])
    const pooling = await renderNote(notes.find(n => n.slug === 'alpha/pooling')!, index, { base: '/' })
    expect(pooling.excerpt.startsWith('A protocol built on Mutual Credit')).toBe(true)
  })
})
