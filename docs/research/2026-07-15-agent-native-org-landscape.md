# Landscape: Agent-Native Organizational Operating Systems (2024–2026)

> **Research brief** — Where does org-os sit among similar/aligned projects emerging from the coding-agent boom?
> **Method:** Deep-research harness — 5 parallel search angles, 15 primary sources fetched, every extracted claim adversarially verified by 3 independent agents (2/3 refutes kill a claim). 104 agents, 10 findings survived (9 high-confidence, 1 medium).
> **Date:** 2026-07-15 · **Operator:** Luiz Fernando · **Provenance:** workflow `wf_7a497e74-1c7`, session `432471d5`

## Executive summary

The 2024–2026 coding-agent boom produced a crowded field of file-based "AI-run" operating systems, but **org-os occupies an intersection no verified peer replicates**. Direct "company as code" competitors exist but are weeks old with ~2 stars each and lack data registries, schemas, and federation. The personal-OS category (OpenClaw at 383k stars) has independently converged on org-os's exact file conventions — validating the pattern — while remaining single-user in scope. The conventions org-os builds on (AGENTS.md, SKILL.md) are now multi-vendor standards backed by the Linux Foundation, Anthropic, OpenAI, and Obsidian's CEO. **org-os is the only verified project that is simultaneously an agent workspace, a governed organizational data model, a schema-compliant DAO endpoint, and a multi-org federation protocol.**

## The four-layer landscape map

| Layer | What it is | Competitive status |
|---|---|---|
| **1. Agent-native file workspace** | CLAUDE.md/AGENTS.md/SOUL.md/SKILL.md/memory files | **Commodity.** Shared with OpenClaw, LifeOS-OSS, claude-chief-of-staff, both CompanyOS projects; standardized by AGENTS.md (Linux Foundation) + Agent Skills (Anthropic/OpenAI/OpenCode) |
| **2. Organizational (not personal) scope** | The workspace models an org, not an individual | **Near-empty.** Only two near-zero-traction markdown-only CompanyOS projects + 5dive (runtime-primitives, not file-based) |
| **3. Machine-readable org schemas + data registries** | EIP-4824/DAOstar `.well-known/` + 13 canonical YAML registries | **Uncontested.** No surveyed peer has either |
| **4. Multi-org federation with personal hub node** | federation.yaml, hub/instance topology, drift analysis, skill promotion | **Unique to org-os.** Peers' "multi-agent" is single-host, not multi-organization |

**Strategic read:** the commodity layers are converging fast (good — org-os rides standards it didn't have to create); the differentiating layers have no visible competitive pressure — which also means no external validation of demand yet.

## Project profiles

### (a) "Company as code" / agent-native org frameworks

**tomevault-io/companyos** — Closest "company as code" peer. MIT, ~2,000 lines of markdown, 13 universal skills, AGENTS.md-loaded-at-start with CLAUDE.md alias; tool-portable (Claude Code, Cursor, Copilot). Near-zero traction (2 stars, 8 commits, created 2026-04-30). **Lacks:** YAML registries, EIP-4824 schemas, memory layer, federation. *(high confidence — [repo](https://github.com/tomevault-io/companyos))*

**rojenwai/CompanyOS** — Unrelated project, same name; the most maximalist "org as repo" analogue. MIT; `handbook/` (20 department manuals) + `ai/` side with **107 standardized agent specs** (11-section template) and a **14-type agent-memory system** — directly overlapping org-os's memory/skills conventions. Extremely new: created 2026-07-03, 2 stars, 0 forks, pseudonymous author. Markdown specs + Python validation, not executable code. *(high — [repo](https://github.com/rojenwai/CompanyOS))*

**5dive (5dive-ai/5dive)** — The architectural counterpoint: "run a company of AI agents on a server you own." Each agent is a Linux user running an official coding CLI under systemd; coordination = shared bash CLI as message bus + SQLite task queue + journald. Ships org charts (`5dive org set/tree`), character packs, team templates, Telegram/Discord escalation. Actively maintained (v0.9.13 on 2026-07-15, 161 releases), ~21 stars. **OS-primitives state instead of git+markdown; no schemas.** *(high — [repo](https://github.com/5dive-ai/5dive))*

### (b) AI chief-of-staff / personal-OS

**claude-chief-of-staff (mimurchison)** — ~419 stars, MIT, by Mike Murchison (CEO of Ada). "Personal AI operating system built on Claude Code": CLAUDE.md core, `goals.yaml`/`my-tasks.yaml`/`schedules.yaml`, markdown contact profiles, `commands/`. Same file-based source-of-truth pattern as org-os but scoped to individual executive productivity (inbox triage, `/gm` briefings, 160+-contact personal CRM auto-enriched via MCPs). No org structure, schemas, or federation. *(high — [repo](https://github.com/mimurchison/claude-chief-of-staff))*

**LifeOS-OSS (kcwoodfield)** — 15 stars, v1.1.0 Oct 2025. Closest match to org-os's specific **Obsidian + Claude Code + Git** stack: CLAUDE.md system guide, `.claude/` skills, git hooks, and a "Cabinet" of 14 executive-persona agents as markdown files — a persona-based analogue applied to an individual's life. No org/DAO layer. *(high — [repo](https://github.com/kcwoodfield/LifeOS-OSS))*

### (c) File conventions & ecosystems

**OpenClaw** — 383k stars, MIT, Peter Steinberger. Dominant personal-agent OS and the strongest convention-level convergence: its workspace injects **the same identity files org-os uses** — AGENTS.md, SOUL.md, TOOLS.md (guides even show IDENTITY.md, USER.md, HEARTBEAT.md, `memory/` under git) — with per-skill `SKILL.md` folders. Adds what org-os lacks at scale: 20+ messaging channels and the ClawHub registry (5,400+ skills, VirusTotal-scanned). **Explicitly personal, not organizational.** Note: org-os already registers an openclaw container as a federation AgentRuntime, and Hermes (in-dev) is positioned as its replacement. *(high — [repo](https://github.com/openclaw/openclaw), [workspace docs](https://docs.openclaw.ai/concepts/agent-workspace))*

**AGENTS.md + Agent Skills standards** — The conventions org-os builds on institutionalized in 2025–2026: AGENTS.md (from OpenAI Codex, Amp, Jules, Cursor, Factory; donated to Linux Foundation's Agentic AI Foundation Dec 2025; 60k+ projects, ~150k files on GitHub vs ~45k CLAUDE.md) and the Agent Skills spec (agentskills.io, Anthropic Dec 2025; adopted by Claude Code, OpenAI Codex, OpenCode). **org-os's ~30 skills ride a cross-vendor standard.** *(high — [agents.md](https://agents.md/), [agentskills.io](https://agentskills.io/specification))*

### (d) DAO tooling with machine-readable org data

**ERC-4824 / DAOstar** — org-os's standards lineage. The EIP defines a `daoURI` returning JSON-LD with membersURI/proposalsURI/activityLogURI/contractsURI. org-os's `.well-known/dao.json` uses the daostar.org context, includes all four standard URIs, and **extends** the standard (meetingsURI, projectsURI, financesURI + ideas/skills/knowledge registries). **No other surveyed agent-native project implements any machine-readable org schema.** *(high — [EIP-4824](https://eips.ethereum.org/EIPS/eip-4824), local `.well-known/dao.json`, `docs/EIP4824-GUIDE.md`)*

### (e) Obsidian / knowledge-vault + agent overlays

**kepano/obsidian-skills** — ~42k stars, June 2026, authored by Steph Ango (Obsidian CEO). Five Agent Skills teaching agents Obsidian's file formats (markdown, bases, JSON Canvas, CLI, defuddle), installed into `/.claude` at vault root, targeting Claude Code/Codex/OpenCode. **Obsidian has effectively endorsed the vault-plus-agent pattern org-os uses.** Scope is file-format literacy only — org-os's operational overlay is uncontested here. *(high — [repo](https://github.com/kepano/obsidian-skills))*

### (f) Multi-agent org simulation/ops

No verified 2024–2026 successor to Generative Agents/AutoGen-style org structures overlaps org-os's file-based organizational model; the closest operational analogues are 5dive's team templates and OpenClaw's multi-agent routing — both single-host multi-agent, not multi-organization.

## What differentiates org-os (verified against every peer)

1. **Organizational data model** — 13 canonical YAML registries + 3 framework-only registries, with cross-references and validators. No peer has structured org data.
2. **Standards compliance** — the only agent-native project emitting EIP-4824/DAOstar machine-readable descriptors, extended for operational data.
3. **Federation** — hub/instance topology, trust levels, pull-based migrations, drift analysis, ≥2-instance skill promotion. Peers stop at single host.
4. **Convention alignment** — its workspace layer matches what OpenClaw (383k★), Obsidian's CEO, and the Linux Foundation standardized independently — org-os rides the standards rather than fighting them.
5. **Live proof** — self-hosting since 2026-04-24, operating a real 7-instance federation (drift 27→0), vs. peers' 2-star templates.

## Risks / honest caveats

- **Layers 3–4 are unvalidated externally** — no competition also means no demonstrated demand; the website/docs should make the case, not assume it.
- **Layer 1 commoditization** cuts both ways: easy for a big player (OpenClaw org mode? Obsidian teams + agents?) to move up-stack.
- **claude-chief-of-staff (419★) shows the demand shape** — people want the *operator experience*; org-os's non-tech operator ladder is the right bet.

## Sources

All claims 3-vote adversarially verified against primary sources (GitHub repos/APIs, official docs, EIP text). One refuted claim (tomevault companyos "constitutional documents" governance) was excluded. Full verification journal: workflow `wf_7a497e74-1c7`.
