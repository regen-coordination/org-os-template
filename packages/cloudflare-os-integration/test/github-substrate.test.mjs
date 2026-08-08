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
