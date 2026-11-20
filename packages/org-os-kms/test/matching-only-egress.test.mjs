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
const publish = (dir, puts, dels) => OPS.publish.run({ dir, flags: { apply: true }, deps: { createClient: clientFor(puts, dels), env } });

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
