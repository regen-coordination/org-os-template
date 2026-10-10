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
