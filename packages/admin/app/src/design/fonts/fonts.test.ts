import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', '..') // app/src
const app = join(src, '..') // app
const css = readFileSync(join(here, 'fonts.css'), 'utf8')
const base = readFileSync(join(here, '..', 'base.css'), 'utf8')
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => m[1]!)
const prop = (block: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim()
const files = faces.map(b => /url\("\.\/([^"]+)"\)/.exec(b)?.[1] ?? '')

describe('self-hosted fonts', () => {
  it('declares Fraunces roman and italic, Geist and Geist Mono for latin and latin-ext', () => {
    expect(faces).toHaveLength(8)
    expect(new Set(faces.map(b => prop(b, 'font-family')))).toEqual(new Set(['"Fraunces"', '"Geist"', '"Geist Mono"']))
    const by = (fam: string) => faces.filter(b => prop(b, 'font-family') === `"${fam}"`)
    expect(by('Fraunces')).toHaveLength(4)
    expect(by('Fraunces').map(b => prop(b, 'font-style')).sort()).toEqual(['italic', 'italic', 'normal', 'normal'])
    for (const b of by('Fraunces')) expect(prop(b, 'font-weight')).toBe('300 600')
    expect(by('Geist')).toHaveLength(2)
    for (const b of by('Geist')) expect(prop(b, 'font-weight')).toBe('400 600')
    expect(by('Geist Mono')).toHaveLength(2)
    for (const b of by('Geist Mono')) expect(prop(b, 'font-weight')).toBe('400 500')
    for (const b of faces) {
      expect(prop(b, 'font-display')).toBe('swap')
      expect(prop(b, 'unicode-range')).toMatch(/^U\+/)
    }
  })

  it('every src is a file beside it that is WOFF2', () => {
    expect(new Set(files).size).toBe(8)
    for (const f of files) {
      expect(existsSync(join(here, f)), f).toBe(true)
      expect(readFileSync(join(here, f)).subarray(0, 4).toString(), f).toBe('wOF2')
    }
  })

  it('names its source and the hashes match', () => {
    const header = css.slice(0, css.indexOf('@font-face'))
    for (const f of files) {
      const line = new RegExp(`${f.replace('.', '\\.')} (@?[a-z-]+@\\d+\\.\\d+\\.\\d+) sha256:([0-9a-f]{64})`).exec(header)
      expect(line, `${f} has a provenance line`).not.toBeNull()
      expect(createHash('sha256').update(readFileSync(join(here, f))).digest('hex'), f).toBe(line![2])
    }
    expect(existsSync(join(here, 'OFL-Fraunces.txt'))).toBe(true)
    expect(existsSync(join(here, 'OFL-Geist.txt'))).toBe(true)
  })

  it('no client file asks a font host', () => {
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap(n => {
        const p = join(d, n)
        return statSync(p).isDirectory() ? walk(p) : /\.(css|ts|tsx)$/.test(n) && n !== 'fonts.test.ts' ? [p] : []
      })
    for (const f of [join(app, 'index.html'), ...walk(src)]) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net/)
    }
  })
})

describe('base.css type', () => {
  it('turns on optical sizing and smoothing, and gives .display its SOFT axis', () => {
    expect(base).toContain('font-optical-sizing: auto')
    expect(base).toContain('-webkit-font-smoothing: antialiased')
    expect(base).toContain('-moz-osx-font-smoothing: grayscale')
    expect(/\.display\s*\{[^}]*font-variation-settings:\s*"SOFT" var\(--soft\)/.test(base)).toBe(true)
    expect(/\.display\s*\{[^}]*font-family:\s*var\(--display\)/.test(base)).toBe(true)
  })

  it('has the mono and wrapping helpers', () => {
    // C10 (ledger): `.num` is gone (no caller; legacy.test.ts fails a dead rule); tabular figures are each element's own
    expect(base).not.toMatch(/\.num\s*\{/)
    expect(/\.mono\s*\{[^}]*font-family:\s*var\(--mono\)[^}]*tabular-nums slashed-zero/.test(base)).toBe(true)
    expect(/h1,\s*h2,\s*h3\s*\{\s*text-wrap:\s*balance;?\s*\}/.test(base)).toBe(true)
    expect(/\bp\s*\{\s*text-wrap:\s*pretty;?\s*\}/.test(base)).toBe(true)
  })

  it('inputs use the page-prose size on a phone', () => {
    const m = /@media \(max-width: 759px\)\s*\{([^]*?)\n\}/.exec(base)
    expect(m).not.toBeNull()
    expect(m![1]).toMatch(/input[^{]*\{[^}]*font-size:\s*var\(--fs-sub\)/)
  })

  it('the document declares its language, direction and viewport', () => {
    const html = readFileSync(join(app, 'index.html'), 'utf8')
    expect(html).toContain('<html lang="en" dir="ltr">')
    expect(html).toContain('content="width=device-width, initial-scale=1, viewport-fit=cover"')
  })
})
