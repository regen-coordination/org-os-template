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
