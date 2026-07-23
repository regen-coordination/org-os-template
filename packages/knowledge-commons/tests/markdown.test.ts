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
  it('strips a leading level-1 heading (layout supplies the title H1)', async () => {
    const note: NoteFile = {
      source: 'alpha', slug: 'alpha/leading-h1', relPath: 'leading-h1.md',
      title: 'Leading H1', tags: [], date: null, frontmatter: {},
      body: '# Leading H1\n\nBody text.\n\n## A section\n\nmore',
    }
    const r = await renderNote(note, index, { base: '/' })
    expect(r.html).not.toContain('<h1')
    expect(r.html).toContain('<h2')           // deeper headings survive
    expect(r.excerpt.startsWith('Body text.')).toBe(true)
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
  it('heading ToC ids match the rendered heading ids (github-slugger)', async () => {
    const note: NoteFile = {
      source: 'alpha', slug: 'alpha/gh-slug', relPath: 'gh-slug.md',
      title: 'GH Slug', tags: [], date: null, frontmatter: {},
      body: '## Node.js Basics\n\ntext',
    }
    const r = await renderNote(note, index, { base: '/' })
    expect(r.headings[0].id).toBe('nodejs-basics')
    expect(r.html).toContain('id="nodejs-basics"')
  })
  it('wikilink heading anchors match rendered heading ids (github-slugger)', async () => {
    const note: NoteFile = {
      source: 'alpha', slug: 'alpha/gh-anchor', relPath: 'gh-anchor.md',
      title: 'GH Anchor', tags: [], date: null, frontmatter: {},
      body: 'See [[Reserve Ratio#Node.js Basics|there]].',
    }
    const r = await renderNote(note, index, { base: '/' })
    expect(r.html).toContain('href="/alpha/guide/reserve-ratio#nodejs-basics"')
  })
})
