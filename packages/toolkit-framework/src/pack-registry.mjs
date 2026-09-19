// packages/toolkit-framework/src/pack-registry.mjs — extension-pack state. State only, no imports, so index.mjs and publishable.mjs can both read it without a cycle.
const packs = new Map(); // name -> { name, schemaDir, entities, types }, in registration order

export function getPacks() { return packs; }
export function setPack(name, pack) { packs.set(name, pack); }
export function clearPacks() { packs.clear(); }
