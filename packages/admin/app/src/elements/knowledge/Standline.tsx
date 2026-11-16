import { Icon, type IconName } from '../../design/Icon.tsx'
import { StatusMark } from '../../design/StatusMark.tsx'
import { DataList } from '../rows/DataList.tsx'
import { DataRow } from '../rows/DataRow.tsx'
import type { CanonRow, KnowledgeView, Lane } from '../../api.ts'
import { kindGlyph, LANE_MARK, markOf } from './marks.ts'

export { kindGlyph } from './marks.ts'

/** The gate's own words, in the gap between lanes: what moves a row on (spec §3, §5-N1). */
const GATE_OF: Record<string, { glyph: IconName; words: string }> = {
  awaiting: { glyph: 'needs', words: 'a person reads it' },
  published: { glyph: 'check', words: 'your rule' },
  internal: { glyph: 'arrow-right', words: 'a run applies it' },
}

/** One row: the house's data row (§9.2, spec §4.1: "cards are house data rows") — the kind's tile, the title, the
 *  reason it is in this lane, and how old it is. A peer's entry carries its peer's name; a deprecated one keeps the
 *  closed mark (KI K-25: never `--o-dim`). Awaiting review turns the tile clay, as the house's needs mark does. */
export function CanonDataRow({ row, href }: { row: CanonRow; href?: string }) {
  return (
    <DataRow
      kind={row.type} icon={kindGlyph(row.type)} title={row.title} href={href}
      tone={row.lane === 'awaiting' ? 'attn' : 'plain'}
      second={<>
        {row.mark && <StatusMark mark={markOf(row.mark.shape)} label={row.mark.word} />}
        <span>{row.why}</span>
        {row.peer && <span className="mono">from {row.peer} ↗</span>}
        {row.deprecated && <span>superseded by {row.deprecated}</span>}
      </>}
      trailing={row.updatedDays !== null ? <span className="faint">{row.updatedDays} d</span> : undefined}
      marks={[]}
    />
  )
}

/** N1 · The standline: four lanes in pipeline order, the gate that decides each move standing in the gap, and a
 *  grouped list at a narrow frame — both drawn from one array, so the two cannot disagree (spec §5-N1, R-26). Each
 *  lane's rows are a house DataList of data rows (review fix: no hand-drawn row). */
export function Standline({ view, hrefOf }: { view: KnowledgeView; hrefOf?: (row: CanonRow) => string }) {
  const head = (lane: Lane) => (
    <div className="lane-h">
      <div className="t">
        <StatusMark mark={LANE_MARK[lane.id].mark} label={LANE_MARK[lane.id].word} />
        <span className="c">{lane.count}</span>
      </div>
      <div className="moves">{lane.movesOn}</div>
    </div>
  )
  const rows = (lane: Lane) => lane.count === 0
    ? (
        <div className="lane-empty">
          <p className="note note-empty"><Icon name="dashed-circle" size="sm" /><span className="note-t">
            {lane.id === 'draft' ? 'Nothing in draft. New adds an entry; it stays out of the commons until a run.'
              : lane.id === 'internal' ? 'One decision, not a backlog.' : `Nothing ${lane.id === 'awaiting' ? 'waits for a person' : 'published'} yet.`}
          </span></p>
        </div>
      )
    : (
        <div className="lane-rows">
          <DataList label={LANE_MARK[lane.id].word}>
            {lane.rows.slice(0, 5).map(r => <CanonDataRow key={r.id} row={r} href={hrefOf?.(r)} />)}
          </DataList>
        </div>
      )
  const foot = (lane: Lane) => lane.count > 5 ? (
    <div className="lane-foot">
      <a className="btn sm" href={`#lane-${lane.id}`}>Show all {lane.count}</a>
    </div>
  ) : null
  return (
    <>
      <div className="lanes">
        {view.lanes.map((lane, i) => (
          <span key={lane.id} className="contents">
            {i > 0 && (
              <div className="gate" aria-hidden="true">
                <div className="g">
                  <Icon name={GATE_OF[lane.id]?.glyph ?? 'arrow-right'} size="sm" />
                  <span>{GATE_OF[lane.id]?.words ?? 'on'}</span>
                </div>
              </div>
            )}
            <div className="lane" id={`lane-${lane.id}`}>
              {head(lane)}
              {rows(lane)}
              {foot(lane)}
            </div>
          </span>
        ))}
      </div>
      <div className="lanes-list">
        {view.lanes.map(lane => (
          <div className="lane-l" key={lane.id} id={`lane-${lane.id}-list`}>
            {head(lane)}
            {rows(lane)}
            {foot(lane)}
          </div>
        ))}
      </div>
    </>
  )
}
