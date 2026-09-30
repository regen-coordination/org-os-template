// packages/org-os-kms/src/geo/registry.mjs — data/kms-geo.json: what this instance has registered in Geo, and where.
// The proof of registration lives here, not on the objects (writing grc20Id onto objects would change their AT Proto records).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from '../atomic-write.mjs';

export const GEO_REGISTRY_PATH = 'data/kms-geo.json';

export function readGeoRegistry(dir) {
  const p = join(dir, GEO_REGISTRY_PATH);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { version: 1, network: null, space: null, entities: {} };
}

export function writeGeoRegistry(dir, registry) {
  const p = join(dir, GEO_REGISTRY_PATH);
  atomicWrite(p, JSON.stringify(registry, null, 2) + '\n');
  return p;
}

export function readVocabulary(path) {
  if (!existsSync(path)) throw new Error(`geo: vocabulary file not found: ${path}`);
  const j = JSON.parse(readFileSync(path, 'utf8'));
  const recs = Array.isArray(j) ? j : Object.values(j ?? {}).find(Array.isArray);
  if (!Array.isArray(recs)) throw new Error(`geo: ${path} holds no list of records`);
  return recs;
}
