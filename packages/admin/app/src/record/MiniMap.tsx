import { Link } from 'wouter'
import type { Resource } from '../api.ts'
import { KIND_ORDER } from '../kinds.ts'
import { recordHref, selectHref } from '../hrefs.ts'
import { Empty } from '../design/Empty.tsx'
import { Icon, kindIcon } from '../design/Icon.tsx'
import { ButtonLink } from '../design/Button.tsx'
import { useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { RestrictedValue } from '../viewAs/VisibilityMarker.tsx'
import { restrictedHat, restrictedOf } from './restricted.ts'

/** §8.6's fixed radial template: where the first six neighbours sit around the record, in order. */
export const RADIAL = ['above-start', 'above-end', 'below-start', 'below-end', 'start', 'end'] as const
export type RadialPlace = (typeof RADIAL)[number]

/** Each place's point on the map (per cent of its box, start to end and top to bottom): the line from the record
 *  runs to it, under the neighbour's pill. css/map.css puts the pills there (`.mini-at-<place>`). */
const POINT: Record<RadialPlace, [number, number]> = {
  'above-start': [20, 20], 'above-end': [80, 20], 'below-start': [20, 80], 'below-end': [80, 80], start: [8, 50], end: [92, 50],
}

const at = (kind: string) => { const i = KIND_ORDER.indexOf(kind); return i < 0 ? KIND_ORDER.length : i }
/** A System's glyph is its driver's kind (a Safe's, a hat's); any other record's is its own. */
const glyphOf = (r: Resource) => kindIcon(r.kind === 'system' && typeof r.facts.kind === 'string' ? r.facts.kind : r.kind)

function Pill({ r, place, name, kept }: { r: Resource; place: RadialPlace; name: string; kept?: string }) {
  const attn = r.attention !== null
  const cls = attn ? 'mini-n is-attn' : 'mini-n'
  const body = <><Icon name={glyphOf(r)} size="xs" /><span className="mini-nm">{kept === undefined ? name : <RestrictedValue hat={kept} />}</span>{attn && <span className="mini-dot" aria-hidden="true" />}</>
  return (
    <span className={`mini-at mini-at-${place}`}>
      {r.kind === 'absent'
        ? <span className={cls} data-at={place}>{body}</span>
        : <Link href={recordHref(r.id)} className={cls} data-at={place} aria-label={attn ? `${name}, needs attention: ${r.attention!.text}` : undefined}>{body}</Link>}
    </span>
  )
}

/** The small map (§8.6): the record, outlined in ink, and up to six of its one-hop neighbours on a fixed radial
 *  template (`RADIAL`), each a 12px pill with its glyph and a link to its record, joined to it by straight lines; an
 *  8px clay dot on one that needs attention. Neighbours the viewer may not see are not drawn and not counted (§6.3).
 *  Past six (and `more` the caller did not send), "+N on the map"; "Open on the map" opens the full map with this
 *  record selected. 188px tall in the inspector, 220 on the record page (0.6's props draw the page's). */
export function MiniMap({ centre, neighbours, more = 0, size = 'page', entryOf }: {
  centre: Resource; neighbours: Resource[]; more?: number; size?: 'inspector' | 'page'
  entryOf?: (r: Resource) => Record<string, unknown> | undefined
}) {
  const { visible } = useViewer()
  const visibility = useVisibilitySource()
  // A name the viewer is not admitted to never prints its value (rule 3, E-70): it reads "<hat> only", drawn as
  // every restricted field is, and named the same in a link's accessible name and in the group's.
  const keptOf = (r: Resource): string | undefined => {
    const level = restrictedOf(entryOf?.(r)).name
    return level === undefined ? undefined : restrictedHat(level, visibility)
  }
  const nameOf = (r: Resource) => { const kept = keptOf(r); return kept === undefined ? r.name : `${kept} only` }
  const seen = visible(neighbours)
  if (seen.length === 0 && more === 0) return <Empty>Touches nothing yet.</Empty>
  const sorted = [...seen].sort((a, b) => at(a.kind) - at(b.kind) || nameOf(a).localeCompare(nameOf(b)))
  const shown = sorted.slice(0, RADIAL.length)
  const extra = sorted.length - shown.length + more
  const onMap = selectHref(centre.board, [centre.id])
  return (
    <div className="mini-w" role="group" aria-label={`What ${nameOf(centre)} touches`}>
      <div className={`mini mini-${size}`} data-testid="minimap">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {shown.map((n, i) => { const [x, y] = POINT[RADIAL[i]!]; return <line key={n.id} x1={50} y1={50} x2={x} y2={y} /> })}
        </svg>
        <span className="mini-at mini-at-centre">
          <span className="mini-n is-me" aria-current={size === 'page' ? 'page' : undefined}>
            <Icon name={glyphOf(centre)} size="xs" /><span className="mini-nm">{keptOf(centre) === undefined ? centre.name : <RestrictedValue hat={keptOf(centre)!} />}</span>
          </span>
        </span>
        {shown.map((n, i) => <Pill key={n.id} r={n} place={RADIAL[i]!} name={nameOf(n)} kept={keptOf(n)} />)}
      </div>
      <div className="mini-foot">
        <ButtonLink href={onMap} variant="ghost" icon="map" small>Open on the map</ButtonLink>
        {extra > 0 && <Link href={onMap} className="mini-more">+{extra} on the map</Link>}
      </div>
    </div>
  )
}
