import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '../../design/Icon.tsx'
import { StatusMark } from '../../design/StatusMark.tsx'
import { AddressChip } from '../atoms/AddressChip.tsx'
import { Presence } from '../atoms/Presence.tsx'
import { flattenVisible, isEmptyHat, typeAhead, type RoleNode } from './roles.ts'

/** How many monograms a hat draws before "+N" (§9.7, as Presence draws). */
const SHOWN = 3
/** How long typed letters run together for type-ahead (APG). */
const TYPE_MS = 500
const ACCOUNT = /^(eip155:\d+):(0x[0-9a-fA-F]{40})$/

const withKids = (nodes: RoleNode[]): string[] => nodes.flatMap(n => (n.children.length > 0 ? [n.id, ...withKids(n.children)] : []))
const holds = (n: RoleNode, id: string): boolean => n.children.some(c => c.id === id || holds(c, id))

/** A hat's wearers (§9.7): up to three monograms and "+N" for wearers who made theirs public, else the one wearer's
 *  address chip, else the count, never names (rule 9); "· you" on yours; then what the hat does. An empty hat says
 *  "No wearer" (the needs mark); a hat switched off says so. */
function Wearers({ node }: { node: RoleNode }) {
  const { count, shown, address } = node.wearers
  const people = shown && shown.length > 0 ? shown.slice(0, SHOWN) : null
  const account = address ? ACCOUNT.exec(address) : null
  const chip = !people && address ? (account ? <AddressChip value={account[2]!} chain={account[1]!} /> : <AddressChip value={address} />) : null
  const words = [
    !chip && count > 0 && `${count} ${count === 1 ? 'wears' : 'wear'} it`,
    node.yours && 'you',
    node.does,
  ].filter(Boolean).join(' · ')
  return (
    <span className="rt-wear">
      {isEmptyHat(node) && <StatusMark mark="needs" label="No wearer" />}
      {node.active === false && <StatusMark mark="closed" label="Switched off" />}
      {people && (
        <>
          <span className="rt-pres" aria-hidden="true">
            <Presence people={people} />
            {count > people.length && <span className="av av-more">+{count - people.length}</span>}
          </span>
          <span className="sr-only">{`${people.length} shown: ${people.map(p => p.role).join(', ')} · `}</span>
        </>
      )}
      {chip}
      {words !== '' && <span>{isEmptyHat(node) || node.active === false || chip ? `· ${words}` : words}</span>}
    </span>
  )
}

/** The role tree (§9.7): an APG tree of hats. Rows 44px: the chevron, the 26px hat disc, the name and its id, the
 *  wearers. ↑↓ move, → opens or goes to the first hat inside, ← closes or goes to the parent, Home/End, type-ahead;
 *  Enter opens the hat (`onOpen`), Space inspects it (`onInspect`, and selects it). A click on the chevron opens or
 *  closes; on the row, inspects. `defaultOpen` names the hats open at first (every hat with hats inside when absent);
 *  `label` names the tree. Under 520px of the tree the wearers move under the name. */
export function RoleTree({ nodes, onOpen, onInspect, label = 'Roles', defaultOpen }:
  { nodes: RoleNode[]; onOpen(id: string): void; onInspect(id: string): void; label?: string; defaultOpen?: string[] }) {
  const [open, setOpen] = useState(() => new Set(defaultOpen ?? withKids(nodes)))
  const [active, setActive] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const items = useRef(new Map<string, HTMLElement>())
  const moved = useRef(false)
  const typed = useRef({ letters: '', at: 0 })
  const base = useId()

  const rows = useMemo(() => flattenVisible(nodes, open), [nodes, open])
  const current = rows.some(r => r.node.id === active) ? active : (rows[0]?.node.id ?? null)

  useEffect(() => {
    if (!moved.current || current === null) return
    moved.current = false
    items.current.get(current)?.focus()
  }, [current])

  const move = (id: string) => { moved.current = true; setActive(id) }
  const setHat = (id: string, to: boolean) => setOpen(prev => {
    const next = new Set(prev)
    if (to) next.add(id); else next.delete(id)
    return next
  })
  const toggle = (node: RoleNode) => {
    const closing = open.has(node.id)
    setHat(node.id, !closing)
    // closing a hat the focus is inside of brings the focus to it
    if (closing && current !== null && holds(node, current)) setActive(node.id)
  }
  const inspect = (id: string) => { setSelected(id); onInspect(id) }

  function onKey(e: KeyboardEvent<HTMLUListElement>) {
    if ((e.target as HTMLElement).getAttribute('role') !== 'treeitem' || e.altKey || e.ctrlKey || e.metaKey) return
    const at = rows.findIndex(r => r.node.id === current)
    if (at < 0) return
    const { node, parent } = rows[at]!
    const isOpen = node.children.length > 0 && open.has(node.id)
    const go = (i: number) => move(rows[Math.max(0, Math.min(rows.length - 1, i))]!.node.id)
    switch (e.key) {
      case 'ArrowDown': go(at + 1); break
      case 'ArrowUp': go(at - 1); break
      case 'Home': go(0); break
      case 'End': go(rows.length - 1); break
      case 'ArrowRight':
        if (node.children.length === 0) break
        if (isOpen) go(at + 1); else setHat(node.id, true)
        break
      case 'ArrowLeft':
        if (isOpen) setHat(node.id, false); else if (parent !== null) move(parent)
        break
      case 'Enter': onOpen(node.id); break
      case ' ': inspect(node.id); break
      default: {
        if (e.key.length !== 1) return
        const now = e.timeStamp
        typed.current = { letters: (now - typed.current.at < TYPE_MS ? typed.current.letters : '') + e.key, at: now }
        go(typeAhead(rows, at, typed.current.letters))
      }
    }
    e.preventDefault()
  }

  const item = (node: RoleNode, level: number) => {
    const kids = node.children.length > 0
    const isOpen = kids && open.has(node.id)
    const rowId = `${base}-${node.id}`
    const cls = ['rt-row', isEmptyHat(node) && 'rt-empty', node.yours && 'rt-yours', selected === node.id && 'rt-sel'].filter(Boolean).join(' ')
    // The treeitem is the row, its words its name (2.5.3: a name from its own visible words); the hats inside are its
    // group, beside it in the same list item, drawn nested (aria-level says the depth).
    return (
      <li key={node.id} role="none" className="rt-item">
        <div className={cls} id={rowId} role="treeitem" aria-level={level} aria-expanded={kids ? isOpen : undefined}
          aria-selected={selected === node.id} tabIndex={node.id === current ? 0 : -1}
          onFocus={e => { if (e.target === e.currentTarget) setActive(node.id) }}
          ref={el => { if (el) items.current.set(node.id, el); else items.current.delete(node.id) }}
          onClick={() => { setActive(node.id); inspect(node.id) }}>
          <span className="rt-tg" aria-hidden="true" onClick={kids ? e => { e.stopPropagation(); setActive(node.id); toggle(node) } : undefined}>
            {kids && <Icon name="chevron-right" size="xs" />}
          </span>
          <span className="rt-hat" aria-hidden="true"><Icon name="hat" size="sm" /></span>
          <span className="rt-nm">
            {node.name === null
              ? <b className="rt-n rt-n-id">{node.prettyId}</b>
              : <><b className="rt-n">{node.name}</b> <span className="rt-id">{node.prettyId}</span></>}
          </span>
          {' '}<Wearers node={node} />
        </div>
        {isOpen && <ul role="group" className="rt-group">{node.children.map(c => item(c, level + 1))}</ul>}
      </li>
    )
  }

  return (
    <div className="rt">
      <ul role="tree" className="rt-tree" aria-label={label} onKeyDown={onKey}>{nodes.map(n => item(n, 1))}</ul>
    </div>
  )
}
