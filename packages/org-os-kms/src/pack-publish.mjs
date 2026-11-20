// src/pack-publish.mjs — what an extension pack DECLARES about publishing its types: data that kms core enforces.
// A pack supplies no gate (docs/CONNECTORS.md §13): `visibility_gated`, `publish_requires`, `public_fields` and
// `shared_lexicon` are read from pack.yaml by loadExtensions and registered here, per type, with the same collision
// rules as registry bindings. A pack without `visibility_gated: true` registers nothing and is untouched.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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

/**
 * The shared-lexicon types of the loaded packs, for planPublish: { [schema]: { doc, toRecord } }.
 * `doc` is the pack's lexicon JSON (pack.yaml `shared_lexicon`, a path inside the pack); `toRecord` is the `toSharedRecord`
 * the pack ships at src/shared-map.mjs (null = the object has no home in the lexicon and stays canon-only).
 * Only a visibility-gated pack can declare one. Like a pack connector, that module is executed.
 */
export async function loadSharedLexicons(packs = []) {
  const out = {};
  for (const p of packs) {
    const decl = p.manifest?.visibility_gated === true ? p.manifest.shared_lexicon : null;
    if (!decl) continue;
    const mapPath = join(p.dir, 'src', 'shared-map.mjs');
    if (!existsSync(mapPath)) throw new Error(`extension pack "${p.name}": shared_lexicon is declared but src/shared-map.mjs is missing`);
    let mod;
    try { mod = await import(pathToFileURL(mapPath).href); } catch (e) { throw new Error(`extension pack "${p.name}": src/shared-map.mjs failed to load: ${e.message}`); }
    if (typeof mod.toSharedRecord !== 'function') throw new Error(`extension pack "${p.name}": src/shared-map.mjs does not export toSharedRecord`);
    for (const [schema, rel] of Object.entries(decl)) {
      const file = join(p.dir, rel);
      if (!existsSync(file)) throw new Error(`extension pack "${p.name}": shared lexicon for ${schema} not found: ${rel}`);
      out[schema] = { doc: JSON.parse(readFileSync(file, 'utf8')), toRecord: mod.toSharedRecord };
    }
  }
  return out;
}
