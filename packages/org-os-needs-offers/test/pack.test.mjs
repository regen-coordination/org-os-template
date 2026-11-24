// packages/org-os-needs-offers/test/pack.test.mjs — the needs/offers pack: types, required visibility, opt-in gate (kms plan Task 5).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import * as fw from '../../org-os-kms/src/framework.mjs';
import { loadExtensions } from '../../org-os-kms/src/extensions.mjs';
import { loadKmsConfig } from '../../org-os-kms/src/config.mjs';
import { resetRegistryBindings } from '../../org-os-kms/src/bind.mjs';
import { planPublish } from '../../org-os-kms/src/atproto/publish.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const AUTH = 'xyz.example.kb';
const base = { title: 'Need', type: 'need', category: 'Tools and tech', text: 'x', visibility: 'public', public_use: 'ok-with-caveat' };

function instance(extensions = ['org-os-needs-offers']) {
  const dir = mkdtempSync(join(tmpdir(), 'no-pack-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', extensions,
    publish: { types_opt_in: ['need', 'offer'] }, atproto: { did: 'did:plc:me', pds: 'https://pds.test', nsid_authority: AUTH } }));
  return dir;
}
const load = (extensions) => loadKmsConfig(instance(extensions), { packagesDir: join(here, '..', '..') });
const plan = (object, schema = 'need') => planPublish({ items: [{ schema, object: { id: 'n1', ...object }, ref: `data/kb/${schema}.yaml#n1` }], manifest: { version: 1, objects: {} }, did: 'did:plc:me', authority: AUTH });

beforeEach(() => { fw.resetPacks(); resetRegistryBindings(); });

test('the pack registers need and offer, and validates a need with a visibility level', () => {
  load();
  assert.ok(fw.listSchemas().includes('need') && fw.listSchemas().includes('offer'));
  assert.equal(fw.validateObject('need', base).valid, true);
});

test('a need with no visibility is invalid; an unknown level is invalid', () => {
  load();
  const { visibility, ...none } = base;
  const r = fw.validateObject('need', none);
  assert.equal(r.valid, false); assert.match(JSON.stringify(r.errors), /missing required field: visibility/);
  assert.equal(fw.validateObject('need', { ...base, visibility: 'everyone' }).valid, false);
});

test('the types are opt-in: published only when an instance lists them', () => {
  load();
  assert.ok(fw.optInTypes().includes('need') && fw.optInTypes().includes('offer'));
  assert.ok(!fw.publishableTypes({}).includes('need'));
});

test('a core-name collision is a load error', () => {
  const p = mkdtempSync(join(tmpdir(), 'no-coll-'));
  mkdirSync(join(p, 'bad', 'schemas'), { recursive: true });
  writeFileSync(join(p, 'bad', 'pack.yaml'), yaml.dump({ name: 'bad', types: ['resource'] }));
  writeFileSync(join(p, 'bad', 'schemas', 'resource.yaml'), 'id: resource\nversion: 0.1.0\nextends: frontmatter\nrequired: [title]\nfields: {}\n');
  assert.throws(() => loadExtensions({ extensions: ['bad'] }, { packagesDir: p }), /collides with core/);
});

test('planPublish refuses a gated-pack type that declares no public_fields', () => {
  const p = mkdtempSync(join(tmpdir(), 'no-gated-'));
  mkdirSync(join(p, 'g', 'schemas'), { recursive: true });
  writeFileSync(join(p, 'g', 'pack.yaml'), yaml.dump({ name: 'g', types: ['gizmo'], visibility_gated: true, publish_requires: { gizmo: { visibility: 'public' } } }));
  writeFileSync(join(p, 'g', 'schemas', 'gizmo.yaml'), 'id: gizmo\nversion: 0.1.0\nextends: frontmatter\nrequired: [title]\nfields: {}\n');
  loadExtensions({ extensions: ['g'] }, { packagesDir: p });
  const r = plan({ title: 'G', type: 'gizmo' }, 'gizmo');
  assert.equal(r.ok, false); assert.match(JSON.stringify(r.errors), /public_fields/);
});

test('planPublish refuses a gated-pack type that declares public_fields but no publish_requires', () => {
  const p = mkdtempSync(join(tmpdir(), 'no-gated2-'));
  mkdirSync(join(p, 'g', 'schemas'), { recursive: true });
  writeFileSync(join(p, 'g', 'pack.yaml'), yaml.dump({ name: 'g', types: ['gizmo'], visibility_gated: true, public_fields: { gizmo: ['title', 'type'] } }));
  writeFileSync(join(p, 'g', 'schemas', 'gizmo.yaml'), 'id: gizmo\nversion: 0.1.0\nextends: frontmatter\nrequired: [title]\nfields: {}\n');
  loadExtensions({ extensions: ['g'] }, { packagesDir: p });
  const r = plan({ title: 'G', type: 'gizmo' }, 'gizmo');
  assert.equal(r.ok, false); assert.match(JSON.stringify(r.errors), /publish_requires/);
});

test('a public need record has no contact_route and no intro_wanted, and still validates', () => {
  load();
  const r = plan({ ...base, contact_route: 'SECRET-ROUTE', intro_wanted: true, notes: 'n' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const rec = r.create[0].record;
  assert.equal(rec.contact_route, undefined); assert.equal(rec.intro_wanted, undefined); assert.equal(rec.notes, undefined);
  assert.equal(rec.visibility, 'public'); assert.equal(rec.text, 'x');
  // the probe that found the leak: without the cut, toRecord keeps both
  assert.equal(fw.toRecord({ visibility: 'public', contact_route: 'X', intro_wanted: true }, 'x.need').contact_route, 'X');
});

test('an offer is cut the same way', () => {
  load();
  const r = plan({ title: 'Offer', type: 'offer', category: 'Tools and tech', text: 'y', terms: 't', visibility: 'public', public_use: 'ok-with-caveat', contact_route: 'S' }, 'offer');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.create[0].record.contact_route, undefined); assert.equal(r.create[0].record.terms, 't');
});

test('a pack without visibility_gated is unchanged (org-os-territory plans ok)', () => {
  load(['org-os-territory']);
  const r = plan({ title: 'U', type: 'territorial-unit', unit_id: 'landscape:unit:a', layer: 'landscape', level: 'unit', public_use: 'ok-with-caveat', notes: 'private' }, 'territorial-unit');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.create[0].record.unit_id, 'landscape:unit:a');
});

test('a pack requiring a higher kms is refused', () => {
  const p = mkdtempSync(join(tmpdir(), 'no-ver-'));
  mkdirSync(join(p, 'future'), { recursive: true });
  writeFileSync(join(p, 'future', 'pack.yaml'), yaml.dump({ name: 'future', types: [], requires: { kms: '>=9.0.0' } }));
  assert.throws(() => loadExtensions({ extensions: ['future'] }, { packagesDir: p }), /requires kms >=9\.0\.0, found 0\.2\.0/);
});
