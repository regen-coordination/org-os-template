import type { ReactNode } from 'react'
import { Icon, kindIcon, type IconName } from '../../design/Icon.tsx'
import { useViewer } from '../../viewAs/ViewAs.tsx'
import { FromMark, type From } from '../atoms/FromMark.tsx'
import { ReadAge, type ReadingState } from '../atoms/ReadAge.tsx'
import { kindWord } from '../records/RecordHeader.tsx'
import { PageHeading } from '../../design/PageHeading.tsx'

/** A workspace page's body (§10.1): the prose measure plus gutters, centred; the meta line (12 faint: "Edited 4 min
 *  ago by Ops lead · Workspace write · saves directly · 3 backlinks"), with the from mark after it when the page says
 *  where it was read from (E-1, Q70); the title in the display face, Fraunces 32 (§3.3, C-4); then the prose, Geist
 *  16/1.65, its headings Sans 600 (H2 20, H3 16), its links underlined in --edge. The children are the page's blocks:
 *  paragraphs, headings, lists and the pieces below. Drawing only: the editor engine and persistence are L6's. */
export function PageBody({ meta, title, from, now, children }: { meta: string; title: string; from?: From; now?: Date; children: ReactNode }) {
  return (
    <article className="ed-body">
      <div className="ed-meta">{meta}{from && <>{' · '}<FromMark from={from} now={now ?? new Date()} /></>}</div>
      <PageHeading className="display ed-title">{title}</PageHeading>
      <div className="ed-prose">{children}</div>
    </article>
  )
}

/** A callout (§10.1): on --sunken, radius 10, a glyph, 14px. */
export function Callout({ icon = 'info', children }: { icon?: IconName; children: ReactNode }) {
  return <div className="ed-callout"><Icon name={icon} size="sm" /><div className="ed-callout-t">{children}</div></div>
}

/** May the viewer see what an embed shows? With no `item` it is the page's own content. */
function useShown(item: unknown): boolean {
  const { sees } = useViewer()
  return item === undefined || sees(item)
}

/** An embedded record (§10.1): a bordered block with an eyebrow head — the kind's glyph, "<name> · <kind>", the read's
 *  age at its end — then its data rows. One the reader may not see is absent on the members' side: no slot, no title
 *  (§18-2, strict rule 7). */
export function EmbedRecord({ kind, name, read, now, rows, item }: {
  kind: string; name: string; read?: { state: ReadingState; readAt: string | null }; now?: Date
  rows: { label: string; value: ReactNode }[]; item?: unknown
}) {
  if (!useShown(item)) return null
  const head = `${name} · ${kindWord(kind)}`
  return (
    <div className="ed-embed" role="group" aria-label={head}>
      <div className="ed-embed-h">
        <Icon name={kindIcon(kind)} size="sm" /><span>{head}</span>
        {read && <span className="ed-embed-end"><ReadAge state={read.state} readAt={read.readAt} now={now ?? new Date()} /></span>}
      </div>
      <dl className="ed-erows">
        {rows.map(r => <div className="ed-erow" key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}
      </dl>
    </div>
  )
}

/** An embedded view (§10.1): a collection's view element, with its tabs, inside the same bordered block. Absent
 *  when the reader may not see the collection (§18-2). */
export function EmbedView({ label, item, children }: { label: string; item?: unknown; children: ReactNode }) {
  if (!useShown(item)) return null
  return <div className="ed-embed ed-embed-view" role="group" aria-label={`${label} · view`}>{children}</div>
}

/** The block the caret is in (§10.1): a 2px --focus rule at its inline start. */
export function Current({ children }: { children: ReactNode }) {
  return <div className="ed-cur">{children}</div>
}

/** Selected text (§10.1), on --accent-soft. */
export function Selected({ children }: { children: ReactNode }) {
  return <span className="ed-sel">{children}</span>
}

/** Commented text (§10.1, §10.3): underlined clay on --attn-soft. Its anchor is what an anchored comment points at;
 *  selecting that comment scrolls here (CommentThread). */
export function Commented({ anchor, children }: { anchor: string; children: ReactNode }) {
  return <mark className="ed-cmt" data-anchor={anchor}>{children}</mark>
}
