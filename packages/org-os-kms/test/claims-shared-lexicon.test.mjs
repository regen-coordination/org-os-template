// packages/org-os-kms/test/claims-shared-lexicon.test.mjs — a claim of a type that lives in a SHARED lexicon (seat-7 fixes).
// The shared collection (example.commons.need, …) is somebody else's schema. If it has no place for the claim marks, a claim put
// there would read as the node's OWN record. So it is withheld, not published, until the lexicon carries the marks (fail closed).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import * as fw from '../src/framework.mjs';
import { OPS } from '../src/ops.mjs';
import { resetRegistryBindings } from '../src/bind.mjs';
import { planPublish } from '../src/atproto/publish.mjs';

const AUTH = 'xyz.example.kb';
beforeEach(() => { fw.resetPacks(); resetRegistryBindings(); });

const claimNeed = { title: 'Node A needs tools', type: 'need', category: 'Tools and tech', text: 'a plain public text', contact_route: 'PUBLIC', intro_wanted: true,
  public_use: 'ok-with-caveat', visibility: 'public', claim_for: 'https://node-a.example', claim_status: 'claimed', consent_atproto: '2026-11-19' };

function instance() {
  const dir = mkdtempSync(join(tmpdir(), 'claims-shared-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'need.yaml'), yaml.dump({ entries: { 'node-a-need': claimNeed, 'plain-need': { ...claimNeed, title: 'A plain need', claim_for: undefined, claim_status: undefined, consent_atproto: undefined } } }));
  writeFileSync(join(dir, 'federation.yaml'), yaml.dump({ identity: { name: 'claims-os', type: 'PersonalNode' }, peers: [] }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', extensions: ['org-os-needs-offers'],
    publish: { base_url: 'https://t.example', types_opt_in: ['need'], claims: true, claim_publisher: 'ReFi DAO' },
    atproto: { did: 'did:plc:me', handle: 'x.test', pds: 'https://pds.test', nsid_authority: AUTH } }));
  return dir;
}

test('op: a claim of a shared-lexicon type is withheld with the reason, nothing of it is put, and the plain object is published', async () => {
  const dir = instance(); const puts = [];
  const client = () => ({ async login() {}, async putRecord(op) { puts.push(op); return { uri: `at://did:plc:me/${op.collection}/${op.rkey}`, cid: 'c' }; }, async deleteRecord() {} });
  const res = await OPS.publish.run({ dir, flags: { apply: true }, deps: { createClient: client, env: { ATPROTO_APP_PASSWORD: 'pw' }, allowPlaceholderLexicons: true } });
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.deepEqual(puts.map((p) => p.record.title), ['A plain need']);
  assert.equal(res.report.withheld.claims, 1);
  assert.equal(res.report.withheld.claim_details.length, 1);
  assert.match(res.report.withheld.claim_details[0].reason, /example\.commons\.need.*no claim marks/);
});

// A shared entry built by hand: the lexicon doc says which marks it carries, toRecord says what it keeps.
const doc = (props) => ({ lexicon: 1, id: 'example.shared.org', defs: { main: { type: 'record', key: 'any', record: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, ...props } } } } });
const MARKS = { claim_for: { type: 'string' }, claim_status: { type: 'string' }, publisher: { type: 'string' } };
const item = { schema: 'organization', ref: 'data/kb/organization.yaml#a', object: { id: 'c1', type: 'organization', title: 'Node A', public_use: 'ok-with-caveat',
  claim_for: 'https://node-a.example', claim_status: 'claimed', consent_atproto: '2026-11-19' } };
const plan = (shared) => planPublish({ items: [item], manifest: { version: 1, objects: {} }, did: 'did:plc:me', authority: AUTH, shared, publishClaims: true, claimPublisher: 'ReFi DAO' });
const keepAll = (o) => ({ $type: 'example.shared.org', ...o });

test('planPublish: a lexicon without the claim marks withholds the claim (plan stays ok, withheld names it)', () => {
  const p = plan({ organization: { doc: doc({}), toRecord: keepAll } });
  assert.equal(p.ok, true); assert.deepEqual(p.create, []);
  assert.equal(p.withheld.length, 1); assert.equal(p.withheld[0].id, 'c1'); assert.match(p.withheld[0].reason, /no claim marks/);
});

test('planPublish: a lexicon that carries the marks, with a toRecord that keeps them, publishes the claim into the shared collection', () => {
  const p = plan({ organization: { doc: doc(MARKS), toRecord: keepAll } });
  assert.equal(p.ok, true, JSON.stringify(p.errors)); assert.equal(p.create.length, 1); assert.deepEqual(p.withheld, []);
  assert.equal(p.create[0].collection, 'example.shared.org');
  assert.equal(p.create[0].record.publisher, 'ReFi DAO'); assert.equal(p.create[0].record.consent_atproto, undefined);
});

test('planPublish: a lexicon that declares the marks but whose toRecord drops them still withholds (the record is what is checked)', () => {
  const p = plan({ organization: { doc: doc(MARKS), toRecord: (o) => ({ $type: 'example.shared.org', title: o.title }) } });
  assert.deepEqual(p.create, []); assert.equal(p.withheld.length, 1); assert.match(p.withheld[0].reason, /record/);
});

test('planPublish: a plain object of a shared type is unaffected by the claim rule', () => {
  const plain = { ...item, object: { id: 'p1', type: 'organization', title: 'Plain', public_use: 'ok-with-caveat' } };
  const p = planPublish({ items: [plain], manifest: { version: 1, objects: {} }, did: 'did:plc:me', authority: AUTH, shared: { organization: { doc: doc({}), toRecord: keepAll } } });
  assert.equal(p.create.length, 1); assert.deepEqual(p.withheld, []);
});
