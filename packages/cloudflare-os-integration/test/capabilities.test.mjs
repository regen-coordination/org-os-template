import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGatekeeper, READ_CAPABILITIES } from "../src/gatekeeper/capabilities.mjs";
import { SUPPORTED_PAGES } from "../src/page-core/render-page.mjs";
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
  assert.deepEqual(READ_CAPABILITIES, ["get_registry", "get_federation", "get_schema", "get_context_bundle", "get_page"]);
});

test("get_page renders markdown for supported pages", async () => {
  const r = await gk.handle("get_page", { instance: "instance-a", page_id: "projects" });
  assert.equal(r.ok, true);
  assert.ok(r.data.markdown.startsWith("# Projects"));
  assert.equal(r.data.page_id, "projects");
  assert.equal(r.provenance.sha, "abc123");
});

test("get_page rejects unknown page ids", async () => {
  assert.equal((await gk.handle("get_page", { instance: "instance-a", page_id: "nope" })).error.code, "BAD_ARGS");
});

// get_page reads ~9 fixed paths plus a directory listing; on a real instance most of them are
// routinely absent. Each read must degrade to an absent key rather than failing the whole page,
// otherwise one missing optional file (say data/events.yaml) blanks the operator's dashboard.
test("get_page tolerates missing inputs — a sparse instance still renders", async () => {
  const sparse = createGatekeeper({
    instances: [{ id: "instance-b", owner: "o", repo: "r" }],
    substrateFor: () => new MemorySubstrate(loadFixture("instance-b"), { sha: "s", date: "d" }),
    now: () => new Date("2026-08-08T12:00:00Z"),
  });
  const r = await sparse.handle("get_page", { instance: "instance-b", page_id: "dashboard" });
  assert.equal(r.ok, true);
  assert.ok(r.data.markdown.includes("## Projects"));
  assert.ok(r.data.markdown.includes("0 critical"));
});

test("get_page renders every supported page id", async () => {
  for (const page of SUPPORTED_PAGES) {
    const r = await gk.handle("get_page", { instance: "instance-a", page_id: page });
    assert.equal(r.ok, true, `${page} should render`);
    assert.equal(typeof r.data.markdown, "string");
    assert.ok(r.data.markdown.length > 0, `${page} should not be empty`);
  }
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

// ── message vs detail: operator-facing copy, diagnostics kept separate ───────

test("BAD_ARGS: message is plain-language, detail carries the regex", async () => {
  const r = await gk.handle("get_registry", { instance: "instance-a", name: "../SOUL" });
  assert.equal(r.error.code, "BAD_ARGS");
  assert.match(r.error.message, /"\.\.\/SOUL"/);
  assert.doesNotMatch(r.error.message, /\[a-z0-9-\]/); // no regex leaked to the operator
  assert.match(r.error.detail, /\[a-z0-9-\]/); // regex is fine in detail (diagnostic-only)
});

test("NOT_FOUND: message names the missing thing and the instance, no internal path shape", async () => {
  const rReg = await gk.handle("get_registry", { instance: "instance-a", name: "zzz" });
  assert.equal(rReg.error.code, "NOT_FOUND");
  assert.match(rReg.error.message, /"zzz"/);
  assert.match(rReg.error.message, /instance-a/);
  assert.doesNotMatch(rReg.error.message, /data\//); // no substrate path shape leaked

  const rSchema = await gk.handle("get_schema", { instance: "instance-a", name: "zzz" });
  assert.equal(rSchema.error.code, "NOT_FOUND");
  assert.match(rSchema.error.message, /"zzz"/);
  assert.match(rSchema.error.message, /instance-a/);
  assert.doesNotMatch(rSchema.error.message, /\.well-known/);
});

test("UNKNOWN_CAPABILITY / UNKNOWN_INSTANCE messages read plainly, no enumeration of valid values", async () => {
  const r1 = await gk.handle("write_stuff", { instance: "instance-a" });
  assert.equal(r1.error.code, "UNKNOWN_CAPABILITY");
  assert.match(r1.error.message, /write_stuff/);
  assert.doesNotMatch(r1.error.message, /get_registry/); // doesn't enumerate the valid catalog

  const r2 = await gk.handle("get_registry", { instance: "nope", name: "projects" });
  assert.equal(r2.error.code, "UNKNOWN_INSTANCE");
  assert.match(r2.error.message, /nope/);
  assert.doesNotMatch(r2.error.message, /instance-a/); // doesn't enumerate valid instance ids
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
  assert.equal(typeof r.error.message, "string");
  assert.ok(r.error.message.length > 0);
  assert.match(r.error.detail, /boom/);
});

test("a substrate that throws a bare string produces a well-formed envelope", async () => {
  const gk2 = createGatekeeper({
    instances: [{ id: "instance-a", owner: "o", repo: "r" }],
    substrateFor: () => ({
      readFile: async () => {
        // eslint-disable-next-line no-throw-literal
        throw "plain string failure";
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
  assert.equal(typeof r.error.message, "string");
  assert.ok(r.error.message.length > 0);
  assert.doesNotMatch(r.error.message, /plain string failure/); // raw thrown value stays out of message
  assert.equal(r.error.detail, "plain string failure");
});

test("a substrate that throws a plain object or undefined produces a well-formed envelope", async () => {
  const makeGk = (thrown) =>
    createGatekeeper({
      instances: [{ id: "instance-a", owner: "o", repo: "r" }],
      substrateFor: () => ({
        readFile: async () => {
          // eslint-disable-next-line no-throw-literal
          throw thrown;
        },
        listDir: async () => [],
        head: async () => ({ sha: "s", date: "d" }),
        proposeChange: async () => {
          throw new Error("M3");
        },
      }),
      now: () => new Date(),
    });

  const rObj = await makeGk({ weird: "shape" }).handle("get_registry", { instance: "instance-a", name: "projects" });
  assert.equal(rObj.ok, false);
  assert.equal(rObj.error.code, "UPSTREAM");
  assert.equal(typeof rObj.error.message, "string");
  assert.ok(rObj.error.message.length > 0);
  assert.equal(typeof rObj.error.detail, "string");

  const rUndef = await makeGk(undefined).handle("get_registry", { instance: "instance-a", name: "projects" });
  assert.equal(rUndef.ok, false);
  assert.equal(rUndef.error.code, "UPSTREAM");
  assert.equal(typeof rUndef.error.message, "string");
  assert.ok(rUndef.error.message.length > 0);
  assert.equal(typeof rUndef.error.detail, "string");
});

test("malformed YAML registry maps to UPSTREAM; parse diagnostics live in detail, not message", async () => {
  const gk2 = createGatekeeper({
    instances: [{ id: "instance-a", owner: "o", repo: "r" }],
    substrateFor: () => new MemorySubstrate({ "data/broken.yaml": "key: [unterminated" }, { sha: "s", date: "d" }),
    now: () => new Date(),
  });
  const r = await gk2.handle("get_registry", { instance: "instance-a", name: "broken" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "UPSTREAM");
  assert.match(r.error.detail, /registry parse failed: broken/);
  assert.doesNotMatch(r.error.message, /parse failed/);
  assert.match(r.error.message, /"broken"/);
  assert.match(r.error.message, /instance-a/);
});

test("a SubstrateError with code UPSTREAM (not just NOT_FOUND) passes its code through, but keeps the raw upstream snippet out of message", async () => {
  const gk2 = createGatekeeper({
    instances: [{ id: "instance-a", owner: "o", repo: "r" }],
    substrateFor: () => ({
      readFile: async () => {
        throw new SubstrateError("UPSTREAM", 'upstream error 500 for data/projects.yaml: <html>Internal Server Error</html>');
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
  // The raw upstream response snippet must land in `detail` (diagnostic-only,
  // not for display) and must NOT appear in `message` (rendered verbatim to
  // a non-technical org member by Task 18's gadget).
  assert.match(r.error.detail, /<html>Internal Server Error<\/html>/);
  assert.doesNotMatch(r.error.message, /<html>/);
  assert.doesNotMatch(r.error.message, /Internal Server Error/);
  assert.match(r.error.message, /instance-a/);
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
