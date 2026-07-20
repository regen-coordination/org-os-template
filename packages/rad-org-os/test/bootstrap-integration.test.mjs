import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { bootstrap } from '../bootstrap/rad-bootstrap.mjs';

// Gated: needs a live `rad` + a running node (`rad node start`). Creates a REAL
// private repo in the operator's radicle storage, then cleans up the temp working dir.
// To run: `rad node start` first, then
// `RAD_INTEGRATION=1 node --test test/bootstrap-integration.test.mjs`. This also pins
// any real `rad auth`/`rad init` output differences; correct `parseRid`/`parseDid` if
// the live format differs.
const run = process.env.RAD_INTEGRATION === '1' ? test : test.skip;

run('live: bootstrap a scratch org with real rad auth + rad init', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'radboot-'));
  try {
    const res = await bootstrap({ targetDir: dir, name: `scratch-${Date.now()}`, alias: 'luizfernando', visibility: 'private', seed: 'https://seed.radicle.xyz' });
    assert.match(res.rid, /^rad:z/);
    assert.match(res.did, /^did:key:z6/);
    assert.ok(existsSync(join(dir, 'federation.yaml')));
    const fed = yaml.load(readFileSync(join(dir, 'federation.yaml'), 'utf8'));
    assert.equal(fed.platforms.canonical, 'radicle');
    assert.equal(fed.identity.rid, res.rid);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
