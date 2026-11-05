import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
const tokens = read('./skins/bare.css')
const base = read('./base.css')
const controls = read('./css/controls.css')
const states = read('./css/states.css')
const frame = read('./css/frame.css')
const rows = read('./css/rows.css')
const needs = read('./css/needs.css')
const governance = read('./css/governance.css')
const map = read('./css/map.css')
const library = read('./css/library.css')
const house = read('./skins/house.css')

/** A sheet with the lengths, type and weights bare gives its tokens put back, so the guards below keep reading the
 *  values P1 drew. Colours and families stay tokens: those are what the tests name. */
const KEEP = new Set(['paper', 'ink', 'mute', 'faint', 'rule', 'wash', 'attn', 'raised', 'edge', 'solid', 'on-solid', 'focus', 'sans', 'mono'])
const bareValues = new Map([...tokens.slice(0, tokens.indexOf('@media')).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]))
const asBare = (css: string) => css.replace(/var\(--([a-z0-9-]+)\)/g, (m, n: string) => (KEEP.has(n) ? m : bareValues.get(n) ?? m))
/** design.css imports the group sheets and holds no rule of its own (C10, legacy.test.ts): the guards that said
 *  "design.css keeps none of 0.6's X" still read it, and the rules it held are read where they live now. */
const design = asBare(read('./design.css'))
const utilities = asBare(read('./css/utilities.css'))

const LIGHT = { paper: '#ffffff', ink: '#111111', mute: '#666666', faint: '#888888', rule: '#dddddd', wash: '#f2f2f2', attn: '#b3261e', raised: '#ffffff', edge: '#111111', solid: '#111111', focus: '#111111' }
const DARK = { paper: '#111111', ink: '#ededed', mute: '#a0a0a0', faint: '#7a7a7a', rule: '#2e2e2e', wash: '#1c1c1c', attn: '#ff6b5e', raised: '#111111', edge: '#ededed', solid: '#ededed', focus: '#ededed' }
const tokensIn = (block: string) => Object.fromEntries([...block.matchAll(/--([a-z]+):\s*(#[0-9a-f]{6})/g)].map(m => [m[1], m[2]]))
const blockAfter = (css: string, selector: string) => {
  const at = css.indexOf(selector)
  expect(at).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open))
}

describe('the register (spec §4), as the skin "bare"', () => {
  it('holds the light tokens exactly', () => {
    expect(tokensIn(blockAfter(tokens, ':root[data-skin="bare"] {'))).toEqual(LIGHT)
  })

  it('holds the dark tokens under prefers-color-scheme and under the override', () => {
    expect(tokensIn(blockAfter(tokens, ':root[data-skin="bare"]:not([data-theme="light"])'))).toEqual(DARK)
    expect(tokensIn(blockAfter(tokens, ':root[data-skin="bare"][data-theme="dark"]'))).toEqual(DARK)
  })

  it("draws a field's error as P1's .err: 11px mono in attn, its margin (M-4)", () => {
    expect(blockAfter(utilities, '.err {').trim()).toBe('font: 11px var(--mono); font-variant-numeric: normal; color: var(--attn); margin: 2px 0;')
  })

  it("draws a block's error note in clay, as the house note (A5: controls.css owns .note)", () => {
    expect(design).not.toMatch(/^\.note-error \{/m)
    expect(blockAfter(controls, '.note-error {')).toContain('color: var(--attn);')
  })

  // C10 (ledger): "keeps the left rule of a faint staged or stale tile" is gone with the tile density (no caller).

  it('lets a block scroll only once it is wider than its place: until then it is a plain block, drawn as P1 drew it', () => {
    expect(rows).toMatch(/\.scroll\[role="region"\] \{ overflow-x: auto; \}/) // C10: with the ruled table, rows.css
    expect(rows).not.toMatch(/\.scroll \{/)
  })

  it("adds no margin above a bare block: a section's table sits under its head as in P1 (M-6)", () => {
    expect(design).not.toMatch(/\.blk\.bare \{/)
  })

  it('draws no radius, shadow or gradient in bare: its tokens say none', () => {
    expect(tokens).not.toMatch(/gradient/)
    for (const t of ['radius', 'radius-ctl']) expect(bareValues.get(t)).toBe('0')
    for (const t of ['shadow-card', 'shadow-pop']) expect(bareValues.get(t)).toBe('none')
    expect(bareValues.get('dur')).toBe('0s')
  })

  // A10 replaces 0.6's "collapses the nav to a top menu below 760px" and "hides the menu button on desktop" (ledger):
  // the frame reads its own width (Shell's data-mode), not the viewport's, and there is no Menu button.
  it('lays the frame out by its own width: sidebar, rail or phone from data-mode, never a viewport query (§3.8)', () => {
    expect(design).not.toMatch(/\.shell|\.nav-toggle|\.main-col|\.tray-slot|^\.notice/m)
    expect(frame).toMatch(/^\.frame \{[^}]*grid-template-columns: var\(--w-nav\) minmax\(0, 1fr\);/m)
    expect(frame).toMatch(/^\.frame\[data-mode="rail"\] \{ grid-template-columns: var\(--w-rail\) minmax\(0, 1fr\); \}/m)
    expect(frame).toMatch(/^\.frame\[data-mode="phone"\] \{ grid-template-columns: minmax\(0, 1fr\); \}/m)
    expect(frame).not.toMatch(/@media \((max|min)-width/)
  })

  /** The rules inside the frame's phone query: the frame's own width under 760 (A11; §3.8, §5.4). */
  const phone = () => {
    const at = frame.indexOf('@container frame (max-width: 759px) {')
    expect(at, 'no @container frame (max-width: 759px) block').toBeGreaterThanOrEqual(0)
    return frame.slice(at, frame.indexOf('\n}', at))
  }

  // A11 replaces A10's `.frame[data-mode="phone"] > .frame-side { display: none; }` (and, before it, 0.6's
  // "collapses the nav to a top menu below 760px"; ledger): the phone is the frame's container query.
  it('under 760 of frame width the sidebar is not drawn and the bottom bar is (§5.4)', () => {
    expect(frame).toMatch(/^\.frame-bbar \{ display: none; \}/m)
    expect(phone()).toMatch(/\.frame-side \{ display: none; \}/)
    expect(phone()).toMatch(/\.frame-bbar \{ display: block; \}/)
    expect(phone()).toMatch(/\.frame-main \{ grid-template-rows: var\(--h-phonebar\) auto minmax\(0, 1fr\) auto auto; \}/)
    // every phone form keys off the frame's own width: no rule left on data-mode="phone" but the grid's one column
    expect([...frame.matchAll(/data-mode="phone"/g)]).toHaveLength(1)
  })

  it('the bottom bar pads by env(safe-area-inset-bottom), five equal columns (§5.4, §13)', () => {
    const bbar = blockAfter(frame, '.bbar {')
    expect(bbar).toContain('grid-template-columns: repeat(5, minmax(0, 1fr));')
    expect(bbar).toContain('block-size: calc(var(--h-bottombar) + env(safe-area-inset-bottom));')
    expect(bbar).toContain('padding-block-end: env(safe-area-inset-bottom);')
  })

  it('the phone bar is 48px, and its buttons 44px targets on any pointer (§5.4)', () => {
    expect(blockAfter(frame, '.ptop-tools .btn.icon {')).toMatch(/inline-size: var\(--h-ctl-touch\); block-size: var\(--h-ctl-touch\);/)
    expect(blockAfter(frame, '.ptop-t {')).toMatch(/font: var\(--fw-strong\) var\(--fs-body\)/)
  })

  it('the More sheet: --pop, 16px top corners, a grab handle, 44px rows of 16px labels, over the scrim', () => {
    const sheet = blockAfter(frame, '.sheet {')
    expect(sheet).toContain('background: var(--pop);')
    expect(sheet).toContain('border-start-start-radius: var(--radius-lg); border-start-end-radius: var(--radius-lg);')
    expect(blockAfter(frame, '.sheet::backdrop {')).toContain('background: var(--scrim);')
    expect(blockAfter(frame, '.sheet-grab::before {')).toMatch(/inline-size: var\(--w-grab\); block-size: var\(--h-grab\);/)
    expect(blockAfter(frame, '.sheet-a {')).toMatch(/block-size: var\(--h-ctl-touch\);[^}]*font-size: var\(--fs-sub\);/)
  })

  it('scrolls the page in its own area, under the top bar (§5.1)', () => {
    expect(blockAfter(frame, '.frame-scroll {')).toMatch(/min-width: 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scroll-padding-top: var\(--h-topbar\);/)
  })

  it('gives every frame target 44px on a coarse pointer: the sidebar’s rows, the rail’s hit areas, the path’s links, the palette’s rows (§13)', () => {
    const coarse = [...frame.matchAll(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/g)].map(m => m[1]!).join('\n')
    const rule = (sel: string) => {
      const at = coarse.split('}').find(r => r.split('{')[0]!.split(',').map(s => s.trim()).includes(sel))
      expect(at, `${sel} has no coarse-pointer rule`).toBeDefined()
      return at!
    }
    for (const sel of ['.side-a', '.side-sub', '.side-org', '.side-search']) expect(rule(sel)).toContain('block-size: var(--h-ctl-touch)')
    for (const sel of ['button.side-h', 'button.who']) expect(rule(sel)).toContain('min-block-size: var(--h-ctl-touch)')
    for (const sel of ['.side-rail .side-a::after', '.side-rail .side-search::after', '.side-rail .side-org::after'])
      expect(rule(sel)).toContain('inset: calc((var(--h-rail-a) - var(--h-ctl-touch)) / 2)')
    expect(rule('.side-rail button.who')).toContain('min-inline-size: var(--h-ctl-touch)')
    expect(rule('.pal-o')).toContain('block-size: var(--h-ctl-touch)') // the palette is a touch sheet on a phone (A12 review)
    expect(rule('.crumbs a')).toContain('line-height: var(--h-ctl-touch)')
  })

  it('mirrors under dir="rtl": no physical four-value padding with different start and end (L4a final review M-17)', () => {
    const lopsided = [...frame.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[;{\s])padding:\s*([^;}]+)/g)]
      .map(m => m[1]!.trim().split(/\s+(?![^(]*\))/))
      .filter(v => v.length === 4 && v[1] !== v[3])
      .map(v => v.join(' '))
    expect(lopsided).toEqual([])
  })

  it('the phone palette sheet clears the status bar (§13: safe-area insets on sheets; L4a final review M-16)', () => {
    const phone = frame.slice(frame.indexOf('/* The palette on a phone'))
    expect(blockAfter(phone, '.pal-dialog > .pal {')).toContain('padding-block-start: env(safe-area-inset-top);')
  })

  it('holds every transition for the one frame a theme switch takes', () => {
    expect(frame).toMatch(/:root\[data-theme-switching\] \*[^{]*\{ transition: none; \}/)
  })

  it('draws the sidebar’s hover only for a pointer that hovers', () => {
    const outside = frame.replace(/^@media \(hover: hover\) \{ [^\n]* \} \}$/gm, '').replace(/^@media \(hover: hover\) \{\n[\s\S]*?\n\}$/gm, '')
    expect(outside).not.toMatch(/:hover/)
    expect(frame).toMatch(/@media \(hover: hover\) \{\n {2}\.side-a:hover/)
  })

  it('keeps a focus ring on controls drawn with all: unset', () => {
    // '.insp-close' left with the 0.6 library preview (C4b, E-24; ledgered): its Close is a ghost button link now.
    for (const sel of ['.x', '.token button']) expect(rows).toContain(`${sel}:focus-visible`) // C10: rows.css
  })

  // C10 (ledger; E-79): "draws one ink rule under a section label, under the table head…" is gone with 0.6's .sec-h:
  // BlockFrame and the Propose panel draw the house's section head (.sect-h, rows.css).
  it('draws a section head in the skin’s label face and case, and meta lines in its data face: bare keeps its own (E-79)', () => {
    const views = read('./css/views.css')
    expect(blockAfter(rows, '.sect-t {')).toMatch(/font: var\(--fw-strong\) var\(--fs-body\)\/var\(--lh-label\) var\(--label-font\);[^}]*text-transform: var\(--label-case\);/)
    for (const [sheet, sel] of [[rows, '.sect-n {'], [rows, '.sect-end {'], [rows, '.rh-meta {'], [views, '.vhead-meta {']] as const) {
      expect(blockAfter(sheet, sel), sel).toContain('font-family: var(--font-data);')
      expect(blockAfter(sheet, sel), sel).not.toContain('var(--sans)')
    }
    // the house draws them as before, in its Sans and as written; bare in its mono capitals, as 0.6's section label
    expect(house).toMatch(/--label-font: var\(--sans\);[\s\S]*--label-case: none;|--label-case: none;[\s\S]*--label-font: var\(--sans\);/)
    expect(house).toMatch(/--font-data: var\(--sans\);/)
    expect(bareValues.get('label-font')).toBe('var(--mono)')
    expect(bareValues.get('label-case')).toBe('uppercase')
    expect(bareValues.get('font-data')).toBe('var(--mono)')
  })


  // B1 replaces "gives field labels 120px, more specific than the kind column width" (ledger): field rows are a <dl>
  // in rows.css, and the label column is 96–132px from tokens (§9.3).
  it('draws field rows as a two-column dl, the label column 96–132px from tokens (§9.3)', () => {
    expect(design).not.toMatch(/\.rows\.fields|\.fields td\.staged/)
    expect(blockAfter(rows, '.fields {')).toContain('grid-template-columns: minmax(var(--w-field-label-min), var(--w-field-label-max)) minmax(0, 1fr);')
    expect(house).toMatch(/--w-field-label-min: 96px;/)
    expect(house).toMatch(/--w-field-label-max: 132px;/)
  })

  it('stacks the labels above the values under 420px of the field container (§9.3)', () => {
    expect(blockAfter(rows, '.fields-w {')).toContain('container: field / inline-size;')
    const at = rows.indexOf('@container field (max-width: 419px) {')
    expect(at, 'no @container field (max-width: 419px) block').toBeGreaterThanOrEqual(0)
    expect(rows.slice(at, rows.indexOf('\n}', at))).toMatch(/\.fields \{ grid-template-columns: minmax\(0, 1fr\); \}/)
  })

  it('draws a staged value with the 2px moss inline-start bar and a stale one with the clay bar (§6.2)', () => {
    expect(blockAfter(rows, '.fields > dd.staged {')).toContain('border-inline-start: var(--rule-w-heavy) solid var(--accent);')
    expect(blockAfter(rows, '.fields > dd.stale {')).toContain('border-inline-start: var(--rule-w-heavy) solid var(--attn);')
  })

  it('sets a record title in Sans 600 24, balanced (§9.1)', () => {
    expect(blockAfter(rows, '.rh-title {')).toContain('font: var(--fw-strong) var(--fs-title)/var(--lh-title) var(--sans);')
    expect(blockAfter(rows, '.rh-title {')).toContain('text-wrap: balance;')
  })

  it('dims a closed or faint row by colour: its words in --faint (4.5:1), its glyphs and marks at --o-dim, never opacity over the words (1.4.3; C11, axe color-contrast)', () => {
    expect(rows).toMatch(/\.drow\.o-dim :is\(\.drow-t, \.drow-s, \.drow-s \*, \.drow-end\) \{ color: var\(--faint\); \}/)
    expect(rows).toMatch(/\.drow\.o-dim :is\(svg, \.ktile, \.av, \.smark-shape\) \{ opacity: var\(--o-dim\); \}/)
    expect(rows).not.toMatch(/\.drow\.o-dim \{[^}]*opacity/)
  })

  it('lets the record header and its route pill fit a phone: one shrinkable column, a pill that wraps (1.4.10; C11 reflow)', () => {
    expect(blockAfter(rows, '.rh {')).toContain('grid-template-columns: minmax(0, 1fr);')
    expect(blockAfter(rows, '.rh-route {')).toMatch(/max-inline-size: 100%;[^}]*white-space: normal;/)
  })

  it('grows the sidebar rows with the text (200 %, 1.4.4): min-block-size, and labels with room for their descenders (C11)', () => {
    for (const sel of ['.side-org {', '.side-search {', '.side-a {']) expect(blockAfter(frame, sel), sel).toMatch(/min-block-size: var\(--h-(org|ctl)\);/)
    expect(blockAfter(frame, '.side-sub {')).toContain('min-block-size: var(--h-side-sub);')
    for (const sel of ['.side-org-nm {', '.side-l {']) expect(blockAfter(frame, sel), sel).toContain('line-height: var(--lh-body);')
  })

  it('keeps the skip link off at the inline start, so a right-to-left page does not scroll to it (§13; C11 reflow)', () => {
    expect(blockAfter(frame, '.skip {')).toContain('inset-inline-start: -9999px;')
    expect(blockAfter(frame, '.skip {')).not.toMatch(/\bleft:/)
    expect(blockAfter(frame, '.skip:focus {')).toContain('inset-inline-start: var(--sp-7);')
  })

  it('lays the record and field sheet out by its elements’ own containers, never a viewport width query (CC-15)', () => {
    expect(rows).not.toMatch(/@media \((max|min)-width/)
  })

  it('gives the section head’s end link a 44px target on a coarse pointer (§13)', () => {
    const coarse = [...rows.matchAll(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/g)].map(m => m[1]!).join('\n')
    expect(coarse).toMatch(/\.sect-end a::after \{[^}]*min-block-size: var\(--h-ctl-touch\)/)
  })

  it('draws a data row 56px at least in a raised list that is the rows container; selected is the moss bar, closed and faint dim it (§9.2, §6.2)', () => {
    expect(blockAfter(rows, '.dlist {')).toContain('container: rows / inline-size;')
    expect(blockAfter(rows, '.dlist {')).toContain('background: var(--raised);')
    expect(blockAfter(rows, '.drow {')).toContain('min-block-size: var(--h-row);')
    expect(blockAfter(rows, '.drow {')).toContain('padding: var(--sp-7) var(--sp-10);')
    expect(blockAfter(rows, '.drow-sel::before {')).toContain('background: var(--accent);')
    expect(rows).toContain('.drow.o-dim :is(.drow-t, .drow-s, .drow-s *, .drow-end) { color: var(--faint); }') // dimmed by colour (C11)
    // hover fills only where a pointer can hover
    expect(rows.replace(/@media \(hover: hover\) \{[^\n]*\}\s*\}/g, '')).not.toMatch(/:hover/)
  })

  it('lays the Systems row out in six columns, and under 760px of its list moves the chain into the second line and drops the address and the age (§9.2)', () => {
    expect(blockAfter(rows, '.sysrow {')).toContain('grid-template-columns: var(--h-ktile) minmax(0, 1.6fr) minmax(0, .9fr) minmax(0, 1fr) minmax(0, 1fr) var(--w-row-age);')
    expect(blockAfter(rows, '.sysrow-k {')).toContain('display: none;')
    const at = rows.indexOf('@container rows (max-width: 759px) {')
    expect(at, 'no @container rows (max-width: 759px) block').toBeGreaterThanOrEqual(0)
    const narrow = rows.slice(at, rows.indexOf('\n}', at))
    expect(narrow).toMatch(/\.sysrow \{ grid-template-columns: var\(--h-ktile\) minmax\(0, 1fr\) auto; \}/)
    expect(narrow).toMatch(/\.sysrow-chain, \.sysrow-addr, \.sysrow-age \{ display: none; \}/)
    expect(narrow).toMatch(/\.sysrow-k \{ display: inline-flex; \}/)
    expect(house).toMatch(/--w-row-age: 84px;/)
  })

  // B3: Needs you's sheet (§9.4), and CC-15 extended to it.
  it('draws a Needs you row 72px at least, 32 · main · trailing, in a raised list that is the needs container (§9.4)', () => {
    expect(blockAfter(needs, '.needs {')).toContain('container: needs / inline-size;')
    expect(blockAfter(needs, '.needs {')).toContain('background: var(--raised);')
    expect(blockAfter(needs, '.need {')).toContain('grid-template-columns: var(--h-ktile-needs) minmax(0, 1fr) auto;')
    expect(blockAfter(needs, '.need {')).toContain('min-block-size: var(--h-need);')
    expect(blockAfter(needs, '.skel-row-needs {')).toContain('min-block-size: var(--h-need);')
    expect(house).toMatch(/--h-need: 72px;/)
    expect(blockAfter(needs, '.need-late {')).toContain('color: var(--attn);')
    // the trailing words move under the title under 520px of the list
    const at = needs.indexOf('@container needs (max-width: 519px) {')
    expect(at, 'no @container needs (max-width: 519px) block').toBeGreaterThanOrEqual(0)
    expect(needs.slice(at, needs.indexOf('\n}', at))).toMatch(/\.need-end \{ grid-column: 2;/)
    // hover fills only where a pointer can hover
    expect(needs.replace(/@media \(hover: hover\) \{[^\n]*\}\s*\}/g, '')).not.toMatch(/:hover/)
  })

  it('lays Needs you out by its own container, never a viewport width query (CC-15)', () => {
    expect(needs).not.toMatch(/@media \((max|min)-width/)
  })

  // B5: the prepared-transaction card's sheet (§9.6), and CC-15 extended to it.
  it('draws the prepared-transaction card raised, radius 10, the card shadow, its own prepared container (§9.6)', () => {
    const ptx = blockAfter(governance, '.ptx {')
    expect(ptx).toContain('container: prepared / inline-size;')
    expect(ptx).toContain('background: var(--raised);')
    expect(ptx).toContain('border-radius: var(--radius);')
    expect(ptx).toContain('box-shadow: var(--shadow-card);')
    // calls: the 22px number on --wash, in Mono; the total and the payload's well on --sunken; the well Mono 12/1.6
    expect(blockAfter(governance, '.ptx-n {')).toContain('inline-size: var(--h-call-n);')
    expect(blockAfter(governance, '.ptx-n {')).toContain('background: var(--wash);')
    expect(house).toMatch(/--h-call-n: 22px;/)
    expect(blockAfter(governance, '.ptx-total {')).toContain('background: var(--sunken);')
    expect(blockAfter(governance, '.ptx-well {')).toContain('background: var(--sunken);')
    expect(blockAfter(governance, '.ptx-well {')).toContain('font: var(--fs-tiny)/var(--lh-code) var(--mono);')
    expect(blockAfter(governance, '.ptx-well {')).toContain('overflow-wrap: anywhere;')
    // the outcome strip: moss, clay when bad; the hash chip on it takes the --raised fill (R-11)
    expect(blockAfter(governance, '.ptx-out {')).toContain('background: var(--accent-soft);')
    expect(blockAfter(governance, '.ptx-out-bad {')).toContain('background: var(--attn-soft);')
    expect(blockAfter(governance, '.ptx-out .addr {')).toContain('background: var(--raised);')
    // Review Focus 2: a long amount wraps, at most half a call wide, rather than being clipped by the card's overflow
    expect(blockAfter(governance, '.ptx-call {')).toContain('grid-template-columns: var(--h-call-n) minmax(0, 1fr) fit-content(50%);')
    expect(blockAfter(governance, '.ptx-call > .amt, .ptx-sums > .amt {')).toContain('overflow-wrap: anywhere;')
    expect(blockAfter(governance, '.ptx-call > .amt, .ptx-sums > .amt {')).toContain('white-space: normal;')
  })

  it('under 520px of the card the head\'s actions wrap under the title, amounts move under each call, foot buttons go full width (§9.6)', () => {
    const at = governance.indexOf('@container prepared (max-width: 519px) {')
    expect(at, 'no @container prepared (max-width: 519px) block').toBeGreaterThanOrEqual(0)
    const narrow = governance.slice(at, governance.indexOf('\n}', at))
    expect(narrow).toMatch(/\.ptx-end \{ grid-column: 1 \/ -1;/)
    expect(narrow).toMatch(/\.ptx-call > \.amt \{ grid-column: 2;/)
    expect(narrow).toMatch(/\.ptx-acts \{ inline-size: 100%;/)
    expect(narrow).toMatch(/\.ptx-acts > \.btn \{ flex: 1/)
  })

  it('gives the payload\'s summary a 44px target on a coarse pointer, after the rule it enlarges; hover only where a pointer hovers (§13)', () => {
    const coarse = governance.indexOf('@media (pointer: coarse) { .ptx-payload > summary { min-block-size: var(--h-ctl-touch); } }')
    expect(coarse, 'no coarse rule for the payload summary').toBeGreaterThanOrEqual(0)
    expect(governance.indexOf('.ptx-payload > summary {')).toBeLessThan(coarse)
    expect(governance.replace(/@media \(hover: hover\) \{[^\n]*\}\s*\}/g, '')).not.toMatch(/:hover/)
  })

  it('lays the governance elements out by their own containers, never a viewport width query (CC-15)', () => {
    expect(governance).not.toMatch(/@media \((max|min)-width/)
  })

  it('lays the map out by its own container (narrow under 680px of it), never a viewport width query (CC-15, §8.2)', () => {
    expect(map).not.toMatch(/@media \((max|min)-width/)
    expect(map).toContain('@container map (max-width: 679px) {')
  })

  it('draws sign-in as a card at most --w-signin wide, its actions full width at --h-signin-go and 44px on a coarse pointer, after (§11.4, §13)', () => {
    expect(library).toMatch(/\.signin \{[^}]*max-inline-size: var\(--w-signin\)/)
    expect(library).toMatch(/\.signin-go \.btn \{[^}]*inline-size: 100%; height: var\(--h-signin-go\)/)
    const coarse = library.indexOf('@media (pointer: coarse) { .signin-go .btn { height: var(--h-ctl-touch); } }')
    expect(coarse, 'no coarse rule for the sign-in actions').toBeGreaterThanOrEqual(0)
    expect(library.indexOf('.signin-go .btn {')).toBeLessThan(coarse)
  })

  it('lays the library, wizards and sign-in out by their own containers, never a viewport width query (CC-15, E-27)', () => {
    expect(library).not.toMatch(/@media \((max|min)-width/)
    expect(library).toContain('@container prev (max-width: 679px) {') // the preview: one column under 680px of it (§11.2)
    expect(library).toContain('@container wiz (max-width: 559px) {') // a wizard: the rail a top line under 560px of it (§11.3)
  })

  it('draws the shelf as a grid auto-fill minmax(260px, 1fr) of cards at least 172 tall, the open one in moss (§11.1)', () => {
    expect(library).toMatch(/\.lib-grid \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(min\(var\(--w-lib-card\), 100%\), 1fr\)\)/)
    expect(library).toMatch(/\.lib-card \{[^}]*min-height: var\(--h-lib-card\)/)
    expect(library).toMatch(/\.lib-card\.sel \{ border-color: var\(--accent\); box-shadow: 0 0 0 var\(--sp-3\) var\(--accent-soft\); \}/)
    expect(library).toMatch(/@media \(hover: hover\) \{ \.lib-card:hover/)
    expect(library).toMatch(/\.lib-card-d \{[^}]*-webkit-line-clamp: 2/)
  })

  it('draws a wizard with its rail beside the body, the steps’ circles in the skin’s step shape, and the foot full width when narrow (§11.3)', () => {
    expect(library).toMatch(/\.wiz \{[^}]*grid-template-columns: var\(--w-wiz-rail\) minmax\(0, 1fr\)/)
    expect(library).toMatch(/\.wiz-dot \{[^}]*inline-size: var\(--h-wiz-dot\)[^}]*border-radius: var\(--radius-step\)/)
    expect(library).toMatch(/\.wiz-step\.done \.wiz-dot \{ background: var\(--solid\)/)
    expect(library).toMatch(/\.wiz-h \{[^}]*var\(--fs-wiz-h\)/)
    const narrow = library.slice(library.indexOf('@container wiz (max-width: 559px) {'))
    expect(narrow).toMatch(/\.wiz-steps \{ display: none; \}/)
    expect(narrow).toMatch(/\.wiz-top \{ display: flex;/)
    expect(narrow).toMatch(/\.wiz-foot > \.btn \{ flex: 1 1 100%; \}/) // Save and leave, on a line of its own
    expect(narrow).toMatch(/\.wiz-end \.btn \{ flex: 1; \}/)
  })

  it('draws no 0.6 machine diagram: MachineDiagram is drawn with the map’s nodes and edges (B8, §14.2)', () => {
    expect(design).not.toMatch(/mdiag/)
  })

  it('draws the timeline with 22px markers joined by a 1px line, ink once passed; the step states by their markers (§9.5)', () => {
    expect(house).toMatch(/--h-tl-mark: 22px;/)
    expect(tokens).toMatch(/--h-tl-mark: 22px;/)
    expect(blockAfter(governance, '.tl-step {')).toContain('grid-template-columns: var(--h-tl-mark) minmax(0, 1fr);')
    expect(blockAfter(governance, '.tl-step::before {')).toContain('inline-size: var(--rule-w);')
    expect(blockAfter(governance, '.tl-step::before {')).toContain('background: var(--rule-strong);')
    expect(blockAfter(governance, '.tl-done::before {')).toContain('background: var(--ink);')
    const mk = blockAfter(governance, '.tl-mk {')
    expect(mk).toContain('inline-size: var(--h-tl-mark);')
    expect(mk).toContain('border: var(--stroke-w) solid var(--rule-strong);')
    expect(blockAfter(governance, '.tl-done > .tl-mk {')).toContain('background: var(--solid);')
    expect(blockAfter(governance, '.tl-current > .tl-mk::after {')).toContain('background: var(--ink);')
    expect(blockAfter(governance, '.tl-yours > .tl-mk {')).toContain('background: var(--accent);')
    expect(blockAfter(governance, '.tl-failed > .tl-mk {')).toContain('border-color: var(--attn);')
    expect(blockAfter(governance, '.tl-not-needed > .tl-mk {')).toContain('border-style: dashed;')
    expect(blockAfter(governance, '.tl-waiting .tl-t, .tl-not-needed .tl-t {')).toContain('color: var(--mute);')
    expect(blockAfter(governance, '.tl-failed .tl-t {')).toContain('color: var(--attn);')
  })

  it('draws the compact timeline as 10px dots joined by 14px lines (§9.5)', () => {
    expect(house).toMatch(/--h-tl-dot: 10px;/)
    expect(house).toMatch(/--w-tl-join: 14px;/)
    expect(tokens).toMatch(/--h-tl-dot: 10px;/)
    expect(tokens).toMatch(/--w-tl-join: 14px;/)
    expect(blockAfter(governance, '.tlc-dots > i {')).toContain('inline-size: var(--h-tl-dot);')
    expect(blockAfter(governance, '.tlc-dots > b {')).toContain('inline-size: var(--w-tl-join);')
    expect(blockAfter(governance, '.tlc-dots > i.d {')).toContain('background: var(--ink);')
    expect(blockAfter(governance, '.tlc-dots > i.f {')).toContain('border-color: var(--attn);')
  })

  it('draws rule statuses and events from governance.css; design.css keeps none of 0.6’s .rstat or .ev rules (brief B4)', () => {
    expect(blockAfter(governance, '.rst-s {')).toContain('font: var(--fw-medium) var(--fs-body)/var(--lh-row) var(--sans);')
    expect(blockAfter(governance, '.evt-d {')).toContain('border-inline-start: var(--rule-w-heavy) solid var(--rule);')
    const sheet = read('./design.css')
    expect(sheet).not.toMatch(/\.rstat/)
    expect(sheet).not.toMatch(/\.ev(-[a-z]+)?\s*[{,]|\.ev-object/)
  })

  // R4 (fix wave): a marked label must not outrank a skin's own --data-nums (bare keeps proportional figures, on
  // purpose), so the rule sits at no specificity: only a label with no figure rule of its own gets tabular figures.
  it('marks a volatile label at no specificity, so a skin’s own --data-nums still decides its figures (R4)', () => {
    expect(utilities).toMatch(/^:where\(\[data-volatile\]\) \{ font-variant-numeric: tabular-nums; \}$/m)
    expect(utilities).not.toMatch(/^\[data-volatile\]/m)
  })

  it('wraps a long unbroken token in a cell instead of widening the page (Task 14, phone)', () => {
    expect(utilities).toMatch(/^\.brk \{ overflow-wrap: anywhere; \}/m)
  })

  // C7 replaces "sets a decision title in the body face, on its row's first baseline, not its last (Task 14)" (ledger):
  // a decision is a ledger data row now (its title the row's 14/500), and its text a Mono well in governance.css.
  it('the Propose panel holds two field columns at 1440 and never outgrows its column on the phone (C7 I-5, 1.4.10)', () => {
    const rule = blockAfter(frame, '.panel-form {')
    expect(rule).toContain('inline-size: var(--w-panel-form);')
    expect(rule).toContain('max-inline-size: 100%;')
    expect(rule).toContain('box-sizing: border-box;')
    expect(design).not.toMatch(/\.panel-form/)
    // the slot's floor is border-box with the form's sizing: 300px of the panel fits a 320px screen, padding and all
    expect(blockAfter(frame, '.panel-right {')).toContain('min-width: var(--w-panel);') // C10: frame.css, beside the form
    const px = (name: string) => Number(new RegExp(`--${name}: (\\d+)px;`).exec(house)![1])
    expect(px('w-panel')).toBeLessThanOrEqual(320)
    expect(px('w-panel-form')).toBeGreaterThanOrEqual(420 + 2 * 20)
  })

  it('keeps none of 0.6’s Governance and proposal page rules: decisions are data rows, the page is governance.css (C7)', () => {
    expect(design).not.toMatch(/\.rows\.dec|\.decision-text|\.prop-|\.evlog/)
    expect(blockAfter(governance, '.gov-well {')).toContain('font: var(--fs-tiny)/var(--lh-code) var(--mono);')
    expect(blockAfter(governance, '.pp {')).toContain('flex-wrap: wrap;')
  })

  it('keeps none of 0.6’s record page rules: the page, its wells, the log and the driver tables are rows.css (C8)', () => {
    expect(design).not.toMatch(/\.rec-|\.confirm\b|\.cmdline|^\.log\b|\.rows\.drv|\.embed\b/m)
    expect(blockAfter(rows, '.mono-well {')).toContain('font: var(--fs-tiny)/var(--lh-code) var(--mono);')
    expect(blockAfter(rows, '.joblog-out {')).toContain('max-block-size: var(--h-log);')
    expect(blockAfter(rows, '.rp {')).toContain('flex-wrap: wrap;')
    expect(rows).not.toMatch(/@media \((max|min)-width/)
  })

  // E-65: a field's input may sit in a wrapper of its own (the reference tokens, the checkbox's box); the value's run
  // still takes the row's whole width for it.
  it('gives a field row’s input the whole value column, wrapped or not (E-65)', () => {
    const rule = /\.fields-v:has\(([^)]*(?:\([^)]*\)[^)]*)*)\) \{ flex-basis: 100%; \}/.exec(rows)
    expect(rule, 'no .fields-v:has(…) rule').not.toBeNull()
    const parts = rule![1]!.split(',').map(p => p.trim())
    expect(parts).toEqual(['input:not([type=checkbox])', 'select', 'textarea'])
  })

  // B1: `.was` left design.css for rows.css (ledger); the struck value stays one piece beside the new.
  it('keeps a struck old value in one piece, beside the input or under it, never split across both (Task 14; B1: rows.css)', () => {
    expect(design).not.toMatch(/^\.was \{/m)
    expect(blockAfter(rows, '.fields .was {')).toContain('display: inline-block;')
  })

  // B1: the raw inputs in field rows are drawn in rows.css, as controls.css's .input (ledger).
  it('sets a prose textarea in the body face, not the YAML mono (final 1; B1: rows.css)', () => {
    expect(design).not.toMatch(/\.fields (input|select|textarea)/)
    expect(blockAfter(rows, '.fields textarea.prose {')).toContain('font: var(--fw-regular) var(--fs-body)/var(--lh-body) var(--sans);')
  })

  // B9 replaces "runs the inspector's left rule the column's full height…" (final 4; ledger): the inspector is drawn
  // in rows.css (.insp, raised, its start hairline) and design.css keeps none of 0.6's .inspector or .insp-in.
  it("runs the inspector's start rule the column's full height, its content sticky inside it (final 4; B9: rows.css)", () => {
    const outer = blockAfter(rows, '.insp {')
    expect(outer).toContain('inline-size: var(--w-inspector);')
    expect(outer).toContain('align-self: stretch;')
    expect(outer).toContain('border-inline-start: var(--rule-w) solid var(--rule);')
    expect(outer).toContain('background: var(--raised);')
    expect(outer).not.toMatch(/sticky|max-height|overflow/)
    expect(blockAfter(rows, '.insp-in {')).toMatch(/position: sticky; inset-block-start: 0; max-height: 100dvh; overflow-y: auto;/)
    expect(design).not.toMatch(/\.inspector\b|\.insp-in\b/)
  })

  // B9 replaces "breaks a MiniMap node's name between words, not inside one" (final 11; ledger): a small-map pill is
  // one line (§8.6), its name ending in an ellipsis inside a share of the map's width.
  it('keeps a small-map pill to one line, a long name ending in "…" (final 11; B9: map.css)', () => {
    expect(blockAfter(map, '.mini-n {')).toContain('white-space: nowrap;')
    expect(blockAfter(map, '.mini-nm {')).toMatch(/min-width: 0; overflow: hidden; text-overflow: ellipsis;/)
    expect(blockAfter(map, '.mini-at {')).toContain('max-inline-size: 36%;')
    expect(design).not.toMatch(/\.mini\b|\.mini-node/)
  })

  it('draws the inspector modal under 1200 as a sheet over the scrim: from the end at 760–1199, from the bottom on the phone, 88% at most (§5.10)', () => {
    expect(blockAfter(rows, '.insp-sheet::backdrop {')).toContain('background: var(--scrim);')
    expect(blockAfter(rows, '.insp-side {')).toMatch(/inset-block: 0; inset-inline: auto 0; inline-size: min\(var\(--w-inspector\), 100%\); block-size: 100dvh;/)
    expect(blockAfter(rows, '.insp-bottom {')).toMatch(/inset-block: auto 0; inset-inline: 0;[^}]*max-block-size: var\(--h-sheet-max\);[^}]*env\(safe-area-inset-bottom\)/)
    for (const skin of [house, tokens]) expect(skin).toMatch(/--h-sheet-max: 88dvh;/)
    expect(blockAfter(rows, '.insp-t {')).toContain('font: var(--fw-strong) var(--fs-sub)/var(--lh-title) var(--sans);')
  })

  it('lays the compose canvas out in three columns, and under 820px of its own width the shelf wraps above and the inspector goes below (§8.7)', () => {
    expect(blockAfter(map, '.cmp {')).toContain('container: compose / inline-size;')
    expect(blockAfter(map, '.cmp-shell {')).toContain('grid-template-columns: var(--w-shelf) minmax(0, 1fr) var(--w-cmp-insp);')
    const at = map.indexOf('@container compose (max-width: 819px) {')
    expect(at, 'no @container compose (max-width: 819px) block').toBeGreaterThanOrEqual(0)
    const narrow = map.slice(at)
    expect(blockAfter(narrow, '.cmp-shell, .cmp-shell.cmp-read {')).toContain('grid-template-columns: minmax(0, 1fr);')
    expect(blockAfter(narrow, '.cmp-shelf {')).toMatch(/grid-template-columns: repeat\(auto-fill, minmax\(var\(--w-shelf-item-min\), 1fr\)\);[^}]*border-block-end:/)
    expect(blockAfter(narrow, '.cmp-insp {')).toContain('border-block-start: var(--rule-w) solid var(--rule);')
    for (const [t, v] of [['w-shelf', '200px'], ['h-shelf-item', '34px'], ['h-handle', '9px'], ['w-cmp-node', '190px']]) expect(house).toContain(`--${t}: ${v};`)
  })

  it('draws an invalid connection clay dashed 4 4 with its note on --pop, and the selected node’s handles 9px moss rings (§8.4, §8.7)', () => {
    expect(blockAfter(map, '.hedge.is-bad {')).toContain('stroke: var(--attn); stroke-dasharray: var(--dash-bad);')
    expect(blockAfter(map, '.cmp-bad {')).toMatch(/color: var\(--attn\);[^}]*background: var\(--pop\);/)
    expect(blockAfter(map, '.cmp-handle {')).toMatch(/inline-size: var\(--h-handle\); block-size: var\(--h-handle\);[^}]*border: var\(--stroke-w\) solid var\(--accent\);/)
  })

  it('gives shelf items, handles, small-map neighbours and "+N on the map" 44px on a coarse pointer, each after the rule it enlarges (§2, §13)', () => {
    const after = (rule: string, coarse: string) => {
      const r = map.indexOf(rule), c = map.indexOf(coarse)
      expect(r, rule).toBeGreaterThanOrEqual(0)
      expect(c, coarse).toBeGreaterThan(r)
    }
    after('.cmp-item {', '@media (pointer: coarse) { .cmp-item { block-size: var(--h-ctl-touch); } }')
    after('.cmp-handle {', '@media (pointer: coarse) { .cmp-handle::after { content: ""; position: absolute; inset: calc((var(--h-handle) - var(--h-ctl-touch)) / 2); } }')
    after('.mini-n {', 'a.mini-n::after { content: ""; position: absolute; inset-block: calc((100% - var(--h-ctl-touch)) / 2); inset-inline: 0; }')
    after('.mini-more {', '.mini-more { display: inline-flex; align-items: center; min-block-size: var(--h-ctl-touch); }')
    expect(map).toMatch(/@media \(hover: hover\) \{ \.cmp-item:hover/)
  })

  it("sets a textarea field's label on its first line, not its last (final 8; B1: the label beside a textarea starts at the top)", () => {
    expect(blockAfter(rows, '.fields > dt:has(+ dd textarea) {')).toContain('align-items: flex-start;')
  })

  it('keeps the attention shape on the line of its text (final 9; A6: states.css draws it)', () => {
    expect(design).not.toMatch(/^\.mark(-dot)? \{/m)
    expect(states).toMatch(/^\.mark \{ display: inline-flex; align-items: baseline; \}/m)
    const shape = blockAfter(states, '.smark-shape, .mark-shape {')
    expect(shape).toContain('flex: none;')
    expect(shape).toContain('align-self: center;') // the text, not the shape, is the line's baseline
    expect(states).toMatch(/^\.smark \{ display: inline-flex; align-items: baseline;/m)
  })

  // C10 (ledger): "keeps a Links row's record kind narrow (final 10)" is gone: Links draws data rows (C8), and no
  // table names a .kd cell any more.

  it('keeps the focus ring on the controls: none is drawn with all: unset or loses its outline (P4b; A5)', () => {
    expect(controls).not.toMatch(/all: unset/)
    expect(controls).not.toMatch(/outline: (none|0)\b/)
    expect(controls).toMatch(/\.tabs \[role="tab"\]:focus-visible \{[^}]*outline-offset: calc\(-1 \* var\(--focus-w\)\)/)
  })

  it("lays a menu's own children out as a column of choices, not a row (P4b; A5)", () => {
    expect(blockAfter(controls, '.menu-children {')).toMatch(/display: flex; flex-direction: column; gap: var\(--sp-4\);/)
  })

  // C9 (ledger): the block frame's foot is views.css's `.bf-foot` now; 0.6's `.blk-foot` is gone with design.css's rule
  it("hides a block's foot when its Foot draws nothing, so it adds no stray margin (final review M-1)", () => {
    const views = read('./css/views.css')
    expect(blockAfter(views, '.bf-foot:empty {').trim()).toBe('display: none;')
    expect(views.indexOf('.bf-foot:empty {')).toBeGreaterThan(views.indexOf('.bf-foot {'))
  })

  // C9 (§14.2): the boards, Arrange and the block frame are drawn by views.css; design.css keeps none of 0.6's rules
  it("leaves none of 0.6's board, Arrange, block or source-well rules in design.css (C9)", () => {
    for (const sel of ['.board', '.arr', '.blk {', '.blk-foot', '.cols3', '.yaml', '.nav-skin']) expect(design, sel).not.toContain(sel)
  })

  it('draws a picked block as a moss drop target, and block settings at the panel width (E-71, §14.2)', () => {
    const views = read('./css/views.css')
    expect(blockAfter(views, '.arr.picked {')).toMatch(/outline: var\(--rule-w-heavy\) dashed var\(--accent\);[^}]*background: var\(--accent-soft\);/)
    expect(blockAfter(views, '.insp.insp-settings {')).toContain('inline-size: var(--w-panel);')
  })

  it('gives every mark a shape: no mark is told by colour alone (P4b, spec §8; A6: §6.1, in states.css)', () => {
    expect(design).not.toMatch(/\.smark/)
    for (const m of ['needs', 'staged', 'stale', 'draft', 'open', 'ok', 'done', 'failed', 'closed', 'aged']) {
      expect(states).toContain(`.smark-${m} > .smark-shape`)
    }
    expect(states).toMatch(/\.smark-running > \.spin \{/) // the running shape is the reading ring itself
    // selected and faint are a row's or a node's treatment, not a glyph: moss, and the word in --faint (C11: never
    // opacity over a word, 1.4.3)
    expect(blockAfter(states, '.smark-selected {')).toContain('color: var(--accent);')
    expect(blockAfter(states, '.smark-faint {')).toContain('color: var(--faint);')
  })
})

describe('the root keeps the browser’s font size (A7b)', () => {
  /** Every stylesheet under design/ but the skins (token values) and the font faces. */
  const dir = fileURLToPath(new URL('./', import.meta.url))
  const sheets: Record<string, string> = {}
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = `${d}${e.name}`
    if (e.isDirectory()) { if (e.name !== 'skins' && e.name !== 'fonts') walk(`${p}/`) }
    else if (e.name.endsWith('.css')) sheets[p.slice(dir.length)] = readFileSync(p, 'utf8')
  } }
  walk(dir)

  /** The rules of a sheet as [selector list, declarations], innermost blocks only (a rule inside @media too). */
  const rules = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(m => [m[1]!.trim(), m[2]!] as const)
  /** A selector list one of whose selectors is the root itself: `html` or `:root`, with or without attributes. */
  const namesRoot = (sel: string) => sel.split(',').some(s => /^(html|:root)(?![-\w])[^\s>+~]*$/.test(s.trim()))
  const setsFont = (decls: string) => /(?:^|;)\s*font(?:-size)?\s*:/.test(decls)

  it('reads the design sheets, base.css among them', () => {
    expect(Object.keys(sheets)).toEqual(expect.arrayContaining(['base.css', 'design.css']))
    expect(Object.keys(sheets).some(k => k.startsWith('skins/') || k.startsWith('fonts/'))).toBe(false)
  })

  it('tells a root font rule from the others', () => {
    expect(rules('html, body { font: 1rem x; }').filter(([s, d]) => namesRoot(s) && setsFont(d))).toHaveLength(1)
    expect(rules(':root { font-size: 14px; }').filter(([s, d]) => namesRoot(s) && setsFont(d))).toHaveLength(1)
    expect(rules('html { font-optical-sizing: auto; -webkit-font-smoothing: antialiased; }').filter(([s, d]) => namesRoot(s) && setsFont(d))).toEqual([])
    expect(rules('html body { font: 1rem x; } .html { font: 1rem x; }').filter(([s, d]) => namesRoot(s) && setsFont(d))).toEqual([])
  })

  it('sets no font or font-size on html or :root, so every rem token is drawn at the gallery’s 16px root', () => {
    const found = Object.entries(sheets).flatMap(([name, css]) =>
      rules(css).filter(([s, d]) => namesRoot(s) && setsFont(d)).map(([s]) => `${name}: ${s}`))
    expect(found).toEqual([])
  })

  it('keeps a mark as wide as its word: a nowrap mark that shrinks spills out of its row (at the true root, /parts/blocks scrolled sideways at 390)', () => {
    const mark = rules(sheets['css/states.css']!).find(([s]) => s === '.smark')
    expect(mark).toBeDefined()
    expect(mark![1]).toContain('white-space: nowrap;')
    expect(mark![1]).not.toMatch(/min-width: 0/)
  })

  it('sets the body’s type on body', () => {
    expect(rules(sheets['base.css']!).some(([s, d]) => s === 'body' && /font: var\(--fs-body\)\/var\(--lh-body\) var\(--sans\);/.test(d))).toBe(true)
  })
})

// C1 (CC-15, E-8): the collection views' sheet joins the no-viewport-width guard; its narrow form reads the view's own
// named container, and nothing in it scrolls sideways.
describe('the collection views (§10.2), by their own container', () => {
  const views = read('./css/views.css')
  it('lays the views out by their own container (the table as cards under 600px of it), never a viewport width query (CC-15, E-8)', () => {
    expect(views).not.toMatch(/@media \((max|min)-width/)
    expect(views).toContain('.tv { container: tview / inline-size;')
    expect(views).toContain('@container tview (max-width: 599px) {')
    expect(views).not.toMatch(/overflow-x: (auto|scroll)/)
  })

  it('fills on hover only where a pointer can hover', () => {
    expect(views.replace(/@media \(hover: hover\) \{[^\n]*\}\s*\}/g, '')).not.toMatch(/:hover/)
  })
})

// C3 (CC-15, E-13, E-18): the workspace's sheet joins the no-viewport-width guard. The editor reads its own named
// container: under 760px of it the bar keeps the path's end, the save glyph, presence and the visibility control,
// the title is 26px and the body's padding 16 (§10.1 phone).
describe('the workspace (§10.1–§10.4), by its own container', () => {
  const work = read('./css/workspace.css')
  const narrow = (() => {
    const at = work.indexOf('@container ed (max-width: 759px) {')
    expect(at, 'no narrow form for the editor').toBeGreaterThanOrEqual(0)
    return work.slice(at, work.indexOf('\n}', at))
  })()

  it('lays the editor out by its own container, never a viewport width query (CC-15, E-18)', () => {
    expect(work).not.toMatch(/@media \((max|min)-width/)
    expect(work).toMatch(/\.ed \{[^}]*container: ed \/ inline-size;/)
    expect(work).not.toMatch(/overflow-x: (auto|scroll)/)
  })

  it('under 760px of the editor: the path’s end alone, the save glyph without its words (still read), title 26, body padding 16 (E-13)', () => {
    expect(narrow).toMatch(/\.ed-crumbs li:not\(:last-child\) \{ display: none; \}/)
    expect(narrow).toMatch(/\.ed-crumbs li:last-child::before \{ content: none; \}/)
    expect(narrow).toMatch(/\.ed-bar \.save-w \{[^}]*clip-path: inset\(50%\);/)
    expect(narrow).toMatch(/\.ed-title \{ font-size: var\(--fs-page-narrow\); \}/)
    expect(narrow).toMatch(/\.ed-body \{ padding: [^;]*var\(--sp-10\)[^;]*; \}/)
    // presence and the visibility control are never hidden
    expect(narrow).not.toMatch(/\.(pres|vis|vis-ctl)\b[^{]*\{[^}]*display: none/)
    expect(house).toMatch(/--fs-page-narrow: 1\.625rem;/)
    expect(tokens).toMatch(/--fs-page-narrow: [^;]+;/)
  })

  it('the title Fraunces 32 at 1.15, prose Geist 16/1.65 at the prose measure, H2 Sans 600 20, H3 Sans 600 16 (§10.1, §3.3)', () => {
    expect(work).toMatch(/\.ed-title \{[^}]*font: var\(--fw-regular\) var\(--fs-page\)\/var\(--lh-greet\) var\(--display\);/)
    expect(work).toMatch(/\.ed-prose \{[^}]*font: var\(--fw-regular\) var\(--fs-sub\)\/var\(--lh-prose\) var\(--sans\);/)
    expect(work).toMatch(/\.ed-prose p \{[^}]*max-inline-size: var\(--w-prose\);/)
    expect(work).toMatch(/\.ed-prose h2 \{[^}]*font: var\(--fw-strong\) var\(--fs-h2\)\/var\(--lh-title\) var\(--sans\);/)
    expect(work).toMatch(/\.ed-prose h3 \{[^}]*font: var\(--fw-strong\) var\(--fs-sub\)\/var\(--lh-title\) var\(--sans\);/)
    expect(work).toMatch(/\.ed-meta \{[^}]*font-size: var\(--fs-tiny\);[^}]*color: var\(--faint\);/)
  })

  it('the editing affordances: the current block’s 2px --focus rule, selection on --accent-soft, commented text clay on --attn-soft, links under --edge (E-14)', () => {
    expect(work).toMatch(/\.ed-cur \{[^}]*border-inline-start: var\(--rule-w-heavy\) solid var\(--focus\);/)
    expect(work).toMatch(/\.ed-sel \{[^}]*background: var\(--accent-soft\);/)
    expect(work).toMatch(/\.ed-cmt \{[^}]*background: var\(--attn-soft\);[^}]*border-block-end: [^;]*var\(--attn\);/)
    expect(work).toMatch(/\.ed-prose a \{[^}]*text-decoration-color: var\(--edge\);[^}]*text-decoration-thickness: from-font;/)
    expect(work).toMatch(/\.ed-callout \{[^}]*background: var\(--sunken\);[^}]*border-radius: var\(--radius\);/)
    expect(work).toMatch(/\.ed-embed \{[^}]*border: var\(--rule-w\) solid var\(--rule\);/)
  })

  it('the thread: 28px monograms, replies indented 54, a sheet from the bottom under 1200 (§10.3, E-15)', () => {
    expect(work).toMatch(/\.av-lg \{[^}]*inline-size: var\(--h-av-lg\); block-size: var\(--h-av-lg\);/)
    expect(work).toMatch(/\.cmt-reply \{[^}]*padding-inline-start: var\(--pad-reply\);/)
    expect(work).toMatch(/\.thread-sheet \{[^}]*position: fixed;/)
    expect(house).toMatch(/--h-av-lg: 28px;/)
    expect(house).toMatch(/--pad-reply: 54px;/)
    for (const t of ['h-av-lg', 'pad-reply', 'fs-h2']) expect(tokens, `bare lacks --${t}`).toMatch(new RegExp(`--${t}: [^;]+;`))
  })

  it('the selection toolbar on --pop, radius 10; its buttons 44px on a coarse pointer, after the rule they enlarge (§13)', () => {
    expect(work).toMatch(/\.selbar \{[^}]*background: var\(--pop\);[^}]*border-radius: var\(--radius\);/)
    const coarse = work.indexOf('@media (pointer: coarse) { .selbar-b {')
    expect(coarse).toBeGreaterThanOrEqual(0)
    expect(work.indexOf('.selbar-b {')).toBeLessThan(coarse)
  })

  it('fills on hover only where a pointer can hover', () => {
    expect(work.replace(/@media \(hover: hover\) \{[^\n]*\}\s*\}/g, '')).not.toMatch(/:hover/)
  })
})

describe('design pass e2e fixes (2026-11-04)', () => {
  it("the new form's id edit is a 24px target at least (WCAG 2.5.8; e2e:a11y target-size)", () => {
    const form = read('./css/form.css')
    expect(form).toMatch(/\.form-id-edit \{[^}]*min-block-size: var\(--sp-12\);[^}]*min-inline-size: var\(--sp-12\);/)
    expect(house).toMatch(/--sp-12: 24px;/)
  })
  it("Boards' show-all names every folded section and wraps at 320 instead of running past the column (e2e:reflow)", () => {
    const views = read('./css/views.css')
    expect(views).toMatch(/\.boards-fold \.btn\.sm \{[^}]*height: auto;[^}]*max-inline-size: 100%;[^}]*white-space: normal;/)
  })
})
