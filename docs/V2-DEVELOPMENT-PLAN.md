# org-os v2.0.0 — Comprehensive Development Plan

## Context

**org-os** is the complete operating system for organizations (DAOs, cooperatives, nonprofits). It structures all organizational knowledge in a machine-readable, federated way — provides an agent runtime for autonomous operations — and serves human workflows and web interfaces. It is not just an agent workspace or just a knowledge system: it is both equally, integrated.

The v1.0 foundation is solid: 9-step agent startup sequence, federation.yaml v3.0, EIP-4824 schemas, 6 core skills, memory system, and two fully operational instances (refi-dao-os, refi-bcn-os). This v2 plan closes remaining gaps and prepares for scaling.

**Key decisions for v2:**
- Standardize on **MASTERPLAN.md** (not MASTERPROMPT) across all instances
- Plan split as a **matrix**: feature layers (rows) x repos (columns) — enabling parallel execution
- **Fully develop** refi-dao-os and refi-bcn-os; create **detailed specs** for regen-coordination-os and regen-toolkit
- Skills: **core + custom + sharing** (framework core, instance custom, federation sharing)
- Bootstrapping: **layered approach** (interview → source ingestion → ongoing learning)
- **Autoresearch pattern** (inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch)) — agents autonomously improve the workspace through iterative experiment loops guided by MASTERPLAN.md
- **Idea hatching pipeline** — knowledge (blog, podcast, research) feeds ideas, ideas become hatched projects where agents and community develop ecosystem gaps
- **Non-tech operator accessibility** — onboarding and basic operations must be accessible without GitHub/CLI knowledge

---

## Subproject Matrix

The plan is organized as a matrix of **5 feature layers** x **5 repos**. Each cell is an independently executable task.

| Layer | org-os (framework) | refi-dao-os | refi-bcn-os | regen-coordination-os (spec) | regen-toolkit (spec) |
|-------|-------------------|-------------|-------------|------------------------------|---------------------|
| **A. File Structure & Standards** | A1 | A2 | A3 | A4 | A5 |
| **B. Data Model & Schemas** | B1 | B2 | B3 | B4 | B5 |
| **C. Agentic Files & Skills** | C1 | C2 | C3 | C4 | C5 |
| **D. Packages & Webapps** | D1 | D2 | D3 | D4 | D5 |
| **E. Federation & Exchange** | E1 | E2 | E3 | E4 | E5 |

---

## Layer A: File Structure & Standards

### Goal
Establish the canonical file structure for org-os. Every instance follows the same layout. The framework defines the standard; instances customize content.

### A1: org-os Framework — Canonical File Structure Spec

Define and document the **universal org-os directory structure**:

```
[instance-root]/
├── MASTERPLAN.md              # Strategic vision, directions, activations for agents
├── AGENTS.md                  # Agent operating manual (9-step startup, autonomy matrix)
├── SOUL.md                    # Mission, values, voice, boundaries
├── IDENTITY.md                # Org identity, governance infra, chain, addresses
├── USER.md                    # Primary operator profile
├── MEMORY.md                  # Curated long-term decisions index
├── HEARTBEAT.md               # Active tasks, health checks, urgency
├── TOOLS.md                   # Environment config, endpoints, credentials refs
├── BOOTSTRAP.md               # First-run onboarding ritual
├── CLAUDE.md                  # Claude Code quickstart (points to MASTERPLAN)
├── README.md                  # Human-facing repo overview
├── federation.yaml            # Federation manifest v3.0
├── package.json               # npm scripts for all operations
│
├── data/                      # YAML ground truth registries
│   ├── members.yaml
│   ├── projects.yaml
│   ├── finances.yaml
│   ├── governance.yaml
│   ├── meetings.yaml
│   ├── ideas.yaml
│   ├── funding-opportunities.yaml
│   ├── relationships.yaml
│   ├── sources.yaml
│   ├── knowledge-manifest.yaml
│   ├── events.yaml            # NEW v2
│   ├── channels.yaml          # NEW v2
│   └── assets.yaml            # NEW v2
│
├── .well-known/               # EIP-4824 machine-readable schemas
│   ├── dao.json
│   ├── members.json
│   ├── projects.json
│   ├── finances.json
│   ├── meetings.json
│   ├── proposals.json
│   ├── activities.json
│   ├── contracts.json
│   ├── ideas.json             # v2
│   └── knowledge.json         # v2
│
├── memory/                    # Daily operational logs
│   └── YYYY-MM-DD.md
│
├── knowledge/                 # Knowledge commons pages
│   ├── [domain]/
│   │   ├── _index.yaml
│   │   └── [topic].md
│   └── exchange-log.yaml
│
├── ideas/                     # Community idea submissions (markdown)
│   └── [idea-slug].md
│
├── skills/                    # Agent skills (core from framework + custom)
│   └── [skill-name]/
│       └── SKILL.md
│
├── packages/                  # Operational packages
│   ├── operations/            # Meetings, projects, coordination templates
│   ├── governance/            # Election templates, proposal flows
│   ├── webapps/               # Interactive web tools
│   ├── ideation-board/        # v2: Community ideation UI
│   ├── aggregator/            # v2: Content aggregation engine
│   ├── system-canvas/         # v2: Obsidian canvas generator
│   ├── knowledge-exchange/    # v2: Cross-org knowledge sync
│   └── dashboard/             # v2: Organizational health dashboard
│
├── scripts/                   # Operational scripts
│   ├── setup-org-os.mjs
│   ├── generate-all-schemas.mjs
│   ├── validate-identity.mjs
│   ├── clone-linked-repos.mjs
│   └── sync-upstream.mjs
│
├── docs/                      # Instance-specific documentation
│
├── .claude/                   # Claude Code configuration
│   ├── agents/                # Agent modes/personas
│   ├── commands/              # Slash commands
│   └── settings.json
│
└── .well-known/               # (listed above)
```

**Tasks:**
- [ ] Write `docs/FILE-STRUCTURE.md` — canonical spec with purpose of each file/directory
- [ ] Add CLAUDE.md to org-os framework (currently missing)
- [ ] Rename MASTERPROMPT.md → MASTERPLAN.md in org-os framework
- [ ] Update `docs/ARCHITECTURE.md` to reference new file structure spec
- [ ] Create `scripts/validate-structure.mjs` — checks an instance against the canonical spec

### A2: refi-dao-os — Align to canonical structure
- [ ] Rename MASTERPROMPT.md → MASTERPLAN.md
- [ ] Verify all canonical directories exist
- [ ] Clean up any orphaned/duplicate files
- [ ] Ensure CLAUDE.md points to MASTERPLAN.md

### A3: refi-bcn-os — Align to canonical structure
- [ ] Verify MASTERPLAN.md exists (already does)
- [ ] Verify all canonical directories exist
- [ ] Clean up any orphaned/duplicate files

### A4: regen-coordination-os — Structure Specification
Write a spec document defining what this instance needs when initialized:
- Type: Hub (federation coordinator)
- Unique aspects: aggregates all node data, coordinates cross-org sync
- Which packages to enable: aggregator, knowledge-exchange, dashboard, coordination
- Custom data files: nodes.yaml (registry of all local nodes)

### A5: regen-toolkit — Structure Specification
Write a spec document:
- Type: Resource library
- Unique aspects: curates regenerative finance knowledge, tracks/branches across repos
- Which packages to enable: aggregator, knowledge-exchange
- Custom data files: tracks.yaml, modules.yaml

---

## Layer B: Data Model & Schemas

### Goal
Ensure all aspects of organizational life are properly mapped. Add missing dimensions (events, channels, assets). Standardize schemas across instances.

### B1: org-os Framework — Data Model Standard

**Existing registries** (documented, standardized):
1. `members.yaml` — People, roles, layers
2. `projects.yaml` — Initiatives with IDEA lifecycle (Idea→Develop→Execute→Archive)
3. `finances.yaml` — Budgets, expenses, revenues (multi-currency)
4. `governance.yaml` — Elections, decisions, timeline phases
5. `meetings.yaml` — Meeting records with decisions and action items
6. `ideas.yaml` — Community ideas/proposals pipeline
7. `funding-opportunities.yaml` — Grants, rounds, deadlines
8. `relationships.yaml` — Inter-org partnerships
9. `sources.yaml` — Content sources for aggregation
10. `knowledge-manifest.yaml` — Knowledge commons domains and collections

**New v2 registries:**

11. **`events.yaml`** — Community events, deadlines, milestones
```yaml
events:
  - id: "event-001"
    title: "Q2 Assembly"
    type: "assembly"          # assembly | workshop | deadline | milestone | call
    date: "2026-06-15"
    end_date: "2026-06-15"    # null for single-day
    recurrence: null          # weekly | monthly | quarterly | null
    location: "online"        # online | [city] | hybrid
    url: null
    related_project: null
    participants: []
    status: "upcoming"        # upcoming | completed | cancelled
```

12. **`channels.yaml`** — Communication channels and their purposes
```yaml
channels:
  - id: "telegram-main"
    platform: "telegram"      # telegram | discord | forum | email | slack | signal
    name: "ReFi DAO Main"
    url: "https://t.me/refidao"
    purpose: "General coordination and announcements"
    visibility: "public"      # public | members | core | private
    topics: []                # topic routing (for Telegram topics)
    managed_by: "core-stewards"
```

13. **`assets.yaml`** — Organizational assets inventory
```yaml
assets:
  - id: "domain-refidao"
    type: "domain"            # domain | account | credential | brand | tool | document
    name: "refidao.com"
    owner: "core-stewards"
    status: "active"          # active | expired | pending
    renewal_date: "2027-01-15"
    notes: "Registered via Namecheap"
  - id: "github-org"
    type: "account"
    name: "refi-dao GitHub Organization"
    platform: "github"
    url: "https://github.com/refi-dao"
    owner: "luizfernando"
```

**Tasks:**
- [ ] Write `docs/DATA-MODEL.md` — complete data model spec with all 13 registries
- [ ] Add schema templates for events, channels, assets to `.well-known/` generation
- [ ] Update `scripts/generate-all-schemas.mjs` to handle new registries
- [ ] Document schema versioning convention (add `schema_version: "2.0"` header to each YAML)

### B2: refi-dao-os — Populate new registries
- [ ] Create `data/events.yaml` with known events (assemblies, council calls, deadlines)
- [ ] Create `data/channels.yaml` mapping all ReFi DAO communication channels
- [ ] Create `data/assets.yaml` with domains, accounts, brand assets
- [ ] Add `schema_version` headers to existing YAML files
- [ ] Regenerate all `.well-known/` schemas

### B3: refi-bcn-os — Populate new registries
- [ ] Create `data/events.yaml` (local events, cooperative milestones, Regenerant workshops)
- [ ] Create `data/channels.yaml` (Telegram topics, forum, website)
- [ ] Create `data/assets.yaml` (domains, cooperative registration, shared tools)
- [ ] Add `schema_version` headers to existing YAML files

### B4: regen-coordination-os — Data Model Spec
- [ ] Define which registries are needed for a hub node
- [ ] Spec `data/nodes.yaml` — registry of all federated local nodes
- [ ] Spec aggregated views (cross-node members, cross-node events)

### B5: regen-toolkit — Data Model Spec
- [ ] Define `data/tracks.yaml` — toolkit tracks (Foundations, Applied, Playbooks, Local Implementation)
- [ ] Define `data/modules.yaml` — individual learning modules
- [ ] Spec how sources.yaml maps to toolkit repos

---

## Layer C: Agentic Files & Skills

### Goal
All agentic files properly defined. Clear bootstrapping process. Skills architecture with core + custom + sharing. Agent modes documented.

### C1: org-os Framework — Agentic Standards

**Standardize the agent file set:**

| File | Purpose | Template provided? |
|------|---------|-------------------|
| MASTERPLAN.md | Strategic vision + agent activations | Yes (template) |
| AGENTS.md | Operating manual (startup, autonomy, execution) | Yes (complete) |
| SOUL.md | Mission, values, voice, boundaries | Yes (template) |
| IDENTITY.md | Org identity, governance, chain, addresses | Yes (template) |
| USER.md | Operator profile | Yes (template) |
| BOOTSTRAP.md | First-run onboarding | Yes (complete) |
| HEARTBEAT.md | Active tasks | Yes (template) |
| MEMORY.md | Long-term decisions | Yes (template) |
| TOOLS.md | Environment config | Yes (template) |
| CLAUDE.md | Claude Code quickstart | Yes (template) |

**Bootstrapping Process — 3 Phases:**

**Phase 1: Guided Interview** (BOOTSTRAP.md)
Agent runs interactive setup:
1. "What is your organization's name, type, and mission?"
2. "Who are the core members and their roles?"
3. "What are your active projects?"
4. "What governance model do you use?"
5. "What communication channels do you use?"
→ Auto-generates: SOUL.md, IDENTITY.md, data/members.yaml, data/projects.yaml, data/channels.yaml, federation.yaml

**Phase 2: Source Ingestion** (knowledge-curator skill)
Point agent at existing sources:
- GitHub repos → crawl, index, populate data/sources.yaml
- Website → extract org info, content
- Documents → process into knowledge/

**Phase 3: Ongoing Learning** (continuous)
- Meeting processing → builds operational memory
- Heartbeat monitoring → learns priorities
- Knowledge curation → expands knowledge commons
- Feedback loop → improves agent behavior

**Skills Architecture:**

```
skills/
├── [core skills from framework — shared across all instances]
│   ├── meeting-processor/SKILL.md
│   ├── funding-scout/SKILL.md
│   ├── knowledge-curator/SKILL.md
│   ├── capital-flow/SKILL.md
│   ├── schema-generator/SKILL.md
│   ├── heartbeat-monitor/SKILL.md
│   └── bootstrap-interviewer/SKILL.md     # NEW v2
│
├── [custom skills — instance-specific]
│   └── [instance-skill]/SKILL.md
│
└── [shared skills — promoted from instances to framework]
    └── [shared-skill]/SKILL.md
```

**Skill sharing protocol:**
1. Instance creates custom skill in `skills/`
2. Skill proves value over time
3. Instance proposes skill to framework (PR or federation.yaml declaration)
4. Framework reviews, generalizes, adds to core
5. Other instances inherit via `sync-upstream`

**Autoresearch Pattern — Autonomous Workspace Improvement**

Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch), org-os adopts an **autonomous iterative improvement loop** where agents don't just operate within the workspace — they improve it.

The autoresearch model: `program.md` (human-written instructions) guides an agent that modifies `train.py` (the single editable surface), runs experiments with fixed time budgets and clear metrics (val_bpb), and keeps/discards changes based on results. Humans wake up to improved systems.

**Applied to org-os:**

```
MASTERPLAN.md          = program.md     (human-written directions, activations, research agenda)
data/*.yaml + skills/  = train.py       (the editable surface agents improve)
HEARTBEAT.md metrics   = val_bpb        (clear success criteria)
memory/YYYY-MM-DD.md   = experiment log (what was tried, what worked)
```

**The org-os autoresearch loop:**
1. Agent reads MASTERPLAN.md — understands current directions and improvement areas
2. Agent identifies an improvement (knowledge gap, missing data, stale registry, new skill opportunity)
3. Agent makes a scoped change (processes a source into knowledge/, fills a data gap, creates a skill draft)
4. Agent evaluates: did HEARTBEAT task count go down? Did knowledge coverage increase? Did schema validation pass?
5. Agent logs results in memory/ — what was tried, metric before/after
6. Agent keeps improvement or reverts
7. Repeat — human reviews accumulated improvements on next session

**Key design constraints (from autoresearch):**
- **Fixed evaluation surface**: agents measure success via `npm run validate:schemas` pass/fail, HEARTBEAT pending count, knowledge coverage percentage
- **Scoped modification**: agents can modify data/, knowledge/, memory/, skills/ — but NOT SOUL.md, IDENTITY.md, federation.yaml (those are human-controlled, like prepare.py)
- **Human guidance via MASTERPLAN.md**: operators write research/improvement directions ("focus on consolidating meeting insights", "fill gaps in carbon-markets domain") — agents execute autonomously
- **Experiment logging**: every improvement attempt logged with before/after metrics in memory/

**MASTERPLAN.md as the "program.md" for org-os:**
The MASTERPLAN.md becomes the key document where humans write:
- **Activations**: what the agent should focus on right now
- **Research directions**: what knowledge gaps to fill, what processes to improve
- **Success metrics**: how to evaluate whether improvements worked
- **Boundaries**: what NOT to change autonomously

This makes MASTERPLAN.md the most important human-authored file in org-os — it's how operators steer autonomous agent behavior over time.

**Tasks:**
- [ ] Write `docs/AGENTIC-ARCHITECTURE.md` — complete spec for agent files, bootstrapping, skills, autoresearch loop
- [ ] Write `docs/SKILL-SPECIFICATION.md` — how to write skills, YAML frontmatter schema, sharing protocol
- [ ] Write `docs/AUTORESEARCH.md` — the autonomous improvement pattern, metrics, boundaries
- [ ] Create `skills/bootstrap-interviewer/SKILL.md` — guided interview skill
- [ ] Create `skills/workspace-improver/SKILL.md` — autonomous improvement loop skill
- [ ] Update BOOTSTRAP.md template with 3-phase bootstrapping
- [ ] Create MASTERPLAN.md template with activations/directions/metrics/boundaries sections
- [ ] Document agent modes pattern in `docs/AGENT-MODES.md`
- [ ] Define evaluation metrics for autonomous improvement (schema validation, heartbeat delta, knowledge coverage)

### C2: refi-dao-os — Agentic Completion
- [ ] Rename MASTERPROMPT.md → MASTERPLAN.md (update all references)
- [ ] Update AGENTS.md to reference MASTERPLAN.md
- [ ] Update CLAUDE.md to reference MASTERPLAN.md
- [ ] Verify all 4 agent modes are complete: governance-facilitator, content-processor, ideation-curator, aggregator-indexer
- [ ] Verify all 6 core skills + any custom skills are present
- [ ] Ensure BOOTSTRAP.md reflects 3-phase process
- [ ] Add bootstrap-interviewer skill

**Knowledge Processing (refi-dao-os specific):**
- [ ] Process all ReFi Podcast episodes into `knowledge/podcast/` (transcripts → structured summaries with key themes, guests, ecosystem insights)
- [ ] Process all ReFi Blog articles into `knowledge/blog/` (article → structured summary with takeaways, referenced projects, ecosystem gaps)
- [ ] Process internal docs (proposals, governance docs, strategy docs) into `docs/` (organized by type, not into /knowledge)
- [ ] Update `data/sources.yaml` with all processed sources and their status
- [ ] Update `data/knowledge-manifest.yaml` to declare all knowledge domains

**Project Management Review (refi-dao-os):**
- [ ] Audit `data/projects.yaml` — ensure all active projects have current status, owners, and milestones
- [ ] Cross-reference HEARTBEAT.md action items with projects.yaml — close stale items, add missing ones
- [ ] Verify `data/governance.yaml` reflects current stewardship structure

### C3: refi-bcn-os — Agentic Completion
- [ ] Verify MASTERPLAN.md is current
- [ ] Verify agent modes: cooperative-ops + inherited modes
- [ ] Add missing core skills if any
- [ ] Add bootstrap-interviewer skill
- [ ] Ensure Telegram bot persona is documented in agent modes
- [ ] Document cooperative-ops as a shareable skill candidate

**Knowledge Processing (refi-bcn-os specific):**
- [ ] Process old ReFi BCN knowledge base into `knowledge/` (existing docs, meeting notes, community resources → structured knowledge pages by domain)
- [ ] Organize by domains: cooperative-governance, local-economy, regenerative-projects, community-building
- [ ] Update `data/knowledge-manifest.yaml` with all BCN knowledge domains

**Quartz Frontend (scoped, not immediate — Phase 3+):**
- [ ] Spec the Quartz-based frontend for publishing BCN knowledge publicly
- [ ] Define content structure mapping: `knowledge/` → Quartz pages, `data/` → structured views
- [ ] Reference `quartz-refi-template` repo as starting point
- [ ] This is a separate sub-project; document scope in `docs/QUARTZ-FRONTEND-SPEC.md`

**Project Management Review (refi-bcn-os):**
- [ ] Audit `data/projects.yaml` — ensure all active projects have current status
- [ ] Cross-reference `projects/` directory with projects.yaml — reconcile any mismatches
- [ ] Verify Regenerant-Catalunya project status and data are current

### C4: regen-coordination-os — Agentic Spec
Specify the agent personality and skills for the hub:
- [ ] Spec MASTERPLAN.md — hub coordination mandate
- [ ] Spec SOUL.md — values: network weaving, pluralism, subsidiarity
- [ ] Spec unique skills: node-coordinator, federation-sync, cross-org-aggregator
- [ ] Spec agent modes: network-facilitator, knowledge-aggregator

### C5: regen-toolkit — Agentic Spec
Specify the agent for the toolkit:
- [ ] Spec MASTERPLAN.md — toolkit curation mandate
- [ ] Spec SOUL.md — values: open knowledge, practical tools, accessibility
- [ ] Spec unique skills: content-curator, gap-analyzer, module-tracker
- [ ] Spec agent modes: toolkit-curator

---

## Layer D: Packages & Webapps

### Goal
All v2 packages built, tested, and documented. Dashboard added as the 6th package. Clean package structure.

### D1: org-os Framework — Package Standards
- [ ] Document package specification in `docs/PACKAGES.md`
- [ ] Define standard package structure:
  ```
  packages/[name]/
  ├── package.json
  ├── SKILL.md          # Agent skill for this package
  ├── README.md
  ├── src/              # Source code
  ├── scripts/          # Data generation scripts
  ├── config/           # Package config
  └── public/data/      # Generated JSON for frontends
  ```
- [ ] List all standard packages and their status:
  - `operations` — meetings, projects, coordination templates (v1, complete)
  - `governance` — election templates, proposal flows (v1, complete)
  - `webapps` — task manager (v1, complete)
  - `ideation-board` — community ideation kanban (v2, built)
  - `aggregator` — content aggregation engine (v2, built + verified)
  - `system-canvas` — Obsidian canvas generator (v2, built)
  - `knowledge-exchange` — cross-org knowledge sync (v2, built)
  - `dashboard` — organizational health overview (v2, **to build**)

### D2: refi-dao-os — Build Dashboard + Polish Packages

**Dashboard** (`packages/dashboard/`):
- Single-page React app showing org health overview
- 8 sections: Identity, Metrics, Projects, Governance, Finances, Heartbeat, Federation, Activity
- Generation script reads all data/*.yaml + federation.yaml + HEARTBEAT.md → `dashboard.json`
- CSS-only visualizations (progress bars, status badges, bar charts via div widths)
- Same stack as aggregator: React 19 + Vite 6 + Tailwind 3.4
- [ ] Create `scripts/generate-dashboard-data.mjs`
- [ ] Create React components (IdentityHeader, KeyMetrics, ProjectsOverview, GovernanceStatus, FinancialSummary, HeartbeatMonitor, FederationNetwork, RecentActivity)
- [ ] Add to launch.json and test with preview

**Polish existing packages:**
- [ ] Verify ideation-board builds and runs (npm install + dev)
- [ ] Verify system-canvas generates correct .canvas files
- [ ] Verify knowledge-exchange scripts run (process:blog, process:podcast)
- [ ] Ensure all packages have SKILL.md files
- [ ] Add `generate:dashboard` to root package.json

### D3: refi-bcn-os — Build Dashboard + Polish Packages
- [ ] Copy dashboard package from refi-dao-os, customize identity
- [ ] Verify all packages work with BCN data
- [ ] Add BCN-specific events/channels to dashboard data generation

### D4: regen-coordination-os — Package Spec
- [ ] Spec which packages are needed (aggregator, knowledge-exchange, dashboard)
- [ ] Spec the hub aggregator: aggregates data from ALL federated nodes
- [ ] Spec the hub dashboard: shows network-wide metrics

### D5: regen-toolkit — Package Spec
- [ ] Spec the toolkit aggregator: sources from multiple toolkit repos
- [ ] Spec the toolkit browser: content grid with tracks/modules

---

## Layer E: Federation & Exchange

### Goal
Federation works end-to-end. Knowledge exchange protocol is clear. Instances can discover, sync, and share.

### E1: org-os Framework — Federation Protocol
- [ ] Document federation.yaml v3.0 complete spec in `docs/FEDERATION.md`
- [ ] Define knowledge exchange protocol:
  - Publisher: generates knowledge pages, declares in knowledge-manifest.yaml
  - Subscriber: reads peer's manifest, pulls relevant content
  - Sync: git-based (current), koi-net (future)
- [ ] Define skill sharing protocol (how skills propagate through federation)
- [ ] Define the `.well-known/` discovery convention (how instances find each other)

### E2: refi-dao-os — Federation Configuration
- [ ] Verify federation.yaml is complete and accurate
- [ ] Ensure knowledge-manifest.yaml declares all publishable domains
- [ ] Verify cross-references to peers are correct
- [ ] Add new v2 packages to federation.yaml packages list (dashboard)

### E3: refi-bcn-os — Federation Configuration
- [ ] Mirror E2 tasks for BCN context
- [ ] Ensure BCN-specific knowledge domains are declared
- [ ] Verify peer relationships (especially with refi-dao-os and regenerant-catalunya)

### E4: regen-coordination-os — Federation Spec (Hub Role)
- [ ] Spec the hub's unique federation role: aggregates all peers
- [ ] Spec how nodes register with the hub
- [ ] Spec cross-node knowledge routing rules

### E5: regen-toolkit — Federation Spec
- [ ] Spec how toolkit relates to the federation (resource library, not an org)
- [ ] Spec how toolkit content is consumed by other instances' aggregators

---

## Cross-Cutting Concern 1: Idea Hatching Pipeline

### Vision
org-os isn't just internal operations — it's a **coordination layer for ecosystem development**. An org consolidates its repos, knowledge, and community intelligence. From that base, it identifies ecosystem gaps and hatches projects to fill them.

### The Pipeline: Knowledge → Ideas → Hatched Projects

```
knowledge/               ideas/                  hatched repos
┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐
│ Blog posts   │    │ Community    │    │ Standalone project   │
│ Podcast eps  │───▶│ submissions  │───▶│ repo with org-os     │
│ Research     │    │ Agent-       │    │ workspace files,     │
│ Meeting      │    │ surfaced     │    │ deployed agent,      │
│ insights     │    │ gaps         │    │ community stewards   │
└──────────────┘    └──────────────┘    └──────────────────────┘
     (ingest)          (curate)              (hatch & develop)
```

### How it works

**1. Knowledge → Idea Extraction**
- `knowledge-curator` skill processes blog, podcast, meeting content into `knowledge/`
- `idea-scout` skill (NEW) scans knowledge for ecosystem gaps, unmet needs, repeated themes
- Agent surfaces potential ideas into `data/ideas.yaml` with status `surfaced`
- Community members also submit ideas directly via `ideation-board` or markdown in `ideas/`

**2. Idea Lifecycle (enhanced IDEA model)**
```yaml
# data/ideas.yaml - enhanced
ideas:
  - id: "idea-042"
    title: "Carbon Credit Verification Toolkit"
    status: "developing"      # surfaced → proposed → approved → developing → hatched → archived
    source: "knowledge/carbon-markets/verification-gaps.md"
    submitted_by: "agent"     # agent | member-id
    champions: ["luiz", "monty"]
    ecosystem_gap: "No open-source MRV tools for small-scale projects"
    hatched_repo: null         # → "github.com/refi-dao/mrv-toolkit" when hatched
    skills_needed: ["smart-contracts", "data-science", "field-ops"]
    resources: []              # links to related knowledge, funding, repos
    compensation:
      model: null              # bounty | retroactive | grants | equity | null
      pool: null               # funding source reference
```

**3. Hatching: Idea → Project Repo**
When an idea reaches `approved` status:
- Agent (or operator) scaffolds a new repo from org-os template
- Pre-populates with relevant knowledge from parent org's `knowledge/`
- Links back to parent org via `federation.yaml` upstream
- Community members can deploy agents on the hatched repo to develop it
- The hatched project inherits the org's skills, workflows, and knowledge base

**4. Compensation Layer (future-ready)**
Not built in v2 but the data model supports it:
- `compensation.model` field in ideas.yaml tracks how contributors are rewarded
- Links to `data/funding-opportunities.yaml` for grant-funded ideas
- Links to `data/finances.yaml` for bounty pools
- Gardens conviction voting can prioritize which ideas get funded

### Impact on existing plan

**B1 update:** Enhance `data/ideas.yaml` schema with `source`, `ecosystem_gap`, `hatched_repo`, `skills_needed`, `compensation` fields

**C1 update:** Add `idea-scout` to core skills:

| Skill | Description |
|-------|-------------|
| `idea-scout` | Scans knowledge commons for ecosystem gaps, surfaces ideas, tracks idea lifecycle |

**D1 update:** `ideation-board` package should show the full lifecycle: surfaced → proposed → approved → developing → hatched

**E1 update:** Hatched repos federate back to parent org via `federation.yaml` downstream links

### Tasks (added to respective layers)
- [ ] (B1) Enhance `data/ideas.yaml` schema with hatching fields
- [ ] (C1) Create `skills/idea-scout/SKILL.md` — knowledge-to-ideas extraction skill
- [ ] (C1) Document hatching workflow in `docs/IDEA-HATCHING.md`
- [ ] (D2/D3) Update ideation-board to show full idea lifecycle with hatching status
- [ ] (E1) Define hatched-repo federation pattern (downstream link from parent org)

---

## Cross-Cutting Concern 2: Non-Tech Operator Accessibility

### Problem
Currently, all org-os operations require GitHub + CLI + Claude Code proficiency. This excludes most community members and non-technical operators from onboarding and basic tasks.

### Principle: Progressive Disclosure

```
Level 0: Chat interface          (anyone — Telegram, web chat)
Level 1: Web dashboard           (anyone — browser only)
Level 2: Guided bootstrap        (basic computer literacy — web wizard or chat flow)
Level 3: Claude Code CLI         (developer — terminal)
Level 4: Direct repo editing     (developer — git, yaml, scripts)
```

Operators should be able to do meaningful work at every level. Higher levels unlock more power but are not required for basic operations.

### Level 0: Chat Interface (Telegram / Web)
- Operators interact with the org agent via Telegram (or future web chat)
- Can ask questions ("What are our active projects?"), submit ideas ("I have an idea for..."), get status updates
- Agent reads from `data/*.yaml` and responds conversationally
- No GitHub account needed
- **v2 scope:** Document the interface contract (what questions the agent answers, what actions it can take via chat). Telegram bot persona already documented in agent modes.

### Level 1: Web Dashboard (Browser Only)
- `packages/dashboard/` provides read-only org overview
- `packages/ideation-board/` allows idea submission and voting
- `packages/aggregator/` shows curated content
- No authentication needed for public data; simple auth for member actions
- **v2 scope:** All three webapps are being built. Ensure they work standalone (hosted on GitHub Pages or similar).

### Level 2: Guided Bootstrap (Web Wizard / Chat)
- New orgs can bootstrap via a web form or chat flow instead of CLI
- The `bootstrap-interviewer` skill's interview questions become a web form:
  1. Org name, type, mission
  2. Core members and roles
  3. Active projects
  4. Communication channels
- Form submission triggers repo creation + file generation (via GitHub Actions or a hosted service)
- **v2 scope:** Design the flow and document it. Implementation can use GitHub template repos + Actions for the backend.

### Level 3: Claude Code CLI (Current Default)
- Full power: direct agent interaction, skill execution, data editing
- This is where developers and technical operators work
- **v2 scope:** Already well-supported. Improve with better CLAUDE.md quickstart and slash commands.

### Impact on existing plan

**A1 update:** `README.md` template must include "Getting Started" section for non-tech users pointing to dashboard URL and chat interface

**C1 update:**
- `bootstrap-interviewer` skill should define both CLI and web-form question flows
- Document chat interface contract in `docs/OPERATOR-GUIDE.md`

**D1 update:**
- All webapp packages must be deployable as static sites (GitHub Pages)
- Add `npm run deploy:pages` script template for static deployment

**D2/D3 update:**
- Dashboard, ideation-board, aggregator should each have a deploy-to-pages config
- Add basic navigation between the three apps (shared header/links)

### Tasks (added to respective layers)
- [ ] (A1) Add non-tech "Getting Started" section to README.md template
- [ ] (C1) Write `docs/OPERATOR-GUIDE.md` — non-tech operator manual (what you can do via chat, web, CLI)
- [ ] (C1) Define chat interface contract in bootstrap-interviewer skill (question set that works via both CLI and web/chat)
- [ ] (D1) Add `deploy:pages` script template for static webapp deployment
- [ ] (D2/D3) Add shared navigation header across dashboard, ideation-board, aggregator
- [ ] (D2/D3) Ensure all webapps build as static sites deployable to GitHub Pages
- [ ] (C1) Document Telegram bot interface spec in `docs/CHAT-INTERFACE.md`

---

## Cross-Cutting Concern 3: Notion Integration & External Data Coupling

### Problem
Orgs have data in Notion (and other external systems) that must stay coupled with org-os data files. Agents across all setups (Claude Code, Cursor, OpenClaw, OpenCode) need access to these external sources.

### Architecture

```
Notion DBs                    org-os data/
┌──────────────┐              ┌──────────────┐
│ Members DB   │◄────sync────►│ members.yaml │
│ Projects DB  │◄────sync────►│ projects.yaml│
│ Meetings DB  │◄────sync────►│ meetings.yaml│
│ Finances DB  │◄────sync────►│ finances.yaml│
└──────────────┘              └──────────────┘
       ▲                              ▲
       │                              │
   Notion MCP                    File system
   (all agent setups)            (all agent setups)
```

### Design

**1. Notion MCP Configuration (all agent setups):**
- `TOOLS.md` documents the Notion workspace ID, relevant DB IDs, and access token reference
- Each agent setup (Claude Code, Cursor, OpenClaw, OpenCode) configures Notion MCP server
- Config templates provided in `docs/TOOL-SETUP.md` for each platform:
  - Claude Code: `.claude/settings.json` MCP config
  - Cursor: `.cursor/mcp.json`
  - OpenClaw: `openclaw.config.json`
  - OpenCode: `.opencode/config.json` (or equivalent)

**2. Notion ↔ YAML Sync:**
- `scripts/sync-notion.mjs` — bidirectional sync between Notion DBs and `data/*.yaml`
- Direction: Notion is the "live" source for day-to-day updates; YAML is the versioned ground truth
- Sync strategy: Notion → YAML for reads; YAML → Notion for agent-generated updates
- Conflict resolution: timestamp-based, with manual review flag for conflicts
- `npm run sync:notion` added to package.json

**3. Other External Sources:**
- Google Drive/Docs: referenced in `TOOLS.md`, accessed via MCP or direct links
- Telegram: bot integration documented in `docs/CHAT-INTERFACE.md`
- GitHub: already integrated via repos.manifest.json

### Tasks
- [ ] (C1) Document external tool configuration in `docs/TOOL-SETUP.md` — Notion MCP config for Claude Code, Cursor, OpenClaw, OpenCode
- [ ] (C1) Define `TOOLS.md` template section for Notion workspace/DB IDs
- [ ] (B1) Define Notion DB ↔ YAML field mapping spec in `docs/DATA-MODEL.md`
- [ ] (B2) Create `scripts/sync-notion.mjs` for refi-dao-os (map Notion DBs to data/*.yaml)
- [ ] (B2) Add `npm run sync:notion` to refi-dao-os package.json
- [ ] (B2) Document refi-dao-os Notion workspace map (DB IDs, owners) — builds on existing `docs/NOTION-WORKSPACE-MAP.md`
- [ ] (B3) Create `scripts/sync-notion.mjs` for refi-bcn-os
- [ ] (B3) Document refi-bcn-os Notion workspace map

---

## Cross-Cutting Concern 4: Repo Consolidation

### Problem
The `03 Libraries/` directory contains parallel repos that should be consolidated inside org-os instance repos. This creates duplication and confusion about which is canonical.

### Current State

**Repos that exist both standalone in `03 Libraries/` AND inside an org-os instance:**

| Standalone repo | Should consolidate into | Current status in org-os instance |
|----------------|------------------------|----------------------------------|
| `ReFi-DAO-Website` | `refi-dao-os/repos/ReFi-DAO-Website` | Already cloned in repos/ |
| `ReFi-BCN-Website` | `refi-bcn-os/repos/ReFi-BCN-Website` | Already cloned in repos/ |
| `ReFi-Barcelona` | `refi-bcn-os/repos/ReFi-Barcelona` | Already cloned in repos/ |
| `Regenerant-Catalunya` | `refi-bcn-os/repos/Regenerant-Catalunya` | Already cloned in repos/ |
| `ReFi-Mediterranean` | `refi-dao-os/repos/ReFi-Mediterranean` | In repos.manifest.json |
| `ReFi-Provence` | `refi-dao-os/repos/ReFi-Provence` | In repos.manifest.json |
| `Local-ReFi-Toolkit` | `refi-dao-os/repos/Local-ReFi-Toolkit` | In repos.manifest.json |
| `regen-toolkit` | `refi-dao-os/repos/regen-toolkit` | In repos.manifest.json |
| `quartz-refi-template` | `refi-dao-os/repos/quartz-refi-template` | In repos.manifest.json |
| `regen-toolkit-interface` | `refi-dao-os/repos/` or standalone | Evaluate — may stay standalone |
| `Regen Coordination` | `regen-coordination-os/` (when initialized) | Not yet consolidated |

**Repos that should remain standalone in `03 Libraries/`:**
- `org-os` — the framework itself
- `refi-dao-os`, `refi-bcn-os` — org-os instances (top-level)
- `regen-coordination-os` — org-os instance (spec phase)
- `organizational-os` — legacy/reference framework
- `dao-os`, `coop-os`, `grants-os` — legacy module repos (reference only)
- `openclaw`, `openclaw-source` — separate project
- `koi-net`, `koi-net-integration` — separate project
- `becoming-constellations`, `ecosystem-canvas` — separate projects
- `bioregionalknowledgecommons` — separate project
- Infrastructure repos: `ReFi-DAO-Infrastructure-Migration`, `regen_eliza-refi_dao`

### Consolidation Plan

**Step 1: Verify repos.manifest.json is complete**
- [ ] refi-dao-os: ensure all ReFi DAO org repos are listed in `repos.manifest.json`
- [ ] refi-bcn-os: ensure all ReFi BCN repos are listed in `repos.manifest.json`
- [ ] Add any missing repos (e.g., `refi-vision-forum-posts`, `ReFi-DAO-Infrastructure-Migration`)

**Step 2: Clone all declared repos inside each org-os instance**
- [ ] Run `npm run sync:repos` in refi-dao-os — all repos from manifest cloned into `repos/`
- [ ] Run `npm run sync:repos` in refi-bcn-os — all repos from manifest cloned into `repos/`
- [ ] Verify no broken references or access blockers (e.g., quartz-refi-template access issue)

**Step 3: Remove standalone duplicates from `03 Libraries/`**
- [ ] For each repo now inside an org-os instance's `repos/`, remove the standalone copy from `03 Libraries/`
- [ ] Update any symlinks or references that pointed to the old standalone location
- [ ] Verify git submodule references (if any) still work

**Step 4: Verify no duplicates inside org-os instances**
- [ ] Check that no repo appears in both refi-dao-os/repos/ and refi-bcn-os/repos/ (unless intentionally shared)
- [ ] Verify `repos/` directories don't contain nested org-os instances (e.g., refi-bcn-os/repos/ should NOT contain refi-bcn-os itself — currently `projects/refi-bcn-os` exists, verify this is intentional)

**Step 5: Update indexes and references**
- [ ] Re-run `npm run index:changed` in both instances after consolidation
- [ ] Update ECOSYSTEM-MAP.md to reflect consolidated structure
- [ ] Update any docs that reference standalone repo paths

---

## Execution Priority

### Phase 1: Standards & Structure (Framework-first)
Execute A1, B1, C1, D1, E1 in org-os framework.
These define the standards all instances follow.
Also: Notion integration spec (CC3 framework tasks), repo consolidation manifest review (CC4 step 1).

### Phase 2: Instance Alignment (Parallel)
Execute A2+B2+C2+D2+E2 (refi-dao-os) and A3+B3+C3+D3+E3 (refi-bcn-os) in parallel.
Each instance aligns to the new standards and builds remaining packages.
**Includes per-instance:**
- refi-dao-os: Process ReFi Blog + Podcast into knowledge/, sync Notion DBs, project management audit
- refi-bcn-os: Process old knowledge base, sync Notion DBs, project management audit, Quartz frontend spec
- Both: Notion MCP configuration, sync:notion scripts

### Phase 2.5: Repo Consolidation
Execute CC4 steps 2-5:
- Clone all repos into org-os instances via repos.manifest.json
- Remove standalone duplicates from `03 Libraries/`
- Verify no duplicates within instances
- Re-index

### Phase 3: Specs for Future Instances
Execute A4+B4+C4+D4+E4 (regen-coordination-os spec) and A5+B5+C5+D5+E5 (regen-toolkit spec).
These are documents, not code — blueprints for when submodules are initialized.

### Phase 4: Integration & Verification
- Test federation exchange between refi-dao-os ↔ refi-bcn-os
- Verify all dashboards render correctly
- Run structure validation across all instances
- Verify Notion sync works bidirectionally
- Verify all standalone repos consolidated
- Update ECOSYSTEM-MAP.md with v2 state

---

## Verification Plan

### Per Instance
1. Run `npm run validate:structure` → all canonical files present
2. Run `npm run generate:schemas` → all `.well-known/` schemas generate
3. Run `npm run generate:dashboard` → dashboard.json has all sections
4. Start dashboard dev server → all 8 sections render
5. Open SYSTEM-CANVAS.canvas in Obsidian → accurate visualization
6. Run bootstrap-interviewer in a fresh workspace → generates initial files

### End-to-End
1. refi-dao-os publishes knowledge → refi-bcn-os receives via exchange protocol
2. Both dashboards show accurate, current data
3. ECOSYSTEM-MAP.md reflects all v2 packages, registries, and connections
4. A new org could fork the template and bootstrap using the 3-phase process

### Case Study: Idea Hatching
1. Knowledge-curator processes a blog post into `knowledge/`
2. Idea-scout identifies an ecosystem gap → creates entry in `data/ideas.yaml` with status `surfaced`
3. Ideation-board shows the idea; community champion moves it to `proposed` → `approved`
4. Hatching creates a new repo from template, pre-populated with relevant knowledge
5. Hatched repo's `federation.yaml` links back to parent org

### Case Study: Non-Tech Operator
1. Non-tech user opens dashboard URL in browser → sees org overview without any setup
2. Non-tech user opens ideation-board → can submit an idea via the web form
3. Non-tech user interacts with Telegram bot → asks "what are our active projects?" → gets answer from data/*.yaml
4. All three webapps deploy to GitHub Pages via `npm run deploy:pages`

---

## Critical Files

### Framework (org-os)
- `docs/FILE-STRUCTURE.md` — NEW: canonical directory spec
- `docs/DATA-MODEL.md` — NEW: complete data model (13 registries)
- `docs/AGENTIC-ARCHITECTURE.md` — NEW: agent files, bootstrapping, skills
- `docs/SKILL-SPECIFICATION.md` — NEW: skill authoring and sharing
- `docs/FEDERATION.md` — NEW: federation protocol spec
- `docs/AGENT-MODES.md` — NEW: agent personas pattern
- `docs/IDEA-HATCHING.md` — NEW: knowledge → ideas → hatched projects pipeline
- `docs/OPERATOR-GUIDE.md` — NEW: non-tech operator manual
- `docs/CHAT-INTERFACE.md` — NEW: Telegram/chat bot interface spec
- `docs/AUTORESEARCH.md` — NEW: autonomous improvement pattern
- `MASTERPLAN.md` — RENAME from MASTERPROMPT.md
- `CLAUDE.md` — NEW
- `skills/bootstrap-interviewer/SKILL.md` — NEW
- `skills/idea-scout/SKILL.md` — NEW: knowledge-to-ideas extraction
- `skills/workspace-improver/SKILL.md` — NEW: autoresearch loop
- `scripts/validate-structure.mjs` — NEW

### Instances (refi-dao-os, refi-bcn-os)
- `MASTERPLAN.md` — RENAME (dao-os) or verify (bcn-os)
- `data/events.yaml` — NEW
- `data/channels.yaml` — NEW
- `data/assets.yaml` — NEW
- `packages/dashboard/` — NEW (full React app)
- `federation.yaml` — UPDATE (add dashboard package)
- `package.json` — UPDATE (add generate:dashboard, sync:notion scripts)
- `scripts/sync-notion.mjs` — NEW: Notion ↔ YAML bidirectional sync
- `repos.manifest.json` — UPDATE (ensure complete)

### refi-dao-os specific
- `knowledge/podcast/` — NEW: processed ReFi Podcast episodes
- `knowledge/blog/` — NEW: processed ReFi Blog articles
- `docs/NOTION-WORKSPACE-MAP.md` — UPDATE (complete with DB IDs)

### refi-bcn-os specific
- `knowledge/` — NEW: processed old ReFi BCN knowledge base (cooperative-governance, local-economy, etc.)
- `docs/QUARTZ-FRONTEND-SPEC.md` — NEW: Quartz frontend scope document
- `projects/regenerant-catalunya/` — VERIFY: project data current

### Specs (regen-coordination-os, regen-toolkit)
- `SPEC.md` — NEW: complete instance specification document per repo
