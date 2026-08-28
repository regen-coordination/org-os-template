# Modules — the org-os v0.5 catalog

> **Canonical list.** `site/src/data/modules.yaml` mirrors this file, and
> `site/test/modules-catalog.test.mjs` fails the build if the two drift. When they disagree,
> this file wins.
>
> **Hand-authored, for now.** v5 Phase 2 generates this from `modules/*/module.yaml` via the
> module engine (`scripts/modules.mjs`). Until then it is a maintained snapshot — and the
> format the generator should reproduce. Design:
> [`2026-08-02-org-os-v5-modularization-design.md`](superpowers/specs/2026-08-02-org-os-v5-modularization-design.md).

A **module** is a versioned unit of organizational capability: a skill, a script, a schema, a
data template, an integration — or a bundle of all five. Modules are how org-os stays one
system instead of a pile of folders: each declares what it is and what files it owns, and
(from v5 Phase 1) each instance tracks which ones it has installed, at what version, and
whether they have drifted.

**Status vocabulary:** `planned` (specified, not built) · `in-dev` (being built) ·
`pilot` (built and verified, not yet running in production) · `live` (in production use).

---

## Tracked modules

Modules with a manifest in `modules/`.

### org-os-cloudflare-os — Cloudflare OS Integration

**What it is.** The bridge between an org-os instance and a
[Cloudflare OS](https://os.cloudflare.app/) workspace: org data, pages, and an org-literate
agent, reachable from a browser by people who will never touch git.

**How it works.** A `gatekeeper-org-os` Worker exposes read capabilities (`get_registry`,
`get_federation`, `get_schema`, `get_context_bundle`, `get_page`) over a **substrate
interface** — `GitHubSubstrate` today, with ETag/TTL caching and stale-while-revalidate; a
Radicle or workerd driver slots in without capability changes. All the meaning lives in
`packages/cloudflare-os-integration/` as pure, runtime-agnostic Node; the Worker is thin
wiring. Every answer carries provenance (the commit sha it was read from), and every read
authorizes an observation before it fetches.

**Status.** `pilot` — 86 tests green; verified against the live GitHub API for both a public
hub and a private instance on a local Cloudflare OS stack. Deployed-workspace verification and
the write path (M3) are pending.

**Links:** [manifest](../modules/org-os-cloudflare-os/module.yaml) ·
[discovery & runbook](integrations/cloudflare-os.md) ·
[design](superpowers/specs/2026-08-08-cloudflare-os-org-os-integration-design.md) ·
package `packages/cloudflare-os-integration/`

---

## The v5 core tranche

The seven modules the v5 spec migrates first. Each proves a different module shape; none has a
manifest yet.

### org-os-standards — Standards & Module Engine

**What it is.** The self-hosting core: EIP-4824 schema generation, structure validation, the
file-structure spec, and the module engine itself.

**How it works.** Everything else depends on it. It ships `scripts/modules.mjs`,
`schemas/module.schema.json`, and the validators wired into `npm run validate:schemas` and
`npm run validate:structure` — so the module system reaches instances through the same
materialization path as every other capability.

**Status.** `in-dev` — manifest validation and the schema ship today; registry loading, `add`,
`adopt`, drift and health checks are Phase 1–3.

**Links:** [v5 design](superpowers/specs/2026-08-02-org-os-v5-modularization-design.md) ·
[file structure](FILE-STRUCTURE.md) · [EIP-4824 guide](EIP4824-GUIDE.md)

### org-os-federation — Federation

**What it is.** The protocol layer: how instances declare each other, publish machine-readable
state, and stay in lineage with the framework.

**How it works.** `federation.yaml` declares identity, peers, trust levels, and upstream;
`.well-known/*.json` publishes the instance to anyone who asks; `analyze:instances` reports
drift across the network; the federation map renders it all as a graph.

**Status.** `live` — running across 5 downstream instances + the hub (`federation.yaml` declares 7 peers; dao-os and openclaw are marked non-instances there — dev platform, agent runtime — leaving 5; single-operator dogfood, external pilot is the open milestone).

**Links:** [federation docs](FEDERATION.md) · package `packages/org-os-federation-map/`

### org-os-pm — Projects & Tasks

**What it is.** Workstream and task tracking: the projects registry, the plans queue, and the
dashboard sections that render them.

**How it works.** `data/projects.yaml` holds long-lived workstreams; `docs/agent-plans/`
holds short-lived execution plans queued against them; `/initialize` renders both.

**Status.** `live`.

**Links:** [data model](DATA-MODEL.md) · [plans](PLANS.md)

### org-os-meeting-processor — Meeting Processor

**What it is.** Transcript → structured meeting record → registry updates → knowledge base.

**How it works.** A skill-only module: `skills/meeting-processor/` plus the meeting templates
and the `data/meetings.yaml` shape. The simplest module shape in the system, which is why v5
uses it as a pilot.

**Status.** `live`.

**Links:** [data model](DATA-MODEL.md)

### org-os-knowledge — Knowledge Commons

**What it is.** Compiling, linting, indexing, and federating an org's knowledge.

**How it works.** A hybrid module: the `knowledge-curator` and `knowledge-graph` skills plus
the `@org-os/knowledge-commons` package and `data/knowledge-manifest.yaml`.

**Status.** `in-dev`.

**Links:** [knowledge commons quickref](knowledge-commons-quickref.md) ·
[practical guide](practical-knowledge-commons.md)

### org-os-funding — Funding

**What it is.** Grant and funding-opportunity tracking with deadline surfacing.

**How it works.** The `funding-scout` skill writes `data/funding-opportunities.yaml`;
`/initialize` surfaces deadlines inside 30 days.

**Status.** `live`.

### org-os-heartbeat — Heartbeat

**What it is.** The instance's live pulse — the module that consumes every other module's
health checks.

**How it works.** `heartbeat-monitor` aggregates checks into `HEARTBEAT.md`; from v5 Phase 3 it
calls the module engine's `check` and folds the results in as warnings.

**Status.** `in-dev`.

**Links:** [reliability](RELIABILITY.md)

---

## Distributions and surfaces

### rad-org-os — the sovereign distribution

**What it is.** The full org-os stack on [Radicle](https://radicle.xyz) — peer-to-peer, on
infrastructure no single platform can withdraw. And, because Radicle has no org or team
primitive of its own, the missing org layer for Radicle.

**How it works.** A substrate driver: the same capabilities org-os already runs against GitHub,
implemented against `radicle-httpd` and the `rad` CLI. The interface the Cloudflare OS module
shipped is the seam both sides build to.

**Status.** `in-dev`.

**Links:** [rad-org-os](RAD-ORG-OS.md)

### org-os-website-generator — Website Generator

**What it is.** Any instance's data and docs → a federated public site.

**How it works.** An Astro site reads `../docs` through a curated allowlist and federates
live-at-build from `data/instances.yaml` and sibling instances' `.well-known/`. The org-os site
is its first reference output.

**Status.** `in-dev`.

**Links:** [design](superpowers/specs/2026-06-17-org-os-website-design.md)

### org-os-kms — Knowledge Management System

**What it is.** A compiled, indexed, linted knowledge commons across the federation.

**How it works.** The toolkit-framework bound into org-os as a swappable module, with a
connector layer for external sources.

**Status.** `in-dev`.

**Links:** [connector layer design](superpowers/specs/2026-07-19-org-os-kms-connector-layer-design.md)

### org-os-hermes — Hermes Agent

**What it is.** A local agent runtime with a Telegram gateway — the chat surface of an
instance.

**How it works.** Hosts the org-os workspace for a persistent agent and bridges it to
messaging, replacing the OpenClaw host integration.

**Status.** `in-dev`.

**Links:** [host integration](HOST-INTEGRATION.md) · [chat interface](CHAT-INTERFACE.md)

### org-os-admin — Admin App

**What it is.** The framework's first read-**write** web surface: editing an instance's
registries through schema-driven forms.

**How it works.** A Hono API plus a Vite/React SPA writing comment-preserving YAML, committing
every change to git, with layered proposals for anything beyond plain registry edits.

**Status.** `in-dev` — M1 built on `feat/admin-app`, not yet merged.

**Links:** [PR #1](https://github.com/regen-coordination/org-os-template/pull/1) · design spec
`docs/superpowers/specs/2026-07-23-admin-app-design.md` (lives on `feat/admin-app`; not linked
because it does not resolve on this branch until PR #1 merges)

---

## Planned

Specified, not yet built. Boundaries are settled so later migration doesn't relitigate them —
see the v5 spec's §6 backlog.

The two surfaced on the public roadmap get full entries; the rest are boundary declarations.

### org-os-ideas — Ideation System

**What it is.** Idea capture → triage → hatching, federated across instances.

**How it works.** The `idea-scout` skill writes `data/ideas.yaml`; the hatching pipeline
promotes an idea into a project or a module manifest once it earns one.

**Status.** `planned`.

### org-os-members-hub — Members Hub

**What it is.** Membership, roles, and contribution surfaces for an instance.

**How it works.** Reads the CRM registries and renders who is here, what they hold, and what
they have contributed — the human-facing counterpart to `org-os-crm`'s data.

**Status.** `planned`.

| Module | What it will consolidate |
|---|---|
| **org-os-agent-core** | Identity/memory templates, `org-os-init`, `initialize.mjs`, session commands |
| **org-os-bootstrap** | The interview, `setup-org-os.mjs`, the SETUP/BOOTSTRAP docs |
| **org-os-research** | The research skill, autoresearch loops, `data/knowledge-gaps.yaml` |
| **org-os-treasury** | `capital-flow`, `data/finances.yaml`, `data/assets.yaml` |
| **org-os-crm** | Members, relationships, channels, governance registries |
| **org-os-comms** | Telegram and channel connectivity |
| **org-os-koi** | KOI-net bridges and the OPAL integration |
| **org-os-egregore** | `packages/egregore-core` |
| **org-os-web3** | Safe, Hats, and Gardens integrations |

---

## Not modules

Deliberate exclusions, so the boundary stays legible:

- **`workspace-improver`, `schema-generator`** — framework-maintenance tooling, absorbed into
  `org-os-standards`.
- **`packages/dashboard`, `webapps`, `agents-app`, `regen-agents`** — apps that *consume*
  modules. They stay npm workspaces.
- **`site/`** — a deployment, not a capability.
