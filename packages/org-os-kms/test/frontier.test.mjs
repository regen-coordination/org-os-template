import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFrontier } from '../src/frontier.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'map', 'full');
const NOW = '2026-07-19T12:00:00Z';
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'kms-frontier-'));
  cpSync(FIX, dir, { recursive: true });
  return dir;
}
const noFetch = async () => { throw new Error('network disabled in test'); };

test('local cloned sibling: reads its federation.yaml, writes a snapshot', async () => {
  const dir = scratch();
  const r = await fetchFrontier({ dir, fetchFn: noFetch, now: NOW });
  const child = r.report.find((x) => x.id === 'child-os');
  assert.equal(child.ok, true);
  assert.equal(child.source, 'local');
  const snap = JSON.parse(readFileSync(join(dir, 'data', 'federation', 'frontier', 'child-os.json'), 'utf8'));
  assert.equal(snap.fetched_at, NOW);
  assert.deepEqual(snap.peers.map((p) => p.id), ['grand-peer']);
});

test('remote peer: fetches raw-GitHub federation.yaml via injected fetchFn', async () => {
  const dir = scratch();
  const fakeFetch = async (url) => {
    assert.ok(url.includes('raw.githubusercontent.com/example/sibling-os/HEAD/federation.yaml'));
    return { ok: true, text: async () => 'identity:\n  name: sibling-os\npeers:\n  - id: remote-friend\n    name: Remote Friend\n' };
  };
  const r = await fetchFrontier({ dir, fetchFn: fakeFetch, now: NOW });
  const sib = r.report.find((x) => x.id === 'sibling-os');
  assert.equal(sib.ok, true);
  const snap = JSON.parse(readFileSync(join(dir, 'data', 'federation', 'frontier', 'sibling-os.json'), 'utf8'));
  assert.deepEqual(snap.peers.map((p) => p.id), ['remote-friend']);
});

test('fetch failure: reports error, keeps the stale cache (never deletes)', async () => {
  const dir = scratch();
  const cacheDir = join(dir, 'data', 'federation', 'frontier');
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, 'sibling-os.json'), JSON.stringify({ fetched_at: 'old', peers: [] }));
  const r = await fetchFrontier({ dir, fetchFn: noFetch, now: NOW });
  const sib = r.report.find((x) => x.id === 'sibling-os');
  assert.ok(sib.error);
  assert.equal(sib.cached, true);
  const snap = JSON.parse(readFileSync(join(cacheDir, 'sibling-os.json'), 'utf8'));
  assert.equal(snap.fetched_at, 'old', 'stale cache untouched');
});

test('peer with no local_path and no repo is reported skipped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kms-frontier-'));
  writeFileSync(join(dir, 'federation.yaml'), 'identity:\n  name: x\npeers:\n  - id: ghost\n    name: Ghost\n');
  const r = await fetchFrontier({ dir, fetchFn: noFetch, now: NOW });
  assert.equal(r.report[0].skipped, 'no local_path or repo');
});

// ── attempts are recorded ─────────────────────────────────────────────────────
function oneRemote() {
  const dir = mkdtempSync(join(tmpdir(), 'kms-frontier-'));
  writeFileSync(join(dir, 'federation.yaml'),
    'identity:\n  name: x\npeers:\n  - id: far\n    name: Far\n    repo: example/far\n');
  return dir;
}
const snapPath = (dir) => join(dir, 'data', 'federation', 'frontier', 'far.json');
const readSnap = (dir) => JSON.parse(readFileSync(snapPath(dir), 'utf8'));
const seed = (dir, snap) => {
  mkdirSync(join(dir, 'data', 'federation', 'frontier'), { recursive: true });
  writeFileSync(snapPath(dir), JSON.stringify(snap));
};
const OLD = { fetched_at: '2026-07-01T00:00:00Z', source: 'https://x/federation.yaml', peers: [{ id: 'p', name: 'P' }] };

test('a failed fetch keeps the cached peers and records the attempt', async () => {
  const dir = oneRemote();
  seed(dir, OLD);
  await fetchFrontier({ dir, fetchFn: noFetch, now: NOW });
  const s = readSnap(dir);
  assert.deepEqual(s.peers, OLD.peers);
  assert.equal(s.fetched_at, OLD.fetched_at);
  assert.equal(s.last_attempt_at, NOW);
  assert.equal(s.last_error, 'network disabled in test');
});

test('an HTTP failure records "HTTP <status>"', async () => {
  const dir = oneRemote();
  seed(dir, OLD);
  const r = await fetchFrontier({ dir, fetchFn: async () => ({ ok: false, status: 404 }), now: NOW });
  const s = readSnap(dir);
  assert.equal(s.last_error, 'HTTP 404');
  assert.equal(s.last_attempt_at, NOW);
  assert.deepEqual(s.peers, OLD.peers);
  assert.equal(r.report[0].skipped, 'unreached');
});

test('a first failure writes an empty snapshot', async () => {
  const dir = oneRemote();
  await fetchFrontier({ dir, fetchFn: noFetch, now: NOW });
  const s = readSnap(dir);
  assert.equal(s.fetched_at, null);
  assert.equal(s.source, null);
  assert.deepEqual(s.peers, []);
  assert.equal(s.last_attempt_at, NOW);
  assert.equal(s.last_error, 'network disabled in test');
});

test('a success clears last_error and sets last_attempt_at to fetched_at', async () => {
  const dir = oneRemote();
  seed(dir, { ...OLD, last_attempt_at: '2026-07-02T00:00:00Z', last_error: 'HTTP 500' });
  const ok = async () => ({ ok: true, text: async () => 'identity:\n  name: far\npeers:\n  - id: q\n    name: Q\n' });
  await fetchFrontier({ dir, fetchFn: ok, now: NOW });
  const s = readSnap(dir);
  assert.equal(s.last_error, null);
  assert.equal(s.fetched_at, NOW);
  assert.equal(s.last_attempt_at, s.fetched_at);
  assert.deepEqual(s.peers.map((p) => p.id), ['q']);
});

test('no address writes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kms-frontier-'));
  writeFileSync(join(dir, 'federation.yaml'), 'identity:\n  name: x\npeers:\n  - id: ghost\n    name: Ghost\n');
  const r = await fetchFrontier({ dir, fetchFn: noFetch, now: NOW });
  assert.equal(r.report[0].skipped, 'no local_path or repo');
  assert.equal(existsSync(join(dir, 'data', 'federation', 'frontier', 'ghost.json')), false);
});

// `cached` says whether a snapshot from an earlier read was there before this attempt (it is what the map still
// draws); recording the attempt itself writes the file, so it must be decided first.
test('report.cached is decided before the attempt is recorded: false on a first failure, true over an earlier read', async () => {
  for (const fetchFn of [noFetch, async () => ({ ok: false, status: 503 })]) {
    const dir = oneRemote();
    const first = await fetchFrontier({ dir, fetchFn, now: NOW });
    assert.equal(first.report[0].cached, false, 'nothing cached before the first attempt');
    const again = await fetchFrontier({ dir, fetchFn, now: NOW });
    assert.equal(again.report[0].cached, false, 'an attempt record is not a cached read');
    seed(dir, OLD);
    const over = await fetchFrontier({ dir, fetchFn, now: NOW });
    assert.equal(over.report[0].cached, true, 'an earlier read is cached');
  }
});
