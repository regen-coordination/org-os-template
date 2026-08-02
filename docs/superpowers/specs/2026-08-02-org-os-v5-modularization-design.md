# org-os v5 — Module System Design

**Date:** 2026-08-02
**Status:** Approved (brainstorm 2026-08-02)
**Supersedes:** the conceptual package registry in `docs/PACKAGES.md`
**Related:** `docs/FILE-STRUCTURE.md`, `docs/FEDERATION.md`, `docs/AGENTIC-ARCHITECTURE.md`

## 0. Summary and locked decisions

org-os v5 consolidates the framework's capabilities — today scattered across
`skills/`, `scripts/`, `schemas/`, `docs/`, and `data/` templates, with a
parallel *conceptual* package registry in `docs/PACKAGES.md` — into **tracked
modules**: versioned units with manifests, whose actual state (installed,
drifted, healthy) is always known per instance.

| Question | Decision |
|---|---|
| Module form | **Hybrid** — canonical form is a manifest directory (`modules/org-os-<name>/` + `module.yaml`); npm packaging only for modules that are genuinely code (e.g. `@org-os/knowledge-commons`) |
| State tracking scope | **Install + drift + health**, phased in that order |
| Physical layout | **True consolidation with install-time materialization** — files live inside module dirs in the framework; installing copies them to the canonical instance paths and records checksums. Instance layout does not change |
| v5 coverage | **Core-first tranche** — the module *system* plus 7 flagship modules; everything else migrates in v5.x |
| Tooling | **One module engine, existing surfaces** — a single `scripts/modules.mjs` exposed as `npm run module -- <cmd>`; `initialize.mjs`, heartbeat-monitor, and `sync:upstream` consume it. No new CLI in v5 (clean seam for a bin-wrapper in v6) |
| Version anchor | Framework declares **5.0.0** (package.json + MASTERPLAN), fixing today's 1.0/2.0/3.1 drift. Modules semver independently from 1.0.0 |

## 1. Concepts

A **module** is a versioned unit of organizational capability. Its canonical
form is a directory in the framework repo:

```
modules/org-os-<name>/
  module.yaml       # the manifest — identity, files, deps, checks
  ...content        # skills, scripts, schemas, docs, data templates
```

Modules consolidate what a capability needs across every canonical location.
Code-heavy modules may additionally reference an npm package; the manifest is
still the canonical identity.

Two registries make state trackable:

- **Framework registry** — generated from `modules/*/module.yaml` into the
  framework's `.well-known/modules.json` (published, federation-visible):
  every module, latest version, dependency graph.
- **Instance manifest** — `data/modules.yaml` in each instance: which modules
  are installed, at what version, when, with per-file checksums. Regenerated
  into the instance's own `.well-known/modules.json` so federation peers can
  see each other's capabilities.

## 2. Module anatomy

Example:

```
modules/org-os-pm/
  module.yaml
  skills/pm/SKILL.md        → materialized to skills/pm/
  scripts/…                 → scripts/
  schemas/…                 → schemas/
  docs/PM.md                → docs/
  templates/projects.yaml   → data/projects.yaml   (seed-only)
  templates/tasks.yaml      → data/tasks.yaml      (seed-only)
```

### module.yaml fields

| Field | Meaning |
|---|---|
| `id` | `org-os-<name>` — globally unique |
| `version` | semver, independent per module |
| `type` | `core` \| `operational` \| `integration` |
| `description` | one-liner for registries and dashboards |
| `dependencies` | list of module ids (e.g. everything depends on `org-os-standards`) |
| `files` | source → target path map for materialized content |
| `templates` | seed-only data files — copied **only if the target does not exist**, never overwritten on update |
| `checks` | declarative health checks (see §4) |
| `npm` | optional package name for code modules |

`module.yaml` is validated against `schemas/module.schema.json` (provided by
`org-os-standards`) as part of `npm run validate:schemas`.

### Materialization

Installing a module copies its files to the canonical paths instances already
use (`skills/`, `scripts/`, `docs/`, `schemas/`, `data/`). Consequences:

- Instance layout does not change; Obsidian and all existing tooling are
  unaffected.
- A checksum of every materialized file is recorded in the instance manifest —
  this is the backbone of drift detection.
- Data templates seed once and are never touched again; instance data is
  instance property.

## 3. The engine

One file — `scripts/modules.mjs` — is the sole reader/writer of manifests.
All module logic lives here; no other script parses `module.yaml` or
`data/modules.yaml` directly.

| Command | Does |
|---|---|
| `npm run module -- list` | Registry vs installed, versions |
| `npm run module -- add <id>` | Resolve dependencies → materialize → record in instance manifest |
| `npm run module -- update [id]` | Diff against new version; refuses to clobber locally-modified files unless `--force`; templates untouched |
| `npm run module -- status` | Drift report, per file: `ok` / `modified locally` / `outdated` / `missing` |
| `npm run module -- check [id]` | Run health checks; emit JSON + human summary |
| `npm run module -- adopt` | Migration: detect already-present files matching known modules; record install state without copying |

Existing surfaces **consume** the engine rather than reimplementing it:

- `initialize.mjs` renders a **Modules panel** (installed / drift / health
  glyphs) in the dashboard.
- heartbeat-monitor calls `check` and feeds results into HEARTBEAT.
- `sync:upstream` calls `status` to report per-module drift when syncing
  instances.

Drift comparison fetches the framework's published `modules.json` from the
template repo (falling back to a local clone; offline → drift reads
"unknown"). The engine ships **inside `org-os-standards`** — the module system
is itself a tracked module, and reaches instances through the same
materialization path as everything else.

## 4. State tracking

Three layers, phased:

1. **Install state** (Phase 1) — instance `data/modules.yaml` +
   generated `.well-known/modules.json`.
2. **Drift state** (Phase 2) — checksum three-way compare per file:
   *recorded at install* vs *file on disk* (→ locally modified) vs
   *framework latest* (→ outdated). Surfaced in `status`, the dashboard,
   and `sync:upstream`.
3. **Health state** (Phase 3) — `checks:` entries in `module.yaml`,
   declarative:
   - `file-exists: <path>`
   - `freshness: {path, max-age}` — e.g. a processed meeting note in
     `memory/` newer than 7 days
   - `command: <script>` — exit-0 custom check

   Run via `check`; results feed HEARTBEAT and the dashboard as warnings.
   Health failures never block `initialize`.

## 5. The v5 tranche (7 modules)

Chosen to prove every module shape against the system's design:

| Module | Type | Consolidates | Shape it proves |
|---|---|---|---|
| **org-os-standards** | core | EIP-4824 schemas, schema generators, `validate-structure`, FILE-STRUCTURE spec, `module.schema.json`, **the module engine itself** | Self-hosting core; everything depends on it |
| **org-os-meeting-processor** | operational | meeting-processor skill + meeting templates, `data/meetings.yaml` schema | Skill-only module (simplest) |
| **org-os-pm** | operational | projects/tasks/plans data templates + schemas + dashboard sections | Data-heavy module |
| **org-os-knowledge** | operational | knowledge-curator + knowledge-graph skills, `@org-os/knowledge-commons` npm ref, `data/knowledge-manifest.yaml` | Hybrid skill + npm code module |
| **org-os-funding** | operational | funding-scout skill, `data/funding-opportunities.yaml` | Skill + data |
| **org-os-heartbeat** | operational | heartbeat-monitor skill, health aggregation | The module that *consumes* other modules' checks |
| **org-os-federation** | integration | `federation.yaml`, FEDERATION.md, `test-federation.sh`, `data/instances.yaml`, `data/federation/`, `packages/org-os-federation-map`, `.well-known` publishing | Integration type; makes `modules.json` visible to peers |

## 6. v5.x backlog (defined now, migrated later)

Named in the spec so boundaries are settled even though migration is deferred:

| Module | Type | Would consolidate |
|---|---|---|
| **org-os-agent-core** | core | AGENTS.md/SOUL/IDENTITY/MEMORY/HEARTBEAT templates, org-os-init skill, `initialize.mjs`, `/initialize` + `/close` commands, memory conventions. Deferred deliberately: touching identity templates is the riskiest migration and must not gate the system shipping |
| **org-os-bootstrap** | operational | bootstrap-interviewer skill, `setup-org-os.mjs`, SETUP/SETUP-PATHS/BOOTSTRAP docs |
| **org-os-ideas** | operational | idea-scout skill, `data/ideas.yaml`, IDEA-HATCHING.md, ideas pipeline |
| **org-os-research** | operational | research skill, AUTORESEARCH.md, `data/knowledge-gaps.yaml`, `data/sources.yaml` (acquisition — distinct from org-os-knowledge's curation) |
| **org-os-treasury** | operational | capital-flow skill, `data/finances.yaml`, `data/assets.yaml` |
| **org-os-crm** | operational | `data/members.yaml`, `data/relationships.yaml`, `data/channels.yaml`, governance/membership schemas |
| **org-os-comms** | integration | Telegram bot + channels connectivity (existing HEARTBEAT checks get a home) |
| **org-os-egregore** | integration | `packages/egregore-core` |
| **org-os-koi** | integration | `packages/koi-bridge`, `koi-opal-bridge`, `opal-bridge`, `integrations/opal` |
| **org-os-hermes** | integration | `packages/hermes-integration` |
| **org-os-web3** | integration | the PACKAGES.md web3 concept (Safe, Hats) |

**Deliberately not modules:**

- `workspace-improver`, `schema-generator` skills — framework-maintenance
  tooling, absorbed into `org-os-standards`.
- `packages/dashboard`, `webapps`, `agents-app`, `paperclip-agents-app`,
  `regen-agents` — apps that *consume* modules; they remain npm workspaces.
- `site/` — a deployment, not a capability.

## 7. Versioning and migration

- Framework anchors at **5.0.0** in `package.json` and MASTERPLAN.
- Modules semver independently starting at 1.0.0.
- `docs/PACKAGES.md` is deprecated and replaced by a generated
  `docs/MODULES.md` (from the framework registry).
- `docs/FILE-STRUCTURE.md` gains: `modules/` (framework-only) and
  `data/modules.yaml` (instances).
- Instance migration is **non-breaking**: files are already in canonical
  places, so adoption = run `module -- adopt` once, review the generated
  manifest, commit. Instances that never adopt keep working — they simply
  have no tracked state.

## 8. Error handling

- Locally-modified file on `update` → skip + warn; never silent overwrite
  (`--force` to override).
- Missing dependency on `add` → install it (with confirmation) or fail with a
  clear message naming the dependency.
- Health-check failure → warning glyph in dashboard; never blocks initialize.
- Offline / template repo unreachable → drift reports "unknown"; `add` from
  local clone, `check` unaffected.

## 9. Testing

- Fixture-based engine tests in `scripts/test/`: a temp fixture instance;
  golden tests for `add`, `update`, `status`, `check`, `adopt` — including
  the locally-modified-file and template-preservation cases.
- `module.yaml` validation wired into `npm run validate:schemas`.
- `test-federation.sh` extended to assert `.well-known/modules.json` is
  published and well-formed.

## 10. Phasing

1. **Phase 1 — the system exists.** Engine + manifest formats + install
   state; `org-os-standards` and `org-os-meeting-processor` migrated as
   pilots; `adopt` command.
2. **Phase 2 — state is visible.** Drift detection; remaining 5 tranche
   modules; dashboard Modules panel; PACKAGES.md → generated MODULES.md.
3. **Phase 3 — state is alive.** Health checks; heartbeat +
   `sync:upstream` integration; `.well-known/modules.json` federation
   exposure; instance rollout (refi-dao-os, refi-bcn-os,
   regen-coordination-os, refi-med-os).
