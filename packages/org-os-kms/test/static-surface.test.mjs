// packages/org-os-kms/test/static-surface.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeStaticSurface } from '../src/static/surface.mjs';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'kms-static-'));
  mkdirSync(join(dir, '.well-known'));
  writeFileSync(join(dir, '.well-known', 'dao.json'), '{"type":"DAO"}');
  writeFileSync(join(dir, '.well-known', 'meetings.json'), '{"meetings":[{"participants":["x"]}]}');
  writeFileSync(join(dir, '.well-known', 'knowledge.json'), JSON.stringify({ '@context': 'https://www.daostar.org/schemas', type: 'KnowledgeManifest', domains: [{ id: 'd1', name: 'D' }], sources: [{ title: 'Existing' }] }));
  return dir;
}
const items = [{ schema: 'resource', ref: 'r#a', object: { title: 'A', type: 'resource', public_use: 'ok-with-caveat', id: 'id-a', notes: 'internal', reviewed_by: 'L' } }];
const allItems = [...items,
  { schema: 'source-system', ref: 's#self', object: { title: 'S', type: 'knowledge-garden', public_use: 'ok-with-caveat', url: 'https://kc', steward: 'x' } },
  { schema: 'source-system', ref: 's#priv', object: { title: 'P', type: 'database', public_use: 'internal-only' } }];
const manifest = { version: 1, objects: { 'id-a': { slug: 'a', type: 'resource', rkey: 'id-a', atUri: 'at://d/c/id-a', cid: 'cid-a', hash: 'h', publishedAt: 't' } } };
const config = { instance: 't', publish: { base_url: 'https://kc.example' }, atproto: { did: 'did:plc:me', nsid_authority: 'xyz.regencoordination.kb' }, geo: { parent_space: 'p', space: null },
  connectors: [{ name: 'atproto', config: { peers: ['did:plc:peer'] } }] };

test('projected entries, absolute @context, merged knowledge.json, allowlisted .well-known', () => {
  const dir = setup();
  const { files } = writeStaticSurface({ dir, items, allItems, manifest, config });
  const pub = (p) => JSON.parse(readFileSync(join(dir, 'public', p), 'utf8'));
  const one = pub('api/resource/id-a.json');
  assert.equal(one['@context'], 'https://kc.example/api/context.jsonld');
  assert.equal(one.notes, undefined); assert.equal(one.reviewed_by, undefined); assert.equal(one.cid, 'cid-a');
  assert.ok(pub('api/index.json').endpoints.some((e) => e.path === 'https://kc.example/api/resource.json'));
  const km = pub('.well-known/knowledge.json');
  assert.deepEqual(km.domains, [{ id: 'd1', name: 'D' }], 'generate:schemas shape preserved');
  assert.deepEqual(km.sources.map((s) => s.title), ['Existing', 'S']);
  assert.equal(km.did, 'did:plc:me');
  assert.deepEqual(km.exchange, { published_domains: ['xyz.regencoordination.kb.resource'], subscribed_domains: ['did:plc:peer'] });
  assert.ok(existsSync(join(dir, 'public', '.well-known', 'dao.json')));
  assert.ok(!existsSync(join(dir, 'public', '.well-known', 'meetings.json')), 'never copied');
  assert.ok(files.includes('api/context.jsonld'));
});

test('base_url is required', () => {
  const dir = setup();
  assert.throws(() => writeStaticSurface({ dir, items, allItems, manifest, config: { ...config, publish: {} } }), /base_url/);
});
