// packages/org-os-kms/test/visibility.test.mjs — the visibility floor: core enforces what a gated pack declares (kms plan Task 7).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import * as fw from '../src/framework.mjs';
import { OPS } from '../src/ops.mjs';
import { resetRegistryBindings } from '../src/bind.mjs';
import { loadKmsConfig } from '../src/config.mjs';
import { visibilityFloor, publishRequires } from '../src/visibility.mjs';
import { planPublish } from '../src/atproto/publish.mjs';
import { loadSharedLexicons } from '../src/pack-publish.mjs';

const AUTH = 'xyz.example.kb';
const need = (visibility) => ({ id: 'n1', title: 'Need', type: 'need', category: 'Tools and tech', text: 'x', public_use: 'ok-with-caveat', ...(visibility ? { visibility } : {}) });

beforeEach(() => { fw.resetPacks(); resetRegistryBindings(); });

function instance({ gate = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vis-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'resource.yaml'), yaml.dump({ entries: { a: { title: 'A', type: 'resource', public_use: 'ok-with-caveat' } } }));
  writeFileSync(join(dir, 'data', 'kb', 'need.yaml'), yaml.dump({ entries: { 'm-need': { ...need('matching-only'), id: undefined } } }));
  if (gate) writeFileSync(join(dir, 'gate.mjs'), 'export function isPublishable(){ return { ok: true }; }');
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', extensions: ['org-os-needs-offers'],
    publish: { base_url: 'https://t.example', types_opt_in: ['need'], ...(gate ? { gate: 'gate.mjs' } : {}) },
    atproto: { did: 'did:plc:me', handle: 'x.test', pds: 'https://pds.test', nsid_authority: AUTH } }));
  return dir;
}

test('public passes', () => { loadKmsConfig(instance()); assert.equal(visibilityFloor(need('public'), 'need').ok, true); });
test('matching-only is refused', () => { loadKmsConfig(instance()); const r = visibilityFloor(need('matching-only'), 'need'); assert.equal(r.ok, false); assert.match(r.reason, /visibility/); });
test('private is refused', () => { loadKmsConfig(instance()); assert.equal(visibilityFloor(need('private'), 'need').ok, false); });
test('missing visibility is refused, not passed', () => { loadKmsConfig(instance()); assert.equal(visibilityFloor(need(), 'need').ok, false); });
test('a schema with no requirement passes (a core resource)', () => {
  loadKmsConfig(instance());
  assert.equal(visibilityFloor({ title: 'R', type: 'resource' }, 'resource').ok, true);
  assert.deepEqual(Object.keys(publishRequires()).sort(), ['need', 'offer']);
});

test('planPublish fails closed for a matching-only item even when called directly', async () => {
  const config = loadKmsConfig(instance());
  const plan = planPublish({ items: [{ schema: 'need', object: need('matching-only'), ref: 'data/kb/need.yaml#m-need' }], manifest: { version: 1, objects: {} }, did: 'did:plc:me', authority: AUTH, shared: await loadSharedLexicons(config.packs) });
  assert.equal(plan.ok, false); assert.deepEqual(plan.create, []);
  assert.match(plan.errors[0].errors[0], /^visibility floor:/);
});

test('an instance gate that returns { ok: true } for everything does not widen it', async () => {
  const dir = instance({ gate: true }); const log = [];
  const client = () => ({ async login() {}, async putRecord(op) { log.push(op.collection); return { uri: `at://x/${op.collection}/${op.rkey}`, cid: 'c' }; }, async deleteRecord() {} });
  const res = await OPS.publish.run({ dir, flags: { apply: true }, deps: { createClient: client, env: { ATPROTO_APP_PASSWORD: 'pw' } } });
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.deepEqual(log, [`${AUTH}.resource`]);
  assert.equal(res.report.withheld.visibility, 1);
});
