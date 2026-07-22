import { describe, it, expect, vi } from 'vitest'
import { buildCommons, dedupeSlugs } from '../src/loaders.ts'
import { defineKmsConfig } from '../src/config.ts'
import { fixtureConfig, FIXTURE_ROOT } from './fixtures/config.ts'

describe('buildCommons', () => {
  it('produces notes with html/backlinks/headings, registries, link report and graph artifact', async () => {
    const c = await buildCommons(fixtureConfig(), FIXTURE_ROOT, { base: '/' })
    const pooling = c.notes.find(n => n.slug === 'alpha/pooling')!
    expect(pooling.html).toContain('kc-wikilink')
    expect(c.backlinks.get('alpha/pooling')!.length).toBe(1)
    expect(c.registries.find(r => r.source === 'alpha' && r.kind === 'projects')).toBeTruthy()
    expect(c.linkReport.missing.length).toBe(1)
    expect(c.artifact).toBeNull()   // fixture config declares no graph on sources
  })
})

describe('slug collision guard', () => {
  it('de-collides duplicate slugs deterministically and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const notes = [
      { source: 'gamma', slug: 'gamma/shared', relPath: 'rootB/shared.md', title: 'B', tags: [], date: null, frontmatter: {}, body: '' },
      { source: 'gamma', slug: 'gamma/shared', relPath: 'rootA/shared.md', title: 'A', tags: [], date: null, frontmatter: {}, body: '' },
    ] as any
    const out = dedupeSlugs(notes)
    const slugs = out.map((n: any) => n.slug).sort()
    expect(slugs).toEqual(['gamma/shared', 'gamma/shared-2'])
    // deterministic: relPath sort order picks rootA/shared.md as the canonical (unrenamed) one
    expect(out.find((n: any) => n.relPath === 'rootA/shared.md')!.slug).toBe('gamma/shared')
    expect(out.find((n: any) => n.relPath === 'rootB/shared.md')!.slug).toBe('gamma/shared-2')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('buildCommons survives a real multi-root collision with both notes intact under distinct slugs', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const config = defineKmsConfig({
      identity: { name: 'collision/commons' },
      sources: [
        { id: 'gamma', label: 'Gamma', dir: 'vault/gamma', content: ['rootA/**/*.md', 'rootB/**/*.md'] },
      ],
    })
    const c = await buildCommons(config, FIXTURE_ROOT, { base: '/' })
    const slugs = c.notes.map(n => n.slug).sort()
    expect(slugs).toEqual(['gamma/shared', 'gamma/shared-2'])
    expect(new Set(slugs).size).toBe(2)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
