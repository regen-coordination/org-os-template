import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SKINS } from './index.ts'
import { coloursIn, darkBlocks, declarations, ratio, type Scheme } from './read.ts'

/** What a skin may be made of is its tokens, so what a person can read is a property of its tokens: WCAG 2.2
 *  contrast (1.4.3 text 4.5:1, 1.4.11 the edge of a control, a selected state and a focus ring 3:1),
 *  measured for every skin in light and in dark, on the surfaces text and controls sit on. */
const dir = fileURLToPath(new URL('.', import.meta.url))
const css = (id: string) => readFileSync(`${dir}${id}.css`, 'utf8')

/** The tokens whose value differs between the two dark blocks, as readable lines. */
const darkDrift = (src: string, id: string): string[] => {
  const [system, chosen] = darkBlocks(src, id).map(declarations) as [Record<string, string>, Record<string, string>]
  return [...new Set([...Object.keys(system), ...Object.keys(chosen)])].sort()
    .filter(k => system[k] !== chosen[k])
    .map(k => `--${k}: ${system[k] ?? 'missing'} under the system preference, ${chosen[k] ?? 'missing'} when dark is chosen`)
}
const coloursOf = (id: string, scheme: Scheme) => coloursIn(css(id), id, scheme)

const SURFACES = ['paper', 'raised', 'pop', 'sunken', 'wash', 'accent-soft', 'attn-soft', 'row-hover', 'input-fill', 'block-bg', 'nav-on-bg']
/** [foreground token, background token, floor]. Text is read at 4.5; the edge of a control, the outline
 *  that marks a selection and the focus ring at 3. --rule is a decorative hairline and is not measured. */
const PAIRS: ReadonlyArray<readonly [string, string, number]> = [
  ...['ink', 'mute', 'faint', 'attn', 'accent'].flatMap(fg => SURFACES.map(bg => [fg, bg, 4.5] as const)),
  ['ink', 'wash-strong', 4.5], // only ink sits on wash-strong (spec §3.2, rule 1)
  ['nav-ink', 'paper', 4.5], ['nav-ink', 'nav-on-bg', 4.5], ['on-solid', 'solid', 4.5], ['on-solid', 'accent', 4.5],
  ['on-accent', 'accent', 4.5], ['on-accent', 'attn', 4.5],
  ...['edge', 'focus', 'accent'].flatMap(fg => ['paper', 'raised', 'wash', 'accent-soft'].map(bg => [fg, bg, 3] as const)),
  ['input-edge', 'input-fill', 3], ['input-edge', 'paper', 3], ['input-edge', 'raised', 3],
  ['solid', 'paper', 3], ['solid', 'raised', 3],
]
/** Tokens every skin must give a colour (or transparent) for: a missing one fails, a transparent one is skipped. */
const REQUIRED = new Set(PAIRS.flatMap(([a, b]) => [a, b]))

/** The pairs of a colour set that fall under their floor, as readable lines. */
function failures(c: Record<string, string | null | undefined>): string[] {
  const out: string[] = []
  for (const t of REQUIRED) if (c[t] === undefined) out.push(`--${t}: a token is missing`)
  for (const [fg, bg, floor] of PAIRS) {
    const [f, b] = [c[fg], c[bg]]
    if (!f || !b) continue
    const r = ratio(f, b)
    if (r < floor) out.push(`--${fg} ${f} on --${bg} ${b}: ${r.toFixed(2)}:1, needs ${floor}:1`)
  }
  return out
}

/** Bare is the P1 register, kept as it was drawn (the platform's screenshots hold it to the pixel). Its
 *  faint text is under the floor, in light and in dark. It is a known exception, listed so it cannot
 *  spread, and the test below fails when one stops being true, so it cannot go stale. Raising it changes
 *  bare's look: that is a decision for the operator, not a fix for a test. */
const KNOWN: Record<string, Record<Scheme, string[]>> = {
  bare: {
    light: ['faint on paper', 'faint on raised', 'faint on pop', 'faint on sunken', 'faint on wash', 'faint on accent-soft', 'faint on attn-soft', 'faint on input-fill'],
    dark: ['faint on paper', 'faint on raised', 'faint on pop', 'faint on sunken', 'faint on wash', 'faint on accent-soft', 'faint on attn-soft', 'faint on input-fill'],
  },
}
const label = (line: string) => /^--(\S+) .* on --(\S+) /.exec(line)?.slice(1, 3).join(' on ') ?? line

describe('every skin can be read', () => {
  for (const { id } of SKINS) for (const scheme of ['light', 'dark'] as const) {
    it(`${id}, ${scheme}: text 4.5:1, control edges, selection and focus 3:1`, () => {
      const known = KNOWN[id]?.[scheme] ?? []
      const found = failures(coloursOf(id, scheme))
      expect(found.filter(f => !known.includes(label(f))), `${id} ${scheme}`).toEqual([])
      for (const k of known) expect(found.map(label), `${id} ${scheme} no longer needs the exception "${k}": remove it`).toContain(k)
    })
  }

  for (const { id } of SKINS) it(`${id}: the dark under the system preference and the dark that was chosen hold the same values`, () => {
    expect(darkDrift(css(id), id), id).toEqual([])
  })

  it('can fail on the system-dark block: a value that differs there is found, in a colour and in a shadow', () => {
    const src = css('house')
    const at = src.indexOf(':root[data-skin="house"]:not([data-theme="light"])')
    const line = /^\s*--edge:.*$/m.exec(src.slice(at))![0]
    const drifted = src.slice(0, at) + src.slice(at).replace(line, '    --edge: #3b4049;')
    expect(darkDrift(src, 'house')).toEqual([])
    expect(darkDrift(drifted, 'house').join()).toContain('--edge')
    expect(darkDrift(src.slice(0, at) + src.slice(at).replace(/^(\s*)--shadow-pop:.*$/m, '$1--shadow-pop: none;'), 'house').join()).toContain('--shadow-pop')
  })

  it('reads colours the way the browser gets them: the dark override over the light block', () => {
    const [light, dark] = [coloursOf('house', 'light'), coloursOf('house', 'dark')]
    expect(light.paper).not.toBe(dark.paper)
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort())
  })

  it('can fail: a planted pair under its floor is found, in text, in an edge and in a ring', () => {
    const ok = { paper: '#ffffff', raised: '#ffffff', pop: '#ffffff', sunken: '#eeeeee', wash: '#eeeeee', 'wash-strong': '#e4e4e4', 'attn-soft': '#f8eeee', 'on-accent': '#ffffff', ink: '#000000', mute: '#444444', faint: '#555555', attn: '#aa0000', solid: '#000000', 'on-solid': '#ffffff', edge: '#555555', focus: '#0000aa', accent: '#0000aa', 'accent-soft': '#e8e8f8', 'row-hover': null, 'nav-ink': '#000000', 'nav-on-bg': null, 'input-fill': '#eeeeee', 'input-edge': '#555555', 'block-bg': null }
    expect(failures(ok)).toEqual([])
    expect(failures({ ...ok, faint: '#aaaaaa' }).map(label)).toContain('faint on paper')
    expect(failures({ ...ok, edge: '#dddddd' }).map(label)).toContain('edge on paper')
    expect(failures({ ...ok, focus: '#eeeeee' }).map(label)).toContain('focus on raised')
    expect(failures({ ...ok, edge: undefined }).join()).toContain('missing')
    expect(failures({ ...ok, 'input-edge': '#dddddd' }).map(label)).toContain('input-edge on input-fill')
    expect(failures({ ...ok, accent: '#cccccc' }).map(label)).toContain('accent on paper')
    expect(failures({ ...ok, 'accent-soft': '#999999' }).map(label)).toContain('mute on accent-soft')
    expect(failures({ ...ok, 'row-hover': '#222222' }).map(label)).toContain('ink on row-hover')
    expect(failures({ ...ok, 'on-accent': '#3333aa' }).map(label)).toContain('on-accent on accent')
    expect(failures({ ...ok, 'wash-strong': '#333333' }).map(label)).toContain('ink on wash-strong')
  })

  it('house measures as §3.2 says', () => {
    const [L, D] = [coloursOf('house', 'light'), coloursOf('house', 'dark')] as Array<Record<string, string>>
    expect(ratio(L.faint!, L.paper!)).toBeCloseTo(4.98, 2)
    expect(ratio(L.edge!, L.raised!)).toBeCloseTo(3.95, 2)
    expect(ratio(D.edge!, D.raised!)).toBeCloseTo(3.72, 2)
    expect(ratio(D['on-accent']!, D.accent!)).toBeCloseTo(8.87, 2)
  })

  it('measures the way WCAG does: white on black is 21:1, a grey on white is 4.54:1', () => {
    expect(ratio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(ratio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
  })
})
