// packages/org-os-needs-offers/test/plan-publish-shared.test.mjs — planPublish puts shared-lexicon types in the shared collection (kms plan Task 6).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import * as fw from '../../org-os-kms/src/framework.mjs';
import { loadKmsConfig } from '../../org-os-kms/src/config.mjs';
import { resetRegistryBindings } from '../../org-os-kms/src/bind.mjs';
import { loadSharedLexicons } from '../../org-os-kms/src/pack-publish.mjs';
import { planPublish, applyPublish } from '../../org-os-kms/src/atproto/publish.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const AUTH = 'xyz.example.kb';
const need = { id: 'n1', title: 'Need', type: 'need', category: 'Tools and tech', text: 'x', visibility: 'public', public_use: 'ok-with-caveat' };
const item = (object, schema = 'need') => ({ schema, object, ref: `data/kb/${schema}.yaml#${object.id}` });
const empty = { version: 1, objects: {} };

beforeEach(() => { fw.resetPacks(); resetRegistryBindings(); });

async function shared() {
  const dir = mkdtempSync(join(tmpdir(), 'no-shared-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', extensions: ['org-os-needs-offers'] }));
  const config = loadKmsConfig(dir, { packagesDir: join(here, '..', '..') });
  return loadSharedLexicons(config.packs);
}
const resource = { id: 'r1', title: 'R', type: 'resource', public_use: 'ok-with-caveat' };

test('planPublish puts a need in the shared collection, not the instance authority; a core item still uses the authority', async () => {
  const s = await shared();
  const plan = planPublish({ items: [item(need), item(resource, 'resource')], manifest: empty, did: 'did:plc:me', authority: AUTH, shared: s });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(plan.create.find((o) => o.type === 'need').collection, 'example.commons.need');
  assert.equal(plan.create.find((o) => o.type === 'need').record.$type, 'example.commons.need');
  assert.equal(plan.create.find((o) => o.type === 'resource').collection, `${AUTH}.resource`);
});

test('a record the shared lexicon rejects fails the whole plan', async () => {
  const s = await shared();
  const { text, ...noText } = need;
  const plan = planPublish({ items: [item(noText), item(resource, 'resource')], manifest: empty, did: 'did:plc:me', authority: AUTH, shared: s });
  assert.equal(plan.ok, false); assert.deepEqual(plan.create, []);
  assert.match(JSON.stringify(plan.errors), /missing required field: text/);
});

test('a need that left the selection is deleted from the shared collection', async () => {
  const s = await shared(); const puts = []; const dels = [];
  const plan = planPublish({ items: [item(need)], manifest: empty, did: 'did:plc:me', authority: AUTH, shared: s });
  const client = { async putRecord(op) { puts.push(op.collection); return { uri: `at://x/${op.collection}/${op.rkey}`, cid: 'c1' }; }, async deleteRecord(op) { dels.push(op.collection); } };
  const { manifest } = await applyPublish(plan, { client, did: 'did:plc:me' });
  assert.equal(manifest.objects.n1.collection, 'example.commons.need');
  const gone = planPublish({ items: [], manifest, did: 'did:plc:me', authority: AUTH, shared: s });
  assert.equal(gone.delete[0].collection, 'example.commons.need');
  await applyPublish(gone, { client, did: 'did:plc:me' });
  assert.deepEqual(dels, ['example.commons.need']);
});

test('a manifest entry with no collection still deletes from the core collection', () => {
  const manifest = { version: 1, objects: { r1: { slug: 'r', type: 'resource', rkey: 'r1', atUri: 'at://x/y/r1', cid: 'c', hash: 'h' } } };
  const plan = planPublish({ items: [], manifest, did: 'did:plc:me', authority: AUTH });
  assert.equal(plan.delete[0].collection, `${AUTH}.resource`);
});

test('a need whose category has no home in the lexicon stays canon-only, and is deleted if it was published', async () => {
  const s = await shared();
  const other = { ...need, category: 'Other' };
  const plan = planPublish({ items: [item(other)], manifest: empty, did: 'did:plc:me', authority: AUTH, shared: s });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors)); assert.deepEqual(plan.create, []);
  const before = { version: 1, objects: { n1: { slug: 'n1', type: 'need', rkey: 'n1', collection: 'example.commons.need', atUri: 'at://x/example.commons.need/n1', cid: 'c', hash: 'h' } } };
  assert.equal(planPublish({ items: [item(other)], manifest: before, did: 'did:plc:me', authority: AUTH, shared: s }).delete[0].collection, 'example.commons.need');
});

// The pack's own public_fields whitelist, tested directly. With no shared lexicon the record comes from fw.toRecord, which keeps
// every non-private key, so only planPublish's whitelist cuts a matching-only field here.
test('planPublish cuts a need to the pack public_fields: contact_route and intro_wanted never reach a record', async () => {
  await shared(); // loads the pack (its publish rules and the need schema) into the registry
  const withContact = { ...need, contact_route: 'MATCHING-ONLY-CONTACT', intro_wanted: true };
  const plan = planPublish({ items: [item(withContact)], manifest: empty, did: 'did:plc:me', authority: AUTH });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  const rec = plan.create[0].record;
  assert.equal(rec.title, 'Need');
  assert.equal('contact_route' in rec, false); assert.equal('intro_wanted' in rec, false);
  assert.equal(JSON.stringify(plan).includes('MATCHING-ONLY-CONTACT'), false);
});
