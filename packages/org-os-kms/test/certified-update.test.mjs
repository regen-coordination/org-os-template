// packages/org-os-kms/test/certified-update.test.mjs — a node's update into the Certified feed, without holding its credentials (kms plan Task 9).
// The bundle builds the exact org.hypercerts.context.attachment record and EXPORTS it as a draft file for the node's own session
// to put. It never logs in, never puts the record, and never reads the update text from `notes`.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import * as fw from '../src/framework.mjs';
import { OPS } from '../src/ops.mjs';
import { resetRegistryBindings } from '../src/bind.mjs';
import { loadKmsConfig } from '../src/config.mjs';
import { buildUpdateRecord, exportUpdateDrafts } from '../src/certified/update.mjs';
import { textToLeaflet } from '../src/certified/leaflet.mjs';
import { dispatch } from '../src/cli.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'fixtures', 'certified', 'feed-post.json'), 'utf8')).record;
const SUBJECT = 'at://did:plc:nodeaaaaaaaaaaaaaaaaaaaa/org.hypercerts.claim.activity/3abc';
const CID = 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
beforeEach(() => { fw.resetPacks(); resetRegistryBindings(); });

const signal = (extra = {}) => ({ title: 'Seedlings planted', type: 'signal', signal_type: 'implementation', public_use: 'ok-with-caveat',
  update_text: 'First paragraph of the report.\n\nSecond paragraph.', certified_subject: SUBJECT, consent_atproto: '2026-11-19', ...extra });

function instance({ drafts = true, signals = { 'seedlings': signal() } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kms-cert-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'signal.yaml'), yaml.dump({ entries: signals }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', publish: { ...(drafts ? { certified_drafts: true } : {}) } }));
  return dir;
}
const outDirOf = (dir) => join(dir, 'renders', 'certified-updates');
const files = (dir) => (existsSync(outDirOf(dir)) ? readdirSync(outDirOf(dir)).sort() : []);
const NOW = '2026-11-20T12:00:00.000Z';
const noLogin = () => { throw new Error('the bundle must never create a client or log in'); };

test('buildUpdateRecord output equals the golden fixture\'s shape', () => {
  const rec = buildUpdateRecord(signal(), { subject: { uri: SUBJECT, cid: CID }, createdAt: NOW });
  assert.deepEqual(Object.keys(rec).sort(), Object.keys(golden).sort());
  assert.equal(rec.$type, 'org.hypercerts.context.attachment'); assert.equal(rec.contentType, 'update');
  assert.equal(rec.createdAt, NOW); assert.equal(rec.title, 'Seedlings planted');
  assert.equal(rec.description.$type, 'pub.leaflet.pages.linearDocument'); assert.equal(rec.description.$type, golden.description.$type);
  assert.deepEqual(Object.keys(rec.description.blocks[0]).sort(), Object.keys(golden.description.blocks[0]).sort());
  assert.equal(rec.description.blocks[0].$type, golden.description.blocks[0].$type);
  assert.equal(rec.description.blocks[0].block.$type, golden.description.blocks[0].block.$type);
  assert.deepEqual(Object.keys(rec.description.blocks[0].block).sort(), Object.keys(golden.description.blocks[0].block).sort());
  assert.equal(rec.subjects.length, 1);
  assert.deepEqual(Object.keys(rec.subjects[0]).sort(), Object.keys(golden.subjects[0]).sort());
  assert.equal(rec.subjects[0].$type, golden.subjects[0].$type);
  assert.equal(rec.subjects[0].uri, SUBJECT); assert.equal(rec.subjects[0].cid, CID);
});

test('a body with Malayalam text round-trips, paragraph by paragraph', () => {
  const text = 'എക്കോ-കോൺഷ്യസ്നെസ്സ് പ്രോജക്റ്റിന്റെ ഭാഗമായ സ്കൂളുകളിൽ ഓരോ ദിവസവും ധ്യാനത്തോടെ തുടങ്ങുന്നു.\n\nരണ്ടാം ഖണ്ഡിക.';
  const doc = textToLeaflet(text);
  assert.equal(doc.blocks.length, 2);
  assert.equal(doc.blocks.map((b) => b.block.plaintext).join('\n\n'), text);
  const rec = buildUpdateRecord(signal({ update_text: text }), { subject: { uri: SUBJECT }, createdAt: NOW });
  assert.equal(JSON.parse(JSON.stringify(rec)).description.blocks[1].block.plaintext, 'രണ്ടാം ഖണ്ഡിക.');
});

test('textToLeaflet: blank paragraphs are dropped, line breaks inside a paragraph kept, empty text is refused', () => {
  assert.deepEqual(textToLeaflet('a\n\n\n\nb\nc\n\n').blocks.map((b) => b.block.plaintext), ['a', 'b\nc']);
  assert.throws(() => textToLeaflet('  \n\n '), /empty/);
});

test('the update text is read from update_text, never from notes', () => {
  assert.throws(() => buildUpdateRecord({ title: 'T', notes: 'SECRET-NOTE text' }, { subject: { uri: SUBJECT }, createdAt: NOW }), /update_text/);
  const rec = buildUpdateRecord(signal({ notes: 'SECRET-NOTE text', work_order: 'wo-1', reviewed_by: 'x' }), { subject: { uri: SUBJECT }, createdAt: NOW });
  assert.ok(!JSON.stringify(rec).includes('SECRET-NOTE')); assert.ok(JSON.stringify(rec).includes('First paragraph'));
});

test('draft export writes one file per eligible update and none for an ineligible one (reasons asserted)', async () => {
  const dir = instance({ signals: {
    seedlings: signal(),
    'no-consent': signal({ title: 'No consent', consent_atproto: undefined }),
    'a-claim': signal({ title: 'A claim', claim_for: 'https://node.example', consent_atproto: undefined, publisher: 'node' }),
    'wrong-use': signal({ title: 'Not public', public_use: 'internal-only' }),
    ingested: signal({ title: 'Ingested', sourceUri: 'at://did:plc:x/org.hypercerts.context.attachment/1' }),
    'not-implementation': signal({ title: 'A tension', signal_type: 'content' }),
  } });
  const res = await exportUpdateDrafts({ dir, config: loadKmsConfig(dir), now: NOW, deps: { createClient: noLogin } });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.report.written.map((w) => w.split('/').pop()), ['seedlings.json']);
  assert.deepEqual(files(dir), ['seedlings.json']);
  const why = Object.fromEntries(res.report.skipped.map((s) => [s.id, s.reason]));
  assert.match(why['no-consent'], /consent/);
  assert.match(why['a-claim'], /consent/);
  assert.match(why['wrong-use'], /public_use/);
  assert.equal(Object.hasOwn(why, 'ingested'), false, 'an ingested record is never an update of ours: ignored, not listed as a skip');
  assert.equal(res.report.ignored.ingested, 1);
  assert.equal(Object.hasOwn(why, 'not-implementation'), false);
});

test('a node\'s own authorship (publisher: node, no claim_for) is eligible without a consent date', async () => {
  const dir = instance({ signals: { own: signal({ consent_atproto: undefined, publisher: 'node' }), neither: signal({ title: 'Neither', consent_atproto: undefined }) } });
  const res = await exportUpdateDrafts({ dir, config: loadKmsConfig(dir), now: NOW, deps: { createClient: noLogin } });
  assert.deepEqual(files(dir), ['own.json']); assert.match(res.report.skipped[0].reason, /consent/);
});

test('export never logs in: a client factory that throws on any call is never called, and the verb completes', async () => {
  const dir = instance(); let calls = 0;
  const trap = new Proxy({}, { get() { calls++; throw new Error('touched a client'); } });
  const res = await OPS['certified.draft'].run({ dir, now: NOW, deps: { createClient: () => { calls++; return trap; }, env: { ATPROTO_APP_PASSWORD: 'pw' } } });
  assert.equal(res.ok, true, JSON.stringify(res)); assert.equal(calls, 0);
  assert.deepEqual(files(dir), ['seedlings.json']);
});

test('exported files carry no private field, and the body holds the text of update_text', async () => {
  const dir = instance({ signals: { seedlings: signal({ notes: 'SECRET-NOTE', reviewed_by: 'SECRET-REVIEWER', work_order: 'SECRET-WO', interpretation: 'SECRET-INTERP', consent_atproto: '2026-11-19' }) } });
  await exportUpdateDrafts({ dir, config: loadKmsConfig(dir), now: NOW });
  const raw = readFileSync(join(outDirOf(dir), 'seedlings.json'), 'utf8');
  for (const s of ['SECRET', 'notes', 'reviewed_by', 'work_order', 'consent_atproto', '2026-11-19']) assert.ok(!raw.includes(s), `leaked: ${s}`);
  const file = JSON.parse(raw);
  assert.equal(file.draft, true); assert.equal(file.collection, 'org.hypercerts.context.attachment');
  assert.equal(file.record.description.blocks[0].block.plaintext, 'First paragraph of the report.');
  assert.equal(file.record.createdAt, NOW);
});

test('a signal whose text is only in notes is skipped with reason "no update_text"', async () => {
  const dir = instance({ signals: { 'notes-only': signal({ update_text: undefined, notes: 'the report text, as ingested' }) } });
  const res = await exportUpdateDrafts({ dir, config: loadKmsConfig(dir), now: NOW });
  assert.deepEqual(files(dir), []); assert.equal(res.report.skipped[0].reason, 'no update_text');
});

test('a subject that is not an AT-URI is skipped with a reason; a missing one too', async () => {
  const dir = instance({ signals: { web: signal({ certified_subject: 'https://certified.app/x' }), none: signal({ title: 'None', certified_subject: undefined }) } });
  const res = await exportUpdateDrafts({ dir, config: loadKmsConfig(dir), now: NOW });
  assert.deepEqual(files(dir), []);
  const why = Object.fromEntries(res.report.skipped.map((s) => [s.id, s.reason]));
  assert.match(why.web, /not an AT-URI/); assert.match(why.none, /certified_subject/);
});

test('the draft says what the node\'s session still has to do: put it, and resolve the subject cid when the signal has none', async () => {
  const dir = instance({ signals: { a: signal(), b: signal({ title: 'B', certified_subject_cid: CID }) } });
  await exportUpdateDrafts({ dir, config: loadKmsConfig(dir), now: NOW });
  const a = JSON.parse(readFileSync(join(outDirOf(dir), 'a.json'), 'utf8')); const b = JSON.parse(readFileSync(join(outDirOf(dir), 'b.json'), 'utf8'));
  assert.deepEqual(a.needs, ['certified_subject_cid']); assert.deepEqual(b.needs, []);
  assert.equal(a.record.subjects[0].cid, undefined); assert.equal(b.record.subjects[0].cid, CID);
  assert.match(a.note, /node's own session/);
});

test('off by default: without publish.certified_drafts nothing is written and the result says why', async () => {
  const dir = instance({ drafts: false });
  const res = await exportUpdateDrafts({ dir, config: loadKmsConfig(dir), now: NOW });
  assert.equal(res.ok, false); assert.match(res.report.error, /certified_drafts/); assert.deepEqual(files(dir), []);
});

test('export is idempotent: a second run rewrites the same bytes', async () => {
  const dir = instance();
  await exportUpdateDrafts({ dir, config: loadKmsConfig(dir), now: NOW });
  const first = readFileSync(join(outDirOf(dir), 'seedlings.json'), 'utf8');
  await exportUpdateDrafts({ dir, config: loadKmsConfig(dir), now: NOW });
  assert.equal(readFileSync(join(outDirOf(dir), 'seedlings.json'), 'utf8'), first);
});

test('the op is registered and bound to no lifecycle event; the verb routes `certified draft`', async () => {
  const { LIFECYCLE_BINDINGS } = await import('../src/bind.mjs');
  assert.ok(OPS['certified.draft']); for (const ops of Object.values(LIFECYCLE_BINDINGS)) assert.ok(!ops.includes('certified.draft'));
  const dir = instance();
  assert.deepEqual(dispatch(['certified', 'draft', '--dir', dir], { dry: true }).args, ['draft']);
  const res = await dispatch(['certified', 'draft', '--dir', dir]);
  assert.equal(res.ok, true); assert.equal(res.report.written.length, 1);
  assert.match((await dispatch(['certified', 'nope', '--dir', dir])).error, /unknown subcommand/);
});

// F5 (seat-7 fixes): the consent date is a real date here too (the same isDate as the claim floor).
test('a signal whose consent_atproto is 2026-02-31 is not eligible (not a calendar date)', async () => {
  const dir = instance({ signals: { impossible: signal({ consent_atproto: '2026-02-31' }), fine: signal({ title: 'Fine', consent_atproto: '2026-02-28' }) } });
  const res = await exportUpdateDrafts({ dir, config: loadKmsConfig(dir), now: NOW, deps: { createClient: noLogin } });
  assert.deepEqual(files(dir), ['fine.json']); assert.match(res.report.skipped[0].reason, /consent/);
});

test('the golden fixture names no real account: its subject DID is a placeholder', () => {
  const raw = readFileSync(join(here, 'fixtures', 'certified', 'feed-post.json'), 'utf8');
  assert.ok(!raw.includes('5djz5xbrofohabl25g6y7tst'), 'the author\'s DID is not in the fixture');
  assert.match(golden.subjects[0].uri, /^at:\/\/did:plc:a{24}\//);
});
