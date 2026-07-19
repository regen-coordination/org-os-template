// src/connector.mjs — the Connector seam: where knowledge COMES FROM (orthogonal to
// storage, which is where it LANDS). A connector is a source driver for one external
// protocol. It presents itself as a source-system peer (describe), fetches foreign
// records since a cursor (pull), and translates each record into framework KB
// candidates (map). runConnector sequences describe → pull → map → validate → store
// and is the single place all lifecycle/error policy for connectors lives.
//
// Connector = {
//   name: string,
//   protocol: string,
//   capabilities: { ingest: bool, subscribe: bool, publish: bool },
//   describe(config)          → source-system object (this source AS a federation peer)
//   pull(config, {cursor})    → { records: [...], cursor: <opaque> }   // network read; may be async
//   map(record, config)       → [{ schema, object }]                   // PURE, total; no I/O
//   subscribe?(config, onEvent) → unsubscribe()   // optional; only if capabilities.subscribe
//   publish?(config, records)   → { applied:false, draft }  // optional; DRAFT-ONLY
// }
//
// Cursors are connector-opaque tokens (like storage refs): the orchestrator stores and
// replays them but never inspects them.
import { validateObject, checkInvariants, schemaFields, listSchemas } from './index.mjs';

export const NOT_IMPLEMENTED = 'NOT_IMPLEMENTED';

/**
 * Run one connector: describe → pull → map → validate/stamp → store.
 * ctx = { config, cursor, adapter, target }. Async because pull does I/O.
 * Returns { source, stored, candidates, cursor, errors }.
 */
export async function runConnector(connector, ctx = {}) {
  const { config = {}, cursor = null, adapter, target } = ctx;
  if (!adapter) throw new Error('runConnector: adapter required');
  const errors = [];

  const card = connector.describe(config);
  const cv = validateObject('source-system', card);
  if (!cv.valid) throw new Error(`describe() is not a valid source-system: ${cv.errors.join('; ')}`);

  const pulled = await connector.pull(config, { cursor });
  const records = (pulled && pulled.records) || [];
  const nextCursor = pulled && pulled.cursor !== undefined ? pulled.cursor : cursor;

  const candidates = [];
  for (const r of records) {
    try {
      const mapped = connector.map(r, config) || [];
      candidates.push(...mapped);
    } catch (e) {
      errors.push(`map: ${e.message}`);
    }
  }

  const known = new Set(listSchemas());
  const toStore = [{ schema: 'source-system', object: card }];
  for (const c of candidates) {
    if (!c || !c.schema || !c.object || typeof c.object !== 'object') { errors.push('map produced an empty candidate'); continue; }
    if (!known.has(c.schema)) { errors.push(`unknown schema "${c.schema}"`); continue; }
    const object = { ...c.object };
    if ('maturity' in schemaFields(c.schema)) {
      if (object.maturity == null) object.maturity = 'raw';
      if (!object.provenance) object.provenance = { origin: card.title };
    }
    const v = validateObject(c.schema, object);
    if (!v.valid) { errors.push(`${c.schema} "${object.title || '?'}": ${v.errors.join('; ')}`); continue; }
    const inv = checkInvariants(object);
    if (!inv.ok) { errors.push(`${c.schema} "${object.title || '?'}": ${inv.violations.join('; ')}`); continue; }
    toStore.push({ schema: c.schema, object });
  }

  const { stored } = adapter.store(target, toStore);
  return { source: card.title, stored: stored.length, candidates: candidates.length, cursor: nextCursor, errors };
}
