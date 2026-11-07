import type { CSSProperties, FocusEvent } from 'react'
import { Icon, kindIcon, type IconName } from '../design/Icon.tsx'
import { Spinner } from '../design/Spinner.tsx'
import { kindWord } from '../elements/records/RecordHeader.tsx'
import { RestrictedValue } from '../viewAs/VisibilityMarker.tsx'
import type { MapItem } from './layers.ts'

/** A node's states (§8.3's table). `selected` and `dim` are usually the map's to give (the selection and its path);
 *  the others come with the data. Restricted has no state: a node the viewer may not see is not drawn (§6.3). */
export type NodeState = 'default' | 'selected' | 'needs' | 'staged' | 'aged' | 'failed' | 'reading' | 'linked' | 'empty-hat' | 'draft' | 'dim'

/** One node of the map: its item (for layout and visibility), its one line of facts in Mono (`hat 13.1 · 8 wear it`,
 *  `4 of 8 · 7 chains`), its states, the need it is lit for (§8.5), its deployment order on the compose canvas, and
 *  its page on the door. `factsKept` is the hat word when the viewer is not admitted to the record's `status` (rule 3,
 *  E-70): the line then reads "<hat> only", drawn as every restricted field is, and `facts` is empty. */
export interface MapNodeData { item: MapItem; facts: string; factsKept?: string; states: NodeState[]; need?: string; order?: number; href?: string }

/** The states the door never shows, even if given: what needs a member, and what members have staged or composed
 *  (C-32). */
const NOT_ON_THE_DOOR: ReadonlySet<NodeState> = new Set<NodeState>(['needs', 'staged', 'draft'])

export function statesFor(d: MapNodeData, variant: 'members' | 'door'): NodeState[] {
  return d.states.filter(s => s !== 'default' && (variant === 'members' || !NOT_ON_THE_DOOR.has(s)))
}

/** The facts line as read: "reading…" while a read runs; an empty hat says it has no wearer; a restricted status reads
 *  "<hat> only", the words the node draws in its place. */
export function factsLine(d: MapNodeData, states: readonly NodeState[] = d.states): string {
  if (states.includes('reading')) return 'reading…'
  if (states.includes('empty-hat')) return d.facts ? `${d.facts} · no wearer` : 'no wearer'
  return d.factsKept === undefined ? d.facts : `${d.factsKept} only`
}

/** A node's accessible name (0.6 `nodeName` + `cardName`): first the words it draws, in the order it draws them — the
 *  name, the kind's eyebrow on the main Safe, the facts line (or "reading…"), a picture's third line, then the tags on
 *  its top edge — so the visible words are in the name as they read (2.5.3); then what it does not draw: the kind, what
 *  it needs. A failed node's facts line says "couldn’t read" once. `drawn` is what the node draws beside its data. */
export function nodeName(d: MapNodeData, states: readonly NodeState[] = d.states, drawn: { big?: boolean; tag?: string; more?: string } = {}): string {
  const has = (s: NodeState) => states.includes(s)
  const kind = kindWord(d.item.kind)
  return [
    d.item.name, drawn.big ? kind : null, has('reading') ? 'reading…' : factsLine(d, states) || null, drawn.more ?? null,
    drawn.tag ?? null, has('staged') ? 'staged' : null, has('draft') ? 'not deployed' : null,
    has('draft') && d.order !== undefined ? String(d.order) : null,
    drawn.big ? null : kind, has('needs') ? (d.need ? `needs you: ${d.need}` : 'needs you') : null,
  ].filter(Boolean).join(', ')
}

export interface HouseNodeProps {
  data: MapNodeData
  /** The main Safe (§8.3): the kind's eyebrow, the name in the display face, the edge outline. */
  big?: boolean
  variant?: 'members' | 'door'
  /** A picture's node (a machine diagram): a plain box, not a control. */
  still?: boolean
  /** A word on the top edge (a machine's "initial" and "final"). */
  tag?: string
  /** A third line, faint Mono, for a picture's node (a machine state's own loops). */
  more?: string
  className?: string
  style?: CSSProperties
  tabIndex?: number
  describedBy?: string
  /** The machine diagram's state id. */
  dataState?: string
  onFocus?(e: FocusEvent<HTMLElement>): void
}

/** A map node (§8.3): a `<button>` (an `<a>` on the door, a plain box there when it has no page), glyph and name on the first line, one line of facts in
 *  Mono on the second, and its states as classes (`is-<state>`), tags and the clay dot. Its name is `nodeName`; the
 *  drawn text is decoration for it. */
export function HouseNode({ data: d, big = false, variant = 'members', still = false, tag, more, className, style, tabIndex, describedBy, dataState, onFocus }: HouseNodeProps) {
  const states = statesFor(d, variant)
  const has = (s: NodeState) => states.includes(s)
  const glyph: IconName = has('linked') ? 'link' : kindIcon(d.item.kind)
  const lead: IconName | null = has('failed') ? 'alert' : has('aged') ? 'clock' : null
  const dot = variant === 'members' && (has('needs') || has('failed') || has('empty-hat'))
  const cls = ['hnode', big ? 'hnode-big' : null, ...states.map(s => `is-${s}`), className].filter(Boolean).join(' ')
  // The text in the order `nodeName` says it, a space between the parts (the grid does not draw it): the name, the main
  // Safe's eyebrow (drawn above it, by its order), the facts, then the tags placed on the top edge (2.5.3).
  const body = <>
    <span className="hnode-t">
      {!big && !still && <span className="hnode-g" data-glyph={glyph}><Icon name={glyph} size="sm" /></span>}
      <span className={big ? 'hnode-n hnode-display' : 'hnode-n'}>
        {d.item.nameKept === undefined ? d.item.name : <RestrictedValue hat={d.item.nameKept} />}
      </span>
    </span>{' '}
    {big && <><span className="hnode-k">{kindWord(d.item.kind)}</span>{' '}</>}
    <span className="hnode-f">
      {has('reading') ? <><Spinner />reading…</> : <>
        {lead && <span className="hnode-lead" data-glyph={lead}><Icon name={lead} size="xs" /></span>}
        {d.factsKept === undefined ? factsLine(d, states) : <RestrictedValue hat={d.factsKept} />}{has('linked') && <span aria-hidden="true"> ↗</span>}
      </>}
    </span>
    {more !== undefined && <>{' '}<span className="hnode-more">{more}</span></>}
    {tag !== undefined && <>{' '}<span className="hnode-tag hnode-tag-plain">{tag}</span></>}
    {has('staged') && <>{' '}<span className="hnode-tag">staged</span></>}
    {has('draft') && <>{' '}<span className="hnode-tag hnode-tag-draft">not deployed</span></>}
    {has('draft') && d.order !== undefined && <>{' '}<span className="hnode-order">{d.order}</span></>}
    {dot && <span className="hnode-dot" aria-hidden="true" />}
  </>
  const common = {
    className: cls, style, 'data-node-id': d.item.id, 'data-state': dataState, tabIndex,
    'aria-describedby': describedBy, 'aria-busy': has('reading') ? true : undefined, onFocus,
  }
  if (still) return <div {...common}>{body}</div>
  const name = nodeName(d, states, { big, tag, more })
  if (variant === 'door') {
    // the door's node is a link to its public page; with no page it is no control, only its words (B8 review M-4)
    if (d.href) return <a {...common} href={d.href} aria-label={name}>{body}</a>
    return <div {...common} tabIndex={undefined}>{body}</div>
  }
  return <button type="button" {...common} aria-label={name} aria-current={has('selected') ? 'true' : undefined}>{body}</button>
}
