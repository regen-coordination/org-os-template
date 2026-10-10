// site/test/manifest.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sortPages, neighboursOf, validateManifest } from "../src/lib/manifest.mjs";
import { PAGES, SECTIONS, ALLOW_UNVERIFIED, pageBySlug, pageBySource, pagesBySection, neighbours } from "../src/data/docs-manifest.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sections = [{ id: "a", title: "A", summary: "a" }, { id: "b", title: "B", summary: "b" }];
const page = (over) => ({ source: "docs/X.md", slug: "x", title: "X", section: "a", order: 1, summary: "s", verified: "abc1234", ...over });
const ok = { fileExists: () => true, commitExists: () => true, allowUnverified: false };

test("sortPages orders by section, then by order", () => {
  const pages = [page({ slug: "b2", section: "b", order: 2 }), page({ slug: "a2", order: 2 }), page({ slug: "b1", section: "b", order: 1 }), page({ slug: "a1", order: 1 })];
  assert.deepEqual(sortPages(pages, sections).map((p) => p.slug), ["a1", "a2", "b1", "b2"]);
});

test("neighboursOf crosses section boundaries and stops at the ends", () => {
  const pages = [page({ slug: "a1", order: 1 }), page({ slug: "b1", section: "b", order: 1 })];
  assert.equal(neighboursOf(pages, sections, "a1").prev, null);
  assert.equal(neighboursOf(pages, sections, "a1").next.slug, "b1");
  assert.equal(neighboursOf(pages, sections, "b1").prev.slug, "a1");
  assert.equal(neighboursOf(pages, sections, "b1").next, null);
  assert.deepEqual(neighboursOf(pages, sections, "nope"), { prev: null, next: null });
});

test("a valid manifest has no problems", () => {
  assert.deepEqual(validateManifest([page({})], sections, ok), []);
});

test("validateManifest reports each kind of problem by name", () => {
  const has = (pages, opts, needle) => {
    const out = validateManifest(pages, sections, { ...ok, ...opts });
    assert.ok(out.some((m) => m.includes(needle)), `expected "${needle}" in ${JSON.stringify(out)}`);
  };
  has([page({ title: "" })], {}, "title");
  has([page({ summary: "  " })], {}, "summary");
  has([page({ slug: "Bad Slug" })], {}, "slug");
  has([page({ section: "zzz" })], {}, "section");
  has([page({ order: Number.NaN })], {}, "order");
  has([page({ source: "../outside.md" })], {}, "source");
  has([page({ source: "/abs/x.md" })], {}, "source");
  has([page({ source: "docs/x.txt" })], {}, ".md");
  has([page({})], { fileExists: () => false }, "does not exist");
  has([page({}), page({ source: "docs/Y.md" })], {}, "duplicate slug");
  has([page({}), page({ slug: "y" })], {}, "duplicate source");
  has([page({ verified: null })], {}, "not verified");
  has([page({ verified: "not-a-sha" })], {}, "not a commit id");
  has([page({})], { commitExists: () => false }, "not in the repository");
  has([page({ covers: "docs/" })], {}, "covers");
});

test("an unverified page is accepted only while the flag is on", () => {
  assert.deepEqual(validateManifest([page({ verified: null })], sections, { ...ok, allowUnverified: true }), []);
});

test("the real manifest is valid against the working tree", () => {
  const problems = validateManifest(PAGES, SECTIONS, {
    fileExists: (p) => existsSync(join(repoRoot, p)),
    commitExists: () => true, // git lookup is exercised by verify-build
    allowUnverified: ALLOW_UNVERIFIED,
  });
  assert.deepEqual(problems, []);
});

test("the twelve addresses the site already serves are kept", () => {
  for (const slug of ["architecture", "modules", "agentic-architecture", "federation", "ecosystem", "data-model", "eip4824", "package-lifecycle", "operator-guide", "adopt-with-an-agent", "rad-org-os", "setup"]) {
    assert.ok(pageBySlug(slug), `missing slug ${slug}`);
  }
});

test("lookups agree with each other", () => {
  const p = pageBySlug("setup");
  assert.equal(p.source, "docs/SETUP.md");
  assert.equal(pageBySource("docs/SETUP.md"), p);
  assert.ok(pagesBySection("start").includes(p));
  assert.equal(pageBySlug("nope"), undefined);
  const n = neighbours("setup");
  assert.ok(n.prev === null || typeof n.prev.slug === "string");
});
