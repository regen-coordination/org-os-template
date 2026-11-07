// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { screen, within } from '@testing-library/react'
import { renderAt } from '../../test/render.tsx'
import { fetchRoutes } from '../../test/fetchRoutes.ts'
import { MARK_WORD } from '../../design/StatusMark.tsx'
import Atoms from './Atoms.tsx'
import { PARTS_GROUPS, NotDrawn } from './index.ts'

const partsCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'design', 'css', 'parts.css'), 'utf8')

describe('/parts/atoms', () => {
  it('is drawn: the group’s component, not the note', () => {
    expect(PARTS_GROUPS.find(g => g.id === 'atoms')!.Component).not.toBe(NotDrawn)
  })

  it('lays the cards out in the gallery’s order: the chain atoms, status, read age, visibility, mention, presence, then the meter', () => {
    renderAt(<Atoms />, '/parts/atoms')
    const caps = [...document.querySelectorAll('.pg-card > .pg-cap')].map(h => h.textContent)
    expect(caps.slice(0, 9)).toEqual(['Address chip · copy on click, CAIP-10 underneath', 'Chain chip · neutral, never a logo', 'Amount',
      'Status · shape + word', 'Read age · fresh, aged, failed', 'Visibility marker', 'Mention', 'Presence · who else has it open', 'Meter · approvals and signatures'])
  })

  it('draws the visibility marker: public, members, a hat, as a control, a widening staged, and a restricted field', () => {
    renderAt(<Atoms />, '/parts/atoms')
    const card = screen.getByRole('region', { name: 'Visibility marker' })
    expect([...card.querySelectorAll('.pg-state > .pg-cap')].map(c => c.textContent)).toEqual(['public', 'members', 'a hat', 'as control', 'widening staged', 'field'])
    expect([...card.querySelectorAll('.pg-state .vis')].map(v => v.textContent)).toEqual(['Public', 'Members', 'Hat: Ops', 'Members', 'Members → Public, proposed', 'Ops only'])
    const controls = within(card).getAllByRole('button')
    // the widening staged is the marker, as the gallery draws it (L4a final review M-9): one control, for "as control"
    expect(controls.map(b => b.getAttribute('aria-haspopup'))).toEqual(['menu'])
    expect(card.querySelector('.vis-to')!.textContent).toBe('Public, proposed')
    expect(card.querySelector('.vis-field')).not.toBeNull()
  })

  it('draws the address chip in the gallery’s six states, each a real chip', () => {
    renderAt(<Atoms />, '/parts/atoms')
    const card = screen.getByRole('region', { name: 'Address chip · copy on click, CAIP-10 underneath' })
    expect([...card.querySelectorAll('.pg-state > .pg-cap')].map(c => c.textContent)).toEqual(['default', 'hover', 'copied', 'named', 'full', 'warn'])
    const chips = within(card).getAllByRole('button')
    expect(chips.map(b => b.getAttribute('aria-label'))).toEqual(['Copy address 0x6AFF…343a', 'Copy address 0x5d0b…8a5c', 'Copy address 0xeb52…f20c',
      'Copy address exampledao.eth', 'Copy address 0x6AFFe5105DE869fE4A27b3353468eFb51a55343a', 'Copy address 0x0000…0000'])
    expect(chips[0]!.getAttribute('title')).toBe('eip155:42220:0x6AFFe5105DE869fE4A27b3353468eFb51a55343a')
    expect(card.querySelector('.pg-hover .addr')).not.toBeNull()
    expect(partsCss).toMatch(/\.pg-hover \.addr \{ background: var\(--wash-strong\); \}/) // drawn hovered, as the gallery's is
    expect(chips[2]!.hasAttribute('data-copied')).toBe(true)
    expect(chips[5]!.classList.contains('addr-warn')).toBe(true)
  })

  it('draws the chain chip: one, several, test network, disagree, and the list the several opens', () => {
    renderAt(<Atoms />, '/parts/atoms')
    const card = screen.getByRole('region', { name: 'Chain chip · neutral, never a logo' })
    expect([...card.querySelectorAll('.pg-state > .pg-cap')].map(c => c.textContent)).toEqual(['one', 'several', 'test network', 'disagree', 'list'])
    expect([...card.querySelectorAll('.pg-state > .chain, .pg-state > .chain-wrap > .chain')].map(c => c.textContent)).toEqual(['Celo', '7 chains', 'Sepolia · test', '6 of 7 agree'])
    expect([...card.querySelectorAll('.pg-state > .chain-list > [role="listitem"]')].map(c => c.textContent)).toEqual(['Ethereum', 'Optimism', 'Arbitrum', 'Gnosis', 'Polygon', 'Base', 'Celo'])
  })

  it('draws the amounts: row, body, outgoing, an old read, not read, large', () => {
    renderAt(<Atoms />, '/parts/atoms')
    const card = screen.getByRole('region', { name: 'Amount' })
    expect([...card.querySelectorAll('.pg-state > .pg-cap')].map(c => c.textContent)).toEqual(['row', 'body', 'outgoing', 'from an old read', 'not read', 'large'])
    expect([...card.querySelectorAll('.amt')].map(a => a.textContent)).toEqual(['1,271.00\u00a0USDGLO', '27,561,390.98\u00a0G$', '−1,829.00\u00a0USDGLO',
      '3,100.00\u00a0USDGLO', '—\u00a0not read yet', '3,100\u00a0USDGLO'])
  })

  it('draws the read ages from the fixtures’ clock: unknown, reading, fresh, aged, failed', () => {
    renderAt(<Atoms />, '/parts/atoms')
    const card = screen.getByRole('region', { name: 'Read age · fresh, aged, failed' })
    expect([...card.querySelectorAll('.pg-state > .pg-cap')].map(c => c.textContent)).toEqual(['unknown', 'reading', 'fresh', 'aged', 'failed'])
    expect([...card.querySelectorAll('.age')].map(a => a.textContent)).toEqual(['not read yet', 'reading…', 'read 4\u00a0min ago', 'read 38\u00a0min ago', 'couldn’t read · last 2\u00a0h ago'])
  })

  it('draws every mark as a shape and a word, as the gallery’s status card does', () => {
    renderAt(<Atoms />, '/parts/atoms')
    const card = screen.getByRole('region', { name: 'Status · shape + word' })
    const marks = [...card.querySelectorAll('.smark')]
    const kinds = new Set(marks.map(m => [...m.classList].find(c => c.startsWith('smark-'))!.slice('smark-'.length)))
    expect([...kinds].sort()).toEqual(Object.keys(MARK_WORD).sort())
    for (const m of marks) expect(m.querySelector('.smark-shape')!.getAttribute('aria-hidden')).toBe('true')
    for (const word of ['Needs you', 'Staged', 'Changed since staged', 'Not yet deployed', 'Open', 'Up to date', 'Decided', 'Withdrawn', 'Reading…', 'Couldn’t read', 'Old read', 'Executed']) {
      expect(within(card).getByText(word)).toBeTruthy()
    }
  })

  it('draws the mentions: a person, you, a record, a page, each a link; and one that can’t be seen, which is not', () => {
    renderAt(<Atoms />, '/parts/atoms')
    const card = screen.getByRole('region', { name: 'Mention' })
    expect([...card.querySelectorAll('.pg-state > .pg-cap')].map(c => c.textContent)).toEqual(['person', 'you', 'record', 'page', 'can’t be seen'])
    const links = within(card).getAllByRole('link')
    expect(links.map(a => a.textContent)).toEqual(['@Ops lead', '@Council steward', 'DR-2026-010', 'How the treasury is run'])
    expect(links.map(a => a.getAttribute('href'))).toEqual(['/r/member/ops-lead', '/r/member/council-steward', '/governance/proposals/DR-2026-010', '/r/page/how-the-treasury-is-run'])
    expect(links[1]!.classList.contains('mention-you')).toBe(true)
    expect(card.querySelector('.mention-gone')!.textContent).toBe('Members only')
  })

  it('draws presence from the fixture people: one, editing, several (three and "+2"), and who you are signed in as', () => {
    renderAt(<Atoms />, '/parts/atoms')
    const card = screen.getByRole('region', { name: 'Presence · who else has it open' })
    expect([...card.querySelectorAll('.pg-state > .pg-cap')].map(c => c.textContent)).toEqual(['one', 'editing', 'several', 'signed-in as'])
    const who = card.querySelector('.pg-state:last-child .who')!
    expect(who.querySelector('.hatmark')).not.toBeNull()
    expect(who.querySelector('.who-t')!.textContent).toBe('Council steward')
    expect(who.querySelector('.who-s')!.textContent).toMatch(/^0x[0-9a-f]{4}…[0-9a-f]{4}$/)
    const stacks = within(card).getAllByRole('img')
    expect(stacks.map(s => s.getAttribute('aria-label'))).toEqual(['Ops lead is reading', 'Steward A is editing',
      'Steward A is reading; Ops lead is reading; Treasury steward is reading; Steward B is reading; Council steward is reading'])
    expect(stacks.map(s => [...s.querySelectorAll('.av')].map(a => a.textContent))).toEqual([['OL'], ['SA'], ['SA', 'OL', 'TS', '+2']])
    expect(stacks[1]!.querySelector('.av-pen')).not.toBeNull()
  })

  it('draws the meters: waiting, yours in it, met, and over 12 as a bar', () => {
    renderAt(<Atoms />, '/parts/atoms')
    const card = screen.getByRole('region', { name: 'Meter · approvals and signatures' })
    for (const words of ['2 of 4 approved', '3 of 4 · you approved', '4 of 4 signed', '31 of 50 voted']) expect(within(card).getByText(words)).toBeTruthy()
    expect(card.querySelectorAll('.meter > i.you')).toHaveLength(1)
    expect(card.querySelector('.meter.bar')).not.toBeNull()
  })

  it('draws kind tiles at the three sizes and in the two tones', () => {
    renderAt(<Atoms />, '/parts/atoms')
    const card = screen.getByRole('region', { name: 'Kind tile · row, Needs you, header' })
    for (const c of ['ktile-row', 'ktile-needs', 'ktile-header', 'ktile-attn', 'ktile-moss']) expect(card.querySelector(`.${c}`), c).not.toBeNull()
  })

  it('draws skeleton rows as busy regions, each named for what it loads', () => {
    renderAt(<Atoms />, '/parts/atoms')
    const card = screen.getByRole('region', { name: 'Loading · first load only' })
    const busy = within(card).getAllByRole('region').filter(r => r.getAttribute('aria-busy') === 'true')
    expect(busy.length).toBeGreaterThanOrEqual(3)
    for (const r of busy) expect(r.getAttribute('aria-label')).toMatch(/^Loading /)
    expect(within(card).getByText('Reading…')).toBeTruthy() // the spinner with its word
  })

  it('reads nothing from the network', () => {
    const { calls } = fetchRoutes({})
    renderAt(<Atoms />, '/parts/atoms')
    expect(calls).toEqual([])
  })
})
