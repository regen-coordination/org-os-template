import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySubstrate, SubstrateError } from "../src/substrate/memory-substrate.mjs";

const sub = new MemorySubstrate(
  { "data/projects.yaml": "projects: []", "data/members.yaml": "members: []", "IDENTITY.md": "# I" },
  { sha: "abc123", date: "2026-08-08" },
);

test("readFile returns content, NOT_FOUND otherwise", async () => {
  assert.equal(await sub.readFile("IDENTITY.md"), "# I");
  await assert.rejects(() => sub.readFile("nope.md"), (e) => e instanceof SubstrateError && e.code === "NOT_FOUND");
});

test("listDir lists direct children", async () => {
  assert.deepEqual(await sub.listDir("data"), [
    { name: "members.yaml", type: "file" },
    { name: "projects.yaml", type: "file" },
  ]);
});

test("head + proposeChange", async () => {
  assert.deepEqual(await sub.head(), { sha: "abc123", date: "2026-08-08" });
  await assert.rejects(() => sub.proposeChange({}), /M3/);
});

// ── listDir: nested dirs dedupe to a single "dir" entry, sorted with files ──
test("listDir dedupes nested subdirectories into a single dir entry, sorted", async () => {
  const nested = new MemorySubstrate(
    {
      "data/projects.yaml": "projects: []",
      "data/members.yaml": "members: []",
      "data/archive/old.yaml": "archived: true",
      "data/archive/older.yaml": "archived: true",
    },
    { sha: "abc123", date: "2026-08-08" },
  );

  assert.deepEqual(await nested.listDir("data"), [
    { name: "archive", type: "dir" },
    { name: "members.yaml", type: "file" },
    { name: "projects.yaml", type: "file" },
  ]);
});

// ── listDir: a path with no children returns [] rather than throwing ───────
test("listDir returns empty array for a path with no children", async () => {
  assert.deepEqual(await sub.listDir("docs/agent-plans"), []);
});

// ── Documented precondition-violation behavior, not a feature: a leading or
// trailing slash makes `path` match no key, so listDir quietly returns [].
// Pinned here so a future refactor can't silently change this to a throw.
test("listDir returns [] for paths violating the no-leading/trailing-slash precondition", async () => {
  assert.deepEqual(await sub.listDir("data/"), []);
  assert.deepEqual(await sub.listDir("/data"), []);
});
