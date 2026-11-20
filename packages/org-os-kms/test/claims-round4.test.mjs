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

// ---- sweep: the certified update drafts (certified/update.mjs) follow the claim floor ----
import { exportUpdateDrafts } from '../src/certified/update.mjs';
import { readdirSync, existsSync } from 'node:fs';
import { loadKmsConfig } from '../src/config.mjs';

const SUBJECT = 'at://did:plc:nodeaaaaaaaaaaaaaaaaaaaa/org.hypercerts.claim.activity/3abc';
const sig = (extra) => ({ title: 'A claimed update', type: 'signal', signal_type: 'implementation', public_use: 'ok-with-caveat', update_text: 'The node planted seedlings.', certified_subject: SUBJECT,
  claim_for: 'https://node-a.example', claim_status: 'claimed', consent_atproto: '2026-11-19', ...extra });
function certInstance(signals, publish = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kms-claim-r4c-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'signal.yaml'), yaml.dump({ entries: signals }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', publish: { certified_drafts: true, ...publish } }));
  return dir;
}
const drafted = (dir) => { const d = join(dir, 'renders', 'certified-updates'); return existsSync(d) ? readdirSync(d).sort() : []; };

test('sweep certified drafts: a claimed signal is drafted only when it clears the claim floor (publish.claims on, a publisher, still claimed)', async () => {
  const dir = certInstance({ ok: sig(), superseded: sig({ title: 'Superseded', claim_status: 'superseded', superseded_by: 'at://did:plc:n/x/y' }), 'no-claim-for': sig({ title: 'No target', claim_for: '' }) }, { claims: true, claim_publisher: 'ReFi DAO' });
  const res = await exportUpdateDrafts({ dir, config: loadKmsConfig(dir), now: '2026-11-20T12:00:00.000Z' });
  assert.deepEqual(drafted(dir), ['ok.json']);
  const why = Object.fromEntries(res.report.skipped.map((s) => [s.id, s.reason]));
  assert.match(why.superseded, /claim floor/); assert.match(why['no-claim-for'], /claim floor/);
});

test('sweep certified drafts: with publish.claims off, or no publisher, a consented claim is not drafted either', async () => {
  for (const publish of [{ claim_publisher: 'ReFi DAO' }, { claims: true }]) {
    const dir = certInstance({ ok: sig() }, publish);
    const res = await exportUpdateDrafts({ dir, config: loadKmsConfig(dir), now: '2026-11-20T12:00:00.000Z' });
    assert.deepEqual(drafted(dir), [], JSON.stringify(publish));
    assert.match(res.report.skipped[0].reason, /claim floor/);
  }
});
