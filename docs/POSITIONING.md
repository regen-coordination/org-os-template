# org-os — Positioning & Website Content

> Source material for the public site (`site/`) and documentation. Compiled 2026-07-15 from a full framework analysis + adversarially-verified landscape research (`docs/research/2026-07-15-agent-native-org-landscape.md`). Copy here is draft-quality for the website; adjust voice per `SOUL.md` (plain, direct, technically precise, no corporate speak).

---

## 1. Definition

### One-liner

**org-os is the operating system for organizations run by humans and AI agents together — a git-native workspace where your org's knowledge, data, and operations live as files any agent can read, act on, and federate.**

### Short (landing hero)

Fork a repo, answer six questions, and your organization has a brain: identity and values agents actually follow, structured data registries, session memory, 30+ operational skills, machine-readable schemas, and a federation protocol connecting you to a network of peer orgs. No SaaS, no lock-in — markdown, YAML, and git.

### Long (about page)

org-os is three things at once:

- **A template** — fork-in-hours starting point for a new organization (DAO, cooperative, nonprofit, local node, project). A guided six-question interview generates your identity files, data registries, and federation config.
- **A standard** — a canonical file structure, a 13-registry data model, and EIP-4824/DAOstar-compliant machine-readable schemas, so organizations stop reinventing the same shapes and can actually interoperate.
- **A live network hub** — the framework repo is itself a running org-os instance (self-hosting since 2026-04-24), coordinating a real federation of instances with drift monitoring, pull-based migrations, and a skill-promotion pipeline.

The core bet: the same file conventions that let coding agents work on codebases (AGENTS.md, SKILL.md, CLAUDE.md — now Linux Foundation / Anthropic / OpenAI standards) can run *organizations*. org-os extends that commodity layer with what no one else has built: a governed organizational data model, standards-compliant org schemas, and multi-org federation.

### What org-os is NOT (from SOUL.md)

Not a SaaS product · not a central authority · not a single org's internal tool · not a governance protocol ("we describe governance; we don't dictate it") · not finished.

---

## 2. Why unique — the four-layer thesis

Verified landscape finding (2026-07): **org-os is the only project combining all four layers.** Every peer covers at most one or two.

| Layer | org-os | Nearest peers |
|---|---|---|
| **Agent-native file workspace** — identity files, memory, skills | ✅ Rides the AGENTS.md + Agent Skills standards | OpenClaw (383k★), claude-chief-of-staff, LifeOS-OSS — all converged on the same conventions, all *personal*-scope |
| **Organizational scope** — models an org, not an individual | ✅ | Two 2-star markdown "CompanyOS" templates; 5dive (Linux-primitives, not file-based) |
| **Machine-readable org data** — 13 YAML registries + EIP-4824 `.well-known/` schemas | ✅ Only agent-native project implementing any org schema standard | None |
| **Multi-org federation** — hub/instance topology, trust levels, drift analysis, skill promotion | ✅ Running live across 7 instances | None (peers' "multi-agent" = single host) |

Supporting proof points for copy:

- The workspace conventions org-os chose were **independently validated** by OpenClaw (383k stars uses SOUL.md/AGENTS.md/TOOLS.md/memory), Obsidian's CEO (official vault-agent skills), and the Linux Foundation (AGENTS.md, 60k+ projects).
- org-os **extends EIP-4824** with operational URIs (meetings, projects, finances) — dogfooded even though the framework itself is "Framework, not a DAO."
- **It runs itself.** Every standard ships with a reference implementation and validators; the hub's own federation went from 27 drift items to 0 in the latest consolidation.
- **Vault-safe by design** — snapshot refs, file-loss audits, banned destructive git ops, operator trunks. Born from a real data-loss incident, codified into iron rules.
- **Autopoietic** — explicit self-improvement loops (modeled on karpathy/autoresearch): agents don't just operate the workspace, they improve it, and instance-proven patterns (≥2 instances) get promoted upstream.

---

## 3. Core concepts (documentation "Concepts" section)

1. **Agent identity files** — the org's brain at repo root: `MASTERPLAN.md` (strategy), `SOUL.md` (values/voice), `IDENTITY.md` (org identity), `USER.md` (operator), `AGENTS.md` (operating manual), `TOOLS.md` (config).
2. **Memory** — `MEMORY.md` (index) + `memory/YYYY-MM-DD.md` (daily logs, append-only) + `DECISIONS.md` (authoritative record) + `HEARTBEAT.md` (live pulse/tasks).
3. **Data registries** — `data/*.yaml`, single source of truth: members, projects, finances, governance, meetings, ideas (+7 optional: funding-opportunities, relationships, sources, knowledge-manifest, events, channels, assets).
4. **Schemas** — `.well-known/*.json` EIP-4824/DAOstar descriptors, auto-generated from registries, never hand-edited. Your org becomes machine-readable and discoverable.
5. **Skills** — portable agent capabilities as `skills/<name>/SKILL.md` (cross-vendor Agent Skills format). Three tiers: core / custom / shared; instance-proven skills get promoted to canonical.
6. **Sessions** — deterministic lifecycle: `/initialize` (sync, dashboard, plan) → work → `/close` (memory, commit, push). Plus `/commit`, `/sync`, `/handoff`, `/skills` for multi-operator flow.
7. **Federation** — `federation.yaml` declares identity, peers, trust levels (full/read/none), upstream/downstream. Git is the substrate; koi-net adds optional real-time sync. "Opt-in, additive, sovereignty-preserving."
8. **Plans & projects** — long-lived workstreams (`data/projects.yaml`) joined to short-lived execution plans (`docs/agent-plans/`, queued → active → completed).
9. **Autopoiesis** — the framework improves through use: HEARTBEAT metrics as evaluation, memory as experiment log, drift analysis + skill promotion as the upstream feedback loop.

---

## 4. Features (website features page, grouped)

### Run your org from files
- Fork-in-hours bootstrap: 6-question guided interview generates identity + registries + federation config (CLI or web form)
- Session dashboard: projects, tasks, calendar, funding pipeline, federation status — rendered from your data at `/initialize`
- Deterministic agent startup: 9-step context load so every session begins fully oriented
- Multi-runtime: same files work in Claude Code, Cursor, OpenCode, OpenClaw; host integrations for Hermes and opencode

### Organizational memory that compounds
- Daily logs, decision records, and an indexed long-term memory — append-only, git-versioned, greppable
- Meeting pipeline: transcript → structured record → registry updates → knowledge base
- Knowledge commons: compile, lint, index, and share knowledge across the federation (toolkit-framework: 22 schemas, 7 agentic skills, lift ETL)

### Machine-readable by standard
- EIP-4824/DAOstar `.well-known/` descriptors auto-generated from your data — extended with meetings, projects, finances, ideas, skills, knowledge
- 13-registry canonical data model with cross-references, validators, and semver'd schema versions
- `npm run selftest`: every promised failure mode caught by at least one trigger layer (manual / pre-commit / CI)

### 32 operational skills
- **Operations:** meeting processing, heartbeat monitoring, knowledge curation, funding scout, idea scout
- **Capital & governance:** treasury monitoring and transaction queueing (Gnosis Safe, Hats, Gardens), EIP-4824 schema generation
- **Research:** deep-research workflows with provenance, first-principles frameworks, autoresearch loops
- **Building:** skill creator (with evals), MCP builder, artifacts/frontend, Obsidian Canvas
- **Methodology:** the full superpowers suite — brainstorming, planning, TDD, debugging, code review, worktrees

### Federation, not silos
- Hub/instance topology with per-peer trust levels; every instance publishes standard schemas
- Pull-based migrations — the framework never breaks downstream; instances sync when ready
- Drift analysis across all instances (`analyze:instances`), lineage stamps, divergence checks
- Skill & package promotion: patterns proven in ≥2 instances become framework-canonical

### Safe for real work
- Vault-safety: snapshot refs before risky ops, file-loss audits, hard bans on `stash`/`clean`/`reset --hard`
- Operator trunks: each collaborator commits to their own branch, PRs to main — git-unfamiliar users can't lose work
- Draft-and-present default: agents never send, publish, or spend without operator approval
- Two-tier autonomy matrix: agents may edit data/knowledge/memory/skills; never SOUL/IDENTITY/federation without approval

---

## 5. Modules (aligns with `site/src/data/modules.yaml`)

**Core framework (live):**
| Module | What it provides |
|---|---|
| Session lifecycle | `/initialize` → `/close` + dashboard + memory protocol |
| Data model & schemas | 13 registries, EIP-4824 generation, validators, selftest |
| Skills system | 32 skills, promotion pipeline, cross-vendor SKILL.md format |
| Federation protocol | federation.yaml, hub/instance sync, drift analysis, migrations |
| Bootstrap engine | interview + cloning engine (8-stage), acceptance-tested end-to-end |
| Vault safety | snapshots, audits, operator trunks, recovery runbook |

**v0.5 constellation (from modules.yaml):**
- **Website Generator** *(in-dev)* — any instance's data + docs → federated public site (the org-os site is its first output)
- **KMS / org-os-kms** *(installed, maturing)* — toolkit-framework knowledge commons bound into org-os as a swappable module
- **rad-org-os** *(in-dev)* — Radicle-native sovereign p2p infra for grassroots orgs
- **Hermes Agent** *(in-dev)* — local runtime + Telegram gateway (replacing OpenClaw)
- **Members Hub** *(planned)* — membership, roles, contribution surfaces
- **Ideation System** *(planned)* — idea capture → triage → hatching pipeline, federated

**Bridges & integrations:** KOI-net (distributed knowledge graphs), OPAL (AI knowledge gardens), Notion, Telegram, GitHub, Obsidian/Canvas, Gnosis Safe + Hats + Gardens, opencode/Hermes hosts.

---

## 6. Use cases (website use-cases page)

### By organization type
- **DAO / web3 collective** — EIP-4824-compliant out of the box; treasury ops via capital-flow; governance registry tracking Safe/Hats/Gardens/Snapshot infra. *Live example: refi-dao-os.*
- **Local node / chapter** — light-weight instance federating with a global org; local meetings, funding scout, shared knowledge commons. *Live: refi-bcn-os (production), refi-med-os.*
- **Cooperative / nonprofit** — no on-chain requirement; same memory, meetings, funding pipeline, and operator ladder. *Acceptance-tested: bread-coop-os.*
- **Network-of-networks hub** — aggregate instances, monitor drift, coordinate a federation from one dashboard. *Live: regen-coordination-os + the org-os hub itself.*
- **Personal hub** — an individual's Obsidian vault as the hub node federating their org instances. *Live: lf-zettelkasten-os.*

### By moment
- **"We keep losing knowledge between tools."** → registries + memory + meeting pipeline: every decision, meeting, and idea lands in versioned files agents can query.
- **"We want an AI chief of staff for the org, not just for me."** → the personal-OS pattern (validated at 383k stars by OpenClaw) applied to organizational scope.
- **"We're starting a new org this month."** → fork, 6 questions, first session in hours — with governance-upgrade path documented (solo → OSS → DAO evolution triggers).
- **"Our network of orgs can't see each other."** → federation: publish schemas, subscribe to peers, share skills, keep sovereignty.
- **"Non-technical members need in."** → 5-level operator ladder: chat → browser dashboard → guided setup → CLI → direct editing.

### By operator
- **Founders/coordinators** — session dashboard, heartbeat, plans queue
- **Facilitators** — meeting processor, transcription fixer, decision records
- **Treasurers** — capital-flow, finances registry, funding scout
- **Researchers/curators** — research skill, knowledge commons, idea hatching
- **Developers** — skills/packages, superpowers methodology, MCP builder

---

## 7. Comparison copy (website "why org-os" section)

> Short, non-disparaging framing per SOUL voice; all claims verified 2026-07-15.

- **vs. personal agent OSes (OpenClaw, claude-chief-of-staff, LifeOS):** they run *you*; org-os runs *your organization* — same proven file conventions, plus an org data model, schemas, and federation. (And they compose: org-os federates with agent runtimes like OpenClaw/Hermes.)
- **vs. "company as code" templates (CompanyOS ×2):** templates give you prose; org-os gives you a running system — structured data, validators, live dashboard, memory, and a real federation operating since April 2026.
- **vs. runtime orchestration (5dive):** they provision agent *workers* on a box; org-os provides the organizational *substrate* — knowledge, data, standards — any runtime's agents operate on.
- **vs. DAO tooling (DAOstar ecosystem):** org-os is a full operational implementation of the standard, extended to day-to-day ops (meetings, projects, finances) — not just an on-chain endpoint.
- **vs. knowledge tools (Obsidian + agent skills):** Obsidian's official skills teach agents the *file formats*; org-os supplies the *operational layer* on top — and works inside a vault natively.

**Tagline candidates:**
- *The operating system for organizations run by humans and AI agents together.*
- *Your organization, machine-readable. Your agents, organizationally literate.*
- *Fork an org. Federate a network.*
- *Files in, organization out.*

---

## 8. Numbers box (for the site, as of v0.5.0, 2026-07-15)

32 skills · 13 packages · 13 canonical registries (+3 hub-only) · 11 EIP-4824 descriptors · 6 slash commands · 40 npm scripts · 7 federation instances · drift 27→0 · self-hosting since 2026-04-24 · 100/100 toolkit-framework tests green

---

## 9. Honest-positioning notes (do not publish, keep for strategy)

- Layers 3–4 (schemas, federation) have **no competitive pressure but also no external demand validation** — website should *demonstrate* value (live federation graph, real instances) rather than assert it.
- The commodity workspace layer converges fast; a big player could move up-stack. Moat = standards compliance + live network + promotion pipeline, not the file format.
- claude-chief-of-staff's traction (~419★ in weeks) shows demand concentrates on **operator experience** — prioritize the non-tech ladder, dashboard, and Hermes/Telegram surfaces in marketing.
- v0.5 versioning ("pre-beta by design, renumbered from 3.5") is an honesty signal worth telling as a story — differentiates from vaporware.
