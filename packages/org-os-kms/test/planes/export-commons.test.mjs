import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { exportCommons } from "../../src/planes/export-commons.mjs";
import { loadKb } from "../../src/planes/kb-loader.mjs";
import { stripPrivateDeep } from "../../src/planes/write-published-kb.mjs";
import { makeCanon, makeCommons, readTree, SOURCE_CARDS } from "./helpers.mjs";

const lineage = "repos/ReFi-Barcelona/notes/x.md";
const published = {
  title: "Published",
  summary: "ok",
  maturity: "reviewed",
  public_use: "ok-with-caveat",
  source_lineage: lineage,
  ai_assisted: true,
  notes: "INTERNAL NOTE",
  work_order: "wo-1",
  reviewed_by: "lf",
  consent_note: "secret",
  interpretation: "i",
  provenance: {
    origin: lineage,
    surfaced_by: "agent-7",
    transformation: "summarised",
  },
};
const raw = {
  title: "Raw",
  maturity: "raw",
  public_use: "ok-with-caveat",
  source_lineage: lineage,
};
const noFloor = {
  title: "No floor",
  maturity: "reviewed",
  source_lineage: lineage,
};
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

test("an empty store exports nothing and leaves the commons self card alone", () => {
  const root = makeCanon();
  const outDir = makeCommons();
  fs.mkdirSync(path.join(outDir, "data", "kb"), { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "data", "kb", "source-system.yaml"),
    "entries:\n  self: {}\n",
  );
  const r = exportCommons({ root, outDir, uuid });
  assert.deepEqual(r.written, []);
  assert.deepEqual(fs.readdirSync(path.join(outDir, "data", "kb")).sort(), [
    "public-fields.json",
    "source-system.yaml",
  ]);
});

test("only gate ∧ floor passes; private fields are stripped; ids are minted in the canon", () => {
  const root = makeCanon({ resource: { published, raw, "no-floor": noFloor } });
  const outDir = makeCommons();
  const r = exportCommons({ root, outDir, uuid });
  assert.deepEqual(r.written, [path.join("data", "kb", "resource.yaml")]);
  const out = yaml.load(
    fs.readFileSync(path.join(outDir, "data", "kb", "resource.yaml"), "utf8"),
  ).entries;
  assert.deepEqual(Object.keys(out), ["published"]);
  const o = out.published;
  for (const f of [
    "notes",
    "work_order",
    "reviewed_by",
    "consent_note",
    "interpretation",
  ])
    assert.ok(!(f in o), `${f} leaked`);
  assert.ok(!("surfaced_by" in o.provenance));
  assert.equal(o.provenance.origin, lineage);
  assert.ok(o.id, "id minted");
  assert.equal(
    loadKb(path.join(root, "data", "kb")).objects["resource:published"].id,
    o.id,
  );
  assert.deepEqual(
    r.skipped.map((s) => s.key),
    ["resource:raw"],
  );
  assert.deepEqual(
    r.floorRejected.map((s) => s.key),
    ["resource:no-floor"],
  );
  assert.ok(!JSON.stringify(readTree(outDir)).includes("INTERNAL NOTE"));
});

test("export is deterministic: a second run is byte-identical and mints nothing", () => {
  const root = makeCanon({
    resource: { published, b: { ...published, title: "B" } },
    signal: { s: { ...published, title: "S" } },
  });
  const outDir = makeCommons();
  exportCommons({ root, outDir, uuid });
  const first = readTree(outDir);
  const r2 = exportCommons({ root, outDir, uuid });
  assert.equal(r2.minted, 0);
  assert.deepEqual(readTree(outDir), first);
});

test("a retracted object disappears from the projection on the next run", () => {
  const root = makeCanon({ resource: { published } });
  const outDir = makeCommons();
  exportCommons({ root, outDir, uuid });
  const file = path.join(root, "data", "kb", "resource.yaml");
  const doc = yaml.load(fs.readFileSync(file, "utf8"));
  doc.entries.published.maturity = "raw";
  fs.writeFileSync(file, yaml.dump(doc));
  exportCommons({ root, outDir, uuid });
  assert.ok(!fs.existsSync(path.join(outDir, "data", "kb", "resource.yaml")));
});

test("refuses any target that is not the commons instance", () => {
  const root = makeCanon({ resource: { published } });
  assert.throws(
    () => exportCommons({ root, outDir: root, uuid }),
    /refusing to export into the canon/,
  );
  assert.throws(
    () => exportCommons({ root, outDir: makeCommons("something-else"), uuid }),
    /not the commons instance/,
  );
  assert.throws(
    () => exportCommons({ root, outDir: path.join(root, "nope"), uuid }),
    /no kms\.yaml/,
  );
});

test("refuses to run when a source-system card has malformed held_prefixes, naming the card", () => {
  // held_prefixes must be a list; a bare string (the author dropped the `- `) is unreadable, so the
  // gate treats the card as refusing everything it claims. The export must lint this BEFORE
  // computing any verdict and throw, naming the offending card, rather than silently letting
  // "refuses everything" pass as a normal (if total) rejection.
  const badCards = {
    ...SOURCE_CARDS,
    "refi-bcn-old-kb": {
      ...SOURCE_CARDS["refi-bcn-old-kb"],
      held_prefixes: "repos/ReFi-Barcelona/secret/",
    },
  };
  const root = makeCanon({
    "source-system": badCards,
    resource: { published },
  });
  const outDir = makeCommons();
  assert.throws(() => exportCommons({ root, outDir, uuid }), /refi-bcn-old-kb/);
});

test("refuses to run when a public-use-boundary record is directory-shaped, not corpus-path exact-key", () => {
  // Boundaries are exact-key: a source_lineage ending in "/" reads as directory intent, which
  // boundaries do not have (that is a card's held_prefixes job). validateBoundaries reports this;
  // the export must refuse rather than silently index a control that protects nothing.
  const badBoundary = {
    source_lineage: "repos/ReFi-Barcelona/notes/",
    tier: "never-publish-without-consent",
  };
  const root = makeCanon({
    "public-use-boundary": { bad: badBoundary },
    resource: { published },
  });
  const outDir = makeCommons();
  assert.throws(() => exportCommons({ root, outDir, uuid }), /ends in \//);
});

test('an entry key containing "#" is refused at load, naming the file and the key', () => {
  // The repo-data adapter's ref format is `<file>#<slug>`; select-for-publication and
  // write-published-kb both derive the slug via ref.lastIndexOf('#'). Without this guard, a key
  // like "a#b" would be gate-refused under "resource:a#b" but published under "b", overwriting
  // (and leaking the raw body of) the legitimate "b" object.
  const secret = {
    title: "Secret",
    maturity: "raw",
    public_use: "ok-with-caveat",
    source_lineage: lineage,
    notes: "TOP SECRET RAW BODY",
  };
  const root = makeCanon({ resource: { b: published, "a#b": secret } });
  const outDir = makeCommons();
  assert.throws(
    () => exportCommons({ root, outDir, uuid }),
    /resource\.yaml: entry key "a#b" contains '#'/,
  );
});

test('the legitimate object still publishes once the "#" key is absent', () => {
  const root = makeCanon({ resource: { b: published } });
  const outDir = makeCommons();
  exportCommons({ root, outDir, uuid });
  const out = yaml.load(
    fs.readFileSync(path.join(outDir, "data", "kb", "resource.yaml"), "utf8"),
  ).entries;
  assert.deepEqual(Object.keys(out), ["b"]);
});

test("refuses a commons target whose data/kb is symlinked into the canon, and the canon survives", () => {
  const root = makeCanon({
    signal: { s: { ...published, title: "Internal signal" } },
  });
  const outDir = makeCommons();
  fs.mkdirSync(path.join(outDir, "data"), { recursive: true });
  fs.symlinkSync(
    path.join(root, "data", "kb"),
    path.join(outDir, "data", "kb"),
    "dir",
  );
  assert.throws(
    () => exportCommons({ root, outDir, uuid }),
    /resolves inside the canon/,
  );
  assert.ok(
    fs.existsSync(path.join(root, "data", "kb", "signal.yaml")),
    "canon file must survive the refused export",
  );
});

test("production layout — commons nested at <root>/repos/<instance> is accepted", () => {
  // Mirrors the real layout: commonsDir()'s default is exactly <root>/repos/<COMMONS_INSTANCE>.
  // Before this fix, assertCommonsTarget refused this unconditionally because it resolves inside
  // the canon root — the production export could never pass its own safety guard.
  const root = makeCanon({ resource: { published } });
  const outDir = makeCommons(
    undefined,
    path.join(root, "repos", "regenerant-catalunya-commons"),
  );
  const r = exportCommons({ root, outDir, uuid });
  assert.deepEqual(r.written, [path.join("data", "kb", "resource.yaml")]);
  assert.ok(
    fs.existsSync(path.join(outDir, "data", "kb", "resource.yaml")),
    "commons file must be written",
  );
  // Nothing was written anywhere in the canon other than under repos/ (where the commons lives) and
  // the canon's own pre-existing data/ (minting rewrites the canon's own source file in place).
  assert.deepEqual(fs.readdirSync(root).sort(), ["data", "kms.yaml", "repos"]);
});

test("symlink attack is still refused when the commons is legitimately nested under repos/", () => {
  // Same attack as above, but staged at the real production path — repos/<commons>/data/kb — to
  // prove the repos/ exception does not blanket-allow everything under repos/, only the commons
  // directory itself; a data/kb that escapes back into the canon via a symlink is still caught.
  const root = makeCanon({
    signal: { s: { ...published, title: "Internal signal" } },
  });
  const outDir = makeCommons(
    undefined,
    path.join(root, "repos", "regenerant-catalunya-commons"),
  );
  fs.mkdirSync(path.join(outDir, "data"), { recursive: true });
  fs.symlinkSync(
    path.join(root, "data", "kb"),
    path.join(outDir, "data", "kb"),
    "dir",
  );
  assert.throws(
    () => exportCommons({ root, outDir, uuid }),
    /resolves inside the canon/,
  );
  assert.ok(
    fs.existsSync(path.join(root, "data", "kb", "signal.yaml")),
    "canon file must survive the refused export",
  );
});

test("a commons nested elsewhere in the canon (not under repos/) is refused", () => {
  const root = makeCanon({ resource: { published } });
  const outDir = makeCommons(
    undefined,
    path.join(root, "somewhere", "commons"),
  );
  assert.throws(
    () => exportCommons({ root, outDir, uuid }),
    /resolves inside the canon/,
  );
});

test("a sibling directory named repos-evil is not mistaken for repos/", () => {
  // Containment must be path-segment-aware: "repos-evil" shares the "repos" prefix but is not
  // "repos" or a path under it, so it must be refused like any other in-canon location.
  const root = makeCanon({ resource: { published } });
  const outDir = makeCommons(
    undefined,
    path.join(root, "repos-evil", "commons"),
  );
  assert.throws(
    () => exportCommons({ root, outDir, uuid }),
    /resolves inside the canon/,
  );
});

test("ROUND B: <root>/repos itself is refused as a commons target — only strictly below it qualifies", () => {
  const root = makeCanon({ resource: { published } });
  const outDir = makeCommons(undefined, path.join(root, "repos"));
  assert.throws(
    () => exportCommons({ root, outDir, uuid }),
    /resolves inside the canon/,
  );
});

test("ROUND B: <root>/repos as a symlink is refused outright, whether it points into the canon or entirely outside it", () => {
  // Both cases are refused for the SAME reason: the repos/ exception is only safe because repos/
  // really is the directory the canon's own filesystem says it is. A symlinked repos/ could point
  // anywhere and be re-pointed later, so it is refused regardless of its target — there is no
  // "safe" symlink target for repos/ itself.
  for (const target of ["into the canon", "outside the canon"]) {
    const root = makeCanon({ resource: { published } });
    const reposPath = path.join(root, "repos");
    const realTargetDir =
      target === "into the canon"
        ? (() => {
            const d = path.join(root, "secret-repos-target");
            fs.mkdirSync(d, { recursive: true });
            return d;
          })()
        : fs.mkdtempSync(path.join(os.tmpdir(), "repos-target-"));
    const outDir = path.join(realTargetDir, "regenerant-catalunya-commons");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "kms.yaml"),
      yaml.dump({
        instance: "regenerant-catalunya-commons",
        adapter: "repo-data",
        target: ".",
      }),
    );
    fs.symlinkSync(realTargetDir, reposPath, "dir");
    assert.throws(
      () =>
        exportCommons({
          root,
          outDir: path.join(reposPath, "regenerant-catalunya-commons"),
          uuid,
        }),
      /repos.*is a symlink/,
      `repos/ symlinked ${target} must still be refused`,
    );
  }
});

test("ROUND C: a dangling symlink sitting at a published schema file path is refused, and the canon is untouched", () => {
  // The exact class of bug reproduced end to end: the FINAL path component (not an ancestor) is
  // itself a symlink whose target does not exist yet. Before the fix, resolveThroughExisting used
  // fs.existsSync (which follows symlinks) to test presence, read the dangling link as "not there",
  // and popped/re-appended its basename unresolved — so it looked like an ordinary not-yet-existing
  // file safely inside the commons, and a write through it would have followed the link out.
  const root = makeCanon({ resource: { published } });
  const outDir = makeCommons(
    undefined,
    path.join(root, "repos", "regenerant-catalunya-commons"),
  );
  fs.mkdirSync(path.join(outDir, "data", "kb"), { recursive: true });
  const canonTarget = path.join(root, "escaped-resource.yaml");
  fs.symlinkSync(canonTarget, path.join(outDir, "data", "kb", "resource.yaml")); // dangling
  assert.throws(
    () => exportCommons({ root, outDir, uuid }),
    /dangling symlink/,
  );
  assert.ok(
    !fs.existsSync(canonTarget),
    "the canon must never receive resource.yaml via the dangling symlink",
  );
});

test("ROUND B: outDir/data symlinked to a canon directory with no kb child is refused before mkdir creates one there", () => {
  // The "not-yet-existing" escape: assertCommonsTarget's own kbDir check is skipped because
  // outDir/data/kb does not exist yet (fs.existsSync is false), but write-published-kb.mjs's
  // mkdirSync({recursive:true}) would still create it by walking through the symlinked ancestor.
  // assertInsideCommons closes this by resolving the deepest EXISTING ancestor before the write.
  const root = makeCanon({ resource: { published } });
  const outDir = makeCommons(
    undefined,
    path.join(root, "repos", "regenerant-catalunya-commons"),
  );
  const secretDir = path.join(root, "secretdir");
  fs.mkdirSync(secretDir, { recursive: true });
  fs.symlinkSync(secretDir, path.join(outDir, "data"), "dir");
  assert.throws(
    () => exportCommons({ root, outDir, uuid }),
    /refusing to write outside the commons/,
  );
  assert.ok(
    !fs.existsSync(path.join(secretDir, "kb")),
    "must not have created kb/ inside the canon via the symlink",
  );
});

test("private fields are stripped at any depth, case-insensitively", () => {
  const deep = {
    title: "Deep",
    summary: "ok",
    maturity: "reviewed",
    public_use: "ok-with-caveat",
    source_lineage: lineage,
    provenance: {
      origin: lineage,
      notes: "TOP SECRET PROV NOTES",
      reviewer: { consent_note: "TOP SECRET REVIEWER CONSENT" },
    },
    editorial: { notes: "TOP SECRET EDITORIAL NOTES" },
    mentions: [{ Notes: "TOP SECRET ARRAY NOTES" }, { ok: true }],
  };
  const root = makeCanon({ resource: { deep } });
  const outDir = makeCommons();
  exportCommons({ root, outDir, uuid });
  const tree = JSON.stringify(readTree(outDir));
  for (const secret of [
    "TOP SECRET PROV NOTES",
    "TOP SECRET REVIEWER CONSENT",
    "TOP SECRET EDITORIAL NOTES",
    "TOP SECRET ARRAY NOTES",
  ]) {
    assert.ok(!tree.includes(secret), `${secret} leaked`);
  }
  const out = yaml.load(
    fs.readFileSync(path.join(outDir, "data", "kb", "resource.yaml"), "utf8"),
  ).entries.deep;
  // The allowlist is stricter than the deny-list here, and that is the point: `mentions` is an array
  // of OBJECTS and no schema gives that key a per-key rule, so the whole field fails closed and
  // disappears — the innocent `{ ok: true }` element with it. `editorial` likewise. What survives is
  // exactly what a resource's allowlist names.
  assert.equal(out.mentions, undefined);
  assert.equal(out.editorial, undefined);
  assert.equal(out.summary, "ok");
  assert.equal(out.provenance.origin, lineage);
  assert.equal(out.provenance.reviewer, undefined);
});

test("a malformed canon YAML file names the file in the thrown error", () => {
  const root = makeCanon({ resource: { published } });
  fs.writeFileSync(
    path.join(root, "data", "kb", "resource.yaml"),
    "entries:\n  x: [1, 2\n",
  );
  const outDir = makeCommons();
  assert.throws(() => exportCommons({ root, outDir, uuid }), /resource\.yaml/);
});

test("a malformed commons kms.yaml names the file in the thrown error", () => {
  const root = makeCanon({ resource: { published } });
  const outDir = makeCommons();
  fs.writeFileSync(path.join(outDir, "kms.yaml"), "instance: [1, 2\n");
  assert.throws(() => exportCommons({ root, outDir, uuid }), /kms\.yaml/);
});

test("floorRejected is sorted the same way skipped is, not readdir order", () => {
  const root = makeCanon({
    resource: {
      zzz: { ...noFloor, title: "zzz" },
      aaa: { ...noFloor, title: "aaa" },
    },
  });
  const outDir = makeCommons();
  const r = exportCommons({ root, outDir, uuid });
  assert.deepEqual(
    r.floorRejected.map((s) => s.key),
    ["resource:aaa", "resource:zzz"],
  );
});

test("reports which canon files minting rewrote", () => {
  const root = makeCanon({ resource: { published } });
  const outDir = makeCommons();
  const r = exportCommons({ root, outDir, uuid });
  assert.deepEqual(r.mintedFiles, [path.join("data", "kb", "resource.yaml")]);
});

test("an unquoted date round-trips to a real date, not {}", () => {
  // Built from raw YAML text, not a JS object literal: a JS string dumped through yaml.dump comes
  // back quoted (and therefore a string again), which would not reproduce the bug — js-yaml only
  // parses an UNQUOTED scalar like 2024-01-01 into a native Date.
  const root = makeCanon({ resource: {} });
  const outDir = makeCommons();
  fs.writeFileSync(
    path.join(root, "data", "kb", "resource.yaml"),
    [
      "entries:",
      "  published:",
      "    title: Published",
      "    summary: ok",
      "    maturity: reviewed",
      "    public_use: ok-with-caveat",
      `    source_lineage: ${lineage}`,
      "    last_reviewed: 2024-01-01",
      "",
    ].join("\n"),
  );
  exportCommons({ root, outDir, uuid });
  const out = yaml.load(
    fs.readFileSync(path.join(outDir, "data", "kb", "resource.yaml"), "utf8"),
  ).entries.published;
  assert.ok(
    out.last_reviewed instanceof Date,
    `last_reviewed should be a Date, got ${JSON.stringify(out.last_reviewed)}`,
  );
  assert.equal(out.last_reviewed.toISOString().slice(0, 10), "2024-01-01");
});

test("a nested date survives while a sibling provenance.notes in the same object is stripped", () => {
  const root = makeCanon({ resource: {} });
  const outDir = makeCommons();
  fs.writeFileSync(
    path.join(root, "data", "kb", "resource.yaml"),
    [
      "entries:",
      "  d:",
      "    title: D",
      "    summary: ok",
      "    maturity: reviewed",
      "    public_use: ok-with-caveat",
      `    source_lineage: ${lineage}`,
      "    provenance:",
      `      origin: ${lineage}`,
      "      recorded_on: 2024-01-01",
      "      notes: TOP SECRET NESTED NOTES",
      "",
    ].join("\n"),
  );
  exportCommons({ root, outDir, uuid });
  const out = yaml.load(
    fs.readFileSync(path.join(outDir, "data", "kb", "resource.yaml"), "utf8"),
  ).entries.d;
  // `provenance` publishes through its own three-key allowlist (origin, transformation, authorship),
  // so `recorded_on` and `notes` are both gone while `origin` survives untouched — and provenance
  // itself is omitted entirely when nothing in it is public, rather than written as an empty map.
  assert.equal(out.provenance.origin, lineage);
  assert.equal(out.provenance.recorded_on, undefined);
  assert.ok(
    !("notes" in out.provenance),
    "provenance.notes should still be stripped",
  );
  assert.equal(out.summary, "ok");
});

test("a null-prototype object carrying a private key is still stripped", () => {
  // A real null-prototype object is not reachable through the YAML-sourced export pipeline (js-yaml
  // always parses mappings to ordinary Object.prototype objects) — this pins stripPrivateDeep's
  // prototype check directly, since Object.create(null) is the one shape that fails a naive
  // `v.constructor === Object` test while still being a plain map that must be walked.
  const nullProto = Object.create(null);
  nullProto.keep = "ok";
  nullProto.notes = "TOP SECRET NULL PROTO NOTES";
  const result = stripPrivateDeep({ wrapper: nullProto });
  assert.equal(result.wrapper.keep, "ok");
  assert.ok(
    !("notes" in result.wrapper),
    "notes should be stripped from a null-prototype object",
  );
});

test("notes_url and release_notes survive stripping — exact key match only", () => {
  // Pinned against stripPrivateDeep itself, not through an export: these keys are not on any
  // allowlist, so an export drops them for a different reason. What is being pinned is the
  // deny-list's exact-key matching (`notes_url` must not be caught by `notes`), which still governs
  // the preserved self card's scan.
  const out = stripPrivateDeep({
    notes_url: "https://example.com/notes",
    release_notes: "v1 changelog",
    notes: "gone",
  });
  assert.equal(out.notes_url, "https://example.com/notes");
  assert.equal(out.release_notes, "v1 changelog");
  assert.equal(out.notes, undefined);
});

// FINAL REVIEW -------------------------------------------------------------------------------
// Minting happens in the CANON (ensureIds writes ids back into data/kb/*.yaml). A write-time
// refusal that fires AFTER minting leaves the canon modified by an export that produced nothing.
// Containment of <outDir>/data/kb is therefore asserted before selectForPublication runs.

test("FINAL REVIEW: a refused export leaves the canon byte-identical — nothing is minted first", () => {
  const root = makeCanon({
    resource: {
      p: {
        title: "P",
        maturity: "reviewed",
        public_use: "ok-with-caveat",
        source_lineage: "repos/ReFi-Barcelona/notes/x.md",
      },
    },
  });
  const outDir = makeCommons();
  const canonFile = path.join(root, "data", "kb", "resource.yaml");
  const before = fs.readFileSync(canonFile);
  assert.ok(
    !before.toString().includes("id:"),
    "fixture: the canon object has no id yet, so an export WOULD mint one",
  );

  // A hard link at the write target: contained, no symlink, but a shared inode.
  const outsideFile = path.join(
    fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "canon-side-"))),
    "resource.yaml",
  );
  fs.writeFileSync(outsideFile, "entries: {}\n");
  fs.mkdirSync(path.join(outDir, "data", "kb"), { recursive: true });
  fs.linkSync(outsideFile, path.join(outDir, "data", "kb", "resource.yaml"));
  // …and data/kb itself is what the up-front assertion checks, so make THAT the refusal: a
  // dangling symlink where data/kb should be.
  fs.rmSync(path.join(outDir, "data", "kb"), { recursive: true, force: true });
  fs.symlinkSync(
    path.join(outDir, "nope"),
    path.join(outDir, "data", "kb"),
    "dir",
  );

  assert.throws(
    () => exportCommons({ root, outDir }),
    /export-commons: refusing/,
  );
  assert.deepEqual(
    fs.readFileSync(canonFile),
    before,
    "the canon was rewritten by a refused export",
  );
});

test("FINAL REVIEW: the same export succeeds and DOES mint once the target is sound", () => {
  const root = makeCanon({
    resource: {
      p: {
        title: "P",
        maturity: "reviewed",
        public_use: "ok-with-caveat",
        source_lineage: "repos/ReFi-Barcelona/notes/x.md",
      },
    },
  });
  const outDir = makeCommons();
  const r = exportCommons({ root, outDir });
  assert.equal(r.minted, 1);
  assert.ok(
    fs
      .readFileSync(path.join(root, "data", "kb", "resource.yaml"), "utf8")
      .includes("id:"),
  );
});
