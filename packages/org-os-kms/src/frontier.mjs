// src/frontier.mjs
// `federate frontier` — fetch each ring-1 peer's federation manifest one hop out
// (spec §3). Local clone first (no network), then raw-GitHub fallback. Snapshots
// under data/federation/frontier/<id>.json; `render map` reads ONLY this cache, so
// fetch failures can never break a build. Stale cache beats broken build.
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { atomicWrite } from './atomic-write.mjs';

function normalizePeers(manifest) {
  const out = [];
  for (const section of ['peers', 'upstream', 'downstream']) {
    for (const p of manifest?.[section] || []) {
      const id = p.id || p.name;
      if (id) out.push({ id, name: p.name || id, repo: p.repo || null, url: p.url || null, type: p.type || null });
    }
  }
  return out;
}

function readPrevious(cachePath) {
  try {
    const p = JSON.parse(readFileSync(cachePath, 'utf8'));
    return p && typeof p === 'object' ? p : null;
  } catch { return null; }
}

// Every attempt is recorded: the previous snapshot (or an empty one) keeps its peers and
// fetched_at, and gains when we last tried and why it failed (null on success).
function recordAttempt(cachePath, now, error) {
  const prev = readPrevious(cachePath) || { fetched_at: null, source: null, peers: [] };
  const snap = { ...prev, last_attempt_at: now, last_error: error };
  atomicWrite(cachePath, JSON.stringify(snap, null, 2));
}

export async function fetchFrontier({ dir = '.', fetchFn = globalThis.fetch, now = new Date().toISOString() } = {}) {
  const fed = yaml.load(readFileSync(join(dir, 'federation.yaml'), 'utf8'));
  const entries = [...(fed.peers || []), ...(fed.upstream || []), ...(fed.downstream || [])];
  const outDir = join(dir, 'data', 'federation', 'frontier');
  mkdirSync(outDir, { recursive: true });
  const report = [];
  for (const entry of entries) {
    const id = entry.id || entry.name;
    if (!id) continue;
    const cachePath = join(outDir, `${id}.json`);
    // an earlier read the map still draws — decided before this attempt is recorded (which writes the file)
    const cached = Boolean(readPrevious(cachePath)?.fetched_at);
    try {
      let manifest = null, source = null, failure = null;
      const localFed = entry.local_path ? join(dir, entry.local_path, 'federation.yaml') : null;
      if (localFed && existsSync(localFed)) {
        manifest = yaml.load(readFileSync(localFed, 'utf8'));
        source = 'local';
      } else if (entry.repo) {
        const url = `https://raw.githubusercontent.com/${entry.repo}/HEAD/federation.yaml`;
        // Abort a hung host so one slow peer can't stall the whole sequential sweep;
        // a timeout lands in the catch below, which preserves any existing cache.
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
          const res = await fetchFn(url, { signal: ctrl.signal });
          if (res.ok) { manifest = yaml.load(await res.text()); source = url; }
          else failure = `HTTP ${res.status}`;
        } finally { clearTimeout(timer); }
      } else {
        report.push({ id, skipped: 'no local_path or repo' });
        continue;
      }
      if (!manifest) {
        recordAttempt(cachePath, now, failure || 'no federation.yaml found');
        report.push({ id, skipped: 'unreached', cached });
        continue;
      }
      const snap = { fetched_at: now, source, peers: normalizePeers(manifest), last_attempt_at: now, last_error: null };
      atomicWrite(cachePath, JSON.stringify(snap, null, 2));
      report.push({ id, ok: true, source, count: snap.peers.length });
    } catch (e) {
      try { recordAttempt(cachePath, now, e.message); } catch { /* the report still carries the error */ }
      report.push({ id, error: e.message, cached });
    }
  }
  return { ok: true, report };
}
