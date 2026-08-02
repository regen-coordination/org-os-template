# DECISIONS.md — Key Decisions Log

_Append-only log of significant decisions in this org. Most recent at top. Detailed session notes live in `memory/YYYY-MM-DD.md`. This file is the **authoritative source** for the agent's context on "what was decided and why" — `MEMORY.md` indexes; `DECISIONS.md` records._

## Conventions

Each decision is a section with these fields:

- **Status** — `active` (in force) · `superseded` (replaced by a later decision) · `withdrawn` (rolled back) · `proposed` (under discussion, not yet ratified)
- **Scope** — which area(s): framework / instances / governance / federation / data-model / agent-runtime / operator-ux / etc.
- **Decision** — the call, in one or two sentences
- **Why** — the rationale, including alternatives considered and what made them lose
- **Refs** — commits, files, plans, related decisions, session memory

When a decision is superseded, mark it `superseded` and add a `Superseded by:` link to the newer decision. Do not delete; the trail is the value.

---

## 2026-08-02 · Philosophy — org-os as an attempt at synthetic autopoiesis; dialectical form, literal content, regulative method

**Status:** active
**Scope:** framework, governance

**Decision** — org-os gains a canonical root **`PHILOSOPHY.md`** manifesto plus a living note-web (`docs/philosophy/`, ~11 interlinked notes), holding the central claim in a specific configuration: **dialectical form, strong-literal content, regulative "as-if" method**. The text argues that an organization is the *motion of organizing* — holding organisation, organism, and organizing true at once — and is structured as a four-movement phenomenological ascent (Organisation → Organism → Organizing → Spirit) so its form enacts its content. It is simultaneously a **mandate**: it licenses and disciplines what org-os builds, naming `SOUL.md`/`IDENTITY.md`/`MEMORY.md` as an organization's actual apparatus for reading its own self-description back. `PHILOSOPHY.md` is also the single place licensed to use philosophical jargon (defined on first use), an explicit exception to `SOUL.md`'s "no jargon" rule.

**Why** — The existing `autopoiesis-research` corpus is deliberately mechanical: its scoping spec brackets off "Maturana–Varela orthodoxy", "deep formalism", and "philosophy paper", and calls autopoiesis "a working frame, not a literal claim". That bracket left the project's most ambitious idea with no home, no argument, and no mandate status — `SOUL.md` carries values and voice, not philosophy. The three-part stance was chosen because each part fixes a failure mode of the others: a purely **strong** claim collapses into mysticism (orgs are literally alive, unfalsifiable); a purely **regulative** claim retreats into mere metaphor and cannot drive design; **dialectical form** is what lets the strong claim stay alive as content while the "as-if" keeps it honest as method — and it makes the acknowledged pretension productive rather than embarrassing. Two hinges were confirmed load-bearing: **von Foerster's second-order cybernetics** (the system folding its own observer in) is what turns "living motion" into "self-knowing" — without it the ascent to Spirit is a leap of faith; and the **DAO thread carries the present tense**, since Beer, Luhmann and Hegel theorized the self-observing collective while agent-native substrates are the first chance to actually attempt one. This is the turn from commentary on a tradition to participation in it. Alternatives rejected: deepening `SOUL.md` instead (values and philosophy are different registers, and the jargon exception would have contaminated the values file); a genealogical structure tracing cybernetics → Luhmann → DAOs (describes a tradition rather than enacting an argument); and folding Spirit into the synthesis as a coda (the Spirit question was the operator's explicit second lineage and needed its own summit).

**Refs** — spec `docs/superpowers/specs/2026-08-02-org-os-philosophy-manifesto-design.md`, `memory/2026-08-02.md` (§11:05 scoping, §13:25 design), `docs/agent-plans/QUEUE.md` Active §3 `philosophy-foundations`, grounds `docs/superpowers/research/2026-05-02-autopoiesis/` (whose "not a literal claim" disclaimer this revisits), commit `615f7f7`. **Manifesto prose not yet drafted** — spec awaiting operator review.

---

## 2026-08-02 · Positioning — the four-layer thesis; demonstrate rather than assert

**Status:** active
**Scope:** framework, operator-ux, public-surfaces

**Decision** — org-os positions on the **intersection of four layers**, not on any single one: (1) agent-native file workspace, (2) organizational rather than personal scope, (3) machine-readable org data (YAML registries + EIP-4824/DAOstar `.well-known/`), (4) multi-org federation with a personal hub node. Adversarially-verified landscape research found no project combining all four; every peer covers at most one or two. Two supporting calls: **demonstrate layers 3–4 rather than assert them** (the public site proves them with the live federation graph and real instances), and **treat operator experience as the traction priority** over further framework depth.

**Why** — Layer 1 is now a commodity: OpenClaw (383k★), claude-chief-of-staff, and LifeOS-OSS independently converged on the same `SOUL.md`/`AGENTS.md`/`TOOLS.md`/`memory/` conventions, and those conventions became multi-vendor standards (AGENTS.md under the Linux Foundation, 60k+ projects; the Agent Skills `SKILL.md` format across Anthropic/OpenAI/OpenCode; Obsidian's CEO shipping official vault-agent skills). Positioning on the workspace layer alone would be undifferentiated and would fight standards org-os benefits from. Positioning on schemas or federation alone was rejected too — they are uncontested *because no one has validated demand for them*, so asserting their value invites skepticism; showing a federation that actually runs does not. Operator experience won the priority argument on evidence: claude-chief-of-staff reached ~419★ in weeks on executive-assistant UX alone, while org-os's differentiating layers attracted no competitive pressure at all.

**Refs** — `docs/POSITIONING.md`, `docs/research/2026-07-15-agent-native-org-landscape.md` (104-agent verified landscape; one refuted claim excluded — note the filename date is an authoring error, the work is 2026-08-02), `memory/2026-08-02.md`, commits `e2a2f4f` + `eb390a0` (rad-org-os sovereignty proof point), `site/src/data/landing.yaml` (not yet updated), plan `org-os-website`

---

## 2026-07-15 · v0.5 cross-instance consolidation — diff-verified backports, generated artifacts registered by mechanism

**Status:** active
**Scope:** framework, instances, data-model, operator-ux

**Decision** — The framework absorbed the instances' proven developments in one verified pass: 4 skills promoted (`research` reconciled from 3 copies, `working-with-obsidian-canvas`, `web-browsing`, `notion-cli`), the vault-safe multi-operator command set (`/commit` `/sync` `/handoff` + `operator-setup.sh` + pre-commit guard), the `sync-commands.mjs` cross-editor mirroring mechanism, two script backports (`generate-all-schemas.mjs` hand-merged, `clone-linked-repos.mjs` copied), and the hermes-cron + Hub-registry data shapes as documented extension patterns. Drift: 27 → 0 across 7 instances. Three governing rules established: (1) **backports are decided by content diff, never file dates** — `setup-org-os.mjs` looked instance-newer but the framework was ahead; (2) **generated artifacts (skills/commands/) are registered via their generator, not enumerated** — excluded from `federation.yaml agent.skills`, special-cased in `validate-structure.mjs`; (3) **instance data-model extensions promote as documented shapes** (DATA-MODEL.md "Recognized Extension Registries"), not as populated data files.

**Why** — Instances (refi-bcn-os especially) had outpaced the framework for ~2 months; upstream-first only works if consolidation is periodic and verified. Straight file copies were rejected: the divergences were two-way (framework richer in some generators, instances richer in others), so date- or size-based sync would have caused regressions. Promoting Hub registries as populated templates was rejected — content is regen-specific, only the shape generalizes.

**Refs** — `memory/2026-07-15.md`, `memory/reports/instances-drift-2026-07-15.md`, `data/skills-matrix.yaml` (40 entries), `data/packages-matrix.yaml` (22 entries), `docs/DATA-MODEL.md` §Recognized Extension Registries, HEARTBEAT §Consolidation follow-ups

---

## 2026-04-25 · Instance bootstrap as engine; non-tech-onboarding as UI wrapper

**Status:** active
**Scope:** framework, agent-runtime, operator-ux

**Decision** — A new `instance-bootstrap` workstream/plan defines the end-to-end mechanism for creating a new org-os instance: framework cloning + wizard with package/skill selection + knowledge bootstrap (one source ingested as proof-of-pipeline). The pre-existing `non-tech-onboarding` plan is narrowed to "web UI + GitHub Actions glue over the engine" and gains `depends_on: [instance-bootstrap]`.

**Why** — Two alternatives lost: (a) absorbing `non-tech-onboarding` into one mega-plan would over-couple CLI-driven and web-driven concerns and produce a sprawling unshippable plan; (b) keeping them parallel-independent would risk divergent implementations of the same underlying mechanism (cloning, selection, ingestion). The engine-and-wrapper pattern creates a natural dependency, lets the engine be tested and shipped via CLI first, and shrinks `non-tech-onboarding` to a tighter, more focused plan that consumes a stable interface. Also creates a clean boundary with the existing `bootstrap-interviewer` skill, which gets extended in phase 2 of the engine plan rather than rewritten.

**Refs** — `docs/agent-plans/instance-bootstrap.md`, `docs/agent-plans/non-tech-onboarding.md`, `data/projects.yaml`, `memory/2026-04-25.md`

---

## 2026-04-25 · Packages and reliability as first-class workstreams

**Status:** active
**Scope:** framework, data-model

**Decision** — Three new workstreams introduced as parallel first-class concerns in `data/projects.yaml`: `package-integration`, `reliability`, and `instance-bootstrap`. Each has a single umbrella scoping plan with three phases and an explicit Splitting Criteria section that triggers decomposition into per-phase plans if execution exceeds three sessions.

**Why** — Folding these into existing workstreams was rejected: `v2-stabilization` is meant to be closing down (not absorbing more); `skill-promotion` is too narrow (covers skills only, not packages or integration mechanisms); `framework-evolution` is the catchall and would bury the work. Packages already had a registry (`packages-matrix.yaml`) but no governing doc — the asymmetry with skills (which have `SKILL-PROMOTION.md`) needed correction. Reliability had no workstream at all despite four distinct failure modes (data integrity, agent runtime, federation drift, recovery) accumulating risk. The single-umbrella-with-splitting-criteria pattern lets work start without premature decomposition while preserving an exit ramp if the plan grows.

**Refs** — `docs/agent-plans/package-integration.md`, `docs/agent-plans/system-reliability.md`, `docs/agent-plans/instance-bootstrap.md`, `data/projects.yaml`, `memory/2026-04-25.md`

---

## 2026-04-24 · Versioning system

**Status:** active
**Scope:** framework, data-model

**Decision** — `package.json.version` is the single source of truth for framework version. Strict semver. Schema, framework, skill, and `MASTERPLAN.md` versions are decoupled — each can bump independently. Instance migrations are **pull-based**: the framework publishes migration scripts in `scripts/migrations/`; instances run `npm run migrate` when ready. Policy codified in `docs/VERSIONING.md`. v3.0.0 is the first tagged release.

**Why** — Three versions disagreed (`package.json` said 2.0.0, `federation.yaml.metadata.framework_version` said 3.0, MASTERPLANs varied per file) with no migration path for breaking changes like the recent `workstream:` frontmatter addition. Coupling all versions would create false-positive bumps; decoupling lets each artifact evolve at its own cadence. Pull-based migration was chosen over push (framework opening PRs to instances) because instances have their own release cadences and can't always accept framework changes immediately. Strict semver was chosen over 0.x permissiveness because the framework already has production instances depending on it.

**Refs** — `docs/VERSIONING.md`, `CHANGELOG.md`, `scripts/update-version.mjs`, `scripts/migrate.mjs`, `scripts/migrations/v2-to-v3-workstream-frontmatter.mjs`, `docs/migrations/v2-to-v3.md`, `docs/agent-plans/versioning-system.md`

---

## 2026-04-24 · Self-hosting inauguration

**Status:** active
**Scope:** framework, instances, data-model

**Decision** — The org-os repo converts from a template-with-stubs into a **live self-hosting instance** that simultaneously operates as the **multi-instance orchestration hub** for all downstream instances.

**Why** — Two separate shapes (a static framework template + a running hub repo) would mean duplicate canonical files, drift between "what the framework says" and "what the hub does", and no dogfooding loop. Self-hosting collapses both into one repo, gives the framework a living example, and makes hub-only registries (`instances.yaml`, `skills-matrix.yaml`, `packages-matrix.yaml`) first-class citizens of the framework. Cost: framework code now has to distinguish framework-generic from hub-only — handled via `dashboard.yaml` `custom_sections`.

**Refs** — `memory/2026-04-24.md`, `data/instances.yaml`, `data/skills-matrix.yaml`, `data/packages-matrix.yaml`, `IDENTITY.md`, `federation.yaml`

---

## 2026-04-24 · Projects-vs-plans separation

**Status:** active
**Scope:** data-model, agent-runtime

**Decision** — `data/projects.yaml` holds long-lived **workstreams** (multi-month, broad scope, owned). `docs/agent-plans/` holds specific **plans** that execute under a workstream. Plans carry a `workstream:` frontmatter field linking back to the parent project.

**Why** — Conflating workstreams and plans in one registry forced a choice between "too many short-lived projects clogging the registry" or "plans living nowhere". Separation lets workstreams stay stable across many sessions while plans turn over rapidly through scoping → queued → active → completed. The `workstream` field keeps them joinable when needed (e.g., for the upcoming TUI's project entity page, which lists all plans under a project).

**Refs** — `data/projects.yaml`, `docs/agent-plans/QUEUE.md`, `docs/agent-plans/README.md`, `memory/2026-04-24.md`

---

## 2026-04-24 · Identity trajectory: solo-maintainer → OSS → DAO

**Status:** active
**Scope:** governance, identity

**Decision** — The org's identity evolves through three phases: solo-maintainer (now) → open-source project with external contributors → DAO with on-chain governance and treasury. Governance/treasury fields are kept present in `IDENTITY.md` but marked `N/A (solo phase)` rather than removed.

**Why** — Removing fields that don't apply yet would force a bigger refactor when triggers fire (first external contributor, first treasury operation). Keeping them visible as `N/A` makes the upgrade path explicit and self-documenting. Triggers for each phase transition are spelled out in `IDENTITY.md` → Evolution Triggers so the agent knows when to prompt for the change.

**Refs** — `IDENTITY.md`, `SOUL.md`, `memory/2026-04-24.md`

---

## 2026-04-24 · Framework-only registries

**Status:** active
**Scope:** data-model, framework

**Decision** — `data/instances.yaml`, `data/skills-matrix.yaml`, `data/packages-matrix.yaml` are **framework-only** registries — only the framework/hub repo carries them. Individual instances do not.

**Why** — Instances coordinate themselves; the hub coordinates the federation. Putting cross-instance catalogs in every instance would create N copies that drift instantly. Concentrating them in the hub gives one source of truth for cross-instance health (drift, sync, promotion candidates). Documented as an explicit registry-class distinction in `docs/DATA-MODEL.md` so future framework-only registries follow the same convention.

**Refs** — `docs/DATA-MODEL.md` (Framework-only registries section), `data/instances.yaml`, `data/skills-matrix.yaml`, `data/packages-matrix.yaml`

---

## 2026-04-24 · Skill promotion policy

**Status:** active
**Scope:** framework, federation

**Decision** — A skill becomes a candidate for framework canonization when it has been **independently validated in ≥2 instances**. Promotion involves reconciling implementations and extracting a common core to `skills/<id>/SKILL.md`. Single-instance skills stay instance-specific.

**Why** — One instance proves nothing is impossible; two instances suggest it generalizes. Without a criterion, every clever instance-local skill would lobby for promotion and the framework would bloat. The ≥2-instance bar is the smallest gate that selects for genuinely shared patterns. `data/skills-matrix.yaml` tracks promotion status per skill.

**Refs** — `docs/SKILL-PROMOTION.md`, `data/skills-matrix.yaml`

---

## 2026-04-15 · `/initialize` self-executing via `dashboard.yaml`

**Status:** active
**Scope:** agent-runtime, operator-ux

**Decision** — The `/initialize` and `/close` slash commands are self-executing: each step in their definition is a concrete instruction the agent runs in order. Sections shown by `/initialize` are controlled by `dashboard.yaml` (`show:` flags + file order + per-section options).

**Why** — Earlier `/initialize` definitions described what the dashboard *should* contain rather than what the agent should *do*, leaving execution ambiguous and the rendered output inconsistent across sessions. Step-by-step execution + a config file removes both ambiguities — the agent has a script, and the operator has one place to toggle sections without editing skill code.

**Refs** — commits `0e383a6`, `1b2f7e4`, `dashboard.yaml`, `skills/org-os-init/SKILL.md`

---

## 2026-04-06 · Plans pipeline convention

**Status:** active
**Scope:** data-model, agent-runtime

**Decision** — Plans live in `docs/agent-plans/` and move through a four-state pipeline: **scoping** → **queued** → **active** → **completed**. State is tracked in `docs/agent-plans/QUEUE.md`. Each plan is a single markdown file with frontmatter (`status`, `workstream`, `depends_on`, etc.).

**Why** — Plans are short-lived and high-volume; a flat folder with state in frontmatter is lighter than a per-state directory or a database. The QUEUE.md index gives the agent and operator one place to see "what's active right now". Renaming/moving files on state transitions was rejected — it breaks links and history.

**Refs** — commits `d1028ec`, `c80b3dc`, `docs/agent-plans/QUEUE.md`, `docs/agent-plans/README.md`

---

## 2026-04-05 · v2 data model complete

**Status:** active
**Scope:** data-model, framework

**Decision** — org-os v2.0.0 ships with 13 canonical data registries, an EIP-4824 schema generator (`scripts/generate-schemas.mjs`), and a deploy script. Schema files in `.well-known/` are auto-generated from `data/*.yaml` — never hand-edited.

**Why** — Federated organizations need machine-readable schemas to interoperate. EIP-4824 (DAO URI) is the existing standard for DAO identity and was extended for non-DAO org types. Auto-generation from YAML keeps `.well-known/` in sync with operational data without humans needing to remember to regenerate — `npm run generate:schemas` is the one command.

**Refs** — commit `4dbd987`, `docs/DATA-MODEL.md`, `scripts/generate-schemas.mjs`, `.well-known/`

---

_End of log. Append new decisions above, most recent at top. When superseding an older decision, mark it `superseded` and link the newer entry._
