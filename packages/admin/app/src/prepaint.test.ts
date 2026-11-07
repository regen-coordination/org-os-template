// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SKIN_KEY } from './skin.ts'

const html = readFileSync(join(process.cwd(), 'app/index.html'), 'utf8') // vitest runs from packages/admin
const inline = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''

/** Runs the page's inline script against a stand-in document and storage; returns what it set on <html>. */
function run(opts: { stored?: string | null; refuse?: boolean; fallback?: string }): string | undefined {
  const root = { dataset: {} as Record<string, string> }
  const storage = { getItem: (k: string) => { if (opts.refuse) throw new Error('refused'); return k === SKIN_KEY ? opts.stored ?? null : null } }
  const code = inline.replaceAll('%VITE_ORG_OS_SKIN%', opts.fallback ?? '%VITE_ORG_OS_SKIN%')
  new Function('document', 'localStorage', code)({ documentElement: root }, storage)
  return root.dataset.skin
}

describe('the skin before the first paint (index.html)', () => {
  it('sets data-skin from an inline script that comes before the module and the stylesheet', () => {
    expect(inline).toContain('dataset.skin')
    const at = (s: string) => html.indexOf(s)
    expect(at('<script>')).toBeGreaterThan(-1)
    expect(at('<script>')).toBeLessThan(at('type="module"'))
  })

  it("applies the viewer's stored choice", () => {
    expect(run({ stored: 'bare' })).toBe('bare')
    expect(run({ stored: 'bare', fallback: 'house' })).toBe('bare')
  })

  it("falls back to the instance's default, then to nothing (the stylesheet's house)", () => {
    expect(run({ stored: null, fallback: 'bare' })).toBe('bare')
    expect(run({ stored: null })).toBeUndefined()
  })

  it('survives refused storage and a made-up stored value', () => {
    expect(run({ refuse: true, fallback: 'bare' })).toBe('bare')
    expect(run({ refuse: true })).toBeUndefined()
    expect(run({ stored: '"><script>', fallback: 'bare' })).toBe('bare')
  })

  it('says that no choice draws house, the stylesheet\'s plain :root', () => {
    expect(inline).toMatch(/none set means the stylesheet's house/)
  })

  it('holds a key that is the one skin.ts stores under', () => {
    expect(SKIN_KEY).toBe('org-os-admin.skin')
    expect(inline).toContain(SKIN_KEY)
  })
})
