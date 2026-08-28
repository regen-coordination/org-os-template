# BOOTSTRAP.md — First-Run Onboarding

_Run this when deploying org-os for a new organization. Bootstrapping has three phases: identity capture, source ingestion, and ongoing learning. After Phase 1 completes, this file can be archived._

> **There is one recommended setup path:** the cloning engine (`npm run clone:framework`), below. It is non-interactive, config-driven, agent-friendly, and produces a fresh instance in a **sibling directory** with your identity and a lineage stamp — the framework repo is a *generator*, not the thing you edit in place. If you are driving it with an AI agent (Claude Code, Cursor, a ChatGPT connector), follow [`docs/ADOPT-WITH-AN-AGENT.md`](docs/ADOPT-WITH-AN-AGENT.md) — the same path, as a copy-paste recipe.
>
> The only alternative is `npm run setup` — an **in-place, interactive-terminal-only** wizard (it cannot be driven by an agent or any non-TTY shell, and in a clone of this repo it edits around the maintainer's live content rather than replacing it — see the 2026-08-21 clean-room findings). Its real prompts, in order: org type · org name · description · base URL · operational packages (multiselect) · agent runtime · federation network · emoji · Notion integration. It does **not** ask about team, projects, communication channels, or data sources — those are Phase 1 work after either path.

> **Note:** The org-os repo itself is bootstrapped as of 2026-04-24. See `memory/2026-04-24.md` for the self-hosting inauguration notes. New instances (downstream of this framework) run the phases below.

> **⚠️ Workspace Safety:** Before any destructive git operation (merge, rebase, pull, reset, checkout across branches, clean, stash), run `npm run vault:snapshot -- "<reason>"`. Never use `git stash` in a workspace with precious untracked content. See [docs/VAULT-SAFETY.md](docs/VAULT-SAFETY.md) for the full protocol and recovery runbook.

---

## Quick Path: Cloning Engine (v3.5+)

For most new instances, prefer the cloning engine over the manual phases below. It's faster, idempotent, and produces a structurally-valid instance with a lineage stamp pointing back to this framework.

```bash
# 1. Write a config file describing the new org
cat > /tmp/my-org-config.yaml <<'YAML'
org:
  name: "my-new-org"
  type: "Cooperative"            # or DAO, LocalNode, Hub, Project
  short_description: "What this org does in one sentence."
  emoji: "🌱"
operator:
  name: "Your Name"
  email: "you@example.com"
network:
  name: "regen-coordination"     # or whichever federation network
packages:
  operations: true               # which framework packages to materialize
skills:
  - bootstrap-interviewer        # which skills to include
  - org-os-init
  - heartbeat-monitor
  - knowledge-curator
YAML

# 2. Clone into a sibling directory
npm run clone:framework -- --target ../my-new-org --config /tmp/my-org-config.yaml

# 3. Bootstrap-interviewer fills in remaining identity (Phase 1 below)
cd ../my-new-org
npm install
npm run validate:structure
npm run selftest
```

The reference acceptance-test instance bootstrapped this way is `bread-coop-os` (see `data/instances.yaml`). Its config lives at `tests/fixtures/bread-coop-config.yaml`.

After cloning, the manual phases below still apply for filling in identity, ingesting sources, and ongoing learning — but the file scaffolding, package selection, federation lineage, and reset placeholders are done for you.

---

## Phase 1: Identity Capture

The cloning engine scaffolds the files; Phase 1 fills them with your org's reality. This is **agent-led conversation, not a script**: open a session in the new instance with any agent runtime and use the `bootstrap-interviewer` skill, which walks these six topics and writes the files as you answer. (No `npm` command runs this phase — the six topics below are what the *skill* covers, not what `npm run setup` asks; that wizard's nine prompts are listed at the top of this file and cover only the first and fifth topics.)

### For New Workspaces (Empty Instance)

1. **Organization identity** — name, type, mission, values
   → Fills: `SOUL.md`, `IDENTITY.md` (the clone seeds name/type; this pass adds the substance)

2. **Team** — core members, roles, contact info
   → Generates: `data/members.yaml`

3. **Projects** — active initiatives, status, leads
   → Generates: `data/projects.yaml`

4. **Communication** — channels, platforms, purposes
   → Generates: `data/channels.yaml`

5. **Network** — federation membership, peers
   → Reviews: `federation.yaml` (the clone wrote identity + lineage; this pass confirms peers/trust)

6. **Data sources** — Notion, GitHub repos, websites, docs
   → Populates: `TOOLS.md`, `data/sources.yaml`

The interview runs wherever your agent does — Claude Code, Cursor, OpenCode. There is no web form today (`docs/OPERATOR-GUIDE.md` Level 2 describes the agent-guided equivalent).

### For Existing Workspaces (Agent Joining)

If the workspace already has files, skip the interview and run the standard onboarding:

- [ ] Read `MASTERPLAN.md` — understand mandate and activations
- [ ] Read `SOUL.md` — internalize values and voice
- [ ] Read `IDENTITY.md` — note org identity, governance, addresses
- [ ] Read `USER.md` — understand the operator
- [ ] Read `MEMORY.md` — check key decisions
- [ ] Read `memory/` (last 3-7 days) — recent context
- [ ] Read `HEARTBEAT.md` — identify urgent tasks
- [ ] Read `TOOLS.md` — available integrations
- [ ] Read `federation.yaml` — network relationships
- [ ] Run `npm run validate:schemas` — check system health
- [ ] Create `memory/YYYY-MM-DD.md` with initialization note
- [ ] Present summary to operator

---

## Phase 2: Source Ingestion

After the workspace has basic files, point the agent at existing knowledge sources:

### GitHub Repositories
```bash
# Add repos to repos.manifest.json, then:
npm run clone:repos
npm run index:repos
```
→ Populates: `repos/`, `data/sources.yaml`

### Website / Blog
Use the `knowledge-curator` skill to process articles:
→ Populates: `knowledge/[domain]/`, `data/sources.yaml`

### Podcast Episodes
Use the `knowledge-curator` skill to process episodes:
→ Populates: `knowledge/podcast/`, `data/sources.yaml`

### Notion Databases
Configure Notion MCP (see `docs/TOOL-SETUP.md`), then:
```bash
npm run sync:notion
```
→ Syncs: `data/*.yaml` ↔ Notion databases

### Documents
Process documents into appropriate locations:
- Proposals, governance docs → `docs/`
- Knowledge content → `knowledge/`
- Meeting transcripts → `data/meetings.yaml` via `meeting-processor` skill

### Generate Schemas
After ingesting sources:
```bash
npm run generate:schemas
npm run validate:schemas
```

---

## Phase 3: Ongoing Learning

After initial setup and ingestion, the workspace enters continuous improvement:

- **Meeting processing** → Builds operational memory, extracts action items
- **Heartbeat monitoring** → Tracks priorities, surfaces blocked tasks
- **Knowledge curation** → Expands knowledge commons from new content
- **Idea scouting** → Surfaces ecosystem gaps from knowledge analysis
- **Workspace improvement** → Autonomous autoresearch loop (see `docs/AUTORESEARCH.md`)
- **Feedback loop** → Agent behavior improves based on operator corrections

The `workspace-improver` skill manages the autonomous improvement cycle. See `skills/workspace-improver/SKILL.md`.

---

## Post-Bootstrap

Once Phase 1 is complete:
- Archive this file: `mv BOOTSTRAP.md docs/bootstrap-completed-YYYY-MM-DD.md`
- Future sessions use the standard startup sequence in `AGENTS.md`
- Log "Bootstrap complete" in `memory/YYYY-MM-DD.md`
- Begin Phase 2 source ingestion when ready

---

_Bootstrap is a one-time ritual for Phase 1. Phases 2 and 3 are ongoing. The standard session startup (AGENTS.md) handles all subsequent sessions._
