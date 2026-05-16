// Smoke test for the opencode integration plugin.
// We can't fully exercise the @opencode-ai/plugin runtime in unit tests,
// so we verify the plugin function is exported, accepts a context object,
// and returns a hook map without throwing when @opencode-ai/plugin is absent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { OrgOsPlugin } from "../src/index.mjs";

test("OrgOsPlugin: exports an async function", () => {
  assert.equal(typeof OrgOsPlugin, "function");
  assert.equal(OrgOsPlugin.constructor.name, "AsyncFunction");
});

test("OrgOsPlugin: returns empty hook map when @opencode-ai/plugin is unavailable", async () => {
  // In our test env, @opencode-ai/plugin is not installed. The plugin should
  // return {} (no tools) rather than throw.
  const result = await OrgOsPlugin({ directory: process.cwd() });
  assert.equal(typeof result, "object");
  assert.ok(result !== null);
});

test("OrgOsPlugin: handles missing context gracefully", async () => {
  const result = await OrgOsPlugin({});
  assert.equal(typeof result, "object");
});
