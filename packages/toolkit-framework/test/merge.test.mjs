// test/merge.test.mjs — BR2: storing a second object under an existing slug must
// MERGE, not replace. The ingest brief tells agents to share a title so the same
// real-world entity dedups; before this, the later (usually thinner) mention
// silently destroyed the richer earlier entry, so agents defensively refused to
// emit already-noded entities and lost their provenance links instead.
//
// The contract asserted here:
//   1. new slug            → stored as-is (no behaviour change)
//   2. existing scalars win → a thin later mention cannot clobber a rich entry
//   3. gap fill            → absent/null/'' on the existing entry is filled by the incoming
//   4. arrays union        → order-stable, de-duplicated
//   5. maturity never downgrades, and review fields survive untouched
//   6. notes preserved from both sides
//   7. provenance accumulates into additional_provenance[]
//   8. idempotent          → storing the byte-identical object twice is a no-op
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAdapter } from '../src/storage.mjs';

const SCHEMA = 'resource';
const fresh = () => mkdtempSync(join(tmpdir(), 'tf-merge-'));
const a = () => getAdapter('repo-data');
const entry = (object) => ({ schema: SCHEMA, object });
const only = (target) => {
  const items = a().list(target);
  assert.equal(items.length, 1, `expected exactly 1 entry, got ${items.length}`);
  return items[0].object;
};

// A rich, already-noded entity — the kind an earlier wave produced.
const rich = () => ({
  title: 'Toucan Protocol',
  type: 'resource',
  resource_type: 'protocol',
  url: 'https://real.example',
  related_concepts: ['tokenized-carbon', 'bridge'],
  maturity: 'raw',
  ai_assisted: true,
  source_lineage: 'https://blog.refidao.com/post-a/',
  provenance: {
    origin: 'https://blog.refidao.com/post-a/',
    surfaced_by: 'batch 1 (2026-07-07)',
    transformation: 'summarized',
    authorship: 'ai-assisted',
  },
  notes: 'Bridged the first BCT.',
  work_order: 'wo-aaaa1111',
});

// A thin later mention of the SAME entity from a different post.
const thin = () => ({
  title: 'Toucan Protocol',
  type: 'resource',
  resource_type: 'protocol',
  related_concepts: ['bridge', 'carbon-market'],
  maturity: 'raw',
  ai_assisted: true,
  source_lineage: 'https://blog.refidao.com/post-b/',
  provenance: {
    origin: 'https://blog.refidao.com/post-b/',
    surfaced_by: 'batch 2 (2026-07-19)',
    transformation: 'summarized',
    authorship: 'ai-assisted',
  },
  notes: 'Mentioned as a partner.',
  work_order: 'wo-bbbb2222',
});

// 1 ────────────────────────────────────────────────────────────────────────────
test('[merge] a new slug is stored as-is (no regression to existing behaviour)', () => {
  const t = fresh();
  const object = rich();
  const { stored } = a().store(t, [entry(object)], { onCollision: 'merge' });
  assert.equal(stored.length, 1);
  assert.ok(stored[0].endsWith('#toucan-protocol'), `bad ref: ${stored[0]}`);
  assert.deepEqual(only(t), object);
});

// 2 ────────────────────────────────────────────────────────────────────────────
test('[merge] a thin later mention cannot clobber a rich existing entry', () => {
  const t = fresh();
  a().store(t, [entry(rich())], { onCollision: 'merge' });
  a().store(t, [entry(thin())], { onCollision: 'merge' });           // thin has NO url at all
  assert.equal(only(t).url, 'https://real.example');

  // ...and a *conflicting* value loses too: existing wins on scalars.
  const t2 = fresh();
  a().store(t2, [entry(rich())], { onCollision: 'merge' });
  a().store(t2, [entry({ ...thin(), url: 'https://wrong.example' })], { onCollision: 'merge' });
  assert.equal(only(t2).url, 'https://real.example');
  assert.equal(only(t2).work_order, 'wo-aaaa1111');
  assert.equal(only(t2).source_lineage, 'https://blog.refidao.com/post-a/');
  assert.equal(only(t2).provenance.surfaced_by, 'batch 1 (2026-07-07)');
});

// 3 ────────────────────────────────────────────────────────────────────────────
test('[merge] gap fill: an absent / null / empty-string field is filled by the incoming', () => {
  const t = fresh();
  a().store(t, [entry({ ...rich(), url: null, domain: '', resource_type: undefined })], { onCollision: 'merge' });
  a().store(t, [entry({ ...thin(), url: 'https://filled.example', domain: 'carbon', resource_type: 'protocol' })], { onCollision: 'merge' });
  const m = only(t);
  assert.equal(m.url, 'https://filled.example');
  assert.equal(m.domain, 'carbon');
  assert.equal(m.resource_type, 'protocol');
});

test('[merge] falsey-but-present values (false, 0) are NOT treated as gaps', () => {
  const t = fresh();
  a().store(t, [entry({ ...rich(), is_source_system_candidate: false, ai_assisted: false })], { onCollision: 'merge' });
  a().store(t, [entry({ ...thin(), is_source_system_candidate: true, ai_assisted: true })], { onCollision: 'merge' });
  const m = only(t);
  assert.equal(m.is_source_system_candidate, false);
  assert.equal(m.ai_assisted, false, 'a human-cleared ai_assisted flag must not be re-set by a later raw store');
});

// 4 ────────────────────────────────────────────────────────────────────────────
test('[merge] arrays union: order-stable, de-duplicated', () => {
  const t = fresh();
  a().store(t, [entry({ ...rich(), related_concepts: ['a', 'b'], tags: ['x'] })], { onCollision: 'merge' });
  a().store(t, [entry({ ...thin(), related_concepts: ['b', 'c'], tags: ['x', 'y'], related_resources: ['r1'] })], { onCollision: 'merge' });
  const m = only(t);
  assert.deepEqual(m.related_concepts, ['a', 'b', 'c']);
  assert.deepEqual(m.tags, ['x', 'y']);
  assert.deepEqual(m.related_resources, ['r1']);       // array arriving into a gap
});

// 5 ────────────────────────────────────────────────────────────────────────────
test('[merge] maturity never downgrades and review fields survive untouched', () => {
  const t = fresh();
  a().store(t, [entry({
    ...rich(), maturity: 'reviewed', ai_assisted: false,
    reviewed_by: 'luiz', last_reviewed: '2026-07-25',
  })], { onCollision: 'merge' });
  a().store(t, [entry(thin())], { onCollision: 'merge' });                       // thin is maturity: raw, ai_assisted: true
  const m = only(t);
  assert.equal(m.maturity, 'reviewed');
  assert.equal(m.reviewed_by, 'luiz');
  assert.equal(m.last_reviewed, '2026-07-25');
  assert.equal(m.ai_assisted, false);
});

test('[merge] maturity is not silently auto-promoted by a later store either', () => {
  const t = fresh();
  a().store(t, [entry(rich())], { onCollision: 'merge' });                                   // raw
  a().store(t, [entry({ ...thin(), maturity: 'reviewed', reviewed_by: 'nobody' })], { onCollision: 'merge' });
  const m = only(t);
  assert.equal(m.maturity, 'raw', 'promotion is review-promote\'s job, not store\'s');
  assert.equal(m.reviewed_by, 'nobody', 'a brand-new field still gap-fills');
});

test('[merge] a missing maturity on the existing entry is gap-filled', () => {
  const t = fresh();
  const { maturity: _drop, ...noMaturity } = rich();
  a().store(t, [entry(noMaturity)], { onCollision: 'merge' });
  a().store(t, [entry({ ...thin(), maturity: 'draft' })], { onCollision: 'merge' });
  assert.equal(only(t).maturity, 'draft');
});

// 6 ────────────────────────────────────────────────────────────────────────────
test('[merge] notes from both sides are preserved', () => {
  const t = fresh();
  a().store(t, [entry(rich())], { onCollision: 'merge' });
  a().store(t, [entry(thin())], { onCollision: 'merge' });
  const { notes } = only(t);
  assert.ok(notes.includes('Bridged the first BCT.'), `existing notes lost: ${notes}`);
  assert.ok(notes.includes('Mentioned as a partner.'), `incoming notes lost: ${notes}`);
  assert.ok(notes.indexOf('Bridged') < notes.indexOf('Mentioned'), 'existing notes come first');
});

test('[merge] identical notes are not duplicated', () => {
  const t = fresh();
  a().store(t, [entry(rich())], { onCollision: 'merge' });
  a().store(t, [entry({ ...thin(), notes: 'Bridged the first BCT.' })], { onCollision: 'merge' });
  const { notes } = only(t);
  assert.equal(notes.split('Bridged the first BCT.').length - 1, 1, `notes duplicated: ${notes}`);
});

// 7 ────────────────────────────────────────────────────────────────────────────
test('[merge] provenance accumulates into additional_provenance[]', () => {
  const t = fresh();
  a().store(t, [entry(rich())], { onCollision: 'merge' });
  a().store(t, [entry(thin())], { onCollision: 'merge' });
  const m = only(t);
  // primary provenance + lineage stay put
  assert.equal(m.provenance.origin, 'https://blog.refidao.com/post-a/');
  assert.equal(m.source_lineage, 'https://blog.refidao.com/post-a/');
  // the second object's provenance is discoverable
  assert.ok(Array.isArray(m.additional_provenance), 'additional_provenance[] not created');
  assert.equal(m.additional_provenance.length, 1);
  const [p] = m.additional_provenance;
  assert.equal(p.surfaced_by, 'batch 2 (2026-07-19)');
  assert.equal(p.origin, 'https://blog.refidao.com/post-b/');
  assert.equal(p.transformation, 'summarized');
  assert.equal(p.authorship, 'ai-assisted');
  assert.equal(p.work_order, 'wo-bbbb2222');
});

test('[merge] a third distinct provenance appends; a repeat of one already recorded does not', () => {
  const t = fresh();
  const third = { ...thin(), source_lineage: 'https://blog.refidao.com/post-c/', work_order: 'wo-cccc3333',
    provenance: { origin: 'https://blog.refidao.com/post-c/', surfaced_by: 'batch 3', transformation: 'summarized', authorship: 'ai-assisted' } };
  a().store(t, [entry(rich())], { onCollision: 'merge' });
  a().store(t, [entry(thin())], { onCollision: 'merge' });
  a().store(t, [entry(third)], { onCollision: 'merge' });
  assert.equal(only(t).additional_provenance.length, 2);
  a().store(t, [entry(thin())], { onCollision: 'merge' });                       // already recorded
  a().store(t, [entry(rich())], { onCollision: 'merge' });                       // this is the PRIMARY provenance
  const m = only(t);
  assert.equal(m.additional_provenance.length, 2, `duplicated provenance: ${JSON.stringify(m.additional_provenance)}`);
  assert.deepEqual(m.additional_provenance.map((p) => p.surfaced_by), ['batch 2 (2026-07-19)', 'batch 3']);
});

// 8 ────────────────────────────────────────────────────────────────────────────
test('[merge] idempotent: storing the byte-identical object twice is a no-op', () => {
  const once = fresh();
  a().store(once, [entry(rich())], { onCollision: 'merge' });
  const twice = fresh();
  a().store(twice, [entry(rich())], { onCollision: 'merge' });
  a().store(twice, [entry(rich())], { onCollision: 'merge' });
  assert.deepEqual(only(twice), only(once));
  assert.equal(only(twice).additional_provenance, undefined, 'additional_provenance grew on a no-op re-store');
});

test('[merge] idempotent after a real merge: re-storing both objects changes nothing', () => {
  const t = fresh();
  a().store(t, [entry(rich())], { onCollision: 'merge' });
  a().store(t, [entry(thin())], { onCollision: 'merge' });
  const settled = only(t);
  a().store(t, [entry(rich())], { onCollision: 'merge' });
  a().store(t, [entry(thin())], { onCollision: 'merge' });
  a().store(t, [entry(rich())], { onCollision: 'merge' });
  assert.deepEqual(only(t), settled);
});

test('[merge] two objects sharing a slug WITHIN one store() call merge too', () => {
  const t = fresh();
  a().store(t, [entry(rich()), entry(thin())], { onCollision: 'merge' });
  const m = only(t);
  assert.equal(m.url, 'https://real.example');
  assert.deepEqual(m.related_concepts, ['tokenized-carbon', 'bridge', 'carbon-market']);
  assert.equal(m.additional_provenance.length, 1);
});

test('[merge] distinct slugs are untouched by each other', () => {
  const t = fresh();
  a().store(t, [entry(rich()), entry({ ...thin(), title: 'Klima DAO' })], { onCollision: 'merge' });
  const items = a().list(t);
  assert.equal(items.length, 2);
  assert.deepEqual(items.find((i) => i.object.title === 'Toucan Protocol').object, rich());
});

test('default policy is unchanged: a colliding different object gets a hash-suffixed key (B5)', () => {
  const t = mkdtempSync(join(tmpdir(), 'merge-default-'));
  a().store(t, [entry({ title: 'Toucan Protocol', type: 'resource', url: 'https://toucan.earth' })]);
  const { stored, collisions } = a().store(t, [entry({ title: 'Toucan Protocol', type: 'resource', notes: 'thin later mention' })]);
  assert.equal(collisions.length, 1);
  assert.match(stored[0], /#toucan-protocol-[0-9a-f]{8}$/);
});

test('merge policy reports no collision and keeps one key', () => {
  const t = mkdtempSync(join(tmpdir(), 'merge-on-'));
  a().store(t, [entry({ title: 'Toucan Protocol', type: 'resource', url: 'https://toucan.earth' })]);
  const { stored, collisions } = a().store(t, [entry({ title: 'Toucan Protocol', type: 'resource', notes: 'thin later mention' })], { onCollision: 'merge' });
  assert.deepEqual(collisions, []);
  assert.match(stored[0], /#toucan-protocol$/);
});
