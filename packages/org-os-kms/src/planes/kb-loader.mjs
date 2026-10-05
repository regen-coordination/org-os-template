// Loads the canon store (data/kb/*.yaml). Does NOT dedupe boundaries — buildBoundaryIndex owns that.
// Every *.yaml present is a schema; an absent file is an empty schema (an empty store is legal).
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { buildBoundaryIndex } from './publication-gate.mjs';
import { cmp } from './constants.mjs';
import { isPlainObject } from './write-published-kb.mjs';

// The vendored `publicView` (zero-edit) rebuilds its output via `out[k] = v`. For the one key
// name `__proto__`, plain bracket assignment on an object literal is intercepted by
// Object.prototype's legacy accessor and reassigns the object's actual [[Prototype]] instead of
// creating an own property — and publicView runs BEFORE this repo's own `stripPrivateDeep`,
// which defends against exactly this (via `setOwn`) but only for keys it encounters while
// walking, never for a rewrite that already happened one call earlier. A top-level `__proto__`
// key therefore survives publicView's own construction as an object whose prototype is no longer
// Object.prototype; stripPrivateDeep's root `isPlainObject` check then fails, which SKIPS its
// recursive walk ENTIRELY — every private field nested anywhere under that reassigned prototype
// reaches the published store unstripped. Nested `__proto__` keys are fine (setOwn only needs to
// defend the level it is rebuilding, and it does), so strictly only a TOP-level `__proto__` key
// is broken — but refusing at any depth is one rule instead of two, and removes any need for a
// future reader to work out which depths happen to be safe.
//
// Refused at LOAD, the same way an entry key containing '#' already is: the canon cannot safely
// represent this shape, so it is rejected before it ever reaches a writer, not caught only on the
// next `commons:validate` run after the unsafe file already exists and could have been committed.
function findProtoKeyPath(value, prefix = '') {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findProtoKeyPath(value[i], prefix ? `${prefix}[${i}]` : `[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const k of Object.keys(value)) {
      const kp = prefix ? `${prefix}.${k}` : k;
      if (k === '__proto__') return kp;
      const hit = findProtoKeyPath(value[k], kp);
      if (hit) return hit;
    }
  }
  return null;
}

export function loadKb(kbDir) {
  const objects = {};
  const files = fs.existsSync(kbDir) ? fs.readdirSync(kbDir).filter((f) => f.endsWith('.yaml')).sort(cmp) : [];
  for (const f of files) {
    const type = f.slice(0, -'.yaml'.length);
    const filePath = path.join(kbDir, f);
    let doc;
    try {
      doc = yaml.load(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      throw new Error(`kb-loader: ${filePath}: ${err?.message ?? String(err)}`);
    }
    for (const [slug, obj] of Object.entries(doc?.entries ?? {})) {
      // The repo-data adapter's ref format is `<file>#<slug>` and its own comment says a slug is
      // "[a-z0-9-] and never contains '#'". A key that violates that (or is empty) cannot be
      // round-tripped through that ref format: select-for-publication and write-published-kb both
      // derive the slug via `ref.lastIndexOf('#')`, and a key containing '#' would split at the
      // wrong place there, silently disagreeing with the key loadKb used here. Enforcing the
      // invariant at load, once, keeps both of those derivations safe as written.
      if (typeof slug !== 'string' || slug === '') {
        throw new Error(`kb-loader: ${filePath}: entry key ${JSON.stringify(slug)} is empty, which the repo-data ref format cannot represent`);
      }
      if (slug.includes('#')) {
        throw new Error(`kb-loader: ${filePath}: entry key ${JSON.stringify(slug)} contains '#', which the repo-data ref format cannot represent`);
      }
      // The same hazard as findProtoKeyPath below, one level out: `bySchema.get(schema)[slug] =
      // ...` in write-published-kb.mjs is plain bracket assignment on an object literal, so a
      // slug of EXACTLY `__proto__` reseats that object's prototype instead of adding an entry —
      // the object silently vanishes from the published file (already-sanitised data, so this is
      // loss, not a leak, but a `commons:export` that reports success while writing `entries: {}`
      // is its own hazard). Exact-match only: a slug that merely contains the substring is an
      // ordinary string and is not this hazard.
      if (slug === '__proto__') {
        throw new Error(`kb-loader: ${filePath}: entry key ${JSON.stringify(slug)} cannot be safely projected`);
      }
      const protoPath = findProtoKeyPath(obj);
      if (protoPath) {
        throw new Error(`kb-loader: ${filePath}: entry ${JSON.stringify(slug)} contains a "__proto__" key at ${protoPath}, which cannot be safely projected`);
      }
      objects[`${type}:${slug}`] = { ...obj, type, slug };
    }
  }
  const sourceSystems = {}; const boundaryRecords = [];
  for (const obj of Object.values(objects)) {
    if (obj.type === 'source-system') sourceSystems[obj.slug] = obj;
    if (obj.type === 'public-use-boundary') boundaryRecords.push(obj);
  }
  // boundaryRecords is returned alongside the built index so callers (export-commons) can lint the
  // raw control data with validateBoundaries() — the index alone has already discarded the shape
  // information a lint needs (e.g. which record was unkeyable and why).
  return { objects, sourceSystems, boundaries: buildBoundaryIndex(boundaryRecords), boundaryRecords };
}
