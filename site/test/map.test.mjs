import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { missingInstalls, installMessage } from "../scripts/installs.mjs";

const orgOsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("buildMap runs against the real org-os root (siblings may be absent)", async () => {
  // packages/org-os-kms needs the root install; say so in words when it is missing.
  const missing = missingInstalls(orgOsRoot);
  assert.equal(missing.length, 0, installMessage(missing, orgOsRoot));
  const { buildMap } = await import("../../packages/org-os-kms/src/map.mjs");
  const map = buildMap({ dir: orgOsRoot, now: "2026-07-19T00:00:00Z" });
  assert.equal(map.self.id, "org-os");
  assert.ok(map.nodes.length >= 2, "at least the federation.yaml peers/downstream render");
  assert.ok(map.nodes.every((n) => n.id && n.kind && typeof n.ring === "number"));
});
