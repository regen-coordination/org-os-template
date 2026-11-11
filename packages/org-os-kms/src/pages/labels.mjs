// packages/org-os-kms/src/pages/labels.mjs — the words the commons pages use. Pure data and small functions.
// Field headings are English here because standard-site adds none (a label must be in some language); an instance
// overrides them in kms.yaml `render.labels`, a pack in its pack.yaml `labels`.

export const LABELS = Object.freeze({
  // body fields named in FIELD_MAP (atproto/standard-site.mjs)
  summary: 'Summary',
  known_tensions: 'Known tensions',
  short_description: 'Short description',
  toolkit_usage: 'How the toolkit uses it',
  adjacent_meanings: 'Adjacent meanings',
  important_distinctions: 'Important distinctions',
  claim: 'Claim',
  evidence: 'Evidence',
  use_cases: 'Use cases',
  not_for: 'Not for',
  context: 'Context',
  scale: 'Scale',
  failure_modes: 'Failure modes',
  what_worked: 'What worked',
  what_failed: 'What failed',
  adaptations: 'Adaptations',
  what_returns_to_commons: 'What returns to the commons',
  audience: 'Audience',
  starting_context: 'Starting context',
  outcome: 'Outcome',
  what_it_curates: 'What it curates',
  why_it_matters: 'Why it matters',
  how_to_credit: 'How to credit',
  reuse_conditions: 'Reuse conditions',
  // the "About this entry" rows
  kind: 'Kind',
  page_type: 'Page type',
  maturity: 'Maturity',
  public_use: 'Public use',
  currentness: 'Currentness',
  steward: 'Steward',
  record: 'Record',
  // the related fields
  related_concepts: 'Related concepts',
  related_options: 'Related options',
  related_resources: 'Related resources',
  source_traditions: 'Source traditions',
});

const humanise = (s) => {
  const t = String(s).replace(/[_-]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
};

// render.labels (instance) > the pack's labels > LABELS > the field name, humanised.
export function labelFor(field, { config = {}, pack = null } = {}) {
  return config?.render?.labels?.[field]
    ?? pack?.labels?.[field] ?? pack?.manifest?.labels?.[field]
    ?? LABELS[field]
    ?? humanise(field);
}

export function kindLabel(schema) { return humanise(schema); }

// Spec §4-6: the mark shapes are the L4 §6.1 shapes; the word always travels with the mark.
const done = { shape: 'done' }; const ok = { shape: 'ok' }; const open = { shape: 'open' };
const aged = { shape: 'aged' }; const closed = { shape: 'closed' };
export const MATURITY_MARK = Object.freeze({
  reviewed: { ...done, word: 'Reviewed' },
  'field-informed': { ...done, word: 'Field-informed' },
  'pattern-generating': { ...done, word: 'Pattern' },
  'source-linked': { ...ok, word: 'Source-linked' },
  draft: { ...open, word: 'Draft' },
  candidate: { ...open, word: 'Candidate' },
  raw: { ...aged, word: 'Raw' },
  held: { ...aged, word: 'Held' },
  deprecated: { ...closed, word: 'Deprecated' },
  archived: { ...closed, word: 'Archived' },
});

// One callout sentence for the public_use values that carry a caveat (spec §4-6, §5.5).
export const CAVEATS = Object.freeze({
  'ok-with-caveat': 'Shared with a caveat. Read this entry as context, not as settled guidance.',
  'source-linked-unreviewed': 'Source-linked, not yet reviewed. This entry points to its sources, but no one has reviewed it yet.',
  'reviewed-for-explanation': 'Reviewed for explanation. This entry explains the idea; it is not yet guidance.',
});

// Spec §4-7: one glyph per schema; an unknown pack type falls back to the glyph of its maps_to_core type.
export const GLYPHS = Object.freeze({
  'encyclopedia-entry': 'book', 'concept-lineage': 'branch', 'claim-evidence': 'quote', 'option-entry': 'sliders',
  'implementation-record': 'hammer', track: 'route', 'source-system': 'database', resource: 'file', signal: 'radio',
  'relationship-record': 'link', deployment: 'layers', place: 'pin', 'territorial-unit': 'pin', 'data-stream': 'waves',
  organization: 'record', 'public-use-boundary': 'file',
});
export function glyphFor(schema, entities = {}) {
  return GLYPHS[schema] ?? GLYPHS[entities?.[schema]?.maps_to_core] ?? 'file';
}

// public_use as words for the "About" row ("reviewed-for-explanation" → "Reviewed for explanation").
export const publicUseWord = (v) => (v ? humanise(v) : null);
