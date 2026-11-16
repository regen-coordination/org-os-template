// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PortalPage } from './PortalPage.tsx'
import { MembersOnly } from './MembersOnly.tsx'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { PortalModel } from './portal.ts'
import App from '../App.tsx'
import { renderAt } from '../test/render.tsx'
import { flowEnv } from '../test/flowEnv.ts'
import { PORTAL_PUBLIC } from '../test/fixtures/house/portal.ts'
import { MAP_NODES } from '../test/fixtures/house/map.ts'
import { FIXED_NOW } from '../test/fixtures/parts.ts'
import { SAFE } from '../test/fixtures/house/org.ts'
import { TREASURY_SIGNERS } from '../test/fixtures/house/systems.ts'

const css = readFileSync(join(process.cwd(), 'app/src/design/css/portal.css'), 'utf8') // vitest runs from packages/admin
const house = readFileSync(join(process.cwd(), 'app/src/design/skins/house.css'), 'utf8')
const rule = (sel: string, from = css) => {
  const at = from.indexOf(`${sel} {`)
  expect(at, `no rule for ${sel}`).toBeGreaterThanOrEqual(0)
  return from.slice(from.indexOf('{', at) + 1, from.indexOf('}', at))
}
const narrow = css.slice(css.indexOf('@media (max-width: 899px) {'))

beforeEach(() => {
  flowEnv()
  // the map plate is 1000 wide, as on a desktop; the rest as flowEnv sizes it
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() {
    return (this as HTMLElement).classList.contains('hmap') ? 1000 : parseFloat((this as HTMLElement).style.width) || 1
  } })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { vi.unstubAllGlobals(); delete document.documentElement.dataset.theme })

const portal = (model: PortalModel = PORTAL_PUBLIC) => render(<PortalPage model={model} now={FIXED_NOW} />)
const section = (name: string) => screen.getByRole('region', { name })
const drawn = async () => { await waitFor(() => expect(document.querySelectorAll('.portal-plate .react-flow__node').length).toBeGreaterThan(0)) }

describe('the top (§12.1)', () => {
  it('the neutral seal on a 26px solid square, the name in Fraunces; nav Who holds what · What we fund · Treasury · Decisions; Members (secondary) → sign-in', () => {
    portal()
    const top = screen.getByRole('banner')
    expect(top.querySelector('.portal-seal svg')).not.toBeNull()
    expect(top.querySelector('.portal-seal img')).toBeNull()
    expect(top.querySelector('.portal-name')!.textContent).toBe('Example DAO')
    const nav = within(top).getByRole('navigation', { name: 'The portal' })
    const plain = [...nav.querySelectorAll<HTMLAnchorElement>('.portal-nav-a')].map(a => [a.textContent, a.getAttribute('href')])
    expect(plain).toEqual([['Who holds what', '#who'], ['What we fund', '#fund'], ['Treasury', '#treasury'], ['Decisions', '#decisions']])
    const members = within(nav).getByRole('link', { name: 'Members' })
    expect(members.getAttribute('href')).toBe('/sign-in') // E-29: L5's route
    expect(members.className).toBe('btn secondary portal-members')
    expect(rule('.portal-seal')).toMatch(/inline-size: var\(--w-portal-seal\); block-size: var\(--w-portal-seal\)/)
    expect(rule('.portal-seal')).toContain('background: var(--solid)')
    expect(house).toMatch(/--w-portal-seal: 26px;/)
    expect(rule('.portal-name')).toMatch(/font: var\(--fw-medium\) var\(--fs-d-mark\)\/var\(--lh-ui\) var\(--display\)/)
    expect(house).toMatch(/--fs-d-mark: 1\.1875rem;/)
    expect(rule('.portal-nav')).toMatch(/font-size: var\(--fs-meta\); color: var\(--mute\)/)
  })

  it('the org’s own mark when its records give one', () => {
    portal({ ...PORTAL_PUBLIC, org: { ...PORTAL_PUBLIC.org, mark: '/mark.png' } })
    expect(screen.getByRole('banner').querySelector('.portal-seal img')!.getAttribute('src')).toBe('/mark.png')
  })

  it('under 900px the nav folds into a Menu button opening a sheet; Members stays', () => {
    portal()
    expect(rule('.portal-nav-a', narrow)).toContain('display: none')
    expect(rule('.portal-menu', narrow)).toContain('display: block')
    expect(rule('.portal-menu')).toContain('display: none')
    expect(narrow).not.toMatch(/portal-members/)
    const menu = screen.getByLabelText('Menu')
    const details = menu.closest('details')!
    expect(details.open).toBe(false)
    fireEvent.click(menu)
    expect(details.open).toBe(true)
    const sheet = details.querySelector('.portal-sheet')!
    expect([...sheet.querySelectorAll('a')].map(a => a.textContent)).toEqual(['Who holds what', 'What we fund', 'Treasury', 'Decisions'])
    expect(within(sheet as HTMLElement).queryByRole('link', { name: 'Members' })).toBeNull()
    // a followed link closes it; so does Esc, focus back on Menu
    fireEvent.click(sheet.querySelector('a')!)
    expect(details.open).toBe(false)
    fireEvent.click(menu)
    fireEvent.keyDown(sheet, { key: 'Escape' })
    expect(details.open).toBe(false)
    expect(document.activeElement).toBe(menu)
  })

  it('names the Hub’s sign-in at its own origin, and leaves Members out when the portal has no members’ side (L9)', () => {
    const { unmount } = portal({ ...PORTAL_PUBLIC, membersOrigin: 'https://hub.example.org/' })
    expect(screen.getByRole('link', { name: 'Members' }).getAttribute('href')).toBe('https://hub.example.org/sign-in')
    unmount()
    portal({ ...PORTAL_PUBLIC, membersOrigin: null })
    expect(screen.queryByRole('link', { name: 'Members' })).toBeNull()
  })
})

describe('the hero (§12.2)', () => {
  it('the H1 holds one <em>, the moss phrase; facts are figure over label', () => {
    portal()
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe('Seeds and tools, shared along the river.')
    expect([...h1.querySelectorAll('em')].map(e => e.textContent)).toEqual(['shared along the river.'])
    expect(rule('.portal-h1 em')).toMatch(/font-style: italic; color: var\(--accent\)/)
    expect(document.querySelector('.portal-eyebrow')!.textContent).toBe('A growers’ cooperative · since 2024')
    const facts = [...document.querySelectorAll('.portal-hero .portal-fact')].map(f => [f.firstElementChild!.className, f.firstElementChild!.textContent, f.lastElementChild!.textContent])
    expect(facts).toEqual([
      ['portal-fact-f', '4 of 8', 'signers move funds'], ['portal-fact-f', '7', 'chains, one treasury'], ['portal-fact-f', '2', 'grant pools'],
    ])
    expect(rule('.portal-fact')).toContain('display: grid')
    expect(rule('.portal-fact-f')).toMatch(/var\(--fs-d-fact\)\/var\(--lh-ui\) var\(--display\)/)
  })

  it('two columns 1.25 : 1, bottom-aligned; one under 900px', () => {
    expect(rule('.portal-hero')).toMatch(/grid-template-columns: minmax\(0, 1\.25fr\) minmax\(0, 1fr\);[^}]*align-items: end/)
    expect(rule('.portal-hero', narrow)).toContain('grid-template-columns: minmax(0, 1fr)')
  })
})

describe('the map plate (§12.3)', () => {
  it('"How the DAO is arranged", "Read from its own records · 4 min ago"; nodes are links to the sections that show them', async () => {
    portal()
    const plate = section('How the DAO is arranged')
    expect(plate.querySelector('.portal-eyebrow')!.textContent).toBe('Read from its own records · 4 min ago')
    expect(plate.querySelector('time[data-volatile]')).not.toBeNull()
    await drawn()
    const links = [...plate.querySelectorAll<HTMLAnchorElement>('a.hnode')]
    expect(links.map(a => a.getAttribute('href')).sort()).toEqual(
      PORTAL_PUBLIC.map.items.flatMap(d => (d.href ? [d.href] : [])).sort())
    expect(links.find(a => a.getAttribute('href') === '#treasury')!.getAttribute('aria-label')).toMatch(/^Treasury, Safe/)
    // the linked Systems with no section are words, not controls
    expect(within(plate).queryByRole('link', { name: /^Karma GAP/ })).toBeNull()
    expect(rule('.portal-plate')).toMatch(/background: var\(--raised\);[^}]*border-radius: var\(--radius-plate\); box-shadow: var\(--shadow-raise\)/)
  })

  it('no attention, staged or draft state, even when the nodes carry them (C-32)', async () => {
    const lit = MAP_NODES.map((d, i) => ({ ...d, href: '#who', states: i === 0 ? [...d.states, 'draft' as const] : d.states }))
    expect(lit.some(d => d.states.includes('staged'))).toBe(true)
    expect(lit.some(d => d.need)).toBe(true)
    portal({ ...PORTAL_PUBLIC, map: { ...PORTAL_PUBLIC.map, items: lit } })
    await drawn()
    const plate = section('How the DAO is arranged')
    expect(plate.querySelectorAll('.is-needs, .is-staged, .is-draft, .hnode-dot, .hnode-tag')).toHaveLength(0)
    expect(plate.textContent).not.toMatch(/needs you|staged|not deployed/i)
  })
})

describe('the sections (§12.4)', () => {
  it('a 240px sticky label column (number in Mono, the name), leads 34em at most, sections --sp-17 above and --sp-15 below', () => {
    portal()
    const labels = [...document.querySelectorAll('.portal-sec')].map(s => [s.id, s.querySelector('.portal-sec-no')!.textContent, s.querySelector('h2')!.textContent])
    expect(labels).toEqual([['who', '01', 'Who holds what'], ['fund', '02', 'What we fund'], ['treasury', '03', 'Treasury'], ['decisions', '04', 'Decisions'], ['writing', '05', 'Writing']])
    expect(rule('.portal-sec')).toMatch(/grid-template-columns: var\(--w-portal-label\) minmax\(0, 1fr\);[^}]*padding-block: var\(--sp-17\) var\(--sp-15\)/)
    expect(house).toMatch(/--w-portal-label: 240px;/)
    expect(rule('.portal-sec-l')).toMatch(/position: sticky; inset-block-start: var\(--sp-12\)/)
    expect(rule('.portal-lead')).toMatch(/max-inline-size: var\(--w-portal-lead\); font: var\(--fw-regular\) var\(--fs-d-lead\)\/var\(--lh-d-lead\) var\(--display\)/)
    expect(house).toMatch(/--w-portal-lead: 34em;/)
    expect(rule('.portal')).toMatch(/max-inline-size: var\(--w-portal\); margin-inline: auto; padding-inline: var\(--sp-13\)/)
    expect(rule('.portal', narrow)).toContain('padding-inline: var(--sp-10)')
    expect(rule('.portal-sec', narrow)).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(rule('.portal-sec-l', narrow)).toContain('position: static')
  })

  it('hats in Fraunces 18 indented by level, "open" for an empty hat; no wearer names', () => {
    portal()
    const who = section('Who holds what')
    const hats = [...who.querySelectorAll('.portal-hat')].map(li => [li.getAttribute('data-level'), li.querySelector('.portal-hat-n')!.textContent, li.querySelector('.portal-hat-l')!.textContent])
    expect(hats.slice(0, 4)).toEqual([['0', 'Steward Council', '5 wear it'], ['1', 'Treasury signer', '8 wear it'], ['0', 'Operations', '1 wears it'], ['1', 'Finance', '1 wears it']])
    expect(hats.find(h => h[1] === 'Regional coordinator')![2]).toBe('open')
    expect(rule('.portal-hat-n')).toMatch(/font: var\(--fw-regular\) var\(--fs-d-hat\)\/var\(--lh-d-row\) var\(--display\)/)
    expect(house).toMatch(/--fs-d-hat: 1\.125rem;/)
    expect(rule('.portal-hat[data-level="1"] .portal-hat-n')).toContain('padding-inline-start: var(--sp-12)')
    expect(who.textContent).not.toMatch(/0x[0-9a-f]{4}/i)
    for (const a of TREASURY_SIGNERS) expect(document.body.innerHTML).not.toContain(a)
    expect(who.textContent).not.toMatch(/Steward [AB]|Council steward|Ops lead|Treasury steward/)
  })

  it('pool cards: the balance figure and the unit in Mono, the purpose, the address chip; the open-decisions note', () => {
    portal()
    const fund = section('What we fund')
    const cards = [...fund.querySelectorAll('.portal-pool')]
    expect(cards.map(c => [c.querySelector('.portal-eyebrow')!.textContent, c.querySelector('h3')!.textContent, c.querySelector('.amt-v')!.textContent,
      c.querySelector('.amt-u')!.textContent!.trim(), c.querySelector('.portal-pool-p')!.textContent])).toEqual([
      ['Grant pool · Celo', 'Network Projects', '1,271', 'USDGLO', 'Work that serves the whole network'],
      ['Grant pool · Celo', 'Local Starter', '3,100', 'USDGLO', 'Seed funding for new local nodes'],
    ])
    expect(within(cards[0] as HTMLElement).getByRole('button', { name: /^Copy address 0x/ })).toBeTruthy()
    expect(rule('.portal-fig .amt-u')).toMatch(/var\(--mono\)/)
    expect(rule('.portal-fig .amt-v')).toMatch(/var\(--fs-d-fig\)\/var\(--lh-ui\) var\(--display\)/)
    expect(rule('.portal-card')).toContain('border-radius: var(--radius-portal-card)')
    expect(house).toMatch(/--radius-portal-card: 18px;/)
    const note = fund.querySelector('.portal-note')!
    expect(note.querySelector('.portal-pill')!.textContent).toBe('Open')
    expect(note.textContent).toBe('OpenThe Council is considering returning both pools to the treasury — DR-2026-010.')
  })

  it('treasury: signer dots, filled for the threshold, "Any 4 of 8", the full address in Mono, chain chips, "balances read 4 min ago"', () => {
    portal()
    const t = section('Treasury')
    const dots = t.querySelector('.portal-dots')!
    expect(dots.getAttribute('aria-label')).toBe('4 of 8 signatures needed')
    expect(dots.querySelectorAll('.portal-dot')).toHaveLength(8)
    expect(dots.querySelectorAll('.portal-dot.is-on')).toHaveLength(4)
    expect(within(t).getByRole('heading', { level: 3, name: 'Any 4 of 8' })).toBeTruthy()
    expect(t.textContent).toContain('Signers are whoever wears the Treasury signer hat.')
    const addr = t.querySelector('.addr-full')!
    expect(addr.textContent).toBe(SAFE)
    expect([...t.querySelectorAll('.chain-list .chain')].map(c => c.textContent)).toEqual(['Ethereum', 'Optimism', 'Arbitrum', 'Gnosis', 'Polygon', 'Base', 'Celo'])
    expect(t.querySelector('.portal-age')!.textContent).toBe('balances read 4 min ago')
    expect(rule('.portal-dot')).toMatch(/inline-size: var\(--w-portal-dot\);[^}]*border: var\(--w-portal-dot-ring\) solid var\(--accent\)/)
    expect(rule('.portal-dot.is-on')).toContain('background: var(--accent)')
    expect(house).toMatch(/--w-portal-dot: 20px;/)
  })

  it('decisions ledger: id Mono faint, title Fraunces 19, route and date, state pill (Executed in moss soft)', () => {
    portal()
    const d = section('Decisions')
    const rows = [...d.querySelectorAll('.portal-row')].map(r => [r.querySelector('.portal-row-id')!.textContent, r.querySelector('.portal-row-t')!.textContent,
      r.querySelector('.portal-row-s')!.textContent, r.querySelector('.portal-pill')!.textContent, r.querySelector('.portal-pill')!.className])
    expect(rows).toEqual([
      ['DR-2026-010', 'Return the Gardens pools to the treasury', 'Council · route T3 · opened 28 Sep 2026', 'Open', 'portal-pill'],
      ['DR-2026-011', 'Return the G$ to the treasury', 'Council · route T2 · executed 8 Oct 2026', 'Executed', 'portal-pill is-done'],
      ['DR-2026-009', 'A change to a restricted collection', 'Ops lead · route T1 · decided 14 Sep 2026', 'Decided', 'portal-pill'],
    ])
    expect(d.textContent).not.toContain('stipends') // the members-level decision is not on the portal
    expect(rule('.portal-row-id')).toMatch(/var\(--mono\);[^}]*color: var\(--faint\)/)
    expect(rule('.portal-row')).toContain('grid-template-columns: var(--w-portal-id) minmax(0, 1fr) auto')
    expect(rule('.portal-row-t')).toMatch(/var\(--fs-d-row\)\/var\(--lh-d-row\) var\(--display\)/)
    expect(house).toMatch(/--fs-d-row: 1\.1875rem;/)
    expect(rule('.portal-pill.is-done')).toMatch(/background: var\(--accent-soft\); color: var\(--accent\)/)
  })

  it('writing: the published pages as a ledger of titles and dates', () => {
    portal()
    const w = section('Writing')
    expect([...w.querySelectorAll('.portal-row')].map(r => [r.querySelector('a')!.textContent, r.querySelector('time')!.textContent]))
      .toEqual([['How the treasury is signed', '2 Oct 2026'], ['The spring call for local nodes: what was funded', '21 Sep 2026']])
  })
})

describe('members only (§6.3)', () => {
  it('reveals nothing: a lock glyph and "Members only", no title, kind or count', () => {
    const { container } = render(<MembersOnly />)
    const slot = container.firstElementChild!
    expect(slot.textContent).toBe('Members only')
    expect(slot.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    expect(slot.querySelectorAll('*:not(svg):not(svg *)')).toHaveLength(0)
    expect(MembersOnly.length).toBe(0) // it takes nothing it could show
  })
})

describe('the foot (§12.5)', () => {
  it('"Also on …", the daoURI with "EIP-4824", "A DAO-OS Hub"', () => {
    portal()
    const foot = screen.getByRole('contentinfo')
    const lines = [...foot.querySelectorAll('.portal-foot-p')].map(p => p.textContent)
    expect(lines).toEqual(['Also on Snapshot · Karma GAP · Gitcoin', 'daoURI https://door.example.org/.well-known/dao.json · EIP-4824', 'A DAO-OS Hub'])
    expect(within(foot).getByRole('link', { name: 'Snapshot' }).getAttribute('href')).toBe('https://snapshot.box/#/s:exampledao.eth')
    expect(foot.querySelector('.portal-uri')!.getAttribute('href')).toBe('https://door.example.org/.well-known/dao.json')
    expect(rule('.portal-uri')).toContain('font-family: var(--mono)')
  })

  it('no daoURI line without one', () => {
    const { daoUri: _, ...model } = PORTAL_PUBLIC
    portal(model)
    expect(screen.getByRole('contentinfo').textContent).not.toContain('EIP-4824')
  })
})

describe('the portal as a whole', () => {
  it('says "Hub", never "house": in its words, its accessible names and its title (Q66, E-28)', async () => {
    renderAt(<App />, '/portal')
    await drawn()
    const named = [...document.querySelectorAll('[aria-label], [title], [alt]')].map(e => `${e.getAttribute('aria-label')} ${e.getAttribute('title')} ${e.getAttribute('alt')}`)
    expect(`${document.body.textContent} ${named.join(' ')} ${document.title}`).not.toMatch(/house/i)
    expect(document.title).toBe('Example DAO')
  })

  it('follows the system’s light/dark: it clears a stored data-theme while mounted, without storing, and restores it on leaving (C-29); no theme toggle', () => {
    localStorage.setItem('org-os-admin.theme', 'dark')
    document.documentElement.dataset.theme = 'dark'
    const set = vi.spyOn(Storage.prototype, 'setItem')
    const { unmount } = portal()
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(set).not.toHaveBeenCalled()
    expect(localStorage.getItem('org-os-admin.theme')).toBe('dark')
    expect(screen.queryByRole('button', { name: /theme|dark|light|appearance/i })).toBeNull()
    unmount()
    expect(document.documentElement.dataset.theme).toBe('dark')
    localStorage.removeItem('org-os-admin.theme')
  })

  // B4 (fix wave): /portal stands outside the Hub's frame, so it mounts its own live region — a copy is said to someone.
  it('says a copy out loud, through the portal’s own live region (4.1.3)', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true })
    try {
      // the portal alone, as the app draws it: no frame, and so no Hub provider with its region
      const loc = memoryLocation({ path: '/portal', record: true })
      render(<Router hook={loc.hook} searchHook={loc.searchHook}><App /></Router>)
      await drawn()
      fireEvent.click(screen.getAllByRole('button', { name: /^Copy address / })[0]!)
      await waitFor(() => expect(screen.getByTestId('live').textContent).toMatch(/^Copied 0x/))
    } finally { Reflect.deleteProperty(navigator, 'clipboard') }
  })

  it('/portal shows no write control, no frame and no tray, and says its values are fixtures', async () => {
    renderAt(<App />, '/portal')
    await drawn()
    expect(document.querySelectorAll('input, textarea, select, form, [contenteditable]')).toHaveLength(0)
    const buttons = screen.getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent)
    for (const name of buttons) expect(name, `a control on the portal: ${name}`).toMatch(/^(Copy address .+|Fit to view)$/)
    expect(screen.queryByRole('region', { name: 'Changes' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Hub' })).toBeNull()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByText(/^Sample values: this portal is drawn from fixtures\./)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Skip to the portal' }).getAttribute('href')).toBe('#portal-main')
  })
})
