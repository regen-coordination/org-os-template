/** The knowledge model: pure functions over facts someone else computed. No file is read here, no clock taken, no
 *  kms module imported — so the lanes, the checks and the words can be tested against a table.
 *
 *  Spec: docs/superpowers/specs/2026-10-31-kms-admin-design.md §3 (the lanes and their precedence), §4.2 (checks,
 *  references, provenance), §5-N1–N5. */
import type { CanonRow, CheckRow, FieldRow, Lane, LaneId, Mark, ProvenanceRow, RefRow } from './types.ts'

/** The four lanes in pipeline order, with what moves a card out of each. The standline draws the gates in the gaps
 *  from these words (`Lane.movesOn`). */
export const LANES: readonly { id: LaneId; word: string; movesOn: string }[] = [
  { id: 'draft', word: 'Draft', movesOn: 'Moves on: a field it still needs.' },
  { id: 'awaiting', word: 'Awaiting review', movesOn: 'Moves on: a person.' },
  { id: 'published', word: 'Published', movesOn: 'Moves on: a run.' },
  { id: 'internal', word: 'Internal only', movesOn: 'Moves on: your decision.' },
]

/** What the lanes are computed from: the object's own axes, and what the gate made of it. */
export interface LaneFacts {
  publicUse: string | null
  maturity: string | null
  /** kms's `isAwaitingReview`: raw, held, or written with AI help. */
  awaiting: boolean
  /** `ai_assisted: true` — the object's own flag, so the row can say which of the queue's reasons applies. */
  aiAssisted: boolean
  /** The framework floor: `isPublishable(object, { schema })`. */
  publishable: boolean
  /** In the instance gate's selection (`selectPublic`). */
  selected: boolean
  /** The instance gate's reason when it withheld the entry, else null. */
  rejected: string | null
  /** The schema is one this instance may publish (`publishableTypes`), so a draft's reason can say so. */
  optedIn: boolean
}

/**
 * The lane an entry is in, and why, from one predicate each, taken in this order: **internal > awaiting > published >
 * draft**. A steward's decision outranks a person's turn, which outranks the selection, which outranks not-yet-ready
 * (spec §3, K-3). `held` is a withdrawal, so it outranks the review queue it would otherwise sit in.
 */
export function laneOf(f: LaneFacts): { lane: LaneId; why: string } {
  if (f.publicUse === 'internal-only') return { lane: 'internal', why: 'public use: internal only' }
  if (f.maturity === 'held') return { lane: 'internal', why: 'withdrawn · maturity held' }
  if (f.awaiting) {
    const why = [f.maturity === 'raw' ? 'raw' : null, f.aiAssisted ? 'written with AI help' : null].filter(Boolean).join(' · ') || 'in the review queue'
    // kms's floor does not read the review queue: an entry in it with a publishable public use is selected, and a run
    // publishes it as it stands. The lane stays a person's turn (K-3); the row must not hide what the run will do.
    return { lane: 'awaiting', why: f.selected ? `${why} · selected: a run publishes it unreviewed` : why }
  }
  if (f.rejected !== null) return { lane: 'internal', why: `your rule: ${f.rejected}` }
  if (f.selected) return { lane: 'published', why: 'in the selection' }
  if (!f.optedIn) return { lane: 'draft', why: 'this kind is opt-in, and this instance has not opted in' }
  if (f.publicUse === null || f.publicUse === '') return { lane: 'draft', why: 'no public use yet' }
  if (f.publicUse === 'not-public-yet') return { lane: 'draft', why: 'not public yet' }
  if (!f.publishable) return { lane: 'draft', why: `its public use, ${f.publicUse}, is not one that is published` } // walk W7, D3: no "floor"
  return { lane: 'draft', why: 'not in the selection' }
}

/** The four lanes with their rows, in pipeline order. Every row lands in exactly one lane. */
export function groupLanes(rows: CanonRow[]): Lane[] {
  return LANES.map(l => ({ ...l, count: rows.filter(r => r.lane === l.id).length, rows: rows.filter(r => r.lane === l.id) }))
}

/** The count line the plate shows, from the grouped lanes. */
export function laneCounts(lanes: Lane[]): { published: number; awaiting: number; internal: number; draft: number } {
  const of = (id: LaneId) => lanes.find(l => l.id === id)?.count ?? 0
  return { published: of('published'), awaiting: of('awaiting'), internal: of('internal'), draft: of('draft') }
}

/** The facts one check row is built from. `invalid` is kms's own schema validation of the object. */
export interface CheckFacts {
  validating: { ok: boolean; errors: string[] }
  requiredFields: { missing: string[] }
  references: { resolved: number; total: number }
  publicUse: string | null
  publishable: boolean
  selected: boolean
  rejected: string | null
  id: string | null
  atUri: string | null
  /** An instance rule (`publish.gate`) ran, so a selected entry passed it as well as the floor. */
  gated?: boolean
  /** The entry's kind is one this instance publishes (an opt-in kind it has not opted into is not). Absent: it is. */
  optedIn?: boolean
}

/** Walk D5: why an entry is not in the selection, in words a member reads (no "floor", no file): its public use first,
 *  then its kind, else the next run decides. A rule's own reason is said by the row itself (`rejected`). */
export function notSelectedWhy(f: Pick<CheckFacts, 'publicUse' | 'publishable' | 'optedIn'>): string {
  if (f.optedIn === false) return 'not in the selection: entries of this kind are not published here'
  if (!f.publishable) {
    if (f.publicUse === null || f.publicUse === '') return 'not in the selection: it has no public use yet'
    if (f.publicUse === 'not-public-yet') return 'not in the selection: its public use is not public yet'
    if (f.publicUse === 'internal-only') return 'not in the selection: its public use is internal only'
    return `not in the selection: its public use, ${f.publicUse}, is not one that is published`
  }
  return 'not in the selection yet: the next run’s selection decides'
}

const ok = (word: string): Mark => ({ shape: 'done', word })
const needs = (word: string): Mark => ({ shape: 'needs', word })
const open = (word: string): Mark => ({ shape: 'open', word })
const closed = (word: string): Mark => ({ shape: 'closed', word })

/** The Checks block (spec §5-N5): six rows, each a predicate kms or the gate already computes. Five pass on the
 *  gallery's entry; the failing one is a reference, and its fix is the row's own words. */
export function checksOf(f: CheckFacts): CheckRow[] {
  const rows: CheckRow[] = []
  rows.push({
    field: 'schema', mark: f.validating.ok ? ok('Valid') : needs(`Not valid`),
    value: f.validating.ok ? 'Valid' : `${f.validating.errors.length} ${f.validating.errors.length === 1 ? 'problem' : 'problems'}`,
    note: f.validating.ok ? null : f.validating.errors[0] ?? null,
  })
  rows.push({
    field: 'required', mark: f.requiredFields.missing.length === 0 ? ok('All present') : needs('Missing'),
    value: f.requiredFields.missing.length === 0 ? 'All present' : f.requiredFields.missing.join(', '),
    note: f.requiredFields.missing.length === 0 ? null : 'a required field is empty',
  })
  const refsBad = f.references.total - f.references.resolved
  rows.push({
    field: 'references', mark: refsBad === 0 ? ok(`${f.references.total} resolve`) : needs(`${f.references.resolved} of ${f.references.total} resolve`),
    value: `${f.references.resolved} of ${f.references.total} resolve`,
    note: refsBad === 0 ? null : `${refsBad} point${refsBad === 1 ? 's' : ''} at nothing`,
  })
  rows.push({
    // walk W7, D3: members read the checks: kms's "floor" is the setup page's word
    field: 'public use', mark: f.publishable ? ok('Its public use is published') : open(f.publicUse ?? 'none'),
    value: f.publicUse ?? '—',
    note: f.publishable ? 'its public use is one that is published' : 'its public use is not one that is published',
  })
  rows.push({
    field: 'your rule', mark: f.selected ? ok('Selected') : f.rejected !== null ? needs('Withheld') : closed('Not selected'),
    value: f.selected ? 'Selected' : f.rejected !== null ? 'Withheld' : 'Not selected',
    note: f.rejected ?? (f.selected ? (f.gated ? 'its public use and your rule both let it through' : 'no rule of its own here: its public use decides') : notSelectedWhy(f)),
  })
  rows.push({
    field: 'record', mark: f.id ? ok('Published') : open('None yet'),
    value: f.id ?? 'none yet',
    note: f.atUri ?? (f.id ? null : 'a run mints ids'),
  })
  return rows
}

/** A reference row's words, from what the projection made of the reference. */
export function refRow(r: { slug: string; title: string; kindLabel: string; glyphType: string; href: string | null; peer: string | null; mark: Mark | null; internal?: boolean; broken?: boolean }): RefRow {
  return {
    slug: r.slug, title: r.title, kind: r.kindLabel, glyph: r.glyphType, href: r.href, peer: r.peer,
    mark: r.mark ?? null, internal: r.internal === true, broken: r.broken === true,
  }
}

/** The provenance block: the fields the projection drops, and the ones it keeps. Only the Record face shows the
 *  first, with "not published" beside each (spec §4.2). */
export function provenanceOf(object: Record<string, unknown>, privateFields: readonly string[]): ProvenanceRow[] {
  const rows: ProvenanceRow[] = []
  const text = (v: unknown): string | null => {
    if (v === null || v === undefined) return null
    if (Array.isArray(v)) return v.map(x => String(x)).join(', ') || null
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v) || null
  }
  for (const field of ['source_system', 'source_lineage', 'viaUri', 'provenance'] as const) {
    const value = text(object[field])
    if (value !== null) rows.push({ field, value, published: true })
  }
  for (const field of privateFields) {
    if (!(field in object)) continue
    rows.push({ field, value: text(object[field]), published: false })
  }
  return rows
}

/** The fields the record shows above the body, in `FIELD_MAP`'s order and then the rest (spec §4.2). */
export function fieldRows(entries: [string, string][], labels: Record<string, string>): FieldRow[] {
  return entries.map(([field, value]) => ({ field, label: labels[field] ?? field, value, kind: 'text' as const }))
}

/** Days between a date and the answer's clock, or null. Whole days, floored: "9 d", never "8.6 d". */
export function daysSince(date: string | null, now: string): number | null {
  if (!date) return null
  const then = Date.parse(date)
  const at = Date.parse(now)
  if (Number.isNaN(then) || Number.isNaN(at)) return null
  return Math.max(0, Math.floor((at - then) / 86_400_000))
}

/** A read state, from when it last succeeded and what the last attempt said (kms's `data/kms-reads.json`, whose rule
 *  is: `ok_at` moves only on success). Seven days is the age at which a read is "aged" (KI K-7). */
export function readState(reads: { ok_at?: string | null; attempt_at?: string | null; error?: string | null } | null | undefined, now: string): { state: 'fresh' | 'aged' | 'failed' | 'never'; ageDays: number | null; error: string | null } {
  const okAt = reads?.ok_at ?? null
  const age = daysSince(okAt, now)
  if (reads?.error) return { state: 'failed', ageDays: age, error: String(reads.error) }
  if (okAt === null) return { state: 'never', ageDays: null, error: null }
  return { state: age !== null && age > 7 ? 'aged' : 'fresh', ageDays: age, error: null }
}
