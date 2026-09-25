# harness-kit

Dependency-free helpers shared by org-os agent hosts: vault-guard bridge and workspace detection.

## What It Is

`harness-kit` provides two core modules used by org-os agent hosts (cockpit, Pi, and future hosts):

1. **Workspace detection** — locating and reading org-os workspace metadata
2. **Vault guard bridge** — invoking the canonical destructive-git guard and fail-closed result mapping

These are loaded early in the bootstrap sequence, before any npm install has run. Designed to be zero-dependency and pure Node.js ESM.

## workspace.mjs

Exports: `WORKSPACE_MARKERS`, `isWorkspace()`, `readWorkspaceName()`, `findWorkspace()`, `findEnclosingWorkspace()`.

**Markers** — An org-os workspace must contain all four markers:
- `package.json`
- `federation.yaml`
- `data/` (directory)
- `memory/` (directory)

**Functions:**

- `isWorkspace(dir)` — Returns true if all markers exist in `dir`.
- `readWorkspaceName(dir)` — Reads `identity.name` from `federation.yaml` without a YAML parser. Falls back to the directory basename if the file is missing or the name key is not found under `identity:`.
- `findWorkspace(cwd)` — Walks up from `cwd` until it finds a workspace directory. Returns `{ root, name }` or `null`.
- `findEnclosingWorkspace(root)` — Returns the nearest ancestor workspace above `root` (excluding `root` itself). Returns `{ root, name }` or `null`.

## guard-bridge.mjs

Exports: `GUARD_RELATIVE_PATH`, `CANONICAL_GUARD`, `GUARD_TIMEOUT_MS`, `resolveGuard()`, `mapGuardResult()`, `buildGuardPayload()`, `runGuard()`.

**Design:** The canonical vault guard (`scripts/guards/deny-destructive-git.mjs`) is the single source of truth. This module locates it, runs it, and maps its exit code to a structured result.

**Resolution order:**
1. If `workspaceRoot` is provided, check for `scripts/guards/deny-destructive-git.mjs` inside it.
2. Fall back to the framework canonical copy at `scripts/guards/deny-destructive-git.mjs` (relative to the harness-kit package).

**Exit mapping (fail-closed):**
- Exit 0 → `{ allow: true }`
- Exit 2 → `{ allow: false, reason: <stderr or default> }`
- Any other exit or signal → `{ allow: false, reason: "...fail-closed..." }`
- Error or timeout → `{ allow: false, reason: "...fail-closed..." }`
- No result → `{ allow: false, reason: "...fail-closed..." }`

**Hook contract:** The guard payload matches Claude Code's `PreToolUse` hook contract: `{ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }`.

**Timeout:** 15 seconds. If the guard does not respond, execution is blocked (fail-closed).

**No bundled copy:** The guard is never bundled; it is always read from the repo. This ensures every supported distribution carries the latest guard logic and the single source of truth is never out of sync.

## Tests

Run with:

```bash
npm test --prefix packages/harness-kit
```

Or from this directory:

```bash
npm test
```

Tests cover workspace detection (markers, name reading, directory walks) and guard-bridge (resolution, result mapping, fail-closed behavior, real guard invocation, timeout handling).
