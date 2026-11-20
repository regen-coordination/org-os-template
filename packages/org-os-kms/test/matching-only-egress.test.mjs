// packages/org-os-kms/test/matching-only-egress.test.mjs — a matching-only need appears nowhere but the private canon (kms plan Task 7, Review Focus 1).
// A sentinel string sits in title, text and contact_route; every output the instance can produce is then searched for it.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import * as fw from '../src/framework.mjs';
import { OPS } from '../src/ops.mjs';
import { resetRegistryBindings } from '../src/bind.mjs';
import { loadKmsConfig } from '../src/config.mjs';
import { buildMap } from '../src/map.mjs';
import { exportCommons } from '../src/planes/export-commons.mjs';
import { makeCanon, makeCommons, readTree } from './planes/helpers.mjs';

const AUTH = 'xyz.example.kb';
const SENTINEL = 'SENTINEL-MATCHING-ONLY-7f3a';
const SHARED = 'example.commons.need';
beforeEach(() => { fw.resetPacks(); resetRegistryBindings(); });

const matching = { title: `Need ${SENTINEL}`, type: 'need', category: 'Tools and tech', text: `wants ${SENTINEL}`, contact_route: `${SENTINEL}@example.org`, intro_wanted: true, public_use: 'ok-with-caveat', visibility: 'matching-only' };
const pub = { title: 'A public need', type: 'need', category: 'Land and place', text: 'a plain public text', contact_route: 'PUBLIC-NEED-CONTACT', intro_wanted: true, public_use: 'ok-with-caveat', visibility: 'public' };

function instance(entries) {
  const dir = mkdtempSync(join(tmpdir(), 'egress-')); // no git, no remote
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'resource.yaml'), yaml.dump({ entries: { r: { title: 'A resource', type: 'resource', public_use: 'ok-with-caveat' } } }));
  writeFileSync(join(dir, 'data', 'kb', 'need.yaml'), yaml.dump({ entries }));
  writeFileSync(join(dir, 'federation.yaml'), yaml.dump({ identity: { name: 'egress-os', type: 'PersonalNode' }, peers: [] }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', extensions: ['org-os-needs-offers'],
    publish: { base_url: 'https://t.example', types_opt_in: ['need'] },
    atproto: { did: 'did:plc:me', handle: 'x.test', pds: 'https://pds.test', nsid_authority: AUTH } }));
  return dir;
}
const clientFor = (puts, dels) => () => ({ async login() {}, async putRecord(op) { puts.push(op); return { uri: `at://did:plc:me/${op.collection}/${op.rkey}`, cid: 'c1' }; }, async deleteRecord(op) { dels.push(op); } });
const env = { ATPROTO_APP_PASSWORD: 'pw' };
const walk = (root, rel = '') => readdirSync(join(root, rel), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(root, join(rel, e.name)) : [join(rel, e.name)]);
const filesWith = (dir, needle) => walk(dir).filter((f) => readFileSync(join(dir, f), 'utf8').includes(needle)).sort();
const publish = (dir, puts, dels) => OPS.publish.run({ dir, flags: { apply: true }, deps: { createClient: clientFor(puts, dels), env, allowPlaceholderLexicons: true } });

test('the sentinel reaches no record, no output file and no map: it stays in the private canon', async () => {
  const dir = instance({ 'm-need': matching, 'p-need': pub }); const puts = []; const dels = [];
  const config = loadKmsConfig(dir);
  const res = await publish(dir, puts, dels);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  OPS['index.rebuild'].run({ dir, config });
  assert.equal(OPS['render.site'].run({ dir, config }).ok, true);
  assert.equal(OPS.bridge.run({ dir, config }).ok, true);
  buildMap({ dir });
  assert.equal(JSON.stringify(puts).includes(SENTINEL), false, 'a captured putRecord carries the sentinel');
  assert.deepEqual(filesWith(dir, SENTINEL), ['data/kb/need.yaml']);
  assert.equal(existsSync(join(dir, 'public')), true);
});

test('the public need IS published, in the shared collection, cut to the lexicon; the static api cut it too', async () => {
  const dir = instance({ 'm-need': matching, 'p-need': pub }); const puts = []; const dels = [];
  const res = await publish(dir, puts, dels);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  const rec = puts.find((o) => o.collection === SHARED);
  assert.ok(rec, 'the public need was not published: the floor is simply off');
  assert.equal(rec.record.text, 'a plain public text'); assert.equal(rec.record.contact_route, undefined);
  assert.equal(res.report.withheld.visibility, 1);
  const api = JSON.parse(readFileSync(join(dir, 'public', 'api', 'need.json'), 'utf8'));
  assert.equal(api.count, 1); assert.equal(api.items[0].contact_route, undefined); assert.equal(api.items[0].intro_wanted, undefined);
  assert.deepEqual(filesWith(dir, 'PUBLIC-NEED-CONTACT'), ['data/kb/need.yaml']);
});

async function downgrade(change) {
  const dir = instance({ 'p-need': pub }); const puts = []; const dels = [];
  assert.equal((await publish(dir, puts, dels)).ok, true);
  const file = join(dir, 'data', 'kb', 'need.yaml');
  const doc = yaml.load(readFileSync(file, 'utf8'));
  change(doc.entries); writeFileSync(file, yaml.dump(doc));
  const res = await publish(dir, puts, dels);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  return { dels, res };
}

test('a need downgraded to matching-only or private is deleted from the SHARED collection', async () => {
  for (const level of ['matching-only', 'private']) {
    fw.resetPacks(); resetRegistryBindings();
    const { dels, res } = await downgrade((e) => { e['p-need'].visibility = level; });
    assert.equal(res.report.atproto.deleted, 1, level);
    assert.deepEqual(dels.map((d) => d.collection), [SHARED], level);
  }
});

test('the registry bridge skips a non-public need and never writes a canon-only field into a row', async () => {
  const dir = instance({ 'm-need': matching, 'p-need': pub }); const config = loadKmsConfig(dir);
  const r = OPS.bridge.run({ dir, config });
  assert.equal(r.ok, true, JSON.stringify(r.report));
  const rows = yaml.load(readFileSync(join(dir, 'data', 'needs.yaml'), 'utf8')).needs;
  assert.deepEqual(rows.map((x) => x.title), ['A public need']);
  assert.equal(rows[0].contact_route, undefined); assert.equal(rows[0].intro_wanted, undefined);
  assert.equal(r.report.withheld.some((w) => w.schema === 'need' && w.reason === 'visibility'), true);
});

test('a need removed from the canon is deleted from the shared collection', async () => {
  const { dels, res } = await downgrade((e) => { delete e['p-need']; });
  assert.equal(res.report.atproto.deleted, 1);
  assert.deepEqual(dels.map((d) => d.collection), [SHARED]);
});

test('the export verb: matching-only and private needs never reach the commons; the public one does', () => {
  const lineage = 'repos/ReFi-Barcelona/notes/x.md';
  const base = { maturity: 'reviewed', source_lineage: lineage, public_use: 'ok-with-caveat', type: 'need' };
  const root = makeCanon({ need: {
    'm-need': { ...base, title: `Need ${SENTINEL}`, text: `wants ${SENTINEL}`, contact_route: `${SENTINEL}@example.org`, visibility: 'matching-only' },
    'x-need': { ...base, title: 'PRIVATE-NEED-TITLE', visibility: 'private' },
    'p-need': { ...base, title: 'A public need', text: 'a plain public text', contact_route: 'PUBLIC-NEED-CONTACT', visibility: 'public' },
  } });
  const outDir = makeCommons(undefined, undefined, { extensions: ['org-os-needs-offers'], types_opt_in: ['need'] });
  let n = 0;
  const r = exportCommons({ root, outDir, uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` });
  const out = readTree(outDir);
  const all = JSON.stringify(out) + JSON.stringify(r);
  for (const leak of [SENTINEL, 'PRIVATE-NEED-TITLE', 'PUBLIC-NEED-CONTACT', 'contact_route']) assert.equal(all.includes(leak), false, `the export leaked ${leak}`);
  assert.equal(out[join('data', 'kb', 'need.yaml')].includes('A public need'), true, 'the public need was not exported: the floor is simply off');
});

test('apply is refused while a shared lexicon is the placeholder example.commons.*: no client, no putRecord, no deleteRecord; plan mode still works', async () => {
  const dir = instance({ 'p-need': pub }); const puts = []; const dels = []; let created = 0;
  const createClient = (...a) => { created++; return clientFor(puts, dels)(...a); };
  const refused = await OPS.publish.run({ dir, flags: { apply: true }, deps: { createClient, env } });
  assert.equal(refused.ok, false);
  assert.equal(refused.report.atproto.status, 'failed');
  assert.match(refused.report.atproto.reason, /example\.commons\.need/); assert.match(refused.report.atproto.reason, /placeholder/);
  assert.equal(created, 0, 'a client was created for a placeholder lexicon'); assert.deepEqual([puts, dels], [[], []]);
  fw.resetPacks(); resetRegistryBindings();
  const planned = await OPS.publish.run({ dir, flags: {}, deps: { createClient, env } });
  assert.equal(planned.ok, true, JSON.stringify(planned.report)); assert.equal(planned.report.atproto.status, 'planned'); assert.equal(planned.report.atproto.created, 2); // the public need and the resource
});

test('index.json (render.site) counts a gated type only when it passes the floor: a node moving between matching-only and private moves no count', () => {
  const counts = (m, x) => {
    fw.resetPacks(); resetRegistryBindings();
    const dir = instance({ 'p-need': pub, 'm-need': { ...matching, visibility: m }, 'x-need': { ...matching, title: 'other', visibility: x } });
    const config = loadKmsConfig(dir);
    OPS['index.rebuild'].run({ dir, config });
    assert.equal(OPS['render.site'].run({ dir, config }).ok, true);
    const idx = JSON.parse(readFileSync(join(dir, 'src', 'data', 'kms-index.json'), 'utf8'));
    return { need: idx.by_type.need, total: idx.total, text: JSON.stringify(idx) };
  };
  const a = counts('matching-only', 'private'); const b = counts('private', 'matching-only'); const c = counts('private', 'private');
  assert.equal(a.need, 1); assert.deepEqual([a.need, a.total], [b.need, b.total]); assert.deepEqual([a.need, a.total], [c.need, c.total]);
  assert.equal(a.total, 2, 'the public need and the resource'); // the private canon index keeps its own, honest counts
  assert.equal(counts('public', 'private').need, 2, 'a node that becomes public is counted: it is public');
});
