# Plan Queue — org-os (framework)

> Last updated: 2026-11-25. The top of this file is rewritten from `CHANGELOG.md`, the tags and the code on `main` at 0.7.5 (`7c1b959c`). The Frozen, Superseded and Completed sections below are kept as they were; the v0.5 release line moved to Completed. Where the repository does not say what became of an item, this file says "state not recorded here".

## Where things stand (2026-11-25)

**Released since v0.5.0** (each has a tag, `v0.6.0` to `v0.7.5`, and a section in `CHANGELOG.md`):

- **0.6.0** (2026-11-05): the house, `packages/admin`: one Hub per org over its records, rules, proposals, boards and outside systems.
- **0.6.1** (2026-11-08): the house runs hosted as the members' Hub (`deploy/hub/`), with sign-in by emailed link; a hosted Hub writes nothing to its instance by default.
- **0.6.2** (2026-11-08): the hosted Hub's public site is named the portal.
- **0.7.0** (2026-11-11): the workspace (pages, collections, tasks, imports, conversation), the knowledge commons' pages (local only), and compose and deploy.
- **0.7.1** (2026-11-20): instance seams for the house's look; the agent layer read only by those who decide.
- **0.7.2** (2026-11-23): raw file reads by Role (`files:` in `data/visibility.yaml`).
- **0.7.3** (2026-11-23): closes what 0.7.2's `files:` section still let a member be told of a kept file.
- **0.7.4** (2026-11-25): federation on atproto (joining a network; not yet run on live accounts), `org-os-kms` 0.2.0 with the needs/offers pack, snapshots that capture untracked files.
- **0.7.5** (2026-11-25): sign-in with a Bluesky or Certified account, and a network's node accounts.

**The seven v0.6 Actives, by what the repository shows:**

1. **downstream-propagation** — state not recorded here. The last record in this file is the 2026-08-29 fleet sync (`memory/reports/fleet-sync-2026-08-29.md`: five instances took the overlay, none stamped). The weekly drift reports (latest `memory/reports/instances-drift-2026-11-22.md`) could not scan the instances from CI (`local_path_missing`), so they do not say which instances run 0.7.
2. **external-pilot** — open. The docs still say every instance is run by the maintainer, and nothing in the repository records an outside operator.
3. **admin-app M2** — shipped in a changed shape: the admin app became the Hub, released across 0.6.0–0.7.5 (views, the map, ⌘K, the workspace, hosting, sign-in). The M2/M3 plan files were not closed against it here.
4. **buzz-integration** — built, catalogued `pilot` in `docs/MODULES.md`; the five-session dogfood tally in `HEARTBEAT.md` has no session ticked.
5. **berd-integration** — built, catalogued `pilot`; the Goose verification, the full session and the five-use tally in `HEARTBEAT.md` are unticked.
6. **interfaces-consolidation** — not done as specified: `packages/dashboard`, `agents-app`, `paperclip-agents-app` and `webapps`, and `PAPERCLIP_DEPLOYMENT_GUIDE.md`, are still in the repository. Spec: [`2026-08-29-org-os-interfaces-design.md`](../superpowers/specs/2026-08-29-org-os-interfaces-design.md).
7. **org-os-wizard** — not built: `docs/START-HERE.md`, `skills/org-os-wizard/` and `data/agent-roster.yaml` do not exist. The launcher (`npm run open`, 0.7.4) opens, creates or adopts an instance from one page; whether it replaces the wizard is state not recorded here. Spec and plan: [`2026-08-29-org-os-wizard-design.md`](../superpowers/specs/2026-08-29-org-os-wizard-design.md), [`2026-08-29-org-os-wizard.md`](../superpowers/plans/2026-08-29-org-os-wizard.md).

**Open lines the repository shows:**

- PR #11, `feat/crew`: role-based agents (module `org-os-crew`). Open.
- PR #6, `feat/human-authored-born-rule`: accept human-authored candidates with `ai_assisted: false`. Open.
- `docs/site-docs-v2-on-main`: the site's docs v2 brought onto 0.7.5 and re-read against it. Local, not yet a PR.

## Frozen (v0.6+ · trigger required · content preserved)

| Item | Plan/spec | Trigger (additive to the external-pilot floor) |
|---|---|---|
| cloudflare-os deploy half + M3–M4 | `2026-08-10-cloudflare-os-m3-m4.md` | pilot operator asks for a hosted dashboard |
| v5 module engine (beyond manifest-first) | `2026-08-02-org-os-v5-module-system-phase1.md` · **design input: [`interop-plugin-architecture.md`](interop-plugin-architecture.md)** (everything-is-a-plugin per dsh; one manifest mechanism unifying packages/skills/modules; `org-os-module` topic discovery; org-os as connective tissue across Cloudflare OS/Hermes/Multica/Berd/dsh) | a second module manifest exists — **fires at v0.5 ship**: WS-B B10 registers `org-os-instance-doctor` as module #2 |
| autopoiesis Phase 3 | `2026-05-02-autopoiesis-phase3-decisions.md` | pilot hits a federation-scale problem Loop C can't solve |
| skills-section · tui-dashboard · obsidian-interface · obsidian-canvas-interface · framework-dashboard-template · commands-consolidation | respective plans | admin M2 ships **and** (2wk daily-use gap **or** second operator names one) |
| package-integration · system-reliability · federation-protocol · future-instance-specs | respective plans | memo §4 rows 9/10/—/— |
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

- `non-tech-onboarding.md` — **superseded 2026-08-29 by v0.6 Active #7 `org-os-wizard`.** `docs/OPERATOR-GUIDE.md` + `docs/CHAT-INTERFACE.md` shipped; the web wizard, `deploy:pages` config and shared nav header are **retired unbuilt** — its central open question (“which platform for the web wizard?”) is answered *none*: the chat window is the wizard.
- `instance-bootstrap.md` — **superseded 2026-08-29 by v0.6 Active #7 `org-os-wizard`.** Phase 1 shipped as `clone:framework`; open questions 1–5 + 7 resolved in the wizard spec §7; Phase 3 survives as the “no sources ingested” rung of the ladder; the `archive/v3.5-execution` salvage diff carries forward to wizard Phase 1.
- `v3-5-release-implementation.md` — 3.5 line re-baselined to 0.5; branches archived.
- `2026-08-10-v0.5-beta-ship.md` (+ spec) — pre-08-21 snapshot; folded into the masterplan.
- `2026-07-24-multica-org-os-operator.md` — branch archived; scope in memo row 8.
- `2026-04-25_obsidian-terminal-setup.md` — personal vault theming, out of framework scope.

## Completed

**v0.5-release** (shipped 2026-08-29 as `v0.5.0`; the masterplan, [`2026-08-28-v0.5-release-masterplan.md`](../superpowers/plans/2026-08-28-v0.5-release-masterplan.md), and its handoffs hold the workstreams WS-A to WS-I) · federation-map (2026-08-02, XSS fixed) · generate-quilt · graphify-kms-integration · autopoiesis P1+P2 (sync machinery shipped; the P2 fix is load-bearing for WS-B) · symbient v2 · cloudflare-os M0–M2 in-repo (86 tests) · cloudflare-os module + v0.5 docs (substantially; residuals in masterplan) · org-os-website build + positioning truth-up (deploy = WS-D) · ship-and-validate Phases 0–3+5 (trunk landed 2026-08-21, +292 commits; triage round 1; clean-room experiment) · v2-phase1-framework · versioning-system (3.x policy now historical).
