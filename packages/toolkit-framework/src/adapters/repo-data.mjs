// src/adapters/repo-data.mjs — the org-os instance target: per-schema registry
// files under data/kb/. Deliberately does NOT touch an instance's existing
// data/*.yaml (different shapes); @org-os/kms bridges the two.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import yaml from 'js-yaml';
import { slugify, deriveIndex, sameStoredObject, isOwnKey } from '../util.mjs';
import { hashContent } from '../workorder.mjs';
import { toJsonLdContext } from '../index.mjs';

function atomicWrite(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function safeSchema(schema) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(schema))) throw new Error(`invalid schema name for storage: ${JSON.stringify(schema)}`);
  return schema;
}

export function slugFor(object) {
  return slugify(object.title || object.id || '') || `untitled-${hashContent(yaml.dump(object)).slice(0, 8)}`;
}

const fileFor = (target, schema) => join(target, 'data', 'kb', `${safeSchema(schema)}.yaml`);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// --- slug-collision merge (BR2) -----------------------------------------------
// The ingest brief tells agents to give the same real-world entity the same
// title "so it dedups". Before this, a slug collision REPLACED the entry, so a
// thin later mention destroyed a richer earlier one — and agents learned to
// defensively skip already-noded entities, losing their provenance links instead.
// Merge rules (all conservative, "never lose what's already on disk"):
//   · scalars      — the EXISTING value wins; the incoming may only FILL a gap
//                    (undefined / null / ''). false and 0 are values, not gaps.
//   · arrays       — union, order-stable, de-duplicated
//   · nested maps  — merged recursively under the same rules
//   · maturity     — existing wins outright, so a `raw` re-store can never revert
//                    a `reviewed` entry, and store can never auto-promote either
//                    (promotion is review-promote's human-gated job)
//   · notes        — both sides kept, existing first, joined by NOTE_DELIM,
//                    never duplicating text the existing side already contains
//   · provenance   — the existing block + source_lineage stay primary; the
//                    incoming one is appended to additional_provenance[] unless
//                    an identical record is already recorded (incl. the primary)
// Storing a byte-identical object twice is therefore a no-op.

const NOTE_DELIM = '\n\n---\n\n';

const isGap = (v) => v === undefined || v === null || v === '';

const dedupeKey = (v) => (v !== null && typeof v === 'object' ? `j:${JSON.stringify(v)}` : `${typeof v}:${String(v)}`);

function unionArrays(existing, incoming) {
  const out = [];
  const seen = new Set();
  for (const v of [...existing, ...incoming]) {
    const k = dedupeKey(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

// Both sides kept, existing first. De-duplication is per whole SEGMENT (exact,
// trimmed) rather than substring: that is enough to converge on a re-store —
// the incoming text is already its own segment — while never swallowing a short
// incoming note just because its words happen to occur inside the existing one.
function mergeNotes(existing, incoming) {
  if (isGap(existing)) return incoming;
  if (isGap(incoming)) return existing;
  const a = String(existing);
  const b = String(incoming);
  const already = new Set(a.split(NOTE_DELIM).map((s) => s.trim()));
  if (b.split(NOTE_DELIM).map((s) => s.trim()).every((s) => already.has(s))) return existing;
  return `${a}${NOTE_DELIM}${b}`;
}

// Recursive value merge: existing wins, incoming fills gaps, arrays union.
// A type conflict (array vs non-empty scalar, map vs scalar) resolves to the
// existing value — coercing would change the object's shape under the operator.
function mergeValue(existing, incoming) {
  if (isGap(existing)) return incoming;
  if (isGap(incoming)) return existing;
  if (Array.isArray(existing) && Array.isArray(incoming)) return unionArrays(existing, incoming);
  if (isPlainObject(existing) && isPlainObject(incoming)) {
    const out = { ...existing };
    for (const [k, v] of Object.entries(incoming)) out[k] = mergeValue(existing[k], v);
    return out;
  }
  return existing;
}

// The comparable identity of one provenance contribution: the block itself plus
// the lineage pointers that say WHICH pass produced it.
function provRecord(object) {
  const p = object?.provenance;
  if (!isPlainObject(p)) return null;
  const rec = { ...p };
  if (!isGap(object.work_order)) rec.work_order = object.work_order;
  if (!isGap(object.source_lineage)) rec.source_lineage = object.source_lineage;
  return rec;
}

const provKey = (rec) => JSON.stringify(Object.keys(rec).sort().map((k) => [k, rec[k]]));

function mergeObjects(existing, incoming) {
  const merged = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (k === 'provenance' || k === 'additional_provenance') continue;  // handled below
    if (k === 'maturity') { if (isGap(existing[k])) merged[k] = v; continue; }
    if (k === 'notes') { merged[k] = mergeNotes(existing[k], v); continue; }
    merged[k] = mergeValue(existing[k], v);
  }

  // Provenance. The existing block (+ its source_lineage / work_order) stays
  // primary; if the existing entry had none, the incoming one becomes primary
  // rather than being filed as "additional".
  const primary = provRecord(existing);
  if (!primary) {
    if (isPlainObject(incoming.provenance)) merged.provenance = incoming.provenance;
  }
  const extra = Array.isArray(existing.additional_provenance) ? [...existing.additional_provenance] : [];
  const seen = new Set(extra.filter(isPlainObject).map(provKey));
  const primaryNow = provRecord(merged);
  if (primaryNow) seen.add(provKey(primaryNow));
  const candidates = [
    ...(isPlainObject(incoming.provenance) ? [provRecord(incoming)] : []),
    ...(Array.isArray(incoming.additional_provenance) ? incoming.additional_provenance : []),
  ].filter(isPlainObject);
  for (const rec of candidates) {
    const k = provKey(rec);
    if (seen.has(k)) continue;
    seen.add(k);
    extra.push(rec);
  }
  if (extra.length) merged.additional_provenance = extra;
  return merged;
}

// Normalize: a hand-edited/legacy file without an `entries:` key must not crash
// store/update. But a doc that IS present and NOT a mapping (scalar, list) can't
// be round-tripped through the mapping model — refuse loudly rather than coerce,
// because coercion would silently drop the existing content on the next write.
const loadFile = (p) => {
  if (!existsSync(p)) return { entries: {} };
  const doc = yaml.load(readFileSync(p, 'utf8'));
  if (doc !== null && doc !== undefined && !isPlainObject(doc)) {
    throw new Error(`not a registry file (expected a YAML mapping): ${p}`);
  }
  const d = doc || {};
  if ('entries' in d && !isPlainObject(d.entries)) {
    throw new Error(`registry file has a non-mapping "entries" key (hand-edited?) — refusing to touch it: ${p}`);
  }
  return { ...d, entries: d.entries || {} };
};

export const repoDataAdapter = {
  name: 'repo-data',

  store(target, entries, { onCollision = 'suffix' } = {}) {
    const stored = [];
    const collisions = [];
    const byFile = new Map();
    for (const { schema, object, replaces } of entries) {
      const p = fileFor(target, schema);
      if (!byFile.has(p)) byFile.set(p, loadFile(p));
      const reg = byFile.get(p).entries;
      const slug = slugFor(object);
      let key = slug;
      // `replaces`: see kb-folder — honored only for an existing key in THIS schema's registry
      // file that derives from the entry's slug; anything else falls through to the normal path.
      const at = replaces ? replaces.lastIndexOf('#') : -1;
      const rKey = at > 0 ? replaces.slice(at + 1) : null;
      if (rKey !== null && resolve(replaces.slice(0, at)) === resolve(p) && reg[rKey] !== undefined && isOwnKey(rKey, slug)) {
        reg[rKey] = object;
        stored.push(replaces);
        continue;
      }
      if (reg[key] !== undefined && !sameStoredObject(reg[key], object)) {
        if (onCollision === 'merge' && isPlainObject(reg[key])) {
          // BR2 (opt-in, kms.yaml store.on_collision: merge): same slug = same real-world
          // entity. Merge conservatively — never lose what is already on disk.
          reg[key] = mergeObjects(reg[key], object);
          stored.push(`${p}#${key}`);
          continue;
        }
        // Same title-slug, different object (B5): never clobber — give the
        // newcomer a hash-suffixed key and report the collision.
        key = `${slug}-${hashContent(yaml.dump(object)).slice(0, 8)}`;
        collisions.push({ schema, slug, key });
      }
      reg[key] = object;                                // idempotent: same identity overwrites in place
      stored.push(`${p}#${key}`);
    }
    for (const [p, doc] of byFile) atomicWrite(p, yaml.dump(doc));
    return { stored, collisions };
  },

  list(target) {
    const dir = join(target, 'data', 'kb');
    if (!existsSync(dir)) return [];
    const out = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
      const schema = f.replace(/\.yaml$/, '');
      const doc = loadFile(join(dir, f));
      for (const [slug, object] of Object.entries(doc.entries || {})) {
        out.push({ schema, object, ref: `${join(dir, f)}#${slug}` });
      }
    }
    return out;
  },

  update(target, ref, patch) {
    // slugs are [a-z0-9-] and never contain '#', but the target path may — split at the LAST '#'
    const i = ref.lastIndexOf('#');
    const file = ref.slice(0, i);
    const slug = ref.slice(i + 1);
    const doc = loadFile(file);
    if (!doc.entries[slug]) throw new Error(`no entry "${slug}" in ${file}`);
    doc.entries[slug] = { ...doc.entries[slug], ...patch };
    atomicWrite(file, yaml.dump(doc));
    return { ref, object: doc.entries[slug] };
  },

  index(target) {
    return deriveIndex(this.list(target), 'data/kb/');
  },

  writeIndex(target) {
    const indexPath = join(target, 'data', 'kb', 'index.json');
    const contextPath = join(target, 'data', 'kb', 'context.jsonld');
    atomicWrite(indexPath, JSON.stringify(this.index(target), null, 2));
    atomicWrite(contextPath, JSON.stringify(toJsonLdContext(), null, 2));
    return { indexPath, contextPath };
  },
};
