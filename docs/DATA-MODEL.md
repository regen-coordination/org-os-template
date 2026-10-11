# Data model

org-os keeps an organisation's structured data as YAML registries in `data/`. They are the source of truth: the `.well-known/` files, the `/initialize` dashboard and agent queries all read from them. After any change:

```bash
npm run generate:schemas && npm run validate:schemas
```

For where these files sit in the tree, and which of them a new instance receives, see [FILE-STRUCTURE.md](FILE-STRUCTURE.md).

## What the code actually checks

Read this before trusting a field table. The framework's scripts check far less than the tables below suggest.

- **`npm run validate:schemas`** (`scripts/validate-identity.mjs`) parses seven `.well-known/*.json` files and compares `IDENTITY.md` with `federation.yaml`. It does not read `data/*.yaml`; it also checks the lineage stamp in `federation.yaml` (`framework_version`, `genesis_commit`, `last_sync_commit`).
- **`npm run validate:structure`** (`scripts/validate-structure.mjs`) checks that the files exist, and that every entry of `skills-matrix.yaml` and `packages-matrix.yaml` has a valid status. It does not check any other registry's fields.
- **`npm run generate:schemas`** reads some registries and copies some fields into `.well-known/` (each registry section below says who reads it).
- **The admin app** (`packages/admin`, `npm run admin`) validates an entry against `packages/admin/schemas/<registry>.schema.json` before saving it. Those JSON Schemas are the only machine-readable definition of the field names, types and enums below; the type, enum and "required" columns in this page come from them. Only `id` is required, and only in the collection registries; free-form fields (strings, numbers, lists, maps) are optional and accept `null`; an enum field must be omitted or hold one of the listed values. `finances`, `governance` and `knowledge-manifest` (the document registries) are read-only in the admin app. Extra fields are allowed. The enums are enforced only when an entry is saved through the admin app; real files already use values outside them (flagged below).
- Everything else, including the example values, is convention.

## Conventions

- A registry file is a YAML map. Most hold one list under a plural key (`members:`, `projects:`). The keys do not always match the filename: `funding-opportunities.yaml` uses `opportunities` (or `funding_opportunities`), `knowledge-manifest.yaml` uses `knowledge_manifest`, `knowledge-gaps.yaml` uses `gaps`, and `finances.yaml` has `budgets`, `expenses` and `revenues` at the top level, with no wrapper.
- Entries in a list have an `id`, unique within the file. It is a free string; this repository's own members use `github:<handle>`.
- Dates are ISO 8601 (`YYYY-MM-DD`).
- Status vocabularies are per registry. They are not uniformly lower-case: the projects in this repository use `Discovery` and `Develop`.
- Files carry a `schema_version: "2.0"` line. All of this repository's registries have it except `ecosystems.yaml`.
- The files shipped in `data/` are mostly empty, and the empty ones (`finances`, `meetings`, `events`, `channels`, `assets`, `sources`, `funding-opportunities`, `knowledge-manifest`) end in a commented example entry; open the file to see one.

## Registries in `data/`

This repository has 18 YAML files in `data/` (counted, not assumed). The validator knows 14 of them; three are framework-only; one, `ecosystems.yaml`, was not documented before.

| File | Top-level key | Kind | Checked by `validate:structure` | Entries in this repository |
|---|---|---|---|---|
| `members.yaml` | `members` | list | required | 1 |
| `projects.yaml` | `projects` | list | required | 13 |
| `finances.yaml` | `budgets`, `expenses`, `revenues` | document | required | none |
| `governance.yaml` | `governance` | document | required | 2 decisions |
| `meetings.yaml` | `meetings` | list | required | none |
| `ideas.yaml` | `ideas` | list | required | 9 |
| `funding-opportunities.yaml` | `opportunities` or `funding_opportunities` | list | optional | none |
| `relationships.yaml` | `relationships` | list | optional | 7 |
| `sources.yaml` | `sources` | list | optional | none |
| `knowledge-manifest.yaml` | `knowledge_manifest` | document | optional | none |
| `events.yaml` | `events` | list | optional | none |
| `channels.yaml` | `channels` | list | optional | none |
| `assets.yaml` | `assets` | list | optional | none |
| `knowledge-gaps.yaml` | `gaps` | list, generated | optional | 268 |
| `ecosystems.yaml` | `ecosystems` | list | not checked | 3 |
| `instances.yaml` | `instances` | list | not checked | 8 |
| `skills-matrix.yaml` | `skills` | list | status values checked | 42 |
| `packages-matrix.yaml` | `packages` | list | status values checked | 27 |

The tables below give `Field`, `Type` and `Notes`. "date" means a string in `YYYY-MM-DD`. A field is optional unless the registry's "Required" line says otherwise.

### members.yaml: people and roles

Required field: `id`. Read by `generate:schemas` (only the `id` goes into `members.json`) and by the dashboard (`name`, `role`, `layer`, `status`, `joined`).

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `name`, `role` | string | |
| `layer` | `core` \| `contributor` \| `community` \| `observer` | |
| `status` | `active` \| `inactive` \| `alumni` | dashboard defaults a missing status to `active` |
| `joined`, `left` | date | |
| `skills` | list of strings | |
| `handles` | map of strings | e.g. `github`, `telegram`, `email` |
| `affiliations` | list | |

This repository's own entry also uses `pronouns`, `timezone` and `also_operates`, which no schema lists.

```yaml
schema_version: "2.0"
members:
  - id: "operator"
    name: "Your Name"
    role: "Operator"
    layer: "core"
    status: "active"
    joined: "2026-10-10"
```

### projects.yaml: initiatives

Required field: `id`. `generate:schemas` copies each entry into `projects.json` unchanged (and adds any `content/projects/*.md` file with an `id` in its front matter, if that directory exists). The dashboard shows `title` (or `name`), `status` (default `idea`), `lead` and `owner`. This repository's projects also carry `members` and `researchArtifacts`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `title` | string | this repository's entries use `name` instead |
| `status` | string | the vocabulary is the instance's own. Suggested: `idea`, `develop`, `execute`, `archive`. This repository uses `Discovery` and `Develop` |
| `type` | string | suggested: `program`, `initiative`, `workstream`, `experiment` |
| `lead` | string | a member `id` |
| `contributors` | list of strings | member ids |
| `started`, `target_completion` | date | this repository uses `startDate` |
| `description` | string | |
| `milestones` | list of maps | |
| `related_ideas` | list of strings | idea ids |
| `funding_source` | string | an opportunity `id` |
| `tags` | list of strings | |

### finances.yaml: budgets, expenses, revenues

A document, not a list. **Use the flat shape**: `budgets:`, `expenses:` and `revenues:` at the top level, as the shipped file does. It is the only shape `generate:schemas` reads (`scripts/generate-all-schemas.mjs` reads `financesData?.budgets` and its siblings); the same top-level lists are what `finances.json` carries.

The two readers disagree:

- The admin app looks for the lists under a `finances:` key (`topKey: 'finances'` in `packages/admin/server/registries.ts`; `readRegistry` returns `{}` when the key is absent). Its schema, `finances.schema.json`, lists `budgets` and the others as properties of that document. So in `npm run admin` the shipped flat file shows as an empty document. Nothing is lost: finances is a document registry and document registries are read-only in the admin app.
- If you wrap the lists in `finances:`, the admin app shows them, but `generate:schemas` writes an empty `finances.json`. Do not wrap them.

This page documents the generator's shape. The `treasury` map in the admin schema is ignored by `generate:schemas`.

The commented examples in the shipped file give these entry fields:

| List | Fields |
|---|---|
| `budgets` | `id`, `name`, `period`, `currency`, `totalAllocated` |
| `expenses` | `id`, `date`, `amount`, `currency`, `category`, `description`, `recipient`, `status` |
| `revenues` | `id`, `date`, `amount`, `currency`, `source`, `description`, `status` |

The admin app types the three lists as lists of maps and enforces no entry fields.

### governance.yaml: decisions and elections

A document under the `governance` key. `generate:schemas` turns `governance.decisions` into `proposals.json` (keeping `id`, `title`, `type`, `status`, `date`, `summary`). Nothing in the scripts reads `elections`.

| Field | Type | Notes |
|---|---|---|
| `model` | string | the admin enum is `steward-council`, `multisig`, `assembly`, `conviction`; the scaffold and this repository use `solo-maintainer` |
| `current_phase` | `bootstrap` \| `transition` \| `active` \| `sunset` | |
| `infrastructure` | map | `safe`, `hats_tree`, `gardens`, `snapshot`, each `null` or a value |
| `decisions` | list of maps | entry fields in use: `id`, `title`, `type`, `status`, `date`, `passed_by`, `summary`. `type` and `status` are free strings; this repository uses `amendment` and `ratified` |
| `elections` | list of maps | free-form |

### meetings.yaml: meeting records

Required field: `id`. Read by `generate:schemas` (all of them into `meetings.json`, the last 20 into `activities.json`) and the dashboard (`title`, `date`).

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `title` | string | |
| `date` | date | |
| `type` | `sync` \| `assembly` \| `workshop` \| `standup` \| `ad-hoc` | |
| `participants` | list of strings | member ids |
| `duration_minutes` | number | |
| `recording_url`, `transcript_path`, `summary` | string | |
| `decisions` | list of strings | |
| `action_items` | list of maps | e.g. `assignee`, `task`, `due`, `status` |
| `tags` | list of strings | |

### ideas.yaml: the ideas pipeline

Required field: `id`. Lifecycle and the hatching process: [IDEA-HATCHING.md](IDEA-HATCHING.md). `generate:schemas` copies the entries into `ideas.json`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `title` | string | |
| `status` | `surfaced` \| `proposed` \| `approved` \| `developing` \| `hatched` \| `archived` | dashboard defaults a missing status to `surfaced` |
| `source` | string | a file path, such as a knowledge page; not a registry id |
| `submitted_by` | string | `agent`, `symbient` or a member id |
| `champions` | list of strings | |
| `ecosystem_gap`, `description` | string | |
| `hatched_repo` | string | |
| `skills_needed` | list of strings | |
| `resources` | list | |
| `compensation` | map | |
| `created`, `updated` | date | |
| `votes` | number | |
| `comments` | list | |

`submitted_by: "symbient"` marks an entry surfaced by a symbient practice (deep-weave only); it is deliberately anonymous and never identifies a particular being or habitat. See `skills/symbient/SKILL.md`.

### funding-opportunities.yaml: grants and rounds

Required field: `id`. The dashboard accepts either top-level key, `opportunities` or `funding_opportunities` (`scripts/initialize.mjs`), and so does the admin app. Two entry shapes are in use, and they do not agree:

- The shape the `funding-scout` skill writes and the shipped file's example shows: `id`, `platform`, `fund`, `deadline`, `domain`, `amount_range`, `matching`, `url`, `status` (`pending`, `applied`, `approved`, `rejected`, `expired`), `eligible`, `relevant_nodes`, `discovered_by`, `discovered_date`, `source_refs`, `notes`. This is what the top-level key `opportunities` goes with.
- The shape the admin app's schema describes:

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `title` | string | |
| `type` | `grants-round` \| `rfp` \| `bounty` \| `retroactive` \| `investment` | |
| `platform` | string | |
| `status` | `upcoming` \| `open` \| `closed` \| `awarded` | |
| `deadline` | date | |
| `amount_available` | number | |
| `currency` | string | |
| `relevance` | `high` \| `medium` \| `low` | |
| `url`, `notes` | string | |
| `applied` | boolean | |
| `application_id` | string | |

The dashboard reads `deadline` and `status` from either shape: an entry whose deadline has passed is dropped, whatever its status; otherwise entries with status `applied` or `awarded` count as active, entries without a deadline count as active when their status is `active`, `applied` or `open`, and other future-dated entries are listed as upcoming.

### relationships.yaml: partnerships

Required field: `id`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `partner` | string | |
| `type` | `alliance` \| `collaboration` \| `funding` \| `advisory` \| `peer` | |
| `status` | `active` \| `dormant` \| `completed` \| `proposed` | |
| `since` | date | |
| `contact`, `description` | string | |
| `touchpoints` | list | this repository's entries use a list of strings |

### sources.yaml: content sources

Required field: `id`. Read by `generate:schemas` (`id`, `name`, `type`, `url` or `feed_url`, `status` go into `knowledge.json`).

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `name`, `url`, `feed_url` | string | |
| `type` | `blog` \| `podcast` \| `newsletter` \| `github` \| `forum` \| `social` | |
| `status` | `active` \| `paused` \| `archived` | |
| `last_synced` | date | |
| `sync_method` | `rss` \| `api` \| `manual` \| `scrape` | |
| `content_count` | number | |
| `tags` | list of strings | |

### knowledge-manifest.yaml: knowledge domains

A document under `knowledge_manifest`, with no required fields. `npm run knowledge:update-index` updates page counts and dates in it; `generate:schemas` copies it into `knowledge.json`.

| Field | Type | Notes |
|---|---|---|
| `domains` | list of maps | entry fields in use: `id`, `name`, `description`, `coverage` (`none`, `partial`, `comprehensive`), `page_count`, `sources` (source ids), `last_updated` |
| `exchange` | map | `published_domains` and `subscribed_domains`, lists of domain ids |

### events.yaml: events and milestones

Required field: `id`. The dashboard reads `title`, `date`, `end_date`, `type`, `location`, `url`, `related_project`, `status` and hides cancelled events.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `title` | string | |
| `type` | `assembly` \| `workshop` \| `deadline` \| `milestone` \| `call` \| `conference` | |
| `date`, `end_date` | date | |
| `recurrence` | string | `weekly`, `monthly`, `quarterly` or `null` |
| `location` | string | |
| `url`, `notes` | string | |
| `related_project` | string | a project `id` |
| `participants` | list of strings | |
| `status` | `upcoming` \| `completed` \| `cancelled` | |

### channels.yaml: communication channels

Required field: `id`. No script in `scripts/` reads this file; only the admin app does.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `platform` | `telegram` \| `discord` \| `forum` \| `email` \| `slack` \| `signal` \| `matrix` | |
| `name`, `url`, `purpose`, `managed_by` | string | |
| `visibility` | `public` \| `members` \| `core` \| `private` | |
| `topics` | list of strings | |
| `status` | `active` \| `archived` \| `migrating` | |

### assets.yaml: organisational assets

Required field: `id`. No script in `scripts/` reads this file; only the admin app does.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `type` | `domain` \| `account` \| `credential` \| `brand` \| `tool` \| `document` \| `contract` | record where a credential lives, never its value |
| `name`, `platform`, `url`, `owner`, `notes` | string | |
| `status` | `active` \| `expired` \| `pending` \| `transferred` | |
| `renewal_date` | date | |

### knowledge-gaps.yaml: gaps in the knowledge graph (generated)

Written by `npm run graph:gaps` (`scripts/graph-gaps.mjs`) from `graphify-out/graph.json`. Only `status` is edited by hand; a re-run keeps the status and first-seen date of gaps it finds again, drops open gaps that are no longer detected, and keeps `curated` and `dismissed` ones. The dashboard shows the count of open gaps. Not copied into a new instance.

| Field | Type | Notes |
|---|---|---|
| `id` | string | the first 12 hex characters of a SHA-256 over the gap's `kind` and its sorted `node_ids` |
| `kind` | `orphan` \| `ambiguous-edge` \| `weak-community` | |
| `node_ids` | list of strings | graph node ids |
| `summary` | string | |
| `status` | `open` \| `curated` \| `dismissed` | |
| `detected` | date | |

### ecosystems.yaml: ecosystem nodes for the federation map

A list under `ecosystems` with `id`, `name`, `url` and `sources` (ids of source systems the ecosystem groups). Read by the federation map (`packages/org-os-kms/src/map.mjs`), which draws each entry as an outer-ring node. It has no `schema_version` line, no admin schema and is not checked by any validator. A new instance receives it reset to an empty list.

## Framework-only registries

These track state across instances, not an organisation's own data. A new instance does not receive them, and `validate:structure` only warns when they are absent.

### instances.yaml: downstream instances

One entry per instance the framework knows of, maintained by hand and read by `npm run analyze:instances`, which compares it with the instances' directories and writes a drift report. Fields: `id`, `name`, `type`, `maturity` (`alpha`, `beta` or `production`), `repo`, `local_path`, `cloned`, `federation_network`, `federation_role`, `masterplan_version`, `framework_version`, `last_sync`, `agent_runtime` (list), `skills_extra` (list), `packages` (list), `data_registries_extra` (list), `drift` (list), `notes`. Every one of the eight entries here has all of these.

One more field is optional: `listed` (boolean, default `true`). Set `listed: false` to keep an entry off any public list of registered instances, and out of the count printed beside that list. It changes only what is shown. `npm run analyze:instances`, the quilt (`npm run generate:quilt`) and the dashboard still read every entry, listed or not, and no code in this repository filters on the field yet. The operator decided on 2026-10-11 that the site's federation page leaves unlisted entries out of its list and its count (see [DECISIONS.md](../DECISIONS.md)); that change to the site has not landed at the time of writing. Two entries set it to `false`: `bread-coop-os`, a fictional test cooperative, and `openclaw`, an agent runtime. `tests/scripts/instances-listed.test.mjs` checks that the value is a boolean and that exactly these two are `false`.

### skills-matrix.yaml: skills across the federation

Fields per entry: `id`, `owner`, `instances_using` (list), `in_framework` (boolean), `promotion_status`, `notes`. `promotion_status` is one of `canonical`, `evaluating`, `candidate`, `instance-specific`, `deprecated` (the set the validator accepts; the file's header lists the same five). See [SKILL-PROMOTION.md](SKILL-PROMOTION.md).

### packages-matrix.yaml: packages across the federation

The same fields as the skills matrix, plus `lifecycle_status`: `active`, `dormant`, `planned` or `retired`. The validator warns when it is missing and fails when it is anything else. See [PACKAGE-LIFECYCLE.md](PACKAGE-LIFECYCLE.md).

## Registries created by the knowledge system

When an instance runs the knowledge system (`packages/org-os-kms`), binding its framework schemas to org-os registries creates more files under `data/`: `resources.yaml`, `source-systems.yaml`, `option-library.yaml`, `tracks.yaml`, `deployments.yaml`, `implementation-memory.yaml`, `evolution-log.yaml`, `signals.yaml` and `contributions.yaml` (the mapping is `REGISTRY_BINDINGS` in `packages/org-os-kms/src/bind.mjs`). None exists in this repository's `data/`. Their fields are defined by the schemas in `packages/toolkit-framework/schemas/`, not by this page; the knowledge system is described in [KMS.md](KMS.md).

## Instance extensions

An instance may add registries of its own (`tasks.yaml`, `pending-payouts.yaml` and so on). Convention:

- Declare the extra registry in `data_registries_extra` of the instance's entry in the framework's `data/instances.yaml`. `npm run analyze:instances` reports `undeclared_data_registry:<name>` for any `data/` YAML file that is neither in its built-in list of canonical registries nor declared. That list contains the first 13 registries above and the three framework-only ones; it does not contain `knowledge-gaps` or `ecosystems`.
- Keep it out of `.well-known/` unless publishing an endpoint is intended: `generate:schemas` writes a fixed set of files and ignores everything else.
- Follow the conventions above: `schema_version: "2.0"` and entries with a unique `id`.

`data/instances.yaml` records these extension registries in use by sibling instances: `hermes-cron`, `orgs`, `figma-assets`, `tasks`, `pending-payouts`, `nodes`, `funds`, `initiatives`, `programs`, `option-library`, `ontology` and others. The shapes below are the ones described for them in earlier versions of this page; the files live in those instances, so they were not verified against code or data in this repository.

**`hermes-cron.yaml`**: scheduled jobs for a proactive-agent gateway (see `packages/hermes-integration`).

```yaml
schema_version: "1.0"
jobs:
  - id: "heartbeat-6h"
    schedule: "0 */6 * * *"      # cron, UTC
    deliver: "telegram"          # delivery channel
    channel: null                # channel or topic id, instance-specific
    prompt: |
      Read HEARTBEAT.md and report anything urgent or overdue.
```

Keep channel ids and prompts in the instance; the reusable part is the shape. The `hermes-integration` README confirms only that this file name exists and that a symbient must never be given a job in it.

**Hub registries** (`nodes.yaml`, `funds.yaml`, `initiatives.yaml`, `programs.yaml`): a network-of-networks graph for an instance that coordinates other organisations. Fields as described earlier: `nodes` (`id`, `name`, `network`, `type`, `location`, `status`, `repo`, `website`); `funds` (`id`, `type`, `network_chain`, `address`, `node` pointing to `nodes.id`, `signers`, `status`); `initiatives` (`id`, `name`, `networks`, `status`, `description`); `programs` (`id`, `name`, `category`, `status`).

**Others** named in the same earlier audit: `orgs.yaml` (an external-organisation directory) and `figma-assets.yaml` (a design-asset registry with a share policy per asset).

## Cross-references

Fields that hold the id of an entry in another registry. These are the pairs the admin app checks when it saves (`REFS` in `packages/admin/server/schema.ts`):

| From | To | Via field |
|---|---|---|
| projects.yaml | members.yaml | `lead`, `contributors` |
| projects.yaml | ideas.yaml | `related_ideas` |
| projects.yaml | funding-opportunities.yaml | `funding_source` |
| meetings.yaml | members.yaml | `participants` |
| events.yaml | projects.yaml | `related_project` |

`ideas.source` is not a cross-reference: it is a path to a knowledge file.

## Generating the `.well-known/` files

```bash
npm run generate:schemas    # .well-known/*.json from data/*.yaml and federation.yaml
npm run validate:schemas    # the .well-known files parse; IDENTITY.md and federation.yaml agree
npm run analyze:instances   # framework only: scan downstream instances, write a drift report to memory/reports/
```

Which `.well-known/` file comes from which source is in [FILE-STRUCTURE.md](FILE-STRUCTURE.md). The EIP-4824 side is in [EIP4824-GUIDE.md](EIP4824-GUIDE.md).

## Notion

The dashboard (`npm run initialize`) can read Notion databases into the projects, meetings and members it shows. There is no Notion sync that writes `data/*.yaml`: an earlier version of this page documented an `npm run sync:notion` script, which does not exist in `package.json` or `scripts/`. See [TOOL-SETUP.md](TOOL-SETUP.md).
