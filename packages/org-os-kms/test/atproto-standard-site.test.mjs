// packages/org-os-kms/test/atproto-standard-site.test.mjs — standard.site rendering of published entries. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPublish } from '../src/atproto/publish.mjs';
import { tidFor, toDocument, planStandardSite, applyStandardSite, PUBLICATION, DOCUMENT } from '../src/atproto/standard-site.mjs';

const AUTH = 'xyz.regencoordination.kb'; const DID = 'did:plc:me';
const TID = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;
const empty = { version: 1, objects: {} };
const item = (slug, extra = {}, schema = 'encyclopedia-entry') => ({ schema, ref: `data/kb/${schema}.yaml#${slug}`,
  object: { title: slug, type: 'entry', page_type: 'concept', public_use: 'ok-with-caveat', id: `id-${slug}`, ...extra } });
const config = (ss = {}, publish = {}) => ({ publish, atproto: { did: DID, nsid_authority: AUTH,
  standard_site: { enabled: true, title: 'Brasil Regenerativo', description: 'Comum de conhecimento sobre regeneração.', url: 'https://brasilregenerativo.example/', language: 'pt-BR', paths: { default: '/kb/{slug}' }, ...ss } } });
const plans = (items, manifest = empty, cfg = config()) => {
  const entryPlan = planPublish({ items, manifest, did: DID, authority: AUTH });
  return { entryPlan, ss: planStandardSite({ items, entryPlan, manifest, did: DID, authority: AUTH, config: cfg }) };
};
const fakeClient = (log, { fail = () => false } = {}) => ({
  async putRecord(op) { log.push(['put', op.collection, op.rkey, op.record, op.swapRecord]); if (fail(op)) throw new Error(`put refused ${op.rkey}`); return { uri: `at://${DID}/${op.collection}/${op.rkey}`, cid: `cid-${op.rkey}-${log.length}` }; },
  async deleteRecord(op) { log.push(['del', op.collection, op.rkey]); if (fail(op)) throw new Error('del refused'); },
});
// What the entry apply would leave in the manifest for these items.
const entriesFor = (entryPlan) => Object.fromEntries([...entryPlan.create, ...entryPlan.update].map((op) => [op.id, { slug: op.slug, type: op.type, rkey: op.rkey, atUri: `at://${DID}/${op.collection}/${op.rkey}`, cid: `ecid-${op.id}`, hash: op.hash, publishedAt: 't' }]));
async function publishOnce(items, manifest = empty, cfg = config(), now = () => '2026-10-05T12:00:00.000Z') {
  const { entryPlan, ss } = plans(items, manifest, cfg);
  const objects = { ...Object.fromEntries(entryPlan.skip.map((id) => [id, manifest.objects[id]])), ...entriesFor(entryPlan) };
  const log = [];
  const out = await applyStandardSite(ss, { client: fakeClient(log), did: DID, entries: objects, now });
  return { manifest: { version: 1, objects, standardSite: out.state }, out, log, ss };
}

test('tidFor: a valid TID, deterministic, distinct per seed', () => {
  const a = tidFor('7b0c9f0e-1111-4222-8333-444455556666');
  assert.match(a, TID);
  assert.equal(a, tidFor('7b0c9f0e-1111-4222-8333-444455556666'));
  assert.notEqual(a, tidFor('7b0c9f0e-1111-4222-8333-444455556667'));
  for (let i = 0; i < 200; i++) assert.match(tidFor(`seed-${i}`), TID);
});

test('mapping: a Portuguese entry with diacritics and no English anywhere', () => {
  const it = item('agrofloresta-sintropica', { title: 'Agrofloresta sintrópica: sucessão e abundância', summary: 'Um sistema de produção que imita a sucessão natural da floresta — não é só "plantar árvores".',
    known_tensions: ['Mão de obra intensiva nos primeiros anos', 'Certificação orgânica'], domain: 'agroecologia', function: '#prática', notes: 'rascunho interno — não publicar' });
  const { record, skipped } = toDocument(it, { did: DID, authority: AUTH, publicationUri: `at://${DID}/${PUBLICATION}/pub`, settings: config().atproto.standard_site });
  assert.equal(skipped, undefined);
  assert.equal(record.$type, DOCUMENT);
  assert.equal(record.site, `at://${DID}/${PUBLICATION}/pub`);
  assert.equal(record.title, 'Agrofloresta sintrópica: sucessão e abundância');
  assert.equal(record.description, 'Um sistema de produção que imita a sucessão natural da floresta — não é só "plantar árvores".');
  assert.equal(record.textContent, 'Um sistema de produção que imita a sucessão natural da floresta — não é só "plantar árvores".\n\nMão de obra intensiva nos primeiros anos\nCertificação orgânica');
  assert.deepEqual(record.tags, ['agroecologia', 'prática'], 'leading # stripped');
  assert.deepEqual(record.langs, ['pt-BR']);
  assert.equal(record.path, '/kb/agrofloresta-sintropica');
  assert.ok(!JSON.stringify(record).includes('rascunho'), 'private fields never reach the document');
  assert.ok(!JSON.stringify(record).includes('"en"'), 'no hard-coded English');
});

test('language: object field (when configured) wins over the default; no language anywhere → no langs', () => {
  const base = { did: DID, authority: AUTH, publicationUri: 'at://x/y/z' };
  const viaField = toDocument(item('a', { idioma: 'es' }), { ...base, settings: { language: 'pt-BR', language_field: 'idioma' } });
  assert.deepEqual(viaField.record.langs, ['es']);
  const none = toDocument(item('a'), { ...base, settings: {} });
  assert.equal('langs' in none.record, false);
});

test('description is cut on a grapheme boundary (never inside a combining sequence), within the lexicon limit', () => {
  const unit = 'coração '; // "coração " written with COMBINING cedilla and tilde: 8 graphemes, 10 code points
  const { record } = toDocument(item('a', { summary: unit.repeat(500) }), { did: DID, authority: AUTH, publicationUri: 'at://x/y/z', settings: {} });
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(record.description)].map((s) => s.segment);
  assert.ok(graphemes.length <= 3000);
  assert.ok(Buffer.byteLength(record.description, 'utf8') <= 30000);
  assert.ok(record.description.endsWith('…'));
  const source = unit.repeat(500); const kept = record.description.slice(0, -1);
  assert.ok(source.startsWith(kept), 'a prefix of the source, byte for byte (no re-normalisation)');
  assert.ok(!/[̀-ͯ]/.test(source[kept.length]), 'the cut does not separate a letter from its combining mark');
  assert.equal(record.description.slice(0, 20).normalize('NFC').trim(), 'coração coração');
  assert.equal(record.textContent, unit.repeat(500).trim(), 'the full text is not truncated');
});

test('the back-pointer: content is an <authority>.entryRef to the entry record; path only when a pattern exists', () => {
  const { ss } = plans([item('a'), item('r', { url: 'https://r.example' }, 'resource')], empty, config({ paths: { 'encyclopedia-entry': '/enciclopédia/{slug}' } }));
  assert.equal(ss.ok, true, JSON.stringify(ss.errors));
  const [a, r] = ss.create;
  assert.deepEqual(a.record.content, { $type: `${AUTH}.entryRef`, entry: { uri: `at://${DID}/${AUTH}.encyclopediaEntry/id-a` }, schema: 'encyclopedia-entry' });
  assert.equal(a.record.path, '/enciclop%C3%A9dia/a');
  assert.equal('path' in r.record, false);
  assert.equal(r.record.content.entry.uri, `at://${DID}/${AUTH}.resource/id-r`);
  assert.equal('textContent' in r.record, false, 'an entry with no prose still gets a document (title + back-pointer)');
  assert.deepEqual(ss.warnings, [{ slug: 'r', warning: 'no path pattern for resource: the document has no web URL and cannot be verified' }]);
});

test('plan: one publication, one document per entry, deterministic TID record keys', () => {
  const { ss, entryPlan } = plans([item('a'), item('b')]);
  assert.equal(ss.ok, true, JSON.stringify(ss.errors));
  assert.equal(ss.publication.action, 'create');
  assert.deepEqual(ss.publication.record, { $type: PUBLICATION, url: 'https://brasilregenerativo.example', name: 'Brasil Regenerativo', description: 'Comum de conhecimento sobre regeneração.' });
  assert.match(ss.publication.rkey, TID);
  assert.equal(ss.create.length, 2); assert.equal(ss.update.length + ss.delete.length + ss.skip.length, 0);
  for (const op of ss.create) { assert.equal(op.collection, DOCUMENT); assert.match(op.rkey, TID); assert.equal(op.rkey, tidFor(op.id)); assert.equal(op.record.site, `at://${DID}/${PUBLICATION}/${ss.publication.rkey}`); }
  assert.deepEqual(plans([item('a'), item('b')]).ss, ss, 're-planning is deterministic');
  assert.equal(entryPlan.create[0].record.title, 'a'); assert.equal(entryPlan.create[0].rkey, 'id-a', 'the entry record is untouched');
});

test('apply: publication first, then documents carrying a strongRef to the entry and publishedAt', async () => {
  const { log, out, manifest } = await publishOnce([item('a')]);
  assert.deepEqual(log.map((l) => [l[0], l[1]]), [['put', PUBLICATION], ['put', DOCUMENT]]);
  const doc = log[1][3];
  assert.deepEqual(doc.content.entry, { uri: `at://${DID}/${AUTH}.encyclopediaEntry/id-a`, cid: 'ecid-id-a' });
  assert.equal(doc.publishedAt, '2026-10-05T12:00:00.000Z'); assert.equal('updatedAt' in doc, false);
  assert.deepEqual(out.applied, { publication: 'created', created: 1, updated: 0, deleted: 0 }); assert.deepEqual(out.failures, []);
  assert.equal(manifest.standardSite.publication.atUri, `at://${DID}/${PUBLICATION}/${manifest.standardSite.publication.rkey}`);
  assert.equal(manifest.standardSite.documents['id-a'].entryCid, 'ecid-id-a');
});

test('idempotent: a second plan against the resulting manifest is all skips, publication included', async () => {
  const items = [item('a'), item('b')];
  const first = await publishOnce(items);
  const { ss } = plans(items, first.manifest);
  assert.equal(ss.publication.action, 'skip');
  assert.equal(ss.create.length + ss.update.length + ss.delete.length, 0);
  assert.deepEqual(ss.skip.sort(), ['id-a', 'id-b']);
  const again = await publishOnce(items, first.manifest);
  assert.deepEqual(again.log, []); assert.deepEqual(again.manifest.standardSite, first.manifest.standardSite);
});

test('update: a changed entry re-puts its document (swapRecord, same rkey, publishedAt kept, updatedAt set); the publication is not rewritten', async () => {
  const first = await publishOnce([item('a', { summary: 'antes' }), item('b')]);
  const second = await publishOnce([item('a', { summary: 'depois' }), item('b')], first.manifest, config(), () => '2026-11-01T00:00:00.000Z');
  assert.equal(second.ss.publication.action, 'skip');
  assert.equal(second.log.length, 1);
  const [, coll, rkey, record, swap] = second.log[0];
  assert.equal(coll, DOCUMENT); assert.equal(rkey, first.manifest.standardSite.documents['id-a'].rkey); assert.equal(swap, first.manifest.standardSite.documents['id-a'].cid);
  assert.equal(record.description, 'depois'); assert.equal(record.publishedAt, '2026-10-05T12:00:00.000Z'); assert.equal(record.updatedAt, '2026-11-01T00:00:00.000Z');
});

test('update: an entry change the document does not render still refreshes the strongRef', async () => {
  const first = await publishOnce([item('a')]);
  const { ss } = plans([item('a', { audience: 'agricultoras' })], first.manifest);
  assert.equal(ss.update.length, 1); assert.equal(ss.skip.length, 0);
});

test('deletion: an entry that leaves the selection takes its document with it; the publication stays', async () => {
  const first = await publishOnce([item('a'), item('b')]);
  const second = await publishOnce([item('a')], first.manifest);
  assert.deepEqual(second.ss.delete.map((d) => d.id), ['id-b']);
  assert.deepEqual(second.log, [['del', DOCUMENT, first.manifest.standardSite.documents['id-b'].rkey]]);
  assert.equal(second.manifest.standardSite.documents['id-b'], undefined);
  assert.ok(second.manifest.standardSite.documents['id-a'] && second.manifest.standardSite.publication);
});

test('an entry without a title is withheld with a reason, not failed', () => {
  const rel = { schema: 'relationship-record', ref: 'data/kb/relationship-record.yaml#x', object: { subject: 'a', predicate: 'informa', object: 'b', public_use: 'ok-with-caveat', id: 'id-x' } };
  const { ss } = plans([item('a'), rel]);
  assert.equal(ss.ok, true); assert.equal(ss.create.length, 1);
  assert.deepEqual(ss.withheld, [{ id: 'id-x', slug: 'x', reason: 'no title: a document needs one' }]);
});

test('validation failures surface in the plan and never throw; an invalid plan writes nothing', async () => {
  for (const [cfg, re] of [
    [config({ title: undefined }), /title/],
    [config({ url: undefined }), /url/],
    [config({ url: 'ftp://x' }), /url/],
    [config({ language: 'português do Brasil' }), /language/],
    [config({ paths: { default: 'kb/{slug}' } }), /path/],
    [config({ publication_rkey: 'not a tid' }), /publication_rkey/],
  ]) {
    const { ss } = plans([item('a')], empty, cfg);
    assert.equal(ss.ok, false); assert.match(JSON.stringify(ss.errors), re); assert.equal(ss.create.length, 0); assert.equal(ss.publication, null);
  }
  const long = plans([item('a', { title: 'ã'.repeat(501) }), item('b', { domain: 'x'.repeat(200) })]).ss;
  assert.equal(long.ok, false);
  assert.deepEqual(long.errors.map((e) => e.slug), ['a', 'b']);
  assert.match(long.errors[0].errors[0], /title exceeds 500 graphemes/); assert.match(long.errors[1].errors[0], /tag exceeds 128 graphemes/);
  await assert.rejects(applyStandardSite(long, { client: fakeClient([]), did: DID, entries: {} }), /failed plan/);
});

test('publish.base_url is the fallback site URL', () => {
  const { ss } = plans([item('a')], empty, config({ url: undefined }, { base_url: 'https://kb.example/' }));
  assert.equal(ss.ok, true); assert.equal(ss.publication.record.url, 'https://kb.example');
});

test('apply failures are per record: a failed publication stops the documents; a failed document keeps its previous state', async () => {
  const { ss, entryPlan } = plans([item('a')]);
  const log = [];
  const out = await applyStandardSite(ss, { client: fakeClient(log, { fail: (op) => op.collection === PUBLICATION }), did: DID, entries: entriesFor(entryPlan) });
  assert.equal(log.length, 1); assert.equal(out.failures.length, 1); assert.equal(out.failures[0].id, 'publication');
  assert.deepEqual(out.state, { publication: null, documents: {} });

  const first = await publishOnce([item('a', { summary: 'antes' })]);
  const p2 = plans([item('a', { summary: 'depois' })], first.manifest);
  const out2 = await applyStandardSite(p2.ss, { client: fakeClient([], { fail: () => true }), did: DID, entries: { ...first.manifest.objects, ...entriesFor(p2.entryPlan) } });
  assert.equal(out2.failures[0].id, 'id-a');
  assert.deepEqual(out2.state.documents['id-a'], first.manifest.standardSite.documents['id-a']);

  // An entry whose own record did not make it to the PDS gets no document.
  const p3 = plans([item('z')]);
  const log3 = [];
  const out3 = await applyStandardSite(p3.ss, { client: fakeClient(log3), did: DID, entries: {} });
  assert.deepEqual(log3.map((l) => l[1]), [PUBLICATION]); assert.match(out3.failures[0].error, /entry record is not published/);
});
