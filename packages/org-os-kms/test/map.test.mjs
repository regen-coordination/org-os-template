// test/map.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMap } from '../src/map.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'map');
const NOW = '2026-07-19T12:00:00Z';

test('bare instance: federation.yaml alone is enough (spec §6)', () => {
  const m = buildMap({ dir: join(FIX, 'bare'), now: NOW });
  assert.equal(m.version, '1');
  assert.equal(m.self.id, 'bare-os');
  assert.deepEqual(m.nodes.map((n) => n.id), ['peer-one']);
  const peer = m.nodes[0];
  assert.equal(peer.kind, 'instance');
  assert.equal(peer.ring, 1);
  assert.equal(peer.live, false, 'local_path missing on disk → unreached');
  assert.deepEqual(m.edges, [{ from: 'bare-os', to: 'peer-one', kind: 'downstream' }]);
});

test('full instance: peers + downstream + kms knowledge peers + sources', () => {
  const m = buildMap({ dir: join(FIX, 'full'), now: NOW });
  const ids = m.nodes.map((n) => n.id);
  assert.ok(ids.includes('sibling-os'), 'federation peer');
  assert.ok(ids.includes('child-os'), 'downstream');
  assert.ok(ids.includes('knowledge-peer'), 'kms.yaml peer');
  assert.ok(ids.includes('koi-network') && ids.includes('regen-registry'), 'source-systems');
  const kinds = Object.fromEntries(m.nodes.map((n) => [n.id, n.kind]));
  assert.equal(kinds['koi-network'], 'source');
  assert.ok(m.edges.some((e) => e.kind === 'federation' && e.to === 'sibling-os'));
  assert.ok(m.edges.some((e) => e.kind === 'knowledge' && e.to === 'knowledge-peer'));
  assert.ok(m.edges.some((e) => e.kind === 'provenance' && e.from === 'koi-network' && e.to === 'full-os'));
});

test('live enrichment: cloned sibling → live:true + counts from .well-known', () => {
  const m = buildMap({ dir: join(FIX, 'full'), now: NOW });
  const child = m.nodes.find((n) => n.id === 'child-os');
  assert.equal(child.live, true);
  assert.equal(child.counts.members, 3);
  assert.equal(child.counts.projects, 2);
  assert.equal(child.last_seen, NOW);
});

test('sources carry object counts from the KB index when present', () => {
  const m = buildMap({ dir: join(FIX, 'full'), now: NOW });
  const src = m.nodes.find((n) => n.id === 'koi-network');
  assert.equal(src.ring, 3);
  assert.equal(src.counts.objects, 14, 'total objects surfaced on sources (per-source split needs richer index — total for now)');
});

test('no federation.yaml → throws with a clear message', () => {
  assert.throws(() => buildMap({ dir: join(FIX, 'nowhere') }), /no federation\.yaml/);
});

test('duplicate ids across sections keep one node, both edges', () => {
  const m = buildMap({ dir: join(FIX, 'full'), now: NOW });
  assert.equal(m.nodes.filter((n) => n.id === 'sibling-os').length, 1);
});

test('frontier snapshots become ring-2 nodes; ring-1 dups keep edge only (spec §3 dedup)', () => {
  const m = buildMap({ dir: join(FIX, 'full'), now: NOW });
  const grand = m.nodes.find((n) => n.id === 'grand-peer');
  assert.equal(grand.kind, 'frontier');
  assert.equal(grand.ring, 2);
  assert.ok(m.edges.some((e) => e.from === 'child-os' && e.to === 'grand-peer' && e.kind === 'frontier'));
  // sibling-os is already ring 1 → stays a single instance node, frontier edge retargets it
  assert.equal(m.nodes.filter((n) => n.id === 'sibling-os').length, 1);
  assert.equal(m.nodes.find((n) => n.id === 'sibling-os').kind, 'instance');
  assert.ok(m.edges.some((e) => e.from === 'child-os' && e.to === 'sibling-os' && e.kind === 'frontier'));
});

test('ecosystems: node added, sources tagged + edged', () => {
  const m = buildMap({ dir: join(FIX, 'full'), now: NOW });
  const eco = m.nodes.find((n) => n.id === 'regen-commons');
  assert.equal(eco.kind, 'ecosystem');
  assert.equal(m.nodes.find((n) => n.id === 'koi-network').ecosystem, 'regen-commons');
  assert.ok(m.edges.some((e) => e.from === 'regen-commons' && e.to === 'koi-network' && e.kind === 'provenance'));
});

// ── the house fixture: frontier reads are carried on ring-1 instances ─────────
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { NOW as HOUSE_NOW } from './fixtures/map/house/now.mjs';

const HOUSE = join(FIX, 'house');
const byId = (m, id) => m.nodes.find((n) => n.id === id);

test('house: a failed read is carried on the node (vault)', () => {
  const m = buildMap({ dir: HOUSE, surface: 'vault', now: HOUSE_NOW });
  assert.equal(byId(m, 'watershed-network').frontier.last_error, 'HTTP 404');
  assert.equal(byId(m, 'watershed-network').frontier.fetched_at, '2026-10-26T12:00:00Z');
});

test('house: an instance with an address but no snapshot has an all-null frontier (vault)', () => {
  const m = buildMap({ dir: HOUSE, surface: 'vault', now: HOUSE_NOW });
  assert.deepEqual(byId(m, 'market-garden').frontier,
    { fetched_at: null, source: null, last_attempt_at: null, last_error: null });
});

test('house: no address → no frontier key; knowledge peers never carry one', () => {
  const m = buildMap({ dir: HOUSE, now: HOUSE_NOW });
  assert.ok(!('frontier' in byId(m, 'lowland-guild')));
  assert.ok(!('frontier' in byId(m, 'open-seed-library')));
});

test('house: frontier.fetched_at equals the snapshot\'s', () => {
  const m = buildMap({ dir: HOUSE, now: HOUSE_NOW });
  const snap = JSON.parse(readFileSync(join(HOUSE, 'data', 'federation', 'frontier', 'hillside-coop.json'), 'utf8'));
  assert.equal(byId(m, 'hillside-coop').frontier.fetched_at, snap.fetched_at);
  assert.equal(byId(m, 'hillside-coop').frontier.source, 'local');
  assert.equal(byId(m, 'hillside-coop').live, true);
});

test('an old snapshot without the new fields reads as last_attempt_at: null, last_error: null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kms-map-'));
  cpSync(HOUSE, dir, { recursive: true });
  writeFileSync(join(dir, 'data', 'federation', 'frontier', 'youth-circle.json'),
    JSON.stringify({ fetched_at: '2026-10-17T12:00:00Z', source: 'local', peers: [] }));
  const m = buildMap({ dir, surface: 'vault', now: HOUSE_NOW });
  assert.deepEqual(byId(m, 'youth-circle').frontier,
    { fetched_at: '2026-10-17T12:00:00Z', source: 'local', last_attempt_at: null, last_error: null });
});

// R-39: "couldn't read" is the steward's (spec §4 rule 1, §5.2) — the public map.json carries when the frontier was
// read and from where, never the last failed attempt or its error.
test('web map.json: frontier is { fetched_at, source } only; the vault keeps last_error and last_attempt_at', () => {
  const web = buildMap({ dir: HOUSE, surface: 'web', now: HOUSE_NOW });
  const vault = buildMap({ dir: HOUSE, surface: 'vault', now: HOUSE_NOW });
  for (const n of web.nodes.filter((x) => x.frontier)) assert.deepEqual(Object.keys(n.frontier).sort(), ['fetched_at', 'source'], n.id);
  assert.deepEqual(byId(web, 'watershed-network').frontier, { fetched_at: '2026-10-26T12:00:00Z', source: byId(vault, 'watershed-network').frontier.source });
  assert.deepEqual(byId(web, 'market-garden').frontier, { fetched_at: null, source: null });
  assert.doesNotMatch(JSON.stringify(web), /HTTP 404|last_error|last_attempt_at/);
  assert.equal(byId(vault, 'watershed-network').frontier.last_error, 'HTTP 404');
  assert.ok('last_attempt_at' in byId(vault, 'watershed-network').frontier);
  assert.deepEqual(buildMap({ dir: HOUSE, now: HOUSE_NOW }), web, 'web is the default surface');
});

test('full fixture: ring-1 instances with an address carry a frontier; child-os from its snapshot', () => {
  const m = buildMap({ dir: join(FIX, 'full'), now: NOW });
  assert.equal(byId(m, 'child-os').frontier.fetched_at !== undefined, true);
  assert.ok(!('frontier' in byId(m, 'koi-network')));
});

test('house: self carries the KB total as counts.entries; sources carry curates when given', () => {
  const m = buildMap({ dir: HOUSE, now: HOUSE_NOW });
  assert.deepEqual(m.self.counts, { entries: 142 });
  assert.equal(byId(m, 'field-notes-archive').curates, 'field notes');
  assert.equal(byId(m, 'seed-registry').curates, 'seed records');
  assert.equal(byId(m, 'open-data-portal').curates, 'public datasets');
});

test('house: no KB index → no self.counts; no curates → no key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kms-house-'));
  cpSync(HOUSE, dir, { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'index.json'), '{}');
  writeFileSync(join(dir, 'data', 'source-systems.yaml'), '- id: s1\n  title: "S1"\n');
  const m = buildMap({ dir, now: HOUSE_NOW });
  assert.equal('counts' in m.self, false);
  assert.equal('curates' in byId(m, 's1'), false);
});
