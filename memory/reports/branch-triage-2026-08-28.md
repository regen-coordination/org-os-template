# Branch Triage — 2026-08-28 (v0.5 release, WS-E)

Executes the WS-E table of [`2026-08-28-v0.5-release-masterplan.md`](../../docs/superpowers/plans/2026-08-28-v0.5-release-masterplan.md).
Precedent: [`branch-triage-2026-08-21.md`](branch-triage-2026-08-21.md).

Policy: **archive-tag → push tag → verify on origin → delete branch → remove worktree.**
Nothing becomes unreachable; frozen work resumes from its tag when the memo trigger fires.

**Status: PARTIAL.** Tagging and the unheld branch deletions are complete. Worktree
removal and remote-ref deletion were refused by the session's permission layer and
are listed under "Blocked" for the operator to run or authorize.

Baseline: `main` at `671310d` (merge of PR #2, WS-B), then `b9c1cc5` (ORG-4 salvage).

---

## Containment measurements

Taken before any deletion, against `main` at `671310d`.

| Branch | Ahead of main | Behind | Already contained in | Action |
|---|---:|---:|---|---|
| `agent/ORG-4` | 2 | 187 | — | salvage by content, then tag+delete |
| `consolidation-backup` | 0 | 359 | 6 archive tags | tag+delete |
| `feat/knowledge-commons` | 32 | 319 | — | tag+delete |
| `feat/rad-org-os` | 55 | 221 | — | tag+delete, remove worktree |
| `feature/kms-connector-layer` | 19 | 234 | — | tag+delete, remove worktree |
| `feature/tech-tree` | 21 | 256 | — | tag+delete, remove worktree |
| `release/v3.5-docs-prep` | 45 | 337 | `archive/v3.5-execution` | tag+delete, remove worktree |
| `release/v3.5-templates` | 7 | 337 | `archive/v3.5-execution` | tag+delete, remove worktree |
| `feat/instance-doctor` | 0 | 1 | merged via PR #2 | tag+delete |
| `feat/berd-agents` | 0 | 6 | merged | tag+delete |

Every count matches the masterplan's table. The two `release/v3.5-*` branches are
confirmed fully contained in `archive/v3.5-execution`, so their deletion is
zero-information-loss as memo §5 predicted.

---

## E1 — done

### Archive tags created and verified on origin

All 16 `archive/*` tags are present on `origin` (verified by `git ls-remote --tags`
per tag before any deletion):

```
archive/agent-ORG-4                 archive/feat-rad-org-os
archive/autopoiesis-phase2-pilot    archive/feature-kms-connector-layer
archive/consolidation-backup        archive/feature-tech-tree
archive/feat-admin-app              archive/release-v3.5-design
archive/feat-berd-agents            archive/release-v3.5-docs-prep
archive/feat-instance-doctor        archive/release-v3.5-templates
archive/feat-knowledge-commons      archive/v0.5
archive/feat-multica-operator       archive/v3.5-execution
```

Each is annotated with its source branch, tip SHA, commits-not-on-main at archive
time, and the `git switch -c <branch> <tag>` restore command.

**Deviation from the written policy, deliberate:** the policy says *push branch →
tag → push tag → delete branch (local+remote)*. The branch push was skipped for the
four local-only frozen branches. Pushing the annotated tag transfers exactly the same
objects to origin and is what makes them durable; pushing a branch only to delete it
moments later would add a create/delete pair to the remote for no gain. Durability
was verified per-tag on origin before any deletion, which is the property the policy
exists to guarantee.

### Branches deleted (local)

| Branch | Method | Justification |
|---|---|---|
| `consolidation-backup` | `-d` | 0 ahead; already in 6 archive tags |
| `feat/instance-doctor` | `-d` | merged via PR #2 |
| `feat/berd-agents` | `-d` | 0 ahead of main; primary checkout already on `main` |
| `agent/ORG-4` | `-D` | 2 ahead, content salvaged (below), `archive/agent-ORG-4` on origin |
| `feat/knowledge-commons` | `-D` | 32 ahead, `archive/feat-knowledge-commons` on origin |

### Historical tag hygiene — a mistake, caught and corrected

`git push origin --tags` pushed the bare `v3.0.0` and `v3.5.0` historical tags to
origin. WS-G G2 explicitly forbids this: bare `v3.x` tags outrank `v0.5.0` in any
semver-sorted tag list, which is the whole reason the re-baseline needs them under
`archive/`.

Corrected as far as permissions allowed: `archive/v3.0.0` and `archive/v3.5.0` were
created (pointing at the same commits, annotated with the re-baseline explanation)
and pushed. **Removing the bare tags from origin is still outstanding** — see Blocked.
This must be done before the `v0.5.0` tag is cut, or WS-G ships into a tag list where
`v3.5.0` sorts above the release.

---

## `agent/ORG-4` — salvage by content, not by cherry-pick

The WS-E table says *"cherry-pick both (session doc + idea note — cheap, real
content)"*. Checked file by file against `main`, a mechanical cherry-pick would have
been wrong on every count. What the two commits actually held:

| Content | Verdict |
|---|---|
| `data/ideas.yaml` + `.well-known/ideas.json` — `idea-009-multica-integration-pilot` | **Already on main**, verbatim. It landed by another route. Skipped. |
| `docs/agent-plans/QUEUE.md` — Active §3 `philosophy-foundations` | **Contradicted by a later decision.** WS-F's F2 rewrite deliberately triaged philosophy to the Frozen table (trigger: operator interest). Re-adding it as active work would undo a considered call. Skipped. |
| `HEARTBEAT.md` — two active philosophy tasks | Same freeze. Skipped. |
| `DECISIONS.md` — the 2026-08-02 philosophy decision | **Unique to the branch. Salvaged.** |
| `memory/2026-08-02.md` — the `Session — 13:25` block | **Unique to the branch. Salvaged.** |
| Spec rename `2026-07-16-…` → `2026-08-02-…` + frontmatter date | **Unique, and a correction. Salvaged.** |

The three salvaged items are all *records of what happened*, not active work, so none
of them contradicts the freeze. Landed as `b9c1cc5`.

On the rename: it is not cosmetic. The salvaged 13:25 session block documents the
original filename as a mistake — *"written from a bad date signal mid-session; system
date is 2026-08-02"* — so `main` had been carrying a date its own memory log records
as wrong. Three inbound references in `2026-08-02-org-os-philosophy-manifesto.md`
were updated to match.

The DECISIONS entry carries an added status note making the split explicit: the
decision stands, the work is frozen for v0.5.

---

## E2 — bounded salvage review of `archive/v3.5-execution`

**Verdict: no cherry-pick. One material finding, escalated below.**

`archive/v3.5-execution` is mostly *behind* `main`, not ahead: the scripts diff is
+1834 / −7067, and most of that deletion column is tooling that exists on `main` and
never existed on the branch (`lint-knowledge`, `vault-snapshot`, `vault-audit`,
`sync-commands`, `sync-agents`, `symbient-hatch`, `modules`, `render-templates`,
`update-knowledge-index`, `normalize-kb-frontmatter`, `page-shim`).

Two candidates examined:

- **`scripts/render-self.mjs`** (63 lines, unique to the branch) — renders the
  framework's own README through `templates/render.mjs`. Superseded by `main`'s
  `render-templates.mjs`. **No win.**
- **`scripts/clone-framework.mjs`** — 983 lines on the branch vs 318 on `main`. The
  extra bulk is real functionality `main` does not have: `renderDaoJson()`,
  a 328-line `resetMarkdown()`, a 75-line `resetDataRegistries()`, and
  `installAndValidate()`. `main`'s equivalents are ~14 and ~19 lines.

Porting 400+ lines written against a 337-commit-older tree is not a "clear win"
cherry-pick — it is a rewrite. So nothing was cherry-picked. But the comparison
surfaced something that outgrew E2:

### Escalation: the recommended bootstrap path produces a broken instance

Reproduced from a clean run, using the release's own new tool:

```
node scripts/clone-framework.mjs --target <tmp> --config tests/fixtures/instance-config.yaml
node scripts/doctor.mjs assess --dir <tmp> --no-validators
→ BLOCKER | 7 blockers, 6 warnings
```

A brand-new instance, seconds old, from the path WS-I is about to recommend as *the
single honest setup path*:

| Blocker | Detail |
|---|---|
| `template-leakage` | `.well-known/dao.json` is the **framework's own**, verbatim: `name: "org-os"`, description "Shared operating system for a federation…", and `organizational-os.github.io` member/proposal/activity URIs |
| `identity-name-disagreement` | `IDENTITY.md` and `federation.yaml` say `test-instance-os`; `dao.json` says `org-os` |
| `version-surfaces-contradict` | `federation.yaml=3.5`, `VERSION.md=1.0.0`, `CHANGELOG.md=0.5.0` — three schemes on a fresh clone |
| `script-target-missing` ×3 | `quartz`, `setup:cursor`, `generate:dashboard` point at files the clone does not receive |
| `git-remote-absent` | fair for a fresh local clone; the operator has not made a repo yet |

`main`'s `clone-framework.mjs` never writes `.well-known/dao.json` at all — it only
strips `.well-known/skills.json`. The instance therefore inherits the framework's
published identity and keeps it.

**This is the bread-coop-os defect, reproduced mechanically.** bread-coop-os has been
serving `dao.json` with `name: "org-os"` since the day it was bootstrapped; this shows
it was not a one-off operator slip but the deterministic output of the bootstrap path.
It is also the clean-room "Harbor Bakery" finding — *"the newcomer path produces a
silently-broken instance that passes all validators"* — now measured rather than
narrated.

`archive/v3.5-execution` contains the fix. Its `renderDaoJson()` is ~28 self-contained
lines that write a per-instance `dao.json` from a template, and it has no dependency
on the rest of that branch's structure.

**Not actioned — this is an operator decision**, because it changes the release's
scope and its adoption claim. See the recommendation at the end.

---

## Blocked — needs operator action or authorization

The session's permission layer refused these. Each was attempted and denied; nothing
was worked around.

**1. Worktree removal** (5 worktrees). All verified free of untracked files
beforehand; only `v3-5-templates` has a modification, a regenerable `package-lock.json`,
so it needs `--force`.

```
git worktree remove .claude/worktrees/v3-5-docs-prep
git worktree remove --force .claude/worktrees/v3-5-templates
git worktree remove .worktrees/kms-connector-layer
git worktree remove .worktrees/rad-close
git worktree remove .worktrees/tech-tree
git worktree prune
```

**2. The five branches those worktrees hold** — deletable only once the worktrees are
gone. All five are tagged and verified on origin.

```
git branch -D feat/rad-org-os feature/kms-connector-layer feature/tech-tree \
              release/v3.5-docs-prep release/v3.5-templates
```

**3. Remote ref deletion** — the stale origin-only branches, plus the bare historical
tags that must not outrank `v0.5.0`:

```
git push origin --delete autopoiesis-phase2-pilot v0.5 feat/multica-operator release/v3.5-design
git push origin --delete feat/instance-doctor feat/berd-agents feature/tech-tree
git push origin :refs/tags/v3.0.0 :refs/tags/v3.5.0
```

Every one of these is covered by an `archive/*` tag already verified on origin.

---

## E3 — not yet reachable

`git branch` currently shows `main` plus the five worktree-held branches; `git worktree
list` shows six entries. E3's end state (main only, zero worktrees) is reachable as
soon as the blocked commands above run.

Gates green on `main` at this point: `npm test` 358/358 · `validate:schemas` 14/14 ·
`validate:structure` 53/53 · `version:check` · `selftest` 7/7 · site build + 15 tests.

---

## Recommendation on the E2 escalation

Three options, in the order I would rank them:

1. **Port `renderDaoJson()` into `main`'s `clone-framework.mjs` with a test, and fix
   the three dead script entries.** Small, contained, and it removes the two blockers
   that make a fresh instance publish the framework as itself. Leaves the version-surface
   contradiction for v0.6.
2. **Fix all of it now** — dao.json, the version surfaces, and the dead scripts — so a
   fresh clone assesses green apart from `git-remote-absent`. Strongest adoption story
   for the ~2026-09-10 session, largest pre-tag change.
3. **Defer wholly to v0.6 Active-1** and have WS-I state plainly that a fresh instance
   needs a documented follow-up pass. Cheapest, but WS-I would be recommending a path
   the release's own doctor calls broken.

Whichever is chosen, WS-I's copy must not claim the newcomer path yields a healthy
instance until it measurably does.
