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
  isListed, registryView,
} from "../scripts/federation-aggregate.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const registryYaml = readFileSync(join(FIX, "instances.yaml"), "utf8");

test("parseRegistry returns the raw instance array", () => {
  const raw = parseRegistry(registryYaml);
  assert.equal(raw.length, 4);
  assert.equal(raw[0].id, "present-instance");
});

// ── listed: false (operator decision, 2026-10-11) ────────────────────────
// The registry may mark an entry `listed: false`: a test fixture, an agent
// runtime. It is left out of the list and of both counts. `listed` chooses what
// is published; it is not itself published.

test("the fixture holds what these tests need: an entry with listed: false, one with listed: true and one without the field", () => {
  const raw = parseRegistry(registryYaml);
  assert.deepEqual(raw.filter((e) => e.listed === false).map((e) => e.id), ["unlisted-instance"]);
  assert.ok(raw.some((e) => e.listed === true));
  assert.ok(raw.some((e) => !("listed" in e)));
  // production, so a count that forgot the filter is off by one in `operational` too
  assert.equal(raw.find((e) => e.id === "unlisted-instance").maturity, "production");
});

test("an entry is unlisted only when listed is the literal false", () => {
  assert.equal(isListed({ listed: false }), false);
  for (const listed of [true, undefined, null, "false", "no", 0, ""]) {
    assert.equal(isListed({ listed }), true, `listed: ${JSON.stringify(listed)} must stay on the list`);
  }
  assert.equal(isListed({}), true);
});

test("aggregate leaves an unlisted entry out of the list", () => {
  const fed = aggregate({ registryYaml, now: "2026-06-17T00:00:00Z" });
  assert.deepEqual(fed.nodes.map((n) => n.name), ["Present Instance", "Hub Instance", "Missing Instance"]);
  assert.ok(!JSON.stringify(fed).includes("Unlisted Instance"));
  assert.ok(!JSON.stringify(fed).includes("example.com/unlisted"));
});

test("the registered count follows the list, and operational is counted among the listed by the same definition", () => {
  const fed = aggregate({ registryYaml, now: "2026-06-17T00:00:00Z" });
  assert.equal(fed.registered, fed.nodes.length);
  assert.equal(fed.registered, 3);
  // two fixture entries are `production`; the unlisted one is not counted
  assert.equal(parseRegistry(registryYaml).filter(isOperational).length, 2);
  assert.equal(fed.operational, 1);
});

test("listed is a filter, not a public field: it is in no node and nowhere in the output", () => {
  assert.ok(!PUBLIC_FIELDS.includes("listed"));
  const fed = aggregate({ registryYaml, now: "2026-06-17T00:00:00Z" });
  for (const node of [fed.root, ...fed.nodes]) assert.ok(!("listed" in node));
  assert.ok(!/listed/i.test(JSON.stringify(fed)), "the word reached federation.json");
});

test("registryView is the one rule the aggregator and the verifier share", () => {
  const raw = parseRegistry(registryYaml);
  const view = registryView(raw);
  const fed = aggregate({ registryYaml, now: "2026-06-17T00:00:00Z" });
  assert.deepEqual(view.nodes, fed.nodes);
  assert.equal(view.registered, fed.registered);
  assert.equal(view.operational, fed.operational);
  assert.deepEqual(view.unlisted, [{ name: "Unlisted Instance", type: "Cooperative", repo: "https://example.com/unlisted" }]);
});

test("on the real registry the list and the count leave out exactly the entries marked listed: false", () => {
  const real = parseRegistry(readFileSync(new URL("../../data/instances.yaml", import.meta.url), "utf8"));
  const unlisted = real.filter((e) => e.listed === false);
  assert.ok(unlisted.length > 0, "data/instances.yaml marks no entry listed: false; this test would look at nothing");
  const view = registryView(real);
  assert.equal(view.registered, real.length - unlisted.length);
  assert.equal(view.nodes.length, view.registered);
  for (const e of unlisted) assert.ok(!view.nodes.some((n) => n.name === e.name), `${e.id} is on the list`);
  assert.ok(view.operational <= view.registered);
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

// The registry's dates of last sync are not published, so the page cannot say how
// old the label is; it can and must say that a person set it and nothing measures it.
test("the definition says the maturity is set by hand and not measured", () => {
  assert.match(OPERATIONAL_DEFINITION, /maintainer sets .* by hand/);
  assert.match(OPERATIONAL_DEFINITION, /does not measure/);
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
