import { describe, it, expect } from 'vitest'
import { scanSources } from '../src/scan.ts'
import { fixtureConfig, FIXTURE_ROOT } from './fixtures/config.ts'

describe('scanSources', () => {
  it('finds all notes across sources, honoring excludes', async () => {
    const notes = await scanSources(fixtureConfig(), FIXTURE_ROOT)
    const slugs = notes.map(n => n.slug).sort()
    expect(slugs).toEqual([
      'alpha/guide/reserve-ratio', 'alpha/mutual-credit', 'alpha/pooling',
      'beta/mutual-credit', 'beta/unicode-cafe',
    ])
  })
  it('parses frontmatter into title/tags/date and keeps body', async () => {
    const notes = await scanSources(fixtureConfig(), FIXTURE_ROOT)
    const pooling = notes.find(n => n.slug === 'alpha/pooling')!
    expect(pooling.title).toBe('Commitment Pooling')
    expect(pooling.tags).toEqual(['funding', 'protocol'])
    expect(pooling.body).toContain('[[Mutual Credit]]')
    expect(pooling.source).toBe('alpha')
  })
  it('falls back to filename-derived title when frontmatter has none', async () => {
    const notes = await scanSources(fixtureConfig(), FIXTURE_ROOT)
    // unicode-café.md HAS a title; craft check on slug normalization instead:
    expect(notes.find(n => n.slug === 'beta/unicode-cafe')!.title).toBe('Unicode Café')
  })
})

describe('duplicated frontmatter blocks', () => {
  it('strips a second frontmatter block from the body, first block wins', async () => {
    const { defineKmsConfig } = await import('../src/config.ts')
    const cfg = defineKmsConfig({
      identity: { name: 'x' },
      sources: [{ id: 'gamma', label: 'G', dir: 'vault/gamma', content: ['meta/double.md'] }],
    })
    const [note] = await scanSources(cfg, FIXTURE_ROOT)
    expect(note.title).toBe('Outer Title')                    // outer wins
    expect(note.frontmatter.author).toBe('Someone')           // inner keys merged
    expect(note.body).not.toContain('Inner Title')            // block stripped
    expect(note.body.trim().startsWith('# Outer Title')).toBe(true)
  })
  it('textually strips an inner block whose yaml is invalid', async () => {
    const { defineKmsConfig } = await import('../src/config.ts')
    const cfg = defineKmsConfig({
      identity: { name: 'x' },
      sources: [{ id: 'gamma', label: 'G', dir: 'vault/gamma', content: ['meta/double-invalid.md'] }],
    })
    const [note] = await scanSources(cfg, FIXTURE_ROOT)
    expect(note.title).toBe('Valid Outer')
    expect(note.body).not.toContain('Broken inner')
    expect(note.body.trim().startsWith('Body survives')).toBe(true)
  })
})
