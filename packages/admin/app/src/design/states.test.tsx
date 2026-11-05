// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import { MARK_WORD, StatusMark, type Mark } from './StatusMark.tsx'
import { Skeleton } from './Skeleton.tsx'
import { Spinner } from './Spinner.tsx'
import { KindTile } from './KindTile.tsx'
import { Meter } from './Meter.tsx'
import { Icon, kindIcon } from './Icon.tsx'

// a string, not a URL: under jsdom the global URL is jsdom's, which node's fileURLToPath refuses
const here = dirname(fileURLToPath(import.meta.url))
const src = `${join(here, '..')}/`
const read = (f: string) => readFileSync(join(here, f), 'utf8')
const states = read('./css/states.css')
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every stylesheet the parts draw with (the skins hold values, not rules). */
function sheets(): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = `${d}${e.name}`
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(`${p}/`) }
      else if (e.name.endsWith('.css')) out[p.slice(src.length)] = readFileSync(p, 'utf8')
    }
  }
  walk(src)
  return out
}

/** The innermost rules of a sheet, as [selector, body]: a rule inside @media keeps its own selector. */
const rules = (css: string) => [...noComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1]!.trim(), m[2]!] as const)

/** The glyph a mark draws (§6.1), as the class its shape carries. */
const ALL: Mark[] = ['needs', 'staged', 'stale', 'draft', 'open', 'ok', 'done', 'running', 'failed', 'closed', 'aged', 'selected', 'faint']

describe('the marks (spec §6.1): a shape and a word', () => {
  it('says every mark in sentence case, in §6.1’s words (L4-R12)', () => {
    expect(MARK_WORD).toEqual({
      needs: 'Needs you', staged: 'Staged', stale: 'Changed since staged', draft: 'Not yet deployed', open: 'Open',
      ok: 'Up to date', done: 'Decided', running: 'Running', failed: 'Couldn’t read', closed: 'Closed', aged: 'Old read',
      selected: 'Selected', faint: 'not in this list',
    })
  })

  it('draws every mark with its own shape class, hidden from a screen reader; the word is the text', () => {
    for (const mark of ALL) {
      const { container, unmount } = render(<StatusMark mark={mark} />)
      const root = container.firstElementChild!
      expect(root.classList.contains('smark')).toBe(true)
      expect(root.classList.contains(`smark-${mark}`)).toBe(true)
      expect(root.querySelector('.smark-shape')!.getAttribute('aria-hidden')).toBe('true')
      expect(root.querySelector('.smark-word')!.textContent).toBe(MARK_WORD[mark])
      expect(container.textContent).toBe(MARK_WORD[mark])
      unmount()
    }
  })

  it('says a label in place of the word', () => {
    render(<StatusMark mark="done" label="Executed" />)
    expect(screen.getByText('Executed').className).toBe('smark-word')
    expect(screen.queryByText('Decided')).toBeNull()
  })

  it('turns the reading ring for a running mark: the one spinner, at the mark’s size', () => {
    const { container } = render(<StatusMark mark="running" label="Reading…" />)
    expect(container.querySelector('.smark-running > .smark-shape.spin[aria-hidden="true"]')).not.toBeNull()
    expect(states).toMatch(/\.smark-running > \.spin \{[^}]*inline-size: var\(--mark\);[^}]*block-size: var\(--mark\);/)
  })

  it('gives each glyph mark its §6.1 shape and colour in states.css', () => {
    const body = (sel: string) => rules(states).filter(([s]) => s.split(',').map(x => x.trim()).includes(sel)).map(([, b]) => b).join(' ')
    expect(body('.smark-needs > .smark-shape')).toMatch(/border-radius: var\(--radius-chip\);[^]*background: var\(--attn\);/)
    expect(body('.smark-staged > .smark-shape')).toMatch(/border-radius: var\(--radius-mark\);[^]*background: var\(--accent\);/)
    expect(body('.smark-stale > .smark-shape')).toMatch(/border: var\(--stroke-w\) solid var\(--attn\);/)
    expect(body('.smark-draft > .smark-shape')).toMatch(/border: var\(--stroke-w\) dashed var\(--accent\);/)
    expect(body('.smark-open > .smark-shape')).toMatch(/border: var\(--stroke-w\) solid var\(--mute\);/)
    expect(body('.smark-ok > .smark-shape')).toMatch(/background: var\(--mute\);/)
    expect(body('.smark-aged > .smark-shape')).toMatch(/border: var\(--stroke-w\) dashed var\(--faint\);/)
    expect(body('.smark-failed > .smark-shape')).toMatch(/block-size: var\(--mark-bar\);[^]*background: var\(--attn\);/)
    expect(body('.smark-closed > .smark-shape')).toMatch(/block-size: var\(--mark-bar\);[^]*background: var\(--faint\);/)
    expect(body('.smark-done > .smark-shape::before')).toMatch(/rotate: 45deg;/)
    for (const m of ['needs', 'stale', 'failed']) expect(body(`.smark-${m}`)).toContain('color: var(--attn);')
    for (const m of ['staged', 'draft', 'selected']) expect(body(`.smark-${m}`)).toContain('color: var(--accent);')
    expect(body('.smark-closed')).toContain('color: var(--faint);')
    // faint is the word in --faint, never opacity over it: dimmed words stay 4.5:1 (1.4.3; C11, axe color-contrast)
    expect(body('.smark-faint')).toContain('color: var(--faint);')
    expect(body('.smark-faint')).not.toContain('opacity')
  })

  it('draws 0.6’s Mark as the needs shape (warn) and the failed shape (alert), keeping its props', () => {
    const together = (a: string, b: string) => rules(states).some(([s]) => { const l = s.split(',').map(x => x.trim()); return l.includes(a) && l.includes(b) })
    expect(together('.smark-needs > .smark-shape', '.mark.warn > .mark-shape')).toBe(true)
    expect(together('.smark-failed > .smark-shape', '.mark.alert > .mark-shape')).toBe(true)
  })
})

describe('motion: the reading ring and the skeleton (spec §3.7)', () => {
  it('keeps the reading ring still under reduced motion: a static ¾ ring', () => {
    expect(noComments(states)).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\.spin \{ animation: none; \}/)
  })

  it('draws one spinner: states.css owns .spin, controls.css no longer does', () => {
    expect(rules(states).some(([s]) => s === '.spin')).toBe(true)
    expect(rules(read('./css/controls.css')).some(([s]) => s.split(',').map(x => x.trim()).includes('.spin'))).toBe(false)
  })

  it('animates nothing forever except the reading ring and a skeleton while pending', () => {
    const forever = Object.entries(sheets()).flatMap(([name, css]) => rules(css).filter(([, b]) => /\binfinite\b/.test(b)).map(([s]) => [name, s] as const))
    expect(forever.length).toBeGreaterThanOrEqual(2)
    for (const [name, sel] of forever) {
      for (const one of sel.split(',').map(x => x.trim())) expect(one, `${name}: ${one}`).toMatch(/^(\.spin$|\.skel\[aria-busy="true"\] )/)
    }
    expect(forever.some(([, s]) => s === '.spin')).toBe(true)
    expect(forever.some(([, s]) => s.startsWith('.skel[aria-busy="true"]'))).toBe(true)
  })

  it('breathes a skeleton from full to --o-breathe, 1.4 s alternate, and only while it is busy', () => {
    const t = read('./skins/house.css')
    expect(t).toMatch(/--o-breathe: \.55;/)
    expect(t).toMatch(/--dur-breathe: 1400ms;/)
    expect(noComments(states)).toMatch(/\.skel\[aria-busy="true"\] \.skel-bar \{ animation: breathe var\(--dur-breathe\) var\(--ease\) infinite alternate; \}/)
    expect(noComments(states)).toMatch(/@keyframes breathe \{ to \{ opacity: var\(--o-breathe\); \} \}/)
  })
})

describe('Spinner', () => {
  it('is the ring alone, hidden, with no label', () => {
    const { container } = render(<Spinner />)
    expect(container.innerHTML).toBe('<span class="spin" aria-hidden="true"></span>')
  })

  it('says its word beside the ring when given one', () => {
    const { container } = render(<Spinner label="Reading…" />)
    expect(container.querySelector('.spinner > .spin[aria-hidden="true"]')).not.toBeNull()
    expect(container.textContent).toBe('Reading…')
  })
})

describe('Skeleton', () => {
  it('is a busy region named "Loading <thing>" with N rows of the given shape', () => {
    render(<Skeleton rows={3} shape="row" label="Systems" />)
    const region = screen.getByRole('region', { name: 'Loading Systems' })
    expect(region.getAttribute('aria-busy')).toBe('true')
    expect(region.classList.contains('skel')).toBe(true)
    expect(region.querySelectorAll(':scope > .skel-row.skel-row-row')).toHaveLength(3)
    for (const row of region.querySelectorAll('.skel-row')) expect(row.getAttribute('aria-hidden')).toBe('true')
  })

  it.each(['row', 'row-1', 'card', 'node', 'needs'] as const)('draws the %s shape with wash bars', shape => {
    const { container } = render(<Skeleton rows={2} shape={shape} label="records" />)
    const rows = container.querySelectorAll(`.skel-row-${shape}`)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.querySelectorAll('.skel-bar').length).toBeGreaterThan(0)
  })

  // B3 (CC-7): the Needs you row's shape — its 32px tile, two bars and the trailing bar, at the 72px row's height.
  it('draws the needs shape with the 32px tile, at the Needs you row’s height', () => {
    const { container } = render(<Skeleton rows={2} shape="needs" label="Needs you" />)
    const row = container.querySelector('.skel-row-needs')!
    expect(row.querySelector('.ktile.ktile-needs')).not.toBeNull()
    expect(row.querySelectorAll('.skel-main .skel-bar')).toHaveLength(2)
    expect(row.querySelector(':scope > .skel-e')).not.toBeNull()
  })

  it('draws its bars in --wash, the row’s real height, so nothing jumps', () => {
    const body = (sel: string) => rules(states).filter(([s]) => s === sel).map(([, b]) => b).join(' ')
    expect(body('.skel-bar')).toContain('background: var(--wash);')
    expect(body('.skel-row-row')).toContain('min-block-size: var(--h-row);')
    expect(body('.skel-row-row-1')).toContain('min-block-size: var(--h-row-1);')
  })
})

describe('KindTile (spec §7.14)', () => {
  it('draws the kind’s glyph from kindIcon', () => {
    for (const kind of ['safe', 'hats-tree', 'proposal', 'gardens-pool', 'meeting']) {
      const { container, unmount } = render(<KindTile kind={kind} />)
      const { container: want } = render(<Icon name={kindIcon(kind)} />)
      expect(container.querySelector('svg')!.innerHTML).toBe(want.querySelector('svg')!.innerHTML)
      unmount()
    }
  })

  it('is a row tile by default (28), 32 on Needs you, 40 on a record header, sized by tokens', () => {
    const cls = (p: Parameters<typeof KindTile>[0]) => { const { container, unmount } = render(<KindTile {...p} />); const c = container.firstElementChild!.className; unmount(); return c }
    expect(cls({ kind: 'safe' })).toBe('ktile ktile-row')
    expect(cls({ kind: 'safe', size: 'needs' })).toBe('ktile ktile-needs')
    expect(cls({ kind: 'safe', size: 'header' })).toBe('ktile ktile-header')
    const body = (sel: string) => rules(states).filter(([s]) => s === sel).map(([, b]) => b).join(' ')
    expect(body('.ktile-row')).toMatch(/inline-size: var\(--h-ktile\); block-size: var\(--h-ktile\);/)
    expect(body('.ktile-needs')).toMatch(/inline-size: var\(--h-ktile-needs\); block-size: var\(--h-ktile-needs\);/)
    expect(body('.ktile-header')).toMatch(/inline-size: var\(--h-ktile-header\); block-size: var\(--h-ktile-header\);/)
    const t = read('./skins/house.css')
    expect(t).toMatch(/--h-ktile: 28px;/)
    expect(t).toMatch(/--h-ktile-needs: 32px;/)
    expect(t).toMatch(/--h-ktile-header: 40px;/)
  })

  it('takes the 20px glyph on a header, 16 elsewhere', () => {
    const { container, rerender } = render(<KindTile kind="safe" size="header" />)
    expect(container.querySelector('svg')!.getAttribute('class')).toContain('i-lg')
    rerender(<KindTile kind="safe" size="needs" />)
    expect(container.querySelector('svg')!.getAttribute('class')).toContain('i-md')
  })

  it('has an attention tone (clay on --attn-soft) and a moss tone (an outcome done)', () => {
    const { container, rerender } = render(<KindTile kind="hat" tone="attn" />)
    expect(container.firstElementChild!.className).toBe('ktile ktile-row ktile-attn')
    rerender(<KindTile kind="task" tone="moss" />)
    expect(container.firstElementChild!.className).toBe('ktile ktile-row ktile-moss')
    const body = (sel: string) => rules(states).filter(([s]) => s === sel).map(([, b]) => b).join(' ')
    expect(body('.ktile-attn')).toMatch(/background: var\(--attn-soft\); color: var\(--attn\);/)
    expect(body('.ktile-moss')).toMatch(/background: var\(--accent-soft\); color: var\(--accent\);/)
  })

  // B3 (CC-7): a tile may draw a glyph that is not its kind's — Needs you's neutral check, a signature's pen.
  it('draws `icon` in place of its kind’s glyph when given', () => {
    const { container } = render(<KindTile kind="proposal" size="needs" icon="check" />)
    const { container: want } = render(<Icon name="check" />)
    expect(container.querySelector('svg')!.innerHTML).toBe(want.querySelector('svg')!.innerHTML)
    expect(container.firstElementChild!.className).toBe('ktile ktile-needs')
  })

  it('is decoration: the kind is said in the text beside it', () => {
    const { container } = render(<KindTile kind="safe" />)
    expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Meter (spec §7.13)', () => {
  const segs = (c: HTMLElement) => [...c.querySelectorAll('.meter > i')].map(i => i.className || 'rest')

  it('draws up to 12 as `of` segments: done in ink, the rest in the track colour; hidden, words beside', () => {
    const { container } = render(<Meter done={2} of={4} words="2 of 4 approved" />)
    expect(segs(container)).toEqual(['on', 'on', 'rest', 'rest'])
    expect(container.querySelector('.meter')!.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('.meter-l')!.textContent).toBe('2 of 4 approved')
    expect(container.textContent).toBe('2 of 4 approved')
  })

  it('draws yours in moss, among the done ones', () => {
    const { container } = render(<Meter done={3} of={4} yours={1} words="3 of 4 · you approved" />)
    const s = segs(container)
    expect(s).toHaveLength(4)
    expect(s.filter(x => x === 'you')).toHaveLength(1)
    expect(s.filter(x => x === 'on')).toHaveLength(2)
    expect(s.slice(0, 3)).toContain('you')
    expect(s[3]).toBe('rest')
  })

  it('draws twelve as segments and thirteen as a bar', () => {
    const { container, rerender } = render(<Meter done={5} of={12} words="5 of 12" />)
    expect(container.querySelectorAll('.meter > i')).toHaveLength(12)
    rerender(<Meter done={5} of={13} words="5 of 13" />)
    expect(container.querySelector('.meter.bar')).not.toBeNull()
  })

  it('draws more than 12 as a bar with a fill, words always present', () => {
    const { container } = render(<Meter done={31} of={50} words="31 of 50 voted" />)
    const bar = container.querySelector('.meter.bar')!
    expect(bar.getAttribute('aria-hidden')).toBe('true')
    expect(bar.querySelectorAll('i')).toHaveLength(0)
    expect((bar.querySelector('.meter-fill') as HTMLElement).style.width).toBe('62%')
    expect(container.querySelector('.meter-l')!.textContent).toBe('31 of 50 voted')
  })

  it('never fills past the end, nor below nothing', () => {
    const { container, rerender } = render(<Meter done={60} of={50} words="all" />)
    expect((container.querySelector('.meter-fill') as HTMLElement).style.width).toBe('100%')
    rerender(<Meter done={3} of={4} yours={9} words="x" />)
    expect(segs(container).filter(x => x === 'rest')).toHaveLength(1)
    rerender(<Meter done={0} of={0} words="no one yet" />)
    expect(container.textContent).toBe('no one yet')
  })

  it('draws segments and the bar from tokens', () => {
    const body = (sel: string) => rules(states).filter(([s]) => s === sel).map(([, b]) => b).join(' ')
    expect(body('.meter > i')).toMatch(/inline-size: var\(--w-meter-seg\); block-size: var\(--h-meter\);[^]*background: var\(--rule-strong\);/)
    expect(body('.meter > i.on')).toContain('background: var(--ink);')
    expect(body('.meter > i.you')).toContain('background: var(--accent);')
    expect(body('.meter.bar')).toContain('inline-size: var(--w-meter-bar);')
  })
})
