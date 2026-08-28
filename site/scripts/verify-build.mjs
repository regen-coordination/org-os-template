// verify-build.mjs — integrity checks on the static build. Runs after `astro build`.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BASE_PATH } from "../base.config.mjs";

const DIST = "dist";

// The site deploys to a GitHub Pages project path. Astro applies `base` to the
// URLs it *emits* but still writes a flat dist/, so the files stay at the root
// while every internal link must carry the prefix. BASE_PATH comes from
// base.config.mjs so this cannot drift from astro.config.mjs.
const ROOT = DIST;

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
  const full = join(ROOT, p);
  if (!existsSync(full)) { console.error(`MISSING: ${full}`); failed = true; }
  else console.log(`OK:      ${full}`);
}

// federation.json shape check
try {
  const fed = JSON.parse(readFileSync(join(ROOT, "federation.json"), "utf8"));
  if (fed.root?.id !== "org-os") { console.error("federation.json: root.id !== org-os"); failed = true; }
  if (!Array.isArray(fed.nodes) || fed.nodes.length === 0) { console.error("federation.json: no nodes"); failed = true; }
  else console.log(`federation.json: ${fed.nodes.length} nodes OK`);
} catch (e) { console.error(`federation.json: unreadable — ${e.message}`); failed = true; }

// Internal link check: docs index links resolve to built pages.
const docsIndex = readFileSync(join(ROOT, "docs/index.html"), "utf8");
const docLink = new RegExp(`href="${BASE_PATH}/docs/([a-z0-9-]+)"`, "g");
let docLinks = 0;
for (const m of docsIndex.matchAll(docLink)) {
  docLinks++;
  const target = join(ROOT, "docs", m[1], "index.html");
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
const INTERNAL_ATTR = /(?:href|src)="(\/[^"]*)"/g;
function htmlFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlFiles(full));
    else if (e.name.endsWith(".html")) out.push(full);
  }
  return out;
}
let unprefixed = 0;
for (const file of htmlFiles(ROOT)) {
  const html = readFileSync(file, "utf8");
  for (const m of html.matchAll(INTERNAL_ATTR)) {
    const href = m[1];
    if (href.startsWith("//")) continue;                 // protocol-relative, external
    if (href.startsWith(`${BASE_PATH}/`) || href === BASE_PATH) continue;
    console.error(`UNPREFIXED: ${file} → ${href}`);
    unprefixed++;
    failed = true;
  }
}
console.log(
  unprefixed === 0
    ? `base check: all internal links carry ${BASE_PATH}`
    : `base check: ${unprefixed} unprefixed internal link(s)`,
);

process.exit(failed ? 1 : 0);
