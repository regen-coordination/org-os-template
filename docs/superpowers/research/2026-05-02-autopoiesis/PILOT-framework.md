# Autopoiesis Phase 2 Pilot — Cascade Closure (Loop C)

> Branch: `autopoiesis-phase2-pilot` (off `feat/multica-operator`)
> Spec: [`2026-05-02-org-os-autopoiesis-design.md`](../../specs/2026-05-02-org-os-autopoiesis-design.md)
> Synthesis: [`SYNTHESIS.md`](SYNTHESIS.md)
> Loop: Loop C — Population learning (Metabolism → Cognition → Federation)
> Status: complete, awaiting Phase 2 gate

## Context note (2026-08-02)

The three closing-edge artifacts were implemented ahead of this pilot in commit
`ec09cdc` (2026-05-16, "feat(autopoiesis): sync-upstream + validate-identity +
lineage stamp (Phase 2)") — with a richer design than the plan spec'd. This
pilot session backfills what that commit did not deliver: the TDD test harness,
validate-structure §8b, FEDERATION.md lineage docs, the end-to-end exercise,
and this postmortem. Where the implementation diverges from the plan, the
implementation's behavior is treated as authoritative and tests are written
against it; divergences are logged in "What broke / had to be invented".

## Closing edge (per SYNTHESIS.md)

Three artifacts implementing cascade closure:
1. `scripts/sync-upstream.mjs` — propagation script honoring customizations
2. `scripts/validate-identity.mjs` — phantom validator (resolves `npm run validate:schemas`)
3. Lineage stamp in `federation.yaml.metadata` (`genesis_commit` + `last_sync_commit`)

## Artifacts implemented

Pre-existing (commit `ec09cdc`, 2026-05-16):

- `scripts/validate-identity.mjs` — phantom validator made real; resolves
  `npm run validate:schemas`. Richer than planned: also validates
  `.well-known/*.json`, supports `--strict`, warns (not fails) on missing
  `genesis_commit`.
- `scripts/sync-upstream.mjs` — phantom propagation script made real;
  resolves `npm run sync:upstream`. 10-stage flow with vault-safety +
  `.sync-freeze` guards, rebase-based sync, confirmation gate.
- `federation.yaml` — `metadata.genesis_commit` populated
  (`af8941a2…`), `last_sync_commit: null` (framework IS the upstream).

Backfilled in this pilot (branch `autopoiesis-phase2-pilot`):

- `tests/scripts/validate-identity.test.mjs` — 7 characterization cases
  (7/7 pass): agreement, name mismatch, missing genesis warn + `--strict`
  promotion, malformed SHAs, framework_version shape.
- `tests/scripts/sync-upstream.test.mjs` — 10 cases (10/10 pass) against
  real temp git repos: happy path, preview gate, customization
  preservation, lineage update, receipt, no-op, genesis seeding,
  `memory/` creation, dirty-tree refusal, freeze refusal.
- `scripts/sync-upstream.mjs` fixes (TDD, caught by the new tests):
  1. **stage-5 null crash** — `git()` `.trim()`'d the null return of
     `execSync(..., {stdio:'inherit'})`, so every successful pull was
     reported as a failure; as shipped the script could never complete
     a sync. Null guard added.
  2. **genesis seeding** — stage 9 now seeds `genesis_commit` from the
     instance root commit on first sync (validate-identity's warning had
     promised this, but nothing implemented it).
  3. **`memory/` mkdir** — stage 10 no longer crashes on instances
     without a `memory/` directory.
- `scripts/validate-identity.mjs` — exit-code docstring corrected
  (warnings exit 0 by design, not 2; sync-upstream stage 8 depends on it).
- `scripts/validate-structure.mjs` — §8b Lineage Stamp: `genesis_commit`
  40-hex shape when present, warn when absent (no first-sync deadlock);
  `last_sync_commit` shape when non-null.
- `docs/FEDERATION.md` — lineage stamp documented in the `metadata`
  section (fields, semantics, use cases).
- `docs/VERSIONING.md` — pull-based migration recipe marked functional,
  with sync-receipt + seeding behavior noted.

## Exercise — what we ran, what happened

**Stage A — Self-validation (2026-08-02):**
- `npm run validate:structure`: **pass** — 53 passed, 0 failed, 2 warnings
  (pre-existing: MASTERPROMPT.md coexists with MASTERPLAN.md; optional
  `ideas/` absent). Includes the new §8b lineage check: genesis_commit
  40-hex ✓.
- `npm run validate:schemas`: **pass** — 14 passed, 0 failed, 0 warnings.

**Stage B — Synthetic propagation (adapted vault-safe):**

The plan's Stage B bumped the real framework and rolled back with
`git reset --hard` — banned under vault safety. Adapted: *both* sides live
in `mktemp -d` — upstream = temp clone of org-os at pilot HEAD (branch
forced to `main`), instance = clone of that clone. Zero mutation of the
real repo.

- Instance customization (SOUL.md marker + upstream URL): commit `4d5a1a6`.
- Framework bump (README line): commit `0b67e38`.
- First run **refused: working tree dirty** — the untracked `node_modules`
  symlink. The real repo ignores `node_modules` via `.git/info/exclude`,
  which does not propagate to clones. Correct vault-safe behavior; fixed
  in the fixture by excluding locally. (Finding: fresh instances cloned
  from the framework lack the exclude — see postmortem.)
- Re-run `node scripts/sync-upstream.mjs --yes`: **exit 0**, all 10 stages.
  - Rebase: "Successfully rebased and updated refs/heads/main."
  - stage 6 migrate: no-op (0.5 == 0.5) ✓
  - stage 7 sync:packages: warned (`knowledge_base` enabled but not in
    framework) — correctly non-fatal ✓
  - stage 8 validators: both passed inside the instance ✓
  - stage 9/10: lineage updated, receipt `memory/sync-2026-08-02.md` ✓

**Closure evidence — all four conditions met:**
1. Pulled the framework bump: README.md tail = "upstream change for sync test" ✓
2. Preserved the customization: SOUL.md tail = `<!-- instance-only soul marker -->` ✓
3. `last_sync_commit: "0b67e38b56768a253ee52fa0128561e755bf4f14"` == upstream HEAD ✓
4. Receipt `memory/sync-2026-08-02.md` with upstream, old/new SHAs, counts ✓

Cosmetic defects observed (postmortem): the stale YAML comment
"# framework IS the upstream; null is correct here" survives beside the
now-set SHA (regex replace keeps trailing comments); "Commits applied: 203"
counted the whole upstream history on a first sync with `last_sync_commit:
null` — the true delta was 1 commit.

## What worked

- **The loop actually closes.** Stage B's synthetic instance pulled the
  framework bump, kept its SOUL.md customization through the rebase, got
  `last_sync_commit` pinned to the exact upstream HEAD (`0b67e38b…`), and
  received a dated receipt — all four closure conditions met in one
  unattended `--yes` run.
- **Characterization tests as archaeology.** Writing tests against the
  already-shipped scripts immediately surfaced a fatal defect (stage-5
  null crash, below) that fifteen weeks of the script existing had not —
  the script had never been run against a real upstream with new commits.
- **The deploy-shaped test harness.** Copying the script into
  `<tmp>/scripts/` and symlinking `node_modules` tests the script exactly
  as instances receive it (it resolves its root from its own location).
  Both suites (7 + 10 cases) run in ~45 s against real git repos.
- **Warn-don't-fail layering held up.** validate-identity warns (exit 0)
  on missing `genesis_commit`, validate-structure §8b mirrors that, and
  sync-upstream stage 8 therefore doesn't deadlock a first sync — then
  stage 9 seeds the field. Exercised in the `withGenesis: false` test.
- **Existing guards fired correctly in anger.** The dirty-tree refusal
  triggered on the fixture's untracked `node_modules` symlink before any
  git mutation; `.sync-freeze` refusal exits 2 as documented.

## What broke / had to be invented

- **Stage-5 null crash (fatal, shipped):** `git()` called `.trim()` on
  `execSync(..., { stdio: "inherit" })`, which returns `null` — so every
  *successful* pull was caught and reported as "Pull failed", after the
  rebase had already happened. As shipped, `sync-upstream` could never
  complete a sync that had new commits. Found by the first happy-path
  test; fixed with a null guard in `scripts/sync-upstream.mjs`.
- **Promised-but-missing genesis seeding:** validate-identity's warning
  text said genesis "will auto-seed on first sync-upstream", but no code
  did it. Invented: stage 9 seeds from `git rev-list --max-parents=0 HEAD`
  (last line = root commit) when `genesis_commit:` is absent.
- **`memory/` assumption:** stage 10 crashed on instances without a
  `memory/` directory (git doesn't track empty dirs, so fresh clones can
  lack it). Fixed with `mkdirSync(..., { recursive: true })`.
- **Exit-code doc drift:** the header claimed "exit 2 on warnings"; the
  code exits 0 (correct — stage 8 depends on it). Doc fixed, behavior kept.
- **`.git/info/exclude` doesn't propagate:** the framework ignores
  `node_modules` in `.git/info/exclude` rather than `.gitignore`, so a
  cloned instance sees it as untracked → dirty-tree refusal on first sync.
  Worked around in fixtures; real fix (tracked `.gitignore` entry) left
  for Phase 3 — it touches every downstream clone.
- **Vault-banned exercise recipe:** the plan's Stage B mutated the real
  framework and rolled back with a hard reset — prohibited here. Invented
  the two-temp-clones topology (upstream clone + instance clone, both in
  `mktemp -d`); strictly safer and reusable in CI.
- **Cosmetic:** stale YAML comment survives next to the updated
  `last_sync_commit` (regex keeps trailing comments); first-sync receipt
  reports "Commits applied: 203" (whole history) when `last_sync_commit`
  is null — should use the merge-base delta instead.

## Decisions for Phase 3 DECISIONS.md

- **Identity validation = file-agreement + SHA-shape check.** Lighter than
  cryptographic identity (DID); enough to catch drift today; defers the
  DID story (`identity-lineage-tracking` per SYNTHESIS net-new).
- **Lineage stamp lives in `metadata.`** (`genesis_commit` +
  `last_sync_commit`), not a parallel `lineage:` block; revisit only if
  more lineage fields accumulate.
- **Missing `genesis_commit` is a warning everywhere, an error nowhere.**
  Seed-on-first-sync (stage 9) is the enforcement mechanism; hard-failing
  validators would deadlock the very sync that fixes the gap.
- **Sync preserves customizations via rebase, not stash.** Committed
  instance changes replay on top of upstream; `maintain_on_sync` entries
  are today informational (counted in the receipt). If the framework
  edits a maintained file, the rebase conflicts and the sync aborts
  loudly — acceptable for Phase 2; Phase 3 should decide whether
  `maintain_on_sync` gets teeth (e.g., `ours` merge strategy per path).
- **Sync output stays uncommitted.** Stage 9/10 changes (lineage bump +
  receipt) are deliberately left for operator review — draft-and-present.
  The no-op test encodes this: commit, then re-sync → "already up to date".
- **`last_sync_commit: null` on the framework itself** (it IS the
  upstream) — kept from the implementation, replacing the plan's
  omit-the-field approach; a present-but-null key is greppable and
  validated.

## Migration note for downstream instances

When `npm run sync:upstream` runs against a downstream instance after
this pilot lands:

**New files (delivered via sync):**
- `tests/scripts/sync-upstream.test.mjs`,
  `tests/scripts/validate-identity.test.mjs` — test harness; optional for
  instances, ships with the framework.

**Modified files (delivered via sync):**
- `scripts/sync-upstream.mjs` — **the stage-5 fix is load-bearing**: any
  instance carrying the `ec09cdc` version cannot complete a sync with new
  commits (every successful pull is reported as a failure). Instances
  must receive this file via a manual copy or first-sync bootstrap,
  because the broken version can't sync itself. One workable path:
  `git fetch upstream && git checkout upstream/main -- scripts/sync-upstream.mjs`,
  then run the normal sync.
- `scripts/validate-structure.mjs` — §8b lineage check (warn-only when
  `genesis_commit` absent; no action required before syncing).
- `scripts/validate-identity.mjs` — docstring only.
- `docs/FEDERATION.md`, `docs/VERSIONING.md` — documentation.

**Required follow-up per instance (operator-driven):**
1. Nothing mandatory: `genesis_commit` auto-seeds on the first post-pilot
   sync (stage 9), and `memory/` is created if absent (stage 10).
2. (Optional) Verify the seed: `genesis_commit` should equal
   `git rev-list --max-parents=0 HEAD | tail -1` in the instance.
3. Run `npm run validate:structure` — §8b should pass or warn, never
   block.
4. If the instance relies on `.git/info/exclude` for `node_modules`
   (clones don't inherit it), the first sync may refuse on a dirty tree —
   add the exclude locally or land a tracked `.gitignore` entry (Phase 3).

**Per-instance notes:**

| Instance | Notes |
|----------|-------|
| `refi-bcn-os` | Production; heavily diverged `initialize.mjs` (+800 lines). Rebase-based sync should replay local commits, but review the conflict surface before the first sync. |
| `refi-dao-os` | Production; long-overdue sync — expect a large accumulated delta; review before merging. |
| `refi-med-os` | Fresh (born 2026-04-29). First-ever sync seeds `genesis_commit` automatically. |
| `dao-os` | Real submodule of the hub; sync from inside its own directory. |
| `openclaw` | AgentRuntime, not a typical data instance — verify the lineage/sync model applies or document an exception. |
| `regen-coordination-os` | Cloned locally 2026-07-15; standalone clone with own remote — sync from inside its own directory. |

All six are listed in `federation.yaml` `downstream:` (verified 2026-04-29).
