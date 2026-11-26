// site/test/redirects.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { REDIRECTS } from "../src/data/redirects.mjs";
import { pageBySlug } from "../src/data/docs-manifest.mjs";

test("the two retired pages redirect", () => {
  assert.deepEqual(REDIRECTS.map((r) => r.from).sort(), ["/about", "/get-started"]);
});

test("every redirect is root-absolute and lands on a page that exists", () => {
  for (const { from, to } of REDIRECTS) {
    assert.ok(from.startsWith("/") && to.startsWith("/"), `${from} → ${to}`);
    assert.notEqual(from, to);
    const m = to.match(/^\/docs\/([a-z0-9-]+)$/);
    if (m) assert.ok(pageBySlug(m[1]), `${from} → ${to}: no such docs page`);
    else assert.ok(["/docs", "/modules", "/federation", "/"].includes(to), `${from} → ${to}: unknown target`);
  }
});
