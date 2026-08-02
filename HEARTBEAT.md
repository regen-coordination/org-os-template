# HEARTBEAT.md — Active Monitoring

_Living checklist of active tasks and system health. Agents consult on every session. Update regularly — mark done, add new, remove stale._

---

## Active Tasks

### Technical
- [ ] Execute `autopoiesis-research` Phase 2 (12-task TDD plan; cascade closure: `sync-upstream.mjs` + `validate-identity.mjs` + lineage stamp). Plan: `docs/superpowers/plans/2026-05-02-autopoiesis-phase2-pilot.md`
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
- [ ] graphify-integration: answer the scope question (A ingest source / B query engine / C adapter / D profile bundle) and resume brainstorm → spec → plan — see `memory/2026-08-02.md`
- [ ] graphify-integration: decide the Node↔Python bridge (subprocess CLI / MCP server / REST server) and whether a Python toolchain becomes an org-os instance requirement — blocks the spec
- [ ] dfos-integration: operator review of the approved spec, then run writing-plans on Phases 0–1 (`did:dfos` identities + `verify:federation`) — spec `docs/superpowers/specs/2026-07-25-dfos-org-os-integration-design.md`, queue #8
- [ ] dfos-integration: ask Metalabel about hosted-relay terms/limits and whether the spaces product exposes an API (Phase 4 gate; open questions in spec)
- [ ] org-os-website: wire `docs/POSITIONING.md` into `site/src/data/landing.yaml` + `modules.yaml` — hero still carries pre-positioning copy; positioning decision is `DECISIONS.md` 2026-08-02 (four-layer thesis)
- [ ] github-pages-deploy: publish the built org-os site to a live URL via GitHub Pages — plan queued (`docs/agent-plans/github-pages-deploy.md`). No live site exists anywhere (verified 2026-08-02). Lock open decisions first: target repo (`org-os-framework` rec.), URL strategy (github.io vs custom domain), canonical `site/` branch
- [ ] Hygiene: `.gitignore` `graphify-out/` (contains a 2.8MB generated `graph.html`) and `site/test-results/` — both currently untracked but not ignored
- [ ] Investigate: git commit timestamps run ~2 weeks behind the system clock (commits stamped 2026-07-19 while `date` says 2026-08-02) — dashboard "N days ago" math will read wrong until resolved
- [ ] Run `npm run generate:schemas` after any `data/` edit

### Orchestration (multi-instance)
- [ ] Weekly: run `npm run analyze:instances` and review drift report
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
- [ ] coop-os hygiene: working tree contains a nested mirror of the whole `03 Libraries/` workspace (517 dirty files) — clean up separately, NOT with git clean (vault safety)
- [ ] Propagate v0.5 consolidation downstream on each instance's next sync (new skills: research, web-browsing, notion-cli, working-with-obsidian-canvas; commands: /commit /sync /handoff; sync-commands mechanism; **+ federation map** — instances get it via the kms profile plus one `<federation-map>` embed)

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
- [ ] `federation.yaml` `downstream` lists all 6 known instances (refi-bcn-os, refi-dao-os, refi-med-os, dao-os, openclaw, regen-coordination-os) — verified 2026-04-29
- [ ] Tell maintainers of refi-dao-os, refi-bcn-os, regen-coordination-os to add `refi-med-os` to their `federation.yaml peers:` lists on next sync
- [ ] Instance sync review performed in last 7 days (`memory/reports/instances-drift-*.md`)

### Release
- [ ] Push `v3.0.0` tag to origin when publishing publicly (currently local only)
- [ ] Edit `CHANGELOG.md` `[Unreleased]` stub before the next `npm run version:update`
- [ ] Apply `v2-to-v3` migration to each downstream instance on their next sync session

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

_Last updated: 2026-08-02_
