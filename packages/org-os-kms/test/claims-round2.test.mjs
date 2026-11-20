// packages/org-os-kms/test/claims-round2.test.mjs — seat-7 fixes, round 2: what a consented claim does end to end (B, C, D, E).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPublish } from '../src/atproto/publish.mjs';
import { claimView } from '../src/claims.mjs';

const claimOf = (schema, extra = {}) => ({ id: `claim-${schema}`, type: schema, title: `Node ${schema}`, public_use: 'ok-with-caveat', claim_for: 'https://node-a.example', claim_status: 'claimed',
  claim_checked_on: '2026-11-18', consent_atproto: '2026-11-19', contact_email: 'pat@node-a.example', ...extra });
const it = (schema, object) => ({ schema, ref: `data/kb/${schema}.yaml#${object.id}`, object });
const manifest = { version: 1, objects: {} };
const plan = (items) => planPublish({ items, manifest, did: 'did:plc:me', authority: 'xyz.example.kb', publishClaims: true, claimPublisher: 'ReFi DAO' });

// ---- B: the cut keeps the schema's required fields; a claim that still fails validation is withheld, never a plan error ----
test('B claimView keeps the schema-required fields (signal_type for a signal) and still cuts the contact', () => {
  const v = claimView(claimOf('signal', { signal_type: 'content' }), 'ReFi DAO', 'signal');
  assert.equal(v.signal_type, 'content'); assert.equal(v.contact_email, undefined);
});

test('B end to end: a consented signal claim is published, and the rest of the plan is not an error', () => {
  const p = plan([it('signal', claimOf('signal', { signal_type: 'content' })), it('organization', claimOf('organization'))]);
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  const sig = p.create.find((o) => o.type === 'signal');
  assert.ok(sig, 'the signal claim is created');
  assert.equal(sig.record.signal_type, 'content'); assert.equal(sig.record.publisher, 'ReFi DAO'); assert.equal(sig.record.contact_email, undefined);
  assert.equal(p.create.length, 2);
});

test('B a claim that still fails validation is a per-claim withheld with its reason; the rest is published and the plan is ok', () => {
  const p = plan([it('signal', claimOf('signal')), it('organization', claimOf('organization'))]); // no signal_type: the signal schema requires it
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.create.map((o) => o.type), ['organization']);
  assert.equal(p.withheld.length, 1);
  assert.equal(p.withheld[0].type, 'signal');
  assert.match(p.withheld[0].reason, /signal_type/);
});

test('B a non-claim that fails validation is still a plan error (only a claim is withheld)', () => {
  const p = plan([it('signal', { id: 's1', type: 'signal', title: 'Plain signal', public_use: 'ok-with-caveat' })]);
  assert.equal(p.ok, false);
});

// ---- the whole publish op, fake client: consented claims of four schemas, with contact fields and provenance.authorship ----
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { OPS } from '../src/ops.mjs';

const fake = (log) => () => ({
  async login() { return { did: 'did:plc:me' }; },
  async putRecord(op) { log.push(['put', op.collection, op.rkey, op.record]); return { uri: `at://did:plc:me/${op.collection}/${op.rkey}`, cid: 'cid1' }; },
  async deleteRecord(op) { log.push(['del', op.rkey]); },
});
function instance(entries, { standard = false, pages = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kms-claim-op-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  for (const [schema, rows] of Object.entries(entries)) writeFileSync(join(dir, 'data', 'kb', `${schema}.yaml`), yaml.dump({ entries: rows }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.',
    publish: { base_url: 'https://t.example', claims: true, claim_publisher: 'ReFi DAO', pages, types_opt_in: ['signal'] },
    atproto: { did: 'did:plc:me', handle: 'kc.test', pds: 'https://pds.test', nsid_authority: 'xyz.example.kb', ...(standard ? { standard_site: { enabled: true, title: 'T', url: 'https://t.example', paths: { default: '/k/{slug}' } } } : {}) } }));
  return dir;
}
const run = (dir, log) => OPS.publish.run({ dir, flags: { apply: true }, deps: { createClient: fake(log), env: { ATPROTO_APP_PASSWORD: 'pw' } } });

test('B op: one consented signal claim no longer fails the whole publish', async () => {
  const dir = instance({
    signal: { s1: { title: 'Signal Claim', type: 'signal', signal_type: 'content', public_use: 'ok-with-caveat', claim_for: 'https://node-a.example', claim_status: 'claimed', consent_atproto: '2026-11-19', contact_email: 'pat@node-a.example' } },
    organization: { o1: { title: 'Org Claim', type: 'organization', public_use: 'ok-with-caveat', claim_for: 'https://node-b.example', claim_status: 'claimed', consent_atproto: '2026-11-19', contact_email: 'sam@node-b.example' } },
  });
  const log = [];
  const res = await run(dir, log);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.equal(res.report.atproto.created, 2);
  for (const [, , , rec] of log.filter((l) => l[0] === 'put')) assert.ok(!JSON.stringify(rec).includes('@'), JSON.stringify(rec));
  const sig = JSON.parse(readFileSync(join(dir, 'public', 'api', 'signal.json'), 'utf8')).items[0];
  assert.equal(sig.signal_type, 'content'); assert.equal(sig.contact_email, undefined);
});

// ---- C: a site.standard.document carries no claim marks, so a claim's document would read as the instance's own ----
import { planStandardSite } from '../src/atproto/standard-site.mjs';

test('C standard.site: a claim is withheld with a reason; an ordinary entry beside it still gets its document', () => {
  const ssConfig = { atproto: { standard_site: { enabled: true, title: 'T', url: 'https://t.example', paths: { default: '/k/{slug}' } } }, publish: { base_url: 'https://t.example' } };
  const items = [it('organization', claimOf('organization')), it('organization', { id: 'plain', type: 'organization', title: 'Plain', public_use: 'ok-with-caveat' })];
  const entryPlan = { create: [], update: [] };
  const ss = planStandardSite({ items, entryPlan, manifest, did: 'did:plc:me', authority: 'xyz.example.kb', config: ssConfig });
  assert.equal(ss.ok, true, JSON.stringify(ss.errors));
  assert.deepEqual(ss.create.map((o) => o.id), ['plain']);
  assert.equal(ss.withheld.length, 1);
  assert.equal(ss.withheld[0].id, 'claim-organization');
  assert.match(ss.withheld[0].reason, /claim/);
});

test('C standard.site: a claim already published as a document is deleted (not kept) once it is withheld', () => {
  const ssConfig = { atproto: { standard_site: { enabled: true, title: 'T', url: 'https://t.example' } }, publish: { base_url: 'https://t.example' } };
  const m = { version: 1, objects: {}, standardSite: { publication: null, documents: { 'claim-organization': { slug: 'claim-organization', rkey: 'abc', cid: 'c' } } } };
  const ss = planStandardSite({ items: [it('organization', claimOf('organization'))], entryPlan: { create: [], update: [] }, manifest: m, did: 'did:plc:me', authority: 'xyz.example.kb', config: ssConfig });
  assert.deepEqual(ss.delete.map((o) => o.id), ['claim-organization']);
});

// ---- D: a person's name can reach a claim through provenance.authorship or the free text of source_lineage ----
import { writeStaticSurface } from '../src/static/surface.mjs';
import { buildCommons } from '../src/pages/model.mjs';

const NAMED = { provenance: { origin: 'the node\'s own site', transformation: 'summarized', authorship: 'Pat Quill' }, source_lineage: 'Interview with Pat Quill, 2026-11-18' };
const dConfig = { instance: 't', publish: { base_url: 'https://t.example', pages: false, claims: true, claim_publisher: 'ReFi DAO' }, atproto: { did: 'did:plc:me', nsid_authority: 'xyz.example.kb' } };

test('D claimView drops provenance.authorship and the free-text source_lineage, and keeps the rest of provenance', () => {
  const v = claimView(claimOf('organization', NAMED), 'ReFi DAO', 'organization');
  assert.ok(!JSON.stringify(v).includes('Pat Quill'), JSON.stringify(v));
  assert.equal(v.provenance.authorship, undefined); assert.equal(v.source_lineage, undefined);
  assert.equal(v.provenance.origin, 'the node\'s own site'); assert.equal(v.provenance.transformation, 'summarized');
});

test('D a claim whose provenance holds only authorship carries no provenance at all', () => {
  const v = claimView(claimOf('organization', { provenance: { authorship: 'Pat Quill' } }), 'ReFi DAO', 'organization');
  assert.equal(v.provenance, undefined);
});

test('D a name in provenance.authorship reaches no surface of a claim: record, static API, page model', async () => {
  const object = claimOf('organization', NAMED);
  const p = plan([it('organization', object)]);
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  assert.ok(!JSON.stringify(p.create[0].record).includes('Pat Quill'));
  const dir = mkdtempSync(join(tmpdir(), 'kms-claim-d-')); mkdirSync(join(dir, '.well-known'));
  await writeStaticSurface({ dir, items: [it('organization', object)], manifest, config: dConfig });
  assert.ok(!readFileSync(join(dir, 'public', 'api', 'organization', 'claim-organization.json'), 'utf8').includes('Pat Quill'));
  assert.ok(!JSON.stringify(buildCommons({ items: [it('organization', object)], manifest, config: dConfig, now: '2026-11-20T00:00:00Z', mode: 'public' })).includes('Pat Quill'));
});

test('D an object that is not a claim keeps its provenance and source_lineage as before', () => {
  const plain = { id: 'p', type: 'organization', title: 'Plain', public_use: 'ok-with-caveat', ...NAMED };
  const p = plan([it('organization', plain)]);
  assert.equal(p.ok, true);
  assert.ok(JSON.stringify(p.create[0].record).includes('Pat Quill'), 'unchanged: the cut is for claims only');
});

// ---- E: what the AT plan withholds, the static API and the pages withhold too ----
const claimRow = (extra) => ({ type: 'x', public_use: 'ok-with-caveat', claim_status: 'claimed', consent_atproto: '2026-11-19', ...extra });

test('E op: a claim the AT plan withholds is not in the static API or the pages either; the claim it publishes is', async () => {
  const dir = instance({
    signal: { bad: claimRow({ title: 'Signal No Type', type: 'signal', claim_for: 'https://node-a.example' }) }, // no signal_type: the plan withholds it
    organization: { good: claimRow({ title: 'Org Good', type: 'organization', claim_for: 'https://node-b.example' }) },
  }, { pages: true });
  const log = [];
  const res = await run(dir, log);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.equal(res.report.atproto.created, 1);
  assert.equal(res.report.withheld.claim_details.length, 1);
  const api = join(dir, 'public', 'api');
  assert.ok(!existsSync(join(api, 'signal.json')), 'the withheld claim has no static API listing');
  assert.ok(existsSync(join(api, 'organization.json')));
  const everything = res.report.static.files.map((f) => readFileSync(join(dir, 'public', f), 'utf8')).join('\n');
  assert.ok(!everything.includes('Signal No Type'), 'no page, index or API entry names the withheld claim');
  assert.ok(everything.includes('Org Good'), 'the published claim is still shown');
});
