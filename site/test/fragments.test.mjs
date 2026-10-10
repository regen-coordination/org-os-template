// site/test/fragments.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { idsIn, fragmentOf, fragmentVerdict } from "../src/lib/fragments.mjs";

test("idsIn collects id attributes, double- and single-quoted, and anchor names", () => {
  const html = `<h2 id="setup">x</h2><div id='box' class="a"></div><a name="old"></a><p data-id="no">`;
  assert.deepEqual([...idsIn(html)].sort(), ["box", "old", "setup"]);
});

test("a name attribute counts only on <a>", () => {
  assert.equal(idsIn(`<meta name="viewport" content="x"><input name="q">`).size, 0);
});

test("idsIn ignores id-like text inside other attributes", () => {
  const html = `<a href="/x" title='see id="fake" here' data-pid="p1" class="grid">y</a>`;
  assert.equal(idsIn(html).size, 0);
});

test("fragmentOf returns the decoded fragment of an address, or null", () => {
  assert.equal(fragmentOf("/org-os-template/docs/setup/#the-doctor"), "the-doctor");
  assert.equal(fragmentOf("/a/b?x=1#caf%C3%A9"), "café");
  assert.equal(fragmentOf("#top-level"), "top-level");
  assert.equal(fragmentOf("/a/b/"), null);
  assert.equal(fragmentOf("/a/b/#"), null);
  assert.equal(fragmentOf("/a/b/#%E0%A4%A"), "%E0%A4%A", "an undecodable fragment is compared as written");
});

test("fragmentVerdict is ok when the id exists and says why when it does not", () => {
  const ids = new Set(["setup", "the-doctor"]);
  assert.deepEqual(fragmentVerdict("the-doctor", ids), { ok: true });
  const bad = fragmentVerdict("old-heading", ids);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /old-heading/);
});

test("the reserved fragments #top and the empty one always resolve", () => {
  assert.deepEqual(fragmentVerdict("top", new Set()), { ok: true });
  assert.deepEqual(fragmentVerdict("", new Set()), { ok: true });
});
