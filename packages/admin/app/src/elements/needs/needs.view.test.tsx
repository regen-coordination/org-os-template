// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { renderAt } from '../../test/render.tsx'
import { ViewAsProvider } from '../../viewAs/ViewAs.tsx'
import type { Viewer } from '../../viewAs/visibility.ts'
import { Icon } from '../../design/Icon.tsx'
import { FIXED_NOW } from '../../test/fixtures/parts.ts'
import { ACTOR, NEEDS_SYSTEMS, PROPOSALS, PROPOSAL_RESOURCES } from '../../test/fixtures/house/governance.ts'
import { AttentionItem } from './AttentionItem.tsx'
import { NeedsList } from './NeedsList.tsx'
import { needsFrom, type NeedItem } from './needs.ts'
import { errorNote } from '../../test/notes.ts'

const NOW = FIXED_NOW
const ITEMS = needsFrom([...NEEDS_SYSTEMS, ...PROPOSAL_RESOURCES], PROPOSALS, ACTOR, NOW)
const item = (kind: NeedItem['kind'], youActed = false) => ITEMS.find(i => i.kind === kind && !!i.youActed === youActed)!
const LINE = '9 Systems read 4 min ago, none failing.'
const glyph = (name: Parameters<typeof Icon>[0]['name']) => renderAt(<Icon name={name} />).container.querySelector('svg')!.innerHTML

function draw(ui: ReactElement, viewer?: Viewer) {
  return renderAt(viewer ? <ViewAsProvider initial={viewer}>{ui}</ViewAsProvider> : ui)
}

describe('AttentionItem (§9.4)', () => {
  it('the row is one <a>: tile, title, meta (id, route, meter and words), trailing', () => {
    draw(<ul><li><AttentionItem item={item('proposal')} now={NOW} /></li></ul>)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    const row = links[0]!
    expect(row.tagName).toBe('A')
    expect(row.getAttribute('href')).toBe('/r/proposal/p-2026-10-17-001')
    expect(row.querySelector('.need-t')!.textContent).toBe('Return the Gardens pools to the treasury')
    const meta = row.querySelector('.need-s')!
    expect(meta.querySelector('.mono')!.textContent).toBe('p-2026-10-17-001')
    expect(meta.textContent).toContain('four Council stewards approve')
    expect(meta.querySelector('.meter')!.getAttribute('aria-hidden')).toBe('true')
    expect(meta.querySelector('.meter-l')!.textContent).toBe('2 of 4 approved')
    expect(row.querySelector('.need-end')!.textContent).toBe('Closes in 5 days')
    expect(row.querySelector('.need-end')!.classList.contains('need-late')).toBe(false)
    // nothing inside the link is interactive of its own
    expect(row.querySelectorAll('a, button')).toHaveLength(0)
  })

  it('the link-out row opens the Safe app in a new tab, and its name ends "(opens the Safe app in a new tab)"', () => {
    draw(<AttentionItem item={item('signature')} now={NOW} />)
    const row = screen.getByRole('link', { name: /\(opens the Safe app in a new tab\)$/ })
    expect(row.getAttribute('href')).toMatch(/^https:\/\/app\.safe\.global\//)
    expect(row.getAttribute('target')).toBe('_blank')
    expect(row.getAttribute('rel')).toContain('noopener')
    expect(row.querySelector('.need-end')!.textContent).toContain('Open in Safe')
    expect(row.querySelector('.need-s .meter-l')!.textContent).toBe('2 of 4 signed')
    expect(row.querySelector('.need-s .chain')!.textContent).toBe('Celo')
  })

  it('waiting on you has the attn tile with the need’s glyph', () => {
    draw(<AttentionItem item={item('signature')} now={NOW} />)
    const tile = screen.getByRole('link').querySelector('.ktile')!
    expect(tile.className).toBe('ktile ktile-needs ktile-attn')
    expect(tile.querySelector('svg')!.innerHTML).toBe(glyph('pen'))
  })

  it('waiting on others: a neutral tile with a check, the moss segment, "Waiting on others" trailing', () => {
    draw(<AttentionItem item={item('proposal', true)} now={NOW} />)
    const row = screen.getByRole('link')
    expect(row.classList.contains('need-others')).toBe(true)
    const tile = row.querySelector('.ktile')!
    expect(tile.className).toBe('ktile ktile-needs')
    expect(tile.querySelector('svg')!.innerHTML).toBe(glyph('check'))
    expect(row.querySelectorAll('.meter i.you')).toHaveLength(1)
    expect(row.querySelector('.meter-l')!.textContent).toBe('2 of 4 · you approved')
    expect(row.querySelector('.need-end')!.textContent).toBe('Waiting on others')
  })

  it('overdue: the clock, the closing past in clay', () => {
    draw(<AttentionItem item={item('overdue')} now={NOW} />)
    const row = screen.getByRole('link')
    expect(row.querySelector('.ktile svg')!.innerHTML).toBe(glyph('clock'))
    const end = row.querySelector('.need-end')!
    expect(end.textContent).toBe('Closed 2 days ago')
    expect(end.classList.contains('need-late')).toBe(true)
  })

  it('a failed read: the alert glyph, the chain, the last good read in clay; "Look"', () => {
    draw(<AttentionItem item={item('failed-read')} now={NOW} />)
    const row = screen.getByRole('link')
    expect(row.getAttribute('href')).toBe('/r/system/garden')
    expect(row.querySelector('.ktile svg')!.innerHTML).toBe(glyph('alert'))
    expect(row.querySelector('.need-s .chain')!.textContent).toBe('Celo')
    expect(row.querySelector('.need-ctx.need-failed')!.textContent).toBe('last good read 2 h ago')
    expect(row.querySelector('.need-end')!.textContent).toBe('Look')
  })

  it('chains that disagree: the clay chip "6 of 7 agree", not a button inside the link', () => {
    draw(<AttentionItem item={item('chains-disagree')} now={NOW} />)
    const row = screen.getByRole('link')
    const chip = row.querySelector('.need-s .chain')!
    expect(chip.tagName).toBe('SPAN')
    expect(chip.classList.contains('chain-split')).toBe(true)
    expect(chip.textContent).toBe('6 of 7 agree: Ethereum, Optimism, Arbitrum, Gnosis, Polygon, Base, Celo')
    expect(chip.querySelector('.sr-only')!.textContent).toBe(': Ethereum, Optimism, Arbitrum, Gnosis, Polygon, Base, Celo')
    expect(row.querySelector('.need-ctx')!.textContent).toBe('Gnosis lists 9 owners')
  })
})

describe('NeedsList (§9.4)', () => {
  it('draws the items as a list, in Needs you’s order', () => {
    draw(<NeedsList items={[...ITEMS].reverse()} systemsLine={LINE} now={NOW} />)
    const list = screen.getByRole('list', { name: 'Needs you' })
    expect(within(list).getAllByRole('listitem').map(li => li.querySelector('.need-t')!.textContent)).toEqual([
      'Close the spring call for local nodes', 'Return the Gardens pools to the treasury', '3 hats have no wearer', 'Sign nonce 18 on the Treasury',
      'The Treasury disagrees across chains', 'The Example DAO Garden couldn’t be read', 'Add a Treasury signer',
    ])
  })

  it('loading: two skeleton rows, busy and named', () => {
    draw(<NeedsList items={null} systemsLine={LINE} now={NOW} />)
    const region = screen.getByRole('region', { name: 'Loading Needs you' })
    expect(region.getAttribute('aria-busy')).toBe('true')
    expect(region.querySelectorAll('.skel-row-needs')).toHaveLength(2)
  })

  it('error: a note with Try again', () => {
    const onRetry = vi.fn()
    draw(<NeedsList items={null} error="Couldn’t work out what needs you." onRetry={onRetry} systemsLine={LINE} now={NOW} />)
    const note = errorNote()
    expect(note.textContent).toContain('Couldn’t work out what needs you.')
    fireEvent.click(within(note).getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('empty: "Nothing waits on you." and the Systems line in a dashed block', () => {
    draw(<NeedsList items={[]} systemsLine={LINE} now={NOW} />)
    const block = screen.getByText('Nothing waits on you.').closest('.note-block')!
    expect(block).not.toBeNull()
    expect(block.closest('.needs-empty')).not.toBeNull()
    expect(within(block as HTMLElement).getByText(LINE)).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('previewing drops the items the viewer may not see, with no gap; if none is left it is empty', () => {
    const hidden = { ...item('failed-read'), facts: { visibility: 'hat:treasury' } }
    const shown = { ...item('proposal'), facts: { visibility: 'members' } }
    draw(<NeedsList items={[hidden, shown]} systemsLine={LINE} now={NOW} />, { as: 'members' })
    expect(within(screen.getByRole('list', { name: 'Needs you' })).getAllByRole('listitem').map(li => li.textContent)).toHaveLength(1)
    expect(screen.queryByText(/couldn’t be read/)).toBeNull()
  })

  it('previewing with nothing left to see is the empty block', () => {
    const hidden = { ...item('failed-read'), facts: { visibility: 'hat:treasury' } }
    draw(<NeedsList items={[hidden]} systemsLine={LINE} now={NOW} />, { as: 'members' })
    expect(screen.getByText('Nothing waits on you.')).toBeTruthy()
  })
})
