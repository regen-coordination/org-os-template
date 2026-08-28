# org-os Admin App — Design Spec

**Date:** 2026-07-23
**Status:** Approved design, pre-implementation
**Package:** `packages/admin/`

## 1. Purpose

org-os today has three surfaces: the CLI (`npm run initialize`, skills, scripts), read-only static hubs (refi-dao-hub), and static Astro sites. All web surfaces are build-time, read-only, with no write path and no proposals workflow (`.well-known/proposals.json` is an empty placeholder).

The admin app is the first **read-write** surface: a live web interface over any org-os instance repo that gives stewards the full picture of the organization, lets them manipulate the repo through schema-safe editing, and lets them **stage changes as proposals tracked through git**. Aesthetic and interaction references: railway.app (resource dashboard, environment switcher, ⌘K) and n8n (node canvas).

## 2. Decisions (settled during brainstorming)

| # | Question | Decision |
|---|----------|----------|
| 1 | Where does it run? | **Hybrid**: backend-API + SPA architecture from day one; v1 ships local-first (`npm run admin`, localhost); the same server deploys hosted in v2. |
| 2 | Change model | **Layered proposals**: a proposal is a `data/proposals.yaml` entry (governance metadata, EIP-4824 export) that points at a `proposal/<slug>` git branch (the actual changes). Git does diffs/merges; the registry does status/votes/federation visibility. |
| 3 | Editing surface | **Rings**: v1 edits the 14 `data/*.yaml` registries only. Ring B (markdown: docs/knowledge/memory) and Ring C (system files: skills, scripts, federation.yaml, agent files) are later, behind capability flags; Ring C always requires the proposal flow, never direct commit. |
| 4 | Shell paradigm | **A+B**: canvas (Map) and dashboard (Overview) are co-equal home tabs. The workspace-of-views layer is implemented natively (see View Engine), not via Anytype. |
| 5 | Canvas content | **Registry graph as spine** (org entities + relations, ~100s of nodes); any node expands its **graphify** knowledge-graph neighborhood on demand from `graphify-out/`. |
| 6 | First user | v1 = operator on org-os itself (success: daily registry ops happen in the app, not the CLI). v2 = hosted for refi-dao-os stewards. |
| 7 | Embeds | An `embed` view type (sandboxed iframe + URL) ships in v1. Deeper dapp integration (wallet context, postMessage) is v2. |
| 8 | Stack | **Node API server (Hono) + Vite React SPA**, one package, one port. Canvas: React Flow (xyflow, MIT). Tables: TanStack Table/Query. |

**Anytype verdict** (investigated): fork is blocked by the Any Source Available License 1.0 (non-commercial / allowed-networks only — incompatible with treasury/funding operations) and by architecture (its CRDT object store vs. our git+YAML source of truth; no embeddable web client). We **adopt its pattern** — Objects + Relations + Sets-with-switchable-views — natively over the registries, and keep its local REST API as a future connector target.

## 3. Architecture

```
Browser — React SPA (Vite)
  Dashboard · Canvas (React Flow) · View engine (table/kanban/canvas/embed)
  Proposal context switcher · ⌘K palette
        ⇅ REST + WebSocket
Hono API server (Node)
  registry service · schema service · git service
  proposals engine · graph service · watcher (chokidar → WS)
        ⇅ filesystem + git
Any org-os instance repo (source of truth)
  data/*.yaml (14 registries) · data/proposals.yaml (new) · data/views.yaml (new)
  proposal/* branches · graphify-out/ · .well-known/ (regenerated on ratify)
```

- `packages/admin/server/` — the API. Repo path is the only required context; the same binary runs against org-os, refi-dao-os, or any instance.
- `packages/admin/app/` — the SPA, served statically by the server. One process, one port, started with `npm run admin` from an instance root.
- The API is a first-class product: SPA, CLI, agents, and later MCP are all clients. v2 changes deployment (Railway + GitHub App clone + per-steward auth), not architecture.
- v1 binds to localhost only; no auth (the surface is the machine).

### Server modules

| Module | Responsibility |
|--------|----------------|
| Registry service | CRUD over `data/*.yaml` with comment-preserving round-trip (`yaml` package CST). One-field edit → one-line git diff. |
| Schema service | Hand-authored JSON Schema files per registry, checked into `packages/admin/schemas/` and kept aligned with `docs/DATA-MODEL.md` (source of truth for shape disputes). Drives SPA form generation and validates every write, including referential checks (e.g. `projects.owner` must exist in members). |
| Git service | `simple-git`, scoped to the repo. Vocabulary: branch/commit/diff/merge/rebase on `proposal/*` + structured commits to current branch. No stash/clean/reset --hard/force-push, no paths outside the repo — vault safety enforced at the API layer. |
| Proposals engine | Entry ↔ branch lifecycle (see §5). Branch checkouts happen in a hidden worktree (`.admin/worktrees/`), never in the user's working tree. |
| Graph service | Builds the org map from registries + `relationships.yaml`; serves graphify neighborhood expansion from `graphify-out/`. |
| Watcher | chokidar on `data/` + git refs → WebSocket events, so external edits (Obsidian, agents, pulls) appear live. |

### API surface (sketch)

- `GET/PUT /api/registries/:name`, `GET/PUT/POST/DELETE /api/registries/:name/:id`
- `GET /api/schemas/:name`
- `GET/POST /api/proposals`, `POST /api/proposals/:id/(propose|ratify|reject|rebase)`, `GET /api/proposals/:id/diff`
- `GET /api/graph/org`, `GET /api/graph/expand/:nodeId`
- `GET/PUT /api/views`
- `WS /api/events`

## 4. Interface

**Shell**: top bar (org identity · branch + clean/dirty state · proposal-mode switcher · ⌘K · "+ Propose change" CTA), left sidebar (Map, Overview, registries, proposals, saved views), main area, right detail panel. Dark, dense, Railway-flavored.

**Map** (canvas home): React Flow rendering the registry graph — org, projects, members, funds, governance, proposals as typed nodes; registry relations as edges. Click → right panel with details and actions. A ⊕ affordance on any node expands its graphify neighborhood (knowledge docs, code, meetings) as a distinct visual layer.

**Overview** (dashboard home): resource cards per registry (counts, health, urgent items), open proposals, org identity — the at-a-glance state currently rendered by `initialize.mjs`, live.

**View engine**: a view is data, not code — an entry in `data/views.yaml`:

```yaml
- id: funding-board
  source: funding-opportunities
  type: kanban          # table | kanban | canvas | embed
  group_by: status
  filters: { deadline: "<90d" }
- id: safe
  type: embed
  url: https://app.safe.global/…
```

Saved views appear in the sidebar, are versioned in git, shareable, and can themselves be proposed. Embed views render in a sandboxed iframe (`iframe sandbox`, no credential sharing); targets that forbid framing get a link-out card instead.

**Entity panels** always expose two actions: **Edit** (direct mode) and **Stage…** (into a proposal) — the proposal flow is reachable from anywhere.

## 5. Proposal workflow

Two editing modes, always visible in the top bar:

- **Direct mode** (v1 default): validated edits commit straight to the current branch with structured messages (`admin(projects): update status of proj-x`).
- **Proposal mode**: the UI re-renders as if the proposal's branch were reality, with a persistent purple-tinted banner ("Editing proposal: X · N changes"). Every edit commits to `proposal/<slug>` via the hidden worktree.

Lifecycle (entry in `data/proposals.yaml` ↔ branch `proposal/<slug>`):

1. **draft** — server allocates the branch and commits the registry entry (id, title, rationale, author, created, branch ref) **to the main branch**, so the proposals list is complete regardless of which branch anyone is on. Edits accumulate as commits on the proposal branch.
2. **proposed** — a human-readable summary diff is frozen into the entry (entities changed, not raw git diff). If a GitHub remote exists, push + open PR (`gh`), record the PR URL.
3. **in review** — the app renders the diff at registry level ("projects/proj-x · status: active → sunset"); raw git diff behind a toggle.
4. **ratified** — merge to main referencing the proposal id → `npm run generate:schemas` → `.well-known/proposals.json` becomes a real EIP-4824 export → branch deleted → decision optionally mirrored into `governance.yaml` `decisions[]`.
5. **rejected / withdrawn** — entry keeps the frozen diff; branch deleted.

**Conflicts**: if main moves under an open proposal, the entry shows "needs rebase". Because edits are registry-scoped, most conflicts resolve at entity level ("both changed proj-x.status — pick one"). Unresolvable → the UI says plainly that the terminal is the escape hatch.

In v1 the operator is author and ratifier. The lifecycle grows votes/quorum from `governance.yaml` rules in v2 without changing shape.

## 6. Error handling & safety

- **Validation gate**: no write reaches disk without schema + referential validation. Failures return structured field-level violations; never partial writes.
- **YAML fidelity**: CST round-trip preserves comments, key order, formatting; guarded by round-trip tests per registry fixture.
- **Git guardrails**: destructive operations are not in the git service's vocabulary; all paths repo-scoped. Vault safety rules (no stash/clean/reset) enforced in code.
- **Dirty-tree honesty**: proposal ops that overlap uncommitted changes are blocked with "commit or set aside first" — never auto-stashed.
- **Concurrent editors**: watcher-driven live updates; unsaved UI edits to an externally-modified entity produce an entity-level conflict card (yours vs. theirs), never last-write-wins.
- **Transactional ratify**: merge → regenerate → export is a sequence; a failure after merge flags the proposal `ratified-with-errors` with the log attached — no silent half-states.
- **Embeds sandboxed**; embed URLs live in `views.yaml`, so adding one is a reviewable git change.
- **localhost-only** in v1.

## 7. Testing

Vitest + fixture repos (temp dirs with real git), mirroring `packages/knowledge-commons` conventions:

- **Round-trip fidelity** per registry (comments/order preserved; only the edited range differs).
- **Schema validation matrix** (valid/invalid per registry, referential checks).
- **Proposals E2E**: draft → edit → propose → conflicting main → rebase → ratify → assert regenerated `.well-known/`.
- **Guardrails**: destructive git ops rejected; out-of-repo paths rejected.
- **API contract tests** per endpoint; WS assertions for external-edit detection.
- **SPA**: component tests for the schema-driven form generator; one Playwright smoke for the golden path (dashboard → edit → stage → review diff → ratify).
- **Pilot gate (v1 done)**: one week of daily org-os registry ops in the app without dropping to the CLI.

## 8. Milestones

- **M1 — Read + edit**: server, registry CRUD, schema forms, Overview dashboard, sidebar shell.
- **M2 — Map + views**: React Flow canvas (registry graph + graphify expansion), view engine (table/kanban/embed), `views.yaml`, ⌘K palette.
- **M3 — Proposals**: proposal mode, branch machinery, registry-level diff review, transactional ratify, `proposals.yaml` + EIP-4824 export, GitHub PR integration.

## 9. Out of scope (v2+, separate specs)

Hosted deployment (Railway, GitHub App, per-steward auth) · votes/quorum wired to `governance.yaml` · refi-dao-os steward rollout · Ring B (markdown editing) · Ring C (system files) · deeper dapp integration (wallet, postMessage) · Anytype connector via its local REST API.
