# 05 — Metabolism

_Aspect: instance-level primary, framework-level secondary._

What flows through an org-os instance: **sources → registries → memory → synthesis → output**. The mechanism is concrete: which file is written by whom, in what order, triggered by what. "Metabolism" is the metaphor; the substance is a chain of file edits with explicit handoffs and a few load-bearing scripts.

## Mechanism (step by step)

End-to-end ingestion-to-output trail in this codebase:

1. **Source declared.** A new source is registered in `data/sources.yaml` (currently empty stub at `/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os/data/sources.yaml` — only an example commented out) or a repo is added to `repos.manifest.json` (9 entries) and pulled by `scripts/clone-linked-repos.mjs` into `repos/`. The source can be a Telegram channel, GitHub repo, blog feed, podcast, or — most commonly used today — a meeting transcript pasted into chat.

2. **Ingest skill catches it.** Three skills handle ingestion based on type:
   - `skills/meeting-processor/SKILL.md` consumes raw transcripts → emits `packages/operations/meetings/YYMMDD <title>.md` (canonical v2 path).
   - `skills/knowledge-curator/SKILL.md` consumes channel/repo/blog content → emits `knowledge/<domain>/YYYY-MM-DD-curation.md`.
   - `skills/idea-scout/SKILL.md` consumes already-curated `knowledge/` → emits `data/ideas.yaml` entries + `ideas/[slug].md`.

3. **Registry catches it.** Skills write into the canonical 13-registry surface in `data/*.yaml`. From the directory: `assets`, `channels`, `events`, `finances`, `funding-opportunities`, `governance`, `ideas`, `instances`, `knowledge-manifest`, `meetings`, `members`, `packages-matrix`, `projects`, `relationships`, `skills-matrix`, `sources`. Skill→registry mapping is explicit in each `SKILL.md` `outputs:` block.

4. **Memory entry written.** Every skill's "Step N: Update Memory" appends to `memory/YYYY-MM-DD.md` (daily logs, append-only — see `meeting-processor` Step 4, `idea-scout` Step 5, `workspace-improver` Step 7). The daily log is the **execution log**: what was done this session, what changed, what regressed. The memory directory currently has 3 dated files (`2026-04-24.md`, `2026-04-25.md`, `2026-04-29.md`) plus `README.md` and `reports/`.

5. **Synthesis into decisions.** When a memory entry contains a load-bearing decision (not just an action log), the operator promotes it to `DECISIONS.md` (root, append-only chronological, most-recent-first, 11 entries as of 2026-05-02). `MEMORY.md` is **not** the decision record — it is an index pointing at `DECISIONS.md` and the recent `memory/` dailies. The 2026-04-24 entry "Projects-vs-plans separation" makes the dual structure explicit: workstreams in `data/projects.yaml`, plans in `docs/agent-plans/` with `workstream:` frontmatter linking back. Memory promotes to decision; decision references registry.

6. **Active layer updated.** Action items extracted in step 2 land in `HEARTBEAT.md` (root, currently 88 lines, sectioned: Active Tasks → Technical/Orchestration/Funding/Governance/Operations, then System Health, then Recently Completed). This is the **digestive layer** — items enter from meetings/decisions/scans, sit pending, then either get checked off (moved to "Recently Completed", retained 30 days) or removed when stale. `scripts/initialize.mjs` line 286–324 (`loadTasks`) parses checkbox state and `(due: YYYY-MM-DD)` markers into `critical/urgent/upcoming/completed` buckets for the dashboard.

7. **Plans pipeline.** Bigger digests don't fit in HEARTBEAT — they become plans in `docs/agent-plans/*.md` with frontmatter `status: scoping → queued → active → completed` (per the 2026-04-06 decision). 16 plan files exist. `QUEUE.md` indexes state. This is metabolism's **slow track** — multi-session work that needs more than a checkbox.

8. **Excretion: schemas.** When `data/*.yaml` changes, the operator runs `npm run generate:schemas` (mapped to `scripts/generate-all-schemas.mjs`). The script reads 7 yaml registries + meeting markdown, emits 9 JSON files into `.well-known/`: `members.json`, `meetings.json`, `projects.json`, `finances.json`, `proposals.json`, `activities.json`, `contracts.json`, `ideas.json`, `knowledge.json`. These are the EIP-4824 compliant external surface — what other federation peers consume.

9. **Excretion: dashboard.** `npm run initialize` runs `scripts/initialize.mjs` which reads identity files, registries, HEARTBEAT, memory, federation, git status, and emits either JSON (default, for the agent) or rendered markdown (`--format=markdown`, for the human). 13 `load*` functions, one per data source. This is metabolism's **introspective output**: the system showing itself to itself.

10. **Excretion: publications/PRs.** Per `docs/AGENTIC-ARCHITECTURE.md` Safety Policy, anything external (Telegram messages, GitHub PRs, on-chain transactions) is **draft-and-present** — the agent prepares output, the human approves, then it leaves the cell.

**Where the loop closes:** meeting transcript → meeting note in `packages/operations/meetings/` → action items in `HEARTBEAT.md` → memory entry → (if material) decision in `DECISIONS.md` → registry update if it touches data → `npm run generate:schemas` → `.well-known/*.json` ready for federation peers. That's a complete digestion cycle.

**Where the loop breaks (in this codebase, today):**
- **Sources stub.** `data/sources.yaml` and `data/knowledge-manifest.yaml` are both empty placeholders. The framework instance has no actual external sources registered, so the `idea-scout → knowledge → ideas` track has no fuel here. (The 8 entries in `data/ideas.yaml` were seeded from `MASTERPLAN.md §4` and a manual cross-instance scan — not from knowledge processing.)
- **`knowledge/` is reference, not operational.** `knowledge/INDEX.md` explicitly says "this is a framework/template knowledge commons — reference material rather than operational content." So at the framework layer, the curator → ideas pipeline is gestured rather than running. This is fine by design but means the framework instance's metabolism tests differently than a downstream node's.
- **Schema regeneration is manual.** `HEARTBEAT.md` line 20 is literally a standing reminder: "Run `npm run generate:schemas` after any `data/` edit". No git hook, no file watcher. If forgotten, `.well-known/` drifts from `data/` silently. The 2026-04-29 memory notes that `validate:schemas` itself is broken in the framework `package.json` (references missing `scripts/validate-identity.mjs`) — quality control on excretion is currently degraded.
- **`dao.json` is hand-written.** Per 2026-04-29 memory: "Hand-wrote `.well-known/dao.json` (the schema generator reads but doesn't create it)." So the headline schema entry-point is outside the auto-generation pipeline. The framework `.well-known/` listing confirms `dao.json.template` exists, but no `dao.json` — only the template. Excretion of identity is a one-off manual emission.
- **Memory bloat without synthesis.** Nothing forces a daily memory entry to graduate to `DECISIONS.md`. The promotion is operator judgment. Some decisions logged in dailies (e.g., the multi-session 2026-04-25 brainstorming) made it to `DECISIONS.md`; others may not.

## Prior art

1. **Biology — digestion.** Ingestion (mouth) → catalysis (stomach/intestine) → distribution (bloodstream) → excretion (kidney/colon). Maps cleanly: sources → registries → schemas → external surface. The "what doesn't get digested gets excreted" rule has no analog here — undigested sources just sit in HEARTBEAT or memory until manually removed.

2. **Beer's Viable System Model — System 3 (operations) + System 4 (intelligence).** S3 = current operations (HEARTBEAT, projects, meetings). S4 = scanning the environment (knowledge-curator, idea-scout, sources). org-os has both layers but the S3↔S4 link is weak: S4's surface (`knowledge/`, `data/ideas.yaml`) is mostly disconnected from S3's HEARTBEAT in this instance.

3. **RAG pipelines (retrieval → synthesis → emission).** Same shape: chunked sources → embedded/indexed → LLM synthesis → output. The org-os version is markdown-and-yaml-flavored RAG with the agent as both retriever and synthesizer. Difference: org-os has explicit operator-approved promotion gates (memory→decision, scoping→queued→active) which RAG systems usually lack.

4. **Karpathy's autoresearch (`docs/AUTORESEARCH.md`).** The framework explicitly maps itself: `MASTERPLAN.md = program.md`, `data/+skills/+knowledge/ = train.py`, `HEARTBEAT.md metrics = val_bpb`, `memory/YYYY-MM-DD.md = experiment log`. This is the framework's self-description as a metabolic loop with measurable evaluation. `skills/workspace-improver/SKILL.md` operationalizes it as a 7-step procedure.

5. **Data pipelines (ETL).** Extract (skills read sources) → transform (synthesis into yaml/md) → load (`.well-known/` for downstream peers, dashboard for operator). The unusual feature is that org-os's "transform" step is human-and-agent, not pure code — synthesis lives in skill prose, not in deterministic functions.

## Invariants / failure modes

**What CLOSES the loop:**
- Source → meeting note → memory entry → HEARTBEAT update → action completed → marked done. This is the canonical happy path; `meeting-processor` Steps 1–6 enforce it.
- Source → curation → ideas surfaced → idea promoted to project → project executes → memory log. Slower track, runs through `idea-scout` → `data/ideas.yaml` → manual promotion to `data/projects.yaml`.
- Data edit → `npm run generate:schemas` → `.well-known/*.json` regenerated → federation peers can fetch fresh state.
- Memory entry → operator promotes to `DECISIONS.md` → decision becomes referenceable rationale for future agent sessions.

**What BREAKS it:**
- **Source ingested, never synthesized.** A meeting note filed without action items extracted, or a knowledge curation without an `idea-scout` pass — content sits in `knowledge/` or `packages/operations/meetings/` but never feeds HEARTBEAT or ideas. Memory bloat.
- **Decision logged but not applied.** A `DECISIONS.md` entry that says "registries X, Y, Z added" without the actual yaml file changes → schema drift.
- **Registry updated, `.well-known/` stale.** The HEARTBEAT reminder "Run `npm run generate:schemas` after any `data/` edit" exists because this fails routinely. External peers fetch outdated JSON. No automated trigger.
- **`HEARTBEAT.md` bloat.** Items added but never closed; "Recently Completed" section grows past its 30-day retention. The skill is small and the file is short today (88 lines), but at scale this is the obvious failure mode — heartbeat-monitor's note "Delete stale tasks ruthlessly: a bloated HEARTBEAT is useless" is the explicit defense.
- **Plans abandoned in `scoping`/`queued`.** 10 of the 11 active tasks in `HEARTBEAT.md` are queued plans; only multica-integration is fully written and deferred. Plans that never activate are metabolism's equivalent of fat storage — eventually they're either spent or excised.
- **Validation degraded.** The 2026-04-29 memory notes `validate:schemas` is broken in the framework. When the quality-control step on excretion fails silently, the loop runs but emits low-quality output.
- **Manual `dao.json`.** Identity excretion is outside the pipeline. If `IDENTITY.md` changes, nothing regenerates `.well-known/dao.json`. The 2026-04-29 hand-write was a one-shot.
- **Daily memory not promoted.** The relationship between `memory/YYYY-MM-DD.md` (write often) and `DECISIONS.md` (promote rarely) is operator-judgment. No skill enforces "if a session decided something material, promote to DECISIONS." Knowledge of why-things-are stays trapped in the daily log.

## Open questions

1. **Where is the synthesis trigger today — manual, scheduled, or event-driven?** Reading the skills, every loop step is "agent-invoked when operator says so" or `/initialize`/`/close` boundaries. There is no cron, no file-watcher, no GitHub Action mentioned for ingestion. `heartbeat-monitor` references `federation.yaml heartbeat_interval` but the framework `federation.yaml` may or may not set it. Worth confirming if any genuinely autonomous metabolism runs today.

2. **What's the formal relationship between `memory/YYYY-MM-DD.md`, `MEMORY.md`, and `DECISIONS.md`?** `MEMORY.md` says "→ See `DECISIONS.md` for the authoritative chronological log; this file (MEMORY.md) is the index over org memory." Three files, one decision is "where do agents look first on session boot?" Per `BOOTSTRAP.md` startup sequence: MEMORY.md (5), then memory/*.md (6). DECISIONS.md isn't in the 9-step boot sequence in `docs/AGENTIC-ARCHITECTURE.md` — but it is in `MEMORY.md`'s redirect. Implicit assumption: agent reads MEMORY.md, follows pointer to DECISIONS.md as needed.

3. **Is autoresearch a metabolism component or a cognition component?** `skills/workspace-improver/SKILL.md` is framed as autoresearch — but its 7 steps are exactly the metabolic loop (read directions → measure → ingest/synthesize → evaluate → log). It is metabolism, just narrated as cognition. Worth deciding if "improvement loop" and "metabolism" are the same loop or two loops sharing a substrate.

4. **What enforces the schema-regeneration step?** Today: `HEARTBEAT.md` reminder. Could be: pre-commit hook, GitHub Action on `data/*.yaml` change, or `/close` skill running `generate:schemas` before commit. Currently none of these are wired in this instance.

5. **What's the canonical path for a decision that doesn't fit a registry?** A meta-decision like "we're going to use TDD for skills going forward" — does it become an entry in `DECISIONS.md`, a skill in `skills/`, an entry in `data/projects.yaml`? The 2026-04-25 plan-shape standardization was logged in `DECISIONS.md`; the implementation lives in plan-template prose. Not a registry. The pattern "decisions about how-we-work" has no dedicated digestive organ.

6. **Where does cross-instance metabolism live?** When `refi-bcn-os` learns something, how does it flow back to the framework? `analyze:instances` script + `data/skills-matrix.yaml` `promotion_status: candidate` is the answer for skills. For decisions, knowledge, patterns? Largely manual today (operator reads memories, writes to MEMORY.md / DECISIONS.md).

## Existing-plan touchpoints

- **`instance-bootstrap` (`docs/agent-plans/instance-bootstrap.md`)** — Phase 3 is "first source ingest, proof-of-pipeline" — this is the metabolic startup. Per the 2026-04-25 brainstorm note: "knowledge scope = B-proof-of-pipeline." The plan's phase 3 is literally first-bite, first-digestion. Validates that a brand-new instance can run the loop end-to-end before being declared bootstrapped.

- **`federation-protocol` (`docs/agent-plans/federation-protocol.md`)** — Peer exchange (knowledge commons publish/subscribe via `federation.yaml knowledge-commons:` block) is metabolism *across* cells. Outputs from one instance's metabolism become inputs to another's. Currently mostly inert at the framework level — `federation.yaml`'s `knowledge_commons.published_domains` is empty per the schema generator's read.

- **`system-reliability` (`docs/agent-plans/system-reliability.md`)** — Quality control on metabolism output. The 2026-04-25 scoping calls out four failure modes: data integrity, agent runtime, federation drift, recovery. The first three are all "metabolism produced bad output" failures. `validate:schemas` and `validate:structure` are existing reliability primitives; this plan extends them.

- **`package-integration` (`docs/agent-plans/package-integration.md`)** — Packages are metabolism components: `packages/operations/meetings/` is where digested meetings land; `packages/dashboard/` would consume the digested state; `packages/knowledge-exchange/` would handle cross-cell flow. The 2026-04-25 multica-integration spec proposes multica-as-runtime — i.e., introducing a new digestive enzyme into the chain.

- **`framework-dashboard-template` / `tui-dashboard` / `obsidian-interface`** — Different output organs for the same metabolic state. Dashboard is the introspective excretion (system showing state to operator). Each plan adds a different rendering of the same registries-and-memory substrate.

## Framework-level note

Framework metabolism is the second-order loop: patterns flow from instances back to the framework via skill-promotion and package-promotion. The mechanism lives in three places: `scripts/analyze-instances.mjs` (detection — flags skills present in ≥2 instances per the 2026-04-24 skill-promotion-policy decision), `data/skills-matrix.yaml` (the registry holding `promotion_status: candidate|canonical`), and `docs/SKILL-PROMOTION.md` (the prose workflow: detect → triage → reconcile → move → sync downstream → log). It is partially gestured: the detection is automated, but reconciliation and promotion are manual operator work, and there is no automated demotion despite the doc mentioning it. Knowledge promotion (instance learnings becoming framework patterns) has no analogous registry — only the prose pattern in `docs/KNOWLEDGE-INITIATION.md` and the operator's editorial judgment when writing to `docs/`. So framework metabolism *exists as a real loop for skills* (with detection, candidate registry, promotion criteria, and a current backlog of 6 candidates listed in `HEARTBEAT.md`) and *exists as gestured intent for everything else* (knowledge patterns, decision patterns, plan-shape patterns), making the framework itself a partially autopoietic cell — it digests skill-level outputs from its instances, but most other outputs flow downstream-only.
