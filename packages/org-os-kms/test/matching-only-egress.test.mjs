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

function instance(entries, resource = { title: 'A resource', type: 'resource', public_use: 'ok-with-caveat' }) {
  const dir = mkdtempSync(join(tmpdir(), 'egress-')); // no git, no remote
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'resource.yaml'), yaml.dump({ entries: { r: resource } }));
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

test('the export verb: a public resource whose related names a matching-only or private need carries no such slug into the commons', () => {
  const base = { maturity: 'reviewed', source_lineage: 'repos/ReFi-Barcelona/notes/x.md', public_use: 'ok-with-caveat' };
  const root = makeCanon({
    need: { 'm-need': { ...base, type: 'need', title: 'M', visibility: 'matching-only' }, 'x-need': { ...base, type: 'need', title: 'X', visibility: 'private' } },
    resource: { r: { ...base, type: 'resource', title: 'A resource', related: ['m-need', 'need:m-need', 'x-need'], related_concepts: ['x-need'] } },
  });
  const outDir = makeCommons(undefined, undefined, { extensions: ['org-os-needs-offers'], types_opt_in: ['need'] });
  let n = 0;
  exportCommons({ root, outDir, uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` });
  const all = JSON.stringify(readTree(outDir)); // the files written to the commons; the CLI report names rejected keys by design
  assert.equal(all.includes('A resource'), true, 'the resource was not exported');
  for (const slug of ['m-need', 'x-need']) assert.equal(all.includes(slug), false, `the export carries ${slug}`);
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

// Spec 6.3: "never on a public page, never on atproto". A public record's `related` (and every ref field) must not name a
// matching-only or private object of the canon: not as a slug, an id or a type:slug.
test('a public resource whose related names a matching-only and a private need leaks neither slug anywhere outside the canon', async () => {
  const resource = { title: 'A resource', type: 'resource', public_use: 'ok-with-caveat',
    related: ['m-need', 'need:m-need', 'x-need', 'p-need', 'at://did:plc:other/xyz.example.kb.resource/abc', 'no-such-object'],
    related_concepts: ['x-need', 'p-need'] };
  const dir = instance({ 'm-need': matching, 'x-need': { ...matching, title: 'other', visibility: 'private' }, 'p-need': pub }, resource);
  const puts = []; const dels = []; const config = loadKmsConfig(dir);
  const res = await publish(dir, puts, dels);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  OPS['index.rebuild'].run({ dir, config });
  assert.equal(OPS['render.site'].run({ dir, config }).ok, true);
  assert.equal(OPS.bridge.run({ dir, config }).ok, true);
  buildMap({ dir });
  const rec = puts.find((o) => o.record.title === 'A resource');
  assert.ok(rec, 'the resource was not published');
  for (const slug of ['m-need', 'x-need']) {
    assert.equal(JSON.stringify(puts).includes(slug), false, `a putRecord payload carries ${slug}`);
    const hit = filesWith(dir, slug);
    assert.deepEqual(hit, ['data/kb/need.yaml', 'data/kb/resource.yaml'], `${slug} reached ${hit}`);
  }
  // What stays: a selected object, an at:// URI, and a ref that resolves to nothing local.
  assert.deepEqual(rec.record.related, ['p-need', 'at://did:plc:other/xyz.example.kb.resource/abc', 'no-such-object'], 'the payload keeps only what is public, a foreign at:// and a dangling ref');
  const api = JSON.parse(readFileSync(join(dir, 'public', 'api', 'resource.json'), 'utf8'));
  assert.deepEqual(api.items[0].related, ['p-need', 'at://did:plc:other/xyz.example.kb.resource/abc', 'no-such-object']);
  assert.deepEqual(api.items[0].related_concepts, ['p-need']);
  const rows = yaml.load(readFileSync(join(dir, 'data', 'resources.yaml'), 'utf8')).resources;
  assert.deepEqual(rows[0].related, ['p-need', 'at://did:plc:other/xyz.example.kb.resource/abc', 'no-such-object']);
});

// Round 3: the scrub is by VALUE. A field nobody listed (superseded_by, supersedes, parent, see_also, a nested object) reaches toRecord,
// the pages, the static api and the registry row exactly like `related` does, so an exact slug, id or type:slug of a non-public need
// is removed wherever it sits. Free text ("see m-need") is not parsed; it is out of scope and not asserted here.
test('an unlisted field naming a matching-only or private need (slug, id, type:slug) reaches no file outside the canon and no putRecord payload', async () => {
  const resource = { title: 'A resource', type: 'resource', public_use: 'ok-with-caveat',
    superseded_by: 'm-need', supersedes: ['need:x-need', 'p-need', 'idx-777'], parent: 'idm-777', see_also: ['x-need', 'at://did:plc:other/xyz.example.kb.resource/abc', 'no-such-object'],
    lineage: { from: ['need:m-need', 'p-need'], note: { about: 'idx-777', keep: 'p-need' }, solo: 'x-need' } };
  const dir = instance({ 'm-need': { ...matching, id: 'idm-777' }, 'x-need': { ...matching, title: 'other', visibility: 'private', id: 'idx-777' }, 'p-need': pub }, resource);
  const puts = []; const dels = []; const config = loadKmsConfig(dir);
  const res = await publish(dir, puts, dels);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  OPS['index.rebuild'].run({ dir, config });
  assert.equal(OPS['render.site'].run({ dir, config }).ok, true);
  assert.equal(OPS.bridge.run({ dir, config }).ok, true);
  buildMap({ dir });
  const rec = puts.find((o) => o.record.title === 'A resource');
  assert.ok(rec, 'the resource was not published');
  for (const needle of ['m-need', 'x-need', 'idm-777', 'idx-777']) {
    assert.equal(JSON.stringify(puts).includes(needle), false, `a putRecord payload carries ${needle}`);
    const hit = filesWith(dir, needle);
    assert.equal(hit.every((f) => f === 'data/kb/need.yaml' || f === 'data/kb/resource.yaml'), true, `${needle} reached ${hit}`);
  }
  // What stays: the public need, a foreign at:// URI, a dangling ref.
  assert.equal(rec.record.superseded_by, undefined); assert.equal(rec.record.parent, undefined);
  assert.deepEqual(rec.record.supersedes, ['p-need']);
  assert.deepEqual(rec.record.see_also, ['at://did:plc:other/xyz.example.kb.resource/abc', 'no-such-object']);
  assert.deepEqual(rec.record.lineage, { from: ['p-need'], note: { keep: 'p-need' } });
  const api = JSON.parse(readFileSync(join(dir, 'public', 'api', 'resource.json'), 'utf8'));
  assert.equal(api.items[0].superseded_by, undefined); assert.deepEqual(api.items[0].supersedes, ['p-need']);
  const rows = yaml.load(readFileSync(join(dir, 'data', 'resources.yaml'), 'utf8')).resources;
  for (const needle of ['m-need', 'x-need', 'idm-777', 'idx-777']) assert.equal(JSON.stringify(rows).includes(needle), false, `a registry row carries ${needle}`);
});

// Round 4: the same leak by the variants the scrub missed in round 3: a closed-vocabulary field carrying a private slug or id (outside its
// enum / axis list), whitespace, a newline, upper case, and the slug as an object KEY at the top level and nested. The drop is counted in the report.
test('round 4: vocabulary fields outside their list, padded / newlined / upper-cased slugs and slug KEYS reach no output outside the canon; the report counts the drop', async () => {
  const resource = { title: 'A resource', type: 'resource', public_use: 'ok-with-caveat',
    link_status: 'm-need', maturity: 'm-need', lifecycle_state: 'idx-777',
    related: [' m-need ', 'm-need\n', 'M-NEED', 'p-need'], see_also: ['\tNeed:X-Need '],
    'm-need': 'anything', nested: { 'x-need': 1, keep: 'p-need', deeper: [{ 'M-NEED': true, ok: 1 }] } };
  const dir = instance({ 'm-need': matching, 'x-need': { ...matching, title: 'other', visibility: 'private', id: 'idx-777' }, 'p-need': pub }, resource);
  const kmsFile = join(dir, 'kms.yaml'); const kmsDoc = yaml.load(readFileSync(kmsFile, 'utf8')); kmsDoc.publish.pages = true; writeFileSync(kmsFile, yaml.dump(kmsDoc)); // the pages are written beside the API
  const puts = []; const dels = []; const config = loadKmsConfig(dir);
  const res = await publish(dir, puts, dels);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  OPS['index.rebuild'].run({ dir, config });
  assert.equal(OPS['render.site'].run({ dir, config }).ok, true);
  assert.equal(OPS.bridge.run({ dir, config }).ok, true);
  buildMap({ dir });
  const rec = puts.find((o) => o.record.title === 'A resource');
  assert.ok(rec, 'the resource was not published');
  const lower = (x) => String(x).toLowerCase();
  const filesWithCI = (needle) => walk(dir).filter((f) => lower(readFileSync(join(dir, f), 'utf8')).includes(needle)).sort();
  for (const needle of ['m-need', 'x-need', 'idx-777']) {
    assert.equal(lower(JSON.stringify(puts)).includes(needle), false, `a putRecord payload carries ${needle}`);
    const hit = filesWithCI(needle);
    // The canon (data/kb/*.yaml) and its own private index (data/kb/index.json, which tallies the canon honestly) may name them; nothing else.
    assert.equal(hit.every((f) => ['data/kb/need.yaml', 'data/kb/resource.yaml', 'data/kb/index.json'].includes(f)), true, `${needle} reached ${hit}`);
  }
  const pages = walk(dir).filter((f) => f.startsWith(join('public', 'k')) && f.endsWith('.html'));
  assert.ok(pages.length > 0, 'no page was rendered'); // the page HTML is in the walk above
  for (const k of ['link_status', 'maturity', 'lifecycle_state']) assert.equal(rec.record[k], undefined, `${k} survived outside its vocabulary`);
  assert.deepEqual(rec.record.related, ['p-need']); assert.deepEqual(rec.record.see_also, []);
  assert.deepEqual(rec.record.nested, { keep: 'p-need', deeper: [{ ok: 1 }] });
  const rows = yaml.load(readFileSync(join(dir, 'data', 'resources.yaml'), 'utf8')).resources;
  for (const needle of ['m-need', 'x-need', 'idx-777']) assert.equal(lower(JSON.stringify(rows)).includes(needle), false, `a registry row carries ${needle}`);
  // 3 vocabulary values + 3 related + 1 see_also + the top-level key + nested key + deeper key = 10; counted, never named.
  assert.equal(res.report.scrubbed.total, 10);
  assert.deepEqual(res.report.scrubbed.items.map((x) => x.count), [10]);
  assert.equal(lower(JSON.stringify(res.report.scrubbed)).includes('m-need'), false, 'the report names no removed value');
});

test('round 4: the export verb: the seven variants (vocabulary field outside its list, id, padded, newlined, upper-cased, key, nested key) carry no private slug into the commons', () => {
  const base = { maturity: 'reviewed', source_lineage: 'repos/ReFi-Barcelona/notes/x.md', public_use: 'ok-with-caveat' };
  const root = makeCanon({
    need: { 'm-need': { ...base, type: 'need', title: 'M', visibility: 'matching-only' }, 'x-need': { ...base, type: 'need', title: 'X', visibility: 'private', id: 'idx-777' } },
    resource: { r: { ...base, type: 'resource', title: 'A resource', link_status: 'm-need', lifecycle_state: 'idx-777', related: [' m-need ', 'm-need\n', 'M-NEED'], 'm-need': 'anything', nested: { 'x-need': 1 } } },
  });
  const outDir = makeCommons(undefined, undefined, { extensions: ['org-os-needs-offers'], types_opt_in: ['need'] });
  let n = 0; exportCommons({ root, outDir, uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` });
  const all = JSON.stringify(readTree(outDir)).toLowerCase();
  assert.equal(all.includes('a resource'), true);
  for (const s of ['m-need', 'x-need', 'idx-777']) assert.equal(all.includes(s), false, `export carries ${s}`);
});
