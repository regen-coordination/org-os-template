# Multica × org-os Integration — Design Spec

**Date:** 2026-07-24
**Status:** approved; frozen (v0.6+; portfolio memo row 8)
**Multica:** https://github.com/multica-ai/multica — agent-teammate orchestration platform (Next.js UI, Go backend, Postgres/pgvector, local daemon that auto-detects agent CLIs and executes assigned issues)

## Goal

Make an org-os instance fully visible and operable through multica, without giving up org-os invariants — then generalize the working pieces into upstream contributions to multica.

Two directions, combined and staged:

- **Hands (Phase 1):** org-os becomes an *executable teammate* in multica — an "org-os operator" agent persona (instructions + imported org-os skills, riding the detected `claude` runtime, bound to the instance repo via a `local_directory` project resource) executes issues as session-disciplined org-os work.
- **Eyes (Phase 2):** org-os state is *projected* into multica — tasks, agents, skills, and cron become issues, agent profiles, registry skills, and autopilots, with reconciled write-back.

A native "git-backed workspace" driver inside multica (Approach B) is deliberately deferred to an upstream RFC in Phase 3, informed by real bridge mileage.

## Decisions (locked)

| Question | Decision |
|---|---|
| Primary outcome | Both: operate org-os through multica now, upstream later |
| Source of truth | org-os `data/*.yaml` + git stay canonical; multica's Postgres is a disposable projection |
| Pilot scope | The org-os framework repo itself (dogfood); hub/instances later |
| Multica deployment | Self-hosted locally via Docker Compose; daemon on the same Mac |
| Sync surfaces | All four: tasks→issues, skills→registry, heartbeat/cron→autopilots, members→agent profiles+squad |
| Autonomy | Autonomous for repo-internal work on `agent/*` branches; draft-and-present for anything external (comms, publishing, financial, pushes to shared remotes) |

## Architecture

```
                     ┌──────────────────────────────────────────┐
                     │  Multica (vanilla, self-hosted Docker)   │
                     │  Next.js UI · Go backend · Postgres      │
                     └───────┬──────────────────────┬───────────┘
                             │ issues/squads/       │ REST API + webhooks
                             │ autopilots           │
                     ┌───────▼────────┐    ┌────────▼───────────────┐
                     │ Multica daemon │    │ packages/multica-bridge │  Phase 2
                     │ (local; runs   │    │ (org-os sync: yaml ⇄    │
                     │ detected CLIs) │    │  issues, agents, skills,│
                     └───────┬────────┘    │  autopilots)            │
                             │ runs `claude` as    └────┬───────────┘
                             │ "org-os operator" agent  │ reads/writes
                     ┌───────▼─────────────┐  Phase 1   │
                     │ org-os operator     │────────────▼───────────┐
                     │ persona: session-   │   org-os instance repo  │
                     │ discipline instr. + │   data/*.yaml · memory/ │
                     │ imported skills;    │   skills/ · HEARTBEAT.md│
                     │ local_directory →   │   (canonical truth, git)│
                     │ instance repo       │   └─────────────────────┘
                     └─────────────────────┘
```

Multica stays **vanilla** — no fork. Its database is a cache of projections; org-os remains fully functional if multica is down.

## Phases

### Phase 0 — Foundation (~half a day)

- Self-host multica via `docker compose` (images from GHCR, `.env` from their `.env.example`).
- Run `multica daemon` locally; create one workspace `org-os`.
- Verify a vanilla flow: assign a trivial issue to a detected agent CLI (e.g. Claude Code) and watch it execute.

### Phase 1 — Hands: "org-os operator" agent persona (~1 day)

**Research finding (2026-07-24, from multica source):** the daemon's provider registry is hardcoded (`defaultAgentCommandNames` + explicit `probe()` calls in `server/internal/daemon/config.go`) — a custom CLI on PATH is never auto-detected, so the originally-sketched PATH shim is not viable without forking. Multica's *supported* customization layer is the **Agent**: an instructions block (markdown, passed verbatim to the runtime CLI) plus skills materialized from GitHub URLs, riding an already-detected runtime (`claude`). Projects additionally support a **`local_directory` resource** (`server/internal/handler/agent.go`) that binds tasks to an existing local directory on a specific daemon instead of a fresh worktree.

Phase 1 therefore ships, in `packages/multica-bridge/` (which Phase 2 extends with the sync loop):

1. **Operator instructions** — `packages/multica-bridge/personas/org-os-operator.md`: the session-discipline preamble pasted into the multica agent's instructions: bootstrap context from `IDENTITY.md`/`AGENTS.md` + relevant `data/*.yaml`; do the task; append to `memory/YYYY-MM-DD.md`; run `npm run generate:schemas` if data changed; commit to an `agent/<issue-id>` branch; draft-and-present anything external.
2. **Multica-side setup** (documented, scriptable where the API allows): workspace `org-os` → agent "org-os operator" (runtime `claude`, instructions from the persona file, skills imported from `github.com/regen-coordination/org-os-template` `skills/`) → project bound to the local framework repo via `local_directory` pinned to the Mac's daemon.
3. **Runtime permission profile** — the instance repo's `.claude/settings.json` (checked in) enforcing the autonomy policy at the CLI layer: allow repo-internal ops, deny `git push` and external-comms tools.
4. **Smoke issue** — an issue assigned to the operator that performs a real yaml task end-to-end and lands an `agent/<issue-id>` branch.

### Phase 2 — Eyes: `packages/multica-bridge/` (~2–3 days)

One process, `npm run multica:sync` (daemon mode or one-shot), running four mappers over multica's REST API:

| org-os (canonical) | → multica | write-back |
|---|---|---|
| tasks (yaml / HEARTBEAT) | issues in `org-os` workspace | status changes, agent results → task status in yaml + memory note |
| `data/members.yaml` agents | agent profiles + `@org-os` squad | none (one-way) |
| `skills/*/SKILL.md` | skills registry (`skills-lock.json` format) | new multica-authored skills → `skills/` as drafts |
| heartbeat/cron jobs | autopilots | autopilot-created issues → tasks in yaml |

**Identity & reconciliation:**

- Every projected object carries a stable `orgos_id` slug in its multica metadata/description; reconciliation matches on that ID.
- Three-way reconcile: last-synced state stored in `packages/multica-bridge/.sync-state.json` (gitignored).
- **Conflict rule: yaml wins.** The multica-side edit is preserved as a memory note — never silently dropped.
- Issues authored in the multica UI flow back as new task entries in yaml on the next reconcile — the UI is a legitimate *input* surface even though git is truth.

**Config:** `packages/multica-bridge/config.yaml`, shared by the Phase 1 setup tooling and the bridge — instance path, multica endpoint/credentials reference, workspace/agent/project identifiers.

### Phase 3 — Upstream (ongoing)

1. **Agent-template PR** — contribute an "org-os operator" template to multica's curated catalog (`server/internal/agenttmpl/templates/`, plain JSON added by normal PR — a far cheaper opener than a Go provider). A native provider PR remains an option later if the persona proves limiting.
2. **Bridge as reference** — register `multica-bridge` in org-os's `PACKAGES.md` as the "git-backed org connector" reference implementation; write it up for the multica community.
3. **Git-backed workspace RFC** — after real mileage, propose the workspace-storage abstraction upstream (multica workspaces backed directly by a git repo of yaml), with the bridge as evidence of demand and shape.

Federation-wide rollout (one multica workspace per org-os instance: hub, refi-bcn-os, refi-dao-os, regen-coordination-os, refi-med-os; squads per org) happens only after the pilot proves out.

## Safety

Enforced at the **runtime-CLI permission layer** (the repo's checked-in `.claude/settings.json`), not by trusting the LLM:

- Checked-in deny rules for `git stash`, `git clean`, `git reset --hard` — safe to apply repo-wide because vault-safety already forbids them for every session. The deny list doubles as the `vaultSafe` guard, so pointing the setup at the Zettelkasten hub or vault-adjacent instances later is safe by default (per `docs/VAULT-SAFETY.md` in the hub).
- `git push` is NOT denied in shared settings (that would break human workflows like `/close`); instead a versioned **pre-push hook** refuses to push `agent/*` branches — the only branches the operator works on — so agent work can never be published without a human merging it to a normal branch first.
- Operator instructions additionally mandate draft-and-present: external actions (comms, publishing, financial) are written as drafts into the issue result for human execution.
- Agent commits land on `agent/<issue-id>` branches, never directly on `master`. Merging is a human act (or a follow-up reviewed issue).
- Known limitation vs the original shim design: instructions are soft; the hard guarantees live entirely in the CLI permission config, so that file is the security boundary and gets its own tests.

## Error handling

- **Operator sessions:** failure or timeout surfaces through multica's own task lifecycle (daemon reports failed runs); operator instructions require never leaving the repo mid-state — a session either commits its `agent/*` branch or leaves the working tree untouched.
- **Bridge:** multica unreachable → skip cycle, log, retry with backoff; org-os is fully functional without multica. Malformed yaml → fail loudly, sync nothing (no partial projections). Write-backs are atomic per file, validated (`npm run validate:schemas`) before commit.
- **Sync-state loss:** `.sync-state.json` deleted → full re-reconcile from `orgos_id`s; worst case is duplicate detection by slug, never data loss (git is truth).

## Testing

- **Operator:** permission-profile tests (the `.claude/settings.json` deny rules actually block push/stash/clean/reset-hard in a headless `claude -p` probe); persona lint (instructions reference only files that exist); one live smoke issue through real multica.
- **Bridge:** mapper unit tests (yaml fixture → expected API payloads, and reverse); reconcile-loop test covering the yaml-wins conflict rule; integration smoke against Docker multica (create issue in UI → appears in yaml; edit yaml → appears in UI).
- Uses the repo's existing `scripts/test` harness conventions.

## Alternatives considered

- **A. Sync bridge only** — eyes without hands; adopted as Phase 2.
- **B. Fork multica with a native org-os workspace driver** — deepest integration, but heavy Go work in a fast-moving young codebase plus fork-maintenance burden; deferred to the Phase 3 RFC.
- **C. Agent-provider shim only** — hands without eyes; adopted as Phase 1, then **revised on research**: the daemon's provider registry is hardcoded, so C's mechanism became the persona-based operator (instructions + skills + `local_directory`) rather than a PATH shim.
- Chosen: **C (persona form) then A, staged**, with B as the upstream endgame — mirrors the KOI early-adopter playbook (work in kind first, architectural contribution second).

## Open questions (to resolve during implementation)

- ~~Exact daemon↔CLI invocation contract~~ — resolved 2026-07-24: registry hardcoded; persona + `local_directory` is the supported path (see Phase 1).
- Whether multica's API exposes webhooks usable by the bridge or polling is required initially.
- Skills registry write format (`skills-lock.json`) fidelity to org-os `SKILL.md` frontmatter.
- How much of the multica-side setup (workspace, agent, project, local_directory binding) is drivable via REST API vs requiring UI clicks — determines how reproducible `npm run multica:setup` can be.
