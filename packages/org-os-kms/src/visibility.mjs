// src/visibility.mjs — the visibility floor, in core. A pack only DECLARES `publish_requires` (field: value pairs a
// type needs before it may be published); this module enforces it. It is read in three places that must agree:
// selectPublic (the `publish` op withholds), planPublish (fails closed, whatever called it), and the registry bridge.
// No instance gate can widen it: it runs before the gate, and planPublish checks again after.
import { basename, extname } from 'node:path';
import { packPublishRules, publishRequirements } from './pack-publish.mjs';
import { schemaFields, isValid } from './framework.mjs';

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
/**
 * The top-level fields a schema declares a closed vocabulary for (`enum` or an `axis`) → { field: (value) => is it IN the vocabulary }.
 * A value inside the list is a category or a maturity, not a ref; a value outside it is not exempt, whatever the field.
 */
function closedVocabularies(schema) {
  try {
    const out = new Map();
    for (const [k, def] of Object.entries(schemaFields(schema) || {})) {
      if (def?.enum) out.set(k, (v) => def.enum.includes(v));
      else if (def?.axis) out.set(k, (v) => isValid(def.axis, v));
    }
    return out;
  } catch { return new Map(); } // a schema that is not registered declares nothing
}
const slugOf = (ref) => { const i = ref.lastIndexOf('#'); return i >= 0 ? ref.slice(i + 1) : basename(ref, extname(ref)); };
const norm = (s) => s.trim().toLowerCase(); // both sides of every comparison: ' M-Need\n' is m-need

/**
 * Spec 6.3: a public record never names an object that is not itself public. Scrubbed BY VALUE, not by field name: toRecord
 * passes every non-private key and the pages print every extra field, so any field (superseded_by, parent, see_also, a nested
 * object, one nobody listed) may carry a ref. For each selected item, at any depth, a string that equals (trimmed, case-folded)
 * the slug, id or type:slug of a local object of `all` that is NOT in `items` (matching-only, private, undeclared, gate-rejected)
 * is removed from its array, or its key is dropped when it is a scalar. An object KEY that equals one is dropped too, with its
 * value, at every depth. Kept: at:// URIs (foreign, already public), strings that resolve to nothing local, and strings that
 * resolve to a selected object. A bare slug that also names an unselected object is ambiguous, and an ambiguous value is dropped
 * (fail closed). Exempt, so a value is never mistaken for a ref: the item's own id, slug, type and title (keys and values), and a
 * top-level field its schema declares an enum or axis for, but ONLY while its value is in that list (link_status: active survives
 * a private slug `active`; link_status: m-need does not). A dropped required field is left to the record validation to refuse,
 * loudly, in planPublish. Out of scope: free text (`notes: 'see x-need'`) is not parsed.
 * The drop is counted, never named: each returned item that lost something carries `scrubbed: <count of values and keys removed>`,
 * and the optional `stats` object receives { total, items: [{ ref, count }] }, so the publish report can tell an author that an
 * ordinary word collided with a private slug. Pure but for `stats`; `items` and `all` are { schema, object, ref } lists.
 */
export function scrubUnpublishedRefs(items, all = items, stats = null) {
  const selected = new Set(items.map((it) => it.ref));
  const index = new Map(); // normalised key -> Set(ref)
  const add = (key, ref) => { if (typeof key !== 'string' || !key.trim()) return; const k = norm(key); if (!index.has(k)) index.set(k, new Set()); index.get(k).add(ref); };
  for (const it of [...all, ...items]) {
    const slug = slugOf(it.ref);
    add(slug, it.ref); add(`${it.schema}:${slug}`, it.ref); add(it.object?.id, it.ref);
  }
  const leaks = (entry) => {
    if (typeof entry !== 'string' || entry.trim().startsWith('at://')) return false;
    const hits = index.get(norm(entry));
    return Boolean(hits) && [...hits].some((ref) => !selected.has(ref));
  };
  // → the value without any leaking string or key, or DROP when the value itself is one. Unchanged values come back as the same reference.
  const DROP = Symbol('drop');
  const clean = (v, c, keep) => {
    if (typeof v === 'string') { if (keep?.(v) || !leaks(v)) return v; c.n++; return DROP; }
    if (Array.isArray(v)) {
      const kept = v.map((x) => clean(x, c, keep)).filter((x) => x !== DROP);
      return kept.length === v.length && kept.every((x, i) => x === v[i]) ? v : kept;
    }
    if (v && typeof v === 'object') {
      let out = v;
      for (const [k, x] of Object.entries(v)) {
        if (leaks(k)) { if (out === v) out = { ...v }; delete out[k]; c.n++; continue; }
        const r = clean(x, c, keep);
        if (r === x) continue;
        if (out === v) out = { ...v };
        if (r === DROP) delete out[k]; else out[k] = r;
      }
      return out;
    }
    return v;
  };
  const counted = [];
  const result = items.map((it) => {
    const object = it.object;
    if (!object || typeof object !== 'object') return it;
    const vocab = closedVocabularies(it.schema);
    const c = { n: 0 };
    let next = object;
    for (const [k, v] of Object.entries(object)) {
      if (IDENTITY_FIELDS.has(k) || vocab.has(k)) { // the key is the schema's own; a vocabulary field is checked by value below
        if (IDENTITY_FIELDS.has(k)) continue;
      } else if (leaks(k)) { if (next === object) next = { ...object }; delete next[k]; c.n++; continue; }
      const r = clean(v, c, vocab.get(k));
      if (r === v) continue;
      if (next === object) next = { ...object };
      if (r === DROP) delete next[k]; else next[k] = r;
    }
    if (c.n === 0) return it;
    counted.push({ ref: it.ref, count: c.n });
    return { ...it, object: next, scrubbed: c.n };
  });
  if (stats) { stats.total = counted.reduce((n, x) => n + x.count, 0); stats.items = counted; }
  return result;
}
