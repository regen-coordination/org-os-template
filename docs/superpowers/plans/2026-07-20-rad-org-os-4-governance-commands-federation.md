# rad-org-os Plan 4 — Governance, Commands & Federation Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Radicle driver into org-os's governance, command, and federation surfaces — so a Radicle-canonical instance is governed by its identity-doc quorum, its operator commands (`/commit /sync /handoff /close /initialize`) route through the driver, its linked-repo/upstream scripts speak `rad://`, and its `federation.yaml`/`members.yaml`/`instances.yaml` carry the additive Radicle fields — completing Tiers 1+2.

**Architecture:** Governance maps onto Radicle's native identity doc: `governance.proposal_threshold` → the identity-doc `threshold` (which *is* main's quorum — Radicle disallows an explicit default-branch `crefs` rule); a pure `buildCrefs()` generates `xyz.radicle.crefs` payloads for *additional* protected patterns (e.g. release tags), applied via `rad id update` (operator-gated). Genesis-stamp persistence (Plan 3 carryover) is finished. Scripts (`clone-linked-repos`, `sync-upstream`) route through `resolveDriver`. Command skills gain a canonical-aware branch (github → gh/PR; radicle → rad patch/COB/`driver.webUrl`). Data-model additions get a validator (member-id scheme ↔ canonical coherence). The sovereign-runtime audit + `rad-skill` reference land.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test`, `js-yaml`; command skills are Markdown. Reuses `@org-os/host` (`resolveDriver`, `resolveRemoteScheme`) and `@org-os/rad`. No new runtime deps.

**Spec:** [`docs/superpowers/specs/2026-07-20-rad-org-os-design.md`](../specs/2026-07-20-rad-org-os-design.md) — "Identity & governance", "Collaboration workflow", "Federation & data-model", "Agent-integration & sovereign-runtime". **Roadmap:** [`2026-07-20-rad-org-os-ROADMAP.md`](2026-07-20-rad-org-os-ROADMAP.md).

**Prerequisites shipped (Plans 1–3 on `v0.5`):** `@org-os/host` (`resolveDriver`, `resolveRemoteScheme`, `HostDriver`), `@org-os/rad` (radicle driver, `bootstrap/`, `rad-cli` `defaultExec`, `errors` `WriteUnavailableError`, `bootstrap/generate.mjs` `buildGenesisStamp`). Read those before starting.

**Verified Radicle governance facts (from Plans 1–2 research, adversarially confirmed):**
- Identity doc at `refs/rad/id` = `delegates[]` (did:key) + a signature `threshold`. Main's canonical advance requires a `threshold` quorum of delegate signatures — this IS "protected main". **An explicit `crefs` rule for the default branch is disallowed** (checked at `rad id update`); the default-branch rule is synthesized from `threshold`+`delegates`.
- `xyz.radicle.crefs` (Radicle 1.3.0): per-ref-pattern rules, each `{ allow: [did:key…], threshold: N }`, for patterns *other than* the default branch (e.g. `refs/tags/releases/*`).
- `rad id update` proposes an identity-doc revision (`--repo`, `--no-confirm`); it is editor/quorum-driven and needs a running node + passphrase → **applying** crefs/threshold changes is operator-gated. Generating the payload is pure and testable.

**Operator-gated steps (marked ⚙ inline):** anything that runs `rad id update` / a real node write. These are implemented as pure generators + documented apply commands; the live apply is an operator action (needs `rad node start` + `RAD_PASSPHRASE`), like the Plan 3 live bootstrap.

---

## File structure

```
packages/rad-org-os/
  src/
    governance.mjs        # buildCrefs (additional patterns), mainQuorum(federation) mapping
  bootstrap/
    rad-bootstrap.mjs     # + genesis-stamp persistence into federation.yaml metadata
    generate.mjs          # buildFederationYaml gains metadata block
  test/
    governance.test.mjs
    (rad-bootstrap.test.mjs, generate.test.mjs extended)
packages/org-os-host/
  src/identity-scheme.mjs # validateMemberIdScheme(members, canonical) — coherence check
  test/identity-scheme.test.mjs
scripts/
  clone-linked-repos.mjs  # route through resolveDriver (rid-aware)
  sync-upstream.mjs       # rad sync when canonical radicle
.claude/commands/         # /commit /sync /handoff /close /initialize — canonical-aware branches
skills/commands/…         # regenerated from .claude/commands via sync-commands.mjs
docs/
  DATA-MODEL.md           # document the additive did/rid/canonical fields
```

---

### Task 1: Governance mapping — `buildCrefs` + `mainQuorum`

**Files:**
- Create: `packages/rad-org-os/src/governance.mjs`
- Test: `packages/rad-org-os/test/governance.test.mjs`

- [ ] **Step 1: Write failing tests**

`packages/rad-org-os/test/governance.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCrefs, mainQuorum } from '../src/governance.mjs';

test('mainQuorum maps governance.proposal_threshold to the identity threshold', () => {
  const q = mainQuorum({ governance: { proposal_threshold: 2, maintainers: [{ id: 'did:key:z6MkA' }, { id: 'did:key:z6MkB' }] } });
  assert.equal(q.threshold, 2);
  assert.deepEqual(q.delegates, ['did:key:z6MkA', 'did:key:z6MkB']);
  // main is governed by the identity threshold directly — NOT a crefs rule
  assert.equal(q.mainRuleIsImplicit, true);
});

test('buildCrefs makes per-pattern rules for ADDITIONAL protected refs', () => {
  const crefs = buildCrefs([
    { pattern: 'refs/tags/releases/*', allow: ['did:key:z6MkA', 'did:key:z6MkB'], threshold: 2 },
  ]);
  assert.equal(crefs['refs/tags/releases/*'].threshold, 2);
  assert.deepEqual(crefs['refs/tags/releases/*'].allow, ['did:key:z6MkA', 'did:key:z6MkB']);
});

test('buildCrefs rejects a rule targeting the default branch (Radicle disallows it)', () => {
  assert.throws(() => buildCrefs([{ pattern: 'refs/heads/main', allow: ['did:key:z6MkA'], threshold: 1 }]),
    /default branch.*disallowed|refs\/heads\/main/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rad-org-os && node --test test/governance.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `governance.mjs`**

`packages/rad-org-os/src/governance.mjs`:
```js
// Maps org-os governance onto Radicle's native identity-doc model.
// Main's quorum IS the identity-doc `threshold` over `delegates` — Radicle synthesizes
// the default-branch rule and DISALLOWS an explicit crefs rule for it. crefs is only
// for ADDITIONAL protected ref patterns (e.g. release tags).
const DEFAULT_BRANCH_PATTERNS = new Set(['refs/heads/main', 'refs/heads/master']);

export function mainQuorum(federation) {
  const gov = federation?.governance || {};
  return {
    threshold: typeof gov.proposal_threshold === 'number' ? gov.proposal_threshold : 1,
    delegates: (gov.maintainers || []).map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean),
    mainRuleIsImplicit: true, // enforced by the identity threshold, not a crefs rule
  };
}

export function buildCrefs(rules = []) {
  const out = {};
  for (const r of rules) {
    if (DEFAULT_BRANCH_PATTERNS.has(r.pattern)) {
      throw new Error(`crefs rule for the default branch (${r.pattern}) is disallowed by Radicle; main is governed by the identity threshold`);
    }
    out[r.pattern] = { allow: r.allow, threshold: r.threshold };
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/rad-org-os && node --test test/governance.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/rad-org-os/src/governance.mjs packages/rad-org-os/test/governance.test.mjs
git commit -m "feat(rad): governance mapping — identity-threshold main quorum + crefs for extra refs"
```

⚙ Applying a threshold change or a crefs payload runs `rad id update --repo <RID>` (operator-gated: needs `rad node start` + `RAD_PASSPHRASE`). Document this in the module's header comment; do not run it in tests.

---

### Task 2: Genesis-stamp persistence (Plan 3 carryover)

**Files:**
- Modify: `packages/rad-org-os/bootstrap/generate.mjs` (federation.yaml gains a `metadata` block)
- Modify: `packages/rad-org-os/bootstrap/rad-bootstrap.mjs` (stamp the genesis commit oid)
- Test: extend `packages/rad-org-os/test/generate.test.mjs`, `test/rad-bootstrap.test.mjs`

- [ ] **Step 1: Write failing tests**

Append to `packages/rad-org-os/test/generate.test.mjs`:
```js
test('buildFederationYaml embeds a metadata block with a null genesis stamp by default', () => {
  const doc = yaml.load(buildFederationYaml({ rid: 'rad:z', seed: 's', name: 'n', threshold: 1 }));
  assert.equal(doc.metadata.genesis_commit ?? null, null);   // stamped later by bootstrap
  assert.equal(doc.metadata.framework_version, '0.5');
});
```

Append to `packages/rad-org-os/test/rad-bootstrap.test.mjs` (bootstrap stamps the genesis commit into federation.yaml after the genesis commit exists):
```js
test('bootstrap stamps the genesis commit oid into federation.yaml metadata', async () => {
  const writes = {};
  const exec = async (bin, args) => {
    if (bin === 'rad' && args[0] === 'self') return { code: 0, stdout: 'DID did:key:z6MkXY\n', stderr: '' };
    if (bin === 'rad' && args[0] === 'init') return { code: 0, stdout: 'Initialized private repository rad:z3NEW\n', stderr: '' };
    if (bin === 'git' && args[0] === 'rev-list') return { code: 0, stdout: 'a'.repeat(40) + '\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const fs = { mkdir: async () => {}, writeFile: async (p, c) => { writes[p] = c; } };
  await bootstrap({ targetDir: '/tmp/o', name: 'o', alias: 'a', visibility: 'private', seed: 's', exec, fs, scaffold: async () => {}, now: '2026-07-20T00:00:00Z' });
  const fedPath = Object.keys(writes).find((p) => p.endsWith('federation.yaml'));
  const fed = (await import('js-yaml')).default.load(writes[fedPath]);
  assert.equal(fed.metadata.genesis_commit, 'a'.repeat(40));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/rad-org-os && node --test test/generate.test.mjs test/rad-bootstrap.test.mjs`
Expected: FAIL — metadata block absent / genesis oid not stamped.

- [ ] **Step 3: Add the metadata block to `buildFederationYaml`**

In `packages/rad-org-os/bootstrap/generate.mjs`, add to the `buildFederationYaml` object a `metadata` field:
```js
    metadata: { framework_version: '0.5', created: null, genesis_commit: null, last_sync_commit: null },
```
(Keep the existing fields; `created`/`genesis_commit` are filled by bootstrap.)

- [ ] **Step 4: Stamp the genesis oid in `bootstrap`**

In `packages/rad-org-os/bootstrap/rad-bootstrap.mjs`, after writing `federation.yaml` and its commit, resolve the genesis oid and re-write the stamp. Replace the federation.yaml write + commit block (step 5) with:
```js
  // 5. write federation.yaml (needs rid), commit, then stamp the genesis commit oid
  const fedPath = join(targetDir, 'federation.yaml');
  await fs.writeFile(fedPath, buildFederationYaml({ rid, seed, name, threshold: 1 }));
  await run('git', ['add', 'federation.yaml']);
  await run('git', ['-c', 'user.name=org-os', '-c', 'user.email=genesis@org-os', 'commit', '-q', '-m', 'genesis: federation']);
  const genesisOid = (await run('git', ['rev-list', '--max-parents=0', 'HEAD'])).trim().split('\n')[0];
  const stamped = buildFederationYaml({ rid, seed, name, threshold: 1 });
  const doc = yaml.load(stamped);
  doc.metadata = { ...doc.metadata, created: now, genesis_commit: genesisOid };
  await fs.writeFile(fedPath, yaml.dump(doc));
```
Add `import yaml from 'js-yaml';` at the top of `rad-bootstrap.mjs`. Remove the "stamp persistence deferred to Plan 4" comment (it's now done).

- [ ] **Step 5: Run to verify pass**

Run: `cd packages/rad-org-os && npm test`
Expected: PASS — generate + rad-bootstrap tests green (the genesis-stamp tests included).

- [ ] **Step 6: Commit**

```bash
git add packages/rad-org-os/bootstrap/generate.mjs packages/rad-org-os/bootstrap/rad-bootstrap.mjs packages/rad-org-os/test/generate.test.mjs packages/rad-org-os/test/rad-bootstrap.test.mjs
git commit -m "feat(rad): persist genesis commit stamp into federation.yaml metadata"
```

---

### Task 3: Member-id scheme validator (data-model coherence)

**Files:**
- Create: `packages/org-os-host/src/identity-scheme.mjs`
- Test: `packages/org-os-host/test/identity-scheme.test.mjs`

Enforces the spec rule: a member `id` scheme (`github:` | `did:`) must match the instance's `platforms.canonical`.

- [ ] **Step 1: Write failing tests**

`packages/org-os-host/test/identity-scheme.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMemberIdScheme } from '../src/identity-scheme.mjs';

test('radicle-canonical requires did: member ids', () => {
  const r = validateMemberIdScheme([{ id: 'did:key:z6MkA' }], 'radicle');
  assert.equal(r.ok, true);
  const bad = validateMemberIdScheme([{ id: 'github:alice' }], 'radicle');
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /github:alice.*radicle/);
});

test('github-canonical requires github: member ids', () => {
  assert.equal(validateMemberIdScheme([{ id: 'github:alice' }], 'github').ok, true);
  assert.equal(validateMemberIdScheme([{ id: 'did:key:z6MkA' }], 'github').ok, false);
});

test('empty members list is ok', () => {
  assert.equal(validateMemberIdScheme([], 'radicle').ok, true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/org-os-host && node --test test/identity-scheme.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `identity-scheme.mjs`**

`packages/org-os-host/src/identity-scheme.mjs`:
```js
// Coherence rule (spec): a member id is a URI whose scheme matches the instance's
// canonical platform. github-canonical → github:<handle>; radicle-canonical → did:<method>.
const SCHEME_FOR = { github: 'github:', radicle: 'did:' };

export function validateMemberIdScheme(members = [], canonical = 'github') {
  const wanted = SCHEME_FOR[canonical] || 'github:';
  const errors = [];
  for (const m of members) {
    if (typeof m?.id !== 'string' || !m.id.startsWith(wanted)) {
      errors.push(`member id "${m?.id}" must use scheme "${wanted}" for canonical=${canonical}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/org-os-host && node --test test/identity-scheme.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-host/src/identity-scheme.mjs packages/org-os-host/test/identity-scheme.test.mjs
git commit -m "feat(host): member-id scheme validator (id scheme tracks canonical platform)"
```

---

### Task 4: Route `clone-linked-repos.mjs` + `sync-upstream.mjs` through the driver

**Files:**
- Modify: `scripts/clone-linked-repos.mjs`, `scripts/sync-upstream.mjs`
- Test: `packages/rad-org-os/test/script-routing.test.mjs` (or a scripts/ test if one exists)

Behavior-preserving for github; a `rid`-bearing manifest entry / upstream clones/syncs via the radicle driver.

- [ ] **Step 1: Read the two scripts**

Run: `sed -n '1,120p' scripts/clone-linked-repos.mjs` and `sed -n '1,150p' scripts/sync-upstream.mjs`. Note exactly where the remote URL / clone / fetch happens (per the codebase sweep: `clone-linked-repos.mjs` reads `repos.manifest.json` and does `git clone --branch <b> <url> <target>`; `sync-upstream.mjs` reads `federation.yaml.upstream[0].url` and does `git remote add upstream` + `git fetch upstream` + `git pull --rebase upstream main`).

- [ ] **Step 2: Write a behavior-preserving routing test**

`packages/rad-org-os/test/script-routing.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRemoteScheme } from '../../org-os-host/src/index.mjs';

// The routing invariant these scripts must honor: a manifest/upstream entry with a
// rad: rid resolves to the radicle scheme; a github url/slug resolves to github.
test('a rid entry routes to radicle, a github entry to github', () => {
  assert.equal(resolveRemoteScheme('rad:z3abc'), 'radicle');
  assert.equal(resolveRemoteScheme('https://github.com/org/repo'), 'github');
});
```
(The full script refactor is exercised by this invariant + the existing github behavior; a deeper integration is gated on a live node.)

- [ ] **Step 3: Refactor `clone-linked-repos.mjs`**

Add near the top: `import { resolveRemoteScheme } from '../packages/org-os-host/src/index.mjs';` (adjust relative depth to the actual script location). For each manifest repository, if `repo.rid` is present (or `repo.url` starts with `rad:`), clone via `rad clone <rid> <target>` (shell `rad`); else keep the existing `git clone <url>` path unchanged. Guard: if `rad` isn't installed and a rid entry is encountered, log an actionable skip (do not crash the whole clone loop) — mirror the existing per-entry error handling.

- [ ] **Step 4: Refactor `sync-upstream.mjs`**

If `federation.yaml.upstream[0]` has a `rid` (or `platforms.canonical === 'radicle'`), sync via `rad sync` + pull from the upstream RID's canonical branch instead of `git fetch upstream`/`git pull --rebase upstream main`. Keep the existing github path unchanged when there's no rid. Preserve the lineage-stamp write and the `memory/sync-*.md` receipt.

- [ ] **Step 5: Run the routing test + confirm no github regression**

Run: `cd packages/rad-org-os && node --test test/script-routing.test.mjs` (PASS). Then, if the repo has a scripts smoke test, run it; otherwise manually confirm `node scripts/clone-linked-repos.mjs --help` (or a dry run) still parses the github manifest without error.

- [ ] **Step 6: Commit**

```bash
git add scripts/clone-linked-repos.mjs scripts/sync-upstream.mjs packages/rad-org-os/test/script-routing.test.mjs
git commit -m "feat(rad): clone-linked-repos + sync-upstream route rid entries through the radicle driver"
```

---

### Task 5: Canonical-aware command skills

**Files:**
- Modify: `.claude/commands/commit.md`, `sync.md`, `handoff.md`, `close.md`, `initialize.md`
- Regenerate: `skills/commands/*` via `node scripts/sync-commands.mjs`

Add a canonical-aware branch to each command's body: when `federation.yaml platforms.canonical: radicle`, use the radicle path; else the existing github path. These are prose instructions to the agent, so the "test" is structural (the mapping appears) + `sync-commands` regeneration succeeds.

- [ ] **Step 1: Read the current command bodies**

Run: `sed -n '1,80p' .claude/commands/commit.md` (repeat for sync/handoff/close/initialize). Note the exact github-specific lines (per the sweep): `/commit` trunk+PR-to-main; `/sync` `git fetch origin`+`merge --ff-only`; `/handoff` builds `github.com/<org>/<repo>/blob/main/<path>`; `/close` `git push origin`; `/initialize` sync vs `@{u}` + peers panel.

- [ ] **Step 2: Add the canonical-aware mapping to each command**

For each command, insert a short "## Radicle-canonical variant" section (or an inline branch) mapping the github step to the radicle one, keyed on `federation.yaml platforms.canonical`:
- `/commit`: structural changes → `rad patch` against the identity-threshold-governed main (not a trunk PR); `git push rad` for the operator branch.
- `/sync`: `rad sync` + fast-forward from the canonical branch (via `driver.getDrift`) instead of `git fetch origin`/`merge --ff-only`.
- `/handoff`: the doc link comes from `driver.webUrl(rid, path)` (an `app.radicle.xyz/…` URL) instead of the hardcoded `github.com/…/blob/main/…`; the paste-prompt says `rad clone <rid>` + `rad patch`.
- `/close`: `git push rad` (memory is a normal signed push).
- `/initialize`: session sync uses `rad sync` + `driver.getDrift`; the peers panel uses `driver.listPeers`; offline is the normal (soft) state.

Keep every existing github instruction intact under a "github-canonical (default)" framing — this is additive, not a rewrite.

- [ ] **Step 3: Regenerate the command-skills + verify**

Run: `node scripts/sync-commands.mjs` (regenerates `skills/commands/*/SKILL.md` from `.claude/commands/*.md`). Then `npm run validate:structure` → 0 failed (the skills container still validates).

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/ skills/commands/
git commit -m "docs(commands): canonical-aware Radicle variants for /commit /sync /handoff /close /initialize"
```

---

### Task 6: Sovereign-runtime audit + `rad-skill` reference + data-model docs + matrix

**Files:**
- Modify: `docs/DATA-MODEL.md` (document the additive `did`/`rid`/`canonical` fields)
- Create: `docs/RADICLE.md` (the rad-org-os operator guide: bootstrap, seed-node, availability, runtime, rad-skill)
- Modify: `data/skills-matrix.yaml` (add a `rad-skill` reference entry, `promotion_status: candidate`)

- [ ] **Step 1: Document the additive data-model fields**

In `docs/DATA-MODEL.md`, add a short subsection under the members / instances / federation registries documenting: member `did` + the id-scheme-tracks-canonical rule (link the Task-3 validator); `instances.yaml` `rid` + per-instance `canonical`; `federation.yaml` `platforms.canonical` + `platforms.seed_node` + per-peer `rid`. All additive, backward-compatible.

- [ ] **Step 2: Write `docs/RADICLE.md`**

A concise operator guide: what rad-org-os is; `rad-bootstrap` quickstart (zero→live); the seed-node recipe + 3-tier availability with the honest at-rest framing; the runtime-agnostic default (`agent.runtime: open-model`) and how to choose Claude; and `rad-skill` as the agent-facing `rad` guidance (RID `rad:zvBj4kByGeQSrSy2c4H7fyK42cS8`, adopt-as-runtime-neutral-skill, credit `hdh`). Cross-link the spec + roadmap.

- [ ] **Step 3: Register `rad-skill` in the skills matrix**

Inspect `data/skills-matrix.yaml` shape (it validates `promotion_status`). Add an entry referencing `rad-skill` as an external candidate to adopt (runtime-neutral), `promotion_status: candidate`, with a note pointing at Open Decision 5 in the spec. `npm run validate:structure` → 0 failed.

- [ ] **Step 4: Sovereign-runtime audit note**

Grep the Radicle-native command paths + `@org-os/rad` for hard Claude/Anthropic assumptions: `grep -riE 'anthropic|claude' packages/rad-org-os .claude/commands` — confirm none are load-bearing (the driver/bootstrap are model-agnostic). Record the finding (a one-paragraph "runtime-agnostic: verified" note) in `docs/RADICLE.md`. If a hard assumption is found, fix it or file it as a follow-up.

- [ ] **Step 5: Validate + commit**

Run: `npm run validate:structure` → 0 failed. Commit:
```bash
git add docs/DATA-MODEL.md docs/RADICLE.md data/skills-matrix.yaml
git commit -m "docs(rad-org-os): data-model additions, RADICLE.md operator guide, rad-skill candidate + runtime audit"
```

---

## Scope fence

- **In (this plan):** governance mapping (identity-threshold main quorum + `buildCrefs` for extra refs), genesis-stamp persistence, member-id scheme validator, `clone-linked-repos`/`sync-upstream` rid routing, canonical-aware command skills, data-model docs, `docs/RADICLE.md`, `rad-skill` candidate registration, runtime-agnostic audit.
- **Operator-gated (⚙, documented not run):** applying a threshold/`crefs` change via `rad id update`; the live end-to-end bootstrap; any real node write — all need `rad node start` + `RAD_PASSPHRASE`.
- **Deferred (Tier 3, per the spec):** replacing the 3 GitHub Actions workflows with `radicle-ci-broker` adapters; the full GitHub-Pages → node hosting rebuild (only the `.well-known` served-from-node URI-template piece was in scope earlier — confirm it's captured or carry it here as a small doc task). The local-LLM runtime remains a separate module.

## Self-review

**Spec coverage:** "Identity & governance" (identity-threshold main quorum + `crefs` for extra refs, correcting the earlier "crefs main" framing per Radicle's disallow-default-branch rule) → Task 1; signed lineage stamp / genesis persistence → Task 2; member-id scheme rule → Task 3; federation addressing + rid routing → Task 4; command mapping (`/commit /sync /handoff /close /initialize`) → Task 5; data-model additions + sovereign-runtime + `rad-skill` → Task 6. Dual-stack mirroring and the `.well-known` served-from-node URI template are the two thinnest items — mirroring is a best-effort hook noted in the command skills (Task 5); confirm the `.well-known` template lands in Task 6's data-model doc or carry a follow-up.

**Placeholder scan:** code tasks (1–3) have complete code + runnable tests; script/command/doc tasks (4–6) require reading the current files first (explicit Step 1 in each) because they edit existing content — the edits are specified by exact target lines from the codebase sweep, not "TBD". Operator-gated applies are explicitly marked ⚙ with the real `rad id update` command, not hand-waved.

**Type/name consistency:** `buildCrefs`, `mainQuorum`, `validateMemberIdScheme`, `resolveRemoteScheme`, `buildFederationYaml`, `buildGenesisStamp`, `bootstrap` are used consistently with their Plan 1–3 definitions. The genesis-stamp shape `{created, genesis_commit, last_sync_commit}` matches `buildGenesisStamp` from Plan 3 and the lineage-stamp validator's expectations.
