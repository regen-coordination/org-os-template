// The rad-org-os capability map is content, not code — but its tier labels carry the
// page's honesty contract (Now = true today), and a typo in `status` silently renders an
// empty badge while the build still exits 0. These assertions are that missing guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "rad-org-os.yaml");
const doc = yaml.load(readFileSync(DATA, "utf8"));

test("the capability map has exactly the three honesty tiers, in order", () => {
  assert.deepEqual(doc.tiers.map((t) => t.label), ["Now", "Next", "Later"]);
});

test("every tier status is a StatusBadge variant", () => {
  const VALID = new Set(["planned", "in-dev", "live"]);
  for (const tier of doc.tiers) {
    assert.ok(VALID.has(tier.status), `tier ${tier.label} has unrenderable status "${tier.status}"`);
  }
});

test("every tier carries a legend and at least one item", () => {
  for (const tier of doc.tiers) {
    assert.ok(tier.desc?.length, `tier ${tier.label} is missing its desc legend`);
    assert.ok(tier.items?.length > 0, `tier ${tier.label} has no items`);
  }
});

test("every item has non-empty title and body", () => {
  for (const tier of doc.tiers) {
    for (const [i, item] of tier.items.entries()) {
      assert.ok(item.title?.length, `${tier.label}[${i}] is missing a title`);
      assert.ok(item.body?.length, `${tier.label}[${i}] (${item.title}) is missing a body`);
    }
  }
});
