# HEARTBEAT.md — Active Monitoring

_Living checklist of active tasks and system health. Agents consult on every session. Update regularly — mark done, add new, remove stale._

---

## 🚢 v0.5 release in flight (2026-08-28)

**The single convergence point is [`docs/superpowers/plans/2026-08-28-v0.5-release-masterplan.md`](docs/superpowers/plans/2026-08-28-v0.5-release-masterplan.md)** — consolidated trunk + admin M1 + `packages/instance-doctor/` (assessment + reliable sync) + live site + `v0.5.0` tag + branch/worktree topology cleared + **WS-I adoption & session kit**. Everything below either ships in it, is frozen behind it (QUEUE has triggers), or is done. Do not start non-masterplan work before the tag.

- [ ] **🎤 org-os session for the Regen Knowledge Commons group — anchor ~2026-09-10** (`task-260827-luiz-orgos-session-scheduling`; meeting 260827). WS-I (handoff H7) produces the kit: one honest setup path, agent-driven recipe, narrative/demo/one-pager/FAQ, knowledge-commons branch demo instance (`task-260827-luiz-orgos-branch`, `main` kept clean per Monty), clean-room re-run as acceptance. Propose times to the group; 1:1 with Durgadas on the org-os/Craft overlap (`task-260827-luiz-durgadas-1to1`).

---

## Active Tasks

### Vault-safety guard over-matches `clean` (2026-08-21 — found during tonight's session, not yet fixed)

- [x] ~~**Narrow `scripts/guards/deny-destructive-git.mjs`'s `clean` match to the git verb.**~~ — **done 2026-08-28 (WS-A A6)**: the tokenizer now matches `clean`/`stash`/`reset --hard` only in git *subcommand* position, so pathspecs and commit messages naming them are fine. Dashed libexec binaries, wrapper/chained forms and expansion-as-subcommand stay blocked; regression fixtures both ways in `tests/guards/`. One residual false positive is documented and accepted: a heredoc body that *quotes* a real git command still trips it, because the guard reads the whole command line and cannot tell a command from prose about one.
  - Observed false positive 1: a status/report script whose command also happened to contain `git` was blocked because it merely `echo`ed the word "clean" in a string, unrelated to any `git clean` call.
  - Observed false positive 2: `git commit`/`git add` invocations were blocked because the commit message or pathspec referenced the filename `clean-room-bootstrap-2026-08-21.md` — `\bclean\b` matches "clean" inside it because `-` is a non-word character and creates a word boundary. Forced a `git commit -F <file>` / `--pathspec-from-file` workaround to avoid the literal string "clean" appearing in the command line.
  - **Do not fix this as a drive-by** — this is a deliberate safety-control decision for the operator (see the guard's own "DESIGN TRADEOFF — deliberate over-matching" comment); narrowing it changes the boundary and should be a considered choice, not an incidental patch.

### Clean-room bootstrap fix-list (2026-08-21 — outranks the rest of this backlog)

Task 14 forked org-os as a stranger would ("Harbor Bakery Co-op") and found the documented
newcomer path silently produces a wrong instance that passes every check. Full findings:
`memory/reports/clean-room-bootstrap-2026-08-21.md`. Ordered by first-hour impact per the
report's own fix-list.

- [ ] **B3/B4/B5/B6 — Make the fork target an actual blank template.** **Partly closed 2026-08-28:** the *cloning* path no longer leaks framework content — `clone-framework.mjs` strips every generated `.well-known/*.json` and the framework CHANGELOG, and renders the instance's own `dao.json` (see M4 above). What remains is the positioning-level trade-off for the **fork** path: splitting the fork target from the maintainer's live content would end "the framework repo is itself a running org-os instance", a headline proof point at `docs/POSITIONING.md:25` and `README.md:28`. **Not a mechanical fix** — needs its own `DECISIONS.md` entry before execution.
- [x] ~~**B7 — Add a content-diff check that fails when `.well-known/dao.json`'s `name` disagrees with `IDENTITY.md`'s `Name`, or registries still carry upstream placeholder IDs.**~~ — **done 2026-08-28 (WS-B B1)**, in `packages/instance-doctor` rather than in `validate:schemas`: `identity-name-disagreement` compares IDENTITY.md ↔ federation.yaml ↔ dao.json, and `template-leakage` fires when any of them still carries the framework's own identity. Run via `npm run doctor`. This is the check that would have caught bread-coop-os publishing `name: "org-os"` on day one.
- [ ] **B2 — Give the interactive wizard a non-interactive/scriptable mode** (flags or `--config answers.yaml`, analogous to `clone-framework.mjs`) that works *in place* in the current repo, not only a new sibling directory — unblocks CI users and any AI agent driving setup.
- [ ] **B1 — Reconcile `BOOTSTRAP.md`'s six-question description with what `scripts/setup-org-os.mjs` actually asks** (nine prompts, none of which cover team/projects/channels/sources as documented), or make the script ask what's documented. **→ moved into v0.5: masterplan WS-I task I1 (load-bearing for the ~09-10 session).**
- [x] ~~**M1 — Delete or fix `docs/SETUP-PATHS.md`.**~~ — **done 2026-08-28 (WS-F5)**: reduced to an honest stub pointing at the one real path, with a note explaining why 374 lines of Egregore/Filesystem/Hybrid path-selection never described choices a newcomer actually had. Kept as a stub so existing links resolve.
- [ ] **M2 — Point Level 2 of `docs/OPERATOR-GUIDE.md` at something real** — a URL, a command, or an honest "not built yet, use Level 3." As written it promises a web form/chat flow that doesn't exist. **→ moved into v0.5: masterplan WS-I task I1.**
- [x] ~~**M3 — Reconcile README's two competing bootstrap commands.**~~ — **done 2026-08-28 (WS-F5)**: `clone:framework` is stated as the one recommended path, followed by `npm run doctor -- --dir` to verify the result; `npm run setup` is described honestly as the TTY-only in-place alternative that has not been re-tested end to end. Edited in `templates/README.framework.md` and re-rendered, so it cannot drift back.
- [x] ~~**M4 — Fix or reframe `clone-framework.mjs`'s "Recommended" framing.**~~ — **done 2026-08-28 (WS-F5 + the bootstrap fix)**: it is now genuinely the recommended path *and* it produces a healthy instance. It previously emitted one with 7 doctor blockers seconds after creation — no per-instance `dao.json`, the framework's published `.well-known/` data, a hardcoded `3.5`, a legacy upstream URL, the framework's CHANGELOG, and npm scripts pointing at files the instance never receives. All fixed, guarded by `tests/clone-framework-health.test.mjs`.

### Technical
- [ ] **External-validation pilot (v0.6 gate):** recruit one unaffiliated operator to run their org on org-os for 30 consecutive days with ≤4 support interventions and a publishing `.well-known/` instance — see `DECISIONS.md` 2026-08-21 "External-validation milestone". Recruitment is Task 15, `docs/superpowers/plans/2026-08-21-ship-and-validate.md`. Until this lands, network claims stay scoped to single-operator dogfooding and frozen workstreams stay frozen.
- [x] ~~Execute `autopoiesis-research` Phase 2~~ — **done 2026-08-02, gate passed** (sync-upstream + validate-identity + lineage stamp on main; fatal stage-5 bug fixed; 17 tests). Was never checked off here.
- [ ] Execute `autopoiesis-research` Phase 3 (decisions rollup + plan annotations + per-instance cascade) after Phase 2 gate
- [ ] Execute `multica-integration` plan (25 tasks, spec + plan ready, execution deferred 2026-04-25 — recommend fresh worktree)
- [ ] Complete `federation-protocol` end-to-end sync test (queued plan; will benefit from Phase 2 sync-upstream.mjs)
- [ ] Write `future-instance-specs` for regen-coordination-os and regen-toolkit (queued plan)
- [ ] Activate `package-integration` plan phase 1 — inventory audit of `packages/` (queued plan; multica-integration is its pilot)
- [ ] Activate `system-reliability` plan phase 1 — inventory existing reliability infra (queued plan; will absorb Phase 3 within-instance referential integrity findings)
- [ ] Activate `instance-bootstrap` plan phase 1 — resolve cloning mechanism open question (queued plan)
- [ ] Finalize `non-tech-onboarding` scoping — narrowed to web UI + GHA glue over `instance-bootstrap` engine (scoping plan)
- [ ] Finalize `framework-dashboard-template` scoping — reusable dashboard package (scoping plan)
- [ ] Finalize `obsidian-interface` scoping — Obsidian as primary operator interface (scoping plan)
- [ ] Finalize `obsidian-canvas-interface` scoping — Canvas as system overview + interface (scoping plan, depends on `obsidian-interface`)
- [ ] rad-org-os: plan the substrate driver interface (clone/sync/push/propose-change/publish-schema; `github` + `radicle` drivers, selected by `platforms.primary`) — see `docs/RAD-ORG-OS.md` "Next"
- [ ] rad-org-os: add a Radicle bootstrap path to the setup interview (`rad init` + seeding instead of a GitHub fork)
- [ ] rad-org-os: write the seed-node runbook (home server / RPi, systemd, seeding policy as membership, Radicle pinned ≥1.9.1)
- [ ] rad-org-os: implement the KMS `radicle` connector `pull` (specced stub → `radicle-httpd` read API + `rad` CLI; blocked on the connector layer landing)
- [ ] federation-map: add an automated bundle-drift test (run esbuild to a temp file, byte-compare vs committed `dist/federation-map.iife.js`) so a stale vault artifact fails CI instead of silently shipping old code — only review Minor left open
- [ ] federation-map: optional review cleanups — `self.emoji` emitted but never rendered (dead field in `kms/src/map.mjs`); `federation` edge kind has no CSS rule (falls back to base green — confirm intended)
- [ ] federation-map: populate `data/ecosystems.yaml` `sources:` lists once instances carry `source-systems.yaml` (currently empty arrays; ring-3 source nodes therefore absent on the hub)
- [x] ~~graphify-integration scope question~~ — **resolved by what shipped** (A: ingest source — `graphify export --wiki` + `compile:knowledge` on main; portfolio memo §4 row 14 closed it)
- [ ] dfos-integration: operator review of the approved spec, then run writing-plans on Phases 0–1 (`did:dfos` identities + `verify:federation`) — spec `docs/superpowers/specs/2026-07-25-dfos-org-os-integration-design.md`, queue #8
- [ ] dfos-integration: ask Metalabel about hosted-relay terms/limits and whether the spaces product exposes an API (Phase 4 gate; open questions in spec)
- [x] ~~org-os-website: wire `docs/POSITIONING.md` into `site/src/data/landing.yaml` + `modules.yaml`~~ — done 2026-08-10; `landing.yaml` carries the four-layer hero, `modules.yaml` mirrors `docs/MODULES.md` under a drift test
- [ ] v5 module engine: implement `loadRegistry`/`add`/`adopt` + the `npm run module` script (`scripts/modules.mjs` is a 70-line validate-only scaffold). `adopt` must treat an identity mapping (`X: X`) as "already installed — checksum in place", per `modules/org-os-cloudflare-os/module.yaml`. **Design input locked 2026-08-28: [`docs/agent-plans/interop-plugin-architecture.md`](docs/agent-plans/interop-plugin-architecture.md)** (everything-is-a-plugin; unify packages/skills/modules under the manifest; topic discovery; interop matrix). Un-freeze trigger fires at v0.5 ship (doctor = module #2, WS-B B10)
- [ ] Give the v5 core tranche manifests (`org-os-standards` first — `org-os-cloudflare-os` already declares a dependency on it), then regenerate `docs/MODULES.md` from the registry instead of maintaining it by hand
- [ ] Execute the Cloudflare OS deployment runbook (`docs/integrations/cloudflare-os.md`) when a Cloudflare account is available; flip `org-os-cloudflare-os` `pilot` → `live` in `docs/MODULES.md` + `site/src/data/modules.yaml` on success
- [x] ~~github-pages-deploy~~ — **done 2026-08-28 (WS-D)**: live at `https://regen-coordination.github.io/org-os-template/`, auto-deploying on push to `main`, with the base-path gate (every internal link carries `/org-os-template` exactly once) enforced in the site build.
- [x] ~~Hygiene: `.gitignore` graphify renderings + test artifacts~~ — landed via the 2026-08-21 trunk merge (`61f117e` + Task 8 narrowing)
- [ ] Investigate: git commit timestamps run ~2 weeks behind the system clock (commits stamped 2026-07-19 while `date` says 2026-08-02) — dashboard "N days ago" math will read wrong until resolved
- [ ] Run `npm run generate:schemas` after any `data/` edit

### Orchestration (multi-instance)
- [ ] Weekly: run `npm run analyze:instances` and review drift report
- [ ] **Known issue: `analyze-instances.mjs` overwrites the tracked drift report with placeholders when run from a worktree** — running `npm run selftest` or `npm run analyze:instances` from a git worktree (not the primary checkout) rewrites `memory/reports/instances-drift-<today>.md`, replacing real drift data with "Not locally scannable" for every instance. Root cause: `frameworkRoot` is derived from `process.argv[1]` (`scripts/analyze-instances.mjs:18`) and resolves each instance's `local_path` relative to the worktree root instead of the primary checkout, so no sibling org-instance dir is ever found; the unconditional `writeFileSync` (`scripts/analyze-instances.mjs:246`) then writes the placeholder report anyway. Found 2026-08-29 during Task 4 (berd integration) selftest wiring. Mitigation: `git restore` the report file after any worktree-run gate, never stage it. Real fix: skip the write (or gate it behind at least one instance actually being scannable) instead of silently overwriting real data with placeholders.
- [ ] Review skill-promotion candidates (see `data/skills-matrix.yaml` where `promotion_status: candidate`)
  - `safe-treasury`, `hats-governance`, `gardens-governance`, `karma-reputation`, `eip4824-identity` — DAO modules in dao-os; evaluate for framework
- [x] ~~`research` promotion — promoted to framework v0.5 (2026-07-15 consolidation; 3 instance copies reconciled)~~
- [x] ~~Resolve `regen-coordination-os` locally — cloned and audited 2026-07-15~~
- [x] ~~Reconcile `federation.yaml` `agent.skills` with actual `skills/` directory — done 2026-07-15 (32 skills listed; generated `skills/commands/` intentionally excluded)~~

### Consolidation follow-ups (from 2026-07-15 instance audit — deferred)
- [ ] Reconcile `initialize.mjs` — refi-bcn-os is +800 lines ahead (vault-safe trunk-aware sync, `--sync/--notion` flags, never-throws session-sync) but massively instance-diverged; needs a careful feature-level backport, not a copy
- [ ] Review `paperclip-agents-app` backport — regen-coordination-os fork is ahead (org-os-bridge, memory/skill syncers, org_os_integration migrations); deep diff then merge
- [ ] Evaluate regen-coordination-os Figma/OKLCH design-token scripts (`derive-{light,dark}-tokens.mjs`, `figma-{extract,render,deepfetch}.mjs`) for promotion as a design-system pipeline
- [ ] Consider backporting refi-bcn-os `close.md`/`initialize.md` command-body improvements (richer than framework's; review after initialize.mjs reconciliation)
- [ ] Document the hub data-bridge pattern (refi-dao `docs/HUB.md` module contract + allowlist→JSON snapshot) as a framework doc
- [ ] coop hygiene — **claim corrected 2026-08-28 sweep:** the big dirty tree is `03 Libraries/coop` (the app repo, 989 dirty files on `fix/landing-page-bugs`), NOT regen-coordination-os (24 dirty); no nested `03 Libraries` mirror found. Tidy separately, vault-safe methods only
- [ ] Propagate v0.5 downstream — **now the post-release Active-1**, executed via `instance-doctor` (masterplan WS-B/WS-H; QUEUE "Next after release"). Sweep 2026-08-28: no instance currently has a working sync path — bcn/regen/bread missing `sync-upstream.mjs` (broken npm entries), dao a no-op stub + no upstream remote; lineage stamps absent everywhere except bread-coop
- [x] ~~**Instance promotion ledgers — register as convergence inputs**~~ — **done 2026-08-28 (WS-F4)**: `refi-bcn-os/docs/kms/FRAMEWORK-FEEDBACK.md` (TF-1..TF-6) and `refi-dao-os/docs/kms/FRAMEWORK-FEEDBACK.md` (~18 items, A1..F1) are now registered in `docs/SKILL-PROMOTION.md` as recognized upstream feedback channels. Full fold of their contents remains v0.6; the two 🔴 data-loss items are broken out above with their own disposition. F1's dispatch package re-targets `archive/feat-knowledge-commons`.
- [ ] 🔴 **kms `store` silently overwrites objects sharing a title-slug (data loss at scale)** — refi-dao ledger B5. **Disposition (WS-F4, 2026-08-28):** ships as a documented **Known Issue** in `CHANGELOG.md [0.5.0]`, not silently. Fix targets **v0.5.1**, and it **gates v0.6 Active-1** (downstream propagation): the fleet does not get synced onto a kms that can lose data. Data loss outranks the scope freeze, so this is exempt from the freeze table.
- [ ] 🔴 **kms provenance criticals** — refi-dao ledger section D (two red items). **Same disposition as B5 above (WS-F4):** documented Known Issue in `[0.5.0]`, fix targets v0.5.1, gates v0.6 Active-1 propagation.

### Funding
- N/A (solo phase — no treasury, no active funding applications)

### Governance
- N/A (solo phase — solo-maintainer decision model)

### Operations
- N/A (solo phase — no formal meetings)

---

## System Health

### Agent Runtime
- [x] Verify `/initialize` renders real content (no stub placeholders) — verified 2026-04-25
- [x] Verify `scripts/initialize.mjs` emits valid JSON with populated registries — verified 2026-04-25

### Data Integrity
- [ ] `data/members.yaml` is up to date
- [ ] `data/projects.yaml` reflects current workstreams
- [ ] `data/instances.yaml` reflects current instance state (update after any framework change affecting instances)
- [ ] `.well-known/*.json` matches current `data/`

### Federation
- [x] `federation.yaml` `downstream` lists all known instances — verified 2026-04-29, re-verified 2026-07-15 (bread-coop-os added)
- [ ] Tell maintainers of refi-dao-os, refi-bcn-os, regen-coordination-os to add `refi-med-os` to their `federation.yaml peers:` lists on next sync
- [ ] Instance sync review performed in last 7 days (`memory/reports/instances-drift-*.md`)

### Release
- [ ] Ship `v0.5.0` per the masterplan (WS-G): tag + push `main --follow-tags`; push historical `v3.0.0`/`v3.5.0` tags alongside (supersedes the old "push v3.0.0 when publishing" item)
- [ ] CHANGELOG `[Unreleased]` (symbient v2) folds into `[0.5.0]` at ship — masterplan WS-C2
- [ ] Cross-scheme migrations (3.0/3.5 → 0.5) run per-instance via `instance-doctor sync` — masterplan WS-B8/WS-H (supersedes "apply v2-to-v3 on next sync")

---

## Reminders

- [ ] After any `data/` change → `npm run generate:schemas && npm run validate:schemas`
- [ ] After any `data/` change → `npm run generate:quilt` (`docs/QUILT.md` is generated — never hand-edit; edit `scripts/generate-quilt.mjs` / `scripts/lib/quilt-view.mjs`)
- [ ] After any `federation.yaml` change → `npm run validate:structure`
- [ ] Log key decisions to `DECISIONS.md` (authoritative decisions log)
- [ ] Write detailed session notes to `memory/YYYY-MM-DD.md`

---

## Recently Completed

_(Move completed items here with date — keep for 30 days then remove)_

- [2026-08-02] **Admin app M1 shipped — the framework's first read-write web surface.** New package `@org-os/admin`: Hono API + Vite/React SPA that edits an instance's 14 `data/*.yaml` registries through schema-driven forms, committing every change to git. Comment-preserving YAML CST round-trip (one-field edit → one-line diff), 15 hand-authored JSON Schemas, Ajv + referential validation, vault-safe git service (no stash/clean/reset; all paths scoped to `data/`), per-registry write lock, chokidar→WebSocket live updates, localhost-only bind. 44 tests green, typecheck + build green, HTTP end-to-end verified. Final review reproduced and fixed 3 defects (concurrent lost-update, PUT id-mismatch rename, flow-array reformatting). Built in isolated worktree `.worktrees/admin-app`; **PR #1 open** (`feat/admin-app` → `main`). Decisions: hybrid local-first API+SPA · layered proposals (registry entry ↔ git branch) · editing rings · A+B shell · Anytype integrate-don't-fork (licence + architecture verified). Spec: `docs/superpowers/specs/2026-07-23-admin-app-design.md` · M2/M3 plans ready on disk. See `DECISIONS.md` 2026-08-02 + `memory/2026-08-02.md`.
- [2026-08-02] **dfos-integration designed, specced, queued** — DFOS protocol (Metalabel) adopted as the federation's cryptographic identity + verifiable-authorship layer (org **and** agent `did:dfos`, manifest/knowledge/governance anchoring with peer countersignatures, CLI bridge + official `dfos@metalabel` skill, hosted relay first, spaces research-gated). Spec approved + committed, queue entry #8. See `DECISIONS.md` 2026-08-02 + `memory/2026-08-02.md`.
- [2026-08-02] **Positioning + competitive landscape defined** — `docs/POSITIONING.md` (definition, four-layer uniqueness thesis, concepts, features, modules, use cases, comparison copy, taglines) + `docs/research/2026-07-15-agent-native-org-landscape.md` (filename date is an authoring error; work is 2026-08-02). Landscape verified adversarially: 104 agents, 15 primary sources, 3-vote refutation per claim, 10 findings survived, 1 refuted claim excluded. Finding: org-os is the only verified project combining agent-native file workspace + organizational scope + machine-readable org data (EIP-4824) + multi-org federation — layer 1 is commodity (OpenClaw 383k★, claude-chief-of-staff, LifeOS converged on the same conventions; AGENTS.md now Linux Foundation-stewarded), layers 3–4 uncontested. Decisions: demonstrate rather than assert; operator experience is the traction priority. See `DECISIONS.md` 2026-08-02 + `memory/2026-08-02.md`.
- [2026-08-02] **Federation map ("the torch") shipped** — interactive map of an instance's external world (ring 1 instances · ring 2 frontier peers-of-peers · ring 3 sources/ecosystems), the counterpart to the internal note graph. New package `@org-os/federation-map` (framework-agnostic `<federation-map>` web component; deterministic ring-pinned d3-force layout × torchlight styling; d3-force sole dep). kms data plane: `render map` → `map.json`, `federate frontier` (one-hop peer-manifest fetch, stale-cache-never-breaks), `render map html` → self-contained offline vault artifact + portal index. Site `/federation` + home mini swapped off the old static SVG. Live map: 35 nodes. Final review caught + fixed a Critical panel XSS on remote-influenced frontier data. 19+65+7 tests green. Spec: `docs/superpowers/specs/2026-07-19-federation-map-design.md` · plan: `docs/superpowers/plans/2026-07-19-federation-map.md` · see `memory/2026-08-02.md`.
- [2026-07-15] **v0.5 cross-instance consolidation complete** — drift 27→0 across all 7 instances. Promoted: `research` (3-way reconciled), `working-with-obsidian-canvas`, `web-browsing`, `notion-cli` skills; `/commit` `/sync` `/handoff` commands; `sync-commands.mjs` cross-editor mechanism; operator-trunk model (`operator-setup.sh` + pre-commit guard); `generate-all-schemas.mjs` merge + `clone-linked-repos.mjs` backport. federation.yaml 0.5 labels fixed, agent.skills 21→32, bread-coop-os in downstream. Matrices: 40 skills / 22 packages. Commit `177c2c8`. See `memory/2026-07-15.md` + DECISIONS.md entry.
- [2026-05-03] **Autopoiesis research scoping + Phase 1 complete.** Spec + 3 phase plans + 9 aspect notes (Genesis, Identity, Membrane, Coupling, Metabolism, Self-maintenance, Cognition, Federation, Volition) + synthesis. Phase 1 gate passed; pilot loop = Loop C (Population learning — cascade closure: `sync-upstream.mjs` + `validate-identity.mjs` + lineage stamp). Phase 2 plan replanned for Loop C. Surfaced two phantom-script bugs in framework. See `memory/2026-05-03.md` and `docs/superpowers/research/2026-05-02-autopoiesis/SYNTHESIS.md`.
- [2026-04-29] **`refi-med-os` instance scaffolded + pushed live** to `ReFiDAO/refi-med-os` (public). Federated under `refi-dao` network as LocalNode peer. Public website + knowledge base consolidated at `repos/refi-mediterranean/`. Bootstrap pending — operator follows `BOOTSTRAP.md` + one-pager. Hub registered in `data/instances.yaml` + `federation.yaml`. See `memory/2026-04-29.md`.
- [2026-04-29] Pre-existing framework bug surfaced (not fixed): `validate:schemas` script in framework `package.json` references missing `scripts/validate-identity.mjs`. Captured in 2026-04-29 memory.
- [2026-04-25] Three new workstreams scoped and queued — `package-integration`, `reliability`, `instance-bootstrap` (see `memory/2026-04-25.md` and DECISIONS entries)
- [2026-04-25] Verified `/initialize` renders real content (no stubs) and `scripts/initialize.mjs` emits valid JSON
- [2026-04-24] Versioning system — policy, CHANGELOG, migrations, version-consistency validator, v3.0.0 bump (see `docs/agent-plans/versioning-system.md`)
- [2026-04-24] Self-hosting inauguration — stubs filled, instance registry introduced, all 5 instances mapped
- [2026-04-06] v2.0.0 Phase 1 framework — docs, skills, data model, session lifecycle (see `docs/agent-plans/v2-phase1-framework.md`)

---

_Last updated: 2026-08-28 (v0.5 release execution — WS-A/B/D/E landed, WS-C/F in progress; see the [release masterplan](docs/superpowers/plans/2026-08-28-v0.5-release-masterplan.md) for live workstream state)_
