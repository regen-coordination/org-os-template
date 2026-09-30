// pure: which entities to register in Geo (create/update/skip), their relations, and which registry entries are
// no longer planned (orphaned — reported, never deleted: Geo writes are additive here). Vocabulary entries first,
// so objects can relate to them by value or alias.
import { contentHash } from '../atproto/publish.mjs';
import { slugFromRef } from '../manifest.mjs';
import { geoIdFromUuid, derivedGeoId, isGeoId } from './ids.mjs';
import { GEO_REGISTRY_PATH } from './registry.mjs';

const DESCRIPTION_FIELDS = ['summary', 'short_description', 'description'];
const MAX_DESCRIPTION = 300;
const oneLine = (s) => s.trim().replace(/\s+/g, ' ');
const clip = (s) => (s.length > MAX_DESCRIPTION ? `${s.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…` : s);
const describe = (o) => { for (const f of DESCRIPTION_FIELDS) if (typeof o[f] === 'string' && o[f].trim()) return clip(oneLine(o[f])); return ''; };
const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const aliasesOf = (rec) => {
  const a = rec.aliases;
  if (Array.isArray(a)) return a.filter((x) => typeof x === 'string');
  if (a && typeof a === 'object') return Object.values(a).flat().filter((x) => typeof x === 'string');
  return [];
};

const tryGeoId = (id) => { try { return geoIdFromUuid(id); } catch { return null; } };

export function planGeoRegistration({ items, vocabularies = [], geo, registry }) {
  const errors = []; const warnings = [];
  if (registry.space && geo.space && registry.space !== geo.space) errors.push(`${GEO_REGISTRY_PATH} belongs to space ${registry.space}; kms.yaml names space ${geo.space}. Use a new registry for a new space.`);
  if (registry.network && registry.network !== geo.network) errors.push(`${GEO_REGISTRY_PATH} was written on ${registry.network}; kms.yaml names ${geo.network}`);

  const entities = [];
  const vocabIndex = new Map();
  for (const { decl, records } of vocabularies) {
    const ix = new Map(); vocabIndex.set(decl.namespace, ix);
    for (const rec of records) {
      if (!rec?.id || !rec?.name) { errors.push(`vocabulary ${decl.namespace}: a record lacks id or name`); continue; }
      const geoId = derivedGeoId(decl.namespace, rec.id);
      for (const v of [rec.id, ...aliasesOf(rec)]) {
        if (ix.has(v) && ix.get(v) !== geoId) errors.push(`vocabulary ${decl.namespace}: "${v}" names two entries`);
        ix.set(v, geoId);
      }
      const relations = [];
      for (const l of decl.links ?? []) {
        const v = getPath(rec, l.field);
        if (v == null || v === '') continue;
        if (!isGeoId(v)) { errors.push(`${decl.namespace}:${rec.id}: ${l.field} is not a 32-hex Geo id`); continue; }
        relations.push({ toGeoId: v, propertyId: l.property_id, ...(l.to_space ? { toSpace: l.to_space } : {}) });
      }
      entities.push({ key: `${decl.namespace}:${rec.id}`, geoId, name: rec.name, description: typeof rec.description === 'string' ? clip(oneLine(rec.description)) : '', typeId: decl.type_id, url: null, relations });
    }
  }

  const typed = items.filter(({ schema }) => geo.types[schema]);
  const select = geo.select.length ? new Set(geo.select) : null;
  if (select) {
    const known = new Set(typed.flatMap(({ ref, object }) => [object.id, tryGeoId(object.id), slugFromRef(ref)].filter(Boolean)));
    const unknown = geo.select.filter((s) => !known.has(s));
    if (unknown.length) errors.push(`geo.select names entries that are not selectable (unknown, unpublished, or of a type not in geo.types): ${unknown.join(', ')}`);
  }
  for (const { schema, ref, object } of typed) {
    const slug = slugFromRef(ref);
    if (select && !select.has(object.id) && !select.has(tryGeoId(object.id)) && !select.has(slug)) continue;
    if (!object.id) { errors.push(`${schema}:${slug} has no id — publish it before registering it in Geo`); continue; }
    let geoId;
    try { geoId = geoIdFromUuid(object.id); } catch (e) { errors.push(`${schema}:${slug}: ${e.message}`); continue; }
    if (!object.title) { errors.push(`${schema}:${slug} has no title`); continue; }
    const t = geo.types[schema];
    const relations = [];
    for (const r of geo.relations) {
      const v = object[r.from_field];
      if (v == null || v === '') continue;
      const to = vocabIndex.get(r.to_vocabulary)?.get(v);
      if (!to) { warnings.push(`${schema}:${slug}: ${r.from_field} "${v}" has no entry in ${r.to_vocabulary}`); continue; }
      relations.push({ toGeoId: to, propertyId: r.property_id });
    }
    entities.push({ key: `${schema}:${slug}`, geoId, name: object.title, description: describe(object), typeId: t.type_id, url: t.url ? t.url.replace('{slug}', slug) : null, relations });
  }

  const seen = new Map();
  for (const e of entities) {
    if (seen.has(e.geoId)) errors.push(`duplicate Geo id ${e.geoId}: ${seen.get(e.geoId)} and ${e.key}`);
    else seen.set(e.geoId, e.key);
  }
  const plan = { ok: errors.length === 0, errors, warnings, create: [], update: [], skip: [], orphaned: [] };
  if (!plan.ok) return plan;
  for (const e of entities) {
    const hash = contentHash({ name: e.name, description: e.description, typeId: e.typeId, url: e.url, relations: e.relations });
    const prev = registry.entities[e.geoId];
    if (!prev) plan.create.push({ ...e, hash });
    else if (prev.hash === hash) plan.skip.push(e.geoId);
    else plan.update.push({ ...e, hash });
  }
  for (const [geoId, prev] of Object.entries(registry.entities)) if (!seen.has(geoId)) plan.orphaned.push({ geoId, key: prev.key });
  return plan;
}
