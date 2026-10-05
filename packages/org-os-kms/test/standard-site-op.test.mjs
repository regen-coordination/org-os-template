// packages/org-os-kms/test/standard-site-op.test.mjs — the publish op with atproto.standard_site. Fake client, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { OPS } from '../src/ops.mjs';

const AUTH = 'xyz.regencoordination.kb'; const DID = 'did:plc:me';
const PUB = 'site.standard.publication'; const DOC = 'site.standard.document';
const SS = { enabled: true, title: 'Brasil Regenerativo', description: 'Comum de conhecimento.', language: 'pt-BR', paths: { default: '/kb/{slug}' } };
const ENTRIES = {
  agrofloresta: { title: 'Agrofloresta sintrópica', type: 'entry', page_type: 'concept', public_use: 'ok-with-caveat', summary: 'Produção que imita a sucessão natural.', id: '11111111-1111-4111-8111-111111111111' },
  mutirao: { title: 'Mutirão', type: 'entry', page_type: 'concept', public_use: 'ok-with-caveat', summary: 'Trabalho coletivo e recíproco.', id: '22222222-2222-4222-8222-222222222222' },
};

function instance({ standardSite, entries = ENTRIES } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kms-ss-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'encyclopedia-entry.yaml'), yaml.dump({ entries }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', publish: { base_url: 'https://br.example' },
    atproto: { did: DID, handle: 'kc.test', pds: 'https://pds.test', nsid_authority: AUTH, ...(standardSite ? { standard_site: standardSite } : {}) } }));
  return dir;
}
const setEntries = (dir, entries) => writeFileSync(join(dir, 'data', 'kb', 'encyclopedia-entry.yaml'), yaml.dump({ entries }));
const fakeClientFactory = (log) => () => ({
  async login() { log.push('login'); return { did: DID }; },
  async putRecord(op) { log.push(['put', op.collection, op.rkey, op.record]); return { uri: `at://${DID}/${op.collection}/${op.rkey}`, cid: `cid-${op.collection.split('.').pop()}-${JSON.stringify(op.record).length}` }; },
  async deleteRecord(op) { log.push(['del', op.collection, op.rkey]); },
});
const env = { ATPROTO_APP_PASSWORD: 'pw' };
const run = (dir, log, flags = { apply: true }) => OPS.publish.run({ dir, flags, deps: { createClient: fakeClientFactory(log), env, now: () => '2026-10-05T12:00:00.000Z' } });
const manifestOf = (dir) => JSON.parse(readFileSync(join(dir, 'data', 'kms-published.json'), 'utf8'));

test('opt-out is byte-identical: no block and enabled:false give the same report, PDS calls, manifest and static files', async () => {
  const outs = [];
  for (const standardSite of [undefined, { ...SS, enabled: false }]) {
    const dir = instance({ standardSite }); const log = [];
    const res = await run(dir, log);
    outs.push({ res: JSON.stringify(res), log: JSON.stringify(log), manifest: readFileSync(join(dir, 'data', 'kms-published.json'), 'utf8').replace(/"publishedAt": "[^"]+"/g, '"publishedAt": "T"'),
      wellKnown: existsSync(join(dir, 'public', '.well-known', PUB)) });
    assert.equal('standard_site' in res.report, false);
    assert.ok(log.every((l) => l === 'login' || l[1].startsWith(AUTH)), 'only entry collections are written');
  }
  assert.deepEqual(outs[0], outs[1]);
  assert.equal(outs[0].wellKnown, false);
  assert.ok(!outs[0].manifest.includes('standardSite'));
});

test('plan mode: reports what would be written, writes nothing', async () => {
  const dir = instance({ standardSite: SS }); const log = [];
  const res = await run(dir, log, {});
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.deepEqual(res.report.standard_site, { status: 'planned', publication: 'create', created: 2, updated: 0, deleted: 0, skipped: 0, withheld: [], warnings: [] });
  assert.deepEqual(log, []); assert.ok(!existsSync(join(dir, 'data', 'kms-published.json')));
  assert.ok(!existsSync(join(dir, 'public', '.well-known', PUB)), 'no verification file before the publication exists');
});

test('apply: entries first and unchanged in shape, then one publication, then a document per entry pointing back', async () => {
  const dir = instance({ standardSite: SS }); const log = [];
  const res = await run(dir, log);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.deepEqual(log.filter((l) => l !== 'login').map((l) => [l[0], l[1]]), [['put', `${AUTH}.encyclopediaEntry`], ['put', `${AUTH}.encyclopediaEntry`], ['put', PUB], ['put', DOC], ['put', DOC]]);
  assert.deepEqual(res.report.standard_site, { status: 'applied', publication: 'created', created: 2, updated: 0, deleted: 0, skipped: 0, withheld: [], warnings: [], failures: [] });
  const entry = log[1]; const pub = log[3]; const doc = log[4];
  assert.deepEqual(Object.keys(entry[3]).sort(), ['$type', 'id', 'page_type', 'public_use', 'summary', 'title', 'type'], 'the entry record carries nothing new');
  assert.equal(entry[2], ENTRIES.agrofloresta.id, 'entry rkey is still the object id');
  assert.deepEqual(pub[3], { $type: PUB, url: 'https://br.example', name: 'Brasil Regenerativo', description: 'Comum de conhecimento.' });
  const m = manifestOf(dir);
  assert.deepEqual(doc[3], { $type: DOC, site: `at://${DID}/${PUB}/${pub[2]}`, title: 'Agrofloresta sintrópica', path: '/kb/agrofloresta', description: 'Produção que imita a sucessão natural.',
    textContent: 'Produção que imita a sucessão natural.', langs: ['pt-BR'],
    content: { $type: `${AUTH}.entryRef`, entry: { uri: m.objects[ENTRIES.agrofloresta.id].atUri, cid: m.objects[ENTRIES.agrofloresta.id].cid }, schema: 'encyclopedia-entry' }, publishedAt: '2026-10-05T12:00:00.000Z' });
  assert.equal(m.standardSite.publication.atUri, `at://${DID}/${PUB}/${pub[2]}`);
  assert.deepEqual(Object.keys(m.standardSite.documents).sort(), Object.keys(m.objects).sort());
  // The site-side half of verification that the static surface can do by itself.
  assert.equal(readFileSync(join(dir, 'public', '.well-known', PUB), 'utf8'), m.standardSite.publication.atUri);
  assert.ok(res.report.static.files.includes(`.well-known/${PUB}`));
});

test('re-publishing is all skips; the publication is created once', async () => {
  const dir = instance({ standardSite: SS }); const log = [];
  await run(dir, log);
  const before = readFileSync(join(dir, 'data', 'kms-published.json'), 'utf8');
  log.length = 0;
  const res = await run(dir, log);
  assert.deepEqual(log, ['login']);
  assert.deepEqual(res.report.standard_site, { status: 'applied', publication: 'skipped', created: 0, updated: 0, deleted: 0, skipped: 2, withheld: [], warnings: [], failures: [] });
  assert.equal(readFileSync(join(dir, 'data', 'kms-published.json'), 'utf8'), before);
});

test('an entry removed from the selection removes its document on the next apply', async () => {
  const dir = instance({ standardSite: SS }); const log = [];
  await run(dir, log);
  const gone = manifestOf(dir).standardSite.documents[ENTRIES.mutirao.id];
  setEntries(dir, { agrofloresta: ENTRIES.agrofloresta, mutirao: { ...ENTRIES.mutirao, maturity: 'held' } });
  log.length = 0;
  const res = await run(dir, log);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.deepEqual(log, ['login', ['del', `${AUTH}.encyclopediaEntry`, ENTRIES.mutirao.id], ['del', DOC, gone.rkey]]);
  assert.equal(res.report.standard_site.deleted, 1); assert.equal(res.report.standard_site.skipped, 1);
  const m = manifestOf(dir);
  assert.equal(m.standardSite.documents[ENTRIES.mutirao.id], undefined); assert.ok(m.standardSite.publication);
});

test('an edited entry updates its document in place', async () => {
  const dir = instance({ standardSite: SS }); const log = [];
  await run(dir, log);
  const prev = manifestOf(dir).standardSite.documents[ENTRIES.mutirao.id];
  setEntries(dir, { ...ENTRIES, mutirao: { ...ENTRIES.mutirao, summary: 'Ajuda mútua entre vizinhas.' } });
  log.length = 0;
  const res = await run(dir, log);
  assert.equal(res.report.standard_site.updated, 1); assert.equal(res.report.standard_site.created, 0);
  const put = log.find((l) => l[1] === DOC);
  assert.equal(put[2], prev.rkey); assert.equal(put[3].description, 'Ajuda mútua entre vizinhas.');
  assert.equal(put[3].content.entry.cid, manifestOf(dir).objects[ENTRIES.mutirao.id].cid, 'the strongRef follows the new entry version');
});

test('an invalid standard_site config is reported, never thrown; entries still publish; nothing standard.site is written', async () => {
  const dir = instance({ standardSite: { ...SS, title: undefined, language: 'brasileiro!' } }); const log = [];
  const res = await run(dir, log);
  assert.equal(res.ok, false);
  assert.equal(res.report.standard_site.status, 'invalid');
  assert.match(JSON.stringify(res.report.standard_site.errors), /title/); assert.match(JSON.stringify(res.report.standard_site.errors), /language/);
  assert.equal(res.report.atproto.status, 'applied'); assert.equal(res.report.atproto.created, 2);
  assert.ok(log.every((l) => l === 'login' || l[1].startsWith(AUTH)));
  assert.equal('standardSite' in manifestOf(dir), false);
});

test('switching standard_site off later leaves its records and manifest section alone', async () => {
  const dir = instance({ standardSite: SS }); const log = [];
  await run(dir, log);
  const section = manifestOf(dir).standardSite;
  const cfg = yaml.load(readFileSync(join(dir, 'kms.yaml'), 'utf8')); cfg.atproto.standard_site.enabled = false; writeFileSync(join(dir, 'kms.yaml'), yaml.dump(cfg));
  setEntries(dir, { ...ENTRIES, mutirao: { ...ENTRIES.mutirao, summary: 'Outra.' } });
  log.length = 0;
  const res = await run(dir, log);
  assert.equal('standard_site' in res.report, false);
  assert.ok(log.every((l) => l === 'login' || l[1].startsWith(AUTH)));
  assert.deepEqual(manifestOf(dir).standardSite, section);
});
