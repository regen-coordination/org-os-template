# org-os Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the org-os cockpit — a fleet TUI on OpenTUI (Solid) with an embedded, guarded Pi agent pane, a host-launch path and herdr integration — plus the two shared packages it stands on (`harness-kit`, `org-state`).

**Architecture:** One Bun process. `packages/tui/src/core/` is headless TypeScript (fleet discovery, workspace loading via `org-state`, page resolvers, gate, launch, herdr client, Pi adapter, and a `Cockpit` controller that publishes immutable snapshots). `packages/tui/src/ui/` is `@opentui/solid` and only reads snapshots and calls `cockpit.dispatch(command)`. Pure logic lives in small tested modules; the UI is tested with OpenTUI's `testRender`.

**Tech Stack:** Bun 1.4.2 (local devDependency) · `@opentui/core`/`@opentui/solid` 0.5.12 · `solid-js` 1.9.12 · `@earendil-works/pi-coding-agent` 0.87.1 (+ `@earendil-works/pi-ai` 0.87.1 for the faux test provider) · `js-yaml` 4.1.0 · Node ≥ 22 for `harness-kit`/`org-state` (`node --test`).

**Spec:** `docs/superpowers/specs/2026-09-25-org-os-cockpit-design.md` (read it first; this plan argues from it).

## Global Constraints

- Work only in the worktree `~/.cache/lf-worktrees/org-os-cockpit` (branch `feat/org-os-cockpit`). All paths below are relative to it.
- **Vault safety:** never run `git stash`, `git clean`, `git reset --hard`, never push, never tag, never merge. Commit after every task.
- **Guard quirk:** the vault guard (a PreToolUse hook) refuses any Bash command line that contains a destructive git verb, even inside a heredoc or an `echo`. Create any file whose content mentions those verbs with the **Write tool**, never with a shell heredoc. In test code, build the dangerous command at runtime: `const DANGEROUS = ["git", "stash", "list"].join(" ");`. Never put those verbs in a commit message.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` (pass it as a second `-m`).
- Exact dependency pins (no `^`/`~`): `@opentui/core@0.5.12`, `@opentui/solid@0.5.12`, `solid-js@1.9.12`, `@earendil-works/pi-coding-agent@0.87.1`, `@earendil-works/pi-ai@0.87.1` (dev), `bun@1.4.2` (dev), `js-yaml@4.1.0`.
- Bun is always the **local** one: `packages/tui/node_modules/.bin/bun`. Run tui tests with `npm test --prefix packages/tui` (npm puts the local bin on PATH). Never upgrade the operator's global Bun or Node.
- Pi in tests: always a temporary `agentDir` (`mkdtempSync`) and `SessionManager.inMemory(cwd)`; never read or write `~/.pi`. Model = the faux provider; no network, no API keys.
- herdr in tests: always an injected fake `Runner`; never call the real `herdr` binary (its guidance forbids inspecting the operator's live session from outside herdr).
- `harness-kit` and `org-state` stay plain `.mjs` ESM tested with `node --test` + `node:assert/strict`. `packages/tui` is TypeScript/TSX tested with `bun:test`. House style: 2-space indent, double quotes, semicolons.
- The cockpit itself never writes into any repo and never runs a mutating git command. Git reads run with `GIT_OPTIONAL_LOCKS=0`.
- Copy/labels: the embedded agent is labelled **"pi"** in the UI. Never label anything "Claude Code" (Anthropic branding rule); launched hosts are named by their binary: `claude`, `pi`, `opencode`.

## Review Focus

1. **Scaffold instances with missing or malformed files** (no `HEARTBEAT.md`, no `DECISIONS.md`, empty `memory/`, invalid YAML) — every page must render with a notice instead of throwing. Pinned by the `ws-bad` fixture tests in Task 3 and the page tests in Task 8.
2. **Fleet entries whose `local_path` is missing or not a workspace** (every instance when running from `~/.cache/lf-worktrees/…`) — rows show `missing`, selecting one shows a notice, `start()` never throws. Pinned in Task 6 and Task 14.
3. **Typing in the agent input must never trigger global shortcuts** (`q`, `j`, `1`–`9`, `?`) — OpenTUI delivers keys to `useKeyboard` even while an `<input>` is focused (spike T1). Pinned in Task 15 (`routeKey`) and Task 17 (typing "quit jq" into the input).
4. **Narrow terminals and wide characters** (80×24, emoji like 🧬 in workspace names) — no overflow, truncation by display width. Pinned in Task 15 (`truncate`) and Task 16 (80×24 render).
5. **Concurrent permission requests and a failing/slow guard** (parallel tool calls, guard timeout, non-string command) — requests queue by id, answers resolve the right one, guard failures block. Pinned in Task 10.

## File Map

```
packages/harness-kit/          package.json · README.md · workspace.mjs · guard-bridge.mjs · test/
packages/org-state/            package.json · README.md · build-state.mjs · parse-helpers.mjs · render-page.mjs (moved)
                               read-files.mjs · index.mjs · loaders/{heartbeat,memory,decisions,plans,funding}.mjs · test/
packages/cloudflare-os-integration/src/page-core/*.mjs   → one-line re-export shims
packages/tui/
  package.json · bunfig.toml · tsconfig.json · README.md · VERIFIED.md
  bin/cockpit.mjs              Node launcher (finds Bun ≥1.3, execs src/main.tsx)
  herdr/                       herdr-plugin.toml · scripts/{cockpit,open-cockpit,open-cockpit-tab}.sh
  src/main.tsx                 entry (args → Cockpit → render / --snapshot)
  src/core/types.ts            all shared types + HOSTS/LIFECYCLE constants
  src/core/{bus,proc,config,util,args}.ts
  src/core/{fleet,workspace,markdown,commands,actions,gate,launch,herdr,transcript,cockpit}.ts
  src/core/pages/{index,fleet,workspace-pages,this-week}.ts
  src/core/agents/{backend,pi}.ts
  src/ui/{theme,keys,layout,format,page-model,palette-model,transcript-view,store}.ts
  src/ui/{App,Header,Rail,PageView,AgentPane,StatusBar}.tsx
  src/ui/overlays/{Palette,Help,PermissionDialog}.tsx
  test/…                       mirrors src/
```

---

### Task 1: `harness-kit` — workspace detection + fail-closed guard bridge

**Files:**
- Create: `packages/harness-kit/package.json`, `packages/harness-kit/README.md`, `packages/harness-kit/workspace.mjs`, `packages/harness-kit/guard-bridge.mjs`
- Test: `packages/harness-kit/test/workspace.test.mjs`, `packages/harness-kit/test/guard-bridge.test.mjs`
- Modify: `package.json` (root) — add script `"test:harness-kit": "npm test --prefix packages/harness-kit"`

**Interfaces:**
- Produces (`workspace.mjs`): `WORKSPACE_MARKERS: string[]`, `isWorkspace(dir): boolean`, `readWorkspaceName(dir): string`, `findWorkspace(cwd): { root: string, name: string } | null`, `findEnclosingWorkspace(root): { root, name } | null` (nearest *ancestor* workspace, excluding `root`).
- Produces (`guard-bridge.mjs`): `GUARD_RELATIVE_PATH`, `CANONICAL_GUARD: string`, `GUARD_TIMEOUT_MS = 15000`, `resolveGuard(workspaceRoot, {canonical?, exists?}) → { path, source: "workspace"|"framework" } | null`, `mapGuardResult(res) → { allow: true } | { allow: false, reason: string }`, `buildGuardPayload(command) → string`, `runGuard(command, workspaceRoot, {spawn?, execPath?, timeoutMs?, resolve?}) → { allow, reason?, guard? }`.

- [ ] **Step 1: Write the failing workspace test** — `packages/harness-kit/test/workspace.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWorkspace, readWorkspaceName, findWorkspace, findEnclosingWorkspace } from "../workspace.mjs";

function makeWs(dir, federation) {
  mkdirSync(join(dir, "data"), { recursive: true });
  mkdirSync(join(dir, "memory"), { recursive: true });
  writeFileSync(join(dir, "package.json"), "{}");
  writeFileSync(join(dir, "federation.yaml"), federation ?? 'identity:\n  name: "Test Org"\n');
}

test("isWorkspace requires all four markers", () => {
  const d = mkdtempSync(join(tmpdir(), "hk-"));
  assert.equal(isWorkspace(d), false);
  makeWs(d);
  assert.equal(isWorkspace(d), true);
});

test("readWorkspaceName reads identity.name in its common shapes", () => {
  const cases = [
    ['identity:\n  name: "org-os"\n  type: "Project"\n', "org-os"],
    ["identity:\n  name: LF Zettelkasten OS\n", "LF Zettelkasten OS"],
    ["identity:\n  emoji: x\n  name: 'Quoted'   # comment\n", "Quoted"],
    ["identity:\n  onchain_registration:\n    name: nested\n  name: Real\n", "Real"],
    ["network: x\nname: top-level-is-ignored\n", null],
  ];
  for (const [yaml, expected] of cases) {
    const d = mkdtempSync(join(tmpdir(), "hk-name-"));
    writeFileSync(join(d, "federation.yaml"), yaml);
    const name = readWorkspaceName(d);
    assert.equal(name, expected ?? d.split("/").pop(), yaml);
  }
  const missing = mkdtempSync(join(tmpdir(), "hk-nofed-"));
  assert.equal(readWorkspaceName(missing), missing.split("/").pop());
});

test("findWorkspace walks up; findEnclosingWorkspace skips the root itself", () => {
  const hub = mkdtempSync(join(tmpdir(), "hk-hub-"));
  makeWs(hub, "identity:\n  name: Hub\n");
  const fw = join(hub, "libs", "fw");
  makeWs(fw, "identity:\n  name: Framework\n");
  const deep = join(fw, "packages", "x", "src");
  mkdirSync(deep, { recursive: true });
  assert.deepEqual(findWorkspace(deep), { root: fw, name: "Framework" });
  assert.deepEqual(findEnclosingWorkspace(fw), { root: hub, name: "Hub" });
  assert.equal(findEnclosingWorkspace(hub), null);
  const lone = mkdtempSync(join(tmpdir(), "hk-lone-"));
  assert.equal(findWorkspace(lone), null);
});
```

- [ ] **Step 2: Run it — expect failure** (`Cannot find module '../workspace.mjs'`)

Run: `node --test packages/harness-kit/test/workspace.test.mjs`

- [ ] **Step 3: Implement** — `packages/harness-kit/workspace.mjs`

```js
// Workspace detection shared by every org-os host (cockpit, Pi, future hosts).
// Dependency-free on purpose: hosts load this before any npm install has run.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export const WORKSPACE_MARKERS = ["package.json", "federation.yaml", "data", "memory"];

export function isWorkspace(dir) {
  return WORKSPACE_MARKERS.every((m) => existsSync(join(dir, m)));
}

// identity.name from federation.yaml without a YAML parser: the first `name:`
// among the direct children of the top-level `identity:` key.
export function readWorkspaceName(dir) {
  let text;
  try {
    text = readFileSync(join(dir, "federation.yaml"), "utf8");
  } catch {
    return basename(dir);
  }
  let inIdentity = false;
  let childIndent = null;
  for (const line of text.split("\n")) {
    if (!inIdentity) {
      if (/^identity:\s*(#.*)?$/.test(line)) inIdentity = true;
      continue;
    }
    if (/^\S/.test(line)) break;
    const indent = line.match(/^(\s+)\S/);
    if (!indent) continue;
    if (childIndent === null) childIndent = indent[1].length;
    if (indent[1].length !== childIndent) continue;
    const m = line.match(/^\s+name:\s*(.*?)\s*(?:#.*)?$/);
    if (m) {
      const value = m[1].replace(/^["']|["']$/g, "").trim();
      return value || basename(dir);
    }
  }
  return basename(dir);
}

export function findWorkspace(cwd) {
  let dir = resolve(cwd);
  for (;;) {
    if (isWorkspace(dir)) return { root: dir, name: readWorkspaceName(dir) };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function findEnclosingWorkspace(root) {
  const self = resolve(root);
  const parent = dirname(self);
  if (parent === self) return null;
  return findWorkspace(parent);
}
```

- [ ] **Step 4: Run it — expect PASS.** `node --test packages/harness-kit/test/workspace.test.mjs`

- [ ] **Step 5: Write the failing guard-bridge test** — `packages/harness-kit/test/guard-bridge.test.mjs` (create with the **Write tool**; it names a destructive verb)

```js
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
```

- [ ] **Step 6: Run it — expect failure.** `node --test packages/harness-kit/test/guard-bridge.test.mjs`

- [ ] **Step 7: Implement** — `packages/harness-kit/guard-bridge.mjs`

```js
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
```

- [ ] **Step 8: Run both tests — expect PASS.** `node --test packages/harness-kit/test/*.test.mjs`

- [ ] **Step 9: Package files** — `packages/harness-kit/package.json`

```json
{
  "name": "@org-os/harness-kit",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Dependency-free helpers shared by org-os agent hosts: vault-guard bridge and workspace detection",
  "exports": {
    "./guard-bridge": "./guard-bridge.mjs",
    "./workspace": "./workspace.mjs"
  },
  "scripts": {
    "test": "node --test \"test/*.test.mjs\""
  },
  "engines": {
    "node": ">=22"
  }
}
```

`packages/harness-kit/README.md` — sections: *What it is* (shared by `packages/tui` and, once it lands, `packages/pi-integration`); *workspace.mjs* (markers, the four functions); *guard-bridge.mjs* (resolution order workspace → framework canonical, exit mapping table 0/2/other, fail-closed, 15 s timeout, no bundled copy because every supported distribution carries the whole repo); *Tests* (`npm test --prefix packages/harness-kit`). Add the root script `"test:harness-kit": "npm test --prefix packages/harness-kit"` next to the other `test:*` scripts in `package.json`.

- [ ] **Step 10: Verify + commit**

Run: `npm run test:harness-kit` → all pass.

```bash
git add packages/harness-kit package.json
git commit -m "feat(harness-kit): shared workspace detection and fail-closed guard bridge" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `org-state` — move `page-core` out of `cloudflare-os-integration`

**Files:**
- Move (git mv): `packages/cloudflare-os-integration/src/page-core/{build-state,parse-helpers,render-page}.mjs` → `packages/org-state/`
- Create: the three old paths as one-line re-export shims; `packages/org-state/package.json`, `packages/org-state/README.md`, `packages/org-state/test/shim.test.mjs`
- Modify: `scripts/page-shim.mjs:23` (import path), root `package.json` (script `test:org-state`)

**Interfaces:**
- Produces: `packages/org-state/build-state.mjs` (`buildState(files, {now})`, `loadFederation(files)`), `parse-helpers.mjs` (`extractCheckboxes`, `getRelativeAge`, `daysUntil(dateStr, now)`, `parseFrontmatter`), `render-page.mjs` (`SUPPORTED_PAGES`, `renderPage(id, state)`) — contents unchanged.

- [ ] **Step 1: Capture the baseline page output** (before touching anything)

```bash
BASE="${TMPDIR:-/tmp}/org-state-baseline" && mkdir -p "$BASE"
for p in dashboard projects tasks instances decisions plans this-week; do node scripts/page-shim.mjs "$p" > "$BASE/$p.md" 2>&1; echo "$p $?"; done
```
Expected: every page prints `<id> 0`.

- [ ] **Step 2: Move the files**

```bash
mkdir -p packages/org-state
git mv packages/cloudflare-os-integration/src/page-core/build-state.mjs packages/org-state/build-state.mjs
git mv packages/cloudflare-os-integration/src/page-core/parse-helpers.mjs packages/org-state/parse-helpers.mjs
git mv packages/cloudflare-os-integration/src/page-core/render-page.mjs packages/org-state/render-page.mjs
```

- [ ] **Step 3: Re-create the old paths as shims** (each file is one line + comment)

`packages/cloudflare-os-integration/src/page-core/build-state.mjs`:
```js
// Moved to packages/org-state (2026-09-25). Re-exported so existing importers keep working.
export * from "../../../org-state/build-state.mjs";
```
`packages/cloudflare-os-integration/src/page-core/parse-helpers.mjs`:
```js
// Moved to packages/org-state (2026-09-25). Re-exported so existing importers keep working.
export * from "../../../org-state/parse-helpers.mjs";
```
`packages/cloudflare-os-integration/src/page-core/render-page.mjs`:
```js
// Moved to packages/org-state (2026-09-25). Re-exported so existing importers keep working.
export * from "../../../org-state/render-page.mjs";
```

- [ ] **Step 4: Point `scripts/page-shim.mjs` at the new home** — replace line 23:

```js
import { renderPage } from "../packages/org-state/render-page.mjs";
```

- [ ] **Step 5: Write the shim-identity test** — `packages/org-state/test/shim.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import * as orgBuild from "../build-state.mjs";
import * as orgRender from "../render-page.mjs";
import * as orgParse from "../parse-helpers.mjs";
import * as shimBuild from "../../cloudflare-os-integration/src/page-core/build-state.mjs";
import * as shimRender from "../../cloudflare-os-integration/src/page-core/render-page.mjs";
import * as shimParse from "../../cloudflare-os-integration/src/page-core/parse-helpers.mjs";

test("old page-core paths re-export the same functions", () => {
  assert.equal(shimBuild.buildState, orgBuild.buildState);
  assert.equal(shimBuild.loadFederation, orgBuild.loadFederation);
  assert.equal(shimRender.renderPage, orgRender.renderPage);
  assert.deepEqual(shimRender.SUPPORTED_PAGES, orgRender.SUPPORTED_PAGES);
  assert.equal(shimParse.extractCheckboxes, orgParse.extractCheckboxes);
});
```

- [ ] **Step 6: Package files** — `packages/org-state/package.json`

```json
{
  "name": "@org-os/org-state",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Pure org-os workspace state: files map → structured state, loaders, and markdown pages (backs `npm run page`)",
  "exports": {
    ".": "./index.mjs",
    "./build-state": "./build-state.mjs",
    "./render-page": "./render-page.mjs",
    "./parse-helpers": "./parse-helpers.mjs",
    "./read-files": "./read-files.mjs"
  },
  "scripts": {
    "test": "node --test \"test/*.test.mjs\""
  },
  "dependencies": {
    "js-yaml": "4.1.0"
  },
  "engines": {
    "node": ">=22"
  }
}
```
(`index.mjs` and `read-files.mjs` arrive in Task 3; the export entries are fine to declare now.) Root `package.json`: add `"test:org-state": "npm test --prefix packages/org-state"`. `README.md`: *What moved and why* (third consumer; not inside a frozen integration), *Consumers* (cloudflare gatekeeper via shim, `scripts/page-shim.mjs`, `packages/tui`), *Purity rule* (only `read-files.mjs` touches the filesystem), *Tests*.

- [ ] **Step 7: Verify nothing changed**

```bash
BASE="${TMPDIR:-/tmp}/org-state-baseline"
for p in dashboard projects tasks instances decisions plans this-week; do node scripts/page-shim.mjs "$p" > "$BASE/$p.after.md" 2>&1; cmp -s "$BASE/$p.md" "$BASE/$p.after.md" && echo "$p identical" || echo "$p DIFFERS"; done
node --test packages/org-state/test/shim.test.mjs
npm run test:cloudflare-os-integration
```
Expected: 7× `identical` — except pages whose output embeds the current time (`dashboard`/`this-week` may show relative ages); if one differs, diff it and confirm the only differences are clock-derived. Shim test passes; cloudflare suite passes unchanged.

- [ ] **Step 8: Commit**

```bash
git add -A packages/org-state packages/cloudflare-os-integration/src/page-core scripts/page-shim.mjs package.json
git commit -m "refactor(org-state): move page-core into a shared org-state package" -m "Old page-core paths stay as re-export shims; npm run page output unchanged." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `org-state` — file reader and new loaders

**Files:**
- Create: `packages/org-state/read-files.mjs`, `packages/org-state/index.mjs`, `packages/org-state/loaders/{heartbeat,memory,decisions,plans,funding}.mjs`
- Create fixtures: `packages/org-state/test/fixtures/ws/**`, `packages/org-state/test/fixtures/ws-bad/**`
- Test: `packages/org-state/test/read-files.test.mjs`, `packages/org-state/test/loaders.test.mjs`

**Interfaces:**
- Consumes: `extractCheckboxes`, `daysUntil(dateStr, now)` (Task 2), `buildState(files, {now})`.
- Produces:
  - `read-files.mjs`: `ROOT_FILES: string[]`, `WATCH_PATHS: string[]`, `MEMORY_LIMIT = 60`, `listMemoryFiles(root, limit?) → string[]`, `listProjectFiles(root) → string[]`, `readWorkspaceFiles(root, {memoryLimit?}) → { files: Record<string,string>, errors: string[] }`.
  - `loaders/heartbeat.mjs`: `loadHeartbeat(files) → { present, sections: {heading, items: {text, done, category, due, assignee}[]}[], open, done }`.
  - `loaders/memory.mjs`: `listMemory(files) → { id, date, path, title: string|null, focus: string|null }[]` newest first.
  - `loaders/decisions.mjs`: `parseDecisions(text) → { n, date, title, status: string|null, body }[]` (file order, `n` 1-based).
  - `loaders/plans.mjs`: `QUEUE_PATHS`, `loadQueue(files) → { path, text } | null`.
  - `loaders/funding.mjs`: `loadFunding(files, now) → { upcoming: {title, deadline, status, daysLeft}[], active: {title, status}[], error?: string }`.
  - `index.mjs`: re-exports all of the above plus `buildState`, `renderPage`, `SUPPORTED_PAGES`, and `loadWorkspaceState(files, {now}) → buildState(...) & { heartbeat, memory, decisions, queue, funding }` and `yamlErrors(files) → string[]`.

- [ ] **Step 1: Create fixtures** (plain files; use the Write tool)

`packages/org-state/test/fixtures/ws/package.json`:
```json
{ "name": "fixture-ws", "scripts": { "initialize": "node -e 1", "validate:schemas": "node -e 1", "deploy": "node -e 1" } }
```
`packages/org-state/test/fixtures/ws/federation.yaml`:
```yaml
identity:
  name: "Fixture Org"
  type: "LocalNode"
network: "fixture-net"
federation:
  peers:
    - name: "peer-a"
      role: "hub"
```
`packages/org-state/test/fixtures/ws/HEARTBEAT.md`:
```markdown
# HEARTBEAT

## Funding
- [ ] Submit grant report (due: 2026-09-27)
- [x] Pay invoices

## Technical
- [ ] Fix the sync script
- [ ] Write docs @luiz
```
`packages/org-state/test/fixtures/ws/DECISIONS.md`:
```markdown
# DECISIONS.md

## Conventions

Text.

---

## 2026-09-20 · Adopt the cockpit

- **Status:** active
- **Scope:** framework

Body one.

## 2026-09-01 — Older call

**Status:** superseded

Body two.
```
`packages/org-state/test/fixtures/ws/memory/2026-09-02.md`:
```markdown
# 2026-09-02 — Second day

**Focus:** ship the thing
```
`packages/org-state/test/fixtures/ws/memory/2026-09-01.md`:
```markdown
# 2026-09-01 — First day
```
`packages/org-state/test/fixtures/ws/memory/README.md`: `Not a log.`
`packages/org-state/test/fixtures/ws/data/projects.yaml`:
```yaml
projects:
  - id: cockpit
    title: "Cockpit"
    status: "Develop"
    lead: "luiz"
  - id: garden
    title: "Garden Party"
    status: "Discovery"
```
`packages/org-state/test/fixtures/ws/data/events.yaml`:
```yaml
events:
  - date: "2026-09-26"
    title: "Council call"
  - date: "2026-10-30"
    title: "Far event"
```
`packages/org-state/test/fixtures/ws/data/funding-opportunities.yaml`:
```yaml
funding_opportunities:
  - name: "Gitcoin round"
    deadline: "2026-10-05"
    status: "open"
  - name: "Old round"
    deadline: "2026-01-01"
    status: "open"
  - name: "Applied grant"
    status: "applied"
```
`packages/org-state/test/fixtures/ws/docs/agent-plans/QUEUE.md`:
```markdown
# Plan Queue

## Active
- cockpit
```
`packages/org-state/test/fixtures/ws-bad/package.json`: `{}`
`packages/org-state/test/fixtures/ws-bad/federation.yaml`:
```yaml
identity: [unclosed
```
`packages/org-state/test/fixtures/ws-bad/data/projects.yaml`:
```yaml
projects:
  - title: "ok"
   bad-indent: true
```
`packages/org-state/test/fixtures/ws-bad/memory/.gitkeep`: empty file.

- [ ] **Step 2: Write the failing tests** — `packages/org-state/test/read-files.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkspaceFiles, listMemoryFiles, ROOT_FILES, WATCH_PATHS } from "../read-files.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

test("readWorkspaceFiles reads known root files and dated memory logs only", () => {
  const { files, errors } = readWorkspaceFiles(join(FIX, "ws"));
  assert.deepEqual(errors, []);
  assert.ok(files["HEARTBEAT.md"].includes("Submit grant report"));
  assert.ok(files["package.json"]);
  assert.ok(files["memory/2026-09-02.md"]);
  assert.equal(files["memory/README.md"], undefined);
  assert.equal(files["MEMORY.md"], undefined);
});

test("memory files are newest first and limited", () => {
  assert.deepEqual(listMemoryFiles(join(FIX, "ws")), ["memory/2026-09-02.md", "memory/2026-09-01.md"]);
  assert.deepEqual(listMemoryFiles(join(FIX, "ws"), 1), ["memory/2026-09-02.md"]);
  assert.deepEqual(listMemoryFiles(join(FIX, "does-not-exist")), []);
});

test("constants cover what the loaders and the watcher need", () => {
  for (const p of ["package.json", "HEARTBEAT.md", "DECISIONS.md", "federation.yaml", "data/funding-opportunities.yaml"]) assert.ok(ROOT_FILES.includes(p), p);
  for (const p of ["data", "memory", "HEARTBEAT.md"]) assert.ok(WATCH_PATHS.includes(p), p);
});
```

`packages/org-state/test/loaders.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkspaceFiles } from "../read-files.mjs";
import { loadWorkspaceState, yamlErrors, loadHeartbeat, listMemory, parseDecisions, loadQueue, loadFunding } from "../index.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const NOW = new Date("2026-09-25T12:00:00Z");
const ws = readWorkspaceFiles(join(FIX, "ws")).files;
const bad = readWorkspaceFiles(join(FIX, "ws-bad")).files;

test("heartbeat groups tasks by heading", () => {
  const hb = loadHeartbeat(ws);
  assert.equal(hb.present, true);
  assert.deepEqual(hb.sections.map((s) => s.heading), ["Funding", "Technical"]);
  assert.equal(hb.open, 3);
  assert.equal(hb.done, 1);
  assert.deepEqual(loadHeartbeat({}), { present: false, sections: [], open: 0, done: 0 });
});

test("memory entries: newest first, heading and focus", () => {
  const m = listMemory(ws);
  assert.deepEqual(m.map((e) => e.id), ["2026-09-02", "2026-09-01"]);
  assert.equal(m[0].title, "2026-09-02 — Second day");
  assert.equal(m[0].focus, "ship the thing");
  assert.equal(m[1].focus, null);
});

test("decisions: both separators, both status styles, conventions skipped", () => {
  const d = parseDecisions(ws["DECISIONS.md"]);
  assert.deepEqual(d.map((x) => [x.n, x.date, x.title, x.status]), [
    [1, "2026-09-20", "Adopt the cockpit", "active"],
    [2, "2026-09-01", "Older call", "superseded"],
  ]);
  assert.ok(d[0].body.includes("Body one."));
  assert.ok(!d[0].body.includes("Body two."));
  assert.deepEqual(parseDecisions(undefined), []);
});

test("queue prefers the framework path", () => {
  assert.equal(loadQueue(ws).path, "docs/agent-plans/QUEUE.md");
  assert.equal(loadQueue({ "docs/plans/QUEUE.md": "x" }).path, "docs/plans/QUEUE.md");
  assert.equal(loadQueue({}), null);
});

test("funding: upcoming sorted with daysLeft, past dropped, applied is active", () => {
  const f = loadFunding(ws, NOW);
  assert.deepEqual(f.upcoming.map((o) => [o.title, o.daysLeft]), [["Gitcoin round", 10]]);
  assert.deepEqual(f.active.map((o) => o.title), ["Applied grant"]);
  assert.deepEqual(loadFunding({}, NOW), { upcoming: [], active: [] });
});

test("loadWorkspaceState combines page-core state with the new loaders", () => {
  const s = loadWorkspaceState(ws, { now: NOW });
  assert.equal(s.identity.name, "Fixture Org");
  assert.equal(s.projects.length, 2);
  assert.equal(s.heartbeat.open, 3);
  assert.equal(s.decisions.length, 2);
  assert.equal(s.funding.upcoming.length, 1);
  assert.equal(s.events.thisWeek.length, 1);
});

test("malformed workspace degrades instead of throwing", () => {
  const s = loadWorkspaceState(bad, { now: NOW });
  assert.equal(s.identity.name, null);
  assert.deepEqual(s.projects, []);
  assert.equal(s.heartbeat.present, false);
  assert.deepEqual(s.memory, []);
  const errs = yamlErrors(bad);
  assert.equal(errs.length, 2);
  assert.ok(errs.some((e) => e.startsWith("federation.yaml:")));
  assert.ok(errs.some((e) => e.startsWith("data/projects.yaml:")));
  assert.deepEqual(yamlErrors(ws), []);
});
```

- [ ] **Step 3: Run — expect failure.** `node --test packages/org-state/test/read-files.test.mjs packages/org-state/test/loaders.test.mjs`

- [ ] **Step 4: Implement `read-files.mjs`**

```js
// The only fs-touching module in org-state: reads a workspace into the flat
// { "relative/path": "content" } map every other module consumes.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT_FILES = [
  "package.json",
  "federation.yaml",
  "HEARTBEAT.md",
  "MEMORY.md",
  "DECISIONS.md",
  "docs/agent-plans/QUEUE.md",
  "docs/plans/QUEUE.md",
  "data/projects.yaml",
  "data/instances.yaml",
  "data/events.yaml",
  "data/meetings.yaml",
  "data/funding-opportunities.yaml",
];

export const WATCH_PATHS = [
  "data",
  "memory",
  "HEARTBEAT.md",
  "MEMORY.md",
  "DECISIONS.md",
  "federation.yaml",
  "docs/agent-plans/QUEUE.md",
  "docs/plans/QUEUE.md",
];

export const MEMORY_LIMIT = 60;

function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function listMemoryFiles(root, limit = MEMORY_LIMIT) {
  return listDir(join(root, "memory"))
    .filter((n) => /^\d{4}-\d{2}-\d{2}.*\.md$/.test(n))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((n) => `memory/${n}`);
}

export function listProjectFiles(root) {
  return listDir(join(root, "packages", "operations", "projects"))
    .filter((n) => n.endsWith(".md"))
    .map((n) => `packages/operations/projects/${n}`);
}

export function readWorkspaceFiles(root, { memoryLimit = MEMORY_LIMIT } = {}) {
  const files = {};
  const errors = [];
  const paths = [...ROOT_FILES, ...listMemoryFiles(root, memoryLimit), ...listProjectFiles(root)];
  for (const rel of paths) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    try {
      files[rel] = readFileSync(abs, "utf8");
    } catch (e) {
      errors.push(`${rel}: ${e.message}`);
    }
  }
  return { files, errors };
}
```

- [ ] **Step 5: Implement the loaders**

`packages/org-state/loaders/heartbeat.mjs`:
```js
import { extractCheckboxes } from "../parse-helpers.mjs";

export function loadHeartbeat(files) {
  const text = files["HEARTBEAT.md"];
  if (!text) return { present: false, sections: [], open: 0, done: 0 };
  const items = extractCheckboxes(text);
  const sections = [];
  const byHeading = new Map();
  for (const item of items) {
    const heading = item.category || "Tasks";
    if (!byHeading.has(heading)) {
      const section = { heading, items: [] };
      byHeading.set(heading, section);
      sections.push(section);
    }
    byHeading.get(heading).items.push(item);
  }
  const done = items.filter((i) => i.done).length;
  return { present: true, sections, open: items.length - done, done };
}
```

`packages/org-state/loaders/memory.mjs`:
```js
export function listMemory(files) {
  return Object.keys(files)
    .filter((k) => /^memory\/\d{4}-\d{2}-\d{2}.*\.md$/.test(k))
    .sort()
    .reverse()
    .map((path) => {
      const text = files[path] || "";
      const id = path.slice("memory/".length, -".md".length);
      return {
        id,
        date: id.slice(0, 10),
        path,
        title: (text.match(/^#\s+(.+)$/m) || [])[1]?.trim() ?? null,
        focus: (text.match(/^\*\*Focus:\*\*\s*(.+)$/m) || [])[1]?.trim() ?? null,
      };
    });
}
```

`packages/org-state/loaders/decisions.mjs`:
```js
// DECISIONS.md sections look like `## 2026-09-20 · Title` (also `—`, `–`, `-`),
// with a `**Status:** active` line (bulleted or not).
const HEADING = /^## (\d{4}-\d{2}-\d{2})\s*[·—–-]\s*(.+)$/gm;

export function parseDecisions(text) {
  if (!text) return [];
  const heads = [...text.matchAll(HEADING)];
  return heads.map((m, i) => {
    const start = m.index;
    const hardEnd = i + 1 < heads.length ? heads[i + 1].index : text.length;
    let body = text.slice(start, hardEnd);
    const nextH2 = body.slice(3).search(/^## /m);
    if (nextH2 >= 0) body = body.slice(0, nextH2 + 3);
    const status = (body.match(/\*\*Status:?\*\*:?\s*([A-Za-z-]+)/) || [])[1] ?? null;
    return { n: i + 1, date: m[1], title: m[2].trim(), status: status ? status.toLowerCase() : null, body: body.trim() };
  });
}
```

`packages/org-state/loaders/plans.mjs`:
```js
export const QUEUE_PATHS = ["docs/agent-plans/QUEUE.md", "docs/plans/QUEUE.md"];

export function loadQueue(files) {
  for (const path of QUEUE_PATHS) if (files[path]) return { path, text: files[path] };
  return null;
}
```

`packages/org-state/loaders/funding.mjs`:
```js
// Port of scripts/initialize.mjs loadFunding with `now` injected (pure).
import yaml from "js-yaml";
import { daysUntil } from "../parse-helpers.mjs";

const title = (o) => o.name || o.title || o.id || "untitled";

export function loadFunding(files, now) {
  const raw = files["data/funding-opportunities.yaml"];
  if (!raw) return { upcoming: [], active: [] };
  let data;
  try {
    data = yaml.load(raw);
  } catch (e) {
    return { upcoming: [], active: [], error: `data/funding-opportunities.yaml: ${e.message.split("\n")[0]}` };
  }
  const opportunities = data?.funding_opportunities || data?.opportunities || [];
  const upcoming = [];
  const active = [];
  for (const opp of opportunities) {
    if (!opp.deadline) {
      if (["active", "applied", "open"].includes(opp.status)) active.push({ title: title(opp), status: opp.status });
      continue;
    }
    const days = daysUntil(opp.deadline, now);
    if (days < 0) continue;
    if (opp.status === "applied" || opp.status === "awarded") active.push({ title: title(opp), status: opp.status });
    else upcoming.push({ title: title(opp), deadline: opp.deadline, status: opp.status ?? null, daysLeft: days });
  }
  upcoming.sort((a, b) => a.daysLeft - b.daysLeft);
  return { upcoming, active };
}
```
Note: the fixture expects `daysLeft` 10 for `2026-10-05` from `2026-09-25T12:00Z`; `daysUntil` normalizes to local midnight — if the test machine's timezone makes it 9 or 11, change the assertion to `assert.ok([9, 10, 11].includes(daysLeft))` rather than touching `daysUntil` (it is a verbatim port that must not change).

- [ ] **Step 6: Implement `index.mjs`**

```js
import yaml from "js-yaml";
import { buildState } from "./build-state.mjs";
import { loadHeartbeat } from "./loaders/heartbeat.mjs";
import { listMemory } from "./loaders/memory.mjs";
import { parseDecisions } from "./loaders/decisions.mjs";
import { loadQueue } from "./loaders/plans.mjs";
import { loadFunding } from "./loaders/funding.mjs";

export { buildState, loadFederation } from "./build-state.mjs";
export { renderPage, SUPPORTED_PAGES } from "./render-page.mjs";
export { extractCheckboxes, daysUntil, getRelativeAge, parseFrontmatter } from "./parse-helpers.mjs";
export { readWorkspaceFiles, listMemoryFiles, ROOT_FILES, WATCH_PATHS } from "./read-files.mjs";
export { loadHeartbeat, listMemory, parseDecisions, loadQueue, loadFunding };
export { QUEUE_PATHS } from "./loaders/plans.mjs";

export function loadWorkspaceState(files, { now }) {
  return {
    ...buildState(files, { now }),
    heartbeat: loadHeartbeat(files),
    memory: listMemory(files),
    decisions: parseDecisions(files["DECISIONS.md"]),
    queue: loadQueue(files),
    funding: loadFunding(files, now),
  };
}

export function yamlErrors(files) {
  const errors = [];
  for (const [path, text] of Object.entries(files)) {
    if (!path.endsWith(".yaml") && !path.endsWith(".yml")) continue;
    try {
      yaml.load(text);
    } catch (e) {
      errors.push(`${path}: ${String(e.message).split("\n")[0]}`);
    }
  }
  return errors;
}
```

- [ ] **Step 7: Run all org-state tests — expect PASS.** `npm run test:org-state`

- [ ] **Step 8: Commit**

```bash
git add packages/org-state
git commit -m "feat(org-state): workspace file reader and heartbeat/memory/decisions/queue/funding loaders" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `packages/tui` scaffold — deps, Bun, launcher, spike record

**Files:**
- Create: `packages/tui/package.json`, `packages/tui/bunfig.toml`, `packages/tui/tsconfig.json`, `packages/tui/.gitignore`, `packages/tui/bin/cockpit.mjs`, `packages/tui/VERIFIED.md`
- Test: `packages/tui/test/launcher.nodetest.mjs` (Node test — the `.nodetest.mjs` name keeps `bun test` from picking it up), `packages/tui/test/smoke.test.tsx`
- Modify: root `package.json` scripts: `tui`, `tui:install`, `test:tui`

**Interfaces:**
- Produces (`bin/cockpit.mjs`): `MIN_BUN = [1,3,0]`, `parseVersion(s) → number[]|null`, `atLeast(v, min) → boolean`, `candidateBuns(pkgDir, env) → string[]`, `findBun({pkgDir?, env?, run?}) → { bin, version } | null`, `invokedFrom(env, cwd) → string`. Running the file execs `bun run src/main.tsx …args` with `cwd = packages/tui` and env `ORG_OS_INVOKED_FROM`.

- [ ] **Step 1: Package manifest** — `packages/tui/package.json`

```json
{
  "name": "@org-os/tui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "org-os cockpit: fleet TUI on OpenTUI with an embedded, guarded Pi agent and herdr integration",
  "bin": {
    "org-os-cockpit": "bin/cockpit.mjs"
  },
  "scripts": {
    "start": "node bin/cockpit.mjs",
    "test": "bun test && node --test test/launcher.nodetest.mjs"
  },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "0.87.1",
    "@opentui/core": "0.5.12",
    "@opentui/solid": "0.5.12",
    "js-yaml": "4.1.0",
    "solid-js": "1.9.12"
  },
  "devDependencies": {
    "@earendil-works/pi-ai": "0.87.1",
    "bun": "1.4.2"
  }
}
```

`packages/tui/bunfig.toml`:
```toml
preload = ["@opentui/solid/preload"]

[test]
preload = ["@opentui/solid/preload"]
```

`packages/tui/tsconfig.json`:
```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid",
    "module": "ESNext",
    "target": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "allowJs": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`packages/tui/.gitignore`:
```
node_modules/
```

- [ ] **Step 2: Install**

```bash
npm install --prefix packages/tui --no-audit --no-fund
packages/tui/node_modules/.bin/bun --version
```
Expected: `1.4.2`. npm may print `allow-scripts` warnings for transitive packages (esbuild, protobufjs, @google/genai) — they are not needed at runtime (verified in spike T0); do **not** approve scripts.

- [ ] **Step 3: Failing launcher test** — `packages/tui/test/launcher.nodetest.mjs`

```js
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
```

- [ ] **Step 4: Implement** — `packages/tui/bin/cockpit.mjs` (then `chmod +x packages/tui/bin/cockpit.mjs`)

```js
#!/usr/bin/env node
// Node launcher for the org-os cockpit: finds a Bun >= 1.3 (the local
// devDependency first), then runs src/main.tsx under it. Kept in plain Node so
// `npm run tui` gives a clear message instead of a stack trace when Bun is missing.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MIN_BUN = [1, 3, 0];

export function parseVersion(s) {
  const m = String(s ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1).map(Number) : null;
}

export function atLeast(v, min) {
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i];
  return true;
}

export function candidateBuns(pkgDir, env) {
  return [join(pkgDir, "node_modules", ".bin", "bun"), env.ORG_OS_BUN, "bun"].filter(Boolean);
}

export function findBun({ pkgDir = PKG, env = process.env, run = spawnSync, exists = existsSync } = {}) {
  for (const bin of candidateBuns(pkgDir, env)) {
    if (bin.includes("/") && !exists(bin)) continue;
    let r;
    try {
      r = run(bin, ["--version"], { encoding: "utf8" });
    } catch {
      continue;
    }
    const v = r && r.status === 0 ? parseVersion(r.stdout) : null;
    if (v && atLeast(v, MIN_BUN)) return { bin, version: v.join(".") };
  }
  return null;
}

export function invokedFrom(env, cwd) {
  return env.ORG_OS_INVOKED_FROM || env.INIT_CWD || cwd;
}

function main() {
  const found = findBun();
  if (!found) {
    process.stderr.write(
      "org-os cockpit needs Bun >= 1.3 (OpenTUI's runtime).\n" +
        "Install the cockpit's pinned dependencies (includes a local Bun):\n\n" +
        "  npm run tui:install\n\n" +
        "or point ORG_OS_BUN at a Bun >= 1.3 binary.\n",
    );
    process.exit(1);
  }
  const child = spawn(found.bin, ["run", join(PKG, "src", "main.tsx"), ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: PKG,
    env: { ...process.env, ORG_OS_INVOKED_FROM: invokedFrom(process.env, process.cwd()) },
  });
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
}

const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) main();
```

- [ ] **Step 5: Toolchain smoke test** — `packages/tui/test/smoke.test.tsx`

```tsx
import { test, expect } from "bun:test";
import { testRender } from "@opentui/solid";

test("OpenTUI Solid renders under the local Bun", async () => {
  const setup = await testRender(() => (
    <box border title="org-os" style={{ width: 30, height: 4 }}>
      <text>cockpit ready</text>
    </box>
  ), { width: 40, height: 6 });
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("cockpit ready");
});
```

- [ ] **Step 6: Run — expect PASS.** `npm test --prefix packages/tui`

- [ ] **Step 7: Root scripts** — add to root `package.json` `scripts`:

```json
"tui": "node packages/tui/bin/cockpit.mjs",
"tui:install": "npm install --prefix packages/org-state --no-audit --no-fund && npm install --prefix packages/tui --no-audit --no-fund",
"test:tui": "npm test --prefix packages/tui"
```

- [ ] **Step 8: Record the spikes** — `packages/tui/VERIFIED.md`

```markdown
# packages/tui — VERIFIED

Facts this package relies on, each checked by running code (not by reading docs alone).

## Spikes — 2026-09-25 (Bun 1.4.2 local, macOS arm64)

| Spike | Result | Decision |
|---|---|---|
| T0 runtime | `@opentui/solid@0.5.12` `testRender` + `captureCharFrame` pass under `bun test`; `@earendil-works/pi-coding-agent@0.87.1` imports and runs a session under Bun | **Bun** is the runtime (local devDependency `bun@1.4.2`). Node 26.4 path not needed. |
| T1 OpenTUI | Elements `box text input textarea select scrollbox code diff markdown …`; hooks `useKeyboard`, `useTerminalDimensions`, `useRenderer`; `renderer.suspend()/resume()`; test `mockInput.pressKey(key, {ctrl})`, `typeText`, `pressEnter`, `waitForFrame`. **`useKeyboard` also receives keys while an `<input>` is focused** → the app routes keys by focus (`ui/keys.ts`). `<markdown>` renders nothing without a tree-sitter style in tests → the cockpit renders markdown itself (`core/markdown.ts`). | as stated |
| T2 Pi embedding | `DefaultResourceLoader({cwd, agentDir, extensionFactories, additionalExtensionPaths, additionalSkillPaths})` + `reload()`; inline factory `pi.on("tool_call", e => ({block:true, reason}))` blocks — result arrives as `tool_execution_end` with `isError: true` and the reason as text; the model continues. Faux provider: `fauxProvider()` from `@earendil-works/pi-ai/providers/faux` registered via `pi.registerProvider(faux.provider)`; `SessionManager.inMemory/create/continueRecent(cwd)`. Session events: `agent_start turn_start message_start message_update message_end tool_execution_start tool_execution_end turn_end agent_end agent_settled`. | as stated; the tool_call handler is the gate. Project `.pi/` trust is **not** granted by the cockpit — Pi's own trust store decides; the cockpit shows a notice. |
| T3 herdr shapes | From `herdr api schema` (protocol 22): envelope `{id, result: {type, …}}`; `agent_list → agents[]` of `AgentInfo{pane_id, workspace_id, cwd, foreground_cwd, agent, display_agent, agent_status, name, title}`; `pane split → pane_info.pane`; `tab create → tab_created.root_pane`; `agent start → agent_started.agent`. Never probed against the live session. | CLI JSON transport, polling. |
| T4 Ghostty | Ghostty 1.3.1 help: on macOS the CLI cannot launch the app; use `open -na Ghostty.app --args --working-directory=<dir> -e <cmd>`. | launch strategy 4 as stated |

## Acceptance (operator, pending)

To be filled after the operator's first run inside herdr — see README "Acceptance".
```

- [ ] **Step 9: Commit**

```bash
git add packages/tui package.json
git commit -m "feat(tui): scaffold cockpit package with pinned OpenTUI, Pi, local Bun and launcher" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
(`packages/tui/package-lock.json` is committed; `node_modules/` is ignored.)

---
### Task 5: core foundations — types, bus, proc, config, util, args

**Files:**
- Create: `packages/tui/src/core/{types,bus,proc,config,util,args}.ts`
- Test: `packages/tui/test/core/{bus,proc,config,util,args}.test.ts`

**Interfaces:**
- Produces (`types.ts`) — every shared type used by later tasks:

```ts
export type NoticeLevel = "info" | "warn" | "error";
export type Notice = { level: NoticeLevel; text: string };
export type PageRef = { page: string; id?: string; workspace?: string };
export type TableRow = { key: string; cells: string[]; target?: PageRef };
export type ListItem = { key: string; label: string; detail?: string; badge?: string; target?: PageRef };
export type Block =
  | { kind: "table"; heading?: string; columns: string[]; rows: TableRow[] }
  | { kind: "list"; heading?: string; items: ListItem[] }
  | { kind: "kv"; heading?: string; pairs: [string, string][] }
  | { kind: "markdown"; text: string }
  | { kind: "notice"; level: NoticeLevel; text: string };
export type ActionRef = { id: string; label: string };
export type PageData = { ref: PageRef; title: string; subtitle?: string; blocks: Block[]; actions: ActionRef[]; sources: string[]; errors: string[] };
export type WorkspaceKind = "hub" | "framework" | "instance" | "extra";
export type WorkspaceInfo = { id: string; label: string; root: string; kind: WorkspaceKind; exists: boolean; drift: number };
export type GitStatus = { branch: string | null; dirty: boolean; ahead: number; behind: number; lastCommit: string | null };
export type WorkspaceSummary = { id: string; name: string; type: string | null; git: GitStatus | null; openTasks: number; urgentTasks: number; lastMemory: string | null; errors: string[] };
export type HostId = "claude" | "pi" | "opencode";
export const HOSTS: HostId[] = ["claude", "pi", "opencode"];
export type Placement = "split" | "tab";
export type LifecycleCommand = "initialize" | "close" | "sync" | "commit" | "handoff";
export const LIFECYCLE_COMMANDS: LifecycleCommand[] = ["initialize", "close", "sync", "commit", "handoff"];
export type LaunchStrategy = "herdr" | "tmux" | "zellij" | "ghostty" | "suspend";
export type AgentStatus = "idle" | "working" | "blocked" | "error";
export type AgentEvent =
  | { type: "status"; status: AgentStatus; detail?: string }
  | { type: "user"; text: string }
  | { type: "text_delta"; delta: string }
  | { type: "assistant_end"; text: string }
  | { type: "tool_start"; callId: string; tool: string; summary: string }
  | { type: "tool_end"; callId: string; ok: boolean; summary: string }
  | { type: "notice"; level: NoticeLevel; text: string };
export type PermissionAnswer = "once" | "session" | "deny";
export type PermissionRequest = { id: string; workspace: string; tool: string; summary: string; input: Record<string, unknown> };
export type HerdrAgent = { paneId: string; workspaceId: string; name: string | null; agent: string | null; status: string; cwd: string | null; title: string | null };
export type ForegroundEffect = { type: "foreground"; cmd: string; args: string[]; cwd: string };
export type Command =
  | { type: "select-workspace"; id: string }
  | { type: "open-page"; ref: PageRef }
  | { type: "back" }
  | { type: "refresh" }
  | { type: "run-action"; actionId: string }
  | { type: "launch"; host: HostId; placement: Placement; paneCols?: number }
  | { type: "agent-prompt"; text: string }
  | { type: "agent-command"; name: LifecycleCommand; args?: string }
  | { type: "agent-abort" }
  | { type: "agent-new-session" }
  | { type: "permission-answer"; id: string; answer: PermissionAnswer };
```

- Produces (`bus.ts`): `class Emitter<M extends object>` with `on(type, fn) → () => void`, `emit(type, payload)`, `clear()`; a throwing listener never stops the others (`onListenerError` callback, default `console.error`).
- Produces (`proc.ts`): `type ProcResult = { code: number | null; stdout: string; stderr: string; error?: string; timedOut?: boolean }`, `type RunOptions = { cwd?; timeoutMs?; env?; input? }`, `type Runner = (cmd, args, opts?) => Promise<ProcResult>`, `run: Runner`, `which(bin, env?) → boolean`.
- Produces (`config.ts`): `type CockpitConfig = { workspaces: { path: string; label?: string }[]; launch: { prefer?: LaunchStrategy }; herdr: { poll: boolean; pollMs: number } }`, `DEFAULT_CONFIG`, `type UiState = { lastWorkspace?: string; agentOpen?: boolean }`, `configDir(env?) → string`, `mergeConfig(raw) → { config, errors }`, `loadConfig(dir) → { config, errors }`, `loadUiState(dir) → UiState`, `saveUiState(dir, state) → boolean`.
- Produces (`util.ts`): `slug(s) → string`, `containsPath(root, p) → boolean`, `firstLine(s, max?) → string`.
- Produces (`args.ts`): `type CliArgs = { workspace?: string; page?: string; snapshot: boolean; width: number; height: number; framework?: string }`, `parseArgs(argv: string[]) → CliArgs`.

- [ ] **Step 1: Write the failing tests**

`packages/tui/test/core/bus.test.ts`:
```ts
import { test, expect } from "bun:test";
import { Emitter } from "../../src/core/bus";

test("on/emit/unsubscribe and listener isolation", () => {
  const errors: unknown[] = [];
  const bus = new Emitter<{ ping: number }>((_, e) => errors.push(e));
  const got: number[] = [];
  const off = bus.on("ping", (n) => got.push(n));
  bus.on("ping", () => { throw new Error("bad listener"); });
  bus.on("ping", (n) => got.push(n * 10));
  bus.emit("ping", 1);
  off();
  bus.emit("ping", 2);
  expect(got).toEqual([1, 10, 20]);
  expect(errors.length).toBe(2);
});
```

`packages/tui/test/core/proc.test.ts`:
```ts
import { test, expect } from "bun:test";
import { run, which } from "../../src/core/proc";

test("captures output and exit code", async () => {
  const r = await run("sh", ["-c", "echo out; echo err >&2; exit 3"]);
  expect(r.code).toBe(3);
  expect(r.stdout.trim()).toBe("out");
  expect(r.stderr.trim()).toBe("err");
});

test("feeds stdin", async () => {
  const r = await run("cat", [], { input: "hello" });
  expect(r.stdout).toBe("hello");
});

test("times out", async () => {
  const r = await run("sleep", ["5"], { timeoutMs: 150 });
  expect(r.timedOut).toBe(true);
  expect(r.code).not.toBe(0);
});

test("missing binary is an error, not a throw", async () => {
  const r = await run("definitely-not-a-binary-xyz", []);
  expect(r.code).toBe(null);
  expect(r.error).toBeTruthy();
});

test("which", () => {
  expect(which("sh")).toBe(true);
  expect(which("definitely-not-a-binary-xyz")).toBe(false);
});
```

`packages/tui/test/core/config.test.ts`:
```ts
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeConfig, loadConfig, loadUiState, saveUiState, configDir, DEFAULT_CONFIG } from "../../src/core/config";

test("mergeConfig keeps defaults and drops invalid entries with errors", () => {
  const { config, errors } = mergeConfig({
    workspaces: [{ path: "/abs/ws", label: "WS" }, { path: "relative" }, { nope: 1 }],
    launch: { prefer: "tmux" },
    herdr: { pollMs: 50 },
  });
  expect(config.workspaces).toEqual([{ path: "/abs/ws", label: "WS" }]);
  expect(config.launch.prefer).toBe("tmux");
  expect(config.herdr).toEqual({ poll: true, pollMs: 1000 });
  expect(errors.length).toBe(2);
  expect(mergeConfig(undefined).config).toEqual(DEFAULT_CONFIG);
  expect(mergeConfig({ launch: { prefer: "warp" } }).errors[0]).toContain("launch.prefer");
});

test("loadConfig tolerates a missing dir and bad JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "ck-"));
  expect(loadConfig(dir)).toEqual({ config: DEFAULT_CONFIG, errors: [] });
  writeFileSync(join(dir, "config.json"), "{ nope");
  const r = loadConfig(dir);
  expect(r.config).toEqual(DEFAULT_CONFIG);
  expect(r.errors[0]).toContain("config.json");
});

test("ui state round-trips atomically", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ck-")), "nested");
  expect(loadUiState(dir)).toEqual({});
  expect(saveUiState(dir, { lastWorkspace: "hub", agentOpen: true })).toBe(true);
  expect(loadUiState(dir)).toEqual({ lastWorkspace: "hub", agentOpen: true });
  expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).lastWorkspace).toBe("hub");
});

test("configDir honours overrides", () => {
  expect(configDir({ ORG_OS_COCKPIT_HOME: "/x" })).toBe("/x");
  expect(configDir({ XDG_CONFIG_HOME: "/cfg" })).toBe("/cfg/org-os/cockpit");
});
```

`packages/tui/test/core/util.test.ts`:
```ts
import { test, expect } from "bun:test";
import { slug, containsPath, firstLine } from "../../src/core/util";

test("slug", () => {
  expect(slug("ReFi BCN OS!")).toBe("refi-bcn-os");
  expect(slug("🧬")).toBe("ws");
});

test("containsPath respects path boundaries", () => {
  expect(containsPath("/a/b", "/a/b")).toBe(true);
  expect(containsPath("/a/b", "/a/b/c")).toBe(true);
  expect(containsPath("/a/b", "/a/bc")).toBe(false);
});

test("firstLine", () => {
  expect(firstLine("one\ntwo")).toBe("one");
  expect(firstLine("x".repeat(100), 10)).toBe("xxxxxxxxx…");
});
```

`packages/tui/test/core/args.test.ts`:
```ts
import { test, expect } from "bun:test";
import { parseArgs } from "../../src/core/args";

test("defaults and flags", () => {
  expect(parseArgs([])).toEqual({ snapshot: false, width: 160, height: 45 });
  expect(parseArgs(["--workspace", "/w", "--page", "tasks", "--snapshot", "--width", "80", "--height", "24", "--framework", "/fw"]))
    .toEqual({ workspace: "/w", page: "tasks", snapshot: true, width: 80, height: 24, framework: "/fw" });
  expect(parseArgs(["--width", "abc"]).width).toBe(160);
});
```

- [ ] **Step 2: Run — expect failures.** `npm test --prefix packages/tui`

- [ ] **Step 3: Implement**

`packages/tui/src/core/types.ts` — exactly the block shown under **Interfaces** above.

`packages/tui/src/core/bus.ts`:
```ts
export type Unsubscribe = () => void;

export class Emitter<M extends object> {
  private listeners = new Map<keyof M, Set<(payload: any) => void>>();

  constructor(
    private onListenerError: (type: keyof M, error: unknown) => void = (type, error) =>
      console.error(`[cockpit] listener for ${String(type)} failed`, error),
  ) {}

  on<K extends keyof M>(type: K, fn: (payload: M[K]) => void): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (error) {
        this.onListenerError(type, error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
```

`packages/tui/src/core/proc.ts`:
```ts
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export type ProcResult = { code: number | null; stdout: string; stderr: string; error?: string; timedOut?: boolean };
export type RunOptions = { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; input?: string };
export type Runner = (cmd: string, args: string[], opts?: RunOptions) => Promise<ProcResult>;

export const run: Runner = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (r: ProcResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      finish({ code: null, stdout: "", stderr: "", error: (e as Error).message });
      return;
    }
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, opts.timeoutMs);
    }
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (e) => finish({ code: null, stdout, stderr, error: e.message }));
    child.on("close", (code) => finish({ code: timedOut ? null : code, stdout, stderr, ...(timedOut ? { timedOut: true } : {}) }));
    child.stdin?.on("error", () => {});
    if (opts.input !== undefined) child.stdin?.end(opts.input);
    else child.stdin?.end();
  });

export function which(bin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const dirs = bin.includes("/") ? [""] : String(env.PATH ?? "").split(delimiter);
  for (const dir of dirs) {
    try {
      accessSync(dir ? join(dir, bin) : bin, constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}
```

`packages/tui/src/core/config.ts`:
```ts
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { LaunchStrategy } from "./types";

export type CockpitConfig = {
  workspaces: { path: string; label?: string }[];
  launch: { prefer?: LaunchStrategy };
  herdr: { poll: boolean; pollMs: number };
};
export type UiState = { lastWorkspace?: string; agentOpen?: boolean };

export const DEFAULT_CONFIG: CockpitConfig = { workspaces: [], launch: {}, herdr: { poll: true, pollMs: 3000 } };
const STRATEGIES: LaunchStrategy[] = ["herdr", "tmux", "zellij", "ghostty", "suspend"];

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ORG_OS_COCKPIT_HOME) return env.ORG_OS_COCKPIT_HOME;
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "org-os", "cockpit");
}

export function mergeConfig(raw: unknown): { config: CockpitConfig; errors: string[] } {
  const errors: string[] = [];
  const config: CockpitConfig = structuredClone(DEFAULT_CONFIG);
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  if (Array.isArray(obj.workspaces)) {
    obj.workspaces.forEach((w: any, i: number) => {
      if (w && typeof w.path === "string" && isAbsolute(w.path)) {
        config.workspaces.push(typeof w.label === "string" ? { path: w.path, label: w.label } : { path: w.path });
      } else {
        errors.push(`config.json workspaces[${i}]: needs an absolute "path"`);
      }
    });
  }
  if (obj.launch?.prefer !== undefined) {
    if (STRATEGIES.includes(obj.launch.prefer)) config.launch.prefer = obj.launch.prefer;
    else errors.push(`config.json launch.prefer: must be one of ${STRATEGIES.join(", ")}`);
  }
  if (obj.herdr && typeof obj.herdr === "object") {
    if (typeof obj.herdr.poll === "boolean") config.herdr.poll = obj.herdr.poll;
    if (typeof obj.herdr.pollMs === "number") config.herdr.pollMs = Math.max(1000, obj.herdr.pollMs);
  }
  return { config, errors };
}

export function loadConfig(dir: string): { config: CockpitConfig; errors: string[] } {
  let text: string;
  try {
    text = readFileSync(join(dir, "config.json"), "utf8");
  } catch {
    return { config: structuredClone(DEFAULT_CONFIG), errors: [] };
  }
  try {
    return mergeConfig(JSON.parse(text));
  } catch (e) {
    return { config: structuredClone(DEFAULT_CONFIG), errors: [`config.json: ${(e as Error).message}`] };
  }
}

export function loadUiState(dir: string): UiState {
  try {
    const raw = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    const out: UiState = {};
    if (typeof raw.lastWorkspace === "string") out.lastWorkspace = raw.lastWorkspace;
    if (typeof raw.agentOpen === "boolean") out.agentOpen = raw.agentOpen;
    return out;
  } catch {
    return {};
  }
}

export function saveUiState(dir: string, state: UiState): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `state.json.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
    renameSync(tmp, join(dir, "state.json"));
    return true;
  } catch {
    return false;
  }
}
```
(The `herdr.pollMs: 50` input in the test is clamped to 1000 — that clamp is intentional.)

`packages/tui/src/core/util.ts`:
```ts
import { resolve, sep } from "node:path";

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "ws";
}

export function containsPath(root: string, p: string): boolean {
  const r = resolve(root);
  const q = resolve(p);
  return q === r || q.startsWith(r.endsWith(sep) ? r : r + sep);
}

export function firstLine(s: string, max = 80): string {
  const line = String(s ?? "").split("\n")[0].trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}
```

`packages/tui/src/core/args.ts`:
```ts
export type CliArgs = { workspace?: string; page?: string; snapshot: boolean; width: number; height: number; framework?: string };

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { snapshot: false, width: 160, height: 45 };
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : d;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--snapshot") out.snapshot = true;
    else if (a === "--workspace") out.workspace = argv[++i];
    else if (a === "--page") out.page = argv[++i];
    else if (a === "--framework") out.framework = argv[++i];
    else if (a === "--width") out.width = num(argv[++i], 160);
    else if (a === "--height") out.height = num(argv[++i], 45);
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS.** `npm test --prefix packages/tui`

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/core packages/tui/test/core
git commit -m "feat(tui): core types, event bus, process runner, config and args" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: fleet discovery

**Files:**
- Create: `packages/tui/src/core/fleet.ts`
- Test: `packages/tui/test/core/fleet.test.ts`, helper `packages/tui/test/helpers/fixtures.ts`

**Interfaces:**
- Consumes: `harness-kit/workspace.mjs` (`findEnclosingWorkspace`, `isWorkspace`, `readWorkspaceName`), `slug`, `containsPath`, `CockpitConfig`.
- Produces: `readInstanceRegistry(frameworkRoot) → { instances: {id, name?, local_path?, drift?}[]; error?: string }`, `discoverFleet(frameworkRoot, { workspaces }) → { fleet: WorkspaceInfo[]; errors: string[] }`, `pickActive(fleet, { invokedFrom, flag?, remembered? }) → string | null`.
- Produces (test helper, reused by Tasks 7, 8, 14, 18): `makeFleetFixture() → { hub: string; fw: string; instA: string }` — a temp tree `hub/` (workspace "Hub") ⊃ `hub/libs/fw/` (workspace "Framework", `data/instances.yaml` listing `inst-a` → `../inst-a` with 2 drift entries and `ghost` → `../ghost` (missing)) ⊃ `hub/libs/inst-a/` (workspace "Instance A" with a HEARTBEAT, DECISIONS, memory log and `.claude/commands/close.md`).

- [ ] **Step 1: Test helper** — `packages/tui/test/helpers/fixtures.ts`

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function writeTree(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
}

export function makeWorkspace(root: string, name: string, extra: Record<string, string> = {}) {
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "memory"), { recursive: true });
  writeTree(root, {
    "package.json": JSON.stringify({ name, scripts: { initialize: "node -e 1", "validate:schemas": "node -e 1" } }),
    "federation.yaml": `identity:\n  name: "${name}"\n  type: "LocalNode"\n`,
    ...extra,
  });
}

export function makeFleetFixture() {
  const hub = mkdtempSync(join(tmpdir(), "ck-hub-"));
  makeWorkspace(hub, "Hub");
  const fw = join(hub, "libs", "fw");
  makeWorkspace(fw, "Framework", {
    "data/instances.yaml": [
      "instances:",
      '  - id: "inst-a"',
      '    name: "Instance A"',
      '    local_path: "../inst-a"',
      "    drift: [a, b]",
      '  - id: "ghost"',
      '    local_path: "../ghost"',
      '  - id: "no-path"',
      "",
    ].join("\n"),
    ".claude/commands/close.md": "---\ndescription: close\n---\nClose the session for $ARGUMENTS now.\n",
  });
  const instA = join(hub, "libs", "inst-a");
  makeWorkspace(instA, "Instance A", {
    "HEARTBEAT.md": "# HB\n\n## Funding\n- [ ] Grant report (due: 2020-01-01)\n- [ ] Budget\n\n## Tech\n- [x] Done thing\n",
    "DECISIONS.md": "# D\n\n## 2026-09-20 · Pick the cockpit\n\n- **Status:** active\n\nBecause.\n",
    "memory/2026-09-24.md": "# 2026-09-24 — Day\n\n**Focus:** fixtures\n",
    "data/projects.yaml": 'projects:\n  - title: "Cockpit"\n    status: "Develop"\n    lead: "luiz"\n',
  });
  return { hub, fw, instA };
}
```

- [ ] **Step 2: Failing test** — `packages/tui/test/core/fleet.test.ts`

```ts
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverFleet, pickActive, readInstanceRegistry } from "../../src/core/fleet";
import { makeFleetFixture, makeWorkspace } from "../helpers/fixtures";

test("discovers hub, framework, instances and extras", () => {
  const { hub, fw, instA } = makeFleetFixture();
  const extra = mkdtempSync(join(tmpdir(), "ck-extra-"));
  makeWorkspace(extra, "Extra");
  const { fleet, errors } = discoverFleet(fw, { workspaces: [{ path: extra, label: "Side" }, { path: hub }] });
  expect(errors).toEqual([]);
  expect(fleet.map((w) => [w.id, w.kind, w.label, w.exists, w.drift])).toEqual([
    ["hub", "hub", "Hub", true, 0],
    ["fw", "framework", "Framework", true, 0],
    ["inst-a", "instance", "Instance A", true, 2],
    ["ghost", "instance", "ghost", false, 0],
    ["side", "extra", "Side", true, 0],
  ]);
  expect(fleet[2].root).toBe(instA);
});

test("framework without a hub or registry still yields itself", () => {
  const lone = mkdtempSync(join(tmpdir(), "ck-lone-"));
  makeWorkspace(lone, "Lone");
  const { fleet } = discoverFleet(lone, { workspaces: [] });
  expect(fleet.map((w) => w.kind)).toEqual(["framework"]);
});

test("a broken registry is reported, not thrown", () => {
  const lone = mkdtempSync(join(tmpdir(), "ck-bad-"));
  makeWorkspace(lone, "Lone", { "data/instances.yaml": "instances: [unclosed" });
  expect(readInstanceRegistry(lone).error).toContain("data/instances.yaml");
  expect(discoverFleet(lone, { workspaces: [] }).errors.length).toBe(1);
});

test("pickActive: flag, then containing path (longest), then remembered, then hub", () => {
  const { hub, fw, instA } = makeFleetFixture();
  const { fleet } = discoverFleet(fw, { workspaces: [] });
  expect(pickActive(fleet, { invokedFrom: "/elsewhere", flag: instA })).toBe("inst-a");
  expect(pickActive(fleet, { invokedFrom: "/elsewhere", flag: "fw" })).toBe("fw");
  expect(pickActive(fleet, { invokedFrom: join(fw, "packages") })).toBe("fw");
  expect(pickActive(fleet, { invokedFrom: hub })).toBe("hub");
  expect(pickActive(fleet, { invokedFrom: "/elsewhere", remembered: "inst-a" })).toBe("inst-a");
  expect(pickActive(fleet, { invokedFrom: "/elsewhere", remembered: "gone" })).toBe("hub");
  expect(pickActive([], { invokedFrom: "/" })).toBe(null);
});
```

- [ ] **Step 3: Run — expect failure.** `npm test --prefix packages/tui`

- [ ] **Step 4: Implement** — `packages/tui/src/core/fleet.ts`

```ts
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import yaml from "js-yaml";
// @ts-ignore — plain .mjs without types
import { findEnclosingWorkspace, isWorkspace, readWorkspaceName } from "../../../harness-kit/workspace.mjs";
import type { CockpitConfig } from "./config";
import type { WorkspaceInfo, WorkspaceKind } from "./types";
import { containsPath, slug } from "./util";

export type InstanceEntry = { id: string; name?: string; local_path?: string; drift?: unknown[] };

export function readInstanceRegistry(frameworkRoot: string): { instances: InstanceEntry[]; error?: string } {
  let text: string;
  try {
    text = readFileSync(join(frameworkRoot, "data", "instances.yaml"), "utf8");
  } catch {
    return { instances: [] };
  }
  try {
    const data = yaml.load(text) as { instances?: InstanceEntry[] } | null;
    return { instances: Array.isArray(data?.instances) ? data!.instances : [] };
  } catch (e) {
    return { instances: [], error: `data/instances.yaml: ${String((e as Error).message).split("\n")[0]}` };
  }
}

export function discoverFleet(
  frameworkRoot: string,
  config: Pick<CockpitConfig, "workspaces">,
): { fleet: WorkspaceInfo[]; errors: string[] } {
  const fleet: WorkspaceInfo[] = [];
  const errors: string[] = [];
  const roots = new Set<string>();
  const ids = new Set<string>();
  const add = (root: string, kind: WorkspaceKind, label: string, idHint: string, drift = 0) => {
    const abs = resolve(root);
    if (roots.has(abs)) return;
    roots.add(abs);
    const base = slug(idHint);
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    fleet.push({ id, label, root: abs, kind, exists: isWorkspace(abs), drift });
  };

  const hub = findEnclosingWorkspace(frameworkRoot);
  if (hub) add(hub.root, "hub", hub.name, "hub");
  add(frameworkRoot, "framework", readWorkspaceName(frameworkRoot), basename(resolve(frameworkRoot)));

  const registry = readInstanceRegistry(frameworkRoot);
  if (registry.error) errors.push(registry.error);
  for (const inst of registry.instances) {
    if (!inst?.id || !inst.local_path) continue;
    add(resolve(frameworkRoot, inst.local_path), "instance", inst.name || inst.id, inst.id, Array.isArray(inst.drift) ? inst.drift.length : 0);
  }
  for (const w of config.workspaces ?? []) add(w.path, "extra", w.label || basename(w.path), w.label || basename(w.path));
  return { fleet, errors };
}

export function pickActive(
  fleet: WorkspaceInfo[],
  opts: { invokedFrom: string; flag?: string; remembered?: string },
): string | null {
  if (opts.flag) {
    const byFlag = fleet.find((w) => w.id === opts.flag || w.root === resolve(opts.flag!));
    if (byFlag) return byFlag.id;
  }
  const containing = fleet
    .filter((w) => containsPath(w.root, opts.invokedFrom))
    .sort((a, b) => b.root.length - a.root.length)[0];
  if (containing) return containing.id;
  if (opts.remembered && fleet.some((w) => w.id === opts.remembered)) return opts.remembered;
  return (fleet.find((w) => w.kind === "hub") ?? fleet.find((w) => w.kind === "framework") ?? fleet[0])?.id ?? null;
}
```
(The `--flag` path check uses `resolve(opts.flag!)` only as a comparison — a relative flag is resolved against the process cwd, which is fine for a CLI flag.)

- [ ] **Step 5: Run — expect PASS**, then commit.

```bash
npm test --prefix packages/tui
git add packages/tui/src/core/fleet.ts packages/tui/test
git commit -m "feat(tui): fleet discovery from hub, framework registry and config" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: workspace loading, git status, summaries, watcher

**Files:**
- Create: `packages/tui/src/core/workspace.ts`
- Test: `packages/tui/test/core/workspace.test.ts`

**Interfaces:**
- Consumes: `org-state` (`readWorkspaceFiles`, `WATCH_PATHS`, `loadWorkspaceState`, `yamlErrors`), `Runner`, types.
- Produces:
  - `type LoadedWorkspace = { info: WorkspaceInfo; files: Record<string, string>; state: any | null; errors: string[]; git: GitStatus | null; loadedAt: Date }`
  - `parseGitStatus(porcelain) → Omit<GitStatus, "lastCommit">`
  - `readGitStatus(root, run?) → Promise<GitStatus | null>` (read-only, `GIT_OPTIONAL_LOCKS=0`, 5 s timeouts)
  - `loadWorkspace(info, { now?, run?, git? }) → Promise<LoadedWorkspace>` (`git: false` skips git)
  - `summarize(ws) → WorkspaceSummary`
  - `watchWorkspace(root, onChange, { debounceMs?, watch? }) → () => void`

- [ ] **Step 1: Failing test** — `packages/tui/test/core/workspace.test.ts`

```ts
import { test, expect } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorkspace, parseGitStatus, readGitStatus, summarize, watchWorkspace } from "../../src/core/workspace";
import { discoverFleet } from "../../src/core/fleet";
import { makeFleetFixture } from "../helpers/fixtures";
import type { Runner } from "../../src/core/proc";

const NOW = new Date("2026-09-25T12:00:00Z");

test("parseGitStatus", () => {
  expect(parseGitStatus("## main...origin/main [ahead 2, behind 1]\n M a.md\n?? b.md\n")).toEqual({ branch: "main", dirty: true, ahead: 2, behind: 1 });
  expect(parseGitStatus("## feat/x\n")).toEqual({ branch: "feat/x", dirty: false, ahead: 0, behind: 0 });
  expect(parseGitStatus("## No commits yet on main\n").branch).toBe("main");
  expect(parseGitStatus("## HEAD (no branch)\n").branch).toBe("HEAD");
});

test("readGitStatus uses read-only git with optional locks off", async () => {
  const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
  const run: Runner = async (_cmd, args, opts) => {
    calls.push({ args, env: opts?.env });
    if (args.includes("status")) return { code: 0, stdout: "## main\n M x\n", stderr: "" };
    return { code: 0, stdout: "3 hours ago\n", stderr: "" };
  };
  expect(await readGitStatus("/r", run)).toEqual({ branch: "main", dirty: true, ahead: 0, behind: 0, lastCommit: "3 hours ago" });
  expect(calls[0].args).toEqual(["-C", "/r", "status", "--porcelain=v1", "--branch"]);
  expect(calls[0].env?.GIT_OPTIONAL_LOCKS).toBe("0");
  const failing: Runner = async () => ({ code: 128, stdout: "", stderr: "not a repo" });
  expect(await readGitStatus("/r", failing)).toBe(null);
});

test("loadWorkspace + summarize on a real fixture", async () => {
  const { fw } = makeFleetFixture();
  const { fleet } = discoverFleet(fw, { workspaces: [] });
  const inst = fleet.find((w) => w.id === "inst-a")!;
  const ws = await loadWorkspace(inst, { now: NOW, git: false });
  expect(ws.errors).toEqual([]);
  expect(ws.state.identity.name).toBe("Instance A");
  const s = summarize(ws);
  expect(s).toMatchObject({ id: "inst-a", name: "Instance A", type: "LocalNode", openTasks: 2, lastMemory: "2026-09-24" });
  expect(s.urgentTasks).toBe(2);
});

test("a missing workspace loads as an error, not a throw", async () => {
  const { fw } = makeFleetFixture();
  const ghost = discoverFleet(fw, { workspaces: [] }).fleet.find((w) => w.id === "ghost")!;
  const ws = await loadWorkspace(ghost, { now: NOW, git: false });
  expect(ws.state).toBe(null);
  expect(ws.errors[0]).toContain("missing");
  expect(summarize(ws)).toMatchObject({ openTasks: 0, name: "ghost" });
});

test("watcher debounces changes", async () => {
  const { instA } = makeFleetFixture();
  let calls = 0;
  const stop = watchWorkspace(instA, () => calls++, { debounceMs: 200 });
  writeFileSync(join(instA, "HEARTBEAT.md"), "# changed\n");
  writeFileSync(join(instA, "memory", "2026-09-25.md"), "# new\n");
  await new Promise((r) => setTimeout(r, 800));
  stop();
  expect(calls).toBe(1);
});
```

- [ ] **Step 2: Run — expect failure.** `npm test --prefix packages/tui`

- [ ] **Step 3: Implement** — `packages/tui/src/core/workspace.ts`

```ts
import { existsSync, watch as fsWatch, type FSWatcher } from "node:fs";
import { join } from "node:path";
// @ts-ignore — plain .mjs without types
import { readWorkspaceFiles, WATCH_PATHS, loadWorkspaceState, yamlErrors } from "../../../org-state/index.mjs";
import { run as defaultRun, type Runner } from "./proc";
import type { GitStatus, WorkspaceInfo, WorkspaceSummary } from "./types";

export type LoadedWorkspace = {
  info: WorkspaceInfo;
  files: Record<string, string>;
  state: any | null;
  errors: string[];
  git: GitStatus | null;
  loadedAt: Date;
};

export function parseGitStatus(porcelain: string): Omit<GitStatus, "lastCommit"> {
  const lines = porcelain.split("\n").filter((l) => l.length > 0);
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  if (lines[0]?.startsWith("## ")) {
    const head = lines.shift()!.slice(3);
    if (head.startsWith("HEAD (no branch)")) branch = "HEAD";
    else if (head.startsWith("No commits yet on ")) branch = head.slice("No commits yet on ".length).trim();
    else branch = head.split("...")[0].split(" ")[0] || null;
    const a = head.match(/ahead (\d+)/);
    const b = head.match(/behind (\d+)/);
    ahead = a ? Number(a[1]) : 0;
    behind = b ? Number(b[1]) : 0;
  }
  return { branch, dirty: lines.length > 0, ahead, behind };
}

export async function readGitStatus(root: string, run: Runner = defaultRun): Promise<GitStatus | null> {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  const status = await run("git", ["-C", root, "status", "--porcelain=v1", "--branch"], { env, timeoutMs: 5000 });
  if (status.code !== 0) return null;
  const log = await run("git", ["-C", root, "log", "-1", "--format=%cr"], { env, timeoutMs: 5000 });
  return { ...parseGitStatus(status.stdout), lastCommit: log.code === 0 ? log.stdout.trim() || null : null };
}

export async function loadWorkspace(
  info: WorkspaceInfo,
  { now = new Date(), run = defaultRun, git = true }: { now?: Date; run?: Runner; git?: boolean } = {},
): Promise<LoadedWorkspace> {
  if (!info.exists) {
    return { info, files: {}, state: null, errors: [`workspace path missing or not an org-os workspace: ${info.root}`], git: null, loadedAt: now };
  }
  const { files, errors } = readWorkspaceFiles(info.root);
  let state: any = null;
  const all = [...errors, ...yamlErrors(files)];
  try {
    state = loadWorkspaceState(files, { now });
  } catch (e) {
    all.push(`state: ${(e as Error).message}`);
  }
  return { info, files, state, errors: all, git: git ? await readGitStatus(info.root, run) : null, loadedAt: now };
}

export function summarize(ws: LoadedWorkspace): WorkspaceSummary {
  const s = ws.state;
  return {
    id: ws.info.id,
    name: s?.identity?.name || ws.info.label,
    type: s?.identity?.type ?? null,
    git: ws.git,
    openTasks: s?.heartbeat?.open ?? 0,
    urgentTasks: (s?.tasks?.critical?.length ?? 0) + (s?.tasks?.urgent?.length ?? 0),
    lastMemory: s?.memory?.[0]?.date ?? null,
    errors: ws.errors,
  };
}

export function watchWorkspace(
  root: string,
  onChange: () => void,
  { debounceMs = 300, watch = fsWatch }: { debounceMs?: number; watch?: typeof fsWatch } = {},
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  };
  const watchers: FSWatcher[] = [];
  for (const rel of WATCH_PATHS as string[]) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    try {
      watchers.push(watch(abs, fire));
    } catch {
      // unwatchable path: the operator can still press r
    }
  }
  return () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}
```
Urgent count note: the fixture's `(due: 2020-01-01)` task is overdue → `critical`; `Budget` sits under a `Funding` heading → `urgent` (page-core rule). Hence `urgentTasks === 2`.

- [ ] **Step 4: Run — expect PASS**, then commit.

```bash
npm test --prefix packages/tui
git add packages/tui/src/core/workspace.ts packages/tui/test/core/workspace.test.ts
git commit -m "feat(tui): workspace loading, read-only git status, summaries and watcher" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: markdown lines and page resolvers

**Files:**
- Create: `packages/tui/src/core/markdown.ts`, `packages/tui/src/core/pages/{helpers,index,fleet,workspace-pages,this-week}.ts`
- Test: `packages/tui/test/core/markdown.test.ts`, `packages/tui/test/core/pages.test.ts`

**Interfaces:**
- Consumes: `LoadedWorkspace`, `summarize`, types, `slug`.
- Produces:
  - `markdown.ts`: `type MdLine = { kind: "h1"|"h2"|"h3"|"bullet"|"code"|"quote"|"rule"|"body"|"blank"; text: string; depth?: number }`, `markdownToLines(text) → MdLine[]`, `inline(s) → string`.
  - `pages/index.ts`: `type FleetRow = { info: WorkspaceInfo; summary: WorkspaceSummary | null; agents: HerdrAgent[] }`, `type PageContext = { ws: LoadedWorkspace | null; fleet: FleetRow[]; now: Date; hints: string[] }`, `PAGE_INDEX: { page: string; label: string }[]`, `resolvePage(ref, ctx) → PageData`, `sourceFor(ref, ws) → string | null` (absolute path of the page's primary source file).

- [ ] **Step 1: Failing markdown test** — `packages/tui/test/core/markdown.test.ts`

```ts
import { test, expect } from "bun:test";
import { markdownToLines, inline } from "../../src/core/markdown";

test("block structure", () => {
  const lines = markdownToLines("# Title\n\nSome **bold** `code` [link](http://x)\n\n\n- one\n  - two\n> quote\n---\n```\nraw *x*\n```\n1. first");
  expect(lines.map((l) => [l.kind, l.text, l.depth ?? null])).toEqual([
    ["h1", "Title", null],
    ["blank", "", null],
    ["body", "Some bold code link", null],
    ["blank", "", null],
    ["bullet", "one", 0],
    ["bullet", "two", 1],
    ["quote", "quote", null],
    ["rule", "", null],
    ["code", "raw *x*", null],
    ["body", "1. first", null],
  ]);
});

test("inline strips emphasis and links", () => {
  expect(inline("a *b* **c** `d` [e](f)")).toBe("a b c d e");
});
```

- [ ] **Step 2: Failing pages test** — `packages/tui/test/core/pages.test.ts`

```ts
import { test, expect } from "bun:test";
import { discoverFleet } from "../../src/core/fleet";
import { loadWorkspace, summarize } from "../../src/core/workspace";
import { resolvePage, PAGE_INDEX, sourceFor, type PageContext } from "../../src/core/pages";
import { makeFleetFixture } from "../helpers/fixtures";

const NOW = new Date("2026-09-25T12:00:00Z");

async function ctxFor(id: string): Promise<PageContext> {
  const { fw } = makeFleetFixture();
  const { fleet } = discoverFleet(fw, { workspaces: [] });
  const loaded = await Promise.all(fleet.map((w) => loadWorkspace(w, { now: NOW, git: false })));
  const ws = loaded.find((l) => l.info.id === id)!;
  return {
    ws,
    fleet: loaded.map((l) => ({ info: l.info, summary: summarize(l), agents: l.info.id === "inst-a" ? [{ paneId: "w1:p1", workspaceId: "w1", name: "a-pi", agent: "pi", status: "working", cwd: l.info.root, title: null }] : [] })),
    now: NOW,
    hints: ["herdr integration for pi is not installed"],
  };
}

test("every indexed page resolves without errors on a full workspace", async () => {
  const ctx = await ctxFor("inst-a");
  for (const { page } of PAGE_INDEX) {
    const p = resolvePage({ page }, ctx);
    expect(p.title.length).toBeGreaterThan(0);
    expect(p.blocks.length).toBeGreaterThan(0);
  }
});

test("fleet page rows target dashboards and show agents, missing rows and hints", async () => {
  const ctx = await ctxFor("inst-a");
  const p = resolvePage({ page: "fleet" }, ctx);
  const table = p.blocks.find((b) => b.kind === "table")!;
  if (table.kind !== "table") throw new Error("expected table");
  const inst = table.rows.find((r) => r.key === "inst-a")!;
  expect(inst.target).toEqual({ page: "dashboard", workspace: "inst-a" });
  expect(inst.cells.join(" ")).toContain("pi:working");
  expect(table.rows.find((r) => r.key === "ghost")!.cells[0]).toContain("missing");
  expect(p.blocks.some((b) => b.kind === "notice" && b.text.includes("herdr integration"))).toBe(true);
  const agents = p.blocks.find((b) => b.kind === "list" && b.heading === "herdr agents");
  expect(agents && agents.kind === "list" && agents.items[0].target).toEqual({ page: "herdr-agent", id: "w1:p1" });
});

test("dashboard, tasks, decisions, memory drill-downs", async () => {
  const ctx = await ctxFor("inst-a");
  const dash = resolvePage({ page: "dashboard" }, ctx);
  expect(dash.title).toBe("Instance A");
  const urgent = dash.blocks.find((b) => b.kind === "list" && b.heading === "Urgent");
  expect(urgent && urgent.kind === "list" && urgent.items.length).toBe(2);
  const projects = dash.blocks.find((b) => b.kind === "table" && b.heading === "Projects");
  expect(projects && projects.kind === "table" && projects.rows[0].target).toEqual({ page: "project", id: "cockpit" });
  expect(resolvePage({ page: "project", id: "cockpit" }, ctx).title).toBe("Cockpit");
  const decisions = resolvePage({ page: "decisions" }, ctx);
  const drow = decisions.blocks[0];
  expect(drow.kind === "table" && drow.rows[0].target).toEqual({ page: "decision", id: "1" });
  const d1 = resolvePage({ page: "decision", id: "1" }, ctx);
  expect(d1.blocks[0]).toMatchObject({ kind: "markdown" });
  expect(resolvePage({ page: "memory", id: "2026-09-24" }, ctx).blocks[0]).toMatchObject({ kind: "markdown" });
  expect(sourceFor({ page: "tasks" }, ctx.ws)).toEndWith("HEARTBEAT.md");
  expect(sourceFor({ page: "memory", id: "2026-09-24" }, ctx.ws)).toEndWith("memory/2026-09-24.md");
});

test("empty or missing workspaces render notices, unknown pages and ids too", async () => {
  const ctx = await ctxFor("fw");
  for (const page of ["tasks", "decisions", "memory", "plans", "this-week"]) {
    const p = resolvePage({ page }, ctx);
    expect(p.blocks.some((b) => b.kind === "notice")).toBe(true);
  }
  const ghost = await ctxFor("ghost");
  expect(resolvePage({ page: "dashboard" }, ghost).blocks[0]).toMatchObject({ kind: "notice", level: "warn" });
  expect(resolvePage({ page: "nope" }, ctx).blocks[0]).toMatchObject({ kind: "notice", level: "error" });
  expect(resolvePage({ page: "project", id: "nope" }, ctx).blocks[0]).toMatchObject({ kind: "notice" });
});
```

- [ ] **Step 3: Run — expect failures.** `npm test --prefix packages/tui`

- [ ] **Step 4: Implement `markdown.ts`**

```ts
export type MdLine = {
  kind: "h1" | "h2" | "h3" | "bullet" | "code" | "quote" | "rule" | "body" | "blank";
  text: string;
  depth?: number;
};

export function inline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|[^*\w])\*([^*]+)\*/g, "$1$2");
}

// A deliberately small renderer: OpenTUI's <markdown> needs a tree-sitter
// style to draw anything (VERIFIED.md T1), and pages only need structure.
export function markdownToLines(text: string): MdLine[] {
  const out: MdLine[] = [];
  let inCode = false;
  for (const raw of String(text ?? "").replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(raw)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push({ kind: "code", text: raw });
      continue;
    }
    const line = raw.trimEnd();
    if (!line.trim()) {
      if (out.length && out[out.length - 1].kind !== "blank") out.push({ kind: "blank", text: "" });
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      const level = m[1].length;
      out.push({ kind: level === 1 ? "h1" : level === 2 ? "h2" : "h3", text: inline(m[2]) });
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push({ kind: "rule", text: "" });
    } else if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) {
      out.push({ kind: "bullet", text: inline(m[2]), depth: Math.floor(m[1].length / 2) });
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      out.push({ kind: "quote", text: inline(m[1]) });
    } else {
      out.push({ kind: "body", text: inline(line.trim()) });
    }
  }
  return out;
}
```

- [ ] **Step 5: Implement the pages**

`packages/tui/src/core/pages/helpers.ts`:
```ts
import type { Block, HerdrAgent, PageData, PageRef, WorkspaceInfo, WorkspaceSummary } from "../types";
import type { LoadedWorkspace } from "../workspace";

export type FleetRow = { info: WorkspaceInfo; summary: WorkspaceSummary | null; agents: HerdrAgent[] };
export type PageContext = { ws: LoadedWorkspace | null; fleet: FleetRow[]; now: Date; hints: string[] };
export type Resolver = (ref: PageRef, ctx: PageContext) => PageData;

export function makePage(ref: PageRef, title: string, blocks: Block[], extra: Partial<PageData> = {}): PageData {
  return { ref, title, blocks, actions: [], sources: [], errors: [], ...extra };
}

export function notice(level: "info" | "warn" | "error", text: string): Block {
  return { kind: "notice", level, text };
}
```

`packages/tui/src/core/pages/index.ts`:
```ts
import { join } from "node:path";
import type { PageData, PageRef } from "../types";
import type { LoadedWorkspace } from "../workspace";
import { fleetPage } from "./fleet";
import { workspacePages } from "./workspace-pages";
import { thisWeekPage } from "./this-week";
import { makePage, notice, type PageContext, type Resolver } from "./helpers";

export { makePage, notice } from "./helpers";
export type { FleetRow, PageContext, Resolver } from "./helpers";

export const PAGE_INDEX: { page: string; label: string }[] = [
  { page: "fleet", label: "Fleet" },
  { page: "dashboard", label: "Dashboard" },
  { page: "tasks", label: "Tasks" },
  { page: "projects", label: "Projects" },
  { page: "plans", label: "Plans" },
  { page: "decisions", label: "Decisions" },
  { page: "memory", label: "Memory" },
  { page: "this-week", label: "This week" },
];

const RESOLVERS: Record<string, Resolver> = {
  fleet: fleetPage,
  "this-week": thisWeekPage,
  ...workspacePages,
};

export function resolvePage(ref: PageRef, ctx: PageContext): PageData {
  const resolver = RESOLVERS[ref.page];
  if (!resolver) return makePage(ref, "Unknown page", [notice("error", `No page called "${ref.page}". Open the palette (ctrl+p) for the list.`)]);
  try {
    return resolver(ref, ctx);
  } catch (e) {
    return makePage(ref, ref.page, [notice("error", `This page failed to render: ${(e as Error).message}`)]);
  }
}

const SOURCES: Record<string, (ref: PageRef, ws: LoadedWorkspace) => string | null> = {
  dashboard: () => "HEARTBEAT.md",
  tasks: () => "HEARTBEAT.md",
  projects: () => "data/projects.yaml",
  project: () => "data/projects.yaml",
  decisions: () => "DECISIONS.md",
  decision: () => "DECISIONS.md",
  plans: (_r, ws) => ws.state?.queue?.path ?? null,
  memory: (r) => (r.id ? `memory/${r.id}.md` : null),
  "this-week": () => "data/events.yaml",
};

export function sourceFor(ref: PageRef, ws: LoadedWorkspace | null): string | null {
  if (!ws) return null;
  const rel = SOURCES[ref.page]?.(ref, ws) ?? null;
  return rel ? join(ws.info.root, rel) : null;
}
```

`packages/tui/src/core/pages/fleet.ts`:
```ts
import type { PageData, PageRef } from "../types";
import { makePage, notice, type PageContext } from "./helpers";

export function fleetPage(ref: PageRef, ctx: PageContext): PageData {
  const rows = ctx.fleet.map(({ info, summary, agents }) => {
    const git = summary?.git;
    return {
      key: info.id,
      cells: [
        info.exists ? summary?.name ?? info.label : `${info.label} (missing)`,
        info.kind,
        git ? `${git.branch ?? "?"}${git.dirty ? " ●" : ""}` : "—",
        summary ? `${summary.openTasks}/${summary.urgentTasks}` : "—",
        summary?.lastMemory ?? "—",
        agents.length ? agents.map((a) => `${a.agent ?? "agent"}:${a.status}`).join(" ") : "—",
      ],
      target: { page: "dashboard", workspace: info.id },
    };
  });
  const blocks: PageData["blocks"] = [
    { kind: "table", columns: ["Workspace", "Kind", "Branch", "Open/Urgent", "Memory", "Agents"], rows },
  ];
  const missing = ctx.fleet.filter((r) => !r.info.exists);
  if (missing.length) blocks.push(notice("warn", `${missing.length} workspace(s) not found on disk: ${missing.map((m) => m.info.label).join(", ")}`));
  const live = ctx.fleet.flatMap((r) => r.agents.map((a) => ({ a, ws: r.info.label })));
  if (live.length) {
    blocks.push({
      kind: "list",
      heading: "herdr agents",
      items: live.map(({ a, ws }) => ({ key: a.paneId, label: `${a.name ?? a.agent ?? "agent"} · ${a.status}`, detail: ws, badge: a.agent ?? undefined, target: { page: "herdr-agent", id: a.paneId } })),
    });
  }
  const drifting = ctx.fleet.filter((r) => r.info.drift > 0);
  if (drifting.length) blocks.push(notice("info", `Drift reported for ${drifting.map((d) => `${d.info.label} (${d.info.drift})`).join(", ")}`));
  for (const hint of ctx.hints) blocks.push(notice("info", hint));
  return makePage(ref, "Fleet", blocks, { subtitle: `${ctx.fleet.length} workspaces` });
}
```

`packages/tui/src/core/pages/workspace-pages.ts`:
```ts
import { slug } from "../util";
import type { Block, PageData, PageRef } from "../types";
import { makePage, notice, type PageContext, type Resolver } from "./helpers";

function needState(ref: PageRef, ctx: PageContext): PageData | null {
  if (!ctx.ws) return makePage(ref, ref.page, [notice("warn", "No workspace selected.")]);
  if (!ctx.ws.state) return makePage(ref, ctx.ws.info.label, [notice("warn", ctx.ws.errors[0] ?? "Workspace not loaded.")]);
  return null;
}

function errorBlocks(ctx: PageContext): Block[] {
  return (ctx.ws?.errors ?? []).map((e) => notice("warn", e));
}

const taskBadge = (t: any) => (t.daysLeft === null || t.daysLeft === undefined ? undefined : t.daysLeft <= 0 ? "overdue" : `${t.daysLeft}d`);

const dashboard: Resolver = (ref, ctx) => {
  const early = needState(ref, ctx);
  if (early) return early;
  const s = ctx.ws!.state;
  const git = ctx.ws!.git;
  const urgent = [...s.tasks.critical, ...s.tasks.urgent];
  const blocks: Block[] = [
    ...errorBlocks(ctx),
    {
      kind: "kv",
      pairs: [
        ["Type", s.identity.type ?? "—"],
        ["Branch", git ? `${git.branch ?? "?"}${git.dirty ? " (dirty)" : ""}${git.lastCommit ? ` · ${git.lastCommit}` : ""}` : "—"],
        ["Tasks", `${s.heartbeat.open} open · ${s.heartbeat.done} done`],
        ["Last memory", s.memory[0]?.date ?? "—"],
      ],
    },
    {
      kind: "list",
      heading: "Urgent",
      items: urgent.length
        ? urgent.map((t: any, i: number) => ({ key: `u${i}`, label: t.text, detail: t.category, badge: taskBadge(t), target: { page: "tasks" } }))
        : [{ key: "none", label: "Nothing urgent." }],
    },
    {
      kind: "list",
      heading: "This week",
      items: [...s.events.thisWeek, ...s.meetings.thisWeek].map((e: any, i: number) => ({ key: `w${i}`, label: e.title, detail: e.date, target: { page: "this-week" } })),
    },
    {
      kind: "table",
      heading: "Projects",
      columns: ["Project", "Stage", "Lead"],
      rows: s.projects.map((p: any) => ({ key: slug(p.name), cells: [p.name, p.stage, p.lead ?? "—"], target: { page: "project", id: slug(p.name) } })),
    },
    {
      kind: "list",
      heading: "Recent memory",
      items: s.memory.slice(0, 3).map((m: any) => ({ key: m.id, label: m.focus ?? m.title ?? m.id, detail: m.date, target: { page: "memory", id: m.id } })),
    },
  ];
  const fed = s.federation;
  if (fed?.peers?.length) blocks.push({ kind: "list", heading: "Federation", items: fed.peers.map((p: any, i: number) => ({ key: `f${i}`, label: p.name, detail: p.role ?? undefined })) });
  return makePage(ref, s.identity.name ?? ctx.ws!.info.label, blocks.filter((b) => b.kind !== "list" || b.items.length > 0), { subtitle: ctx.ws!.info.kind });
};

const tasks: Resolver = (ref, ctx) => {
  const early = needState(ref, ctx);
  if (early) return early;
  const hb = ctx.ws!.state.heartbeat;
  if (!hb.present) return makePage(ref, "Tasks", [notice("info", "No HEARTBEAT.md in this workspace.")]);
  const blocks: Block[] = hb.sections.map((sec: any) => ({
    kind: "list" as const,
    heading: sec.heading,
    items: sec.items.map((t: any, i: number) => ({ key: `${sec.heading}-${i}`, label: `${t.done ? "[x]" : "[ ]"} ${t.text}`, badge: t.due ?? undefined, detail: t.assignee ? `@${t.assignee}` : undefined })),
  }));
  if (!blocks.length) blocks.push(notice("info", "HEARTBEAT.md has no checkbox tasks."));
  return makePage(ref, "Tasks", blocks, { subtitle: `${hb.open} open · ${hb.done} done` });
};

const projects: Resolver = (ref, ctx) => {
  const early = needState(ref, ctx);
  if (early) return early;
  const list = ctx.ws!.state.projects;
  if (!list.length) return makePage(ref, "Projects", [notice("info", "No projects in data/projects.yaml.")]);
  return makePage(ref, "Projects", [
    { kind: "table", columns: ["Project", "Stage", "Lead", "Started", "Tasks"], rows: list.map((p: any) => ({ key: slug(p.name), cells: [p.name, p.stage, p.lead ?? "—", p.startDate ?? "—", String(p.taskCount ?? 0)], target: { page: "project", id: slug(p.name) } })) },
  ]);
};

const project: Resolver = (ref, ctx) => {
  const early = needState(ref, ctx);
  if (early) return early;
  const p = ctx.ws!.state.projects.find((x: any) => slug(x.name) === ref.id);
  if (!p) return makePage(ref, "Project", [notice("warn", `No project "${ref.id}".`)]);
  return makePage(ref, p.name, [
    { kind: "kv", pairs: [["Stage", p.stage], ["Lead", p.lead ?? "—"], ["Started", p.startDate ?? "—"], ["Members", (p.members ?? []).join(", ") || "—"], ["Open tasks", String(p.taskCount ?? 0)]] },
  ]);
};

const plans: Resolver = (ref, ctx) => {
  const early = needState(ref, ctx);
  if (early) return early;
  const q = ctx.ws!.state.queue;
  if (!q) return makePage(ref, "Plans", [notice("info", "No plan queue (docs/agent-plans/QUEUE.md or docs/plans/QUEUE.md).")]);
  return makePage(ref, "Plans", [{ kind: "markdown", text: q.text }], { subtitle: q.path });
};

const decisions: Resolver = (ref, ctx) => {
  const early = needState(ref, ctx);
  if (early) return early;
  const list = ctx.ws!.state.decisions;
  if (!list.length) return makePage(ref, "Decisions", [notice("info", "No dated decisions in DECISIONS.md.")]);
  return makePage(ref, "Decisions", [
    { kind: "table", columns: ["Date", "Decision", "Status"], rows: list.map((d: any) => ({ key: String(d.n), cells: [d.date, d.title, d.status ?? "—"], target: { page: "decision", id: String(d.n) } })) },
  ]);
};

const decision: Resolver = (ref, ctx) => {
  const early = needState(ref, ctx);
  if (early) return early;
  const d = ctx.ws!.state.decisions.find((x: any) => String(x.n) === ref.id);
  if (!d) return makePage(ref, "Decision", [notice("warn", `No decision #${ref.id}.`)]);
  return makePage(ref, d.title, [{ kind: "markdown", text: d.body }], { subtitle: `${d.date} · ${d.status ?? "no status"}` });
};

const memory: Resolver = (ref, ctx) => {
  const early = needState(ref, ctx);
  if (early) return early;
  const ws = ctx.ws!;
  if (ref.id) {
    const text = ws.files[`memory/${ref.id}.md`];
    if (!text) return makePage(ref, ref.id, [notice("warn", `No memory log ${ref.id}.`)]);
    return makePage(ref, ref.id, [{ kind: "markdown", text }]);
  }
  const list = ws.state.memory;
  if (!list.length) return makePage(ref, "Memory", [notice("info", "No dated logs in memory/.")]);
  return makePage(ref, "Memory", [
    { kind: "list", items: list.map((m: any) => ({ key: m.id, label: m.focus ?? m.title ?? m.id, detail: m.date, target: { page: "memory", id: m.id } })) },
  ]);
};

export const workspacePages: Record<string, Resolver> = { dashboard, tasks, projects, project, plans, decisions, decision, memory };
```

`packages/tui/src/core/pages/this-week.ts`:
```ts
import type { Block, PageData, PageRef } from "../types";
import { makePage, notice, type PageContext } from "./helpers";

export function thisWeekPage(ref: PageRef, ctx: PageContext): PageData {
  if (!ctx.ws?.state) return makePage(ref, "This week", [notice("warn", ctx.ws?.errors[0] ?? "No workspace selected.")]);
  const s = ctx.ws.state;
  const due = [...s.tasks.critical, ...s.tasks.urgent].filter((t: any) => t.due);
  const funding = s.funding.upcoming.filter((f: any) => f.daysLeft <= 30);
  const blocks: Block[] = [];
  const add = (heading: string, items: { key: string; label: string; detail?: string; badge?: string }[]) => {
    if (items.length) blocks.push({ kind: "list", heading, items });
  };
  add("Due soon", due.map((t: any, i: number) => ({ key: `d${i}`, label: t.text, detail: t.due, badge: t.daysLeft <= 0 ? "overdue" : `${t.daysLeft}d` })));
  add("Events", s.events.thisWeek.map((e: any, i: number) => ({ key: `e${i}`, label: e.title, detail: e.date })));
  add("Meetings", s.meetings.thisWeek.map((m: any, i: number) => ({ key: `m${i}`, label: m.title, detail: m.date })));
  add("Funding deadlines (30 days)", funding.map((f: any, i: number) => ({ key: `f${i}`, label: f.title, detail: f.deadline, badge: `${f.daysLeft}d` })));
  if (s.funding.error) blocks.push(notice("warn", s.funding.error));
  if (!blocks.length) blocks.push(notice("info", "Nothing dated in the next seven days."));
  return makePage(ref, "This week", blocks);
}
```
- [ ] **Step 6: Run — expect PASS**, then commit.

```bash
npm test --prefix packages/tui
git add packages/tui/src/core/markdown.ts packages/tui/src/core/pages packages/tui/test/core/markdown.test.ts packages/tui/test/core/pages.test.ts
git commit -m "feat(tui): page resolvers for fleet, dashboard, tasks, projects, plans, decisions, memory, this week" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: lifecycle command expansion and the action catalog

**Files:**
- Create: `packages/tui/src/core/commands.ts`, `packages/tui/src/core/actions.ts`
- Test: `packages/tui/test/core/commands.test.ts`, `packages/tui/test/core/actions.test.ts`

**Interfaces:**
- Consumes: `LIFECYCLE_COMMANDS`, `HOSTS`, `LoadedWorkspace`, `Runner`.
- Produces:
  - `commands.ts`: `stripFrontmatter(text) → string`, `expandCommand(root, name, args?, { fallbackRoot? }) → Promise<{ ok: true; text: string; source: string } | { ok: false; error: string }>`, `parseSlash(text) → { name: LifecycleCommand; args: string } | null`.
  - `actions.ts`: `SCRIPT_ALLOWLIST: string[]`, `type ActionDef` (union of `script | open | agent | launch`, each `{ id, label, kind, … }`), `workspaceScripts(files) → Record<string,string>`, `actionsFor(ws) → ActionDef[]`, `findAction(list, id) → ActionDef | undefined`, `runScript(root, script, run?) → Promise<{ ok: boolean; output: string }>`, `editorCommand(env, file) → { cmd, args }`.

- [ ] **Step 1: Failing tests**

`packages/tui/test/core/commands.test.ts`:
```ts
import { test, expect } from "bun:test";
import { expandCommand, parseSlash, stripFrontmatter } from "../../src/core/commands";
import { makeFleetFixture } from "../helpers/fixtures";

test("stripFrontmatter", () => {
  expect(stripFrontmatter("---\na: 1\n---\nbody")).toBe("body");
  expect(stripFrontmatter("no front")).toBe("no front");
});

test("expands from the workspace, falling back to the framework", async () => {
  const { fw, instA } = makeFleetFixture();
  const r = await expandCommand(instA, "close", "today", { fallbackRoot: fw });
  expect(r).toEqual({ ok: true, text: "Close the session for today now.", source: `${fw}/.claude/commands/close.md` });
  const missing = await expandCommand(instA, "sync", "", { fallbackRoot: fw });
  expect(missing.ok).toBe(false);
});

test("parseSlash only accepts lifecycle commands", () => {
  expect(parseSlash("/close wrap up")).toEqual({ name: "close", args: "wrap up" });
  expect(parseSlash("  /initialize ")).toEqual({ name: "initialize", args: "" });
  expect(parseSlash("/deploy now")).toBe(null);
  expect(parseSlash("close")).toBe(null);
});
```

`packages/tui/test/core/actions.test.ts`:
```ts
import { test, expect } from "bun:test";
import { actionsFor, findAction, runScript, editorCommand, SCRIPT_ALLOWLIST } from "../../src/core/actions";
import type { Runner } from "../../src/core/proc";

const ws: any = { info: { root: "/ws" }, files: { "package.json": JSON.stringify({ scripts: { initialize: "x", "validate:schemas": "y", deploy: "z" } }) } };

test("catalog: open, lifecycle, launch, and only allow-listed scripts that exist", () => {
  const list = actionsFor(ws);
  const ids = list.map((a) => a.id);
  expect(ids).toContain("open-source");
  expect(ids).toContain("agent:close");
  expect(ids).toContain("launch:claude:split");
  expect(ids).toContain("launch:opencode:tab");
  expect(ids).toContain("script:initialize");
  expect(ids).toContain("script:validate:schemas");
  expect(ids).not.toContain("script:deploy");
  expect(findAction(list, "agent:close")).toMatchObject({ kind: "agent", command: "close" });
  expect(actionsFor(null).some((a) => a.kind === "script")).toBe(false);
});

test("runScript refuses non-allow-listed scripts and runs allowed ones", async () => {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return { code: 0, stdout: "ok\n", stderr: "" };
  };
  expect(await runScript("/ws", "deploy", run)).toEqual({ ok: false, output: "script not allowed: deploy" });
  expect(await runScript("/ws", "initialize", run)).toEqual({ ok: true, output: "ok" });
  expect(calls).toEqual([["npm", "run", "--silent", "initialize"]]);
  expect(SCRIPT_ALLOWLIST).toContain("validate:structure");
});

test("editorCommand", () => {
  expect(editorCommand({ EDITOR: "nvim -p" }, "/f")).toEqual({ cmd: "nvim", args: ["-p", "/f"] });
  expect(editorCommand({ VISUAL: "code -w", EDITOR: "vi" }, "/f")).toEqual({ cmd: "code", args: ["-w", "/f"] });
  expect(editorCommand({}, "/f")).toEqual({ cmd: "vi", args: ["/f"] });
});
```

- [ ] **Step 2: Run — expect failure.** `npm test --prefix packages/tui`

- [ ] **Step 3: Implement**

`packages/tui/src/core/commands.ts`:
```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LIFECYCLE_COMMANDS, type LifecycleCommand } from "./types";

export function stripFrontmatter(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

// Lifecycle commands have one source: .claude/commands/<name>.md of the
// workspace (framework copy as fallback). The expanded body is sent to the
// agent as an ordinary prompt, so every backend gets the same protocol.
export async function expandCommand(
  root: string,
  name: LifecycleCommand,
  args = "",
  { fallbackRoot }: { fallbackRoot?: string } = {},
): Promise<{ ok: true; text: string; source: string } | { ok: false; error: string }> {
  for (const base of [root, fallbackRoot].filter(Boolean) as string[]) {
    const source = join(base, ".claude", "commands", `${name}.md`);
    try {
      const raw = await readFile(source, "utf8");
      return { ok: true, text: stripFrontmatter(raw).split("$ARGUMENTS").join(args).trim(), source };
    } catch {
      // try the next base
    }
  }
  return { ok: false, error: `No .claude/commands/${name}.md in ${root}${fallbackRoot ? ` or ${fallbackRoot}` : ""}` };
}

export function parseSlash(text: string): { name: LifecycleCommand; args: string } | null {
  const m = text.trim().match(/^\/([a-z-]+)(?:\s+([\s\S]*))?$/);
  if (!m || !LIFECYCLE_COMMANDS.includes(m[1] as LifecycleCommand)) return null;
  return { name: m[1] as LifecycleCommand, args: (m[2] ?? "").trim() };
}
```

`packages/tui/src/core/actions.ts`:
```ts
import { run as defaultRun, type Runner } from "./proc";
import { HOSTS, LIFECYCLE_COMMANDS, type HostId, type LifecycleCommand, type Placement } from "./types";
import type { LoadedWorkspace } from "./workspace";

// npm scripts the cockpit may run directly. Everything else goes through an
// agent (guarded) or the operator.
export const SCRIPT_ALLOWLIST = ["initialize", "generate:schemas", "validate:schemas", "validate:structure", "doctor", "knowledge"];

export type ActionDef =
  | { id: string; label: string; kind: "script"; script: string }
  | { id: string; label: string; kind: "open" }
  | { id: string; label: string; kind: "agent"; command: LifecycleCommand }
  | { id: string; label: string; kind: "launch"; host: HostId; placement: Placement };

export function workspaceScripts(files: Record<string, string>): Record<string, string> {
  try {
    return JSON.parse(files["package.json"] ?? "{}").scripts ?? {};
  } catch {
    return {};
  }
}

export function actionsFor(ws: LoadedWorkspace | null): ActionDef[] {
  const out: ActionDef[] = [{ id: "open-source", label: "Open this page's file in $EDITOR", kind: "open" }];
  for (const command of LIFECYCLE_COMMANDS) out.push({ id: `agent:${command}`, label: `Agent: /${command}`, kind: "agent", command });
  for (const host of HOSTS) {
    for (const placement of ["split", "tab"] as Placement[]) out.push({ id: `launch:${host}:${placement}`, label: `Launch ${host} (${placement})`, kind: "launch", host, placement });
  }
  const scripts = ws ? workspaceScripts(ws.files) : {};
  for (const script of SCRIPT_ALLOWLIST) if (scripts[script]) out.push({ id: `script:${script}`, label: `npm run ${script}`, kind: "script", script });
  return out;
}

export function findAction(list: ActionDef[], id: string): ActionDef | undefined {
  return list.find((a) => a.id === id);
}

export async function runScript(root: string, script: string, run: Runner = defaultRun): Promise<{ ok: boolean; output: string }> {
  if (!SCRIPT_ALLOWLIST.includes(script)) return { ok: false, output: `script not allowed: ${script}` };
  const r = await run("npm", ["run", "--silent", script], { cwd: root, timeoutMs: 300_000 });
  const output = `${r.stdout}${r.stderr}`.trim() || r.error || "";
  return { ok: r.code === 0, output: output.slice(-4000) };
}

export function editorCommand(env: NodeJS.ProcessEnv, file: string): { cmd: string; args: string[] } {
  const [cmd, ...rest] = String(env.VISUAL || env.EDITOR || "vi").trim().split(/\s+/);
  return { cmd, args: [...rest, file] };
}
```

- [ ] **Step 4: Run — expect PASS**, then commit.

```bash
npm test --prefix packages/tui
git add packages/tui/src/core/commands.ts packages/tui/src/core/actions.ts packages/tui/test/core/commands.test.ts packages/tui/test/core/actions.test.ts
git commit -m "feat(tui): lifecycle command expansion from .claude/commands and allow-listed actions" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: the gate — guard first, then operator approval

**Files:**
- Create: `packages/tui/src/core/gate.ts`
- Test: `packages/tui/test/core/gate.test.ts` (Write tool — names a destructive verb)

**Interfaces:**
- Consumes: `runGuard` from `harness-kit/guard-bridge.mjs`, `PermissionRequest`, `PermissionAnswer`, `firstLine`.
- Produces: `READ_ONLY_TOOLS`, `SHELL_TOOLS`, `APPROVAL_TIMEOUT_MS = 600000`, `type GateRequest = { workspace: string; root: string; tool: string; input: Record<string, unknown> }`, `type GateDecision = { allow: true } | { allow: false; reason: string }`, `type GuardFn = (command: string, root: string) => { allow: boolean; reason?: string }`, `summarizeTool(tool, input) → string`, `class Gate` with `constructor({ ask, guard?, timeoutMs?, newId?, onSettle? })` (`onSettle(id)` fires whenever a pending request resolves — answer, timeout or cancel), `check(req) → Promise<GateDecision>`, `answer(id, answer) → boolean`, `pending() → PermissionRequest[]`, `resetSession(workspace)`, `cancelAll(reason)`.

- [ ] **Step 1: Failing test** — `packages/tui/test/core/gate.test.ts`

```ts
import { test, expect } from "bun:test";
import { Gate, summarizeTool } from "../../src/core/gate";
import type { PermissionRequest } from "../../src/core/types";

const DANGEROUS = ["git", "stash", "list"].join(" ");
const base = { workspace: "ws", root: "/tmp" };

function makeGate(opts: { guardAllow?: boolean; timeoutMs?: number } = {}) {
  const asked: PermissionRequest[] = [];
  let n = 0;
  const gate = new Gate({
    ask: (r) => asked.push(r),
    guard: (cmd) => (opts.guardAllow === false || cmd.includes("stash") ? { allow: false, reason: "BLOCKED by guard" } : { allow: true }),
    timeoutMs: opts.timeoutMs,
    newId: () => `p${++n}`,
  });
  return { gate, asked };
}

test("guard block beats everything, including a session allowance", async () => {
  const { gate, asked } = makeGate();
  const first = gate.check({ ...base, tool: "bash", input: { command: "ls" } });
  gate.answer("p1", "session");
  expect(await first).toEqual({ allow: true });
  expect(await gate.check({ ...base, tool: "bash", input: { command: DANGEROUS } })).toEqual({ allow: false, reason: "BLOCKED by guard" });
  expect(asked.length).toBe(1);
});

test("read-only tools pass without asking; mutating tools ask", async () => {
  const { gate, asked } = makeGate();
  expect(await gate.check({ ...base, tool: "read", input: { path: "a" } })).toEqual({ allow: true });
  const pending = gate.check({ ...base, tool: "write", input: { path: "a.md", content: "x" } });
  expect(asked[0]).toMatchObject({ id: "p1", tool: "write", summary: "a.md", workspace: "ws" });
  expect(gate.pending().map((p) => p.id)).toEqual(["p1"]);
  gate.answer("p1", "once");
  expect(await pending).toEqual({ allow: true });
  const again = gate.check({ ...base, tool: "write", input: { path: "b.md" } });
  expect(asked.length).toBe(2);
  gate.answer("p2", "deny");
  expect(await again).toEqual({ allow: false, reason: "denied by the operator" });
});

test("session allowance is per workspace and per tool", async () => {
  const { gate, asked } = makeGate();
  const p = gate.check({ ...base, tool: "edit", input: {} });
  gate.answer("p1", "session");
  await p;
  expect(await gate.check({ ...base, tool: "edit", input: {} })).toEqual({ allow: true });
  const other = gate.check({ workspace: "other", root: "/tmp", tool: "edit", input: {} });
  expect(asked.length).toBe(2);
  gate.answer("p2", "once");
  await other;
  gate.resetSession("ws");
  gate.check({ ...base, tool: "edit", input: {} });
  expect(asked.length).toBe(3);
  gate.cancelAll("test done");
});

test("concurrent requests resolve by id", async () => {
  const { gate } = makeGate();
  const a = gate.check({ ...base, tool: "write", input: { path: "a" } });
  const b = gate.check({ ...base, tool: "write", input: { path: "b" } });
  expect(gate.answer("p2", "once")).toBe(true);
  expect(gate.answer("p1", "deny")).toBe(true);
  expect(gate.answer("p1", "once")).toBe(false);
  expect(await b).toEqual({ allow: true });
  expect((await a).allow).toBe(false);
});

test("unanswered requests time out as deny; cancelAll denies the rest; onSettle fires", async () => {
  const settled: string[] = [];
  const timed = new Gate({ ask: () => {}, guard: () => ({ allow: true }), timeoutMs: 30, newId: () => "t1", onSettle: (id) => settled.push(id) });
  expect(await timed.check({ ...base, tool: "write", input: {} })).toEqual({ allow: false, reason: "no answer from the operator within 0 min — denied" });
  expect(settled).toEqual(["t1"]);
  const { gate: g2 } = makeGate();
  const p = g2.check({ ...base, tool: "write", input: {} });
  g2.cancelAll("cockpit closing");
  expect(await p).toEqual({ allow: false, reason: "cockpit closing" });
});

test("a throwing guard blocks; a non-string command is checked as empty", async () => {
  const gate = new Gate({ ask: () => {}, guard: () => { throw new Error("boom"); } });
  expect(await gate.check({ ...base, tool: "bash", input: { command: "ls" } })).toEqual({ allow: false, reason: "org-os vault guard failed (boom); blocking fail-closed" });
  const seen: string[] = [];
  const g2 = new Gate({ ask: () => {}, guard: (cmd) => { seen.push(cmd); return { allow: false, reason: "x" }; } });
  await g2.check({ ...base, tool: "bash", input: { command: 42 as unknown as string } });
  expect(seen).toEqual([""]);
});

test("the real guard is the default", async () => {
  const gate = new Gate({ ask: () => {} });
  const d = await gate.check({ ...base, tool: "bash", input: { command: DANGEROUS } });
  expect(d.allow).toBe(false);
});

test("summaries", () => {
  expect(summarizeTool("bash", { command: "npm test\nmore" })).toBe("npm test");
  expect(summarizeTool("write", { path: "docs/a.md", content: "x" })).toBe("docs/a.md");
  expect(summarizeTool("custom", { a: 1 })).toBe('{"a":1}');
});
```

- [ ] **Step 2: Run — expect failure.** `npm test --prefix packages/tui`

- [ ] **Step 3: Implement** — `packages/tui/src/core/gate.ts`

```ts
// @ts-ignore — plain .mjs without types
import { runGuard } from "../../../harness-kit/guard-bridge.mjs";
import type { PermissionAnswer, PermissionRequest } from "./types";
import { firstLine } from "./util";

export const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
export const SHELL_TOOLS = new Set(["bash", "powershell"]);
export const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

export type GateRequest = { workspace: string; root: string; tool: string; input: Record<string, unknown> };
export type GateDecision = { allow: true } | { allow: false; reason: string };
export type GuardFn = (command: string, root: string) => { allow: boolean; reason?: string };

export function summarizeTool(tool: string, input: Record<string, unknown>): string {
  const pick = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  const primary = pick("command") ?? pick("path") ?? pick("file_path") ?? pick("pattern");
  return firstLine(primary ?? JSON.stringify(input), 80);
}

type Pending = { request: PermissionRequest; resolve: (d: GateDecision) => void; timer: ReturnType<typeof setTimeout> };

export class Gate {
  private sessionAllow = new Map<string, Set<string>>();
  private waiting = new Map<string, Pending>();
  private ask: (r: PermissionRequest) => void;
  private guard: GuardFn;
  private timeoutMs: number;
  private newId: () => string;
  private onSettle: (id: string) => void;

  constructor(opts: { ask: (r: PermissionRequest) => void; guard?: GuardFn; timeoutMs?: number; newId?: () => string; onSettle?: (id: string) => void }) {
    this.ask = opts.ask;
    this.onSettle = opts.onSettle ?? (() => {});
    this.guard = opts.guard ?? ((cmd, root) => runGuard(cmd, root));
    this.timeoutMs = opts.timeoutMs ?? APPROVAL_TIMEOUT_MS;
    this.newId = opts.newId ?? (() => crypto.randomUUID());
  }

  async check(req: GateRequest): Promise<GateDecision> {
    if (SHELL_TOOLS.has(req.tool)) {
      const command = typeof req.input.command === "string" ? req.input.command : "";
      let verdict: { allow: boolean; reason?: string };
      try {
        verdict = this.guard(command, req.root);
      } catch (e) {
        return { allow: false, reason: `org-os vault guard failed (${(e as Error).message}); blocking fail-closed` };
      }
      if (!verdict.allow) return { allow: false, reason: verdict.reason ?? "blocked by org-os vault guard" };
    }
    if (READ_ONLY_TOOLS.has(req.tool)) return { allow: true };
    if (this.sessionAllow.get(req.workspace)?.has(req.tool)) return { allow: true };
    return this.askOperator(req);
  }

  private askOperator(req: GateRequest): Promise<GateDecision> {
    const request: PermissionRequest = { id: this.newId(), workspace: req.workspace, tool: req.tool, summary: summarizeTool(req.tool, req.input), input: req.input };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.waiting.delete(request.id)) return;
        resolve({ allow: false, reason: `no answer from the operator within ${Math.round(this.timeoutMs / 60000)} min — denied` });
        this.onSettle(request.id);
      }, this.timeoutMs);
      this.waiting.set(request.id, { request, resolve, timer });
      this.ask(request);
    });
  }

  answer(id: string, answer: PermissionAnswer): boolean {
    const p = this.waiting.get(id);
    if (!p) return false;
    this.waiting.delete(id);
    clearTimeout(p.timer);
    if (answer === "deny") {
      p.resolve({ allow: false, reason: "denied by the operator" });
      this.onSettle(id);
      return true;
    }
    if (answer === "session") {
      const set = this.sessionAllow.get(p.request.workspace) ?? new Set<string>();
      set.add(p.request.tool);
      this.sessionAllow.set(p.request.workspace, set);
    }
    p.resolve({ allow: true });
    this.onSettle(id);
    return true;
  }

  pending(): PermissionRequest[] {
    return [...this.waiting.values()].map((p) => p.request);
  }

  resetSession(workspace: string): void {
    this.sessionAllow.delete(workspace);
  }

  cancelAll(reason: string): void {
    for (const [id, p] of this.waiting) {
      clearTimeout(p.timer);
      this.waiting.delete(id);
      p.resolve({ allow: false, reason });
      this.onSettle(id);
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS**, then commit.

```bash
npm test --prefix packages/tui
git add packages/tui/src/core/gate.ts packages/tui/test/core/gate.test.ts
git commit -m "feat(tui): permission gate — fail-closed guard first, then operator approval" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 11: herdr client

**Files:**
- Create: `packages/tui/src/core/herdr.ts`
- Test: `packages/tui/test/core/herdr.test.ts`

**Interfaces:**
- Consumes: `Runner`, `HerdrAgent`, `WorkspaceInfo`, `containsPath`, `HOSTS`.
- Produces: `HERDR_SOURCE = "org-os-cockpit"`, `class HerdrError extends Error { args: string[] }`, `inHerdr(env) → boolean`, `herdrBin(env) → string`, `normalizeStatus(s) → string`, `toHerdrAgent(raw) → HerdrAgent`, `parseIntegrationStatus(text) → Record<string, boolean>`, `integrationHints(status) → string[]`, `mapAgentsToWorkspaces(agents, fleet) → Record<string, HerdrAgent[]>`, and `class HerdrClient` (`constructor({ run, bin, timeoutMs? })`) with `call(args, timeoutMs?) → Promise<any>` (returns the envelope's `result`), `listAgents()`, `splitPane({cwd, direction}) → paneId`, `createTab({cwd, label}) → paneId`, `startAgent({name, kind, paneId})`, `closePane(paneId)`, `runInPane(paneId, command)`, `focusAgent(target)`, `reportAgent({paneId, state, seq, message?})`, `releaseAgent({paneId, seq})`, `reportTitle({paneId, title})`, `notify({title, body?, sound?})`, `integrationStatus() → Record<string, boolean>`.

- [ ] **Step 1: Failing test** — `packages/tui/test/core/herdr.test.ts`

```ts
import { test, expect } from "bun:test";
import { HerdrClient, HerdrError, inHerdr, herdrBin, mapAgentsToWorkspaces, normalizeStatus, parseIntegrationStatus, integrationHints, toHerdrAgent } from "../../src/core/herdr";
import type { ProcResult, Runner } from "../../src/core/proc";
import type { WorkspaceInfo } from "../../src/core/types";

function fake(responses: Record<string, ProcResult>) {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = args.slice(0, 2).join(" ");
    return responses[key] ?? { code: 0, stdout: JSON.stringify({ id: "1", result: { type: "ok" } }), stderr: "" };
  };
  return { calls, client: new HerdrClient({ run, bin: "/bin/herdr" }) };
}
const ok = (result: unknown): ProcResult => ({ code: 0, stdout: JSON.stringify({ id: "1", result }), stderr: "" });

test("env helpers", () => {
  expect(inHerdr({ HERDR_ENV: "1" })).toBe(true);
  expect(inHerdr({})).toBe(false);
  expect(herdrBin({ HERDR_BIN_PATH: "/x/herdr" })).toBe("/x/herdr");
  expect(herdrBin({})).toBe("herdr");
});

test("listAgents unwraps the envelope and normalizes", async () => {
  const { client, calls } = fake({
    "agent list": ok({ type: "agent_list", agents: [{ pane_id: "w1:p2", workspace_id: "w1", name: "rev", agent: "claude", agent_status: "working", cwd: "/a/b", title: "t" }, { pane_id: "w1:p3", workspace_id: "w1", agent: null, display_agent: "pi", agent_status: { state: "idle" }, foreground_cwd: "/c" }] }),
  });
  const agents = await client.listAgents();
  expect(calls[0]).toEqual(["/bin/herdr", "agent", "list"]);
  expect(agents).toEqual([
    { paneId: "w1:p2", workspaceId: "w1", name: "rev", agent: "claude", status: "working", cwd: "/a/b", title: "t" },
    { paneId: "w1:p3", workspaceId: "w1", name: null, agent: "pi", status: "idle", cwd: "/c", title: null },
  ]);
});

test("pane/tab/agent commands build the documented argv", async () => {
  const { client, calls } = fake({
    "pane split": ok({ type: "pane_info", pane: { pane_id: "w1:p9" } }),
    "tab create": ok({ type: "tab_created", tab: { tab_id: "w1:t2" }, root_pane: { pane_id: "w1:p10" } }),
  });
  expect(await client.splitPane({ cwd: "/ws", direction: "right" })).toBe("w1:p9");
  expect(await client.createTab({ cwd: "/ws", label: "ws:claude" })).toBe("w1:p10");
  await client.startAgent({ name: "ws-claude", kind: "claude", paneId: "w1:p9" });
  await client.reportAgent({ paneId: "w1:p1", state: "working", seq: 3 });
  await client.releaseAgent({ paneId: "w1:p1", seq: 4 });
  await client.reportTitle({ paneId: "w1:p1", title: "org-os · Hub" });
  await client.notify({ title: "org-os: approval needed", body: "write in hub" });
  await client.runInPane("w1:p9", "vi /f");
  await client.closePane("w1:p9");
  await client.focusAgent("w1:p2");
  expect(calls.map((c) => c.slice(1))).toEqual([
    ["pane", "split", "--current", "--direction", "right", "--cwd", "/ws", "--no-focus"],
    ["tab", "create", "--cwd", "/ws", "--label", "ws:claude", "--focus"],
    ["agent", "start", "ws-claude", "--kind", "claude", "--pane", "w1:p9"],
    ["pane", "report-agent", "w1:p1", "--source", "org-os-cockpit", "--agent", "pi", "--state", "working", "--seq", "3"],
    ["pane", "release-agent", "w1:p1", "--source", "org-os-cockpit", "--agent", "pi", "--seq", "4"],
    ["pane", "report-metadata", "w1:p1", "--source", "org-os-cockpit", "--title", "org-os · Hub"],
    ["notification", "show", "org-os: approval needed", "--body", "write in hub", "--sound", "request"],
    ["pane", "run", "w1:p9", "vi /f"],
    ["pane", "close", "w1:p9"],
    ["agent", "focus", "w1:p2"],
  ]);
});

test("CLI errors become HerdrError; missing ids too", async () => {
  const { client } = fake({ "agent list": { code: 1, stdout: "", stderr: '{"error":{"code":"no_session","message":"no server"}}' }, "pane split": ok({ type: "pane_info" }) });
  await expect(client.listAgents()).rejects.toBeInstanceOf(HerdrError);
  await expect(client.listAgents()).rejects.toThrow("no server");
  await expect(client.splitPane({ cwd: "/", direction: "down" })).rejects.toThrow("no pane id");
});

test("integration status parsing and hints", () => {
  const st = parseIntegrationStatus("pi: not installed (/x)\nclaude: installed (/y)\nopencode: not installed (/z)\ncodex: not installed (/w)\n");
  expect(st).toEqual({ pi: false, claude: true, opencode: false, codex: false });
  expect(integrationHints(st)).toEqual([
    "herdr can't read pi's state yet — run `herdr integration install pi` (operator action)",
    "herdr can't read opencode's state yet — run `herdr integration install opencode` (operator action)",
  ]);
});

test("agents map to the deepest containing workspace", () => {
  const fleet = [
    { id: "hub", root: "/v" },
    { id: "fw", root: "/v/libs/fw" },
  ] as WorkspaceInfo[];
  const map = mapAgentsToWorkspaces([
    toHerdrAgent({ pane_id: "a", workspace_id: "w", cwd: "/v/libs/fw/packages", agent_status: "idle" }),
    toHerdrAgent({ pane_id: "b", workspace_id: "w", cwd: "/v/notes", agent_status: "done" }),
    toHerdrAgent({ pane_id: "c", workspace_id: "w", cwd: "/elsewhere", agent_status: "idle" }),
  ], fleet);
  expect(map.fw.map((a) => a.paneId)).toEqual(["a"]);
  expect(map.hub.map((a) => a.paneId)).toEqual(["b"]);
  expect(normalizeStatus(undefined)).toBe("unknown");
});
```

- [ ] **Step 2: Run — expect failure.** `npm test --prefix packages/tui`

- [ ] **Step 3: Implement** — `packages/tui/src/core/herdr.ts`

```ts
// herdr (terminal workspace manager for coding agents) over its CLI, which
// answers JSON envelopes { id, result: { type, ... } } — shapes from
// `herdr api schema` (protocol 22). Only used when the cockpit runs inside a
// herdr pane (HERDR_ENV=1); never probes a session from outside.
import type { Runner } from "./proc";
import { HOSTS, type HerdrAgent, type WorkspaceInfo } from "./types";
import { containsPath } from "./util";

export const HERDR_SOURCE = "org-os-cockpit";

export class HerdrError extends Error {
  constructor(message: string, readonly args: string[]) {
    super(message);
    this.name = "HerdrError";
  }
}

export const inHerdr = (env: NodeJS.ProcessEnv) => env.HERDR_ENV === "1";
export const herdrBin = (env: NodeJS.ProcessEnv) => env.HERDR_BIN_PATH || "herdr";

export function normalizeStatus(s: unknown): string {
  if (typeof s === "string") return s;
  if (s && typeof s === "object") {
    const o = s as Record<string, unknown>;
    if (typeof o.state === "string") return o.state;
    if (typeof o.status === "string") return o.status;
  }
  return "unknown";
}

export function toHerdrAgent(a: any): HerdrAgent {
  return {
    paneId: String(a?.pane_id ?? ""),
    workspaceId: String(a?.workspace_id ?? ""),
    name: a?.name ?? null,
    agent: a?.agent ?? a?.display_agent ?? null,
    status: normalizeStatus(a?.agent_status),
    cwd: a?.cwd ?? a?.foreground_cwd ?? null,
    title: a?.title ?? null,
  };
}

export function parseIntegrationStatus(text: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([\w-]+)(?: \([^)]*\))?:\s*(not installed|installed)/);
    if (m) out[m[1]] = m[2] === "installed";
  }
  return out;
}

export function integrationHints(status: Record<string, boolean>): string[] {
  return HOSTS.filter((h) => status[h] === false).map(
    (h) => `herdr can't read ${h}'s state yet — run \`herdr integration install ${h}\` (operator action)`,
  );
}

export function mapAgentsToWorkspaces(agents: HerdrAgent[], fleet: WorkspaceInfo[]): Record<string, HerdrAgent[]> {
  const out: Record<string, HerdrAgent[]> = {};
  for (const agent of agents) {
    if (!agent.cwd) continue;
    const ws = fleet.filter((w) => containsPath(w.root, agent.cwd!)).sort((a, b) => b.root.length - a.root.length)[0];
    if (ws) (out[ws.id] ??= []).push(agent);
  }
  return out;
}

function errorText(stderr: string, fallback: string): string {
  try {
    const parsed = JSON.parse(stderr);
    return parsed?.error?.message ?? parsed?.message ?? stderr.trim();
  } catch {
    return stderr.trim() || fallback;
  }
}

export class HerdrClient {
  constructor(private deps: { run: Runner; bin: string; timeoutMs?: number }) {}

  async call(args: string[], timeoutMs?: number): Promise<any> {
    const r = await this.deps.run(this.deps.bin, args, { timeoutMs: timeoutMs ?? this.deps.timeoutMs ?? 5000 });
    if (r.code !== 0) throw new HerdrError(errorText(r.stderr, r.error ?? `herdr ${args.join(" ")} failed`), args);
    const text = r.stdout.trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      return parsed?.result ?? parsed;
    } catch {
      return text;
    }
  }

  async listAgents(): Promise<HerdrAgent[]> {
    const res = await this.call(["agent", "list"]);
    return Array.isArray(res?.agents) ? res.agents.map(toHerdrAgent) : [];
  }

  async splitPane(o: { cwd: string; direction: "right" | "down" }): Promise<string> {
    const args = ["pane", "split", "--current", "--direction", o.direction, "--cwd", o.cwd, "--no-focus"];
    const id = (await this.call(args))?.pane?.pane_id;
    if (!id) throw new HerdrError("herdr pane split returned no pane id", args);
    return id;
  }

  async createTab(o: { cwd: string; label: string }): Promise<string> {
    const args = ["tab", "create", "--cwd", o.cwd, "--label", o.label, "--focus"];
    const id = (await this.call(args))?.root_pane?.pane_id;
    if (!id) throw new HerdrError("herdr tab create returned no pane id", args);
    return id;
  }

  async startAgent(o: { name: string; kind: string; paneId: string }): Promise<void> {
    await this.call(["agent", "start", o.name, "--kind", o.kind, "--pane", o.paneId], 45_000);
  }

  async closePane(paneId: string): Promise<void> {
    await this.call(["pane", "close", paneId]);
  }

  async runInPane(paneId: string, command: string): Promise<void> {
    await this.call(["pane", "run", paneId, command]);
  }

  async focusAgent(target: string): Promise<void> {
    await this.call(["agent", "focus", target]);
  }

  async reportAgent(o: { paneId: string; state: "idle" | "working" | "blocked" | "unknown"; seq: number; message?: string }): Promise<void> {
    const args = ["pane", "report-agent", o.paneId, "--source", HERDR_SOURCE, "--agent", "pi", "--state", o.state, "--seq", String(o.seq)];
    if (o.message) args.push("--message", o.message);
    await this.call(args);
  }

  async releaseAgent(o: { paneId: string; seq: number }): Promise<void> {
    await this.call(["pane", "release-agent", o.paneId, "--source", HERDR_SOURCE, "--agent", "pi", "--seq", String(o.seq)]);
  }

  async reportTitle(o: { paneId: string; title: string }): Promise<void> {
    await this.call(["pane", "report-metadata", o.paneId, "--source", HERDR_SOURCE, "--title", o.title]);
  }

  async notify(o: { title: string; body?: string; sound?: "none" | "done" | "request" }): Promise<void> {
    await this.call(["notification", "show", o.title, ...(o.body ? ["--body", o.body] : []), "--sound", o.sound ?? "request"]);
  }

  async integrationStatus(): Promise<Record<string, boolean>> {
    const r = await this.deps.run(this.deps.bin, ["integration", "status"], { timeoutMs: 5000 });
    if (r.code !== 0) throw new HerdrError(r.stderr.trim() || "herdr integration status failed", ["integration", "status"]);
    return parseIntegrationStatus(r.stdout);
  }
}
```

- [ ] **Step 4: Run — expect PASS**, then commit.

```bash
npm test --prefix packages/tui
git add packages/tui/src/core/herdr.ts packages/tui/test/core/herdr.test.ts
git commit -m "feat(tui): herdr CLI client — agents, panes, tabs, reporting, notifications" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: host launch strategies

**Files:**
- Create: `packages/tui/src/core/launch.ts`
- Test: `packages/tui/test/core/launch.test.ts`

**Interfaces:**
- Consumes: `HerdrClient`, `Runner`, `which`, `slug`, types.
- Produces: `type LaunchEnv = { env: NodeJS.ProcessEnv; platform: string; has: (bin: string) => boolean; ghosttyInstalled: boolean }`, `detectLaunchEnv(env?) → LaunchEnv`, `viableStrategies(le, prefer?) → LaunchStrategy[]`, `HOST_BIN: Record<HostId, string>`, `agentName(wsId, host, taken) → string`, `type LaunchRequest = { host; placement; cwd; wsId; paneCols; takenNames: string[] }`, `type LaunchOutcome = { ok: true; strategy: LaunchStrategy; detail: string } | { ok: true; strategy: "suspend"; foreground: ForegroundEffect } | { ok: false; error: string; tried: LaunchStrategy[] }`, `launchHost(req, { le, strategies, run, herdr }) → Promise<LaunchOutcome>`.

- [ ] **Step 1: Failing test** — `packages/tui/test/core/launch.test.ts`

```ts
import { test, expect } from "bun:test";
import { agentName, launchHost, viableStrategies, type LaunchEnv } from "../../src/core/launch";
import type { Runner } from "../../src/core/proc";

const le = (env: Record<string, string>, extra: Partial<LaunchEnv> = {}): LaunchEnv => ({
  env,
  platform: "darwin",
  has: (b) => ["herdr", "tmux", "claude", "pi", "open"].includes(b),
  ghosttyInstalled: true,
  ...extra,
});

test("strategy selection", () => {
  expect(viableStrategies(le({ HERDR_ENV: "1", TMUX: "x" }))).toEqual(["herdr", "tmux", "ghostty", "suspend"]);
  expect(viableStrategies(le({}))).toEqual(["ghostty", "suspend"]);
  expect(viableStrategies(le({ TMUX: "x" }), "suspend")).toEqual(["suspend", "tmux", "ghostty"]);
  expect(viableStrategies(le({}), "herdr")).toEqual(["ghostty", "suspend"]);
  expect(viableStrategies(le({}, { platform: "linux" }))).toEqual(["suspend"]);
});

test("agent names are valid for herdr and unique", () => {
  expect(agentName("refi-bcn-os", "claude", [])).toBe("refi-bcn-os-claude");
  expect(agentName("refi-bcn-os", "claude", ["refi-bcn-os-claude"])).toBe("refi-bcn-os-claude-2");
  expect(agentName("2026-hub", "pi", [])).toBe("a-2026-hub-pi");
  expect(agentName("x".repeat(60), "opencode", []).length).toBeLessThanOrEqual(32);
});

function fakeHerdr(fail = false) {
  const calls: string[] = [];
  return {
    calls,
    herdr: {
      async splitPane(o: any) { calls.push(`split ${o.direction} ${o.cwd}`); return "w1:p9"; },
      async createTab(o: any) { calls.push(`tab ${o.label}`); return "w1:p10"; },
      async startAgent(o: any) { calls.push(`start ${o.name} ${o.kind} ${o.paneId}`); if (fail) throw new Error("agent_not_ready"); },
      async closePane(id: string) { calls.push(`close ${id}`); },
    } as any,
  };
}
const req = { host: "claude" as const, placement: "split" as const, cwd: "/ws", wsId: "hub", paneCols: 160, takenNames: [] };

test("herdr split: direction by width, agent started", async () => {
  const { herdr, calls } = fakeHerdr();
  const noRun: Runner = async () => { throw new Error("should not run"); };
  const out = await launchHost(req, { le: le({ HERDR_ENV: "1" }), strategies: ["herdr", "suspend"], run: noRun, herdr });
  expect(out).toEqual({ ok: true, strategy: "herdr", detail: "herdr split w1:p9 (hub-claude)" });
  expect(calls).toEqual(["split right /ws", "start hub-claude claude w1:p9"]);
  await launchHost({ ...req, paneCols: 90 }, { le: le({ HERDR_ENV: "1" }), strategies: ["herdr"], run: noRun, herdr });
  expect(calls[2]).toBe("split down /ws");
});

test("a failed herdr start closes its pane and falls through", async () => {
  const { herdr, calls } = fakeHerdr(true);
  const out = await launchHost({ ...req, placement: "tab" }, { le: le({ HERDR_ENV: "1" }), strategies: ["herdr", "suspend"], run: async () => ({ code: 0, stdout: "", stderr: "" }), herdr });
  expect(calls).toEqual(["tab hub:claude", "start hub-claude claude w1:p10", "close w1:p10"]);
  expect(out).toEqual({ ok: true, strategy: "suspend", foreground: { type: "foreground", cmd: "claude", args: [], cwd: "/ws" } });
});

test("tmux and ghostty argv; missing host fails fast", async () => {
  const seen: string[][] = [];
  const run: Runner = async (cmd, args) => { seen.push([cmd, ...args]); return { code: 0, stdout: "", stderr: "" }; };
  await launchHost(req, { le: le({ TMUX: "x" }), strategies: ["tmux"], run, herdr: null });
  await launchHost({ ...req, placement: "tab" }, { le: le({ TMUX: "x" }), strategies: ["tmux"], run, herdr: null });
  await launchHost({ ...req, host: "pi" }, { le: le({}), strategies: ["ghostty"], run, herdr: null });
  expect(seen).toEqual([
    ["tmux", "split-window", "-h", "-c", "/ws", "claude"],
    ["tmux", "new-window", "-c", "/ws", "claude"],
    ["open", "-na", "Ghostty.app", "--args", "--working-directory=/ws", "-e", "pi"],
  ]);
  const missing = await launchHost({ ...req, host: "opencode" }, { le: le({}), strategies: ["suspend"], run, herdr: null });
  expect(missing).toEqual({ ok: false, error: "opencode is not installed (not on PATH)", tried: [] });
});

test("every strategy failing reports all errors", async () => {
  const run: Runner = async () => ({ code: 1, stdout: "", stderr: "no server" });
  const out = await launchHost(req, { le: le({ TMUX: "x" }), strategies: ["tmux", "ghostty"], run, herdr: null });
  expect(out.ok).toBe(false);
  if (!out.ok) {
    expect(out.tried).toEqual(["tmux", "ghostty"]);
    expect(out.error).toContain("tmux: no server");
  }
});
```

- [ ] **Step 2: Run — expect failure.** `npm test --prefix packages/tui`

- [ ] **Step 3: Implement** — `packages/tui/src/core/launch.ts`

```ts
import { existsSync } from "node:fs";
import type { HerdrClient } from "./herdr";
import { which, type Runner } from "./proc";
import type { ForegroundEffect, HostId, LaunchStrategy, Placement } from "./types";
import { slug } from "./util";

export type LaunchEnv = { env: NodeJS.ProcessEnv; platform: string; has: (bin: string) => boolean; ghosttyInstalled: boolean };

export function detectLaunchEnv(env: NodeJS.ProcessEnv = process.env): LaunchEnv {
  return { env, platform: process.platform, has: (b) => which(b, env), ghosttyInstalled: existsSync("/Applications/Ghostty.app") };
}

const ORDER: LaunchStrategy[] = ["herdr", "tmux", "zellij", "ghostty", "suspend"];

function viable(le: LaunchEnv, s: LaunchStrategy): boolean {
  switch (s) {
    case "herdr":
      return le.env.HERDR_ENV === "1" && le.has(le.env.HERDR_BIN_PATH || "herdr");
    case "tmux":
      return !!le.env.TMUX && le.has("tmux");
    case "zellij":
      return !!le.env.ZELLIJ && le.has("zellij");
    case "ghostty":
      return le.platform === "darwin" && le.ghosttyInstalled;
    case "suspend":
      return true;
  }
}

export function viableStrategies(le: LaunchEnv, prefer?: LaunchStrategy): LaunchStrategy[] {
  const list = ORDER.filter((s) => viable(le, s));
  if (prefer && list.includes(prefer)) return [prefer, ...list.filter((s) => s !== prefer)];
  return list;
}

export const HOST_BIN: Record<HostId, string> = { claude: "claude", pi: "pi", opencode: "opencode" };

// herdr agent names: [a-z][a-z0-9_-]{0,31}, unique among live agents.
export function agentName(wsId: string, host: HostId, taken: string[]): string {
  let base = slug(`${wsId}-${host}`);
  if (!/^[a-z]/.test(base)) base = `a-${base}`;
  base = base.slice(0, 29).replace(/-+$/, "");
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base}-${n}`;
  return name;
}

export type LaunchRequest = { host: HostId; placement: Placement; cwd: string; wsId: string; paneCols: number; takenNames: string[] };
export type LaunchOutcome =
  | { ok: true; strategy: LaunchStrategy; detail: string }
  | { ok: true; strategy: "suspend"; foreground: ForegroundEffect }
  | { ok: false; error: string; tried: LaunchStrategy[] };
export type LaunchDeps = { le: LaunchEnv; strategies: LaunchStrategy[]; run: Runner; herdr: HerdrClient | null };

async function expectOk(run: Runner, cmd: string, args: string[]) {
  const r = await run(cmd, args, { timeoutMs: 10_000 });
  if (r.code !== 0) throw new Error(r.stderr.trim() || r.error || `${cmd} exited ${r.code}`);
}

export async function launchHost(req: LaunchRequest, deps: LaunchDeps): Promise<LaunchOutcome> {
  const bin = HOST_BIN[req.host];
  if (!deps.le.has(bin)) return { ok: false, error: `${bin} is not installed (not on PATH)`, tried: [] };
  const errors: string[] = [];
  const tried: LaunchStrategy[] = [];
  for (const strategy of deps.strategies) {
    tried.push(strategy);
    try {
      switch (strategy) {
        case "herdr": {
          if (!deps.herdr) throw new Error("herdr client unavailable");
          const name = agentName(req.wsId, req.host, req.takenNames);
          const paneId =
            req.placement === "split"
              ? await deps.herdr.splitPane({ cwd: req.cwd, direction: req.paneCols >= 120 ? "right" : "down" })
              : await deps.herdr.createTab({ cwd: req.cwd, label: `${req.wsId}:${req.host}` });
          try {
            await deps.herdr.startAgent({ name, kind: req.host, paneId });
          } catch (e) {
            await deps.herdr.closePane(paneId).catch(() => {});
            throw e;
          }
          return { ok: true, strategy, detail: `herdr ${req.placement} ${paneId} (${name})` };
        }
        case "tmux":
          await expectOk(deps.run, "tmux", req.placement === "split" ? ["split-window", "-h", "-c", req.cwd, bin] : ["new-window", "-c", req.cwd, bin]);
          return { ok: true, strategy, detail: `tmux ${req.placement === "split" ? "split" : "window"}` };
        case "zellij":
          if (req.placement === "tab") await expectOk(deps.run, "zellij", ["action", "new-tab", "--cwd", req.cwd]);
          await expectOk(deps.run, "zellij", ["run", "--cwd", req.cwd, "--", bin]);
          return { ok: true, strategy, detail: `zellij ${req.placement}` };
        case "ghostty":
          await expectOk(deps.run, "open", ["-na", "Ghostty.app", "--args", `--working-directory=${req.cwd}`, "-e", bin]);
          return { ok: true, strategy, detail: "new Ghostty window" };
        case "suspend":
          return { ok: true, strategy: "suspend", foreground: { type: "foreground", cmd: bin, args: [], cwd: req.cwd } };
      }
    } catch (e) {
      errors.push(`${strategy}: ${(e as Error).message}`);
    }
  }
  return { ok: false, error: errors.join("; ") || "no launch strategy available", tried };
}
```

- [ ] **Step 4: Run — expect PASS**, then commit.

```bash
npm test --prefix packages/tui
git add packages/tui/src/core/launch.ts packages/tui/test/core/launch.test.ts
git commit -m "feat(tui): host launch chain — herdr, tmux, zellij, Ghostty, suspend-and-run" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: agent backend interface, transcript reducer, Pi adapter

**Files:**
- Create: `packages/tui/src/core/agents/backend.ts`, `packages/tui/src/core/agents/pi.ts`, `packages/tui/src/core/transcript.ts`
- Create fixture: `packages/tui/test/fixtures/pi-package/package.json`
- Test: `packages/tui/test/core/transcript.test.ts`, `packages/tui/test/core/pi.test.ts` (Write tool — names a destructive verb)

**Interfaces:**
- Consumes: `GateRequest`, `GateDecision`, `summarizeTool` (Task 10), `firstLine`, `AgentEvent`, `WorkspaceInfo`.
- Produces:
  - `backend.ts`: `type GateLike = { check(req: GateRequest): Promise<GateDecision> }`, `interface AgentSession { id; backend: "pi"|"claude"|"opencode"; model?: string; prompt(text, display?): Promise<void>; abort(): Promise<void>; subscribe(fn): () => void; dispose(): Promise<void> }`, `interface AgentBackend { id; available(); open({ workspace, resume: "continue"|"new", gate }): Promise<AgentSession> }`.
  - `transcript.ts`: `type TranscriptEntry = { kind: "user"; text } | { kind: "assistant"; text; streaming: boolean } | { kind: "tool"; callId; tool; summary; status: "running"|"ok"|"error"; result?: string } | { kind: "notice"; level; text }`, `TRANSCRIPT_LIMIT = 500`, `reduceTranscript(entries, event) → TranscriptEntry[]`.
  - `pi.ts`: `piPackageResources(dir) → { extensions, skills, prompts }`, `piIntegrationDir(frameworkRoot) → string | null`, `extraSkillPaths(root) → string[]`, `assistantText(msg)`, `resultSummary(result)`, `mapPiEvent(e) → AgentEvent[]`, `cockpitExtension({ gate, workspace })`, `type PiBackendOptions = { frameworkRoot; agentDir?; persistent?; model?; settingsManager?; extraFactories? }`, `piBackend(opts) → AgentBackend`.

- [ ] **Step 1: Failing transcript test** — `packages/tui/test/core/transcript.test.ts`

```ts
import { test, expect } from "bun:test";
import { reduceTranscript, TRANSCRIPT_LIMIT, type TranscriptEntry } from "../../src/core/transcript";
import type { AgentEvent } from "../../src/core/types";

const run = (events: AgentEvent[]) => events.reduce<TranscriptEntry[]>(reduceTranscript, []);

test("streams, finalizes, tracks tools, ignores status", () => {
  expect(run([
    { type: "user", text: "hi" },
    { type: "status", status: "working" },
    { type: "text_delta", delta: "Hel" },
    { type: "text_delta", delta: "lo" },
    { type: "assistant_end", text: "Hello" },
    { type: "tool_start", callId: "c1", tool: "bash", summary: "ls" },
    { type: "tool_end", callId: "c1", ok: false, summary: "blocked" },
    { type: "assistant_end", text: "" },
    { type: "notice", level: "error", text: "boom" },
  ])).toEqual([
    { kind: "user", text: "hi" },
    { kind: "assistant", text: "Hello", streaming: false },
    { kind: "tool", callId: "c1", tool: "bash", summary: "ls", status: "error", result: "blocked" },
    { kind: "notice", level: "error", text: "boom" },
  ]);
});

test("caps length", () => {
  const events: AgentEvent[] = Array.from({ length: TRANSCRIPT_LIMIT + 10 }, (_, i) => ({ type: "user", text: String(i) }));
  const out = run(events);
  expect(out.length).toBe(TRANSCRIPT_LIMIT);
  expect(out[0]).toEqual({ kind: "user", text: "10" });
});
```

- [ ] **Step 2: Failing Pi test** — `packages/tui/test/core/pi.test.ts` (Write tool)

```ts
import { test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { Gate } from "../../src/core/gate";
import { extraSkillPaths, mapPiEvent, piBackend, piPackageResources } from "../../src/core/agents/pi";
import type { AgentEvent, PermissionRequest, WorkspaceInfo } from "../../src/core/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK = resolve(HERE, "../../../..");
const DANGEROUS = ["git", "stash", "list"].join(" ");

async function setup(responses: any[], answer?: "once" | "deny") {
  const agentDir = mkdtempSync(join(tmpdir(), "ck-pi-agent-"));
  const root = mkdtempSync(join(tmpdir(), "ck-pi-ws-"));
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
  faux.setResponses(responses);
  const asked: PermissionRequest[] = [];
  const gate: Gate = new Gate({
    ask: (r) => {
      asked.push(r);
      if (answer) setTimeout(() => gate.answer(r.id, answer), 10);
    },
  });
  const backend = piBackend({
    frameworkRoot: FRAMEWORK,
    agentDir,
    persistent: false,
    model: faux.getModel(),
    settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } }),
    extraFactories: [(pi: any) => pi.registerProvider(faux.provider)],
  });
  const workspace: WorkspaceInfo = { id: "t", label: "t", root, kind: "extra", exists: true, drift: 0 };
  const session = await backend.open({ workspace, resume: "new", gate });
  const events: AgentEvent[] = [];
  session.subscribe((e) => events.push(e));
  return { session, events, asked, root };
}

test("the vault guard blocks a destructive shell call without asking", async () => {
  const { session, events, asked } = await setup([
    fauxAssistantMessage(fauxToolCall("bash", { command: DANGEROUS }), { stopReason: "toolUse" }),
    fauxAssistantMessage("stopped"),
  ]);
  await session.prompt("go");
  const end = events.find((e) => e.type === "tool_end");
  expect(end).toMatchObject({ type: "tool_end", ok: false });
  expect(end && end.type === "tool_end" && end.summary).toContain("BLOCKED");
  expect(asked.length).toBe(0);
  expect(events.some((e) => e.type === "notice" && e.text.includes("pi-harness"))).toBe(true);
  expect(events.filter((e) => e.type === "assistant_end").at(-1)).toEqual({ type: "assistant_end", text: "stopped" });
  expect(events.at(-1)).toEqual({ type: "status", status: "idle" });
  await session.dispose();
});

test("a write asks the operator; allow once writes the file", async () => {
  const { session, events, asked, root } = await setup([
    fauxAssistantMessage(fauxToolCall("write", { path: "note.txt", content: "hi" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ], "once");
  await session.prompt("write it", "write a note");
  expect(asked.map((a) => [a.tool, a.summary])).toEqual([["write", "note.txt"]]);
  expect(existsSync(join(root, "note.txt"))).toBe(true);
  expect(events.find((e) => e.type === "user")).toEqual({ type: "user", text: "write a note" });
  expect(events.find((e) => e.type === "tool_end")).toMatchObject({ ok: true });
  await session.dispose();
});

test("deny keeps the file from being written", async () => {
  const { session, root } = await setup([
    fauxAssistantMessage(fauxToolCall("write", { path: "no.txt", content: "x" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("ok"),
  ], "deny");
  await session.prompt("write it");
  expect(existsSync(join(root, "no.txt"))).toBe(false);
  await session.dispose();
});

test("a model error surfaces as a notice", async () => {
  const { session, events } = await setup([fauxAssistantMessage("", { stopReason: "error", errorMessage: "boom" })]);
  await session.prompt("hi");
  expect(events.some((e) => e.type === "notice" && e.level === "error" && e.text.includes("boom"))).toBe(true);
  await session.dispose();
});

test("mapPiEvent", () => {
  expect(mapPiEvent({ type: "agent_start" })).toEqual([{ type: "status", status: "working" }]);
  expect(mapPiEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x" } })).toEqual([{ type: "text_delta", delta: "x" }]);
  expect(mapPiEvent({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "x" } })).toEqual([]);
  expect(mapPiEvent({ type: "message_end", message: { role: "user", content: "x" } })).toEqual([]);
  expect(mapPiEvent({ type: "tool_execution_start", toolCallId: "1", toolName: "read", args: { path: "a.md" } })).toEqual([{ type: "tool_start", callId: "1", tool: "read", summary: "a.md" }]);
  expect(mapPiEvent({ type: "tool_execution_end", toolCallId: "1", toolName: "read", isError: false, result: { content: [{ type: "text", text: "line1\nline2" }] } })).toEqual([{ type: "tool_end", callId: "1", ok: true, summary: "line1" }]);
  expect(mapPiEvent({ type: "turn_end" })).toEqual([]);
});

test("pi package manifest and extra skill paths", () => {
  const pkg = join(HERE, "../fixtures/pi-package");
  expect(piPackageResources(pkg)).toEqual({
    extensions: [join(pkg, "extensions/org-os/index.ts"), join(pkg, "extensions/vault-guard.ts")],
    skills: [join(pkg, "skills")],
    prompts: [join(pkg, "prompts")],
  });
  expect(piPackageResources("/does/not/exist")).toEqual({ extensions: [], skills: [], prompts: [] });
  const root = mkdtempSync(join(tmpdir(), "ck-skills-"));
  expect(extraSkillPaths(root)).toEqual([]);
  mkdirSync(join(root, "skills"));
  expect(extraSkillPaths(root)).toEqual([join(root, "skills")]);
  mkdirSync(join(root, ".pi"));
  writeFileSync(join(root, ".pi", "settings.json"), JSON.stringify({ skills: ["../skills", "!../skills/commands/**"] }));
  expect(extraSkillPaths(root)).toEqual([]);
});
```

`packages/tui/test/fixtures/pi-package/package.json`:
```json
{
  "name": "fixture-pi-package",
  "pi": {
    "extensions": ["extensions/org-os/index.ts", "extensions/vault-guard.ts"],
    "skills": ["skills"],
    "prompts": ["prompts/*.md"]
  }
}
```

- [ ] **Step 3: Run — expect failures.** `npm test --prefix packages/tui`

- [ ] **Step 4: Implement**

`packages/tui/src/core/agents/backend.ts`:
```ts
import type { GateDecision, GateRequest } from "../gate";
import type { AgentEvent, WorkspaceInfo } from "../types";

export type GateLike = { check(req: GateRequest): Promise<GateDecision> };

export interface AgentSession {
  readonly id: string;
  readonly backend: "pi" | "claude" | "opencode";
  readonly model?: string;
  /** Resolves when the run settles. `display` is what the transcript shows (e.g. "/close"). */
  prompt(text: string, display?: string): Promise<void>;
  abort(): Promise<void>;
  subscribe(fn: (e: AgentEvent) => void): () => void;
  dispose(): Promise<void>;
}

export interface AgentBackend {
  readonly id: "pi" | "claude" | "opencode";
  available(): Promise<{ ok: true } | { ok: false; reason: string }>;
  open(opts: { workspace: WorkspaceInfo; resume: "continue" | "new"; gate: GateLike }): Promise<AgentSession>;
}
```

`packages/tui/src/core/transcript.ts`:
```ts
import type { AgentEvent, NoticeLevel } from "./types";

export type TranscriptEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; streaming: boolean }
  | { kind: "tool"; callId: string; tool: string; summary: string; status: "running" | "ok" | "error"; result?: string }
  | { kind: "notice"; level: NoticeLevel; text: string };

export const TRANSCRIPT_LIMIT = 500;

const cap = (entries: TranscriptEntry[]) => (entries.length > TRANSCRIPT_LIMIT ? entries.slice(entries.length - TRANSCRIPT_LIMIT) : entries);

export function reduceTranscript(entries: TranscriptEntry[], e: AgentEvent): TranscriptEntry[] {
  const last = entries[entries.length - 1];
  switch (e.type) {
    case "user":
      return cap([...entries, { kind: "user", text: e.text }]);
    case "text_delta":
      if (last?.kind === "assistant" && last.streaming) return [...entries.slice(0, -1), { ...last, text: last.text + e.delta }];
      return cap([...entries, { kind: "assistant", text: e.delta, streaming: true }]);
    case "assistant_end":
      if (last?.kind === "assistant" && last.streaming) return [...entries.slice(0, -1), { kind: "assistant", text: e.text || last.text, streaming: false }];
      return e.text ? cap([...entries, { kind: "assistant", text: e.text, streaming: false }]) : entries;
    case "tool_start":
      return cap([...entries, { kind: "tool", callId: e.callId, tool: e.tool, summary: e.summary, status: "running" }]);
    case "tool_end":
      return entries.map((x) => (x.kind === "tool" && x.callId === e.callId ? { ...x, status: e.ok ? "ok" : "error", result: e.summary } : x));
    case "notice":
      return cap([...entries, { kind: "notice", level: e.level, text: e.text }]);
    default:
      return entries;
  }
}
```

`packages/tui/src/core/agents/pi.ts`:
```ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { summarizeTool } from "../gate";
import type { AgentEvent, WorkspaceInfo } from "../types";
import { firstLine } from "../util";
import type { AgentBackend, AgentSession, GateLike } from "./backend";

export function piPackageResources(pkgDir: string): { extensions: string[]; skills: string[]; prompts: string[] } {
  let manifest: any;
  try {
    manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).pi ?? {};
  } catch {
    return { extensions: [], skills: [], prompts: [] };
  }
  const abs = (p: string) => join(pkgDir, p);
  return {
    extensions: (manifest.extensions ?? []).map(abs),
    skills: (manifest.skills ?? []).map(abs),
    prompts: [...new Set<string>((manifest.prompts ?? []).map((p: string) => (p.includes("*") ? abs(dirname(p)) : abs(p))))],
  };
}

export function piIntegrationDir(frameworkRoot: string): string | null {
  const dir = join(frameworkRoot, "packages", "pi-integration");
  return existsSync(join(dir, "package.json")) ? dir : null;
}

export function extraSkillPaths(root: string): string[] {
  const skills = join(root, "skills");
  if (!existsSync(skills)) return [];
  try {
    const settings = JSON.parse(readFileSync(join(root, ".pi", "settings.json"), "utf8"));
    if (Array.isArray(settings.skills) && settings.skills.some((s: unknown) => typeof s === "string" && s.replace(/\/$/, "") === "../skills")) return [];
  } catch {
    // no project settings: add the workspace skills ourselves
  }
  return [skills];
}

export function assistantText(message: any): string {
  const c = message?.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
}

export function resultSummary(result: any): string {
  const text = Array.isArray(result?.content) ? result.content.find((c: any) => c?.type === "text")?.text : typeof result === "string" ? result : "";
  return firstLine(text ?? "", 80);
}

export function mapPiEvent(e: any): AgentEvent[] {
  switch (e?.type) {
    case "agent_start":
      return [{ type: "status", status: "working" }];
    case "agent_settled":
      return [{ type: "status", status: "idle" }];
    case "message_update":
      return e.assistantMessageEvent?.type === "text_delta" ? [{ type: "text_delta", delta: String(e.assistantMessageEvent.delta ?? "") }] : [];
    case "message_end": {
      const m = e.message;
      if (m?.role !== "assistant") return [];
      const out: AgentEvent[] = [{ type: "assistant_end", text: assistantText(m) }];
      if (m.stopReason === "error" || m.errorMessage) out.push({ type: "notice", level: "error", text: `pi: ${m.errorMessage ?? "model error"}` });
      return out;
    }
    case "tool_execution_start":
      return [{ type: "tool_start", callId: String(e.toolCallId), tool: String(e.toolName), summary: summarizeTool(String(e.toolName), e.args ?? {}) }];
    case "tool_execution_end":
      return [{ type: "tool_end", callId: String(e.toolCallId), ok: !e.isError, summary: resultSummary(e.result) }];
    default:
      return [];
  }
}

// The cockpit's inline Pi extension: every tool call goes through the gate
// (fail-closed guard, then operator approval). A throwing handler also blocks —
// Pi's own fail-safe (VERIFIED.md T2).
export function cockpitExtension(opts: { gate: GateLike; workspace: WorkspaceInfo }) {
  return (pi: any) => {
    pi.on("tool_call", async (event: any) => {
      const decision = await opts.gate.check({
        workspace: opts.workspace.id,
        root: opts.workspace.root,
        tool: String(event.toolName),
        input: (event.input ?? {}) as Record<string, unknown>,
      });
      return decision.allow ? undefined : { block: true, reason: decision.reason };
    });
  };
}

class PiAgentSession implements AgentSession {
  readonly backend = "pi" as const;
  private listeners = new Set<(e: AgentEvent) => void>();
  private buffer: AgentEvent[] = [];
  private working = false;

  constructor(private session: any) {
    session.subscribe((raw: any) => {
      for (const e of mapPiEvent(raw)) this.emit(e);
    });
  }

  get id(): string {
    return String(this.session.sessionId ?? "pi");
  }

  get model(): string | undefined {
    const m = this.session.model;
    return m ? `${m.provider}/${m.id}` : undefined;
  }

  emit(e: AgentEvent): void {
    if (e.type === "status") this.working = e.status === "working";
    if (!this.listeners.size) {
      this.buffer.push(e);
      return;
    }
    for (const fn of [...this.listeners]) fn(e);
  }

  subscribe(fn: (e: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    const pending = this.buffer;
    this.buffer = [];
    for (const e of pending) fn(e);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async prompt(text: string, display?: string): Promise<void> {
    this.emit({ type: "user", text: display ?? text });
    try {
      if (this.working) await this.session.followUp(text);
      else await this.session.prompt(text);
    } catch (e) {
      const msg = (e as Error).message;
      this.emit({ type: "notice", level: "error", text: `pi: ${msg}` });
      this.emit({ type: "status", status: "error", detail: msg });
    }
  }

  async abort(): Promise<void> {
    await this.session.abort();
  }

  async dispose(): Promise<void> {
    this.session.dispose();
    this.listeners.clear();
  }
}

export type PiBackendOptions = {
  frameworkRoot: string;
  agentDir?: string;
  persistent?: boolean;
  model?: unknown;
  settingsManager?: unknown;
  extraFactories?: ((pi: any) => void)[];
};

export function piBackend(opts: PiBackendOptions): AgentBackend {
  return {
    id: "pi",
    async available() {
      return { ok: true };
    },
    async open({ workspace, resume, gate }) {
      const cwd = workspace.root;
      const agentDir = opts.agentDir ?? getAgentDir();
      const pkg = piIntegrationDir(opts.frameworkRoot);
      const res = pkg ? piPackageResources(pkg) : { extensions: [], skills: [], prompts: [] };
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        additionalExtensionPaths: res.extensions,
        additionalSkillPaths: [...res.skills, ...extraSkillPaths(cwd)],
        additionalPromptTemplatePaths: res.prompts,
        extensionFactories: [...(opts.extraFactories ?? []), cockpitExtension({ gate, workspace })],
      });
      await loader.reload();
      const sessionManager =
        opts.persistent === false ? SessionManager.inMemory(cwd) : resume === "new" ? SessionManager.create(cwd) : SessionManager.continueRecent(cwd);
      const { session, modelFallbackMessage } = await createAgentSession({
        cwd,
        agentDir,
        resourceLoader: loader,
        sessionManager,
        ...(opts.model ? { model: opts.model as any } : {}),
        ...(opts.settingsManager ? { settingsManager: opts.settingsManager as any } : {}),
      });
      const wrapped = new PiAgentSession(session);
      if (!pkg) wrapped.emit({ type: "notice", level: "info", text: "org-os Pi tools aren't installed yet (pi-harness not landed). The vault guard and approvals still apply." });
      if (modelFallbackMessage) wrapped.emit({ type: "notice", level: "warn", text: `pi: ${modelFallbackMessage}` });
      if (existsSync(join(cwd, ".pi"))) wrapped.emit({ type: "notice", level: "info", text: "This workspace's .pi/ resources load only after you trust it in Pi itself (run `pi` there once)." });
      return wrapped;
    },
  };
}
```

- [ ] **Step 5: Run — expect PASS.** `npm test --prefix packages/tui`
If the "deny" test leaves `no.txt` absent but Pi reports a different `isError` shape, keep the file assertion (the behaviour that matters) and read `VERIFIED.md` T2 for the event shape.

- [ ] **Step 6: Commit**

```bash
git add packages/tui/src/core/agents packages/tui/src/core/transcript.ts packages/tui/test/core/transcript.test.ts packages/tui/test/core/pi.test.ts packages/tui/test/fixtures/pi-package
git commit -m "feat(tui): embedded Pi backend with gated tool calls and transcript reducer" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: the `Cockpit` controller

**Files:**
- Create: `packages/tui/src/core/cockpit.ts`
- Test: `packages/tui/test/core/cockpit.test.ts`, helper `packages/tui/test/helpers/fakes.ts`

**Interfaces:**
- Consumes: everything in `src/core/`.
- Produces:
  - `type CockpitSnapshot = { fleet: FleetRow[]; activeId: string | null; activeName: string; activeGit: GitStatus | null; activeUrgent: number; page: PageData | null; canGoBack: boolean; transcript: TranscriptEntry[]; agentStatus: AgentStatus; agentModel: string | null; agentAvailable: boolean; permissions: PermissionRequest[]; herdr: { available: boolean; agents: number }; loading: boolean }`
  - `type CoreEvents = { state: CockpitSnapshot; notice: Notice }`
  - `interface CockpitLike { events: Emitter<CoreEvents>; snapshot(): CockpitSnapshot; dispatch(cmd: Command): Promise<ForegroundEffect | void>; actions(): ActionDef[] }`
  - `type CockpitDeps = { frameworkRoot; invokedFrom; flags?: { workspace?; page? }; config: CockpitConfig; uiState?: UiState; env?: NodeJS.ProcessEnv; now?: () => Date; run?: Runner; backend?: AgentBackend | null; herdr?: HerdrClient | null; loadWorkspace?; watch?: typeof watchWorkspace | null; launch?: typeof launchHost; launchEnv?: LaunchEnv; runScript?: typeof runScript; guard?: GuardFn; saveUiState?: (s: UiState) => void; git?: boolean }`
  - `class Cockpit implements CockpitLike` with `start()`, `stop()`, `snapshot()`, `dispatch(cmd)`, `actions()`, `notice(level, text)`, and public `gate: Gate`.

- [ ] **Step 1: Fakes** — `packages/tui/test/helpers/fakes.ts`

```ts
import type { AgentBackend, AgentSession, GateLike } from "../../src/core/agents/backend";
import type { AgentEvent } from "../../src/core/types";

export const tick = () => new Promise((r) => setTimeout(r, 0));

export function fakeBackend(opts: { failOpen?: boolean } = {}) {
  const prompts: string[] = [];
  let gate: GateLike | null = null;
  const backend: AgentBackend = {
    id: "pi",
    available: async () => ({ ok: true }),
    open: async ({ gate: g }) => {
      if (opts.failOpen) throw new Error("no credentials");
      gate = g;
      const listeners = new Set<(e: AgentEvent) => void>();
      const emit = (e: AgentEvent) => listeners.forEach((fn) => fn(e));
      const session: AgentSession = {
        id: "s1",
        backend: "pi",
        model: "faux/faux-1",
        async prompt(text, display) {
          prompts.push(text);
          emit({ type: "user", text: display ?? text });
          emit({ type: "status", status: "working" });
          emit({ type: "assistant_end", text: "ok" });
          emit({ type: "status", status: "idle" });
        },
        async abort() {},
        subscribe(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        async dispose() {},
      };
      return session;
    },
  };
  return { backend, prompts, gate: () => gate };
}

export function fakeHerdr(agents: any[] = []) {
  const calls: string[] = [];
  const herdr: any = {
    listAgents: async () => agents,
    integrationStatus: async () => ({ pi: false, claude: true, opencode: true }),
    reportAgent: async (o: any) => calls.push(`report ${o.state}`),
    releaseAgent: async () => calls.push("release"),
    reportTitle: async (o: any) => calls.push(`title ${o.title}`),
    notify: async (o: any) => calls.push(`notify ${o.title}`),
    splitPane: async () => "w1:p9",
    runInPane: async (_id: string, cmd: string) => calls.push(`run ${cmd}`),
    focusAgent: async (id: string) => calls.push(`focus ${id}`),
  };
  return { herdr, calls };
}
```

- [ ] **Step 2: Failing test** — `packages/tui/test/core/cockpit.test.ts`

```ts
import { test, expect } from "bun:test";
import { join } from "node:path";
import { Cockpit } from "../../src/core/cockpit";
import { DEFAULT_CONFIG } from "../../src/core/config";
import { makeFleetFixture } from "../helpers/fixtures";
import { fakeBackend, fakeHerdr, tick } from "../helpers/fakes";

function make(extra: Record<string, unknown> = {}) {
  const fx = makeFleetFixture();
  const notices: string[] = [];
  const cockpit = new Cockpit({
    frameworkRoot: fx.fw,
    invokedFrom: fx.instA,
    config: structuredClone(DEFAULT_CONFIG),
    env: {},
    now: () => new Date("2026-09-25T12:00:00Z"),
    git: false,
    watch: null,
    ...extra,
  } as any);
  cockpit.events.on("notice", (n) => notices.push(`${n.level}:${n.text}`));
  return { cockpit, notices, ...fx };
}

test("start picks the workspace containing the invocation path", async () => {
  const { cockpit } = make();
  await cockpit.start();
  const s = cockpit.snapshot();
  expect(s.activeId).toBe("inst-a");
  expect(s.activeName).toBe("Instance A");
  expect(s.fleet.map((r) => r.info.id)).toEqual(["hub", "fw", "inst-a", "ghost"]);
  expect(s.page?.title).toBe("Instance A");
  expect(s.loading).toBe(false);
  expect(s.agentAvailable).toBe(false);
  await cockpit.stop();
});

test("navigation: pages, back, and cross-workspace targets", async () => {
  const { cockpit } = make();
  await cockpit.start();
  await cockpit.dispatch({ type: "open-page", ref: { page: "tasks" } });
  expect(cockpit.snapshot().page?.title).toBe("Tasks");
  expect(cockpit.snapshot().canGoBack).toBe(true);
  await cockpit.dispatch({ type: "back" });
  expect(cockpit.snapshot().page?.title).toBe("Instance A");
  await cockpit.dispatch({ type: "open-page", ref: { page: "dashboard", workspace: "fw" } });
  expect(cockpit.snapshot().activeId).toBe("fw");
  await cockpit.dispatch({ type: "select-workspace", id: "ghost" });
  expect(cockpit.snapshot().page?.blocks[0]).toMatchObject({ kind: "notice", level: "warn" });
  await cockpit.stop();
});

test("lifecycle commands expand from .claude/commands and show as the slash form", async () => {
  const fb = fakeBackend();
  const { cockpit } = make({ backend: fb.backend });
  await cockpit.start();
  await cockpit.dispatch({ type: "agent-prompt", text: "/close today" });
  await tick();
  expect(fb.prompts).toEqual(["Close the session for today now."]);
  expect(cockpit.snapshot().transcript[0]).toEqual({ kind: "user", text: "/close today" });
  expect(cockpit.snapshot().agentModel).toBe("faux/faux-1");
  await cockpit.stop();
});

test("permission requests surface, notify herdr, report blocked, and clear on answer", async () => {
  const fb = fakeBackend();
  const { herdr, calls } = fakeHerdr();
  const { cockpit, instA } = make({ backend: fb.backend, herdr, env: { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" } });
  await cockpit.start();
  await cockpit.dispatch({ type: "agent-prompt", text: "hello" });
  await tick();
  const decision = fb.gate()!.check({ workspace: "inst-a", root: instA, tool: "write", input: { path: "x.md" } });
  await tick();
  const [req] = cockpit.snapshot().permissions;
  expect(req).toMatchObject({ tool: "write", summary: "x.md", workspace: "inst-a" });
  expect(calls).toContain("notify org-os: approval needed");
  expect(calls).toContain("report blocked");
  await cockpit.dispatch({ type: "permission-answer", id: req.id, answer: "once" });
  expect(await decision).toEqual({ allow: true });
  await tick();
  expect(cockpit.snapshot().permissions).toEqual([]);
  expect(calls.at(-1)).toBe("report idle");
  await cockpit.stop();
  expect(calls).toContain("release");
});

test("herdr agents appear on their workspace rows; hints load; enter focuses them", async () => {
  const { herdr, calls } = fakeHerdr();
  const fx = make({ herdr, env: { HERDR_ENV: "1" } });
  herdr.listAgents = async () => [{ paneId: "w1:p2", workspaceId: "w1", name: "a", agent: "claude", status: "working", cwd: join(fx.instA, "docs"), title: null }];
  await fx.cockpit.start();
  const s = fx.cockpit.snapshot();
  expect(s.fleet.find((r) => r.info.id === "inst-a")!.agents.length).toBe(1);
  expect(s.herdr).toEqual({ available: true, agents: 1 });
  await fx.cockpit.dispatch({ type: "open-page", ref: { page: "fleet" } });
  expect(fx.cockpit.snapshot().page!.blocks.some((b) => b.kind === "notice" && b.text.includes("install pi"))).toBe(true);
  await fx.cockpit.dispatch({ type: "open-page", ref: { page: "herdr-agent", id: "w1:p2" } });
  expect(calls).toContain("focus w1:p2");
  expect(fx.cockpit.snapshot().page!.title).toBe("Fleet");
  await fx.cockpit.stop();
});

test("actions: allow-listed scripts run, unknown ids refused, launch effects returned", async () => {
  const ran: string[] = [];
  const { cockpit, notices } = make({
    runScript: async (root: string, script: string) => {
      ran.push(`${root.split("/").pop()} ${script}`);
      return { ok: true, output: "done" };
    },
    launch: async () => ({ ok: true, strategy: "suspend", foreground: { type: "foreground", cmd: "claude", args: [], cwd: "/x" } }),
    launchEnv: { env: {}, platform: "linux", has: () => true, ghosttyInstalled: false },
  });
  await cockpit.start();
  await cockpit.dispatch({ type: "run-action", actionId: "script:initialize" });
  expect(ran).toEqual(["inst-a initialize"]);
  expect(notices.some((n) => n.startsWith("info:npm run initialize finished"))).toBe(true);
  await cockpit.dispatch({ type: "run-action", actionId: "script:deploy" });
  expect(notices.at(-1)).toContain("error:");
  const fx = await cockpit.dispatch({ type: "launch", host: "claude", placement: "split" });
  expect(fx).toEqual({ type: "foreground", cmd: "claude", args: [], cwd: "/x" });
  const open = await cockpit.dispatch({ type: "run-action", actionId: "open-source" });
  expect(open && open.type === "foreground" && open.args.at(-1)).toEndWith("HEARTBEAT.md");
  await cockpit.stop();
});

test("a backend that cannot open reports into the transcript", async () => {
  const fb = fakeBackend({ failOpen: true });
  const { cockpit } = make({ backend: fb.backend });
  await cockpit.start();
  await cockpit.dispatch({ type: "agent-prompt", text: "hi" });
  await tick();
  const s = cockpit.snapshot();
  expect(s.transcript.at(-1)).toMatchObject({ kind: "notice", level: "error" });
  expect(s.agentStatus).toBe("error");
  await cockpit.stop();
});
```

- [ ] **Step 3: Run — expect failure.** `npm test --prefix packages/tui`

- [ ] **Step 4: Implement** — `packages/tui/src/core/cockpit.ts`

```ts
import { existsSync } from "node:fs";
import { Emitter } from "./bus";
import type { CockpitConfig, UiState } from "./config";
import { discoverFleet, pickActive } from "./fleet";
import { loadWorkspace as defaultLoad, summarize, watchWorkspace, type LoadedWorkspace } from "./workspace";
import { resolvePage, sourceFor, type FleetRow } from "./pages";
import { actionsFor, editorCommand, findAction, runScript as defaultRunScript, type ActionDef } from "./actions";
import { expandCommand, parseSlash } from "./commands";
import { Gate, type GuardFn } from "./gate";
import { detectLaunchEnv, launchHost as defaultLaunch, viableStrategies, type LaunchEnv } from "./launch";
import { integrationHints, mapAgentsToWorkspaces, type HerdrClient } from "./herdr";
import { reduceTranscript, type TranscriptEntry } from "./transcript";
import type { AgentBackend, AgentSession } from "./agents/backend";
import { run as defaultRun, type Runner } from "./proc";
import type {
  AgentEvent, AgentStatus, Command, ForegroundEffect, GitStatus, HerdrAgent, HostId, Notice, NoticeLevel,
  PageData, PageRef, PermissionRequest, Placement, WorkspaceInfo,
} from "./types";

export type CockpitSnapshot = {
  fleet: FleetRow[];
  activeId: string | null;
  activeName: string;
  activeGit: GitStatus | null;
  activeUrgent: number;
  page: PageData | null;
  canGoBack: boolean;
  transcript: TranscriptEntry[];
  agentStatus: AgentStatus;
  agentModel: string | null;
  agentAvailable: boolean;
  permissions: PermissionRequest[];
  herdr: { available: boolean; agents: number };
  loading: boolean;
};

export type CoreEvents = { state: CockpitSnapshot; notice: Notice };

export interface CockpitLike {
  events: Emitter<CoreEvents>;
  snapshot(): CockpitSnapshot;
  dispatch(cmd: Command): Promise<ForegroundEffect | void>;
  actions(): ActionDef[];
}

export type CockpitDeps = {
  frameworkRoot: string;
  invokedFrom: string;
  flags?: { workspace?: string; page?: string };
  config: CockpitConfig;
  uiState?: UiState;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  run?: Runner;
  backend?: AgentBackend | null;
  herdr?: HerdrClient | null;
  loadWorkspace?: typeof defaultLoad;
  watch?: typeof watchWorkspace | null;
  launch?: typeof defaultLaunch;
  launchEnv?: LaunchEnv;
  runScript?: typeof defaultRunScript;
  guard?: GuardFn;
  saveUiState?: (s: UiState) => void;
  git?: boolean;
};

const IDLE_POLL_PAUSE_MS = 10 * 60 * 1000;

function shellQuote(parts: string[]): string {
  return parts.map((p) => (/^[\w./:@=+-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`)).join(" ");
}

export class Cockpit implements CockpitLike {
  readonly events = new Emitter<CoreEvents>();
  readonly gate: Gate;
  private fleet: WorkspaceInfo[] = [];
  private activeId: string | null = null;
  private loaded = new Map<string, LoadedWorkspace>();
  private history = new Map<string, PageRef[]>();
  private page: PageData | null = null;
  private sessions = new Map<string, AgentSession>();
  private opening = new Map<string, Promise<AgentSession | null>>();
  private transcripts = new Map<string, TranscriptEntry[]>();
  private statuses = new Map<string, AgentStatus>();
  private models = new Map<string, string>();
  private permissions: PermissionRequest[] = [];
  private herdrAgents: HerdrAgent[] = [];
  private hints: string[] = [];
  private loading = false;
  private stopWatch: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivity = Date.now();
  private reportSeq = 0;
  private lastReported: string | null = null;
  private herdrWarned = false;
  private emitQueued = false;
  private stopped = false;

  constructor(private deps: CockpitDeps) {
    this.gate = new Gate({
      ask: (req) => this.onPermission(req),
      onSettle: (id) => {
        this.permissions = this.permissions.filter((p) => p.id !== id);
        this.updateReport();
        this.emitState();
      },
      ...(deps.guard ? { guard: deps.guard } : {}),
    });
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  async start(): Promise<void> {
    const { fleet, errors } = discoverFleet(this.deps.frameworkRoot, this.deps.config);
    this.fleet = fleet;
    errors.forEach((e) => this.notice("warn", e));
    this.activeId = pickActive(fleet, {
      invokedFrom: this.deps.invokedFrom,
      flag: this.deps.flags?.workspace,
      remembered: this.deps.uiState?.lastWorkspace,
    });
    this.loading = true;
    this.emitState();
    if (this.activeId) await this.activate(this.activeId, this.deps.flags?.page ? { page: this.deps.flags.page } : undefined);
    for (const w of this.fleet) {
      if (this.stopped) return;
      if (!this.loaded.has(w.id)) {
        await this.load(w.id);
        this.refreshPage();
        this.emitState();
      }
    }
    this.loading = false;
    if (this.deps.herdr) {
      await this.loadHints();
      await this.pollHerdr();
      this.startPolling();
    }
    this.refreshPage();
    this.emitState();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.stopWatch?.();
    this.gate.cancelAll("cockpit closed");
    for (const s of this.sessions.values()) await s.dispose().catch(() => {});
    this.sessions.clear();
    const paneId = this.env().HERDR_PANE_ID;
    if (this.deps.herdr && paneId && this.lastReported) await this.deps.herdr.releaseAgent({ paneId, seq: ++this.reportSeq }).catch(() => {});
  }

  // ── public surface ────────────────────────────────────────────────────────
  snapshot(): CockpitSnapshot {
    const id = this.activeId;
    const info = this.activeInfo();
    const ws = this.activeLoaded();
    const summary = ws ? summarize(ws) : null;
    return {
      fleet: this.fleetRows(),
      activeId: id,
      activeName: summary?.name ?? info?.label ?? "org-os",
      activeGit: ws?.git ?? null,
      activeUrgent: summary?.urgentTasks ?? 0,
      page: this.page,
      canGoBack: (id ? this.history.get(id)?.length ?? 0 : 0) > 1,
      transcript: id ? this.transcripts.get(id) ?? [] : [],
      agentStatus: id ? this.statuses.get(id) ?? "idle" : "idle",
      agentModel: id ? this.models.get(id) || null : null,
      agentAvailable: !!this.deps.backend,
      permissions: [...this.permissions],
      herdr: { available: !!this.deps.herdr, agents: this.herdrAgents.length },
      loading: this.loading,
    };
  }

  actions(): ActionDef[] {
    return actionsFor(this.activeLoaded() ?? null);
  }

  notice(level: NoticeLevel, text: string): void {
    this.events.emit("notice", { level, text });
  }

  async dispatch(cmd: Command): Promise<ForegroundEffect | void> {
    this.lastActivity = Date.now();
    switch (cmd.type) {
      case "select-workspace":
        if (this.fleet.some((w) => w.id === cmd.id)) await this.activate(cmd.id);
        return;
      case "open-page": {
        const { workspace, ...ref } = cmd.ref;
        if (ref.page === "herdr-agent") {
          if (ref.id && this.deps.herdr) await this.deps.herdr.focusAgent(ref.id).catch((e: Error) => this.notice("warn", `herdr: ${e.message}`));
          return;
        }
        if (workspace && workspace !== this.activeId) return void (await this.activate(workspace, ref));
        this.pushPage(ref);
        return;
      }
      case "back": {
        const hist = this.activeId ? this.history.get(this.activeId) : undefined;
        if (hist && hist.length > 1) {
          hist.pop();
          this.refreshPage();
          this.emitState();
        }
        return;
      }
      case "refresh":
        if (this.activeId) await this.reload(this.activeId);
        return;
      case "run-action":
        return this.runAction(cmd.actionId);
      case "launch":
        return this.launch(cmd.host, cmd.placement, cmd.paneCols ?? 160);
      case "agent-prompt": {
        const slash = parseSlash(cmd.text);
        if (slash) return this.dispatch({ type: "agent-command", name: slash.name, args: slash.args });
        void this.sendToAgent(cmd.text);
        return;
      }
      case "agent-command": {
        const info = this.activeInfo();
        if (!info) return;
        const r = await expandCommand(info.root, cmd.name, cmd.args ?? "", { fallbackRoot: this.deps.frameworkRoot });
        if (!r.ok) return void this.notice("error", r.error);
        void this.sendToAgent(r.text, `/${cmd.name}${cmd.args ? ` ${cmd.args}` : ""}`);
        return;
      }
      case "agent-abort": {
        const s = this.activeId ? this.sessions.get(this.activeId) : undefined;
        await s?.abort().catch(() => {});
        return;
      }
      case "agent-new-session":
        await this.newSession();
        return;
      case "permission-answer":
        this.gate.answer(cmd.id, cmd.answer);
        return;
    }
  }

  // ── workspaces & pages ────────────────────────────────────────────────────
  private env(): NodeJS.ProcessEnv {
    return this.deps.env ?? process.env;
  }
  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
  private activeInfo(): WorkspaceInfo | undefined {
    return this.fleet.find((w) => w.id === this.activeId);
  }
  private activeLoaded(): LoadedWorkspace | undefined {
    return this.activeId ? this.loaded.get(this.activeId) : undefined;
  }

  private async load(id: string): Promise<void> {
    const info = this.fleet.find((w) => w.id === id);
    if (!info) return;
    const load = this.deps.loadWorkspace ?? defaultLoad;
    this.loaded.set(id, await load(info, { now: this.now(), run: this.deps.run, git: this.deps.git ?? true }));
  }

  private async reload(id: string): Promise<void> {
    await this.load(id);
    if (id === this.activeId) this.refreshPage();
    this.emitState();
  }

  private async activate(id: string, ref?: PageRef): Promise<void> {
    this.activeId = id;
    if (!this.loaded.has(id)) await this.load(id);
    const hist = this.history.get(id) ?? [];
    if (ref) hist.push(ref);
    else if (!hist.length) hist.push({ page: "dashboard" });
    this.history.set(id, hist);
    this.refreshPage();
    this.startWatch();
    this.deps.saveUiState?.({ ...(this.deps.uiState ?? {}), lastWorkspace: id });
    this.reportTitle();
    this.emitState();
  }

  private pushPage(ref: PageRef): void {
    if (!this.activeId) return;
    const hist = this.history.get(this.activeId) ?? [];
    hist.push(ref);
    this.history.set(this.activeId, hist);
    this.refreshPage();
    this.emitState();
  }

  private currentRef(): PageRef {
    const hist = this.activeId ? this.history.get(this.activeId) : undefined;
    return hist?.[hist.length - 1] ?? { page: "dashboard" };
  }

  private fleetRows(): FleetRow[] {
    const byWs = mapAgentsToWorkspaces(this.herdrAgents, this.fleet);
    return this.fleet.map((info) => {
      const ws = this.loaded.get(info.id);
      return { info, summary: ws ? summarize(ws) : null, agents: byWs[info.id] ?? [] };
    });
  }

  private refreshPage(): void {
    this.page = resolvePage(this.currentRef(), { ws: this.activeLoaded() ?? null, fleet: this.fleetRows(), now: this.now(), hints: this.hints });
  }

  private startWatch(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    if (this.deps.watch === null) return;
    const info = this.activeInfo();
    if (!info?.exists) return;
    const watch = this.deps.watch ?? watchWorkspace;
    this.stopWatch = watch(info.root, () => void this.reload(info.id));
  }

  private emitState(): void {
    if (this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      this.events.emit("state", this.snapshot());
    });
  }

  // ── agent ─────────────────────────────────────────────────────────────────
  private ensureSession(id: string, resume: "continue" | "new"): Promise<AgentSession | null> {
    const existing = this.sessions.get(id);
    if (existing) return Promise.resolve(existing);
    const inflight = this.opening.get(id);
    if (inflight) return inflight;
    const info = this.fleet.find((w) => w.id === id);
    const backend = this.deps.backend;
    if (!backend) {
      this.notice("warn", "No agent backend in this mode.");
      return Promise.resolve(null);
    }
    if (!info?.exists) {
      this.notice("warn", "This workspace is missing on disk.");
      return Promise.resolve(null);
    }
    const p = backend
      .open({ workspace: info, resume, gate: this.gate })
      .then((session) => {
        this.sessions.set(id, session);
        this.models.set(id, session.model ?? "");
        session.subscribe((e) => this.onAgentEvent(id, e));
        return session;
      })
      .catch((e) => {
        this.onAgentEvent(id, { type: "notice", level: "error", text: `Could not start pi: ${(e as Error).message}` });
        this.onAgentEvent(id, { type: "status", status: "error" });
        return null;
      })
      .finally(() => this.opening.delete(id));
    this.opening.set(id, p);
    return p;
  }

  private async sendToAgent(text: string, display?: string): Promise<void> {
    const id = this.activeId;
    if (!id) return;
    const session = await this.ensureSession(id, "continue");
    if (!session) return;
    await session.prompt(text, display);
  }

  private async newSession(): Promise<void> {
    const id = this.activeId;
    if (!id) return;
    const old = this.sessions.get(id);
    this.sessions.delete(id);
    await old?.dispose().catch(() => {});
    this.transcripts.set(id, []);
    this.statuses.set(id, "idle");
    this.gate.resetSession(id);
    await this.ensureSession(id, "new");
    this.emitState();
  }

  private onAgentEvent(id: string, e: AgentEvent): void {
    this.transcripts.set(id, reduceTranscript(this.transcripts.get(id) ?? [], e));
    if (e.type === "status") {
      this.statuses.set(id, e.status);
      this.updateReport();
      if (e.status === "idle") void this.reload(id);
    }
    this.emitState();
  }

  private onPermission(req: PermissionRequest): void {
    this.permissions.push(req);
    this.updateReport();
    const label = this.fleet.find((w) => w.id === req.workspace)?.label ?? req.workspace;
    this.deps.herdr?.notify({ title: "org-os: approval needed", body: `${req.tool} in ${label}`, sound: "request" }).catch(() => {});
    this.emitState();
  }

  // ── herdr ─────────────────────────────────────────────────────────────────
  private updateReport(): void {
    const herdr = this.deps.herdr;
    const paneId = this.env().HERDR_PANE_ID;
    if (!herdr || !paneId) return;
    const working = [...this.statuses.values()].some((s) => s === "working");
    const state = this.permissions.length ? "blocked" : working ? "working" : "idle";
    if (state === this.lastReported) return;
    this.lastReported = state;
    herdr.reportAgent({ paneId, state, seq: ++this.reportSeq }).catch(() => {});
  }

  private reportTitle(): void {
    const herdr = this.deps.herdr;
    const paneId = this.env().HERDR_PANE_ID;
    const info = this.activeInfo();
    if (!herdr || !paneId || !info) return;
    herdr.reportTitle({ paneId, title: `org-os · ${info.label}` }).catch(() => {});
  }

  private async loadHints(): Promise<void> {
    try {
      this.hints = integrationHints(await this.deps.herdr!.integrationStatus());
    } catch {
      this.hints = [];
    }
  }

  private async pollHerdr(): Promise<void> {
    if (!this.deps.herdr) return;
    try {
      this.herdrAgents = await this.deps.herdr.listAgents();
    } catch (e) {
      this.herdrAgents = [];
      if (!this.herdrWarned) {
        this.herdrWarned = true;
        this.notice("warn", `herdr unavailable: ${(e as Error).message}`);
      }
    }
    this.refreshPage();
    this.emitState();
  }

  private startPolling(): void {
    if (!this.deps.config.herdr.poll || this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (Date.now() - this.lastActivity > IDLE_POLL_PAUSE_MS) return;
      void this.pollHerdr();
    }, this.deps.config.herdr.pollMs);
  }

  // ── actions & launch ──────────────────────────────────────────────────────
  private async runAction(actionId: string): Promise<ForegroundEffect | void> {
    const ws = this.activeLoaded() ?? null;
    const action = findAction(actionsFor(ws), actionId);
    if (!action) return void this.notice("error", `Unknown or unavailable action: ${actionId}`);
    switch (action.kind) {
      case "script": {
        this.notice("info", `Running npm run ${action.script}…`);
        const r = await (this.deps.runScript ?? defaultRunScript)(ws!.info.root, action.script, this.deps.run ?? defaultRun);
        const tail = r.output.split("\n").filter(Boolean).at(-1);
        this.notice(r.ok ? "info" : "error", `npm run ${action.script} ${r.ok ? "finished" : "failed"}${tail ? `: ${tail}` : ""}`);
        if (r.ok) await this.reload(ws!.info.id);
        return;
      }
      case "agent":
        return this.dispatch({ type: "agent-command", name: action.command });
      case "launch":
        return this.launch(action.host, action.placement, 160);
      case "open":
        return this.openSource();
    }
  }

  private async openSource(): Promise<ForegroundEffect | void> {
    const ws = this.activeLoaded() ?? null;
    const file = sourceFor(this.currentRef(), ws);
    if (!ws || !file || !existsSync(file)) return void this.notice("warn", "This page has no source file to open.");
    const { cmd, args } = editorCommand(this.env(), file);
    const herdr = this.deps.herdr;
    if (herdr && this.env().HERDR_ENV === "1") {
      try {
        const paneId = await herdr.splitPane({ cwd: ws.info.root, direction: "right" });
        await herdr.runInPane(paneId, shellQuote([cmd, ...args]));
        return;
      } catch (e) {
        this.notice("warn", `herdr split failed (${(e as Error).message}); opening here instead`);
      }
    }
    return { type: "foreground", cmd, args, cwd: ws.info.root };
  }

  private async launch(host: HostId, placement: Placement, paneCols: number): Promise<ForegroundEffect | void> {
    const info = this.activeInfo();
    if (!info?.exists) return void this.notice("warn", "Select an existing workspace to launch into.");
    const le = this.deps.launchEnv ?? detectLaunchEnv(this.env());
    const strategies = viableStrategies(le, this.deps.config.launch.prefer);
    const takenNames = this.herdrAgents.map((a) => a.name).filter((n): n is string => !!n);
    const outcome = await (this.deps.launch ?? defaultLaunch)(
      { host, placement, cwd: info.root, wsId: info.id, paneCols, takenNames },
      { le, strategies, run: this.deps.run ?? defaultRun, herdr: this.deps.herdr ?? null },
    );
    if ("foreground" in outcome) return outcome.foreground;
    if (outcome.ok) {
      this.notice("info", `Launched ${host}: ${outcome.detail}`);
      void this.pollHerdr();
    } else {
      this.notice("error", `Could not launch ${host}: ${outcome.error}`);
    }
  }
}
```

- [ ] **Step 5: Run — expect PASS**, then commit.

```bash
npm test --prefix packages/tui
git add packages/tui/src/core/cockpit.ts packages/tui/test/core/cockpit.test.ts packages/tui/test/helpers/fakes.ts
git commit -m "feat(tui): Cockpit controller — snapshots, navigation, agent sessions, gate, herdr, actions" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 15: UI models — theme, key routing, layout, formatting, page/transcript lines, palette

**Files:**
- Create: `packages/tui/src/ui/{theme,keys,layout,format,page-model,transcript-view,palette-model}.ts`
- Test: `packages/tui/test/ui/{keys,layout,format,page-model,transcript-view,palette-model}.test.ts`

**Interfaces:**
- Consumes: `PageData`, `PageRef`, `TranscriptEntry`, `markdownToLines`, `PAGE_INDEX`, `ActionDef`, `CockpitSnapshot`, `Command`.
- Produces:
  - `theme.ts`: `theme` (colors: `fg dim accent primary warn error ok selBg border borderFocus bg user`), `levelColor(level)`.
  - `keys.ts`: `type Focus = "rail" | "page" | "agent"`, `type Intent` (union below), `type KeyLike = { name: string; ctrl?; shift?; meta?; sequence? }`, `routeKey(key, { focus, overlay }) → Intent | null`.
  - `layout.ts`: `type Layout = { showRail: boolean; rail: number; agent: number; agentOverlay: boolean }`, `computeLayout(width, agentOpen) → Layout`, `regionsFor(layout, agentOpen) → Focus[]`.
  - `format.ts`: `displayWidth(s)`, `truncate(s, max)`, `pad(s, n)`, `padLine(left, right, width)`, `formatTable(columns, rows, maxWidth) → { header: string; lines: string[] }`.
  - `page-model.ts`: `type LineStyle`, `type PageLine = { key: string; text: string; style: LineStyle; target?: PageRef }`, `pageLines(page, width) → PageLine[]`, `selectableIndexes(lines) → number[]`, `navCount(lines) → number`, `selectedLineIndex(lines, cursor) → number`, `windowFor(lines, cursor, height) → number`, `targetAt(lines, cursor) → PageRef | undefined`.
  - `transcript-view.ts`: `type TLine = { text: string; style: "user" | "assistant" | "tool-running" | "tool-ok" | "tool-error" | "info" | "warn" | "error" | "dim" }`, `wrap(text, width) → string[]`, `transcriptLines(entries, width) → TLine[]`.
  - `palette-model.ts`: `type PaletteAction = { kind: "command"; command: Command } | { kind: "ui"; ui: "toggle-agent" | "help" }`, `type PaletteEntry = { id: string; label: string; hint?: string; action: PaletteAction }`, `buildEntries(snap, actions) → PaletteEntry[]`, `launchEntries(actions) → PaletteEntry[]`, `actionEntries(actions) → PaletteEntry[]`, `scoreEntry(label, q) → number | null`, `filterEntries(entries, q) → PaletteEntry[]`.

- [ ] **Step 1: Failing tests**

`packages/tui/test/ui/keys.test.ts`:
```ts
import { test, expect } from "bun:test";
import { routeKey } from "../../src/ui/keys";

const k = (name: string, mods: Record<string, boolean> = {}, sequence?: string) => ({ name, sequence: sequence ?? name, ...mods });

test("global navigation keys when not typing", () => {
  const s = { focus: "page" as const, overlay: false };
  expect(routeKey(k("j"), s)).toEqual({ type: "move", delta: 1 });
  expect(routeKey(k("up"), s)).toEqual({ type: "move", delta: -1 });
  expect(routeKey(k("g"), s)).toEqual({ type: "top" });
  expect(routeKey(k("g", { shift: true }), s)).toEqual({ type: "bottom" });
  expect(routeKey(k("return"), s)).toEqual({ type: "open" });
  expect(routeKey(k("escape"), s)).toEqual({ type: "back" });
  expect(routeKey(k("l", { shift: true }), s)).toEqual({ type: "launch-menu" });
  expect(routeKey(k("?", {}, "?"), s)).toEqual({ type: "help" });
  expect(routeKey(k(":", {}, ":"), s)).toEqual({ type: "palette" });
  expect(routeKey(k("3"), s)).toEqual({ type: "jump", index: 2 });
  expect(routeKey(k("q"), s)).toEqual({ type: "quit" });
  expect(routeKey(k("tab", { shift: true }), s)).toEqual({ type: "focus-prev" });
});

test("typing in the agent input never triggers global shortcuts", () => {
  const s = { focus: "agent" as const, overlay: false };
  for (const name of ["q", "j", "k", "1", "?", "a", "e", "r", "return", "h", "g"]) expect(routeKey(k(name), s)).toBe(null);
  expect(routeKey(k("escape"), s)).toEqual({ type: "blur" });
  expect(routeKey(k("tab"), s)).toEqual({ type: "focus-next" });
  expect(routeKey(k("p", { ctrl: true }), s)).toEqual({ type: "palette" });
  expect(routeKey(k("x", { ctrl: true }), s)).toEqual({ type: "abort" });
});

test("overlays swallow everything but ctrl+c", () => {
  const s = { focus: "page" as const, overlay: true };
  expect(routeKey(k("j"), s)).toBe(null);
  expect(routeKey(k("escape"), s)).toBe(null);
  expect(routeKey(k("c", { ctrl: true }), s)).toEqual({ type: "force-quit" });
});
```

`packages/tui/test/ui/layout.test.ts`:
```ts
import { test, expect } from "bun:test";
import { computeLayout, regionsFor } from "../../src/ui/layout";

test("three, two and one column layouts", () => {
  expect(computeLayout(160, true)).toEqual({ showRail: true, rail: 26, agent: 54, agentOverlay: false });
  expect(computeLayout(160, false)).toEqual({ showRail: true, rail: 26, agent: 0, agentOverlay: false });
  expect(computeLayout(120, true)).toEqual({ showRail: true, rail: 24, agent: 60, agentOverlay: true });
  expect(computeLayout(80, true)).toEqual({ showRail: false, rail: 0, agent: 80, agentOverlay: true });
  expect(regionsFor(computeLayout(160, true), true)).toEqual(["rail", "page", "agent"]);
  expect(regionsFor(computeLayout(80, false), false)).toEqual(["page"]);
});
```

`packages/tui/test/ui/format.test.ts`:
```ts
import { test, expect } from "bun:test";
import { displayWidth, truncate, pad, padLine, formatTable } from "../../src/ui/format";

test("width-aware truncation handles emoji", () => {
  expect(displayWidth("🧬 org-os")).toBe(9);
  expect(truncate("🧬 org-os framework", 8)).toBe("🧬 org-…");
  expect(displayWidth(truncate("🧬🧬🧬🧬", 5))).toBeLessThanOrEqual(5);
  expect(truncate("short", 10)).toBe("short");
  expect(truncate("x", 0)).toBe("");
  expect(pad("ab", 4)).toBe("ab  ");
  expect(padLine("left", "R", 10)).toBe("left     R");
  expect(displayWidth(padLine("a very long left label", "badge", 12))).toBe(12);
});

test("tables shrink the widest column to fit", () => {
  const t = formatTable(["Name", "Stage"], [["Cockpit project name", "Develop"], ["X", "Idea"]], 20);
  expect(displayWidth(t.header)).toBeLessThanOrEqual(20);
  for (const l of t.lines) expect(displayWidth(l)).toBeLessThanOrEqual(20);
  expect(t.lines[1].startsWith("X")).toBe(true);
});
```

`packages/tui/test/ui/page-model.test.ts`:
```ts
import { test, expect } from "bun:test";
import { pageLines, selectableIndexes, navCount, selectedLineIndex, windowFor, targetAt } from "../../src/ui/page-model";
import type { PageData } from "../../src/core/types";

const page: PageData = {
  ref: { page: "dashboard" },
  title: "Hub",
  actions: [],
  sources: [],
  errors: [],
  blocks: [
    { kind: "kv", pairs: [["Type", "Hub"], ["Branch", "main"]] },
    { kind: "list", heading: "Urgent", items: [{ key: "a", label: "Pay", badge: "2d", target: { page: "tasks" } }, { key: "b", label: "Plain" }] },
    { kind: "table", heading: "Projects", columns: ["Project", "Stage"], rows: [{ key: "c", cells: ["Cockpit", "Develop"], target: { page: "project", id: "cockpit" } }] },
    { kind: "markdown", text: "# Notes\n- one" },
    { kind: "notice", level: "warn", text: "careful" },
  ],
};

test("lines, styles and selectable targets", () => {
  const lines = pageLines(page, 60);
  expect(lines.map((l) => l.style)).toEqual(["kv", "kv", "blank", "heading", "item", "item", "blank", "heading", "header", "row", "blank", "h1", "bullet", "blank", "warn"]);
  expect(lines[4].text).toContain("Pay");
  expect(lines[4].text).toContain("2d");
  expect(selectableIndexes(lines)).toEqual([4, 9]);
  expect(navCount(lines)).toBe(2);
  expect(selectedLineIndex(lines, 1)).toBe(9);
  expect(targetAt(lines, 1)).toEqual({ page: "project", id: "cockpit" });
});

test("pages without targets scroll", () => {
  const md: PageData = { ...page, blocks: [{ kind: "markdown", text: Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") }] };
  const lines = pageLines(md, 40);
  expect(navCount(lines)).toBe(30);
  expect(selectedLineIndex(lines, 3)).toBe(-1);
  expect(windowFor(lines, 25, 10)).toBe(20);
  expect(windowFor(lines, 4, 10)).toBe(4);
  const sel = pageLines(page, 60);
  expect(windowFor(sel, 1, 5)).toBe(5);
  expect(windowFor(sel, 0, 5)).toBe(0);
});
```

`packages/tui/test/ui/transcript-view.test.ts`:
```ts
import { test, expect } from "bun:test";
import { transcriptLines, wrap } from "../../src/ui/transcript-view";

test("wrap", () => {
  expect(wrap("one two three four", 9)).toEqual(["one two", "three", "four"]);
  expect(wrap("a\n\nb", 10)).toEqual(["a", "", "b"]);
  expect(wrap("x".repeat(12), 5)).toEqual(["xxxxx", "xxxxx", "xx"]);
});

test("entries render with prefixes and styles", () => {
  const lines = transcriptLines([
    { kind: "user", text: "hi there" },
    { kind: "assistant", text: "hello", streaming: true },
    { kind: "tool", callId: "1", tool: "bash", summary: "ls", status: "error", result: "BLOCKED" },
    { kind: "notice", level: "info", text: "note" },
  ], 40);
  expect(lines).toEqual([
    { text: "› hi there", style: "user" },
    { text: "hello▍", style: "assistant" },
    { text: "✗ bash ls", style: "tool-error" },
    { text: "  BLOCKED", style: "dim" },
    { text: "· note", style: "info" },
  ]);
});
```

`packages/tui/test/ui/palette-model.test.ts`:
```ts
import { test, expect } from "bun:test";
import { buildEntries, filterEntries, launchEntries, scoreEntry } from "../../src/ui/palette-model";
import { actionsFor } from "../../src/core/actions";

const snap: any = { fleet: [{ info: { id: "hub", label: "Hub", kind: "hub" }, summary: { name: "LF Hub" }, agents: [] }] };

test("entries cover pages, workspaces, actions and UI toggles", () => {
  const entries = buildEntries(snap, actionsFor(null));
  const labels = entries.map((e) => e.label);
  expect(labels).toContain("Go to Tasks");
  expect(labels).toContain("Switch to LF Hub");
  expect(labels).toContain("Agent: /close");
  expect(labels).toContain("Launch claude (split)");
  expect(labels).toContain("Toggle agent pane");
  const launch = entries.find((e) => e.label === "Launch claude (split)")!;
  expect(launch.action).toEqual({ kind: "command", command: { type: "launch", host: "claude", placement: "split" } });
  expect(launchEntries(actionsFor(null)).length).toBe(6);
});

test("fuzzy filtering ranks tight matches first", () => {
  expect(scoreEntry("Go to Tasks", "tsk")).not.toBe(null);
  expect(scoreEntry("Go to Tasks", "xyz")).toBe(null);
  const entries = buildEntries(snap, actionsFor(null));
  expect(filterEntries(entries, "tasks")[0].label).toBe("Go to Tasks");
  expect(filterEntries(entries, "").length).toBe(entries.length);
});
```

- [ ] **Step 2: Run — expect failures.** `npm test --prefix packages/tui`

- [ ] **Step 3: Implement**

`packages/tui/src/ui/theme.ts`:
```ts
import type { NoticeLevel } from "../core/types";

export const theme = {
  fg: "#D8DEE9",
  dim: "#6B7280",
  accent: "#7DD3FC",
  primary: "#34D399",
  warn: "#FBBF24",
  error: "#F87171",
  ok: "#34D399",
  user: "#A5B4FC",
  selBg: "#1F3A5F",
  border: "#374151",
  borderFocus: "#34D399",
  bg: "#0B0F14",
};

export function levelColor(level: NoticeLevel | "dim"): string {
  return level === "error" ? theme.error : level === "warn" ? theme.warn : level === "dim" ? theme.dim : theme.accent;
}
```

`packages/tui/src/ui/keys.ts`:
```ts
export type Focus = "rail" | "page" | "agent";
export type Intent =
  | { type: "palette" } | { type: "help" } | { type: "quit" } | { type: "force-quit" }
  | { type: "focus-next" } | { type: "focus-prev" } | { type: "blur" }
  | { type: "move"; delta: number } | { type: "top" } | { type: "bottom" }
  | { type: "open" } | { type: "back" } | { type: "refresh" } | { type: "open-source" }
  | { type: "actions" } | { type: "launch-menu" } | { type: "toggle-agent" }
  | { type: "new-session" } | { type: "abort" } | { type: "jump"; index: number };
export type KeyLike = { name: string; ctrl?: boolean; shift?: boolean; meta?: boolean; sequence?: string };

// OpenTUI delivers every key to useKeyboard even while an <input> has focus
// (VERIFIED.md T1), so global shortcuts must stand down whenever the agent
// input is focused or an overlay owns the keyboard.
export function routeKey(k: KeyLike, s: { focus: Focus; overlay: boolean }): Intent | null {
  if (k.ctrl && k.name === "c") return { type: "force-quit" };
  if (s.overlay) return null;
  if (k.ctrl) {
    if (k.name === "p") return { type: "palette" };
    if (k.name === "a") return { type: "toggle-agent" };
    if (k.name === "n") return { type: "new-session" };
    if (k.name === "x") return { type: "abort" };
    return null;
  }
  if (k.name === "tab") return k.shift ? { type: "focus-prev" } : { type: "focus-next" };
  if (s.focus === "agent") return k.name === "escape" ? { type: "blur" } : null;
  const seq = k.sequence ?? "";
  if (seq === "?" || k.name === "?") return { type: "help" };
  if (seq === ":" || k.name === ":") return { type: "palette" };
  if (k.shift && k.name === "l") return { type: "launch-menu" };
  if (k.shift && k.name === "g") return { type: "bottom" };
  switch (k.name) {
    case "j":
    case "down":
      return { type: "move", delta: 1 };
    case "k":
    case "up":
      return { type: "move", delta: -1 };
    case "pagedown":
      return { type: "move", delta: 10 };
    case "pageup":
      return { type: "move", delta: -10 };
    case "g":
      return { type: "top" };
    case "return":
    case "enter":
    case "l":
    case "right":
      return { type: "open" };
    case "escape":
    case "h":
    case "left":
    case "backspace":
      return { type: "back" };
    case "r":
      return { type: "refresh" };
    case "e":
      return { type: "open-source" };
    case "a":
      return { type: "actions" };
    case "q":
      return { type: "quit" };
  }
  if (/^[1-9]$/.test(k.name)) return { type: "jump", index: Number(k.name) - 1 };
  return null;
}
```

`packages/tui/src/ui/layout.ts`:
```ts
import type { Focus } from "./keys";

export type Layout = { showRail: boolean; rail: number; agent: number; agentOverlay: boolean };

export function computeLayout(width: number, agentOpen: boolean): Layout {
  if (width >= 140) return { showRail: true, rail: 26, agent: agentOpen ? Math.max(40, Math.floor(width * 0.34)) : 0, agentOverlay: false };
  if (width >= 100) return { showRail: true, rail: 24, agent: agentOpen ? Math.floor(width * 0.5) : 0, agentOverlay: agentOpen };
  return { showRail: false, rail: 0, agent: agentOpen ? width : 0, agentOverlay: agentOpen };
}

export function regionsFor(layout: Layout, agentOpen: boolean): Focus[] {
  return [...(layout.showRail ? (["rail"] as Focus[]) : []), "page", ...(agentOpen ? (["agent"] as Focus[]) : [])];
}
```

`packages/tui/src/ui/format.ts`:
```ts
export function displayWidth(s: string): number {
  return Bun.stringWidth(s);
}

export function truncate(s: string, max: number): string {
  if (max <= 0) return "";
  if (displayWidth(s) <= max) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}

export function pad(s: string, n: number): string {
  const t = truncate(s, n);
  return t + " ".repeat(Math.max(0, n - displayWidth(t)));
}

export function padLine(left: string, right: string, width: number): string {
  if (!right) return pad(left, width);
  const r = truncate(right, Math.max(0, width - 2));
  const l = truncate(left, Math.max(0, width - displayWidth(r) - 1));
  return l + " ".repeat(Math.max(1, width - displayWidth(l) - displayWidth(r))) + r;
}

export function formatTable(columns: string[], rows: string[][], maxWidth: number): { header: string; lines: string[] } {
  const gap = 2;
  const widths = columns.map((c, i) => Math.max(displayWidth(c), ...rows.map((r) => displayWidth(r[i] ?? ""))));
  let total = widths.reduce((a, b) => a + b, 0) + gap * (columns.length - 1);
  while (total > maxWidth) {
    const widest = Math.max(...widths);
    if (widest <= 4) break;
    widths[widths.indexOf(widest)]--;
    total--;
  }
  const line = (cells: string[]) => cells.map((c, i) => pad(c ?? "", widths[i])).join(" ".repeat(gap)).trimEnd();
  return { header: line(columns), lines: rows.map(line) };
}
```

`packages/tui/src/ui/page-model.ts`:
```ts
import { markdownToLines } from "../core/markdown";
import type { PageData, PageRef } from "../core/types";
import { formatTable, padLine } from "./format";

export type LineStyle =
  | "heading" | "header" | "row" | "item" | "kv" | "h1" | "h2" | "h3" | "bullet" | "code" | "quote" | "rule" | "body" | "blank"
  | "info" | "warn" | "error";
export type PageLine = { key: string; text: string; style: LineStyle; target?: PageRef };

export function pageLines(page: PageData, width: number): PageLine[] {
  const out: PageLine[] = [];
  page.blocks.forEach((b, bi) => {
    if (bi > 0) out.push({ key: `gap${bi}`, text: "", style: "blank" });
    switch (b.kind) {
      case "kv": {
        if (b.heading) out.push({ key: `h${bi}`, text: b.heading, style: "heading" });
        const kw = Math.max(0, ...b.pairs.map(([k]) => k.length));
        b.pairs.forEach(([k, v], i) => out.push({ key: `kv${bi}-${i}`, text: `${k.padEnd(kw)}  ${v}`, style: "kv" }));
        break;
      }
      case "list":
        if (b.heading) out.push({ key: `h${bi}`, text: b.heading, style: "heading" });
        for (const it of b.items) {
          const left = `${it.target ? "▸" : " "} ${it.label}${it.detail ? `  ${it.detail}` : ""}`;
          out.push({ key: `i${bi}-${it.key}`, text: padLine(left, it.badge ?? "", width), style: "item", ...(it.target ? { target: it.target } : {}) });
        }
        break;
      case "table": {
        if (b.heading) out.push({ key: `h${bi}`, text: b.heading, style: "heading" });
        const t = formatTable(b.columns, b.rows.map((r) => r.cells), width - 2);
        out.push({ key: `th${bi}`, text: `  ${t.header}`, style: "header" });
        b.rows.forEach((r, i) => out.push({ key: `r${bi}-${r.key}`, text: `${r.target ? "▸" : " "} ${t.lines[i]}`, style: "row", ...(r.target ? { target: r.target } : {}) }));
        break;
      }
      case "markdown":
        markdownToLines(b.text).forEach((m, i) => {
          const text =
            m.kind === "bullet" ? `${"  ".repeat(m.depth ?? 0)}• ${m.text}` : m.kind === "rule" ? "─".repeat(Math.min(width, 40)) : m.kind === "code" ? `  ${m.text}` : m.text;
          out.push({ key: `md${bi}-${i}`, text, style: m.kind });
        });
        break;
      case "notice":
        out.push({ key: `n${bi}`, text: `${b.level === "error" ? "✗" : b.level === "warn" ? "!" : "·"} ${b.text}`, style: b.level });
        break;
    }
  });
  return out;
}

export function selectableIndexes(lines: PageLine[]): number[] {
  return lines.flatMap((l, i) => (l.target ? [i] : []));
}

export function navCount(lines: PageLine[]): number {
  const sel = selectableIndexes(lines).length;
  return sel || lines.length;
}

export function selectedLineIndex(lines: PageLine[], cursor: number): number {
  const sel = selectableIndexes(lines);
  return sel.length ? sel[Math.max(0, Math.min(cursor, sel.length - 1))] : -1;
}

export function windowFor(lines: PageLine[], cursor: number, height: number): number {
  const total = lines.length;
  if (total <= height) return 0;
  const selected = selectedLineIndex(lines, cursor);
  if (selected < 0) return Math.max(0, Math.min(cursor, total - height));
  // keep the selection visible with the least scrolling: it rides the bottom edge going down
  return Math.max(0, Math.min(selected, total - height, Math.max(0, selected - height + 1)));
}

export function targetAt(lines: PageLine[], cursor: number): PageRef | undefined {
  const i = selectedLineIndex(lines, cursor);
  return i >= 0 ? lines[i].target : undefined;
}
```
`packages/tui/src/ui/transcript-view.ts`:
```ts
import type { TranscriptEntry } from "../core/transcript";
import { displayWidth } from "./format";

export type TLine = { text: string; style: "user" | "assistant" | "tool-running" | "tool-ok" | "tool-error" | "info" | "warn" | "error" | "dim" };

export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      let w = word;
      while (displayWidth(w) > width) {
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!w) continue;
      const candidate = line ? `${line} ${w}` : w;
      if (displayWidth(candidate) > width) {
        out.push(line);
        line = w;
      } else line = candidate;
    }
    if (line) out.push(line);
  }
  return out;
}

export function transcriptLines(entries: TranscriptEntry[], width: number): TLine[] {
  const w = Math.max(10, width);
  const out: TLine[] = [];
  for (const e of entries) {
    switch (e.kind) {
      case "user":
        wrap(e.text, w - 2).forEach((l, i) => out.push({ text: `${i ? "  " : "› "}${l}`, style: "user" }));
        break;
      case "assistant": {
        const lines = wrap(e.text + (e.streaming ? "▍" : ""), w);
        lines.forEach((l) => out.push({ text: l, style: "assistant" }));
        break;
      }
      case "tool": {
        const mark = e.status === "running" ? "…" : e.status === "ok" ? "✓" : "✗";
        out.push({ text: `${mark} ${e.tool} ${e.summary}`.slice(0, w * 2), style: e.status === "running" ? "tool-running" : e.status === "ok" ? "tool-ok" : "tool-error" });
        if (e.status === "error" && e.result) out.push({ text: `  ${e.result}`, style: "dim" });
        break;
      }
      case "notice":
        wrap(e.text, w - 2).forEach((l, i) => out.push({ text: `${i ? "  " : e.level === "error" ? "✗ " : e.level === "warn" ? "! " : "· "}${l}`, style: e.level }));
        break;
    }
  }
  return out;
}
```

`packages/tui/src/ui/palette-model.ts`:
```ts
import type { ActionDef } from "../core/actions";
import type { CockpitSnapshot } from "../core/cockpit";
import { PAGE_INDEX } from "../core/pages";
import type { Command } from "../core/types";

export type PaletteAction = { kind: "command"; command: Command } | { kind: "ui"; ui: "toggle-agent" | "help" };
export type PaletteEntry = { id: string; label: string; hint?: string; action: PaletteAction };

function actionEntry(a: ActionDef): PaletteEntry {
  if (a.kind === "launch") return { id: `action:${a.id}`, label: a.label, action: { kind: "command", command: { type: "launch", host: a.host, placement: a.placement } } };
  return { id: `action:${a.id}`, label: a.label, action: { kind: "command", command: { type: "run-action", actionId: a.id } } };
}

export const launchEntries = (actions: ActionDef[]) => actions.filter((a) => a.kind === "launch").map(actionEntry);
export const actionEntries = (actions: ActionDef[]) => actions.filter((a) => a.kind !== "launch").map(actionEntry);

export function buildEntries(snap: Pick<CockpitSnapshot, "fleet">, actions: ActionDef[]): PaletteEntry[] {
  return [
    ...PAGE_INDEX.map((p) => ({ id: `page:${p.page}`, label: `Go to ${p.label}`, action: { kind: "command" as const, command: { type: "open-page" as const, ref: { page: p.page } } } })),
    ...snap.fleet.map((r) => ({
      id: `ws:${r.info.id}`,
      label: `Switch to ${r.summary?.name ?? r.info.label}`,
      hint: r.info.kind,
      action: { kind: "command" as const, command: { type: "select-workspace" as const, id: r.info.id } },
    })),
    ...actions.map(actionEntry),
    { id: "ui:agent", label: "Toggle agent pane", action: { kind: "ui", ui: "toggle-agent" } },
    { id: "ui:help", label: "Help", action: { kind: "ui", ui: "help" } },
  ];
}

// Case-insensitive subsequence match; consecutive runs and word starts score higher.
export function scoreEntry(label: string, q: string): number | null {
  const l = label.toLowerCase();
  const query = q.toLowerCase().replace(/\s+/g, "");
  if (!query) return 0;
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of query) {
    const i = l.indexOf(ch, from);
    if (i < 0) return null;
    score += i === prev + 1 ? 3 : 1;
    if (i === 0 || l[i - 1] === " ") score += 2;
    score -= Math.min(3, i - from);
    prev = i;
    from = i + 1;
  }
  return score;
}

export function filterEntries(entries: PaletteEntry[], q: string): PaletteEntry[] {
  if (!q.trim()) return entries;
  return entries
    .map((e, i) => ({ e, i, s: scoreEntry(e.label, q) }))
    .filter((x) => x.s !== null)
    .sort((a, b) => b.s! - a.s! || a.i - b.i)
    .map((x) => x.e);
}
```

- [ ] **Step 4: Run — expect PASS**, then commit.

```bash
npm test --prefix packages/tui
git add packages/tui/src/ui packages/tui/test/ui
git commit -m "feat(tui): UI models — key routing, layout, width-aware formatting, page and transcript lines, palette" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: UI shell — store, App, Header, Rail, PageView, StatusBar

**Files:**
- Create: `packages/tui/src/ui/{store.ts,App.tsx,Header.tsx,Rail.tsx,PageView.tsx,StatusBar.tsx}`
- Create (stubs completed in Task 17): `packages/tui/src/ui/AgentPane.tsx`, `packages/tui/src/ui/overlays/{Palette,Help,PermissionDialog}.tsx`
- Test: `packages/tui/test/ui/app.test.tsx`, helper `packages/tui/test/helpers/fake-cockpit.ts`

**Interfaces:**
- Consumes: `CockpitLike`, `CockpitSnapshot`, `CoreEvents`, `Emitter`, Task 15 models.
- Produces: `createCockpitStore(cockpit) → { snap: Accessor<CockpitSnapshot>; toasts: Accessor<Notice[]>; dispose() }`; `App(props: { cockpit: CockpitLike; onQuit: () => void; runForeground?: (fx: ForegroundEffect) => Promise<void>; initialAgentOpen?: boolean })`; `Header`, `Rail`, `PageView`, `StatusBar` components (props shown in code).

OpenTUI prop names used below — `border`, `borderColor`, `title`, `flexDirection`, `flexGrow`, `width`, `height`, `position="absolute"`, `left`, `top`, `zIndex`, `backgroundColor` on `<box>`; `fg`, `bg` on `<text>`. If Bun reports an unknown prop, check `node_modules/@opentui/core/renderables/Box.d.ts` / `Text.d.ts` for the exact name and adjust only that prop.

- [ ] **Step 1: Fake cockpit helper** — `packages/tui/test/helpers/fake-cockpit.ts`

```ts
import { Emitter } from "../../src/core/bus";
import { actionsFor } from "../../src/core/actions";
import type { CockpitLike, CockpitSnapshot, CoreEvents } from "../../src/core/cockpit";
import type { Command } from "../../src/core/types";

export function baseSnapshot(over: Partial<CockpitSnapshot> = {}): CockpitSnapshot {
  const row = (id: string, label: string, kind: any, extra: any = {}) => ({
    info: { id, label, root: `/v/${id}`, kind, exists: true, drift: 0 },
    summary: { id, name: label, type: null, git: { branch: "main", dirty: false, ahead: 0, behind: 0, lastCommit: null }, openTasks: 3, urgentTasks: 1, lastMemory: "2026-09-24", errors: [] },
    agents: [],
    ...extra,
  });
  return {
    fleet: [
      row("hub", "🧬 LF Hub", "hub"),
      row("fw", "org-os", "framework"),
      row("inst-a", "ReFi BCN", "instance", { agents: [{ paneId: "w1:p2", workspaceId: "w1", name: "bcn-claude", agent: "claude", status: "working", cwd: "/v/inst-a", title: null }] }),
    ],
    activeId: "hub",
    activeName: "🧬 LF Hub",
    activeGit: { branch: "main", dirty: true, ahead: 0, behind: 0, lastCommit: "1 hour ago" },
    activeUrgent: 1,
    page: {
      ref: { page: "dashboard" },
      title: "LF Hub",
      subtitle: "hub",
      actions: [],
      sources: [],
      errors: [],
      blocks: [
        { kind: "list", heading: "Urgent", items: [{ key: "a", label: "Pay invoices", target: { page: "tasks" } }, { key: "b", label: "Grant report", badge: "2d", target: { page: "this-week" } }] },
        { kind: "table", heading: "Projects", columns: ["Project", "Stage"], rows: [{ key: "c", cells: ["Cockpit", "Develop"], target: { page: "project", id: "cockpit" } }] },
      ],
    },
    canGoBack: false,
    transcript: [{ kind: "user", text: "status?" }, { kind: "assistant", text: "All green.", streaming: false }],
    agentStatus: "idle",
    agentModel: "anthropic/claude-opus-5",
    agentAvailable: true,
    permissions: [],
    herdr: { available: true, agents: 1 },
    loading: false,
    ...over,
  };
}

export function fakeCockpit(over: Partial<CockpitSnapshot> = {}) {
  const events = new Emitter<CoreEvents>();
  const dispatched: Command[] = [];
  let snap = baseSnapshot(over);
  const cockpit: CockpitLike = {
    events,
    snapshot: () => snap,
    dispatch: async (c) => {
      dispatched.push(c);
    },
    actions: () => actionsFor(null),
  };
  return {
    cockpit,
    dispatched,
    set(next: Partial<CockpitSnapshot>) {
      snap = { ...snap, ...next };
      events.emit("state", snap);
    },
  };
}
```

- [ ] **Step 2: Failing tests** — `packages/tui/test/ui/app.test.tsx`

```tsx
import { test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../../src/ui/App";
import { fakeCockpit } from "../helpers/fake-cockpit";

async function mount(width: number, height: number, over = {}) {
  const f = fakeCockpit(over);
  let quits = 0;
  const t = await testRender(() => <App cockpit={f.cockpit} onQuit={() => quits++} />, { width, height });
  await t.renderOnce();
  return { ...f, t, quits: () => quits };
}
const settle = async (t: any) => {
  await new Promise((r) => setTimeout(r, 20));
  await t.renderOnce();
};

test("three-column layout at 160×45", async () => {
  const { t } = await mount(160, 45);
  const f = t.captureCharFrame();
  expect(f).toContain("FLEET");
  expect(f).toContain("ReFi BCN");
  expect(f).toContain("LF Hub · hub");
  expect(f).toContain("Pay invoices");
  expect(f).toContain("AGENT · pi");
  expect(f).toContain("All green.");
  expect(f).toContain("herdr ● 1 agents");
});

test("page selection and drill-down", async () => {
  const { t, dispatched } = await mount(160, 45);
  t.mockInput.pressKey("j");
  t.mockInput.pressEnter();
  await settle(t);
  expect(dispatched).toEqual([{ type: "open-page", ref: { page: "this-week" } }]);
  t.mockInput.pressEscape();
  await settle(t);
  expect(dispatched.at(-1)).toEqual({ type: "back" });
});

test("rail navigation switches workspace", async () => {
  const { t, dispatched } = await mount(160, 45);
  t.mockInput.pressTab({ shift: true });
  await settle(t);
  t.mockInput.pressKey("j");
  t.mockInput.pressEnter();
  await settle(t);
  expect(dispatched).toEqual([{ type: "select-workspace", id: "fw" }]);
});

test("number keys jump; q quits when idle", async () => {
  const { t, dispatched, quits } = await mount(160, 45);
  t.mockInput.pressKey("3");
  await settle(t);
  expect(dispatched).toEqual([{ type: "select-workspace", id: "inst-a" }]);
  t.mockInput.pressKey("q");
  await settle(t);
  expect(quits()).toBe(1);
});

test("q while the agent works asks twice", async () => {
  const { t, quits } = await mount(160, 45, { agentStatus: "working" });
  t.mockInput.pressKey("q");
  await settle(t);
  expect(quits()).toBe(0);
  expect(t.captureCharFrame()).toContain("press q again");
  t.mockInput.pressKey("q");
  await settle(t);
  expect(quits()).toBe(1);
});

test("80×24 hides rail and agent; ctrl+a opens the agent overlay", async () => {
  const { t } = await mount(80, 24);
  let f = t.captureCharFrame();
  expect(f).not.toContain("FLEET");
  expect(f).not.toContain("AGENT · pi");
  t.mockInput.pressKey("a", { ctrl: true });
  await settle(t);
  f = t.captureCharFrame();
  expect(f).toContain("AGENT · pi");
});

test("snapshot updates re-render", async () => {
  const { t, set } = await mount(160, 45);
  set({ activeName: "Renamed WS" });
  await settle(t);
  expect(t.captureCharFrame()).toContain("Renamed WS");
});
```
(At `mount(80, 24)`, `initialAgentOpen` defaults to true, but the layout at < 100 columns shows the agent only as an overlay that starts **closed** — see `App`'s `agentOpen` initialisation: open by default only when width ≥ 140.)

- [ ] **Step 3: Run — expect failure.** `npm test --prefix packages/tui`

- [ ] **Step 4: Implement**

`packages/tui/src/ui/store.ts`:
```ts
import { createSignal, type Accessor } from "solid-js";
import type { CockpitLike, CockpitSnapshot } from "../core/cockpit";
import type { Notice } from "../core/types";

export function createCockpitStore(cockpit: CockpitLike): { snap: Accessor<CockpitSnapshot>; toasts: Accessor<Notice[]>; dispose: () => void } {
  const [snap, setSnap] = createSignal<CockpitSnapshot>(cockpit.snapshot());
  const [toasts, setToasts] = createSignal<Notice[]>([]);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const offState = cockpit.events.on("state", (s) => setSnap(s));
  const offNotice = cockpit.events.on("notice", (n) => {
    setToasts((t) => [...t, n].slice(-3));
    const timer = setTimeout(() => {
      timers.delete(timer);
      setToasts((t) => t.filter((x) => x !== n));
    }, 6000);
    timers.add(timer);
  });
  return {
    snap,
    toasts,
    dispose: () => {
      offState();
      offNotice();
      timers.forEach(clearTimeout);
    },
  };
}
```

`packages/tui/src/ui/Header.tsx`:
```tsx
import type { CockpitSnapshot } from "../core/cockpit";
import { displayWidth, truncate } from "./format";
import { theme } from "./theme";

const GLYPH: Record<string, string> = { idle: "○", working: "◐", blocked: "◆", error: "✗" };

export function Header(props: { snap: CockpitSnapshot; width: number }) {
  const left = () => {
    const s = props.snap;
    const g = s.activeGit;
    return `org-os · ${s.activeName}${g ? ` · ${g.branch ?? "?"}${g.dirty ? " ●" : ""}` : ""}${s.activeUrgent ? ` · ${s.activeUrgent} urgent` : ""}${s.loading ? " · loading…" : ""}`;
  };
  const right = () => {
    const s = props.snap;
    const parts: string[] = [];
    if (s.herdr.available) parts.push(`herdr ● ${s.herdr.agents} agents`);
    if (s.agentAvailable) parts.push(`pi ${GLYPH[s.agentStatus] ?? "○"} ${s.agentStatus}`);
    return parts.join(" · ");
  };
  return (
    <box flexDirection="row" height={1} width="100%">
      <text fg={theme.primary}>{truncate(left(), Math.max(10, props.width - displayWidth(right()) - 2))}</text>
      <box flexGrow={1} />
      <text fg={theme.dim}>{right()}</text>
    </box>
  );
}
```

`packages/tui/src/ui/Rail.tsx`:
```tsx
import { For } from "solid-js";
import type { FleetRow } from "../core/pages";
import { padLine } from "./format";
import { theme } from "./theme";

const MARK: Record<string, string> = { hub: "H", framework: "F", instance: "·", extra: "+" };

export function Rail(props: { rows: FleetRow[]; activeId: string | null; index: number; focused: boolean; width: number }) {
  return (
    <box flexDirection="column" width={props.width} height="100%" border borderColor={props.focused ? theme.borderFocus : theme.border} title="FLEET">
      <For each={props.rows}>
        {(row, i) => {
          const label = () => `${MARK[row.info.kind] ?? "·"} ${i() < 9 ? i() + 1 : " "} ${row.summary?.name ?? row.info.label}`;
          const badges = () =>
            [row.summary?.urgentTasks ? `${row.summary.urgentTasks}!` : "", !row.info.exists ? "missing" : row.info.drift ? "drift" : "", row.agents.length ? `◆${row.agents.length}` : ""]
              .filter(Boolean)
              .join(" ");
          const color = () => (row.info.id === props.activeId ? theme.accent : row.info.exists ? theme.fg : theme.dim);
          return (
            <text fg={color()} bg={props.focused && i() === props.index ? theme.selBg : undefined}>
              {padLine(label(), badges(), props.width - 2)}
            </text>
          );
        }}
      </For>
    </box>
  );
}
```

`packages/tui/src/ui/PageView.tsx`:
```tsx
import { For } from "solid-js";
import type { PageData } from "../core/types";
import { truncate } from "./format";
import type { LineStyle, PageLine } from "./page-model";
import { selectedLineIndex, windowFor } from "./page-model";
import { theme } from "./theme";

function color(style: LineStyle): string {
  switch (style) {
    case "heading":
    case "h1":
    case "h2":
      return theme.accent;
    case "h3":
    case "header":
      return theme.primary;
    case "code":
    case "quote":
    case "rule":
      return theme.dim;
    case "warn":
      return theme.warn;
    case "error":
      return theme.error;
    case "info":
      return theme.accent;
    default:
      return theme.fg;
  }
}

export function PageView(props: { page: PageData | null; lines: PageLine[]; cursor: number; focused: boolean; width: number; height: number }) {
  const body = () => Math.max(1, props.height - 2);
  const selected = () => selectedLineIndex(props.lines, props.cursor);
  const start = () => windowFor(props.lines, props.cursor, body());
  const visible = () => props.lines.slice(start(), start() + body());
  const title = () => (props.page ? `${props.page.title}${props.page.subtitle ? ` · ${props.page.subtitle}` : ""}` : "loading…");
  return (
    <box flexDirection="column" flexGrow={1} height="100%" border borderColor={props.focused ? theme.borderFocus : theme.border} title={truncate(title(), Math.max(4, props.width - 4))}>
      <For each={visible()}>
        {(line, i) => (
          <text fg={color(line.style)} bg={props.focused && start() + i() === selected() ? theme.selBg : undefined}>
            {truncate(line.text, Math.max(1, props.width - 2)) || " "}
          </text>
        )}
      </For>
    </box>
  );
}
```

`packages/tui/src/ui/StatusBar.tsx`:
```tsx
import type { Notice } from "../core/types";
import { displayWidth, truncate } from "./format";
import type { Focus } from "./keys";
import { levelColor, theme } from "./theme";

const HINTS: Record<Focus, string> = {
  rail: "j/k move · enter open · 1-9 jump · tab focus · ctrl+p palette · ? help · q quit",
  page: "j/k move · enter open · esc back · a actions · L launch · e edit · r refresh · ctrl+a agent · ? help",
  agent: "enter send · esc leave · ctrl+x abort · ctrl+n new session · tab focus",
};

export function StatusBar(props: { focus: Focus; toast: Notice | null; message: string | null; width: number }) {
  const right = () => props.message ?? (props.toast ? truncate(props.toast.text, Math.floor(props.width / 2)) : "");
  const rightColor = () => (props.message ? theme.warn : props.toast ? levelColor(props.toast.level) : theme.dim);
  return (
    <box flexDirection="row" height={1} width="100%">
      <text fg={theme.dim}>{truncate(HINTS[props.focus], Math.max(10, props.width - displayWidth(right()) - 2))}</text>
      <box flexGrow={1} />
      <text fg={rightColor()}>{right()}</text>
    </box>
  );
}
```

Stubs so `App` compiles now (replaced in Task 17):

`packages/tui/src/ui/AgentPane.tsx`:
```tsx
import type { CockpitSnapshot } from "../core/cockpit";
import { theme } from "./theme";

export function AgentPane(props: { snap: CockpitSnapshot; focused: boolean; width: number; height: number; onSubmit: (text: string) => void }) {
  return (
    <box flexDirection="column" width={props.width} height="100%" border borderColor={props.focused ? theme.borderFocus : theme.border} title="AGENT · pi">
      <text fg={theme.dim}>…</text>
    </box>
  );
}
```
`packages/tui/src/ui/overlays/Palette.tsx`:
```tsx
import type { PaletteEntry } from "../palette-model";

export function Palette(_props: { title: string; entries: PaletteEntry[]; width: number; height: number; onSelect: (e: PaletteEntry) => void; onClose: () => void }) {
  return <box />;
}
```
`packages/tui/src/ui/overlays/Help.tsx`:
```tsx
export function Help(_props: { width: number; height: number; onClose: () => void }) {
  return <box />;
}
```
`packages/tui/src/ui/overlays/PermissionDialog.tsx`:
```tsx
import type { PermissionAnswer, PermissionRequest } from "../../core/types";

export function PermissionDialog(_props: { request: PermissionRequest; queued: number; workspaceLabel: string; width: number; onAnswer: (a: PermissionAnswer) => void }) {
  return <box />;
}
```

`packages/tui/src/ui/App.tsx`:
```tsx
import { createEffect, createMemo, createSignal, ErrorBoundary, onCleanup, Show } from "solid-js";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import type { CockpitLike } from "../core/cockpit";
import type { Command, ForegroundEffect } from "../core/types";
import { AgentPane } from "./AgentPane";
import { Header } from "./Header";
import { routeKey, type Focus } from "./keys";
import { computeLayout, regionsFor } from "./layout";
import { navCount, pageLines, targetAt } from "./page-model";
import { actionEntries, buildEntries, launchEntries, type PaletteEntry } from "./palette-model";
import { PageView } from "./PageView";
import { Rail } from "./Rail";
import { StatusBar } from "./StatusBar";
import { createCockpitStore } from "./store";
import { theme } from "./theme";
import { Help } from "./overlays/Help";
import { Palette } from "./overlays/Palette";
import { PermissionDialog } from "./overlays/PermissionDialog";

export type AppProps = {
  cockpit: CockpitLike;
  onQuit: () => void;
  runForeground?: (fx: ForegroundEffect) => Promise<void>;
  initialAgentOpen?: boolean;
};
type Overlay = null | { kind: "palette"; title: string; entries: PaletteEntry[] } | { kind: "help" };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function App(props: AppProps) {
  const store = createCockpitStore(props.cockpit);
  onCleanup(store.dispose);
  const snap = store.snap;
  const dims = useTerminalDimensions();
  const [agentOpen, setAgentOpen] = createSignal(dims().width >= 140 ? (props.initialAgentOpen ?? true) : false);
  const layout = createMemo(() => computeLayout(dims().width, agentOpen()));
  const [focus, setFocus] = createSignal<Focus>("page");
  const [railIndex, setRailIndex] = createSignal(0);
  const [cursor, setCursor] = createSignal(0);
  const [overlay, setOverlay] = createSignal<Overlay>(null);
  const [message, setMessage] = createSignal<string | null>(null);
  let quitArmed = false;
  let forceArmed = false;

  const pageWidth = () => Math.max(20, dims().width - layout().rail - (layout().agentOverlay ? 0 : layout().agent));
  const bodyHeight = () => Math.max(3, dims().height - 2);
  const lines = createMemo(() => (snap().page ? pageLines(snap().page!, pageWidth() - 2) : []));
  const dialogOpen = () => snap().permissions.length > 0;
  const modal = () => overlay() !== null || dialogOpen();

  let lastPage = "";
  createEffect(() => {
    const key = `${snap().activeId}|${JSON.stringify(snap().page?.ref ?? null)}`;
    if (key !== lastPage) {
      lastPage = key;
      setCursor(0);
    }
  });
  createEffect(() => {
    if (focus() === "rail") return;
    const i = snap().fleet.findIndex((r) => r.info.id === snap().activeId);
    if (i >= 0) setRailIndex(i);
  });
  createEffect(() => {
    if (!regionsFor(layout(), agentOpen()).includes(focus())) setFocus("page");
  });

  const dispatch = async (cmd: Command) => {
    const withCols = cmd.type === "launch" ? { ...cmd, paneCols: dims().width } : cmd;
    const fx = await props.cockpit.dispatch(withCols);
    if (fx && props.runForeground) await props.runForeground(fx);
  };

  const runEntry = (e: PaletteEntry) => {
    setOverlay(null);
    if (e.action.kind === "command") void dispatch(e.action.command);
    else if (e.action.ui === "help") setOverlay({ kind: "help" });
    else toggleAgent();
  };

  const toggleAgent = () => {
    const open = !agentOpen();
    setAgentOpen(open);
    setFocus(open ? "agent" : "page");
  };

  const cycle = (delta: number) => {
    const regions = regionsFor(layout(), agentOpen());
    const i = Math.max(0, regions.indexOf(focus()));
    setFocus(regions[(i + delta + regions.length) % regions.length]);
  };

  useKeyboard((key) => {
    const intent = routeKey(key, { focus: focus(), overlay: modal() });
    if (!intent) return;
    if (intent.type !== "quit") quitArmed = false;
    if (intent.type !== "force-quit") forceArmed = false;
    if (intent.type !== "quit" && intent.type !== "force-quit") setMessage(null);
    switch (intent.type) {
      case "force-quit":
        if (forceArmed) return props.onQuit();
        forceArmed = true;
        setMessage("press ctrl+c again to quit");
        return;
      case "quit":
        if (snap().agentStatus !== "working" || quitArmed) return props.onQuit();
        quitArmed = true;
        setMessage("pi is working — press q again to quit");
        return;
      case "focus-next":
        return cycle(1);
      case "focus-prev":
        return cycle(-1);
      case "blur":
        return setFocus("page");
      case "move":
        if (focus() === "rail") setRailIndex((i) => clamp(i + intent.delta, 0, snap().fleet.length - 1));
        else setCursor((c) => clamp(c + intent.delta, 0, Math.max(0, navCount(lines()) - 1)));
        return;
      case "top":
        return focus() === "rail" ? setRailIndex(0) : setCursor(0);
      case "bottom":
        return focus() === "rail" ? setRailIndex(snap().fleet.length - 1) : setCursor(Math.max(0, navCount(lines()) - 1));
      case "open": {
        if (focus() === "rail") {
          const row = snap().fleet[railIndex()];
          if (row) void dispatch({ type: "select-workspace", id: row.info.id });
          setFocus("page");
          return;
        }
        const target = targetAt(lines(), cursor());
        if (target) void dispatch({ type: "open-page", ref: target });
        return;
      }
      case "back":
        return void dispatch({ type: "back" });
      case "refresh":
        return void dispatch({ type: "refresh" });
      case "open-source":
        return void dispatch({ type: "run-action", actionId: "open-source" });
      case "jump": {
        const row = snap().fleet[intent.index];
        if (row) void dispatch({ type: "select-workspace", id: row.info.id });
        return;
      }
      case "palette":
        return setOverlay({ kind: "palette", title: "Command palette", entries: buildEntries(snap(), props.cockpit.actions()) });
      case "actions":
        return setOverlay({ kind: "palette", title: "Actions", entries: actionEntries(props.cockpit.actions()) });
      case "launch-menu":
        return setOverlay({ kind: "palette", title: "Launch a host", entries: launchEntries(props.cockpit.actions()) });
      case "help":
        return setOverlay({ kind: "help" });
      case "toggle-agent":
        return toggleAgent();
      case "new-session":
        return void dispatch({ type: "agent-new-session" });
      case "abort":
        return void dispatch({ type: "agent-abort" });
    }
  });

  const activeLabel = () => snap().fleet.find((r) => r.info.id === snap().permissions[0]?.workspace)?.info.label ?? snap().permissions[0]?.workspace ?? "";

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header snap={snap()} width={dims().width} />
      <box flexDirection="row" flexGrow={1}>
        <Show when={layout().showRail}>
          <Rail rows={snap().fleet} activeId={snap().activeId} index={railIndex()} focused={focus() === "rail" && !modal()} width={layout().rail} />
        </Show>
        <ErrorBoundary fallback={(err: Error) => <text fg={theme.error}>{`This view crashed: ${err?.message ?? err} — press r to reload, or switch workspace.`}</text>}>
          <PageView page={snap().page} lines={lines()} cursor={cursor()} focused={focus() === "page" && !modal()} width={pageWidth()} height={bodyHeight()} />
        </ErrorBoundary>
        <Show when={layout().agent > 0 && !layout().agentOverlay}>
          <AgentPane snap={snap()} focused={focus() === "agent" && !modal()} width={layout().agent} height={bodyHeight()} onSubmit={(text) => void dispatch({ type: "agent-prompt", text })} />
        </Show>
      </box>
      <StatusBar focus={focus()} toast={store.toasts().at(-1) ?? null} message={message()} width={dims().width} />
      <Show when={layout().agent > 0 && layout().agentOverlay}>
        <box position="absolute" left={dims().width - layout().agent} top={1} width={layout().agent} height={bodyHeight()} zIndex={10} backgroundColor={theme.bg}>
          <AgentPane snap={snap()} focused={focus() === "agent" && !modal()} width={layout().agent} height={bodyHeight()} onSubmit={(text) => void dispatch({ type: "agent-prompt", text })} />
        </box>
      </Show>
      <Show when={overlay()?.kind === "palette"}>
        <Palette title={(overlay() as any).title} entries={(overlay() as any).entries} width={dims().width} height={dims().height} onSelect={runEntry} onClose={() => setOverlay(null)} />
      </Show>
      <Show when={overlay()?.kind === "help"}>
        <Help width={dims().width} height={dims().height} onClose={() => setOverlay(null)} />
      </Show>
      <Show when={dialogOpen()}>
        <PermissionDialog
          request={snap().permissions[0]}
          queued={snap().permissions.length}
          workspaceLabel={activeLabel()}
          width={dims().width}
          onAnswer={(answer) => void dispatch({ type: "permission-answer", id: snap().permissions[0].id, answer })}
        />
      </Show>
    </box>
  );
}
```
Note on the "q while the agent works" test: the message line reads `pi is working — press q again to quit`, which contains the asserted `press q again`.

- [ ] **Step 5: Run — expect PASS** (the overlay tests arrive in Task 17), then commit.

```bash
npm test --prefix packages/tui
git add packages/tui/src/ui packages/tui/test/ui/app.test.tsx packages/tui/test/helpers/fake-cockpit.ts
git commit -m "feat(tui): cockpit shell — header, fleet rail, page view, status bar, key routing" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: agent pane and overlays — palette, help, permission dialog

**Files:**
- Modify (replace stubs): `packages/tui/src/ui/AgentPane.tsx`, `packages/tui/src/ui/overlays/{Palette,Help,PermissionDialog}.tsx`
- Test: `packages/tui/test/ui/overlays.test.tsx`

**Interfaces:**
- `AgentPane(props: { snap: CockpitSnapshot; focused: boolean; width: number; height: number; onSubmit: (text: string) => void })`
- `Palette(props: { title: string; entries: PaletteEntry[]; width: number; height: number; onSelect: (e: PaletteEntry) => void; onClose: () => void })`
- `Help(props: { width: number; height: number; onClose: () => void })`
- `PermissionDialog(props: { request: PermissionRequest; queued: number; workspaceLabel: string; width: number; onAnswer: (a: PermissionAnswer) => void })`

- [ ] **Step 1: Failing tests** — `packages/tui/test/ui/overlays.test.tsx`

```tsx
import { test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../../src/ui/App";
import { fakeCockpit } from "../helpers/fake-cockpit";

const settle = async (t: any) => {
  await new Promise((r) => setTimeout(r, 20));
  await t.renderOnce();
};
async function mount(over = {}, width = 160, height = 45) {
  const f = fakeCockpit(over);
  let quits = 0;
  const t = await testRender(() => <App cockpit={f.cockpit} onQuit={() => quits++} />, { width, height });
  await t.renderOnce();
  return { ...f, t, quits: () => quits };
}

test("typing into the agent input sends a prompt and never fires shortcuts", async () => {
  const { t, dispatched, quits } = await mount();
  t.mockInput.pressTab(); // page → agent
  await settle(t);
  await t.mockInput.typeText("quit jq 3");
  t.mockInput.pressEnter();
  await settle(t);
  expect(dispatched).toEqual([{ type: "agent-prompt", text: "quit jq 3" }]);
  expect(quits()).toBe(0);
  expect(t.captureCharFrame()).not.toContain("quit jq 3"); // input cleared after send
});

test("agent pane shows transcript, model and status", async () => {
  const { t } = await mount({
    transcript: [
      { kind: "user", text: "run tests" },
      { kind: "tool", callId: "1", tool: "bash", summary: "npm test", status: "error", result: "BLOCKED by guard" },
      { kind: "assistant", text: "Streaming", streaming: true },
    ],
    agentStatus: "working",
  });
  const f = t.captureCharFrame();
  expect(f).toContain("anthropic/claude-opus-5");
  expect(f).toContain("› run tests");
  expect(f).toContain("✗ bash npm test");
  expect(f).toContain("BLOCKED by guard");
  expect(f).toContain("Streaming▍");
});

test("palette filters and runs an entry", async () => {
  const { t, dispatched } = await mount();
  t.mockInput.pressKey("p", { ctrl: true });
  await settle(t);
  expect(t.captureCharFrame()).toContain("Command palette");
  await t.mockInput.typeText("decisions");
  await settle(t);
  t.mockInput.pressEnter();
  await settle(t);
  expect(dispatched).toEqual([{ type: "open-page", ref: { page: "decisions" } }]);
  expect(t.captureCharFrame()).not.toContain("Command palette");
});

test("launch menu passes the terminal width for split direction", async () => {
  const { t, dispatched } = await mount();
  t.mockInput.pressKey("l", { shift: true });
  await settle(t);
  expect(t.captureCharFrame()).toContain("Launch a host");
  t.mockInput.pressEnter();
  await settle(t);
  expect(dispatched).toEqual([{ type: "launch", host: "claude", placement: "split", paneCols: 160 }]);
});

test("escape closes the palette without dispatching", async () => {
  const { t, dispatched } = await mount();
  t.mockInput.pressKey("p", { ctrl: true });
  await settle(t);
  t.mockInput.pressEscape();
  await settle(t);
  expect(t.captureCharFrame()).not.toContain("Command palette");
  expect(dispatched).toEqual([]);
});

test("permission dialog answers by key and blocks other shortcuts", async () => {
  const req = { id: "p1", workspace: "hub", tool: "write", summary: "docs/plan.md", input: {} };
  const { t, dispatched } = await mount({ permissions: [req, { ...req, id: "p2" }] });
  const f = t.captureCharFrame();
  expect(f).toContain("Approval needed");
  expect(f).toContain("docs/plan.md");
  expect(f).toContain("1 more waiting");
  t.mockInput.pressKey("j");
  t.mockInput.pressKey("s");
  await settle(t);
  expect(dispatched).toEqual([{ type: "permission-answer", id: "p1", answer: "session" }]);
});

test("help overlay lists keys and closes on escape", async () => {
  const { t } = await mount();
  t.mockInput.pressKey("?");
  await settle(t);
  expect(t.captureCharFrame()).toContain("ctrl+p");
  t.mockInput.pressEscape();
  await settle(t);
  expect(t.captureCharFrame()).not.toContain("Keys");
});
```
(`pressKey("?")` produces the `?` sequence; if OpenTUI's mock encodes it as `name: "/", shift: true`, add that combination to `routeKey`'s help branch and to the keys test.)

- [ ] **Step 2: Run — expect failures.** `npm test --prefix packages/tui`

- [ ] **Step 3: Implement**

`packages/tui/src/ui/AgentPane.tsx`:
```tsx
import { createSignal, For, Show } from "solid-js";
import type { CockpitSnapshot } from "../core/cockpit";
import { truncate } from "./format";
import { theme } from "./theme";
import { transcriptLines, type TLine } from "./transcript-view";

const COLOR: Record<TLine["style"], string> = {
  user: theme.user,
  assistant: theme.fg,
  "tool-running": theme.accent,
  "tool-ok": theme.ok,
  "tool-error": theme.error,
  info: theme.accent,
  warn: theme.warn,
  error: theme.error,
  dim: theme.dim,
};

export function AgentPane(props: { snap: CockpitSnapshot; focused: boolean; width: number; height: number; onSubmit: (text: string) => void }) {
  const [draft, setDraft] = createSignal("");
  const body = () => Math.max(1, props.height - 3);
  const lines = () => transcriptLines(props.snap.transcript, Math.max(10, props.width - 2));
  const visible = () => lines().slice(-body());
  const title = () => `AGENT · pi${props.snap.agentModel ? ` · ${props.snap.agentModel}` : ""} · ${props.snap.agentStatus}`;
  return (
    <box flexDirection="column" width={props.width} height="100%" border borderColor={props.focused ? theme.borderFocus : theme.border} title={truncate(title(), Math.max(4, props.width - 4))}>
      <box flexDirection="column" flexGrow={1}>
        <Show when={props.snap.agentAvailable} fallback={<text fg={theme.dim}>No agent in this mode.</text>}>
          <Show when={visible().length > 0} fallback={<text fg={theme.dim}>Ask pi about this workspace, or type /close, /initialize, /sync…</text>}>
            <For each={visible()}>{(l) => <text fg={COLOR[l.style]}>{truncate(l.text, Math.max(1, props.width - 2)) || " "}</text>}</For>
          </Show>
        </Show>
      </box>
      <input
        focused={props.focused}
        value={draft()}
        placeholder={props.focused ? "message pi — enter to send" : "tab here to type"}
        onInput={(v: string) => setDraft(v)}
        onSubmit={(v: string) => {
          const text = (v ?? draft()).trim();
          if (text) props.onSubmit(text);
          setDraft("");
        }}
      />
    </box>
  );
}
```
If the test shows the input keeping its old text after submit (the controlled `value` not resetting the renderable), wrap the `<input>` in a keyed `<Show keyed when={inputKey()}>` and bump a `inputKey` signal on submit to remount it.

`packages/tui/src/ui/overlays/Palette.tsx`:
```tsx
import { createMemo, createSignal, For, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { truncate } from "../format";
import { filterEntries, type PaletteEntry } from "../palette-model";
import { theme } from "../theme";

export function Palette(props: { title: string; entries: PaletteEntry[]; width: number; height: number; onSelect: (e: PaletteEntry) => void; onClose: () => void }) {
  const [query, setQuery] = createSignal("");
  const [index, setIndex] = createSignal(0);
  const filtered = createMemo(() => filterEntries(props.entries, query()));
  const w = () => Math.max(20, Math.min(72, props.width - 4));
  const rows = () => Math.max(3, Math.min(12, props.height - 8));
  const start = () => Math.max(0, index() - rows() + 1);
  useKeyboard((k) => {
    if (k.name === "escape") return props.onClose();
    if (k.name === "down" || (k.ctrl && k.name === "j")) return setIndex((i) => Math.min(i + 1, Math.max(0, filtered().length - 1)));
    if (k.name === "up" || (k.ctrl && k.name === "k")) return setIndex((i) => Math.max(i - 1, 0));
    if (k.name === "return" || k.name === "enter") {
      const e = filtered()[index()];
      if (e) props.onSelect(e);
    }
  });
  return (
    <box position="absolute" left={Math.floor((props.width - w()) / 2)} top={2} width={w()} height={rows() + 4} zIndex={20} border borderColor={theme.borderFocus} backgroundColor={theme.bg} title={props.title} flexDirection="column">
      <input focused value={query()} placeholder="type to filter" onInput={(v: string) => { setQuery(v); setIndex(0); }} />
      <For each={filtered().slice(start(), start() + rows())}>
        {(e, i) => (
          <text fg={start() + i() === index() ? theme.accent : theme.fg} bg={start() + i() === index() ? theme.selBg : undefined}>
            {truncate(`${e.label}${e.hint ? `  ${e.hint}` : ""}`, w() - 2)}
          </text>
        )}
      </For>
      <Show when={filtered().length === 0}>
        <text fg={theme.dim}>No matches.</text>
      </Show>
    </box>
  );
}
```

`packages/tui/src/ui/overlays/Help.tsx`:
```tsx
import { For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { PAGE_INDEX } from "../../core/pages";
import { theme } from "../theme";

const KEYS: [string, string][] = [
  ["ctrl+p  :", "command palette"],
  ["tab / shift+tab", "move focus: fleet · page · agent"],
  ["j k ↑ ↓  g G", "move · top · bottom"],
  ["enter  esc", "open · back"],
  ["1-9", "jump to workspace"],
  ["a  L  e  r", "actions · launch a host · edit source · refresh"],
  ["ctrl+a  ctrl+n  ctrl+x", "agent pane · new session · abort turn"],
  ["y s n", "approve once · for session · deny (approval dialog)"],
  ["q  ctrl+c ×2", "quit"],
];

export function Help(props: { width: number; height: number; onClose: () => void }) {
  useKeyboard((k) => {
    if (k.name === "escape" || k.name === "q" || k.sequence === "?") props.onClose();
  });
  const w = () => Math.max(30, Math.min(76, props.width - 4));
  return (
    <box position="absolute" left={Math.floor((props.width - w()) / 2)} top={1} width={w()} height={Math.min(props.height - 2, KEYS.length + PAGE_INDEX.length + 6)} zIndex={20} border borderColor={theme.borderFocus} backgroundColor={theme.bg} title="Keys" flexDirection="column">
      <For each={KEYS}>{([key, what]) => <text fg={theme.fg}>{`${key.padEnd(24)}${what}`}</text>}</For>
      <text> </text>
      <text fg={theme.accent}>{`Pages: ${PAGE_INDEX.map((p) => p.label).join(" · ")}`}</text>
    </box>
  );
}
```

`packages/tui/src/ui/overlays/PermissionDialog.tsx`:
```tsx
import { useKeyboard } from "@opentui/solid";
import type { PermissionAnswer, PermissionRequest } from "../../core/types";
import { truncate } from "../format";
import { theme } from "../theme";

export function PermissionDialog(props: { request: PermissionRequest; queued: number; workspaceLabel: string; width: number; onAnswer: (a: PermissionAnswer) => void }) {
  useKeyboard((k) => {
    if (k.ctrl || k.meta) return;
    if (k.name === "y") props.onAnswer("once");
    else if (k.name === "s") props.onAnswer("session");
    else if (k.name === "n" || k.name === "escape") props.onAnswer("deny");
  });
  const w = () => Math.max(30, Math.min(76, props.width - 4));
  return (
    <box position="absolute" left={Math.floor((props.width - w()) / 2)} top={3} width={w()} height={8} zIndex={30} border borderColor={theme.warn} backgroundColor={theme.bg} title="Approval needed" flexDirection="column">
      <text fg={theme.fg}>{truncate(`pi wants to use ${props.request.tool} in ${props.workspaceLabel}`, w() - 2)}</text>
      <text fg={theme.accent}>{truncate(props.request.summary, w() - 2)}</text>
      <text fg={theme.dim}>{props.queued > 1 ? `${props.queued - 1} more waiting` : " "}</text>
      <text fg={theme.fg}>{truncate(`[y] allow once   [s] allow ${props.request.tool} this session   [n] deny`, w() - 2)}</text>
    </box>
  );
}
```

- [ ] **Step 4: Run — expect PASS** (both `app.test.tsx` and `overlays.test.tsx`), then commit.

```bash
npm test --prefix packages/tui
git add packages/tui/src/ui packages/tui/test/ui/overlays.test.tsx
git commit -m "feat(tui): agent pane, command palette, launch menu, help and approval dialog" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: entry point, `--snapshot` mode, end-to-end smoke

**Files:**
- Create: `packages/tui/src/main.tsx`
- Test: `packages/tui/test/main.test.ts`

**Interfaces:**
- Consumes: everything.
- Produces: `main(argv?, env?) → Promise<number | null>` (number = exit code for `--snapshot`; `null` = interactive session running). Run directly with `bun run src/main.tsx` (the launcher does this).

- [ ] **Step 1: Failing test** — `packages/tui/test/main.test.ts`

```ts
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeFleetFixture } from "./helpers/fixtures";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(PKG, "../..");

async function snapshot(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn([process.execPath, "run", "src/main.tsx", "--snapshot", ...args], {
    cwd: PKG,
    env: { ...process.env, ORG_OS_COCKPIT_HOME: mkdtempSync(join(tmpdir(), "ck-home-")), HERDR_ENV: "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { out, err, code };
}

test("snapshot of a fixture fleet", async () => {
  const { fw, instA } = makeFleetFixture();
  const r = await snapshot(["--framework", fw, "--width", "140", "--height", "32"], { ORG_OS_INVOKED_FROM: instA });
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  expect(r.out).toContain("FLEET");
  expect(r.out).toContain("Instance A");
  expect(r.out).toContain("Grant report");
}, 30_000);

test("snapshot of this repository's fleet page", async () => {
  const r = await snapshot(["--page", "fleet", "--width", "160", "--height", "40"], { ORG_OS_INVOKED_FROM: REPO });
  expect(r.code).toBe(0);
  expect(r.out).toContain("Fleet");
  expect(r.out).toContain("org-os");
}, 60_000);
```

- [ ] **Step 2: Run — expect failure.** `npm test --prefix packages/tui`

- [ ] **Step 3: Implement** — `packages/tui/src/main.tsx`

```tsx
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCliRenderer } from "@opentui/core";
import { render, testRender } from "@opentui/solid";
import { piBackend } from "./core/agents/pi";
import { parseArgs } from "./core/args";
import { Cockpit } from "./core/cockpit";
import { configDir, loadConfig, loadUiState, saveUiState } from "./core/config";
import { HerdrClient, herdrBin, inHerdr } from "./core/herdr";
import { run } from "./core/proc";
import type { ForegroundEffect } from "./core/types";
import { App } from "./ui/App";

const HERE = dirname(fileURLToPath(import.meta.url));

export async function main(argv = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<number | null> {
  const args = parseArgs(argv);
  const frameworkRoot = resolve(args.framework ?? resolve(HERE, "../../.."));
  const invokedFrom = env.ORG_OS_INVOKED_FROM || env.INIT_CWD || process.cwd();
  const dir = configDir(env);
  const { config, errors } = loadConfig(dir);
  const uiState = loadUiState(dir);
  const live = !args.snapshot;
  const herdr = live && inHerdr(env) ? new HerdrClient({ run, bin: herdrBin(env) }) : null;

  const cockpit = new Cockpit({
    frameworkRoot,
    invokedFrom,
    flags: { workspace: args.workspace, page: args.page },
    config,
    uiState,
    env,
    backend: live ? piBackend({ frameworkRoot }) : null,
    herdr,
    watch: live ? undefined : null,
    saveUiState: live ? (s) => void saveUiState(dir, s) : undefined,
  });
  errors.forEach((e) => cockpit.notice("warn", e));
  // Never let a stray async error take the cockpit down: surface it and keep running.
  process.on("unhandledRejection", (e) => cockpit.notice("error", `Unexpected error: ${(e as Error)?.message ?? e}`));
  process.on("uncaughtException", (e) => cockpit.notice("error", `Unexpected error: ${e.message}`));
  await cockpit.start();

  if (args.snapshot) {
    const setup = await testRender(() => <App cockpit={cockpit} onQuit={() => {}} initialAgentOpen={uiState.agentOpen ?? true} />, { width: args.width, height: args.height });
    await setup.renderOnce();
    await new Promise((r) => setTimeout(r, 10));
    await setup.renderOnce();
    process.stdout.write(setup.captureCharFrame() + "\n");
    await cockpit.stop();
    return 0;
  }

  const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 });
  let quitting = false;
  const quit = async () => {
    if (quitting) return;
    quitting = true;
    await cockpit.stop();
    renderer.destroy();
    process.exit(0);
  };
  const runForeground = async (fx: ForegroundEffect) => {
    renderer.suspend();
    try {
      spawnSync(fx.cmd, fx.args, { cwd: fx.cwd, stdio: "inherit" });
    } finally {
      renderer.resume();
    }
  };
  await render(() => <App cockpit={cockpit} onQuit={() => void quit()} runForeground={runForeground} initialAgentOpen={uiState.agentOpen ?? true} />, renderer);
  return null;
}

if (import.meta.main) {
  main()
    .then((code) => {
      if (code !== null) process.exit(code);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run — expect PASS.** `npm test --prefix packages/tui`. Then a manual smoke from the repo root (not in a test): `npm run tui -- --snapshot --page fleet` → prints a frame, exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/main.tsx packages/tui/test/main.test.ts
git commit -m "feat(tui): entry point with interactive renderer, suspend-and-run, and --snapshot mode" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: herdr plugin + package docs

**Files:**
- Create: `packages/tui/herdr/herdr-plugin.toml`, `packages/tui/herdr/scripts/{cockpit,open-cockpit,open-cockpit-tab}.sh`, `packages/tui/README.md`
- Test: `packages/tui/test/herdr-plugin.test.ts`

- [ ] **Step 1: Failing test** — `packages/tui/test/herdr-plugin.test.ts`

```ts
import { test, expect } from "bun:test";
import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-ignore — Bun imports TOML natively
import manifest from "../herdr/herdr-plugin.toml";

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../herdr");

test("manifest declares the cockpit pane and both actions", () => {
  expect(manifest.id).toBe("org-os-cockpit");
  expect(manifest.min_herdr_version).toBe("0.9.0");
  expect(manifest.panes).toEqual([{ id: "cockpit", title: "org-os", placement: "split", command: ["./scripts/cockpit.sh"] }]);
  expect(manifest.actions.map((a: any) => a.id)).toEqual(["open-cockpit", "open-cockpit-tab"]);
});

test("scripts are executable and parse", () => {
  for (const s of ["cockpit.sh", "open-cockpit.sh", "open-cockpit-tab.sh"]) {
    const p = join(DIR, "scripts", s);
    expect(statSync(p).mode & 0o111).not.toBe(0);
    const r = Bun.spawnSync(["bash", "-n", p]);
    expect(r.exitCode).toBe(0);
  }
});
```

- [ ] **Step 2: Implement**

`packages/tui/herdr/herdr-plugin.toml`:
```toml
# herdr plugin manifest for the org-os cockpit. Operator installs it with
#   herdr plugin link "<abs path to>/packages/tui/herdr"
# and binds the actions in ~/.config/herdr/config.toml (see packages/tui/README.md).
# Nothing here runs automatically: no [[events]] hooks.
id = "org-os-cockpit"
name = "org-os cockpit"
version = "0.1.0"
description = "org-os fleet cockpit (OpenTUI) in a herdr split or tab."
min_herdr_version = "0.9.0"
platforms = ["linux", "macos"]

[[panes]]
id = "cockpit"
title = "org-os"
placement = "split"
command = ["./scripts/cockpit.sh"]

[[actions]]
id = "open-cockpit"
platforms = ["linux", "macos"]
title = "Open org-os cockpit"
description = "Open the org-os cockpit in a split beside the current pane."
command = ["bash", "scripts/open-cockpit.sh"]

[[actions]]
id = "open-cockpit-tab"
platforms = ["linux", "macos"]
title = "Open org-os cockpit (tab)"
description = "Open the org-os cockpit in its own tab."
command = ["bash", "scripts/open-cockpit-tab.sh"]
```

`packages/tui/herdr/scripts/cockpit.sh`:
```bash
#!/usr/bin/env bash
# Pane entrypoint: run the cockpit launcher from this repository.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export ORG_OS_INVOKED_FROM="${ORG_OS_INVOKED_FROM:-$PWD}"
exec node "$here/../../bin/cockpit.mjs" "$@"
```

`packages/tui/herdr/scripts/open-cockpit.sh`:
```bash
#!/usr/bin/env bash
set -uo pipefail
herdr_bin="${HERDR_BIN_PATH:-herdr}"
exec "$herdr_bin" plugin pane open --plugin org-os-cockpit --entrypoint cockpit --placement split --direction right --focus
```

`packages/tui/herdr/scripts/open-cockpit-tab.sh`:
```bash
#!/usr/bin/env bash
set -uo pipefail
herdr_bin="${HERDR_BIN_PATH:-herdr}"
exec "$herdr_bin" plugin pane open --plugin org-os-cockpit --entrypoint cockpit --placement tab --focus
```
Then: `chmod +x packages/tui/herdr/scripts/*.sh`.

`packages/tui/README.md` — sections, in this order, with real commands:
1. **What it is** — fleet cockpit; one screen per the spec §5.1 sketch; links to the spec and plan.
2. **Install** — `npm run tui:install` (pins; installs a local Bun 1.4.2; no global changes). Pi needs its own provider auth (`~/.pi/agent`, see Pi's docs) for the agent pane; pages work without it.
3. **Run** — `npm run tui` (from anywhere in the repo; opens the workspace you invoked it from), flags `--workspace <path|id>`, `--page <id>`, `--snapshot [--width --height]`.
4. **Keys** — the table from spec §5.2.
5. **herdr** — `herdr plugin link "$(pwd)/packages/tui/herdr"`, then in `~/.config/herdr/config.toml`:
   ```toml
   [[keys.command]]
   key = "prefix+o"
   type = "plugin_action"
   command = "org-os-cockpit.open-cockpit"
   description = "org-os cockpit in a split"

   [[keys.command]]
   key = "prefix+shift+o"
   type = "plugin_action"
   command = "org-os-cockpit.open-cockpit-tab"
   description = "org-os cockpit in a tab"
   ```
   What the cockpit does inside herdr (launch into splits/tabs, agent badges on the fleet, `report-agent`, approval notifications) and the optional `herdr integration install claude|pi|opencode` (operator's call; writes into each host's config).
6. **Launching hosts** — the strategy chain; `config.json` `launch.prefer`.
7. **Configuration** — `~/.config/org-os/cockpit/config.json` example with `workspaces`, `launch.prefer`, `herdr.poll/pollMs`; `state.json` is cockpit-managed.
8. **Safety** — vault guard first (fail-closed), approvals, no mutating git from the cockpit, scripts allow-list, launched hosts keep their own hooks.
9. **Auth & OQ-1** — the pane uses Pi's configured provider; Max usage inside the pane is an open question (spec §11); use `L` → `claude` for Max today.
10. **Acceptance checklist** — the spec §9 acceptance list as checkboxes, to be ticked by the operator and copied into `VERIFIED.md`.
11. **Tests** — `npm run test:tui`.

- [ ] **Step 3: Run — expect PASS**, then commit.

```bash
npm test --prefix packages/tui
git add packages/tui/herdr packages/tui/README.md packages/tui/test/herdr-plugin.test.ts
git commit -m "feat(tui): herdr plugin manifest and launch scripts; cockpit README" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: governance and catalog updates

**Files:**
- Modify: `DECISIONS.md` (new top entry), `docs/agent-plans/QUEUE.md`, `docs/agent-plans/tui-dashboard.md`, `docs/agent-plans/tui-dashboard-implementation.md`, `data/packages-matrix.yaml`, `CHANGELOG.md`, `docs/HOST-INTEGRATION.md`, `packages/opencode-integration/README.md`

- [ ] **Step 1: `DECISIONS.md`** — insert directly under the `---` that ends the Conventions section (above the newest entry):

```markdown
## 2026-09-25 · org-os cockpit (OpenTUI · Pi · herdr) — operator directive un-freezes the TUI line

- **Status:** active
- **Scope:** framework / operator-ux / agent-runtime
- **Decision:** Build the org-os cockpit: a fleet TUI on OpenTUI (Solid) in one Bun process — headless `core/` + `ui/` — reading every workspace's data plane directly, with an embedded **Pi** agent pane (SDK, in-process) whose tool calls pass the fail-closed vault guard and then operator approval, a launch path for the real `claude`/`pi`/`opencode` CLIs, and **herdr** as the host environment. Shared code lands as `packages/harness-kit` (guard bridge, workspace detection) and `packages/org-state` (page-core moved out of cloudflare-os-integration). Claude Agent SDK and opencode adapters are v1.1.
- **Why:** The operator's daily-driver need, stated directly (2026-09-25), plus two convergences: the Pi harness spec (same day) makes Pi the natural embedded engine, and herdr is where the operator runs agents. The cockpit is the interactive mode of the CLI surface — no new server, no new write path — so the interfaces contract (2026-08-29) holds without amendment. The portfolio memo's row-6 trigger (admin M2 + daily-use gap or second operator) is **overridden by operator directive**, not fired. Alternatives: a daemon + thin client (a new server → contract amendment; too much infra for one operator), extending opencode's TUI (can't host fleet pages; drops the other backends), the frozen Ink design (superseded).
- **Open:** OQ-1 — whether the pane may run on a Claude Max subscription; answered from Anthropic's current terms and Pi's auth docs before any pane auth UI is built. Until then: Pi's configured provider auth; Max via the launch path.
- **Refs:** `docs/superpowers/specs/2026-09-25-org-os-cockpit-design.md`, `docs/superpowers/plans/2026-09-25-org-os-cockpit.md`, `docs/superpowers/specs/2026-09-25-pi-harness-design.md` (branch `feat/pi-harness`), `packages/tui/VERIFIED.md`.
```

- [ ] **Step 2: Plan banners** — in both `docs/agent-plans/tui-dashboard.md` and `docs/agent-plans/tui-dashboard-implementation.md`: set frontmatter `status: superseded` (the first file has `status: frozen`; the second — add or change the `status` field if present) and replace the `> **Release status (2026-08-28):** …` line (or add one under the frontmatter) with:

```markdown
> **Superseded 2026-09-25** by [`2026-09-25-org-os-cockpit-design.md`](../superpowers/specs/2026-09-25-org-os-cockpit-design.md) — OpenTUI (not Ink), embedded Pi agent, herdr host. Content preserved for history.
```

- [ ] **Step 3: `QUEUE.md`** — (a) under *Next after release (v0.6 Actives, per memo §3)* append:
`8. **org-os-cockpit** — operator directive 2026-09-25 (DECISIONS): fleet TUI on OpenTUI with embedded Pi and herdr. Spec [`2026-09-25-org-os-cockpit-design.md`](../superpowers/specs/2026-09-25-org-os-cockpit-design.md) · plan [`2026-09-25-org-os-cockpit.md`](../superpowers/plans/2026-09-25-org-os-cockpit.md) · branch \`feat/org-os-cockpit\`. Workstream: operator-interfaces.`
(b) in the Frozen table row that begins `| skills-section · tui-dashboard ·`, remove `tui-dashboard · `; (c) under *Superseded* add `- \`tui-dashboard.md\` + \`tui-dashboard-implementation.md\` — **superseded 2026-09-25 by org-os-cockpit** (OpenTUI, not Ink).`; (d) update the `> Last updated:` line's date to 2026-09-25 with a short note "(org-os-cockpit added by operator directive)".

- [ ] **Step 4: `data/packages-matrix.yaml`** — append under the framework packages:

```yaml
  - id: "tui"
    owner: "framework"
    instances_using: []
    in_framework: true
    promotion_status: "canonical"
    lifecycle_status: "active"
    notes: "org-os cockpit — fleet TUI (OpenTUI/Solid, Bun) with embedded Pi agent and herdr integration. Opt-in install: npm run tui:install. Spec 2026-09-25-org-os-cockpit-design.md."

  - id: "harness-kit"
    owner: "framework"
    instances_using: []
    in_framework: true
    promotion_status: "canonical"
    lifecycle_status: "active"
    notes: "Dependency-free guard bridge + workspace detection shared by agent hosts (cockpit; pi-integration once it lands)."

  - id: "org-state"
    owner: "framework"
    instances_using: []
    in_framework: true
    promotion_status: "canonical"
    lifecycle_status: "active"
    notes: "Pure workspace state + loaders + markdown pages (page-core moved from cloudflare-os-integration 2026-09-25; shims kept). Backs npm run page."
```
Run `npm run validate:schemas` afterwards; if the matrix has a schema check that rejects a field value, match the neighbouring entries' values.

- [ ] **Step 5: `CHANGELOG.md`** — under `## [Unreleased]` (create the heading at the top if absent) add:

```markdown
### Added
- `packages/tui` — org-os cockpit: fleet TUI on OpenTUI with an embedded, guarded Pi agent pane, host launch (herdr/tmux/zellij/Ghostty), and a herdr plugin. `npm run tui:install`, `npm run tui`.
- `packages/harness-kit` — shared fail-closed vault-guard bridge and workspace detection.
- `packages/org-state` — page-core moved out of cloudflare-os-integration (re-export shims kept) plus heartbeat/memory/decisions/queue/funding loaders.
```

- [ ] **Step 6: `docs/HOST-INTEGRATION.md`** — add a row to its host compatibility table (match the table's columns): host **herdr** — surface "org-os cockpit in a split/tab via plugin; cockpit launches claude/pi/opencode into herdr panes; live agent badges; approval notifications" — mechanism "`packages/tui/herdr` plugin + herdr CLI JSON" — status "v0.1 (2026-09-25), operator acceptance pending". If the file has no table, add a short `## herdr` section with the same content.

- [ ] **Step 7: `packages/opencode-integration/README.md`** — after the sentence that says the tools shell out to `npm run page <id>` (and `npm run tui`), add: `> 2026-09-25: \`npm run tui\` now exists — it opens the OpenTUI cockpit (packages/tui), not the Ink design this README was written against.`

- [ ] **Step 8: Verify + commit**

```bash
npm run validate:schemas && npm run validate:structure
git add DECISIONS.md docs/agent-plans data/packages-matrix.yaml CHANGELOG.md docs/HOST-INTEGRATION.md packages/opencode-integration/README.md
git commit -m "docs(governance): record the org-os cockpit directive; supersede the Ink tui-dashboard plans" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: full verification

**Files:**
- Modify: `packages/tui/VERIFIED.md` (append a "Build verification" section)

- [ ] **Step 1: Run every suite and gate**

```bash
npm run test:harness-kit
npm run test:org-state
npm run test:cloudflare-os-integration
npm run test:tui
npm test
npm run validate:schemas
npm run validate:structure
for p in dashboard projects tasks instances decisions plans this-week; do node scripts/page-shim.mjs "$p" > /dev/null && echo "page $p ok"; done
npm run tui -- --snapshot --page fleet --width 160 --height 40
npm run tui -- --snapshot --page dashboard --width 80 --height 24
```
Expected: all pass; both snapshots print a frame and exit 0. Record any failure honestly — do not skip or weaken a test to get green; fix the code or stop and report.

- [ ] **Step 2: Append to `packages/tui/VERIFIED.md`**

```markdown
## Build verification — <date/time>

| Gate | Result |
|---|---|
| harness-kit tests | <n> pass |
| org-state tests | <n> pass |
| cloudflare-os-integration tests (via shims) | <n> pass |
| tui tests (bun + launcher) | <n> pass |
| root `npm test` | <n> pass |
| validate:schemas / validate:structure | pass / pass |
| `npm run page` × 7 | ok |
| `--snapshot` fleet 160×40 / dashboard 80×24 | exit 0 / exit 0 |

Not verified here (needs the operator): live herdr (plugin link, launch into splits, report-agent, notifications), a real Pi provider turn, `claude` launched with Max login, the acceptance list in README §10.
```
Fill the numbers from the actual runs.

- [ ] **Step 3: Commit**

```bash
git add packages/tui/VERIFIED.md
git commit -m "docs(tui): record build verification results" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
