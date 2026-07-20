import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFrontier } from '../src/frontier.mjs';
import { registerDriver } from '../../org-os-host/src/index.mjs';

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

// The host driver degrades ALL read failures to null uniformly (the read-path
// contract: reads degrade quietly, only writes fail loudly), so a thrown/unreachable
// fetch surfaces as an unreached peer with its cache intact — not a raw error string.
test('fetch failure: reports unreached, keeps the stale cache (never deletes)', async () => {
  const dir = scratch();
  const cacheDir = join(dir, 'data', 'federation', 'frontier');
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, 'sibling-os.json'), JSON.stringify({ fetched_at: 'old', peers: [] }));
  const r = await fetchFrontier({ dir, fetchFn: noFetch, now: NOW });
  const sib = r.report.find((x) => x.id === 'sibling-os');
  assert.equal(sib.skipped, 'unreached');
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

test('frontier routes a rid-only peer to the radicle driver (per-entry scheme)', async () => {
  registerDriver('radicle', () => ({
    resolveRemote: (x) => ({ scheme: 'radicle', fetchUrl: x, canonical: true }),
    whoami: () => ({ id: null }), clone: async () => ({ ok: true }),
    fetchFile: async (_e, p) => (p === 'federation.yaml' ? 'name: rad-peer\npeers: []\n' : null),
    listPeers: async () => [], getCanonical: async () => ({ defaultBranch: 'main', threshold: 1, delegates: [] }),
    getDrift: async () => ({ behind: 0, ahead: 0, canonicalRef: 'main' }),
    push: async () => ({ ok: true }), openChange: async () => ({ id: 'x', ok: true }),
    createIssue: async () => ({ id: 'y', ok: true }), commentIssue: async () => ({ ok: true }),
    syncUpstream: async () => ({ ok: true }), webUrl: (_e, p) => `rad://${p}`,
  }));
  // scratch dir with a rid-only peer, github-canonical hub:
  const dir = mkdtempSync(join(tmpdir(), 'frontier-rad-'));
  writeFileSync(join(dir, 'federation.yaml'), 'platforms:\n  canonical: github\npeers:\n  - id: rad-peer\n    rid: rad:zAbC\n');
  const res = await fetchFrontier({ dir });
  assert.equal(res.ok, true);
  assert.ok(existsSync(join(dir, 'data', 'federation', 'frontier', 'rad-peer.json')));
});
