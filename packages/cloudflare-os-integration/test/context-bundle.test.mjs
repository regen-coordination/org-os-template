import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildContextBundle } from "../src/gatekeeper/context-bundle.mjs";
import { MemorySubstrate } from "../src/substrate/memory-substrate.mjs";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

// Walks a fixture instance into the flat { "relative/path": contents } map the page core consumes.
// See test/fixtures/README.md — fixture dates are calibrated to NOW; change both or neither.
function loadFixture(name = "instance-a") {
  const walk = (dir, prefix = "") => {
    const files = {};
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) Object.assign(files, walk(p, `${prefix}${e.name}/`));
      else files[`${prefix}${e.name}`] = fs.readFileSync(p, "utf-8");
    }
    return files;
  };
  return walk(path.join(fixturesDir, name));
}

test("bundle: identity, agent rules, memory index, recent decisions, registry snapshots, provenance", async () => {
  const sub = new MemorySubstrate(loadFixture(), { sha: "abc123", date: "2026-08-08" });
  const b = await buildContextBundle(sub, { maxBytesPerSection: 64_000 });
  assert.ok(b.identity.includes("#"));
  assert.ok(b.agentRules.length > 0);
  assert.ok(b.memoryIndex.length > 0);
  assert.equal(b.recentDecisions.length, 3);            // instance-a has 3 dated "## " entries
  assert.ok(b.registries.projects.projects.length === 2);
  assert.deepEqual(b.provenance, { sha: "abc123", date: "2026-08-08" });
});

test("missing files degrade to null, never throw; oversize sections truncate with flag", async () => {
  const sub = new MemorySubstrate({ "IDENTITY.md": "# I\n" + "x".repeat(100) }, { sha: "s", date: "d" });
  const b = await buildContextBundle(sub, { maxBytesPerSection: 10 });
  assert.equal(b.identity.length, 10);
  assert.equal(b.truncated.includes("identity"), true);
  assert.equal(b.agentRules, null);
  assert.deepEqual(b.registries.projects, null);
});

test("recentDecisions takes dated entries only, skipping boilerplate headings", async () => {
  const sub = new MemorySubstrate(loadFixture("instance-b"), { sha: "s", date: "d" });
  const b = await buildContextBundle(sub, {});
  assert.equal(b.recentDecisions.length, 2);                       // "## Conventions" excluded
  assert.ok(b.recentDecisions.every((d) => /^## \d{4}-\d{2}-\d{2}/.test(d)));
});

// ── supplementary coverage (not from the plan, added per self-review) ──────

test("completely empty substrate produces a full null bundle without throwing", async () => {
  const sub = new MemorySubstrate({}, { sha: "s", date: "d" });
  const b = await buildContextBundle(sub, {});
  assert.deepEqual(b, {
    identity: null,
    agentRules: null,
    memoryIndex: null,
    recentDecisions: [],
    registries: { projects: null, members: null },
    provenance: { sha: "s", date: "d" },
    truncated: [],
  });
});

test("recentDecisions: more than 5 dated sections keeps only the 5 most recent, newest-first", async () => {
  // org-os DECISIONS.md convention is append-only newest-first (verified against
  // the framework's own root DECISIONS.md), so "the last 5" means the 5 most
  // recent decisions — the first 5 dated sections encountered top-to-bottom —
  // not the literal last 5 lines of the file (which would be the oldest).
  const decisions = [
    "## 2026-08-07 · Seventh",
    "body 7",
    "## 2026-08-06 · Sixth",
    "body 6",
    "## 2026-08-05 · Fifth",
    "body 5",
    "## 2026-08-04 · Fourth",
    "body 4",
    "## 2026-08-03 · Third",
    "body 3",
    "## 2026-08-02 · Second",
    "body 2",
    "## 2026-08-01 · First",
    "body 1",
    "",
  ].join("\n");
  const sub = new MemorySubstrate({ "DECISIONS.md": decisions }, { sha: "s", date: "d" });
  const b = await buildContextBundle(sub, {});
  assert.equal(b.recentDecisions.length, 5);
  assert.deepEqual(
    b.recentDecisions.map((d) => d.split("\n")[0]),
    [
      "## 2026-08-07 · Seventh",
      "## 2026-08-06 · Sixth",
      "## 2026-08-05 · Fifth",
      "## 2026-08-04 · Fourth",
      "## 2026-08-03 · Third",
    ],
  );
});

test("DECISIONS.md with no dated sections yields [], not a throw", async () => {
  const sub = new MemorySubstrate({ "DECISIONS.md": "# Log\n\n## Conventions\n\nNo dated entries here.\n" }, { sha: "s", date: "d" });
  const b = await buildContextBundle(sub, {});
  assert.deepEqual(b.recentDecisions, []);
});

test("SubstrateError with code UPSTREAM propagates rather than degrading to null", async () => {
  const { SubstrateError } = await import("../src/substrate/memory-substrate.mjs");
  const sub = {
    async readFile(p) {
      if (p === "IDENTITY.md") throw new SubstrateError("UPSTREAM", "rate limited");
      throw new SubstrateError("NOT_FOUND", `not found: ${p}`);
    },
    async head() {
      return { sha: "s", date: "d" };
    },
  };
  await assert.rejects(
    () => buildContextBundle(sub, {}),
    (e) => e instanceof SubstrateError && e.code === "UPSTREAM",
  );
});
