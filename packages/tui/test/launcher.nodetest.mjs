import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVersion, atLeast, candidateBuns, findBun, invokedFrom, MIN_BUN } from "../bin/cockpit.mjs";

test("version parsing and comparison", () => {
  assert.deepEqual(parseVersion("1.4.2\n"), [1, 4, 2]);
  assert.equal(parseVersion("nope"), null);
  assert.equal(atLeast([1, 3, 0], MIN_BUN), true);
  assert.equal(atLeast([1, 2, 18], MIN_BUN), false);
  assert.equal(atLeast([2, 0, 0], MIN_BUN), true);
});

test("candidates: local bin first, then ORG_OS_BUN, then PATH", () => {
  assert.deepEqual(candidateBuns("/pkg", { ORG_OS_BUN: "/opt/bun" }), ["/pkg/node_modules/.bin/bun", "/opt/bun", "bun"]);
  assert.deepEqual(candidateBuns("/pkg", {}), ["/pkg/node_modules/.bin/bun", "bun"]);
});

test("findBun skips too-old and failing candidates", () => {
  const versions = { "/opt/bun": "1.2.18", bun: "1.3.5" };
  const run = (bin) => (versions[bin] ? { status: 0, stdout: versions[bin] } : { status: 1, stdout: "" });
  const found = findBun({ pkgDir: "/missing", env: { ORG_OS_BUN: "/opt/bun" }, run, exists: (p) => p === "/opt/bun" });
  assert.deepEqual(found, { bin: "bun", version: "1.3.5" });
  assert.equal(findBun({ pkgDir: "/missing", env: {}, run: () => ({ status: 1, stdout: "" }), exists: () => false }), null);
});

test("invokedFrom prefers INIT_CWD (npm run) over cwd", () => {
  assert.equal(invokedFrom({ ORG_OS_INVOKED_FROM: "/a", INIT_CWD: "/b" }, "/c"), "/a");
  assert.equal(invokedFrom({ INIT_CWD: "/b" }, "/c"), "/b");
  assert.equal(invokedFrom({}, "/c"), "/c");
});
