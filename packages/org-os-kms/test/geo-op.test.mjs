// packages/org-os-kms/test/geo-op.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { OPS } from '../src/ops.mjs';
import { LIFECYCLE_BINDINGS } from '../src/bind.mjs';

const H = (c) => c.repeat(32);
const U1 = '11c13f39-90c4-49b1-b4ac-fca6a4c1f2ea', U2 = '58409dea-6e64-4df8-a619-e6b8aec58839';
function instance({ kind = 'personal', space = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kms-geo-op-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true }); mkdirSync(join(dir, 'content'));
  writeFileSync(join(dir, 'data', 'kb', 'encyclopedia-entry.yaml'), yaml.dump({ entries: {
    pub: { title: 'Pub', type: 'encyclopedia-entry', public_use: 'ok-with-caveat', id: U1, summary: 's', domain: 'funding-public-goods' },
    unpublished: { title: 'Unpub', type: 'encyclopedia-entry', public_use: 'ok-with-caveat', id: U2, summary: 's' },
    internal: { title: 'Int', type: 'encyclopedia-entry', public_use: 'internal-only' } } }));
  writeFileSync(join(dir, 'data', 'kms-published.json'), JSON.stringify({ version: 1, objects: { [U1]: { slug: 'pub', type: 'encyclopedia-entry', rkey: U1 } } }));
  writeFileSync(join(dir, 'content', 'topics.json'), JSON.stringify([{ id: 'funding', name: 'Funding', description: 'f', aliases: { domains: ['funding-public-goods'] } }]));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', publish: { static: false },
    geo: { parent_space: H('e'), ...(space ? { space: H('1'), space_kind: kind, author_space: H('2') } : {}), network: 'testnet', url_property: H('3'),
      types: { 'encyclopedia-entry': { type_id: H('a'), url: 'https://k.example/concepts/{slug}' } },
      vocabularies: [{ path: 'content/topics.json', namespace: 'refidao:topic', type_id: H('b') }],
      relations: [{ from_field: 'domain', to_vocabulary: 'refidao:topic', property_id: H('d') }] } }));
  return dir;
}
const registry = (dir) => JSON.parse(readFileSync(join(dir, 'data', 'kms-geo.json'), 'utf8'));
function deps(log, { indexedAll = true, publishError } = {}) {
  return {
    env: { GEO_PRIVATE_KEY: '0xsecretkey' },
    loadSdk: async () => ({ sdk: {}, accounts: {} }),
    publish: async ({ geo, entities, privateKey }) => {
      log.push(['publish', entities.map((e) => e.key).sort(), geo.spaceKind, privateKey]);
      if (publishError) throw new Error(publishError);
      return { editId: 'e1', cid: 'ipfs://c1', txHash: '0xtx', proposed: geo.spaceKind === 'dao' };
    },
    verify: async ({ geoIds }) => { log.push(['verify', geoIds.length]); return indexedAll ? { indexed: geoIds, missing: [] } : { indexed: [], missing: geoIds }; },
  };
}

test('geo ops are CLI-only: not bound to any lifecycle event', () => {
  assert.ok(OPS['geo.register'] && OPS['geo.verify']);
  for (const ops of Object.values(LIFECYCLE_BINDINGS)) { assert.ok(!ops.includes('geo.register')); assert.ok(!ops.includes('geo.verify')); }
});

test('plan mode (default): published objects + vocabulary planned, nothing written, nothing sent', async () => {
  const dir = instance(); const log = [];
  const r = await OPS['geo.register'].run({ dir, flags: {}, deps: deps(log) });
  assert.equal(r.ok, true, JSON.stringify(r.report)); assert.equal(r.report.status, 'planned');
  assert.deepEqual(r.report.entities.map((e) => e.key).sort(), ['encyclopedia-entry:pub', 'refidao:topic:funding']);
  const pub = r.report.entities.find((e) => e.key === 'encyclopedia-entry:pub');
  assert.equal(pub.name, 'Pub'); assert.equal(pub.description, 's'); assert.equal(pub.url, 'https://k.example/concepts/pub');
  assert.deepEqual(pub.relations, [{ toGeoId: r.report.entities.find((e) => e.key === 'refidao:topic:funding').geoId, propertyId: H('d') }]);
  assert.equal(r.report.spaceKind, 'personal'); assert.deepEqual(r.report.applyBlockers, []); assert.equal(r.report.applyIgnored, undefined);
  assert.equal(log.length, 0); assert.ok(!existsSync(join(dir, 'data', 'kms-geo.json')));
});

test('plan mode works before the space is known', async () => {
  const r = await OPS['geo.register'].run({ dir: instance({ space: false }), flags: {}, deps: deps([]) });
  assert.equal(r.report.status, 'planned');
});

test('apply without the space → invalid-config naming geo.space; without the key → not-configured', async () => {
  const a = await OPS['geo.register'].run({ dir: instance({ space: false }), flags: { apply: true }, deps: deps([]) });
  assert.equal(a.ok, false); assert.equal(a.report.status, 'invalid-config'); assert.match(a.report.errors.join(' '), /geo\.space/);
  const b = await OPS['geo.register'].run({ dir: instance(), flags: { apply: true }, deps: { ...deps([]), env: {} } });
  assert.equal(b.ok, false); assert.equal(b.report.status, 'not-configured'); assert.match(b.report.reason, /GEO_PRIVATE_KEY/);
});

test('--dry wins over --apply', async () => {
  const log = [];
  const r = await OPS['geo.register'].run({ dir: instance(), flags: { apply: true, dry: true }, deps: deps(log) });
  assert.equal(r.report.status, 'planned'); assert.equal(log.length, 0);
});

test('apply (personal): one edit, registry persisted, verified, then nothing-to-do', async () => {
  const dir = instance(); const log = [];
  const r = await OPS['geo.register'].run({ dir, flags: { apply: true }, deps: deps(log) });
  assert.equal(r.ok, true, JSON.stringify(r.report)); assert.equal(r.report.status, 'applied'); assert.equal(r.report.indexed, 2);
  assert.deepEqual(log[0], ['publish', ['encyclopedia-entry:pub', 'refidao:topic:funding'], 'personal', '0xsecretkey']);
  const reg = registry(dir);
  assert.equal(reg.space, H('1')); assert.equal(reg.network, 'testnet');
  assert.equal(reg.entities['11c13f3990c449b1b4acfca6a4c1f2ea'].editId, 'e1'); assert.equal(reg.entities['11c13f3990c449b1b4acfca6a4c1f2ea'].indexed, true);
  const again = await OPS['geo.register'].run({ dir, flags: { apply: true }, deps: deps(log) });
  assert.equal(again.report.status, 'nothing-to-do'); assert.equal(log.filter(([k]) => k === 'publish').length, 1);
});

test('apply (DAO): proposed, not verified, ok', async () => {
  const dir = instance({ kind: 'dao' }); const log = [];
  const r = await OPS['geo.register'].run({ dir, flags: { apply: true }, deps: deps(log) });
  assert.equal(r.ok, true); assert.equal(r.report.status, 'proposed'); assert.match(r.report.note, /vote in Geo/);
  assert.equal(log.some(([k]) => k === 'verify'), false);
  assert.equal(registry(dir).entities['11c13f3990c449b1b4acfca6a4c1f2ea'].indexed, false);
});

test('apply: unindexed after the poll → applied-unverified; geo verify picks them up later', async () => {
  const dir = instance(); const log = [];
  const r = await OPS['geo.register'].run({ dir, flags: { apply: true }, deps: deps(log, { indexedAll: false }) });
  assert.equal(r.report.status, 'applied-unverified'); assert.equal(r.report.missing.length, 2);
  const v = await OPS['geo.verify'].run({ dir, deps: deps(log) });
  assert.equal(v.report.status, 'verified'); assert.equal(v.report.indexed, 2);
  assert.equal(registry(dir).entities['11c13f3990c449b1b4acfca6a4c1f2ea'].indexed, true);
});

test('a publish error is reported with the key scrubbed; nothing persisted', async () => {
  const dir = instance();
  const r = await OPS['geo.register'].run({ dir, flags: { apply: true }, deps: deps([], { publishError: 'signer 0xsecretkey rejected' }) });
  assert.equal(r.ok, false); assert.equal(r.report.status, 'failed');
  assert.ok(!r.report.error.includes('0xsecretkey')); assert.match(r.report.error, /\*\*\*/);
  assert.ok(!existsSync(join(dir, 'data', 'kms-geo.json')));
});

test('a truthy non-boolean --dry (parser swallowed a value) still only plans', async () => {
  const log = [];
  const r = await OPS['geo.register'].run({ dir: instance(), flags: { dry: 'x', apply: true }, deps: deps(log) });
  assert.equal(r.report.status, 'planned'); assert.equal(log.length, 0);
});

test('plan report shows apply blockers, and says when --apply was ignored by --dry', async () => {
  const r = await OPS['geo.register'].run({ dir: instance({ space: false }), flags: { apply: true, dry: true }, deps: deps([]) });
  assert.equal(r.report.status, 'planned'); assert.equal(r.report.applyIgnored, true);
  assert.match(r.report.applyBlockers.join(' '), /geo\.space/);
});

test('no geo: block → ok with status not-configured and a hint, not an empty plan', async () => {
  const dir = instance();
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', publish: { static: false } }));
  const r = await OPS['geo.register'].run({ dir, flags: {}, deps: deps([]) });
  assert.equal(r.ok, true); assert.equal(r.report.status, 'not-configured'); assert.match(r.report.hint, /geo: block.*CONNECTORS/);
});

test('the key is masked without its 0x prefix and in other case; also in error.cause', async () => {
  for (const msg of ['signer secretkey rejected', 'signer 0xSECRETKEY rejected', 'signer SECRETKEY rejected']) {
    const r = await OPS['geo.register'].run({ dir: instance(), flags: { apply: true }, deps: deps([], { publishError: msg }) });
    assert.ok(!/secretkey/i.test(r.report.error), r.report.error);
  }
  const d = deps([]); d.publish = async () => { throw new Error('outer', { cause: new Error('inner secretkey') }); };
  const r = await OPS['geo.register'].run({ dir: instance(), flags: { apply: true }, deps: d });
  assert.ok(!/secretkey/i.test(JSON.stringify(r.report)), JSON.stringify(r.report)); assert.match(r.report.error, /outer/);
});

test('registry write failing after the edit was sent rethrows with editId, cid and txHash', async () => {
  const d = { ...deps([]), writeRegistry: () => { throw new Error('disk full'); } };
  await assert.rejects(() => OPS['geo.register'].run({ dir: instance(), flags: { apply: true }, deps: d }),
    (e) => /e1/.test(e.message) && /ipfs:\/\/c1/.test(e.message) && /0xtx/.test(e.message) && /disk full/.test(e.message));
});

test('geo verify: non-conforming registry keys are reported as invalid and never queried', async () => {
  const dir = instance();
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kms-geo.json'), JSON.stringify({ version: 1, network: 'testnet', space: H('1'), entities: { [H('5')]: { key: 'a', indexed: false }, 'x") { id } evil: entity(id: "1': { key: 'b', indexed: false } } }));
  const asked = [];
  const r = await OPS['geo.verify'].run({ dir, deps: { verify: async ({ geoIds }) => { asked.push(...geoIds); return { indexed: geoIds, missing: [] }; } } });
  assert.deepEqual(asked, [H('5')]); assert.deepEqual(r.report.invalid, ['x") { id } evil: entity(id: "1']);
  assert.equal(r.report.status, 'verified');
});
