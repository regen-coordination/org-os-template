import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANONICAL_GUARD, mapGuardResult, resolveGuard, runGuard, buildGuardPayload } from "../guard-bridge.mjs";

const DANGEROUS = ["git", "stash", "list"].join(" ");

test("canonical guard is the framework's scripts/guards copy", () => {
  assert.ok(CANONICAL_GUARD.endsWith("scripts/guards/deny-destructive-git.mjs"));
  assert.ok(existsSync(CANONICAL_GUARD));
});

test("mapGuardResult is fail-closed", () => {
  assert.deepEqual(mapGuardResult({ status: 0, stderr: "" }), { allow: true });
  assert.deepEqual(mapGuardResult({ status: 2, stderr: "BLOCKED: nope\n" }), { allow: false, reason: "BLOCKED: nope" });
  assert.equal(mapGuardResult({ status: 2, stderr: "" }).reason, "blocked by org-os vault guard");
  assert.match(mapGuardResult({ status: 1, stderr: "x" }).reason, /exit 1.*fail-closed/);
  assert.match(mapGuardResult({ status: null, signal: "SIGKILL" }).reason, /signal SIGKILL/);
  assert.match(mapGuardResult({ error: Object.assign(new Error("t"), { code: "ETIMEDOUT" }) }).reason, /ETIMEDOUT/);
  assert.equal(mapGuardResult(undefined).allow, false);
});

test("resolveGuard prefers the workspace copy, then the framework copy", () => {
  const exists = (p) => p === "/ws/scripts/guards/deny-destructive-git.mjs" || p === "/fw/guard.mjs";
  assert.deepEqual(resolveGuard("/ws", { canonical: "/fw/guard.mjs", exists }), { path: "/ws/scripts/guards/deny-destructive-git.mjs", source: "workspace" });
  assert.deepEqual(resolveGuard("/other", { canonical: "/fw/guard.mjs", exists }), { path: "/fw/guard.mjs", source: "framework" });
  assert.equal(resolveGuard("/other", { canonical: "/none", exists }), null);
});

test("payload matches the Claude Code hook contract", () => {
  assert.deepEqual(JSON.parse(buildGuardPayload("ls")), { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
});

test("runGuard against the real guard", () => {
  const blocked = runGuard(DANGEROUS, null);
  assert.equal(blocked.allow, false);
  assert.match(blocked.reason, /stash/);
  assert.equal(runGuard("git status", null).allow, true);
});

test("runGuard fails closed when the guard is missing, broken or slow", () => {
  assert.match(runGuard("ls", null, { resolve: () => null }).reason, /not found/);
  const broken = runGuard("ls", null, { resolve: () => ({ path: "/nonexistent/guard.mjs", source: "framework" }) });
  assert.equal(broken.allow, false);
  const dir = mkdtempSync(join(tmpdir(), "hk-slow-"));
  const slow = join(dir, "slow.mjs");
  writeFileSync(slow, "setTimeout(() => {}, 5000);\n");
  const timedOut = runGuard("ls", null, { resolve: () => ({ path: slow, source: "framework" }), timeoutMs: 200 });
  assert.equal(timedOut.allow, false);
  assert.match(timedOut.reason, /fail-closed/);
});
