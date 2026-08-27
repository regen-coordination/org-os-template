# Autopoiesis Research — Phase 2: Cascade Closure (Loop C) Implementation Plan

> **Release status (2026-08-28):** Completed 2026-08-02, gate passed (sync-upstream.mjs + validate-identity.mjs + lineage stamp on main); checkboxes never ticked. Convergence: [v0.5 release masterplan](2026-08-28-v0.5-release-masterplan.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Loop C (Population learning — Metabolism → Cognition → Federation) at the framework level by implementing the three cascade-closure artifacts: `scripts/sync-upstream.mjs`, `scripts/validate-identity.mjs`, and lineage stamps in `federation.yaml.metadata`. After Phase 2 lands, downstream instances inherit these via the now-functional sync mechanism (cascade in Phase 3).

**Architecture:** Three small framework artifacts, each TDD-driven where applicable. Tests follow the existing `tests/scripts/<name>.test.mjs` pattern (node:test + temp dirs + spawnSync). The pilot is exercised in `org-os` itself on branch `autopoiesis-phase2-pilot`, then a postmortem is written.

**Tech Stack:** Node.js (ES modules, node 22+ built-in test runner), `js-yaml`, git CLI invoked via child_process, Markdown for docs.

**Spec:** `docs/superpowers/specs/2026-05-02-org-os-autopoiesis-design.md`
**Synthesis (predecessor):** `docs/superpowers/research/2026-05-02-autopoiesis/SYNTHESIS.md`
**Pilot postmortem (output):** `docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md`

---

## Why this plan replaces the previous Phase 2 plan

The original Phase 2 plan was written assuming the spec's default loop (Loop A: Genesis → Metabolism → Cognition → Identity), with an explicit replan trigger if Phase 1 selected a different loop. **Phase 1 selected Loop C at the gate (2026-05-02).** The closing-edge artifacts differ; this is the replan. Per `git log`, the previous version is preserved at commit `549e668`.

---

## Replan trigger (read first)

This plan implements **three specific artifacts** that close Loop C's cascade edge. The artifacts are named in `SYNTHESIS.md` and grounded in the cell notes' findings:

1. `scripts/sync-upstream.mjs` — referenced 6+ times across the codebase, file does not exist. The propagation script.
2. `scripts/validate-identity.mjs` — referenced from `package.json:22` as `validate:schemas`, file does not exist. The phantom validator.
3. Lineage stamp — new fields `genesis_commit` (immutable) and `last_sync_commit` (mutable, updated by sync) in `federation.yaml.metadata`.

If `SYNTHESIS.md` is later revised to identify a *different* set of closing-edge artifacts, halt this plan and replan via `superpowers:writing-plans`.

---

## File structure

| Path | Status | Responsibility |
|------|--------|---------------|
| `scripts/sync-upstream.mjs` | new (missing) | Sync framework upstream; honor `customizations[].maintain_on_sync`; run migrate + validators; update `last_sync_commit`; write sync receipt |
| `scripts/validate-identity.mjs` | new (missing) | Validate identity invariants beyond what `validate-structure §8` already does (IDENTITY.md ↔ federation.yaml.identity agreement; lineage stamp shape) |
| `tests/scripts/sync-upstream.test.mjs` | new | TDD test harness for sync-upstream |
| `tests/scripts/validate-identity.test.mjs` | new | TDD test harness for validate-identity |
| `federation.yaml` (this repo's) | modify | Add `metadata.genesis_commit` + `metadata.last_sync_commit` |
| `scripts/validate-structure.mjs` | modify | Section 8 extended: also check `genesis_commit` exists and looks like a SHA |
| `docs/FEDERATION.md` | modify | Document lineage stamp fields + sync-upstream behavior |
| `docs/VERSIONING.md` | modify | Update "Instance migration — pull-based" recipe (already references `sync:upstream`; now functional) |
| `docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md` | new | Postmortem |

Total: 4 new files, 4 modified files.

---

## Task 1: Setup — verify Phase 1 gate, create branch, scaffold pilot postmortem

**Files:**
- Create: `docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md`

- [ ] **Step 1: Verify Phase 1 gate passed**

```bash
git log --oneline -10 | head -5
test -f "docs/superpowers/research/2026-05-02-autopoiesis/SYNTHESIS.md"
grep -q "Loop C" "docs/superpowers/research/2026-05-02-autopoiesis/SYNTHESIS.md"
```

All three must succeed. The `git log` should show `e5f4e4a` synthesis commit recently. If not, halt and complete Phase 1 first.

- [ ] **Step 2: Create the working branch**

```bash
git checkout -b autopoiesis-phase2-pilot
```

The pilot's framework artifacts land here. After Phase 2 gate, the branch merges to `release/v3.5-design`.

- [ ] **Step 3: Vault-safety check**

```bash
pwd
```

If path contains `lf-zettelkasten-os/03 Libraries/org-os`, the parent vault could be at risk during merge testing. Run:

```bash
cd "../../.." && npm run vault:snapshot -- "before autopoiesis Phase 2 pilot" && cd "03 Libraries/org-os"
```

Otherwise (org-os checked out standalone), skip.

- [ ] **Step 4: Scaffold PILOT-framework.md**

Create `docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md`:

```markdown
# Autopoiesis Phase 2 Pilot — Cascade Closure (Loop C)

> Branch: `autopoiesis-phase2-pilot`
> Spec: [`2026-05-02-org-os-autopoiesis-design.md`](../../specs/2026-05-02-org-os-autopoiesis-design.md)
> Synthesis: [`SYNTHESIS.md`](SYNTHESIS.md)
> Loop: Loop C — Population learning (Metabolism → Cognition → Federation)
> Status: in progress

## Closing edge (per SYNTHESIS.md)

Three artifacts implementing cascade closure:
1. `scripts/sync-upstream.mjs` — propagation script honoring customizations
2. `scripts/validate-identity.mjs` — phantom validator (resolves `npm run validate:schemas`)
3. Lineage stamp in `federation.yaml.metadata` (`genesis_commit` + `last_sync_commit`)

## Artifacts implemented

(filled in Tasks 2–9)

## Exercise — what we ran, what happened

(filled in Task 10)

## What worked

(filled in Task 11)

## What broke / had to be invented

(filled in Task 11)

## Decisions for Phase 3 DECISIONS.md

(filled in Task 11)

## Migration note for downstream instances

(filled in Task 12)
```

- [ ] **Step 5: Commit setup**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md"
git commit -m "pilot: scaffold autopoiesis Phase 2 postmortem (Loop C)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: validate-identity — write failing test

**Files:**
- Create: `tests/scripts/validate-identity.test.mjs`

- [ ] **Step 1: Create the test file**

```javascript
// tests/scripts/validate-identity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('scripts/validate-identity.mjs');

function setupInstance({ identityName = 'test-org', federationName = 'test-org', genesisCommit = 'a1b2c3d4e5f6789012345678901234567890abcd', lastSyncCommit = null } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-identity-'));
  writeFileSync(path.join(root, 'IDENTITY.md'), `# Identity\n\n- **Name:** ${identityName}\n- **Type:** Project\n- **Node ID:** ${identityName}\n`);
  const lastSyncBlock = lastSyncCommit ? `\n  last_sync_commit: "${lastSyncCommit}"` : '';
  writeFileSync(path.join(root, 'federation.yaml'), `
identity:
  name: ${federationName}
  type: Project
  role: standalone
federation:
  network: test
  hub: null
agent:
  runtime: claude-code
metadata:
  framework_version: "3.0"
  genesis_commit: "${genesisCommit}"${lastSyncBlock}
`);
  return root;
}

test('validate-identity passes when IDENTITY.md and federation.yaml.identity agree', () => {
  const root = setupInstance();
  const result = spawnSync('node', [SCRIPT, root], { encoding: 'utf-8' });
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
});

test('validate-identity fails when IDENTITY.md name disagrees with federation.yaml.identity.name', () => {
  const root = setupInstance({ identityName: 'foo', federationName: 'bar' });
  const result = spawnSync('node', [SCRIPT, root], { encoding: 'utf-8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /name.*disagree|mismatch/i);
});

test('validate-identity fails when genesis_commit is missing', () => {
  const root = setupInstance({ genesisCommit: '' });
  // Rewrite federation.yaml without genesis_commit:
  writeFileSync(path.join(root, 'federation.yaml'), `
identity:
  name: test-org
  type: Project
  role: standalone
federation:
  network: test
  hub: null
agent:
  runtime: claude-code
metadata:
  framework_version: "3.0"
`);
  const result = spawnSync('node', [SCRIPT, root], { encoding: 'utf-8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /genesis_commit/i);
});

test('validate-identity fails when genesis_commit is malformed (not a SHA-shaped string)', () => {
  const root = setupInstance({ genesisCommit: 'not-a-sha' });
  const result = spawnSync('node', [SCRIPT, root], { encoding: 'utf-8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /genesis_commit.*malformed|not.*sha|invalid/i);
});
```

- [ ] **Step 2: Run the test — confirm FAIL**

```bash
node --test tests/scripts/validate-identity.test.mjs
```

Expected: all four tests FAIL with `Cannot find module` or similar — the script doesn't exist yet.

- [ ] **Step 3: Do not commit yet** — failing tests get committed together with implementation in Task 3.

---

## Task 3: validate-identity — implement and commit

**Files:**
- Create: `scripts/validate-identity.mjs`

- [ ] **Step 1: Implement the script**

Create `scripts/validate-identity.mjs`:

```javascript
#!/usr/bin/env node

/**
 * validate-identity.mjs — Validate identity invariants for an org-os instance
 *
 * Usage: node scripts/validate-identity.mjs [path]
 *
 * Checks (in addition to validate-structure §8 version triplet):
 * 1. IDENTITY.md "Name" agrees with federation.yaml.identity.name
 * 2. federation.yaml.metadata.genesis_commit exists and looks like a SHA
 * 3. federation.yaml.metadata.last_sync_commit (if present) looks like a SHA
 *
 * Exit codes: 0 = pass, 1 = any check failed
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { load as loadYaml } from 'js-yaml';

const rootDir = resolve(process.argv[2] || '.');

let passed = 0;
let failed = 0;

function check(description, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.log(`  ✗ ${description}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function readIdentityName(identityMdPath) {
  if (!existsSync(identityMdPath)) return null;
  const text = readFileSync(identityMdPath, 'utf-8');
  // Look for "- **Name:** value" or "**Name:** value" or "Name: value"
  const m = text.match(/\*?\*?Name:?\*?\*?\s*[:|]\s*([^\n*]+)/i)
        || text.match(/^[-\s]*\*\*Name:\*\*\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

function isShaShape(s) {
  return typeof s === 'string' && /^[0-9a-f]{7,40}$/i.test(s);
}

console.log('\nIdentity validation\n');

const fedPath = join(rootDir, 'federation.yaml');
if (!existsSync(fedPath)) {
  console.log('  ✗ federation.yaml not found');
  console.log(`\n${passed} passed, 1 failed`);
  process.exit(1);
}

const fed = loadYaml(readFileSync(fedPath, 'utf-8'));

// Check 1: IDENTITY.md name vs federation.yaml.identity.name
const idMdPath = join(rootDir, 'IDENTITY.md');
const idMdName = readIdentityName(idMdPath);
const fedName = fed?.identity?.name;
check(
  'IDENTITY.md Name agrees with federation.yaml.identity.name',
  idMdName !== null && fedName !== undefined && idMdName === fedName,
  `IDENTITY.md="${idMdName ?? '(not found)'}" vs federation.yaml="${fedName ?? '(not found)'}"`
);

// Check 2: genesis_commit present and SHA-shaped
const genesis = fed?.metadata?.genesis_commit;
check(
  'federation.yaml.metadata.genesis_commit is present and SHA-shaped',
  isShaShape(genesis),
  genesis === undefined ? 'genesis_commit is missing' : `genesis_commit="${genesis}" is malformed (not a 7–40 hex SHA)`
);

// Check 3: last_sync_commit (optional) SHA-shaped
const lastSync = fed?.metadata?.last_sync_commit;
if (lastSync !== undefined && lastSync !== null) {
  check(
    'federation.yaml.metadata.last_sync_commit is SHA-shaped',
    isShaShape(lastSync),
    `last_sync_commit="${lastSync}" is malformed (not a 7–40 hex SHA)`
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run the test — confirm PASS**

```bash
node --test tests/scripts/validate-identity.test.mjs
```

Expected: 4/4 PASS.

- [ ] **Step 3: Verify `npm run validate:schemas` no longer errors**

```bash
npm run validate:schemas
```

It will now run validate-identity.mjs against the org-os repo itself. May fail because `genesis_commit` is not yet in this repo's federation.yaml — that's expected and gets fixed in Task 4. Capture stdout for the postmortem.

- [ ] **Step 4: Commit**

```bash
git add scripts/validate-identity.mjs tests/scripts/validate-identity.test.mjs
git commit -m "scripts: implement validate-identity.mjs (resolves npm run validate:schemas)

Closes the phantom-script reference in package.json:22 that the
autopoiesis Phase 1 research flagged 4+ times across cell notes.
Tests in tests/scripts/validate-identity.test.mjs (TDD-driven, 4 cases).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Lineage stamp — populate org-os's federation.yaml + extend validate-structure

**Files:**
- Modify: `federation.yaml`
- Modify: `scripts/validate-structure.mjs`

- [ ] **Step 1: Capture the genesis commit for org-os itself**

The framework's own `genesis_commit` is the first commit in this repo. Find it:

```bash
git log --reverse --pretty=format:"%H" | head -1
```

Capture the full SHA (40 chars). Note it for step 2.

- [ ] **Step 2: Add `genesis_commit` to `federation.yaml.metadata`**

Open `federation.yaml`. Find the `metadata:` block (currently has `framework_version: "3.0"`, possibly other fields). Add after `framework_version`:

```yaml
metadata:
  framework_version: "3.0"
  genesis_commit: "<the SHA from step 1>"
  # last_sync_commit is omitted on the framework itself (it has no upstream)
  ...existing fields...
```

`last_sync_commit` is omitted on the framework because the framework has no upstream — it IS the upstream. Document this in a YAML comment.

- [ ] **Step 3: Extend `validate-structure.mjs` to check `genesis_commit`**

Read `scripts/validate-structure.mjs`. Find Section 8 (Version Consistency, the version-triplet check). Add a parallel block "Section 8b: Lineage Stamp":

```javascript
// --- 8b. Lineage Stamp ---
console.log('\n8b. Lineage Stamp');

const genesisCommit = federation?.metadata?.genesis_commit;
check(
  'federation.yaml.metadata.genesis_commit is present',
  typeof genesisCommit === 'string' && genesisCommit.length > 0
);

if (typeof genesisCommit === 'string' && genesisCommit.length > 0) {
  check(
    'federation.yaml.metadata.genesis_commit is SHA-shaped (7–40 hex chars)',
    /^[0-9a-f]{7,40}$/i.test(genesisCommit)
  );
}
```

Place after the existing Section 8 and before the summary.

- [ ] **Step 4: Run validators**

```bash
npm run validate:structure
npm run validate:schemas
```

Both must succeed. If `validate:structure` fails on the lineage check, the SHA in step 2 was wrong — fix it.

- [ ] **Step 5: Commit**

```bash
git add federation.yaml scripts/validate-structure.mjs
git commit -m "lineage: stamp framework's genesis_commit + extend validate-structure

federation.yaml.metadata gains genesis_commit (immutable). validate-structure
gains Section 8b checking presence and SHA shape. last_sync_commit is the
mutable companion field, set by sync-upstream (Task 6) on instances; the
framework itself has no upstream and omits the field.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: sync-upstream — write failing test

**Files:**
- Create: `tests/scripts/sync-upstream.test.mjs`

- [ ] **Step 1: Create the test file**

```javascript
// tests/scripts/sync-upstream.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('scripts/sync-upstream.mjs');

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function setupFrameworkAndInstance() {
  const root = mkdtempSync(path.join(tmpdir(), 'sync-upstream-'));
  const framework = path.join(root, 'framework');
  const instance = path.join(root, 'instance');

  // Create framework repo
  mkdirSync(framework);
  git(framework, ['init', '-b', 'main', '-q']);
  git(framework, ['config', 'user.email', 'test@test']);
  git(framework, ['config', 'user.name', 'test']);
  writeFileSync(path.join(framework, 'README.md'), '# framework v1\n');
  writeFileSync(path.join(framework, 'shared.md'), 'shared content v1\n');
  mkdirSync(path.join(framework, 'data'));
  writeFileSync(path.join(framework, 'data/members.yaml'), 'schema_version: "2.0"\nmembers: []\n');
  writeFileSync(path.join(framework, 'package.json'), JSON.stringify({ name: 'fw', version: '3.0.0' }));
  git(framework, ['add', '.']);
  git(framework, ['commit', '-m', 'fw v1', '-q']);
  const frameworkGenesis = git(framework, ['rev-parse', 'HEAD']);

  // Clone framework into instance (instance starts as a fork)
  spawnSync('git', ['clone', '-q', framework, instance], { encoding: 'utf-8' });
  git(instance, ['config', 'user.email', 'test@test']);
  git(instance, ['config', 'user.name', 'test']);

  // Add instance-specific customizations + federation.yaml + SOUL.md
  writeFileSync(path.join(instance, 'SOUL.md'), 'instance soul (custom)\n');
  writeFileSync(path.join(instance, 'IDENTITY.md'), '- **Name:** test-instance\n');
  writeFileSync(path.join(instance, 'federation.yaml'), `
identity:
  name: test-instance
  type: Project
federation:
  network: test
agent:
  runtime: claude-code
metadata:
  framework_version: "3.0"
  genesis_commit: "${frameworkGenesis}"
customizations:
  - path: SOUL.md
    maintain_on_sync: true
  - path: IDENTITY.md
    maintain_on_sync: true
`);
  git(instance, ['add', '.']);
  git(instance, ['commit', '-m', 'instance setup', '-q']);

  // Now bump the framework
  writeFileSync(path.join(framework, 'README.md'), '# framework v2\n');
  writeFileSync(path.join(framework, 'shared.md'), 'shared content v2\n');
  git(framework, ['add', '.']);
  git(framework, ['commit', '-m', 'fw v2', '-q']);

  return { root, framework, instance, frameworkGenesis };
}

test('sync-upstream pulls framework changes into instance', () => {
  const { framework, instance } = setupFrameworkAndInstance();
  const result = spawnSync('node', [SCRIPT, '--upstream', framework], {
    cwd: instance, encoding: 'utf-8'
  });
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.equal(readFileSync(path.join(instance, 'README.md'), 'utf-8'), '# framework v2\n');
  assert.equal(readFileSync(path.join(instance, 'shared.md'), 'utf-8'), 'shared content v2\n');
});

test('sync-upstream preserves customizations marked maintain_on_sync', () => {
  const { framework, instance } = setupFrameworkAndInstance();
  spawnSync('node', [SCRIPT, '--upstream', framework], { cwd: instance, encoding: 'utf-8' });
  // SOUL.md was customized; framework didn't have it; must be preserved
  assert.equal(readFileSync(path.join(instance, 'SOUL.md'), 'utf-8'), 'instance soul (custom)\n');
  assert.equal(readFileSync(path.join(instance, 'IDENTITY.md'), 'utf-8'), '- **Name:** test-instance\n');
});

test('sync-upstream updates last_sync_commit in federation.yaml', () => {
  const { framework, instance } = setupFrameworkAndInstance();
  const fwHead = git(framework, ['rev-parse', 'HEAD']);
  spawnSync('node', [SCRIPT, '--upstream', framework], { cwd: instance, encoding: 'utf-8' });
  const fed = readFileSync(path.join(instance, 'federation.yaml'), 'utf-8');
  assert.match(fed, new RegExp(`last_sync_commit:\\s*['"]?${fwHead}['"]?`), `expected last_sync_commit=${fwHead}`);
});

test('sync-upstream writes a sync receipt to memory/', () => {
  const { framework, instance } = setupFrameworkAndInstance();
  mkdirSync(path.join(instance, 'memory'), { recursive: true });
  spawnSync('node', [SCRIPT, '--upstream', framework], { cwd: instance, encoding: 'utf-8' });
  const memoryFiles = require('node:fs').readdirSync(path.join(instance, 'memory'));
  const receipt = memoryFiles.find(f => /\d{4}-\d{2}-\d{2}/.test(f));
  assert.ok(receipt, 'no dated memory file produced');
  const body = readFileSync(path.join(instance, 'memory', receipt), 'utf-8');
  assert.match(body, /sync.*upstream/i);
});

test('sync-upstream is a no-op when already up to date', () => {
  const { framework, instance } = setupFrameworkAndInstance();
  spawnSync('node', [SCRIPT, '--upstream', framework], { cwd: instance, encoding: 'utf-8' });
  // Run again — should detect no-op
  const result = spawnSync('node', [SCRIPT, '--upstream', framework], {
    cwd: instance, encoding: 'utf-8'
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /up.to.date|no.changes|already/i);
});
```

- [ ] **Step 2: Run — confirm FAIL**

```bash
node --test tests/scripts/sync-upstream.test.mjs
```

Expected: all 5 tests fail with `Cannot find module 'scripts/sync-upstream.mjs'`.

- [ ] **Step 3: Do not commit yet** — paired with Task 6.

---

## Task 6: sync-upstream — implement

**Files:**
- Create: `scripts/sync-upstream.mjs`

- [ ] **Step 1: Implement the script**

Create `scripts/sync-upstream.mjs`:

```javascript
#!/usr/bin/env node

/**
 * sync-upstream.mjs — Sync an org-os instance with its upstream framework.
 *
 * Usage:
 *   node scripts/sync-upstream.mjs [--upstream <url-or-path>]
 *
 * Behavior:
 *   1. Resolve upstream (flag, then git remote 'upstream', then federation.yaml)
 *   2. git fetch upstream main
 *   3. Read federation.yaml.customizations[].path with maintain_on_sync: true
 *   4. Stash maintain-paths if they exist in instance and would be touched
 *   5. git merge upstream/main --no-edit (or no-op if up to date)
 *   6. Restore stashed maintain-paths
 *   7. Update federation.yaml.metadata.last_sync_commit to upstream HEAD
 *   8. Write a sync receipt to memory/YYYY-MM-DD.md
 *   9. Run npm run migrate if framework_version advanced
 *  10. Run npm run validate:structure on completion
 *
 * Exit codes: 0 = pass, 1 = any step failed (with structured error message)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { spawnSync } from 'child_process';
import { load as loadYaml, dump as dumpYaml } from 'js-yaml';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';

const args = process.argv.slice(2);
let upstreamArg = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--upstream') upstreamArg = args[i + 1];
}

const rootDir = resolve('.');

function git(cmd, opts = {}) {
  const r = spawnSync('git', cmd, { cwd: rootDir, encoding: 'utf-8', ...opts });
  return { ...r, stdout: r.stdout?.trim() ?? '', stderr: r.stderr?.trim() ?? '' };
}

function fail(msg) {
  console.error(`sync-upstream: ${msg}`);
  process.exit(1);
}

function readFed() {
  const p = join(rootDir, 'federation.yaml');
  if (!existsSync(p)) fail('federation.yaml not found in instance root');
  return { path: p, doc: loadYaml(readFileSync(p, 'utf-8')) };
}

console.log('sync-upstream: starting');

// Step 1: Resolve upstream
let upstream = upstreamArg;
if (!upstream) {
  const r = git(['remote', 'get-url', 'upstream']);
  if (r.status === 0 && r.stdout) upstream = r.stdout;
}
if (!upstream) {
  // Fallback: federation.yaml.federation.upstream or federation.yaml.metadata.upstream
  const { doc } = readFed();
  upstream = doc?.federation?.upstream || doc?.metadata?.upstream;
}
if (!upstream) fail('no upstream specified (--upstream, git remote upstream, or federation.yaml.federation.upstream)');
console.log(`sync-upstream: upstream = ${upstream}`);

// Ensure git remote exists
const remoteCheck = git(['remote', 'get-url', 'upstream']);
if (remoteCheck.status !== 0) {
  const add = git(['remote', 'add', 'upstream', upstream]);
  if (add.status !== 0) fail(`failed to add upstream remote: ${add.stderr}`);
}

// Step 2: Fetch
const fetch = git(['fetch', '--quiet', 'upstream', 'main']);
if (fetch.status !== 0) fail(`git fetch failed: ${fetch.stderr}`);
const upstreamHead = git(['rev-parse', 'upstream/main']).stdout;
const localHead = git(['rev-parse', 'HEAD']).stdout;
if (upstreamHead === localHead) {
  console.log('sync-upstream: already up to date — nothing to merge');
  // Still write a receipt? — yes, document the check.
  writeReceipt(rootDir, upstream, upstreamHead, /*noOp=*/true);
  process.exit(0);
}

// Step 3: Read customizations
const fed = readFed();
const customs = (fed.doc?.customizations || [])
  .filter(c => c.maintain_on_sync === true && c.path)
  .map(c => c.path);

// Step 4: Stash maintain-paths
const stashDir = mkdtempSync(join(tmpdir(), 'sync-upstream-stash-'));
const stashed = [];
for (const p of customs) {
  const src = join(rootDir, p);
  if (existsSync(src)) {
    const dst = join(stashDir, p);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    stashed.push(p);
  }
}

// Step 5: Merge
const merge = git(['merge', '--no-edit', 'upstream/main']);
if (merge.status !== 0) {
  // Restore stash before failing
  restoreStash(rootDir, stashDir, stashed);
  fail(`git merge failed (conflicts likely): ${merge.stderr}`);
}

// Step 6: Restore stash
restoreStash(rootDir, stashDir, stashed);

// Step 7: Update last_sync_commit
const fed2 = readFed();
fed2.doc.metadata = fed2.doc.metadata || {};
fed2.doc.metadata.last_sync_commit = upstreamHead;
writeFileSync(fed2.path, dumpYaml(fed2.doc, { lineWidth: 100 }));

// Step 8: Sync receipt
writeReceipt(rootDir, upstream, upstreamHead, /*noOp=*/false);

// Step 9: Run migrate if framework_version advanced
const oldFwVer = fed.doc?.metadata?.framework_version;
const newFwVer = fed2.doc?.metadata?.framework_version;
if (oldFwVer !== newFwVer) {
  console.log(`sync-upstream: framework_version ${oldFwVer} → ${newFwVer}; running migrate`);
  const m = spawnSync('npm', ['run', 'migrate'], { cwd: rootDir, stdio: 'inherit' });
  if (m.status !== 0) fail('npm run migrate failed');
}

// Step 10: Validate
const v = spawnSync('npm', ['run', 'validate:structure'], { cwd: rootDir, stdio: 'inherit' });
if (v.status !== 0) fail('npm run validate:structure failed after sync');

console.log('sync-upstream: complete');

// Helpers
function restoreStash(rootDir, stashDir, paths) {
  for (const p of paths) {
    const src = join(stashDir, p);
    const dst = join(rootDir, p);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
  }
  // Stage restored files (if changed)
  if (paths.length > 0) {
    const r = git(['add', ...paths]);
    if (r.status === 0) git(['commit', '-m', 'sync: restore maintain_on_sync customizations', '--allow-empty']);
  }
}

function writeReceipt(rootDir, upstream, upstreamHead, noOp) {
  const memoryDir = join(rootDir, 'memory');
  if (!existsSync(memoryDir)) return;
  const today = new Date().toISOString().slice(0, 10);
  const file = join(memoryDir, `${today}.md`);
  const stamp = new Date().toISOString();
  const block = `\n## Sync upstream — ${stamp}\n\n` +
    `- Upstream: ${upstream}\n` +
    `- Upstream HEAD: ${upstreamHead}\n` +
    `- Status: ${noOp ? 'already up to date (no-op)' : 'merged'}\n`;
  if (existsSync(file)) {
    writeFileSync(file, readFileSync(file, 'utf-8') + block);
  } else {
    writeFileSync(file, `# Memory ${today}\n${block}`);
  }
}
```

- [ ] **Step 2: Run tests — confirm PASS**

```bash
node --test tests/scripts/sync-upstream.test.mjs
```

Expected: 5/5 PASS. If the "no-op" test fails, the up-to-date detection isn't quite right; iterate.

- [ ] **Step 3: Confirm `npm run sync:upstream` no longer 404s**

```bash
npm run sync:upstream
```

Expected: it errors with "no upstream specified" (since the framework has no upstream of its own) — but the script *runs*, no longer "Cannot find module." Capture this output for the postmortem.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-upstream.mjs tests/scripts/sync-upstream.test.mjs
git commit -m "scripts: implement sync-upstream.mjs (closes Loop C cascade edge)

Closes the most-referenced phantom script (cited 6+ times across
package.json, validate-structure.mjs, AGENTIC-ARCHITECTURE.md,
FEDERATION.md, SKILL-PROMOTION.md, package-integration plan).

Behavior: resolve upstream, fetch+merge, preserve maintain_on_sync
customizations via stash-and-restore, update last_sync_commit, write
memory receipt, run migrate if framework_version advanced, validate
on completion.

Tests in tests/scripts/sync-upstream.test.mjs (TDD-driven, 5 cases
covering happy path, customization preservation, last_sync_commit
update, memory receipt, no-op detection).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Update FEDERATION.md and VERSIONING.md

**Files:**
- Modify: `docs/FEDERATION.md`
- Modify: `docs/VERSIONING.md`

- [ ] **Step 1: Document the lineage stamp in FEDERATION.md**

Find the section in `docs/FEDERATION.md` describing `federation.yaml`'s `metadata` block (or add one if absent). Add:

```markdown
### Lineage stamp (`metadata.genesis_commit`, `metadata.last_sync_commit`)

Every instance carries a lineage stamp in its `federation.yaml.metadata` block:

- **`genesis_commit`** (string, immutable) — the SHA of the instance's first
  commit. Set at scaffolding time, never modified afterwards. Records the
  exact framework state from which this instance was born. Validated by
  `npm run validate:structure` (Section 8b) and `npm run validate:schemas`.

- **`last_sync_commit`** (string, mutable) — the SHA of the upstream framework
  HEAD at the most recent sync. Updated automatically by `npm run sync:upstream`.
  Omitted on the framework itself (the framework has no upstream).

Use cases:
- Audit the framework version from which an instance was born vs. its current
  synced state.
- Detect forks: if instance A's `genesis_commit` matches instance B's
  `genesis_commit`, they share an ancestor.
- Validate sync receipts: `last_sync_commit` matches `memory/YYYY-MM-DD.md`
  sync receipt entries.
```

- [ ] **Step 2: Update VERSIONING.md "Instance migration — pull-based" recipe**

Find the section in `docs/VERSIONING.md` that mentions `npm run sync:upstream` (per the synthesis, it's already referenced in the "Instance migration — pull-based" recipe). Confirm the script now exists; remove any "this script is not yet implemented" caveats. Add a one-paragraph note that the recipe is now functional, and reference the lineage stamp behavior:

```markdown
> **Note (2026-05-02):** `npm run sync:upstream` is now implemented
> (see `scripts/sync-upstream.mjs`, autopoiesis Phase 2 pilot). The
> recipe below is functional. After a sync, `federation.yaml.metadata.last_sync_commit`
> records the upstream HEAD that was merged, and a sync receipt lands in
> `memory/YYYY-MM-DD.md`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/FEDERATION.md docs/VERSIONING.md
git commit -m "docs: document lineage stamp + functional sync:upstream

federation.yaml.metadata.genesis_commit and last_sync_commit are now
load-bearing; describe their semantics in FEDERATION.md. VERSIONING.md
recipe for instance pull-based migration is now functional (sync:upstream
is no longer a phantom script).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Update PILOT-framework.md "Artifacts implemented" section

**Files:**
- Modify: `docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md`

- [ ] **Step 1: Edit PILOT-framework.md "Artifacts implemented" section**

Append:

```markdown
## Artifacts implemented

- `scripts/validate-identity.mjs` — phantom validator now real. Resolves
  `npm run validate:schemas`. Tests: `tests/scripts/validate-identity.test.mjs`
  (4/4 pass).
- `scripts/sync-upstream.mjs` — phantom propagation script now real. Resolves
  `npm run sync:upstream`. Tests: `tests/scripts/sync-upstream.test.mjs`
  (5/5 pass).
- `federation.yaml` — `metadata.genesis_commit` populated with the framework's
  own first commit SHA. `last_sync_commit` omitted (framework has no upstream).
- `scripts/validate-structure.mjs` — Section 8b added: validates
  `genesis_commit` presence + SHA shape.
- `docs/FEDERATION.md` — lineage stamp documented.
- `docs/VERSIONING.md` — pull-based migration recipe now marked functional.
```

- [ ] **Step 2: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md"
git commit -m "pilot: log artifacts implemented for cascade closure

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Exercise the closed loop end-to-end

**Files:**
- Modify: `docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md`

- [ ] **Step 1: Define the test bed**

Loop C is exercised in two stages:

**Stage A — Self-validation (the framework validates itself):**
```bash
npm run validate:structure
npm run validate:schemas
```
Both must pass on the framework's own files. This proves the artifacts work against the framework as a self-instance.

**Stage B — Synthetic propagation (a temp clone simulates a downstream instance):**
```bash
TMP=$(mktemp -d)
git clone . "$TMP/instance"
cd "$TMP/instance"
# add a customization marker
echo "instance-only soul" > SOUL.md
git add SOUL.md
git -c commit.gpgsign=false commit -m "instance customization"
# bump the upstream framework
cd -
echo "upstream change" >> README.md
git add README.md
git -c commit.gpgsign=false commit -m "framework bump for sync test"
# sync the instance
cd "$TMP/instance"
npm run sync:upstream -- --upstream "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
# verify
cat SOUL.md   # should still say "instance-only soul"
grep last_sync_commit federation.yaml   # should be set
ls memory/    # should have today's receipt
cd -
git reset --hard HEAD~1   # roll back framework's test bump
rm -rf "$TMP"
```

(Adjust paths and commit-signing flags to match the operator's local env.)

- [ ] **Step 2: Run Stage A**

Execute. Capture stdout. Both validators MUST pass.

- [ ] **Step 3: Run Stage B**

Execute. Capture each command's stdout/stderr. Stash the receipt's path before tearing down `$TMP`.

- [ ] **Step 4: Document outputs in PILOT-framework.md**

Append to "Exercise — what we ran, what happened":

```markdown
## Exercise — what we ran, what happened

**Stage A — Self-validation:**
- `npm run validate:structure`: <pass/fail + any output>
- `npm run validate:schemas`: <pass/fail + any output>

**Stage B — Synthetic propagation:**
- `git clone` of framework into temp dir: <result>
- Instance customization (`SOUL.md` "instance-only soul"): <commit SHA>
- Framework bump: <commit SHA>
- `npm run sync:upstream --upstream <path>`:
  - Output: <captured>
  - SOUL.md preserved: <yes/no>
  - last_sync_commit updated: <yes/no, value>
  - Memory receipt produced: <yes/no, path>
- Cleanup: tested in temp dir, framework's test bump rolled back.

**Closure evidence:** the loop closed if Stage B's instance:
1. Pulled the framework bump (README.md changed).
2. Preserved its own SOUL.md customization.
3. Has `last_sync_commit` set to the upstream HEAD.
4. Has a sync receipt in `memory/YYYY-MM-DD.md`.

All four conditions: <met/not met>.
```

- [ ] **Step 5: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md"
git commit -m "pilot: exercise cascade loop end-to-end + record outputs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Postmortem — what worked, what broke, decisions for Phase 3

**Files:**
- Modify: `docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md`

- [ ] **Step 1: Write "What worked"**

Each entry must point to specific evidence from Task 9 outputs. No abstract praise.

```markdown
## What worked

- <claim with concrete reference, e.g., "validate-identity now resolves
  `npm run validate:schemas` — output verifies pass on framework's own
  federation.yaml after Task 4 lineage stamp">
- <next claim>
```

- [ ] **Step 2: Write "What broke / had to be invented"**

```markdown
## What broke / had to be invented

- **<concrete failure mode>:** <what we tried, why it failed, what we
  changed>. File paths.
- **<invention>:** <what wasn't in this plan but emerged as needed>.
  Note whether it should land in DECISIONS.md (Phase 3).
```

Likely candidates (fill in based on what actually happened):
- Stash-and-restore using fs vs. git stash: choice rationale.
- IDENTITY.md "Name" field parsing fragility (regex over markdown).
- Whether `last_sync_commit` should be in `metadata.` or in a parallel
  `lineage:` block. Phase 2 picked `metadata.`; Phase 3 may revisit.

- [ ] **Step 3: Write "Decisions for Phase 3 DECISIONS.md"**

Scan the postmortem for any architectural decisions implied. Likely:

```markdown
## Decisions for Phase 3 DECISIONS.md

- **Identity validation = file-agreement + SHA-shape check.** Lighter than
  cryptographic identity (DID); enough to catch drift today; defers the DID
  story to a later plan (`identity-lineage-tracking` per SYNTHESIS net-new).
- **Lineage stamp = `genesis_commit` + `last_sync_commit` in `metadata.`.**
  Picked `metadata.` over a parallel `lineage:` block to avoid yet another
  top-level key; revisit if more lineage fields accumulate.
- **Sync preserves customizations via fs stash, not git stash.** Avoids
  mutating the parent vault's git state when the instance is a submodule.
- **`last_sync_commit` is omitted on the framework itself.** The framework
  has no upstream; including the field would be misleading.
```

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md"
git commit -m "pilot: postmortem — what worked, what broke, Phase 3 decisions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Migration note for downstream instances

**Files:**
- Modify: `docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md`

- [ ] **Step 1: List downstream instances**

From `data/instances.yaml` and `repos.manifest.json`, list each downstream:
`refi-bcn-os`, `refi-dao-os`, `refi-med-os`, `dao-os`, `openclaw`, `regen-coordination-os`.

- [ ] **Step 2: Append migration section**

Append to PILOT-framework.md:

```markdown
## Migration note for downstream instances

When `npm run sync:upstream` runs against a downstream instance after
this Phase 2 lands:

**New files (delivered via sync):**
- `scripts/sync-upstream.mjs` — replaces the phantom reference. Now
  the script that the package.json entry pointed at exists.
- `scripts/validate-identity.mjs` — replaces the phantom reference.
  `npm run validate:schemas` will work end-to-end.
- `tests/scripts/sync-upstream.test.mjs`, `tests/scripts/validate-identity.test.mjs`
  — TDD test harness. Optional for instances; ships with the framework.

**Modified files (delivered via sync):**
- `scripts/validate-structure.mjs` — Section 8b added (lineage stamp
  presence + SHA-shape check). Existing instances will fail Section 8b
  until their `federation.yaml` is updated (next bullet).
- `docs/FEDERATION.md` and `docs/VERSIONING.md` — documentation updates.

**Required follow-up per instance (operator-driven):**
1. Add `genesis_commit` to `federation.yaml.metadata`. The SHA is the
   first commit in the instance's git history:
   ```bash
   git log --reverse --pretty=format:"%H" | head -1
   ```
2. (Optional) Set `last_sync_commit` to the current upstream HEAD if
   the instance has been synced manually before; subsequent syncs will
   update it automatically.
3. Run `npm run validate:structure` to confirm Section 8b passes.

**Per-instance notes:**

| Instance | Notes |
|----------|-------|
| `refi-bcn-os` | Production. Run sync at next maintenance window. |
| `refi-dao-os` | Production. Last sync 2026-03-06 — overdue. Sync expected to deliver several frameworks of accumulated changes; review before merging. |
| `refi-med-os` | Fresh (born 2026-04-29). First-ever sync; will populate everything. `genesis_commit` should be set to its own first commit. |
| `dao-os` | Last sync 2026-04-02. |
| `openclaw` | AgentRuntime, not a typical data instance — verify the lineage stamp + sync model is appropriate or document an exception. |
| `regen-coordination-os` | Listed in `repos.manifest.json` but not cloned locally. Defer until cloned. |
```

- [ ] **Step 3: Update PILOT-framework.md status**

Change top status line to `Status: complete, awaiting Phase 2 gate`.

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md"
git commit -m "pilot: migration note for downstream + Phase 2 marked complete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Phase 2 gate — present pilot to operator

**Files:** none (review-only task)

- [ ] **Step 1: Vault-safety audit**

If a snapshot was taken at Task 1 step 3, run:

```bash
cd "../../.." && npm run vault:audit && cd "03 Libraries/org-os"
```

Confirm no unintended deletions in the parent vault.

- [ ] **Step 2: Present Phase 2 close summary to operator**

In one message:
- Path to PILOT-framework.md.
- One-line summary of artifacts implemented (validate-identity, sync-upstream, lineage stamp).
- One-line summary of what worked (cite Stage A + Stage B exercise outcomes).
- One-line summary of what broke / was invented.
- Branch name (`autopoiesis-phase2-pilot`).
- Direct ask: "Approve the pilot for Phase 3 cascade, or request changes?"

- [ ] **Step 3: Wait for operator response**

If operator requests changes: revise pilot artifacts and/or postmortem, re-commit, re-present.

If operator approves: proceed to Phase 3 (separate plan: `2026-05-02-autopoiesis-phase3-decisions.md`).

- [ ] **Step 4: Update QUEUE.md**

Mark Phase 2 complete in `docs/agent-plans/QUEUE.md`:

```bash
git add "docs/agent-plans/QUEUE.md"
git commit -m "queue: autopoiesis Phase 2 complete (cascade closure)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

The Phase 2 branch (`autopoiesis-phase2-pilot`) merges to the release branch as part of Phase 3 cascade — not here.

---

## Self-review checklist

- [x] **Spec coverage:** all three closing-edge artifacts from SYNTHESIS.md (`sync-upstream.mjs`, `validate-identity.mjs`, lineage stamp) have implementation tasks. Postmortem, migration note, gate all present.
- [x] **Placeholder scan:** no TBDs or "implement later." Code blocks contain real, complete implementations. Test cases name real behavior, not `// TODO: assert something`. Bracketed slots in PILOT-framework.md are explicit content slots filled from Task 9 outputs, not lazy placeholders.
- [x] **Type consistency:** `genesis_commit` and `last_sync_commit` are spelled identically across all tasks. SHA-shape regex (`/^[0-9a-f]{7,40}$/i`) appears in both validate-identity (Task 3) and validate-structure §8b (Task 4) — same pattern. File paths consistent.
- [x] **TDD discipline:** every code artifact has a test file written before implementation (Tasks 2 → 3, Tasks 5 → 6).

## Notes

- The framework itself acts as both the test-bed (Stage A self-validation) and the upstream (Stage B synthetic propagation). The synthetic clone exists only in `mktemp -d` and is torn down — no permanent change to any other directory.
- `tests/scripts/` doesn't exist yet at task start. The test runner (node --test) will create it implicitly when the test file is added.
- `last_sync_commit` is intentionally omitted on the framework itself; this is a design choice, not an oversight.
- If the implementation reveals that `js-yaml`'s `dump()` reorders or reformats the `federation.yaml` more aggressively than desired, switch to a surgical text-replacement on the `last_sync_commit:` line rather than full re-emit. The TDD test will catch this regression on its own.
