import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FALLBACK_SKIN, SKINS } from './index.ts'
import { blockAfter, declarations } from './read.ts'

const dir = fileURLToPath(new URL('.', import.meta.url))
const src = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string) => readFileSync(path, 'utf8')
const skinCss = (id: string) => read(`${dir}${id}.css`)
const COLOUR = ['paper', 'ink', 'mute', 'faint', 'rule', 'wash', 'attn', 'raised', 'edge', 'solid', 'on-solid', 'focus']

const names = (block: string) => [...block.matchAll(/^\s*--([a-z0-9-]+):/gm)].map(m => m[1]!)
const lightOf = (id: string) => blockAfter(skinCss(id), `:root[data-skin="${id}"] {`)
const darkMediaOf = (id: string) => blockAfter(skinCss(id), `:root[data-skin="${id}"]:not([data-theme="light"])`)
const darkOverrideOf = (id: string) => blockAfter(skinCss(id), `:root[data-skin="${id}"][data-theme="dark"]`)

/** CSS named colours: a colour is a skin's to choose, spelled any way. `transparent` and `currentcolor` draw
 *  nothing of their own and are not listed. */
const NAMED = ('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood '
  + 'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen '
  + 'darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray '
  + 'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia '
  + 'gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender '
  + 'lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink '
  + 'lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta '
  + 'maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise '
  + 'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid '
  + 'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red '
  + 'rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow '
  + 'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' ')
const NAMED_RE = new RegExp(`(?<![\\w-])(${NAMED.join('|')})(?![\\w-])`, 'i')
/** Two rules that draw nothing (clipped to nothing; parked off screen until focused) are exempt, and only as
 *  written here: a change to either is a change to this test. */
const DRAWS_NOTHING: Record<string, string> = {
  '.sr-only': 'position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;',
  '.skip': 'position: absolute; inset-inline-start: -9999px;',
}
const SIZING = new Set(['width', 'min-width', 'max-width', 'height', 'min-height', 'max-height', 'block-size', 'inline-size'])

/** What a skin may not be given by a part: a number with a unit, a colour (hex, function or name), a weight,
 *  a font family, a border width or size spelled as a keyword, opacity, radius, shadow, spacing or duration.
 *  Returns the offending declarations. Bare lengths of 0, percentages, fr, unitless counts, the media-query
 *  breakpoints and a viewport share that caps a width or a height are structure, not a skin's look. */
export function rawValues(css: string): string[] {
  let text = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(media|container|supports)[^{]*\{/g, '{')  // a breakpoint or a feature test is a condition, not a drawn value
  for (const [sel, body] of Object.entries(DRAWS_NOTHING)) {
    const one = new RegExp(`(^|[};])\\s*${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g')
    text = text.replace(one, (all, lead: string, inner: string) => (inner.trim().replace(/\s+/g, ' ') === body ? lead : all))
  }
  const out: string[] = []
  for (const m of text.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g)) {
    const [decl, prop, value] = [m[0], m[1]!, m[2]!.trim()]
    const noVars = value.replace(/var\(--[a-z0-9-]+\)/g, 'V').replace(/(?<![\w.-])0(px|em|s|ms)\b/g, '0') // a zero is nothing, in any unit
    const words = noVars.replace(/"[^"]*"|'[^']*'|url\([^)]*\)/g, '')
    if (/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklch|oklab|color|color-mix|light-dark)\(/i.test(value)) out.push(decl)
    else if (NAMED_RE.test(words)) out.push(decl)
    else if (/(?<![\w.-])-?\d*\.?\d+(px|em|rem|ch|pt|pc|cm|mm|in|ex|lh|rlh|q|ms|s)\b/i.test(noVars)) out.push(decl)
    else if (/(?<![\w.-])-?\d*\.?\d+(vh|vw|vmin|vmax|dvh|dvw|svh|svw|lvh|lvw)\b/i.test(noVars) && !SIZING.has(prop)) out.push(decl)
    else if (['font-weight', 'opacity', 'letter-spacing', 'line-height', 'border-radius', 'box-shadow', 'stroke-width', 'stroke-dasharray', 'font-size', 'transition-duration']
      .includes(prop) && /\d/.test(noVars) && !/^0(\.0+)?(?![\d.])/.test(noVars)) out.push(decl)
    else if (prop === 'font-weight' && /\b(bold|bolder|lighter)\b/i.test(noVars)) out.push(decl)
    else if (prop === 'font-size' && /\b(x{1,3}-)?(small|large)\b|\b(smaller|larger|medium)\b/i.test(noVars)) out.push(decl)
    else if (/^(border|outline|column-rule)(-|$)/.test(prop) && /\b(thin|medium|thick)\b/i.test(noVars)) out.push(decl)
    else if (prop === 'font-family' && !value.split(',').every(v => /^\s*(var\(--[a-z0-9-]+\)|inherit|initial|unset)\s*$/.test(v))) out.push(decl)
    else if (prop === 'font' && !noVars.split(/[\s/]+/).every(w => w === 'V' || w === 'inherit' || w === '')) out.push(decl)
  }
  return out
}

/** Look properties in code: written as an object key (also inside a multi-line style object) with a literal
 *  value that is not a token. Geometry (left, top, width, height, transform) is computed, not a look. */
const LOOK_KEY = /\b(color|background\w*|font\w*|border\w*|outline\w*|opacity|boxShadow|textShadow|letterSpacing|lineHeight|padding\w*|margin\w*|gap|rowGap|columnGap|fill|stroke\w*|transition\w*|animation\w*)\s*:\s*([^,;}\n]+)/g
export function lookInCode(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const out: string[] = []
  for (const m of text.matchAll(LOOK_KEY)) {
    const v = m[2]!.trim()
    if (/^-?\.?\d/.test(v) || (/^['"`]/.test(v) && !/^['"`]var\(--[a-z0-9-]+\)/.test(v))) out.push(m[0])
  }
  for (const m of text.matchAll(/['"`]#[0-9a-f]{3,8}['"`]|\b(rgba?|hsla?|hwb|lab|lch|oklch|oklab)\(/gi)) out.push(m[0])
  return out
}

describe('the skins on disk', () => {
  const files = readdirSync(dir).filter(f => f.endsWith('.css') && f !== 'index.css').map(f => f.replace(/\.css$/, '')).sort()
  const imported = [...read(`${dir}index.css`).matchAll(/@import '\.\/([a-z0-9-]+)\.css'/g)].map(m => m[1]!).sort()

  it('registers house and bare only, house is the fallback', () => {
    expect(SKINS.map(s => s.id).sort()).toEqual(['bare', 'house'])
    expect(SKINS.find(s => s.id === 'house')?.label).toBe('Hub') // C9 (E-75, Q66, ledger): the house skin is read as the Hub's; its id stays
    expect(FALLBACK_SKIN).toBe('house')
  })

  it('are registered, imported and present: one id, one file, one import', () => {
    const ids = SKINS.map(s => s.id).sort()
    expect(ids).toEqual(files)
    expect(imported).toEqual(files)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('bare')
  })

  it('define every token bare defines, and no other: a skin is complete or it fails', () => {
    const bare = names(lightOf('bare')).sort()
    expect(bare.length).toBeGreaterThan(60)
    expect(names(lightOf('house')).sort(), 'house').toEqual(bare)
    for (const { id } of SKINS) expect(names(lightOf(id)).sort(), id).toEqual(bare)
  })

  it('have a light and a dark for every colour: under the system preference and under the override', () => {
    for (const { id } of SKINS) {
      expect(lightOf(id), `${id} light`).toContain('color-scheme: light')
      for (const dark of [darkMediaOf(id), darkOverrideOf(id)]) {
        expect(dark, `${id} dark`).toContain('color-scheme: dark')
        for (const c of COLOUR) expect(names(dark), `${id} dark --${c}`).toContain(c)
      }
      expect(names(darkMediaOf(id)).sort(), id).toEqual(names(darkOverrideOf(id)).sort())
    }
  })

  it('give a dark value to every colour a skin draws in hex: only var() and transparent follow the light block', () => {
    const hexNames = (b: string) => [...b.matchAll(/^\s*--([a-z0-9-]+):\s*#[0-9a-f]{6}\s*;/gm)].map(m => m[1]!).sort()
    for (const { id } of SKINS) {
      const dark = new Set(hexNames(darkOverrideOf(id)))
      for (const n of hexNames(lightOf(id))) expect(dark.has(n), `${id} --${n} has no dark value`).toBe(true)
    }
  })

  it('house owns the plain :root: drawn before any script has run, its three blocks also answer to a bare :root', () => {
    const css = skinCss('house')
    expect(css).toMatch(/:root,\s*:root\[data-skin="house"\] \{/)
    expect(css).toMatch(/:root:not\(\[data-theme="light"\]\),\s*:root\[data-skin="house"\]:not\(\[data-theme="light"\]\) \{/)
    expect(css).toMatch(/:root\[data-theme="dark"\],\s*:root\[data-skin="house"\]\[data-theme="dark"\] \{/)
    expect(skinCss('bare').replace(/\/\*[\s\S]*?\*\//g, ''), 'bare').not.toMatch(/(^|[{},])\s*:root(?!\[data-skin)/m)
  })

  it('leave the plain :root to house: another skin answers only to its own data-skin', () => {
    for (const { id } of SKINS.filter(s => s.id !== 'house')) expect(skinCss(id).replace(/\/\*[\s\S]*?\*\//g, ''), id).not.toMatch(/(^|[{},])\s*:root(?!\[data-skin)/m)
  })

  it("import house first: its plain :root blocks tie with another skin's light block, and the later sheet wins a tie", () => {
    expect(imported.length).toBeGreaterThan(1)
    expect([...read(`${dir}index.css`).matchAll(/@import '\.\/([a-z0-9-]+)\.css'/g)][0]![1]).toBe('house')
  })

  it('keep the dark colours in the dark blocks only: a light value is not a dark one', () => {
    for (const { id } of SKINS) {
      const light = lightOf(id), dark = darkOverrideOf(id)
      for (const c of ['paper', 'ink']) {
        const v = (b: string) => new RegExp(`--${c}:\\s*([^;]+);`).exec(b)?.[1]
        expect(v(light), `${id} --${c}`).not.toBe(v(dark))
      }
    }
  })
})

describe('the scan of code can fail', () => {
  it('sees a look on one line, over several lines, and outside a style prop', () => {
    expect(lookInCode("const a = <div style={{ color: 'red' }} />")).toHaveLength(1)
    expect(lookInCode("const a = <div style={{\n  left: x,\n  background: 'tomato',\n  padding: 8,\n}} />")).toHaveLength(2)
    expect(lookInCode('const planted = { padding: 8 }')).toHaveLength(1)
    expect(lookInCode("const planted = { fontWeight: 'bold', borderRadius: 4 }")).toHaveLength(2)
    expect(lookInCode("const a = '#fff'")).toHaveLength(1)
    expect(lookInCode('const a = `hsl(0 0% 50%)`')).toHaveLength(1)
  })
  it('lets geometry, tokens, types and comments through', () => {
    expect(lookInCode("const style = { left: x, top: y, width: w, transform: 'translateY(-50%)' }")).toEqual([])
    expect(lookInCode("const a = { color: 'var(--ink)', gap: 'var(--sp-3)' }")).toEqual([])
    expect(lookInCode('interface P { color: string; padding: number }')).toEqual([])
    expect(lookInCode('// color: red\n/* padding: 8 */ const a = 1')).toEqual([])
  })
})

describe('the parts hold no look of their own', () => {
  /** Every stylesheet under app/src that parts draw with: all but the skins (token values) and the font faces. */
  const sheets: Record<string, string> = {}
  const walkCss = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = `${d}${e.name}`
    if (e.isDirectory()) walkCss(`${p}/`)
    else if (e.name.endsWith('.css')) {
      const rel = p.slice(src.length)
      if (!rel.startsWith('design/skins/') && rel !== 'design/fonts/fonts.css') sheets[rel] = read(p)
    }
  } }
  walkCss(src)

  it('scan every stylesheet but the skins and the font faces', () => {
    expect(Object.keys(sheets)).toEqual(expect.arrayContaining(['design/design.css', 'design/base.css']))
    expect(Object.keys(sheets).filter(k => k.startsWith('design/skins/'))).toEqual([])
  })

  it('draw every colour, size, space, rule, corner, shadow and movement from a token', () => {
    for (const [name, css] of Object.entries(sheets)) expect(rawValues(css), name).toEqual([])
  })

  it('use every token a sleeker skin needs to set: none is defined and left unread', () => {
    const used = new Set([...Object.values(sheets).join('\n').matchAll(/var\(--([a-z0-9-]+)\)/g)].map(m => m[1]!))
    for (const t of ['accent', 'accent-soft', 'row-hover', 'nav-ink', 'nav-on-bg', 'nav-on-weight', 'input-fill', 'input-edge', 'input-bw', 'block-bg',
      'radius-chip', 'radius-input', 'radius-step', 'label-case', 'label-font', 'font-btn', 'focus-w', 'h-palette-top',
      'block-pad', 'divider', 'nav-pad', 'brand-dot-display',
      'input-pad', 'input-w', 'font-data', 'data-nums', 'lh-title']) expect(used.has(t), `--${t} is read by no rule`).toBe(true)
  })

  it('use only tokens every skin defines', () => {
    const defined = new Set(names(lightOf('bare')))
    for (const [name, css] of Object.entries(sheets)) {
      const used = [...css.matchAll(/var\(--([a-z0-9-]+)\)/g)].map(m => m[1]!).filter(n => !defined.has(n))
      expect(used, name).toEqual([])
    }
  })

  it('catches a raw value when one is written (the check can fail)', () => {
    expect(rawValues('.a { color: #fff; }')).toHaveLength(1)
    expect(rawValues('.a { padding: 4px 8px; }')).toHaveLength(1)
    expect(rawValues('.a { font: 11px var(--mono); }')).toHaveLength(1)
    expect(rawValues('.a { font-weight: 600; }')).toHaveLength(1)
    expect(rawValues('.a { opacity: .5; }')).toHaveLength(1)
    expect(rawValues('.a { opacity: 0.5; }')).toHaveLength(1)
    expect(rawValues('.a { opacity: 0; }')).toEqual([])
    expect(rawValues('.a { border-radius: 6px; }')).toHaveLength(1)
    expect(rawValues('.a { box-shadow: 0 1px 2px red; }')).toHaveLength(1)
    expect(rawValues('.a { transition: color 120ms; }')).toHaveLength(1)
    // named colours, keywords, families, viewport spacing, other units, the exempt rules edited
    expect(rawValues('.a { color: red; }')).toHaveLength(1)
    expect(rawValues('.a { box-shadow: 0 0 var(--sp-3) tomato; }')).toHaveLength(1)
    expect(rawValues('.a { border: var(--rule-w) solid Gainsboro; }')).toHaveLength(1)
    expect(rawValues('.a { font-weight: bold; }')).toHaveLength(1)
    expect(rawValues('.a { font-size: large; }')).toHaveLength(1)
    expect(rawValues('.a { border-width: thin; }')).toHaveLength(1)
    expect(rawValues('.a { font-family: Arial, sans-serif; }')).toHaveLength(1)
    expect(rawValues('.a { font: bold var(--fs-body)/var(--lh-body) var(--sans); }')).toHaveLength(1)
    expect(rawValues('.a { inset: 2vh; }')).toHaveLength(1)
    expect(rawValues('.a { padding: 3cm; }')).toHaveLength(1)
    expect(rawValues('.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; box-shadow: 0 0 9px red; }')).not.toEqual([])
    expect(rawValues('.a { width: 7px; }\n.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }')).toEqual(['width: 7px'])
    expect(rawValues('.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }')).toEqual([])
    expect(rawValues('.a { max-height: 40vh; font-family: var(--mono); font: inherit; background: transparent; border: 0; border-top: var(--rule-w) solid var(--rule); }')).toEqual([])
    expect(rawValues('.a { margin: 0 var(--sp-3); border: var(--rule-w) solid var(--edge); width: 92%; z-index: 5; }')).toEqual([])
    // a container query or a feature test is a condition, like a media query; what it holds is still scanned
    expect(rawValues('@container rows (max-width: 600px) { .a { color: var(--ink); } }')).toEqual([])
    expect(rawValues('@container rows (max-width: 600px) { .a { padding: 4px; } }')).toHaveLength(1)
    expect(rawValues('@supports (width: 1px) { .a { color: var(--ink); } }')).toEqual([])
    expect(rawValues('@supports (width: 1px) { .a { padding: 4px; } }')).toHaveLength(1)
  })

  it('stay out of the code too: no colour literal and no look in a style prop', () => {
    const files: string[] = []
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = `${d}${e.name}`
      if (e.isDirectory()) walk(`${p}/`)
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) files.push(p)
    } }
    walk(src)
    expect(files.length).toBeGreaterThan(50)
    const bad: string[] = []
    for (const f of files) for (const hit of lookInCode(read(f))) bad.push(`${f}: ${hit}`)
    expect(bad).toEqual([])
  })
})

describe('fields and data: what a skin may set about them', () => {
  const css = read(`${dir}../css/utilities.css`) // design.css's own rules: .meta and .err live here since C10
  const controls = read(`${dir}../css/controls.css`) // the segments and tabs moved here in A5
  const rows = read(`${dir}../css/rows.css`) // the record header and the field rows' raw inputs moved here in B1
  const library = read(`${dir}../css/library.css`) // the wizard's step markers moved here in C4b (ledger)
  const rule = (selector: string) => new RegExp(`^${selector.replace(/[.[\]()*+?|\\^$]/g, '\\$&')} \\{([^}]*)\\}`, 'm').exec(`${css}\n${controls}\n${rows}\n${library}`)?.[1] ?? ''
  const value = (id: string, name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(lightOf(id))?.[1]?.trim()

  // B1 (ledger): the field rows' raw inputs left design.css's shared rule for rows.css, drawn as the house's .input
  // from the skin's input tokens. C1 (ledger): the list's filter input left with the view header, whose filter form
  // draws the house's .input; design.css keeps no .filter rule.
  it('read the padding and the width of a field from tokens, so a skin can make it roomy (B1: rows.css)', () => {
    const raw = blockAfter(rows, '.fields input:not([type=checkbox]), .fields select, .fields textarea {')
    expect(raw).toMatch(/inline-size: var\(--input-w\);[\s\S]*padding: var\(--input-pad\);/)
    for (const t of ['input-fill', 'input-edge', 'input-bw', 'radius-input']) expect(raw).toContain(`var(--${t})`)
    expect(css).not.toMatch(/^\.filter \{/m)
  })

  it('read the font of data (meta, segments, tabs, chips, tokens, controls) from --font-data, not from mono', () => {
    // `.ctl` left with 0.6's map control strip (C6, E-42: the house map's tools are buttons; ledger)
    // `.chip` left with the card's chip density (C10; ledger): no caller drew it
    for (const sel of ['.meta', '.seg', '.tabs', '.token']) {
      const body = rule(sel)
      expect(body, sel).toContain('var(--font-data)')
      expect(body, sel).not.toContain('var(--mono)')
    }
  })

  it('keep bare as drawn: the padding it had, the width it had, mono, no tabular figures', () => {
    expect(value('bare', 'input-pad')).toBe('var(--sp-1) var(--sp-2)')
    expect(value('bare', 'input-w')).toBe('92%')
    expect(value('bare', 'font-data')).toBe('var(--mono)')
    expect(value('bare', 'data-nums')).toBe('normal')
  })

  it('keep a heading at bare\'s line height, and a house heading at 1.25; the tray has no corner of its own', () => {
    expect(value('bare', 'lh-title')).toBe('var(--lh-body)')
    expect(value('house', 'lh-title')).toBe('1.25')
    expect(rule('.rh-title')).toContain('var(--lh-title)') // B1: the page head is the record header's title (ledger)
    expect(css).not.toMatch(/\.tray,|\.tray \{[^}]*border-radius/)
  })

  it("draw a wizard's step markers in the skin's own mark shape: round in house, square as drawn in bare (LOW 4)", () => {
    expect(rule('.wiz-dot')).toContain('border-radius: var(--radius-step)')
    expect(value('bare', 'radius-step')).toBe('0')
    expect(value('house', 'radius-step')).toBe('50%')
  })

  it('give house roomy fields and data in the sans stack with tabular figures', () => {
    expect(value('house', 'input-pad')).not.toBe(value('bare', 'input-pad'))
    expect(value('house', 'input-w')).toBe('100%')
    expect(value('house', 'font-data')).toBe('var(--sans)')
    expect(value('house', 'data-nums')).toBe('tabular-nums')
  })
})

describe('the house skin (spec §3)', () => {
  const LIGHT = { paper: '#f4f2ec', raised: '#fdfcf9', pop: '#fdfcf9', sunken: '#efede6', wash: '#ebe8e0', 'wash-strong': '#e2ded4', rule: '#e2dfd6',
    'rule-strong': '#d6d2c7', edge: '#827e73', ink: '#1c1d1a', mute: '#57554e', faint: '#6b685f', accent: '#2e5c4a', 'accent-soft': '#e2ebe4',
    'on-accent': '#ffffff', attn: '#a8452a', 'attn-soft': '#f6e5dc', solid: '#1c1d1a', 'on-solid': '#fdfcf9', focus: '#2e5c4a', 'map-dot': '#d9d5ca' }
  const DARK = { paper: '#121412', raised: '#1a1d1b', pop: '#1f2321', sunken: '#0e100f', wash: '#232725', 'wash-strong': '#2c312e', rule: '#2b2f2c',
    'rule-strong': '#3a3f3b', edge: '#727771', ink: '#ecebe5', mute: '#aeaca3', faint: '#9a978e', accent: '#8fc2a6', 'accent-soft': '#1b2b23',
    'on-accent': '#0e1a13', attn: '#e8916a', 'attn-soft': '#33231b', solid: '#ecebe5', 'on-solid': '#121412', focus: '#8fc2a6', 'map-dot': '#262a27' }
  const pick = (d: Record<string, string>, keys: string[]) => Object.fromEntries(keys.map(k => [k, d[k]]))

  it("holds §3.2's colours exactly, in light and in both darks", () => {
    expect(pick(declarations(lightOf('house')), Object.keys(LIGHT))).toEqual(LIGHT)
    expect(pick(declarations(darkMediaOf('house')), Object.keys(DARK))).toEqual(DARK)
    expect(pick(declarations(darkOverrideOf('house')), Object.keys(DARK))).toEqual(DARK)
  })

  it("holds §3.2's aliases", () => {
    expect(pick(declarations(lightOf('house')), ['row-hover', 'nav-ink', 'nav-on-bg', 'input-fill', 'input-edge', 'block-bg'])).toEqual({
      'row-hover': 'var(--wash)', 'nav-ink': 'var(--mute)', 'nav-on-bg': 'var(--wash)', 'input-fill': 'var(--raised)', 'input-edge': 'var(--edge)', 'block-bg': 'var(--raised)',
    })
  })

  it("holds §3.2's shadows and scrim, light and dark", () => {
    const light = declarations(lightOf('house'))
    expect(light['shadow-card']).toBe('0 1px 0 rgba(28,29,26,.03), 0 1px 3px rgba(28,29,26,.05)')
    expect(light['shadow-raise']).toBe('0 1px 0 rgba(28,29,26,.03), 0 10px 28px -14px rgba(28,29,26,.28)')
    expect(light['shadow-pop']).toBe('0 0 0 1px rgba(28,29,26,.06), 0 18px 44px -14px rgba(28,29,26,.30), 0 4px 10px -4px rgba(28,29,26,.08)')
    expect(light.scrim).toBe('rgba(28,29,26,.32)')
    for (const dark of [declarations(darkMediaOf('house')), declarations(darkOverrideOf('house'))]) {
      expect(dark['shadow-card']).toBe('0 1px 0 rgba(0,0,0,.25)')
      expect(dark['shadow-raise']).toBe('0 1px 0 rgba(0,0,0,.25), 0 12px 30px -14px rgba(0,0,0,.75)')
      expect(dark['shadow-pop']).toBe('0 0 0 1px rgba(236,235,229,.07), 0 22px 50px -14px rgba(0,0,0,.8)')
      expect(dark.scrim).toBe('rgba(0,0,0,.55)')
    }
  })

  it("holds §3.3–§3.8's scale", () => {
    expect(pick(declarations(lightOf('house')), ['fs-body', 'fs-d-hero', 'sp-11', 'sp-18', 'radius-pop', 'dur-flow', 'ease', 'press-scale', 'w-content', 'h-bottombar', 'o-dim', 'soft'])).toEqual({
      'fs-body': '.875rem', 'fs-d-hero': 'clamp(2.5rem, 1.25rem + 4.2vw, 4.75rem)', 'sp-11': '20px', 'sp-18': '128px', 'radius-pop': '12px',
      'dur-flow': '1100ms', ease: 'cubic-bezier(.2,0,0,1)', 'press-scale': '.96', 'w-content': '1040px', 'h-bottombar': '60px', 'o-dim': '.38', soft: '50',
    })
  })

  it('defines every token the shared interfaces name, in house and in bare', () => {
    const NEW = ('pop sunken wash-strong rule-strong on-accent attn-soft map-dot shadow-raise scrim display soft fs-greet fs-page fs-amount '
      + 'fs-d-hero fs-d-sec fs-d-card fs-d-lead fs-d-body fs-d-fig fs-d-fact lh-row lh-prose lh-d-hero lh-d-sec lh-d-lead ls-eyebrow ls-display '
      + 'ls-d-sec fw-display sp-16 sp-17 sp-18 radius-xs radius-sm radius-pop radius-lg radius-plate dur-1 dur-press dur-2 dur-3 dur-flow '
      + 'press-scale w-rail w-content w-prose w-door w-node-min h-topbar h-row h-row-1 h-tray h-bottombar h-ctl h-ctl-touch h-input h-chip '
      + 'h-addr o-dim ic-xs ic-sm ic ic-lg icon-stroke').split(' ')
    for (const id of ['house', 'bare']) expect(NEW.filter(n => !names(lightOf(id)).includes(n)), id).toEqual([])
    expect(pick(declarations(lightOf('house')), ['ic-xs', 'ic-sm', 'ic', 'ic-lg', 'icon-stroke'])).toEqual({ 'ic-xs': '13px', 'ic-sm': '14px', ic: '16px', 'ic-lg': '20px', 'icon-stroke': '1.5' })
  })
})
