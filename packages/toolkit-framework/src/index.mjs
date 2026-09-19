// @regen-commons/toolkit-framework — programmatic API.
// Zero-build ESM so the framework is adoptable in any context with no compile step.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import { getPacks, setPack, clearPacks } from './pack-registry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_DIR = join(here, '..', 'schemas');

// Re-export the compatibility engine (K6) + invariants (SP8) as part of the package API.
export { checkOptionCompatibility, checkDeploymentValidity, checkTrackComposition } from './compatibility.mjs';
export { checkInvariants } from './invariants.mjs';

const _cache = new Map();

/** Core first, then each registered pack's schema dir, in registration order. */
function schemaDirs() {
  return [SCHEMA_DIR, ...[...getPacks().values()].map((p) => p.schemaDir).filter(Boolean)];
}

const yamlNames = (dir) => (existsSync(dir) ? readdirSync(dir) : [])
  .filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, ''));

/** Load a schema YAML by name (without extension), cached. Core wins; packs are searched after it. */
export function loadSchema(name) {
  if (_cache.has(name)) return _cache.get(name);
  const path = schemaDirs().map((d) => join(d, `${name}.yaml`)).find((p) => existsSync(p));
  if (!path) throw new Error(`schema not found: ${name} (${join(SCHEMA_DIR, `${name}.yaml`)})`);
  const doc = yaml.load(readFileSync(path, 'utf8'));
  _cache.set(name, doc);
  return doc;
}

/** List available schema names (core + registered packs). */
export function listSchemas() {
  return [...new Set(schemaDirs().flatMap(yamlNames))].sort();
}

// --- extension packs: sibling packages that add schemas, Layer-B entities and opt-in types ---

/**
 * Register an extension pack. Core always wins: a pack schema named like a core schema (or like
 * an earlier pack's) throws — it is never a shadow. Idempotent per { name, schemaDir }, because
 * a host loads its config more than once per process.
 */
export function registerPack({ name, schemaDir = null, entities = {}, types = [] } = {}) {
  if (!name || typeof name !== 'string') throw new Error('registerPack: name is required');
  const existing = getPacks().get(name);
  if (existing) {
    if (existing.schemaDir === schemaDir) return existing;
    throw new Error(`pack "${name}" is already registered from ${existing.schemaDir}`);
  }
  if (schemaDir && !existsSync(schemaDir)) throw new Error(`pack "${name}": schema dir not found: ${schemaDir}`);
  const mine = schemaDir ? yamlNames(schemaDir) : [];
  const core = new Set(yamlNames(SCHEMA_DIR));
  for (const s of mine) {
    if (core.has(s)) throw new Error(`pack schema "${s}" (${name}) collides with core`);
    for (const p of getPacks().values()) {
      if (p.schemaDir && yamlNames(p.schemaDir).includes(s)) throw new Error(`pack schema "${s}" (${name}) collides with pack ${p.name}`);
    }
  }
  const pack = { name, schemaDir, entities: { ...entities }, types: [...types] };
  setPack(name, pack);
  _cache.clear();
  return pack;
}

/** Drop every registered pack (tests; a host switching instances in one process). */
export function resetPacks() { clearPacks(); _cache.clear(); }

/** The registered packs, in registration order. */
export function registeredPacks() { return [...getPacks().values()]; }

/** Is `value` a member of `axis` in the canonical state model (K1)? */
export function isValid(axis, value) {
  const s = loadSchema('review-maturity');
  const a = s.axes?.[axis];
  return !!a && Array.isArray(a.values) && a.values.includes(value);
}

// --- object-schema validation (K2/K3/K5 etc.) ---

function collectFields(schema) {
  const inherited = schema.extends ? collectFields(loadSchema(schema.extends)) : {};
  return { ...inherited, ...(schema.fields || {}) };
}

function collectRequired(schema) {
  const inherited = schema.extends ? collectRequired(loadSchema(schema.extends)) : [];
  return [...new Set([...inherited, ...(schema.required || [])])];
}

/** Public: the effective field map of a schema (with `extends` inheritance applied). */
export function schemaFields(schemaName) {
  return collectFields(loadSchema(schemaName));
}

/**
 * Validate a plain object against an object-schema (`required` + `fields`, with `extends`).
 * Extra fields are allowed (the model is open/extensible per Principle 11). A field def may
 * carry `enum: [...]` or `axis: <K1 axis>` (validated against the canonical state model).
 * Returns { valid, errors }.
 */
export function validateObject(schemaName, obj) {
  const schema = loadSchema(schemaName);
  const fields = collectFields(schema);
  const required = collectRequired(schema);
  const errors = [];
  for (const r of required) {
    if (obj[r] === undefined || obj[r] === null || obj[r] === '') errors.push(`missing required field: ${r}`);
  }
  for (const [k, v] of Object.entries(obj)) {
    const def = fields[k];
    if (!def) continue; // unknown fields permitted (open model)
    if (def.enum && !def.enum.includes(v)) errors.push(`invalid value for "${k}": ${JSON.stringify(v)}`);
    if (def.axis && !isValid(def.axis, v)) errors.push(`invalid ${def.axis} for "${k}": ${JSON.stringify(v)}`);
    if (def.type === 'array' && v !== undefined && !Array.isArray(v)) {
      errors.push(`${k} must be an array`);
    }
  }
  return { valid: errors.length === 0, errors };
}

// --- semantic kernel (SP2): the interoperability contract ---

/**
 * Validate the kernel's internal consistency (the fork-compatibility contract):
 * every Layer-B extension declares a `maps_to_core` that resolves to a real Layer-A
 * core type; the kernel-profile (MOK) references real types. Returns { valid, errors }.
 */
export function validateKernel() {
  const errors = [];
  const core = loadSchema('core-entities');
  const ext = loadSchema('extension-entities');
  const coreNames = new Set(Object.keys(core.entities || {}));
  for (const [name, def] of Object.entries(ext.entities || {})) {
    if (!def.maps_to_core) errors.push(`extension "${name}" missing maps_to_core`);
    else if (!coreNames.has(def.maps_to_core)) errors.push(`extension "${name}" maps_to_core "${def.maps_to_core}" is not a core type`);
  }
  const kp = loadSchema('kernel-profile');
  const allNames = new Set([...coreNames, ...Object.keys(ext.entities || {})]);
  for (const [name, def] of Object.entries(kp.objects || {})) {
    const t = String(def.type || '').split('/').pop();
    if (!allNames.has(t)) errors.push(`kernel object "${name}" references unknown type "${t}"`);
  }
  return { valid: errors.length === 0, errors };
}

/** Is a fork's local extension type interop-compatible? (must map to a real core type) */
export function isForkCompatible(localType) {
  const core = loadSchema('core-entities');
  const coreNames = new Set(Object.keys(core.entities || {}));
  return !!localType?.maps_to_core && coreNames.has(localType.maps_to_core);
}

/** Generate a JSON-LD @context from the kernel (graph-compatible / AI-readable serialization). */
export function toJsonLdContext(baseIri = 'https://regen-commons.org/ns/') {
  const ctx = { '@version': 1.1, '@vocab': baseIri };
  for (const schemaName of ['core-entities', 'extension-entities']) {
    const s = loadSchema(schemaName);
    for (const name of Object.keys(s.entities || {})) ctx[name] = baseIri + name;
  }
  const rels = loadSchema('relationships');
  for (const group of Object.values(rels.groups || {})) {
    for (const p of Object.keys(group.predicates || {})) ctx[p] = { '@id': baseIri + p, '@type': '@id' };
  }
  return { '@context': ctx };
}
