// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import * as DriverModule from './DriverView.tsx'
import { DriverView, safeHref } from './DriverView.tsx'
import type { DriverRead } from '../api.ts'
import { renderAt } from '../test/render.tsx'
import { resource } from '../test/data.ts'
import { FIXED_NOW } from '../test/fixtures/parts.ts'
import { fakeAddress } from '../elements/atoms/chain.ts'

const CELO = 'eip155:42220'
const SIGNER = fakeAddress(1)
const HAT = 'eip155:42220:0x0000000d00010000000000000000000000000000000000000000000000000000'
const minutesAgo = (n: number) => new Date(FIXED_NOW.getTime() - n * 60_000).toISOString()
const safeRead = (over: Partial<DriverRead> = {}): DriverRead => ({
  ok: true, state: 'fresh', readAt: minutesAgo(4), facts: { threshold: 2 }, open: { url: 'https://app.safe.global/home?safe=celo:0x967c', embeddable: false },
  sections: [
    { title: 'Waiting on signers', note: 'threshold 2 of 3', rows: [{ cells: ['#2', 'transfer 1,200 cUSD', '1 of 2 signatures', '3 days ago'], attention: 'alert',
      href: 'https://app.safe.global/transactions/tx?id=2' }] },
    { title: 'Balances', rows: [{ cells: ['cUSD', '4,310.00'] }, { cells: ['CELO', '212.40'] }] },
    { title: 'Signers', rows: [{ cells: [SIGNER, 'Steward A'], refs: [`${CELO}:${SIGNER}`, HAT] }] },
    { title: 'Chains', rows: [{ cells: ['Celo', '2 of 3', 'nonce 3', '1 waiting'], attention: 'warn', refs: [`${CELO}:${fakeAddress(2)}`] }] },
    { title: 'Executed', rows: [{ cells: ['#1', 'setup and first transfer', '2026-08-09'], href: 'https://app.safe.global/transactions/tx?id=1' }] },
  ], ...over,
})
const system = (driver: unknown) => resource({ id: 'system:treasury-safe', kind: 'system', name: 'Treasury Safe', facts: driver === undefined ? {} : { kind: 'safe', driver },
  source: { path: 'data/systems.yaml', editable: true, registry: 'systems', entityId: 'treasury-safe' } })
const view = (read: DriverRead | undefined) => renderAt(<DriverView resource={system(read)} now={FIXED_NOW} />)

describe('DriverView: the Systems’ reads in the house (§14.2)', () => {
  it('draws a section of label and value pairs as field rows, and any other as a table, each with its read age', () => {
    view(safeRead())
    const balances = screen.getByRole('region', { name: 'Balances' })
    const pairs = within(balances).getByRole('group', { name: 'Balances' })
    expect([...pairs.querySelectorAll('dt')].map(dt => dt.textContent)).toEqual(['cUSD', 'CELO'])
    expect(within(pairs).getByText('4,310.00').classList.contains('mono')).toBe(true)
    const waiting = screen.getByRole('region', { name: 'Waiting on signers' })
    expect(within(waiting).getByRole('table', { name: 'Waiting on signers' })).toBeTruthy()
    expect(within(waiting).getByText('threshold 2 of 3')).toBeTruthy()
    // a section names no columns, so its table has no head: nothing is announced by a made-up column name (C8 fix M-3)
    expect(within(waiting).queryAllByRole('columnheader')).toEqual([])
    expect(waiting.querySelector('thead')).toBeNull()
    for (const name of ['Balances', 'Waiting on signers', 'Signers', 'Chains', 'Executed']) {
      const age = screen.getByRole('region', { name }).querySelector('.sect-h time.age')!
      expect(age.textContent).toBe('read 4 min ago')
      expect(age.getAttribute('datetime')).toBe(minutesAgo(4))
    }
  })

  it('draws a row’s refs as address chips: the plain address copied, its CAIP-10 id in the title, never an explorer link', () => {
    const { container } = view(safeRead())
    const signers = screen.getByRole('region', { name: 'Signers' })
    const chip = within(signers).getByRole('button', { name: `Copy address ${SIGNER.slice(0, 6)}…${SIGNER.slice(-4)}` })
    expect(chip.getAttribute('title')).toBe(`${CELO}:${SIGNER}`)
    expect(within(signers).queryByText(SIGNER, { selector: '.clip' })).toBeNull() // the cell holding the address is the chip
    // a ref no cell shows (a chain row's Safe) gets its chip at the row's end
    const chains = screen.getByRole('region', { name: 'Chains' })
    expect(within(chains).getByRole('button', { name: /^Copy address 0x/ }).getAttribute('title')).toBe(`${CELO}:${fakeAddress(2)}`)
    // a hat ref is not an account: no chip for it
    const titles = [...container.querySelectorAll('.addr')].map(a => a.getAttribute('title'))
    expect(titles).toHaveLength(2)
    for (const t of titles) expect(t).toMatch(/^eip155:\d+:0x[0-9a-fA-F]{40}$/)
  })

  // Item 7 (fix wave): the driver's ages are the server's own words, from its real clock — they move every day, so
  // every cell that is one is marked for the route shots to mask, and a cell that is not an age is not.
  it('marks the server’s ages as volatile (a count of days off now), and nothing else', () => {
    const first = view(safeRead({ sections: [{ title: 'Waiting on signers', rows: [{ cells: ['#2', 'transfer 1,200 cUSD', '1 of 2 signatures', '12 d'] }] }] }))
    expect([...first.container.querySelectorAll('[data-volatile]')].map(c => c.textContent)).toEqual(['12 d'])
    // the server writes a shorter age in hours, and a long one in days; both are the same kind of label
    const second = view(safeRead({ sections: [{ title: 'Executed', rows: [{ cells: ['#1', 'setup and first transfer', '30 h', 'ok'] }] }] }))
    expect([...second.container.querySelectorAll('[data-volatile]')].map(c => c.textContent)).toEqual(['30 h'])
    // other words in a cell are not ages: a count, an amount, a nonce, a date nobody computed from now
    const third = view(safeRead({ sections: [{ title: 'Chains', rows: [{ cells: ['Celo', '2 of 3', '#12', '2026-08-09'] }] }] }))
    expect(third.container.querySelectorAll('[data-volatile]')).toHaveLength(0)
  })

  it('links nowhere: a row’s href is not drawn, so the System’s own "Open in …" stays the only link-out', () => {
    const { container } = view(safeRead())
    expect(container.querySelector('a')).toBeNull()
    expect(screen.getByText('setup and first transfer')).toBeTruthy()
  })

  it('carries the needs and failed marks on rows with attention, in words', () => {
    view(safeRead())
    const waiting = screen.getByRole('table', { name: 'Waiting on signers' })
    expect(waiting.querySelector('.smark-needs')!.textContent).toBe('Needs you')
    const chains = screen.getByRole('table', { name: 'Chains' })
    expect(chains.querySelector('.smark-failed')!.textContent).toBe('Needs a look')
    expect(screen.getByRole('table', { name: 'Executed' }).querySelector('.smark')).toBeNull()
  })

  it('renders cells as text, whatever they hold (Review Focus 3)', () => {
    const { container } = view(safeRead({ sections: [{ title: 'Executed', rows: [{ cells: ['<img src=x onerror=alert(1)>', 'x', 'y'], href: 'javascript:alert(1)' }] }] }))
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy()
  })

  it.each([
    ['https://app.safe.global/home', 'https://app.safe.global/home'],
    ['HTTP://x.org/a', 'HTTP://x.org/a'],
    ['//host/path', null],
    ['JAVASCRIPT:alert(1)', null],
    ['javascript:alert(1)', null],
    [' https://x', null],
    ['https:x', null],
    ['data:text/html,hi', null],
    ['', null],
    [null, null],
    [undefined, null],
  ])('opens only an absolute http(s) address: safeHref(%j) is %j (final 6)', (href, want) => {
    expect(safeHref(href)).toBe(want)
  })

  it('neither links nor embeds an open.url that is not http(s), even one marked embeddable (final 6)', () => {
    const { container } = view({ ok: true, readAt: minutesAgo(1), facts: {}, sections: [], open: { url: 'javascript:alert(1)', embeddable: true } })
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('says a failed read in a note, not an alert (E-67), and keeps the last good read with its failed age', () => {
    view(safeRead({ ok: false, state: 'failed', error: 'timed out after 8 s', readAt: minutesAgo(10) }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Couldn’t read: timed out after 8 s').closest('.note-error')).not.toBeNull()
    const balances = screen.getByRole('region', { name: 'Balances' })
    expect(balances.querySelector('.sect-h .age-failed')!.textContent).toBe('couldn’t read · last 10 min ago')
    expect(within(balances).getByText('4,310.00')).toBeTruthy()
  })

  it('says a first failed read with nothing to keep', () => {
    view({ ok: false, state: 'failed', readAt: null, error: 'HTTP 500', facts: {}, open: null, sections: [] })
    expect(screen.getByText('Couldn’t read: HTTP 500')).toBeTruthy()
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('clips a long cell, the whole text in its title', () => {
    const long = 'x'.repeat(2000)
    const { container } = view(safeRead({ sections: [{ title: 'Executed', rows: [{ cells: [long, '1', '2'] }] }] }))
    expect(container.querySelector('td .clip')!.getAttribute('title')).toBe(long)
  })

  it('says so when nothing has read the system yet', () => {
    view(undefined)
    expect(screen.getByRole('note').textContent).toBe('Nothing has read this system yet: its driver reports here once it does.')
  })

  it('says a section with no rows in one line', () => {
    view(safeRead({ sections: [{ title: 'Executed', note: 'the latest 0', rows: [] }] }))
    expect(within(screen.getByRole('region', { name: 'Executed' })).getByText('Nothing here.')).toBeTruthy()
  })

  it("shows a link system's address in Mono, embedded only when it says so and without privileges; its Open is the header's", () => {
    const link = (embeddable: boolean): DriverRead => ({ ok: true, readAt: minutesAgo(1), facts: {}, sections: [], open: { url: 'https://docs.example.org/handbook', embeddable } })
    const { container, unmount } = view(link(true))
    expect(screen.getByText('https://docs.example.org/handbook').className).toBe('mono')
    expect(container.querySelector('a')).toBeNull()
    const frame = container.querySelector('iframe')!
    expect(frame.className).toBe('drv-embed')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    unmount()
    expect(view(link(false)).container.querySelector('iframe')).toBeNull()
  })

  it('keeps no address helper or head of its own: chain.ts shortens addresses, the record header heads a System (E-68)', () => {
    expect(Object.keys(DriverModule).sort()).toEqual(['DriverView', 'driverOf', 'safeHref'])
  })
})
