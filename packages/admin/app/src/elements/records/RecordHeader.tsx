import type { ReactNode } from 'react'
import type { DriverRead } from '../../api.ts'
import { Button, ButtonLink } from '../../design/Button.tsx'
import { KindTile } from '../../design/KindTile.tsx'
import { Menu, type MenuEntry } from '../../design/Menu.tsx'
import { StatusMark, type Mark } from '../../design/StatusMark.tsx'
import { AddressChip } from '../atoms/AddressChip.tsx'
import { ChainChip } from '../atoms/ChainChip.tsx'
import { Presence } from '../atoms/Presence.tsx'
import { ReadAge } from '../atoms/ReadAge.tsx'
import { FromMark, readStateOf, type From } from '../atoms/FromMark.tsx'
import { useCanWrite } from '../../viewAs/ViewAs.tsx'
import { VisibilityMarker } from '../../viewAs/VisibilityMarker.tsx'
import type { Visibility } from '../../viewAs/visibility.ts'

/** What a kind is called, in sentence case: "Safe", "Hats tree", "Snapshot space". An unknown kind is its own id,
 *  its dashes as spaces. */
const KIND_WORD: Record<string, string> = {
  safe: 'Safe', 'hats-tree': 'Hats tree', hat: 'Hat', 'snapshot-space': 'Snapshot space', 'gardens-community': 'Gardens community',
  'gardens-pool': 'Gardens pool', link: 'Link', wallet: 'Wallet', proposal: 'Proposal', meeting: 'Meeting', task: 'Task', page: 'Page', project: 'Project',
}
export function kindWord(kind: string): string {
  if (Object.hasOwn(KIND_WORD, kind)) return KIND_WORD[kind]!
  const words = kind.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A System's header. `kind` is the driver's kind (the tile's glyph, the eyebrow's word); `governs` is the governing
 *  fact ("4 of 8 signers"); `read` is the driver's latest read, null when none was made; `open` the System's own
 *  link-out ("Open in Safe"). B2's `systemFacts` fills these from a Resource. */
export type SystemHeader = {
  variant: 'system'; kind: string; name: string; chain?: string[]; address?: string; governs?: string
  read: DriverRead | null; now: Date; onReadNow?(): void; open?: { label: string; href: string }
  /** Where the header's facts were read from (E-2): drawn at the end of the facts line. */
  from?: From
  /** The System's visibility marker, for a viewer who may not change it, and a level in flight beside it (L5 §11.4). */
  visibility?: Visibility; visibilityProposed?: Visibility
}

/** A record's header: a proposal, or any record that is not a page or a meeting. `primary` is the one action for this
 *  viewer now; `meta` the opened date and hat, the closing date, laid out in order. */
export type RecordHead = {
  variant: 'record'; kind: string; id: string; title: string; state?: Mark; stateWord?: string; route?: string; visibility?: Visibility
  /** A level in flight (L5 §11.4): "Members → Public, proposed" beside the marker. */
  visibilityProposed?: Visibility
  meta: ReactNode[]; presence?: { handle: string; role: string; editing?: boolean }[]; primary?: ReactNode; secondary?: ReactNode[]; more?: MenuEntry[]
  /** Where the record was read from (E-2), drawn in the meta line after its items; `now` dates the age (now by default). */
  from?: From; now?: Date
}

function System(p: SystemHeader) {
  const chain = p.chain ?? []
  return (
    <header className="rh rh-sys" data-kind={p.kind}>
      <div className="rh-grid">
        <KindTile kind={p.kind} size="header" />
        <div className="rh-main">
          <div className="rh-eyebrow">{kindWord(p.kind)} · System</div>
          <h1 className="rh-title">{p.name}</h1>
          <div className="rh-facts">
            <ChainChip chains={chain} />
            {p.address && <AddressChip value={p.address} chain={chain.length === 1 ? chain[0] : undefined} />}
            {p.governs && <span className="rh-gov">{p.governs}</span>}
            {p.visibility && <VisibilityMarker value={p.visibility} proposed={p.visibilityProposed} />}
            {/* a failed read keeps the last good time in readAt (reader.ts failed()); a from mark of this same read says
                its age itself, so the read is said once (walk 2026-11-04) */}
            {!(p.from && 'system' in p.from && p.from.read === p.read) &&
              <ReadAge state={readStateOf(p.read)} readAt={p.read?.readAt ?? null} lastGood={p.read && !p.read.ok ? p.read.readAt : null} now={p.now} />}
            {p.from && <FromMark from={p.from} now={p.now} />}
          </div>
        </div>
        {(p.onReadNow || p.open) && (
          <div className="rh-acts">
            {p.onReadNow && <Button icon="refresh" iconOnly label="Read now" onClick={() => p.onReadNow?.()} />}
            {p.open && <ButtonLink href={p.open.href} external>{p.open.label}</ButtonLink>}
          </div>
        )}
      </div>
    </header>
  )
}

/** A record's variant. Not named `Record`, which would shadow the type (L4b B1 M-4, E-65). */
function RecordVariant(p: RecordHead) {
  const canWrite = useCanWrite()
  const secondary = p.secondary ?? []
  const more = p.more ?? []
  const acts = canWrite && (p.primary !== undefined || secondary.length > 0 || more.length > 0)
  return (
    <header className="rh" data-kind={p.kind}>
      <div className="rh-top">
        <span className="rh-id">{p.id}</span>
        {p.state && <StatusMark mark={p.state} label={p.stateWord} />}
        {p.route && <span className="rh-route">{p.route}</span>}
        {p.visibility && <VisibilityMarker value={p.visibility} proposed={p.visibilityProposed} />}
      </div>
      <h1 className="rh-title">{p.title}</h1>
      {(p.meta.length > 0 || (p.presence?.length ?? 0) > 0 || p.from) && (
        <div className="rh-meta">
          {p.meta.map((m, i) => <span className="rh-m" key={i}>{m}</span>)}
          {p.from && <span className="rh-m"><FromMark from={p.from} now={p.now ?? new Date()} /></span>}
          {p.presence && p.presence.length > 0 && (
            <span className="rh-m rh-pres"><Presence people={p.presence} />
              <span aria-hidden="true">{p.presence.length} {p.presence.length === 1 ? 'other' : 'others'} here</span></span>
          )}
        </div>
      )}
      {acts && (
        <div className="rh-acts">
          {p.primary}
          {secondary}
          {more.length > 0 && <Menu label="More actions" items={more} />}
        </div>
      )}
    </header>
  )
}

/** The record header (§9.1). A System: the 40px kind tile; the eyebrow (kind · System); the title (Sans 600 24); the
 *  facts line — chain chip, address chip, the governing fact, read age; then Read now (an icon) and the System's own
 *  link-out, which wrap under the title below 560px. A record: the id (Mono), its state mark, the route pill and the
 *  visibility marker; the title; the meta and who else is here; then the one primary for this viewer, the secondary
 *  actions and More. While previewing (no writes), a record draws no actions; a System keeps Read now and its link. */
export function RecordHeader(p: SystemHeader | RecordHead) {
  return p.variant === 'system' ? <System {...p} /> : <RecordVariant {...p} />
}
