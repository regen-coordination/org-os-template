# Cloudflare OS × org-os Integration — Design Spec

**Date:** 2026-08-08
**Status:** implemented M0–M2 in-repo (v0.5); deployment half frozen (portfolio memo row 0)
**Cloudflare OS:** https://github.com/cloudflare/cloudflare-os — agent workspace on Cloudflare Workers (open-sourced 2026-08-05, Apache 2.0, early access). Kernel: `packages/workshop-backend`; drivers: `packages/gatekeeper-*` (GitHub, Google, Slack, Notion, …); shell: `packages/workshop-frontend`; processes: Gadgets (sandboxed Dynamic-Worker apps, per-gadget SQLite via Durable Object Facets); executables: Blueprints (shareable app templates — fork code, not data). Deploy: own CF account via https://github.com/cloudflare/cloudflare-os-starter; self-host on `workerd` announced, docs pending. Announcement: https://blog.cloudflare.com/cloudflare-os/

## Goal

Make Cloudflare OS a first-class operator interface for org-os — and make org-os the portable, git-native definition of a Cloudflare OS workspace.

Two directions, one architecture:

1. **Cloudflare OS as UI for org-os.** A dedicated `gatekeeper-org-os` Worker exposes org-os instances (registries, pages, federation, context) as governed capabilities; gadgets render the dashboard, federation map, and a member write path in the browser; the workspace agent chats with real org context.
2. **org-os as the substrate for Cloudflare OS.** The workspace's meaning — gatekeeper code, blueprints, context — lives in the org-os repo, not in the deployment. Any instance redeploys the same workspace against its own repo; the gatekeeper reads through a substrate interface so GitHub today can become workerd-local-git or Radicle tomorrow. Cloudflare OS stores gadget state in per-gadget SQLite; org truth stays in git. The workspace is a *view with hands*; the repo remains canonical.

Pilot is dogfood: the org-os hub + refi-bcn-os, operated for real.

## Decisions (locked)

| Question | Decision |
|---|---|
| First increment | Dogfood hub pilot — operate the actual federation from a deployed workspace before generalizing |
| Pilot success criteria | All four operator moments, sequenced as milestones: org chat with real context (M1), dashboard gadget (M2), non-tech write path (M3), federation/hub view (M4) |
| Hosting | Own Cloudflare account now (starter fork); **workerd self-host port is a committed Phase 2 item**, not an aspiration |
| Pilot orgs | org-os hub + refi-bcn-os (hub gives the federation view real multi-instance data; refi-bcn gives real members for the write path) |
| Reverse-direction depth | Context sync + blueprint-in-repo now; gadget-state-in-git and Radicle substrate are Phase 3 exploratory |
| Architecture | **B: dedicated `gatekeeper-org-os` Worker** (over A: stock GitHub gatekeeper only — no org semantics; over C: hosted org-os API — second service + unverified bridge) |
| Repo access | GitHub API behind a substrate interface (`readFile / listDir / fileMeta / proposeChange`), Durable Object cache with ETags |
| Write model | PR-only via `proposeChange`; one human gate = GitHub PR review (operator-trunk convention). Gatekeeper async-approval reserved for future sensitive capabilities |
| Write surface | Exactly the CHAT-INTERFACE.md contract: `submit_idea`, `log_meeting`, `update_project_status`, `add_action_item`. Never-via-chat ops (SOUL/IDENTITY/federation, financial, skill deploy) are structurally absent, not policy-blocked |
| Dashboard logic | Extract a runtime-agnostic shared page core (registries-JSON → view-model) used by both the existing host `page-shim` and the gatekeeper — one source of truth, parity-tested |
| Platform risk | Pin cloudflare-os to a known-good commit; M0 probe retires the gatekeeper-authoring unknown first |

## Architecture

```
        CLOUDFLARE OS DEPLOYMENT (starter fork, own CF account;        ORG-OS REPOS (git, canonical)
        workerd port in Phase 2)                                 ┌──────────────────────────────────┐
┌───────────────────────────────────────────────────────┐       │ org-os hub        refi-bcn-os    │
│  workshop-frontend (shell)                            │       │ · data/*.yaml     · data/*.yaml  │
│  ┌─────────────┐ ┌───────────────┐ ┌──────────────┐   │       │ · .well-known/    · memory/      │
│  │ org-dashboard│ │ federation-map│ │ org-inbox    │   │       │ · DECISIONS.md    · meetings     │
│  │ gadget       │ │ gadget (torch)│ │ gadget (write)│  │       │ · federation.yaml                │
│  └──────┬──────┘ └──────┬────────┘ └──────┬───────┘   │       └────────▲─────────────────────────┘
│         │  Cap'n Web RPC │                │           │                │ GitHub API (read + PR)
│  ┌──────▼────────────────▼───────────────▼────────┐   │       ┌────────┴─────────────────────────┐
│  │ agent chat (workspace agent w/ org context)    │   │       │ GitHubSubstrate                  │
│  └──────────────────────┬─────────────────────────┘   │       │ (DO cache, ETags, staleness      │
│                         │ capabilities               │        │  provenance)                     │
│  ┌──────────────────────▼─────────────────────────┐   │       └────────▲─────────────────────────┘
│  │ gatekeeper-org-os (this project)               │───┼────────────────┘
│  │ · substrate iface: readFile/listDir/fileMeta/  │   │   later substrates: workerd-local-git,
│  │   proposeChange                                │   │   Radicle (rad-org-os driver thesis)
│  │ · read caps: get_page · get_registry ·         │   │
│  │   get_federation · get_context_bundle ·        │   │   gatekeeper + blueprint + context code
│  │   get_schema                                   │   │   is CANONICAL in the org-os repo:
│  │ · write caps (4, PR-only): submit_idea ·       │   │   packages/cloudflare-os-integration/
│  │   log_meeting · update_project_status ·        │   │   ├── gatekeeper/
│  │   add_action_item                              │   │   ├── blueprints/
│  └────────────────────────────────────────────────┘   │   └── context/
└───────────────────────────────────────────────────────┘
```

## Components

### 1. `gatekeeper-org-os` (Worker — the org-os "device driver")

- **Substrate interface.** `readFile(path)`, `listDir(path)`, `fileMeta(path)`, `proposeChange({files, message, branch})`. Pilot: `GitHubSubstrate` over the GitHub API with a Durable Object cache (ETag revalidation, ~60s TTL, stale-while-revalidate). The interface is the rad-org-os driver thesis applied to a second host: capabilities never touch GitHub directly, so workerd-local-git and Radicle implementations slot in without capability changes.
- **Instance registry.** Configured instances, each `{id, repo, ref, trust}`. Pilot: `org-os` (hub) + `refi-bcn-os`.
- **Read capabilities.**
  - `get_page(instance, page_id)` — same page catalog as `packages/tui-data/src/builtin-pages.mjs` (dashboard, projects, tasks, plans, decisions, this-week, instances, federation, …), rendered through the shared page core.
  - `get_registry(instance, name)` — parsed YAML → JSON for any `data/*.yaml` registry.
  - `get_federation(instance)` — parsed `federation.yaml` with peer resolution.
  - `get_context_bundle(instance)` — see Component 2.
  - `get_schema(instance)` — `.well-known/*.json` passthrough.
- **Write capabilities (exactly four).** Each validates its payload against the registry schema, constructs a minimal diff, and opens a PR via `proposeChange` on a fresh branch (workspace-labeled, operator-trunk convention). Idempotency by content hash: a double-submit reuses the open PR. The never-via-chat list from `docs/CHAT-INTERFACE.md` is enforced by absence — those capabilities are not implemented.
- **Shared page core (extraction).** The dashboard/page view-model logic currently reachable via `scripts/page-shim.mjs` is extracted into a pure, runtime-agnostic core (registries-JSON in → view-model out, no fs/child_process) that both the existing hosts and this gatekeeper import. Parity-tested against current `page-shim` output so hosts render identically before and after.

### 2. Context sync (repo → workspace)

`get_context_bundle(instance)` assembles the chat-contract context: `IDENTITY.md`, the chat-relevant rules from `AGENTS.md`, registry snapshots, `MEMORY.md` index, recent `DECISIONS.md` entries — each stamped with source commit hash. Cloudflare OS's mechanism for loading "curated context and skills" into a workspace is under-documented as of 2026-08-08, so the adapter is deliberately thin: preferred path is whatever native context-ingestion exists; guaranteed fallback is the workspace agent calling the capability at conversation start. Skills mapping (org-os `SKILL.md` ↔ workspace skills) is Phase 2.

### 3. Gadgets / Blueprints (user-space)

- **`org-dashboard`** — renders `get_page` view-models with an instance switcher (hub / refi-bcn). Web equivalent of the `org_os_page` host-integration surface.
- **`federation-map`** — embeds the existing `packages/org-os-federation-map` `dist/federation-map.iife.js` bundle, fed by `get_federation` data ("the torch" in a gadget).
- **`org-inbox`** — the write path: idea-submission and meeting-log forms → draft preview → capability call → PR link shown to the member.
- Blueprint code is canonical in `packages/cloudflare-os-integration/blueprints/` and exported to the workspace as Blueprints, so other org-os instances instantiate their own copies. Export/import is manual in the pilot; publication tooling is Phase 2.

### 4. Deployment

Fork `cloudflare-os-starter` → own CF account. Secrets: one fine-grained GitHub token (contents:read + pull-requests:write on exactly the two pilot repos). cloudflare-os pinned to a known-good commit; upgrades deliberate, gated on the gatekeeper contract tests passing.

## Data flow

- **Read:** gadget/agent → capability → `GitHubSubstrate` (DO-cached) → YAML parse → shared page core → render. Every view carries provenance: *"as of `<commit>` · `<time>`"*.
- **Write:** form/agent → validated capability → branch + PR → human merges on GitHub → cache TTL picks it up (webhook invalidation is Phase 2).
- **Chat:** workspace agent holds gatekeeper capabilities; context bundle grounds it; factual answers trace to repo state at a commit.

## Error handling

- **Substrate failures** (rate limit, unreachable): stale-while-revalidate; staleness surfaced in the UI; reads never hard-fail while a cached snapshot exists.
- **Parse/validation failures:** structured per-section errors, never silently dropped rows; validated against `schemas/*.json` where present.
- **Write safety:** PR-only means worst case is a bad PR, never corrupted `data/`. No direct commits from the workspace, ever.
- **Never-block:** read path has no dependency on write-path availability.

## Milestones (pilot) → Phases (program)

| # | Deliverable | Proves / retires |
|---|---|---|
| **M0** | Starter deployed to CF account; stock gatekeepers live; hello-world gatekeeper built from an existing `gatekeeper-*` package as template | Gatekeeper authoring path (top platform risk) |
| **M1** | `gatekeeper-org-os` read core + context bundle; hub + refi-bcn configured | Org chat with real context |
| **M2** | Shared page core extracted (parity-tested) + `org-dashboard` gadget | Dashboard gadget |
| **M3** | 4 write capabilities + `org-inbox`; first real refi-bcn member submission → merged PR | Non-tech write path |
| **M4** | `federation-map` gadget + instances view | Federation/hub view |

**Phase 2 (post-pilot):** workerd self-host port (sovereignty commitment) · webhook cache invalidation · skills bridge (`SKILL.md` ↔ workspace skills) · blueprint publication tooling for other instances.

**Phase 3 (exploratory):** gadget SQLite state export/import to the repo (full state-in-git) · Radicle substrate implementation · upstream contribution to `cloudflare/cloudflare-os` (substrate interface or the org-os gatekeeper). Upstream policy is currently "small, trivially-verified PRs only" — upstream is a conversation before it is a PR.

## Testing

- **Gatekeeper:** unit tests with mock substrate; contract tests pinning each capability's output to fixtures recorded from the real pilot repos; write payloads schema-validated.
- **Shared page core:** pure-function tests + parity test vs current `page-shim` output (same spirit as the federation-map bundle-drift test).
- **E2E:** `pnpm run-local` against a fixture repo; per-milestone acceptance = its operator moment demonstrated end-to-end.
- Wired into `npm run selftest`.

## Risks

1. **Platform is 3 days old and explicitly rough** — APIs may churn. → Pin commit; M0 probe first; contract tests as canary.
2. **Context-ingestion mechanism undocumented.** → Thin adapter; capability-call fallback designed in from the start.
3. **GitHub rate limits / token blast radius.** → Fine-grained token scoped to two repos; DO caching; ETag revalidation.
4. **refi-bcn member expectations.** → Write path PR-gated from day one; nothing a member does lands unreviewed.

## Process wiring (on plan execution, not spec commit)

New project entry in `data/projects.yaml` (Operator Interfaces umbrella) → `npm run generate:schemas && npm run generate:quilt` · `DECISIONS.md` entry for the architecture decision · integration doc `docs/integrations/cloudflare-os.md` · session notes to `memory/2026-08-08.md`.

## Open questions (tracked, non-blocking)

- Native context-ingestion API: what does cloudflare-os actually expose for workspace context/skills? (M0/M1 discovery; fallback already designed.)
- Blueprint export format: is there a file representation a repo can hold verbatim, or does publication require the workspace UI? (M2 discovery; affects Phase 2 tooling only.)
- workerd self-host: wait for official docs vs derive from `run-local`? (Phase 2 gate.)
