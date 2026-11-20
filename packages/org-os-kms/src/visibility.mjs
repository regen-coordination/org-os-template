// src/visibility.mjs — the visibility floor, in core. A pack only DECLARES `publish_requires` (field: value pairs a
// type needs before it may be published); this module enforces it. It is read in three places that must agree:
// selectPublic (the `publish` op withholds), planPublish (fails closed, whatever called it), and the registry bridge.
// No instance gate can widen it: it runs before the gate, and planPublish checks again after.
import { basename, extname } from 'node:path';
import { packPublishRules, publishRequirements } from './pack-publish.mjs';
import { schemaFields } from './framework.mjs';

/** Every declared requirement, by type: { need: { visibility: 'public' }, … }. */
export function publishRequires() { return publishRequirements(); }

/**
 * → { ok } when every `field: value` required for `schema` holds. An object that lacks the field is REFUSED, not passed.
 * A schema with no requirement (core types, ungated packs) passes: this floor adds to the framework floor, never replaces it.
 */
export function visibilityFloor(object, schema = object?.type) {
  const need = packPublishRules(schema)?.publish_requires;
  if (!need) return { ok: true };
  for (const [field, value] of Object.entries(need)) {
    if (object?.[field] === undefined || object?.[field] === null) return { ok: false, reason: `visibility floor: ${schema} needs ${field}: ${value}, the object has no ${field}` };
    if (object[field] !== value) return { ok: false, reason: `visibility floor: ${schema} needs ${field}: ${value}, the object has ${field}: ${object[field]}` };
  }
  return { ok: true };
}

/**
 * The fields of the item's own identity: never scrubbed, whatever they hold. They name the object itself, which is selected.
 */
const IDENTITY_FIELDS = new Set(['id', 'slug', 'type', 'title']);
/** The top-level fields a schema declares a closed vocabulary for (`enum` or an `axis`): a category or maturity is a value, not a ref. */
function closedVocabularyFields(schema) {
  try {
    return new Set(Object.entries(schemaFields(schema) || {}).filter(([, def]) => def && (def.enum || def.axis)).map(([k]) => k));
  } catch { return new Set(); } // a schema that is not registered declares nothing
}
const slugOf = (ref) => { const i = ref.lastIndexOf('#'); return i >= 0 ? ref.slice(i + 1) : basename(ref, extname(ref)); };

/**
 * Spec 6.3: a public record never names an object that is not itself public. Scrubbed BY VALUE, not by field name: toRecord
 * passes every non-private key and the pages print every extra field, so any field (superseded_by, parent, see_also, a nested
 * object, one nobody listed) may carry a ref. For each selected item, at any depth, a string that exactly equals the slug, id
 * or type:slug of a local object of `all` that is NOT in `items` (matching-only, private, undeclared, gate-rejected) is removed
 * from its array, or its key is dropped when it is a scalar. Kept: at:// URIs (foreign, already public), strings that resolve to
 * nothing local, and strings that resolve to a selected object. A bare slug that also names an unselected object is ambiguous,
 * and an ambiguous value is dropped (fail closed). Exempt, so a value is never mistaken for a ref: the item's own id, slug, type
 * and title, and every top-level field its schema declares an enum or axis for (a category that equals some private slug survives).
 * Out of scope: free text (`notes: 'see x-need'`) is not parsed; only exact equality is removed. Pure; `items` and `all` are
 * { schema, object, ref } lists; returns new items.
 */
export function scrubUnpublishedRefs(items, all = items) {
  const selected = new Set(items.map((it) => it.ref));
  const index = new Map(); // key -> [{ ref }]
  const add = (key, ref) => { if (typeof key !== 'string' || !key) return; if (!index.has(key)) index.set(key, new Set()); index.get(key).add(ref); };
  for (const it of [...all, ...items]) {
    const slug = slugOf(it.ref);
    add(slug, it.ref); add(`${it.schema}:${slug}`, it.ref); add(it.object?.id, it.ref);
  }
  const leaks = (entry) => {
    if (typeof entry !== 'string' || entry.startsWith('at://')) return false;
    const hits = index.get(entry);
    return Boolean(hits) && [...hits].some((ref) => !selected.has(ref));
  };
  // → the value without any leaking string, or DROP when the value itself is one. Unchanged values come back as the same reference.
  const DROP = Symbol('drop');
  const clean = (v) => {
    if (typeof v === 'string') return leaks(v) ? DROP : v;
    if (Array.isArray(v)) {
      const kept = v.map(clean).filter((x) => x !== DROP);
      return kept.length === v.length && kept.every((x, i) => x === v[i]) ? v : kept;
    }
    if (v && typeof v === 'object') {
      let out = v;
      for (const [k, x] of Object.entries(v)) {
        const c = clean(x);
        if (c === x) continue;
        if (out === v) out = { ...v };
        if (c === DROP) delete out[k]; else out[k] = c;
      }
      return out;
    }
    return v;
  };
  return items.map((it) => {
    const object = it.object;
    if (!object || typeof object !== 'object') return it;
    const exempt = closedVocabularyFields(it.schema);
    let next = object;
    for (const [k, v] of Object.entries(object)) {
      if (IDENTITY_FIELDS.has(k) || exempt.has(k)) continue;
      const c = clean(v);
      if (c === v) continue;
      if (next === object) next = { ...object };
      if (c === DROP) delete next[k]; else next[k] = c;
    }
    return next === object ? it : { ...it, object: next };
  });
}
