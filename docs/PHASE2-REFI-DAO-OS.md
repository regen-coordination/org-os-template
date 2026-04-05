# Phase 2 Plan: refi-dao-os — Align to org-os v2.0.0

## Current State

- **MASTERPROMPT.md** exists (needs rename to MASTERPLAN.md)
- **No .claude/agents/** directory (agent modes not set up for Claude Code)
- **6 skills** present (core set, missing bootstrap-interviewer, idea-scout, workspace-improver, org-os-init)
- **No knowledge/** directory (blog/podcast not processed yet)
- **No events.yaml, channels.yaml, assets.yaml** (v2 registries missing)
- **No packages/dashboard/** (needs building)
- **No scripts/initialize.mjs** (needs copying from framework)
- **No sync-notion.mjs** (Notion sync not implemented)
- **federation.yaml** has v3.0 structure, runtime set to "cursor"
- **.well-known/** has 13 schemas with templates
- **repos.manifest.json** has 6 repos

---

## Tasks

### A2: Align to Canonical Structure

- [ ] Rename MASTERPROMPT.md → MASTERPLAN.md
- [ ] Update all references to MASTERPROMPT in AGENTS.md, CLAUDE.md, etc.
- [ ] Create `.claude/agents/` with 4 agent modes:
  - `governance-facilitator.md`
  - `content-processor.md`
  - `ideation-curator.md`
  - `aggregator-indexer.md`
- [ ] Create `.claude/commands/initialize.md` and `.claude/commands/close.md` (copy from framework)
- [ ] Copy `scripts/initialize.mjs` from org-os framework
- [ ] Add `"initialize": "node scripts/initialize.mjs"` to package.json
- [ ] Add `"validate:structure": "node scripts/validate-structure.mjs"` to package.json
- [ ] Copy `scripts/validate-structure.mjs` from framework
- [ ] Run `npm run validate:structure` and fix any failures

### B2: Populate v2 Data Registries

- [ ] Create `data/events.yaml` — known events (assemblies, council calls, deadlines)
- [ ] Create `data/channels.yaml` — all ReFi DAO communication channels (forum, GitHub, social)
- [ ] Create `data/assets.yaml` — domains (refidao.com), accounts (GitHub org), brand assets
- [ ] Add `schema_version: "2.0"` headers to all existing data/*.yaml files
- [ ] Create `data/ideas.yaml` — seed with any known community ideas
- [ ] Create `data/sources.yaml` — blog RSS, podcast feed, GitHub repos
- [ ] Create `data/knowledge-manifest.yaml` — declare knowledge domains
- [ ] Regenerate all `.well-known/` schemas

### C2: Agentic Completion

- [ ] Update MASTERPLAN.md (after rename) with v2 structure: Activations, Research Directions, Success Metrics, Boundaries
- [ ] Update AGENTS.md to reference MASTERPLAN.md (not MASTERPROMPT)
- [ ] Update CLAUDE.md to reference MASTERPLAN.md and /initialize
- [ ] Copy missing core skills from framework:
  - `skills/bootstrap-interviewer/SKILL.md`
  - `skills/idea-scout/SKILL.md`
  - `skills/workspace-improver/SKILL.md`
  - `skills/org-os-init/SKILL.md`
- [ ] Verify all 6 existing skills match framework versions
- [ ] Ensure BOOTSTRAP.md reflects 3-phase process

### C2-K: Knowledge Processing (refi-dao-os specific)

- [ ] Process ReFi Podcast episodes into `knowledge/podcast/`:
  - Use knowledge-curator skill to process transcripts/episodes
  - Create structured summaries with key themes, guests, ecosystem insights
- [ ] Process ReFi Blog articles into `knowledge/blog/`:
  - Use `data/blog-articles.yaml` as source index
  - Process each article → structured summary with takeaways, referenced projects, ecosystem gaps
- [ ] Process internal docs (proposals, governance docs) into `docs/` (organized by type)
- [ ] Update `data/sources.yaml` with all processed sources and their status
- [ ] Update `data/knowledge-manifest.yaml` to declare all knowledge domains
- [ ] Run idea-scout on processed knowledge to seed `data/ideas.yaml`

### C2-PM: Project Management Review

- [ ] Audit `data/projects.yaml` — ensure all active projects have current status, owners, milestones
- [ ] Cross-reference HEARTBEAT.md action items with projects.yaml — close stale items, add missing ones
- [ ] Verify `data/governance.yaml` reflects current stewardship structure
- [ ] Update `data/meetings.yaml` with recent meetings if not current

### D2: Build Dashboard + Polish Packages

- [ ] **Build `packages/dashboard/`**:
  - Single-page React app showing org health overview
  - 8 sections: Identity, Metrics, Projects, Governance, Finances, Heartbeat, Federation, Activity
  - `scripts/generate-dashboard-data.mjs` reads data/*.yaml → dashboard.json
  - Stack: React 19 + Vite 6 + Tailwind 3.4
- [ ] Verify ideation-board builds and runs (if it exists; otherwise build it)
- [ ] Verify system-canvas generates correct .canvas files (if it exists)
- [ ] Verify aggregator works with ReFi DAO sources
- [ ] Add `"generate:dashboard"` to package.json
- [ ] Ensure all packages have SKILL.md files

### E2: Federation Configuration

- [ ] Verify federation.yaml is complete and accurate
- [ ] Update agent.runtime to include "claude" alongside "cursor"
- [ ] Add dashboard package to federation.yaml packages list
- [ ] Ensure knowledge-manifest.yaml declares all publishable domains
- [ ] Verify cross-references to peers are correct
- [ ] Add ideas.json and knowledge.json to .well-known/ generation

### CC3: Notion Integration

- [ ] Create `scripts/sync-notion.mjs` — bidirectional sync between Notion DBs and data/*.yaml
- [ ] Document Notion workspace map (DB IDs, owners) in `docs/NOTION-WORKSPACE-MAP.md`
- [ ] Add `"sync:notion"` to package.json
- [ ] Configure Notion MCP in `.claude/settings.json`
- [ ] Test sync for: members, projects, meetings, finances

### CC4: Repo Consolidation

- [ ] Verify `repos.manifest.json` includes all ReFi DAO org repos
- [ ] Run `npm run clone:repos` — all repos cloned into repos/
- [ ] Add any missing repos (ReFi-DAO-Infrastructure-Migration, refi-vision-forum-posts)
- [ ] Run `npm run index:repos` after consolidation

---

## Execution Order

1. **A2** — Structure alignment (rename, directories, commands)
2. **B2** — Data registries (create missing YAML files)
3. **C2** — Agent files update (MASTERPLAN, skills, modes)
4. **E2** — Federation update
5. **D2** — Build dashboard
6. **C2-K** — Knowledge processing (can run in parallel with D2)
7. **C2-PM** — Project management audit
8. **CC3** — Notion integration
9. **CC4** — Repo consolidation
10. Final: Run `npm run validate:structure` + `npm run generate:schemas`

## Verification

- [ ] `npm run validate:structure` passes
- [ ] `npm run generate:schemas` succeeds
- [ ] Dashboard dev server starts and renders all sections
- [ ] /initialize renders a complete dashboard with real data
- [ ] /close commits and pushes successfully
