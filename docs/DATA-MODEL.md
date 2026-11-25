# Data model

org-os keeps an organisation's structured data as YAML registries in `data/`. They are the source of truth: the `.well-known/` files, the `/initialize` dashboard, the admin app and agent queries all read from them. After any change:

```bash
npm run generate:schemas && npm run validate:schemas && npm run validate:data
```

For where these files sit in the tree, and which of them a new instance receives, see [FILE-STRUCTURE.md](FILE-STRUCTURE.md).

## What the code actually checks

Read this before trusting a field table: it says which script checks what.

- **`npm run validate:data`** (`scripts/validate-data.mjs`, new in 0.6) checks every registry file in the admin's list (`packages/admin/lib/registries.mjs`) that exists against its JSON Schema in `packages/admin/schemas/`. It goes through `packages/admin/lib/data-validate.mjs`, the module the admin app saves through, so the two cannot disagree. An **error** is a file or an entry that is not what its schema says, and fails the run. A **warning** is something to look at that breaks nothing today (a reference to an id this instance does not hold, an entry with no id or a repeated one, a System kind no driver knows, the deprecated `infrastructure` block, a missing `governance.yaml`), and never fails it. Beyond the schemas, it checks the governance roles and rules against `members.yaml` and `systems.yaml`, the proposals ledger, the library's receipts, and that git holds nothing stricter than members (see `visibility.yaml` below). It runs from the framework against any instance: `node scripts/validate-data.mjs <path>`. It needs the admin's dependencies (`npm ci --prefix packages/admin`); without them it stops with exit code 2.
- **`npm run validate:governance`** (`scripts/validate-governance.mjs`, 0.6) checks the roles and rules again (always errors), then walks the first-parent git history: a commit that touches a file a rule governs, whose author could not apply it alone under the rules of the commit's parent, needs an `Org-Proposal` trailer naming a ratified proposal, and a commit that touches `data/proposals.yaml` is judged as a write to the ledger. History findings are warnings locally and errors with `--strict` or `CI=true`; it never stops a commit. A history with no written rules is not judged. Details under "Roles and rules", in the `governance.yaml` section.
- **`npm run validate:schemas`** (`scripts/validate-identity.mjs`) parses seven `.well-known/*.json` files, compares `IDENTITY.md` with `federation.yaml`, and checks the lineage stamp in `federation.yaml` (`framework_version`, `genesis_commit`, `last_sync_commit`). When `identity.daoURI` is set, it also checks the published standards files against their JSON Schemas (a problem is a warning, an error under `--strict`) and reads the registries to scan `.well-known/` for any value they withhold (a leak always fails). Without a `daoURI` it does not read `data/*.yaml`.
- **`npm run validate:structure`** (`scripts/validate-structure.mjs`) checks that files exist, and that every entry of `skills-matrix.yaml` and `packages-matrix.yaml` has a valid status. It does not check any other registry's fields. It requires `.well-known/dao.json`, `members.json` and `projects.json` only when `identity.daoURI` is set.
- **`npm run generate:schemas`** (`scripts/generate-all-schemas.mjs`, which loads the builder in `packages/admin/lib/standards/`) writes `.well-known/` from `federation.yaml`, the registries and the Markdown records in `content/meetings/` and `content/projects/`. It builds nothing without `identity.daoURI`, because every id is built from it; this repository leaves `daoURI` empty, so here it writes nothing. It publishes only what `data/visibility.yaml` makes public. A collection that file does not list is `members`, so an instance with no `visibility.yaml` publishes no records. What it withholds is counted, never written, and a withheld value found in a built file stops every write. Each registry section below names the file it feeds.
- **The admin app** (`packages/admin`, `npm run admin`) validates an entry with the same module before saving it (`validateEntity` in `packages/admin/server/schema.ts`), and refuses the save on an error or on a reference to an id the target registry does not hold. The JSON Schemas are the only machine-readable definition of the field names, types and enums below; the type, enum and "required" notes in this page come from them. In the older registries only `id` is required, and only in the collections; the 0.6 registries require more (each section says which). Optional fields accept `null`; an enum field must be omitted or hold one of the listed values. Extra fields are allowed, except in `boards`, `proposals`, `library`, `federation-requests` and `invites`. The document registries (`finances`, `governance`, `knowledge-manifest` and `visibility`) are read-only in the admin app; `proposals` and `library` are written only by their own routes (proposing and deciding; the library's Add and Remove).
- Everything else, including the example values, is convention.

## Conventions

- A registry file is a YAML map. Most hold one list under a plural key (`members:`, `projects:`). The keys do not always match the filename: `funding-opportunities.yaml` uses `opportunities` (or `funding_opportunities`), `knowledge-manifest.yaml` uses `knowledge_manifest`, `knowledge-gaps.yaml` uses `gaps`, `library.yaml` uses `installed`, and `finances.yaml` has `budgets`, `expenses` and `revenues` at the top level, with no wrapper.
- Entries in a list have an `id`, unique within the file and **opaque**: never parsed and never rewritten, because every `source_refs`, cross-reference and commit trail depends on it. Instances use `github:<handle>` (as this repository's own members do), `did:…`, `exampledao:role:…` and bare slugs, and the same person carries a different id in each repository. An entry with no id, or with an id an earlier entry already uses, is a `validate:data` warning, and the admin will not edit it.
- Dates are ISO 8601 (`YYYY-MM-DD`).
- Fields that name a kind or a stage (`status`, `type`, `platform`, members' `layer`) are the instance's own vocabulary. Where the tables below list words with `|`, the schema holds a closed list (members' `kind` and `status`, `governance.model`, and a few others); elsewhere the words given are the framework's defaults, and any word is accepted. They are not uniformly lower-case: the projects in this repository use `Discovery` and `Develop`.
- Files carry a `schema_version` line. The older registries use `"2.0"` (all of this repository's have it except `ecosystems.yaml`); the 0.6 migration writes `systems.yaml` with `"1.0"`, and this page's examples of the other 0.6 registries use `"1.0"` too. Nothing checks it.
- A record may carry `visibility: public` or `visibility: members`, which decides whether `generate:schemas` and the admin's public view show it (see `visibility.yaml`). `boards`, `proposals`, `library`, `federation-requests` and `invites` allow no key their schema does not list, so their records cannot.
- The files shipped in `data/` are mostly empty, and the empty ones (`finances`, `meetings`, `events`, `channels`, `assets`, `sources`, `funding-opportunities`, `knowledge-manifest`) end in a commented example entry; open the file to see one.

## Registries in `data/`

This repository has 18 YAML files in `data/` (counted, not assumed). The admin's registry list, which `validate:data` checks, holds 14 of them; three are framework-only; one, `ecosystems.yaml`, is read only by the federation map.

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

The admin's list names five more registries, added in 0.6, that `data/` does not ship. An instance creates them when it uses what they hold, and `validate:structure` does not look for them:

| File | Top-level key | Kind | Written by |
|---|---|---|---|
| `systems.yaml` | `systems` | list | the admin, or the 0.6 migration |
| `boards.yaml` | `boards` | list | the admin's boards |
| `proposals.yaml` | `proposals` | list, a ledger | the proposal routes only |
| `library.yaml` | `installed` | list | the library's Add and Remove only |
| `visibility.yaml` | `visibility` | document | by hand |

That makes 23 registries documented below: the 18 shipped files and these five.

The tables below give `Field`, `Type` and `Notes`. "date" means a string in `YYYY-MM-DD`. A field is optional unless the registry's "Required" line says otherwise.

### members.yaml: people and roles

Required field: `id`. Read by `generate:schemas` into `members.json`: the public members of kind `person` or `organization` with status `active`, each as a URI built from the `daoURI`, and nothing else of them. Also read by the dashboard (`name`, `role`, `layer`, `status`, `joined`) and by the admin, which finds the actor here.

| Field | Type | Notes |
|---|---|---|
| `id` | string | opaque (see Conventions) |
| `name`, `role` | string | |
| `kind` | `person` \| `agent` \| `organization` \| `role` | absent or `null` reads as `person`, and so does `type: individual` |
| `layer` | string | the instance's own word; the framework's are `core`, `contributor`, `community`, `observer` |
| `status` | `active` \| `inactive` \| `alumni` | dashboard defaults a missing status to `active` |
| `joined`, `left` | date | |
| `skills` | list of strings | |
| `email` | string | read as `handles.email`, and as a `handles.git` address (the vault hub writes it here) |
| `handles` | map | e.g. `github`, `telegram`, `email`; each value a string, except `git` and `address` |
| `handles.git` | string or list of strings | the emails commits are made with |
| `handles.address` | CAIP-10 id, or a list of them | accounts such as Safe signers and voters; the Safe driver names a Safe's owners by it (`packages/admin/server/systems/safe.ts`) |
| `handles.wallet` | CAIP-10 id | the account the house reads for sign-in and Hats readings (`walletsOf` in `packages/admin/lib/hat-readings.mjs`); `validate:data` warns when it is not CAIP-10 |
| `affiliations` | list | |

This repository's own entry also uses `pronouns`, `timezone` and `also_operates`, which no schema lists. `email` and `handles` are never published, whatever `visibility.yaml` says.

```yaml
schema_version: "2.0"
members:
  - id: "github:example-steward"   # opaque: any style, unique in this file
    name: "Your Name"
    kind: "person"                 # person | agent | organization | role (absent or null = person)
    role: "Operator"
    layer: "core"                  # open; default words: core | contributor | community | observer
    status: "active"               # active | inactive | alumni
    joined: "2026-10-10"
    handles:
      git: ["you@example.com"]     # the emails commits are made with: one, or a list
      github: "your-handle"
      address: ["eip155:42220:0x..."]   # CAIP-10 accounts (Safe signers, voters): one, or a list
```

- **Aliases are read, never rewritten.** `type: individual` reads as `kind: person`. A top-level `email` reads as `handles.email`, and as a `handles.git` address.
- **The actor.** The admin finds the member whose `handles.git` (or email) holds the repository's `git config user.email`, and writes that member's id in the `Org-Actor` trailer of each commit it makes (`unknown <email>` when no member, or more than one, holds it). It never matches on a name.
- **Agents** (crew seats) are members with `kind: agent`. An agent may propose where a role lists it, and never decides.
- **No governance roles here.** Who decides what is stated once, in `governance.yaml` `roles`. The vault hub's `roles: [{org, role}]` on a member (its affiliations) stays valid as an instance field.

### projects.yaml: initiatives

Required field: `id`. `generate:schemas` writes the public projects, with their public fields, into `projects.json`, and adds each `content/projects/*.md` file with an `id` in its front matter (its tasks and milestones read from the body). A project's `lead` and `members` are published as public member ids; anyone who is not a public member is left out. The dashboard shows `title` (or `name`), `status` (default `idea`), `lead` and `owner`. This repository's projects also carry `members` and `researchArtifacts`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `title` | string | this repository's entries use `name` instead |
| `status` | string | the instance's own word. Suggested: `idea`, `develop`, `execute`, `archive`. This repository uses `Discovery` and `Develop` |
| `type` | string | suggested: `program`, `initiative`, `workstream`, `experiment` |
| `lead` | string | a member `id` |
| `contributors` | list of strings | member ids |
| `started`, `target_completion` | date | this repository uses `startDate` |
| `description` | string | |
| `milestones` | list of maps | |
| `related_ideas` | list of strings | idea ids |
| `funding_source` | string | an opportunity `id` |
| `tags` | list of strings or numbers | |

### finances.yaml: budgets, expenses, revenues

A document, not a list, in one of two shapes: `budgets:`, `expenses:` and `revenues:` at the top level, as the shipped file has them, or the same three under a `finances:` key. The readers do not agree on which they read:

- `generate:schemas` reads either: the `finances:` block when there is one, else the file's own keys (`loadStandardsInput` in `packages/admin/lib/standards/load.mjs`).
- The admin app and `validate:data` read only the `finances:` key (`topKey: 'finances'` in `packages/admin/lib/registries.mjs`). In `npm run admin` the shipped flat file shows as an empty document, and `validate:data` does not check its lists. Nothing is lost: finances is a document registry, and document registries are read-only in the admin app. The admin's schema, `finances.schema.json`, lists `budgets` and the others as properties of that document.

`finances.json` carries the three lists when the document is public. An entry whose own `visibility` is anything but `public` is left out, and so are fields `visibility.yaml` restricts. The `treasury` map in the admin schema is not published.

The commented examples in the shipped file give these entry fields:

| List | Fields |
|---|---|
| `budgets` | `id`, `name`, `period`, `currency`, `totalAllocated` |
| `expenses` | `id`, `date`, `amount`, `currency`, `category`, `description`, `recipient`, `status` |
| `revenues` | `id`, `date`, `amount`, `currency`, `source`, `description`, `status` |

The admin schema types the three lists as lists of maps and enforces no entry fields.

### governance.yaml: how the org decides

A document under the `governance` key. When the document is public, `generate:schemas` turns its public decisions into `proposals.json` (a row's `title`, its `status`, default `draft`, and its `date`; a row that names a published proposal is folded into that proposal's entry; `by` and `summary` are never published), and writes `governance.md` from `description` and `rules`. Nothing in the scripts reads `elections`.

| Field | Type | Notes |
|---|---|---|
| `model` | `solo-maintainer` \| `consensus` \| `steward-council` \| `multisig` \| `assembly` \| `conviction` \| `other` | absent reads as `solo-maintainer`. This repository uses `solo-maintainer` |
| `description` | string | prose; required when `model` is `other` |
| `current_phase` | `bootstrap` \| `transition` \| `active` \| `sunset` | |
| `trunk` | string | 0.6: the branch decisions land on; see "The trunk" below |
| `membership` | map | `{ tree: <systems id> }`: the Hats tree whose wearers are the members |
| `roles` | map | 0.6: who holds which role; see "Roles and rules" below |
| `rules` | list of maps | 0.6: per change class, who proposes and how it is decided |
| `decisions` | list of maps | each row requires `id`, `title`, `date` (a date) and `status` (a free word); any other field is kept. `type` is a free string; this repository's rows use `amendment` and `ratified`. A row a proposal writes also has `proposal`, `rule`, `method`, `outcome` and `by` |
| `elections` | list of maps | free-form |
| `infrastructure` | map | `safe`, `hats_tree`, `gardens`, `snapshot`. Deprecated in 0.6: these belong in `systems.yaml`. Still read (see `systems.yaml`); `validate:data` warns when it holds a value |

```yaml
schema_version: "2.0"
governance:
  model: "steward-council"     # solo-maintainer | consensus | steward-council | multisig | assembly | conviction | other
  description: null            # prose; required when model is other
  current_phase: "active"      # bootstrap | transition | active | sunset
  trunk: "main"                # optional: the branch decisions land on
  roles:                       # who holds which role
    maintainer: { members: ["ana", "bruno"] }   # member ids, as members.yaml writes them
    member: { all: true }                       # every member of kind person
  rules:                       # per change class: who proposes, how it is decided
    - id: "records"
      applies_to: [records]
      propose: member
      decide: { by: maintainer, method: approve, count: 1 }
  decisions:
    - id: "gov-001"            # id, title, date and status are required; any other field is kept
      title: "Adopt Distributed Stewardship Model"
      type: "proposal"
      status: "ratified"       # a free word: see the status groups below
      date: "2026-03-22"
      passed_by: "assembly"
      summary: "Transition from founder-led to council-based governance"
  elections: []
  infrastructure:              # deprecated in 0.6: these belong in systems.yaml
    safe: null
```

**Decision status** stays the instance's own word (`approved`, `executed`, `adopted`, `closed`, `open`…). `schemas/decision-status.json` groups the words for display and for rules, `DECISIONS.md`'s own (`active`, `superseded`, `proposed`, `withdrawn`) included; matching ignores case, and a word it does not hold shows as written:

| Group | Words |
|---|---|
| ratified | ratified, approved, adopted, executed, passed, accepted, enacted, closed, active, superseded |
| open | open, proposed, draft, voting, pending, in-review, discussion |
| rejected | rejected, declined, failed, vetoed, preference-not-ratified |
| expired | expired, lapsed |
| withdrawn | withdrawn, cancelled, canceled, retracted |

**Read leniently, never rewritten** (`packages/admin/lib/governance-read.mjs`). The `governance:` block above is the canonical shape. A file that is missing is read as `solo-maintainer` (`validate:data` warns `no governance file; running as solo-maintainer`), and so is one that states no `model` (it warns `no governance model declared; running as solo-maintainer`). A file with no `governance:` key but top-level `model` or `decisions` (the vault hub) is read as if wrapped, and `decision_model` is read as `model`. A file holding **several YAML documents** (separated by `---`) is not read at all: `validate:data` reports it as an error, the instance doctor as a blocker, and the admin answers `409`. Merge it into one document under `governance:` by hand; no migration does it, because only the instance's people know where each part belongs.

#### Roles and rules (0.6)

`roles` and `rules` make the org's own governance something the platform can check. They are optional: an org that writes neither runs on the solo default. The checks are `checkGovernance` in `packages/admin/lib/rules.mjs`, run by `validate:data` and `validate:governance`.

**Roles** are a map from a role id (lowercase letters, digits, `-`, `_`) to `{ members: [<member ids>] }` or `{ all: true }` (every member of kind person). `roles: []` and `roles: null` mean none. Governance roles are stated here and nowhere else. A role the rules name must be defined, except `maintainer`, which means every person while no role by that name is defined.

A role may instead be **sourced from a hat** (DAO-OS L5): `council: { hat: "eip155:42220:0x0000000d0001…" }` (a hat ref) means whoever wears that hat exactly, not the hats above it. A role is exactly one of `members`, `all: true` and `hat`. The hat must lie in the **membership tree**: the `hats-tree` System that `governance.membership: { tree: <systems id> }` names, or the only `hats-tree` System when none is named (several and none named is a warning). Who wears the hat is read from the readings each proposal records, so offline validation needs no network. Written rules must leave someone able to propose: a `propose` role that is not sourced from a hat needs a person with a git (`handles.git`, `handles.email`, `email`) or wallet (`handles.wallet`, CAIP-10) handle, or `validate:data` reports an error.

**Rules** say, for each change class, who may propose and how it is decided:

| Field | Meaning |
|---|---|
| `id` | Required, unique. `Org-Rule` and a proposal's `rule` name it. |
| `applies_to` | A change class (`records`, `members`, `governance`, `identity`, `systems`, `treasury`, `operations`, `publication`; the list and the registry each maps to are in `schemas/change-classes.json`), a split of one (`records:funding`), or `all`. The most specific rule wins; two rules may not cover the same target. |
| `propose` | The role that may propose. |
| `decide.method` | `direct` (the author decides alone), `approve` (`count` approvals, default 1), `consent` (`window` passes with no objection), `vote` (`quorum` members, `threshold` of the votes cast yes, within `window`), or `system` (the named system in `systems.yaml` decides: `by: system`, `system: <id>`, and optionally `passes: { choice: <label> }`, the Snapshot choice that must win). |
| `decide.by` | The role that decides. It may not contain an agent, and, unless it is sourced from a hat, it must have members. |
| `decide.window` | An ISO 8601 duration of weeks, days, hours or minutes: `P7D`, `P2W`, `PT36H`. |
| `expires` | Optional, any method. An ISO 8601 duration after which a proposal under this rule lapses if nobody decided it. Without it a proposal lapses after `P30D` (an evaluator reads a per-proposal `ttl` too, but the ledger schema has no such key and nothing writes one). A `consent` or `vote` window must be shorter than the expiry (this `expires`, else `P30D`); `validate:data` reports an error otherwise. |
| `self_approve` | Optional, `true` or `false` (anything else is an error); only `true` has an effect, and only `true` is kept in a proposal's stored rule snapshot. Under `approve`, the author's own approval then counts. Without it the author's approval does not count (four eyes). |
| `description` | Optional prose. |

Unknown keys in a rule are errors, so a typo is caught rather than ignored.

**The solo default.** With `model: solo-maintainer` (or no model) and no `rules`, an org behaves as if it had one rule: everything, proposed by a maintainer, decided `direct` by a maintainer. A model that is not solo, with no `rules`, has no default: its changes wait for proposals until rules are written.

`validate:data` checks the rules' structure. `npm run validate:governance` also reads the git history: a commit that touches a record the rules govern, whose author could not apply it alone, needs an `Org-Proposal` trailer naming a ratified proposal. That is a warning locally and an error in CI (`--strict`, or `CI=true`); it never stops a commit. Until `proposals.yaml` exists the trailer is checked by presence only: any text passes. A rule that names a split (`records:funding`) is accepted and does nothing until a change names that split. The 0.6 migration (`scripts/migrations/v0.5-to-v0.6-governance-rules.mjs`) writes the roles that are certain, and prints the ones it infers from `layer: core` / `stakeholder_group: core-team` and from the model, to be written with `--confirm`.

**The trunk.** `governance.trunk` names the branch decisions land on. Without it the trunk is the branch checked out when the server started. Every proposal write refuses, with the branch's name, while the repository is on another branch. A valid name is a short branch name that `git check-ref-format --branch` accepts and that also: does not begin with `+` (a forcing refspec), `-` (an option) or `/`; is not `@`, does not hold `@{`, `..`, `//`, a space, a control character or any of `~ ^ : ? * [ \`; does not begin with `refs/`; is not a name git keeps for its own state (`HEAD`, `AUTO_MERGE`, `MERGE_HEAD` and the other `*_HEAD` names); is not `proposal` or `proposals` and does not begin with `proposal/` or `proposals/` (the proposal branches use those names); does not end in `/`, `.` or `.lock`; has no part that begins with a dot; and uses letters, digits and `. _ / -` only, beginning with a letter or a digit. An invalid name is an error in `validate:data`, and the server refuses every proposal write with the sentence that says why.

**A decision recorded by a proposal** is a row of `decisions` that reads, in this order:

```yaml
    - id: "gov-20261018-001"       # gov-<date>-<NNN>, NNN counted among that day's rows
      proposal: "p-2026-10-18-001-a3f9"
      rule: "records"              # the rule ids, comma-joined when several
      method: "approve"            # the lead rule's method
      outcome: "ratified"          # ratified | rejected | expired
      status: "ratified"           # equal to outcome
      by: ["bruno"]                # who carried it; [] under silent consent
      date: "2026-10-18"
      title: "Move one project to develop"
      summary: "1 approval (bruno); no objection."   # generated from the evaluation's tally
```

A withdrawn proposal leaves no row (nobody decided). The row is written by the server, in the same commit that closes the proposal; `validate:governance` checks it against the evaluation. A proposal with a `statement` also writes an entry in `DECISIONS.md`.

### meetings.yaml: meeting records

Required field: `id`. `generate:schemas` writes the public meetings into `meetings.json`, with the meetings of `content/meetings/*.md` (action items and decisions read from the body); participants and assignees are published as public member ids, and anyone else is left out. The dashboard reads `title` and `date`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `title` | string | |
| `date` | date, or date and time | |
| `type` | string | suggested: `sync`, `assembly`, `workshop`, `standup`, `ad-hoc` |
| `participants` | list of strings | member ids |
| `duration_minutes` | number | |
| `recording_url`, `transcript_path`, `summary` | string | |
| `decisions` | list of strings or maps | |
| `action_items` | list of strings or maps | e.g. `assignee`, `task`, `due`, `status` |
| `tags` | list of strings | |

### ideas.yaml: the ideas pipeline

Required field: `id`. Lifecycle and the hatching process: [IDEA-HATCHING.md](IDEA-HATCHING.md). `generate:schemas` writes the public ideas into `ideas.json`.

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

Required field: `id`. The dashboard accepts either top-level key, `opportunities` or `funding_opportunities` (`scripts/initialize.mjs`), and so do the admin app and `validate:data`. Two entry shapes are in use, and they do not agree:

- The shape the `funding-scout` skill writes and the shipped file's example shows: `id`, `platform`, `fund`, `deadline`, `domain`, `amount_range`, `matching`, `url`, `status` (`pending`, `applied`, `approved`, `rejected`, `expired`), `eligible`, `relevant_nodes`, `discovered_by`, `discovered_date`, `source_refs`, `notes`. This is what the top-level key `opportunities` goes with.
- The shape the admin app's schema describes:

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `title` | string | |
| `type` | string | suggested: `grants-round`, `rfp`, `bounty`, `retroactive`, `investment` |
| `platform` | string | |
| `status` | string | suggested: `upcoming`, `open`, `closed`, `awarded` |
| `deadline` | string | a date |
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
| `type` | string | suggested: `alliance`, `collaboration`, `funding`, `advisory`, `peer` |
| `status` | string | suggested: `active`, `dormant`, `completed`, `proposed` |
| `since` | date | |
| `contact`, `description` | string | |
| `touchpoints` | list of strings or maps | this repository's entries use strings |

### sources.yaml: content sources

Required field: `id`. `generate:schemas` writes the public sources into `knowledge.json` (`id`, `name`, `type`, `url` or `feed_url`, `status`).

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `name`, `url`, `feed_url` | string | |
| `type` | string | suggested: `blog`, `podcast`, `newsletter`, `github`, `forum`, `social` |
| `status` | string | suggested: `active`, `paused`, `archived` |
| `last_synced` | date | |
| `sync_method` | `rss` \| `api` \| `manual` \| `scrape` | |
| `content_count` | number | |
| `tags` | list of strings | |

### knowledge-manifest.yaml: knowledge domains

A document under `knowledge_manifest`, with no required fields. `npm run knowledge:update-index` updates page counts and dates in it. When it is public, `generate:schemas` writes its domains (`id`, `name`, `description`, `coverage`, `page_count`, `sources`, `last_updated`) and its `exchange` lists into `knowledge.json`.

| Field | Type | Notes |
|---|---|---|
| `domains` | list of maps | entry fields in use: `id`, `name`, `description`, `coverage` (`none`, `partial`, `comprehensive`), `page_count`, `sources` (source ids), `last_updated` |
| `exchange` | map | `published_domains` and `subscribed_domains`, lists of domain ids |

### events.yaml: events and milestones

Required field: `id`. The dashboard reads `title`, `date`, `end_date`, `type`, `location`, `url`, `related_project`, `status` and hides cancelled events. `generate:schemas` does not publish events.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `title` | string | |
| `type` | string | suggested: `assembly`, `workshop`, `deadline`, `milestone`, `call`, `conference` |
| `date`, `end_date` | date | |
| `recurrence` | string | `weekly`, `monthly`, `quarterly` or `null` |
| `location` | string | |
| `url`, `notes` | string | |
| `related_project` | string | a project `id` |
| `participants` | list of strings | |
| `status` | string | suggested: `upcoming`, `completed`, `cancelled` |

### channels.yaml: communication channels

Required field: `id`. Only the admin app and `validate:data` read this file.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `platform` | string | suggested: `telegram`, `discord`, `forum`, `email`, `slack`, `signal`, `matrix` |
| `name`, `url`, `purpose`, `managed_by` | string | |
| `visibility` | `public` \| `members` \| `core` \| `private` | the same key as a record's own visibility (see `visibility.yaml`): there, `core` and `private` read as `members` |
| `topics` | list of strings | |
| `status` | `active` \| `archived` \| `migrating` | |

### assets.yaml: organisational assets

Required field: `id`. Only the admin app and `validate:data` read this file.

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

### systems.yaml: outside systems

New in 0.6, not shipped. The org's outside systems (a Safe, a Gardens pool, a Snapshot space, a Hats tree, a docs space) in one place, with their addresses. Required fields: `id`, `kind`, `name`. The 0.6 migration (`scripts/migrations/v0.5-to-v0.6-canonical-records.mjs`) creates it from `federation.yaml` `identity` and `governance.yaml` `infrastructure`, and leaves the originals as they are.

`generate:schemas` lists each public on-chain System with a chain and an address in `contracts.json`. Until an instance has one, it falls back to the 0.5 places, with a warning: the `safe` and `gardens` keys of `federation.yaml` `identity`, else those of `governance.yaml` `infrastructure`; and the registration contract from `identity.onchain_registration` (`loadStandardsInput` in `packages/admin/lib/standards/load.mjs`).

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `kind` | string | known: `safe`, `gardens-community`, `gardens-pool`, `snapshot-space`, `hats-tree`, `daouri-registration`, `docs`, `database`, `repo`, `kms-connector`, `link`. An unknown kind is kept, with a warning, so that a module can add one |
| `name` | string | |
| `chain` | string | CAIP-2 (`eip155:42220` is Celo). The on-chain kinds (`safe`, `gardens-community`, `gardens-pool`, `hats-tree`) need `chain` and `address`, unless composed (below); a `daouri-registration` is named by `address` or `ens` |
| `chains` | list | a Safe read on more than one chain, the first being its chain; an error on any other kind |
| `address` | string | a bare `0x` address for `safe`, `gardens-community` and `gardens-pool`; the tree id for `hats-tree` |
| `url` | string | required for the off-chain kinds (`snapshot-space`, `docs`, `database`, `repo`, `kms-connector`, `link`) |
| `space` | string | a Snapshot space's id, when the link does not say it |
| `driver` | string | which platform driver reads it; absent, it is shown as a link |
| `section` | string | where the Hub shows it, e.g. `organization/treasury` |
| `embeddable` | boolean | whether it can be shown inside the Hub |
| `description`, `notes` | string | |
| `grant_pool` | map, or `false` | for a Gardens pool that funds: a map publishes it as a DAOIP-5 grant pool (in `grant-pools.json`), with what a read cannot know; `false` or absent does not |
| `relates` | list | relations the map draws that the chain does not give |
| `roles` | map | for a Hats tree only: where each hat sits on the map |

```yaml
schema_version: "1.0"
systems:
  - id: "treasury-safe"
    kind: "safe"
    name: "Treasury"
    chain: "eip155:42220"
    address: "0x..."
    driver: "safe"
    section: "organization/treasury"
  - id: "shared-drive"
    kind: "docs"
    name: "Shared drive"
    url: "https://..."
    embeddable: false
```

A `daouri-registration` (L8) is the org's ERC-4824 registration, named by one of `address` (a registration contract)
or `ens` (L7-D13: a Sepolia ENS name, lower case, ending in `.eth`, whose `daouri` text record holds the daoURI), never
both; once it is not composed it also needs `chain`. A registration by `ens` is read through the ENS Universal Resolver
on Sepolia and is not listed in `contracts.json` (it is a text record of a name, not a contract).

A `snapshot-space` needs `url`, composed or not; `space` is its id on the hub, an ENS name, when the url does not say
it.

**Composed and deployed Systems (DAO-OS L7).** A System is *composed* when `deployment.status` is `composed`: a plan,
not yet on a chain. While composed, `chain` and `address` are not required, the System is never read by a driver, is
never the membership tree and is not published in `contracts.json`. The org's Hub prepares its deployment (`GET
/api/deploy`); once the chain holds it, a *read-back* stages it live, in one ordinary change decided by the org's rules:
`deployment.status: deployed` with the day of the read-back, and the address the chain gave. A deployed System is never
written back to `composed` (the change engine refuses it, 422 on `deployment.status`), and the fields the chain holds of
it are not written by hand (L7 gap B1, `lib/chain-held.mjs`): `kind`, `driver`, `chain`, `address`, `deployment` but its
`on_deploy`, a Safe's `chains` and `signer_gate`, a tree's `hats` (a hat's `role` aside; its `wearers` may be dropped),
a space's `space` and `url`, a registration's `ens`. A change to one is refused on every write path, 422 on that field:
"<field> of a deployed System is what the chain holds: change it on the chain, then read it back.", whether git or the
private store keeps it. The read-back's own writes pass. Its other fields (`name`, `description`, `notes`, `relates`,
`roles`, `role`, `position`, `order`, …) are edited like any record's. A System with no `deployment` (registered by
hand) is not judged by this rule. The keys L7 adds, all optional:

| Key | Meaning |
|---|---|
| `deployment` | `{ status, owners?, threshold?, salt?, top?, network?, settings?, on_deploy?, read_back? }`, below. |
| `ens` | A `daouri-registration`'s ENS name (above). |
| `hats` | A Hats tree's hats: `{ key, details, admin (top or a key), max_supply, mutable, wearers, role, image, hat }`; `key` starts with a lower-case letter, then lower case, digits and hyphens. Composed, `hat` is null. |
| `signer_gate` | A Safe's Hats Signer Gate: `{ hats: [<tree id>/<hat key>], threshold: { type: absolute \| proportional, min, target }, claimable_for, address }`; `address` is written by the read-back. |
| `relates` | `[{ to: <System id, system:<id>, a hat ref, or <tree id>/<hat key>>, label: signs \| elects \| appoints \| includes \| holds \| admin \| pool }]`: only what the chain cannot give. A composed space's `elects` names the hat whose wearers vote. |
| `role` | `decides` or `acts`. |
| `position` | `{ x, y }` (numbers, 0 or more): the compose canvas's own. |
| `order` | Deployment order (integer, 0 or more); 0 = never deployed. |

`deployment`, field by field:

| Field | Meaning |
|---|---|
| `status` | `composed` (a plan) or `deployed` (read back from the chain). |
| `owners` | A Safe's owners, CAIP-10 on its chain (`eip155:11155111:0x…`). A DAO template's add writes them so, checksummed; a bare 0x address is read on the composition's chain, and anything else is refused. |
| `threshold` | A Safe: how many owners sign (1 up to the owners). |
| `salt` | A Safe: the `saltNonce`, decimal text; with the owners and threshold it fixes the Safe's address before it exists. |
| `top` | A Hats tree: `{ details, image, worn_by: <the Safe that wears the top hat>, hat? }`. `hat` is the top hat's ref (`eip155:<chain>:0x` and 64 hex digits), written by the read-back as soon as the top hat is minted, while the rest of the tree is still composed. |
| `network` | A Snapshot space: the CAIP-2 chain it votes on (`eip155:11155111`); kept when the space is deployed, and it decides which Snapshot hub reads it (the testnet hub for Sepolia). |
| `settings` | A Snapshot space's settings: `name`, `symbol`, `strategies` (an `erc1155-balance-of` strategy counts a hat: `${hat.<tree>/<key>}`, or the space's `elects`), `voting`, `filters`. |
| `on_deploy` | A Safe: `{ roles?, rules? }`, the governance the DAO takes once it is deployed (L7-D8); `${hat.<tree>/<key>}` and `${system.<id>.address}` stay text until then. The read-back adds it to `data/governance.yaml` when every composed Safe and tree is deployed, and drops it from the Safe. It is not what the chain holds: on a deployed Safe it is edited by hand, and becomes governance at the next read-back that finds the composition whole, judged under the governance rule that covers the actor reading back. |
| `read_back` | The day (`YYYY-MM-DD`, UTC) the read-back found the System deployed. |

Hats wearers (`hats[].wearers`) are CAIP-10 accounts on the tree's chain, written as the owners are. A deployed tree's
`address` is its tree id; its hats keep `{ key, hat, role }` (P9), and their `wearers` only until the Safe's signer gate
has registered its signers, after which the chain says who wears them. The read-back also writes the map's `roles` for
a deployed tree, by hat ref. A deployed Safe keeps `deployment: { status: deployed, read_back }`; a deployed space
`{ status: deployed, read_back, network }`.

### boards.yaml: boards

New in 0.6, not shipped. The org's boards: workspaces made of blocks. Required fields: `id`, `name`, `layout`, `blocks`; no other key is allowed. A board here with the id of a built-in board (`home`, a section such as `projects`, the maps `organization` and `systems`) replaces it wholesale; until then the framework's version is shown, and improves with upgrades. Changing a board is a staged change like any other record (class `records`). `validate:data` checks each board with `validateBoard` in `packages/admin/lib/board-query.mjs`.

```yaml
schema_version: "1.0"
boards:
  - id: "treasury"                # lower case, digits, hyphens
    name: "Treasury & council"     # "{org}" is replaced by the org's name
    audience: "members"            # members | council | public | a role id
    layout: "grid"                 # grid | canvas | flow
    blocks:
      - id: "safe"
        type: "system"
        source: { system: "treasury-safe" }
        place: { col: 1, span: 4, row: 1 }      # grid: 12 columns, span 3–12
      - id: "open-projects"
        type: "list"
        title: "Open projects"
        source: { kind: "project", where: { status: { not: "done" } }, sort: "-started", limit: 10 }
        place: { col: 5, span: 8, row: 1 }
      - id: "pipeline"
        type: "kanban"
        source: { kind: "project" }
        view: { group: "status", columns: ["idea", "active", "done"] }
        place: { col: 1, span: 12, row: 2 }
```

- **Block types:** `list`, `kanban`, `map`, `record`, `metric`, `system`, `note`, `proposals`, `needs`, `systems`, `recently`, `prepared`, `balances`, `fundflow`.
- **Places follow the layout.** On a grid it is `{ col, span, row }`, with a span of 3–12 that ends by column 12; blocks may not overlap. On a canvas it is `{ x, y, w, h }` in pixels, at least 240 × 120. On a flow, blocks go in list order with no `place`.
- **Records sources.** A records source names `kind` (one, a list, or `"*"` for any) or a built-in `section` (never both), then `where`, `sort` and `limit`:
  - `where` maps a field to a value it equals, or to one of `not`, `in`, `before`, `after`, `has`.
  - `sort` is a field or a list of fields, and each may hold comma-separated keys. `-field` sorts descending. `field=value` puts the records holding that value last.
  - Besides a record's own fields, three derived ones can be read: `needs` (alert 0, warning 1, none 2), `changed` (when, as an ISO time) and `free` (1 for a free crew seat). `sort: "needs, changed"` lists alerts first, oldest first.
  - Fields are checked against the kind's schema, so a misspelt one fails `validate:data`, which names the board, the block and the field.
- **Other sources:**
  - `list` blocks can read `{ jobs: recent }`.
  - `map` blocks can read `{ map: organization | systems }`.
  - `record` blocks read `{ record: <kind>:<id> }`.
  - `system` blocks read `{ system, reading? }`.
  - `metric` blocks read a records source, with `view: { measure: count | sum, field }`, or `{ system, fact, reading? }`.
  - `proposals` blocks read `{ proposals: open | closed | mine | needs-me }`; `recently` blocks read `{ recently: all | money }`.
  - `needs`, `systems`, `prepared`, `balances` and `fundflow` blocks are the Hub's own reads and take no source.
  - A `note` holds `text` (Markdown) and no source.

### proposals.yaml: proposals (a ledger)

New in 0.6, not shipped. The proposals of an org whose rules are not `direct` for the person changing a record: what was proposed, what happened to it, who said what. Required fields: `id`, `title`, `author`, `classes`, `rules`, `state`, `opened`, `rev`, `ops`, `events`; no other key is allowed. It is a **ledger**: the proposal routes are its only writers, and the change engine and the generic registry routes refuse it ("proposals are changed by their own routes"). `validate:governance` judges every commit that touches it (form, rule, standing), instead of exempting it. `generate:schemas` publishes each public proposal in `proposals.json` (its title, unless it changes a restricted collection, and its state) and its events in `activities.json`.

```yaml
schema_version: "1.0"
proposals:
  - id: "p-2026-10-18-001-a3f9"  # p-<date>-<NNN>-<xxxx>: NNN counts that day's proposals, xxxx is 4 random hex (the older p-<date>-<NNN> is still accepted)
    title: "Move one project to develop"
    rationale: "Why this is worth deciding."
    author: "ana"                # a member id, set by the server from the actor
    classes: [records]           # whole classes; one per class the ops touch
    rules:                       # the snapshot of the rules it was opened under, one per distinct rule id
      - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
    state: "open"                # open | ratified | rejected | withdrawn | expired
    opened: "2026-10-18T09:30:00Z"
    rev: "3f2a9c1b7d40"          # first 12 hex of the sha-256 of the ops without base
    base: "<trunk sha>"          # where the branch was last built
    branch: "proposal/p-2026-10-18-001-a3f9"
    ops:                         # the content; the branch is derived from it
      - { op: update, record: "projects:alpha", set: { stage: develop }, base: "<sha-256 of the entry when staged>" }
    statement: null              # { title, decision, why, scope? }: present means a DECISIONS.md entry on ratify
    events:                      # append-only
      - { id: "e-lq3k9z-a4", at: "2026-10-18T10:02:00Z", by: "bruno", kind: "approve", rev: "3f2a9c1b7d40" }
    closed: null                 # { at, by, decision } when the proposal closes
```

- **The author** is a member id, or the CAIP-10 id of an address no member lists, set by the server from the actor, never from the request. An author under a role sourced from a hat, or at an address, also has `opened_as`: the Hats reading the proposal was opened on.
- **Events.** `kind` is one of `approve`, `object` (`text` required), `vote` (`vote`: `yes`, `no` or `abstain`), `comment` (`text` required), `retract` (`of`: the event taken back), `revise` (new `ops` and `rev`), `replay` (the new `base`), `attach` and `system` (an outside reference, `ref`, and for `system` an `outcome`: `pending`, `executed`, `failed` or `mismatch`), and the closings `withdraw`, `reject`, `expire` and `ratify`. `by` is a member id, or `system:<id>` for a `system` event. An event never changes: a mistake is answered by a later event.
- **The ledger rule.** Only the server writes the file, one commit per event, with `Org-Actor`, `Org-Rule` and `Org-Proposal` trailers. `validate:governance` checks each commit that changes it: the author of an event is the commit's actor, the kind is one that actor may write, approvals and votes count only for the current `rev`, a closed proposal never changes, and a ratified one has its decision row and, in the same merge commit, exactly the content of its ops. Git authorship is the actor's claim until sign-in.
- **The clock tolerance.** An event's `at`, and a proposal's `opened`, must lie within ten minutes (`CLOCK_SKEW`, `PT10M`) of the committer date of the commit that adds them. The server refuses to write when its own clock is more than that behind the newest `at` in the ledger. Events need not be ordered (two machines interleave after a Sync).
- **Rules and the proposal.** A proposal lives until a person closes it: ratify, reject, expire and withdraw are acts of a person, and the clock only changes what the screen says. It lapses `P30D` after its last revision unless a rule's `expires` says otherwise.
- **Several classes.** A change touching classes that different rules govern is one proposal; its `rules` lists each distinct rule, and it is decided when every one is met.

### library.yaml: library receipts

New in 0.6 (DAO-OS L1), not shipped. What the org added from the library, one receipt per add, and whether it was removed since. Class `records`. Required fields: `id`, `entry`, `version`, `shelf`, `created`, `status`, `by`, `at`, `decision`; no other key is allowed. It is written only through the library's Add and Remove. `validate:data` catches a committed receipt with a sealed field left `null`, and nothing else about a hand edit: a hand commit that rewrites a sealed receipt beside another governed file is judged under that file's class, not `records`.

```yaml
schema_version: "1.0"
installed:
  - id: board-onboarding          # the entry id with ':' → '-', then -2, -3… when taken
    entry: board:onboarding
    version: 1.0.0
    shelf: framework              # the entry's `source`, which equals its shelf's name
    created:
      - { record: boards:onboarding, base: <64 hex> }
    status: installed             # installed | removed
    by: bruno                     # sealed: the member who applied or proposed it
    at: 2026-10-29                # sealed: the day it was applied or proposed (the decision row dates the ratify)
    decision: { rule: records/direct, change: chg_… }   # sealed; or { proposal: p-2026-10-29-001-ab12 }
    removed: null                 # on removal: { by, at, decision }, sealed the same way
```

- **Sealed.** While the change is staged, `by`, `at`, `decision`, every `base` (and, on removal, `removed.by/at/decision`) are `null`; Apply or Propose fills them. A committed receipt with any of them `null` is an error in `validate:data`.
- **Whole.** A change that holds a receipt creates every record the receipt names, and a removal deletes every one of them that is still there. Taking half of an add out of the tray is refused, and a receipt is never deleted or replaced: Remove sets `status` and `removed`, nothing else.
- **Rides along.** The change that writes a receipt is decided by the classes of the records it creates or deletes, never by the receipt's own `records` class, unless the change holds nothing else.
- **`created`** holds `{ record, base }`, the SHA-256 of each record's canonical YAML as created, which is how a removal tells a record edited since the add.
- **What it changes from the 2026-10-18 design:** every receipt has an `id`, so that every collection entry is addressable by id; `source` became `shelf`; `commit` was dropped, because a commit cannot hold its own hash and adding it would take a second, ungoverned commit; `decision` was added; `adopted` was dropped.
- **Modified (L7-D11).** An add that changes a record the org already has (a rule set's `update governance:governance`)
  lists it in `modified: [{ record, base, after }]`: `base` is the record's hash before the add, `after` its hash as the
  add left it (sealed like `created[].base`; `null` only while staged). Removal gives the record back as the version
  whose hash is `base`, read from the file's git history (for `governance.yaml`, its `roles:` and `rules:` blocks only;
  a block the file did not state then is taken out), and asks first when the record's hash is no longer `after`.
  `created` may then be empty; a receipt always names at least one record in one of the two.
- **Templates (L7-D9).** A receipt whose created Systems include one that is `deployment.status: deployed` is not
  removed by the library: "Its Systems are deployed. Remove each System as its own change; the chain keeps them."

### tasks.yaml: tasks

New in 0.7, not shipped. A list under `tasks`, edited as records in the admin app and shown in the workspace's collection views. Required: `id`; other keys are allowed. Class `workspace` in the rules (with no rule naming it, a write is direct).

| Field | Type | Notes |
|---|---|---|
| `id` | string | required |
| `title` | string | |
| `status` | string | the instance's own words; a board's columns come from its saved view |
| `owner` | string | a member id, or a CAIP-10 account |
| `due` | date | |
| `project` | string | a `projects` id, which must exist (`REFS` in `packages/admin/lib/data-validate.mjs`); `related_project`, an older tasks file's field, is read when `project` is absent |
| `meeting` | string | a `meetings` id, which must exist |
| `proposal`, `page` | string | a proposal id, a page id |
| `priority` | string or number | |
| `from` | map | where an imported task came from (its source, its id there, when it was exported) |

### collections.yaml: the workspace's collections

New in 0.7, not shipped. A document: a list under `collections`. An entry whose `id` names a registry (`tasks`, `meetings`, `projects`) holds only its name, that registry's saved views and `notes_parent`. Any other entry defines a **custom collection**, whose records are kept in `data/collections/<id>.yaml` under a top-level key equal to the id. A custom collection's id is lower case, letters, digits and hyphens, 2 to 41 characters; `pages`, `knowledge`, `collections` and the registries' names are taken (`isCustomId` in `packages/admin/lib/registries.mjs`). A collection kept stricter than members lives in the private store and is never named in git. Class `workspace`. `validate:data` reads the file through `lib/workspace/collections.mjs`, which checks more than the schema.

```yaml
collections:
  - id: "loans"
    name: "Tool loans"
    fields:
      - { id: "tool", type: "text" }
      - { id: "due", type: "date" }
      - { id: "borrower", type: "person" }
    views:
      - { id: "by-due", name: "By due date", kind: "table", sort: { field: "due", dir: "asc" } }
```

- **`fields`**: each has an `id` (lower case, digits, `_`) and a `type`: `text`, `longtext`, `number`, `select`, `multiselect`, `date`, `daterange`, `checkbox`, `url`, `person`, `relation` (with `to` and `many`), `page`, `email` or `phone`; `select` takes `options`.
- **`views`**: each has an `id`, a `name` and a `kind` (`table`, `board`, `calendar`, `list`, `map`), and may set `filters` (`field`, `op`: `is`, `is-not`, `before`, `after`, `contains`; `value`), `sort`, `group`, `columns`, `date` and `board` (`field`, `order`).

### imports.yaml: import receipts

New in 0.7, not shipped. A document: a list under `imports`, one receipt per `npm run import -- <notion|fileverse> <folder> --apply` that wrote anything. It holds counts and reasons only: no title of a private item, no name, no private collection's id. Class `workspace`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | required; `imp_` and hex digits |
| `source` | `notion` \| `fileverse` | required |
| `export`, `at`, `by` | string | required: the export's name, when, and who ran it |
| `created` | map | counts of `pages`, `records`, `collections` |
| `updated`, `kept` | integer | |
| `not_carried` | list | `{ what, why }` for what could not land |
| `blobs` | map | the mark of each git item the import wrote, so a later run updates only what the Hub left as imported |

### federation-requests.yaml: requests a hub received

New in 0.7.4, on a hub only. A list under `requests`, written only by the admin app's federation routes (a request's arrival and the hub's decision), never by an edit. No key outside the schema is allowed, and the file is never widened past members (`visibility.yaml`). Class `identity`. See [Federation: Joining a network](FEDERATION.md#joining-a-network).

| Field | Type | Notes |
|---|---|---|
| `id` | string | required; a UUID |
| `received` | string | required; ISO 8601 time |
| `transport` | `file` \| `github` | required |
| `ref` | string | the file name or the issue address it came from |
| `from` | map | required: `name`, `type` and a public `https://` `url` of the asking instance; no person |
| `network` | string | required |
| `answers` | map | required: the answers to the hub's asks |
| `invite` | string | required, may be empty: the id of the invite that matched (`i-` and 8 hex digits), never its token |
| `outcome` | `refused` \| `accepted` \| `proposed` \| `held` | required |
| `reason`, `proposal`, `decision` | string | why it was refused; the proposal opened for it; where the acceptance was recorded |

### invites.yaml: a hub's invites

New in 0.7.4, on a hub only. A list under `invites`, written only by the invite routes. No key outside the schema is allowed, and the file is never widened past members. Class `identity`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | required; `i-` and 8 hex digits |
| `name`, `type`, `network` | string | required: who it is for, the instance type it admits, the network |
| `expires` | string | required: the last day it works, or an ISO 8601 time (1 to 90 days) |
| `token_sha256` | string | required: the SHA-256 of the token, in hex. The token itself is never kept |
| `used_by` | string | required, empty while unused: the id of the request that used it |

### data/kb/: the knowledge canon

kms's store as the instance holds it: one file per kind, `data/kb/<type>.yaml`, each with `entries:`, a map keyed by slug. A record's id is `<type>/<slug>`. Since 0.7 the admin app reads it as the collection `knowledge` (`KNOWLEDGE` in `packages/admin/lib/registries.mjs`), present when the instance has `data/kb/`; an edit is prepared on the commons' entry page and applied in one commit, under class `workspace`. What the entries hold is kms's: see [KMS](KMS.md).

### visibility.yaml: what is public

New in 0.6 (DAO-OS L8 and L5), not shipped. A document under `visibility` (the key may be left out). It decides which collections, records and fields are public in git, and is read by `generate:schemas`, by `validate:schemas`' leak scan, by `validate:data` and by the admin's public view (`packages/admin/lib/visibility.mjs`). Changing it is class `publication` in the rules. The admin app edits it whole in its source editor (`/files/data/visibility.yaml`), staged and checked like any change; narrowing one record, collection or field has its own route, and a text that widens what is public is a publication.

```yaml
schema_version: "1.0"
visibility:
  collections:
    projects: { default: public }
    meetings: { default: public, fields: { summary: members } }
  defaults:
    contact: "role:maintainer"
```

- **Collections.** A collection not listed is `members`. `default` (or its synonym `level`, never both) is `public` or `members`. `fields` makes single fields stricter: `public`, `members`, `hat:<hat ref>` or `role:<role id>`. A value outside these is an error in `validate:data`; `generate:schemas` reads it as `members`, with a warning.
- **Records.** A record may set its own `visibility: public` or `members`, which wins over its collection's default. Any other value reads as `members`; a hat or role level written in git is a `validate:data` error, because such a record belongs in the private store, and so does the value of a field restricted to a hat or role.
- **Never public.** Members' `email` and `handles`, whatever the file says.
- **`defaults.contact`**: the hat or role that keeps contact details outside git.
- **`files`** (0.7.2, opt-in): which Roles read which `data/**` file whole, in the admin app and every read it makes of a file's records. Without the section every member reads every data file, as before 0.7.2.

```yaml
visibility:
  files:
    default: role:steward             # every data/** path not listed
    paths:
      data/projects.yaml: members     # any signed-in member
      data/kb/**: members             # a folder
```

  A level is `members`, `role:<Role>` (the Roles table's: `steward`, `node-lead`, `network-member`) or `hat:<hat ref>`; `public` is refused. A path takes its own level, else the longest `data/<folder>/**` holding it, else `default`, so a file added later is held at the default until listed. The knowledge canon is read as one: list `data/kb/**`, never a path inside it; since 0.7.3 a key written inside `data/kb/` all the same narrows the whole canon, and two levels there that are not ordered close it. A member a file is kept from is given its records as the public is, and their writes to such a record are refused before it is read; the person at the machine is never held back. The policy check (the doctor, and a staged edit of this file) refuses `public`, a path outside `data/`, a `role:` that is no Roles-table Role, an empty section, and any key that opens a file with field levels below `role:steward` (a file is read whole). Removing the section or widening a level is a publication. A section or file that cannot be read closes every data file. `role:` is judged against the Roles a person signed in by emailed link holds, never a governance role of the same name; a wallet session holds none. 0.7.1 refuses the section, so add it only once the Hub runs 0.7.2 or later. Source: CHANGELOG [0.7.2] and [0.7.3]; `schemas/visibility.schema.json` (`packages/admin/schemas/`).

## Framework-only registries

These track state across instances, not an organisation's own data. A new instance does not receive them. `validate:structure` warns when either matrix is absent, and does not look for `instances.yaml`.

### instances.yaml: downstream instances

One entry per instance the framework knows of, maintained by hand and read by `npm run analyze:instances`, which compares it with the instances' directories and writes a drift report. Fields: `id`, `name`, `type`, `maturity` (`alpha`, `beta` or `production`), `repo`, `local_path`, `cloned`, `federation_network`, `federation_role`, `masterplan_version`, `framework_version`, `last_sync`, `agent_runtime` (list), `skills_extra` (list), `packages` (list), `data_registries_extra` (list), `drift` (list), `notes`. Every one of the eight entries here has all of these.

One more field is optional: `listed` (boolean, default `true`). Set `listed: false` to keep an entry off any public list of registered instances, and out of the count printed beside that list. It changes only what is shown. `npm run analyze:instances`, the quilt (`npm run generate:quilt`) and the dashboard still read every entry, listed or not. One reader filters on the field: the project site's aggregator (`isListed` in `site/scripts/federation-aggregate.mjs`) leaves an entry whose `listed` is the literal `false` out of `federation.json`; an entry with `true`, or with no `listed`, stays in; any other value (a quoted `"false"`, `no`, `0`, an empty value, a list) stops `npm run build` in `site/` with a sentence that names the entry, and nothing is built (`listedProblems`, in the same file). The operator decided on 2026-10-11 that the site's federation page leaves unlisted entries out of its list and its count (see [DECISIONS.md](../DECISIONS.md)); the site does so, for the list and for both the registered and the operational count, and `site/scripts/verify-build.mjs` fails the build if an unlisted entry is printed in the list or a count differs from the registry's. Two entries set it to `false`: `bread-coop-os`, a fictional test cooperative, and `openclaw`, an agent runtime. `tests/scripts/instances-listed.test.mjs` checks that the value is a boolean and that exactly these two are `false`.

### skills-matrix.yaml: skills across the federation

Fields per entry: `id`, `owner`, `instances_using` (list), `in_framework` (boolean), `promotion_status`, `notes`. `promotion_status` is one of `canonical`, `evaluating`, `candidate`, `instance-specific`, `deprecated` (the set the validator accepts; the file's header lists the same five). See [SKILL-PROMOTION.md](SKILL-PROMOTION.md).

### packages-matrix.yaml: packages across the federation

The same fields as the skills matrix, plus `lifecycle_status`: `active`, `dormant`, `planned` or `retired`. The validator warns when it is missing and fails when it is anything else. See [PACKAGE-LIFECYCLE.md](PACKAGE-LIFECYCLE.md).

## Registries created by the knowledge system

When an instance runs the knowledge system (`packages/org-os-kms`), binding its framework schemas to org-os registries creates more files under `data/`: `resources.yaml`, `source-systems.yaml`, `option-library.yaml`, `tracks.yaml`, `deployments.yaml`, `implementation-memory.yaml`, `evolution-log.yaml`, `signals.yaml` and `contributions.yaml` (the mapping is `REGISTRY_BINDINGS` in `packages/org-os-kms/src/bind.mjs`). None exists in this repository's `data/`. Their fields are defined by the schemas in `packages/toolkit-framework/schemas/`, not by this page; the knowledge system is described in [KMS.md](KMS.md).

## Instance extensions

An instance may add registries of its own (`tasks.yaml`, `pending-payouts.yaml` and so on). Convention:

- Declare the extra registry in `data_registries_extra` of the instance's entry in the framework's `data/instances.yaml`. `npm run analyze:instances` reports `undeclared_data_registry:<name>` for any `data/` YAML file that is neither in its built-in list of canonical registries nor declared. That list contains the first 13 registries of the table above and the three framework-only ones. It does not contain `knowledge-gaps`, `ecosystems` or the five 0.6 registries (`systems`, `boards`, `proposals`, `library`, `visibility`), so it reports those too until they are declared.
- Keep it out of `.well-known/` unless publishing an endpoint is intended: `generate:schemas` writes a fixed set of files and ignores everything else.
- Follow the conventions above: a `schema_version` line and entries with a unique `id`. `validate:data` checks only the registries in the admin's list, so an extension registry is not checked.

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

Fields that hold the id of an entry in another registry. These are the pairs checked (`REFS` in `packages/admin/lib/data-validate.mjs`):

| From | To | Via field |
|---|---|---|
| projects.yaml | members.yaml | `lead`, `contributors` |
| projects.yaml | ideas.yaml | `related_ideas` |
| projects.yaml | funding-opportunities.yaml | `funding_source` |
| meetings.yaml | members.yaml | `participants` |
| events.yaml | projects.yaml | `related_project` |

The admin refuses to save an entry that names an id the target registry does not hold. `validate:data` reports such a reference already in a file as a warning: meeting participants and project leads often name people of other instances, by ids this one does not hold. Neither checks a reference when the target registry's file is absent.

`ideas.source` is not a cross-reference: it is a path to a knowledge file.

## Generating the `.well-known/` files

```bash
npm run generate:schemas     # .well-known/ from federation.yaml, data/*.yaml and content/; public records only, and nothing without identity.daoURI
npm run validate:schemas     # the .well-known files parse and, with a daoURI, conform and leak nothing; IDENTITY.md and federation.yaml agree
npm run validate:data        # data/*.yaml against the admin schemas, the rules, the ledger and the receipts
npm run validate:governance  # the rules are well-formed, and the git history agrees with them
npm run analyze:instances    # framework only: scan downstream instances, write a drift report to memory/reports/
```

Which `.well-known/` file comes from which source is in [FILE-STRUCTURE.md](FILE-STRUCTURE.md). The EIP-4824 side is in [EIP4824-GUIDE.md](EIP4824-GUIDE.md).

## Notion

The dashboard (`npm run initialize`) can read Notion databases into the projects, meetings and members it shows. There is no Notion sync that writes `data/*.yaml`: an earlier version of this page documented an `npm run sync:notion` script, which does not exist in `package.json` or `scripts/`. See [TOOL-SETUP.md](TOOL-SETUP.md).
