# DECISIONS.md — Key Decisions Log

_Append-only log of significant decisions for {{ org.name }}. Most recent at top. Detailed session notes live in `memory/YYYY-MM-DD.md`. This file is the **authoritative source** for the agent's context on "what was decided and why" — `MEMORY.md` indexes; `DECISIONS.md` records._

## Conventions

Each decision is a section with these fields:

- **Status** — `active` (in force) · `superseded` (replaced by a later decision) · `withdrawn` (rolled back) · `proposed` (under discussion, not yet ratified)
- **Scope** — which area(s): identity / governance / federation / data-model / agent-runtime / publishing / etc.
- **Decision** — the call, in one or two sentences
- **Why** — the rationale, including alternatives considered and what made them lose
- **Refs** — commits, files, plans, related decisions, session memory

When a decision is superseded, mark it `superseded` and add a `Superseded by:` link to the newer decision. Do not delete; the trail is the value.

---

## {{ today }} · Instance bootstrapped from org-os {{ framework.major_minor }}

- **Status:** active
- **Scope:** identity
- **Decision** — {{ org.name }} is generated from the org-os framework (v{{ framework.version }}) via `clone-framework`; lineage is stamped in `federation.yaml.metadata`.
- **Why** — one honest setup path; the instance starts with its own empty registries, memory and plan queue, none of the framework's.
- **Refs** — `federation.yaml`, `docs/plans/QUEUE.md`
