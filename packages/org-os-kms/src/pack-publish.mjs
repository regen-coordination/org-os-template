// src/pack-publish.mjs — what an extension pack DECLARES about publishing its types: data that kms core enforces.
// A pack supplies no gate (docs/CONNECTORS.md §13): `visibility_gated`, `publish_requires`, `public_fields` and
// `shared_lexicon` are read from pack.yaml by loadExtensions and registered here, per type, with the same collision
// rules as registry bindings. A pack without `visibility_gated: true` registers nothing and is untouched.
const gated = new Map(); // schema -> { pack, publish_requires, public_fields, shared_lexicon }

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function registerPackPublish(packName, manifest = {}) {
  if (manifest.visibility_gated !== true) return;
  const { publish_requires: req = {}, public_fields: pub = {}, shared_lexicon: shared = {} } = manifest;
  for (const [key, v] of [['publish_requires', req], ['public_fields', pub], ['shared_lexicon', shared]]) {
    if (!isObj(v)) throw new Error(`extension pack "${packName}": ${key} must be a map keyed by type`);
  }
  for (const type of manifest.types || []) {
    const prev = gated.get(type);
    if (prev && prev.pack !== packName) throw new Error(`pack publish rules for "${type}" (${packName}) collide with pack ${prev.pack}`);
    if (pub[type] !== undefined && !Array.isArray(pub[type])) throw new Error(`extension pack "${packName}": public_fields.${type} must be a list`);
    gated.set(type, { pack: packName, publish_requires: req[type] ?? null, public_fields: pub[type] ?? null, shared_lexicon: shared[type] ?? null });
  }
}

/** The declared publish rules for a type of a visibility-gated pack, or null (core types, ungated packs). */
export function packPublishRules(schema) { return gated.get(schema) ?? null; }

export function resetPackPublish() { gated.clear(); }
