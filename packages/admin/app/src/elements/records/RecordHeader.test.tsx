// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import type { DriverRead } from '../../../../server/systems/driver.ts'
import { renderAt } from '../../test/render.tsx'
import { ViewAsProvider } from '../../viewAs/ViewAs.tsx'
import { Button } from '../../design/Button.tsx'
import { SAFE, SAFE_CHAINS } from '../../test/fixtures/house/org.ts'
import { RecordHeader } from './RecordHeader.tsx'

const NOW = new Date('2026-10-29T12:00:00Z')
const CHAINS = [...SAFE_CHAINS]
const read = (over: Partial<DriverRead> = {}): DriverRead =>
  ({ ok: true, state: 'fresh', readAt: new Date(NOW.getTime() - 4 * 60_000).toISOString(), facts: {}, sections: [], open: null, ...over })

function system(over: Partial<Parameters<typeof RecordHeader>[0] & { variant: 'system' }> = {}) {
  return (
    <RecordHeader variant="system" kind="safe" name="Treasury" chain={CHAINS} address={SAFE} governs="4 of 8 signers"
      read={read()} now={NOW} onReadNow={() => {}} open={{ label: 'Open in Safe', href: `https://app.safe.global/home?safe=eth:${SAFE}` }} {...over} />
  )
}

function proposal() {
  return (
    <RecordHeader variant="record" kind="proposal" id="DR-2026-010" title="Return the Gardens pools to the treasury"
      state="needs" stateWord="Needs your approval" route="T3 · Council consent" visibility={{ level: 'members' }}
      meta={['Opened 28 Sep 2026 under the steward hat', 'closes 3 Nov']}
      presence={[{ handle: 'ops-lead', role: 'Ops lead' }, { handle: 'treasury-steward', role: 'Treasury steward', editing: true }]}
      primary={<Button primary>Approve</Button>} secondary={[<Button key="o">Object</Button>, <Button key="c" variant="ghost" icon="comment">Comment</Button>]}
      more={[{ type: 'item', label: 'Copy link', onSelect: () => {} }]} />
  )
}

describe('RecordHeader · a System', () => {
  it('draws the 40px kind tile, the eyebrow, the title and the facts line: chain chip, address chip, what governs, read age', () => {
    const { container } = renderAt(system())
    expect(container.querySelector('.ktile.ktile-header')).not.toBeNull()
    expect(container.querySelector('.rh-eyebrow')!.textContent).toBe('Safe · System')
    const h1 = screen.getByRole('heading', { level: 1, name: 'Treasury' })
    expect(h1.className).toBe('rh-title')
    const facts = container.querySelector<HTMLElement>('.rh-facts')!
    expect(within(facts).getByRole('button', { name: '7 chains' })).toBeTruthy()
    expect(within(facts).getByRole('button', { name: 'Copy address 0x6AFF…343a' })).toBeTruthy()
    expect(within(facts).getByText('4 of 8 signers')).toBeTruthy()
    expect(facts.querySelector('time.age')!.textContent).toBe('read 4 min ago')
  })

  it('says its read once when the from mark is its own read: no second read age beside it (walk 2026-11-04, L4c-fix 7)', () => {
    const failed = read({ ok: false, state: 'failed', readAt: null, error: 'safe service answered 503' })
    const { container } = renderAt(system({ name: 'Reserve', read: failed, from: { system: 'Reserve', read: failed } }))
    const facts = container.querySelector<HTMLElement>('.rh-facts')!
    expect(facts.querySelectorAll('.age').length).toBe(1)
    expect(facts.querySelector('.from')).not.toBeNull()
    expect((facts.textContent!.match(/couldn’t read/g) ?? []).length).toBe(1)
  })

  it('Read now is an icon button named "Read now"; the System’s own link names a new tab', () => {
    const onReadNow = vi.fn()
    const { container } = renderAt(system({ onReadNow }))
    const now = screen.getByRole('button', { name: 'Read now' })
    expect(now.className).toContain('icon')
    fireEvent.click(now)
    expect(onReadNow).toHaveBeenCalledOnce()
    const open = screen.getByRole('link', { name: 'Open in Safe (opens in a new tab)' })
    expect(open.getAttribute('target')).toBe('_blank')
    expect(open.getAttribute('href')).toBe(`https://app.safe.global/home?safe=eth:${SAFE}`)
    expect(container.querySelector('.rh-acts')!.contains(open)).toBe(true)
  })

  it('says a failed read with its last good time, and a read not made yet as "not read yet"', () => {
    const lastGood = new Date(NOW.getTime() - 2 * 3_600_000).toISOString()
    const { container, rerender } = renderAt(system({ read: read({ ok: false, state: 'failed', error: 'timeout', readAt: lastGood }) }))
    expect(container.querySelector('.age')!.textContent).toBe('couldn’t read · last 2 h ago')
    rerender(system({ read: null }))
    expect(container.querySelector('.age')!.textContent).toBe('not read yet')
  })

  it('draws no Read now without a reader, and keeps reading (not a write) while previewing', () => {
    const { rerender } = renderAt(system({ onReadNow: undefined }))
    expect(screen.queryByRole('button', { name: 'Read now' })).toBeNull()
    rerender(<ViewAsProvider initial={{ as: 'members' }}>{system()}</ViewAsProvider>)
    expect(screen.getByRole('button', { name: 'Read now' })).toBeTruthy()
  })
})

describe('RecordHeader · a record', () => {
  it('tops the title with the id in Mono, the state mark, the route pill and the visibility marker', () => {
    const { container } = renderAt(proposal())
    const top = container.querySelector<HTMLElement>('.rh-top')!
    expect(top.querySelector('.rh-id')!.textContent).toBe('DR-2026-010')
    expect(within(top).getByText('Needs your approval').closest('.smark-needs')).not.toBeNull()
    expect(top.querySelector('.rh-route')!.textContent).toBe('T3 · Council consent')
    expect(top.querySelector('.vis')!.textContent).toBe('Members')
    expect(screen.getByRole('heading', { level: 1, name: 'Return the Gardens pools to the treasury' }).className).toBe('rh-title')
  })

  it('lays the meta out in order with the presence after it', () => {
    const { container } = renderAt(proposal())
    const meta = container.querySelector<HTMLElement>('.rh-meta')!
    expect([...meta.querySelectorAll('.rh-m:not(.rh-pres)')].map(m => m.textContent)).toEqual(['Opened 28 Sep 2026 under the steward hat', 'closes 3 Nov'])
    expect(within(meta).getByRole('img', { name: 'Ops lead is reading; Treasury steward is editing' })).toBeTruthy()
  })

  it('has exactly one primary, its secondary actions, and More as a menu', () => {
    const { container } = renderAt(proposal())
    const acts = container.querySelector<HTMLElement>('.rh-acts')!
    expect(acts.querySelectorAll('.btn.primary')).toHaveLength(1)
    expect(within(acts).getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(within(acts).getByRole('button', { name: 'Object' })).toBeTruthy()
    expect(within(acts).getByRole('button', { name: 'Comment' })).toBeTruthy()
    const more = within(acts).getByRole('button', { name: 'More actions' })
    expect(more.getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.click(more)
    expect(screen.getByRole('menuitem', { name: 'Copy link' })).toBeTruthy()
  })

  it('previewing (no writes) renders no primary, no secondary and no More', () => {
    const { container } = renderAt(<ViewAsProvider initial={{ as: 'members' }}>{proposal()}</ViewAsProvider>)
    expect(container.querySelector('.rh-acts')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Return the Gardens pools to the treasury' })).toBeTruthy()
  })
})
