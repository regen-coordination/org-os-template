// site/test/drift.test.mjs — the pure part of the drift report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pagesToCheck, formatDriftReport } from "../src/lib/drift.mjs";

const V = "214e2e4d06eed1f646c26ae938cb0d0c858af99f";

test("pagesToCheck keeps only pages with covers and a verified commit", () => {
  const pages = [
    { slug: "a", covers: ["x/"], verified: V },
    { slug: "b", verified: V },
    { slug: "c", covers: [], verified: V },
    { slug: "d", covers: ["y"], verified: null },
  ];
  assert.deepEqual(pagesToCheck(pages).map((p) => p.slug), ["a"]);
});

test("a page with changes is listed with its verified commit and each changed path", () => {
  const out = formatDriftReport([
    { slug: "kms", source: "docs/KMS.md", verified: V, covers: ["packages/org-os-kms"], changed: ["packages/org-os-kms/src/cli.mjs", "packages/org-os-kms/src/gate.mjs"] },
  ]);
  assert.match(out, /! kms \(docs\/KMS\.md\) — verified at 214e2e4: 2 changed path\(s\)/);
  assert.match(out, /^ {4}packages\/org-os-kms\/src\/cli\.mjs$/m);
  assert.match(out, /1 of 1 page\(s\) have code changes since they were verified/);
});

test("a clean page says so, and a clean report says nothing drifted", () => {
  const out = formatDriftReport([{ slug: "setup", source: "docs/SETUP.md", verified: V, covers: ["package.json"], changed: [] }]);
  assert.match(out, /setup \(docs\/SETUP\.md\) — verified at 214e2e4: no changes under its covers/);
  assert.match(out, /No page has drifted/);
});

test("a page git could not compare is reported, not hidden", () => {
  const out = formatDriftReport([{ slug: "x", source: "docs/X.md", verified: V, covers: ["a"], changed: null, error: "bad object" }]);
  assert.match(out, /\? x .*could not compare: bad object/);
  assert.match(out, /1 page\(s\) could not be compared/);
  assert.doesNotMatch(out, /No page has drifted/);
});

test("an empty list still produces a readable report", () => {
  const out = formatDriftReport([]);
  assert.match(out, /0 page\(s\) with covers/);
  assert.match(out, /No page has drifted/);
});
