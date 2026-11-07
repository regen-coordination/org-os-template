// packages/admin/server/private/reads.ts
//
// Private data as the gate reads it (L5 spec §9.5): a git record with the restricted fields the store holds for it, a
// private record, a private collection. A member is given what they are admitted to; a field they are not admitted to
// arrives as `restricted: { <field>: "<level>" }` (§11.5), with no value; a record or collection they are not admitted
// to is not there at all — no name, no count. The public is never given anything from here. The store being down
// never stops a read (Review Focus 4): its reads answer nothing, and the git side answers as it is.

import { REGISTRIES } from '../registries.ts'
import { admits, formatLevel, fullLevel, parseLevel, type ParsedLevel, type Viewer, type VisibilityPolicy } from '../../lib/visibility.mjs'
import { asUnavailable, type PrivateAccess } from './ops.ts'
import type { PrivateCollection, PrivateField, PrivateRecord, PrivateStore } from './store.ts'

/** What the gate reads from the store. Never throws: a store that cannot be reached, or fails to answer, reads as one
 *  holding nothing (its attention, §10.1, says why). */
export interface PrivateReads {
  collections(): PrivateCollection[]
  records(collection: string): PrivateRecord[]
  fields(registry: string, record: string): PrivateField[]
}

export const NO_PRIVATE: PrivateReads = Object.freeze({ collections: () => [], records: () => [], fields: () => [] })

/** The gate's reads of the store `access` reaches. A store that is not open reads as empty (its attention was raised when
 *  it failed to open); one that fails after it opened also reads as empty, and that failure is not swallowed: it goes to
 *  the server's log and is raised as the store's attention (`asUnavailable`), its own words never in an answer. */
export function privateReads(access: PrivateAccess): PrivateReads {
  const safely = <T>(fn: (store: PrivateStore) => T[]): T[] => {
    let store: PrivateStore
    try { store = access() } catch { return [] }
    try { return fn(store) } catch (err) { asUnavailable(err, store); return [] }
  }
  return {
    collections: () => safely(store => store.collections() as PrivateCollection[]),
    records: collection => safely(store => store.records(collection)),
    fields: (registry, record) => safely(store => store.fields(registry, record)),
  }
}

const KNOWN = new Set(REGISTRIES.map(r => r.name))

/** A level as the store holds it; one that does not parse admits nobody (no hat ref, so nobody wears it). */
export function levelOfToken(token: string): ParsedLevel {
  return parseLevel(token) ?? { level: 'hat', hat: token }
}

/**
 * A member's view of one record's fields (§9.5): every field of `record` (git's) and of `fields` (the store's, which
 * win over a value git still holds) they are admitted to; the others listed in `restricted` with the level that keeps
 * them out, never with their value. A store field is admitted when both its own level and the policy's level for the
 * field admit them. The record's own `visibility` is left for the caller to set.
 */
export function memberFields(viewer: Viewer, registry: string, record: Record<string, unknown>, config: VisibilityPolicy,
  fields: readonly PrivateField[] = []): Record<string, unknown> {
  // Maps, not plain objects written key by key: a field called `__proto__` stays a field.
  const out = new Map<string, unknown>()
  const restricted = new Map<string, string>()
  for (const [k, v] of Object.entries(record)) {
    if (k === 'visibility') continue
    const level = fullLevel(config, registry, record, k)
    if (admits(level, viewer)) out.set(k, v)
    else if (v !== undefined && v !== null) restricted.set(k, formatLevel(level))
  }
  for (const f of fields) {
    if (f.field === 'visibility' || f.field === 'id') continue
    const own: ParsedLevel = levelOfToken(f.visibility)
    const policy = fullLevel(config, registry, record, f.field)
    out.delete(f.field)
    if (admits(own, viewer) && admits(policy, viewer)) { out.set(f.field, f.value); restricted.delete(f.field) }
    else restricted.set(f.field, admits(own, viewer) ? formatLevel(policy) : f.visibility)
  }
  const view = Object.fromEntries(out)
  return restricted.size > 0 ? { ...view, restricted: Object.fromEntries(restricted) } : view
}

/** A private record as `viewer` may see it, with its level as `visibility`; null when they may not. `fields`: the
 *  restricted fields the store keeps for it beside its body (a git record narrowed out of git keeps them: R-L5-16.3). */
export function privateRecordView(viewer: Viewer, r: PrivateRecord, config: VisibilityPolicy, fields: readonly PrivateField[] = []): Record<string, unknown> | null {
  if (viewer.kind === 'public' || !admits(levelOfToken(r.visibility), viewer)) return null
  const record = { ...r.body, id: r.id, visibility: r.visibility }
  return { ...memberFields(viewer, r.collection, record, config, fields), visibility: r.visibility }
}

/** The private records of `collection` (a git collection's, or a private collection's) that `viewer` may see; a git
 *  collection's with the restricted fields the store keeps for each. */
export function privateEntries(viewer: Viewer, collection: string, reads: PrivateReads, config: VisibilityPolicy): Record<string, unknown>[] {
  if (viewer.kind === 'public') return []
  const kept = KNOWN.has(collection)
  return reads.records(collection).flatMap(r => {
    const v = privateRecordView(viewer, r, config, kept ? reads.fields(collection, r.id) : [])
    return v ? [v] : []
  })
}

/** The private collections `viewer` is admitted to (a name git knows is never one: git's wins). */
export function privateCollections(viewer: Viewer, reads: PrivateReads): PrivateCollection[] {
  if (viewer.kind === 'public') return []
  return reads.collections().filter(c => !KNOWN.has(c.id) && admits(levelOfToken(c.visibility), viewer))
}
