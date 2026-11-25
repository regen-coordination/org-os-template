# File structure

What is at the root of the org-os repository, what a new instance gets from it, and which files `npm run validate:structure` insists on. Field-level detail for the `data/*.yaml` files is in [DATA-MODEL.md](DATA-MODEL.md).

Two trees are described here, and they differ:

- **The framework repository** is the one you clone from GitHub. It is also an org-os instance of itself (it runs on its own `data/`, `memory/` and `MASTERPLAN.md`), so it carries content no new organisation should inherit.
- **A generated instance** is what `npm run clone:framework` writes into a new directory. The clone is the supported way to start an instance (see [SETUP.md](SETUP.md)). The older route, fork the repository, run `npm run setup` and answer an interview in place, is not a working path for a newcomer: a clean-room test on 2026-08-21 found it broken in seven blocker-level ways, and it has not been re-tested since. Every instance today is run by the maintainer; the clone route has not been walked by an outside operator.

"Required" below means `scripts/validate-structure.mjs` fails without it. Everything else is convention.

## Which is which

The clone copies only what is committed at `HEAD` of the framework repository, and every top-level entry is declared in `scripts/lib/clone-excludes.mjs`. A top-level entry that is not declared is skipped and named in the clone's output.

**Copied from the framework** (some are then trimmed or rewritten, noted in the right-hand column):

| Entry | In the instance |
|---|---|
| `.claude/`, `.cursor/`, `.opencode/` | Slash commands, `.claude/settings.json` and `.opencode/opencode.json`. `.opencode/agents/` was removed in 0.7.4 and is kept out of new instances. |
| `.github/` | `hooks/pre-commit.sh` and `workflows/generate-schemas.yml` only. |
| `.well-known/` | The `*.json.template` files. Published `*.json` files are removed; `dao.json` is rendered for the new organisation. Nothing else is published until the instance sets `identity.daoURI` and says what is public in `data/visibility.yaml` (see [EIP4824-GUIDE.md](EIP4824-GUIDE.md)). |
| `.env.example`, `.gitignore`, `.prettierignore`, `LICENSE`, `BOOTSTRAP.md` | As is (`.gitignore` gains a `docs/temp/` line). |
| `data/` | The registry files. `members`, `projects`, `ideas`, `relationships`, `ecosystems` and `governance` are reset to empty or to a scaffold. `instances.yaml`, `skills-matrix.yaml`, `packages-matrix.yaml` and `knowledge-gaps.yaml` are not carried over, and `data/federation/frontier/` is removed. |
| `docs/` | The operator documentation. Framework history is left out: the framework's `agent-plans` directory, `docs/superpowers/`, `docs/sessions/`, `docs/research/`, `docs/design/`, `docs/QUEUE.md`, and a list of framework-only pages (`POSITIONING.md`, `ECOSYSTEM.md`, `RAD-ORG-OS.md`, `QUILT.md`, `VAULT-SAFETY-CASE-STUDY.md` and others named in `EXCLUDE_FILES`). |
| `package.json`, `package-lock.json` | `package.json` is renamed for the new organisation, set to version `0.1.0` and `private: true`; npm scripts whose target file is not in the instance are dropped. |
| `packages/` | Only the packages set to `true` under `packages:` in the clone config. With no `packages:` block, none. |
| `skills/` | Only the skills listed under `skills:` in the config; every skill directory when the list is absent or empty. |
| `repos/`, `repos.manifest.json` | `repos/README.md`; the manifest's `repositories` list is emptied. |
| `schemas/`, `scripts/`, `templates/` | `scripts/` without `clone-manifest.mjs`, `render-templates.mjs` and `test-federation.sh`, and without `validate-data.mjs`, `validate-governance.mjs` and `claim-handle.mjs`, which need `packages/admin` and are run from the framework against the instance (and without `symbient-hatch.mjs` when the `symbient` skill is not selected). `scripts/lib/` gains a copy of the standards generator's core from `packages/admin/lib/standards/` (`scripts/lib/standards-vendor.mjs` computes the set from its imports). `templates/` carries the English set plus the instance's own language. |
| `tests/` | The suites that make sense in an instance. Framework-only suites (clone, instance-doctor, buzz, paper, module manifests) are left out. |

**Written fresh by the clone:** `IDENTITY.md`, `MASTERPLAN.md`, `MEMORY.md`, `HEARTBEAT.md`, `SOUL.md`, `USER.md`, `TOOLS.md`, `DECISIONS.md`, `federation.yaml` (with a lineage stamp), `README.md`, `GETTING-STARTED.md`, `CLAUDE.md`, `AGENTS.md`, `dashboard.yaml`, `memory/.gitkeep`, `knowledge/INDEX.md`, `docs/plans/QUEUE.md`, and empty `docs/superpowers/{specs,plans,research}/`.

**Not copied, framework only:** `.agents/`, `.hermes/`, `CHANGELOG.md`, `VERSION.md`, `SKILLS.md` (the instance makes its own with `npm run generate:skills`), `SYNC-GUIDE.md`, `PAPERCLIP_DEPLOYMENT_GUIDE.md`, `RESEARCH_INTELLIGENCE_PLAN.md`, `graphify-out/`, `renders/`, `site/`, `integrations/`, `modules/`, `deploy/` and `.dockerignore` (the Hub's container image: an instance runs the image, it does not build it), and the contents of the framework's own `knowledge/` and `memory/`.

After the clone, the instance still needs its dependencies, `npm run generate:schemas` and `npm run validate:structure`; the clone prints that list when it finishes (it says `npm install`; use `npm ci`, which leaves the committed `package-lock.json` as it is, see [SETUP.md](SETUP.md)). On a fresh clone `generate:schemas` writes nothing (there is no `identity.daoURI` yet), and `validate:structure` does not require the generated files until there is one; it passes with warnings for the optional pieces the instance does not have.

## Root files

### Agent files (required)

| File | Purpose |
|---|---|
| `MASTERPLAN.md` | Strategic vision and directions for agents. The main human-written file; it is how an operator steers agent behaviour. |
| `AGENTS.md` | Agent operating manual: the session startup sequence (ten items in the framework's own copy), memory rules, safety policy, communication style. |
| `SOUL.md` | Mission, values, voice and boundaries. |
| `IDENTITY.md` | Name, type, governance infrastructure and chain addresses. `npm run validate:schemas` compares its `- **Name:**` and `- **Type:**` lines with `identity.name` and `identity.type` in `federation.yaml`. |
| `USER.md` | The primary operator's profile and preferences. |
| `MEMORY.md` | Curated index of long-lived decisions. |
| `HEARTBEAT.md` | Active tasks, health checks and urgency markers. |
| `TOOLS.md` | Environment notes: endpoints, the Notion integration settings, and the names (not values) of credential environment variables. |

### Configuration files (required)

| File | Purpose |
|---|---|
| `CLAUDE.md` | Quickstart for Claude Code; points at `MASTERPLAN.md` and lists key commands. |
| `README.md` | Human-facing overview. |
| `federation.yaml` | The instance's manifest: `identity`, network and peers, `upstream`/`downstream`, `agent`, `packages`, `metadata` (framework version, lineage stamp). See [FEDERATION.md](FEDERATION.md). |
| `package.json` | npm scripts. It must define `generate:schemas` and `validate:schemas`. |

### Other root files (not checked by the validator)

| File | Purpose |
|---|---|
| `BOOTSTRAP.md` | First-run onboarding sequence. Copied to every instance. |
| `dashboard.yaml` | Which sections `/initialize` (`npm run initialize`) shows and in what order. |
| `DECISIONS.md` | Decision log. Written fresh by the clone; the framework keeps its own. |
| `GETTING-STARTED.md` | Rendered by the clone for the new instance's operator. |
| `LICENSE`, `.env.example`, `.gitignore`, `.prettierignore` | Licence notice, documented environment variables (no values), ignore rules. |
| `repos.manifest.json` | External repositories that `npm run clone:repos` clones into `repos/`. |
| `CHANGELOG.md`, `VERSION.md` | Framework release history and version tracking (framework repository only). |

## Directories

### `data/`: registries (required)

YAML files that hold the structured data of the organisation. The validator requires six: `members.yaml`, `projects.yaml`, `finances.yaml`, `governance.yaml`, `meetings.yaml`, `ideas.yaml`. It warns when any of these optional ones is missing: `funding-opportunities.yaml`, `relationships.yaml`, `sources.yaml`, `knowledge-manifest.yaml`, `events.yaml`, `channels.yaml`, `assets.yaml`, `knowledge-gaps.yaml`.

The framework repository also has `ecosystems.yaml`, `instances.yaml`, `skills-matrix.yaml`, `packages-matrix.yaml` and `data/federation/frontier/` (a cache of what the framework knows of its peers). The 0.6 registries (`systems.yaml`, `boards.yaml`, `proposals.yaml`, `library.yaml`, `visibility.yaml`) and the 0.7 ones (`tasks.yaml`, `collections.yaml`, `imports.yaml`, and on a hub `federation-requests.yaml` and `invites.yaml`) are in neither list; `npm run validate:data` checks them when they exist. A custom collection's records are in `data/collections/<id>.yaml`, and the knowledge canon, when the instance has one, in `data/kb/`. What each file holds is in [DATA-MODEL.md](DATA-MODEL.md).

### `.well-known/`: EIP-4824 files (required)

Generated by `npm run generate:schemas` from `federation.yaml`, `data/` and `content/meetings/`, `content/projects/`, through the standards builder in `packages/admin/lib/standards/` (an instance runs its vendored copy in `scripts/lib/standards/`). Edit the sources, not these files. The directory is required. Once `identity.daoURI` is set the validator also requires `dao.json`, `members.json` and `projects.json`; it checks that every `*.json` in the directory parses.

Without a `daoURI` the generator writes nothing, and it writes only what `data/visibility.yaml` makes public. The files it may write:

| File | Built from |
|---|---|
| `dao.json` | `identity` in `federation.yaml` |
| `members.json` | `data/members.yaml` (active members' ids only) |
| `proposals.json`, `activities.json` | `data/proposals.yaml` (the ledger and its events) and `decisions` in `data/governance.yaml` |
| `contracts.json` | the on-chain Systems in `data/systems.yaml` (falling back to `identity.safe` and `identity.gardens`) |
| `governance.md` | `data/governance.yaml` (its description and rules) |
| `grant-pools.json`, `attestation-issuers.json` | Gardens pools and `grant_pool` blocks in `data/systems.yaml`; `identity.attestation_issuers`. Each only when there is one |
| `projects.json`, `meetings.json` | `data/projects.yaml`, `data/meetings.yaml`, plus `content/projects/*.md` and `content/meetings/*.md` front matter when those directories exist |
| `finances.json`, `ideas.json`, `knowledge.json` | `data/finances.yaml`; `data/ideas.yaml`; `data/knowledge-manifest.yaml` and `data/sources.yaml` |
| `federation.json` | `federation.yaml`: the networks, the join terms and the public peers (see [EIP4824-GUIDE.md](EIP4824-GUIDE.md)) |
| `skills.json` | written by `npm run generate:skills`, not by `generate:schemas` |

`dao.json`, `members.json`, `proposals.json`, `activities.json`, `contracts.json` and the five org-os extras each have a `*.json.template` beside them, left from the earlier generator; only `dao.json.template` is read, by the clone. The full account is in [EIP4824-GUIDE.md](EIP4824-GUIDE.md).

### `memory/`: daily logs (required)

`memory/YYYY-MM-DD.md`, one file per active day, appended to and never overwritten (the rule in `AGENTS.md`). A new instance gets the empty directory.

### `knowledge/`: knowledge pages (optional)

Pages compiled and indexed by `npm run knowledge:compile` and `npm run knowledge:update-index`: `knowledge/<domain>/<topic>.md`, a per-domain `index.md` and a top-level `knowledge/README.md`. The domains are declared in `data/knowledge-manifest.yaml`. A new instance starts with only `knowledge/INDEX.md`. The `idea-scout` skill also reads a `_index.yaml` per domain when one exists; nothing in `scripts/` creates it. An earlier version of this page also listed `exchange-log.yaml`; no script or skill reads or writes it, so it is not described here.

### `skills/`: agent skills (required)

One directory per skill with a `SKILL.md` that has YAML front matter. The framework repository has 37 directories here (36 skills and the generated `commands/` container). `skills/commands/` is a generated container (one `SKILL.md` per slash command, written by `npm run sync:commands`), not a skill itself. The validator needs at least one skill directory and warns for any without a `SKILL.md`. Skills and their promotion status are tracked in `data/skills-matrix.yaml`; an instance generates its own `SKILLS.md`.

### `packages/`: operational packages (required)

Self-contained packages. There is no enforced layout: of the 23 directories in the framework repository, 17 have a `package.json`, 18 have a `README.md`, 13 have a `src/` and one has a `SKILL.md`. An instance only receives the ones its clone config enables; `packages/operations/` (meeting and project templates, no `package.json`) is the usual one. See [PACKAGES.md](PACKAGES.md) for what each one does and [PACKAGE-LIFECYCLE.md](PACKAGE-LIFECYCLE.md) for their status.

### `scripts/`: operational scripts (required)

The machinery behind the npm scripts in `package.json`. The ones this page's subject depends on are `generate-all-schemas.mjs`, `validate-identity.mjs`, `validate-structure.mjs`, `clone-framework.mjs`, `clone-linked-repos.mjs` and `sync-upstream.mjs`. The full list with what each does is in [COMMANDS.md](COMMANDS.md). There is no Notion sync script; `npm run initialize` only reads Notion (see [TOOL-SETUP.md](TOOL-SETUP.md)).

### `docs/`: documentation (optional)

Operator and protocol documentation. Planning documents live in a directory whose name differs by tree: the framework repository keeps its own in the `agent-plans` directory under `docs/` (with a `QUEUE.md` there), while a generated instance gets `docs/plans/` with an empty `QUEUE.md`, and the clone rewrites references to the framework's directory in the instance's commands and docs to `docs/plans/`. See [PLANS.md](PLANS.md). Detail pages for ideas are written to `docs/ideas/<slug>.md` by the `idea-scout` skill (see [IDEA-HATCHING.md](IDEA-HATCHING.md)); that directory does not exist until the first idea is hatched.

### `repos/`: linked repositories (optional)

Clones of the external repositories declared in `repos.manifest.json`. Only `repos/README.md` is tracked.

### `schemas/`: reference schemas

`agents.json-ld`, `finances.json-ld`, `meetings.json-ld`, `node.json-ld`, `projects.json-ld`, `skills.json-ld`, `federation.yaml` (the manifest specification, v3.0) and `module.schema.json`. These are reference vocabularies; no script reads the JSON-LD files. `module.schema.json` mirrors the module contract that `scripts/modules.mjs` implements. Copied to instances.

### `templates/`: clone and render templates

`render.mjs`, the instance templates (`README.instance.md`, `CLAUDE.instance.md`, `AGENTS.instance.md`, `GETTING-STARTED.md`), `partials/`, `scaffold/` (the starting text of the identity files and three registries), `strings.yaml`, and one directory per supported language (`pt-BR/`).

### `tests/`: test suites

Run with `npm test` (`node --test "tests/**/*.test.mjs"`). `tests/clone-manifest.txt` pins the exact set of paths a clone of the test fixture contains.

### Framework-only directories

These exist in the framework repository and are not copied: `modules/` (module manifests, see [MODULES.md](MODULES.md)), `integrations/`, `site/` (this website), `graphify-out/` (the framework's knowledge graph), `renders/` (federation-map output), `deploy/` (`deploy/hub/`: the Hub's `Dockerfile`, its settings in `env.example` and the runbook `RAILWAY.md`), and `.agents/` (the maintainer's agent personas and materialised skills, kept in step by `npm run sync:agents` and `npm run sync:skills:berd`).

### Paths the Hub writes in an instance

The admin app (the Hub, `packages/admin`, run from the framework against an instance) creates these as it is used. A fresh clone has none of them, and `validate:structure` does not look for them:

| Path | What it holds |
|---|---|
| `pages/` | The workspace's pages, one Markdown file a page (`pages/<id>.md`), written one commit per editing session. |
| `data/collections/<id>.yaml` | The records of the org's own collections (see [DATA-MODEL.md](DATA-MODEL.md)). |
| `federation/outgoing/<id>.yaml` | The requests this instance sent to join a network (0.7.4). |
| `house/` | The instance's own look, all optional: `skin.css`, `themes.yaml` and `themes.css`, `bar.yaml`, `nav.yaml` and its images (0.7.1). The Hub reads them; it does not commit them. |
| `.org-os/private/` | The private store: what is stricter than members, and the sessions. The copied `.gitignore` names it, and the Hub refuses to open a store inside the repository that git does not ignore. Never committed. |

The Hub commits only under `data/`, `pages/`, `memory/`, `docs/plans/`, `docs/agent-plans/` and `federation/outgoing/`, and to `IDENTITY.md`, `federation.yaml`, `MEMORY.md`, `HEARTBEAT.md` and (in a ratify) `DECISIONS.md` (`assertWritablePath` in `packages/admin/server/git.ts`). See [ADMIN-APP.md](ADMIN-APP.md).

### Tool configuration directories

| Directory | Contents |
|---|---|
| `.claude/` | `commands/` (`close`, `commit`, `handoff`, `initialize`, `skills`, `sync`) and `settings.json`. |
| `.cursor/` | `commands/`, the same slash commands for Cursor. |
| `.opencode/` | `commands/`, `skills/`, `opencode.json`; `agents/` stays in the framework. |
| `.github/` | `hooks/pre-commit.sh`; workflows (`generate-schemas.yml` in every instance; `validate.yml`, `drift.yml`, `deploy-pages.yml` in the framework only). |
| `.agents/`, `.hermes/` | Framework only (see above). |

## Validation

`npm run validate:structure` (`scripts/validate-structure.mjs [path]`) runs these checks, in order:

1. The twelve required root files exist (listed under "Agent files" and "Configuration files").
2. The six required directories exist: `data`, `.well-known`, `memory`, `skills`, `packages`, `scripts`. A missing `knowledge`, `ideas`, `docs`, `repos`, `.claude` or `graphify-out` is a warning.
3. The six required `data/` files exist; missing optional registries are warnings.
4. When `federation.yaml` sets `identity.daoURI`, `.well-known/dao.json`, `members.json` and `projects.json` exist; every `.well-known/*.json` parses.
5. `skills/` has at least one skill directory, and each has a `SKILL.md`.
6. `federation.yaml` parses and has `identity` (with `name` and `type`), an `agent` section, and some federation participation (`network`, `peers`, `upstream` or `downstream`, or a legacy `federation:` section).
7. `package.json` has `generate:schemas` and `validate:schemas`; missing `clone:repos`, `setup` or `sync:upstream` is a warning.
8. Version consistency: `package.json` has a version, `federation.yaml` has `metadata.framework_version`, and a warning if `CHANGELOG.md` has no entry for the current version.
9. Lineage stamp: `metadata.genesis_commit` is a 40-character SHA (a warning when absent), and `last_sync_commit` is one when set.
10. If the matrix files are present: every `packages-matrix.yaml` entry has a valid `lifecycle_status` and every `skills-matrix.yaml` entry a valid `promotion_status`.

(In the script's own output these are sections 1 to 9, with the lineage stamp as 8b.) The command exits 1 if any check fails; warnings do not fail it. The validator does not look at the instance type: nothing in the code requires a different set of files for a hub or a resource library. An earlier version of this page had a table of per-type variations (`data/nodes.yaml`, `packages/aggregator/`); no code reads it and there is no `aggregator` package, so it was removed.
