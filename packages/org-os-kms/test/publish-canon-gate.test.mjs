// packages/org-os-kms/test/publish-canon-gate.test.mjs
// `publish` in an instance with no plane role whose knowledge base holds canon control data (a
// source-system card that claims or holds corpus paths, or a public-use-boundary record) also runs
// the canon publication gate (src/planes/publication-gate.mjs, via src/planes/canon-gate.mjs in selectPublic). It only
// narrows, in every mode, and a rejected entry is never minted an id or written. Every test works in a fresh temp
// directory; none runs git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { OPS } from '../src/ops.mjs';
import { selectPublic } from '../src/gate.mjs';
import { getAdapter } from '../src/framework.mjs';

const LINEAGE = 'repos/ReFi-Barcelona/notes/x.md';
const CARD = { title: 'ReFi BCN Old KB', steward: 's', return_path: 'r', url: 'https://github.com/refibcn/ReFi-Barcelona',
  origin_prefixes: ['repos/ReFi-Barcelona/'], public_use: 'ok-with-caveat' };
const DRAFT = { title: 'Draft', type: 'resource', public_use: 'ok-with-caveat', maturity: 'draft', source_lineage: LINEAGE };
const REVIEWED = { title: 'Reviewed', type: 'resource', public_use: 'ok-with-caveat', maturity: 'reviewed', source_lineage: LINEAGE };
const ATPROTO = { did: 'did:plc:me', handle: 'kc.test', pds: 'https://pds.test', nsid_authority: 'xyz.regencoordination.kb' };
const env = { ATPROTO_APP_PASSWORD: 'pw' };
const fakeClient = (log) => () => ({
  async login() { log.push('login'); return { did: 'did:plc:me' }; },
  async putRecord(op) { log.push(['put', op.rkey]); return { uri: `at://did:plc:me/${op.collection}/${op.rkey}`, cid: 'cid1' }; },
  async deleteRecord(op) { log.push(['del', op.rkey]); },
});

/** An instance with no plane role: data/kb/<schema>.yaml per key, kms.yaml without `planes`. */
function instance(kb, { atproto = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kms-canon-gate-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  for (const [schema, entries] of Object.entries(kb)) writeFileSync(join(dir, 'data', 'kb', `${schema}.yaml`), yaml.dump({ entries }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.',
    publish: { base_url: 'https://t.example' }, ...(atproto ? { atproto: ATPROTO } : {}) }));
  return dir;
}
const publish = (dir, flags = {}, log = []) => OPS.publish.run({ dir, flags, deps: { createClient: fakeClient(log), env } });
const disk = (dir) => yaml.load(readFileSync(join(dir, 'data', 'kb', 'resource.yaml'), 'utf8')).entries;
const published = (dir) => readFileSync(join(dir, 'public', 'api', 'resource.json'), 'utf8');
const snapshot = (dir) => Object.fromEntries(['resource.yaml', 'source-system.yaml', 'public-use-boundary.yaml']
  .map((f) => join(dir, 'data', 'kb', f)).filter(existsSync).map((p) => [p, readFileSync(p, 'utf8')]));

test('no role + a source-system card: a draft entry under the card is not selected, minted or written (plan mode)', async () => {
  const dir = instance({ 'source-system': { 'refi-bcn-old-kb': CARD }, resource: { draft: DRAFT, reviewed: REVIEWED } });
  const res = await publish(dir);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.deepEqual(res.report.canonGate, { status: 'applied', passed: 1, rejected: 1, by_reason: { 'maturity is draft': 1 } });
  assert.equal(res.report.minted, 1);
  assert.equal(res.report.atproto.created, 1);
  const entries = disk(dir);
  assert.equal(entries.draft.id, undefined, 'the rejected entry was not minted an id');
  assert.ok(entries.reviewed.id, 'the passing entry was minted');
  assert.ok(!published(dir).includes('"Draft"'), 'the rejected entry is not on the static surface');
  assert.ok(published(dir).includes('"Reviewed"'));
});

test('no role + a source-system card: the canon gate holds under --dry and --apply too', async () => {
  const dry = instance({ 'source-system': { 'refi-bcn-old-kb': CARD }, resource: { draft: DRAFT, reviewed: REVIEWED } });
  const d = await publish(dry, { dry: true });
  assert.equal(d.report.canonGate.rejected, 1);
  assert.equal(d.report.minted, 1, 'the preview mints only what passed');
  assert.equal(d.report.atproto.created, 1);
  assert.ok(!existsSync(join(dry, 'public')));

  const app = instance({ 'source-system': { 'refi-bcn-old-kb': CARD }, resource: { draft: DRAFT, reviewed: REVIEWED } });
  const log = [];
  const a = await publish(app, { apply: true }, log);
  assert.equal(a.ok, true, JSON.stringify(a.report));
  assert.equal(a.report.canonGate.rejected, 1);
  assert.equal(a.report.atproto.status, 'applied');
  assert.equal(a.report.atproto.created, 1);
  assert.equal(log.filter((e) => Array.isArray(e) && e[0] === 'put').length, 1, 'only the passing entry reaches the PDS');
  assert.equal(disk(app).draft.id, undefined);
  const manifest = JSON.parse(readFileSync(join(app, 'data', 'kms-published.json'), 'utf8'));
  assert.equal(Object.keys(manifest.objects).length, 1);
});

test('no role + a source-system card: a reviewed entry under the card is published as before', async () => {
  const dir = instance({ 'source-system': { 'refi-bcn-old-kb': CARD }, resource: { reviewed: REVIEWED } });
  const res = await publish(dir);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.deepEqual(res.report.canonGate, { status: 'applied', passed: 1, rejected: 0, by_reason: {} });
  assert.equal(res.report.minted, 1);
  assert.ok(disk(dir).reviewed.id);
  assert.ok(published(dir).includes('"Reviewed"'));
});

test('no role + a held prefix or a consent boundary: the canon gate refuses those entries', async () => {
  const held = { ...CARD, held_prefixes: ['repos/ReFi-Barcelona/private/'] };
  const dir = instance({ 'source-system': { 'refi-bcn-old-kb': held },
    'public-use-boundary': { b: { source_lineage: 'repos/ReFi-Barcelona/notes/consent.md', tier: 'never-publish-without-consent' } },
    resource: { reviewed: REVIEWED,
      priv: { ...REVIEWED, title: 'Private', source_lineage: 'repos/ReFi-Barcelona/private/p.md' },
      consent: { ...REVIEWED, title: 'Consent', source_lineage: 'repos/ReFi-Barcelona/notes/consent.md' } } });
  const res = await publish(dir);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.equal(res.report.canonGate.passed, 1);
  assert.deepEqual(res.report.canonGate.by_reason, { 'held prefix: repos/ReFi-Barcelona/private/': 1, 'boundary: never-publish-without-consent': 1 });
  const entries = disk(dir);
  assert.ok(entries.reviewed.id && !entries.priv.id && !entries.consent.id);
});

test('no role, no source-system cards: behaviour unchanged — the draft entry still goes; the report says the gate was not applied', async () => {
  const dir = instance({ resource: { draft: DRAFT } });
  const res = await publish(dir);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.deepEqual(res.report.canonGate, { status: 'not-applied', reason: 'no source-system cards' });
  assert.equal(res.report.minted, 1);
  assert.ok(disk(dir).draft.id);
  assert.ok(published(dir).includes('"Draft"'));
});

test('no role, source-system cards that claim no corpus path (a federated peer\'s card, a self card): behaviour unchanged', async () => {
  const peer = { title: 'ReFi Blog', type: 'blog', steward: 's', return_path: 'r', url: 'https://blog.refidao.com', public_use: 'ok-with-caveat' };
  const dir = instance({ 'source-system': { 'refi-blog': peer }, resource: { draft: { title: 'Draft', type: 'resource', public_use: 'ok-with-caveat' } } });
  const res = await publish(dir);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.equal(res.report.canonGate.status, 'not-applied');
  assert.match(res.report.canonGate.reason, /claims or holds a corpus path/);
  assert.ok(disk(dir).draft.id);
});

for (const flags of [{ dry: true }, {}, { apply: true }]) {
  test(`malformed canon control data refuses the publish before anything is minted or written (${JSON.stringify(flags)})`, async () => {
    for (const kb of [
      { 'source-system': { bad: { ...CARD, origin_prefixes: ['https://github.com/refibcn/ReFi-Barcelona'] } }, resource: { reviewed: REVIEWED } },
      { 'source-system': { 'refi-bcn-old-kb': { ...CARD, held_prefixes: 'repos/ReFi-Barcelona/private/' } }, resource: { reviewed: REVIEWED } },
      { 'source-system': { 'refi-bcn-old-kb': CARD }, 'public-use-boundary': { b: { source_lineage: 'https://example.org/x', tier: 'never-publish-without-consent' } }, resource: { reviewed: REVIEWED } },
    ]) {
      const dir = instance(kb); const log = [];
      const before = snapshot(dir);
      const res = await publish(dir, flags, log);
      assert.equal(res.ok, false);
      assert.equal(res.report.refused, 'canon-control-data');
      assert.equal(res.report.dry, flags.dry === true);
      assert.ok(Array.isArray(res.report.errors) && res.report.errors.length > 0);
      assert.equal(typeof res.report.reason, 'string');
      assert.deepEqual(log, [], 'no login, no PDS write');
      assert.deepEqual(snapshot(dir), before, 'the store is byte-identical');
      assert.ok(!existsSync(join(dir, 'public')), 'nothing written to public/');
      assert.ok(!existsSync(join(dir, 'data', 'kms-published.json')), 'no manifest');
    }
  });
}

// The selection is shared: `publish`, the steward's preview (src/pages/write.mjs) and kms-admin all read selectPublic, so they agree.
test('selectPublic (what the preview and kms-admin read) applies the same canon gate and reports it', async () => {
  const dir = instance({ 'source-system': { 'refi-bcn-old-kb': CARD }, resource: { draft: DRAFT, reviewed: REVIEWED } });
  const config = yaml.load(readFileSync(join(dir, 'kms.yaml'), 'utf8'));
  const all = getAdapter('repo-data').list(dir);
  const sel = await selectPublic({ dir, config, all });
  assert.deepEqual(sel.candidates.map((c) => c.object.title), ['Reviewed']);
  assert.deepEqual(sel.canonGate, { status: 'applied', passed: 1, rejected: 1, by_reason: { 'maturity is draft': 1 } });
  assert.equal(sel.gated, false);
});

test('selectPublic throws CANON_CONTROL_DATA on malformed control data, so the preview calls nothing public', async () => {
  const dir = instance({ 'source-system': { 'refi-bcn-old-kb': { ...CARD, held_prefixes: 'repos/ReFi-Barcelona/private/' } }, resource: { reviewed: REVIEWED } });
  const config = yaml.load(readFileSync(join(dir, 'kms.yaml'), 'utf8'));
  await assert.rejects(selectPublic({ dir, config, all: getAdapter('repo-data').list(dir) }), (e) => e.code === 'CANON_CONTROL_DATA' && e.errors.length > 0);
});

test('a source-system card keyed __proto__ is malformed control data, never a card dropped unseen', async () => {
  const dir = instance({ resource: { draft: DRAFT } });
  writeFileSync(join(dir, 'data', 'kb', 'source-system.yaml'), "entries:\n  __proto__:\n    title: Old KB\n    origin_prefixes: ['repos/ReFi-Barcelona/']\n");
  const log = [];
  const res = await publish(dir, {}, log);
  assert.equal(res.ok, false, JSON.stringify(res.report));
  assert.equal(res.report.refused, 'canon-control-data');
  assert.match(res.report.errors.join('\n'), /__proto__/);
  assert.equal(disk(dir).draft.id, undefined);
  assert.ok(!existsSync(join(dir, 'public')));
});

test('a canon-shaped instance with a plane role gets no canonGate: a canon is refused as before', async () => {
  const dir = instance({ 'source-system': { 'refi-bcn-old-kb': CARD }, resource: { reviewed: REVIEWED } });
  const cfg = yaml.load(readFileSync(join(dir, 'kms.yaml'), 'utf8'));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ ...cfg, planes: { public: { instance: 't-public' } } }));
  const res = await publish(dir);
  assert.equal(res.ok, false);
  assert.equal(res.report.refused, 'canon');
  assert.equal(res.report.canonGate, undefined);
});
