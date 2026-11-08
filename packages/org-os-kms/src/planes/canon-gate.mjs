// The canon publication gate, for an instance with no plane role (selectPublic in src/gate.mjs, which
// `publish`, the steward's preview and kms-admin all read).
//
// A canon declares itself in kms.yaml (planes.public) and never publishes. An instance that declares
// no planes but whose knowledge base is canon-shaped would otherwise publish on the framework floor
// alone: a `maturity: draft` entry with `public_use: ok-with-caveat` would be minted and written. So
// when the knowledge base holds canon control data, selection also runs the gate `export` runs
// (publication-gate.mjs isPublishable), with the control data linted first (validateCards /
// validateBoundaries), as export-commons.mjs does.
//
// Canon control data is a source-system card that claims or holds corpus paths (origin_prefixes,
// held_prefixes, container_role, or a GitHub url, which claims its checkout), or any
// public-use-boundary record. A card that claims nothing — a federated peer's card brought in by
// ingest, a garden's own self card — is not: those instances are not canons, and the gate would
// refuse every entry they hold.
//
// The control data is read from the same listing the selection judges (the adapter's `list`), not
// from a second read of data/kb: whatever adapter the instance uses, the gate sees the cards and
// boundaries publish sees, shaped the way loadKb shapes them (type = the schema stored under, slug =
// the entry key).
import { isPublishable, validateCards, validateBoundaries, cardPrefixes, buildBoundaryIndex } from './publication-gate.mjs';
import { slugFromRef } from '../manifest.mjs';

const CONTROL_FIELDS = ['origin_prefixes', 'held_prefixes', 'container_role'];
const claimsCorpus = (card) => CONTROL_FIELDS.some((k) => card?.[k] !== undefined) || cardPrefixes(card).length > 0;

/** Thrown by selectPublic when the control data is malformed: nothing can be called public until it is fixed. */
export class CanonControlError extends Error {
  constructor(errors) {
    super(`this knowledge base holds source-system cards or public-use boundaries that are malformed, so what may be public cannot be told: ${errors.join('; ')}`);
    this.code = 'CANON_CONTROL_DATA';
    this.errors = errors;
  }
}

/**
 * The canon control data in `all` ([{ schema, ref, object }]). Lints it only when it applies.
 * @returns {{ status: 'not-applied', reason: string }
 *   | { status: 'malformed', errors: string[] }
 *   | { status: 'applied', kb: { sourceSystems: object, boundaries: Map } }}
 */
export function canonControl(all) {
  const sourceSystems = {}; const boundaryRecords = []; const unsafe = [];
  for (const { schema, ref, object } of all) {
    if (schema !== 'source-system' && schema !== 'public-use-boundary') continue;
    const slug = slugFromRef(ref);
    // `sourceSystems[slug] =` with the key `__proto__` would reseat the map's prototype and drop the card unseen
    // (loadKb refuses the key at load for the same reason): a card the gate cannot hold is malformed control data.
    if (slug === '__proto__') { unsafe.push(`${schema} ${JSON.stringify(slug)}: this entry key cannot be read safely; rename it`); continue; }
    if (schema === 'source-system') sourceSystems[slug] = { ...object, type: schema, slug };
    else boundaryRecords.push({ ...object, type: schema, slug });
  }
  const cards = Object.values(sourceSystems);
  if (cards.length === 0 && boundaryRecords.length === 0 && unsafe.length === 0) return { status: 'not-applied', reason: 'no source-system cards' };
  if (!cards.some(claimsCorpus) && boundaryRecords.length === 0 && unsafe.length === 0) {
    return { status: 'not-applied', reason: 'no source-system card claims or holds a corpus path' };
  }
  const errors = [...unsafe, ...validateCards(sourceSystems), ...validateBoundaries(boundaryRecords)];
  if (errors.length > 0) return { status: 'malformed', errors };
  return { status: 'applied', kb: { sourceSystems, boundaries: buildBoundaryIndex(boundaryRecords) } };
}

/** Narrow `items` ({ schema, ref, object }) to what the canon gate passes. Each object is judged the way
 *  loadKb shapes it: its type is the schema it is stored under, its slug the entry key. */
export function applyCanonGate(items, kb) {
  const passed = []; const rejected = [];
  for (const it of items) {
    const slug = slugFromRef(it.ref);
    const v = isPublishable({ ...it.object, type: it.schema, slug }, kb);
    if (v.ok) passed.push(it); else rejected.push({ slug, reason: v.reason });
  }
  return { passed, rejected };
}
