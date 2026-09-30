// Geo (GRC-20) ids. An object's Geo id is its UUID without dashes
// (one identity across git, AT Proto and Geo); a vocabulary entry gets a UUIDv8 = SHA-256(namespace:key)[0:16]
// with version/variant bits set (GRC-20 encoding §8). Nothing here talks to Geo.
import { createHash } from 'node:crypto';

const DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DASHLESS = /^[0-9a-f]{32}$/i;

export function geoIdFromUuid(id) {
  if (typeof id !== 'string' || !(DASHED.test(id) || DASHLESS.test(id))) throw new Error(`geo: not a UUID: ${JSON.stringify(id)}`);
  return id.replace(/-/g, '').toLowerCase();
}

export function derivedGeoId(namespace, key) {
  if (!namespace || !key) throw new Error('geo: derivedGeoId needs a namespace and a key');
  const b = Buffer.from(createHash('sha256').update(`${namespace}:${key}`, 'utf8').digest().subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  return b.toString('hex');
}

export const isGeoId = (s) => typeof s === 'string' && /^[0-9a-f]{32}$/.test(s);
