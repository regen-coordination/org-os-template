// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { renderAt } from '../../test/render.tsx'
import { ViewAsProvider } from '../../viewAs/ViewAs.tsx'
import type { Viewer } from '../../viewAs/visibility.ts'
import { ReadAge } from '../atoms/ReadAge.tsx'
import { SAFE } from '../../test/fixtures/house/org.ts'
import { FIXED_NOW } from '../../test/fixtures/parts.ts'
import { GARDEN, NETWORK_PROJECTS, OPS_WALLET, ROLES, TREASURY_SYSTEM, VOTES, COUNCIL_SAFE } from '../../test/fixtures/house/systems.ts'
import { DataList } from './DataList.tsx'
import { DataRow } from './DataRow.tsx'
import { SystemRow } from './SystemRow.tsx'

const NOW = new Date('2026-10-29T12:00:00Z')
const AGE = <ReadAge state="fresh" readAt="2026-10-29T11:56:00Z" now={NOW} />

function list(children: ReactNode, viewer?: Viewer) {
  const ui = <DataList label="Rows">{children}</DataList>
  return renderAt(viewer ? <ViewAsProvider initial={viewer}>{ui}</ViewAsProvider> : ui)
}
const rowOf = (title: string) => screen.getByText(title).closest<HTMLElement>('[data-row]')!

describe('DataRow: the house’s list row, one per state of §9.2', () => {
  it('default: a list item with the kind tile, the title, the second line and the trailing facts', () => {
    list(<DataRow kind="page" title="Onboarding for new local nodes" second="Page · Knowledge" trailing={AGE} marks={[]} />)
    const item = within(screen.getByRole('list', { name: 'Rows' })).getByRole('listitem')
    const row = rowOf('Onboarding for new local nodes')
    expect(item.contains(row)).toBe(true)
    expect(row.querySelector('.ktile.ktile-row')).not.toBeNull()
    expect(row.querySelector('.ktile-attn')).toBeNull()
    expect(row.querySelector('.drow-s')!.textContent).toBe('Page · Knowledge')
    expect(row.querySelector('.drow-end time')!.textContent).toBe('read 4\u00a0min ago')
    expect(row.getAttribute('aria-current')).toBeNull()
    expect(row.getAttribute('aria-selected')).toBeNull()
    expect(row.className).not.toMatch(/o-dim|drow-sel/)
  })

  // B2 fix I-1: the plan said aria-selected, which is not valid on a link or a plain row (no listbox/grid role), so
  // a screen reader never said it; aria-current is valid there and is announced as "current".
  it('selected: aria-current and the moss bar class, never aria-selected', () => {
    list(<DataRow kind="safe" title="Treasury" second="Safe · 4 of 8 · 7 chains" marks={[]} selected />)
    const row = rowOf('Treasury')
    expect(row.getAttribute('aria-current')).toBe('true')
    expect(row.getAttribute('aria-selected')).toBeNull()
    expect(row.classList.contains('drow-sel')).toBe(true)
  })

  it('staged: the staged mark trailing, the old value struck in the second line', () => {
    list(<DataRow kind="safe" title="Treasury" second="Safe · threshold 4 of 8" was="4 of 9" marks={['staged']} />)
    const row = rowOf('Treasury')
    expect(row.querySelector('.drow-s .was s')!.textContent).toBe('4 of 9')
    expect(row.querySelector('.drow-s')!.textContent).toBe('was 4 of 9Safe · threshold 4 of 8')
    expect(row.querySelector('.drow-end .smark-staged')!.textContent).toBe('Staged')
  })

  it('stale: the stale mark', () => {
    list(<DataRow kind="hat" title="Treasury signer" second="Hat 13.1.1 · changed on the trunk since you staged" marks={['stale']} />)
    expect(rowOf('Treasury signer').querySelector('.drow-end .smark-stale')).not.toBeNull()
  })

  it('needs: the clay tile and the needs mark', () => {
    list(<DataRow kind="hat" title="Regional coordinator" second="Hat 13.2.3 · no wearer" marks={['needs']} />)
    const row = rowOf('Regional coordinator')
    expect(row.querySelector('.ktile.ktile-attn')).not.toBeNull()
    expect(row.querySelector('.drow-end .smark-needs')!.textContent).toBe('Needs you')
  })

  it('tone attn draws the clay tile without a mark', () => {
    list(<DataRow kind="hat" title="Comms" marks={[]} tone="attn" />)
    expect(rowOf('Comms').querySelector('.ktile-attn')).not.toBeNull()
    expect(rowOf('Comms').querySelector('.smark')).toBeNull()
  })

  it('reading: the spinner and "Reading…" in place of the age', () => {
    list(<DataRow kind="snapshot-space" title="exampledao.eth" second="Snapshot space" trailing={AGE} marks={['running']} />)
    const end = rowOf('exampledao.eth').querySelector('.drow-end')!
    expect(end.querySelector('.smark-running .spin')).not.toBeNull()
    expect(end.textContent).toBe('Reading…')
    expect(end.querySelector('time')).toBeNull()
  })

  it('closed and faint: the whole row dimmed (o-dim); closed says so, faint draws no mark', () => {
    list(<>
      <DataRow kind="proposal" title="Fund the node kit" second="Withdrawn · 12 Aug" marks={['closed']} />
      <DataRow kind="task" title="Not in this list" marks={['faint']} />
    </>)
    expect(rowOf('Fund the node kit').classList.contains('o-dim')).toBe(true)
    expect(rowOf('Fund the node kit').querySelector('.smark-closed')).not.toBeNull()
    expect(rowOf('Not in this list').classList.contains('o-dim')).toBe(true)
    expect(rowOf('Not in this list').querySelector('.smark')).toBeNull()
  })

  it('is one link when href is given: the row itself, everything else inside it', () => {
    list(<DataRow kind="page" title="Council call, 22 October" second="Meeting · notes attached" marks={['needs']} href="/r/meeting/council-call" />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toBe(rowOf('Council call, 22 October'))
    expect(links[0].getAttribute('href')).toBe('/r/meeting/council-call')
  })

  // design pass 2026-11-04 (Boards): a drawn picture in the tile's place, and an action beside the row, never inside its link
  it('draws a lead in place of the kind tile, and an action beside the link, outside it', () => {
    list(<DataRow kind="board" title="Council" lead={<span className="pic" />} marks={[]} href="/b/council"
      action={<button type="button">Copy to yours</button>} />)
    const link = screen.getByRole('link')
    expect(link.querySelector('.pic')).not.toBeNull()
    expect(link.querySelector('.ktile')).toBeNull()
    const button = screen.getByRole('button', { name: 'Copy to yours' })
    expect(link.contains(button)).toBe(false)
    expect(button.closest('li')).toBe(link.closest('li'))
    expect(button.closest('li')!.className).toBe('drow-li drow-li-act')
  })

  it('without href it is no link', () => {
    list(<DataRow kind="page" title="Local node kit, v2" marks={[]} />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('Space calls onPreview, on the row itself', () => {
    const onPreview = vi.fn()
    list(<>
      <DataRow kind="page" title="One" marks={[]} onPreview={onPreview} href="/r/page/one" />
      <DataRow kind="page" title="Two" marks={[]} />
    </>)
    const one = rowOf('One')
    one.focus()
    fireEvent.keyDown(one, { key: ' ' })
    expect(onPreview).toHaveBeenCalledTimes(1)
    // a row without onPreview leaves Space alone
    const two = rowOf('Two')
    two.focus()
    expect(fireEvent.keyDown(two, { key: ' ' })).toBe(true)
  })

  it('draws nothing for an item the viewer may not see (§6.3): no row, no item, no placeholder', () => {
    list(<>
      <DataRow kind="page" title="Open to members" marks={[]} item={{ facts: { visibility: 'members' } }} />
      <DataRow kind="page" title="Treasurer only" marks={[]} item={{ facts: { visibility: 'hat:treasury' } }} />
    </>, { as: 'members' })
    expect(screen.queryByText('Treasurer only')).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })
})

describe('DataList: a list in a raised surface, roving, busy while it loads', () => {
  it('loading draws N skeleton rows of the row’s height, busy and named', () => {
    renderAt(<DataList label="Systems" loading={3}><DataRow kind="safe" title="Treasury" marks={[]} /></DataList>)
    const busy = screen.getByRole('region', { name: 'Loading Systems' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(busy.querySelectorAll('.skel-row-row')).toHaveLength(3)
    expect(screen.queryByText('Treasury')).toBeNull()
    expect(busy.closest('.dlist')).not.toBeNull()
  })

  it('previewing drops the children whose item the viewer may not see, itself: any child, no placeholder', () => {
    // direct children (a Fragment would hide them from the list), and a child that does not filter itself
    const Plain = ({ title }: { title: string; item?: unknown }) => <li>{title}</li>
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><DataList label="Rows">
      <Plain title="Public note" item={{ facts: { visibility: 'public' } }} />
      <Plain title="Ops note" item={{ facts: { visibility: 'hat:ops' } }} />
      <Plain title="Unmarked" />
    </DataList></ViewAsProvider>)
    expect(within(screen.getByRole('list', { name: 'Rows' })).getAllByRole('listitem').map(i => i.textContent)).toEqual(['Public note', 'Unmarked'])
  })

  it('previewing drops the rows the viewer may not see and draws no placeholder', () => {
    list(<>
      <DataRow kind="safe" title="Treasury" marks={[]} item={{ facts: { visibility: 'public' } }} />
      <DataRow kind="page" title="Ops notes" marks={[]} item={{ facts: { visibility: 'hat:ops' } }} />
      <DataRow kind="page" title="Members page" marks={[]} item={{ facts: {} }} />
    </>, { as: 'public' })
    const items = within(screen.getByRole('list', { name: 'Rows' })).getAllByRole('listitem')
    expect(items.map(i => i.textContent)).toEqual(['Treasury'])
    expect(screen.getByRole('list', { name: 'Rows' }).children).toHaveLength(1)
  })

  it('one tab stop; ↓ and ↑ move between the rows', () => {
    list(<>
      <DataRow kind="page" title="First" marks={[]} />
      <DataRow kind="page" title="Second" marks={[]} href="/r/page/second" />
      <DataRow kind="page" title="Third" marks={[]} />
    </>)
    const [a, b, c] = ['First', 'Second', 'Third'].map(rowOf)
    expect([a, b, c].map(r => r!.tabIndex)).toEqual([0, -1, -1])
    a!.focus()
    fireEvent.keyDown(a!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(b)
    fireEvent.keyDown(b!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(c)
    fireEvent.keyDown(c!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(b)
  })
})

describe('SystemRow: a System in a list (§9.2)', () => {
  const sys = (r = TREASURY_SYSTEM, more: { proposed?: string; selected?: boolean } = {}) => list(<SystemRow resource={r} now={FIXED_NOW} {...more} />)
  const col = (row: HTMLElement, c: string) => row.querySelector<HTMLElement>(`.sysrow-${c}`)!

  it('kind tile · name and kind · chain chip · address chip · one state mark · read age, end-aligned', () => {
    sys()
    const row = rowOf('Treasury')
    expect(row.classList.contains('sysrow')).toBe(true)
    expect(row.querySelector(':scope > .ktile')).not.toBeNull()
    expect(row.querySelector('.drow-t')!.textContent).toBe('Treasury')
    expect(row.querySelector('.drow-s')!.firstChild!.textContent).toBe('Safe')
    // the chips are still (E-36): no control of their own, the chain's names said after its count, the address's
    // CAIP-10 id in its title (ledger C6: the address was a copy button)
    expect(col(row, 'chain').querySelector('.chain')!.textContent).toMatch(/^7 chains: Ethereum, /)
    const addr = col(row, 'addr').querySelector('.addr-still') as HTMLElement
    expect(addr.textContent).toBe('0x6AFF…343a')
    expect(within(col(row, 'addr')).queryByRole('button')).toBeNull()
    expect(col(row, 'state').querySelectorAll('.smark')).toHaveLength(1)
    expect(col(row, 'state').textContent).toBe('1 to sign')
    expect(col(row, 'age').textContent).toBe('read 4\u00a0min ago')
    // the columns in order, after the tile and the main
    expect([...row.querySelectorAll('.drow-end > *')].map(e => e.className)).toEqual(['sysrow-chain', 'sysrow-addr', 'sysrow-state', 'sysrow-age'])
  })

  it('carries the chain chip in the second line too, for under 760px (CSS shows one or the other)', () => {
    sys()
    expect(rowOf('Treasury').querySelector('.drow-s .sysrow-k .chain')!.textContent).toMatch(/^7 chains/)
  })

  it('a row with an href is one link and one tab stop: its chips are still, Space previews it (E-36)', () => {
    const preview = vi.fn()
    list(<SystemRow resource={TREASURY_SYSTEM} now={FIXED_NOW} href="/r/system/treasury" onPreview={preview} />)
    const link = screen.getByRole('link', { name: /Treasury/ })
    expect(link.getAttribute('href')).toBe('/r/system/treasury')
    expect(link.querySelectorAll('button, a, [tabindex]')).toHaveLength(0)
    fireEvent.keyDown(link, { key: ' ' })
    expect(preview).toHaveBeenCalledOnce()
  })

  it('the needs tile when the System needs someone; the plain tile otherwise', () => {
    sys()
    expect(rowOf('Treasury').querySelector('.ktile-attn')).not.toBeNull()
  })

  it('a Hats tree’s address is the Mono id "42220 / 13"; a Snapshot space’s its host', () => {
    list(<><SystemRow resource={ROLES} now={FIXED_NOW} /><SystemRow resource={VOTES} now={FIXED_NOW} /></>)
    expect(col(rowOf('Roles'), 'addr').querySelector('.mono')!.textContent).toBe('42220 / 13')
    expect(col(rowOf('Roles'), 'state').textContent).toBe('3 empty hats')
    expect(col(rowOf('exampledao.eth'), 'addr').textContent).toBe('snapshot.box')
    expect(col(rowOf('exampledao.eth'), 'state').textContent).toBe('Up to date')
    expect(rowOf('exampledao.eth').querySelector('.ktile-attn')).toBeNull()
  })

  it('a failed read: Couldn’t read, its last good read’s age in clay', () => {
    sys(GARDEN)
    const row = rowOf('Example DAO Garden')
    expect(col(row, 'state').querySelector('.smark-failed')).not.toBeNull()
    expect(col(row, 'age').querySelector('.age-failed')!.textContent).toBe('couldn’t read · last 2\u00a0h ago')
  })

  it('the age column shows the age alone, as the gallery does; the full words stay for a screen reader', () => {
    list(<><SystemRow resource={TREASURY_SYSTEM} now={FIXED_NOW} /><SystemRow resource={GARDEN} now={FIXED_NOW} /></>)
    const shown = (row: HTMLElement) => {
      const age = col(row, 'age').cloneNode(true) as HTMLElement
      age.querySelectorAll('.sr-only').forEach(s => s.remove())
      return age.textContent
    }
    expect(shown(rowOf('Treasury'))).toBe('4 min ago')
    expect(shown(rowOf('Example DAO Garden'))).toBe('2 h ago')
    expect(col(rowOf('Example DAO Garden'), 'age').querySelector('time.age-failed svg')).not.toBeNull()
  })

  it('a read in flight: Reading… and the reading age', () => {
    sys(COUNCIL_SAFE)
    const row = rowOf('Council Safe')
    expect(col(row, 'state').textContent).toBe('Reading…')
    expect(col(row, 'age').textContent).toBe('reading…')
  })

  it('a proposal pending on it: the staged mark with its words', () => {
    sys(NETWORK_PROJECTS, { proposed: 'Return proposed' })
    expect(col(rowOf('Network Projects'), 'state').querySelector('.smark-staged')!.textContent).toBe('Return proposed')
  })

  it('a link: Linked, not read, and no read age', () => {
    sys(OPS_WALLET)
    const row = rowOf('Ops wallet')
    expect(col(row, 'state').textContent).toBe('Linked, not read')
    expect(col(row, 'age').querySelector('time')).toBeNull()
  })

  it('selected passes through to the row', () => {
    sys(TREASURY_SYSTEM, { selected: true })
    expect(rowOf('Treasury').getAttribute('aria-current')).toBe('true')
    expect(rowOf('Treasury').getAttribute('aria-selected')).toBeNull()
  })

  it('is not drawn for a System the viewer may not see', () => {
    const hidden = structuredClone(TREASURY_SYSTEM)
    hidden.facts.visibility = 'hat:treasury'
    list(<><SystemRow resource={hidden} now={FIXED_NOW} /><SystemRow resource={VOTES} now={FIXED_NOW} /></>, { as: 'members' })
    expect(screen.queryByText('Treasury')).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText(SAFE)).toBeNull()
  })
})
