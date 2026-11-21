// packages/org-os-kms/test/claims-round3.test.mjs — seat-7 fixes, round 3: which schemas may be claimed (F2), the bridge follows the plan (F3).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import * as fw from '../src/framework.mjs';
import { resetRegistryBindings } from '../src/bind.mjs';
import { claimFloor, CLAIMABLE_SCHEMAS } from '../src/claims.mjs';
import { planPublish } from '../src/atproto/publish.mjs';
import { planStandardSite } from '../src/atproto/standard-site.mjs';
import { selectForPublication } from '../src/planes/select-for-publication.mjs';
import { OPS } from '../src/ops.mjs';
import { bridge } from '../src/registry-bridge.mjs';

beforeEach(() => { fw.resetPacks(); resetRegistryBindings(); });

const CFG = { publish: { claims: true, claim_publisher: 'ReFi DAO' } };
const marks = { public_use: 'ok-with-caveat', claim_for: 'https://node-a.example', claim_status: 'claimed', consent_atproto: '2026-11-19' };
const prov = { provenance: { origin: 'Interview with Pat Quill', transformation: 'summarized' } };
// One consented claim per schema, each with a person's name in the field that schema holds it in.
const CLAIMS = {
  organization: { id: 'c-org', type: 'organization', title: 'Org Claim', ...marks, ...prov },
  signal: { id: 'c-sig', type: 'signal', title: 'Signal Claim', signal_type: 'content', ...marks, ...prov },
  'relationship-record': { id: 'c-rel', type: 'relationship-record', title: 'Rel Claim', subject: 'Pat Quill', predicate: 'knows', object: 'Sam Rivera', ...marks, ...prov },
  'contribution-record': { id: 'c-con', type: 'contribution-record', title: 'Con Claim', contributor: 'Pat Quill', what: 'wrote a thing', where_it_appears: 'the node page', ...marks, ...prov },
};
const NAMES = ['Pat Quill', 'Sam Rivera'];

// ---- F2: only a node-shaped schema may be claimed ----
test('F2 claimFloor: the allow-list schemas pass, a person-bearing schema is refused with a reason naming it', () => {
  for (const s of ['organization', 'signal', 'encyclopedia-entry', 'resource', 'option-entry']) {
    assert.equal(claimFloor({ ...CLAIMS.organization, type: s }, CFG, s).ok, true, s);
  }
  for (const s of ['relationship-record', 'contribution-record', 'source-system', 'deployment', 'claim-evidence', 'implementation-record', 'track']) { // track: audience is a required free string that can name a person (round 4)
    const r = claimFloor({ ...CLAIMS.organization, type: s }, CFG, s);
    assert.equal(r.ok, false, s); assert.match(r.reason, new RegExp(s)); assert.match(r.reason, /person/);
  }
  assert.deepEqual([...CLAIMABLE_SCHEMAS].sort(), ['encyclopedia-entry', 'option-entry', 'organization', 'resource', 'signal']);
});

test('F2 claimFloor: an object that is not a claim is unaffected, whatever its schema', () => {
  assert.equal(claimFloor({ id: 'r', type: 'relationship-record', subject: 'a', object: 'b', predicate: 'p' }, CFG, 'relationship-record').ok, true);
});

const manifest = { version: 1, objects: {} };
const it = (schema, object) => ({ schema, ref: `data/kb/${schema}.yaml#${object.id}`, object });
const planOf = (items) => planPublish({ items, manifest, did: 'did:plc:me', authority: 'xyz.example.kb', publishClaims: true, claimPublisher: 'ReFi DAO' });

test('F2 plan: a relationship-record and a contribution-record claim are withheld with a reason, the plan is ok, and the node-shaped claims are published', () => {
  const p = planOf(Object.entries(CLAIMS).map(([s, o]) => it(s, o)));
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  assert.deepEqual(p.create.map((o) => o.type).sort(), ['organization', 'signal']);
  assert.deepEqual(p.withheld.map((w) => w.type).sort(), ['contribution-record', 'relationship-record']);
  for (const w of p.withheld) assert.match(w.reason, /person/);
  for (const n of NAMES) assert.ok(!JSON.stringify(p.create).includes(n), n);
});

test('F2 standard.site: nothing of a claim is planned (round 2 C), so a withheld person-bearing claim has no document either', () => {
  const ssConfig = { atproto: { standard_site: { enabled: true, title: 'T', url: 'https://t.example', paths: { default: '/k/{slug}' } } }, publish: { base_url: 'https://t.example' } };
  const ss = planStandardSite({ items: Object.entries(CLAIMS).map(([s, o]) => it(s, o)), entryPlan: { create: [], update: [] }, manifest, did: 'did:plc:me', authority: 'xyz.example.kb', config: ssConfig });
  assert.deepEqual(ss.create, []);
  assert.equal(ss.withheld.length, 4);
});

const fake = (log) => () => ({
  async login() { return { did: 'did:plc:me' }; },
  async putRecord(op) { log.push(['put', op.collection, op.rkey, op.record]); return { uri: `at://did:plc:me/${op.collection}/${op.rkey}`, cid: 'cid1' }; },
  async deleteRecord(op) { log.push(['del', op.rkey]); },
});
function instance(entries, { standard = false, pages = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kms-claim-r3-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  for (const [schema, rows] of Object.entries(entries)) writeFileSync(join(dir, 'data', 'kb', `${schema}.yaml`), yaml.dump({ entries: rows }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.',
    publish: { base_url: 'https://t.example', claims: true, claim_publisher: 'ReFi DAO', pages, types_opt_in: ['signal'] },
    atproto: { did: 'did:plc:me', handle: 'kc.test', pds: 'https://pds.test', nsid_authority: 'xyz.example.kb', ...(standard ? { standard_site: { enabled: true, title: 'T', url: 'https://t.example', paths: { default: '/k/{slug}' } } } : {}) } }));
  return dir;
}
const allFiles = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(join(d, e.name)) : [join(d, e.name)]));
const rowsOf = () => Object.fromEntries(Object.entries(CLAIMS).map(([s, o]) => { const { id, ...rest } = o; return [s, { [id]: rest }]; }));

test('F2 probe, publish op (fake client): four consented claims, a name in each; the person-bearing two are withheld everywhere, no name leaves by any file', async () => {
  const dir = instance(rowsOf(), { standard: true });
  const log = [];
  const res = await OPS.publish.run({ dir, flags: { apply: true }, deps: { createClient: fake(log), env: { ATPROTO_APP_PASSWORD: 'pw' } } });
  assert.equal(res.ok, true, JSON.stringify(res.report));
  const puts = log.filter((l) => l[0] === 'put' && !l[1].startsWith('site.standard.')); // the standard.site publication record is the instance's own
  assert.deepEqual(puts.map((p) => p[3].title).sort(), ['Org Claim', 'Signal Claim']);
  // relationship-record is publishable by default, so the floor withholds its claim (counted); contribution-record is not a publishable type
  // at all, so it never reaches the claim floor (the plan test above covers it directly).
  assert.equal(res.report.withheld.claims, 1, JSON.stringify(res.report.withheld));
  const out = join(dir, 'public');
  const text = [JSON.stringify(log), ...allFiles(out).map((f) => readFileSync(f, 'utf8'))].join('\n');
  for (const n of NAMES) assert.ok(!text.includes(n), `${n} reached an output`);
  assert.ok(!text.includes('Rel Claim') && !text.includes('Con Claim'), 'the withheld claims are listed nowhere');
  assert.ok(text.includes('Org Claim') && text.includes('Signal Claim'));
  assert.ok(!text.includes('Interview with'), 'no provenance.origin');
});

test('F2 probe, export: a claim of any schema is refused by the export, so no name goes to a public plane', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kms-claim-r3-exp-'));
  fw.getAdapter('repo-data').store(dir, Object.entries(CLAIMS).map(([schema, object]) => ({ schema, object })));
  const verdicts = new Map(fw.getAdapter('repo-data').list(dir).map((l) => [`${l.schema}:${l.ref.slice(l.ref.lastIndexOf('#') + 1)}`, { ok: true }]));
  assert.equal(verdicts.size, 4);
  const r = selectForPublication({ root: dir, verdicts, uuid: () => 'u', types: Object.keys(CLAIMS), config: CFG });
  assert.deepEqual(r.selected, []);
  assert.equal(r.floorRejected.length, 4);
});

test('F2 bridge: a contribution-record claim (and a relationship-record one, which has no registry) writes no row, and is named as withheld with the reason', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kms-claim-r3-br-'));
  fw.getAdapter('repo-data').store(dir, Object.entries(CLAIMS).map(([schema, object]) => ({ schema, object })));
  const out = bridge({ dir, config: { adapter: 'repo-data', target: '.', publish: { claims: true, claim_publisher: 'ReFi DAO' } } });
  assert.equal(out.ok, true, JSON.stringify(out.report));
  // contribution-record is bound to a registry, so the floor withholds it with the reason; relationship-record has no registry here, so the bridge
  // skips it before it writes anything (it is in report.skipped, never a row).
  assert.deepEqual(out.report.withheld.filter((x) => /person/.test(x.reason)).map((x) => x.schema), ['contribution-record']);
  assert.ok(out.report.skipped.includes('relationship-record'));
  const text = allFiles(dir).map((f) => readFileSync(f, 'utf8')).join('\n');
  // the canon (data/kb) holds the names by design; the registries and pages written by the bridge must not
  for (const f of allFiles(dir).filter((f) => !f.includes(`${join(dir, 'data', 'kb')}`))) for (const n of NAMES) assert.ok(!readFileSync(f, 'utf8').includes(n), `${n} in ${f}`);
  assert.ok(text.length > 0);
});

// ---- F3: the bridge follows the same withhold decision as the AT plan, the static API and the pages ----
import { bridgeAsync } from '../src/registry-bridge.mjs';
import { loadKmsConfig } from '../src/config.mjs';

const claimNeed = { title: 'Node A needs tools', type: 'need', category: 'Tools and tech', text: 'a plain public text', contact_route: 'PUBLIC', intro_wanted: true,
  public_use: 'ok-with-caveat', visibility: 'public', claim_for: 'https://node-a.example', claim_status: 'claimed', consent_atproto: '2026-11-19' };
function needInstance({ atproto = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'claims-r3-need-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'need.yaml'), yaml.dump({ entries: { 'node-a-need': claimNeed, 'plain-need': { ...claimNeed, title: 'A plain need', claim_for: undefined, claim_status: undefined, consent_atproto: undefined } } }));
  writeFileSync(join(dir, 'federation.yaml'), yaml.dump({ identity: { name: 'claims-os', type: 'PersonalNode' }, peers: [] }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', extensions: ['org-os-needs-offers'],
    publish: { base_url: 'https://t.example', types_opt_in: ['need'], claims: true, claim_publisher: 'ReFi DAO' },
    ...(atproto ? { atproto: { did: 'did:plc:me', handle: 'x.test', pds: 'https://pds.test', nsid_authority: 'xyz.example.kb' } } : {}) }));
  return dir;
}
const needTitles = (dir) => (existsSync(join(dir, 'data', 'needs.yaml')) ? (yaml.load(readFileSync(join(dir, 'data', 'needs.yaml'), 'utf8')).needs ?? []).map((r) => r.title) : []);

test('F3 the bridge withholds a claim the AT plan withholds (a shared lexicon without claim marks): no row in data/needs.yaml, the reason is named, the plain need is bridged', async () => {
  const dir = needInstance();
  const out = await bridgeAsync({ dir, config: loadKmsConfig(dir) });
  assert.equal(out.ok, true, JSON.stringify(out.report));
  assert.deepEqual(needTitles(dir), ['A plain need']);
  const w = out.report.withheld.find((x) => x.title === 'Node A needs tools');
  assert.ok(w, JSON.stringify(out.report));
  assert.match(w.reason, /example\.commons\.need.*no claim marks/);
});

test('F3 the same instance through publish: the AT plan, the static API and the bridge all leave the claim out', async () => {
  const dir = needInstance(); const puts = [];
  const client = () => ({ async login() {}, async putRecord(op) { puts.push(op); return { uri: `at://did:plc:me/${op.collection}/${op.rkey}`, cid: 'c' }; }, async deleteRecord() {} });
  const res = await OPS.publish.run({ dir, flags: { apply: true }, deps: { createClient: client, env: { ATPROTO_APP_PASSWORD: 'pw' }, allowPlaceholderLexicons: true } });
  assert.equal(res.ok, true, JSON.stringify(res.report));
  await OPS.bridge.run({ dir, config: loadKmsConfig(dir) });
  const publicText = [JSON.stringify(puts), ...allFiles(join(dir, 'public')).map((f) => readFileSync(f, 'utf8')), ...(existsSync(join(dir, 'data', 'needs.yaml')) ? [readFileSync(join(dir, 'data', 'needs.yaml'), 'utf8')] : [])].join('\n');
  assert.ok(!publicText.includes('Node A needs tools'));
  assert.ok(publicText.includes('A plain need'));
});

test('F3 with no AT account configured there is no plan to follow: a consented claim whose floor holds is bridged as before', async () => {
  const dir = needInstance({ atproto: false });
  const out = await bridgeAsync({ dir, config: loadKmsConfig(dir) });
  assert.equal(out.ok, true, JSON.stringify(out.report));
  assert.deepEqual(needTitles(dir).sort(), ['A plain need', 'Node A needs tools']);
});
