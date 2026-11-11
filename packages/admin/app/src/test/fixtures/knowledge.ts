/** The knowledge fixtures: the repo's own "Riverbend Commons" world, as the server answers it (server/knowledge/types.ts).
 *  Same counts the gallery draws, so a page test and the review look at one canon. */
import type { CanonRow, EntryView, KnowledgeView } from '../../api.ts'

const slugOf = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export const row = (lane: CanonRow['lane'], title: string, over: Partial<CanonRow> = {}): CanonRow => ({
  type: 'encyclopedia-entry', slug: slugOf(title), id: `encyclopedia-entry/${slugOf(title)}`,
  title, lane, why: lane === 'published' ? 'in the selection' : lane === 'awaiting' ? 'raw · written with AI help' : lane === 'internal' ? 'public use: internal only' : 'not public yet',
  mark: lane === 'published' ? { shape: 'done', word: 'Reviewed' } : lane === 'awaiting' ? { shape: 'aged', word: 'Raw' } : lane === 'internal' ? { shape: 'closed', word: 'internal' } : { shape: 'open', word: 'Open' },
  maturity: lane === 'awaiting' ? 'raw' : 'reviewed', publicUse: lane === 'internal' ? 'internal-only' : 'reviewed-for-guidance',
  updated: '2026-10-20', updatedDays: 9, summary: '', internal: lane === 'internal', awaiting: lane === 'awaiting',
  peer: null, readAge: null, readFailed: false, deprecated: null,
  pageHref: lane === 'published' ? `k/encyclopedia-entry/id-${slugOf(title)}.html` : null,
  apiHref: lane === 'published' ? `api/encyclopedia-entry/id-${slugOf(title)}.json` : null,
  atUri: null, ...over,
})

export function knowledgeView(over: Partial<KnowledgeView> = {}): KnowledgeView {
  const published = [row('published', 'Living mulch'), row('published', 'Cover cropping'), row('published', 'Rotational grazing')]
  const awaiting = [row('awaiting', 'Seed swap notes', { type: 'claim-evidence', id: 'claim-evidence/seed-swap-notes' })]
  const internal = [row('internal', 'Staff handbook')]
  return {
    configured: true, reason: null, instance: 'Riverbend Commons', did: 'did:plc:riverbendown',
    sentence: 'Field notes and practice from the Riverbend growers.',
    counts: { entries: 5, kinds: 3, sources: 1, peers: 1, published: 3, awaiting: 1, internal: 1, draft: 0 },
    lanes: [
      { id: 'draft', word: 'Draft', movesOn: 'Moves on: a field it still needs.', count: 0, rows: [] },
      { id: 'awaiting', word: 'Awaiting review', movesOn: 'Moves on: a person.', count: 1, rows: awaiting },
      { id: 'published', word: 'Published', movesOn: 'Moves on: a run.', count: 3, rows: published },
      { id: 'internal', word: 'Internal only', movesOn: 'Moves on: your decision.', count: 1, rows: internal },
    ],
    kinds: [
      { schema: 'claim-evidence', label: 'Claim evidence', glyph: 'quote', count: 1 },
      { schema: 'encyclopedia-entry', label: 'Encyclopedia entry', glyph: 'book', count: 4 },
    ],
    peers: [{ id: 'connector:atproto', name: 'atproto', relation: 'connector', detail: 'did:plc:hillsidepeer', state: 'failed', ageDays: 9, error: null }],
    runs: [],
    files: [
      { path: 'kms.yaml', what: 'adapter repo-data · target .', state: 'edited 6 d ago' },
      { path: 'data/kb/', what: '6 files', state: 'edited 6 d ago' },
      { path: 'data/kms-reads.json', what: '1 failure recorded', state: 'written 1 d ago' },
      { path: 'data/kms-cursors.json', what: 'where each connector reads next', state: 'written 1 d ago' },
      { path: 'public/', what: 'the public plane — written by a run, never here', state: 'not written yet' },
    ],
    rule: { module: null, sentence: 'Your rule decides nothing here: publish.gate is unset, so the floor decides what may be public, and a run writes it.' },
    plane: { dir: 'public', pages: true, static: true, atproto: true, lastRun: '2 d ago' },
    ...over,
  }
}

/** One entry as the server answers it (readEntry): living mulch, with its checks, its four references — one broken,
 *  one internal — its private fields, and the public face the commons renders. */
export function entryView(over: Partial<EntryView> = {}): EntryView {
  return {
    row: row('published', 'Living mulch', { mark: { shape: 'done', word: 'Reviewed' } }),
    checks: [
      { field: 'schema', mark: { shape: 'done', word: 'Valid' }, value: 'Valid', note: null },
      { field: 'required', mark: { shape: 'done', word: 'All present' }, value: 'All present', note: null },
      { field: 'references', mark: { shape: 'needs', word: '3 of 4 resolve' }, value: '3 of 4 resolve', note: '1 points at nothing' },
      { field: 'public use', mark: { shape: 'done', word: 'Its public use is published' }, value: 'reviewed-for-guidance', note: 'its public use is one that is published' },
      { field: 'your rule', mark: { shape: 'done', word: 'Selected' }, value: 'Selected', note: 'no rule of its own here: its public use decides' },
      { field: 'record', mark: { shape: 'done', word: 'Published' }, value: 'encyclopedia-entry/living-mulch', note: 'at://did:plc:riverbendown/org.riverbend.encyclopedia-entry/id-living-mulch' },
    ],
    fields: [
      { field: 'title', label: 'Title', value: 'Living mulch', kind: 'text' },
      { field: 'page_type', label: 'Page type', value: 'Concept', kind: 'text' },
      { field: 'maturity', label: 'Maturity', value: 'reviewed', kind: 'text' },
      { field: 'public_use', label: 'Public use', value: 'reviewed-for-guidance', kind: 'text' },
      { field: 'audience', label: 'Audience', value: 'Field crews', kind: 'text' },
      { field: 'steward', label: 'Steward', value: 'Field steward', kind: 'text' },
    ],
    body: [{ field: 'known_tensions', label: 'Known tensions', text: 'Competes with young seedlings for water.\nNeeds a mowing rhythm the crew can keep.' }],
    references: [
      { slug: 'cover-cropping', title: 'Cover cropping', kind: 'Concept lineage', glyph: 'branch', href: 'k/concept-lineage/id-cover-cropping.html', peer: null, mark: { shape: 'done', word: 'Field-informed' }, internal: false, broken: false },
      { slug: 'staff-handbook', title: 'Staff handbook', kind: 'Encyclopedia entry', glyph: 'book', href: null, peer: null, mark: { shape: 'done', word: 'Reviewed' }, internal: true, broken: false },
      { slug: 'seed-saving', title: 'Seed saving for small farms', kind: 'Resource', glyph: 'file', href: 'https://hillside.example/x', peer: 'hillside.example', mark: { shape: 'ok', word: 'Source-linked' }, internal: false, broken: false },
      { slug: 'no-such-note', title: 'no-such-note', kind: 'No entry', glyph: 'link', href: null, peer: null, mark: null, internal: false, broken: true },
    ],
    provenance: [
      { field: 'source_system', value: 'Riverbend Seed Library', published: true },
      { field: 'notes', value: 'ask about the neighbour’s field', published: false },
    ],
    goes: [
      { label: 'page', value: 'public/k/encyclopedia-entry/id-living-mulch.html' },
      { label: 'API', value: 'public/api/encyclopedia-entry/id-living-mulch.json' },
      { label: 'AT Proto', value: 'at://did:plc:riverbendown/org.riverbend.encyclopedia-entry/id-living-mulch' },
    ],
    publicFace: {
      published: true, title: 'Living mulch', lead: 'A cover crop kept growing between rows to hold soil and feed the next planting.',
      body: [{ field: 'known_tensions', label: 'Known tensions', text: 'Competes with young seedlings for water.' }],
      related: [{ slug: 'cover-cropping', title: 'Cover cropping', kind: 'Concept lineage', glyph: 'branch', href: 'k/concept-lineage/id-cover-cropping.html', peer: null, mark: { shape: 'done', word: 'Field-informed' }, internal: false, broken: false }],
      about: [['Kind', 'Encyclopedia entry'], ['Maturity', 'Reviewed'], ['Record', 'at://did:plc:riverbendown/org.riverbend.encyclopedia-entry/id-living-mulch']],
      atUri: 'at://did:plc:riverbendown/org.riverbend.encyclopedia-entry/id-living-mulch',
      cite: 'Credit the Riverbend Seed Library, CC BY.', reason: null,
    },
    file: 'data/kb/encyclopedia-entry.yaml', base: 'a'.repeat(64),
    ...over,
  }
}

export const preparedEdit = (over: Record<string, unknown> = {}) => ({
  type: 'encyclopedia-entry', slug: 'living-mulch', file: 'data/kb/encyclopedia-entry.yaml', base: 'a'.repeat(64), record: 'knowledge:encyclopedia-entry/living-mulch',
  changes: [{ field: 'audience', before: 'Field crews', after: 'Field crews · volunteer growers' }],
  classes: ['records'], rule: { direct: true, rule: 'solo/direct', sentence: 'Applies directly, in one commit, under solo/direct.' },
  text: 'entries: {}', ...over,
})
