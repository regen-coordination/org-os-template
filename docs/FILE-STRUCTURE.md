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
| `.claude/`, `.cursor/`, `.opencode/` | Slash commands, `.claude/settings.json` and `.opencode/opencode.json`. `.opencode/agents/` is not copied. |
| `.github/` | `hooks/pre-commit.sh` and `workflows/generate-schemas.yml` only. |
| `.well-known/` | The `*.json.template` files. Published `*.json` files are removed; `dao.json` is rendered for the new organisation; the rest come back on the first `npm run generate:schemas`. |
| `.env.example`, `.gitignore`, `.prettierignore`, `LICENSE`, `BOOTSTRAP.md` | As is (`.gitignore` gains a `docs/temp/` line). |
| `data/` | The registry files. `members`, `projects`, `ideas`, `relationships`, `ecosystems` and `governance` are reset to empty or to a scaffold. `instances.yaml`, `skills-matrix.yaml`, `packages-matrix.yaml` and `knowledge-gaps.yaml` are not carried over, and `data/federation/frontier/` is removed. |
| `docs/` | The operator documentation. Framework history is left out: `docs/agent-plans/`, `docs/superpowers/`, `docs/sessions/`, `docs/research/`, `docs/QUEUE.md`, and a list of framework-only pages (`POSITIONING.md`, `ECOSYSTEM.md`, `RAD-ORG-OS.md`, `QUILT.md`, `VAULT-SAFETY-CASE-STUDY.md` and others named in `EXCLUDE_FILES`). |
| `package.json`, `package-lock.json` | `package.json` is renamed for the new organisation, set to version `0.1.0` and `private: true`; npm scripts whose target file is not in the instance are dropped (20 of them in the test run for this page). |
| `packages/` | Only the packages set to `true` under `packages:` in the clone config. With no `packages:` block, none. |
| `skills/` | Only the skills listed under `skills:` in the config; every skill directory when the list is absent or empty. |
| `repos/`, `repos.manifest.json` | `repos/README.md`; the manifest's `repositories` list is emptied. |
| `schemas/`, `scripts/`, `templates/` | `scripts/` without `clone-manifest.mjs`, `render-templates.mjs` and `test-federation.sh` (and without `symbient-hatch.mjs` when the `symbient` skill is not selected). `templates/` carries the English set plus the instance's own language. |
| `tests/` | The suites that make sense in an instance. Framework-only suites (clone, instance-doctor, buzz, paper, module manifests) are left out. |

**Written fresh by the clone:** `IDENTITY.md`, `MASTERPLAN.md`, `MEMORY.md`, `HEARTBEAT.md`, `SOUL.md`, `USER.md`, `TOOLS.md`, `DECISIONS.md`, `federation.yaml` (with a lineage stamp), `README.md`, `GETTING-STARTED.md`, `CLAUDE.md`, `AGENTS.md`, `dashboard.yaml`, `memory/.gitkeep`, `knowledge/INDEX.md`, `docs/plans/QUEUE.md`, and empty `docs/superpowers/{specs,plans,research}/`.

**Not copied, framework only:** `.agents/`, `.hermes/`, `CHANGELOG.md`, `VERSION.md`, `SKILLS.md` (the instance makes its own with `npm run generate:skills`), `SYNC-GUIDE.md`, `PAPERCLIP_DEPLOYMENT_GUIDE.md`, `RESEARCH_INTELLIGENCE_PLAN.md`, `graphify-out/`, `renders/`, `site/`, `integrations/`, `modules/`, and the contents of the framework's own `knowledge/` and `memory/`.

After the clone, the instance still needs `npm install`, `npm run generate:schemas` and `npm run validate:structure`; the clone prints that list when it finishes. A fresh clone passes `validate:structure` once `generate:schemas` has produced `members.json` and `projects.json`, with warnings for the optional pieces it does not have.

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

The framework repository also has `ecosystems.yaml`, `instances.yaml`, `skills-matrix.yaml`, `packages-matrix.yaml` and `data/federation/frontier/` (a cache of what the framework knows of its peers). What each file holds is in [DATA-MODEL.md](DATA-MODEL.md).

### `.well-known/`: EIP-4824 files (required)

Generated by `npm run generate:schemas` from `data/` and `federation.yaml`. Edit the sources, not these files. The validator requires `dao.json`, `members.json` and `projects.json`, and checks that every `*.json` in the directory parses.

| File | Built from |
|---|---|
| `dao.json` | `dao.json.template` plus `identity` in `federation.yaml`; only written when `identity.daoURI` is set |
| `members.json` | `data/members.yaml` (member ids only) |
| `projects.json` | `data/projects.yaml`, plus `content/projects/*.md` front matter when that directory exists |
| `finances.json` | `data/finances.yaml` (`budgets`, `expenses`, `revenues`) |
| `meetings.json` | `data/meetings.yaml`, plus `content/meetings/*.md` when that directory exists |
| `proposals.json` | `governance.decisions` in `data/governance.yaml` |
| `activities.json` | the last 20 entries of `data/meetings.yaml` |
| `contracts.json` | `identity.safe` and `identity.gardens` in `federation.yaml` |
| `ideas.json` | `data/ideas.yaml` |
| `knowledge.json` | `data/knowledge-manifest.yaml` and `data/sources.yaml` |
| `skills.json` | written by `npm run generate:skills`, not by `generate:schemas` |

Each `*.json` except `skills.json` has a `*.json.template` beside it.

### `memory/`: daily logs (required)

`memory/YYYY-MM-DD.md`, one file per active day, appended to and never overwritten (the rule in `AGENTS.md`). A new instance gets the empty directory.

### `knowledge/`: knowledge pages (optional)

Pages compiled and indexed by `npm run knowledge:compile` and `npm run knowledge:update-index`: `knowledge/<domain>/<topic>.md`, a per-domain `index.md` and a top-level `knowledge/README.md`. The domains are declared in `data/knowledge-manifest.yaml`. A new instance starts with only `knowledge/INDEX.md`. The `idea-scout` skill also reads a `_index.yaml` per domain when one exists; nothing in `scripts/` creates it. An earlier version of this page also listed `exchange-log.yaml`; no script or skill reads or writes it, so it is not described here.

### `skills/`: agent skills (required)

One directory per skill with a `SKILL.md` that has YAML front matter. The framework repository has 37 directories here (36 skills and the generated `commands/` container). `skills/commands/` is a generated container (one `SKILL.md` per slash command, written by `npm run sync:commands`), not a skill itself. The validator needs at least one skill directory and warns for any without a `SKILL.md`. Skills and their promotion status are tracked in `data/skills-matrix.yaml`; an instance generates its own `SKILLS.md`.

### `packages/`: operational packages (required)

Self-contained packages. There is no enforced layout: of the 22 directories in the framework repository, 16 have a `package.json`, 17 have a `README.md`, 12 have a `src/` and one has a `SKILL.md`. An instance only receives the ones its clone config enables; `packages/operations/` (meeting and project templates, no `package.json`) is the usual one. See [PACKAGES.md](PACKAGES.md) for what each one does and [PACKAGE-LIFECYCLE.md](PACKAGE-LIFECYCLE.md) for their status.

### `scripts/`: operational scripts (required)

The machinery behind the npm scripts in `package.json`. The ones this page's subject depends on are `generate-all-schemas.mjs`, `validate-identity.mjs`, `validate-structure.mjs`, `clone-framework.mjs`, `clone-linked-repos.mjs` and `sync-upstream.mjs`. The full list with what each does is in [COMMANDS.md](COMMANDS.md). There is no Notion sync script; `npm run initialize` only reads Notion (see [TOOL-SETUP.md](TOOL-SETUP.md)).

### `docs/`: documentation (optional)

Operator and protocol documentation. Planning documents live in a directory whose name differs by tree: the framework repository keeps its own in `docs/agent-plans/` (with `QUEUE.md`), while a generated instance gets `docs/plans/` with an empty `QUEUE.md`, and the clone rewrites references to `docs/agent-plans/` in the instance's commands and docs to `docs/plans/`. See [PLANS.md](PLANS.md). Detail pages for ideas are written to `docs/ideas/<slug>.md` by the `idea-scout` skill (see [IDEA-HATCHING.md](IDEA-HATCHING.md)); that directory does not exist until the first idea is hatched.

### `repos/`: linked repositories (optional)

Clones of the external repositories declared in `repos.manifest.json`. Only `repos/README.md` is tracked.

### `schemas/`: reference schemas

`agents.json-ld`, `finances.json-ld`, `meetings.json-ld`, `node.json-ld`, `projects.json-ld`, `skills.json-ld`, `federation.yaml` (the manifest specification, v3.0) and `module.schema.json`. These are reference vocabularies; no script reads the JSON-LD files. `module.schema.json` mirrors the module contract that `scripts/modules.mjs` implements. Copied to instances.

### `templates/`: clone and render templates

`render.mjs`, the instance templates (`README.instance.md`, `CLAUDE.instance.md`, `AGENTS.instance.md`, `GETTING-STARTED.md`), `partials/`, `scaffold/` (the starting text of the identity files and three registries), `strings.yaml`, and one directory per supported language (`pt-BR/`).

### `tests/`: test suites

Run with `npm test` (`node --test "tests/**/*.test.mjs"`). `tests/clone-manifest.txt` pins the exact set of paths a clone of the test fixture contains.

### Framework-only directories

These exist in the framework repository and are not copied: `modules/` (module manifests, see [MODULES.md](MODULES.md)), `integrations/`, `site/` (this website), `graphify-out/` (the framework's knowledge graph), `renders/` (federation-map output) and `.agents/` (the maintainer's agent personas and materialised skills, kept in step by `npm run sync:agents` and `npm run sync:skills:berd`).

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
4. `.well-known/dao.json`, `members.json` and `projects.json` exist, and every `.well-known/*.json` parses.
5. `skills/` has at least one skill directory, and each has a `SKILL.md`.
6. `federation.yaml` parses and has `identity` (with `name` and `type`), an `agent` section, and some federation participation (`network`, `peers`, `upstream` or `downstream`, or a legacy `federation:` section).
7. `package.json` has `generate:schemas` and `validate:schemas`; missing `clone:repos`, `setup` or `sync:upstream` is a warning.
8. Version consistency: `package.json` has a version, `federation.yaml` has `metadata.framework_version`, and a warning if `CHANGELOG.md` has no entry for the current version.
9. Lineage stamp: `metadata.genesis_commit` is a 40-character SHA (a warning when absent), and `last_sync_commit` is one when set.
10. If the matrix files are present: every `packages-matrix.yaml` entry has a valid `lifecycle_status` and every `skills-matrix.yaml` entry a valid `promotion_status`.

(In the script's own output these are sections 1 to 9, with the lineage stamp as 8b.) The command exits 1 if any check fails; warnings do not fail it. The validator does not look at the instance type: nothing in the code requires a different set of files for a hub or a resource library. An earlier version of this page had a table of per-type variations (`data/nodes.yaml`, `packages/aggregator/`); no code reads it and there is no `aggregator` package, so it was removed.
