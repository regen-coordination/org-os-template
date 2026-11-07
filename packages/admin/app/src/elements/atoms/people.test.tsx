// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen, within } from '@testing-library/react'
import { renderAt } from '../../test/render.tsx'
import { Icon, kindIcon, type IconName } from '../../design/Icon.tsx'
import { PEOPLE } from '../../test/fixtures/house/people.ts'
import { ROLES } from '../../test/fixtures/house/org.ts'
import { Presence, monogram } from './Presence.tsx'
import { Mention } from './Mention.tsx'

const here = dirname(fileURLToPath(import.meta.url))
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const atomsCss = noComments(readFileSync(join(here, '..', '..', 'design', 'css', 'atoms.css'), 'utf8'))
/** The house's 13px glyph, drawn on its own (in a detached node), to compare with what a mention draws. */
function glyph(name: IconName) {
  const c = document.createElement('div')
  render(<Icon name={name} size="xs" />, { container: c })
  return c.innerHTML
}
const person = (handle: string, editing?: boolean) => {
  const p = PEOPLE.find(x => x.handle === handle)!
  return { handle: p.handle, role: p.name, ...(editing ? { editing } : {}) }
}

describe('the people fixtures (§17)', () => {
  it('are the placeholder roles, by handle, with their monograms and generated wallets', () => {
    expect(PEOPLE.map(p => [p.handle, p.name, p.monogram])).toEqual([
      ['council-steward', 'Council steward', 'CS'], ['steward-a', 'Steward A', 'SA'], ['steward-b', 'Steward B', 'SB'],
      ['ops-lead', 'Ops lead', 'OL'], ['treasury-steward', 'Treasury steward', 'TS'],
    ])
    expect(PEOPLE.map(p => p.handle)).toEqual(ROLES.map(r => r.handle))
    for (const p of PEOPLE) expect(p.wallet).toMatch(/^0x[0-9a-f]{40}$/)
    expect(new Set(PEOPLE.map(p => p.wallet)).size).toBe(PEOPLE.length)
  })
  it('draw each monogram from the handle', () => {
    for (const p of PEOPLE) expect(monogram(p.handle)).toBe(p.monogram)
  })
})

describe('monogram (§7.12)', () => {
  it('takes two letters from the handle, upper case', () => {
    expect(monogram('ops-lead')).toBe('OL')
    expect(monogram('steward-a')).toBe('SA')
    expect(monogram('x')).toBe('X')
  })
  it('takes the first two letters of a one-word handle, and the first two words of a longer one', () => {
    expect(monogram('treasurer')).toBe('TR')
    expect(monogram('ops-lead-two')).toBe('OL')
    expect(monogram('ops_lead')).toBe('OL')
  })
})

describe('Presence (§7.12)', () => {
  it('is one element named for everyone: who is editing, who is reading', () => {
    renderAt(<Presence people={[person('ops-lead', true), person('steward-b')]} />)
    const stack = screen.getByRole('img', { name: 'Ops lead is editing; Steward B is reading' })
    expect(stack.classList.contains('pres')).toBe(true)
    expect([...stack.querySelectorAll('.av')].map(a => a.firstChild!.textContent)).toEqual(['OL', 'SB'])
  })
  it('draws three monograms at most, then "+N" outlined, and still names everyone', () => {
    renderAt(<Presence people={['steward-a', 'ops-lead', 'treasury-steward', 'steward-b', 'council-steward'].map(h => person(h))} />)
    const stack = screen.getByRole('img', { name: 'Steward A is reading; Ops lead is reading; Treasury steward is reading; Steward B is reading; Council steward is reading' })
    const avs = [...stack.querySelectorAll('.av')]
    expect(avs.map(a => a.textContent)).toEqual(['SA', 'OL', 'TS', '+2'])
    expect(avs[3]!.classList.contains('av-more')).toBe(true)
    expect(avs.slice(0, 3).some(a => a.classList.contains('av-more'))).toBe(false)
  })
  it('three people draw three monograms and no "+N"', () => {
    renderAt(<Presence people={['steward-a', 'ops-lead', 'treasury-steward'].map(h => person(h))} />)
    expect(document.querySelectorAll('.av')).toHaveLength(3)
    expect(document.querySelector('.av-more')).toBeNull()
  })
  it('editing adds the pen badge to that monogram only', () => {
    renderAt(<Presence people={[person('steward-a', true), person('ops-lead')]} />)
    const [sa, ol] = [...document.querySelectorAll('.av')]
    const pen = sa!.querySelector('.av-pen')!
    expect(pen).not.toBeNull()
    expect(pen.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    expect(pen.innerHTML).toBe(glyph('pencil'))
    expect(ol!.querySelector('.av-pen')).toBeNull()
  })
  it('no picture, no identicon: letters only', () => {
    const { container } = renderAt(<Presence people={PEOPLE.map(p => person(p.handle))} />)
    expect(container.querySelector('img, picture, canvas')).toBeNull()
    expect(container.querySelectorAll('[style]')).toHaveLength(0)
  })
  it('draws nothing for nobody', () => {
    const { container } = renderAt(<Presence people={[]} />)
    expect(container.querySelector('.pres')).toBeNull()
  })
  it('is drawn as the spec says: 24px circles on --wash-strong, a --paper ring, −4px overlap, first on top; +N outlined', () => {
    expect(atomsCss).toMatch(/\.av \{[^}]*inline-size: var\(--h-av\);[^}]*block-size: var\(--h-av\);[^}]*background: var\(--wash-strong\);[^}]*color: var\(--ink\);/)
    expect(atomsCss).toMatch(/\.av \{[^}]*font: var\(--fw-strong\) var\(--fs-av\)\/var\(--lh-ui\) var\(--sans\);/)
    expect(atomsCss).toMatch(/\.pres \.av \{[^}]*box-shadow: 0 0 0 var\(--ring-av\) var\(--paper\);/)
    expect(atomsCss).toMatch(/\.pres \.av \+ \.av \{ margin-inline-start: calc\(-1 \* var\(--sp-4\)\); \}/)
    expect(atomsCss).toMatch(/\.pres \.av:nth-child\(1\) \{ z-index: 4; \}/)
    expect(atomsCss).toMatch(/\.av-more \{[^}]*border: var\(--rule-w\) solid var\(--rule-strong\);/)
    expect(atomsCss).toMatch(/\.av-pen \{[^}]*inline-size: var\(--h-av-pen\);[^}]*background: var\(--solid\);[^}]*color: var\(--on-solid\);/)
  })
})

describe('Mention (§7.11)', () => {
  it('takes one shape or the other, never both: a link with `restricted`, or `restricted` with a link, does not type-check (L4a final review M-7)', () => {
    const both = [
      // @ts-expect-error — the link form takes no `restricted`
      <Mention key="a" kind="person" text="Ops lead" href="/roles/members/ops-lead" restricted="not-visible" />,
      // @ts-expect-error — the restricted form takes no text or link
      <Mention key="b" restricted="members-only" text="Ops lead" href="/roles/members/ops-lead" />,
    ]
    expect(both).toHaveLength(2)
  })

  it('a person: a link to their record, "@" faint and hidden from assistive tech', () => {
    renderAt(<Mention kind="person" text="Ops lead" href="/roles/members/ops-lead" />)
    const a = screen.getByRole('link', { name: 'Ops lead' })
    expect(a.getAttribute('href')).toBe('/roles/members/ops-lead')
    expect(a.className).toBe('mention')
    const at = a.querySelector('.mention-at')!
    expect(at.textContent).toBe('@')
    expect(at.getAttribute('aria-hidden')).toBe('true')
    expect(a.textContent).toBe('@Ops lead')
  })
  it('you: the accent-soft class, still a link with the faint-hidden "@"', () => {
    renderAt(<Mention kind="you" text="Council steward" href="/roles/members/council-steward" />)
    const a = screen.getByRole('link', { name: 'Council steward' })
    expect(a.classList.contains('mention-you')).toBe(true)
    expect(a.querySelector('.mention-at')!.getAttribute('aria-hidden')).toBe('true')
    expect(atomsCss).toMatch(/\.mention-you \{[^}]*background: var\(--accent-soft\);[^}]*color: var\(--accent\);/)
  })
  it('a record: its kind’s glyph and its name, a link to the record page; no "@"', () => {
    renderAt(<Mention kind="record" recordKind="proposal" text="DR-2026-010" href="/governance/proposals/DR-2026-010" />)
    const a = screen.getByRole('link', { name: 'DR-2026-010' })
    expect(a.getAttribute('href')).toBe('/governance/proposals/DR-2026-010')
    expect(a.classList.contains('mention-rec')).toBe(true)
    expect(a.querySelector('.mention-at')).toBeNull()
    expect(a.querySelector('svg')!.outerHTML).toBe(glyph(kindIcon('proposal')))
    expect(a.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
  })
  it('a record of another kind draws that kind’s glyph', () => {
    renderAt(<Mention kind="record" recordKind="hat" text="Treasury signer" href="/roles/hats/treasury-signer" />)
    expect(screen.getByRole('link', { name: 'Treasury signer' }).querySelector('svg')!.outerHTML).toBe(glyph('hat'))
  })
  it('a page: the file glyph and its title, a link to the page', () => {
    renderAt(<Mention kind="page" text="How the treasury is run" href="/workspace/how-the-treasury-is-run" />)
    const a = screen.getByRole('link', { name: 'How the treasury is run' })
    expect(a.getAttribute('href')).toBe('/workspace/how-the-treasury-is-run')
    expect(a.classList.contains('mention-rec')).toBe(true)
    expect(a.querySelector('svg')!.outerHTML).toBe(glyph('doc'))
  })
  it('a long title truncates inside the pill: whole in the DOM and in title, the label clips, the pill never outgrows its line', () => {
    const long = 'How the treasury is run, from the first proposal to the last signature, in plain words'
    renderAt(<Mention kind="page" text={long} href="/workspace/x" />)
    const a = screen.getByRole('link', { name: long })
    expect(a.getAttribute('title')).toBe(long)
    expect(a.querySelector('.mention-t')!.textContent).toBe(long)
    expect(atomsCss).toMatch(/\.mention \{[^}]*max-inline-size: 100%;/)
    expect(atomsCss).toMatch(/\.mention-t \{[^}]*min-inline-size: 0;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/)
  })
  it('something the reader may not see: the dashed inline form, no title and no link', () => {
    renderAt(<p><Mention restricted="members-only" /> and <Mention restricted="not-visible" /></p>)
    const p = document.querySelector('p')!
    expect(within(p).queryAllByRole('link')).toHaveLength(0)
    expect([...p.querySelectorAll('.mention-gone')].map(m => m.textContent)).toEqual(['Members only', 'Not visible to you'])
    expect(p.textContent).not.toContain('treasury')
    expect(atomsCss).toMatch(/\.mention-gone \{[^}]*border: var\(--rule-w\) dashed var\(--rule-strong\);/)
  })
  it('inherits the text size, a --wash pill radius 4, "@" faint; focus visible; hover only where a pointer hovers', () => {
    expect(atomsCss).toMatch(/\.mention \{[^}]*padding: 0 var\(--sp-3\);[^}]*border-radius: var\(--radius-xs\);[^}]*background: var\(--wash\);[^}]*color: var\(--ink\);[^}]*font-weight: var\(--fw-medium\);/)
    expect(atomsCss).not.toMatch(/\.mention \{[^}]*font-size/)
    expect(atomsCss).toMatch(/\.mention-at \{ color: var\(--faint\); \}/)
    expect(atomsCss).toMatch(/\.mention:focus-visible \{ outline: var\(--focus-w\) solid var\(--focus\); outline-offset: var\(--focus-w\); \}/)
    const outside = atomsCss.replace(/@media \(hover: hover\) \{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '')
    expect(outside).not.toMatch(/\.mention[^{,]*:hover/)
    expect(atomsCss).toMatch(/@media \(hover: hover\) \{[^@]*\.mention:hover/)
  })
})
