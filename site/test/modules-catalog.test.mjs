// site/test/modules-catalog.test.mjs
//
// Enforces the canonical chain declared at the top of docs/MODULES.md:
// MODULES.md is canon, site/src/data/modules.yaml mirrors it. Without this the
// "canonical" claim is a comment nobody checks, and the two lists drift the way
// modules.yaml and the v5 spec already had.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const siteRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATUSES = ["planned", "in-dev", "pilot", "live"];

const catalog = readFileSync(join(siteRoot, "..", "docs", "MODULES.md"), "utf8");
const modules = yaml.load(readFileSync(join(siteRoot, "src", "data", "modules.yaml"), "utf8")).modules;

// Entry headings are "### <id> — <Name>"; the em-dash separator is load-bearing.
const catalogIds = new Set([...catalog.matchAll(/^### ([a-z0-9-]+) — /gm)].map((m) => m[1]));

// "**Status.** `pilot` — …" under each entry heading.
const catalogStatus = new Map(
  catalog.split(/^### /m).slice(1).flatMap((block) => {
    const id = block.match(/^([a-z0-9-]+) — /)?.[1];
    const status = block.match(/\*\*Status\.\*\* `([a-z-]+)`/)?.[1];
    return id ? [[id, status]] : [];
  }),
);

test("MODULES.md declares at least the tracked module", () => {
  assert.ok(catalogIds.has("org-os-cloudflare-os"), "catalog is missing org-os-cloudflare-os");
});

test("every module on the site appears in the MODULES.md catalog", () => {
  for (const m of modules) {
    assert.ok(catalogIds.has(m.id), `modules.yaml has "${m.id}", MODULES.md does not`);
  }
});

test("every site module uses the shared status vocabulary", () => {
  for (const m of modules) {
    assert.ok(STATUSES.includes(m.status), `"${m.id}" has unknown status "${m.status}"`);
  }
});

test("site module ids are unique", () => {
  const ids = modules.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate module id in modules.yaml");
});

test("every module in the MODULES.md catalog appears on the site", () => {
  const siteIds = new Set(modules.map((m) => m.id));
  for (const id of catalogIds) assert.ok(siteIds.has(id), `MODULES.md has "${id}", modules.yaml does not`);
});

test("each site module carries the status the catalog gives it", () => {
  for (const m of modules) {
    assert.equal(m.status, catalogStatus.get(m.id), `"${m.id}": modules.yaml says ${m.status}, MODULES.md says ${catalogStatus.get(m.id)}`);
  }
});
