// verify-build.mjs — integrity checks on the static build. Runs after `astro build`.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BASE_PATH, SITE_ORIGIN, SITE_URL } from "../base.config.mjs";

// The site deploys to a GitHub Pages project path. Astro applies `base` to the
// URLs it *emits* but still writes a flat dist/, so the files stay at the root
// while every internal link must carry the prefix. BASE_PATH comes from
// base.config.mjs so this cannot drift from astro.config.mjs.
const DIST = "dist";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const REQUIRED = [
  "index.html",
  "modules/index.html",
  "modules/rad-org-os/index.html",
  "federation/index.html",
  "docs/index.html",
  "docs/architecture/index.html",
  "docs/modules/index.html",
  "docs/federation/index.html",
  "docs/rad-org-os/index.html",
  "get-started/index.html",
  "about/index.html",
  "llms.txt",
  "federation.json",
  "map.json",
  ".well-known/members.json",   // surfaced EIP-4824 schema (copied by the aggregate step)
];
let failed = false;
for (const p of REQUIRED) {
  const full = join(DIST, p);
  if (!existsSync(full)) { console.error(`MISSING: ${full}`); failed = true; }
  else console.log(`OK:      ${full}`);
}

// federation.json shape check
try {
  const fed = JSON.parse(readFileSync(join(DIST, "federation.json"), "utf8"));
  if (fed.root?.id !== "org-os") { console.error("federation.json: root.id !== org-os"); failed = true; }
  if (!Array.isArray(fed.nodes) || fed.nodes.length === 0) { console.error("federation.json: no nodes"); failed = true; }
  else console.log(`federation.json: ${fed.nodes.length} nodes OK`);
} catch (e) { console.error(`federation.json: unreadable — ${e.message}`); failed = true; }

// Internal link check: docs index links resolve to built pages. BASE_PATH is
// regex-escaped (a future path like "/v0.5" would otherwise turn "." into a
// wildcard) and the slug charset is permissive — a slug the pattern cannot
// match would be silently exempted from the check.
const docsIndex = readFileSync(join(DIST, "docs/index.html"), "utf8");
const docLink = new RegExp(`href="${escapeRe(BASE_PATH)}/docs/([A-Za-z0-9._-]+)"`, "g");
let docLinks = 0;
for (const m of docsIndex.matchAll(docLink)) {
  docLinks++;
  const target = join(DIST, "docs", m[1], "index.html");
  if (!existsSync(target)) { console.error(`BROKEN LINK: ${m[1]} → ${target}`); failed = true; }
}
if (docLinks === 0) {
  // Guards the check itself: if the prefix ever changes shape, this loop would
  // silently match nothing and "pass" while every link on the page was broken.
  console.error(`link check: matched 0 doc links under ${BASE_PATH}/docs/ — the pattern is stale`);
  failed = true;
} else {
  console.log(`link check: ${docLinks} doc links OK`);
}

// Base-prefix gate (WS-D D1): no internal reference may skip the base, or it
// escapes the project path and 404s on the user page. Checks every built page,
// not just the landing one, since nav/footer are shared but page bodies are not.
// Matches single- AND double-quoted attributes — a single-quoted emitter would
// otherwise ship unprefixed links undetected.
const INTERNAL_ATTR = /(?:href|src)=("|')(\/[^"']*)\1/g;
// A correctly-prefixed href is the bare base or the base followed by a path,
// fragment, or query ("/base#x" and "/base?q=y" are valid same-site links).
const wellPrefixed = (href) =>
  href === BASE_PATH ||
  href.startsWith(`${BASE_PATH}/`) ||
  href.startsWith(`${BASE_PATH}#`) ||
  href.startsWith(`${BASE_PATH}?`);
const htmlFiles = readdirSync(DIST, { recursive: true })
  .filter((f) => f.endsWith(".html"))
  .map((f) => join(DIST, f));
let badLinks = 0;
for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  for (const m of html.matchAll(INTERNAL_ATTR)) {
    const href = m[2];
    if (href.startsWith("//")) continue;                 // protocol-relative, external
    const rest = href.slice(BASE_PATH.length);
    if (!wellPrefixed(href)) {
      console.error(`UNPREFIXED: ${file} → ${href}`);
      badLinks++; failed = true;
    } else if (rest !== "" && wellPrefixed(rest)) {
      // "/base/base/x" satisfies the prefix check too — the exact blind spot a
      // non-idempotent prefix helper would create. Reject it explicitly.
      console.error(`DOUBLE-PREFIXED: ${file} → ${href}`);
      badLinks++; failed = true;
    }
  }
}
console.log(
  badLinks === 0
    ? `base check: all internal links carry ${BASE_PATH} exactly once (${htmlFiles.length} pages)`
    : `base check: ${badLinks} bad internal link(s)`,
);

// llms.txt gate: built from hand-maintained string templates and not HTML, so
// the walk above never sees it — yet its whole audience (LLM crawlers) consumes
// exactly these URLs. Every markdown link must be an absolute URL that either
// lives on our origin *with* the base, or lives elsewhere; a root-relative path
// or an on-origin URL missing the base would 404 on the user page.
const llms = readFileSync(join(DIST, "llms.txt"), "utf8");
let llmsLinks = 0, llmsBad = 0;
const wellSited = (url) =>
  url === SITE_URL || url === `${SITE_URL}/` ||
  url.startsWith(`${SITE_URL}/`) || url.startsWith(`${SITE_URL}#`) || url.startsWith(`${SITE_URL}?`);
for (const m of llms.matchAll(/\]\(([^)]+)\)/g)) {
  const url = m[1];
  llmsLinks++;
  const onOrigin = url === SITE_ORIGIN || url.startsWith(`${SITE_ORIGIN}/`);
  if (url.startsWith("/") || (onOrigin && !wellSited(url))) {
    console.error(`LLMS.TXT BAD URL: ${url}`);
    llmsBad++; failed = true;
  }
}
if (llmsLinks === 0) {
  console.error("llms check: matched 0 links — the pattern is stale");
  failed = true;
} else if (llmsBad === 0) {
  console.log(`llms check: ${llmsLinks} links OK`);
} else {
  console.log(`llms check: ${llmsBad} bad link(s)`);
}

process.exit(failed ? 1 : 0);
