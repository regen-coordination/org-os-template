import { describe, it, expect, beforeAll } from 'vitest'
import { scanSources, type NoteFile } from '../src/scan.ts'
import { buildSlugIndex, resolveLink, type SlugIndex } from '../src/resolver.ts'
import { fixtureConfig, FIXTURE_ROOT } from './fixtures/config.ts'

let notes: NoteFile[]; let index: SlugIndex
beforeAll(async () => { notes = await scanSources(fixtureConfig(), FIXTURE_ROOT); index = buildSlugIndex(notes) })

describe('resolveLink', () => {
  it('resolves same-source title match first', () => {
    const r = resolveLink('Mutual Credit', 'alpha', index)
    expect(r.status).toBe('ok'); expect(r.note!.slug).toBe('alpha/mutual-credit')
  })
  it('resolves unique cross-source match', () => {
    const r = resolveLink('Commitment Pooling', 'beta', index)
    expect(r.status).toBe('ok'); expect(r.note!.slug).toBe('alpha/pooling')
  })
  it('flags cross-source ambiguity when linker has no local match', () => {
    // a hypothetical third source linking 'Mutual Credit' — simulate with unknown fromSource
    const r = resolveLink('Mutual Credit', 'gamma', index)
    expect(r.status).toBe('ambiguous'); expect(r.candidates.map(n => n.slug).sort())
      .toEqual(['alpha/mutual-credit', 'beta/mutual-credit'])
  })
  it('reports missing targets', () => {
    expect(resolveLink('Nowhere', 'alpha', index).status).toBe('missing')
  })
  it('matches case- and diacritic-insensitively', () => {
    expect(resolveLink('unicode cafe', 'alpha', index).note!.slug).toBe('beta/unicode-cafe')
  })
})
