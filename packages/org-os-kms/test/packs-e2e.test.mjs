// packages/org-os-kms/test/packs-e2e.test.mjs — the real org-os-territory pack through bridge + publish, and the no-pack regression.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import * as fw from '../src/framework.mjs';
import { OPS } from '../src/ops.mjs';
import { resetRegistryBindings } from '../src/bind.mjs';

const AUTH = 'cat.regenerant.kb';
function instance({ extensions, optIn = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kms-packs-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'resource.yaml'), yaml.dump({ entries: { a: { title: 'A', type: 'resource', public_use: 'ok-with-caveat', unit_refs: ['landscape:unit:plana-de-vic'] } } }));
  if (extensions) {
    writeFileSync(join(dir, 'data', 'kb', 'territorial-unit.yaml'), yaml.dump({ entries: {
      'plana-de-vic': { title: 'Plana de Vic', type: 'territorial-unit', unit_id: 'landscape:unit:plana-de-vic', layer: 'landscape', level: 'unit', codes: ['one_earth:PA20'], public_use: 'ok-with-caveat', notes: 'private note' } } }));
    writeFileSync(join(dir, 'data', 'kb', 'data-stream.yaml'), yaml.dump({ entries: {
      'unitats-de-paisatge': { title: 'Unitats de paisatge (shp)', type: 'data-stream', source_system: 'observatori-del-paisatge', access: 'download', trust: 'official', public_use: 'not-public-yet' } } }));
  }
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.',
    ...(extensions ? { extensions } : {}),
    publish: { base_url: 'https://t.example', ...(optIn.length ? { types_opt_in: optIn } : {}) },
    atproto: { did: 'did:plc:me', handle: 'kc.test', pds: 'https://pds.test', nsid_authority: AUTH } }));
  return dir;
}
const fakeClient = (log) => () => ({
  async login() { return { did: 'did:plc:me' }; },
  async putRecord(op) { log.push(op); return { uri: `at://did:plc:me/${op.collection}/${op.rkey}`, cid: 'cid1' }; },
  async deleteRecord() {},
});
const env = { ATPROTO_APP_PASSWORD: 'pw' };
const tree = (root, rel = '') => readdirSync(join(root, rel), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? tree(root, join(rel, e.name)) : [join(rel, e.name)]).sort();

beforeEach(() => { fw.resetPacks(); resetRegistryBindings(); });

test('NO PACK: publish produces the core surface and nothing else; pack types are unknown', async () => {
  const dir = instance(); const log = [];
  const res = await OPS.publish.run({ dir, flags: { apply: true }, deps: { createClient: fakeClient(log), env } });
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.equal(fw.registeredPacks().length, 0);
  assert.deepEqual(log.map((o) => o.collection), [`${AUTH}.resource`]);
  const files = tree(join(dir, 'public'));
  assert.deepEqual(files.filter((f) => !/^api\/resource\//.test(f)), ['.well-known/knowledge.json', 'api/context.jsonld', 'api/index.json', 'api/resource.json']);
  assert.equal(JSON.parse(readFileSync(join(dir, 'public', 'api', 'context.jsonld'), 'utf8'))['@context']['territorial-unit'], undefined);
  assert.equal(Object.keys(fw.generateAll({ authority: AUTH })).length, 12);
  // the open model: an unknown field on a core object survives untouched
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'public', 'api', 'resource.json'), 'utf8')).items[0].unit_refs, ['landscape:unit:plana-de-vic']);
});

test('PACK, NOT OPTED IN: the pack loads and bridges, but its types do not publish', async () => {
  const dir = instance({ extensions: ['org-os-territory'] }); const log = [];
  const b = OPS.bridge.run({ dir, config: (await import('../src/config.mjs')).loadKmsConfig(dir) });
  assert.equal(b.ok, true, JSON.stringify(b.report));
  assert.match(readFileSync(join(dir, 'data', 'territorial-units.yaml'), 'utf8'), /Plana de Vic/);
  assert.match(readFileSync(join(dir, 'data', 'data-streams.yaml'), 'utf8'), /Unitats de paisatge/);

  const res = await OPS.publish.run({ dir, flags: { apply: true }, deps: { createClient: fakeClient(log), env } });
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.deepEqual(log.map((o) => o.collection), [`${AUTH}.resource`], 'installing a pack never widens what an instance publishes');
  assert.ok(!existsSync(join(dir, 'public', 'api', 'territorial-unit.json')));
  assert.ok(existsSync(join(dir, 'public', '.well-known', 'extensions.yaml')));
});

test('PACK, OPTED IN: a publishable unit goes to the PDS and the static surface, projected; a not-public-yet stream does not', async () => {
  const dir = instance({ extensions: ['org-os-territory'], optIn: ['territorial-unit', 'data-stream'] }); const log = [];
  const res = await OPS.publish.run({ dir, flags: { apply: true }, deps: { createClient: fakeClient(log), env } });
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.deepEqual(log.map((o) => o.collection).sort(), [`${AUTH}.resource`, `${AUTH}.territorialUnit`]);
  const rec = log.find((o) => o.collection === `${AUTH}.territorialUnit`).record;
  assert.equal(rec.$type, `${AUTH}.territorialUnit`); assert.equal(rec.unit_id, 'landscape:unit:plana-de-vic');
  assert.equal(rec.notes, undefined, 'PRIVATE_FIELDS apply to pack types exactly as to core ones');
  const api = JSON.parse(readFileSync(join(dir, 'public', 'api', 'territorial-unit.json'), 'utf8'));
  assert.equal(api.count, 1); assert.equal(api.items[0].notes, undefined);
  assert.ok(!existsSync(join(dir, 'public', 'api', 'data-stream.json')), 'not-public-yet stays below the floor');
  const km = JSON.parse(readFileSync(join(dir, 'public', '.well-known', 'knowledge.json'), 'utf8'));
  assert.ok(km.exchange.published_domains.includes(`${AUTH}.territorialUnit`));
  assert.equal(JSON.parse(readFileSync(join(dir, 'public', 'api', 'context.jsonld'), 'utf8'))['@context']['territorial-unit'], 'https://regen-commons.org/ns/territorial-unit');
});

test('a declared pack that cannot load stops every op before it runs', async () => {
  const dir = instance({ extensions: ['org-os-does-not-exist'] });
  await assert.rejects(async () => OPS.publish.run({ dir, flags: { dry: true }, deps: { env } }), /extension pack "org-os-does-not-exist" not found/);
  assert.throws(() => OPS['config.load'].run({ dir }), /extension pack "org-os-does-not-exist" not found/);
  assert.ok(!existsSync(join(dir, 'public')));
});
