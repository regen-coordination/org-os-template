# Berd × org-os Integration — Design Spec

**Date:** 2026-08-28
**Status:** design approved (operator session 2026-08-28); build gated behind the v0.5 tag — enters the queue as v0.6 Active #5
**Berd:** https://github.com/block/berd — Block's desktop app for getting work done with AI agents (open-sourced 2026-08-19; v0.6.0; Apache 2.0). Tauri 2 + React 19 client over a Goose backend sidecar (`goose serve`, ACP WebSocket); Goose pinned via `goose-backend.lock.json`. Project-local Agent Markdown under `.agents/agents/` (auto-discovered when a project is open); portable Agent Skills (incl. `buzz-handoff`, which bridges Buzz channel context into agent conversations); enterprise "distribution seams." Outside PRs auto-closed — participation is issues-only.

## Goal

Extend the shipped Berd personas layer (2026-08-20: canonical `.agents/agents/{operator,upstream}.md` + marker-guarded `npm run sync:agents`; DECISIONS 2026-08-20) into a formalized integration: **module #4 `org-os-berd`** wrapping the personas layer plus a **curated skills bridge** that materializes org-os skills into Berd's project-local Agent Skills surface — so a Berd/Goose agent opening this repo gets both the org personas and the org's own skills. Dogfooded in this instance for org-os development.

This resolves the interop matrix's stale Berd row ("internal … formalize as a module when it stabilizes" — [interop-plugin-architecture.md](../../agent-plans/interop-plugin-architecture.md)): Berd stabilized publicly on 2026-08-19, firing the row's own trigger.

## Decisions (locked)

| Question | Decision |
|---|---|
| V1 scope | **Module + curated skills bridge.** (Over module-formalization-only — no new capability; over full-lane incl. Buzz coupling — couples to the unbuilt v0.6 Buzz lane and resurrects the deliberately-YAGNI'd persona templating.) |
| Bridge mechanism | **Approach A — generated mirror**, third run of the proven pattern (`sync-commands` → `sync-agents` → `sync-skills-berd`). (Over symlinks/hand-placed copies — Syncthing-fragile, drift-prone, no curation; over user-level `~/.agents/skills/` — wrong boundary; the 08-20 decision already settled canonical-in-repo, globals as managed mirrors.) |
| Materialized copies | **Committed, not gitignored** — matches the repo idiom for generated artifacts (`.well-known/`, `skills/commands/`) — with a `--check` drift mode wired into the gates. |
| Curated set v1 (candidates) | `org-os-init` (session lifecycle — the acceptance vehicle), `meeting-processor`, `heartbeat-monitor`, `knowledge-curator`, `funding-scout`. Pruned by build-time verification. Criteria: pure-markdown instruction skills, no Claude-Code-specific tool dependencies, each verified once under Goose before entering the list. |
| `.agents/skills/feynman/` (existing, hand-placed) | Carries no marker → the guard skips it untouched. Canonicalizing feynman into `skills/` is a follow-up, not v1. |
| Sequencing | **Spec + queue entry now; implementation plan and build after the v0.5 tag** (v0.6 Active #5, same gate as Buzz). |
| Acceptance | One full org-os session — initialize → work → close — **driven from Berd/Goose**, then 5 real work uses of bridged skills. |
| V2 direction | **Buzz×Berd convergence:** Berd's `buzz-handoff` skill makes Berd the human window onto `#org-os-dev` once the Buzz lane (v0.6 Active #4) lands. Trigger: both acceptances passed. Persona templating stays YAGNI until a second deployment wants it. |

## Architecture

```
┌───────────────────────────── org-os repo ─────────────────────────────┐
│  skills/  (35 canonical, SKILL.md format)                             │
│     │  curated subset ◄── modules/org-os-berd/module.yaml (module #4) │
│     ▼        declares: personas + skills exposure list                │
│  scripts/sync-skills-berd.mjs   (one-way, marker-guarded)             │
│     ▼                                                                 │
│  .agents/skills/<name>/   materialized copies, committed              │
│  .agents/agents/{operator,upstream}.md   (shipped 2026-08-20)         │
└───────────────────────────────────┬───────────────────────────────────┘
                                    │ auto-discovered on project open
                                    ▼
                    Berd desktop (≥ v0.6.0, Tauri)
                                    │ ACP WebSocket
                                    ▼
                    goose serve sidecar → agent works the org-os repo
```

Canon never leaves `skills/`; `.agents/` is a materialized view. No secrets, no network, no runtime dependency — the module is pure repo-side materialization, inert unless Berd is installed.

## Components

- **`modules/org-os-berd/module.yaml`** — module #4, `lifecycle_status: experimental`. One manifest wraps the whole Berd surface: the shipped personas + `sync-agents.mjs`, the new skills bridge, and the exposure list (`berd.skills: [...]`) as the single source of curation truth. Records the Berd version floor (v0.6.0).
- **`scripts/sync-skills-berd.mjs`** + `npm run sync:skills:berd` — same flags as `sync-agents.mjs` (`--adopt`, `--dry-run`, `--source/--target` for tests), marker `managed_by: org-os` in materialized frontmatter, curation list read from the manifest, plus `--check` for the gates.
- **Docs ride along:** `AGENTIC-ARCHITECTURE.md` Berd subsection gains the skills bridge; `FILE-STRUCTURE.md` `.agents/` entry extended.

## Assumption to verify (build task 1)

The 08-20 session verified Berd auto-discovers project-local `.agents/agents/`. The equivalent **skills** discovery path is *assumed* to be `.agents/skills/` (the feynman dir suggests it) but is not yet verified against Berd v0.6 docs/source. Build task 1 verifies the discovery dir and Goose's skill-loading behavior against the pinned version, and adjusts the target path if needed — same pin-and-verify posture as the Buzz spec.

## Error handling & guard rails

| Failure | Behavior |
|---|---|
| Materialized copy drifts from canon | `--check` in the gate suite fails; `sync:skills:berd` regenerates |
| Hand-authored file in `.agents/skills/` | No marker → never touched; `--adopt` is the only takeover path, explicit |
| Skill doesn't work under Goose | Pruned from the manifest exposure list (with a note) — the list only ever names verified skills |
| Berd/Goose not installed | Nothing breaks — `.agents/` is inert markdown; module stays dormant |
| Berd changes discovery conventions (v0.6.x preview-adjacent) | Version floor in manifest; build task 1 re-verifies; one script owns the target path |

## Testing & acceptance

- **Unit:** `tests/scripts/sync-skills-berd.test.mjs` mirroring the 10-case `sync-agents` suite (marker guard both ways, adopt, dry-run, curation list, check mode) — TDD, red first.
- **Gates:** full suite + `npm run validate:structure` green with module #4 registered; the drift `--check` wired into selftest/gates.
- **Dogfood acceptance (the real gate):** one full org-os session (initialize → work → close) driven from Berd/Goose, then 5 real work uses of bridged skills. Only then is the bridge "adopted in this instance."

## Sequencing

**Now (pre-tag):** this spec committed · interop matrix Berd row updated (trigger fired) · queue gains **berd-integration** as v0.6 Active #5. Implementation plan deferred to post-tag, same as Buzz. No build.

**Post-tag build order:**
1. Verify Berd v0.6 skills-discovery dir + Goose skill-loading against the pinned version
2. Manifest + sync script, TDD
3. Curate, materialize, wire the drift check into gates
4. Full-session acceptance from Berd/Goose
5. Matrix/docs convergence

## Constraints honored

- **Substrate, not runtime** — Berd/Goose is a runtime plugging into the repo; org truth stays in `skills/` and `data/`.
- **One module mechanism** — the bridge ships as manifest-first module #4; no new extension surface invented.
- **Honest maturity** — `lifecycle_status: experimental`; the exposure list names only verified skills.
- **Single-deployment caveat stands** (DECISIONS 2026-08-20): framework infrastructure, not a promoted pattern; revisit at a second operator. Berd going public makes it a legitimate demo surface for the ~09-10 session-kit narrative — no build coupling.
- **Release freeze** — nothing in this spec authorizes pre-tag build work.
