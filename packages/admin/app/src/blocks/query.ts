// The board source language lives in the lib (P4c), so validate:data and the server's staging run the
// same evaluator the blocks do. This file keeps P4b's signatures: sections are chosen here, through
// sections.ts, because only the client knows how a section picks its systems (C-4).
import { fieldOf as libFieldOf, matches, runQuery as libRunQuery } from '../../../lib/board-query.mjs'
import type { Resource } from '../api.ts'
import { inSection, sectionById, type SystemEntries } from '../sections.ts'
import type { BlockData, RecordSource } from './types.ts'

export { matches }

/** A record's field as a source reads it (lib/board-query.mjs fieldOf); `entry`, its file entry, for the rest. */
export const fieldOf = (r: Resource, field: string, entry?: Record<string, unknown>): unknown => libFieldOf(r, field, entry)

/** The records a source names; `entryOf` gives a record's file entry, for fields its Resource lacks. */
export function runQuery(source: RecordSource, records: Resource[], systems: SystemEntries = new Map(),
  entryOf?: (r: Resource) => Record<string, unknown> | undefined): Resource[] {
  return libRunQuery(source, records, {
    entryOf,
    inSection: (id: string, r: Resource) => { const def = sectionById(id); return def !== undefined && inSection(def, r, systems) },
  })
}

/** Does this source's list depend on `data/systems.yaml`: a section that sorts systems by their entry (Treasury, Sources,
 *  Outside systems, review I-2)? Without the file read, each of its systems falls out of it. */
export const sortsSystems = (source: RecordSource | undefined): boolean =>
  source?.section !== undefined && sectionById(source.section)?.systems !== undefined

/** What a block over such a source draws until `data/systems.yaml` has answered: loading while it is read, its error once
 *  it failed — never the empty answer. Null when it has answered, or the source does not depend on it. */
export function systemsWait(source: RecordSource | undefined, read: { pending: boolean; error: Error | null }): BlockData | null {
  if (!sortsSystems(source)) return null
  if (read.error) return { state: 'error', error: read.error.message }
  return read.pending ? { state: 'loading' } : null
}
