/** The knowledge commons as this server answers it — the shapes `app/src/api.ts` re-exports for the pages.
 *
 *  Everything here is read-only: the canon is kms's (R-35), and this lane reads it through kms's own adapter rather
 *  than parsing `data/kb/*.yaml` a second way. The one write (a prepared edit's apply, T3) is its own module. */

/** The four lanes, in the order the standline draws them (spec §3). */
export type LaneId = 'draft' | 'awaiting' | 'published' | 'internal'

/** What the mark on a row is: L4 §6.1's shape and its word, together (never colour alone). */
export interface Mark { shape: 'needs' | 'open' | 'ok' | 'done' | 'closed' | 'failed' | 'aged'; word: string }

/** One entry as the collection shows it. `why` is the reason it sits in its lane, on the row itself. */
export interface CanonRow {
  type: string
  slug: string
  /** The record id L6 names: `<type>/<slug>` (§7.5). */
  id: string
  title: string
  lane: LaneId
  why: string
  mark: Mark | null
  maturity: string | null
  publicUse: string | null
  updated: string | null
  /** Days since `updated`, against the same clock the rest of the answer uses. Null when the entry has no date. */
  updatedDays: number | null
  summary: string
  /** In the canon, not in the gate's selection: the preview's word for it. */
  internal: boolean
  /** kms's own review queue (`isAwaitingReview`). */
  awaiting: boolean
  /** Set when the entry was read from a peer: who, how old the read is, and whether the last read failed. */
  peer: string | null
  /** How old the read is, in kms's own words ("9 d"), when the entry came from a peer. */
  readAge: string | null
  readFailed: boolean
  deprecated: string | null
  /** The public paths, once published (null before a run). */
  pageHref: string | null
  apiHref: string | null
  atUri: string | null
}

export interface Lane { id: LaneId; word: string; movesOn: string; count: number; rows: CanonRow[] }

/** A kind as the collection counts it: the schema, its label, its glyph, and how many the canon holds. */
export interface KindRow { schema: string; label: string; glyph: string; count: number }

/** A peer or a connector, with the one thing a steward watches: when it was last read. */
export interface PeerRow {
  id: string
  name: string
  /** `knowledge peer` (a DID in `kms.yaml` peers), `connector` (a declared connector), or `not reached`. */
  relation: string
  detail: string
  state: 'fresh' | 'aged' | 'failed' | 'never'
  ageDays: number | null
  error: string | null
}

/** A run that touched the commons: the operation, its sentence, and what it changed. */
export interface RunRow {
  id: string
  op: string
  label: string
  status: string
  at: string
  sentence: string
  changed: string[]
}

/** One file the canon is, with the state a steward needs: exists, when it last changed. */
export interface CanonFile { path: string; what: string; state: string }

/** What the gate decides, in words the plate shows (spec §4.1). */
export interface RuleView {
  /** The instance's own `publish.gate` module, or null when it has none: then the floor decides everything. */
  module: string | null
  sentence: string
}

export interface KnowledgeView {
  /** False when this repository is not (yet) a kms instance: `reason` says so in one sentence. */
  configured: boolean
  reason: string | null
  instance: string | null
  did: string | null
  sentence: string | null
  counts: { entries: number; kinds: number; sources: number; peers: number; published: number; awaiting: number; internal: number; draft: number }
  lanes: Lane[]
  kinds: KindRow[]
  peers: PeerRow[]
  runs: RunRow[]
  files: CanonFile[]
  rule: RuleView
  /** The thousand-yard line: what would be written if a run went now, and what it would take back. */
  plane: { dir: string; pages: boolean; static: boolean; atproto: boolean; lastRun: string | null }
}

/** One row of the Checks block (spec §5-N5): a predicate, its mark, and the words. */
export interface CheckRow { field: string; mark: Mark; value: string; note: string | null }

/** A reference from this entry, with its target's state — which only the Record face shows. */
export interface RefRow { slug: string; title: string; kind: string; glyph: string; href: string | null; peer: string | null; mark: Mark | null; internal: boolean; broken: boolean }

/** A provenance row: a field, its value (or its absence), and whether the projection keeps it. */
export interface ProvenanceRow { field: string; value: string | null; published: boolean }

export interface FieldRow { field: string; label: string; value: string; kind: 'text' | 'longtext' | 'mono' | 'list' }

/** The public face: the object the commons renders, as `buildCommons` gives it for this entry. */
export interface PublicFace {
  published: boolean
  title: string
  lead: string
  body: { field: string; label: string; text: string }[]
  related: RefRow[]
  about: [string, string][]
  atUri: string | null
  cite: string | null
  reason: string | null
}

export interface EntryView {
  row: CanonRow
  checks: CheckRow[]
  fields: FieldRow[]
  body: { field: string; label: string; text: string }[]
  references: RefRow[]
  provenance: ProvenanceRow[]
  goes: { label: string; value: string }[]
  publicFace: PublicFace
  /** The text of the file the entry lives in, and its base: what a prepared edit starts from (T3). */
  file: string
  base: string
}

/** A prepared edit: nothing is written until Apply (R-32). `after` is the entry as the change leaves it. */
export interface PreparedEdit {
  type: string
  slug: string
  file: string
  /** The file's sha256 when the edit was prepared: Apply refuses if the file has moved since. */
  base: string
  /** The fields the edit changes, old and new, in the order the tray shows them. */
  changes: { field: string; before: unknown; after: unknown }[]
  /** The record op this edit is in the change engine (L6 Task 10): `knowledge:<type>/<slug>`, which Propose stages. */
  record: string
  /** The house's classes for this edit: the canon file's own (`workspace`, L6's row for `data/kb/**`), and `publication`
   *  beside it when the edit makes the entry publishable by the commons' floor (L5 §9.7, L6 §13 `publishes`). */
  classes: string[]
  /** What the house's rules say of it for the person who asked: whether Apply writes it directly, under which rule, and
   *  the sentence. Not direct: Apply refuses, and the card says why (review fix, R-45); `proposable`, the card offers
   *  Propose instead, which stages `record`'s op and opens the house's Propose (L6 Task 10, R-L6-T10-3). */
  rule: { direct: boolean; rule: string | null; sentence: string; proposable?: boolean }
  /** The file's text as Apply will write it. */
  text: string
}

/** The dry read: the selection run in memory, and nothing written (spec §4.4, N4). */
export interface DryRead {
  counts: { canon: number; selected: number; internal: number; awaiting: number; withheld: number }
  withheld: { slug: string; type: string; title: string; reason: string }[]
  broken: { slug: string; type: string; entry: string; fix: string }[]
  kinds: { schema: string; label: string; writes: number }[]
  peers: { name: string; state: string }[]
  /** The sentence that makes the promise: nothing was written. */
  writes: string
}

/** The prepared publication (spec §5-N3): a plan, a payload, and a key the app does not hold. */
export interface PublishPlan {
  ok: boolean
  /** kms's own refusal (a canon publishes nothing itself, a public plane fails its re-gate), or null. */
  refused: string | null
  command: string
  plane: string
  classes: string[]
  counts: { joins: number; unchanged: number; leaves: number; withheld: number; internal: number; awaiting: number }
  calls: { n: number; what: string; where: string }[]
  report: Record<string, unknown>
  /** What the plan was read from: the canon and the manifest, so a reader can tell the numbers are theirs. */
  from: string[]
}
