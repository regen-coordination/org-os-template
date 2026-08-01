# Multica × org-os Operator (Phases 0–1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make this org-os instance operable through a self-hosted multica: an "org-os operator" agent persona executes multica issues inside this repo under org-os session discipline, with hard safety guards.

**Architecture:** Multica (Docker, localhost) assigns issues to an agent whose runtime is the already-detected `claude` CLI; a `local_directory` project resource binds task execution to this repo. The persona (instructions file) supplies org-os discipline; a checked-in `.claude/settings.json` denies destructive git ops; a versioned pre-push hook blocks publishing `agent/*` branches. No multica fork, no custom binary.

**Tech Stack:** Node 23 (`node --test`, ESM `.mjs`), js-yaml (already in root `node_modules`), Docker Compose (multica self-host), `multica` CLI, `claude` CLI.

**Spec:** `docs/superpowers/specs/2026-07-24-multica-org-os-integration-design.md` (Phases 0–1 only; the Phase 2 sync bridge gets its own plan).

---

## Context you need (verified 2026-07-24 against multica@main)

- Multica's daemon only auto-detects a **hardcoded list** of agent CLIs (`server/internal/daemon/config.go`, `defaultAgentCommandNames`). You cannot add a provider by putting a binary on PATH. That's why this plan uses an agent *persona* on the `claude` runtime instead.
- A multica **Agent** = name + instructions (markdown passed verbatim to the runtime) + optional skills + runtime. Created in the web UI (agent creation is not in the CLI; `multica agent list` only lists).
- A multica **project** can carry a `local_directory` resource (`server/internal/handler/agent.go`) pinning task execution to an existing directory on a specific daemon — that's how tasks run inside this repo instead of a throwaway worktree.
- For `local_directory` tasks the agent's cwd is the real repo, so this repo's checked-in `.claude/settings.json` applies to operator sessions. Claude Code merges settings files with **deny-wins**, so deny rules here are a hard boundary (the daemon's own task-local `--settings` file only adds skill policy).
- Issues ARE scriptable: `multica issue create --title ... --assignee ... --project ...`; JSON output via `--output json`.
- This repo: branch off `feat/knowledge-commons`. The working tree contains unrelated untracked files — `git add` only the paths named in each commit step, never `git add -A`. **Never run `git stash`, `git clean`, or `git reset --hard` in this repo** (vault-safety rules).

## File structure

| Path | Responsibility |
|---|---|
| `packages/multica-bridge/package.json` | Package manifest, `npm test` runner |
| `packages/multica-bridge/README.md` | What the package is, pointers to persona/setup |
| `packages/multica-bridge/personas/org-os-operator.md` | The operator instructions pasted into the multica agent |
| `packages/multica-bridge/config.example.yaml` | Template for local (gitignored) `config.yaml` |
| `packages/multica-bridge/docs/SETUP.md` | Reproducible multica-side setup record (Phase 0 + UI wiring) |
| `packages/multica-bridge/test/*.test.mjs` | Persona lint, settings guard, pre-push hook tests |
| `.claude/settings.json` (repo root, checked in) | Deny rules: `git stash` / `git clean` / `git reset --hard` |
| `scripts/git-hooks/pre-push` | Refuses pushes of `agent/*` branches |
| `scripts/install-git-hooks.mjs` | Copies versioned hooks into the live git hooks dir (never clobbers foreign hooks) |
| root `package.json` (modify) | Add `hooks:install` and `test:multica-bridge` scripts |

---

### Task 1: Branch + package scaffold

**Files:**
- Create: `packages/multica-bridge/package.json`
- Create: `packages/multica-bridge/README.md`

- [ ] **Step 1: Create the working branch**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
git checkout -b feat/multica-operator
```

Expected: `Switched to a new branch 'feat/multica-operator'` (untracked files remain — that's fine, do not clean them).

- [ ] **Step 2: Write `packages/multica-bridge/package.json`**

```json
{
  "name": "@org-os/multica-bridge",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "description": "Multica × org-os integration: operator persona (Phase 1) and yaml ⇄ multica sync bridge (Phase 2)",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 3: Write `packages/multica-bridge/README.md`**

```markdown
# @org-os/multica-bridge

Integration between [multica](https://github.com/multica-ai/multica) and this
org-os instance. Spec: `docs/superpowers/specs/2026-07-24-multica-org-os-integration-design.md`.

**Phase 1 (this package today):** the "org-os operator" — a multica agent
persona (`personas/org-os-operator.md`) that executes multica issues inside
this repo on the `claude` runtime, bound via a `local_directory` project
resource. Setup runbook: `docs/SETUP.md`.

**Phase 2 (planned):** `npm run multica:sync` — projects `data/*.yaml`,
skills, and heartbeat cron into multica (issues, skills, autopilots) and
reconciles changes back. Yaml + git stay canonical.

## Safety model

- Repo `.claude/settings.json` denies `git stash` / `git clean` /
  `git reset --hard` for every Claude session in this repo (vault-safety).
- `scripts/git-hooks/pre-push` refuses to push `agent/*` branches — operator
  work is merged locally after human review, never published by the agent.
- The persona mandates draft-and-present for anything external.

## Tests

`npm test` (from this directory) — persona lint, settings guard, hook behavior.
```

- [ ] **Step 4: Verify the test runner wiring (expect failure — no tests yet)**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os/packages/multica-bridge"
npm test
```

Expected: `node --test` reports 0 tests found (no `test/` dir yet). That's the red baseline; Task 2 adds the first test. (Do NOT use `node --test test/` — on Node 23.3.0 a directory argument is resolved as a module and throws `MODULE_NOT_FOUND`. Bare `node --test` discovers `test/*.test.mjs` correctly.)

- [ ] **Step 5: Commit**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
git add packages/multica-bridge/package.json packages/multica-bridge/README.md
git commit -m "feat(multica-bridge): scaffold package for multica integration (MUL phase 1)"
```

---

### Task 2: Operator persona (test-first)

**Files:**
- Create: `packages/multica-bridge/test/persona.test.mjs`
- Create: `packages/multica-bridge/personas/org-os-operator.md`

- [ ] **Step 1: Write the failing persona lint test**

`packages/multica-bridge/test/persona.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(pkgRoot, '..', '..');
const personaPath = resolve(pkgRoot, 'personas/org-os-operator.md');

test('persona file exists', () => {
  assert.ok(existsSync(personaPath), `missing ${personaPath}`);
});

test('persona covers the non-negotiable markers', () => {
  const text = readFileSync(personaPath, 'utf8');
  for (const marker of [
    'agent/<issue-key>',                    // branch discipline
    'memory/',                              // memory append rule
    'generate:schemas',                     // schema regen after data changes
    'draft-and-present',                    // external action gate
    'IDENTITY.md',                          // bootstrap context
    'Never run `git push`',                 // push prohibition, stated as prohibition
    'Never run `git stash`',                // destructive-op prohibition
  ]) {
    assert.ok(text.includes(marker), `persona missing required marker: ${marker}`);
  }
});

test('every concrete repo file the persona references exists', () => {
  const text = readFileSync(personaPath, 'utf8');
  const refs = [...text.matchAll(/[`(]([.\w][\w./-]*\.(?:md|yaml|json))[`)]/g)]
    .map((m) => m[1]);
  assert.ok(refs.length >= 3, 'persona should reference concrete repo files');
  for (const ref of refs) {
    assert.ok(existsSync(resolve(repoRoot, ref)), `persona references missing file: ${ref}`);
  }
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os/packages/multica-bridge"
npm test
```

Expected: FAIL — `persona file exists` assertion (`missing .../personas/org-os-operator.md`).

- [ ] **Step 3: Write the persona**

`packages/multica-bridge/personas/org-os-operator.md`:

> Note for the implementer: file-pattern paths below deliberately use `<...>` placeholders (e.g. `memory/<YYYY-MM-DD>.md`) so the lint test's existence check only fires on concrete files like `IDENTITY.md`.

```markdown
# org-os operator

You are the org-os operator: an agent teammate executing issues inside an
org-os instance repository. Your working directory IS the instance repo.
Its files — `data/` yaml, `memory/`, `HEARTBEAT.md` — are the single source
of truth. Treat everything in the working tree as precious.

## Session discipline (every issue, in order)

1. **Bootstrap.** Before changing anything, read `IDENTITY.md`, `AGENTS.md`,
   and `HEARTBEAT.md`, plus whichever `data/` yaml files the issue touches.
   Then check `git status`. If the working tree is already dirty and you
   cannot attribute the changes to a prior session on this same issue key,
   stop and report — do not build on top of unattributed changes, and do not
   try to clear them.
2. **Branch.** Do all work on `agent/<issue-key>` (e.g. `agent/MUL-42`). If
   that branch already exists, continue on it. Otherwise create it from an
   up-to-date trunk — check out the instance's main working branch and pull
   first — never from whatever branch happens to be checked out, which may be
   another issue's leftover. Never commit to `master` or `main` directly.
3. **Execute** the issue. Match existing file conventions — look at
   neighboring entries before adding one.
4. **Schemas.** If anything under `data/` changed, run
   `npm run generate:schemas`, include the regenerated `.well-known/` files
   in your commit, then run `npm run validate:schemas` and fix any failure.
5. **Memory.** Append (never overwrite) a dated entry to today's memory file,
   `memory/<YYYY-MM-DD>.md`: what you did, why, and the issue key.
6. **Commit** on the agent branch with a conventional message that includes
   the issue key, staging only the files you touched.
7. **Report.** Your final message: what changed, the branch name, files
   touched, and anything that needs human review.

## Hard limits

- Repo-internal work only. Never run `git push`. Never contact external
  services, publish content, send messages, or move funds.
- For any external action the issue implies (comms, publishing, financial
  ops): produce a **draft** in your final report for a human to execute —
  draft-and-present, never send.
- Never run `git stash`, `git clean`, or `git reset --hard` — these are also
  blocked by the repo permission profile; do not attempt to work around it.
- If you cannot complete the issue, leave the working tree clean (commit
  what's coherent to the agent branch, or revert your edits file-by-file)
  and report the blocker instead of guessing. Keep your `memory/` entry even
  when you abort — record what you attempted and why you stopped.
```

> Amendment (post-review): the branch-base, dirty-tree, memory-on-abort, marker-polarity, and dotfile-regex changes above were added after the Task 2 code-quality review. The reviewer also flagged that the persona asserts a permission profile that Tasks 3–4 create — that is sequencing, not a defect: the persona is not wired into multica until Task 7.

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os/packages/multica-bridge"
npm test
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
git add packages/multica-bridge/test/persona.test.mjs packages/multica-bridge/personas/org-os-operator.md
git commit -m "feat(multica-bridge): org-os operator persona + lint test"
```

---

### Task 3: Repo permission profile (test-first)

**Files:**
- Create: `packages/multica-bridge/test/settings.test.mjs`
- Create: `.claude/settings.json` (repo root — note `.claude/settings.local.json` already exists and must not be touched)

- [ ] **Step 1: Write the failing settings test**

`packages/multica-bridge/test/settings.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const settingsPath = resolve(repoRoot, '.claude/settings.json');

test('checked-in claude settings exist', () => {
  assert.ok(existsSync(settingsPath), `missing ${settingsPath}`);
});

test('destructive git ops are denied', () => {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const deny = settings?.permissions?.deny ?? [];
  for (const rule of [
    'Bash(git stash:*)',
    'Bash(git clean:*)',
    'Bash(git reset --hard:*)',
  ]) {
    assert.ok(deny.includes(rule), `missing deny rule: ${rule}`);
  }
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os/packages/multica-bridge"
npm test
```

Expected: FAIL — `checked-in claude settings exist`.

- [ ] **Step 3: Write `.claude/settings.json`**

```json
{
  "permissions": {
    "deny": [
      "Bash(git stash:*)",
      "Bash(git clean:*)",
      "Bash(git reset --hard:*)"
    ]
  }
}
```

Rationale: these three are already forbidden for *every* session in this repo by vault-safety rules, so a shared (checked-in) deny costs nothing and gives operator sessions a hard boundary. `git push` is deliberately NOT denied here — that would break human workflows; the pre-push hook (Task 4) handles the operator case instead. Deny rules win over any allow in `settings.local.json`.

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os/packages/multica-bridge"
npm test
```

Expected: PASS (5 tests).

- [ ] **Step 5: Manual probe that the deny actually bites**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
claude -p "Run exactly: git stash list" 2>&1 | tail -5
```

Expected: the response indicates the Bash call was blocked/denied by permission rules (it must NOT show `git stash list` output). If it runs the command, stop — the settings file location or syntax is wrong; fix before continuing.

**Probe design matters — use only harmless commands.** `git stash list` and `git clean -n` are read-only/dry-run, so the model has no independent reason to refuse them; a refusal therefore proves the *permission layer* fired. Probing with a genuinely destructive command (e.g. `git reset --hard HEAD`) is useless as evidence: the model refuses on CLAUDE.md vault-safety grounds without ever attempting the Bash call, so the deny rule is never exercised and you learn nothing about whether the pattern matches. Verified 2026-07-24: `git stash list` → "denied", `git clean -n` → "The command was denied by permissions". `Bash(git reset --hard:*)` remains verified by pattern analogy only (both layers refuse it, but the permission layer can't be isolated).

- [ ] **Step 6: Commit**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
git add packages/multica-bridge/test/settings.test.mjs .claude/settings.json
git commit -m "feat(multica-bridge): checked-in claude permission profile denying destructive git ops"
```

---

### Task 4: pre-push hook blocking `agent/*` publication (test-first)

**Files:**
- Create: `packages/multica-bridge/test/pre-push-hook.test.mjs`
- Create: `scripts/git-hooks/pre-push`
- Create: `scripts/install-git-hooks.mjs`
- Modify: root `package.json` (scripts block)

- [ ] **Step 1: Write the failing hook test**

`packages/multica-bridge/test/pre-push-hook.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const hookPath = resolve(repoRoot, 'scripts/git-hooks/pre-push');

function runHook(stdinLines) {
  return spawnSync('sh', [hookPath], { input: stdinLines, encoding: 'utf8' });
}

test('hook script exists', () => {
  assert.ok(existsSync(hookPath), `missing ${hookPath}`);
});

test('blocks pushing agent/* branches', () => {
  const r = runHook('refs/heads/agent/MUL-1 1111111 refs/heads/agent/MUL-1 2222222\n');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /agent\//);
});

test('allows pushing normal branches', () => {
  const r = runHook('refs/heads/feat/multica-operator 1111111 refs/heads/feat/multica-operator 2222222\n');
  assert.equal(r.status, 0);
});

test('blocks a mixed push containing an agent ref', () => {
  const r = runHook(
    'refs/heads/feat/x 1111111 refs/heads/feat/x 2222222\n' +
    'refs/heads/agent/MUL-9 1111111 refs/heads/agent/MUL-9 2222222\n'
  );
  assert.equal(r.status, 1);
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os/packages/multica-bridge"
npm test
```

Expected: FAIL — `hook script exists`.

- [ ] **Step 3: Write `scripts/git-hooks/pre-push`**

```sh
#!/bin/sh
# Refuses to push agent/* branches. Multica operator work lands on
# agent/<issue-key> branches and is reviewed + merged locally by a human —
# the agent must never publish. Versioned here; installed into the live git
# hooks dir by `npm run hooks:install` (scripts/install-git-hooks.mjs).
#
# git calls pre-push with lines on stdin:
#   <local_ref> <local_sha> <remote_ref> <remote_sha>
status=0
while read -r local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/agent/*)
      echo "pre-push: refusing '$remote_ref' — agent/* branches are merged locally after human review, never pushed." >&2
      status=1
      ;;
  esac
done
exit $status
```

- [ ] **Step 4: Make it executable and run the tests**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
chmod +x scripts/git-hooks/pre-push
cd packages/multica-bridge && npm test
```

Expected: PASS (9 tests).

- [ ] **Step 5: Write the installer `scripts/install-git-hooks.mjs`**

```js
#!/usr/bin/env node
// Installs versioned git hooks from scripts/git-hooks/ into the active git
// hooks directory (correct even for this submodule, whose git dir lives under
// the parent's .git/modules/). Copies only hooks we version; refuses to
// overwrite an existing hook whose content differs (e.g. the pre-existing
// pre-commit), so foreign hooks are never clobbered.
import { execSync } from 'node:child_process';
import { copyFileSync, chmodSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(repoRoot, 'scripts', 'git-hooks');
const hooksDir = resolve(
  repoRoot,
  execSync('git rev-parse --git-path hooks', { cwd: repoRoot, encoding: 'utf8' }).trim(),
);

let failed = false;
for (const name of readdirSync(srcDir)) {
  const src = join(srcDir, name);
  const dest = join(hooksDir, name);
  if (existsSync(dest) && readFileSync(dest, 'utf8') !== readFileSync(src, 'utf8')) {
    console.error(`hooks: ${name} exists at ${dest} with different content — resolve manually; not overwriting.`);
    failed = true;
    continue;
  }
  copyFileSync(src, dest);
  chmodSync(dest, 0o755);
  console.log(`hooks: installed ${name} -> ${dest}`);
}
process.exitCode = failed ? 1 : 0;
```

- [ ] **Step 6: Add root package.json scripts**

In the root `package.json` `scripts` block, add these two entries (keep existing entries untouched):

```json
    "hooks:install": "node scripts/install-git-hooks.mjs",
    "test:multica-bridge": "npm test --prefix packages/multica-bridge"
```

- [ ] **Step 7: Install and verify the hook is live**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
npm run hooks:install
ls -l "$(git rev-parse --git-path hooks)/pre-push"
```

Expected: `hooks: installed pre-push -> ...` and an executable file listing. The existing `pre-commit` hook must still be present and untouched.

- [ ] **Step 8: Commit**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
git add packages/multica-bridge/test/pre-push-hook.test.mjs scripts/git-hooks/pre-push scripts/install-git-hooks.mjs package.json
git commit -m "feat(multica-bridge): versioned pre-push hook blocking agent/* publication + installer"
```

---

### Task 5: Config template (test-first)

**Files:**
- Create: `packages/multica-bridge/test/config.test.mjs`
- Create: `packages/multica-bridge/config.example.yaml`
- Modify: root `.gitignore` (add the local config)

- [ ] **Step 1: Write the failing config test**

`packages/multica-bridge/test/config.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = resolve(pkgRoot, 'config.example.yaml');

test('config example exists and parses', () => {
  assert.ok(existsSync(examplePath), `missing ${examplePath}`);
  const cfg = yaml.load(readFileSync(examplePath, 'utf8'));
  assert.equal(typeof cfg.multica.baseUrl, 'string');
  assert.equal(typeof cfg.multica.workspace, 'string');
  assert.equal(typeof cfg.multica.agent, 'string');
  assert.equal(typeof cfg.instance.path, 'string');
});
```

(`js-yaml` resolves from the repo root's `node_modules` — verified present.)

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os/packages/multica-bridge"
npm test
```

Expected: FAIL — `config example exists and parses`.

- [ ] **Step 3: Write `packages/multica-bridge/config.example.yaml`**

```yaml
# Copy to config.yaml (gitignored) and fill in during multica-side setup
# (docs/SETUP.md). Shared by Phase 1 setup tooling and the Phase 2 bridge.
multica:
  baseUrl: http://localhost:3000
  workspace: org-os            # workspace slug
  agent: org-os operator       # agent display name (see `multica agent list`)
  project: ""                  # project id — fill from `multica project list --output json`
instance:
  path: /Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os
```

- [ ] **Step 4: Gitignore the local config**

Append to the root `.gitignore`:

```
packages/multica-bridge/config.yaml
```

- [ ] **Step 5: Run the tests and make sure they pass**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os/packages/multica-bridge"
npm test
```

Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
git add packages/multica-bridge/test/config.test.mjs packages/multica-bridge/config.example.yaml .gitignore
git commit -m "feat(multica-bridge): config template + test, gitignore local config"
```

---

### Task 6: Phase 0 — self-host multica + daemon (operational)

**Files:**
- Create: `packages/multica-bridge/docs/SETUP.md` (started here, finished in Task 7)

No code here — record every deviation from these commands in SETUP.md as you go. Command names below come from multica's `SELF_HOSTING.md` / `CLI_AND_DAEMON.md` @ main (2026-07-24); if any drifts, `multica --help` is authoritative and SETUP.md gets the correction.

- [ ] **Step 1: Prerequisites**

```bash
docker --version && docker compose version
which claude
```

Expected: both Docker commands print versions; `claude` resolves. If Docker is missing, install Docker Desktop first.

- [ ] **Step 2: Install CLI + provision the self-host server**

```bash
curl -fsSL https://raw.githubusercontent.com/multica-ai/multica/main/scripts/install.sh | bash -s -- --with-server
```

Expected: installer pulls GHCR images and starts services. Then:

```bash
multica setup self-host
```

Expected: CLI configured against `http://localhost:3000`, authentication completes, daemon starts. Login note: without `RESEND_API_KEY` configured, the email login code appears in the backend container logs — `docker ps` to find the backend container, then `docker logs <backend-container> 2>&1 | grep -i code | tail -5`.

- [ ] **Step 3: Verify server, daemon, and runtime detection**

```bash
curl -fsS http://localhost:3000 >/dev/null && echo "web: up"
multica workspace list
multica daemon status || multica daemon --help
```

Expected: web up; at least one workspace listed; daemon reported running with the `claude` runtime detected (also visible in the web UI's runtimes view). 

- [ ] **Step 4: Vanilla smoke — prove multica works before org-os enters**

In the web UI (http://localhost:3000): create a scratch issue in the default workspace, assign it to a default `claude`-runtime agent, and watch it execute in a throwaway workdir. Any trivial prompt ("create hello.txt containing hi") is fine.

Expected: issue moves through the lifecycle and completes. Do not proceed until this works.

- [ ] **Step 5: Start `packages/multica-bridge/docs/SETUP.md`**

Record what actually happened (versions, deviations, where the login code was found):

```markdown
# Multica self-host setup record

- Date: <fill>
- multica CLI version: `multica --version` → <fill>
- Server: http://localhost:3000 via install.sh --with-server (GHCR images)
- Daemon: running on <hostname>; runtimes detected: <fill, must include claude>
- Login: <resend key | code from backend logs>
- Vanilla smoke issue: <issue key> — completed <date>
- Deviations from plan commands: <none | list>
```

- [ ] **Step 6: Commit**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
git add packages/multica-bridge/docs/SETUP.md
git commit -m "docs(multica-bridge): phase 0 self-host setup record"
```

---

### Task 7: Multica-side wiring — workspace, operator agent, local_directory project

**Files:**
- Modify: `packages/multica-bridge/docs/SETUP.md` (append each sub-step as performed)
- Create: `packages/multica-bridge/config.yaml` (local, gitignored — from the example)

Agent creation and project resources are UI operations (the CLI lists but does not create agents). Document every screen/field in SETUP.md so this is reproducible on another machine.

- [ ] **Step 1: Create the `org-os` workspace** (UI) — name `org-os`. Then `multica workspace switch org-os` and confirm with `multica workspace get`.

- [ ] **Step 2: Create the agent** (UI): name `org-os operator`, runtime `claude`, instructions = the **full contents** of `packages/multica-bridge/personas/org-os-operator.md` (paste verbatim; note in SETUP.md that the persona file is the source of truth and UI must be re-pasted when it changes). Skip skill imports for now — org-os skills ship with the repo the agent works in; note this decision in SETUP.md.

- [ ] **Step 3: Create the project** (UI): title `org-os pilot`. Then attach a **local_directory** resource pointing at `/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os`, pinned to this Mac's daemon. (If the resource UI is under a different name — "repository"/"directory" picker on the project or workspace settings — record the actual location in SETUP.md.)

- [ ] **Step 4: Fill the local config**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os/packages/multica-bridge"
cp config.example.yaml config.yaml
multica project list --output json   # take the org-os pilot project id
```

Edit `config.yaml`: set `multica.project` to that id. Verify `git status --short -- config.yaml` shows nothing (gitignored).

- [ ] **Step 4a: Confirm the operator session is rooted AT the repo (highest-value safety check)**

The entire safety model — `.claude/settings.json` deny rules AND the `PreToolUse` guard — only loads when the Claude session's project directory IS this repo. If multica's `local_directory` binding gives the agent a cwd *above* the repo (e.g. the parent vault), `03 Libraries/org-os/.claude/settings.json` is never read and **nothing is enforced**. This is a configuration-level bypass of the whole model, not a gap in it.

Verify by assigning a throwaway issue whose entire content is: "Run exactly this and report the output verbatim: `git -c core.pager=cat stash list`". Expected: the operator reports being blocked by the vault-safety guard. If it returns stash contents instead, STOP — the binding is rooted wrong, and no operator issue should run until it's fixed.

- [ ] **Step 4b: Confirm the push guard is actually live on this machine**

The pre-push hook is only enforced where it has been installed — unlike `.claude/settings.json`, which applies the moment it is checked in. Before wiring a live agent:

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
npm run install:hooks
ls -l "$(git rev-parse --git-path hooks)/pre-push"
```

Expected: the hook file exists and is executable. Being present in git is necessary but NOT sufficient. (Note: the Task 4 `hooks:install` script was consolidated into the pre-existing, already-documented `install:hooks` after review flagged the near-identical names as a foot-gun.)

- [ ] **Step 5: Verify assignability**

```bash
multica agent list
multica issue list
```

Expected: `org-os operator` appears; issue list is empty but the command targets the `org-os` workspace.

- [ ] **Step 6: Commit the SETUP.md additions**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
git add packages/multica-bridge/docs/SETUP.md
git commit -m "docs(multica-bridge): workspace/agent/local_directory wiring runbook"
```

---

### Task 8: End-to-end smoke issue

**Files:** none created directly — the *operator* produces an `agent/<KEY>` branch in this repo.

- [ ] **Step 1: Create the smoke issue**

```bash
multica issue create \
  --title "Pilot smoke: record the multica integration idea" \
  --description "In data/ideas.yaml, add one idea titled 'Multica × org-os integration pilot' (status: developing), matching the existing entry format exactly. Follow your session discipline end to end: agent branch, schema regen if needed, memory entry, commit, report." \
  --assignee "org-os operator" \
  --project "$(node -e "const y=require('js-yaml'),f=require('fs');console.log(y.load(f.readFileSync('packages/multica-bridge/config.yaml','utf8')).multica.project)")"
```

(Run from the repo root so `js-yaml` resolves; if it fails, paste the project id from `config.yaml` manually.) Note the returned issue KEY (e.g. `ORG-1`).

- [ ] **Step 2: Watch execution** in the web UI until the issue completes. If it fails, read the run log there — the likeliest causes are the local_directory binding (Task 7 Step 3) or daemon not watching the workspace (`multica daemon status`).

- [ ] **Step 3: Verify the operator obeyed discipline**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
git branch --list 'agent/*'                     # expect agent/<KEY>
git log "agent/<KEY>" --oneline -3              # commit referencing <KEY>
git show "agent/<KEY>" --stat                   # data/ideas.yaml + memory/<date>.md (+ .well-known/* if schemas regenerated)
git status --short                              # working tree NOT left dirty by the operator
git diff master.."agent/<KEY>" -- data/ideas.yaml  # exactly one new idea entry
```

- [ ] **Step 4: Verify the pre-push guard**

```bash
git push origin "agent/<KEY>"
```

Expected: **refused** by the pre-push hook with the `agent/*` message. (This is the success condition — the branch must not reach the remote.)

- [ ] **Step 5: Human review + merge the smoke result**

Review the diff; if good:

```bash
git checkout feat/multica-operator
git merge --no-ff "agent/<KEY>" -m "merge(agent/<KEY>): pilot smoke via multica operator"
git branch -d "agent/<KEY>"
```

- [ ] **Step 6: Record the outcome in SETUP.md and commit**

Append the smoke result (issue key, duration, verification results) to `packages/multica-bridge/docs/SETUP.md`, then:

```bash
git add packages/multica-bridge/docs/SETUP.md
git commit -m "docs(multica-bridge): phase 1 smoke verified end-to-end"
```

---

### Task 9: Wrap-up — memory + full test pass

- [ ] **Step 1: Full verification**

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
npm run test:multica-bridge
npm run validate:structure
```

Expected: all bridge tests PASS; structure validation passes.

- [ ] **Step 2: Append the memory entry**

Append to `memory/<today>.md` (create if absent; never overwrite):

```markdown
## Multica × org-os Phase 1 shipped

- packages/multica-bridge: operator persona, permission profile
  (.claude/settings.json deny stash/clean/reset-hard), pre-push hook blocking
  agent/* publication, config template, SETUP.md runbook.
- Multica self-hosted (Docker, localhost:3000); workspace `org-os`; agent
  "org-os operator" on claude runtime; project bound via local_directory.
- Smoke issue <KEY> executed end-to-end: agent branch, ideas.yaml entry,
  memory entry, push correctly refused by hook.
- Next: Phase 2 sync bridge (yaml ⇄ issues/skills/autopilots) — needs its own
  plan; open question: webhooks vs polling.
```

- [ ] **Step 3: Final commit**

```bash
git add memory/
git commit -m "chore(memory): multica phase 1 session log"
```

Merging `feat/multica-operator` back (and any push) is a human decision — use the finishing-a-development-branch skill; remember this repo pushes nowhere by default (no upstream tracking).
