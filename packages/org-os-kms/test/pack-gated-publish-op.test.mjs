// packages/org-os-kms/test/pack-gated-publish-op.test.mjs — the publish op withholds a gated-pack type that declares no rules,
// so one undeclared type never stops the rest of the instance from publishing (kms plan Task 5).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import * as fw from '../src/framework.mjs';
import { OPS } from '../src/ops.mjs';
import { resetRegistryBindings } from '../src/bind.mjs';
import { loadKmsConfig } from '../src/config.mjs';

const AUTH = 'xyz.example.kb';
beforeEach(() => { fw.resetPacks(); resetRegistryBindings(); });

function setup() {
  const pk = mkdtempSync(join(tmpdir(), 'gp-pk-'));
  mkdirSync(join(pk, 'g', 'schemas'), { recursive: true });
  writeFileSync(join(pk, 'g', 'pack.yaml'), yaml.dump({ name: 'g', types: ['gizmo'], visibility_gated: true }));
  writeFileSync(join(pk, 'g', 'schemas', 'gizmo.yaml'), 'id: gizmo\nversion: 0.1.0\nextends: frontmatter\nrequired: [title]\nfields: {}\n');
  const dir = mkdtempSync(join(tmpdir(), 'gp-inst-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'resource.yaml'), yaml.dump({ entries: { a: { title: 'A', type: 'resource', public_use: 'ok-with-caveat' } } }));
  writeFileSync(join(dir, 'data', 'kb', 'gizmo.yaml'), yaml.dump({ entries: { g1: { title: 'G', type: 'gizmo', public_use: 'ok-with-caveat' } } }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', extensions: ['g'],
    publish: { base_url: 'https://t.example', types_opt_in: ['gizmo'] }, atproto: { did: 'did:plc:me', handle: 'x.test', pds: 'https://pds.test', nsid_authority: AUTH } }));
  return { dir, pk };
}

test('a gated-pack type with no declared rules is withheld and counted; the rest still publishes', async () => {
  const { dir, pk } = setup(); const log = [];
  const config = loadKmsConfig(dir, { packagesDir: pk });
  const client = () => ({ async login() {}, async putRecord(op) { log.push(op.collection); return { uri: `at://x/${op.collection}/${op.rkey}`, cid: 'c' }; }, async deleteRecord() {} });
  const res = await OPS.publish.run({ dir, config, flags: { apply: true }, deps: { createClient: client, env: { ATPROTO_APP_PASSWORD: 'pw' } } });
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.deepEqual(log, [`${AUTH}.resource`]);
  assert.equal(res.report.withheld.undeclared, 1);
});
