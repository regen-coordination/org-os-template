import type { Mark } from '../../../lib/machines/run.mjs'
import type { Resource } from '../api.ts'
import { factText } from '../kinds.ts'
import { StatusMark } from '../design/StatusMark.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'

export interface CardProps {
  record: Resource
  marks: Mark[]
  /** The record's registry entry: its fields, in its order; without one, the record's facts. */
  entry?: Record<string, unknown>
  /** The table's name, when its page names it (the record page's State); else "Fields of <name>". */
  label?: string
}

/** The marks the card says above its fields. */
const SAID: Mark[] = ['needs', 'stale', 'staged', 'running']
const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

/** One record's fields, read-only (spec §14.2: the record block that has no schema to draw its fields with): what
 *  it needs or has staged, in words, then a field row per field the entry (or the record's facts) holds. Every
 *  string is text. 0.6's row, tile, node and chip densities are gone: rows, map nodes and chips are the house's
 *  elements now (C10). */
export function Card({ record: r, marks, entry, label }: CardProps) {
  const fields = Object.entries(entry ?? r.facts).filter(([k, v]) => k !== 'driver' && k !== '__proto__' && !isEmpty(v))
  const words = marks.filter(m => SAID.includes(m))
  return (
    <div className="card full">
      {words.length > 0 && <p className="card-marks">{words.map(m => <StatusMark key={m} mark={m} />)}</p>}
      <FieldTable label={label ?? `Fields of ${r.name}`}>
        {fields.map(([k, v]) => <FieldRow key={k} label={k}><span className="wrap">{factText(v)}</span></FieldRow>)}
      </FieldTable>
    </div>
  )
}
