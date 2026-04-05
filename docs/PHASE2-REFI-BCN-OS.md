# Phase 2 Plan: refi-bcn-os — Align to org-os v2.0.0

## Current State

- **MASTERPLAN.md** exists (v2.0.0, 788 lines) — already aligned
- **No .claude/agents/** directory (no Claude Code agent modes)
- **6 skills** present (core set, missing bootstrap-interviewer, idea-scout, workspace-improver, org-os-init)
- **knowledge/** exists but minimal (2 files: normalization-log.md, articulation-map.md)
- **No events.yaml, channels.yaml, assets.yaml** (v2 registries missing)
- **No packages/dashboard/** (needs building)
- **No scripts/initialize.mjs** (needs copying from framework)
- **No sync-notion.mjs** (Notion sync not implemented)
- **federation.yaml** has v3.0 structure, runtime "cursor", 5 peers
- **projects/** has 9 project directories with READMEs
- **12 memory files** (active since Mar 7)
- **HEARTBEAT.md** is large (12K+ lines)
- **repos.manifest.json** has 6 repos (framework-related, not BCN-specific org repos)
- **Has Telegram bot persona** documented in AGENTS.md
- **Has pending-payouts.yaml and telegram-topic-routing.yaml** (custom data files)

---

## Tasks

### A3: Align to Canonical Structure

- [ ] Verify MASTERPLAN.md is current with v2 structure (Activations, Research Directions, Metrics, Boundaries)
- [ ] Create `.claude/agents/` with agent modes:
  - `cooperative-ops.md` — BCN cooperative operations agent
  - `telegram-bot.md` — Telegram bot persona (from AGENTS.md)
  - Inherit standard modes from framework if applicable
- [ ] Create `.claude/commands/initialize.md` and `.claude/commands/close.md` (copy from framework)
- [ ] Copy `scripts/initialize.mjs` from org-os framework
- [ ] Copy `scripts/validate-structure.mjs` from framework
- [ ] Add `"initialize"` and `"validate:structure"` to package.json
- [ ] Run `npm run validate:structure` and fix failures
- [ ] Clean up HEARTBEAT.md — 12K lines is excessive; archive completed items

### B3: Populate v2 Data Registries

- [ ] Create `data/events.yaml` — local events (Regenerant workshops, cooperative milestones, ReFi BCN meetups)
- [ ] Create `data/channels.yaml` — Telegram topics, forum, website, email
- [ ] Create `data/assets.yaml` — domains (refibcn.cat), cooperative registration docs, shared tools
- [ ] Add `schema_version: "2.0"` headers to all existing data/*.yaml files
- [ ] Create `data/ideas.yaml` — seed from knowledge analysis or existing proposals
- [ ] Create `data/sources.yaml` — BCN sources (website, Telegram, docs)
- [ ] Create `data/knowledge-manifest.yaml` — declare BCN knowledge domains
- [ ] Regenerate all `.well-known/` schemas
- [ ] Review/migrate custom data files (pending-payouts.yaml, telegram-topic-routing.yaml) — keep as-is or integrate into standard registries

### C3: Agentic Completion

- [ ] Review MASTERPLAN.md — ensure it has current activations for 2026 Q2
- [ ] Verify AGENTS.md references MASTERPLAN.md
- [ ] Update CLAUDE.md to reference /initialize and /close commands
- [ ] Copy missing core skills from framework:
  - `skills/bootstrap-interviewer/SKILL.md`
  - `skills/idea-scout/SKILL.md`
  - `skills/workspace-improver/SKILL.md`
  - `skills/org-os-init/SKILL.md`
- [ ] Document cooperative-ops as a shareable skill candidate
- [ ] Ensure Telegram bot persona is accessible as an agent mode

### C3-K: Knowledge Processing (refi-bcn-os specific)

- [ ] Process old ReFi BCN knowledge base into `knowledge/`:
  - Existing docs, meeting notes, community resources → structured knowledge pages
  - Organize by domains: cooperative-governance, local-economy, regenerative-projects, community-building
- [ ] Process project docs from `projects/` into knowledge where applicable
- [ ] Process Regenerant Catalunya materials (from `packages/operations/regenerant-catalunya/`)
- [ ] Update `data/knowledge-manifest.yaml` with all BCN knowledge domains
- [ ] Run idea-scout on processed knowledge to seed `data/ideas.yaml`

### C3-PM: Project Management Review

- [ ] Audit `data/projects.yaml` — ensure all 9 projects in `projects/` directory have matching entries
- [ ] Cross-reference projects/ directory READMEs with projects.yaml — reconcile mismatches
- [ ] Verify Regenerant-Catalunya project status and data are current
- [ ] Audit HEARTBEAT.md — archive old completed items, ensure current tasks are accurate
- [ ] Verify `data/finances.yaml` reflects current treasury state (Celo Safe)

### C3-QF: Quartz Frontend Spec (scoped, not immediate)

- [ ] Write `docs/QUARTZ-FRONTEND-SPEC.md` — scope for Quartz-based public knowledge site
- [ ] Define content structure: `knowledge/` → Quartz pages, `data/` → structured views
- [ ] Reference `quartz-refi-template` as starting point
- [ ] This is a separate sub-project for a future session

### D3: Build Dashboard + Polish Packages

- [ ] **Build `packages/dashboard/`**:
  - Copy from org-os framework template or refi-dao-os (if built first)
  - Customize for BCN identity (cooperative, Celo chain, local node)
  - Include BCN-specific data: pending payouts, Telegram routing
- [ ] Verify all existing packages work with BCN data
- [ ] Add BCN-specific events/channels to dashboard data generation
- [ ] Add `"generate:dashboard"` to package.json
- [ ] Verify ideation-board works (build if needed)
- [ ] Verify aggregator works with BCN sources

### E3: Federation Configuration

- [ ] Verify federation.yaml is complete and accurate
- [ ] Update agent.runtime to include "claude" alongside "cursor"
- [ ] Ensure BCN-specific knowledge domains are declared in knowledge-commons
- [ ] Verify peer relationships (especially with refi-dao-os and regenerant-catalunya)
- [ ] Add dashboard package to federation.yaml
- [ ] Add ideas.json and knowledge.json to .well-known/ generation

### CC3: Notion Integration

- [ ] Create `scripts/sync-notion.mjs` — bidirectional sync for BCN Notion workspace
- [ ] Document BCN Notion workspace map in `docs/NOTION-WORKSPACE-MAP.md`
- [ ] Add `"sync:notion"` to package.json
- [ ] Configure Notion MCP in `.claude/settings.json`
- [ ] Map BCN-specific Notion databases (members, projects, finances)

### CC4: Repo Consolidation

- [ ] Review `repos.manifest.json` — currently has framework repos, missing BCN-specific repos
- [ ] Add BCN org repos: ReFi-Barcelona, ReFi-BCN-Website, Regenerant-Catalunya
- [ ] Verify these aren't already tracked as git submodules (they are in the Zettelkasten)
- [ ] Run `npm run clone:repos` after updating manifest
- [ ] Run `npm run index:repos` after consolidation

---

## Execution Order

1. **A3** — Structure alignment (directories, commands, HEARTBEAT cleanup)
2. **B3** — Data registries (create missing YAML files)
3. **C3** — Agent files update (skills, modes, CLAUDE.md)
4. **E3** — Federation update
5. **D3** — Build dashboard
6. **C3-K** — Knowledge processing (can run in parallel with D3)
7. **C3-PM** — Project management audit
8. **C3-QF** — Quartz frontend spec (document only)
9. **CC3** — Notion integration
10. **CC4** — Repo consolidation
11. Final: Run `npm run validate:structure` + `npm run generate:schemas`

## Verification

- [ ] `npm run validate:structure` passes
- [ ] `npm run generate:schemas` succeeds
- [ ] Dashboard dev server starts and renders all sections
- [ ] /initialize renders a complete dashboard with real BCN data
- [ ] /close commits and pushes successfully
- [ ] All 9 projects in projects/ have matching data/projects.yaml entries
- [ ] Knowledge domains are populated with at least basic content
