// Type enablement: which record types a commons publishes is decided by ITS kms.yaml. Loading an
// extension pack registers its types; only `publish.types_opt_in` makes them publish-eligible.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { makeCanon, makeCommons, readTree } from './helpers.mjs';
import { loadCommonsPolicy } from '../../src/planes/kms-config.mjs';
import { exportCommons } from '../../src/planes/export-commons.mjs';
import { validatePublishedKb } from '../../src/planes/validate-published-kb.mjs';
import { loadKb } from '../../src/planes/kb-loader.mjs';
import { isPublishable as gateIsPublishable, buildBoundaryIndex, validateCards } from '../../src/planes/publication-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A throwaway commons whose kms.yaml carries `extensions` and (optionally) `publish.types_opt_in`. */
function commonsWith({ extensions, optIn } = {}) {
  return makeCommons(undefined, undefined, { extensions, types_opt_in: optIn });
}

test('commons policy: pack types are publish-eligible only where the commons opts in', () => {
  const withOptIn = commonsWith({ extensions: ['org-os-territory'], optIn: ['territorial-unit', 'data-stream'] });
  const { config, types } = loadCommonsPolicy({ commonsDir: withOptIn });
  assert.deepEqual(config.extensions, ['org-os-territory']);
  assert.ok(types.includes('territorial-unit') && types.includes('data-stream'));
  assert.ok(types.includes('organization') && types.includes('option-entry') && types.includes('relationship-record'));
  assert.ok(!types.includes('person'));
  const bare = loadCommonsPolicy({ commonsDir: commonsWith({ extensions: ['org-os-territory'] }) });
  assert.ok(!bare.types.includes('territorial-unit'), 'loading a pack never widens what is published');
  assert.ok(!bare.types.includes('data-stream'), 'loading a pack never widens what is published');
});

test('commons policy: repeated loads in one process are idempotent, and a bare commons does not inherit a prior load', () => {
  const withOptIn = commonsWith({ extensions: ['org-os-territory'], optIn: ['territorial-unit'] });
  const a = loadCommonsPolicy({ commonsDir: withOptIn });
  const b = loadCommonsPolicy({ commonsDir: withOptIn });
  assert.deepEqual(a.types, b.types);
  // no pack, no opt-in: the previous load's pack types must not linger
  const none = loadCommonsPolicy({ commonsDir: commonsWith() });
  assert.ok(!none.types.includes('territorial-unit'));
});

test('commons policy: an opt-in for a type no loaded pack provides fails loudly', () => {
  const dir = commonsWith({ optIn: ['territorial-unit'] }); // opts in but never loads the pack
  assert.throws(() => loadCommonsPolicy({ commonsDir: dir }), /unknown publishable type: territorial-unit/);
});

test('commons policy: a declared pack that cannot be loaded fails naming the pack', () => {
  const dir = commonsWith({ extensions: ['org-os-nonexistent'] });
  assert.throws(() => loadCommonsPolicy({ commonsDir: dir }), /org-os-nonexistent/);
});

// ─────────────────────────────────────────────────────────────────────────────
// The five types RC publishes (contract §3). One canon object per type, minimally valid for its
// schema and carrying the born-rule instance fields (§5). Shared by the gate matrix below and by
// the end-to-end loader → gate → exporter → re-gate tests after it.
// ─────────────────────────────────────────────────────────────────────────────

const FIVE = ['organization', 'option-entry', 'relationship-record', 'territorial-unit', 'data-stream'];
const LINEAGE = 'repos/ReFi-Barcelona/notes/x.md';
const GEOMETRY = 'data/geo/barcelona.geojson';

// Only the REQUIRED fields of each schema — a minimal valid object, so a future required-field
// change fails here loudly rather than being masked by a fixture that over-specifies.
// NOTE `option-entry` has its own required field literally named `type`; loadKb overwrites it with
// the file name (see the "loads" test), which is exactly the collision worth pinning.
const REQUIRED = {
  organization: { title: 'Xarxa d\'Economia Solidària' },
  'option-entry': { title: 'Assemblea oberta', type: 'option', category: 'governance' },
  'relationship-record': { subject: 'organization:xes', predicate: 'member-of', object: 'organization:refi-bcn' },
  'territorial-unit': { title: 'Osona', unit_id: 'administrative:comarca:osona', layer: 'administrative', level: 'comarca' },
  'data-stream': { title: 'Idescat padró', source_system: 'idescat', access: 'open-api' },
};

// The born rules (contract §5) plus one private field and one nested geometry reference.
// `provenance.geometry_ref` is nested on EVERY type, not just units, so the strip is proven at
// depth rather than only at the top level.
const BORN = {
  serves: ['administration', 'networks'],
  summary_en: 'One or two sentences of English summary.',
  lang: 'ca',
  locator: 'p. 12',
  unit_refs: ['administrative:comarca:osona'],
  maturity: 'reviewed',
  public_use: 'ok-with-caveat',
  source_lineage: LINEAGE,
  ai_assisted: true,
  notes: 'INTERNAL NOTE — never leaves the canon',
  provenance: { origin: LINEAGE, transformation: 'summarized', geometry_ref: GEOMETRY },
};

// ─────────────────────────────────────────────────────────────────────────────
// The gate matrix: every refusal rule in publication-gate.mjs `evaluate()` × every one of the five
// types. The gate is supposed to be type-AGNOSTIC — its only per-type rules are NEVER_RENDERED_TYPES
// and the structural shape check — so this table is the proof of that claim rather than a set of
// new behaviours. A row that fails is a gate bug for the type it fails on, not a fixture problem.
//
// The object under test is the object the GATE sees: loadKb's shape, i.e. `type` injected from the
// file name. That is why option-entry's own required `type: option` field is overwritten here — the
// gate never reads the schema field of that name.
// ─────────────────────────────────────────────────────────────────────────────

const gateObject = (type, patch = {}) => ({ ...REQUIRED[type], ...BORN, type, slug: 'x', ...patch });

// Cards copied VERBATIM from tests/kms/publication-gate.test.mjs, all three of them: one notation, a
// workspace-relative corpus path. `regenerant-catalunya` is the one with a held prefix, which the
// held-prefix row needs. `lf-work` is internal-only and claims (via its url fallback) only
// `repos/lf-work-os/` — it is in the fixture precisely because a blocked card that does NOT claim
// the object's lineage must not refuse it, which is what keeps the card-side rows below honest.
const sourceSystems = {
  'refi-bcn-old-kb': {
    title: 'ReFi BCN Old KB',
    url: 'https://github.com/refibcn/ReFi-Barcelona',
    origin_prefixes: ['repos/ReFi-Barcelona/'],
    public_use: 'ok-with-caveat',
  },
  'regenerant-catalunya': {
    title: 'Regenerant Catalunya',
    url: 'https://github.com/refibcn/Regenerant-Catalunya',
    origin_prefixes: ['repos/Regenerant-Catalunya/'],
    held_prefixes: ['repos/Regenerant-Catalunya/docs/'],
    public_use: 'ok-with-caveat',
  },
  'lf-work': { title: 'lf-work', url: 'https://github.com/luizfernandosg/lf-work-os', public_use: 'internal-only' },
};

/** The card set with the ONE card that claims the object's lineage patched — the card-side rules
 *  are properties of the claiming container, not of the object, so those rows vary the card and
 *  leave the object at its (accepted) control shape. */
const claimingCardWith = (patch) => ({
  ...sourceSystems,
  'refi-bcn-old-kb': { ...sourceSystems['refi-bcn-old-kb'], ...patch },
});

const ctx = (boundaries = [], cards = sourceSystems) => ({ sourceSystems: cards, boundaries: buildBoundaryIndex(boundaries) });
const verdict = (type, patch, c = ctx()) => gateIsPublishable(gateObject(type, patch), c);

// A boundary that blocks: a public-use-boundary record whose exact lineage key is the object's own,
// at the one tier that refuses. Same shape as the records in publication-gate.test.mjs.
const CONSENT_BOUNDARY = [{ source_lineage: LINEAGE, tier: 'never-publish-without-consent' }];

// Every refusal branch of evaluate(), in the order evaluate() checks them. Each row varies EXACTLY
// ONE thing — the object (`patch`), the boundary index (`boundaries`) or the card set (`cards`) —
// off a baseline the control test proves is accepted, and asserts the FULL reason string anchored.
// An anchored reason is what makes a row non-vacuous: a patch that happened to trip some earlier
// rule instead would produce a different string and fail here rather than passing for free.
const GATE_MATRIX = [
  { rule: 'structurally a public-use-boundary (tier)', patch: { tier: 'x' }, expect: /^structurally a public-use-boundary record \(never rendered\)$/ },
  { rule: 'structurally a source-system (reuse_conditions)', patch: { reuse_conditions: 'x' }, expect: /^structurally a source-system record \(never rendered\)$/ },
  { rule: 'structurally a source-system (what_it_curates)', patch: { what_it_curates: 'x' }, expect: /^structurally a source-system record \(never rendered\)$/ },
  { rule: 'missing type', patch: { type: undefined }, expect: /^missing type$/ },
  { rule: 'never-rendered type', patch: { type: 'source-system' }, expect: /^type source-system is never rendered$/ },
  { rule: 'risk flag', patch: { high_risk: true }, expect: /^high_risk$/ },
  { rule: 'blocked public_use — internal-only', patch: { public_use: 'internal-only' }, expect: /^public_use internal-only$/ },
  { rule: 'blocked public_use — raw-lead', patch: { public_use: 'raw-lead' }, expect: /^public_use raw-lead$/ },
  { rule: 'no lineage', patch: { source_lineage: undefined }, expect: /^no source_lineage$/ },
  // One notation only. NOTE the two spellings are refused by DIFFERENT branches: a leading-slash
  // corpus path is rewritable, so nonCanonicalReason names it; a URL is not, so it falls through to
  // "no registered card claims this". The row names the INPUT; the reason names the branch.
  { rule: 'URL lineage', patch: { source_lineage: 'https://github.com/refibcn/ReFi-Barcelona/blob/main/x.md' }, expect: /^unresolvable source_lineage: https:\/\/github\.com\/refibcn\/ReFi-Barcelona\/blob\/main\/x\.md$/ },
  { rule: 'non-canonical spelling', patch: { source_lineage: '/repos/ReFi-Barcelona/x.md' }, expect: /^non-canonical source_lineage: "\/repos\/ReFi-Barcelona\/x\.md" — write it as "repos\/ReFi-Barcelona\/x\.md"$/ },
  { rule: 'consent boundary', patch: {}, boundaries: CONSENT_BOUNDARY, expect: /^boundary: never-publish-without-consent$/ },
  { rule: 'unregistered container', patch: { source_lineage: 'repos/Nowhere/x.md' }, expect: /^unresolvable source_lineage: repos\/Nowhere\/x\.md$/ },
  { rule: 'provenance.origin unregistered', patch: { provenance: { origin: 'repos/Nowhere/x.md' } }, expect: /^unresolvable source_lineage: repos\/Nowhere\/x\.md$/ },
  { rule: 'claiming card has malformed held_prefixes', patch: {}, cards: claimingCardWith({ held_prefixes: 'repos/ReFi-Barcelona/secret/' }), expect: /^source-system ReFi BCN Old KB has malformed held_prefixes$/ },
  { rule: 'held prefix', patch: { source_lineage: 'repos/Regenerant-Catalunya/docs/pla.md' }, expect: /^held prefix: repos\/Regenerant-Catalunya\/docs\/$/ },
  { rule: 'claiming card is high_risk', patch: {}, cards: claimingCardWith({ high_risk: true }), expect: /^source-system ReFi BCN Old KB is internal-only\/high_risk$/ },
  { rule: 'claiming card has a blocked public_use', patch: {}, cards: claimingCardWith({ public_use: 'internal-only' }), expect: /^source-system ReFi BCN Old KB is internal-only\/high_risk$/ },
  { rule: 'claiming card is unassessed (no public_use)', patch: {}, cards: claimingCardWith({ public_use: undefined }), expect: /^source-system ReFi BCN Old KB is unassessed \(no public_use\)$/ },
  { rule: 'maturity', patch: { maturity: 'raw' }, expect: /^maturity is raw$/ },
];

// The two accept branches, for the same five types: the ordinary promoted maturity, and the
// operator's override. Without the second, a matrix of nothing but refusals would pass just as well
// against a gate that refused everything.
const GATE_ACCEPTS = [
  { rule: 'reviewed, resolvable, public', patch: {}, reason: 'maturity reviewed' },
  { rule: 'operator publish flag over a raw maturity', patch: { maturity: 'raw', publish: true }, reason: 'operator publish flag' },
];

for (const { rule, patch, reason } of GATE_ACCEPTS) {
  test(`gate matrix: ${rule} accepts all five types`, () => {
    for (const t of FIVE) {
      assert.deepEqual(verdict(t, patch), { ok: true, reason }, `${t} was refused`);
    }
  });
}

for (const { rule, patch, boundaries, cards, expect } of GATE_MATRIX) {
  test(`gate matrix: ${rule} refuses all five types`, () => {
    for (const t of FIVE) {
      const v = verdict(t, patch, ctx(boundaries, cards));
      assert.equal(v.ok, false, `${t}: ${rule} did not refuse — ${v.reason}`);
      assert.match(v.reason, expect, `${t}: ${rule} refused for the wrong reason`);
    }
  });
}

test('a data-stream that grows reuse_conditions is refused as structurally a source-system', () => {
  // The data-stream schema does not define reuse_conditions — prose reuse terms live on the
  // PROVIDER's source-system card. A stream carrying them is a card in disguise, and the gate's
  // shape check must catch it before the type name is even read.
  const v = verdict('data-stream', { reuse_conditions: 'attribution required, no redistribution' });
  assert.deepEqual(v, { ok: false, reason: 'structurally a source-system record (never rendered)' });
});

// ─────────────────────────────────────────────────────────────────────────────
// End to end: loader → gate → exporter → re-gate. What this pins is not "the gate likes them" —
// that is the matrix above — but that nothing on the PATH is type-blind in the wrong direction: the
// loader types them from the file name, the exporter's floor sees the commons' own type policy
// rather than the framework default, the public instance fields survive, and the private ones
// (plus geometry, §8) do not.
// ─────────────────────────────────────────────────────────────────────────────

const PACK_TYPES = ['territorial-unit', 'data-stream'];

/** The five instance fields the contract calls PUBLIC — they must survive the export. */
const PUBLIC_INSTANCE_FIELDS = ['serves', 'summary_en', 'lang', 'locator', 'unit_refs'];

const canonObject = (type) => ({
  ...REQUIRED[type],
  ...BORN,
  ...(type === 'territorial-unit' ? { geometry_ref: GEOMETRY } : {}),
});

/** A canon holding exactly one object of each of the five types, all slugged `x`. */
const canonOfFive = () => makeCanon(Object.fromEntries(FIVE.map((t) => [t, { x: canonObject(t) }])));

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const kbFile = (type) => path.join('data', 'kb', `${type}.yaml`);
const publishedEntry = (outDir, type) =>
  yaml.load(fs.readFileSync(path.join(outDir, kbFile(type)), 'utf8')).entries.x;

test('all five types load from the canon, typed by their file name', () => {
  const kb = loadKb(path.join(canonOfFive(), 'data', 'kb'));
  for (const t of FIVE) {
    const o = kb.objects[`${t}:x`];
    assert.ok(o, `${t}:x did not load`);
    assert.equal(o.type, t, `${t}: type is not taken from the file name`);
    assert.equal(o.slug, 'x');
  }
  // option-entry's OWN `type: option` field is what loadKb overwrote — the gate and the exporter
  // both read the file-name type, never the schema field of the same name.
  assert.equal(REQUIRED['option-entry'].type, 'option');
});

test('all five types export: an id is minted, the public instance fields survive, notes and geometry do not', () => {
  const root = canonOfFive();
  const outDir = makeCommons(undefined, undefined, { extensions: ['org-os-territory'], types_opt_in: PACK_TYPES });
  const r = exportCommons({ root, outDir, uuid });
  assert.deepEqual([...r.written].sort(), FIVE.map(kbFile).sort());
  assert.deepEqual(r.floorRejected, [], 'nothing the commons opted into may be floor-rejected');
  assert.deepEqual(r.skipped, [], 'nothing gate-skipped');
  for (const t of FIVE) {
    const o = publishedEntry(outDir, t);
    assert.ok(o.id, `${t}: no id minted`);
    assert.equal(loadKb(path.join(root, 'data', 'kb')).objects[`${t}:x`].id, o.id, `${t}: id not written back to the canon`);
    assert.ok(!('notes' in o), `${t}: notes leaked`);
    for (const f of PUBLIC_INSTANCE_FIELDS) {
      assert.ok(f in o, `${t}: public instance field ${f} did not survive the export`);
    }
    assert.deepEqual(o.serves, BORN.serves, `${t}: serves was altered`);
    assert.ok(!('geometry_ref' in o), `${t}: geometry_ref leaked at the top level`);
    assert.ok(!('geometry_ref' in o.provenance), `${t}: provenance.geometry_ref leaked`);
  }
  // Belt and braces across the WHOLE written tree, at any depth and in any file.
  const tree = JSON.stringify(readTree(outDir));
  assert.ok(!tree.includes('geometry_ref'), 'geometry_ref reached the commons somewhere');
  assert.ok(!tree.includes(GEOMETRY), 'a geometry path reached the commons somewhere');
  assert.ok(!tree.includes('INTERNAL NOTE'), 'a private note reached the commons');
});

test('the exported five re-gate clean against the canon', () => {
  const root = canonOfFive();
  const outDir = makeCommons(undefined, undefined, { extensions: ['org-os-territory'], types_opt_in: PACK_TYPES });
  exportCommons({ root, outDir, uuid });
  const { types } = loadCommonsPolicy({ commonsDir: outDir });
  const errors = validatePublishedKb({
    publishedDir: path.join(outDir, 'data', 'kb'),
    kb: loadKb(path.join(root, 'data', 'kb')),
    types,
  });
  assert.deepEqual(errors, []);
});

test('the re-gate reports a geometry_ref that reached a published file, top level or nested', () => {
  const root = canonOfFive();
  const outDir = makeCommons(undefined, undefined, { extensions: ['org-os-territory'], types_opt_in: PACK_TYPES });
  exportCommons({ root, outDir, uuid });
  const file = path.join(outDir, kbFile('territorial-unit'));
  const doc = yaml.load(fs.readFileSync(file, 'utf8'));
  doc.entries.x.geometry_ref = GEOMETRY;
  doc.entries.x.provenance.geometry_ref = GEOMETRY;
  fs.writeFileSync(file, yaml.dump(doc));
  const { types } = loadCommonsPolicy({ commonsDir: outDir });
  const errors = validatePublishedKb({
    publishedDir: path.join(outDir, 'data', 'kb'),
    kb: loadKb(path.join(root, 'data', 'kb')),
    types,
  });
  assert.ok(errors.some((e) => e === 'territorial-unit:x: private field(s) leaked: geometry_ref'), errors.join('\n'));
  assert.ok(errors.some((e) => e === 'territorial-unit:x: provenance.geometry_ref leaked'), errors.join('\n'));
});

test('a commons that loads the pack but opts no type in publishes neither pack type', () => {
  const root = canonOfFive();
  const outDir = makeCommons(undefined, undefined, { extensions: ['org-os-territory'] });
  const r = exportCommons({ root, outDir, uuid });
  assert.deepEqual([...r.written].sort(), ['organization', 'option-entry', 'relationship-record'].map(kbFile).sort());
  assert.deepEqual(r.floorRejected.map((s) => s.key).sort(), ['data-stream:x', 'territorial-unit:x']);
  for (const t of PACK_TYPES) {
    assert.ok(!fs.existsSync(path.join(outDir, kbFile(t))), `${t} was published without an opt-in`);
  }
  assert.ok(!JSON.stringify(readTree(outDir)).includes('Osona'), 'a unit body reached a commons that never opted in');
});

// Same idiom, and the same hazard, as "a refused export leaves the canon byte-identical" in
// tests/kms/export-commons.test.mjs. Minting happens in the CANON: selectForPublication calls
// ensureIds({ write: true }), which stamps new ids into data/kb/*.yaml. loadCommonsPolicy is a NEW
// throw site added in front of that, and it throws on exactly the two malformed-policy cases below.
// Read after selectForPublication instead of before it, an unknown-pack commons would rewrite every
// canon file and then produce nothing — so the ORDER is the invariant, and this is what pins it.
for (const [label, options, expected] of [
  ['a declared pack that does not exist', { extensions: ['org-os-nonexistent'] }, /org-os-nonexistent/],
  ['an opt-in for a type no loaded pack provides', { types_opt_in: ['territorial-unit'] }, /unknown publishable type: territorial-unit/],
]) {
  test(`an export refused by the commons' policy (${label}) leaves the canon byte-identical`, () => {
    const root = canonOfFive();
    const outDir = makeCommons(undefined, undefined, options);
    const canonFile = (t) => path.join(root, 'data', 'kb', `${t}.yaml`);
    const before = new Map(FIVE.map((t) => [t, fs.readFileSync(canonFile(t))]));
    for (const [t, bytes] of before) {
      // `^\s*id:` and not `includes('id:')` — territorial-unit carries `unit_id:`, which the
      // looser check would match, making the fixture guard pass for the wrong reason.
      assert.ok(!/^\s*id:/m.test(bytes.toString()), `fixture: ${t} already has an id, so an export would mint nothing`);
    }
    assert.throws(() => exportCommons({ root, outDir, uuid }), expected);
    for (const [t, bytes] of before) {
      assert.deepEqual(fs.readFileSync(canonFile(t)), bytes, `${t}.yaml was rewritten by a refused export`);
    }
    assert.ok(!fs.existsSync(path.join(outDir, 'data', 'kb')), 'the published store was created by a refused export');
  });
}
