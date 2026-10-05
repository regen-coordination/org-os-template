import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { exportCommons } from "../../src/planes/export-commons.mjs";
import {
  validatePublishedKb,
  diffPaths,
} from "../../src/planes/validate-published-kb.mjs";
import { loadKb } from "../../src/planes/kb-loader.mjs";
import {
  leakedPaths,
  stripPrivateDeep,
} from "../../src/planes/write-published-kb.mjs";
import { PRIVATE_FIELDS } from "../../src/framework.mjs";
import { makeCanon, makeCommons } from "./helpers.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const lineage = "repos/ReFi-Barcelona/notes/x.md";
const obj = {
  title: "P",
  maturity: "reviewed",
  public_use: "ok-with-caveat",
  source_lineage: lineage,
  provenance: { origin: lineage },
};
const setup = () => {
  const root = makeCanon({ resource: { p: obj } });
  const outDir = makeCommons();
  exportCommons({ root, outDir });
  return { root, outDir, publishedDir: path.join(outDir, "data", "kb") };
};
const run = ({ root, publishedDir }) =>
  validatePublishedKb({
    publishedDir,
    kb: loadKb(path.join(root, "data", "kb")),
  });
const patch = (file, fn) => {
  const d = yaml.load(fs.readFileSync(file, "utf8"));
  fn(d);
  fs.writeFileSync(file, yaml.dump(d));
};

test("a fresh export validates clean; a missing published dir is clean too", () => {
  const s = setup();
  assert.deepEqual(run(s), []);
  assert.deepEqual(
    validatePublishedKb({
      publishedDir: path.join(s.outDir, "nope"),
      kb: loadKb(path.join(s.root, "data", "kb")),
    }),
    [],
  );
});

test("catches a leaked private field and a leaked surfaced_by", () => {
  const s = setup();
  patch(path.join(s.publishedDir, "resource.yaml"), (d) => {
    d.entries.p.notes = "x";
    d.entries.p.provenance.surfaced_by = "a";
  });
  const errs = run(s).join("\n");
  assert.match(errs, /resource:p: private field\(s\) leaked: notes/);
  assert.match(errs, /resource:p: provenance\.surfaced_by leaked/);
});

test("catches a leak nested two levels deep, inside an array, and with mismatched case", () => {
  const s = setup();
  patch(path.join(s.publishedDir, "resource.yaml"), (d) => {
    d.entries.p.provenance.reviewer = { consent_note: "x" };
    d.entries.p.items = [{ Notes: "y" }];
  });
  const errs = run(s).join("\n");
  assert.match(errs, /resource:p: provenance\.reviewer\.consent_note leaked/);
  assert.match(errs, /resource:p: items\[0\]\.Notes leaked/);
});

test("leakedPaths and stripPrivateDeep agree on every PRIVATE_FIELDS (+ surfaced_by) key, case-insensitively", () => {
  for (const f of [...PRIVATE_FIELDS, "surfaced_by"]) {
    const shouted = f.toUpperCase();
    const value = { [shouted]: "x", keep: "y" };
    assert.deepEqual(leakedPaths(value), [shouted]);
    assert.deepEqual(stripPrivateDeep(value), { keep: "y" });
  }
});

test("catches canon drift: demoted, retracted, or newly bounded after publication", () => {
  const demoted = setup();
  patch(path.join(demoted.root, "data", "kb", "resource.yaml"), (d) => {
    d.entries.p.maturity = "raw";
  });
  assert.match(
    run(demoted).join("\n"),
    /canon counterpart rejected by the canon gate — maturity is raw/,
  );

  const retracted = setup();
  patch(path.join(retracted.root, "data", "kb", "resource.yaml"), (d) => {
    delete d.entries.p;
  });
  assert.match(
    run(retracted).join("\n"),
    /resource:p: no such object in the canon/,
  );

  const bounded = setup();
  fs.writeFileSync(
    path.join(bounded.root, "data", "kb", "public-use-boundary.yaml"),
    yaml.dump({
      entries: {
        b: { source_lineage: lineage, tier: "never-publish-without-consent" },
      },
    }),
  );
  assert.match(
    run(bounded).join("\n"),
    /boundary: never-publish-without-consent/,
  );
});

test("catches maturity drifted to held", () => {
  const s = setup();
  patch(path.join(s.root, "data", "kb", "resource.yaml"), (d) => {
    d.entries.p.maturity = "held";
  });
  assert.match(
    run(s).join("\n"),
    /canon counterpart rejected by the canon gate — maturity is held/,
  );
});

test("catches a source-system card demoted to internal-only", () => {
  const s = setup();
  patch(path.join(s.root, "data", "kb", "source-system.yaml"), (d) => {
    d.entries["refi-bcn-old-kb"].public_use = "internal-only";
  });
  assert.match(
    run(s).join("\n"),
    /canon counterpart rejected by the canon gate — .*internal-only\/high_risk/,
  );
});

test("catches held_prefixes extended, after publication, to cover the published object", () => {
  const s = setup();
  patch(path.join(s.root, "data", "kb", "source-system.yaml"), (d) => {
    d.entries["refi-bcn-old-kb"].held_prefixes = [
      "repos/ReFi-Barcelona/notes/",
    ];
  });
  assert.match(
    run(s).join("\n"),
    /canon counterpart rejected by the canon gate — held prefix: repos\/ReFi-Barcelona\/notes\//,
  );
});

test("C1: a schema the framework floor never allows (person) dropped straight into the published store", () => {
  const s = setup();
  fs.writeFileSync(
    path.join(s.publishedDir, "person.yaml"),
    yaml.dump({
      entries: {
        someone: {
          id: "urn:x",
          title: "Someone",
          maturity: "reviewed",
          public_use: "ok-with-caveat",
        },
      },
    }),
  );
  const errs = run(s).join("\n");
  assert.match(
    errs,
    /person:someone: framework floor rejects this entry — schema "person" is not a publishable type/,
  );
});

test("C2: canon public_use drifts to a value the floor never allows, even though the gate itself does not block it", () => {
  const s = setup();
  patch(path.join(s.root, "data", "kb", "resource.yaml"), (d) => {
    d.entries.p.public_use = "needs-review";
  });
  assert.match(
    run(s).join("\n"),
    /resource:p: canon public_use "needs-review" is not publishable/,
  );
});

test("I4: a published copy that no longer matches what an export would write today — wrong id, smuggled field, rewritten title", () => {
  const s = setup();
  patch(path.join(s.publishedDir, "resource.yaml"), (d) => {
    d.entries.p.id = "urn:totally:wrong";
    d.entries.p.secret_budget = "40k";
    d.entries.p.title = "Not P Anymore";
  });
  const errs = run(s).join("\n");
  assert.match(
    errs,
    /resource:p: published copy diverges from the canon projection at:.*\bid\b/,
  );
  assert.match(
    errs,
    /resource:p: published copy diverges from the canon projection at:.*secret_budget/,
  );
  assert.match(
    errs,
    /resource:p: published copy diverges from the canon projection at:.*title/,
  );
});

test("I4: a field present in the canon but missing from the published copy is also a divergence", () => {
  const s = setup();
  patch(path.join(s.publishedDir, "resource.yaml"), (d) => {
    delete d.entries.p.provenance;
  });
  assert.match(
    run(s).join("\n"),
    /resource:p: published copy diverges from the canon projection at:.*provenance/,
  );
});

test("the divergence message fires alongside a failed canon gate, not instead of it", () => {
  const s = setup();
  patch(path.join(s.root, "data", "kb", "resource.yaml"), (d) => {
    d.entries.p.maturity = "raw";
  });
  patch(path.join(s.publishedDir, "resource.yaml"), (d) => {
    d.entries.p.title = "Rewritten While Demoted";
  });
  const errs = run(s).join("\n");
  assert.match(
    errs,
    /canon counterpart rejected by the canon gate — maturity is raw/,
  );
  assert.match(
    errs,
    /resource:p: published copy diverges from the canon projection at:.*title/,
  );
});

test("a leak is still reported on a published entry with no canon counterpart", () => {
  const s = setup();
  patch(path.join(s.publishedDir, "resource.yaml"), (d) => {
    d.entries.p.notes = "x";
  });
  patch(path.join(s.root, "data", "kb", "resource.yaml"), (d) => {
    delete d.entries.p;
  });
  const errs = run(s).join("\n");
  assert.match(errs, /resource:p: no such object in the canon/);
  assert.match(errs, /resource:p: private field\(s\) leaked: notes/);
});

test("frameworkFloorReason's maturity-is-held branch, distinct from the schema-not-publishable branch", () => {
  const s = setup();
  patch(path.join(s.publishedDir, "resource.yaml"), (d) => {
    d.entries.p.maturity = "held";
  });
  assert.match(
    run(s).join("\n"),
    /resource:p: framework floor rejects this entry — maturity is held/,
  );
});

test("catches a missing id and an unpublishable public_use", () => {
  const s = setup();
  patch(path.join(s.publishedDir, "resource.yaml"), (d) => {
    delete d.entries.p.id;
    d.entries.p.public_use = "whatever";
  });
  const errs = run(s).join("\n");
  assert.match(errs, /resource:p: missing id/);
  assert.match(errs, /resource:p: public_use "whatever" is not publishable/);
});

test("I5: a non-mapping document, non-mapping entries, and an empty entries the canon disagrees with", () => {
  const nonMapping = setup();
  fs.writeFileSync(
    path.join(nonMapping.publishedDir, "resource.yaml"),
    yaml.dump(["a", "b"]),
  );
  assert.match(
    run(nonMapping).join("\n"),
    /resource\.yaml: document is not a mapping/,
  );

  const nonMappingEntries = setup();
  fs.writeFileSync(
    path.join(nonMappingEntries.publishedDir, "resource.yaml"),
    yaml.dump({ entries: ["a", "b"] }),
  );
  assert.match(
    run(nonMappingEntries).join("\n"),
    /resource\.yaml: entries is not a mapping/,
  );

  const emptyEntries = setup();
  fs.writeFileSync(
    path.join(emptyEntries.publishedDir, "resource.yaml"),
    yaml.dump({ entries: {} }),
  );
  assert.match(
    run(emptyEntries).join("\n"),
    /resource\.yaml: entries is empty but the canon has a publishable object of schema "resource"/,
  );
});

const validSelfCard = {
  title: "Commons Self",
  type: "repo",
  url: "https://github.com/x/commons",
  origin_prefixes: ["repos/Commons/"],
  public_use: "ok-with-caveat",
};

test("C3: the preserved self card is scanned fully — a leak, a second entry, and a non-publishable public_use", () => {
  const leaked = setup();
  fs.writeFileSync(
    path.join(leaked.publishedDir, "source-system.yaml"),
    yaml.dump({
      entries: {
        self: {
          ...validSelfCard,
          notes: "LEAK",
          provenance: { origin: "x", surfaced_by: "a" },
        },
      },
    }),
  );
  const leakedErrs = run(leaked).join("\n");
  assert.match(
    leakedErrs,
    /source-system:self: private field\(s\) leaked: notes/,
  );
  assert.match(
    leakedErrs,
    /source-system:self: provenance\.surfaced_by leaked/,
  );

  const secondEntry = setup();
  fs.writeFileSync(
    path.join(secondEntry.publishedDir, "source-system.yaml"),
    yaml.dump({
      entries: { self: validSelfCard, extra: validSelfCard },
    }),
  );
  assert.match(
    run(secondEntry).join("\n"),
    /source-system\.yaml: expected exactly one entry \(the commons' self card\), found 2/,
  );

  const badPublicUse = setup();
  fs.writeFileSync(
    path.join(badPublicUse.publishedDir, "source-system.yaml"),
    yaml.dump({
      entries: { self: { ...validSelfCard, public_use: "internal-only" } },
    }),
  );
  assert.match(
    run(badPublicUse).join("\n"),
    /source-system:self: public_use "internal-only" is not publishable/,
  );
});

test("ROUND B: a self card needs no corpus-path prefix (no origin_prefixes/url required) to validate clean", () => {
  // A self card describes the commons itself, not a source container — it has no corpus to claim
  // a prefix over, so validateCards' "this card claims nothing" rule must NOT apply to it. Before
  // this fix, requiring one made commons:validate fail against the real, correctly-scaffolded
  // regenerant-catalunya-commons self card. Uses the real scaffold's own shape as the positive
  // control: title, type, url, steward, return_path, public_use — no corpus fields at all.
  const s = setup();
  fs.writeFileSync(
    path.join(s.publishedDir, "source-system.yaml"),
    yaml.dump({
      entries: {
        self: {
          title: "Regenerant Catalunya Commons",
          type: "knowledge-garden",
          url: "https://example.invalid",
          steward: "Luiz Fernando",
          return_path: "Corrections to Luiz Fernando",
          public_use: "ok-with-caveat",
        },
      },
    }),
  );
  assert.deepEqual(run(s), []);
});

test("ROUND C: a resource-shaped sole entry ({title, maturity, public_use, source_lineage}) is caught, not clean", () => {
  // Removing validateCards from the self-card path (round B) silently dropped its
  // wrongly-shaped-entry rejection too — it was the same rule. Without a replacement structural
  // check, this exact shape (no "type", and carrying maturity/source_lineage — fields that mark a
  // CONTENT object, not a card describing the commons itself) validated clean once smuggled into
  // the one published file the exporter never rewrites, making it permanent.
  const s = setup();
  fs.writeFileSync(
    path.join(s.publishedDir, "source-system.yaml"),
    yaml.dump({
      entries: {
        self: {
          title: "P",
          maturity: "reviewed",
          public_use: "ok-with-caveat",
          source_lineage: lineage,
        },
      },
    }),
  );
  const errs = run(s).join("\n");
  assert.match(
    errs,
    /source-system:self: self card must have a non-empty "type"/,
  );
  assert.match(errs, /source-system:self: self card must not carry "maturity"/);
  assert.match(
    errs,
    /source-system:self: self card must not carry "source_lineage"/,
  );
});

test("I6: a malformed self card names the file rather than throwing", () => {
  const s = setup();
  fs.writeFileSync(
    path.join(s.publishedDir, "source-system.yaml"),
    "key: [unterminated",
  );
  assert.doesNotThrow(() => run(s));
  assert.match(run(s).join("\n"), /source-system\.yaml: unloadable —/);
});

test("validateCards/validateBoundaries surface through validatePublishedKb even with no published store at all", () => {
  const root = makeCanon({});
  patch(path.join(root, "data", "kb", "source-system.yaml"), (d) => {
    d.entries["refi-bcn-old-kb"].held_prefixes = "not-a-list";
  });
  const errs = validatePublishedKb({
    publishedDir: path.join(root, "data", "kb", "nope"),
    kb: loadKb(path.join(root, "data", "kb")),
  });
  assert.match(
    errs.join("\n"),
    /held_prefixes is present but nothing in it holds anything/,
  );

  const root2 = makeCanon({});
  fs.writeFileSync(
    path.join(root2, "data", "kb", "public-use-boundary.yaml"),
    yaml.dump({
      entries: {
        b: {
          source_lineage: `${lineage}/`,
          tier: "never-publish-without-consent",
        },
      },
    }),
  );
  const errs2 = validatePublishedKb({
    publishedDir: path.join(root2, "data", "kb", "nope"),
    kb: loadKb(path.join(root2, "data", "kb")),
  });
  assert.match(errs2.join("\n"), /ends in \/ — a boundary names one document/);
});

test("a fresh multi-schema export with several entries and nested/array fields validates clean", () => {
  const lineageA = "repos/ReFi-Barcelona/notes/a.md";
  const lineageB = "repos/ReFi-Barcelona/notes/b.md";
  const root = makeCanon({
    resource: {
      p1: {
        title: "P1",
        maturity: "reviewed",
        public_use: "ok-with-caveat",
        source_lineage: lineageA,
        provenance: { origin: lineageA },
        resource_type: "report",
        summary: "ok",
        unit_refs: ["administrative:nacio:catalunya"],
      },
      p2: {
        title: "P2",
        maturity: "reviewed",
        public_use: "reviewed-for-guidance",
        source_lineage: lineageB,
        provenance: { origin: lineageB },
      },
    },
    organization: {
      o1: {
        title: "Org One",
        org_type: "network",
        maturity: "reviewed",
        public_use: "ok-with-caveat",
        source_lineage: lineageA,
        provenance: { origin: lineageA },
        membership: { count: 3, as_of: "2025", criteria: "stated" },
      },
    },
  });
  const outDir = makeCommons();
  exportCommons({ root, outDir });
  const publishedDir = path.join(outDir, "data", "kb");
  assert.deepEqual(
    validatePublishedKb({
      publishedDir,
      kb: loadKb(path.join(root, "data", "kb")),
    }),
    [],
  );
});

// Round-2 fix: valuesEqual used to fall back to `===`, which disagrees with itself for every one
// of these on a perfectly correct export (two independent yaml.load results are never the same
// instance, and NaN !== NaN). Since the allowlist landed, a binary blob or a NaN has no place on
// the published surface — those shapes are pinned against the comparator directly, and the
// export-path case below proves the round-trip on a shape that IS allowlisted (a Date in
// `last_reviewed`).
test("false positive 1: a !!binary value (two independent decodes are never the same instance)", () => {
  const a = yaml.load("blob: !!binary |\n  AQIDBAX/AA==\n");
  const b = yaml.load("blob: !!binary |\n  AQIDBAX/AA==\n");
  assert.notStrictEqual(a.blob, b.blob);
  assert.deepEqual(diffPaths(a, b), []);
});

test("false positive 2: a NaN value (NaN === NaN is false)", () => {
  assert.deepEqual(diffPaths({ score: NaN }, { score: NaN }), []);
});

test("a Date in an allowlisted field round-trips clean through a real export", () => {
  const root = makeCanon({
    resource: {
      p: { ...obj, last_reviewed: new Date("2024-01-01T00:00:00Z") },
    },
  });
  const outDir = makeCommons();
  exportCommons({ root, outDir });
  const publishedDir = path.join(outDir, "data", "kb");
  assert.deepEqual(
    validatePublishedKb({
      publishedDir,
      kb: loadKb(path.join(root, "data", "kb")),
    }),
    [],
  );
});

// Round 3: a canon entry carrying a literal `__proto__` key is now refused at LOAD, not merely
// caught on the next commons:validate run once an unsafe file already exists. The round-2
// "false positive 3" test above proved a NESTED `__proto__` key strips and validates clean — that
// finding was accurate for the depth it tested (setOwn only needed to defend the level it was
// rebuilding), but the coordinator's round-3 reproduction found the TOP-level case is worse: the
// vendored, zero-edit publicView's own `out[k] = v` reseats the object's prototype before
// stripPrivateDeep ever runs, which then skips its ENTIRE recursive walk (its root isPlainObject
// check fails), writing every private field under that prototype to the published store
// unstripped. The old "strips and validates clean" nested test is therefore no longer reachable
// behaviour — loadKb now refuses ANY depth of `__proto__` (nested included, to keep one rule
// instead of two) before stripPrivateDeep ever sees the data — so it is replaced here with the
// refusal it now actually produces, rather than deleted silently.
const injectTopLevelProto = (file, slug, junk) => {
  const parsed = yaml.load(fs.readFileSync(file, "utf8"));
  Object.defineProperty(parsed.entries[slug], "__proto__", {
    value: junk,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  fs.writeFileSync(file, yaml.dump(parsed));
};

test('loadKb refuses a top-level "__proto__" key, naming the file, the entry, and the path', () => {
  const root = makeCanon({
    resource: {
      p: {
        ...obj,
        provenance: {
          origin: lineage,
          reviewer: {
            consent_note: "DEEP-PRIVATE-CONSENT",
            notes: "DEEP-EDITORIAL-NOTE",
          },
        },
      },
    },
  });
  const file = path.join(root, "data", "kb", "resource.yaml");
  injectTopLevelProto(file, "p", { junk: true });
  assert.throws(
    () => loadKb(path.join(root, "data", "kb")),
    /kb-loader: .*resource\.yaml: entry "p" contains a "__proto__" key at __proto__, which cannot be safely projected/,
  );
});

test('loadKb refuses a "__proto__" key nested under an ordinary field, and one inside an array element', () => {
  const nested = setup();
  patch(path.join(nested.root, "data", "kb", "resource.yaml"), (d) => {
    d.entries.p.provenance.reviewer = yaml.load(
      "__proto__:\n  consent_note: DEEP-PRIVATE-CONSENT\n",
    );
  });
  assert.throws(
    () => loadKb(path.join(nested.root, "data", "kb")),
    /entry "p" contains a "__proto__" key at provenance\.reviewer\.__proto__/,
  );

  const inArray = setup();
  patch(path.join(inArray.root, "data", "kb", "resource.yaml"), (d) => {
    d.entries.p.items = [yaml.load("__proto__:\n  x: 1\n")];
  });
  assert.throws(
    () => loadKb(path.join(inArray.root, "data", "kb")),
    /entry "p" contains a "__proto__" key at items\[0\]\.__proto__/,
  );
});

test('exportCommons refuses when the canon contains a "__proto__" key, and writes nothing to the commons', () => {
  const root = makeCanon({ resource: { p: { ...obj } } });
  injectTopLevelProto(path.join(root, "data", "kb", "resource.yaml"), "p", {
    junk: true,
  });
  const outDir = makeCommons();
  assert.throws(
    () => exportCommons({ root, outDir }),
    /contains a "__proto__" key/,
  );
  assert.equal(
    fs.existsSync(path.join(outDir, "data", "kb")),
    false,
    "no data/kb directory should exist after a refused export",
  );
});

// Round 4: the round-3 walk only reached keys INSIDE an entry's value — an entry's own slug
// (the `entries:` key itself) was still only checked for emptiness and '#'. A slug of exactly
// `__proto__` hits the identical hazard one level out: `write-published-kb.mjs`'s
// `bySchema.get(schema)[slug] = ...` is plain bracket assignment on an object literal, so that
// one slug reseats the object's prototype instead of adding an entry — the object silently
// vanishes from the published file (`entries: {}`), and `exportCommons` reports success
// (`written: [...]`) while having written nothing for it. No private data reaches disk here
// (the value is already sanitised before the broken assignment) — this is loss, not a leak — but
// a successful-looking export that dropped an object is exactly the kind of thing an operator
// running only `commons:export` would never notice.
const injectProtoSlug = (file, plainSlug) => {
  const parsed = yaml.load(fs.readFileSync(file, "utf8"));
  const newEntries = {};
  Object.defineProperty(newEntries, "__proto__", {
    value: parsed.entries[plainSlug],
    enumerable: true,
    writable: true,
    configurable: true,
  });
  parsed.entries = newEntries;
  fs.writeFileSync(file, yaml.dump(parsed));
};

test('loadKb refuses an entry slugged "__proto__", naming the file and the key', () => {
  const root = makeCanon({ resource: { p: { ...obj } } });
  const file = path.join(root, "data", "kb", "resource.yaml");
  injectProtoSlug(file, "p");
  assert.throws(
    () => loadKb(path.join(root, "data", "kb")),
    /kb-loader: .*resource\.yaml: entry key "__proto__" cannot be safely projected/,
  );
});

test('exportCommons refuses when an entry is slugged "__proto__", and writes nothing to the commons', () => {
  const root = makeCanon({ resource: { p: { ...obj } } });
  injectProtoSlug(path.join(root, "data", "kb", "resource.yaml"), "p");
  const outDir = makeCommons();
  assert.throws(
    () => exportCommons({ root, outDir }),
    /entry key "__proto__" cannot be safely projected/,
  );
  assert.equal(
    fs.existsSync(path.join(outDir, "data", "kb")),
    false,
    "no data/kb directory should exist after a refused export",
  );
});

test('a slug that merely contains "__proto__" as a substring is an ordinary key — exact match only', () => {
  const root = makeCanon({ resource: { my__proto__thing: { ...obj } } });
  const outDir = makeCommons();
  exportCommons({ root, outDir });
  const publishedDir = path.join(outDir, "data", "kb");
  assert.deepEqual(
    validatePublishedKb({
      publishedDir,
      kb: loadKb(path.join(root, "data", "kb")),
    }),
    [],
  );
});

test('a legitimate object with no "__proto__" key still exports and validates clean', () => {
  assert.deepEqual(run(setup()), []);
});

test('a leaked field under a literal "__proto__" key is still caught when it survives to the published copy', () => {
  // A plain `{ __proto__: {...} }` object-literal in JS source does NOT create an own property
  // named "__proto__" — it sets the actual prototype (JS Annex B legacy syntax). js-yaml avoids
  // exactly that trap via Object.defineProperty when parsing a `__proto__:` YAML key, so the
  // fixture has to be built the same defensive way to stand in for real parsed input.
  const inner = {};
  Object.defineProperty(inner, "__proto__", {
    value: { notes: "LEAK" },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  assert.deepEqual(leakedPaths({ m: inner }), ["m.__proto__.notes"]);
});

test("strengthened positive control: the ordinary YAML value shapes that ARE on the allowlist round-trip at once", () => {
  const root = makeCanon({
    resource: {
      p: {
        title: "Full Shape",
        maturity: "reviewed",
        public_use: "ok-with-caveat",
        source_lineage: lineage,
        provenance: { origin: lineage, transformation: "summarised" },
        last_reviewed: new Date("2024-01-01T00:00:00Z"),
        resource_type: "report",
        summary: "ok",
        summary_en: "ok",
        lang: "ca",
        serves: "reports",
        locator: "p.12",
        unit_refs: ["administrative:nacio:catalunya"],
        caveat: "Read as a mid-2022 snapshot.",
      },
    },
    organization: {
      o: {
        title: "Org One",
        maturity: "reviewed",
        public_use: "ok-with-caveat",
        source_lineage: lineage,
        provenance: { origin: lineage },
        org_type: "network",
        membership: { count: 12, as_of: "2026-01-01", criteria: "stated" },
        legal_form: "association",
        url: "https://example.org/",
      },
    },
  });
  const outDir = makeCommons();
  exportCommons({ root, outDir });
  const publishedDir = path.join(outDir, "data", "kb");
  assert.deepEqual(
    validatePublishedKb({
      publishedDir,
      kb: loadKb(path.join(root, "data", "kb")),
    }),
    [],
  );
});

test("the validate verb exits non-zero on errors and zero (with a distinct message) when there is nothing to validate", () => {
  const cli = path.join(REPO_ROOT, "src", "cli.mjs");
  const canon = makeCanon();
  const run = (commons) =>
    spawnSync(process.execPath, [cli, "validate", "--dir", canon], {
      env: { ...process.env, COMMONS_DIR: commons },
      encoding: "utf8",
    });
  const emptyCommons = fs.mkdtempSync(
    path.join(os.tmpdir(), "validate-commons-empty-"),
  );
  const brokenCommons = fs.mkdtempSync(
    path.join(os.tmpdir(), "validate-commons-broken-"),
  );
  try {
    const clean = run(emptyCommons);
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /no published store at/);

    fs.mkdirSync(path.join(brokenCommons, "data", "kb"), { recursive: true });
    fs.writeFileSync(
      path.join(brokenCommons, "data", "kb", "resource.yaml"),
      yaml.dump({
        entries: {
          ghost: {
            id: "urn:ghost",
            title: "Ghost",
            maturity: "reviewed",
            public_use: "ok-with-caveat",
          },
        },
      }),
    );
    const broken = run(brokenCommons);
    assert.equal(broken.status, 1);
    assert.match(broken.stdout, /resource:ghost: no such object in the canon/);
  } finally {
    for (const d of [canon, emptyCommons, brokenCommons])
      fs.rmSync(d, { recursive: true, force: true });
  }
});

// ── FINAL WHOLE-BRANCH REVIEW, seam 1 ───────────────────────────────────────
// provenance.origin is a lineage. A published copy whose canon counterpart's provenance drifted to
// held or unregistered material must be flagged here too, not only refused at export time: the
// re-gate is the standing check an operator runs, and this is precisely the drift it exists for.

test("flags a published copy whose canon provenance.origin drifted to UNREGISTERED material", () => {
  const s = setup();
  patch(path.join(s.root, "data", "kb", "resource.yaml"), (d) => {
    d.entries.p.provenance.origin = "repos/Nowhere/private.md";
  });
  assert.match(
    run(s).join("\n"),
    /resource:p: canon counterpart rejected by the canon gate — unresolvable source_lineage: repos\/Nowhere\/private\.md/,
  );
});

test("flags a published copy whose canon provenance.origin drifted under a HELD prefix", () => {
  const s = setup();
  patch(path.join(s.root, "data", "kb", "source-system.yaml"), (d) => {
    d.entries["refi-bcn-old-kb"].held_prefixes = [
      "repos/ReFi-Barcelona/minutes/",
    ];
  });
  patch(path.join(s.root, "data", "kb", "resource.yaml"), (d) => {
    d.entries.p.provenance.origin = "repos/ReFi-Barcelona/minutes/secret.md";
  });
  assert.match(
    run(s).join("\n"),
    /resource:p: canon counterpart rejected by the canon gate — held prefix: repos\/ReFi-Barcelona\/minutes\//,
  );
});

test("flags a published copy whose canon lineage drifted to a NON-CANONICAL spelling (seam 2)", () => {
  const s = setup();
  patch(path.join(s.root, "data", "kb", "resource.yaml"), (d) => {
    d.entries.p.source_lineage = `/${lineage}`;
  });
  assert.match(
    run(s).join("\n"),
    /canon counterpart rejected by the canon gate — non-canonical source_lineage/,
  );
});
