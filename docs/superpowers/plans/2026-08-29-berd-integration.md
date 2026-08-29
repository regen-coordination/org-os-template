# Berd Integration (module #4 + skills bridge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formalize the shipped Berd personas layer as module #4 `org-os-berd` and bridge a curated set of org-os skills into Berd's project-local Agent Skills surface via a marker-guarded generated mirror.

**Architecture:** `scripts/sync-skills-berd.mjs` — third run of the `sync-commands` → `sync-agents` pattern — materializes skill directories from canonical `skills/<name>/` into `.agents/skills/<name>/`, injecting a `managed_by: org-os` marker into each materialized SKILL.md. The curation list lives in the module manifest's `files:` materialization map. Copies are committed; a `--check` drift mode joins the gates.

**Tech Stack:** Node ESM (`.mjs`), `gray-matter` (already a dep), `node --test` root glob, `js-yaml` if already present else a manifest read via `gray-matter`'s YAML engine. External: Berd desktop ≥ v0.6.0 + its Goose sidecar (verification only — no runtime dependency).

**Spec:** `docs/superpowers/specs/2026-08-28-berd-integration-design.md`

## Global Constraints

- Canon never leaves `skills/`; `.agents/skills/` is a materialized view, committed, drift-gated (spec: Architecture).
- The marker guard is absolute: no file without `managed_by: org-os` in its target SKILL.md is ever overwritten except via explicit `--adopt`. `.agents/skills/feynman/` must survive every run untouched (spec: feynman decision).
- `module.yaml` schema is strict (`additionalProperties: false`, no status key): the curation list is expressed as `files:` materialization entries; status lives in `docs/MODULES.md` + `site/src/data/modules.yaml` (double-entry, site test gates drift).
- The exposure list only ever names Goose-verified skills — prune, don't aspire (spec: curation criteria).
- Marker injection is textual and deterministic: insert the line `managed_by: org-os` immediately before the frontmatter's closing `---`; all other bytes verbatim. `--check` recomputes and byte-compares.
- Tests in root `tests/scripts/`; `npx prettier . --check` green before every commit; stage explicit paths only.

---

### Task 1: Verify Berd's project-local skills discovery (build-gate assumption)

**Files:**
- Create: `docs/integrations/berd.md`

**Interfaces:**
- Produces: the verified skills-discovery directory (assumed `.agents/skills/`) and Berd/Goose versions — Task 2's manifest targets and Task 3's DEFAULT_TARGET must copy from this file.

- [ ] **Step 1: Check the source of truth.** In the Berd repo/docs (github.com/block/berd, pinned ≥ v0.6.0): confirm where a *project* (not Berd's own repo) publishes project-local Agent Skills, and how Goose loads them. Record exact doc/source references.
- [ ] **Step 2: Live confirmation.** Open this repo as a Berd project; verify the existing `.agents/skills/feynman/*` skills appear/load. If discovery is NOT `.agents/skills/`, record the real path — every later task uses the recorded value.
- [ ] **Step 3: Write `docs/integrations/berd.md`** — sections: What Berd is (one paragraph, from the spec header); Verified surfaces (agents dir — verified 2026-08-20; skills dir — verified today, exact path + Berd/Goose versions); The bridge (one paragraph pointing at module #4 + `sync:skills:berd`); Re-verification note (on Berd minor bumps, re-run this task's steps).
- [ ] **Step 4: Commit** — `git add docs/integrations/berd.md && git commit -m "docs(berd): verify project-local skills discovery surface"`

### Task 2: Module #4 manifest (curation list lives here)

**Files:**
- Create: `modules/org-os-berd/module.yaml`

**Interfaces:**
- Produces: the `files:` map that `sync-skills-berd.mjs` (Task 3) reads as its curation list — entries whose value starts with `.agents/skills/`.

- [ ] **Step 1: Write `modules/org-os-berd/module.yaml`:**

```yaml
# org-os-berd — the Berd desktop integration (module #4).
#
# HYBRID mapping: identity entries own shipped in-place content (personas,
# sync scripts); materialization entries (skills/<name> → .agents/skills/<name>)
# double as the CURATED EXPOSURE LIST that scripts/sync-skills-berd.mjs reads.
# Only Goose-verified skills may appear as materialization entries (Task 5
# prunes). Status lives in docs/MODULES.md, not here (schema is strict).
id: org-os-berd
version: 0.1.0
type: integration
description: >-
  Berd desktop integration — canonical in-repo agent personas (Operator,
  Upstream) mirrored to the user level, plus a curated, marker-guarded bridge
  materializing org-os skills into Berd's project-local .agents/skills/
  surface so Berd/Goose agents work this org with its own skills.
dependencies:
  - org-os-standards
files:
  .agents/agents: .agents/agents
  scripts/sync-agents.mjs: scripts/sync-agents.mjs
  scripts/sync-skills-berd.mjs: scripts/sync-skills-berd.mjs
  skills/org-os-init: .agents/skills/org-os-init
  skills/meeting-processor: .agents/skills/meeting-processor
  skills/heartbeat-monitor: .agents/skills/heartbeat-monitor
  skills/knowledge-curator: .agents/skills/knowledge-curator
  skills/funding-scout: .agents/skills/funding-scout
checks:
  - file-exists: .agents/agents/operator.md
  - file-exists: scripts/sync-skills-berd.mjs
  - command: node scripts/sync-skills-berd.mjs --check
```

- [ ] **Step 2: Run the manifest gate.** `npm test 2>&1 | grep -i manifest` — Expected: PASS (schema-valid, id matches dir). Note `sync-skills-berd.mjs` doesn't exist yet — `file-exists`/`command` checks are engine declarations, not test-time executions; the manifest test validates schema only. If it does execute them, reorder: land this task's commit together with Task 3's.
- [ ] **Step 3: Commit** — `git add modules/org-os-berd/module.yaml && git commit -m "feat(berd): org-os-berd module manifest — personas + curated exposure list"`

### Task 3: `sync-skills-berd.mjs` (TDD, mirrors sync-agents)

**Files:**
- Create: `scripts/sync-skills-berd.mjs`
- Test: `tests/scripts/sync-skills-berd.test.mjs`

**Interfaces:**
- Consumes: manifest `files:` map (Task 2); canonical `skills/<name>/` dirs.
- Produces: CLI `node scripts/sync-skills-berd.mjs [--adopt] [--dry-run] [--check] [--manifest <path>] [--source-root <dir>] [--target-root <dir>]`. Exit 0 ok; 1 error / drift found by `--check`.

- [ ] **Step 1: Write the failing tests** (fixture idiom copied from `tests/scripts/sync-agents.test.mjs` — spawn the real script against temp dirs):

```js
// tests/scripts/sync-skills-berd.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ORG_ROOT } from "../helpers/repo-paths.mjs";

const SCRIPT = path.join(ORG_ROOT, "scripts", "sync-skills-berd.mjs");
const SKILL = (name, body = "Do the thing.") =>
  `---\nname: ${name}\ndescription: A ${name} skill.\n---\n\n${body}\n`;
const MIRRORED = (name, body = "Do the thing.") =>
  `---\nname: ${name}\ndescription: A ${name} skill.\nmanaged_by: org-os\n---\n\n${body}\n`;

function setup({ skills = {}, targets = {}, exposure = Object.keys(skills) } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "sync-skills-"));
  const src = path.join(root, "skills");
  const tgt = path.join(root, "agents-skills");
  for (const [name, files] of Object.entries(skills)) {
    mkdirSync(path.join(src, name), { recursive: true });
    for (const [f, c] of Object.entries(files)) writeFileSync(path.join(src, name, f), c);
  }
  for (const [name, files] of Object.entries(targets)) {
    mkdirSync(path.join(tgt, name), { recursive: true });
    for (const [f, c] of Object.entries(files)) writeFileSync(path.join(tgt, name, f), c);
  }
  const manifest = path.join(root, "module.yaml");
  const lines = exposure.map((n) => `  skills/${n}: .agents/skills/${n}`).join("\n");
  writeFileSync(manifest, `id: org-os-berd\nversion: 0.1.0\ntype: integration\ndescription: t\nfiles:\n${lines}\n`);
  return { root, src, tgt, manifest };
}
const run = (f, ...flags) =>
  spawnSync("node", [SCRIPT, "--manifest", f.manifest, "--source-root", f.src, "--target-root", f.tgt, ...flags],
    { encoding: "utf-8", cwd: ORG_ROOT });

test("materializes a curated skill dir with marker injected into SKILL.md", () => {
  const f = setup({ skills: { alpha: { "SKILL.md": SKILL("alpha"), "notes.md": "ref\n" } } });
  const r = run(f);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(path.join(f.tgt, "alpha", "SKILL.md"), "utf-8"), MIRRORED("alpha"));
  assert.equal(readFileSync(path.join(f.tgt, "alpha", "notes.md"), "utf-8"), "ref\n");
});

test("skills absent from the exposure list are not materialized", () => {
  const f = setup({ skills: { alpha: { "SKILL.md": SKILL("alpha") }, beta: { "SKILL.md": SKILL("beta") } }, exposure: ["alpha"] });
  run(f);
  assert.ok(!existsSync(path.join(f.tgt, "beta")));
});

test("hand-authored target dir (no marker) is never touched", () => {
  const hand = "---\nname: alpha\ndescription: mine.\n---\n\nhand-authored\n";
  const f = setup({ skills: { alpha: { "SKILL.md": SKILL("alpha") } }, targets: { alpha: { "SKILL.md": hand } } });
  const r = run(f);
  assert.equal(r.status, 0);
  assert.equal(readFileSync(path.join(f.tgt, "alpha", "SKILL.md"), "utf-8"), hand);
  assert.match(r.stdout, /skipped/);
});

test("--adopt takes over a hand-authored target", () => {
  const f = setup({ skills: { alpha: { "SKILL.md": SKILL("alpha") } }, targets: { alpha: { "SKILL.md": "---\nname: alpha\ndescription: mine.\n---\nold\n" } } });
  run(f, "--adopt");
  assert.equal(readFileSync(path.join(f.tgt, "alpha", "SKILL.md"), "utf-8"), MIRRORED("alpha"));
});

test("managed target is updated when canon changes", () => {
  const f = setup({ skills: { alpha: { "SKILL.md": SKILL("alpha", "v2") } }, targets: { alpha: { "SKILL.md": MIRRORED("alpha", "v1") } } });
  const r = run(f);
  assert.match(r.stdout, /updated/);
  assert.equal(readFileSync(path.join(f.tgt, "alpha", "SKILL.md"), "utf-8"), MIRRORED("alpha", "v2"));
});

test("--dry-run reports but writes nothing", () => {
  const f = setup({ skills: { alpha: { "SKILL.md": SKILL("alpha") } } });
  const r = run(f, "--dry-run");
  assert.match(r.stdout, /would install/);
  assert.ok(!existsSync(path.join(f.tgt, "alpha")));
});

test("--check passes when mirror matches, fails on drift", () => {
  const f = setup({ skills: { alpha: { "SKILL.md": SKILL("alpha") } } });
  run(f);
  assert.equal(run(f, "--check").status, 0);
  writeFileSync(path.join(f.tgt, "alpha", "SKILL.md"), MIRRORED("alpha", "tampered"));
  const r = run(f, "--check");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /drift/);
});

test("exposure entry with no canonical skill dir is a hard error", () => {
  const f = setup({ skills: {}, exposure: ["ghost"] });
  assert.equal(run(f).status, 1);
});
```

- [ ] **Step 2: Run to verify failure.** `npm test 2>&1 | grep -B1 -A3 sync-skills` — Expected: FAIL (script missing).
- [ ] **Step 3: Implement `scripts/sync-skills-berd.mjs`:**

```js
#!/usr/bin/env node
// sync-skills-berd.mjs — materialize the curated org-os skills into Berd's
// project-local .agents/skills/ surface (third run of the sync-commands →
// sync-agents pattern; see modules/org-os-berd/module.yaml for the exposure
// list and docs/integrations/berd.md for the verified discovery surface).
//
// Copy = canonical dir, verbatim, EXCEPT SKILL.md gains one injected line —
// `managed_by: org-os` before the closing frontmatter fence. The marker is
// the overwrite permission for future runs; hand-authored targets are
// skipped (--adopt to take over). --check recomputes and byte-compares.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flagValue = (n) => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : undefined; };
const MANIFEST = flagValue("--manifest") ?? path.join(root, "modules", "org-os-berd", "module.yaml");
const SRC_ROOT = flagValue("--source-root") ?? path.join(root, "skills");
const TGT_ROOT = flagValue("--target-root") ?? path.join(root, ".agents", "skills");
const ADOPT = argv.includes("--adopt");
const DRY = argv.includes("--dry-run");
const CHECK = argv.includes("--check");

// Curation list = manifest files entries targeting .agents/skills/
const manifestFiles = matter(`---\n${fs.readFileSync(MANIFEST, "utf8")}\n---`).data.files ?? {};
const exposure = Object.entries(manifestFiles)
  .filter(([, tgt]) => String(tgt).startsWith(".agents/skills/"))
  .map(([src]) => path.basename(src))
  .sort();

if (exposure.length === 0) { console.error("ERROR: manifest exposes no skills."); process.exit(1); }

const injectMarker = (raw) => {
  const fence = raw.indexOf("\n---", 3); // end of frontmatter block
  if (fence === -1) return null;
  return raw.slice(0, fence) + "\nmanaged_by: org-os" + raw.slice(fence);
};

const listFiles = (dir) =>
  fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(dir, path.join(d.parentPath ?? d.path, d.name)))
    .sort();

let failures = 0, drift = 0;
const counts = {};
const tally = (action, name, note = "") => {
  counts[action] = (counts[action] ?? 0) + 1;
  console.log(`  ${action.padEnd(13)} ${name}${note}`);
};

for (const name of exposure) {
  const srcDir = path.join(SRC_ROOT, name);
  const tgtDir = path.join(TGT_ROOT, name);
  if (!fs.existsSync(path.join(srcDir, "SKILL.md"))) {
    console.error(`ERROR: exposure entry "${name}" has no canonical skills/${name}/SKILL.md`);
    failures++; continue;
  }
  // Build the expected materialized content in memory.
  const expected = new Map();
  for (const rel of listFiles(srcDir)) {
    let content = fs.readFileSync(path.join(srcDir, rel), "utf8");
    if (rel === "SKILL.md") {
      const injected = injectMarker(content);
      if (!injected) { console.error(`ERROR: ${name}/SKILL.md has no frontmatter fence.`); failures++; content = null; }
      else content = injected;
    }
    if (content !== null) expected.set(rel, content);
  }
  if (failures) continue;

  const tgtSkill = path.join(tgtDir, "SKILL.md");
  const exists = fs.existsSync(tgtSkill);
  const managed = exists && matter(fs.readFileSync(tgtSkill, "utf8")).data.managed_by === "org-os";
  const inSync = exists &&
    listFiles(tgtDir).join("\n") === [...expected.keys()].join("\n") &&
    [...expected].every(([rel, c]) => fs.readFileSync(path.join(tgtDir, rel), "utf8") === c);

  if (CHECK) {
    if (!exists) { tally("missing", name); drift++; }
    else if (!managed) tally("hand-authored", name, "  (ignored by check)");
    else if (!inSync) { tally("drift", name); drift++; }
    else tally("in-sync", name);
    continue;
  }
  if (exists && !managed && !ADOPT) { tally("skipped", name, "  (hand-authored — rerun with --adopt)"); continue; }
  if (inSync) { tally("unchanged", name); continue; }
  const action = !exists ? "install" : managed ? "update" : "adopt";
  if (DRY) { tally(`would ${action}`, name); continue; }
  fs.rmSync(tgtDir, { recursive: true, force: true });
  for (const [rel, c] of expected) {
    fs.mkdirSync(path.dirname(path.join(tgtDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(tgtDir, rel), c);
  }
  tally(action + "ed", name);
}

const summary = Object.entries(counts).map(([a, n]) => `${n} ${a}`).join(", ");
console.log(`\n${failures || drift ? "✗" : "✓"} ${exposure.length} curated skills → ${TGT_ROOT}${DRY ? "  (dry run)" : ""}\n  ${summary || "nothing to do"}`);
process.exit(failures || drift ? 1 : 0);
```

- [ ] **Step 4: Run tests.** `npm test 2>&1 | grep -B1 -A3 sync-skills` — Expected: PASS (8/8). Fix `parentPath` fallback if the Node version needs `d.path`.
- [ ] **Step 5: Add the npm script** to root `package.json` next to `sync:agents`: `"sync:skills:berd": "node scripts/sync-skills-berd.mjs",`
- [ ] **Step 6: Commit** — `git add scripts/sync-skills-berd.mjs tests/scripts/sync-skills-berd.test.mjs package.json && git commit -m "feat(berd): marker-guarded curated skills mirror (TDD)"`

### Task 4: Materialize for real + wire the drift gate

**Files:**
- Create: `.agents/skills/{org-os-init,meeting-processor,heartbeat-monitor,knowledge-curator,funding-scout}/` (generated, committed)
- Modify: `scripts/selftest.mjs`

- [ ] **Step 1: Dry-run first.** `npm run sync:skills:berd -- --dry-run` — Expected: 5 × `would install`, feynman NOT mentioned.
- [ ] **Step 2: Materialize.** `npm run sync:skills:berd` then `npm run sync:skills:berd -- --check` — Expected: 5 installed, then 5 in-sync, exit 0. Verify feynman untouched: `git status --porcelain .agents/skills/feynman` → empty.
- [ ] **Step 3: Wire into selftest.** In `scripts/selftest.mjs`, next to the other validator `run(...)` calls, add:

```js
run("berd skills mirror in sync", "node", ["scripts/sync-skills-berd.mjs", "--check"], {
  optional: true,
  skipKey: "berd",
});
```

- [ ] **Step 4: Full gates.** `npm test && npm run selftest && npm run validate:structure && npx prettier . --check` — Expected: all green (prettier may reformat materialized md — if so, run `npx prettier .agents/skills --write`, confirm `--check` still passes because canon is already prettier-formatted; if it does NOT, the canon file was unformatted — format canon first, re-materialize).
- [ ] **Step 5: Commit** — `git add .agents/skills scripts/selftest.mjs && git commit -m "feat(berd): materialize curated five; drift check joins selftest"`

### Task 5: Goose verification + pruning pass

**Files:**
- Modify: `docs/integrations/berd.md`, possibly `modules/org-os-berd/module.yaml` + re-materialization

- [ ] **Step 1: Open this repo in Berd** (≥ v0.6.0). Confirm the five bridged skills are discovered alongside feynman.
- [ ] **Step 2: Exercise each skill once under Goose** (ask the agent to use it on a trivial real input). Record per-skill verdict (loads / runs / fails-and-why) in a "Goose verification" table in `docs/integrations/berd.md`.
- [ ] **Step 3: Prune failures.** Remove failing skills' materialization entries from `modules/org-os-berd/module.yaml`, delete their `.agents/skills/<name>/` dirs, re-run `npm run sync:skills:berd -- --check` — Expected: remaining set in-sync, exit 0. The exposure list now names only verified skills.
- [ ] **Step 4: Commit** — `git add docs/integrations/berd.md modules/org-os-berd/module.yaml .agents/skills && git commit -m "feat(berd): Goose verification pass — exposure list pruned to verified"`

### Task 6: Catalog + docs convergence

**Files:**
- Modify: `docs/MODULES.md`, `site/src/data/modules.yaml`, `docs/AGENTIC-ARCHITECTURE.md`, `docs/FILE-STRUCTURE.md`

- [ ] **Step 1: Catalog double-entry.** Add `org-os-berd` under "Tracked modules" in `docs/MODULES.md` (status **in-dev**) and mirror into `site/src/data/modules.yaml`. Run the site catalog test — Expected: PASS.
- [ ] **Step 2: Extend the "Berd Personas" subsection** of `docs/AGENTIC-ARCHITECTURE.md` with a "Berd Skills Bridge" paragraph: curated exposure list in the module manifest; marker-guarded mirror via `npm run sync:skills:berd`; `--check` in selftest; feynman untouched as hand-authored; discovery surface per `docs/integrations/berd.md`.
- [ ] **Step 3: Extend the `.agents/` entry** in `docs/FILE-STRUCTURE.md`: `.agents/agents/` (canonical personas — shipped 2026-08-20) and `.agents/skills/` (materialized curated skills — generated by `sync:skills:berd`, committed, drift-gated; may also hold hand-authored skill dirs, which the sync never touches).
- [ ] **Step 4: Full gates + commit** — `npm test && npm run validate:structure && npx prettier . --check`, then `git add docs/MODULES.md site/src/data/modules.yaml docs/AGENTIC-ARCHITECTURE.md docs/FILE-STRUCTURE.md && git commit -m "docs(berd): module #4 catalogued; architecture + file-structure converged"`

### Task 7: Dogfood acceptance tracking

**Files:**
- Modify: `HEARTBEAT.md`

- [ ] **Step 1: Add the acceptance tracker** to HEARTBEAT.md under Active Tasks:

```markdown
### Berd bridge dogfood acceptance (module #4 → live)

- [ ] One full org-os session (initialize → work → close) driven from Berd/Goose
- [ ] 5 real work uses of bridged skills from Berd: ☐ ☐ ☐ ☐ ☐
      (on completion: flip docs/MODULES.md org-os-berd to **live**, update the
      site mirror + QUEUE entry; then evaluate the Buzz×Berd v2 trigger —
      both acceptances passed?)
```

- [ ] **Step 2: Commit** — `git add HEARTBEAT.md && git commit -m "feat(berd): acceptance tracker armed"`

---

## Self-review checklist (ran at authoring)

- Spec coverage: verify-assumption→1; manifest/curation→2; mirror mechanics + guard rails table→3 (each failure row has a test); committed copies + drift gate→4; Goose pruning→5; docs→6; acceptance→7. V2 items (buzz-handoff window, persona templating) deliberately absent.
- No placeholders: sync script and all 8 tests are full code; doc edits specify exact content or exact sections.
- Type consistency: flag names (`--manifest/--source-root/--target-root`), marker line, exposure-entry format, and exit codes identical across Tasks 2–4; `MIRRORED` fixture matches `injectMarker` output byte-for-byte.
