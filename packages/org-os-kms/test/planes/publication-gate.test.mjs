import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  isPublishable, buildBoundaryIndex, isConsentBlocked, lineageKey, canonicalLineage, cardPrefixes,
  claimingCards, heldReasonFor, validateCards, validateBoundaries, boundaryFor, trimLineage, allLineages,
  NEVER_RENDERED_TYPES, CORPUS_PREFIX_RE, CORPUS_LINEAGE_RE,
} from '../../src/planes/publication-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Round 4: ONE notation. A source_lineage is a workspace-relative corpus path, repos/<Repo>/<…>.
// The cards below mirror data/kb/source-system.yaml after the round-4 data change: the upstream
// GitHub URL lives in `url:`, never in origin_prefixes or held_prefixes.
const sourceSystems = {
  'refi-bcn-old-kb': { title: 'ReFi BCN Old KB', url: 'https://github.com/refibcn/ReFi-Barcelona',
    origin_prefixes: ['repos/ReFi-Barcelona/'], public_use: 'ok-with-caveat' },
  'regenerant-catalunya': { title: 'Regenerant Catalunya', url: 'https://github.com/refibcn/Regenerant-Catalunya',
    origin_prefixes: ['repos/Regenerant-Catalunya/'],
    held_prefixes: ['repos/Regenerant-Catalunya/docs/'],
    public_use: 'ok-with-caveat' },
  'lf-work': { title: 'lf-work', url: 'https://github.com/luizfernandosg/lf-work-os', public_use: 'internal-only' },
};
const good = { type: 'resource', slug: 'x', title: 'X', maturity: 'reviewed', public_use: 'ok-with-caveat',
  source_lineage: 'repos/ReFi-Barcelona/notes/x.md' };
const ctx = (boundaries = []) => ({ sourceSystems, boundaries: buildBoundaryIndex(boundaries) });
const verdict = (patch, c = ctx()) => isPublishable({ ...good, ...patch }, c);
const withSystems = (systems, boundaries = []) => ({ sourceSystems: systems, boundaries: buildBoundaryIndex(boundaries) });

// NFC vs NFD spellings of the same two accented words. Written with explicit \uXXXX escapes,
// and ASCII-only comments describing the codepoints, so nothing on these lines depends on the
// source file's own normalisation form -- an editor, formatter or git filter that silently
// renormalised literal accented characters would otherwise collapse NFC and NFD to the same
// bytes, and every NFC-vs-NFD test below would then pass vacuously instead of failing loudly.
// The guard test immediately below checks these fixtures are still what they claim to be.
const SECCIO_NFC = 'secci\u00f3'; // 6 codepoints: "secci" + U+00F3 (precomposed o-with-acute)
const SECCIO_NFD = 'seccio\u0301'; // 7 codepoints: "seccio" (plain U+006F) + U+0301 (combining acute)
const CAFE_NFC = 'caf\u00e9'; // 4 codepoints: "caf" + U+00E9 (precomposed e-with-acute)
const CAFE_NFD = 'cafe\u0301'; // 5 codepoints: "cafe" (plain U+0065) + U+0301 (combining acute)

test('NFC/NFD fixtures are what they claim, so a renormalised source file fails loudly here rather than making every NFC-vs-NFD test below pass vacuously', () => {
  for (const [nfc, nfd] of [[SECCIO_NFC, SECCIO_NFD], [CAFE_NFC, CAFE_NFD]]) {
    assert.equal(nfc, nfc.normalize('NFC'), 'NFC fixture is not actually NFC-normalised');
    assert.equal(nfd, nfd.normalize('NFD'), 'NFD fixture is not actually NFD-normalised');
    assert.notEqual(nfc, nfd, 'NFC and NFD fixtures have collapsed to the same string');
    assert.notEqual(nfc.length, nfd.length, 'NFC and NFD fixtures no longer differ in codepoint count');
  }
});

test('a reviewed, resolvable, public object passes', () => {
  assert.deepEqual(verdict({}), { ok: true, reason: 'maturity reviewed' });
});

test('fails closed on every missing or blocking field', () => {
  assert.equal(verdict({ type: undefined }).reason, 'missing type');
  assert.equal(verdict({ maturity: 'raw' }).reason, 'maturity is raw');
  assert.equal(verdict({ maturity: undefined }).reason, 'maturity is missing');
  assert.equal(verdict({ high_risk: true }).reason, 'high_risk');
  assert.equal(verdict({ high_risk: 'yes' }).reason, 'high_risk');
  assert.equal(verdict({ public_use: 'internal_only' }).reason, 'public_use internal_only');
  assert.equal(verdict({ public_use: 'raw-lead' }).reason, 'public_use raw-lead');
  assert.equal(verdict({ source_lineage: '' }).reason, 'no source_lineage');
  assert.equal(verdict({ source_lineage: 42 }).reason, 'no source_lineage');
});

test('lineage must resolve to a registered container; sibling repos do not match', () => {
  assert.match(verdict({ source_lineage: 'https://example.com/post' }).reason, /^unresolvable source_lineage/);
  assert.match(verdict({ source_lineage: 'repos/ReFi-Barcelona-archive/x.md' }).reason, /^unresolvable source_lineage/);
  assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/content/index.md' }).ok, true);
});

test('held prefixes are refused even though the container resolves', () => {
  assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/docs/meetings/a.md' }).reason,
    'held prefix: repos/Regenerant-Catalunya/docs/');
  assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/content/index.md' }).ok, true);
});

test('an internal-only container blocks its objects', () => {
  assert.match(verdict({ source_lineage: 'repos/lf-work-os/x.md' }).reason, /is internal-only\/high_risk$/);
});

test('boundary and source-system records are never rendered, by type or by shape', () => {
  assert.match(verdict({ type: 'source-system' }).reason, /never rendered/);
  assert.match(verdict({ type: 'public-use-boundary' }).reason, /never rendered/);
  assert.match(verdict({ tier: 'public' }).reason, /^structurally a public-use-boundary/);
  assert.match(verdict({ reuse_conditions: 'x' }).reason, /^structurally a source-system/);
});

test('a never-publish boundary blocks primary and secondary lineage', () => {
  const b = [{ source_lineage: 'repos/ReFi-Barcelona/notes/x.md/', tier: ' Never_Publish Without-Consent ' }];
  assert.equal(verdict({}, ctx(b)).reason, 'boundary: never-publish-without-consent');
  const viaSecondary = { source_lineage: 'repos/ReFi-Barcelona/notes/y.md',
    additional_provenance: [{ source_lineage: 'REPOS/ReFi-Barcelona/notes/x.md' }] };
  assert.equal(verdict(viaSecondary, ctx(b)).reason, 'boundary: never-publish-without-consent');
  assert.equal(isConsentBlocked(buildBoundaryIndex(b), 'repos/ReFi-Barcelona/notes/x.md?v=1'), true);
});

test('strictest boundary wins regardless of order; unkeyable records are reported', () => {
  const recs = [{ source_lineage: 'repos/a/x.md', tier: 'public-with-caveat' },
    { source_lineage: 'repos/a/x.md', tier: 'never-publish-without-consent' }, { tier: 'public' }];
  for (const order of [recs, [...recs].reverse()]) {
    const idx = buildBoundaryIndex(order);
    assert.equal(isConsentBlocked(idx, 'repos/a/x.md'), true);
    assert.equal(idx.__unkeyable.length, 1);
  }
});

test('operator publish flag overrides maturity only', () => {
  assert.deepEqual(verdict({ maturity: 'raw', publish: true }), { ok: true, reason: 'operator publish flag' });
  assert.equal(verdict({ maturity: 'raw', publish: true, high_risk: true }).ok, false);
});

test('lineageKey and cardPrefixes', () => {
  assert.equal(lineageKey(' Repos//A/x.md/#frag '), 'repos/a/x.md');
  assert.equal(lineageKey(null), '');
  // cardPrefixes now yields corpus paths ONLY — a URL is never a prefix, only a derivation source.
  assert.deepEqual(cardPrefixes({ url: 'https://github.com/o/r' }), ['repos/r/']);
  assert.deepEqual(cardPrefixes({ url: 'https://x.org', origin_prefixes: ['a/'] }), []);
  assert.deepEqual(cardPrefixes({}), []);
  assert.deepEqual(cardPrefixes({ origin_prefixes: ['repos/ReFi-Barcelona/'] }), ['repos/refi-barcelona/']);
});

describe('one notation: a lineage is a corpus path (round 4)', () => {
  test('a URL lineage is refused as unresolvable, in every notation', () => {
    for (const url of [
      'https://github.com/refibcn/Regenerant-Catalunya/blob/main/content/index.md',
      'https://github.com/refibcn/Regenerant-Catalunya/tree/main/content',
      'https://github.com/refibcn/Regenerant-Catalunya/raw/main/content/index.md',
      'https://github.com/refibcn/Regenerant-Catalunya/blame/main/content/index.md',
      'https://github.com/refibcn/Regenerant-Catalunya',
      'https://github.com/refibcn/Regenerant-Catalunya/',
      'https://github.com/',
      'https://github.com/refibcn/ReFi-Barcelona/issues/1',
      'http://github.com/refibcn/ReFi-Barcelona/blob/main/notes/x.md',
    ]) {
      assert.match(verdict({ source_lineage: url }).reason, /^unresolvable source_lineage/, url);
    }
  });

  test('a bare repo root, or a path outside the corpus root, is refused as unresolvable', () => {
    assert.match(verdict({ source_lineage: 'repos/Regenerant-Catalunya' }).reason, /^unresolvable source_lineage/);
    assert.match(verdict({ source_lineage: 'repos/Regenerant-Catalunya/' }).reason, /^unresolvable source_lineage/);
    assert.match(verdict({ source_lineage: 'repos/Regenerant-Catalunya/docs/..' }).reason, /^unresolvable source_lineage/);
    assert.match(verdict({ source_lineage: '/Users/x/repos/ReFi-Barcelona/notes/x.md' }).reason, /^unresolvable source_lineage/);
    assert.match(verdict({ source_lineage: 'repos' }).reason, /^unresolvable source_lineage/);
    assert.match(verdict({ source_lineage: 'repos/' }).reason, /^unresolvable source_lineage/);
  });

  test('a LEADING slash still KEYS to the same document, but an object may no longer be written that way', () => {
    // lineageKey drops every empty segment, including the leading one, so `/repos/X/y.md` keys
    // identically to `repos/X/y.md` — the same document, so the same holds and the same boundaries
    // apply to it. That is still true, and control data still relies on it (see the notation-
    // robustness suite below).
    assert.equal(lineageKey('/repos/ReFi-Barcelona/notes/x.md'), lineageKey('repos/ReFi-Barcelona/notes/x.md'));
    // FINAL REVIEW (seam 2): an OBJECT's lineage is different — it is displayed, not just matched,
    // and the site buckets it by a raw lowercase prefix test. So the leading-slash spelling, which
    // used to publish, is now refused with the canonical spelling named. Expected values changed
    // here: `.ok` true -> false, and the held-prefix reason -> the non-canonical reason (the hold
    // is never reached, because nothing downstream sees a non-canonical string).
    const lead = verdict({ source_lineage: '/repos/ReFi-Barcelona/notes/x.md' });
    assert.equal(lead.ok, false);
    assert.equal(lead.reason,
      'non-canonical source_lineage: "/repos/ReFi-Barcelona/notes/x.md" — write it as "repos/ReFi-Barcelona/notes/x.md"');
    assert.equal(verdict({ source_lineage: '/repos/Regenerant-Catalunya/docs/a.md' }).reason,
      'non-canonical source_lineage: "/repos/Regenerant-Catalunya/docs/a.md" — write it as "repos/Regenerant-Catalunya/docs/a.md"');
    // …and the canonical spelling of the very same document publishes.
    assert.equal(verdict({ source_lineage: 'repos/ReFi-Barcelona/notes/x.md' }).ok, true);
  });

  test('CORPUS_PREFIX_RE and CORPUS_LINEAGE_RE are exported and describe the two shapes', () => {
    for (const ok of ['repos/x/', 'repos/ReFi-Barcelona/', 'repos/a.b-c/']) assert.ok(CORPUS_PREFIX_RE.test(ok), ok);
    for (const no of ['repos/', 'repos', 'repos/x', 'repos/x/y/', '/repos/x/', 'https://github.com/o/r/', ''])
      assert.ok(!CORPUS_PREFIX_RE.test(no), no);
    for (const ok of ['repos/x/y', 'repos/x/y/z.md', 'repos/ReFi-Barcelona/issues/x.md'])
      assert.ok(CORPUS_LINEAGE_RE.test(ok), ok);
    for (const no of ['repos/x', 'repos/x/', 'repos/', 'repos', 'x/y/z', 'https:/github.com/o/r/x', ''])
      assert.ok(!CORPUS_LINEAGE_RE.test(no), no);
    // and they agree with the functions that use them
    assert.deepEqual(cardPrefixes({ origin_prefixes: ['repos/x/', 'repos/x/y/'] }), ['repos/x/']);
    assert.equal(claimingCards('repos/ReFi-Barcelona', sourceSystems).length, 0);
    assert.equal(claimingCards('repos/ReFi-Barcelona/a.md', sourceSystems).length, 1);
  });

  test('repos/ alone is not a card prefix — a card may not claim the whole workspace', () => {
    assert.deepEqual(cardPrefixes({ origin_prefixes: ['repos/'] }), []);
    assert.deepEqual(cardPrefixes({ origin_prefixes: ['repos'] }), []);
    const greedy = { greedy: { title: 'Greedy', origin_prefixes: ['repos/'], public_use: 'ok-with-caveat' } };
    assert.deepEqual(claimingCards('repos/ReFi-Barcelona/notes/x.md', greedy), []);
    assert.match(isPublishable(good, withSystems(greedy)).reason, /^unresolvable source_lineage/);
  });

  test('a deeper-than-repo origin_prefix is not a card prefix either', () => {
    assert.deepEqual(cardPrefixes({ origin_prefixes: ['repos/Z/private/'] }), []);
  });

  test('claimingCards reports the card-relative remainder, in key space', () => {
    assert.deepEqual(claimingCards('repos/ReFi-Barcelona/Notes/X.md', sourceSystems),
      [{ slug: 'refi-bcn-old-kb', sys: sourceSystems['refi-bcn-old-kb'], path: 'notes/x.md' }]);
    assert.deepEqual(claimingCards('repos/Nope/x.md', sourceSystems), []);
    assert.deepEqual(claimingCards(42, sourceSystems), []);
    assert.deepEqual(claimingCards('repos/ReFi-Barcelona/x.md', undefined), []);
  });
});

describe('the round-3 review findings NEW-1..NEW-5', () => {
  test('NEW-1: a whole-container hold holds everything, including the repo root content', () => {
    // The URL form that used to expand to a useless ['main'] is now simply inert (validateCards
    // reports it); the hold that matters is written in the one surviving notation.
    const card = { ...sourceSystems['regenerant-catalunya'], held_prefixes: ['repos/Regenerant-Catalunya/'] };
    const c = withSystems({ ...sourceSystems, 'regenerant-catalunya': card });
    assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/content/index.md' }, c).reason,
      'held prefix: repos/Regenerant-Catalunya/');
    assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/anything.md' }, c).ok, false);
    // …and an inert URL-form whole-repo hold cannot be mistaken for a live one.
    const inert = { ...sourceSystems['regenerant-catalunya'],
      held_prefixes: ['https://github.com/refibcn/Regenerant-Catalunya/tree/main/'] };
    assert.match(validateCards({ 'regenerant-catalunya': inert })[0], /holds nothing/);
  });

  test('NEW-2: querying with {} cards first cannot poison a later query with real cards', () => {
    const b = [{ source_lineage: 'repos/Regenerant-Catalunya/content/x.md', tier: 'never-publish-without-consent' }];
    const idx = buildBoundaryIndex(b);
    // There is no card parameter and no memo any more; the index is a plain exact-key Map.
    assert.equal(isConsentBlocked(idx, 'repos/Regenerant-Catalunya/content/x.md'), true);
    assert.equal(isPublishable({ ...good, source_lineage: 'repos/Regenerant-Catalunya/content/x.md' },
      { sourceSystems: {}, boundaries: idx }).ok, false);
    assert.equal(isPublishable({ ...good, source_lineage: 'repos/Regenerant-Catalunya/content/x.md' },
      { sourceSystems, boundaries: idx }).reason, 'boundary: never-publish-without-consent');
    assert.equal(isConsentBlocked(idx, 'repos/Regenerant-Catalunya/content/x.md'), true);
  });

  test('NEW-3: an overlapping card is never skipped — both slug orders', () => {
    const strict = { title: 'Strict', origin_prefixes: ['repos/Z/'], public_use: 'internal-only' };
    const loose = { title: 'Loose', origin_prefixes: ['repos/Z/'], public_use: 'ok-with-caveat' };
    const obj = { ...good, source_lineage: 'repos/Z/a.md' };
    for (const systems of [{ strict, loose }, { loose, strict }]) {
      assert.equal(claimingCards('repos/Z/a.md', systems).length, 2);
      assert.match(isPublishable(obj, withSystems(systems)).reason, /^source-system Strict is internal-only/,
        `slug order ${Object.keys(systems).join(',')}`);
    }
  });

  test("NEW-3: a narrow card's hold is not suppressed by a broad ok card, in either order", () => {
    const holder = { title: 'Holder', origin_prefixes: ['repos/Z/'], held_prefixes: ['repos/Z/private/'],
      public_use: 'ok-with-caveat' };
    const open = { title: 'Open', origin_prefixes: ['repos/Z/'], public_use: 'ok-with-caveat' };
    const obj = { ...good, source_lineage: 'repos/Z/private/a.md' };
    for (const systems of [{ holder, open }, { open, holder }]) {
      assert.equal(isPublishable(obj, withSystems(systems)).reason, 'held prefix: repos/Z/private/',
        `slug order ${Object.keys(systems).join(',')}`);
    }
    // the unheld sibling path still publishes under both
    for (const systems of [{ holder, open }, { open, holder }]) {
      assert.equal(isPublishable({ ...good, source_lineage: 'repos/Z/public/a.md' }, withSystems(systems)).ok, true);
    }
  });

  test('NEW-4: boundaryFor has one arity and never drops a key', () => {
    const recs = [{ source_lineage: 'repos/Regenerant-Catalunya/content/x.md', tier: 'never-publish-without-consent' }];
    const idx = buildBoundaryIndex(recs);
    assert.equal(boundaryFor(idx, 'repos/Regenerant-Catalunya/content/x.md').tier, 'never-publish-without-consent');
    assert.equal(boundaryFor(recs, 'repos/Regenerant-Catalunya/content/x.md').tier, 'never-publish-without-consent');
    // extra arguments are ignored rather than switching to a different key space
    assert.equal(boundaryFor(idx, 'repos/Regenerant-Catalunya/content/x.md', sourceSystems).tier,
      'never-publish-without-consent');
    assert.equal(boundaryFor.length, 2);
    assert.equal(isConsentBlocked.length, 2);
    assert.equal(buildBoundaryIndex.length, 1);
  });

  test('NEW-5: an explicit empty or junk origin_prefixes falls back to the url, keeping holds live', () => {
    for (const origin_prefixes of [[], [42, null], ['https://github.com/refibcn/Regenerant-Catalunya/']]) {
      const card = { title: 'Regenerant Catalunya', url: 'https://github.com/refibcn/Regenerant-Catalunya',
        origin_prefixes, held_prefixes: ['repos/Regenerant-Catalunya/docs/'], public_use: 'internal-only' };
      const c = withSystems({ 'regenerant-catalunya': card });
      assert.deepEqual(cardPrefixes(card), ['repos/regenerant-catalunya/']);
      assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/docs/a.md' }, c).reason,
        'held prefix: repos/Regenerant-Catalunya/docs/');
      assert.match(verdict({ source_lineage: 'repos/Regenerant-Catalunya/content/a.md' }, c).reason,
        /is internal-only\/high_risk$/);
    }
  });
});

describe('held prefixes, cards and consent', () => {
  test('a held prefix in path form holds docs/ and nothing else', () => {
    // Canonical spellings: these reach the held check and are refused BY IT.
    assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/docs/a.md' }).reason,
      'held prefix: repos/Regenerant-Catalunya/docs/');
    assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/docs/deep/nested/a.md' }).reason,
      'held prefix: repos/Regenerant-Catalunya/docs/');
    // Case-only difference is still canonical (case is preserved for display, never compared), so
    // this one is also refused by the hold itself.
    assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/Docs/a.md' }).reason,
      'held prefix: repos/Regenerant-Catalunya/docs/');
    // FINAL REVIEW (seam 2): the four NON-CANONICAL spellings below are still refused — that is
    // what this test has always asserted and it is unchanged — but they are now refused EARLIER,
    // as non-canonical, so they no longer demonstrate the hold. They stay as regression cover for
    // "no notation trick publishes a held document"; the proof that held-matching itself is still
    // notation-robust moved to the helper suite below (heldReasonFor/isConsentBlocked/
    // claimingCards), where control data — which IS still matched in normalised space — lives.
    for (const nonCanonical of [
      'repos/Regenerant-Catalunya//docs/a.md',
      'repos/Regenerant-Catalunya/./docs/a.md',
      'repos/Regenerant-Catalunya/content/../docs/a.md',
      'repos/Regenerant-Catalunya/content/%252e%252e/docs/a.md',
    ]) {
      const r = verdict({ source_lineage: nonCanonical });
      assert.equal(r.ok, false, nonCanonical);
      assert.match(r.reason, /^non-canonical source_lineage/, nonCanonical);
      assert.ok(r.reason.includes('repos/Regenerant-Catalunya/docs/a.md'), nonCanonical);
    }
    // not held: a sibling directory whose name merely starts with the held one
    assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/docs-public/a.md' }).ok, true);
  });

  test('a container with no public_use is refused as unassessed', () => {
    const unassessed = { ...sourceSystems, 'refi-bcn-old-kb': { ...sourceSystems['refi-bcn-old-kb'], public_use: undefined } };
    assert.match(verdict({}, withSystems(unassessed)).reason, /unassessed/);
  });

  test('a container with public_use raw-lead is refused', () => {
    const rawLead = { ...sourceSystems, 'refi-bcn-old-kb': { ...sourceSystems['refi-bcn-old-kb'], public_use: 'raw-lead' } };
    assert.match(verdict({}, withSystems(rawLead)).reason, /is internal-only\/high_risk$/);
  });

  test('a source-system card flagged high_risk blocks its objects', () => {
    const risky = { ...sourceSystems, 'refi-bcn-old-kb': { ...sourceSystems['refi-bcn-old-kb'], high_risk: true } };
    assert.match(verdict({}, withSystems(risky)).reason, /is internal-only\/high_risk$/);
  });

  test('consent blocks via the primary lineage and via every additional_provenance shape', () => {
    const b = [{ source_lineage: 'repos/Regenerant-Catalunya/content/secret.md', tier: 'never-publish-without-consent' }];
    const c = ctx(b);
    const blocked = 'repos/Regenerant-Catalunya/content/secret.md';
    assert.equal(verdict({ source_lineage: blocked }, c).reason, 'boundary: never-publish-without-consent');
    for (const ap of [
      [blocked],
      [{ source_lineage: blocked }],
      [{ origin: blocked }],
      [{ lineage: blocked }],
      [{ url: blocked }],
      { source_lineage: blocked },
    ]) {
      assert.equal(verdict({ additional_provenance: ap }, c).reason, 'boundary: never-publish-without-consent',
        JSON.stringify(ap));
    }
  });

  test('a held_prefixes entry in NFD holds a lineage in NFC, and vice versa', () => {
    const nfdHeld = withSystems({ acc: { title: 'Accented', origin_prefixes: ['repos/Accented/'],
      held_prefixes: [`repos/Accented/${SECCIO_NFD}/`], public_use: 'ok-with-caveat' } });
    const viaNfc = isPublishable({ ...good, source_lineage: `repos/Accented/${SECCIO_NFC}/a.md` }, nfdHeld);
    assert.equal(viaNfc.ok, false);
    assert.match(viaNfc.reason, /^held prefix:/);

    const nfcHeld = withSystems({ acc: { title: 'Accented', origin_prefixes: ['repos/Accented/'],
      held_prefixes: [`repos/Accented/${SECCIO_NFC}/`], public_use: 'ok-with-caveat' } });
    const viaNfd = isPublishable({ ...good, source_lineage: `repos/Accented/${SECCIO_NFD}/a.md` }, nfcHeld);
    assert.equal(viaNfd.ok, false);
    assert.match(viaNfd.reason, /^held prefix:/);
  });

  test('a consent boundary recorded in NFD blocks an object whose lineage is NFC, and vice versa', () => {
    const bNfd = [{ source_lineage: `repos/Accented/${SECCIO_NFD}/x.md`, tier: 'never-publish-without-consent' }];
    assert.equal(verdict({ source_lineage: `repos/Accented/${SECCIO_NFC}/x.md` }, ctx(bNfd)).reason,
      'boundary: never-publish-without-consent');
    const bNfc = [{ source_lineage: `repos/Accented/${SECCIO_NFC}/x.md`, tier: 'never-publish-without-consent' }];
    assert.equal(verdict({ source_lineage: `repos/Accented/${SECCIO_NFD}/x.md` }, ctx(bNfc)).reason,
      'boundary: never-publish-without-consent');
  });

  test('every additional_provenance shape is also checked for holds and resolution', () => {
    assert.equal(verdict({ additional_provenance: ['repos/Regenerant-Catalunya/docs/a.md'] }).ok, false);
    assert.equal(verdict({ additional_provenance: [{ lineage: 'repos/Regenerant-Catalunya/docs/a.md' }] }).ok, false);
    assert.equal(verdict({ additional_provenance: [{ url: 'repos/Regenerant-Catalunya/docs/a.md' }] }).ok, false);
    assert.equal(verdict({ additional_provenance: { source_lineage: 'repos/Regenerant-Catalunya/docs/a.md' } }).ok, false);
    assert.match(verdict({ additional_provenance: ['https://github.com/refibcn/ReFi-Barcelona/blob/main/x.md'] }).reason,
      /^unresolvable source_lineage/);
  });
});

describe('malformed control data fails the card closed (round 5)', () => {
  const rc = (held_prefixes) => ({ 'regenerant-catalunya': {
    title: 'Regenerant Catalunya', origin_prefixes: ['repos/Regenerant-Catalunya/'],
    held_prefixes, public_use: 'ok-with-caveat' } });
  const held = 'repos/Regenerant-Catalunya/docs/';
  const target = { source_lineage: 'repos/Regenerant-Catalunya/docs/a.md' };
  const other = { source_lineage: 'repos/Regenerant-Catalunya/content/index.md' };

  test('a held_prefixes that is a string (the dropped "- ") refuses everything the card claims', () => {
    const c = withSystems(rc(held));
    assert.equal(verdict(target, c).reason, 'source-system Regenerant Catalunya has malformed held_prefixes');
    // not just the intended path — the whole card, because its control cannot be read
    assert.equal(verdict(other, c).reason, 'source-system Regenerant Catalunya has malformed held_prefixes');
    assert.match(validateCards(rc(held)).join('\n'), /held_prefixes is present but nothing in it holds anything/);
  });

  test('other present-but-unreadable held_prefixes shapes refuse the same way', () => {
    for (const bad of [held, 42, {}, [42, null], [''], ['   '], ['https://github.com/refibcn/Regenerant-Catalunya/blob/main/docs/'],
      ['repos/SomeOtherRepo/docs/'], ['repos/Regenerant-Catalunya/docs/**']]) {
      const c = withSystems(rc(bad));
      assert.equal(verdict(other, c).reason, 'source-system Regenerant Catalunya has malformed held_prefixes',
        JSON.stringify(bad));
      assert.ok(validateCards(rc(bad)).length > 0, JSON.stringify(bad));
    }
  });

  test('absent and explicitly-empty held_prefixes legitimately hold nothing', () => {
    for (const fine of [undefined, null, []]) {
      const c = withSystems(rc(fine));
      assert.equal(verdict(other, c).ok, true, JSON.stringify(fine));
      assert.equal(verdict(target, c).ok, true, JSON.stringify(fine));
      assert.deepEqual(validateCards(rc(fine)), []);
    }
  });

  test('one live entry among dead ones keeps the card readable; the dead ones are still reported', () => {
    const mixed = rc(['repos/Regenerant-Catalunya/docs/**', 42, held]);
    const c = withSystems(mixed);
    assert.equal(verdict(target, c).reason, `held prefix: ${held}`);
    assert.equal(verdict(other, c).ok, true);
    const errs = validateCards(mixed);
    assert.equal(errs.length, 2);
    assert.match(errs[0], /contains a glob/);
    assert.match(errs[1], /is not a non-empty string/);
  });

  test('a glob entry is inert and reported, never a silent hold', () => {
    const globbed = rc(['repos/Regenerant-Catalunya/docs/**', held]);
    assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/docs/**/x.md' }, withSystems(globbed)).reason,
      `held prefix: ${held}`);
    assert.match(validateCards(globbed)[0], /contains a glob — \* is not supported/);
  });
});

describe('boundaries name one document, exactly (round 5)', () => {
  test('an inert URL-notation boundary is never indexed, lands in __unkeyable, and is reported', () => {
    const recs = [{ source_lineage: 'https://github.com/refibcn/Regenerant-Catalunya/blob/main/content/secret.md',
      tier: 'never-publish-without-consent' }];
    const idx = buildBoundaryIndex(recs);
    assert.equal(idx.size, 0);
    assert.equal(idx.__unkeyable.length, 1);
    assert.equal(isConsentBlocked(idx, 'repos/Regenerant-Catalunya/content/secret.md'), false);
    assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/content/secret.md' }, ctx(recs)).ok, true);
    // …and the pairing is the point: the abandoned notation is inert AND loud.
    assert.equal(validateBoundaries(recs).length, 1);
    assert.match(validateBoundaries(recs)[0], /is not corpus-path form/);
  });

  test('a directory-shaped boundary does not cover the documents under it, and is reported', () => {
    const recs = [{ source_lineage: 'repos/Regenerant-Catalunya/content/', tier: 'never-publish-without-consent' }];
    assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/content/x.md' }, ctx(recs)).ok, true);
    assert.match(validateBoundaries(recs)[0], /ends in \/ — a boundary names one document/);
    // to hold a directory back you use a card's held_prefixes, which IS prefix-shaped
    const card = { ...sourceSystems['regenerant-catalunya'], held_prefixes: ['repos/Regenerant-Catalunya/content/'] };
    assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/content/x.md' },
      withSystems({ ...sourceSystems, 'regenerant-catalunya': card })).ok, false);
  });

  test('validateBoundaries reports missing, non-corpus and directory-shaped lineages', () => {
    assert.deepEqual(validateBoundaries([]), []);
    assert.deepEqual(validateBoundaries(undefined), []);
    assert.deepEqual(validateBoundaries([{ source_lineage: 'repos/RC/content/x.md', tier: 'public' }]), []);

    const missing = validateBoundaries([{ tier: 'public' }, { source_lineage: 42 }, { source_lineage: '   ' }]);
    assert.equal(missing.length, 3);
    for (const e of missing) assert.match(e, /no usable source_lineage/);
    assert.match(missing[0], /^boundary record #0:/);

    const notCorpus = validateBoundaries([{ source_lineage: 'repos/RC' }, { source_lineage: 'https://x.org/a' },
      { source_lineage: 'notes/x.md' }]);
    assert.equal(notCorpus.length, 3);
    for (const e of notCorpus) assert.match(e, /must be repos\/<Repo>\/<path>/);

    // a URL ending in / is both non-corpus and directory-shaped — both are said
    const both = validateBoundaries([{ source_lineage: 'https://github.com/refibcn/RC/tree/main/docs/' }]);
    assert.equal(both.length, 2);

    const byKey = validateBoundaries({ 'my-slug': { source_lineage: 'repos/RC/content/', tier: 'public' } });
    assert.equal(byKey.length, 1);
    assert.match(byKey[0], /^boundary record my-slug:/);
    // the object-keyed-by-lineage shape is validated through its key too
    assert.match(validateBoundaries({ 'https://x.org/a': { tier: 'public' } })[0], /is not corpus-path form/);
  });

  test('a live corpus-path boundary still blocks, and a trailing slash on it still keys', () => {
    const recs = [{ source_lineage: 'repos/ReFi-Barcelona/notes/x.md', tier: 'never-publish-without-consent' }];
    assert.equal(verdict({}, ctx(recs)).reason, 'boundary: never-publish-without-consent');
    assert.deepEqual(validateBoundaries(recs), []);
  });
});

describe('the owner is discarded by design; safety rests on assessing every claiming card', () => {
  test('same-named repos under different owners collapse to one prefix — and the strict card wins, both orders', () => {
    const a = { title: 'A', url: 'https://github.com/a/notes', public_use: 'ok-with-caveat' };
    const b = { title: 'B', url: 'https://github.com/b/notes', public_use: 'internal-only' };
    assert.deepEqual(cardPrefixes(a), ['repos/notes/']);
    assert.deepEqual(cardPrefixes(b), ['repos/notes/']);
    const obj = { ...good, source_lineage: 'repos/notes/secret.md' };
    for (const systems of [{ a, b }, { b, a }]) {
      assert.equal(claimingCards('repos/notes/secret.md', systems).length, 2);
      assert.equal(isPublishable(obj, withSystems(systems)).reason, 'source-system B is internal-only/high_risk',
        `slug order ${Object.keys(systems).join(',')}`);
    }
  });

  test('a hold on either same-prefix card holds the path, both orders', () => {
    const a = { title: 'A', url: 'https://github.com/a/notes', public_use: 'ok-with-caveat' };
    const b = { title: 'B', url: 'https://github.com/b/notes', public_use: 'ok-with-caveat',
      held_prefixes: ['repos/notes/private/'] };
    const obj = { ...good, source_lineage: 'repos/notes/private/x.md' };
    for (const systems of [{ a, b }, { b, a }]) {
      assert.equal(isPublishable(obj, withSystems(systems)).reason, 'held prefix: repos/notes/private/',
        `slug order ${Object.keys(systems).join(',')}`);
    }
  });
});

describe('validateCards', () => {
  test('reports a zero-prefix card, an inert held entry, a URL origin_prefix and a repos/-only prefix', () => {
    const noPrefix = validateCards({ nope: { title: 'Nope', url: 'https://example.com/x', public_use: 'ok-with-caveat' } });
    assert.equal(noPrefix.length, 1);
    assert.match(noPrefix[0], /no corpus-path prefix/);
    assert.match(noPrefix[0], /url:/);

    const inertHeld = validateCards({ rc: { origin_prefixes: ['repos/RC/'],
      held_prefixes: ['https://github.com/refibcn/RC/blob/main/docs/', 'repos/Other/docs/', 42,
        'repos/RC/docs/'] } });
    assert.equal(inertHeld.length, 3);
    for (const e of inertHeld) assert.match(e, /held_prefixes entry .* holds nothing$/);

    const urlOrigin = validateCards({ rc: { origin_prefixes: ['https://github.com/refibcn/RC/', 'repos/RC/'] } });
    assert.equal(urlOrigin.length, 1);
    assert.match(urlOrigin[0], /origin_prefixes entry .* is not a corpus path/);

    const reposOnly = validateCards({ rc: { origin_prefixes: ['repos/'] } });
    assert.equal(reposOnly.length, 2);
    assert.match(reposOnly[0], /is not a corpus path/);
    assert.match(reposOnly[1], /no corpus-path prefix/);

    const notALists = validateCards({ rc: { origin_prefixes: 'repos/RC/', held_prefixes: 'repos/RC/docs/' } });
    assert.deepEqual(notALists.map((e) => e.replace(/^source-system rc: /, '').split(' —')[0]), [
      'origin_prefixes must be a list of repos/<Repo>/ paths',
      'no corpus-path prefix',
      'held_prefixes entry "repos/RC/docs/" is not a list',
      'held_prefixes is present but nothing in it holds anything',
    ]);

    assert.deepEqual(validateCards({}), []);
    assert.deepEqual(validateCards(undefined), []);
  });

  // LD-2026-009 amendment: contract §7 asks for a card per provider (ICGC, XES…), and a provider has no
  // repo of its own. Such a card is descriptive only — it must never look like a live control.
  test('a provider card is exempt from the prefix rule, and may carry no control that would hold nothing', () => {
    const provider = { title: 'ICGC', container_role: 'provider', url: 'https://www.icgc.cat/', public_use: 'ok-with-caveat' };
    assert.deepEqual(validateCards({ icgc: provider }), []);

    const container = { origin_prefixes: ['repos/rc-field-sources/'] };
    assert.deepEqual(claimingCards('repos/rc-field-sources/icgc/divisions/extract.md', { icgc: provider }), []);
    assert.deepEqual(
      claimingCards('repos/rc-field-sources/icgc/divisions/extract.md', { icgc: provider, 'rc-field-sources': container })
        .map((c) => c.slug), ['rc-field-sources']);

    assert.match(validateCards({ icgc: { ...provider, url: undefined } })[0], /provider card needs a url/);
    assert.match(validateCards({ icgc: { ...provider, url: '  ' } })[0], /provider card needs a url/);
    assert.match(validateCards({ icgc: { ...provider, origin_prefixes: ['repos/rc-field-sources/'] } })[0],
      /provider card must not carry origin_prefixes/);
    assert.match(validateCards({ icgc: { ...provider, held_prefixes: ['repos/rc-field-sources/icgc/'] } })[0],
      /provider card must not carry held_prefixes .* container card/);
    for (const pu of ['internal-only', 'raw_lead', 'Internal Only']) {
      assert.match(validateCards({ icgc: { ...provider, public_use: pu } })[0],
        /provider card's public_use .* holds nothing .* container card/, pu);
    }
    // a GitHub url would make cardPrefixes() derive a claim — a provider card must claim nothing
    assert.match(validateCards({ gh: { ...provider, url: 'https://github.com/refibcn/ReFi-Barcelona' } })[0],
      /provider card's url derives a corpus prefix/);
    // the role is an exact word, not a loophole: anything else is still a zero-prefix card
    assert.match(validateCards({ x: { ...provider, container_role: 'providers' } })[0], /no corpus-path prefix/);
  });

  test('one provider is held back on the container card, by a sub-path of its prefix', () => {
    const cards = { 'rc-field-sources': { origin_prefixes: ['repos/rc-field-sources/'],
      held_prefixes: ['repos/rc-field-sources/pam-a-pam/'] } };
    assert.deepEqual(validateCards(cards), []);
    assert.match(heldReasonFor('repos/rc-field-sources/pam-a-pam/mapa/extract.md', cards), /held prefix/);
    assert.equal(heldReasonFor('repos/rc-field-sources/icgc/divisions/extract.md', cards), null);
  });
});

describe('lineageKey', () => {
  test('is idempotent over a variety of inputs', () => {
    const inputs = [
      'repos/a/%2525',
      'repos/a/%252e%252e/b',
      'a/b%23c/d',
      'https://github.com/refibcn/Regenerant-Catalunya/blob/main/content/index.md',
      'repos/ReFi-Barcelona/notes/x.md',
      '',
      ' Repos//A/x.md/#frag ',
      'a/./b/./c',
      'a/b/../../c',
      '%2e%2e/x',
      'https://x.org/a/../b',
      'repos/Regenerant-Catalunya/docs/../content/x.md',
      'repos/A/b?query=1#frag',
      'REPOS/A///B/',
      '../../etc/passwd',
      'repos/a/%20b/c',
      // Unicode normalisation cases: NFD, NFC, percent-encoded NFD, and mixed-case accented.
      `repos/Accented/${SECCIO_NFD}/a.md`,
      `repos/Accented/${SECCIO_NFC}/a.md`,
      `repos/Accented/${encodeURIComponent(SECCIO_NFD)}/a.md`,
      `REPOS/Accented/${CAFE_NFC.toUpperCase()}/X.MD`,
    ];
    for (const x of inputs) {
      const once = lineageKey(x);
      assert.equal(lineageKey(once), once, `not idempotent for ${JSON.stringify(x)}`);
    }
  });

  test('NFC and NFD spellings of the same path — including percent-encoded NFD — key identically', () => {
    const nfc = `repos/Accented/${SECCIO_NFC}/a.md`;
    const nfd = `repos/Accented/${SECCIO_NFD}/a.md`;
    const percentEncodedNfd = `repos/Accented/${encodeURIComponent(SECCIO_NFD)}/a.md`;
    assert.equal(lineageKey(nfc), lineageKey(nfd));
    assert.equal(lineageKey(nfc), lineageKey(percentEncodedNfd));
    assert.ok(lineageKey(nfc).length > 0);
  });

  test('normalisation does not strip accents: café and cafe stay different keys', () => {
    assert.notEqual(lineageKey(`repos/a/${CAFE_NFC}.md`), lineageKey('repos/a/cafe.md'));
    assert.notEqual(lineageKey(`repos/a/${CAFE_NFD}.md`), lineageKey('repos/a/cafe.md'));
  });

  test('fails closed on malformed encoding, null bytes and escapes past the root', () => {
    assert.equal(lineageKey('repos/a/%'), '');
    assert.equal(lineageKey('repos/a/%2525'), '');
    assert.equal(lineageKey(`repos/a/${String.fromCharCode(0)}b`), '');
    assert.equal(lineageKey('../x'), '');
    assert.equal(lineageKey(42), '');
    // `..` that stays within the string resolves normally; it only fails closed when it pops past
    // the start. Escaping the corpus this way lands outside repos/<Repo>/ and is then unresolvable.
    assert.equal(lineageKey('repos/a/../../x'), 'x');
    assert.match(verdict({ source_lineage: 'repos/ReFi-Barcelona/../../etc/passwd' }).reason,
      /^unresolvable source_lineage/);
    // FINAL REVIEW (seam 2): this one resolves BACK INTO the corpus (repos/Other/x.md), so it is
    // now caught one step earlier, as a non-canonical spelling rather than as an unresolvable one.
    // Expected value changed: /^unresolvable source_lineage/ -> /^non-canonical source_lineage/.
    // Still refused either way; the new reason additionally names what it would have resolved to,
    // which is the more useful thing to see for a `..` that quietly hops containers.
    assert.match(verdict({ source_lineage: 'repos/ReFi-Barcelona/notes/../../Other/x.md' }).reason,
      /^non-canonical source_lineage/);
    assert.equal(verdict({ source_lineage: 'repos/ReFi-Barcelona/notes/../../Other/x.md' }).reason,
      'non-canonical source_lineage: "repos/ReFi-Barcelona/notes/../../Other/x.md" — write it as "repos/Other/x.md"');
  });
});

describe('branch coverage', () => {
  test('boundaryFor accepts a prebuilt Map or a raw records shape, and fails closed on empty lineage', () => {
    const recs = [{ source_lineage: 'repos/a/x.md', tier: 'public-with-caveat' }];
    const idx = buildBoundaryIndex(recs);
    assert.equal(boundaryFor(idx, 'repos/a/x.md').tier, 'public-with-caveat');
    assert.equal(boundaryFor(recs, 'repos/a/x.md').tier, 'public-with-caveat');
    assert.equal(boundaryFor(idx, ''), null);
    assert.equal(boundaryFor(idx, 'repos/a/nope.md'), null);
    assert.equal(isConsentBlocked(recs, 'repos/a/x.md'), false);
    assert.equal(isConsentBlocked(idx, ''), false);
  });

  test('trimLineage trims, drops trailing slashes, and fails closed on non-strings', () => {
    assert.equal(trimLineage('  a/b/  '), 'a/b');
    assert.equal(trimLineage(42), '');
    assert.equal(trimLineage(null), '');
  });

  test('allLineages dedups and supports the origin fallback key', () => {
    const obj = { source_lineage: 'repos/a/x.md',
      additional_provenance: [{ origin: 'repos/a/x.md' }, { origin: 'repos/a/y.md' }] };
    assert.deepEqual(allLineages(obj), ['repos/a/x.md', 'repos/a/y.md']);
    assert.deepEqual(allLineages(undefined), []);
    assert.deepEqual(allLineages({ source_lineage: 'repos/a/x.md', additional_provenance: 'nope' }), ['repos/a/x.md']);
  });

  test('NEVER_RENDERED_TYPES lists the boundary and source-system types', () => {
    assert.deepEqual(NEVER_RENDERED_TYPES, ['public-use-boundary', 'source-system']);
  });

  test('buildBoundaryIndex accepts an object keyed by slug or by lineage', () => {
    const bySlug = buildBoundaryIndex({ mySlug: { source_lineage: 'repos/a/x.md', tier: 'never-publish-without-consent' } });
    assert.equal(isConsentBlocked(bySlug, 'repos/a/x.md'), true);
    const byLineageKey = buildBoundaryIndex({ 'repos/a/x.md': { tier: 'never-publish-without-consent' } });
    assert.equal(isConsentBlocked(byLineageKey, 'repos/a/x.md'), true);
    assert.equal(buildBoundaryIndex(undefined).size, 0);
  });

  test('a high_risk value of the string "false" is not flagged', () => {
    assert.equal(verdict({ high_risk: 'false' }).ok, true);
  });

  test('an object shaped like a source-system card (what_it_curates) is never rendered', () => {
    assert.match(verdict({ what_it_curates: 'x' }).reason, /^structurally a source-system/);
  });

  test('isPublishable never throws', () => {
    const hostile = { get type() { throw new Error('boom'); } };
    const r = isPublishable(hostile, ctx());
    assert.equal(r.ok, false);
    assert.match(r.reason, /^gate error/);
    assert.equal(isPublishable(undefined, undefined).ok, false);
    assert.equal(isPublishable(null, null).reason, 'missing type');
    assert.equal(isPublishable(good, { sourceSystems: null, boundaries: null }).reason,
      'unresolvable source_lineage: repos/ReFi-Barcelona/notes/x.md');
  });

  test('sanity: the set that must still publish', () => {
    assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/content/index.md' }).ok, true);
    assert.equal(verdict({ source_lineage: 'repos/ReFi-Barcelona/notes/x.md' }).ok, true);
    // a real directory named like a GitHub web-UI route — no route classification exists any more
    assert.equal(verdict({ source_lineage: 'repos/ReFi-Barcelona/issues/x.md' }).ok, true);
    assert.equal(verdict({ source_lineage: 'repos/ReFi-Barcelona/blob/main/x.md' }).ok, true);
    assert.equal(verdict({ source_lineage: 'repos/ReFi-Barcelona/wiki/x.md' }).ok, true);
  });
});

// ── FINAL WHOLE-BRANCH REVIEW ────────────────────────────────────────────────
// Two seams the per-task reviews could not see, because each lives half in the gate and half in
// the site: provenance.origin was never gated though it is displayed FIRST, and a non-canonical
// lineage passed the gate and was then mis-bucketed by the site.

describe('seam 1: provenance.origin and provenance.adapted_from are lineages', () => {
  test('a clean source_lineage does not excuse a HELD provenance.origin', () => {
    const r = verdict({ source_lineage: 'repos/Regenerant-Catalunya/content/a.md',
      provenance: { origin: 'repos/Regenerant-Catalunya/docs/minutes-secret.md' } });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'held prefix: repos/Regenerant-Catalunya/docs/');
  });

  test('a HELD provenance.origin under a second held prefix is refused too', () => {
    const card = { ...sourceSystems['regenerant-catalunya'],
      held_prefixes: ['repos/Regenerant-Catalunya/docs/', 'repos/Regenerant-Catalunya/content/ca/internal/'] };
    const c = withSystems({ ...sourceSystems, 'regenerant-catalunya': card });
    assert.equal(isPublishable({ ...good, source_lineage: 'repos/Regenerant-Catalunya/content/a.md',
      provenance: { origin: 'repos/Regenerant-Catalunya/content/ca/internal/x.md' } }, c).reason,
      'held prefix: repos/Regenerant-Catalunya/content/ca/internal/');
  });

  test('an UNREGISTERED provenance.origin is refused as unresolvable', () => {
    const r = verdict({ source_lineage: 'repos/Regenerant-Catalunya/content/a.md',
      provenance: { origin: 'repos/refi-bcn-os/data/crm/private.md' } });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unresolvable source_lineage: repos/refi-bcn-os/data/crm/private.md');
  });

  test('provenance.adapted_from pointing at held material refuses', () => {
    assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/content/a.md',
      provenance: { origin: 'repos/Regenerant-Catalunya/content/a.md',
        adapted_from: 'repos/Regenerant-Catalunya/docs/prior.md' } }).reason,
      'held prefix: repos/Regenerant-Catalunya/docs/');
  });

  test('a provenance.origin EQUAL to source_lineage still publishes (dedup)', () => {
    const lineage = 'repos/Regenerant-Catalunya/content/a.md';
    assert.deepEqual(allLineages({ source_lineage: lineage, provenance: { origin: lineage } }), [lineage]);
    assert.equal(verdict({ source_lineage: lineage, provenance: { origin: lineage } }).ok, true);
  });

  test('a consent boundary on provenance.origin alone blocks', () => {
    const b = [{ source_lineage: 'repos/Regenerant-Catalunya/content/secret.md', tier: 'never-publish-without-consent' }];
    assert.equal(verdict({ source_lineage: 'repos/Regenerant-Catalunya/content/a.md',
      provenance: { origin: 'repos/Regenerant-Catalunya/content/secret.md' } }, ctx(b)).reason,
      'boundary: never-publish-without-consent');
  });

  test('allLineages yields source_lineage, provenance.origin, provenance.adapted_from, then additional_provenance — deduped, in order', () => {
    assert.deepEqual(allLineages({
      source_lineage: 'repos/a/1.md',
      provenance: { origin: 'repos/a/2.md', adapted_from: 'repos/a/3.md', surfaced_by: 'someone' },
      additional_provenance: [{ origin: 'repos/a/4.md' }, 'repos/a/1.md'],
    }), ['repos/a/1.md', 'repos/a/2.md', 'repos/a/3.md', 'repos/a/4.md']);
    // a list-valued origin/adapted_from (defensive: the schema says string) is read entry by entry
    assert.deepEqual(allLineages({ source_lineage: 'repos/a/1.md',
      provenance: { origin: ['repos/a/2.md', 'repos/a/3.md'] } }),
      ['repos/a/1.md', 'repos/a/2.md', 'repos/a/3.md']);
    // a non-object provenance is ignored rather than throwing
    assert.deepEqual(allLineages({ source_lineage: 'repos/a/1.md', provenance: 'nope' }), ['repos/a/1.md']);
    assert.deepEqual(allLineages({ source_lineage: 'repos/a/1.md', provenance: null }), ['repos/a/1.md']);
  });

  test('`url` is deliberately NOT a lineage: an external link never gates the object, and never displaces a real lineage', () => {
    // An object may legitimately link a site it does not claim as a source. Gating `url` would
    // refuse it for citing a page.
    assert.equal(verdict({ url: 'https://example.com/post' }).ok, true);
    assert.equal(verdict({ url: 'repos/Regenerant-Catalunya/docs/a.md' }).ok, true);
    assert.ok(!allLineages({ source_lineage: 'repos/a/1.md', url: 'https://example.com/post' })
      .includes('https://example.com/post'));
    // And the site agrees: its origin chain is provenance.origin -> source_lineage -> url, so url
    // is only ever read as provenance when NEITHER of the other two is set. (Mirrored here so the
    // premise is asserted, not just asserted about — see repos/…/src/lib/kb.mjs loadKb/originKey
    // and components/ProvenanceBlock.astro.)
    const siteOrigin = (o) => o?.provenance?.origin || o?.source_lineage || o?.url || '';
    assert.equal(siteOrigin({ provenance: { origin: 'repos/a/1.md' }, source_lineage: 'repos/a/2.md', url: 'https://x' }), 'repos/a/1.md');
    assert.equal(siteOrigin({ source_lineage: 'repos/a/2.md', url: 'https://x' }), 'repos/a/2.md');
    assert.equal(siteOrigin({ url: 'https://x' }), 'https://x');
  });
});

describe('seam 2: an object lineage must already be written canonically', () => {
  const REPROS = [
    ['/repos/Regenerant-Catalunya/content/d.md', 'repos/Regenerant-Catalunya/content/d.md'],
    ['repos//Regenerant-Catalunya/content/d.md', 'repos/Regenerant-Catalunya/content/d.md'],
    ['./repos/Regenerant-Catalunya/content/d.md', 'repos/Regenerant-Catalunya/content/d.md'],
    ['repos/Regenerant%2DCatalunya/content/d.md', 'repos/Regenerant-Catalunya/content/d.md'],
    ['repos/ReFi-Barcelona/../Regenerant-Catalunya/content/e.md', 'repos/Regenerant-Catalunya/content/e.md'],
  ];

  test('all five spellings that used to pass are refused, each naming its canonical form', () => {
    for (const [raw, canonical] of REPROS) {
      const r = verdict({ source_lineage: raw });
      assert.equal(r.ok, false, raw);
      assert.equal(r.reason, `non-canonical source_lineage: ${JSON.stringify(raw)} — write it as ${JSON.stringify(canonical)}`, raw);
    }
  });

  test('the canonical spelling of each of those documents publishes', () => {
    for (const [, canonical] of REPROS) assert.equal(verdict({ source_lineage: canonical }).ok, true, canonical);
  });

  test('case is PRESERVED, never forced: repos/ReFi-Barcelona/… is canonical as written', () => {
    assert.equal(verdict({ source_lineage: 'repos/ReFi-Barcelona/notes/x.md' }).ok, true);
    assert.equal(verdict({ source_lineage: 'repos/ReFi-Barcelona/Notes/X.md' }).ok, true);
    assert.equal(verdict({ source_lineage: 'REPOS/ReFi-Barcelona/notes/x.md' }).ok, true);
    assert.equal(canonicalLineage('repos/ReFi-Barcelona/notes/x.md'), 'repos/ReFi-Barcelona/notes/x.md');
    assert.notEqual(canonicalLineage('repos/ReFi-Barcelona/notes/x.md'), lineageKey('repos/ReFi-Barcelona/notes/x.md'));
  });

  test('the check applies to EVERY lineage, not just the primary', () => {
    assert.match(verdict({ provenance: { origin: '/repos/Regenerant-Catalunya/content/d.md' } }).reason,
      /^non-canonical source_lineage/);
    assert.match(verdict({ provenance: { adapted_from: './repos/Regenerant-Catalunya/content/d.md' } }).reason,
      /^non-canonical source_lineage/);
    assert.match(verdict({ additional_provenance: [{ lineage: 'repos//Regenerant-Catalunya/content/d.md' }] }).reason,
      /^non-canonical source_lineage/);
  });

  test('the check runs BEFORE consent and before container assessment, so nothing downstream sees a non-canonical string', () => {
    const b = [{ source_lineage: 'repos/ReFi-Barcelona/notes/x.md', tier: 'never-publish-without-consent' }];
    assert.match(verdict({ source_lineage: '/repos/ReFi-Barcelona/notes/x.md' }, ctx(b)).reason,
      /^non-canonical source_lineage/);
    // …but AFTER "no source_lineage", so an empty lineage still says the simpler thing
    assert.equal(verdict({ source_lineage: '' }).reason, 'no source_lineage');
  });

  test('a lineage that is unresolvable in ANY spelling keeps the accurate reason', () => {
    // Telling an operator to write a URL as "https:/github.com/…" would be advice to write
    // something equally unusable, so these fall through to the unresolvable refusal.
    for (const raw of ['https://github.com/refibcn/Regenerant-Catalunya/blob/main/a.md',
      'repos/Regenerant-Catalunya/', 'repos/Regenerant-Catalunya', 'notes/x.md',
      '/Users/x/repos/ReFi-Barcelona/notes/x.md', 'repos/ReFi-Barcelona/../../etc/passwd']) {
      assert.match(verdict({ source_lineage: raw }).reason, /^unresolvable source_lineage/, raw);
    }
  });

  test('a "?" or "#" in a real filename is refused with its OWN reason, never with truncating advice', () => {
    // Not hypothetical: `repos/ReFi-Barcelona/content/02-ecosystem/bioregional/case-studies/What is
    // BioFi?.md` and `…/What is a BFF?.md` are real files in the live corpus, and the selector
    // emits both. lineageKey strips from the first '?', so the key is a truncated, DIFFERENT
    // document — suggesting that truncation as "the canonical spelling" would be advice to record
    // a lineage naming a file that does not exist.
    const real = 'repos/ReFi-Barcelona/content/02-ecosystem/bioregional/case-studies/What is BioFi?.md';
    const r = verdict({ source_lineage: real });
    assert.equal(r.ok, false);
    assert.match(r.reason, /contains "\?" or "#", which the lineage key truncates/);
    assert.ok(r.reason.includes(real));
    assert.ok(!r.reason.includes('write it as'), 'must not suggest the truncated form as the fix');
    assert.match(verdict({ source_lineage: 'repos/ReFi-Barcelona/notes/x.md#frag' }).reason, /truncates/);
    // the underlying lineageKey truncation is UNCHANGED — this check surfaces it, it does not fix it
    assert.equal(lineageKey(real), 'repos/refi-barcelona/content/02-ecosystem/bioregional/case-studies/what is biofi');
  });

  test('canonicalLineage is lineageKey with case kept, and fails closed identically', () => {
    for (const raw of ['repos/a/%', 'repos/a/%2525', '../x', 42, null, `repos/a/${String.fromCharCode(0)}b`]) {
      assert.equal(canonicalLineage(raw), '', JSON.stringify(raw));
      assert.equal(lineageKey(raw), '', JSON.stringify(raw));
    }
    for (const raw of [' Repos//A/x.md/#frag ', 'repos/Regenerant-Catalunya/docs/../content/x.md',
      `repos/Accented/${SECCIO_NFD}/a.md`, `repos/Accented/${encodeURIComponent(SECCIO_NFD)}/a.md`]) {
      assert.equal(canonicalLineage(raw).toLowerCase(), lineageKey(raw), raw);
      assert.equal(canonicalLineage(canonicalLineage(raw)), canonicalLineage(raw), raw);
    }
    // an NFD lineage is canonicalised to NFC — it is the same document, spelled the way the gate
    // and the page both compare
    assert.equal(canonicalLineage(`repos/Accented/${SECCIO_NFD}/a.md`), `repos/Accented/${SECCIO_NFC}/a.md`);
  });
});

describe('seam 2 knock-on: CONTROL DATA matching stays notation-robust', () => {
  // Object lineages are strict now. Control data — held_prefixes, boundary records, card prefixes
  // — is NOT: it is matched, never displayed, and a hold that stops working because an operator
  // wrote a doubled slash is a safety failure, not a lint. These assert the helpers directly,
  // which is where the notation-robustness the gate tests above used to prove now lives.
  const heldSystems = { rc: { title: 'RC', origin_prefixes: ['repos/Regenerant-Catalunya/'],
    held_prefixes: ['repos/Regenerant-Catalunya/docs/'], public_use: 'ok-with-caveat' } };

  test('heldReasonFor holds a non-canonically-spelled path, and a non-canonically-spelled held_prefixes entry still holds', () => {
    for (const raw of [
      'repos/Regenerant-Catalunya/docs/a.md',
      '/repos/Regenerant-Catalunya/docs/a.md',
      'repos/Regenerant-Catalunya//docs/a.md',
      './repos/Regenerant-Catalunya/docs/a.md',
      'repos/Regenerant-Catalunya/./docs/a.md',
      'repos/Regenerant-Catalunya/content/../docs/a.md',
      'repos/Regenerant-Catalunya/content/%252e%252e/docs/a.md',
      'repos/Regenerant%2DCatalunya/docs/a.md',
      'REPOS/Regenerant-Catalunya/Docs/A.MD',
      'repos/Regenerant-Catalunya/docs/a.md?v=1#frag',
    ]) {
      assert.equal(heldReasonFor(raw, heldSystems), 'held prefix: repos/Regenerant-Catalunya/docs/', raw);
    }
    // and the mirror: the HOLD written non-canonically still holds a canonical path
    for (const held of ['/repos/Regenerant-Catalunya/docs/', 'repos//Regenerant-Catalunya/docs/',
      './repos/Regenerant-Catalunya/docs/', 'repos/Regenerant-Catalunya/content/../docs/',
      'repos/Regenerant%2DCatalunya/docs/']) {
      const sys = { rc: { ...heldSystems.rc, held_prefixes: [held] } };
      assert.equal(heldReasonFor('repos/Regenerant-Catalunya/docs/a.md', sys), `held prefix: ${held}`, held);
    }
    assert.equal(heldReasonFor('repos/Regenerant-Catalunya/content/a.md', heldSystems), null);
  });

  test('isConsentBlocked matches across notations, in both directions', () => {
    const idx = buildBoundaryIndex([{ source_lineage: 'repos/ReFi-Barcelona/notes/x.md', tier: 'never-publish-without-consent' }]);
    for (const raw of ['/repos/ReFi-Barcelona/notes/x.md', 'repos//ReFi-Barcelona/notes/x.md',
      './repos/ReFi-Barcelona/notes/x.md', 'repos/ReFi-Barcelona/content/../notes/x.md',
      'repos/ReFi%2DBarcelona/notes/x.md', 'REPOS/ReFi-Barcelona/NOTES/X.MD',
      'repos/ReFi-Barcelona/notes/x.md?v=1']) {
      assert.equal(isConsentBlocked(idx, raw), true, raw);
    }
    // a boundary RECORD written non-canonically still indexes and still blocks
    const oddIdx = buildBoundaryIndex([{ source_lineage: '/repos//ReFi-Barcelona/./notes/x.md', tier: 'never-publish-without-consent' }]);
    assert.equal(isConsentBlocked(oddIdx, 'repos/ReFi-Barcelona/notes/x.md'), true);
  });

  test('claimingCards resolves a non-canonical lineage to its card, and a non-canonical origin_prefix still claims', () => {
    for (const raw of ['/repos/ReFi-Barcelona/notes/x.md', 'repos//ReFi-Barcelona/notes/x.md',
      './repos/ReFi-Barcelona/notes/x.md', 'repos/ReFi%2DBarcelona/notes/x.md',
      'repos/Other/../ReFi-Barcelona/notes/x.md']) {
      assert.deepEqual(claimingCards(raw, sourceSystems).map((h) => h.slug), ['refi-bcn-old-kb'], raw);
    }
    for (const prefix of ['/repos/ReFi-Barcelona/', 'repos//ReFi-Barcelona/', './repos/ReFi-Barcelona/',
      'repos/ReFi%2DBarcelona/', 'repos/ReFi-Barcelona']) {
      assert.deepEqual(cardPrefixes({ origin_prefixes: [prefix] }), ['repos/refi-barcelona/'], prefix);
    }
  });
});
