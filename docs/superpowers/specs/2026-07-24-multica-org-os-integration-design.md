# Multica × org-os Integration — Design Spec

**Date:** 2026-07-24
**Status:** Approved design, pending implementation plan
**Multica:** https://github.com/multica-ai/multica — agent-teammate orchestration platform (Next.js UI, Go backend, Postgres/pgvector, local daemon that auto-detects agent CLIs and executes assigned issues)

## Goal

Make an org-os instance fully visible and operable through multica, without giving up org-os invariants — then generalize the working pieces into upstream contributions to multica.

Two directions, combined and staged:

- **Hands (Phase 1):** org-os becomes an *agent provider* multica can invoke — issues assigned to the "org-os" agent execute as headless, session-disciplined org-os sessions.
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
                     │ (local, PATH   │    │ (org-os sync: yaml ⇄    │
                     │  auto-detect)  │    │  issues, agents, skills,│
                     └───────┬────────┘    │  autopilots)            │
                             │ invokes     └────────┬───────────────┘
                     ┌───────▼────────┐             │ reads/writes
                     │ org-os CLI shim│   Phase 1   │
                     │ (agent provider│─────────────▼──────────────┐
                     │  → headless    │    org-os instance repo     │
                     │  session)      │    data/*.yaml · memory/ ·  │
                     └────────────────┘    skills/ · HEARTBEAT.md   │
                                           (canonical truth, git)   │
                                           └────────────────────────┘
```

Multica stays **vanilla** — no fork. Its database is a cache of projections; org-os remains fully functional if multica is down.

## Phases

### Phase 0 — Foundation (~half a day)

- Self-host multica via `docker compose` (images from GHCR, `.env` from their `.env.example`).
- Run `multica daemon` locally; create one workspace `org-os`.
- Verify a vanilla flow: assign a trivial issue to a detected agent CLI (e.g. Claude Code) and watch it execute.

### Phase 1 — Hands: `org-os` agent provider (~1 day)

Creates `packages/multica-bridge/` (which Phase 2 extends with the sync loop). A small executable `packages/multica-bridge/bin/org-os-agent`, symlinked onto PATH so multica's daemon auto-detects it as an agent CLI. Per invocation:

1. **Receive** the issue prompt/spec from multica (stdin/args — exact invocation contract to be confirmed against multica's `server/` + daemon code during implementation).
2. **Resolve workspace** — the target org-os instance repo, from shim config (pilot: this framework repo).
3. **Execute headless** — invoke `claude -p` (or OpenCode) with a session preamble enforcing org-os discipline: read `IDENTITY.md`/`AGENTS.md` + relevant `data/*.yaml`; do the task; append to `memory/YYYY-MM-DD.md`; run `npm run generate:schemas` if data changed; commit to an `agent/<issue-id>` branch.
4. **Stream/return** progress and the final result to the daemon so multica shows live status.

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

**Config:** `packages/multica-bridge/config.yaml`, shared by shim and bridge — instance path, delegated agent CLI, multica endpoint/credentials reference, autonomy policy, `vaultSafe` flag.

### Phase 3 — Upstream (ongoing)

1. **Provider PR** — add org-os to multica's supported agent CLIs (follows the pattern of their existing ~14 providers; the credibility opener).
2. **Bridge as reference** — register `multica-bridge` in org-os's `PACKAGES.md` as the "git-backed org connector" reference implementation; write it up for the multica community.
3. **Git-backed workspace RFC** — after real mileage, propose the workspace-storage abstraction upstream (multica workspaces backed directly by a git repo of yaml), with the bridge as evidence of demand and shape.

Federation-wide rollout (one multica workspace per org-os instance: hub, refi-bcn-os, refi-dao-os, regen-coordination-os, refi-med-os; squads per org) happens only after the pilot proves out.

## Safety

Enforced at the **shim layer**, not by trusting the LLM:

- Headless sessions run with a permission profile allowlisting repo-internal ops (file edits within the instance repo, `npm run` scripts, git commit/branch) and denying network sends, `git push`, and external-comms tooling.
- Session preamble additionally instructs draft-and-present: external actions are written as drafts into the issue result for human execution.
- Agent commits land on `agent/<issue-id>` branches, never directly on `master`. Merging is a human act (or a follow-up reviewed issue).
- `vaultSafe: true` config flag (on by default) blocks stash/clean/reset-hard patterns, so pointing the shim at the Zettelkasten hub or vault-adjacent instances later is safe by default (per `docs/VAULT-SAFETY.md` in the hub).

## Error handling

- **Shim:** agent CLI failure or timeout → report `failed` to multica with the log tail; never leave the repo mid-state (the session either commits its branch or discards it).
- **Bridge:** multica unreachable → skip cycle, log, retry with backoff; org-os is fully functional without multica. Malformed yaml → fail loudly, sync nothing (no partial projections). Write-backs are atomic per file, validated (`npm run validate:schemas`) before commit.
- **Sync-state loss:** `.sync-state.json` deleted → full re-reconcile from `orgos_id`s; worst case is duplicate detection by slug, never data loss (git is truth).

## Testing

- **Shim:** contract test with a fake daemon invocation (golden input → expected session behavior with a stubbed agent CLI); one live smoke against real multica.
- **Bridge:** mapper unit tests (yaml fixture → expected API payloads, and reverse); reconcile-loop test covering the yaml-wins conflict rule; integration smoke against Docker multica (create issue in UI → appears in yaml; edit yaml → appears in UI).
- Uses the repo's existing `scripts/test` harness conventions.

## Alternatives considered

- **A. Sync bridge only** — eyes without hands; adopted as Phase 2.
- **B. Fork multica with a native org-os workspace driver** — deepest integration, but heavy Go work in a fast-moving young codebase plus fork-maintenance burden; deferred to the Phase 3 RFC.
- **C. Agent-provider shim only** — hands without eyes; adopted as Phase 1.
- Chosen: **C then A, staged**, with B as the upstream endgame — mirrors the KOI early-adopter playbook (work in kind first, architectural contribution second).

## Open questions (to resolve during implementation)

- Exact daemon↔CLI invocation contract (args/stdin/streaming format) — read from multica source in Phase 1, step 1.
- Whether multica's API exposes webhooks usable by the bridge or polling is required initially.
- Skills registry write format (`skills-lock.json`) fidelity to org-os `SKILL.md` frontmatter.
