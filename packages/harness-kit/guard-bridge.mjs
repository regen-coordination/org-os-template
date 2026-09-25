// Bridge from any agent host's shell-tool call to the canonical vault guard
// (scripts/guards/deny-destructive-git.mjs). The guard stays the single source
// of truth; this module only locates it, runs it, and maps its exit code.
// Fail closed: only exit 0 allows.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const GUARD_RELATIVE_PATH = "scripts/guards/deny-destructive-git.mjs";
// packages/harness-kit → repo root. Present in every clone of the framework.
export const CANONICAL_GUARD = resolve(HERE, "..", "..", GUARD_RELATIVE_PATH);
export const GUARD_TIMEOUT_MS = 15000;

export function resolveGuard(workspaceRoot, { canonical = CANONICAL_GUARD, exists = existsSync } = {}) {
  if (workspaceRoot) {
    const local = join(workspaceRoot, GUARD_RELATIVE_PATH);
    if (exists(local)) return { path: local, source: "workspace" };
  }
  if (canonical && exists(canonical)) return { path: canonical, source: "framework" };
  return null;
}

export function mapGuardResult(res) {
  if (!res) return { allow: false, reason: "org-os vault guard unavailable (no result); blocking fail-closed" };
  if (res.error) {
    const detail = res.error.code || res.error.message || "spawn error";
    return { allow: false, reason: `org-os vault guard unavailable (${detail}); blocking fail-closed` };
  }
  if (res.status === 2) {
    return { allow: false, reason: String(res.stderr || "").trim() || "blocked by org-os vault guard" };
  }
  if (res.status === 0) return { allow: true };
  const detail = res.signal ? `signal ${res.signal}` : `exit ${res.status}`;
  return { allow: false, reason: `org-os vault guard unavailable (${detail}); blocking fail-closed` };
}

export function buildGuardPayload(command) {
  return JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
}

export function runGuard(
  command,
  workspaceRoot,
  { spawn = spawnSync, execPath = process.execPath, timeoutMs = GUARD_TIMEOUT_MS, resolve: resolveFn = resolveGuard } = {},
) {
  const guard = resolveFn(workspaceRoot);
  if (!guard) {
    return { allow: false, reason: "org-os vault guard unavailable (guard script not found); blocking fail-closed" };
  }
  let res;
  try {
    res = spawn(execPath, [guard.path], {
      input: buildGuardPayload(String(command ?? "")),
      encoding: "utf8",
      timeout: timeoutMs,
      cwd: workspaceRoot || undefined,
    });
  } catch (error) {
    res = { error };
  }
  return { ...mapGuardResult(res), guard: guard.path };
}
