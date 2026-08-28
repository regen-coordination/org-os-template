# Branch Triage — 2026-08-21

Context: `main` had sat 272 commits behind the branch/worktree zoo; it has now
caught up to `8460c8a`, so containment against `main` can finally be measured
meaningfully. This report covers Task 5 (`release/v3.5-execution` triage) and
Task 6 (containment check + archive of fully-merged branches).

---

## Task 5: `release/v3.5-execution` (tip `25197b4`)

### Method

```
git log --oneline main..release/v3.5-execution     # 48 commits
git diff --stat main...release/v3.5-execution       # 52 files, +4198/-391
git cherry main release/v3.5-execution              # salvage gate
```

`git cherry` evaluates non-merge commits only. Of the 48 commits in the
range, 44 are non-merge and 4 are merges. **All 44 non-merge commits print
`+` (no matching patch-id on `main`) — zero print `-` (superseded).**

### Salvage-gate verdict: OPERATOR DECISION REQUIRED — no cherry-pick performed

Per protocol, a cherry-pick only proceeds automatically when *every* commit
is superseded. Here every non-merge commit is unique by patch-id, so the
gate does not resolve on its own — it is a decision for the operator.

Important caveat for that decision: "unique" (`+`) means git found no
matching patch on `main`, **not** that the functionality is absent from
`main`. Several touched paths already exist on `main` under independently
evolved implementations built during the 272-commit gap, e.g.:

| Path | `main` | `release/v3.5-execution` |
|---|---|---|
| `scripts/clone-framework.mjs` | 318 lines | 983 lines |
| `templates/render.mjs` | 96 lines | 44 lines |
| `CHANGELOG.md` | exists | exists (different draft) |

These are divergent rewrites, not clean additions — a blind cherry-pick
risks conflict or regression against work `main` already did on its own
path. This is exactly the kind of call that needs a human diff review, so
no salvage was attempted this session.

**Resolution taken:** archive only. Nothing is lost — every commit remains
fully reachable from the `archive/v3.5-execution` tag, so the operator can
diff/cherry-pick from there at any time.

### Full `git cherry main release/v3.5-execution` output

```
+ 220e7ad16aa78984a680dc06bd2e3c814e1f6563
+ 2ddee994ea1e362a78212f2cfb9945f71e7703f8
+ bae7cd18d75400bdf01dae06482489e6b4a1cc8d
+ c6c8101f47c3684d33946d58d79b77429d861eb2
+ 0614b1149a1ca2146e5b58a9996c0a7f81bd8215
+ 021269f404072293496c4185b1395796da907ddb
+ 39322300cb93826a59e9a8d01ca8e79c56d505aa
+ ada97e72751564f6b000b5bb7cd1eb2e17f073b7
+ cf6d1b24fe53f55349af1b9433b2e3e7d56bb254
+ e1dd7237b761d42e49e15ef6a6dca985c71e35cf
+ c73263513698ff1dbda9b1c1f9e45402d2b9f0dc
+ 310ba48112211a458cdb23754297da5558569c3e
+ 4fd074f10c5745f58c4fd5eadd683a2bfe1046a8
+ 374c8a3dbc838936ff39466d74f86148bd2cfd8c
+ 3c0116b6b8340f450fc6ad8e4662b1f0394b2e3e
+ a6e26d58eb18c942f46b886d4ea860dcd6608566
+ 2d4ae0ad3d571c59844a6010b7bdf43dca078301
+ 241ccfd93007502dcb125d278476bd77e64cb362
+ fe3434851f12eec2c85ba84e85362732e648bd77
+ b9e895e577c8f390beda318206bdbb4c44bc61b8
+ 6d2bc637145940573832cba89364b896577536a3
+ dd84067b2a39841bf2533355b892d322601a7f3c
+ 539e9e1c31473f5cd91f76c83ff9da3448a6428c
+ 0863b035848e1b27392207096a5eaf8e437af2e2
+ fd9844b6a9cf8c0e4e34588d2ad9cdada113a088
+ 74b69fb7e2307909689767b8879c4c1cd35f9329
+ 26ccffe7b4d2a3daf36968ada84e61135164c333
+ 73243d0ae53b39a5f7ba52fd020aadcd6c1e0324
+ 97d3e91711de06c06af3f4bfee49ab746e6cbe8d
+ cbdb60c0ed0923b42a8125468e13ca1cbcf97bfa
+ 061b31eeca13d90647a1586e7dc4e353954b26c6
+ 2ca74bd23f31b2d85ea0482131f05673fc48c670
+ ed844c63f0f318eae37dfe2ec3c757122f029daa
+ dd14f602b62bf81afe9974679944c5c166fa62c4
+ 47190473c634c1659df0b73f28453dca173bd19b
+ 30c47f73373f2bb798e434da0e422bdb62f6c809
+ fe0fd9d11d3c1b74c5f4daafd51fc1c3e9f176dc
+ ced081f99e5f4e405a3f9ccf031ffc5efb4ce055
+ 864927c758f7806dd683c486df5b2a140dafb78b
+ e3e4bd76d6668d13ebf42d39af859645273fd5dd
+ d0802e09061b8566b87f8b47f8771d4b8932b734
+ 1866276820cf48293a2e59b6cb1e4f57e5438daf
+ 3aa2093d4c03871af33695a2a073de51b7d0fc22
+ 25197b41195c7c35a593e2b368485dba06740d63
```

(4 merge commits — `aad31b3`, `e4bb219`, `aed1267`, `adb54f8` — are outside
`git cherry`'s scope; their content is carried by the non-merge commits
already listed above.)

### Per-commit classification (one line each, chronological, oldest first)

`<sha> — <subject> — superseded | salvage | unclear`

```
220e7ad — preflight: stub validate-identity.mjs and sync-upstream.mjs — salvage
2ddee99 — docs(reliability): audit + recovery runbook for v3.5 — salvage
bae7cd1 — docs(reliability): fix review issues — replace hallucinated --rollback, add v3.5-in-progress banner, reword latent signals section — salvage
c6c8101 — feat(templates): minimal Mustache-style renderer — salvage
0614b11 — feat(templates): shared cheatsheet and federation partials — salvage
021269f — feat(templates): framework README template — salvage
3932230 — feat(templates): instance README template — salvage
ada97e7 — feat(templates): GETTING-STARTED conversational onboarding — salvage
cf6d1b2 — feat(templates): render framework README + GETTING-STARTED from templates — salvage
e1dd723 — fix(structure): federation.yaml wrapper + dao.json for validation compliance — salvage
c732635 — feat(reliability): npm run selftest aggregator + fixture — salvage
310ba48 — fix(reliability): correct TODO trigger reference + dedupe package.json initialize key — salvage
4fd074f — feat(reliability): version:check mode verifies CHANGELOG sync — salvage
374c8a3 — feat(reliability): pre-commit hook + install:hooks script — salvage
3c0116b — fix(reliability): install-hooks works from any cwd inside the repo — salvage
a6e26d5 — feat(reliability): CI validate workflow on push + PR — salvage
2d4ae0a — feat(reliability): scheduled drift workflow + --report mode — salvage
241ccfd — docs(reliability): document --report + --check-only contract; clean stray import — salvage
aad31b3 — merge: Phase 1c templates into v3.5 execution branch — unclear
fe34348 — docs(packages): audit per packages-matrix and instance state — salvage
b9e895e — chore(reliability): update selftest happy-path TODO trigger to Phase 3 task 31 — salvage
6d2bc63 — feat(packages): lifecycle_status field on packages-matrix + validator — salvage
dd84067 — docs(packages): PACKAGE-LIFECYCLE doc covering promotion + retirement — salvage
539e9e1 — feat(packages): sync-packages.mjs vendored materialization — salvage
0863b03 — fix(packages): validate federation.yaml shape + log destructive overwrites + cleanup — salvage
fd9844b — feat(packages): sync-upstream delegates to sync-packages — salvage
74b69fb — feat(packages): mark dashboard package promotion-ready — salvage
26ccffe — feat(clone): scaffold scripts/clone-framework.mjs with arg parsing + dry-run — salvage
73243d0 — docs(bootstrap): point at clone-framework engine (v3.5) — salvage
97d3e91 — docs(changelog): draft v3.5.0 entry — salvage
cbdb60c — feat(clone): copy + strip + reset markdown stages (Tasks 20-21) — salvage
061b31e — feat(clone): bootstrap-collect (interactive + config) + skill doc extension — salvage
2ca74bd — feat(clone): render templates + materialize skills + write federation (Tasks 23-25) — salvage
ed844c6 — feat(clone): npm install + validate + git init stages (Tasks 26-27) — salvage
dd14f60 — fix(clone): nested federation.yaml schema + generate:schemas in pipeline — salvage
4719047 — feat(clone): GitHub Template wrapping (Issue form + workflow) — salvage
30c47f7 — feat(bread-coop): bootstrap fixture for v3.5 acceptance test — salvage
fe0fd9d — feat(packages): promote dashboard package to framework + strip more stale files — salvage
e4bb219 — merge: Hermes docs prep — BOOTSTRAP rewrite + CHANGELOG draft — unclear
ced081f — feat(bread-coop): register in instances.yaml — salvage
864927c — release: v3.5.0 — Ready for Real Orgs — salvage
aed1267 — merge: bring docs-prep up to date with execution branch for closeout work — unclear
e3e4bd7 — session: v3.5 release closeout — plans moved, HEARTBEAT reset, memory logged — salvage
d0802e0 — verify: v3.5.0 acceptance gates — 12/14 pass, 2 deferred to operator — salvage
1866276 — chore(schemas): regenerate projects.json after v3.5 closeout edits — salvage
adb54f8 — merge: v3.5 closeout — plans/HEARTBEAT/memory + verification gates + schema regen — unclear
3aa2093 — fix(clone): strip framework identity/data/plans/specs from instances + reset to seed templates — salvage
25197b4 — fix(validate): skip framework_version match for pre-release instance versions — salvage
```

Totals: 48 commits — 0 superseded, 44 salvage (unique per `git cherry`), 4 unclear (merges, not evaluated by `git cherry`).

### Decision needed: unique commits and what they touch

The whole `clone-framework.mjs` / bootstrap-instance pipeline (26 of the 44
salvage-candidates) is the largest coherent chunk — it implements a
`scripts/clone-framework.mjs` CLI (983 lines) with copy/strip/reset/render/
bootstrap-collect/npm-install/git-init stages, GitHub Template wrapping, and
its own test suite (`tests/scripts/clone-framework.test.mjs`). `main`
carries a different, smaller (318-line) implementation of the same script —
these need a side-by-side diff before anything is merged, not a cherry-pick.

Other groups, by touched paths:
- **reliability tooling** (10 commits: `220e7ad`…`241ccfd`, `b9e895e`): `scripts/selftest.mjs`, `scripts/install-hooks.mjs`, `scripts/analyze-instances.mjs`, `.github/workflows/{validate,drift}.yml`, `.github/hooks/pre-commit.sh`, `docs/RELIABILITY.md`.
- **templates system** (7 commits: `c6c8101`…`cf6d1b2`): `templates/render.mjs` (44-line version, vs. main's 96-line version — also divergent), `templates/README.*.md`, `templates/GETTING-STARTED.md`, `templates/partials/*`.
- **packages lifecycle** (7 commits: `6d2bc63`…`fe0fd9d`, `74b69fb`): `data/packages-matrix.yaml`, `scripts/sync-packages.mjs`, `docs/PACKAGE-LIFECYCLE.md`, `packages/dashboard/*`.
- **v3.5.0 release closeout** (7 commits: `ced081f`, `864927c`, `e3e4bd7`, `d0802e0`, `1866276`, `3aa2093`, `25197b4`): `CHANGELOG.md`, `federation.yaml`, `HEARTBEAT.md`, `memory/2026-04-25.md`, `.well-known/projects.json`, `data/instances.yaml`, bread-coop fixture registration.
- **bootstrap preflight stub** (1 commit: `220e7ad`): `scripts/validate-identity.mjs`, `scripts/sync-upstream.mjs`.

None of this was cherry-picked. The operator should review whether any of
it is still wanted given `main`'s independent evolution, and if so,
cherry-pick the specific commits from the `archive/v3.5-execution` tag onto
a fresh branch (`git checkout -b salvage/v3.5-execution main`).

### Archive action taken

```
git tag archive/v3.5-execution release/v3.5-execution
git worktree remove .claude/worktrees/v3-5-execution
git branch -D release/v3.5-execution
```

---

## Task 6: containment check on the remaining stale branches

Rule: only branches where `git rev-list --count main..<branch>` prints
exactly `0` were archived. Everything else is left alone and listed below.
Measured containment did **not** match the plan's working assumption that
all eight branches were fully merged — only four of the eight actually
printed `0`. The other four carry real unmerged work and were left
untouched, per the absolute containment rule.

| Branch | `main..branch` count | Action |
|---|---|---|
| `feat/multica-operator` | 0 | archived → `archive/feat-multica-operator`, branch deleted |
| `v0.5` | 0 | archived → `archive/v0.5`, branch deleted |
| `release/v3.5-design` | 0 | archived → `archive/release-v3.5-design`, branch deleted |
| `autopoiesis-phase2-pilot` | 0 | archived → `archive/autopoiesis-phase2-pilot`, branch deleted |
| `release/v3.5-docs-prep` | **45** | **left alone** — not contained; still has active worktree `.claude/worktrees/v3-5-docs-prep` |
| `release/v3.5-templates` | **7** | **left alone** — not contained; still has active worktree `.claude/worktrees/v3-5-templates` |
| `agent/ORG-4` | **2** | **left alone** — not contained (`ca79192` session: design org-os philosophical foundations; `e19c86c` feat(ideas): record Multica x org-os integration pilot [ORG-4]) |
| `feat/knowledge-commons` | **32** | **left alone** — not contained |

No worktree removal was performed for Task 6: none of the four archived
branches (`feat/multica-operator`, `v0.5`, `release/v3.5-design`,
`autopoiesis-phase2-pilot`) had an associated worktree, and the two
branches whose worktrees the brief flagged for conditional removal
(`release/v3.5-docs-prep`, `release/v3.5-templates`) were not archived
because they are not contained — so per the brief's own condition ("only if
its branch was archived") their worktrees stay.

Left alone (live unmerged work, out of scope for this triage — per the plan
they surface in the Task 13 memo instead):

| Branch | Reason |
|---|---|
| `feat/rad-org-os` | explicitly excluded — live unmerged work, has active worktree `.worktrees/rad-close` |
| `feature/kms-connector-layer` | explicitly excluded — live unmerged work, has active worktree `.worktrees/kms-connector-layer` |
| `feature/tech-tree` | explicitly excluded — live unmerged work, has active worktree `.worktrees/tech-tree` |

Also present in the repo but not in either brief's branch list — untouched,
no action taken, no containment claim made either way:

| Branch | Note |
|---|---|
| `consolidation-backup` | not listed in Task 5 or Task 6 scope |
| `feat/admin-app` | not listed in Task 5 or Task 6 scope; has active worktree `.worktrees/admin-app` |

See `.superpowers/sdd/2026-08-21-ship-and-validate/task-5-6-report.md` for
the raw command output backing every row above (exact `rev-list --count`
per branch, tags created, worktrees removed, final `git branch --list` /
`git worktree list`).
