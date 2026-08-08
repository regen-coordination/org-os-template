import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGatekeeper, READ_CAPABILITIES } from "../src/gatekeeper/capabilities.mjs";
import { MemorySubstrate, SubstrateError } from "../src/substrate/memory-substrate.mjs";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

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

// ── plan's verbatim scenario ─────────────────────────────────────────────────

const gk = createGatekeeper({
  instances: [{ id: "instance-a", owner: "o", repo: "r", ref: "main", trust: "read" }],
  substrateFor: () => new MemorySubstrate(loadFixture(), { sha: "abc123", date: "2026-08-08" }),
  now: () => new Date("2026-08-08T12:00:00Z"),
});

test("capability catalog", () => {
  assert.deepEqual(READ_CAPABILITIES, ["get_registry", "get_federation", "get_schema", "get_context_bundle"]);
});

test("get_registry parses a data/ registry with provenance", async () => {
  const r = await gk.handle("get_registry", { instance: "instance-a", name: "projects" });
  assert.equal(r.ok, true);
  assert.equal(r.data.projects.length, 2);
  assert.deepEqual(r.provenance, { instance: "instance-a", sha: "abc123", date: "2026-08-08", stale: false });
});

test("get_registry rejects path-ish names", async () => {
  const r = await gk.handle("get_registry", { instance: "instance-a", name: "../SOUL" });
  assert.deepEqual(r.error.code, "BAD_ARGS");
});

test("get_federation, get_schema, get_context_bundle", async () => {
  assert.equal((await gk.handle("get_federation", { instance: "instance-a" })).data.network, "test-net");
  assert.equal((await gk.handle("get_schema", { instance: "instance-a", name: "dao" })).data.name, "instance-a");
  assert.ok((await gk.handle("get_context_bundle", { instance: "instance-a" })).data.identity);
});

test("unknown instance / capability / registry", async () => {
  assert.equal((await gk.handle("get_registry", { instance: "nope", name: "projects" })).error.code, "UNKNOWN_INSTANCE");
  assert.equal((await gk.handle("write_stuff", {})).error.code, "UNKNOWN_CAPABILITY");
  assert.equal((await gk.handle("get_registry", { instance: "instance-a", name: "zzz" })).error.code, "NOT_FOUND");
});

// ── name validation: BAD_ARGS on every path-ish shape ────────────────────────

test("get_registry / get_schema reject .., /, ., empty, and uppercase names", async () => {
  const badNames = ["..", "/", ".", "", "Projects", "a/b", "a..b", "a.b"];
  for (const name of badNames) {
    const rReg = await gk.handle("get_registry", { instance: "instance-a", name });
    assert.equal(rReg.error?.code, "BAD_ARGS", `get_registry name=${JSON.stringify(name)}`);
    const rSchema = await gk.handle("get_schema", { instance: "instance-a", name });
    assert.equal(rSchema.error?.code, "BAD_ARGS", `get_schema name=${JSON.stringify(name)}`);
  }
});

test("get_schema happy path and NOT_FOUND for missing schema", async () => {
  const r = await gk.handle("get_schema", { instance: "instance-a", name: "zzz" });
  assert.equal(r.error.code, "NOT_FOUND");
});

// ── never-throws exploration ──────────────────────────────────────────────────

test("handle never throws: null args, missing instance, wrong-typed args", async () => {
  await assert.doesNotReject(() => gk.handle("get_registry", null));
  await assert.doesNotReject(() => gk.handle("get_registry", {}));
  await assert.doesNotReject(() => gk.handle("get_registry", { instance: "instance-a", name: 42 }));
  await assert.doesNotReject(() => gk.handle(null, {}));
  await assert.doesNotReject(() => gk.handle(undefined, undefined));

  // Instance resolution runs before capability-specific arg validation, so
  // missing/null args surface as UNKNOWN_INSTANCE (no instance to resolve),
  // not BAD_ARGS — either is a valid error envelope; this pins the actual
  // precedence so it doesn't drift silently.
  const r1 = await gk.handle("get_registry", null);
  assert.equal(r1.ok, false);
  assert.equal(r1.error.code, "UNKNOWN_INSTANCE");

  const r2 = await gk.handle("get_registry", {});
  assert.equal(r2.ok, false);
  assert.equal(r2.error.code, "UNKNOWN_INSTANCE");
});

test("a substrate that throws a non-SubstrateError maps to UPSTREAM", async () => {
  const gk2 = createGatekeeper({
    instances: [{ id: "instance-a", owner: "o", repo: "r" }],
    substrateFor: () => ({
      readFile: async () => {
        throw new TypeError("boom");
      },
      listDir: async () => [],
      head: async () => ({ sha: "s", date: "d" }),
      proposeChange: async () => {
        throw new Error("M3");
      },
    }),
    now: () => new Date(),
  });
  const r = await gk2.handle("get_registry", { instance: "instance-a", name: "projects" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "UPSTREAM");
});

test("malformed YAML registry maps to UPSTREAM with a named message", async () => {
  const gk2 = createGatekeeper({
    instances: [{ id: "instance-a", owner: "o", repo: "r" }],
    substrateFor: () => new MemorySubstrate({ "data/broken.yaml": "key: [unterminated" }, { sha: "s", date: "d" }),
    now: () => new Date(),
  });
  const r = await gk2.handle("get_registry", { instance: "instance-a", name: "broken" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "UPSTREAM");
  assert.match(r.error.message, /registry parse failed: broken/);
});

test("a SubstrateError with code UPSTREAM (not just NOT_FOUND) passes its code through unchanged", async () => {
  const gk2 = createGatekeeper({
    instances: [{ id: "instance-a", owner: "o", repo: "r" }],
    substrateFor: () => ({
      readFile: async () => {
        throw new SubstrateError("UPSTREAM", "GitHub API 500");
      },
      listDir: async () => [],
      head: async () => ({ sha: "s", date: "d" }),
      proposeChange: async () => {
        throw new Error("M3");
      },
    }),
    now: () => new Date(),
  });
  const r = await gk2.handle("get_registry", { instance: "instance-a", name: "projects" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "UPSTREAM");
  assert.match(r.error.message, /GitHub API 500/);
});

test("malformed federation.yaml maps to UPSTREAM", async () => {
  const gk2 = createGatekeeper({
    instances: [{ id: "instance-a", owner: "o", repo: "r" }],
    substrateFor: () => new MemorySubstrate({ "federation.yaml": "key: [unterminated" }, { sha: "s", date: "d" }),
    now: () => new Date(),
  });
  const r = await gk2.handle("get_federation", { instance: "instance-a" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "UPSTREAM");
});

test("malformed JSON schema maps to UPSTREAM", async () => {
  const gk2 = createGatekeeper({
    instances: [{ id: "instance-a", owner: "o", repo: "r" }],
    substrateFor: () =>
      new MemorySubstrate({ ".well-known/broken.json": "{not json" }, { sha: "s", date: "d" }),
    now: () => new Date(),
  });
  const r = await gk2.handle("get_schema", { instance: "instance-a", name: "broken" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "UPSTREAM");
});

// ── provenance / staleness ────────────────────────────────────────────────────

test("stale is read after the capability's reads complete, not before", async () => {
  let headCalls = 0;
  const stub = {
    files: loadFixture(),
    lastReadStale: false,
    async readFile(p) {
      // Flip stale mid-read, simulating a cache-fallback substrate that only
      // knows it went stale once the actual read happens.
      this.lastReadStale = true;
      if (!Object.prototype.hasOwnProperty.call(this.files, p)) {
        throw new SubstrateError("NOT_FOUND", `not found: ${p}`);
      }
      return this.files[p];
    },
    async listDir() {
      return [];
    },
    async head() {
      headCalls++;
      return { sha: "s", date: "d" };
    },
    async proposeChange() {
      throw new Error("M3");
    },
  };
  const gk2 = createGatekeeper({
    instances: [{ id: "instance-a", owner: "o", repo: "r" }],
    substrateFor: () => stub,
    now: () => new Date(),
  });
  const r = await gk2.handle("get_registry", { instance: "instance-a", name: "projects" });
  assert.equal(r.ok, true);
  assert.equal(r.provenance.stale, true);
  assert.ok(headCalls >= 1);
});

// ── substrateFor memoization ──────────────────────────────────────────────────

test("substrateFor is memoized per instance id", async () => {
  let calls = 0;
  const gk2 = createGatekeeper({
    instances: [{ id: "instance-a", owner: "o", repo: "r" }],
    substrateFor: () => {
      calls++;
      return new MemorySubstrate(loadFixture(), { sha: "abc123", date: "2026-08-08" });
    },
    now: () => new Date(),
  });
  await gk2.handle("get_registry", { instance: "instance-a", name: "projects" });
  await gk2.handle("get_federation", { instance: "instance-a" });
  await gk2.handle("get_schema", { instance: "instance-a", name: "dao" });
  assert.equal(calls, 1);
});
