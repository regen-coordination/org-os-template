// packages/org-os-kms/test/pages-model.test.mjs — the pure page model (Task 8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommons } from '../src/pages/model.mjs';
import { LABELS, MATURITY_MARK, CAVEATS, labelFor, kindLabel } from '../src/pages/labels.mjs';
import { FIELD_MAP } from '../src/atproto/standard-site.mjs';
import * as F from './fixtures/pages/commons.mjs';

const base = { items: F.items, allItems: F.allItems, manifest: F.manifest, config: F.config, knowledge: F.knowledge, reads: F.reads, now: F.NOW };
const pub = (o = {}) => buildCommons({ ...base, mode: 'public', ...o });
const prev = (o = {}) => buildCommons({ ...base, mode: 'preview', ...o });
const by = (m, slug) => m.entries.find((e) => e.slug === slug);

test('public lists only gated items', () => {
  const m = pub();
  assert.deepEqual(m.entries.map((e) => e.slug).sort(), ['cover-cropping', 'living-mulch', 'rotational-grazing', 'seed-library', 'seed-saving', 'three-sisters-guild']);
  assert.equal(m.counts.entries, 6);
  assert.deepEqual(m.needsReview, []);
  assert.ok(m.entries.every((e) => !e.internal && !e.awaiting && e.broken === undefined));
  assert.equal(m.instance, 'Example DAO Commons'); assert.equal(m.did, 'did:plc:exampledao');
  assert.equal(m.sentence, 'Field notes and practice from the Example DAO growers.');
  assert.ok(!JSON.stringify(m).includes('PRIVATE'), 'private fields never reach the model');
});

test('public: internal and broken refs are dropped alike', () => {
  const swap = (it, f, vals) => ({ ...it, object: { ...it.object, [f]: vals } });
  const mk = (ref) => {
    const lm = swap(F.living, 'related_concepts', ['cover-cropping', ref]);
    const items = F.items.map((i) => (i === F.living ? lm : i));
    return pub({ items, allItems: [...items, F.handbook, F.swapNotes] });
  };
  const a = mk('staff-handbook'); const b = mk('nowhere-at-all');
  for (const slug of ['living-mulch', 'cover-cropping']) {
    assert.deepEqual(by(a, slug).related, by(b, slug).related);
    assert.deepEqual(by(a, slug).backlinks, by(b, slug).backlinks);
    assert.deepEqual(by(a, slug).neighbours, by(b, slug).neighbours);
  }
  assert.deepEqual(a.counts, b.counts);
  assert.deepEqual(a.kinds, b.kinds);
  // and an internal entry citing a published one leaves no backlink
  const without = pub({ allItems: F.items });
  assert.deepEqual(by(pub(), 'living-mulch').backlinks, by(without, 'living-mulch').backlinks);
  assert.deepEqual(pub().counts, without.counts);
  // an own AT URI of an internal entry is dropped too, never turned into a peer row
  const own = swap(F.living, 'related_resources', [F.manifest.objects[F.handbook.object.id].atUri]);
  const items = F.items.map((i) => (i === F.living ? own : i));
  assert.deepEqual(by(pub({ items, allItems: [...items, F.handbook] }), 'living-mulch').related.map((r) => r.title), ['Cover cropping']);
  assert.ok(!JSON.stringify(a).includes('staff-handbook') && !JSON.stringify(a).includes('Staff handbook'));
});

test('public: a published ref, a peer ref and an own AT URI resolve', () => {
  const r = by(pub(), 'living-mulch').related;
  assert.deepEqual(r.map((x) => x.title), ['Cover cropping', 'Seed saving for small farms']);
  assert.equal(r[0].href, 'k/concept-lineage/id-cover-cropping.html');
  assert.equal(r[0].kindLabel, 'Concept lineage'); assert.equal(r[0].glyphType, 'branch'); assert.equal(r[0].mark.word, 'Field-informed');
  assert.equal(r[1].peer, 'hillside.example'); assert.equal(r[1].href, 'https://hillside.example/resources/seed-saving');
  assert.deepEqual(by(pub(), 'cover-cropping').backlinks.map((x) => x.slug), ['living-mulch']);
  // an own AT URI resolves to the entry
  const via = { ...F.cover, object: { ...F.cover.object, related_concepts: [F.manifest.objects['id-living-mulch'].atUri] } };
  const m = pub({ items: F.items.map((i) => (i === F.cover ? via : i)) });
  assert.equal(by(m, 'cover-cropping').related[0].title, 'Living mulch');
});

test('an external AT URI with no local copy is a peer row with no link (P-8)', () => {
  const far = 'at://did:plc:elsewhere/org.other.resource/abc123';
  const lm = { ...F.living, object: { ...F.living.object, related_resources: [far, 'javascript:alert(1)'] } };
  const m = pub({ items: F.items.map((i) => (i === F.living ? lm : i)) });
  const r = by(m, 'living-mulch').related;
  assert.deepEqual(r.map((x) => x.title), ['Cover cropping', 'abc123']);
  assert.equal(r[1].href, null); assert.equal(r[1].peer, 'did:plc:elsewhere');
  const m2 = prev({ items: F.items.map((i) => (i === F.living ? lm : i)), allItems: F.allItems.map((i) => (i === F.living ? lm : i)) });
  assert.deepEqual(by(m2, 'living-mulch').broken.map((b) => b.slug), ['no-such-note', 'javascript:alert(1)']);
});

test('preview lists every canon entry, flags internal, lists the broken slug with its fix, queues the awaiting entry', () => {
  const m = prev();
  assert.equal(m.entries.length, 8);
  assert.deepEqual(m.entries.filter((e) => e.internal).map((e) => e.slug).sort(), ['seed-swap-notes', 'staff-handbook']);
  const lm = by(m, 'living-mulch');
  assert.deepEqual(lm.broken, [{ slug: 'no-such-note', fix: 'No entry with this name. Fix the reference or publish the entry.' }]);
  assert.ok(lm.related.some((r) => r.title === 'Staff handbook'));
  assert.deepEqual(m.needsReview.map((e) => e.slug), ['seed-swap-notes']);
  assert.equal(by(m, 'seed-swap-notes').awaiting, true);
  assert.deepEqual(by(m, 'cover-cropping').backlinks.map((b) => b.slug), ['living-mulch']);
  assert.deepEqual(by(m, 'living-mulch').backlinks.map((b) => b.slug), ['cover-cropping', 'staff-handbook']);
});

test('body follows FIELD_MAP order with labels; render.labels overrides one; other fields are extra', () => {
  const e = by(pub(), 'living-mulch');
  assert.deepEqual(e.body.map((b) => b.field), ['known_tensions']);
  assert.equal(e.summary, 'A cover crop kept growing between rows to hold soil and feed the next planting.');
  const o = by(pub(), 'three-sisters-guild');
  // the description field (use_cases) is the lead, so the body starts after it; order is FIELD_MAP's
  assert.deepEqual(o.body.map((b) => [b.field, b.label]), [['not_for', 'Not for']]);
  assert.equal(o.summary, 'Small beds with a trellis.');
  const lm = by(pub({ config: { ...F.config, render: { labels: { known_tensions: 'Open tensions' } } } }), 'living-mulch');
  assert.equal(lm.body[0].label, 'Open tensions');
  assert.equal(lm.body[0].text, 'Competes with young seedlings for water.\nNeeds a mowing rhythm the crew can keep.');
  assert.ok(e.extra.every((x) => x.label && x.value !== undefined));
});

test('a pack type: body from standard_site.fields, other fields only as extra', () => {
  const unit = { schema: 'territorial-unit', ref: 'data/kb/territorial-unit.yaml#north-bank', object: { type: 'territorial-unit', id: 'id-nb', title: 'North bank', maturity: 'draft', public_use: 'ok-with-caveat', blurb: 'A strip of floodplain.', notes_for_crew: 'Walk it in April.', hectares: 12 } };
  const config = { ...F.config, atproto: { ...F.config.atproto, standard_site: { fields: { 'territorial-unit': { description: 'blurb', body: ['blurb'] } } } } };
  const m = pub({ items: [unit], allItems: [unit], manifest: { version: 1, objects: {} }, config });
  const e = m.entries[0];
  assert.equal(e.summary, 'A strip of floodplain.');
  assert.deepEqual(e.body, []);
  assert.deepEqual(e.extra.map((x) => [x.label, x.value]), [['Notes for crew', 'Walk it in April.'], ['Hectares', '12']]);
  assert.equal(e.kindLabel, 'Territorial unit'); assert.equal(e.glyphType, 'pin');
  const e2 = pub({ items: [{ ...unit, object: { ...unit.object, blurb: 'A strip.', summary_long: 'Longer text.' } }], allItems: [], manifest: { version: 1, objects: {} }, config: { ...config, atproto: { ...config.atproto, standard_site: { fields: { 'territorial-unit': { description: 'blurb', body: ['blurb', 'summary_long'] } } } } } }).entries[0];
  assert.deepEqual(e2.body.map((b) => b.field), ['summary_long']);
});

test('labelFor: render.labels > pack > LABELS > humanised; every FIELD_MAP body field has a label', () => {
  assert.equal(labelFor('known_tensions', {}), 'Known tensions');
  assert.equal(labelFor('known_tensions', { config: { render: { labels: { known_tensions: 'X' } } }, pack: { labels: { known_tensions: 'Y' } } }), 'X');
  assert.equal(labelFor('known_tensions', { pack: { labels: { known_tensions: 'Y' } } }), 'Y');
  assert.equal(labelFor('soil_depth_cm', {}), 'Soil depth cm');
  for (const m of Object.values(FIELD_MAP)) for (const f of [m.description, ...m.body]) assert.ok(LABELS[f], f);
  assert.equal(kindLabel('encyclopedia-entry'), 'Encyclopedia entry');
});

test('caveat sentence for reviewed-for-explanation', () => {
  const e = by(pub(), 'rotational-grazing');
  assert.equal(e.caveat, CAVEATS['reviewed-for-explanation']);
  assert.match(e.caveat, /^Reviewed for explanation\. This entry explains the idea; it is not yet guidance/);
  assert.equal(by(pub(), 'living-mulch').caveat, null);
  assert.ok(CAVEATS['ok-with-caveat'] && CAVEATS['source-linked-unreviewed']);
});

test('deprecated carries its successor', () => {
  const e = by(pub(), 'three-sisters-guild');
  assert.deepEqual(e.deprecated, { byTitle: 'Cover cropping', byHref: 'k/concept-lineage/id-cover-cropping.html' });
  assert.equal(e.mark.shape, 'closed');
  assert.equal(by(pub(), 'living-mulch').deprecated, null);
  // a successor that is not published is dropped, as any ref
  const m = pub({ items: F.items.filter((i) => i !== F.cover) });
  assert.deepEqual(by(m, 'three-sisters-guild').deprecated, { byTitle: null, byHref: null });
});

test('peer origin: from <peer>, http href, read age from reads; a failed read shows only in preview', () => {
  const e = by(pub(), 'seed-saving');
  assert.deepEqual(e.origin, { peer: 'hillside.example', href: 'https://hillside.example/resources/seed-saving', readAge: '3 d', failed: false });
  assert.equal(by(pub(), 'living-mulch').origin, null);
  const pf = by(pub({ reads: F.readsFailed }), 'seed-saving').origin;
  assert.equal(pf.failed, false); assert.equal(pf.readAge, '9 d');
  const vf = by(prev({ reads: F.readsFailed }), 'seed-saving').origin;
  assert.equal(vf.failed, true); assert.equal(vf.readAge, '9 d');
  assert.equal(pub().counts.peersRead, 1);
  // no http form: from <peer>, no link
  const odd = { ...F.peerEntry, object: { ...F.peerEntry.object, url: 'javascript:alert(1)' } };
  const o = by(pub({ items: F.items.map((i) => (i === F.peerEntry ? odd : i)) }), 'seed-saving').origin;
  assert.equal(o.href, null); assert.ok(o.peer);
  const nourl = { ...F.peerEntry, object: { ...F.peerEntry.object, url: undefined } };
  assert.equal(by(pub({ items: F.items.map((i) => (i === F.peerEntry ? nourl : i)) }), 'seed-saving').origin.href, null);
  assert.equal(by(pub({ reads: {} }), 'seed-saving').origin.readAge, null);
});

test('maturity marks and words per the spec table', () => {
  const t = { reviewed: ['done', 'Reviewed'], 'field-informed': ['done', 'Field-informed'], 'pattern-generating': ['done', 'Pattern'], 'source-linked': ['ok', 'Source-linked'],
    draft: ['open', 'Draft'], candidate: ['open', 'Candidate'], raw: ['aged', 'Raw'], held: ['aged', 'Held'], deprecated: ['closed', 'Deprecated'], archived: ['closed', 'Archived'] };
  assert.deepEqual(Object.keys(MATURITY_MARK).sort(), Object.keys(t).sort());
  for (const [k, [shape, word]] of Object.entries(t)) assert.deepEqual(MATURITY_MARK[k], { shape, word });
  assert.deepEqual(by(pub(), 'living-mulch').mark, { shape: 'done', word: 'Reviewed' });
});

test('neighbours capped at 6 with more', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ schema: 'resource', ref: `r.yaml#r${i}`, object: { type: 'resource', id: `id-r${i}`, title: `Resource ${i}`, maturity: 'reviewed', public_use: 'reviewed-for-guidance' } }));
  const hub = { schema: 'encyclopedia-entry', ref: 'e.yaml#hub', object: { type: 'encyclopedia-entry', id: 'id-hub', title: 'Hub', maturity: 'reviewed', public_use: 'reviewed-for-guidance', related_resources: many.map((_, i) => `r${i}`) } };
  const all = [hub, ...many];
  const e = pub({ items: all, allItems: all, manifest: { version: 1, objects: {} } }).entries.find((x) => x.slug === 'hub');
  assert.equal(e.neighbours.items.length, 6); assert.equal(e.neighbours.more, 2);
  assert.equal(e.related.length, 8);
  const small = pub().entries.find((x) => x.slug === 'cover-cropping');
  assert.equal(small.neighbours.more, 0);
});

test('kinds, counts, about, cite, hrefs', () => {
  const m = pub();
  assert.deepEqual(m.kinds.map((k) => [k.schema, k.label, k.glyphType, k.count]), [
    ['concept-lineage', 'Concept lineage', 'branch', 1], ['encyclopedia-entry', 'Encyclopedia entry', 'book', 2],
    ['option-entry', 'Option entry', 'sliders', 1], ['resource', 'Resource', 'file', 1], ['source-system', 'Source system', 'database', 1]]);
  assert.deepEqual(m.counts, { entries: 6, kinds: 5, sources: 1, peersRead: 1 });
  const e = by(m, 'living-mulch');
  assert.equal(e.href, 'k/encyclopedia-entry/id-living-mulch.html'); assert.equal(e.apiHref, 'api/encyclopedia-entry/id-living-mulch.json');
  assert.equal(e.atUri, 'at://did:plc:exampledao/org.exampledao.encyclopedia-entry/id-living-mulch');
  assert.equal(e.cite, 'Credit the Example DAO Seed Library, CC BY.'); assert.equal(by(m, 'cover-cropping').cite, null);
  assert.equal(e.updated, '2026-10-20');
  assert.deepEqual(e.about.slice(0, 3), [['Kind', 'Encyclopedia entry'], ['Page type', 'Concept'], ['Maturity', 'Reviewed']]);
  assert.ok(e.about.some(([l, v]) => l === 'Steward' && v === 'Field steward'));
  assert.ok(e.about.some(([l, v]) => l === 'Record' && v === e.atUri));
  const empty = pub({ items: [], allItems: [] });
  assert.deepEqual(empty.counts, { entries: 0, kinds: 0, sources: 1, peersRead: 0 }); assert.deepEqual(empty.entries, []);
});

test('pure: now is injected; same input, same output', () => {
  assert.deepEqual(pub(), pub());
  assert.equal(by(pub({ now: '2026-10-30T12:00:00Z' }), 'seed-saving').origin.readAge, '4 d');
});

test('a read under an hour old is in minutes, the map\'s age(): "read 10 min ago", never "read just now ago"', async () => {
  const { renderIndex } = await import('../src/pages/render-index.mjs');
  const { renderEntry } = await import('../src/pages/render-entry.mjs');
  const ok_at = new Date(Date.parse(F.NOW) - 10 * 60_000).toISOString();
  const m = pub({ reads: { atproto: { ok_at, attempt_at: ok_at, error: null } } });
  const e = by(m, 'seed-saving');
  assert.equal(e.origin.readAge, '10 min');
  const opts = { fonts: { mode: 'system' }, now: F.NOW };
  const index = renderIndex(m, opts);
  assert.match(index, /read 10 min ago/);
  assert.doesNotMatch(index, /just now/);
  const page = renderEntry(by(m, 'living-mulch'), m, opts);
  assert.doesNotMatch(page, /just now/);
});

test('lead keeps the whole description; summary is its one-line form (core and pack)', () => {
  const long = `${'A long, careful description of the practice. '.repeat(10)}END`;
  assert.ok(long.length > 240);
  const lm = { ...F.living, object: { ...F.living.object, summary: long } };
  const e = by(pub({ items: F.items.map((i) => (i === F.living ? lm : i)) }), 'living-mulch');
  assert.equal(e.lead, long); assert.ok(e.summary.length <= 240 && e.summary.endsWith('…'));
  assert.ok(!e.body.some((b) => b.field === 'summary'));
  const unit = { schema: 'territorial-unit', ref: 'u.yaml#nb', object: { type: 'territorial-unit', id: 'id-nb', title: 'North bank', maturity: 'draft', public_use: 'ok-with-caveat', blurb: long } };
  const config = { ...F.config, atproto: { ...F.config.atproto, standard_site: { fields: { 'territorial-unit': { description: 'blurb', body: ['blurb'] } } } } };
  const p = pub({ items: [unit], allItems: [unit], manifest: { version: 1, objects: {} }, config }).entries[0];
  assert.equal(p.lead, long); assert.ok(p.summary.length <= 240);
});

test('deprecated is set only for a deprecated entry, even when superseded_by exists', () => {
  const lm = { ...F.living, object: { ...F.living.object, superseded_by: 'cover-cropping' } };
  assert.equal(by(pub({ items: F.items.map((i) => (i === F.living ? lm : i)) }), 'living-mulch').deprecated, null);
});

test('preview rows to internal entries carry internal: true; public rows carry no such key', () => {
  const rel = by(prev(), 'living-mulch').related;
  assert.equal(rel.find((r) => r.title === 'Staff handbook').internal, true);
  assert.equal(rel.find((r) => r.title === 'Cover cropping').internal, false);
  assert.equal(by(prev(), 'living-mulch').backlinks.find((b) => b.slug === 'staff-handbook').internal, true);
  assert.ok(by(pub(), 'living-mulch').related.every((r) => !('internal' in r)));
  assert.ok(by(pub(), 'cover-cropping').backlinks.every((r) => !('internal' in r)));
});
