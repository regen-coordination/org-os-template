import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { parseRegistry, toNode, enrichFromDisk, deriveEdges, aggregate } from "../scripts/federation-aggregate.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const registryYaml = readFileSync(join(FIX, "instances.yaml"), "utf8");

test("parseRegistry returns the raw instance array", () => {
  const raw = parseRegistry(registryYaml);
  assert.equal(raw.length, 3);
  assert.equal(raw[0].id, "present-instance");
});

test("toNode normalizes a registry entry", () => {
  const node = toNode(parseRegistry(registryYaml)[0]);
  assert.equal(node.id, "present-instance");
  assert.equal(node.role, "spoke");
  assert.equal(node.network, "refi-dao");
  assert.equal(node.available, false); // not enriched yet
});

test("enrichFromDisk sets available + counts when data is readable", () => {
  const node = toNode(parseRegistry(registryYaml)[0]);
  const enriched = enrichFromDisk(node, join(FIX, "present-instance"));
  assert.equal(enriched.available, true);
  assert.equal(enriched.counts.members, 3);
});

test("enrichFromDisk degrades gracefully when the path is absent", () => {
  const node = toNode(parseRegistry(registryYaml)[2]);
  const enriched = enrichFromDisk(node, join(FIX, "does-not-exist"));
  assert.equal(enriched.available, false);
  assert.deepEqual(enriched.counts, {});
});

test("deriveEdges links spokes to their hub and instances to the framework root", () => {
  const nodes = parseRegistry(registryYaml).map(toNode);
  const edges = deriveEdges(nodes, "org-os");
  assert.ok(edges.some((e) => e.from === "present-instance" && e.to === "hub-instance" && e.kind === "federation"));
  assert.ok(edges.some((e) => e.from === "present-instance" && e.to === "org-os" && e.kind === "framework"));
  // missing-instance has framework_version null → no framework edge
  assert.ok(!edges.some((e) => e.from === "missing-instance" && e.kind === "framework"));
});

test("aggregate produces a root + nodes + edges and never throws on a missing sibling", () => {
  const fed = aggregate({ registryYaml, baseDir: FIX, now: "2026-06-17T00:00:00Z" });
  assert.equal(fed.root.id, "org-os");
  assert.equal(fed.nodes.length, 3);
  assert.equal(fed.generatedAt, "2026-06-17T00:00:00Z");
  const missing = fed.nodes.find((n) => n.id === "missing-instance");
  assert.equal(missing.available, false);
});
