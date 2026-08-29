# Plan Queue — org-os (framework)

> Last updated: 2026-08-29 (v0.6 Active #6 interfaces-consolidation added) — **converged on the v0.5 release masterplan.** Every entry below carries a verdict: ships-in-v0.5, frozen (with un-freeze trigger), superseded, or completed. Full index + rationale: [`2026-08-28-v0.5-release-masterplan.md`](../superpowers/plans/2026-08-28-v0.5-release-masterplan.md) · portfolio policy: [portfolio decision memo](2026-08-21-portfolio-decision-memo.md) (adopted, one amendment: instance-doctor joins the release).

## Release (the only active line)

**v0.5-release** — [`2026-08-28-v0.5-release-masterplan.md`](../superpowers/plans/2026-08-28-v0.5-release-masterplan.md). Workstreams: **WS-A** land admin M1 (PR [#1](https://github.com/regen-coordination/org-os-template/pull/1), spec promoted from worktree) · **WS-B** `packages/instance-doctor/` (B1–B7 assessment battery + reliable update/sync; closes the "no instance can sync" gap — sweep 2026-08-28 found `sync-upstream.mjs` missing/stubbed in every instance) · **WS-C** one versioning story (`v0.5.0` tag, CHANGELOG fold, VERSIONING 0.x, MASTERPLAN alignment) · **WS-D** site live on GitHub Pages (decisions locked: `org-os-template` repo, project path, current theme) · **WS-E** branch/worktree topology cleared (archive-tag policy, salvage review of `archive/v3.5-execution`) · **WS-F** status convergence (this file, HEARTBEAT, 54 plan/spec stamps, instance promotion-ledger registration) · **WS-G** ship · **WS-H** doctor acceptance on refi-med-os + bread-coop-os · **WS-I** adoption & session kit (one honest setup path via `clone:framework`, agent-driven recipe, session narrative/demo/one-pager/FAQ, knowledge-commons branch demo, clean-room re-run) for the **org-os session ~2026-09-10** to the Regen Knowledge Commons group (meeting 260827; Luiz leads Repo Stabilization; DAIAA = first external audience). Absorbs the open remainder (T4, T10–12, T15) of [`2026-08-21-ship-and-validate.md`](../superpowers/plans/2026-08-21-ship-and-validate.md). **Execution briefs:** [`2026-08-28-v0.5-release-handoffs.md`](../superpowers/plans/2026-08-28-v0.5-release-handoffs.md) (H1–H7, one per session).

## Next after release (v0.6 Actives, per memo §3)

1. **downstream-propagation** — run instance-doctor assess+sync across all 6 downstream instances (refi-bcn-os, refi-dao-os, regen-coordination-os, refi-med-os, bread-coop-os, dao-os); WS-H proves the tooling on two of them first. Workstream: instance-orchestration.
2. **external-pilot** — recruit one unaffiliated operator (30 days, ≤4 interventions, valid `.well-known/`) — the v0.6 gate everything frozen sits behind (`DECISIONS.md` 2026-08-21). **Recruitment channel now concrete:** the ~2026-09-10 org-os session (WS-I) + DAIAA; the knowledge-commons branch instance (WS-I I5) is the first semi-external datapoint.
3. **admin-app M2** — Map + view engine + ⌘K; clock starts at PR #1 merge (WS-A). Spec: [`2026-07-23-admin-app-design.md`](../superpowers/specs/2026-07-23-admin-app-design.md) (promoted in WS-A2; plans `2026-07-23-admin-app-{m2,m3}.md` are tracked in git — the old "gitignored/on-disk-only" note here was wrong).
4. **buzz-integration** — agent-lane bridge to Buzz (github.com/block/buzz): module #3 `org-os-buzz` (`packages/buzz-integration/` + manifest), `/close` posts signed session digests to a local Buzz relay, `/initialize` reads the channel back. Dogfood acceptance: 5 consecutive sessions. Spec: [`2026-08-28-buzz-integration-design.md`](../superpowers/specs/2026-08-28-buzz-integration-design.md) (approved) · plan ready: [`2026-08-29-buzz-integration.md`](../superpowers/plans/2026-08-29-buzz-integration.md) — v0.5 shipped, gate lifted; **built and catalogued `in-dev`** on `main`, dogfood acceptance still pending (HEARTBEAT.md tracker).
5. **berd-integration** — module #4 `org-os-berd` formalizing the shipped personas layer (DECISIONS 2026-08-20) + curated skills bridge materializing org-os skills into Berd's project-local `.agents/skills/` (github.com/block/berd — open-sourced 2026-08-19, which fired the old matrix row's "formalize when it stabilizes" trigger). Acceptance: one full session driven from Berd/Goose + 5 real uses. Spec: [`2026-08-28-berd-integration-design.md`](../superpowers/specs/2026-08-28-berd-integration-design.md) (approved) · plan ready: [`2026-08-29-berd-integration.md`](../superpowers/plans/2026-08-29-berd-integration.md) — v0.5 shipped, gate lifted; **built and catalogued `in-dev`** on `main`, Goose-verification acceptance still pending (HEARTBEAT.md tracker).
6. **interfaces-consolidation** — the interface contract + legacy-surface prune: two planes (git-native data plane · admin API as the framework's only server, "new interfaces are clients, never servers"), four canonical surfaces (CLI · KMS · Admin · Conversational). Deletes `packages/{dashboard,agents-app,paperclip-agents-app,webapps}` + orphaned `PAPERCLIP_DEPLOYMENT_GUIDE.md`; updates MODULES.md ("Not modules" supersession record + stale admin status), PACKAGES.md deprecation banner, `data/packages-matrix.yaml` lifecycle entries; overturns the 08-02 modularization "stay npm workspaces" ruling. Spec + doc updates land on `main` (spec committed `efeb225`); deletions ride `feat/interfaces-prune` and merge only after the 0.5.1 patch is cut — removals target 0.6.0. Spec: [`2026-08-29-org-os-interfaces-design.md`](../superpowers/specs/2026-08-29-org-os-interfaces-design.md) (approved) · plan: to be written at pickup. Workstream: interfaces.

## Frozen (v0.6+ · trigger required · content preserved)

| Item | Plan/spec | Trigger (additive to the external-pilot floor) |
|---|---|---|
| cloudflare-os deploy half + M3–M4 | `2026-08-10-cloudflare-os-m3-m4.md` | pilot operator asks for a hosted dashboard |
| v5 module engine (beyond manifest-first) | `2026-08-02-org-os-v5-module-system-phase1.md` · **design input: [`interop-plugin-architecture.md`](interop-plugin-architecture.md)** (everything-is-a-plugin per dsh; one manifest mechanism unifying packages/skills/modules; `org-os-module` topic discovery; org-os as connective tissue across Cloudflare OS/Hermes/Multica/Berd/dsh) | a second module manifest exists — **fires at v0.5 ship**: WS-B B10 registers `org-os-instance-doctor` as module #2 |
| autopoiesis Phase 3 | `2026-05-02-autopoiesis-phase3-decisions.md` | pilot hits a federation-scale problem Loop C can't solve |
| skills-section · tui-dashboard · obsidian-interface · obsidian-canvas-interface · framework-dashboard-template · commands-consolidation | respective plans | admin M2 ships **and** (2wk daily-use gap **or** second operator names one) |
| instance-bootstrap (wizard scope) | `instance-bootstrap.md` | resumes with package-consumption answer; **cloning engine itself is shipped** (`clone:framework`, bread-coop acceptance) — salvage diff vs `archive/v3.5-execution` runs in WS-E2 |
| package-integration · system-reliability · federation-protocol · future-instance-specs · non-tech-onboarding | respective plans | memo §4 rows 9/10/—/—/6-adjacent |
| dfos-integration + Metalabel outreach | `2026-07-25-dfos-org-os-integration-design.md` | a peer org asks for verifiable identity / Metalabel publishes a spaces API |
| multica-integration | `2026-04-25-multica-integration.md` | Multica stable self-hosted release |
| rad-org-os (55 commits → `archive/feat-rad-org-os`) | `2026-07-31-rad-org-os-artifacts.md` | Radicle carries a real second operator |
| kms-connector-layer (19 commits → archive tag) | `2026-07-19-org-os-kms-connector-layer.md` | rad-org-os trigger, or GitHub/KOI ingestion needed on its own merits |
| tech-tree (21 commits → archive tag; first queue entry ever) | `2026-07-19-tech-tree.md` | operator wants the roadmap visualization |
| knowledge-commons (32 commits → archive tag; refi-dao F1 dispatch package re-targets the tag) | `2026-07-23-org-os-kms.md` | interface question (row 6) resolves in its favor |
| aggregator-package-promotion | regen-coordination spec | aggregator v1 ships (~6–8 wks from 2026-08-21) |
| graphify-knowledge-pages / -lint · validate-structure-v3-audit · repo-check-health | — | first post-release maintenance batch (repo-check-health + validate-structure-audit are the memo §7 cheap exceptions) |
| philosophy-manifesto | `2026-08-02-org-os-philosophy-manifesto.md` | unstarted; operator interest |

## Superseded

- `v3-5-release-implementation.md` — 3.5 line re-baselined to 0.5; branches archived.
- `2026-08-10-v0.5-beta-ship.md` (+ spec) — pre-08-21 snapshot; folded into the masterplan.
- `2026-07-24-multica-org-os-operator.md` — branch archived; scope in memo row 8.
- `2026-04-25_obsidian-terminal-setup.md` — personal vault theming, out of framework scope.

## Completed

federation-map (2026-08-02, XSS fixed) · generate-quilt · graphify-kms-integration · autopoiesis P1+P2 (sync machinery shipped; the P2 fix is load-bearing for WS-B) · symbient v2 · cloudflare-os M0–M2 in-repo (86 tests) · cloudflare-os module + v0.5 docs (substantially; residuals in masterplan) · org-os-website build + positioning truth-up (deploy = WS-D) · ship-and-validate Phases 0–3+5 (trunk landed 2026-08-21, +292 commits; triage round 1; clean-room experiment) · v2-phase1-framework · versioning-system (3.x policy now historical).
