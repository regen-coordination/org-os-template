---
title: multica-integration package — design spec
date: 2026-04-25
status: approved
phase: a
workstream: package-integration
related_plans:
  - docs/agent-plans/package-integration.md
related_specs: []
---

# multica-integration — Design Spec

## Summary

Add `packages/multica-integration/` to org-os. The package wires Multica
([github.com/multica-ai/multica](https://github.com/multica-ai/multica)) into
org-os as the **primary agent runtime**, replacing `openclaw` in that role
(openclaw is demoted to `alternative-runtime`, not removed). The package
follows the existing thin-glue pattern of `hermes-integration` and
`opencode-integration` — it does not vendor multica's source. It ships an
`install.sh` + `docker-compose.yml` that brings up a self-hosted multica
server (Postgres+pgvector + multica Go server) locally, plus slash commands,
a control skill, and a one-way bridge that writes open `HEARTBEAT.md` tasks
into multica issues.

This spec covers **phase (a)** only. Bidirectional sync (phase b) and
publishing org-os as a multica plugin (phase c) are deferred to separate
specs.

## Goals

1. Operators can run a `multica` workspace alongside any org-os instance with
   one install command.
2. org-os slash commands (initialize, close, dashboard, project queries,
   funding scan, meeting processing) are invokable from multica.
3. Open tasks in `HEARTBEAT.md` show up as multica issues automatically at
   `/close` and on demand via `npm run bridge:multica`.
4. The package serves as the **pilot** for the queued `package-integration`
   workstream's Phase 3 consumption-mechanism question — it establishes
   "self-installing package with bundled docker-compose" as the proposed
   canonical pattern.

## Non-Goals

- Vendoring multica source or pinning a specific multica version into org-os.
- Bidirectional sync (multica → HEARTBEAT.md). One-way write only in phase a.
- Project-level sync (`data/projects.yaml` ↔ multica projects). Phase b.
- Replacing claude-code as the underlying agent CLI. Multica is the
  orchestrator above the agent CLI, not a peer to it.
- Multica Cloud support. Self-hosted only in phase a (re-evaluated in phase b
  if demand emerges).
- Removing `openclaw` from `data/instances.yaml`. It stays as
  `alternative-runtime`.

## Background

### Multica in one paragraph

Multica is a coding-agent orchestration platform: Next.js frontend, Go server
(Chi router, WebSocket), Postgres 17 with pgvector, plus a `multica` CLI and
local daemon. The daemon dispatches tasks to one of several agent runtimes
(Claude Code, Codex, OpenClaw, OpenCode, Hermes, Gemini, Pi, Cursor Agent).
v0.2.16 as of 2026-04-24, 52 releases, ~21k GitHub stars. Self-hostable via
docker-compose; also available as a hosted service ("Multica Cloud").

### Existing org-os patterns this builds on

- **Thin runtime-glue packages.** `packages/hermes-integration/` and
  `packages/opencode-integration/` already exist as glue between an external
  agent runtime and org-os. They ship `install.sh`, slash commands, a
  `SKILL.md`, a smoke test, and a `package.json` workspace stub. They do not
  vendor the runtime — they assume it is installed externally and wire org-os
  context into it.
- **AgentRuntime instance type.** `data/instances.yaml` already classifies
  `openclaw` as `type: AgentRuntime`. Multica fits the same slot.
- **Federation runtime registry.** `federation.yaml integrations.agent_runtimes`
  already lists openclaw with `role: primary-runtime` and regen-eliza with
  `role: alternative-runtime`. Multica slots in alongside.
- **Packages matrix.** `data/packages-matrix.yaml` is a framework-only
  registry of every package across the federation. New packages are
  registered there with promotion status.

### Layering with the queued `package-integration` plan

`docs/agent-plans/package-integration.md` is a 3-phase plan covering an audit
of `packages/`, a `docs/PACKAGE-LIFECYCLE.md` doc, and a Phase-3 decision on
how instances actually consume framework packages. multica-integration ships
*before* that plan resolves Phase 3, and **becomes the concrete pilot** that
proposes the answer: a package may be self-installing via its own
`install.sh` + bundled `docker-compose.yml`. The package-integration plan
keeps full authority to ratify, reject, or amend that pattern; this spec
just gives it a working example to reason about. The small schema bump it
pulls forward — adding `lifecycle_status` to `packages-matrix.yaml` — is
called out explicitly in §5 so the parent plan can coordinate.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Phased: a → b → c | Avoid scope creep; a is shippable on its own. |
| D2 | Phase a target = CLI commands + multica-as-runtime + write-only HEARTBEAT bridge | "Heartbeat-bridge parity" picked from Q2 option (c). |
| D3 | Self-hosted via bundled docker-compose | Sovereignty-aligned; avoids SaaS dependency. Q3 option (a). |
| D4 | multica replaces openclaw as `primary-runtime`; openclaw kept as `alternative-runtime` | Multica is the more polished orchestrator; openclaw stays for users already on it. Q4 option (b). |
| D5 | Bridge runs both manually (`npm run bridge:multica`) and automatically on `/close` | Catches every session, allows ad-hoc runs. Q5 option (e). |
| D6 | Bridge filter: all open HEARTBEAT.md tasks; categories → labels; CRITICAL/URGENT → priority | Lossless without overload. |
| D7 | Idempotency: multica issues keyed by `sha1(category + "\|" + normalize(text))`, where `normalize` trims, collapses internal whitespace to single spaces, strips leading checkbox/list markers (`- [ ]`, `*`, `1.`, etc.), and preserves case. | Re-runs update, never duplicate. |
| D8 | Tasks present in multica but missing from HEARTBEAT.md → closed in multica with reason `removed-from-heartbeat` | Honors HEARTBEAT.md as the source of truth. |
| D9 | No vendoring of multica source | Multica releases too frequently (52 releases at time of spec); pin would rot fast. |
| D10 | Slash-command set in phase a: `/initialize`, `/close`, `/dashboard`, `/org-projects`, `/org-decisions`, `/org-this-week`, `/scan-funding`, `/process-meeting` | Mirrors `opencode-integration`'s curation; covers the daily-use surface. |
| D11 | `federation.yaml agent.runtime: "multica"` is a valid value | Operators can pick multica without a schema change; `scripts/initialize.mjs` already emits the field. |
| D12 | Per-instance opt-in via `federation.yaml packages.multica_integration: false` (default) | Framework defaults off; instances flip on after running install.sh. |
| D13 | This spec pulls the `lifecycle_status` field on `packages-matrix.yaml` forward from the queued `package-integration` plan | The new entry needs the field; small enough to land here. |

## Open Questions

None blocking phase a. Items deferred to phase b/c:

- (b1) Multica → HEARTBEAT.md write direction: who wins on conflict?
- (b2) Should `data/projects.yaml` rows map 1:1 to multica projects, or
  multica project = workstream and multica issue = project?
- (b3) Multica Cloud support — is the install.sh kept docker-only, or does
  it grow a `--cloud` mode?
- (c1) Plugin/skill bundle format multica accepts (TBD — depends on
  multica's plugin API surface at the time phase c starts).

## Architecture

### Component layout

```
packages/multica-integration/
├── README.md                     # operator-facing install + usage
├── SKILL.md                      # multica-control skill (lightweight)
├── package.json                  # npm workspace member
├── install.sh                    # docker compose up + multica setup + register workspace
├── uninstall.sh                  # docker compose down + remove workspace registration
├── docker/
│   ├── docker-compose.yml        # postgres+pgvector + multica server services
│   └── .env.example              # DB creds, multica server port, workspace name
├── commands/                     # multica slash commands (markdown)
│   ├── initialize.md
│   ├── close.md
│   ├── dashboard.md
│   ├── org-projects.md
│   ├── org-decisions.md
│   ├── org-this-week.md
│   ├── scan-funding.md
│   └── process-meeting.md
├── src/
│   ├── bridge.mjs                # entrypoint for `npm run bridge:multica`
│   ├── multica-client.mjs        # thin wrapper over multica REST + CLI
│   └── heartbeat-parser.mjs      # parses HEARTBEAT.md → task records
└── test/
    ├── smoke.test.mjs            # CLI present, server reachable, workspace exists
    └── bridge.test.mjs           # parser + diff against fixture HEARTBEAT.md
```

### Boundaries (how each unit is used independently)

- `heartbeat-parser.mjs` — pure function `parse(markdown) → Task[]`. No I/O.
  Reusable elsewhere (e.g. dashboard renderer).
- `multica-client.mjs` — single class. Default transport is multica REST
  (host + token from `docker/.env`). For actions the REST API does not yet
  expose at the multica version pinned by `install.sh`, the client shells
  out to the local `multica` CLI. The transport choice per action is
  encoded in a small lookup table inside the file so consumers do not need
  to think about it. All network and subprocess I/O sits here.
- `bridge.mjs` — orchestration only. Calls parser, computes diff, calls
  client. No HTTP, no markdown parsing in this file.
- `commands/*.md` — static markdown registered with multica's slash-command
  loader. No code.
- `install.sh` / `docker/docker-compose.yml` — server lifecycle. Does not
  import any node code; runs ahead of the package being usable.

### Data flow — HEARTBEAT bridge

```
HEARTBEAT.md
    │
    ▼
heartbeat-parser.mjs            (parse markdown → Task[] with category, status, due, assignee)
    │
    ▼
bridge.mjs                      (compute hash(category + "|" + normalize(text)) per task)
    │
    ▼
multica-client.mjs              (upsert via multica API/CLI)
    │   • new hash             → POST /issues (label = category, priority from CRITICAL/URGENT)
    │   • known hash, changed  → PATCH (text or due_date diff)
    │   • known hash, same     → no-op
    │   • open in multica, not present in HEARTBEAT → close with reason "removed-from-heartbeat"
    ▼
Multica server (local docker)
```

Trigger paths:

- **Manual:** `npm run bridge:multica` (from instance root, or from
  `packages/multica-integration/`).
- **Auto on `/close`:** the `org-os-init` skill's CLOSE phase calls
  `bridge.mjs` after memory is written and before the git commit. Failures
  log a warning and do not block the commit.

### Server install flow

`install.sh` performs, in order:

1. Verify `docker` and `docker compose` are available; abort with a clear
   message if not.
2. Verify `multica` CLI is on PATH; abort with a link to
   `https://github.com/multica-ai/multica#install` if not.
3. Copy `docker/.env.example` → `docker/.env` if missing; prompt for
   non-default values (server port, workspace name).
4. `docker compose -f docker/docker-compose.yml up -d`.
5. Poll multica server `/health` for up to 60s.
6. Run `multica setup` non-interactively against the local server; capture
   the API token into `docker/.env` (gitignored).
7. Read `IDENTITY.md` for the org name; call `multica` to create a workspace
   with that name if not present.
8. Register the slash commands from `commands/`.
9. Print next steps: how to run the bridge, how to stop the stack.

`uninstall.sh` mirrors with `docker compose down -v` and a workspace removal
confirmation prompt.

## Data Model + Federation Changes

### `data/instances.yaml`

- Add a new entry:

  ```yaml
  - id: multica
    name: Multica
    type: AgentRuntime
    maturity: production
    framework_version: null
    last_sync: null
    cloned: false
    note: "External orchestration platform — github.com/multica-ai/multica. Self-hosted via packages/multica-integration."
  ```

- Update existing `openclaw` entry's `note`:
  `"Alternative agent runtime — see multica entry. Was primary pre-2026-04."`

### `data/packages-matrix.yaml`

- Add `lifecycle_status` field (one of `active`, `dormant`, `planned`, `retired`)
  to the schema. Backfill all existing entries with `active` except those
  with `instances_using: []` and no near-term plan, which become `planned`.
  This is the early landing of work otherwise queued in
  `package-integration` Phase 1; `lifecycle_status` is the only field added
  here, and the parent plan retains authority over the full audit. We do
  **not** retire any package as part of this spec.
- Add new entry:

  ```yaml
  - id: multica-integration
    owner: framework
    instances_using: []
    in_framework: true
    promotion_status: canonical
    lifecycle_status: active
    notes: "Pilot for self-installing package pattern. Wires Multica orchestration platform as primary agent runtime."
  ```

### `federation.yaml`

- `integrations.agent_runtimes` — add multica with `role: primary-runtime`;
  change openclaw to `role: alternative-runtime`.

  ```yaml
  agent_runtimes:
    - name: multica
      repo: multica-ai/multica
      url: https://github.com/multica-ai/multica
      role: primary-runtime
    - name: openclaw
      repo: organizational-os/openclaw-source
      url: https://github.com/organizational-os/openclaw-source
      role: alternative-runtime
    - name: regen-eliza
      repo: regen-coordination/regen_eliza-refi_dao
      url: https://github.com/regen-coordination/regen_eliza-refi_dao
      role: alternative-runtime
  ```

- `packages` block — add `multica_integration: false`. (Default off;
  instances opt in.)
- Document — but do not change schema for — `agent.runtime: "multica"` as a
  valid value alongside `claude-code`.

### `docs/`

- `docs/agent-plans/QUEUE.md` — move this work from "queued" to "active"
  when the implementation plan is written.
- `docs/PACKAGE-LIFECYCLE.md` — not created here; that doc is owned by the
  parent `package-integration` plan. This spec only seeds the
  `lifecycle_status` field, and the parent plan finalizes the doc.

### `scripts/`

- `scripts/initialize.mjs` — surface multica server status (running /
  unreachable / not installed) in the JSON output under
  `status.runtimes.multica`. Single field, off by default — populated only
  when `federation.yaml packages.multica_integration: true`.

## Error Handling / Degraded Modes

| Failure | Phase | Behavior |
|---|---|---|
| `docker` or `docker compose` missing | install | Exit 1; print install link. |
| `multica` CLI missing | install | Exit 1; print install link. |
| Server `/health` not green within 60s | install | Exit 1; print `docker compose logs` hint. |
| Server unreachable at bridge time | bridge (manual) | Exit 0 with warning `"multica server unreachable, skipping bridge"`. |
| Server unreachable at bridge time | bridge (auto on `/close`) | Same — never block close. |
| HEARTBEAT.md parse failure | bridge | Exit 1 with the offending section quoted. Bridge never half-syncs. |
| Hash collision (two tasks with same category + text) | bridge | Append index to second task's hash; log warning. |
| Workspace name conflict (multica already has one) | install | Detect, prompt to attach to existing or pick new name. |
| Operator runs install.sh twice | install | Idempotent — detects existing stack, skips. |

## Testing

| Test | Type | Always-on? |
|---|---|---|
| `test/bridge.test.mjs` | Unit (parser + diff against fixture HEARTBEAT.md, mocked client) | Yes |
| `test/smoke.test.mjs` | Integration (CLI present, server health, workspace exists) | Gated by env `MULTICA_E2E=1`; off in default CI |
| Manual: install.sh on clean Mac/Linux | Operator-driven | Documented in README |
| Manual: `/close` triggers bridge end-to-end | Operator-driven | Documented in README |

We do **not** test multica itself. The smoke test only verifies our wiring.

## Phased Delivery

| Phase | Scope | Owner doc |
|---|---|---|
| **a (this spec)** | Package skeleton, install.sh + docker-compose, slash commands, write-only HEARTBEAT bridge, federation/data updates, multica = primary runtime, `lifecycle_status` schema bump on `packages-matrix.yaml`. | This spec → writing-plans next. |
| b | Bidirectional task sync (multica issue updates → HEARTBEAT.md). Project-level sync (`data/projects.yaml` ↔ multica projects). | Future spec. |
| c | Reverse direction: publish org-os as a multica plugin/skill bundle so any multica workspace can install org-os patterns. | Future spec. |

## Verification

Phase (a) is done when all of these are true:

- [ ] `packages/multica-integration/` exists with the layout in §Architecture.
- [ ] `bash packages/multica-integration/install.sh` brings up a healthy
      multica stack on a clean machine and registers a workspace named after
      the org.
- [ ] `npm run bridge:multica` writes every open `HEARTBEAT.md` task into
      multica as an issue, with category labels and CRITICAL/URGENT
      priority. Re-run is a no-op.
- [ ] Closing a HEARTBEAT.md task and re-running the bridge closes the
      corresponding multica issue with reason `removed-from-heartbeat`.
- [ ] `/close` automatically triggers the bridge; bridge failure does not
      block the close commit.
- [ ] `data/instances.yaml`, `data/packages-matrix.yaml`, `federation.yaml`
      reflect the changes in §Data Model.
- [ ] `test/bridge.test.mjs` passes in CI; `test/smoke.test.mjs` passes
      locally with `MULTICA_E2E=1`.
- [ ] `npm run validate:schemas && npm run validate:structure` pass.

## Out of Scope (explicit)

- Multica Cloud install path.
- Bidirectional sync.
- Migrating existing openclaw consumers off openclaw.
- Removing or refactoring `packages/hermes-integration/` or
  `packages/opencode-integration/`.
- Resolving the full set of Phase-3 questions in the parent
  `package-integration` plan — this spec contributes one pattern, the parent
  plan ratifies.
