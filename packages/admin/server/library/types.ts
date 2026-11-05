/** The library (design 2026-10-18, section 4): what an organization builds itself from. It reads the framework's
 *  shelf and the shelves an instance registers, and previews what adding an entry would change. */
export type Shelf = 'board' | 'block' | 'rules' | 'system' | 'module' | 'pattern' | 'practice' | 'tool' | 'case' | 'resource'
export type Standing = 'verified' | 'agent-read' | 'recorded' | 'stated'
export type Maturity = 'raw' | 'field-informed' | 'reviewed'

/** One op of an entry's `installs`: the change engine's own (create, update, replace, delete). */
export interface InstallOp { op: 'create' | 'update' | 'replace' | 'delete'; record: string; value?: Record<string, unknown>; set?: Record<string, unknown> }

/** An entry's manifest (library/entry.schema.json), or a built-in board seen as one (`builtin`). */
export interface LibraryEntry {
  id: string
  shelf: Shelf
  title: string
  summary: string
  version: string
  source: string
  standing: Standing
  as_of: string
  tags?: { function?: string[]; domain?: string[]; audience?: string[]; maturity?: Maturity }
  requires?: string[]
  related?: string[]
  installs?: InstallOp[]
  config?: { properties: Record<string, { type?: string; default?: unknown; description?: string }>; required?: string[] }
  replaces?: string
  builtin?: boolean
}

/** Whether the org has what an entry requires. `null` when it requires nothing. */
export interface Fits { met: boolean; missing: string[] }

/** One row of the browse list: the manifest without its values, and what it adds said in a line. */
export interface ListedEntry {
  id: string; shelf: Shelf; title: string; summary: string; version: string; source: string; standing: Standing; as_of: string
  maturity: Maturity | null; tags: NonNullable<LibraryEntry['tags']>; builtin: boolean; installable: boolean; adds: string; fits: Fits | null
  /** This entry's receipts that are still installed: when each add was made (null on a receipt never sealed). */
  added: { receipt: string; at: string | null }[]
}
/** Something a registered shelf left out, and why, in a sentence a person can act on. `shelf` is its name, or the path it was registered under when it has none. */
export interface ShelfProblem { shelf: string; sentence: string }
export interface LibraryList { sources: string[]; shelves: { shelf: Shelf; count: number }[]; entries: ListedEntry[]; problems: ShelfProblem[] }

/** What adding an entry would change, said before anything is added (design 4.5: preview = prepare). */
export interface LibraryPreview {
  id: string
  builtin: boolean
  adds: { record: string; op: string; class: string; summary: string }[]
  blocks: { id: string; type: string; title: string | null }[]
  roles: { id: string; sentence: string }[]
  rules: { id: string; sentence: string }[]
  needs: { text: string; met: boolean }[]
  asks: string[]
  /** What the entry asks the person for (its config), each with its default (null when it has none). */
  fields: { name: string; description: string | null; default: unknown; required: boolean }[]
  reaches: { host: string; reads: 'read only' }[]
  decided: { class: string; direct: boolean; sentence: string }[]
  source: { name: string; version: string; standing: Standing; as_of: string }
  refusal: { sentence: string; nextFreeId: string } | null
  /** Why it cannot be added, in the library's sentence, or null when it can (a taken id the person can change is a
   *  `refusal`, not this). */
  cannotAdd: string | null
  /** This entry's receipts in data/library.yaml, the ones still installed. */
  receipts: { id: string; at: string | null; by: string | null }[]
  note: string | null
}

/** What decided a receipt (ruling L1-R1): the rule and the change, for a change applied directly; the proposal, for
 *  one ratified (its decision row is found by its `proposal` field). */
export type ReceiptDecision = { rule: string; change: string } | { proposal: string }

/** One receipt of data/library.yaml (ruling L1-R1): what an add created, and who decided it; on removal, who removed
 *  it. `by`, `at`, `decision`, every `base` and `removed`'s fields are null only while staged. */
export interface Receipt {
  id: string; entry: string; version: string; shelf: string
  created: { record: string; base: string | null }[]
  status: 'installed' | 'removed'; by: string | null; at: string | null; decision: ReceiptDecision | null
  removed?: { by: string | null; at: string | null; decision: ReceiptDecision | null } | null
}

/** What removing a receipt would do, said before anything is staged. A record is `gone` when it is no longer on
 *  file, `edited` when it differs from the record as added, and `as added` otherwise; `referrers` are the records
 *  that still name it (`<registry>:<id>`), which the engine refuses a delete over. `asks` are the edited records a
 *  removal must name in `take`. `refusal` says when a removed receipt was removed. */
export interface RemovalPreview {
  receipt: string; entry: string; title: string | null
  records: { record: string; state: 'as added' | 'edited' | 'gone'; referrers: string[] }[]
  asks: string[]
  decided: { class: string; direct: boolean; sentence: string }[]
  refusal: string | null
}
