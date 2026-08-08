import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubSubstrate } from "../src/substrate/github-substrate.mjs";

function fakeFetch(script) {
  // script: [{status, headers, body}] consumed in order
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url: String(url), opts });
    const r = script.shift();
    return {
      status: r.status,
      ok: r.status < 300,
      headers: new Map(Object.entries(r.headers || {})),
      text: async () => r.body ?? "",
      json: async () => JSON.parse(r.body ?? "null"),
    };
  };
  fn.calls = calls;
  return fn;
}

const base = { owner: "o", repo: "r", ref: "main", token: "tok" };

test("readFile fetches raw content with auth and caches by ETag", async () => {
  const f = fakeFetch([{ status: 200, headers: { etag: 'W/"e1"' }, body: "projects: []" }]);
  let t = 0;
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map(), now: () => t });
  assert.equal(await sub.readFile("data/projects.yaml"), "projects: []");
  assert.match(f.calls[0].url, /\/repos\/o\/r\/contents\/data\/projects\.yaml\?ref=main/);
  assert.equal(f.calls[0].opts.headers.Authorization, "Bearer tok");
  assert.equal(f.calls[0].opts.headers.Accept, "application/vnd.github.raw+json");
  assert.equal(await sub.readFile("data/projects.yaml"), "projects: []"); // within TTL → no 2nd call
  assert.equal(f.calls.length, 1);
});

test("after TTL, revalidates with If-None-Match; 304 serves cache", async () => {
  const f = fakeFetch([
    { status: 200, headers: { etag: 'W/"e1"' }, body: "v1" },
    { status: 304, headers: {} },
  ]);
  let t = 0;
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map(), ttlMs: 1000, now: () => t });
  assert.equal(await sub.readFile("x.md"), "v1");
  t = 5000;
  assert.equal(await sub.readFile("x.md"), "v1");
  assert.equal(f.calls[1].opts.headers["If-None-Match"], 'W/"e1"');
});

test("rate-limited refresh serves stale cache, marks staleness", async () => {
  const f = fakeFetch([
    { status: 200, headers: { etag: 'W/"e1"' }, body: "v1" },
    { status: 403, headers: {}, body: '{"message":"rate limit"}' },
  ]);
  let t = 0;
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map(), ttlMs: 1000, now: () => t });
  await sub.readFile("x.md");
  t = 5000;
  assert.equal(await sub.readFile("x.md"), "v1");
  assert.equal(sub.lastReadStale, true);
});

test("404 → SubstrateError NOT_FOUND; head() hits branches API; listDir maps contents array", async () => {
  const f = fakeFetch([
    { status: 404, headers: {}, body: '{"message":"Not Found"}' },
    { status: 200, headers: {}, body: '{"commit":{"sha":"abc","commit":{"committer":{"date":"2026-08-08T00:00:00Z"}}}}' },
    { status: 200, headers: {}, body: '[{"name":"projects.yaml","type":"file"},{"name":"sub","type":"dir"}]' },
  ]);
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map() });
  await assert.rejects(() => sub.readFile("gone.md"), (e) => e.code === "NOT_FOUND");
  assert.deepEqual(await sub.head(), { sha: "abc", date: "2026-08-08T00:00:00Z" });
  assert.deepEqual(await sub.listDir("data"), [{ name: "projects.yaml", type: "file" }, { name: "sub", type: "dir" }]);
});

// ── listDir must not throw on a missing directory — GitHub returns 404 for a
// nonexistent path, and the Substrate contract says listDir never throws
// NOT_FOUND (see memory-substrate.mjs header). Not in the plan's test list,
// but Task 16 calls listDir on paths that may not exist in a given instance.
test("listDir maps a 404 (missing directory) to []", async () => {
  const f = fakeFetch([{ status: 404, headers: {}, body: '{"message":"Not Found"}' }]);
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map() });
  assert.deepEqual(await sub.listDir("no/such/dir"), []);
});

test("non-404 upstream failure without a cached entry throws SubstrateError UPSTREAM", async () => {
  const f = fakeFetch([{ status: 500, headers: {}, body: '{"message":"boom"}' }]);
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map() });
  await assert.rejects(() => sub.readFile("x.md"), (e) => e.code === "UPSTREAM");
});

test("proposeChange throws an M3 error", async () => {
  const sub = new GitHubSubstrate({ ...base, fetchImpl: fakeFetch([]), cache: new Map() });
  await assert.rejects(() => sub.proposeChange({}), /M3/);
});

test("listDir hits the contents API with default Accept header (no raw override)", async () => {
  const f = fakeFetch([{ status: 200, headers: {}, body: "[]" }]);
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map() });
  await sub.listDir("data");
  assert.match(f.calls[0].url, /\/repos\/o\/r\/contents\/data\?ref=main/);
  assert.equal(f.calls[0].opts.headers.Accept, "application/vnd.github+json");
});

test("lastReadStale resets to false on the next successful fresh read", async () => {
  const f = fakeFetch([
    { status: 200, headers: { etag: 'W/"e1"' }, body: "v1" },
    { status: 403, headers: {}, body: '{"message":"rate limit"}' },
    { status: 200, headers: { etag: 'W/"e2"' }, body: "v2" },
  ]);
  let t = 0;
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map(), ttlMs: 1000, now: () => t });
  await sub.readFile("x.md");
  t = 5000;
  assert.equal(await sub.readFile("x.md"), "v1");
  assert.equal(sub.lastReadStale, true);
  t = 10000;
  assert.equal(await sub.readFile("x.md"), "v2");
  assert.equal(sub.lastReadStale, false);
});

// ── (review fix 1) URL encoding — the fake fetch records the raw string, so
// these tests assert on that string directly rather than round-tripping
// through a real URL parser. Unencoded, a `#` in `path` would truncate the
// query string (dropping `ref=`) and a `/` in `ref` would land as an extra
// path segment against a real fetch/URL implementation.

test("readFile encodes '#' in path segments so the ref query string survives", async () => {
  const f = fakeFetch([{ status: 200, headers: {}, body: "ok" }]);
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map() });
  await sub.readFile("data/pro#ject.yaml");
  assert.equal(f.calls[0].url, "https://api.github.com/repos/o/r/contents/data/pro%23ject.yaml?ref=main");
});

test("readFile encodes a ref containing '/' as a query value", async () => {
  const f = fakeFetch([{ status: 200, headers: {}, body: "ok" }]);
  const sub = new GitHubSubstrate({ ...base, ref: "feature/foo", fetchImpl: f, cache: new Map() });
  await sub.readFile("x.md");
  assert.equal(f.calls[0].url, "https://api.github.com/repos/o/r/contents/x.md?ref=feature%2Ffoo");
});

test("head encodes a ref containing '/' as %2F rather than an extra path segment", async () => {
  const f = fakeFetch([
    { status: 200, headers: {}, body: '{"commit":{"sha":"abc","commit":{"committer":{"date":"2026-08-08T00:00:00Z"}}}}' },
  ]);
  const sub = new GitHubSubstrate({ ...base, ref: "feature/foo", fetchImpl: f, cache: new Map() });
  await sub.head();
  assert.equal(f.calls[0].url, "https://api.github.com/repos/o/r/branches/feature%2Ffoo");
});

// ── (review fix 2) listDir sorts by name, matching the documented contract
// (memory-substrate.mjs header + MemorySubstrate's explicit sort) — GitHub's
// returned order must not leak through unsorted.

test("listDir sorts entries by name regardless of GitHub's returned order", async () => {
  const f = fakeFetch([
    {
      status: 200,
      headers: {},
      body: '[{"name":"zeta.yaml","type":"file"},{"name":"alpha.yaml","type":"file"},{"name":"beta","type":"dir"}]',
    },
  ]);
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map() });
  assert.deepEqual(await sub.listDir("data"), [
    { name: "alpha.yaml", type: "file" },
    { name: "beta", type: "dir" },
    { name: "zeta.yaml", type: "file" },
  ]);
});

// ── (review fix 6) listDir normalizes exotic Contents-API types (symlink,
// submodule) to "file" so the documented "file" | "dir" union always holds.

test("listDir normalizes non-dir entry types (e.g. symlink) to \"file\"", async () => {
  const f = fakeFetch([{ status: 200, headers: {}, body: '[{"name":"link","type":"symlink"}]' }]);
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map() });
  assert.deepEqual(await sub.listDir("data"), [{ name: "link", type: "file" }]);
});

// ── (review fix 3) UPSTREAM errors carry the HTTP status, the request path,
// and a truncated snippet of the response body — the only diagnostic signal
// available once this runs live against real GitHub.

test("UPSTREAM error message includes status, path, and a body snippet", async () => {
  const f = fakeFetch([{ status: 500, headers: {}, body: '{"message":"internal server error, something broke badly"}' }]);
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map() });
  await assert.rejects(
    () => sub.readFile("x.md"),
    (e) => {
      assert.equal(e.code, "UPSTREAM");
      assert.match(e.message, /500/);
      assert.match(e.message, /x\.md/);
      assert.match(e.message, /internal server error/);
      return true;
    },
  );
});

test("UPSTREAM error body snippet is capped so a huge error page can't bloat the message", async () => {
  const bigBody = JSON.stringify({ message: "x".repeat(500) });
  const f = fakeFetch([{ status: 500, headers: {}, body: bigBody }]);
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map() });
  await assert.rejects(
    () => sub.readFile("x.md"),
    (e) => {
      assert.ok(e.message.length < 300, `message too long: ${e.message.length} chars`);
      return true;
    },
  );
});

// ── (review fix 4) malformed JSON responses surface as SubstrateError
// UPSTREAM (naming the path), not a raw SyntaxError — capabilities must only
// ever see SubstrateError per the dispatch contract.

test("listDir wraps malformed JSON as SubstrateError UPSTREAM naming the path", async () => {
  const f = fakeFetch([{ status: 200, headers: {}, body: "not json" }]);
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map() });
  await assert.rejects(() => sub.listDir("data"), (e) => e.code === "UPSTREAM" && /data/.test(e.message));
});

test("head wraps malformed JSON as SubstrateError UPSTREAM naming the ref", async () => {
  const f = fakeFetch([{ status: 200, headers: {}, body: "not json" }]);
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map() });
  await assert.rejects(() => sub.head(), (e) => e.code === "UPSTREAM" && /main/.test(e.message));
});

// ── (review fix 7) the ETag used for the *next* revalidation stays pinned to
// the last confirmed-good response even after an intervening failed
// (stale-served) refresh — asserted directly rather than inferred from
// return values.

test("stale-serve does not clobber the cached ETag used for the next revalidation", async () => {
  const f = fakeFetch([
    { status: 200, headers: { etag: 'W/"e1"' }, body: "v1" },
    { status: 403, headers: {}, body: '{"message":"rate limit"}' },
    { status: 304, headers: {} },
  ]);
  let t = 0;
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map(), ttlMs: 1000, now: () => t });
  await sub.readFile("x.md");
  t = 5000;
  assert.equal(await sub.readFile("x.md"), "v1");
  assert.equal(sub.lastReadStale, true);
  t = 10000;
  assert.equal(await sub.readFile("x.md"), "v1");
  assert.equal(f.calls[2].opts.headers["If-None-Match"], 'W/"e1"');
  assert.equal(sub.lastReadStale, false);
});
