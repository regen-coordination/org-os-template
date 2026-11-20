// src/visibility.mjs — the visibility floor, in core. A pack only DECLARES `publish_requires` (field: value pairs a
// type needs before it may be published); this module enforces it. It is read in three places that must agree:
// selectPublic (the `publish` op withholds), planPublish (fails closed, whatever called it), and the registry bridge.
// No instance gate can widen it: it runs before the gate, and planPublish checks again after.
import { basename, extname } from 'node:path';
import { packPublishRules, publishRequirements } from './pack-publish.mjs';
import { REF_ARRAY_FIELDS } from './refs.mjs';

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
 * The ref fields a public record may carry: the pack-agnostic REF_ARRAY_FIELDS plus `related`. `related` is deliberately NOT in
 * REF_ARRAY_FIELDS: that list also drives AT-URI rewriting and the page relations, and `related` stays what it always was, a
 * passthrough of what the author wrote. It is only scrubbed here.
 */
export const SCRUBBED_REF_FIELDS = ['related', ...REF_ARRAY_FIELDS];
const slugOf = (ref) => { const i = ref.lastIndexOf('#'); return i >= 0 ? ref.slice(i + 1) : basename(ref, extname(ref)); };

/**
 * Spec 6.3: a public record never names an object that is not itself public. For each selected item, drop from `related` and every
 * REF_ARRAY_FIELDS field each entry that resolves (slug, id or type:slug) to a local object of `all` that is NOT in `items`
 * (matching-only, private, undeclared, gate-rejected). Kept: at:// URIs (foreign, already public), entries that resolve to
 * nothing local, and entries that resolve to a selected object. A bare slug that also names an unselected object is ambiguous,
 * and an ambiguous ref is dropped (fail closed). Pure; `items` and `all` are { schema, object, ref } lists; returns new items.
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
  return items.map((it) => {
    let object = it.object;
    for (const f of SCRUBBED_REF_FIELDS) {
      if (!Array.isArray(object?.[f])) continue;
      const kept = object[f].filter((e) => !leaks(e));
      if (kept.length !== object[f].length) object = { ...object, [f]: kept };
    }
    return object === it.object ? it : { ...it, object };
  });
}
