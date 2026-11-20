// src/visibility.mjs — the visibility floor, in core. A pack only DECLARES `publish_requires` (field: value pairs a
// type needs before it may be published); this module enforces it. It is read in three places that must agree:
// selectPublic (the `publish` op withholds), planPublish (fails closed, whatever called it), and the registry bridge.
// No instance gate can widen it: it runs before the gate, and planPublish checks again after.
import { packPublishRules, publishRequirements } from './pack-publish.mjs';

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
