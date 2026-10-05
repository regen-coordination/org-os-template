// The canon publication gate. Fail closed.
//
// ONE NOTATION (round 4). A source_lineage is exactly one thing: a workspace-relative corpus
// path, `repos/<Repo>/<path…>`. That is what the batch selector emits (path.relative(root, abs))
// and it is what every fixture and every canon object uses. A URL, a path outside `repos/<Repo>/`,
// or a bare repo root is NOT a lineage — it is unresolvable, and unresolvable is refused.
// (Precisely: a LEADING slash is dropped by lineageKey along with every other empty segment, so
// `/repos/X/y.md` denotes the same document as `repos/X/y.md` and resolves. An absolute path that
// does not begin with the corpus root — `/Users/…/repos/X/y.md` — does not.)
//
// ONE SPELLING, AND PROVENANCE COUNTS (final whole-branch review). Two seams closed together,
// because both come from the same fact: the SITE reads an object's lineage as text, while the gate
// reads it through lineageKey.
//   (a) allLineages() now also yields `provenance.origin` and `provenance.adapted_from`. The site
//       derives an object's displayed origin as `provenance.origin -> source_lineage -> url`, so a
//       clean source_lineage beside a held or unregistered provenance.origin used to publish and
//       then print the held path. `url` is excluded on purpose — it is a link, not a lineage; see
//       allLineages.
//   (b) An OBJECT's lineage must already be written canonically (case aside). The gate no longer
//       repairs `/repos/X/a.md`, `repos//X/a.md`, `./repos/X/a.md`, `repos/X%2DY/a.md` or
//       `repos/A/../X/a.md` for itself, because the site cannot repair them and mis-attributes
//       them. CONTROL DATA is unaffected: card prefixes, held_prefixes and boundary records keep
//       being matched in lineageKey space, where notation-robustness is a safety property.
//
// BOUNDARIES ARE EXACT-KEY (round 5). A public-use-boundary record names ONE document: its
// lineageKey must equal the object's, character for character. There is no prefix matching here —
// a boundary on `repos/X/content/` does NOT cover `repos/X/content/a.md`. To hold a whole
// directory back, use a source-system card's `held_prefixes`, which is the prefix-shaped control.
// validateBoundaries() reports a record written as though it were a prefix.
//
// MALFORMED CONTROL DATA FAILS THE CARD CLOSED (round 5). A `held_prefixes` that is present but
// unreadable — a string because the author dropped the `- `, or a list where no entry can hold
// anything — makes its card refuse everything it claims. An ABSENT `held_prefixes` is different:
// it legitimately means "this card holds nothing back". The asymmetry is the whole point: silence
// is a choice, gibberish is an error.
//
// Rounds 1–3 tried to reconcile GitHub-URL lineages with corpus-path lineages: route stripping
// (blob|tree|raw|blame), suffix expansion for refs of unknowable length, card-scoped boundary
// keys, a memoised index rebuild. Eleven of fourteen review findings came out of that machinery,
// each round's fix opening the next round's hole. It is deleted, not patched. Nothing produces
// URL lineages, so nothing is lost; anything that did would now be refused rather than silently
// mis-resolved.
//
// A card registers its corpus with origin_prefixes of the form `repos/<Repo>/`. Because a prefix
// is always exactly two segments, at most one prefix per card can ever match a given lineage —
// there is no "longest match", no precedence, and therefore no way for a broad card to suppress a
// narrow one. Every card that claims a lineage is assessed, and any one of them can refuse it.
//
// validateCards() reports cards whose prefixes or held_prefixes are dead text, so a control that
// does nothing is loud rather than silent. The gate's own safety never depends on it.

export const NEVER_RENDERED_TYPES = ['public-use-boundary', 'source-system'];
export const BLOCKED_PUBLIC_USE = ['raw-lead', 'internal-only'];
const PROMOTED_MATURITIES = ['reviewed'];
const NEVER_PUBLISH_TIER = 'never-publish-without-consent';

// A card prefix: normalised, with exactly one trailing slash. `repos/` alone does NOT qualify —
// it needs a repo segment, or a card would claim the entire workspace.
export const CORPUS_PREFIX_RE = /^repos\/[^/]+\/$/;
// A lineage: normalised, no trailing slash, and something under the repo root.
export const CORPUS_LINEAGE_RE = /^repos\/[^/]+\/.+$/;

const NUL = String.fromCharCode(0);

const normStr = (v) => String(v ?? '').trim().toLowerCase();
// 'internal_only', 'internal only', 'internal-only' must compare equal.
const normKey = (v) => normStr(v).replace(/[_\s]+/g, '-');
const NEVER_RENDERED_NORM = new Set(NEVER_RENDERED_TYPES.map(normKey));
const BLOCKED_PUBLIC_USE_NORM = new Set(BLOCKED_PUBLIC_USE.map(normKey));

// Anything other than false / "false" counts as flagged. Absence = unassessed, left alone.
export function isRiskFlagged(value) {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === 'string' && normStr(value) === 'false') return false;
  return true;
}

/** Whether a source-system card's OWN public_use/high_risk would have the gate refuse every
 *  document under it, independent of any specific lineage or held_prefixes. Mirrors the per-card
 *  checks inside evaluate() below so a consumer outside the gate (the sources projection at
 *  scripts/build-commons-sources.mjs) can ask "would the gate ever publish from this container?"
 *  without re-deriving BLOCKED_PUBLIC_USE or the unassessed rule — two copies of this rule
 *  drifting apart is exactly how a page can tell a reader something the pipeline contradicts.
 *
 *  `unassessed` is broken out from `blocked` because it names a different situation: no public_use
 *  at all is an operator to-do (nobody has decided yet), not a deliberate boundary like
 *  `internal-only` or `raw-lead`. Both are still `blocked: true` — the gate refuses either way. */
export function cardPublicationVerdict(card) {
  if (isRiskFlagged(card?.high_risk)) return { blocked: true, unassessed: false };
  const pu = normKey(card?.public_use);
  if (BLOCKED_PUBLIC_USE_NORM.has(pu)) return { blocked: true, unassessed: false };
  if (!pu) return { blocked: true, unassessed: true };
  return { blocked: false, unassessed: false };
}

/** Cosmetic trim only — NOT a comparison key. */
export function trimLineage(lineage) {
  return typeof lineage === 'string' ? lineage.trim().replace(/\/+$/, '') : '';
}

// Percent-decode to a fixed point, capped at 3 passes (defeats double/triple encoding like
// %252e%252e without looping forever). A pass that throws, or a result that still carries a raw
// '%' once we stop, is malformed/adversarial input — fail closed to null, never guess.
function decodePercentToStable(s) {
  let cur = s;
  for (let i = 0; i < 3; i += 1) {
    let next;
    try {
      next = decodeURIComponent(cur);
    } catch {
      return null;
    }
    if (next === cur) return cur.includes('%') ? null : cur;
    cur = next;
  }
  return cur.includes('%') ? null : cur;
}

/** The shared pipeline behind lineageKey and canonicalLineage: percent-decode to a fixed point,
 *  strip query/fragment, resolve dot segments (which also collapses duplicate and trailing
 *  slashes). Returns the resolved segments, or null when the input fails closed (non-string, null
 *  byte, malformed percent-encoding, or a `..` that pops past the start). */
function canonicalSegments(raw) {
  if (typeof raw !== 'string' || raw.includes(NUL)) return null;
  const trimmed = raw.trim().replace(/[?#].*$/, '');
  const decoded = decodePercentToStable(trimmed);
  if (decoded === null) return null;
  const s = decoded.replace(/[?#].*$/, '');
  const resolved = [];
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    resolved.push(seg);
  }
  return resolved;
}

/** Canonical comparison key: percent-decoded to a fixed point, query/fragment and trailing slash
 *  stripped, dot-segment-resolved (which also collapses duplicate slashes), Unicode-normalised to
 *  NFC, lowercased. Normalising to NFC means an NFD spelling (accents as combining marks — what
 *  macOS filesystem APIs routinely hand back) and the NFC spelling of the same path (accents
 *  precomposed — what a human types or pastes) compare equal, including when the NFD form arrived
 *  percent-encoded, since normalisation runs on the fully-decoded string. Non-strings, strings with
 *  a null byte, malformed percent-encoding, or a `..` that pops past the start all fail closed to
 *  ''.
 *
 *  Idempotent by construction: the output never contains an undecoded '%', a '.'/'..' segment, a
 *  duplicate or trailing slash, or an uppercase character, so a second call is always a no-op. */
export function lineageKey(raw) {
  const segs = canonicalSegments(raw);
  return segs === null ? '' : segs.join('/').normalize('NFC').toLowerCase();
}

/** lineageKey's CASE-PRESERVING twin: the same normalisation, without the lowercasing. This is the
 *  spelling an operator should write — `repos/ReFi-Barcelona/notes/x.md`, not the all-lowercase
 *  key — and it exists so the non-canonical refusal below can name the fix instead of only naming
 *  the fault. Always lowercases to lineageKey(raw) by construction. '' on the same fail-closed
 *  inputs. NOT a comparison key: two spellings differing only in case produce two different
 *  strings here, which is the whole point. */
export function canonicalLineage(raw) {
  const segs = canonicalSegments(raw);
  return segs === null ? '' : segs.join('/').normalize('NFC');
}

/** ONE SPELLING (final review, seam 2). The gate matches lineages in lineageKey space, but the
 *  site buckets objects into source containers by a lowercase prefix test on the RAW string. Three
 *  normalisations of one path cannot be kept in step: `/repos/X/a.md`, `repos//X/a.md`,
 *  `./repos/X/a.md`, `repos/X%2DY/a.md` and `repos/A/../X/a.md` all pass the gate and then show up
 *  on the public page as "Unattributed" — or, worse, attributed to the WRONG container. So an
 *  OBJECT's lineage must already be written canonically; the gate no longer accepts a spelling it
 *  would have to repair.
 *
 *  Canonical means: NFC-normalised and trimmed, case aside, the raw string already is what
 *  canonicalLineage would produce from it. Case is deliberately NOT forced — `repos/ReFi-Barcelona/`
 *  is the real directory name and must survive to the page.
 *
 *  Returns a refusal reason, or null when the lineage is acceptable HERE. Two things pass:
 *   - a canonical lineage (the normal case);
 *   - a lineage whose canonical form is not corpus-path shaped at all (a URL, a bare repo root, a
 *     `..` escape). Those can never resolve however they are spelled, and the later
 *     `unresolvable source_lineage` refusal names that accurately; telling an operator to "write
 *     the URL as https:/github.com/…" would be advice to write something equally unusable. They
 *     are still refused — just downstream, and by the check that actually describes them.
 *
 *  Control data (card prefixes, held_prefixes, boundary records) is NOT subject to this: it is
 *  matched, never displayed, and lineageKey's notation-robustness there is a safety property —
 *  see the direct helper coverage in tests/kms/publication-gate.test.mjs. */
function nonCanonicalReason(raw) {
  const key = lineageKey(raw);
  if (!CORPUS_LINEAGE_RE.test(key)) return null; // unresolvable in any spelling — named later
  const asWritten = typeof raw === 'string' ? raw.trim().normalize('NFC') : '';
  if (asWritten.toLowerCase() === key) return null;
  // A '?' or '#' in the RAW string is a case apart, and it is not hypothetical: two files in the
  // live ReFi-Barcelona corpus are literally named `What is BioFi?.md` and `What is a BFF?.md`.
  // lineageKey strips everything from the first '?'/'#' as a URL query/fragment, so the key for
  // such a path is a TRUNCATED, different document — it would collide with a real neighbouring
  // `What is BioFi.md`, and no held_prefix or boundary could ever name the real file precisely.
  // The gate cannot faithfully key this lineage, so it refuses it; what it must NOT do is suggest
  // the truncation as the fix, which is what naming "the canonical form" would amount to here.
  // (lineageKey's stripping is deliberate and unchanged — a lineage is a corpus path, and the
  // notation was settled in round 4. Renaming the two files, or recording a lineage without the
  // character, is the operator-side fix; it is queued as a precondition of first publication.)
  if (/[?#]/.test(asWritten)) {
    return `source_lineage ${JSON.stringify(raw)} contains "?" or "#", which the lineage key truncates — it cannot be keyed faithfully; rename the file or record a lineage without it`;
  }
  const suggestion = canonicalLineage(raw) || key;
  return `non-canonical source_lineage: ${JSON.stringify(raw)} — write it as ${JSON.stringify(suggestion)}`;
}

// Exported so a case-preserving display twin of the url: fallback (build-commons-sources.mjs) can
// reuse the exact same capture rather than re-deriving it and risking drift.
export const GITHUB_REPO_RE = /^https?:\/\/github\.com\/[^/]+\/([^/?#]+)/i;

/** A card's corpus-path prefixes: normalised, each with exactly one trailing slash, each of the
 *  form `repos/<repo>/`. Entries of any other shape (a URL, a bare `repos/`, a deeper path, a
 *  non-string) do not qualify and are simply not prefixes — validateCards reports them.
 *
 *  If no origin_prefixes entry qualifies (including the `origin_prefixes: []` case) and `url` is a
 *  GitHub URL, `repos/<repo>/` is derived from it, so a card that only records its upstream still
 *  claims its checkout. The trailing slash is load-bearing: without it `repos/ReFi-Barcelona`
 *  would also match `repos/ReFi-Barcelona-archive`. */
export function cardPrefixes(card) {
  const out = [];
  const origins = Array.isArray(card?.origin_prefixes) ? card.origin_prefixes : [];
  for (const p of origins) {
    if (typeof p !== 'string') continue;
    const k = lineageKey(p);
    if (!k) continue;
    const prefix = `${k}/`;
    if (CORPUS_PREFIX_RE.test(prefix) && !out.includes(prefix)) out.push(prefix);
  }
  if (out.length > 0) return out;
  const url = card?.url;
  if (typeof url !== 'string') return [];
  const m = GITHUB_REPO_RE.exec(url.trim());
  if (!m) return [];
  const prefix = `${lineageKey(`repos/${m[1]}`)}/`;
  return CORPUS_PREFIX_RE.test(prefix) ? [prefix] : [];
}

/** Every card that claims this lineage: `[{ slug, sys, path }]`, where `path` is the lineage's
 *  card-relative remainder (already in key space). `[]` when the lineage is not a corpus path at
 *  all, or when no registered card claims it — either way the caller must refuse it.
 *
 *  A card prefix is always exactly `repos/<repo>/`, so at most one of a card's prefixes can match
 *  a given lineage; there is no precedence to get wrong. Overlapping cards (two cards registering
 *  the same repo) both appear here and are both assessed. */
export function claimingCards(lineage, sourceSystems) {
  const key = lineageKey(lineage);
  if (!CORPUS_LINEAGE_RE.test(key)) return [];
  const keySlash = `${key}/`;
  const hits = [];
  for (const [slug, sys] of Object.entries(sourceSystems ?? {})) {
    for (const prefix of cardPrefixes(sys)) {
      if (keySlash.startsWith(prefix)) { hits.push({ slug, sys, path: key.slice(prefix.length) }); break; }
    }
  }
  return hits;
}

// A held_prefixes entry naming the card's own root means "hold everything in this card". That is
// an operator's clearest possible instruction and must never normalise to an empty string that
// holds nothing, so it gets a dedicated sentinel.
const HELD_ROOT = Symbol('held-root');

/** Read a card's `held_prefixes`. Returns `{ state, usable, problems }`:
 *
 *  - `state: 'absent'`  — no held_prefixes at all, or an explicitly empty list. Holds nothing, by
 *    choice. An empty list is the one present-but-empty form that is still a legible instruction,
 *    and no one-character typo produces it.
 *  - `state: 'malformed'` — present but unreadable: not a list at all (the dropped `- `), or a
 *    non-empty list in which NOT ONE entry can hold anything. The card refuses everything it
 *    claims; see isPublishable.
 *  - `state: 'ok'` — at least one entry holds something. `usable` is `{ raw, key }` per live entry,
 *    `key` being HELD_ROOT when the entry names the card's own root, else the card-relative key
 *    with a trailing slash. `problems` carries the dead entries alongside, for validateCards.
 *
 *  An entry containing `*` is never usable: globs are not supported, a prefix is a prefix, and a
 *  glob that silently holds nothing is exactly the failure mode this function exists to surface. */
function classifyHeld(card) {
  const value = card?.held_prefixes;
  if (value === undefined || value === null) return { state: 'absent', usable: [], problems: [] };
  if (!Array.isArray(value)) {
    return { state: 'malformed', usable: [], problems: [{ raw: value, why: 'is not a list' }] };
  }
  const prefixes = cardPrefixes(card);
  const usable = [];
  const problems = [];
  for (const raw of value) {
    if (typeof raw !== 'string' || !raw.trim()) { problems.push({ raw, why: 'is not a non-empty string' }); continue; }
    if (raw.includes('*')) { problems.push({ raw, why: 'contains a glob — * is not supported, a prefix is a prefix' }); continue; }
    const k = lineageKey(raw);
    if (!k) { problems.push({ raw, why: 'does not normalise to a usable path' }); continue; }
    const ks = `${k}/`;
    if (prefixes.includes(ks)) { usable.push({ raw, key: HELD_ROOT }); continue; }
    const under = prefixes.find((p) => ks.startsWith(p));
    if (under) { usable.push({ raw, key: ks.slice(under.length) }); continue; }
    problems.push({ raw, why: "resolves outside this card's corpus prefixes" });
  }
  if (value.length === 0) return { state: 'absent', usable, problems };
  return { state: usable.length > 0 ? 'ok' : 'malformed', usable, problems };
}

/** The held_prefixes entry (verbatim, for the reason message) that holds this card-relative path,
 *  or null. */
function heldMatch(path, usable) {
  const pathSlash = `${lineageKey(path)}/`;
  for (const h of usable) {
    if (h.key === HELD_ROOT) return h.raw;
    if (pathSlash.startsWith(h.key)) return h.raw;
  }
  return null;
}

/** Export-only seam for consumers OUTSIDE the gate that must ask "would evaluate() refuse this
 *  lineage for a held-prefix reason?" without re-deriving held_prefixes semantics themselves (the
 *  batch selector at scripts/kms-select-batch.mjs is the first such consumer — a second, weaker
 *  copy of "is it held" is exactly how the gate's held-prefix rule and a caller's guess at it drift
 *  apart). Delegates to the SAME classifyHeld/heldMatch/claimingCards evaluate() itself uses; this
 *  function adds no new logic, predicate, check order, or reason string — it only exposes the
 *  existing ones. Mirrors evaluate()'s two held-shaped refusals in the same order it checks them:
 *  a malformed held_prefixes refuses everything the card claims, else a matched held_prefixes
 *  entry refuses the specific path. Returns the reason string, or null when no claiming card holds
 *  this lineage back (including when the lineage is not corpus-path form, or no card claims it at
 *  all — a caller deciding whether a lineage is *held* is not the same question as whether it is
 *  *claimed*; use claimingCards for that). */
export function heldReasonFor(lineage, sourceSystems) {
  for (const hit of claimingCards(lineage, sourceSystems)) {
    const held = classifyHeld(hit.sys);
    if (held.state === 'malformed') {
      return `source-system ${hit.sys?.title ?? hit.slug} has malformed held_prefixes`;
    }
    const holder = heldMatch(hit.path, held.usable);
    if (holder) return `held prefix: ${holder}`;
  }
  return null;
}

/** A provider card (`container_role: provider`) describes who is behind captures that live in
 *  someone else's container — the ICGC or XES has no repo of its own (contract §7, LD-2026-009).
 *  It claims nothing, by construction: the container card stays the only control over those
 *  lineages. So everything on it that would READ as a control is an error, not an allowance —
 *  the same "a dead control must be loud" rule validateCards exists for. */
const isProviderCard = (card) => card?.container_role === 'provider';

function providerCardErrors(slug, card) {
  const errors = [];
  const at = `source-system ${slug}:`;
  if (typeof card.url !== 'string' || !card.url.trim()) {
    errors.push(`${at} provider card needs a url — it is the only thing that says who the provider is`);
  }
  if (card.origin_prefixes !== undefined) {
    errors.push(`${at} provider card must not carry origin_prefixes — a provider claims nothing; the captures are claimed by their container card`);
  } else if (cardPrefixes(card).length > 0) {
    errors.push(`${at} provider card's url derives a corpus prefix (${cardPrefixes(card).join(', ')}) — a provider claims nothing; a repo that is checked out is a container, not a provider`);
  }
  if (card.held_prefixes !== undefined) {
    errors.push(`${at} provider card must not carry held_prefixes — it would hold nothing; hold the provider's directory back on the container card`);
  }
  if (BLOCKED_PUBLIC_USE_NORM.has(normKey(card.public_use))) {
    errors.push(`${at} provider card's public_use ${JSON.stringify(card.public_use)} holds nothing — hold the provider's directory back with held_prefixes on the container card`);
  }
  return errors;
}

/** Operator feedback: every way a source-system card's registration is dead text. Empty = clean.
 *  A control that silently does nothing is how two GitHub-URL held_prefixes sat in production data
 *  looking active while holding nothing. The gate's safety never depends on this — it is a lint. */
export function validateCards(sourceSystems) {
  const errors = [];
  for (const [slug, card] of Object.entries(sourceSystems ?? {})) {
    if (isProviderCard(card)) { errors.push(...providerCardErrors(slug, card)); continue; }
    // origin_prefixes: a non-list keeps the url fallback (that is what closed NEW-5) but is still
    // an authoring error worth naming.
    if (card?.origin_prefixes !== undefined && !Array.isArray(card.origin_prefixes)) {
      errors.push(`source-system ${slug}: origin_prefixes must be a list of repos/<Repo>/ paths — it is ignored as written, and the card falls back to url:`);
    }
    const origins = Array.isArray(card?.origin_prefixes) ? card.origin_prefixes : [];
    for (const p of origins) {
      const prefix = typeof p === 'string' ? `${lineageKey(p)}/` : '';
      if (!CORPUS_PREFIX_RE.test(prefix)) {
        errors.push(`source-system ${slug}: origin_prefixes entry ${JSON.stringify(p)} is not a corpus path of the form repos/<Repo>/ — an upstream URL belongs in url:`);
      }
    }
    if (cardPrefixes(card).length === 0) {
      errors.push(`source-system ${slug}: no corpus-path prefix — add an origin_prefixes entry of the form repos/<Repo>/ (the upstream URL belongs in url:); this card claims nothing, so its held_prefixes and public_use hold nothing`);
    }
    const held = classifyHeld(card);
    for (const p of held.problems) {
      errors.push(`source-system ${slug}: held_prefixes entry ${JSON.stringify(p.raw)} ${p.why} — it holds nothing`);
    }
    if (held.state === 'malformed') {
      errors.push(`source-system ${slug}: held_prefixes is present but nothing in it holds anything — the card refuses EVERYTHING it claims until this is fixed`);
    }
  }
  return errors;
}

/** Operator feedback for public-use-boundary records, the counterpart of validateCards. Empty =
 *  clean. A boundary whose lineage is not corpus-path form indexes nothing and protects nothing —
 *  round 5 finding 2 was exactly that, a URL-notation record that looked like a live control and
 *  was not even reported as unkeyable. A lineage ending in `/` reads as directory intent, which
 *  boundaries do not have: matching is exact-key, one document per record. */
export function validateBoundaries(records) {
  const errors = [];
  const check = (label, record, fallbackKey) => {
    const raw = typeof record?.source_lineage === 'string' ? record.source_lineage : fallbackKey;
    if (typeof raw !== 'string' || !raw.trim()) {
      errors.push(`${label}: no usable source_lineage — the record indexes nothing and protects nothing`);
      return;
    }
    if (!CORPUS_LINEAGE_RE.test(lineageKey(raw))) {
      errors.push(`${label}: source_lineage ${JSON.stringify(raw)} is not corpus-path form — a lineage must be repos/<Repo>/<path>; this record indexes nothing and protects nothing`);
    }
    if (raw.trim().replace(/[?#].*$/, '').endsWith('/')) {
      errors.push(`${label}: source_lineage ${JSON.stringify(raw)} ends in / — a boundary names one document, matched exactly; use a card's held_prefixes to hold a directory back`);
    }
  };
  if (Array.isArray(records)) records.forEach((r, i) => check(`boundary record #${i}`, r, undefined));
  else for (const [k, r] of Object.entries(records ?? {})) check(`boundary record ${k}`, r, k);
  return errors;
}

const isStrictTier = (tier) => normKey(tier) === NEVER_PUBLISH_TIER;

/** Single source of truth for boundary dedup: strictest record per key, order-independent.
 *  Accepts an array, or an object keyed by slug or by lineage. Keys are exact `lineageKey`s —
 *  one notation, no cards, no memo — and must be corpus-path form. A record whose lineage is not
 *  (a URL, a bare repo root, junk) is collected on `.__unkeyable` and NEVER indexed: indexing it
 *  under a key nothing can ever match made a dead control look live, with no signal anywhere
 *  (round 5 finding 2). Records with no usable lineage land there too, rather than being dropped. */
export function buildBoundaryIndex(records) {
  const index = new Map();
  const unkeyable = [];
  const ingest = (record, fallbackKey) => {
    const raw = typeof record?.source_lineage === 'string' ? record.source_lineage : fallbackKey;
    const key = lineageKey(raw);
    if (!CORPUS_LINEAGE_RE.test(key)) { unkeyable.push(fallbackKey !== undefined ? fallbackKey : record); return; }
    const existing = index.get(key);
    if (!existing || (isStrictTier(record?.tier) && !isStrictTier(existing?.tier))) index.set(key, record);
  };
  if (Array.isArray(records)) for (const r of records) ingest(r, undefined);
  else for (const [k, r] of Object.entries(records ?? {})) ingest(r, k);
  index.__unkeyable = unkeyable;
  return index;
}

/** Exact-key lookup — a thin accessor for direct inspection of an index. Accepts a prebuilt Map or
 *  the raw records shape (rebuilt on the spot). */
export function boundaryFor(index, lineage) {
  const built = index instanceof Map ? index : buildBoundaryIndex(index);
  const target = lineageKey(lineage);
  if (!target) return null;
  return built.get(target) ?? null;
}

/** Blocked when this lineage's key carries a never-publish-without-consent record. */
export function isConsentBlocked(index, lineage) {
  const built = index instanceof Map ? index : buildBoundaryIndex(index);
  const key = lineageKey(lineage);
  if (!key) return false;
  return isStrictTier(built.get(key)?.tier);
}

// Second, independent line of defence: identify boundary / source-system records by shape.
function structuralNeverRenderedType(obj) {
  if (obj == null || typeof obj !== 'object') return null;
  const has = (k) => Object.prototype.hasOwnProperty.call(obj, k);
  if (has('tier')) return 'public-use-boundary';
  if (has('what_it_curates') || has('reuse_conditions')) return 'source-system';
  return null;
}

/** Every source an object drew on: primary lineage + the provenance block + each
 *  additional_provenance entry. Deduped, in that order.
 *
 *  PROVENANCE IS A LINEAGE (final review, seam 1). `provenance.origin` is REQUIRED by the vendored
 *  provenance schema (packages/toolkit-framework/schemas/provenance.yaml) and it is the FIRST
 *  thing the site displays — the commons derives an object's origin as
 *  `provenance.origin → source_lineage → url` (repos/…/src/lib/kb.mjs, ProvenanceBlock.astro).
 *  Reading only source_lineage therefore let an object with a clean primary lineage and a HELD (or
 *  entirely unregistered) `provenance.origin` publish, export, validate clean — and print the held
 *  path on a public page. `provenance.adapted_from` is the same shape and the same exposure.
 *  Both are declared `type: string`, but an array is accepted defensively: dropping entries a
 *  future extractor might write is exactly the silent-loss failure this function must not have.
 *
 *  `url` is deliberately NOT a lineage. It is an object's public LINK — a published object may
 *  legitimately point at an external site it does not claim as a source, and gating it would
 *  refuse that object for naming a page it merely cites. The site agrees: `url` is only ever read
 *  as provenance when BOTH `provenance.origin` and `source_lineage` are absent (the loadKb
 *  fallback chain and ProvenanceBlock's dedup both stop at the first one present), so an object
 *  with any real lineage never displays its url as an origin. Note the asymmetry with an
 *  additional_provenance ENTRY's `url:` key below: there, `url` is one of the shapes an operator
 *  writes a secondary lineage in, so it IS read.
 *
 *  additional_provenance may be an array, a single record (wrapped as one entry), or absent.
 *  Each entry may be a bare lineage string, or an object exposing the lineage under any of
 *  source_lineage / origin / lineage / url — provenance is free-form operator input and a
 *  narrower reader would silently drop entries rather than fail closed on them. */
export function allLineages(obj) {
  const out = [];
  const push = (v) => {
    if (Array.isArray(v)) { for (const x of v) push(x); return; }
    const t = trimLineage(v); if (t && !out.includes(t)) out.push(t);
  };
  push(obj?.source_lineage);
  const prov = obj?.provenance;
  if (prov && typeof prov === 'object') { push(prov.origin); push(prov.adapted_from); }
  const ap = obj?.additional_provenance;
  const entries = Array.isArray(ap) ? ap : ap && typeof ap === 'object' ? [ap] : [];
  for (const e of entries) {
    if (typeof e === 'string') { push(e); continue; }
    push(e?.source_lineage ?? e?.origin ?? e?.lineage ?? e?.url);
  }
  return out;
}

function evaluate(obj, sourceSystems, boundaries) {
  const structural = structuralNeverRenderedType(obj);
  if (structural) return { ok: false, reason: `structurally a ${structural} record (never rendered)` };

  const type = normKey(obj.type);
  if (!type) return { ok: false, reason: 'missing type' };
  if (NEVER_RENDERED_NORM.has(type)) return { ok: false, reason: `type ${obj.type} is never rendered` };

  if (isRiskFlagged(obj.high_risk)) return { ok: false, reason: 'high_risk' };
  if (BLOCKED_PUBLIC_USE_NORM.has(normKey(obj.public_use))) return { ok: false, reason: `public_use ${obj.public_use}` };

  const lineage = trimLineage(obj.source_lineage);
  if (!lineage) return { ok: false, reason: 'no source_lineage' };

  // One spelling, checked before anything downstream reads a lineage: see nonCanonicalReason.
  for (const l of allLineages(obj)) {
    const bad = nonCanonicalReason(l);
    if (bad) return { ok: false, reason: bad };
  }

  // Consent binds to EVERY source an object drew on, not just its primary.
  for (const l of allLineages(obj)) {
    if (isConsentBlocked(boundaries, l)) return { ok: false, reason: 'boundary: never-publish-without-consent' };
  }

  // Every lineage must be a corpus path claimed by at least one registered card, and must clear
  // EVERY card that claims it — a card that holds the path, is high_risk, is blocked, or was never
  // assessed refuses it, whichever card that is and however many others would have allowed it.
  for (const l of allLineages(obj)) {
    const hits = claimingCards(l, sourceSystems);
    if (hits.length === 0) return { ok: false, reason: `unresolvable source_lineage: ${l}` };
    for (const hit of hits) {
      const name = hit.sys?.title ?? hit.slug;
      // A present-but-unreadable held_prefixes is not "holds nothing" — it is a control whose
      // meaning cannot be determined, so the card refuses everything it claims.
      const held = classifyHeld(hit.sys);
      if (held.state === 'malformed') return { ok: false, reason: `source-system ${name} has malformed held_prefixes` };
      const holder = heldMatch(hit.path, held.usable);
      if (holder) return { ok: false, reason: `held prefix: ${holder}` };
      if (isRiskFlagged(hit.sys?.high_risk)) return { ok: false, reason: `source-system ${name} is internal-only/high_risk` };
      const sysPublicUse = normKey(hit.sys?.public_use);
      if (BLOCKED_PUBLIC_USE_NORM.has(sysPublicUse)) return { ok: false, reason: `source-system ${name} is internal-only/high_risk` };
      // An unassessed container (no public_use at all) is not "not blocked" — it is unreviewed,
      // and unreviewed fails closed same as any other missing assessment.
      if (!sysPublicUse) return { ok: false, reason: `source-system ${name} is unassessed (no public_use)` };
    }
  }

  if (obj.publish === true) return { ok: true, reason: 'operator publish flag' };
  const maturity = normStr(obj.maturity);
  if (!PROMOTED_MATURITIES.includes(maturity)) return { ok: false, reason: `maturity is ${obj.maturity ?? 'missing'}` };
  return { ok: true, reason: `maturity ${obj.maturity}` };
}

/** The gate. Never throws: an unexpected shape anywhere inside becomes a refusal, because a gate
 *  that throws is a gate a caller can accidentally treat as "no objection". */
export function isPublishable(rawObj, rawCtx) {
  try {
    return evaluate(rawObj ?? {}, rawCtx?.sourceSystems ?? {}, rawCtx?.boundaries ?? {});
  } catch (err) {
    return { ok: false, reason: `gate error: ${err?.message ?? String(err)}` };
  }
}
