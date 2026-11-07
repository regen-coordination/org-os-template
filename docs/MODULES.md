# Modules

> **Canonical list.** `site/src/data/modules.yaml` mirrors this file, and
> `site/test/modules-catalog.test.mjs` fails the build if the two drift. When they disagree,
> this file wins.
>
> **Hand-written.** Nothing generates this page. `scripts/modules.mjs` is 70 lines and exports
> `validateManifest()` and three constants; it has no command line, no registry loading and no
> catalog output, and there is no `modules` npm script. The plan to generate this page from
> `modules/*/module.yaml` is in the design:
> [`2026-08-02-org-os-v5-modularization-design.md`](superpowers/specs/2026-08-02-org-os-v5-modularization-design.md).
> Until that is built, this page is a maintained snapshot, and the status of each module is
> a judgement recorded here, not a field in the manifest (the manifest schema has no status).

A **module** is a versioned unit of organizational capability: a skill, a script, a schema, a
data template, an integration — or a bundle of all five. A module is meant to declare what it
is and which files it owns. Five modules have a manifest in `modules/` today; the other
fifteen entries below are catalog entries with no manifest. The idea that each instance
tracks which modules it has installed, at what version, and whether they have drifted
(`data/modules.yaml`) is not built: no instance has that file.

**Status vocabulary:** `planned` (specified, not built) · `in-dev` (being built) ·
`pilot` (built and verified, not yet running in production) · `live` (in production use).

---

## Tracked modules

Modules with a manifest in `modules/`.

### org-os-instance-doctor — Instance Assessment & Reliable Sync

**What it is.** The answer to "is this instance actually healthy, and can I safely update it?"
Two verbs — `assess` (read-only scorecard) and `sync` (guided repair-then-update) — runnable
from inside an instance or, more usefully, from the framework against a sibling.

**How it works.** Six checks read one snapshot of the instance and each return
`BLOCKER`/`WARN`/`OK` with a remediation hint: identity coherence and template leakage, lineage
stamps, cross-scheme version surfaces, machinery integrity, structure/schemas via the
framework's own validators, and freshness. `sync` then runs ten stages — snapshot,
ensure-upstream, fetch, inject-machinery, overlay, migrate, declare-visibility (DAO-OS L8:
declares public what `.well-known/` shows the instance already publishes, as its own commit;
nothing once `dao.json` carries the L8 generator's mark),
generate-schemas, re-assess, receipt — aborting on the first failure so an instance is never
left half-migrated.
The `overlay` stage copies the framework-owned paths over the instance's; it replaces the
framework's own `scripts/sync-upstream.mjs` (a git rebase) for instances that cannot run it.

The `--dir` hub mode is the point. The code comments give the reason: an instance cannot
repair its own updating mechanism using its own updating mechanism, so the framework supplies
it. (The maintainer's 2026-08-28 sweep of which instances could run `sync-upstream.mjs` is
not reproducible from this repository.)

Every check is a pure function over a snapshot and every side effect is injected, which is why
the suite runs without a network: `tests/instance-doctor/` has 167 tests, all passing on this
branch.

**Status.** `pilot` — built, and the suite passes offline. A run against the maintainer's real
instances is the acceptance gate to `live`; no acceptance report is recorded in this
repository.

**Links:** [manifest](../modules/org-os-instance-doctor/module.yaml) ·
[operator skill](../skills/instance-doctor/SKILL.md) ·
[instance doctor](INSTANCE-DOCTOR.md) ·
package `packages/instance-doctor/`

---

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

**Status.** `pilot` — `packages/cloudflare-os-integration/` has 86 tests (`npm run
test:cloudflare-os-integration`); on 2026-10-10 in a UTC+2 timezone 84 passed and the two
`daysUntil` date tests failed, and all 86 passed with `TZ=UTC`. The verification against the live
GitHub API (a public hub and a private instance on a local Cloudflare OS stack) is recorded in
[the runbook](integrations/cloudflare-os.md) and was not re-run for this page. The write path
is not built: `proposeChange()` throws `M3 — not implemented` in both substrates, and a
deployed-workspace verification is pending.

**Links:** [manifest](../modules/org-os-cloudflare-os/module.yaml) ·
[discovery & runbook](integrations/cloudflare-os.md) ·
[design](superpowers/specs/2026-08-08-cloudflare-os-org-os-integration-design.md) ·
package `packages/cloudflare-os-integration/`

---

### org-os-berd — Berd Desktop Integration

**What it is.** The bridge between an org-os instance and
[Berd](https://github.com/block/berd), Block's open-source Goose-backed desktop agent app:
canonical in-repo personas plus a curated slice of org-os skills, both surfaced through Berd's
project-local `.agents/` discovery.

**How it works.** A hybrid manifest. Identity entries own the shipped personas layer —
`.agents/agents/{operator,upstream}.md` mirrored by `scripts/sync-agents.mjs` (`npm run
sync:agents`). Materialization entries (`skills/<name>: .agents/skills/<name>`)
double as the module's curated exposure list: five skills — `org-os-init`,
`meeting-processor`, `heartbeat-monitor`, `knowledge-curator`, `funding-scout` — mirrored
one-way and marker-guarded (`managed_by: org-os`) by `scripts/sync-skills-berd.mjs`
(`npm run sync:skills:berd`), the same pattern `sync-agents.mjs` uses for personas. `--check`
byte-compares the mirror and is wired into `npm run selftest` (optional, `skipKey: "berd"`).

**Status.** `pilot` — built, not in production use. `node scripts/sync-skills-berd.mjs --check`
reports all five bridged skills in sync on this branch. The live checks in the Berd app (the
personas layer, 2026-08-20) and with `goosed skills list` (all five skills discovered) are
recorded in [the verification trail](integrations/berd.md) and were not re-run for this page.
What remains before `live`: exercising each bridged skill under Goose to do real work, and the
five-use tally in `HEARTBEAT.md`, which has no use ticked.

**Links:** [manifest](../modules/org-os-berd/module.yaml) ·
[discovery & verification](integrations/berd.md) ·
[design](superpowers/specs/2026-08-28-berd-integration-design.md) ·
[architecture](AGENTIC-ARCHITECTURE.md)

---

### org-os-buzz — Buzz Agent Lane

**What it is.** A signed, cryptographically-provenanced comms lane between org-os sessions and
a [Buzz](https://github.com/block/buzz) relay — since 2026-08-29 the operator's hosted
community, with the local compose relay as dev sandbox: `/close` posts a SHA-tagged digest of
the session to `#org-os-dev`, `/initialize` reads the channel back. Fail-open everywhere — the
lane never blocks a session.

**How it works.** `packages/buzz-integration/lib/buzz.mjs` is a thin wrapper that shells out to
a pinned `buzz` binary (JSON in/out) for `postEvent`, `readChannel`, and `status` (which runs
`buzz channels list`, since the CLI has no status command); nothing
else in the repo speaks the Nostr protocol Buzz is built on. Three root-invoked scripts sit on
top — `npm run buzz:post`, `npm run buzz:read`, `npm run buzz:doctor` — and the session skills
gain two optional hooks: a read-back step in `/initialize` and a digest-post step in `/close`,
both fail-open (a non-green `doctor` or any lane error prints a one-line skip and never blocks
the session).

**Status.** `pilot` — built, not in production use. The package's scripts and wrapper are
covered by the four test files in `tests/buzz-integration/` (all passing on this branch, with
the paper tests: 119). The end-to-end run against a live relay (2026-08-29, `buzz:doctor` green,
a digest posted and read back, then the same against the operator's hosted community relay)
is recorded in [`VERIFIED.md`](../packages/buzz-integration/VERIFIED.md) and the
[runbook](integrations/buzz.md); it was not re-run for this page. The `/initialize` read-back
step and the `/close` digest-post step are in `skills/initialize/SKILL.md` and
`skills/commands/close/SKILL.md`. What remains before `live`: five consecutive real sessions
with no manual step, tracked in `HEARTBEAT.md` (none ticked).

**Links:** [manifest](../modules/org-os-buzz/module.yaml) ·
[operations runbook](integrations/buzz.md) ·
[verification trail](../packages/buzz-integration/VERIFIED.md) ·
[design](superpowers/specs/2026-08-28-buzz-integration-design.md) ·
package `packages/buzz-integration/`

---

### org-os-paper — Paper Design Canvas

**What it is.** A human-editable design canvas for on-brand artifacts. An agent asked for a
social card today writes a self-contained HTML file; a steward who wants to nudge the headline
edits CSS. With [Paper](https://paper.design) — a canvas whose every element is real HTML/CSS —
the agent drafts the composition from the org's brand tokens, the human refines it by hand, and
PNG/SVG/JSX exports flow back into the repo.

**How it works.** `packages/paper-integration/` speaks the MCP wire format directly to Paper
Desktop's local server (`http://127.0.0.1:29979/mcp`, three JSON-RPC methods, no SDK). A pure
planner maps a brand.yaml-shaped token map onto Paper's ten token types — names preserved
verbatim (`--refi-color-blue`), rem→px, one-way — and `paper:push-tokens` syncs it diffed and
idempotently in three metered calls (`get_tokens`, `create_tokens`, `set_tokens`);
`paper:lint-tokens` checks the same token map for drift against Paper. `paper:doctor` spends
zero metered calls. **org-os never draws:** agents design
through Paper's own tools following `skills/paper-design/SKILL.md`, under a per-artifact call
budget (the free tier allows 100 metered calls a week). Registration is instance-level opt-in via
a committed `.mcp.json` (this repository has none; the runbook shows the file).

**Status.** `in-dev` — the package and its tests ship (`tests/paper-integration/`, passing). The
token round trip was run against Paper Desktop 0.5.6 ([`VERIFIED.md`](../packages/paper-integration/VERIFIED.md)),
which this page did not repeat; the remaining gate to `pilot` is drawing a real composition
on the canvas (the refi-dao-os prototype). See the [runbook](integrations/paper.md).

**Links:** [manifest](../modules/org-os-paper/module.yaml) ·
[runbook](integrations/paper.md) ·
[verification trail](../packages/paper-integration/VERIFIED.md) ·
[design](superpowers/specs/2026-09-02-paper-integration-design.md) ·
package `packages/paper-integration/`

---

## The v5 core tranche

The seven modules the v5 spec migrates first. Each proves a different module shape; none has a
manifest yet. The statuses below say what the repository contains. `live` for a module means
the maintainer's instances use it. That cannot be checked from this repository, and the
framework's own `data/meetings.yaml` and `data/funding-opportunities.yaml` are empty. The four
`live` statuses (federation, pm, meeting-processor, funding) are not verifiable from the code.

### org-os-standards — Standards & Module Engine

**What it is.** The self-hosting core: EIP-4824 schema generation, structure validation, the
file-structure spec, and the module engine itself.

**How it works.** Everything else depends on it. It is meant to ship `scripts/modules.mjs`,
`schemas/module.schema.json`, and the validators wired into `npm run validate:schemas` and
`npm run validate:structure`. Today `scripts/modules.mjs` validates a manifest and does
nothing else (see the note at the top); `tests/scripts/modules.test.mjs` and
`tests/scripts/module-manifests.test.mjs` cover it and `modules/README.md` describes the state.
In an instance, `validate:schemas` checks for leaks but not the standards schemas (no ajv
there), so `--strict` cannot pass; run the framework's `scripts/validate-identity.mjs <instance>
--strict` for the strict check.

**Status.** `in-dev` — manifest validation and the schema ship today; registry loading, `add`,
`adopt`, drift and health checks are not built (v5 Phase 1–3).

**Links:** [v5 design](superpowers/specs/2026-08-02-org-os-v5-modularization-design.md) ·
[file structure](FILE-STRUCTURE.md) · [EIP-4824 guide](EIP4824-GUIDE.md)

### org-os-federation — Federation

**What it is.** The protocol layer: how instances declare each other, publish machine-readable
state, and stay in lineage with the framework.

**How it works.** `federation.yaml` declares identity, peers, trust levels, and upstream;
`.well-known/*.json` publishes the instance to anyone who asks; `npm run analyze:instances`
reports drift across the network; the federation map renders it as a graph
(`packages/org-os-federation-map/`; [the map page](FEDERATION-MAP.md) covers it).

**Status.** `live` — `federation.yaml` declares 7 downstream entries; `dao-os` (a development
platform) and `openclaw` (an agent runtime) are marked as not data instances, leaving 5, of
which `bread-coop-os` is a test instance and `refi-med-os` is awaiting its bootstrap. All of
them are run by the maintainer; an external pilot is the open milestone.

**Links:** [federation docs](FEDERATION.md) · package `packages/org-os-federation-map/`

### org-os-pm — Projects & Tasks

**What it is.** Workstream and task tracking: the projects registry, the plans queue, and the
dashboard sections that render them.

**How it works.** `data/projects.yaml` holds long-lived workstreams; the plans
directory under `docs/` holds short-lived execution plans queued against them; `/initialize` renders the projects
section (and `npm run initialize` the plans).

**Status.** `live` — rests on the maintainer's own use in other instances; this repository cannot show it.

**Links:** [data model](DATA-MODEL.md) · [plans](PLANS.md)

### org-os-meeting-processor — Meeting Processor

**What it is.** Transcript → structured meeting record → registry updates → knowledge base.

**How it works.** A skill-only module: `skills/meeting-processor/` plus the meeting templates
and the `data/meetings.yaml` shape. The simplest module shape in the system, which is why v5
uses it as a pilot.

**Status.** `live` — rests on the maintainer's own use in other instances; the framework's own `data/meetings.yaml` is empty.

**Links:** [data model](DATA-MODEL.md)

### org-os-knowledge — Knowledge Commons

**What it is.** Compiling, linting, indexing, and federating an org's knowledge.

**How it works.** A hybrid module: the `knowledge-curator` and `knowledge-graph` skills plus
`data/knowledge-manifest.yaml` (which is `domains: []` in the framework). There is no
`@org-os/knowledge-commons` package in `packages/`; it appears only in a plan
(`docs/superpowers/plans/2026-07-23-org-os-kms.md`), and the package that was built is
`org-os-kms` below.

**Status.** `in-dev`.

**Links:** [knowledge commons quickref](knowledge-commons-quickref.md) ·
[practical guide](practical-knowledge-commons.md)

### org-os-funding — Funding

**What it is.** Grant and funding-opportunity tracking with deadline surfacing.

**How it works.** The `funding-scout` skill writes `data/funding-opportunities.yaml`;
`/initialize` surfaces deadlines inside 30 days (`horizon_days: 30` in `scripts/initialize.mjs`).

**Status.** `live` — rests on the maintainer's own use in other instances; the framework's own funding registry is empty.

### org-os-heartbeat — Heartbeat

**What it is.** The instance's live pulse — the module that consumes every other module's
health checks.

**How it works.** The `heartbeat-monitor` skill reads `HEARTBEAT.md` and the data files for
deadlines and open items. Calling the module engine's `check` and folding the results in as
warnings is v5 Phase 3 and is not built, because the engine has no `check`.

**Status.** `in-dev`.

**Links:** [reliability](RELIABILITY.md)

---

## Distributions and surfaces

### rad-org-os — the sovereign distribution

**What it is.** The intent: the full org-os stack on [Radicle](https://radicle.dev) — peer-to-peer, on
infrastructure no single platform can withdraw. And, because Radicle has no org or team
primitive of its own, the missing org layer for Radicle.

**How it works.** Planned as a substrate driver: the same capabilities org-os runs against GitHub,
to be implemented against `radicle-httpd` and the `rad` CLI. The interface the Cloudflare OS module
shipped is the seam both sides build to.

**Status.** `planned` — specified and documented, with a research note and a design; no Radicle code exists (see the page). The one built piece it will use is the substrate interface in `packages/cloudflare-os-integration/`.

**Links:** [rad-org-os](RAD-ORG-OS.md)

### org-os-website-generator — Website Generator

**What it is.** Any instance's data and docs → a federated public site.

**How it works.** The Astro site in `site/` publishes the docs listed in
`site/src/data/docs-manifest.mjs` (the allowlist) and, at build time, `site/scripts/aggregate-federation.mjs`
reads `data/instances.yaml` and each reachable instance's `.well-known/`. The org-os site is
the only output; there is no command that points the generator at another instance's data.

**Status.** `in-dev`.

**Links:** [design](superpowers/specs/2026-06-17-org-os-website-design.md)

### org-os-kms — Knowledge Management System

**What it is.** A compiled, indexed, linted knowledge commons across the federation.

**How it works.** `packages/toolkit-framework` bound into org-os by `packages/org-os-kms`
(`@org-os/kms`, a CLI plus a library), with a connector layer for external sources: two
connectors are registered, `atproto` and `static-json` (`src/connectors/index.mjs`); packs can
add more. It has a two-plane canon-and-publication gate, extension packs, and a federation map
builder. Its overview, planes and publishing pages are [KMS](KMS.md), [KMS planes](KMS-PLANES.md) and
[KMS publishing](KMS-PUBLISHING.md), and the map is [FEDERATION-MAP](FEDERATION-MAP.md); extension packs are in
[extension packs](KMS-EXTENSION-PACKS.md). Of the four connectors the design calls for
(`geo`, `radicle`, `atproto`, `synthefy`) only `atproto` exists.

**Status.** `in-dev` — the package runs and has a test directory,
`packages/org-os-kms/test/`; it is used by the maintainer's own instances only.

**Links:** [connector layer design](superpowers/specs/2026-07-19-org-os-kms-connector-layer-design.md)

### org-os-territory — Territory Extension Pack

**What it is.** An extension pack for org-os-kms that gives a knowledge instance a sense of place.
`territorial-unit` (a bounded unit on a named layer: administrative, landscape, ecological,
hydrological, custom; maps to the core `place`) and `data-stream` (what a source system offers,
by place and kind of work, with a trust tier).

**How it works.** A sibling package at `packages/org-os-territory/`, requiring
`toolkit-framework >= 0.3.0` and `org-os-kms >= 0.1.0` (`pack.yaml`). Opt in with `kms.yaml`
`extensions: [org-os-territory]`; its types are publish-opt-in. See [the territory
pack](TERRITORY-PACK.md).

**Status.** `pilot` — built, with 71 passing tests (`packages/org-os-territory/`), and not in
production: no instance uses it, and its demo data is illustrative.

**Links:** [territory pack](TERRITORY-PACK.md) · [extension packs](KMS-EXTENSION-PACKS.md) ·
[pack README](../packages/org-os-territory/README.md) · [extension packs contract](../packages/org-os-kms/docs/CONNECTORS.md#13-extension-packs)

### org-os-hermes — Hermes Agent

**What it is.** The integration of org-os with the Hermes agent runtime, which has a chat
gateway; the intent is that Hermes is an instance's chat surface.

**How it works.** `packages/hermes-integration/` is a Python tool, `org_os_page`, plus three
skills that Hermes registers as slash commands (`/dashboard`, `/initialize`, `/org_os_pages`),
installed with its `install.sh`. The Telegram gateway belongs to Hermes itself; org-os
contains only the chat-interface contract. That Hermes replaces the OpenClaw host integration
is a plan, not something this repository shows: `federation.yaml` still lists `openclaw`.

**Status.** `in-dev` — one smoke test (`test/smoke.test.py`); not part of `npm run selftest`.

**Links:** [host integration](HOST-INTEGRATION.md) · [chat interface](CHAT-INTERFACE.md)

### org-os-admin — Admin App

**What it is.** The framework's first read-**write** web surface: editing an instance's
registries through schema-driven forms.

**How it works.** A Hono API plus a Vite/React SPA writing comment-preserving YAML and
committing every change to git. The layered proposals the design describes are not built.

**Status.** `in-dev` — milestone M1 is on this branch in `packages/admin/` (`npm run admin`,
on `127.0.0.1:4680`), with 47 test cases written; proposals, the canvas view and any auth are
later milestones. See [the admin app](ADMIN-APP.md).

**Links:** [admin app](ADMIN-APP.md) ·
[design spec](superpowers/specs/2026-07-23-admin-app-design.md) · package `packages/admin/`

---

## Planned

Specified, not yet built. Boundaries are settled so later migration doesn't relitigate them —
see the v5 spec's §6 backlog.

The two surfaced on the public roadmap get full entries; the rest are boundary declarations.

### org-os-ideas — Ideation System

**What it is.** Idea capture → triage → hatching, federated across instances.

**How it works.** The module will bundle what already exists in the core — the `idea-scout`
skill, the `data/ideas.yaml` registry and its dashboard pipeline — with a hatching pipeline
that promotes an idea into a project or a module manifest once it earns one. The pipeline is
not built: the last step is done by hand (see [idea hatching](IDEA-HATCHING.md)), and there is
no federated view of ideas across instances.

**Status.** `planned` — the module as a unit is specified, not built.

**Links:** [idea hatching](IDEA-HATCHING.md)

### org-os-members-hub — Members Hub

**What it is.** Membership, roles, and contribution surfaces for an instance.

**How it works.** It will read the CRM registries and render who is here, what they hold, and
what they have contributed — the human-facing counterpart to `org-os-crm`'s data. Nothing for
it exists yet beyond the `data/members.yaml` registry.

**Status.** `planned`.

| Module                | What it will consolidate                                                     |
| --------------------- | ---------------------------------------------------------------------------- |
| **org-os-agent-core** | Identity/memory templates, `org-os-init`, `initialize.mjs`, session commands |
| **org-os-bootstrap**  | The interview, `setup-org-os.mjs`, the SETUP/BOOTSTRAP docs                  |
| **org-os-research**   | The research skill, autoresearch loops, `data/knowledge-gaps.yaml`           |
| **org-os-treasury**   | `capital-flow`, `data/finances.yaml`, `data/assets.yaml`                     |
| **org-os-crm**        | Members, relationships, channels, governance registries                      |
| **org-os-comms**      | Telegram and channel connectivity                                            |
| **org-os-koi**        | KOI-net bridges and the OPAL integration                                     |
| **org-os-egregore**   | `packages/egregore-core`                                                     |
| **org-os-web3**       | Safe, Hats, and Gardens integrations                                         |

---

## Not modules

Deliberate exclusions, so the boundary stays legible:

- **`workspace-improver`, `schema-generator`** — framework-maintenance tooling, absorbed into
  `org-os-standards`.
- **`packages/dashboard`, `webapps`, `agents-app`, `regen-agents`** — apps that _consume_
  modules. They stay npm workspaces.
- **`site/`** — a deployment, not a capability.
