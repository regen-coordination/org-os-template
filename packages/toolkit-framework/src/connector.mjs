// src/connector.mjs — seam 3: a Connector is a source driver (2026-07-19 spec).
// runConnector sequences describe → pull → map → validate → upsert/store → card → retract.
// Dry-aware (dry writes nothing); each candidate is validated AS IT WILL BE STORED.
import { getAdapter, slugify } from './storage.mjs';
import { validateObject, checkInvariants } from './index.mjs';

export class NOT_IMPLEMENTED extends Error {
  constructor(name) { super(`connector ${name}: pull not implemented`); this.code = 'NOT_IMPLEMENTED'; }
}

// Local identity + review state that an origin update must never overwrite.
const LOCAL_ONLY = ['id', 'maturity', 'public_use', 'review_needs'];

export async function runConnector(connector, { config, cursor, adapter, target, dry = false, now = () => new Date().toISOString() }) {
  const source = connector.describe(config);
  const { records, cursor: nextCursor, retracted = [], errors = [] } = await connector.pull(config, { cursor });
  const a = getAdapter(adapter);
  const local = a.list(target);
  const byOrigin = new Map(local.filter((i) => i.object.sourceUri).map((i) => [i.object.sourceUri, i]));
  const stamp = now();

  const toStore = []; const toUpdate = []; const invalid = [];
  for (const r of records) for (const { schema, object } of connector.map(r, config)) {
    const base = { ...object, ai_assisted: object.ai_assisted ?? true,
      work_order: `connector:${connector.name}:${stamp}`,
      source_lineage: object.sourceUri ?? object.source_lineage ?? source.return_path,
      provenance: { origin: `${connector.name}:${source.return_path || source.title}`, ...(object.provenance || {}) } };
    // Whatever the origin claims, what we hold is raw + not-public-yet: validate THAT, not the origin's claim.
    const candidate = { ...base, maturity: 'raw', public_use: 'not-public-yet' };
    const v = validateObject(schema, candidate); const inv = checkInvariants(candidate);
    const errs = [...v.errors, ...(inv.violations || [])];
    if (errs.length) { invalid.push({ title: object.title, errors: errs }); continue; }
    const existing = object.sourceUri && byOrigin.get(object.sourceUri);
    if (existing) {
      const patch = {}; for (const [k, x] of Object.entries(candidate)) if (!LOCAL_ONLY.includes(k)) patch[k] = x;
      toUpdate.push({ ref: existing.ref, patch: { ...patch, review_needs: 'updated at origin' } });
    } else toStore.push({ schema, object: candidate });
  }
  const report = { source, pulled: records.length, candidates: toStore.length + toUpdate.length, invalid, stored: 0, updated: 0, collisions: 0, cursor, retractions: 0, errors, dry };
  if (dry) return report;

  for (const u of toUpdate) a.update(target, u.ref, u.patch);
  const { stored, collisions = [] } = toStore.length ? a.store(target, toStore) : { stored: [], collisions: [] };

  // The federation primitive is always written: the source's own card (never overwritten once it exists).
  const cardSlug = slugify(source.title);
  const existingCard = local.find((i) => i.schema === 'source-system' && slugify(i.object.title) === cardSlug);
  if (!existingCard) a.store(target, [{ schema: 'source-system', object: { ...source, maturity: 'raw', public_use: 'internal-only', ai_assisted: false } }]);

  let retractions = 0;
  if (retracted.length) {
    const set = new Set(retracted);
    for (const { object, ref } of a.list(target)) if (object.sourceUri && set.has(object.sourceUri)) { a.update(target, ref, { maturity: 'held', review_needs: `retracted at origin ${object.sourceUri}` }); retractions++; }
  }
  return { ...report, stored: stored.length, updated: toUpdate.length, collisions: collisions.length, retractions, cursor: nextCursor };
}
