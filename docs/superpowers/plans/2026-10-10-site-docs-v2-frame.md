# Site and Docs v2 — Plan 1: the Frame — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `site/` into a documentation site driven by one manifest — docs layout, working links between docs, search, a dark theme, feedback links, an operator's home page and stricter build checks — with the twelve pages it starts with still unverified.

**Architecture:** A manifest (`site/src/data/docs-manifest.mjs`) is the only place that says what is published. The content loader, a remark plugin that rewrites file links, the sidebar, the docs index, `llms.txt`, the redirects and `verify-build.mjs` all read it. Logic lives in small pure `.mjs` modules under `site/src/lib/`, unit-tested with `node --test`; Astro components only render.

**Tech Stack:** Astro 5.18 (static, no client framework), Node ≥22, `node --test`, `js-yaml`, Pagefind 1.5, plain CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-10-10-site-docs-v2-design.md` (§4 is this plan; §3 gives the sections; §8 says what plan 1 leaves to plan 2).

## Global Constraints

- All work is in the worktree `~/.cache/lf-worktrees/site-docs-v2`, branch `feat/site-docs-v2`. Never work in `03 Libraries/org-os` itself.
- **Do not push the branch and do not open a pull request.** The deploy workflow runs on every push to `main`; publication is plan 3 and needs the operator's explicit go.
- No file under `docs/` is moved or renamed. This plan edits three of them only to unlink dead links (Task 3).
- Static Astro, no client framework. Astro stays on 5.x.
- English only. One version of the docs. No version switcher.
- The deployed address does not change. `site/base.config.mjs` stays the only place that names the origin and base path. Every internal `href`/`src` goes through `withBase()` from `site/src/lib/base.ts`.
- Site commands run from `site/` (`process.cwd()` is relied on). Paths in the manifest are relative to the repository root.
- Components read theme variables only — no raw colour values outside `site/src/styles/themes/*.css`.
- `--color-faint` is never used for body text in new components (it does not meet 4.5:1).
- The version shown on the site is read from the root `package.json`; it is never written into a page.
- Feedback uses links to GitHub issues only: no backend, no third-party script.
- `rm -rf .astro dist` before every `npm run build` in this plan: Astro caches rendered markdown in `.astro/`, and a stale cache hides a changed remark plugin.
- Commit messages follow the repo's style (`feat(site): …`, `test(site): …`, `docs(site): …`) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A link written as raw HTML inside a markdown file** (`<a href="SETUP.md">`) never passes through the remark plugin. Expected: the build fails rather than shipping a link that 404s. → Task 8, the relative-`href` check in `verify-build.mjs`.
2. **A viewer whose browser blocks `localStorage`** (private mode, strict settings). Expected: the page still gets a theme and nothing throws. → Task 5, `theme-boot.test.mjs`.
3. **Search assets that fail to load** (dev server, offline, blocked). Expected: the Search control takes the viewer to the docs index instead of doing nothing. → Task 6, `search.test.mjs`.
4. **A link that escapes the repository or carries an encoded space** (`../../koi-net/`, `03%20Libraries/…`). Expected: the first fails the build by name; the second resolves to the real file. → Task 2, `doc-links.test.mjs`.
5. **A manifest entry whose file exists but was not loaded** (typo in case, a glob that matched nothing). Expected: the build stops and names the source, instead of silently publishing one page fewer. → Task 3, the count check in `[...slug].astro`; Task 8, "every manifest page built".

## File Structure

| File | Responsibility |
|---|---|
| `site/src/data/docs-manifest.mjs` (new) | The sections and the pages. Data plus four lookups. |
| `site/src/lib/manifest.mjs` (new) | Pure: ordering, neighbours, validation of a manifest. |
| `site/src/lib/repo.mjs` (new) | Facts about the repository: root, URL, version, release ref, file list, commit lookup. |
| `site/src/lib/doc-links.mjs` (new) | Pure: resolve one link from one source file. |
| `site/src/lib/remark-doc-links.mjs` (new) | Remark plugin: apply `doc-links` to a markdown tree; fail on broken links. |
| `site/src/lib/remark-strip-title.mjs` (new) | Remark plugin: drop a document's leading `h1` (the layout prints the title). |
| `site/src/lib/feedback.mjs` (new) | Pure: build a prefilled GitHub issue URL. |
| `site/src/lib/theme-boot.mjs` (new) | The pre-paint theme script, as a string, so it can be tested. |
| `site/src/lib/search.mjs` (new) | Pure: open search, or fall back when it cannot load. |
| `site/src/data/redirects.mjs` (new) | Old addresses and where they go. |
| `site/src/components/DocsLayout.astro`, `DocsSidebar.astro`, `DocsToc.astro`, `DocsFooter.astro` (new) | The docs page. |
| `site/src/components/ThemeToggle.astro`, `Search.astro`, `Redirect.astro` (new) | Nav controls; a redirect page. |
| `site/src/content.config.ts` | Load exactly the manifest's files. |
| `site/astro.config.mjs` | Register the two remark plugins. |
| `site/src/pages/docs/[...slug].astro`, `docs/index.astro`, `index.astro`, `modules.astro`, `llms.txt.ts`, `get-started.astro`, `about.astro` | Pages. |
| `site/src/components/Layout.astro`, `Nav.astro`, `Footer.astro` | Shell. |
| `site/src/styles/theme.css`, `themes/systems.css`, `themes/systems-dark.css` | Both themes active, chosen by `data-theme`. |
| `site/src/data/modules.yaml`, `landing.yaml` | Module mirror (seven entries restored); home copy. |
| `site/scripts/verify-build.mjs` | Build checks, derived from the manifest. |
| `site/test/*.test.mjs` | Unit tests. |
| `.github/workflows/validate.yml`, `deploy-pages.yml` | Full history at checkout, so a `verified` commit can be looked up. |
| `site/src/data/docs-allowlist.ts` | Deleted. |

---

### Task 1: The manifest and its validation

**Files:**
- Create: `site/src/lib/manifest.mjs`
- Create: `site/src/data/docs-manifest.mjs`
- Test: `site/test/manifest.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces, from `site/src/lib/manifest.mjs`:
  - `sortPages(pages, sections) → DocPage[]` — by section order, then `order`.
  - `neighboursOf(pages, sections, slug) → { prev: DocPage | null, next: DocPage | null }`
  - `validateManifest(pages, sections, { fileExists(path) → boolean, commitExists(sha) → boolean, allowUnverified: boolean }) → string[]` — one message per problem; empty when valid.
- Produces, from `site/src/data/docs-manifest.mjs`:
  - `SECTIONS: { id: string, title: string, summary: string }[]`
  - `PAGES: DocPage[]` where `DocPage = { source: string, slug: string, title: string, section: string, order: number, summary: string, verified: string | null, covers?: string[] }`
  - `ALLOW_UNVERIFIED: boolean`
  - `ORDERED: DocPage[]`, `pageBySlug(slug)`, `pageBySource(source)`, `pagesBySection(sectionId)`, `neighbours(slug)`, `sectionById(id)`

- [ ] **Step 1: Install and confirm the baseline is green**

```bash
cd ~/.cache/lf-worktrees/site-docs-v2
npm ci                                   # root (already done once; harmless)
npm ci --prefix packages/org-os-federation-map
npm ci --prefix site
cd site && rm -rf .astro dist && npm run build && npm test
```

Expected: the build ends with `llms check: … links OK` and exit 0; the tests all pass. If either fails before any change, stop and report — the baseline is not what this plan assumes.

- [ ] **Step 2: Write the failing tests**

Create `site/test/manifest.test.mjs`:

```js
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

test("the eleven addresses the site already serves are kept", () => {
  for (const slug of ["architecture", "modules", "agentic-architecture", "federation", "ecosystem", "data-model", "eip4824", "package-lifecycle", "operator-guide", "adopt-with-an-agent", "rad-org-os"]) {
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
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd site && node --test test/manifest.test.mjs`
Expected: FAIL — `Cannot find module …/src/lib/manifest.mjs`.

- [ ] **Step 4: Write `site/src/lib/manifest.mjs`**

```js
// manifest.mjs — pure functions over a docs manifest. No filesystem, no git:
// callers pass those in, so this is testable without either.

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const SHA = /^[0-9a-f]{7,40}$/;
const filled = (v) => typeof v === "string" && v.trim() !== "";

/** Pages in reading order: by the order of `sections`, then by `order`. */
export function sortPages(pages, sections) {
  const rank = new Map(sections.map((s, i) => [s.id, i]));
  return [...pages].sort(
    (a, b) => (rank.get(a.section) ?? 999) - (rank.get(b.section) ?? 999) || a.order - b.order,
  );
}

/** The pages before and after `slug` in reading order. */
export function neighboursOf(pages, sections, slug) {
  const ordered = sortPages(pages, sections);
  const i = ordered.findIndex((p) => p.slug === slug);
  if (i === -1) return { prev: null, next: null };
  return { prev: ordered[i - 1] ?? null, next: ordered[i + 1] ?? null };
}

/**
 * Every problem in a manifest, as messages a person can act on.
 * @param {{ fileExists: (path: string) => boolean, commitExists: (sha: string) => boolean, allowUnverified: boolean }} io
 */
export function validateManifest(pages, sections, { fileExists, commitExists, allowUnverified }) {
  const problems = [];
  const sectionIds = new Set(sections.map((s) => s.id));
  const slugs = new Set();
  const sources = new Set();

  for (const p of pages) {
    const at = `manifest: ${p.source || p.slug || "(unnamed entry)"}`;
    for (const field of ["source", "slug", "title", "summary"]) {
      if (!filled(p[field])) problems.push(`${at} — ${field} is empty`);
    }
    if (filled(p.slug) && !SLUG.test(p.slug)) problems.push(`${at} — slug "${p.slug}" must be lower-case letters, digits and hyphens`);
    if (!sectionIds.has(p.section)) problems.push(`${at} — section "${p.section}" is not one of ${[...sectionIds].join(", ")}`);
    if (!Number.isFinite(p.order)) problems.push(`${at} — order must be a number`);

    if (filled(p.source)) {
      if (p.source.startsWith("/") || p.source.split("/").includes("..")) {
        problems.push(`${at} — source must be a path inside the repository, from its root`);
      } else if (!p.source.endsWith(".md")) {
        problems.push(`${at} — source must be a .md file`);
      } else if (!fileExists(p.source)) {
        problems.push(`${at} — source does not exist`);
      }
    }

    if (slugs.has(p.slug)) problems.push(`${at} — duplicate slug "${p.slug}"`);
    slugs.add(p.slug);
    if (sources.has(p.source)) problems.push(`${at} — duplicate source`);
    sources.add(p.source);

    if (p.verified == null) {
      if (!allowUnverified) problems.push(`${at} — not verified (no commit recorded)`);
    } else if (typeof p.verified !== "string" || !SHA.test(p.verified)) {
      problems.push(`${at} — verified "${p.verified}" is not a commit id`);
    } else if (!commitExists(p.verified)) {
      problems.push(`${at} — verified commit ${p.verified} is not in the repository`);
    }

    if (p.covers !== undefined && !(Array.isArray(p.covers) && p.covers.every(filled))) {
      problems.push(`${at} — covers must be a list of paths`);
    }
  }
  return problems;
}
```

- [ ] **Step 5: Write `site/src/data/docs-manifest.mjs`**

```js
// docs-manifest.mjs — the only place that decides what is on the site.
// The loader, the sidebar, the docs index, llms.txt, the redirects and
// scripts/verify-build.mjs all read this file.
//
// `source` is a path from the repository root and may be outside docs/.
// `verified` is the commit the page was checked against the code at; null
// means not checked yet, which is accepted only while ALLOW_UNVERIFIED is true.
// `covers` (optional) lists the code paths a page describes.
import { sortPages, neighboursOf } from "../lib/manifest.mjs";

/**
 * @typedef {{ source: string, slug: string, title: string, section: string,
 *   order: number, summary: string, verified: string | null, covers?: string[] }} DocPage
 */

export const SECTIONS = [
  { id: "start", title: "Start", summary: "What org-os is and how an instance is set up." },
  { id: "operate", title: "Operate", summary: "Running an instance day to day and keeping it current." },
  { id: "knowledge", title: "Knowledge", summary: "The knowledge management system, its two planes and what it publishes." },
  { id: "modules", title: "Modules", summary: "The catalog of modules and the integrations." },
  { id: "reference", title: "Reference", summary: "The file structure, the data model and the protocols, field by field." },
  { id: "concepts", title: "Concepts", summary: "How the framework is put together, and why." },
];

// Temporary (plan 1). Plan 2 verifies every page and sets this to false; from
// then on a page without a verified commit fails the build.
export const ALLOW_UNVERIFIED = true;

/** @type {DocPage[]} */
export const PAGES = [
  { source: "docs/SETUP.md", slug: "setup", title: "Setup", section: "start", order: 20,
    summary: "Requirements and the steps to set up an instance.", verified: null },
  { source: "docs/ADOPT-WITH-AN-AGENT.md", slug: "adopt-with-an-agent", title: "Adopt with an agent", section: "start", order: 40,
    summary: "The recipe an AI agent follows to create a new instance from the framework.", verified: null },

  { source: "docs/OPERATOR-GUIDE.md", slug: "operator-guide", title: "Operator guide", section: "operate", order: 10,
    summary: "A manual for operators who do not write code.", verified: null },

  { source: "docs/MODULES.md", slug: "modules", title: "Module catalog", section: "modules", order: 10,
    summary: "Every module, what it is, how it works and its status.", verified: null },
  { source: "docs/RAD-ORG-OS.md", slug: "rad-org-os", title: "rad-org-os", section: "modules", order: 30,
    summary: "The Radicle-native distribution of org-os.", verified: null },

  { source: "docs/DATA-MODEL.md", slug: "data-model", title: "Data model", section: "reference", order: 20,
    summary: "The registries under data/ and their fields.", verified: null },
  { source: "docs/FEDERATION.md", slug: "federation", title: "Federation protocol", section: "reference", order: 30,
    summary: "federation.yaml, peers, trust levels and how instances stay in step.", verified: null },
  { source: "docs/EIP4824-GUIDE.md", slug: "eip4824", title: "EIP-4824", section: "reference", order: 40,
    summary: "How an instance publishes EIP-4824 schemas under .well-known/.", verified: null },
  { source: "docs/PACKAGE-LIFECYCLE.md", slug: "package-lifecycle", title: "Package lifecycle", section: "reference", order: 80,
    summary: "How packages are promoted, integrated and retired.", verified: null },

  { source: "docs/ARCHITECTURE.md", slug: "architecture", title: "Architecture", section: "concepts", order: 10,
    summary: "How the framework is put together.", verified: null },
  { source: "docs/AGENTIC-ARCHITECTURE.md", slug: "agentic-architecture", title: "Agentic architecture", section: "concepts", order: 20,
    summary: "How agents operate inside a workspace.", verified: null },
  { source: "docs/ECOSYSTEM.md", slug: "ecosystem", title: "Ecosystem", section: "concepts", order: 60,
    summary: "The projects and repositories around org-os.", verified: null },
];

export const ORDERED = sortPages(PAGES, SECTIONS);
export const sectionById = (id) => SECTIONS.find((s) => s.id === id);
export const pageBySlug = (slug) => PAGES.find((p) => p.slug === slug);
export const pageBySource = (source) => PAGES.find((p) => p.source === source);
export const pagesBySection = (sectionId) => ORDERED.filter((p) => p.section === sectionId);
export const neighbours = (slug) => neighboursOf(PAGES, SECTIONS, slug);
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd site && node --test test/manifest.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add site/src/lib/manifest.mjs site/src/data/docs-manifest.mjs site/test/manifest.test.mjs
git commit -m "feat(site): the docs manifest and its validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Repository facts and the link resolver

**Files:**
- Create: `site/src/lib/repo.mjs`
- Create: `site/src/lib/doc-links.mjs`
- Test: `site/test/doc-links.test.mjs`, `site/test/repo.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces, from `site/src/lib/repo.mjs`:
  - `REPO_URL: string` — `"https://github.com/regen-coordination/org-os-template"`
  - `REPO_ROOT: string` — absolute path of the repository root (`process.cwd()/..`)
  - `VERSION: string` — from the root `package.json`, e.g. `"0.5.0"`
  - `RELEASE_REF: string` — `"v" + VERSION`
  - `listRepoFiles(root = REPO_ROOT) → string[]` — tracked and untracked-but-not-ignored files, `/`-separated, from the root
  - `commitExists(sha, root = REPO_ROOT) → boolean`
- Produces, from `site/src/lib/doc-links.mjs`:
  - `dirsOf(files: Iterable<string>) → Set<string>` — every ancestor directory
  - `resolveDocLink({ url, sourcePath, pages, repoFiles: Set<string>, repoDirs: Set<string>, base, repoUrl, ref, image?: boolean }) → { kind: "external" | "page" | "repo" | "broken", href: string }`

- [ ] **Step 1: Write the failing tests**

Create `site/test/doc-links.test.mjs`:

```js
// site/test/doc-links.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDocLink, dirsOf } from "../src/lib/doc-links.mjs";

const pages = [
  { source: "docs/SETUP.md", slug: "setup" },
  { source: "docs/FEDERATION.md", slug: "federation" },
];
const repoFiles = new Set([
  "docs/SETUP.md", "docs/FEDERATION.md", "docs/QUEUE.md", "docs/img/map.png",
  "docs/superpowers/specs/a design.md", "packages/org-os-kms/docs/CONNECTORS.md", "BOOTSTRAP.md",
]);
const ctx = {
  pages, repoFiles, repoDirs: dirsOf(repoFiles),
  base: "/org-os-template", repoUrl: "https://github.com/o/r", ref: "v0.5.1",
};
const from = (sourcePath, url, extra = {}) => resolveDocLink({ ...ctx, sourcePath, url, ...extra });

test("dirsOf lists every ancestor directory", () => {
  assert.deepEqual([...dirsOf(["a/b/c.md", "a/d.md"])].sort(), ["a", "a/b"]);
});

test("a link to a published page becomes its site address", () => {
  assert.deepEqual(from("docs/SETUP.md", "FEDERATION.md"), { kind: "page", href: "/org-os-template/docs/federation" });
  assert.deepEqual(from("docs/SETUP.md", "./FEDERATION.md"), { kind: "page", href: "/org-os-template/docs/federation" });
});

test("fragments and queries survive", () => {
  assert.equal(from("docs/SETUP.md", "FEDERATION.md#trust-levels").href, "/org-os-template/docs/federation#trust-levels");
  assert.equal(from("docs/SETUP.md", "FEDERATION.md?x=1#y").href, "/org-os-template/docs/federation?x=1#y");
});

test("a link from a file outside docs/ resolves from that file's own folder", () => {
  assert.deepEqual(
    from("packages/org-os-kms/docs/CONNECTORS.md", "../../../docs/FEDERATION.md"),
    { kind: "page", href: "/org-os-template/docs/federation" },
  );
});

test("a link to an unpublished repo file goes to GitHub at the release ref", () => {
  assert.deepEqual(from("docs/SETUP.md", "QUEUE.md#next"), { kind: "repo", href: "https://github.com/o/r/blob/v0.5.1/docs/QUEUE.md#next" });
  assert.deepEqual(from("docs/SETUP.md", "../BOOTSTRAP.md"), { kind: "repo", href: "https://github.com/o/r/blob/v0.5.1/BOOTSTRAP.md" });
});

test("a link to a directory goes to GitHub's tree view", () => {
  assert.deepEqual(from("docs/SETUP.md", "superpowers/specs/"), { kind: "repo", href: "https://github.com/o/r/tree/v0.5.1/docs/superpowers/specs" });
  assert.deepEqual(from("docs/SETUP.md", ".."), { kind: "repo", href: "https://github.com/o/r/tree/v0.5.1" });
});

test("an encoded space resolves to the real file and is re-encoded", () => {
  assert.deepEqual(
    from("docs/SETUP.md", "superpowers/specs/a%20design.md"),
    { kind: "repo", href: "https://github.com/o/r/blob/v0.5.1/docs/superpowers/specs/a%20design.md" },
  );
});

test("a link that resolves to nothing is broken", () => {
  assert.equal(from("docs/SETUP.md", "OPERATOR-GUIDEBOOK.md").kind, "broken");
  assert.equal(from("docs/SETUP.md", "03%20Libraries/org-os/docs/EIP4824-GUIDE.md").kind, "broken");
});

test("a link that leaves the repository is broken", () => {
  assert.equal(from("docs/SETUP.md", "../../koi-net/").kind, "broken");
  assert.equal(from("docs/SETUP.md", "../..").kind, "broken");
});

test("a malformed escape is broken, not a crash", () => {
  assert.equal(from("docs/SETUP.md", "bad%ZZ.md").kind, "broken");
});

test("absolute and external links are left alone", () => {
  for (const url of ["https://example.org/x.md", "mailto:a@b.c", "#section", "/docs/setup", "//cdn.example.org/x.js"]) {
    assert.deepEqual(from("docs/SETUP.md", url), { kind: "external", href: url });
  }
});

test("an image in the repo is served raw; a page is never used as an image", () => {
  assert.deepEqual(from("docs/SETUP.md", "img/map.png", { image: true }), { kind: "repo", href: "https://raw.githubusercontent.com/o/r/v0.5.1/docs/img/map.png" });
  assert.equal(from("docs/SETUP.md", "FEDERATION.md", { image: true }).href, "https://raw.githubusercontent.com/o/r/v0.5.1/docs/FEDERATION.md");
});

test("an empty base path still gives a root-absolute address", () => {
  assert.equal(from("docs/SETUP.md", "FEDERATION.md", { base: "" }).href, "/docs/federation");
});
```

Create `site/test/repo.test.mjs`:

```js
// site/test/repo.test.mjs — runs from site/ (npm test), inside a git checkout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, REPO_URL, VERSION, RELEASE_REF, listRepoFiles, commitExists } from "../src/lib/repo.mjs";

test("the root is the repository, not the site folder", () => {
  assert.ok(existsSync(join(REPO_ROOT, "federation.yaml")));
  assert.ok(existsSync(join(REPO_ROOT, "site", "astro.config.mjs")));
});

test("version and ref come from the root package.json", () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+/);
  assert.equal(RELEASE_REF, `v${VERSION}`);
  assert.equal(REPO_URL, "https://github.com/regen-coordination/org-os-template");
});

test("the file list is repo-relative, uses forward slashes and skips ignored files", () => {
  const files = listRepoFiles();
  assert.ok(files.includes("docs/SETUP.md"));
  assert.ok(files.includes("site/astro.config.mjs"));
  assert.ok(!files.some((f) => f.includes("node_modules/")));
  assert.ok(!files.some((f) => f.includes("\\")));
});

test("commitExists tells a real commit from a made-up one", () => {
  assert.equal(commitExists("HEAD"), true);
  assert.equal(commitExists("0000000000000000000000000000000000000000"), false);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd site && node --test test/doc-links.test.mjs test/repo.test.mjs`
Expected: FAIL — `Cannot find module …/src/lib/doc-links.mjs` (and `repo.mjs`).

- [ ] **Step 3: Write `site/src/lib/doc-links.mjs`**

```js
// doc-links.mjs — resolve one link found in one markdown file.
//
// Docs link to each other as files ("[x](FEDERATION.md)"). That is right in
// the repository and wrong on the site. Pure: everything it needs is passed in.
import { posix } from "node:path";

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

/** Every ancestor directory of a list of repo-relative files. */
export function dirsOf(files) {
  const dirs = new Set();
  for (const f of files) {
    let d = posix.dirname(f);
    while (d !== "." && !dirs.has(d)) { dirs.add(d); d = posix.dirname(d); }
  }
  return dirs;
}

/**
 * @param {{ url: string, sourcePath: string, pages: { source: string, slug: string }[],
 *   repoFiles: Set<string>, repoDirs: Set<string>, base: string, repoUrl: string,
 *   ref: string, image?: boolean }} input
 * @returns {{ kind: "external" | "page" | "repo" | "broken", href: string }}
 */
export function resolveDocLink({ url, sourcePath, pages, repoFiles, repoDirs, base, repoUrl, ref, image = false }) {
  if (SCHEME.test(url) || url.startsWith("#") || url.startsWith("/")) return { kind: "external", href: url };

  const cut = url.search(/[#?]/);
  const rawPath = cut === -1 ? url : url.slice(0, cut);
  const tail = cut === -1 ? "" : url.slice(cut);

  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { return { kind: "broken", href: url }; }

  const target = posix.normalize(posix.join(posix.dirname(sourcePath), decoded)).replace(/\/$/, "");
  if (target === ".." || target.startsWith("../")) return { kind: "broken", href: url };

  if (image) {
    if (!repoFiles.has(target)) return { kind: "broken", href: url };
    const raw = repoUrl.replace("https://github.com/", "https://raw.githubusercontent.com/");
    return { kind: "repo", href: `${raw}/${ref}/${encodePath(target)}` };
  }

  const page = pages.find((p) => p.source === target);
  if (page) return { kind: "page", href: `${base}/docs/${page.slug}${tail}` };
  if (repoFiles.has(target)) return { kind: "repo", href: `${repoUrl}/blob/${ref}/${encodePath(target)}${tail}` };
  if (target === ".") return { kind: "repo", href: `${repoUrl}/tree/${ref}` };
  if (repoDirs.has(target)) return { kind: "repo", href: `${repoUrl}/tree/${ref}/${encodePath(target)}` };
  return { kind: "broken", href: url };
}
```

Note: `"//cdn.example.org/x.js"` is caught by the `startsWith("/")` test, which is what "left alone" requires.

- [ ] **Step 4: Write `site/src/lib/repo.mjs`**

```js
// repo.mjs — facts about the repository the site is built from.
//
// The site is built and tested from site/ (see README), so the repository root
// is process.cwd()/.. — the same assumption index.astro and modules.astro
// already make. Do not use import.meta.url here: Vite bundles this module and
// the URL would point into the build output.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const REPO_URL = "https://github.com/regen-coordination/org-os-template";
export const REPO_ROOT = resolve(process.cwd(), "..");
export const VERSION = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version;
/** The git ref links into the repository point at. The tag is pushed at release. */
export const RELEASE_REF = `v${VERSION}`;

/** Tracked files plus untracked ones that are not ignored, from the root. */
export function listRepoFiles(root = REPO_ROOT) {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

/** True when `sha` names a commit that is present in this checkout. */
export function commitExists(sha, root = REPO_ROOT) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd site && node --test test/doc-links.test.mjs test/repo.test.mjs`
Expected: PASS, 13 + 4 tests.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/doc-links.mjs site/src/lib/repo.mjs site/test/doc-links.test.mjs site/test/repo.test.mjs
git commit -m "feat(site): resolve links between docs, and repository facts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Load from the manifest, rewrite links, drop the allowlist

After this task the site builds from the manifest, links between docs work, and each doc page has one `h1`. The page still uses the plain layout; Task 4 replaces it.

**Files:**
- Create: `site/src/lib/remark-doc-links.mjs`, `site/src/lib/remark-strip-title.mjs`
- Test: `site/test/remark-plugins.test.mjs`
- Modify: `site/src/content.config.ts`, `site/astro.config.mjs`, `site/src/pages/docs/[...slug].astro`, `site/src/pages/docs/index.astro`, `site/src/pages/llms.txt.ts`, `scripts/render-templates.mjs:40` (a comment)
- Modify: `docs/ECOSYSTEM.md`, `docs/EIP4824-GUIDE.md`, `docs/SETUP.md` (dead links only)
- Delete: `site/src/data/docs-allowlist.ts`

**Interfaces:**
- Consumes: `resolveDocLink`, `dirsOf` (Task 2); `PAGES`, `SECTIONS`, `pageBySource`, `pagesBySection` (Task 1); `REPO_ROOT`, `REPO_URL`, `RELEASE_REF`, `listRepoFiles` (Task 2).
- Produces:
  - `rewriteTree(tree, { sourcePath, pages, repoFiles, repoDirs, base, repoUrl, ref }) → string[]` — rewrites `link`, `definition` and `image` nodes in place; returns the broken URLs.
  - `default remarkDocLinks({ pages, repoRoot, base, repoUrl, ref, listFiles })` — remark plugin; throws on a broken link, naming the file.
  - `default remarkStripTitle()` — remark plugin; removes a leading `h1`.
  - The `docs` collection: entry `id` equals the manifest `source` exactly.

- [ ] **Step 1: Write the failing tests**

Create `site/test/remark-plugins.test.mjs`:

```js
// site/test/remark-plugins.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import remarkDocLinks, { rewriteTree } from "../src/lib/remark-doc-links.mjs";
import remarkStripTitle from "../src/lib/remark-strip-title.mjs";
import { dirsOf } from "../src/lib/doc-links.mjs";

const pages = [{ source: "docs/SETUP.md", slug: "setup" }, { source: "docs/FEDERATION.md", slug: "federation" }];
const files = ["docs/SETUP.md", "docs/FEDERATION.md", "docs/QUEUE.md", "docs/img/a.png"];
const ctx = { pages, repoFiles: new Set(files), repoDirs: dirsOf(files), base: "/b", repoUrl: "https://github.com/o/r", ref: "v1" };
const link = (url) => ({ type: "link", url, children: [{ type: "text", value: "x" }] });
const para = (...children) => ({ type: "paragraph", children });
const root = (...children) => ({ type: "root", children });

test("rewriteTree rewrites links, definitions and images at any depth", () => {
  const tree = root(
    para(link("FEDERATION.md#a"), { type: "image", url: "img/a.png" }),
    { type: "list", children: [{ type: "listItem", children: [para(link("QUEUE.md"))] }] },
    { type: "definition", identifier: "s", url: "SETUP.md" },
    para(link("https://example.org")),
  );
  const broken = rewriteTree(tree, { ...ctx, sourcePath: "docs/SETUP.md" });
  assert.deepEqual(broken, []);
  assert.equal(tree.children[0].children[0].url, "/b/docs/federation#a");
  assert.equal(tree.children[0].children[1].url, "https://raw.githubusercontent.com/o/r/v1/docs/img/a.png");
  assert.equal(tree.children[1].children[0].children[0].children[0].url, "https://github.com/o/r/blob/v1/docs/QUEUE.md");
  assert.equal(tree.children[2].url, "/b/docs/setup");
  assert.equal(tree.children[3].children[0].url, "https://example.org");
});

test("rewriteTree returns every broken link and leaves it untouched", () => {
  const tree = root(para(link("NOPE.md"), link("../../outside/")));
  assert.deepEqual(rewriteTree(tree, { ...ctx, sourcePath: "docs/SETUP.md" }), ["NOPE.md", "../../outside/"]);
  assert.equal(tree.children[0].children[0].url, "NOPE.md");
});

const plugin = (over = {}) => remarkDocLinks({ ...ctx, repoRoot: "/repo", listFiles: () => files, ...over });

test("the plugin takes the source path from a file URL, as Astro passes it", () => {
  const tree = root(para(link("FEDERATION.md")));
  plugin()(tree, { path: pathToFileURL(join("/repo", "docs", "SETUP.md")) });
  assert.equal(tree.children[0].children[0].url, "/b/docs/federation");
});

test("the plugin also accepts a plain path string", () => {
  const tree = root(para(link("FEDERATION.md")));
  plugin()(tree, { path: join("/repo", "docs", "SETUP.md") });
  assert.equal(tree.children[0].children[0].url, "/b/docs/federation");
});

test("the plugin fails the build on a broken link, naming file and link", () => {
  const tree = root(para(link("NOPE.md")));
  assert.throws(() => plugin()(tree, { path: join("/repo", "docs", "SETUP.md") }), /docs\/SETUP\.md[\s\S]*NOPE\.md/);
});

test("the plugin refuses to guess when it is given no source path", () => {
  assert.throws(() => plugin()(root(para(link("FEDERATION.md"))), {}), /no source path/);
});

test("the plugin lists the repository's files once, not once per page", () => {
  let calls = 0;
  const p = plugin({ listFiles: () => { calls++; return files; } });
  p(root(), { path: "/repo/docs/SETUP.md" });
  p(root(), { path: "/repo/docs/FEDERATION.md" });
  assert.equal(calls, 1);
});

test("strip-title removes a leading h1 and nothing else", () => {
  const h = (depth, value) => ({ type: "heading", depth, children: [{ type: "text", value }] });
  const a = root(h(1, "Title"), para(), h(2, "Next"));
  remarkStripTitle()(a);
  assert.deepEqual(a.children.map((n) => n.type + (n.depth ?? "")), ["paragraph", "heading2"]);

  const b = root(para(), h(1, "Late title"));
  remarkStripTitle()(b);
  assert.equal(b.children.length, 2, "an h1 that is not first is kept");

  const c = root(h(2, "No h1"));
  remarkStripTitle()(c);
  assert.equal(c.children.length, 1);

  const d = root({ type: "html", value: "<!-- note -->" }, h(1, "Title"), para());
  remarkStripTitle()(d);
  assert.deepEqual(d.children.map((n) => n.type), ["html", "paragraph"], "a leading comment does not hide the title");
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd site && node --test test/remark-plugins.test.mjs`
Expected: FAIL — `Cannot find module …/src/lib/remark-doc-links.mjs`.

- [ ] **Step 3: Write `site/src/lib/remark-doc-links.mjs`**

```js
// remark-doc-links.mjs — rewrite file links in a doc into addresses that work
// on the site, and stop the build on one that goes nowhere. See doc-links.mjs.
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDocLink, dirsOf } from "./doc-links.mjs";

function walk(node, visit) {
  visit(node);
  if (Array.isArray(node.children)) for (const child of node.children) walk(child, visit);
}

/** Rewrites in place. Returns the URLs that resolve to nothing. */
export function rewriteTree(tree, { sourcePath, pages, repoFiles, repoDirs, base, repoUrl, ref }) {
  const broken = [];
  walk(tree, (node) => {
    if (node.type !== "link" && node.type !== "definition" && node.type !== "image") return;
    if (typeof node.url !== "string" || node.url === "") return;
    const out = resolveDocLink({
      url: node.url, sourcePath, pages, repoFiles, repoDirs, base, repoUrl, ref,
      image: node.type === "image",
    });
    if (out.kind === "broken") broken.push(node.url);
    else node.url = out.href;
  });
  return broken;
}

// Astro hands remark the source as a file: URL object; plain remark uses a
// string. Accept both.
function toPath(value) {
  if (value instanceof URL) return fileURLToPath(value);
  if (typeof value === "string" && value.startsWith("file:")) return fileURLToPath(value);
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * @param {{ pages: { source: string, slug: string }[], repoRoot: string, base: string,
 *   repoUrl: string, ref: string, listFiles: () => string[] }} options
 */
export default function remarkDocLinks({ pages, repoRoot, base, repoUrl, ref, listFiles }) {
  let repoFiles;
  let repoDirs;
  return (tree, file) => {
    const abs = toPath(file?.path ?? file?.history?.[0]);
    if (!abs) throw new Error("remark-doc-links: no source path on the file, so relative links cannot be resolved");
    if (!repoFiles) { repoFiles = new Set(listFiles()); repoDirs = dirsOf(repoFiles); }
    const sourcePath = relative(repoRoot, abs).split(sep).join("/");
    const broken = rewriteTree(tree, { sourcePath, pages, repoFiles, repoDirs, base, repoUrl, ref });
    if (broken.length > 0) {
      throw new Error(`Broken link(s) in ${sourcePath}:\n${broken.map((u) => `  → ${u}`).join("\n")}`);
    }
  };
}
```

- [ ] **Step 4: Write `site/src/lib/remark-strip-title.mjs`**

```js
// remark-strip-title.mjs — every doc opens with its own "# Title". The docs
// layout prints the title from the manifest, so the document's leading h1 is
// dropped to leave one h1 on the page. An h1 further down is left alone.
export default function remarkStripTitle() {
  return (tree) => {
    const i = tree.children.findIndex((n) => n.type !== "html" && n.type !== "yaml");
    if (i !== -1 && tree.children[i].type === "heading" && tree.children[i].depth === 1) {
      tree.children.splice(i, 1);
    }
  };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd site && node --test test/remark-plugins.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 6: Point the loader at the manifest**

Replace `site/src/content.config.ts` with:

```ts
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { PAGES } from "./data/docs-manifest.mjs";

// Loads exactly the files the manifest names, from the repository root (one
// level above this Astro project). Nothing is copied into site/.
// generateId keeps the path as written, so an entry's id equals its manifest
// `source` — the default would slugify and lower-case it.
const docs = defineCollection({
  loader: glob({
    base: "..",
    pattern: PAGES.map((p) => p.source),
    generateId: ({ entry }) => entry,
  }),
});

export const collections = { docs };
```

- [ ] **Step 7: Register the plugins**

Replace `site/astro.config.mjs` with:

```js
import { defineConfig } from "astro/config";
import { SITE_ORIGIN, BASE_PATH } from "./base.config.mjs";
import { PAGES } from "./src/data/docs-manifest.mjs";
import { REPO_ROOT, REPO_URL, RELEASE_REF, listRepoFiles } from "./src/lib/repo.mjs";
import remarkDocLinks from "./src/lib/remark-doc-links.mjs";
import remarkStripTitle from "./src/lib/remark-strip-title.mjs";

export default defineConfig({
  // Deployed as a GitHub Pages *project* page, so the site lives under a
  // sub-path. `base` is what makes import.meta.env.BASE_URL (and therefore
  // src/lib/base.ts's withBase) resolve correctly. See base.config.mjs.
  site: SITE_ORIGIN,
  base: BASE_PATH,
  output: "static",
  build: { format: "directory" },
  markdown: {
    remarkPlugins: [
      remarkStripTitle,
      // Markdown is rendered outside the page pipeline, so withBase() is not
      // available to it; the plugin is given the base path directly.
      [remarkDocLinks, {
        pages: PAGES, repoRoot: REPO_ROOT, base: BASE_PATH,
        repoUrl: REPO_URL, ref: RELEASE_REF, listFiles: listRepoFiles,
      }],
    ],
  },
  vite: { server: { fs: { allow: [".."] } } },  // dev server may import ../packages/*
});
```

- [ ] **Step 8: Route from the manifest**

Replace `site/src/pages/docs/[...slug].astro` with:

```astro
---
import { getCollection, render } from "astro:content";
import Layout from "../../components/Layout.astro";
import { PAGES, pageBySource, sectionById } from "../../data/docs-manifest.mjs";

export async function getStaticPaths() {
  const all = await getCollection("docs");
  // The manifest decides; the loader must agree with it exactly. A source that
  // exists but did not load (wrong case, a pattern that matched nothing) would
  // otherwise publish one page fewer without a word.
  const loaded = new Set(all.map((entry) => entry.id));
  const missing = PAGES.filter((p) => !loaded.has(p.source)).map((p) => p.source);
  if (missing.length > 0) throw new Error(`docs: in the manifest but not loaded:\n  ${missing.join("\n  ")}`);
  return all.map((entry) => {
    const page = pageBySource(entry.id);
    if (!page) throw new Error(`docs: loaded ${entry.id}, which is not in the manifest`);
    return { params: { slug: page.slug }, props: { entry, page } };
  });
}
const { entry, page } = Astro.props;
const { Content } = await render(entry);
---
<Layout title={page.title} description={page.summary} current="docs">
  <div class="container prose">
    <p class="eyebrow">{sectionById(page.section).title}</p>
    <h1>{page.title}</h1>
    <article class="doc"><Content /></article>
  </div>
</Layout>
<style>
.doc :global(h2) { margin-top: var(--space-8); }
.doc :global(pre) { background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: var(--radius); padding: var(--space-4); overflow-x: auto; }
.doc :global(code) { font-size: var(--text-sm); }
</style>
```

- [ ] **Step 9: Move the docs index and `llms.txt` off the allowlist**

Replace `site/src/pages/docs/index.astro` with (Task 7 restyles it; this keeps it building):

```astro
---
import Layout from "../../components/Layout.astro";
import { withBase } from "../../lib/base";
import { SECTIONS, pagesBySection } from "../../data/docs-manifest.mjs";
const sections = SECTIONS.map((s) => ({ ...s, pages: pagesBySection(s.id) })).filter((s) => s.pages.length > 0);
---
<Layout title="Docs" current="docs" description="org-os documentation for operators of instances.">
  <div class="container prose">
    <p class="eyebrow">Documentation</p>
    <h1>Docs</h1>
    {sections.map((s) => (
      <section>
        <h2>{s.title}</h2>
        <ul>
          {s.pages.map((p) => (
            <li><a href={withBase(`/docs/${p.slug}`)}>{p.title}</a> — {p.summary}</li>
          ))}
        </ul>
      </section>
    ))}
  </div>
</Layout>
```

In `site/src/pages/llms.txt.ts`, replace the import of the allowlist and the `## Docs` lines:

```ts
import type { APIRoute } from "astro";
import { SECTIONS, pagesBySection } from "../data/docs-manifest.mjs";
import { withBase } from "../lib/base";

export const GET: APIRoute = ({ site }) => {
  // `site` is the origin only — Astro keeps `base` out of it — so every path
  // still has to go through withBase or these URLs 404 on the project page.
  const origin = site?.toString().replace(/\/$/, "") ?? "";
  const url = (path: string) => `${origin}${withBase(path)}`;
  const docs = SECTIONS.flatMap((s) => {
    const pages = pagesBySection(s.id);
    if (pages.length === 0) return [];
    return [`### ${s.title}`, ...pages.map((p) => `- [${p.title}](${url(`/docs/${p.slug}`)}): ${p.summary}`), ""];
  });
  const lines = [
    "# org-os",
    "> The agent-native org operating system — framework, standards, and orchestration hub for a federation of regenerative organizations.",
    "",
    "## Pages",
    `- [Home](${url("/")}): the front door to the documentation`,
    `- [Modules](${url("/modules")}): the module catalog with each module's status`,
    `- [rad-org-os](${url("/modules/rad-org-os")}): sovereign Radicle-native distribution`,
    `- [Federation](${url("/federation")}): live network of instances`,
    "",
    "## Docs",
    "",
    ...docs,
    "## Machine-readable",
    `- [Federation data](${url("/federation.json")}): aggregated instance registry + edges`,
    `- [dao.json](${url("/.well-known/dao.json")}): the EIP-4824 entry point; its sibling schemas sit beside it`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
```

Delete the allowlist and fix the comment that names it:

```bash
git rm site/src/data/docs-allowlist.ts
```

In `scripts/render-templates.mjs` line 40, change `site/src/data/docs-allowlist.ts` to `site/src/data/docs-manifest.mjs` in the comment. Nothing else on that line changes.

- [ ] **Step 10: Build, and read the list of dead links**

Run: `cd site && rm -rf .astro dist && npm run build`
Expected: FAIL — `Broken link(s) in docs/…` for the first of `docs/ECOSYSTEM.md`, `docs/EIP4824-GUIDE.md`, `docs/SETUP.md`. These files link to folders outside the repository and to files that do not exist; the links were always dead on the site.

- [ ] **Step 11: Repair the dead links**

Two links in `docs/SETUP.md` have an obvious right target. Repoint them:

- `](OPERATOR-GUIDEBOOK.md)` → `](OPERATOR-GUIDE.md)`
- `](03%20Libraries/org-os/docs/EIP4824-GUIDE.md)` → `](EIP4824-GUIDE.md)`

Every other dead link is unlinked — the visible text stays, the link goes. Save this as a one-off script outside the repo and run it from the repository root:

```bash
cat > /tmp/unlink-dead.mjs <<'EOF'
// One-off: turn "[text](dead-url)" into "text" for links whose target is not
// in this repository. Run from the repository root. Not committed.
import { readFileSync, writeFileSync } from "node:fs";
const dead = {
  "docs/ECOSYSTEM.md": [
    "../../quartz-refi-template/", "../../openclaw-source/", "../../regen_eliza-refi_dao/",
    "../../koi-net/", "../../koi-net-integration/", "../../regen-coordination-hub/",
    "../../Regenerant-Catalunya/", "../../Local-ReFi-Toolkit/", "../../ReFi-BCN-Website/",
    "../../ReFi-DAO-Website/", "../../ReFi-Mediterranean/", "../../ReFi-Barcelona/",
    "../../regen-toolkit/", "../../regen-toolkit-interface/", "../../becoming-constellations/",
    "../../refi-vision-forum-posts/",
  ],
  "docs/EIP4824-GUIDE.md": [
    "../packages/web3/on-chain-registration/",
    "../../organizational-os-framework/docs/02-standards/eip-4824-integration.md",
    "../../organizational-os-framework/schemas/",
  ],
  "docs/SETUP.md": [
    "../../organizational-os/packages/framework/",
    "../../organizational-os/packages/framework/docs/",
  ],
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
for (const [file, urls] of Object.entries(dead)) {
  let text = readFileSync(file, "utf8");
  for (const url of urls) {
    const re = new RegExp(`\\[([^\\]]*)\\]\\(${esc(url)}\\)`, "g");
    const before = text;
    text = text.replace(re, "$1");
    if (text === before) console.error(`NOT FOUND in ${file}: ${url}`);
  }
  writeFileSync(file, text);
  console.log(`${file}: done`);
}
EOF
node /tmp/unlink-dead.mjs
git diff --stat docs/
```

Expected: three files changed, no `NOT FOUND` line. A `NOT FOUND` means the link is written another way in that file (a reference-style link, a trailing title): open the file, find it, and unlink it by hand the same way.

- [ ] **Step 12: Build until it passes**

Run: `cd site && rm -rf .astro dist && npm run build`
Expected: PASS. If the build names a dead link not listed in Step 11 (the list came from a text scan; the build is the authority), unlink it the same way — keep the text, drop the link — and rebuild. Record each extra one in the commit message.

Then confirm by hand:

```bash
grep -o 'href="[^"]*adopt-with-an-agent[^"]*"' dist/docs/operator-guide/index.html | head -3
grep -o '<h1' dist/docs/setup/index.html | wc -l
ls dist/docs
```

Expected: an `href="/org-os-template/docs/adopt-with-an-agent…"`; exactly `1`; thirteen entries (twelve page folders and `index.html`).

- [ ] **Step 13: Run all tests and commit**

Run: `cd site && npm test`
Expected: PASS.

```bash
git add -A site/src site/test site/astro.config.mjs scripts/render-templates.mjs docs/ECOSYSTEM.md docs/EIP4824-GUIDE.md docs/SETUP.md
git commit -m "feat(site): load docs from the manifest and make links between them work

The loader reads exactly the manifest's files; a remark plugin turns file
links into site addresses or GitHub links and fails the build on a dead one;
each page keeps one h1. Dead links to folders outside the repository are
unlinked in ECOSYSTEM, EIP4824-GUIDE and SETUP; two in SETUP are repointed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The docs layout and the feedback links

**Files:**
- Create: `site/src/lib/feedback.mjs`
- Test: `site/test/feedback.test.mjs`
- Create: `site/src/components/DocsSidebar.astro`, `DocsToc.astro`, `DocsFooter.astro`, `DocsLayout.astro`
- Modify: `site/src/pages/docs/[...slug].astro`

**Interfaces:**
- Consumes: `SECTIONS`, `pagesBySection`, `sectionById`, `neighbours` (Task 1); `REPO_URL` (Task 2); `withBase` (`src/lib/base.ts`).
- Produces:
  - `feedbackUrl({ kind: "useful" | "not-useful" | "problem", title, source, verified, repoUrl }) → string`
  - `<DocsLayout page={DocPage} headings={{ depth: number, slug: string, text: string }[]}>` with the article body as its default slot. The article element carries `data-pagefind-body` (Task 6 relies on it).

- [ ] **Step 1: Write the failing test**

Create `site/test/feedback.test.mjs`:

```js
// site/test/feedback.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { feedbackUrl } from "../src/lib/feedback.mjs";

const base = { title: "Setup", source: "docs/SETUP.md", verified: "abc1234", repoUrl: "https://github.com/o/r" };
const parse = (u) => new URL(u);

test("the link opens a new issue on the repository with the label", () => {
  const u = parse(feedbackUrl({ ...base, kind: "problem" }));
  assert.equal(u.origin + u.pathname, "https://github.com/o/r/issues/new");
  assert.equal(u.searchParams.get("labels"), "docs-feedback");
});

test("the issue names the page, its source and the commit it was checked at", () => {
  const u = parse(feedbackUrl({ ...base, kind: "problem" }));
  assert.equal(u.searchParams.get("title"), "Docs — Problem: Setup");
  const body = u.searchParams.get("body");
  assert.match(body, /Page: Setup/);
  assert.match(body, /Source: docs\/SETUP\.md/);
  assert.match(body, /Checked against: abc1234/);
});

test("each kind has its own title and prompt", () => {
  assert.equal(parse(feedbackUrl({ ...base, kind: "useful" })).searchParams.get("title"), "Docs — Useful: Setup");
  assert.equal(parse(feedbackUrl({ ...base, kind: "not-useful" })).searchParams.get("title"), "Docs — Not useful: Setup");
  assert.match(parse(feedbackUrl({ ...base, kind: "not-useful" })).searchParams.get("body"), /What were you looking for/);
});

test("an unverified page says so instead of printing null", () => {
  const body = parse(feedbackUrl({ ...base, verified: null, kind: "useful" })).searchParams.get("body");
  assert.match(body, /Checked against: not yet verified/);
  assert.doesNotMatch(body, /null/);
});

test("titles with reserved characters survive the round trip", () => {
  const u = parse(feedbackUrl({ ...base, title: "Q&A #1 — 100% + more", kind: "problem" }));
  assert.equal(u.searchParams.get("title"), "Docs — Problem: Q&A #1 — 100% + more");
});

test("an unknown kind is an error, not a silent default", () => {
  assert.throws(() => feedbackUrl({ ...base, kind: "meh" }), /unknown kind/);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd site && node --test test/feedback.test.mjs`
Expected: FAIL — `Cannot find module …/src/lib/feedback.mjs`.

- [ ] **Step 3: Write `site/src/lib/feedback.mjs`**

```js
// feedback.mjs — feedback is a prefilled GitHub issue. No backend, no script,
// nothing stored: the reader decides whether to send it.
const KINDS = {
  useful: { head: "Useful", prompt: "What worked? (optional)" },
  "not-useful": { head: "Not useful", prompt: "What were you looking for, and what was missing?" },
  problem: { head: "Problem", prompt: "What is wrong on this page? Quote the line if you can." },
};

/** @param {{ kind: string, title: string, source: string, verified: string | null, repoUrl: string }} input */
export function feedbackUrl({ kind, title, source, verified, repoUrl }) {
  const k = KINDS[kind];
  if (!k) throw new Error(`feedbackUrl: unknown kind "${kind}"`);
  const params = new URLSearchParams({
    labels: "docs-feedback",
    title: `Docs — ${k.head}: ${title}`,
    body: [
      `Page: ${title}`,
      `Source: ${source}`,
      `Checked against: ${verified ?? "not yet verified"}`,
      "",
      k.prompt,
      "",
    ].join("\n"),
  });
  return `${repoUrl}/issues/new?${params}`;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd site && node --test test/feedback.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write `site/src/components/DocsSidebar.astro`**

```astro
---
// The six sections and their pages, from the manifest. Rendered twice by
// DocsLayout (a column on wide screens, a disclosure on narrow ones); CSS shows
// one of them, so only one is ever in the accessibility tree.
import { withBase } from "../lib/base";
import { SECTIONS, pagesBySection } from "../data/docs-manifest.mjs";
interface Props { current: string; }
const { current } = Astro.props;
const sections = SECTIONS.map((s) => ({ ...s, pages: pagesBySection(s.id) })).filter((s) => s.pages.length > 0);
---
<nav class="docs-sidebar" aria-label="Documentation">
  {sections.map((s) => (
    <section>
      <h2 class="label">{s.title}</h2>
      <ul>
        {s.pages.map((p) => (
          <li>
            <a href={withBase(`/docs/${p.slug}`)} class:list={{ active: p.slug === current }}
               aria-current={p.slug === current ? "page" : undefined}>{p.title}</a>
          </li>
        ))}
      </ul>
    </section>
  ))}
</nav>
<style>
.docs-sidebar { display: flex; flex-direction: column; gap: var(--space-6); font-size: var(--text-sm); }
.docs-sidebar h2 { font-size: var(--text-2xs); font-weight: 500; color: var(--color-muted); margin-bottom: var(--space-2); }
.docs-sidebar ul { list-style: none; padding: 0; display: flex; flex-direction: column; }
.docs-sidebar a {
  display: block; padding: var(--space-1) var(--space-3); color: var(--color-ink-2);
  border-left: 2px solid var(--color-line); transition: color var(--t-fast), border-color var(--t-fast);
}
.docs-sidebar a:hover { color: var(--color-ink); border-left-color: var(--color-line-2); }
.docs-sidebar a.active { color: var(--color-accent); border-left-color: var(--color-accent); font-weight: 500; }
</style>
```

- [ ] **Step 6: Write `site/src/components/DocsToc.astro`**

```astro
---
// On-page contents from the page's h2 and h3. A page with fewer than three is
// short enough to scan, so nothing is rendered. Open by default; the script in
// DocsLayout closes it on a narrow screen.
interface Heading { depth: number; slug: string; text: string; }
interface Props { headings: Heading[]; }
const items = Astro.props.headings.filter((h) => h.depth === 2 || h.depth === 3);
---
{items.length >= 3 && (
  <details class="docs-toc" open data-pagefind-ignore>
    <summary class="label">On this page</summary>
    <ul>
      {items.map((h) => (
        <li class:list={{ sub: h.depth === 3 }}><a href={`#${h.slug}`}>{h.text}</a></li>
      ))}
    </ul>
  </details>
)}
<style>
.docs-toc { font-size: var(--text-sm); }
.docs-toc summary { cursor: pointer; color: var(--color-muted); margin-bottom: var(--space-2); }
.docs-toc ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.docs-toc a { color: var(--color-muted); }
.docs-toc a:hover { color: var(--color-accent); }
.docs-toc .sub { padding-left: var(--space-4); }
</style>
```

- [ ] **Step 7: Write `site/src/components/DocsFooter.astro`**

```astro
---
// Under every doc: previous and next, where the page comes from and what it
// was checked against, and the feedback links.
import { withBase } from "../lib/base";
import { neighbours } from "../data/docs-manifest.mjs";
import { REPO_URL } from "../lib/repo.mjs";
import { feedbackUrl } from "../lib/feedback.mjs";
interface Props { page: { source: string; slug: string; title: string; verified: string | null }; }
const { page } = Astro.props;
const { prev, next } = neighbours(page.slug);
const fb = (kind: string) => feedbackUrl({ kind, title: page.title, source: page.source, verified: page.verified, repoUrl: REPO_URL });
---
<footer class="docs-footer" data-pagefind-ignore>
  <nav class="pager" aria-label="Previous and next page">
    {prev ? <a class="prev" href={withBase(`/docs/${prev.slug}`)}><span class="label">Previous</span>{prev.title}</a> : <span></span>}
    {next ? <a class="next" href={withBase(`/docs/${next.slug}`)}><span class="label">Next</span>{next.title}</a> : <span></span>}
  </nav>
  <p class="meta mono">
    {page.verified
      ? <span>Checked against <a class="link" href={`${REPO_URL}/commit/${page.verified}`}><code>{page.verified.slice(0, 7)}</code></a></span>
      : <span>Not yet checked against the code</span>}
    <span aria-hidden="true"> · </span>
    <a class="link" href={`${REPO_URL}/edit/main/${page.source}`}>Edit this page</a>
  </p>
  <p class="feedback">
    Was this page useful?
    <a class="link" href={fb("useful")}>Yes</a>
    <a class="link" href={fb("not-useful")}>No</a>
    <span aria-hidden="true"> · </span>
    <a class="link" href={fb("problem")}>Report a problem with this page</a>
  </p>
</footer>
<style>
.docs-footer { margin-top: var(--space-16); padding-top: var(--space-6); border-top: var(--border-hair) solid var(--color-line-2);
  display: flex; flex-direction: column; gap: var(--space-4); font-size: var(--text-sm); color: var(--color-muted); }
.pager { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }
.pager a { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3) var(--space-4);
  border: var(--border-hair) solid var(--color-line); border-radius: var(--radius); background: var(--color-surface); color: var(--color-ink); }
.pager a:hover { border-color: var(--color-accent); }
.pager .label { color: var(--color-muted); }
.pager .next { text-align: right; }
.meta { font-size: var(--text-xs); }
.feedback a { margin-left: var(--space-2); }
</style>
```

- [ ] **Step 8: Write `site/src/components/DocsLayout.astro`**

```astro
---
// The docs page: sidebar · article · on-page contents.
//   ≥ 1100px  three columns
//   ≥ 800px   sidebar and article; contents above the article
//   < 800px   one column; the sidebar is a disclosure under the nav
import Layout from "./Layout.astro";
import DocsSidebar from "./DocsSidebar.astro";
import DocsToc from "./DocsToc.astro";
import DocsFooter from "./DocsFooter.astro";
import { sectionById } from "../data/docs-manifest.mjs";
interface Heading { depth: number; slug: string; text: string; }
interface Props {
  page: { source: string; slug: string; title: string; section: string; summary: string; verified: string | null };
  headings: Heading[];
}
const { page, headings } = Astro.props;
---
<Layout title={page.title} description={page.summary} current="docs">
  <details class="docs-drawer">
    <summary class="mono">Documentation menu</summary>
    <DocsSidebar current={page.slug} />
  </details>
  <div class="container-wide docs-grid">
    <aside class="docs-side"><DocsSidebar current={page.slug} /></aside>
    <div class="docs-contents"><DocsToc headings={headings} /></div>
    <div class="docs-main">
      <article class="doc prose" data-pagefind-body>
        <p class="eyebrow" data-pagefind-ignore>{sectionById(page.section).title}</p>
        <h1>{page.title}</h1>
        <slot />
      </article>
      <DocsFooter page={page} />
    </div>
  </div>
</Layout>
<script>
  // The contents list starts open so it works without script; on a narrow
  // screen it would push the article down, so close it there.
  const toc = document.querySelector<HTMLDetailsElement>(".docs-toc");
  if (toc && window.matchMedia("(max-width: 1099px)").matches) toc.open = false;
</script>
<style>
.docs-drawer { display: none; }
.docs-grid {
  display: grid; gap: var(--space-10); align-items: start; padding-top: var(--space-10);
  grid-template-columns: 15rem minmax(0, 1fr) 13rem;
  grid-template-areas: "side main contents";
}
.docs-side { grid-area: side; position: sticky; top: 5rem; max-height: calc(100vh - 6rem); overflow-y: auto; }
.docs-main { grid-area: main; min-width: 0; }
.docs-contents { grid-area: contents; position: sticky; top: 5rem; max-height: calc(100vh - 6rem); overflow-y: auto; }

.doc h1 { font-size: var(--text-3xl); margin-top: var(--space-3); }
.doc :global(h2) { margin-top: var(--space-10); scroll-margin-top: 5rem; }
.doc :global(h3) { scroll-margin-top: 5rem; }
.doc :global(table) { display: block; overflow-x: auto; border-collapse: collapse; font-size: var(--text-sm); }
.doc :global(th), .doc :global(td) { border: var(--border-hair) solid var(--color-line); padding: var(--space-2) var(--space-3); text-align: left; vertical-align: top; }
.doc :global(th) { background: var(--color-bg-2); color: var(--color-ink); }
.doc :global(blockquote) { border-left: 2px solid var(--color-line-2); padding-left: var(--space-4); color: var(--color-muted); }
.doc :global(ul), .doc :global(ol) { padding-left: var(--space-6); }
.doc :global(li + li) { margin-top: var(--space-1); }
.doc :global(img) { max-width: 100%; height: auto; }
.doc :global(hr) { border: 0; border-top: var(--border-hair) solid var(--color-line); margin-block: var(--space-8); }

@media (max-width: 1099px) {
  .docs-grid { grid-template-columns: 15rem minmax(0, 1fr); grid-template-areas: "side contents" "side main"; row-gap: var(--space-6); }
  .docs-contents { position: static; max-height: none; }
}
@media (max-width: 799px) {
  .docs-side { display: none; }
  .docs-drawer {
    display: block; position: sticky; top: 3.75rem; z-index: calc(var(--z-nav) - 1);
    background: var(--color-bg-2); border-bottom: var(--border-hair) solid var(--color-line);
  }
  .docs-drawer summary { cursor: pointer; padding: var(--space-3) var(--gutter); font-size: var(--text-sm); color: var(--color-ink); }
  .docs-drawer[open] { max-height: calc(100vh - 3.75rem); overflow-y: auto; }
  .docs-drawer :global(.docs-sidebar) { padding: var(--space-2) var(--gutter) var(--space-6); }
  .docs-grid { grid-template-columns: minmax(0, 1fr); grid-template-areas: "contents" "main"; padding-top: var(--space-6); }
}
</style>
```

- [ ] **Step 9: Use the layout on the docs page**

In `site/src/pages/docs/[...slug].astro`, replace everything from the line `const { entry, page } = Astro.props;` to the end of the file with:

```astro
const { entry, page } = Astro.props;
const { Content, headings } = await render(entry);
---
<DocsLayout page={page} headings={headings}>
  <Content />
</DocsLayout>
```

and in the frontmatter imports of the same file replace

```astro
import Layout from "../../components/Layout.astro";
import { PAGES, pageBySource, sectionById } from "../../data/docs-manifest.mjs";
```

with

```astro
import DocsLayout from "../../components/DocsLayout.astro";
import { PAGES, pageBySource } from "../../data/docs-manifest.mjs";
```

- [ ] **Step 10: Build and check the page**

Run: `cd site && rm -rf .astro dist && npm run build`
Expected: PASS.

```bash
# grep -o … | wc -l counts occurrences; the built HTML is mostly one line.
grep -o 'aria-current="page"' dist/docs/setup/index.html | wc -l            # 3: nav "Docs", and the sidebar rendered twice
grep -o 'data-pagefind-body' dist/docs/setup/index.html | wc -l             # 1
grep -o 'issues/new?labels=docs-feedback' dist/docs/setup/index.html | wc -l  # 3
grep -o '<h1' dist/docs/federation/index.html | wc -l                       # 1
grep -o 'class="docs-toc' dist/docs/federation/index.html | wc -l           # 1 (a long page has contents)
```

Then look at it: `npm run preview`, open `http://localhost:4321/org-os-template/docs/federation`. Check at 1300px, 900px and 400px wide: three columns, then two, then one with the "Documentation menu" disclosure; a wide table scrolls inside the article instead of widening the page.

- [ ] **Step 11: Commit**

```bash
git add site/src/lib/feedback.mjs site/test/feedback.test.mjs site/src/components/Docs*.astro "site/src/pages/docs/[...slug].astro"
git commit -m "feat(site): the docs layout — sidebar, on-page contents, pager, stamp, feedback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The dark theme

The light accent is `#1c7d3b`, which gives 4.39:1 on `--color-bg-2` and 4.47:1 on `--color-surface-2` — under WCAG AA for text. This task darkens it to `#1a7738` (4.75:1 at worst) and raises `--color-faint` from `#969aa0` to `#7e8288` (2.39:1 → 3.27:1 at worst; it stays a non-text colour). Both are small changes within the same identity; the contrast test pins them.

**Files:**
- Create: `site/src/lib/theme-boot.mjs`, `site/src/components/ThemeToggle.astro`
- Test: `site/test/theme-boot.test.mjs`, `site/test/theme-contrast.test.mjs`
- Modify: `site/src/styles/theme.css`, `site/src/styles/themes/systems.css`, `site/src/styles/themes/systems-dark.css`, `site/src/components/Layout.astro`, `site/src/components/Nav.astro`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `THEME_KEY: string` (`"org-os-theme"`), `THEME_BOOT: string` — a self-contained script that sets `document.documentElement.dataset.theme` to `"light"` or `"dark"`.
  - `<ThemeToggle />` — a button with class `theme-toggle`.
  - `<html data-theme="light|dark">` on every page once script has run; light when it has not.

- [ ] **Step 1: Write the failing tests**

Create `site/test/theme-boot.test.mjs`:

```js
// site/test/theme-boot.test.mjs — runs the pre-paint script against fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { THEME_BOOT, THEME_KEY } from "../src/lib/theme-boot.mjs";

function boot({ saved = null, systemDark = false, storageThrows = false, mediaThrows = false } = {}) {
  const document = { documentElement: { dataset: {} } };
  const localStorage = { getItem: (k) => { if (storageThrows) throw new Error("blocked"); return k === THEME_KEY ? saved : null; } };
  const matchMedia = (q) => { if (mediaThrows) throw new Error("no matchMedia"); return { matches: systemDark && q.includes("dark") }; };
  new Function("document", "localStorage", "matchMedia", THEME_BOOT)(document, localStorage, matchMedia);
  return document.documentElement.dataset.theme;
}

test("a saved choice wins over the system setting", () => {
  assert.equal(boot({ saved: "light", systemDark: true }), "light");
  assert.equal(boot({ saved: "dark", systemDark: false }), "dark");
});

test("with nothing saved, the system setting decides", () => {
  assert.equal(boot({ systemDark: true }), "dark");
  assert.equal(boot({ systemDark: false }), "light");
});

test("a saved value that is neither theme is ignored", () => {
  assert.equal(boot({ saved: "purple", systemDark: true }), "dark");
});

test("blocked storage does not throw; the system setting still decides", () => {
  assert.equal(boot({ storageThrows: true, systemDark: true }), "dark");
  assert.equal(boot({ storageThrows: true, systemDark: false }), "light");
});

test("with neither storage nor matchMedia, the page is light", () => {
  assert.equal(boot({ storageThrows: true, mediaThrows: true }), "light");
});
```

Create `site/test/theme-contrast.test.mjs`:

```js
// site/test/theme-contrast.test.mjs — WCAG AA for both themes, from the theme
// files themselves, so a palette edit that breaks contrast fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const themes = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", "themes");
const tokens = (file) => {
  const out = {};
  for (const m of readFileSync(join(themes, file), "utf8").matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2];
  return out;
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const SURFACES = ["bg", "bg-2", "surface", "surface-2"];
const TEXT = ["ink", "ink-2", "muted", "accent"];

for (const file of ["systems.css", "systems-dark.css"]) {
  const t = tokens(file);

  test(`${file}: defines every token the checks read`, () => {
    for (const name of [...SURFACES, ...TEXT, "faint", "accent-ink"]) assert.ok(t[name], `--color-${name} missing or not a 6-digit hex`);
  });

  test(`${file}: text colours reach 4.5:1 on every surface`, () => {
    for (const fg of TEXT) for (const bg of SURFACES) {
      const r = ratio(t[fg], t[bg]);
      assert.ok(r >= 4.5, `--color-${fg} on --color-${bg} is ${r.toFixed(2)}:1`);
    }
  });

  test(`${file}: text on the accent reaches 4.5:1`, () => {
    const r = ratio(t["accent-ink"], t.accent);
    assert.ok(r >= 4.5, `--color-accent-ink on --color-accent is ${r.toFixed(2)}:1`);
  });

  test(`${file}: the faint colour reaches 3:1 on every surface (non-text use only)`, () => {
    for (const bg of SURFACES) {
      const r = ratio(t.faint, t[bg]);
      assert.ok(r >= 3, `--color-faint on --color-${bg} is ${r.toFixed(2)}:1`);
    }
  });
}

test("the two themes define the same variables", () => {
  const names = (file) => [...readFileSync(join(themes, file), "utf8").matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(names("systems-dark.css"), names("systems.css"));
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd site && node --test test/theme-boot.test.mjs test/theme-contrast.test.mjs`
Expected: FAIL — `theme-boot.mjs` not found; and in the contrast file, `systems.css: text colours reach 4.5:1` fails with `--color-accent on --color-bg-2 is 4.39:1`, and the faint test fails for `systems.css`. The dark theme's contrast tests already pass.

- [ ] **Step 3: Write `site/src/lib/theme-boot.mjs`**

```js
// theme-boot.mjs — the script that picks the theme before first paint.
// Kept as a string so Layout can inline it in <head> (a module script would
// run after paint and flash) and so the test can run the same text.
// It must not throw: storage can be blocked, and matchMedia can be missing.
export const THEME_KEY = "org-os-theme";

export const THEME_BOOT = `(function () {
  var theme = "light";
  try {
    var saved = null;
    try { saved = localStorage.getItem(${JSON.stringify(THEME_KEY)}); } catch (e) {}
    if (saved === "dark" || saved === "light") theme = saved;
    else if (matchMedia("(prefers-color-scheme: dark)").matches) theme = "dark";
  } catch (e) {}
  document.documentElement.dataset.theme = theme;
})();`;
```

- [ ] **Step 4: Make both themes active**

Replace `site/src/styles/theme.css` with:

```css
/* theme.css — both themes are loaded. Light is the default (:root); dark
 * applies when <html data-theme="dark">, which src/lib/theme-boot.mjs sets
 * before first paint. To retheme the site, change these two imports. */
@import "./themes/systems.css";
@import "./themes/systems-dark.css";
```

In `site/src/styles/themes/systems-dark.css`, change the header comment and the selector — the first three lines become:

```css
/* themes/systems-dark.css — dark variant. Mirrors the systems.css variable contract
 * one-for-one (site/test/theme-contrast.test.mjs checks that). Active when
 * <html data-theme="dark">. */
:root[data-theme="dark"] {
```

In `site/src/styles/themes/systems.css`, change three values:

```css
  --color-faint:  #7e8288;      /* captions, labels, leader lines — non-text; 3:1 */
```

```css
  --color-accent:      #1a7738;
```

```css
  --color-accent-wash: rgba(26, 119, 56, 0.08);
```

(`--color-accent` was `#1c7d3b`, `--color-faint` was `#969aa0`, the wash was `rgba(28, 125, 59, 0.08)`. Nothing else in the file changes.)

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd site && node --test test/theme-boot.test.mjs test/theme-contrast.test.mjs`
Expected: PASS, 5 + 9 tests.

- [ ] **Step 6: Boot the theme in the layout**

In `site/src/components/Layout.astro`, add to the frontmatter imports:

```astro
import { THEME_BOOT } from "../lib/theme-boot.mjs";
```

and in `<head>`, directly after the `<meta name="theme-color" …>` line, add:

```astro
  <script is:inline set:html={THEME_BOOT}></script>
```

- [ ] **Step 7: Write `site/src/components/ThemeToggle.astro`**

```astro
---
// A button that switches between the two themes and remembers the choice.
// Hidden until script runs: without script it could do nothing.
import { THEME_KEY } from "../lib/theme-boot.mjs";
---
<button type="button" class="theme-toggle mono" aria-pressed="false" data-key={THEME_KEY} hidden>Dark</button>
<script>
  const root = document.documentElement;
  const button = document.querySelector<HTMLButtonElement>(".theme-toggle");
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (button) {
    const paint = () => {
      button.setAttribute("aria-pressed", String(root.dataset.theme === "dark"));
      // Keep the browser chrome in step with the page background.
      if (meta) meta.content = getComputedStyle(root).getPropertyValue("--color-bg").trim();
    };
    button.hidden = false;
    paint();
    button.addEventListener("click", () => {
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem(button.dataset.key!, root.dataset.theme); } catch { /* storage blocked: the choice lasts for this page */ }
      paint();
    });
  }
</script>
<style>
.theme-toggle {
  font-size: var(--text-sm); color: var(--color-muted); background: none; cursor: pointer;
  border: var(--border-hair) solid var(--color-line-2); border-radius: var(--radius-sm);
  padding: 0.2rem 0.55rem; transition: color var(--t-fast), border-color var(--t-fast);
}
.theme-toggle:hover { color: var(--color-ink); border-color: var(--color-ink-2); }
.theme-toggle[aria-pressed="true"] { color: var(--color-accent); border-color: var(--color-accent); }
</style>
```

- [ ] **Step 8: Put the toggle in the nav**

In `site/src/components/Nav.astro`, add `import ThemeToggle from "./ThemeToggle.astro";` to the frontmatter, and change the markup so the list and the toggle sit together on the right:

```astro
<nav class="nav">
  <div class="container nav-inner">
    <a href={withBase("/")} class="brand mono" aria-label="org-os home">~/org-os<span class="cursor" aria-hidden="true"></span></a>
    <div class="nav-right">
      <ul>
        {links.map((l) => (
          <li>
            <a href={withBase(l.href)} class:list={["nav-link", { active: current === l.id }]}
               aria-current={current === l.id ? "page" : undefined}>{l.label}</a>
          </li>
        ))}
      </ul>
      <ThemeToggle />
    </div>
  </div>
</nav>
```

and add to the `<style>` block:

```css
.nav-right { display: flex; align-items: center; gap: var(--space-5); flex-wrap: wrap; }
```

- [ ] **Step 9: Build and look at both themes**

Run: `cd site && rm -rf .astro dist && npm run build && npm test`
Expected: PASS.

```bash
grep -o 'org-os-theme' dist/index.html | wc -l      # at least 1: the inline boot script
grep -l 'data-theme' dist/_astro/*.css              # one stylesheet carries the dark block (the minifier may drop the quotes)
```

`npm run preview`, then on `/org-os-template/` and `/org-os-template/docs/federation`: press the toggle, reload (the choice holds), and read a page in each theme — code blocks, tables, the sidebar's current page, the federation map panel. If the federation map does not follow the dark theme, do not fix it here: note it in the commit message for plan 2.

- [ ] **Step 10: Commit**

```bash
git add site/src/lib/theme-boot.mjs site/src/components/ThemeToggle.astro site/src/components/Layout.astro site/src/components/Nav.astro site/src/styles site/test/theme-boot.test.mjs site/test/theme-contrast.test.mjs
git commit -m "feat(site): a dark theme, a toggle, and a contrast test for both themes

The light accent moves from #1c7d3b to #1a7738 and the faint colour from
#969aa0 to #7e8288 so every text colour reaches 4.5:1 on every surface.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Search

**Files:**
- Create: `site/src/lib/search.mjs`, `site/src/components/Search.astro`
- Test: `site/test/search.test.mjs`
- Modify: `site/package.json`, `site/src/components/Nav.astro`, `site/src/pages/modules.astro`

**Interfaces:**
- Consumes: `data-pagefind-body` on the docs article (Task 4); `.nav-right` in `Nav.astro` (Task 5).
- Produces:
  - `openSearch({ load: () => Promise<void>, show: () => void, fallback: () => void }) → Promise<"shown" | "fallback">`
  - `isTypingTarget(el: { tagName?: string, isContentEditable?: boolean } | null) → boolean`
  - `dist/pagefind/` after `npm run build` (Task 8 checks for it).

- [ ] **Step 1: Write the failing test**

Create `site/test/search.test.mjs`:

```js
// site/test/search.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSearch, isTypingTarget } from "../src/lib/search.mjs";

test("when the search assets load, the dialog is shown", async () => {
  const calls = [];
  const out = await openSearch({ load: async () => { calls.push("load"); }, show: () => calls.push("show"), fallback: () => calls.push("fallback") });
  assert.equal(out, "shown");
  assert.deepEqual(calls, ["load", "show"]);
});

test("when they fail to load, the viewer is sent to the docs index instead", async () => {
  const calls = [];
  const out = await openSearch({ load: async () => { throw new Error("404"); }, show: () => calls.push("show"), fallback: () => calls.push("fallback") });
  assert.equal(out, "fallback");
  assert.deepEqual(calls, ["fallback"]);
});

test("a failure while showing also falls back", async () => {
  const calls = [];
  const out = await openSearch({ load: async () => {}, show: () => { throw new Error("no dialog"); }, fallback: () => calls.push("fallback") });
  assert.equal(out, "fallback");
  assert.deepEqual(calls, ["fallback"]);
});

test("the / shortcut is ignored while the viewer is typing", () => {
  assert.equal(isTypingTarget({ tagName: "INPUT" }), true);
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isTypingTarget({ tagName: "SELECT" }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: "BODY" }), false);
  assert.equal(isTypingTarget(null), false);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd site && node --test test/search.test.mjs`
Expected: FAIL — `Cannot find module …/src/lib/search.mjs`.

- [ ] **Step 3: Write `site/src/lib/search.mjs`**

```js
// search.mjs — the decisions behind the Search control, free of the DOM so
// they can be tested. Search.astro supplies load/show/fallback.

/**
 * Load the search assets and show the dialog. If either step fails — the dev
 * server has no index, the viewer is offline, a blocker ate the script — send
 * the viewer to the docs index rather than leaving a control that does nothing.
 * @returns {Promise<"shown" | "fallback">}
 */
export async function openSearch({ load, show, fallback }) {
  try {
    await load();
    show();
    return "shown";
  } catch {
    fallback();
    return "fallback";
  }
}

/** True when a keystroke belongs to a field, not to a page shortcut. */
export function isTypingTarget(el) {
  if (!el) return false;
  return el.isContentEditable === true || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName ?? "");
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd site && node --test test/search.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add Pagefind to the build**

```bash
cd site && npm install --save-dev pagefind@^1.5.0
```

In `site/package.json`, change the `build` script to:

```json
    "build": "npm run aggregate && astro build && pagefind --site dist && npm run verify",
```

- [ ] **Step 6: Write `site/src/components/Search.astro`**

```astro
---
// Search. Without script this is a plain link to the docs index. With script
// it opens a dialog and loads Pagefind's index on first use — nothing is
// fetched until the viewer asks. Pagefind writes its files to dist/pagefind/
// after `astro build`; they do not exist under `astro dev`, where the control
// falls back to the link.
import { withBase } from "../lib/base";
---
<a class="search-open mono" href={withBase("/docs")} data-base={withBase("/")}>Search <kbd>/</kbd></a>
<dialog class="search-dialog" aria-label="Search the documentation">
  <form method="dialog"><button class="search-close mono">Close</button></form>
  <div id="search-ui"></div>
</dialog>
<script>
  import { openSearch, isTypingTarget } from "../lib/search.mjs";

  const link = document.querySelector<HTMLAnchorElement>(".search-open");
  const dialog = document.querySelector<HTMLDialogElement>(".search-dialog");
  let loading: Promise<void> | undefined;

  function load(base: string): Promise<void> {
    loading ??= new Promise<void>((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = `${base}pagefind/pagefind-ui.css`;
      document.head.append(css);
      const script = document.createElement("script");
      script.src = `${base}pagefind/pagefind-ui.js`;
      script.onload = () => {
        try {
          // baseUrl: Pagefind records addresses from the root of dist/, which
          // do not carry the deploy base path.
          new (window as any).PagefindUI({ element: "#search-ui", baseUrl: base, showSubResults: true, showImages: false });
          resolve();
        } catch (error) { reject(error); }
      };
      script.onerror = () => reject(new Error("pagefind-ui.js did not load"));
      document.head.append(script);
    });
    // A failed load must be retryable, not cached as a permanent failure.
    loading.catch(() => { loading = undefined; });
    return loading;
  }

  if (link && dialog) {
    const base = link.dataset.base!;
    const open = (event: Event) => {
      event.preventDefault();
      openSearch({
        load: () => load(base),
        show: () => { dialog.showModal(); dialog.querySelector<HTMLInputElement>("input")?.focus(); },
        fallback: () => { window.location.href = link.href; },
      });
    };
    link.addEventListener("click", open);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (dialog.open || isTypingTarget(document.activeElement as HTMLElement | null)) return;
      open(event);
    });
  }
</script>
<style>
/* Nav.astro's .nav-link styles are scoped to that component, so the control
   carries its own. */
.search-open { font-size: var(--text-sm); color: var(--color-muted); transition: color var(--t-fast); }
.search-open:hover { color: var(--color-ink); }
.search-open kbd {
  font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--color-muted);
  border: var(--border-hair) solid var(--color-line-2); border-radius: var(--radius-sm); padding: 0 0.3em; margin-left: 0.3em;
}
.search-dialog {
  width: min(44rem, calc(100% - 2 * var(--gutter))); max-height: 80vh; margin: 10vh auto auto;
  padding: var(--space-5); overflow-y: auto;
  background: var(--color-surface); color: var(--color-ink-2);
  border: var(--border-hair) solid var(--color-line-2); border-radius: var(--radius); box-shadow: var(--shadow-2);
  /* Pagefind UI reads these. */
  --pagefind-ui-primary: var(--color-accent);
  --pagefind-ui-text: var(--color-ink-2);
  --pagefind-ui-background: var(--color-surface);
  --pagefind-ui-border: var(--color-line-2);
  --pagefind-ui-tag: var(--color-bg-2);
  --pagefind-ui-border-width: 1px;
  --pagefind-ui-border-radius: var(--radius);
  --pagefind-ui-font: var(--font-body);
  --pagefind-ui-scale: 0.85;
}
.search-dialog::backdrop { background: color-mix(in srgb, var(--color-ink) 45%, transparent); }
.search-dialog form { display: flex; justify-content: flex-end; margin-bottom: var(--space-3); }
.search-close {
  font-size: var(--text-xs); color: var(--color-muted); background: none; cursor: pointer;
  border: var(--border-hair) solid var(--color-line-2); border-radius: var(--radius-sm); padding: 0.2rem 0.55rem;
}
.search-close:hover { color: var(--color-ink); }
</style>
```

- [ ] **Step 7: Put Search in the nav, and index the modules page**

In `site/src/components/Nav.astro`, add `import Search from "./Search.astro";` and place `<Search />` immediately before `<ThemeToggle />` inside `.nav-right`.

In `site/src/pages/modules.astro`, change `<div class="container">` to `<div class="container" data-pagefind-body>`.

- [ ] **Step 8: Build and try it**

Run: `cd site && rm -rf .astro dist && npm run build && npm test`
Expected: PASS; Pagefind's summary in the build log reports 13 pages indexed (twelve docs and the modules page — only elements marked `data-pagefind-body` are indexed).

```bash
ls dist/pagefind/pagefind.js dist/pagefind/pagefind-ui.js dist/pagefind/pagefind-ui.css
```

`npm run preview`; on any page press `/`, type `trust level`, and follow a result: the address must start with `/org-os-template/docs/`. Press `Esc` to close. Then turn script off in the browser and click Search: it goes to the docs index.

- [ ] **Step 9: Commit**

```bash
git add site/package.json site/package-lock.json site/src/lib/search.mjs site/src/components/Search.astro site/src/components/Nav.astro site/src/pages/modules.astro site/test/search.test.mjs
git commit -m "feat(site): search over the docs with Pagefind, loaded on first use

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Home, docs index, modules, nav, footer, redirects

**Files:**
- Create: `site/src/data/redirects.mjs`, `site/src/components/Redirect.astro`
- Modify: `site/src/pages/index.astro`, `site/src/pages/docs/index.astro`, `site/src/pages/modules.astro`, `site/src/pages/get-started.astro`, `site/src/pages/about.astro`, `site/src/components/Nav.astro`, `site/src/components/Footer.astro`, `site/src/data/landing.yaml`, `site/src/data/modules.yaml`
- Test: `site/test/modules-catalog.test.mjs` (extend), `site/test/redirects.test.mjs` (new)

**Interfaces:**
- Consumes: `SECTIONS`, `pagesBySection`, `pageBySlug` (Task 1); `VERSION`, `REPO_URL` (Task 2).
- Produces: `REDIRECTS: { from: string, to: string }[]` from `site/src/data/redirects.mjs` (Task 8 checks them in the build output).

- [ ] **Step 1: Write the failing tests**

Create `site/test/redirects.test.mjs`:

```js
// site/test/redirects.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { REDIRECTS } from "../src/data/redirects.mjs";
import { pageBySlug } from "../src/data/docs-manifest.mjs";

test("the two retired pages redirect", () => {
  assert.deepEqual(REDIRECTS.map((r) => r.from).sort(), ["/about", "/get-started"]);
});

test("every redirect is root-absolute and lands on a page that exists", () => {
  for (const { from, to } of REDIRECTS) {
    assert.ok(from.startsWith("/") && to.startsWith("/"), `${from} → ${to}`);
    assert.notEqual(from, to);
    const m = to.match(/^\/docs\/([a-z0-9-]+)$/);
    if (m) assert.ok(pageBySlug(m[1]), `${from} → ${to}: no such docs page`);
    else assert.ok(["/docs", "/modules", "/federation", "/"].includes(to), `${from} → ${to}: unknown target`);
  }
});
```

In `site/test/modules-catalog.test.mjs`, add after the existing `catalogIds` line:

```js
// "**Status.** `pilot` — …" under each entry heading.
const catalogStatus = new Map(
  catalog.split(/^### /m).slice(1).flatMap((block) => {
    const id = block.match(/^([a-z0-9-]+) — /)?.[1];
    const status = block.match(/\*\*Status\.\*\* `([a-z-]+)`/)?.[1];
    return id ? [[id, status]] : [];
  }),
);
```

and add at the end of the file:

```js
test("every module in the MODULES.md catalog appears on the site", () => {
  const siteIds = new Set(modules.map((m) => m.id));
  for (const id of catalogIds) assert.ok(siteIds.has(id), `MODULES.md has "${id}", modules.yaml does not`);
});

test("each site module carries the status the catalog gives it", () => {
  for (const m of modules) {
    assert.equal(m.status, catalogStatus.get(m.id), `"${m.id}": modules.yaml says ${m.status}, MODULES.md says ${catalogStatus.get(m.id)}`);
  }
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd site && node --test test/redirects.test.mjs test/modules-catalog.test.mjs`
Expected: FAIL — `redirects.mjs` not found; and `every module in the MODULES.md catalog appears on the site` fails with `MODULES.md has "org-os-instance-doctor", modules.yaml does not`.

- [ ] **Step 3: Write `site/src/data/redirects.mjs`**

```js
// redirects.mjs — addresses the site used to serve, and where they go now.
// Each has a page under src/pages/ that renders <Redirect>; verify-build.mjs
// checks every one in the built output.
// `/about` goes to the docs index until the Overview page exists (plan 2),
// then to /docs/overview.
export const REDIRECTS = [
  { from: "/get-started", to: "/docs/setup" },
  { from: "/about", to: "/docs" },
];
export const redirectFor = (from) => {
  const found = REDIRECTS.find((r) => r.from === from);
  if (!found) throw new Error(`redirects: no entry for ${from}`);
  return found.to;
};
```

- [ ] **Step 4: Write `site/src/components/Redirect.astro` and the two pages**

`site/src/components/Redirect.astro`:

```astro
---
// A static redirect: GitHub Pages cannot send a 301, so the page refreshes to
// its target and names it as canonical. The link is for viewers whose browser
// does not follow the refresh.
import { withBase } from "../lib/base";
interface Props { to: string; }
const href = withBase(Astro.props.to);
---
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex" />
  <meta http-equiv="refresh" content={`0; url=${href}`} />
  <link rel="canonical" href={href} />
  <title>Moved · org-os</title>
</head>
<body>
  <p>This page has moved to <a href={href}>{href}</a>.</p>
</body>
</html>
```

Replace `site/src/pages/get-started.astro` with:

```astro
---
import Redirect from "../components/Redirect.astro";
import { redirectFor } from "../data/redirects.mjs";
---
<Redirect to={redirectFor("/get-started")} />
```

Replace `site/src/pages/about.astro` with:

```astro
---
import Redirect from "../components/Redirect.astro";
import { redirectFor } from "../data/redirects.mjs";
---
<Redirect to={redirectFor("/about")} />
```

- [ ] **Step 5: Restore the seven missing modules**

In `site/src/data/modules.yaml`, insert directly after the line `modules:`:

```yaml
  - id: org-os-instance-doctor
    name: Instance Assessment & Reliable Sync
    status: pilot
    summary: Is this instance healthy, and can it be updated safely? assess gives a read-only scorecard; sync repairs, then updates.
    link: /docs/modules
```

and insert directly after the `org-os-federation` entry (the one ending `link: /docs/federation`):

```yaml
  - id: org-os-pm
    name: Projects & Tasks
    status: live
    summary: Workstream and task tracking — the projects registry, the plans queue, and the dashboard sections that render them.
    link: /docs/modules
  - id: org-os-meeting-processor
    name: Meeting Processor
    status: live
    summary: Transcript to structured meeting record to registry updates to knowledge base.
    link: /docs/modules
  - id: org-os-knowledge
    name: Knowledge Commons
    status: in-dev
    summary: Compiling, linting, indexing and federating an org's knowledge.
    link: /docs/modules
  - id: org-os-funding
    name: Funding
    status: live
    summary: Grant and funding-opportunity tracking with deadline surfacing.
    link: /docs/modules
  - id: org-os-heartbeat
    name: Heartbeat
    status: in-dev
    summary: The instance's live pulse — the module that consumes every other module's health checks.
    link: /docs/modules
  - id: org-os-territory
    name: Territory Extension Pack
    status: in-dev
    summary: An extension pack for org-os-kms that gives a knowledge instance a sense of place — territorial units and data streams.
    link: /docs/modules
```

Change the two comment lines at the top of the file to:

```yaml
# Mirror of docs/MODULES.md — that file is canon; this one feeds /modules.
# site/test/modules-catalog.test.mjs fails if the two lists differ, in either
# direction, or if a status here disagrees with the catalog.
```

Run: `cd site && node --test test/redirects.test.mjs test/modules-catalog.test.mjs`
Expected: PASS. If the status test names a module, `docs/MODULES.md` is canon: change `modules.yaml` to match it.

- [ ] **Step 6: The nav**

In `site/src/components/Nav.astro`, replace the `links` array with:

```js
const links = [
  { id: "docs", href: "/docs", label: "Docs" },
  { id: "modules", href: "/modules", label: "Modules" },
  { id: "federation", href: "/federation", label: "Federation" },
];
```

- [ ] **Step 7: The home page**

Replace `site/src/data/landing.yaml` with:

```yaml
# Home copy. The site's audience is people who already run an org-os instance
# (spec 2026-10-10, §1). The pitch for newcomers lives in docs/POSITIONING.md.
eyebrow: "docs"
title: "Run your organization on org-os"
subtitle: "Documentation for operators of org-os instances — setting one up, the daily session, keeping it current, and the reference for every file and registry."
ctas:
  - { label: "Operator guide", href: "/docs/operator-guide", variant: "solid" }
  - { label: "All docs", href: "/docs", variant: "ghost" }
  - { label: "Modules", href: "/modules", variant: "ghost" }
intro: "New to org-os? It is a git-native workspace where an organization's knowledge, data and operations live as files that people and agents both work on. Every instance today is run by the maintainer; an unaffiliated pilot is the open milestone."
intro_link: { label: "How the framework is put together", href: "/docs/architecture" }
```

Replace `site/src/pages/index.astro` with:

```astro
---
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import Layout from "../components/Layout.astro";
import Hero from "../components/Hero.astro";
import SectionBlock from "../components/SectionBlock.astro";
import FederationMapIsland from "../components/FederationMapIsland.astro";
import { federationData } from "../lib/federation";
import { withBase } from "../lib/base";
import { SECTIONS, pagesBySection } from "../data/docs-manifest.mjs";
import { VERSION, REPO_URL } from "../lib/repo.mjs";

const landing = yaml.load(readFileSync(resolve(process.cwd(), "src/data/landing.yaml"), "utf8")) as any;
const sections = SECTIONS.map((s) => ({ ...s, pages: pagesBySection(s.id) })).filter((s) => s.pages.length > 0);
const statline = `v${VERSION} · ${federationData.nodes.length} instances · EIP-4824`;
const SHOWN = 4;
---
<Layout title="Home" current="home" description="Documentation for operators of org-os instances.">
  <div class="container">
    <Hero eyebrow={landing.eyebrow} title={landing.title} subtitle={landing.subtitle} ctas={landing.ctas} statline={statline} />
  </div>

  <SectionBlock index="01" eyebrow="Documentation" title="Where to look" href={withBase("/docs")} cta="All docs">
    <div class="grid">
      {sections.map((s) => (
        <article class="surface ticked card">
          <h3><a href={withBase(`/docs/${s.pages[0].slug}`)}>{s.title}</a></h3>
          <p class="summary">{s.summary}</p>
          <ul>
            {s.pages.slice(0, SHOWN).map((p) => <li><a class="link" href={withBase(`/docs/${p.slug}`)}>{p.title}</a></li>)}
          </ul>
          {s.pages.length > SHOWN && <p class="more mono">+ {s.pages.length - SHOWN} more</p>}
        </article>
      ))}
    </div>
  </SectionBlock>

  <SectionBlock index="02" eyebrow="Release" title={`Version ${VERSION}`} href={`${REPO_URL}/blob/main/CHANGELOG.md`} cta="Changelog">
    <p class="prose">These docs describe org-os <code>v{VERSION}</code>. Each page says which commit it was checked against.</p>
  </SectionBlock>

  <SectionBlock index="03" eyebrow="Federation" title="One OS, many nodes" href={withBase("/federation")} cta="Explore the network">
    <FederationMapIsland mode="mini" />
  </SectionBlock>

  <section class="container intro">
    <p class="prose">{landing.intro} <a class="link" href={withBase(landing.intro_link.href)}>{landing.intro_link.label}</a>.</p>
  </section>
</Layout>
<style>
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--space-5); }
.card { padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-3); }
.card h3 a { color: var(--color-ink); }
.card h3 a:hover { color: var(--color-accent); }
.card .summary { font-size: var(--text-sm); color: var(--color-muted); }
.card ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-sm); }
.card .more { font-size: var(--text-xs); color: var(--color-muted); }
.intro { margin-block: var(--space-16); color: var(--color-muted); }
</style>
```

- [ ] **Step 8: The docs index**

Replace `site/src/pages/docs/index.astro` with:

```astro
---
import Layout from "../../components/Layout.astro";
import { withBase } from "../../lib/base";
import { SECTIONS, pagesBySection } from "../../data/docs-manifest.mjs";
import { VERSION, REPO_URL } from "../../lib/repo.mjs";
const sections = SECTIONS.map((s) => ({ ...s, pages: pagesBySection(s.id) })).filter((s) => s.pages.length > 0);
---
<Layout title="Docs" current="docs" description="org-os documentation for operators of instances.">
  <div class="container">
    <p class="eyebrow">Documentation · v{VERSION}</p>
    <h1>Docs</h1>
    <p class="lead prose">For people who run an org-os instance. Working notes, plans and research stay in the <a class="link" href={`${REPO_URL}/tree/main/docs`}>repository</a>.</p>
    {sections.map((s) => (
      <section class="section">
        <h2>{s.title}</h2>
        <p class="about">{s.summary}</p>
        <ul>
          {s.pages.map((p) => (
            <li>
              <a href={withBase(`/docs/${p.slug}`)}>{p.title}</a>
              <span>{p.summary}</span>
            </li>
          ))}
        </ul>
      </section>
    ))}
  </div>
</Layout>
<style>
h1 { margin-top: var(--space-3); }
.lead { margin-top: var(--space-4); }
.section { margin-top: var(--space-12); }
.section .about { color: var(--color-muted); margin-top: var(--space-1); }
.section ul { list-style: none; padding: 0; margin-top: var(--space-4); border-top: var(--border-hair) solid var(--color-line); }
.section li { display: grid; grid-template-columns: minmax(12rem, 18rem) 1fr; gap: var(--space-4);
  padding: var(--space-3) 0; border-bottom: var(--border-hair) solid var(--color-line); }
.section li a { font-family: var(--font-mono); font-size: var(--text-sm); }
.section li span { color: var(--color-ink-2); font-size: var(--text-sm); }
@media (max-width: 640px) { .section li { grid-template-columns: 1fr; gap: var(--space-1); } }
</style>
```

- [ ] **Step 9: Modules page and footer**

In `site/src/pages/modules.astro`, replace everything from the `<Layout …>` opening tag through the `<p class="prose">…</p>` line (five lines, ending just above the `<div class="grid">` line) with:

```astro
<Layout title="Modules" current="modules" description="The org-os module catalog, with each module's status.">
  <div class="container" data-pagefind-body>
    <p class="eyebrow">Catalog</p>
    <h1>Modules</h1>
    <p class="prose">Every module in the <a class="link" href={withBase("/docs/modules")}>catalog</a>, with its status: planned (specified, not built), in-dev (being built), pilot (built and verified, not yet in production) or live.</p>
```

and add `import { withBase } from "../lib/base";` to its frontmatter.

In `site/src/components/Footer.astro`:

- add `import { VERSION } from "../lib/repo.mjs";` to the frontmatter;
- change `<a class="link" href={withBase("/.well-known/")}>.well-known</a>` to `<a class="link" href={withBase("/.well-known/dao.json")}>.well-known/dao.json</a>` (the directory has no index page, so the old link was a 404);
- change `<a class="link" href={withBase("/get-started")}>Get started</a>` to `<a class="link" href={withBase("/docs/setup")}>Setup</a>`;
- change `<span class="faint">v0.5 · pre-beta · self-hosting since 2026</span>` to `<span>v{VERSION} · pre-beta · self-hosting since 2026</span>`, and delete the rule `.baseline .faint { color: var(--color-faint); }` from its `<style>` (the faint colour is not for text).

- [ ] **Step 10: Build and read every page**

Run: `cd site && rm -rf .astro dist && npm run build && npm test`
Expected: PASS.

```bash
grep -o 'url=[^"]*' dist/get-started/index.html dist/about/index.html
grep -o 'class="surface' dist/modules/index.html | wc -l   # 20
grep -o 'v[0-9]*\.[0-9]*\.[0-9]*' dist/index.html | sort -u
grep -rn "get-started\|/about" dist/index.html dist/docs/index.html dist/llms.txt | head
```

Expected: `url=/org-os-template/docs/setup` and `url=/org-os-template/docs`; `20`; a list that includes `v0.5.0`; no output from the last command.

`npm run preview` and read: `/`, `/docs`, `/modules`, `/federation`, `/get-started` (lands on Setup), `/about` (lands on the docs index), in both themes and at phone width.

- [ ] **Step 11: Commit**

```bash
git add site/src site/test
git commit -m "feat(site): an operator's home, the docs index, all twenty modules, redirects

/get-started and /about become redirects; the nav is Docs, Modules,
Federation; the version shown comes from package.json.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Build checks, CI history, README

**Files:**
- Modify: `site/scripts/verify-build.mjs` (rewrite), `.github/workflows/validate.yml:14`, `.github/workflows/deploy-pages.yml:33`, `site/README.md`

**Interfaces:**
- Consumes: `PAGES`, `SECTIONS`, `ALLOW_UNVERIFIED` (Task 1); `validateManifest` (Task 1); `REPO_ROOT`, `commitExists` (Task 2); `REDIRECTS` (Task 7); `dist/pagefind/` (Task 6).
- Produces: `npm run verify` — exit 1 with a named line for each failure of spec §4.9.

- [ ] **Step 1: Rewrite `site/scripts/verify-build.mjs`**

```js
// verify-build.mjs — integrity checks on the static build. Runs after
// `astro build` and `pagefind` (see package.json "build"), from site/.
// Every check prints what it looked at; a check that looked at nothing fails,
// because a pattern that silently stops matching is how gates go quiet.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { BASE_PATH, SITE_ORIGIN, SITE_URL } from "../base.config.mjs";
import { PAGES, SECTIONS, ALLOW_UNVERIFIED } from "../src/data/docs-manifest.mjs";
import { REDIRECTS } from "../src/data/redirects.mjs";
import { validateManifest } from "../src/lib/manifest.mjs";
import { REPO_ROOT, commitExists } from "../src/lib/repo.mjs";

const DIST = "dist";
let failed = false;
const fail = (message) => { console.error(message); failed = true; };

// ── 1. The manifest itself (spec §4.9, checks 1 and 2) ────────────────────
const problems = validateManifest(PAGES, SECTIONS, {
  fileExists: (p) => existsSync(join(REPO_ROOT, p)),
  commitExists,
  allowUnverified: ALLOW_UNVERIFIED,
});
for (const p of problems) fail(`MANIFEST: ${p}`);
const unverified = PAGES.filter((p) => p.verified == null).length;
console.log(
  problems.length === 0
    ? `manifest: ${PAGES.length} pages OK${unverified > 0 ? ` (${unverified} not yet verified — allowed while ALLOW_UNVERIFIED is on)` : ""}`
    : `manifest: ${problems.length} problem(s)`,
);

// ── 2. Required pages (check 3). The docs come from the manifest. ─────────
// The eleven addresses the site served before the manifest; they must keep
// resolving whatever the manifest becomes (spec §3, "Addresses").
const OLD_DOC_SLUGS = [
  "architecture", "modules", "agentic-architecture", "federation", "ecosystem", "data-model",
  "eip4824", "package-lifecycle", "operator-guide", "adopt-with-an-agent", "rad-org-os",
];
const REQUIRED = [
  "index.html",
  "modules/index.html",
  "modules/rad-org-os/index.html",
  "federation/index.html",
  "docs/index.html",
  ...PAGES.map((p) => `docs/${p.slug}/index.html`),
  ...OLD_DOC_SLUGS.map((s) => `docs/${s}/index.html`),
  "llms.txt",
  "federation.json",
  "map.json",
  ".well-known/dao.json",
  ".well-known/members.json",   // surfaced EIP-4824 schema (copied by the aggregate step)
  "pagefind/pagefind.js",
  "pagefind/pagefind-ui.js",
  "pagefind/pagefind-ui.css",
];
let present = 0;
for (const p of new Set(REQUIRED)) {
  if (existsSync(join(DIST, p))) present++;
  else fail(`MISSING: ${join(DIST, p)}`);
}
console.log(`required: ${present}/${new Set(REQUIRED).size} files present`);

// ── 3. federation.json shape ─────────────────────────────────────────────
try {
  const fed = JSON.parse(readFileSync(join(DIST, "federation.json"), "utf8"));
  if (fed.root?.id !== "org-os") fail("federation.json: root.id !== org-os");
  if (!Array.isArray(fed.nodes) || fed.nodes.length === 0) fail("federation.json: no nodes");
  else console.log(`federation.json: ${fed.nodes.length} nodes OK`);
} catch (e) { fail(`federation.json: unreadable — ${e.message}`); }

// ── 4. Links, on every built page (checks 4 and 6) ────────────────────────
// The site deploys to a GitHub Pages project path. Astro applies `base` to the
// URLs it *emits* but still writes a flat dist/, so the files stay at the root
// while every internal link must carry the prefix exactly once — and must
// point at something that was built.
const wellPrefixed = (href) =>
  href === BASE_PATH ||
  href.startsWith(`${BASE_PATH}/`) ||
  href.startsWith(`${BASE_PATH}#`) ||
  href.startsWith(`${BASE_PATH}?`);

/** Is there a built file behind this (correctly prefixed) internal address? */
function built(href) {
  let path;
  try { path = decodeURIComponent(href.slice(BASE_PATH.length).split(/[#?]/)[0]); } catch { return false; }
  if (path === "" || path === "/") return existsSync(join(DIST, "index.html"));
  const full = join(DIST, path);
  if (path.endsWith("/")) return existsSync(join(full, "index.html"));
  return (existsSync(full) && statSync(full).isFile()) || existsSync(join(full, "index.html"));
}

// Matches single- AND double-quoted attributes — a single-quoted emitter would
// otherwise ship unprefixed links undetected.
const ATTR = /(?:href|src)=("|')([^"']*)\1/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const htmlFiles = readdirSync(DIST, { recursive: true })
  .filter((f) => f.endsWith(".html"))
  .map((f) => join(DIST, f));
let internal = 0, bad = 0;
for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  for (const m of html.matchAll(ATTR)) {
    const href = m[2];
    if (href === "" || href.startsWith("#") || href.startsWith("//") || SCHEME.test(href)) continue;
    if (!href.startsWith("/")) {
      // A relative address. Markdown links are rewritten by remark-doc-links;
      // one written as raw HTML inside a doc is not, and would 404 here.
      fail(`RELATIVE: ${file} → ${href}`); bad++;
      continue;
    }
    internal++;
    const rest = href.slice(BASE_PATH.length);
    if (!wellPrefixed(href)) { fail(`UNPREFIXED: ${file} → ${href}`); bad++; }
    // "/base/base/x" satisfies the prefix check too — the exact blind spot a
    // non-idempotent prefix helper would create. Reject it explicitly.
    else if (BASE_PATH !== "" && rest !== "" && wellPrefixed(rest)) { fail(`DOUBLE-PREFIXED: ${file} → ${href}`); bad++; }
    else if (!built(href)) { fail(`BROKEN LINK: ${file} → ${href}`); bad++; }
  }
}
if (internal === 0) fail("link check: matched 0 internal links — the pattern is stale");
else console.log(bad === 0
  ? `link check: ${internal} internal links on ${htmlFiles.length} pages carry ${BASE_PATH || "/"} once and resolve`
  : `link check: ${bad} bad link(s)`);

// ── 5. Redirects (check 5) ───────────────────────────────────────────────
for (const { from, to } of REDIRECTS) {
  const file = join(DIST, from, "index.html");
  const target = `${BASE_PATH}${to}`;
  if (!existsSync(file)) { fail(`REDIRECT: ${from} was not built`); continue; }
  if (!readFileSync(file, "utf8").includes(`url=${target}"`)) fail(`REDIRECT: ${from} does not refresh to ${target}`);
  else if (!built(target)) fail(`REDIRECT: ${from} → ${to}, which was not built`);
  else console.log(`redirect: ${from} → ${to} OK`);
}
if (REDIRECTS.length === 0) fail("redirect check: no redirects defined — /get-started and /about must keep resolving");

// ── 6. llms.txt ──────────────────────────────────────────────────────────
// Built from string templates and not HTML, so the walk above never sees it —
// yet its whole audience (LLM crawlers) consumes exactly these URLs. Every
// markdown link must be an absolute URL that either lives on our origin *with*
// the base, or lives elsewhere.
const llms = readFileSync(join(DIST, "llms.txt"), "utf8");
let llmsLinks = 0, llmsBad = 0;
const wellSited = (url) =>
  url === SITE_URL || url === `${SITE_URL}/` ||
  url.startsWith(`${SITE_URL}/`) || url.startsWith(`${SITE_URL}#`) || url.startsWith(`${SITE_URL}?`);
for (const m of llms.matchAll(/\]\(([^)]+)\)/g)) {
  const url = m[1];
  llmsLinks++;
  const onOrigin = url === SITE_ORIGIN || url.startsWith(`${SITE_ORIGIN}/`);
  if (url.startsWith("/") || (onOrigin && !wellSited(url))) { fail(`LLMS.TXT BAD URL: ${url}`); llmsBad++; }
  else if (onOrigin && !built(url.slice(SITE_ORIGIN.length))) { fail(`LLMS.TXT BROKEN: ${url}`); llmsBad++; }
}
for (const p of PAGES) {
  if (!llms.includes(`${SITE_URL}/docs/${p.slug})`)) { fail(`LLMS.TXT: missing docs page ${p.slug}`); llmsBad++; }
}
if (llmsLinks === 0) fail("llms check: matched 0 links — the pattern is stale");
else console.log(llmsBad === 0 ? `llms check: ${llmsLinks} links OK, all ${PAGES.length} docs listed` : `llms check: ${llmsBad} problem(s)`);

process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it against a good build**

Run: `cd site && rm -rf .astro dist && npm run build`
Expected: PASS, ending with lines like:

```
manifest: 12 pages OK (12 not yet verified — allowed while ALLOW_UNVERIFIED is on)
required: 25/25 files present
federation.json: … nodes OK
link check: … internal links on 19 pages carry /org-os-template once and resolve
redirect: /get-started → /docs/setup OK
redirect: /about → /docs OK
llms check: … links OK, all 12 docs listed
```

If `link check` reports a `BROKEN LINK` or `RELATIVE` line, it is a real defect that the old check could not see. Fix it at its source (a component's `href`, or a raw-HTML link in a doc — unlink it as in Task 3) and rebuild. Do not weaken the check.

- [ ] **Step 3: Prove each check fails when it should**

Each of these breaks the build output or the manifest on purpose, confirms the named failure, and restores it. Run them one at a time from `site/`.

```bash
# (a) a page that was not built
mv dist/docs/setup dist/docs/setup.bak && npm run verify; echo "exit=$?"; mv dist/docs/setup.bak dist/docs/setup
```
Expected: `MISSING: dist/docs/setup/index.html`, several `BROKEN LINK: … → /org-os-template/docs/setup`, `REDIRECT: /get-started → /docs/setup, which was not built`, `exit=1`.

```bash
# (b) a relative link from raw HTML
cp dist/docs/setup/index.html /tmp/setup.bak
sed -i '' 's|</article>|<a href="OTHER.md">x</a></article>|' dist/docs/setup/index.html
npm run verify; echo "exit=$?"; cp /tmp/setup.bak dist/docs/setup/index.html
```
Expected: `RELATIVE: dist/docs/setup/index.html → OTHER.md`, `exit=1`. (On Linux, `sed -i` takes no `''` argument.)

```bash
# (c) a redirect that points somewhere else
cp dist/about/index.html /tmp/about.bak
sed -i '' 's|url=/org-os-template/docs"|url=/org-os-template/nowhere"|' dist/about/index.html
npm run verify; echo "exit=$?"; cp /tmp/about.bak dist/about/index.html
```
Expected: `REDIRECT: /about does not refresh to /org-os-template/docs`, `exit=1`.

```bash
# (d) a verified commit that is not in the repository
sed -i '' 's|summary: "Requirements and the steps to set up an instance.", verified: null|summary: "Requirements and the steps to set up an instance.", verified: "0000000"|' src/data/docs-manifest.mjs
npm run verify; echo "exit=$?"; git checkout src/data/docs-manifest.mjs
```
Expected: `MANIFEST: manifest: docs/SETUP.md — verified commit 0000000 is not in the repository`, `exit=1`.

```bash
# (e) the flag off, with pages still unverified
sed -i '' 's|export const ALLOW_UNVERIFIED = true;|export const ALLOW_UNVERIFIED = false;|' src/data/docs-manifest.mjs
npm run verify; echo "exit=$?"; git checkout src/data/docs-manifest.mjs
```
Expected: twelve `MANIFEST: … — not verified (no commit recorded)` lines, `exit=1`. This is the state plan 2 has to clear.

Finish with `npm run verify; echo "exit=$?"` — expected `exit=0` — and `git status --short site/src` — expected empty.

- [ ] **Step 4: Give CI the history a `verified` commit needs**

`actions/checkout@v4` fetches one commit by default, so `git cat-file -e <sha>^{commit}` would fail for every verified page. In both `.github/workflows/validate.yml` (line 14) and `.github/workflows/deploy-pages.yml` (line 33), replace

```yaml
      - uses: actions/checkout@v4
```

with

```yaml
      # Full history: the site's verify-build looks up each doc's `verified`
      # commit (site/src/data/docs-manifest.mjs). A shallow clone has one
      # commit and would fail every page.
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
```

Leave `drift.yml` and `generate-schemas.yml` as they are; they do not build the site.

- [ ] **Step 5: Update `site/README.md`**

Replace the section `## How it works` through the end of `## The generator seam` with:

```markdown
## How it works

- **Docs** are published from one manifest, `src/data/docs-manifest.mjs`: each entry names a markdown file anywhere in the repository, its address, title, section, order, summary and the commit it was checked against. Nothing is copied into `site/`. A file that is not in the manifest is not on the site.
- **Links between docs** are written as file links (`[x](FEDERATION.md)`), as the repository needs. `src/lib/remark-doc-links.mjs` turns a link to a published page into its site address and a link to any other repo file into its GitHub address at the release tag. A link that resolves to nothing fails the build.
- **Search** is Pagefind: `npm run build` indexes `dist/` after Astro builds it, and the index loads when the viewer first opens search. It does not exist under `npm run dev`, where Search falls back to the docs index — use `npm run build && npm run preview` to try it.
- **Federation** is aggregated at build by `scripts/aggregate-federation.mjs` from `../data/instances.yaml` + each sibling instance's `.well-known/` → `src/data/federation.json` (gitignored, regenerated each build). A missing/unreadable sibling degrades gracefully (node flagged `available: false`); the build never fails. The aggregator also copies org-os's own `.well-known/*.json` into `public/.well-known/`.
- **Themes**: light and dark, both loaded (`src/styles/theme.css`); `<html data-theme>` chooses, set before first paint by `src/lib/theme-boot.mjs` from the viewer's saved choice or the system setting. Palette/fonts/radius live in `src/styles/themes/`; structural tokens in `tokens.css`. `test/theme-contrast.test.mjs` holds both to WCAG AA.
- **Feedback** is a link to a prefilled GitHub issue under the `docs-feedback` label (`src/lib/feedback.mjs`). No backend, no script.
- **Graph**: the federation network on `/` and `/federation` is the `<federation-map>` web component.
- **Machine layer**: `/llms.txt` (generated from the manifest), `/federation.json`, and the surfaced `/.well-known/` EIP-4824 schemas.
- **Build checks**: `scripts/verify-build.mjs` fails the build on an invalid manifest, a page that did not build, a broken or unprefixed internal link on any page, a relative link left in the output, or a redirect that does not land.

## Pages

`/` · `/docs` (+ `/docs/<slug>`) · `/modules` (+ `/modules/rad-org-os`) · `/federation`

`/get-started` and `/about` are redirects (`src/data/redirects.mjs`).

## Adding a doc to the site

1. Write or pick the markdown file. It can live anywhere in the repository.
2. Check it against the code and note the commit you checked at.
3. Add an entry to `src/data/docs-manifest.mjs`.
4. `npm run build`. The build tells you if a link in it goes nowhere.

## The generator seam

`src/styles` + `src/components` + `src/lib` + `scripts/` are the reusable core; `src/data/` is org-os's own content (home copy, module mirror, docs manifest, redirects). This split is the basis for the future `org-os-website-generator` module — any instance would swap the data, keep the core.
```

In the same file, in `## Open decisions`, replace the first sentence so it no longer mentions the allowlist:

```markdown
A custom domain would be a new decision, made by changing `base.config.mjs`.
Specs: `../docs/superpowers/specs/2026-06-17-org-os-website-design.md` (the first
version) and `../docs/superpowers/specs/2026-10-10-site-docs-v2-design.md` (this one).
```

and in `## Run`, change the `npm run build` comment to `# aggregate → astro build → pagefind → verify  (static site → dist/)` and the `npm test` comment to `# unit tests (manifest, links, themes, search, feedback, federation, modules)`.

- [ ] **Step 6: Run everything the CI runs**

```bash
cd ~/.cache/lf-worktrees/site-docs-v2
npm test
npm run validate:structure
npm run version:check
cd site && rm -rf .astro dist && npm run build && npm test
```

Expected: every command exits 0.

- [ ] **Step 7: Commit**

```bash
git add site/scripts/verify-build.mjs site/README.md .github/workflows/validate.yml .github/workflows/deploy-pages.yml
git commit -m "feat(site): build checks read the manifest and cover every page

Manifest integrity, every manifest page built, every internal link on every
page prefixed once and resolving, no relative links left in the output,
redirects landing, llms.txt listing every doc. CI checks out full history so
a doc's verified commit can be looked up.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the last task

Not a task for a subagent — the handoff to the operator.

1. `cd site && rm -rf .astro dist && npm run build && npm run preview`, and give the operator `http://localhost:4321/org-os-template/`.
2. The operator looks, by eye (spec §7): each page type at desktop and phone width, in both themes; keyboard through the nav, sidebar, search and toggle; one page with script turned off.
3. **Nothing is pushed.** The branch stays local until plan 3.

## Left for plan 2 (content)

- Set `verified` on every page and turn `ALLOW_UNVERIFIED` off.
- Add the remaining pages of spec §3 to the manifest, including the new ones.
- `/about` → `/docs/overview` in `redirects.mjs`; the home page's intro link → `/docs/overview`.
- `site/scripts/docs-drift.mjs` and its CI step (spec §5.5).
- Revisit the links unlinked in Task 3 when ECOSYSTEM, EIP4824-GUIDE and SETUP are verified: some may deserve a real target.
- Anything Task 5 noted about the federation map under the dark theme.
