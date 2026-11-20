// packages/org-os-kms/src/gate.mjs — the instance gate hook. Framework gate is the floor; this can only narrow.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { slugFromRef } from './manifest.mjs';
import * as fw from './framework.mjs';
import { packPublishRules } from './pack-publish.mjs';
import { visibilityFloor } from './visibility.mjs';
import { claimFloor } from './claims.mjs';

export async function loadInstanceGate(dir, config) {
  const rel = config.publish?.gate;
  if (!rel) return null;
  const mod = await import(pathToFileURL(join(dir, rel)).href);
  if (typeof mod.isPublishable !== 'function') throw new Error(`publish.gate ${rel} does not export isPublishable(obj, ctx)`);
  return mod.isPublishable;
}

export function buildGateContext(allItems) {
  const sourceSystems = {}; const boundaries = [];
  for (const { schema, ref, object } of allItems) {
    if (schema === 'source-system') sourceSystems[slugFromRef(ref)] = { ...object, slug: slugFromRef(ref) };
    if (schema === 'public-use-boundary' || Object.prototype.hasOwnProperty.call(object, 'tier')) boundaries.push(object);
  }
  return { sourceSystems, boundaries };
}

export function applyGate(gate, items, ctx) {
  const passed = []; const rejected = [];
  for (const it of items) {
    const v = gate({ ...it.object, type: it.object.type ?? it.schema, slug: slugFromRef(it.ref) }, ctx);
    const ok = typeof v === 'boolean' ? v : Boolean(v?.ok);
    if (ok) passed.push(it); else rejected.push({ slug: slugFromRef(it.ref), reason: (typeof v === 'object' && v?.reason) || 'rejected by instance gate' });
  }
  return { passed, rejected };
}

/**
 * What may be public, from the whole canon `all`: the framework floor (publishableTypes/isPublishable), then the
 * instance gate, which can only narrow. The one place both `publish` and the steward's preview decide it.
 * A type of a visibility-gated pack that declares no publish_requires / public_fields is withheld here (counted in
 * `withheld.undeclared`), and one whose object misses a declared `publish_requires` value (`withheld.visibility`), and a claim that misses its floor (`withheld.claims`), so one undeclared type never fails the whole plan; planPublish refuses it independently.
 * → { candidates, rejected, gated, withheld } (gated: an instance gate ran; candidates are what passed)
 */
export async function selectPublic({ dir, config, all }) {
  const types = fw.publishableTypes(config);
  const eligible = all.filter(({ schema, object }) => fw.isPublishable(object, { schema, types }));
  const declared = (schema) => { const r = packPublishRules(schema); return !r || Boolean(r.publish_requires && r.public_fields); };
  const declaredOnly = eligible.filter(({ schema }) => declared(schema));
  // The visibility floor sits right after the framework floor and BEFORE the instance gate, which can only narrow it.
  const visible = declaredOnly.filter(({ schema, object }) => visibilityFloor(object, schema).ok);
  // The claims floor (src/claims.mjs) sits beside it: a claim about a node is published only with the node's consent date and publish.claims on.
  const floor = visible.filter(({ object }) => claimFloor(object, config).ok);
  const withheld = { undeclared: eligible.length - declaredOnly.length, visibility: declaredOnly.length - visible.length, claims: visible.length - floor.length };
  const gate = await loadInstanceGate(dir, config);
  if (!gate) return { candidates: floor, rejected: [], gated: false, withheld };
  const { passed, rejected } = applyGate(gate, floor, buildGateContext(all));
  return { candidates: passed, rejected, gated: true, withheld };
}
