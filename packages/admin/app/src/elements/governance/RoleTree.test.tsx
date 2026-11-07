// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderAt } from '../../test/render.tsx'
import { DEEP_TREE, ROLE_TREE, ROLE_TREE_OPEN } from '../../test/fixtures/house/governance.ts'
import { hatRefOf } from '../../test/fixtures/house/systems.ts'
import { RoleTree } from './RoleTree.tsx'
import type { RoleNode } from './roles.ts'

const css = readFileSync(join(process.cwd(), 'app/src/design/css/governance.css'), 'utf8') // vitest runs from packages/admin
const everyId = (nodes: RoleNode[]): string[] => nodes.flatMap(n => [n.id, ...everyId(n.children)])

function draw(nodes = ROLE_TREE, open: string[] | undefined = ROLE_TREE_OPEN) {
  const onOpen = vi.fn(), onInspect = vi.fn()
  const utils = renderAt(<RoleTree nodes={nodes} onOpen={onOpen} onInspect={onInspect} label="Hats tree 13" defaultOpen={open} />)
  return { ...utils, onOpen, onInspect }
}
// the treeitem is the row itself (C11, 2.5.3: its words are its name); its group is beside it in the list item
const item = (name: string) => screen.getAllByRole('treeitem').find(t => t.querySelector('.rt-n')!.textContent === name)!
const focused = () => document.activeElement!.querySelector('.rt-n')!.textContent
const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k })

describe('RoleTree (§9.7, APG tree)', () => {
  it('is a tree of treeitems with aria-level, and aria-expanded on hats that hold hats', () => {
    draw()
    const tree = screen.getByRole('tree', { name: 'Hats tree 13' })
    expect(tree.tagName).toBe('UL')
    const items = screen.getAllByRole('treeitem')
    expect(items.map(i => i.querySelector('.rt-n')!.textContent)).toEqual([
      'Example DAO', 'Steward Council', 'Treasury signer', 'Operations', 'Finance', 'Events', 'Regional coordinator', 'Comms', 'Local nodes',
    ])
    expect(items.map(i => i.getAttribute('aria-level'))).toEqual(['1', '2', '3', '2', '3', '3', '3', '3', '2'])
    expect(items.map(i => i.getAttribute('aria-expanded'))).toEqual(['true', 'true', null, 'true', null, null, null, null, 'false'])
    // the hats under a hat are a group; one item is in the tab order (roving)
    expect(item('Operations').parentElement!.querySelector(':scope > ul')!.getAttribute('role')).toBe('group')
    expect(items.filter(i => i.tabIndex === 0)).toEqual([items[0]])
    // each item is named by its own row, not by the hats under it
    expect(screen.getByRole('treeitem', { name: /^Example DAO 0x0000000d/ })).toBe(items[0])
  })

  it('a treeitem is its row: named by its own words, with no label over them, and it holds no hat under it (2.5.3, axe label-content-name-mismatch)', () => {
    draw()
    for (const t of screen.getAllByRole('treeitem')) {
      expect(t.hasAttribute('aria-label') || t.hasAttribute('aria-labelledby')).toBe(false)
      expect(t.querySelector('[role="treeitem"]')).toBeNull()
      expect(t.parentElement!.getAttribute('role')).toBe('none')
    }
  })

  it('↓↑ move, → opens or goes to the first hat inside, ← closes or goes to the parent, Home/End', () => {
    draw()
    act(() => item('Example DAO').focus())
    key('ArrowDown'); expect(focused()).toBe('Steward Council')
    key('ArrowDown'); key('ArrowDown'); expect(focused()).toBe('Operations')
    key('ArrowUp'); expect(focused()).toBe('Treasury signer')
    key('ArrowLeft'); expect(focused()).toBe('Steward Council') // a leaf: to its parent
    key('ArrowLeft'); expect(item('Steward Council').getAttribute('aria-expanded')).toBe('false') // open: closes
    expect(focused()).toBe('Steward Council')
    key('ArrowRight'); expect(item('Steward Council').getAttribute('aria-expanded')).toBe('true') // closed: opens
    key('ArrowRight'); expect(focused()).toBe('Treasury signer') // open: to the first hat inside
    key('End'); expect(focused()).toBe('Local nodes')
    key('ArrowRight'); expect(item('Local nodes').getAttribute('aria-expanded')).toBe('true')
    key('End'); expect(focused()).toBe('Local node 4')
    key('Home'); expect(focused()).toBe('Example DAO')
    key('ArrowUp'); expect(focused()).toBe('Example DAO')
    expect(screen.getAllByRole('treeitem').filter(i => i.tabIndex === 0)).toHaveLength(1)
  })

  it('Enter opens the hat, Space inspects it (and selects it); typing "tr" moves to "Treasury signer"', () => {
    const { onOpen, onInspect } = draw()
    act(() => item('Example DAO').focus())
    key('t'); key('r')
    expect(focused()).toBe('Treasury signer')
    key('Enter')
    expect(onOpen).toHaveBeenCalledWith(hatRefOf(1, 1))
    key(' ')
    expect(onInspect).toHaveBeenCalledWith(hatRefOf(1, 1))
    expect(item('Treasury signer').getAttribute('aria-selected')).toBe('true')
    expect(item('Treasury signer').classList.contains('rt-sel')).toBe(true)
  })

  it('a click on the chevron opens or closes; a click on the row inspects it', () => {
    const { onInspect } = draw()
    fireEvent.click(item('Local nodes').querySelector('.rt-tg')!)
    expect(item('Local nodes').getAttribute('aria-expanded')).toBe('true')
    expect(onInspect).not.toHaveBeenCalled()
    fireEvent.click(item('Events'))
    expect(onInspect).toHaveBeenCalledWith(hatRefOf(2, 2))
  })

  it('a click on a chevron brings the keyboard to that hat: ↓ moves from it (review I-1); unselected items say aria-selected false', () => {
    draw()
    act(() => item('Example DAO').focus())
    fireEvent.click(item('Operations').querySelector('.rt-tg')!)
    expect(item('Operations').getAttribute('aria-expanded')).toBe('false')
    expect(item('Operations').tabIndex).toBe(0)
    act(() => item('Operations').focus())
    key('ArrowDown'); expect(focused()).toBe('Local nodes')
    // focus by any path (a pointer on the item, a script) is where the keys start
    act(() => item('Steward Council').focus())
    key('ArrowDown'); expect(focused()).toBe('Treasury signer')
    expect(screen.getAllByRole('treeitem').map(i => i.getAttribute('aria-selected'))).toEqual(screen.getAllByRole('treeitem').map(() => 'false'))
  })

  it('an empty hat: a dashed disc, the name mute, the needs mark "No wearer"', () => {
    draw()
    const row = item('Comms')
    expect(row.classList.contains('rt-empty')).toBe(true)
    expect(row.querySelector('.rt-wear .smark-needs .smark-word')!.textContent).toBe('No wearer')
    expect(css).toMatch(/\.rt-empty \.rt-hat \{[^}]*border-style: dashed;/)
    expect(css).toMatch(/\.rt-empty \.rt-n \{[^}]*color: var\(--mute\);/)
  })

  it('yours: the moss disc outline and "· you"', () => {
    draw()
    const row = item('Steward Council')
    expect(row.classList.contains('rt-yours')).toBe(true)
    expect(row.querySelector('.rt-wear')!.textContent).toMatch(/5 wear it · you$/)
    expect(css).toMatch(/\.rt-yours \.rt-hat \{[^}]*border-color: var\(--accent\);/)
  })

  it('up to three monograms, then "+5" and "8 wear it"; who is shown is said by role', () => {
    draw()
    const wear = item('Treasury signer').querySelector('.rt-wear')!
    const stack = wear.querySelector('.rt-pres')!
    expect(stack.getAttribute('aria-hidden')).toBe('true')
    expect([...stack.querySelectorAll('.av')].map(a => a.textContent)).toEqual(['TS', 'SA', 'SB', '+5'])
    expect(wear.querySelector('.sr-only')!.textContent).toBe('3 shown: Treasury steward, Steward A, Steward B · ')
    expect(wear.textContent).toMatch(/8 wear it · signs 4 of 8$/)
  })

  it('wearers not shown read as a count or an address chip, never names', () => {
    draw()
    const events = item('Events').querySelector('.rt-wear')!
    expect(events.textContent).toBe('2 wear it')
    expect(events.querySelector('.av')).toBeNull()
    const ops = item('Operations').querySelector('.rt-wear')!
    expect(ops.querySelector('button.addr')!.getAttribute('title')).toMatch(/^eip155:42220:0x/)
    expect(ops.querySelector('.av')).toBeNull()
    const top = item('Example DAO').querySelector('.rt-wear')!
    expect(top.querySelector('.addr-t')!.textContent).toBe('0x6AFF…343a')
    expect(top.textContent).toContain('top hat · held by the Safe')
  })

  it('a deep, wide tree: six levels, connectors in every group; 200 wearers read "+197" and "200 wear it"; no name shows the pretty id', () => {
    draw(DEEP_TREE, everyId(DEEP_TREE))
    const items = screen.getAllByRole('treeitem')
    expect(Math.max(...items.map(i => Number(i.getAttribute('aria-level'))))).toBe(6)
    expect(document.querySelectorAll('ul.rt-group')).toHaveLength(5)
    const unnamed = items.find(i => i.getAttribute('aria-level') === '6')!
    const row = unnamed
    expect(row.querySelector('.rt-n')!.textContent).toBe('0x0000000e.0001.0001.0001.0001.0001')
    expect(row.querySelector('.rt-n')!.classList.contains('rt-n-id')).toBe(true)
    expect(row.querySelector('.rt-id')).toBeNull() // the id is not said twice
    expect([...row.querySelectorAll('.rt-pres .av')].map(a => a.textContent)).toEqual(['SA', 'SB', 'OL', '+197'])
    expect(row.querySelector('.rt-wear')!.textContent).toMatch(/3 shown: Steward A, Steward B, Ops lead · 200 wear it$/)
    // a connector: every group's hats hang from one vertical, each from its own elbow
    expect(css).toMatch(/\.rt-group > li::before \{[^}]*inline-size: var\(--rule-w\);/)
    expect(css).toMatch(/\.rt-group > li > \.rt-row::before \{[^}]*inline-size: var\(--w-rt-elbow\);/)
  })

  it('opens every hat with hats inside when no defaultOpen is given', () => {
    renderAt(<RoleTree nodes={ROLE_TREE} onOpen={vi.fn()} onInspect={vi.fn()} />)
    expect(screen.getByRole('tree', { name: 'Roles' })).toBeTruthy()
    expect(screen.getAllByRole('treeitem')).toHaveLength(everyId(ROLE_TREE).length)
  })

  it('CSS: under 520px of the role tree the wearers move under the name', () => {
    expect(css).toMatch(/\.rt \{[^}]*container: roles \/ inline-size;/)
    const at = css.indexOf('@container roles (max-width: 519px) {')
    expect(at, 'no @container roles (max-width: 519px) block').toBeGreaterThanOrEqual(0)
    const narrow = css.slice(at, css.indexOf('\n}', at))
    expect(narrow).toMatch(/\.rt-row \{ grid-template-columns: var\(--h-rt-tg\) var\(--h-rt-hat\) minmax\(0, 1fr\);/)
    expect(narrow).toMatch(/\.rt-wear \{ grid-column: 3;/)
  })
})
