// packages/org-os-kms/test/claims-round4.test.mjs — seat-7 fixes, round 4: the knowledge manifest follows the claim floor (F4).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import * as fw from '../src/framework.mjs';
import { resetRegistryBindings } from '../src/bind.mjs';
import { OPS } from '../src/ops.mjs';

beforeEach(() => { fw.resetPacks(); resetRegistryBindings(); });

const base = { type: 'source-system', return_path: 'https://node.example/contact', public_use: 'ok-with-caveat', url: 'https://node.example' };
const rows = {
  'plain-src': { ...base, title: 'Plain Source', steward: 'Plain Steward Org' },
  'consented-claim': { ...base, title: 'Consented Claim Source', steward: 'Pat Quill', claim_for: 'https://node-a.example', claim_status: 'claimed', consent_atproto: '2026-11-19' },
  'unconsented-claim': { ...base, title: 'Unconsented Claim Source', steward: 'Sam Rivera', claim_for: 'https://node-b.example', claim_status: 'claimed' },
  'superseded-claim': { ...base, title: 'Superseded Claim Source', steward: 'Alex Moreau', claim_for: 'https://node-c.example', claim_status: 'superseded', consent_atproto: '2026-11-19', superseded_by: 'at://did:plc:x/y/z' },
};
function instance(publish = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kms-claim-r4-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'source-system.yaml'), yaml.dump({ entries: rows }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', publish: { base_url: 'https://t.example', types_opt_in: ['source-system'], claim_publisher: 'ReFi DAO', ...publish } }));
  return dir;
}
const sourcesOf = (dir) => JSON.parse(readFileSync(join(dir, 'public', '.well-known', 'knowledge.json'), 'utf8')).sources;

for (const claims of [true, false]) {
  test(`F4 knowledge.json: a source-system claim (consented, unconsented or superseded; publish.claims ${claims}) puts no source card and no steward in .well-known/knowledge.json`, async () => {
    const dir = instance({ claims });
    const res = await OPS.publish.run({ dir, flags: {}, deps: { env: {} } });
    assert.equal(res.ok, true, JSON.stringify(res.report));
    const sources = sourcesOf(dir);
    assert.deepEqual(sources.map((s) => s.title), ['Plain Source'], 'the plain source stays');
    const text = readFileSync(join(dir, 'public', '.well-known', 'knowledge.json'), 'utf8');
    for (const n of ['Pat Quill', 'Sam Rivera', 'Alex Moreau', 'Claim Source']) assert.ok(!text.includes(n), n);
  });
}
