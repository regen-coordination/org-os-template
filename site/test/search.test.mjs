// site/test/search.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSearch, isTypingTarget } from "../src/lib/search.mjs";

test("when the search assets load, the dialog is shown", async () => {
  const calls = [];
  const out = await openSearch({ load: async () => { calls.push("load"); }, show: () => calls.push("show"), fallback: () => calls.push("fallback") });
  assert.equal(out, "shown");
  assert.deepEqual(calls, ["load", "show"]);
});

test("when they fail to load, the viewer is sent to the docs index instead", async () => {
  const calls = [];
  const out = await openSearch({ load: async () => { throw new Error("404"); }, show: () => calls.push("show"), fallback: () => calls.push("fallback") });
  assert.equal(out, "fallback");
  assert.deepEqual(calls, ["fallback"]);
});

test("a failure while showing also falls back", async () => {
  const calls = [];
  const out = await openSearch({ load: async () => {}, show: () => { throw new Error("no dialog"); }, fallback: () => calls.push("fallback") });
  assert.equal(out, "fallback");
  assert.deepEqual(calls, ["fallback"]);
});

test("the / shortcut is ignored while the viewer is typing", () => {
  assert.equal(isTypingTarget({ tagName: "INPUT" }), true);
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isTypingTarget({ tagName: "SELECT" }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: "BODY" }), false);
  assert.equal(isTypingTarget(null), false);
});
