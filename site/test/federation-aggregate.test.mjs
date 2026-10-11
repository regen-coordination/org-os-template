// What the site may say about a registered instance: its name, its type and its
// link. Nothing else from data/instances.yaml reaches federation.json — the
// registry's notes are the maintainer's working notes, not text for a public page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import {
  parseRegistry, PUBLIC_FIELDS, publicInstance, isOperational, OPERATIONAL_DEFINITION, aggregate, quietMap,
} from "../scripts/federation-aggregate.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const registryYaml = readFileSync(join(FIX, "instances.yaml"), "utf8");

test("parseRegistry returns the raw instance array", () => {
  const raw = parseRegistry(registryYaml);
  assert.equal(raw.length, 3);
  assert.equal(raw[0].id, "present-instance");
});

test("the agreed public fields are name, type and repo", () => {
  assert.deepEqual(PUBLIC_FIELDS, ["name", "type", "repo"]);
});

test("publicInstance keeps only the public fields", () => {
  const node = publicInstance(parseRegistry(registryYaml)[0]);
  assert.deepEqual(node, { name: "Present Instance", type: "LocalNode", repo: "https://example.com/present" });
});

test("publicInstance gives an instance without a repository a null link, and a name when it has only an id", () => {
  assert.deepEqual(publicInstance({ id: "bare", notes: "x" }), { name: "bare", type: "Instance", repo: null });
});

test("an instance is operational when the registry marks its maturity as production", () => {
  assert.equal(isOperational({ maturity: "production" }), true);
  assert.equal(isOperational({ maturity: "beta" }), false);
  assert.equal(isOperational({ maturity: "alpha" }), false);
  assert.equal(isOperational({}), false);
  assert.match(OPERATIONAL_DEFINITION, /maturity/);
  assert.match(OPERATIONAL_DEFINITION, /production/);
  assert.match(OPERATIONAL_DEFINITION, /data\/instances\.yaml/);
});

test("aggregate counts the registered and the operational instances", () => {
  const fed = aggregate({ registryYaml, now: "2026-06-17T00:00:00Z" });
  assert.equal(fed.registered, 3);
  assert.equal(fed.operational, 1); // only present-instance is `production` in the fixture
  assert.equal(fed.operationalDefinition, OPERATIONAL_DEFINITION);
  assert.equal(fed.generatedAt, "2026-06-17T00:00:00Z");
});

test("aggregate's output carries no field outside the public list, for any node or the root", () => {
  const fed = aggregate({ registryYaml, now: "2026-06-17T00:00:00Z" });
  assert.deepEqual(Object.keys(fed).sort(), ["generatedAt", "nodes", "operational", "operationalDefinition", "registered", "root"]);
  for (const node of [fed.root, ...fed.nodes]) assert.deepEqual(Object.keys(node), PUBLIC_FIELDS);
  assert.equal(fed.root.name, "org-os");
});

test("no text from notes, and no local path, is in aggregate's output", () => {
  const out = JSON.stringify(aggregate({ registryYaml, now: "2026-06-17T00:00:00Z" }));
  for (const raw of parseRegistry(registryYaml)) {
    assert.ok(!out.includes(raw.notes), `notes of ${raw.id} reached the output`);
    assert.ok(!out.includes(raw.local_path), `local_path of ${raw.id} reached the output`);
  }
});

test("quietMap drops a false `live` and an empty `last_seen`, so an instance not read at build shows no status", () => {
  const map = { self: { id: "org-os" }, edges: [], nodes: [
    { id: "a", name: "A", live: false, last_seen: null, counts: {} },
    { id: "b", name: "B", live: true, last_seen: "2026-06-17T00:00:00Z", counts: { members: 2 } },
    { id: "c", name: "C" },
  ] };
  const quiet = quietMap(map);
  assert.deepEqual(quiet.nodes[0], { id: "a", name: "A", counts: {} });
  assert.deepEqual(quiet.nodes[1], map.nodes[1]);
  assert.deepEqual(quiet.nodes[2], { id: "c", name: "C" });
  assert.equal(map.nodes[0].live, false, "the input is not changed");
});
