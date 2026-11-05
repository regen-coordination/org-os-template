# DATA-MODEL.md — org-os Data Model Specification

Version: 2.4.0

## Overview

org-os structures all organizational data as YAML registries in `data/`. These files are the single source of truth — all schemas, dashboards, and agent queries read from them.

After any data change: `npm run generate:schemas && npm run validate:schemas && npm run validate:data`

`validate:data` checks every registry file below against the admin schemas (`packages/admin/schemas/`).
An **error** is a file or an entry that is not what its schema says, and fails the run. A **warning** is
something to look at that breaks nothing today (a reference to an id this instance does not hold, an entry
with no id or a repeated one, a System kind no driver knows, the deprecated `infrastructure` block), and
never fails it. It runs from the framework against any instance: `node scripts/validate-data.mjs <path>`.

### Conventions

- Top-level key matches the filename (e.g., `members:` in `members.yaml`)
- Each entry has an `id`, unique in its file and **opaque**: never parsed, never rewritten (see members)
- Dates use ISO 8601 format (`YYYY-MM-DD`)
- Status fields use lowercase kebab-case
- Fields that name a kind or a stage (`status`, `type`, `platform`, members' `layer`) are the instance's own
  vocabulary; the words in the comments below are the framework's defaults. Where a field is a closed list
  (`members.status`, `kind`, `governance.model`), the schema says so
- Add `schema_version: "2.0"` header to each file

---

## Registries (17 total)

### 1. members.yaml — People & Roles (Required)

```yaml
schema_version: "2.0"
members:
  - id: "github:example-steward"  # opaque: any style, unique in this file
    name: "Luiz Fernando"
    kind: "person"             # person | agent | organization | role (absent or null = person)
    role: "Core Steward"
    layer: "core"              # open; default words: core | contributor | community | observer
    status: "active"           # active | inactive | alumni
    joined: "2023-01-15"
    left: null
    skills: ["governance", "engineering", "coordination"]
    handles:
      git: ["luiz@example.com"]   # the emails commits are made with: one, or a list
      github: "luizfernandosg"
      telegram: "@luizfernando"
      email: "luiz@example.com"
      address: ["eip155:42220:0x..."]   # CAIP-10 accounts (Safe signers, voters): one, or a list
    affiliations: []
```

- **Ids are opaque.** Instances use `github:…`, `did:…`, `exampledao:role:…` and bare slugs, and the same
  person carries a different id in each repository. An id is unique within its file and is never parsed or
  rewritten: every `source_refs`, cross-reference and commit trail depends on it. Identity across
  instances goes through `handles`.
- **Aliases are read, never rewritten.** `type: individual` reads as `kind: person`. A top-level `email`
  reads as `handles.email`, and as a `handles.git` address.
- **The actor.** The admin finds the member whose `handles.git` (or email) holds the repository's
  `git config user.email`, and writes that member's id in the `Org-Actor` trailer of each commit it makes
  (`unknown <email>` when no member, or more than one, holds it). It never matches on a name.
- **Agents** (crew seats) are members with `kind: agent`.
- **No governance roles here.** Who decides what is stated once, in `governance.yaml` `roles` (F2). The
  vault hub's `roles: [{org, role}]` (its affiliations) stays valid as an instance field.

### 2. projects.yaml — Initiatives (Required)

Uses the IDEA lifecycle: Idea → Develop → Execute → Archive

```yaml
schema_version: "2.0"
projects:
  - id: "proj-001"
    title: "Local Node Onboarding Program"
    status: "execute"          # idea | develop | execute | archive
    type: "program"            # program | initiative | workstream | experiment
    lead: "luiz"
    contributors: ["monty", "john"]
    started: "2025-06-01"
    target_completion: "2026-03-31"
    description: "Streamline onboarding for new local ReFi nodes"
    milestones:
      - title: "Template finalized"
        date: "2025-09-01"
        status: "completed"
    related_ideas: []
    funding_source: null
    tags: ["nodes", "onboarding"]
```

### 3. finances.yaml — Budgets, Expenses, Revenues (Required)

```yaml
schema_version: "2.0"
finances:
  treasury:
    primary_safe: "0x..."
    chain: "optimism"
    balance_last_updated: "2026-03-01"
  budgets:
    - id: "budget-2026-h1"
      period: "2026-H1"
      total: 50000
      currency: "USD"
      allocations:
        - category: "operations"
          amount: 20000
        - category: "grants"
          amount: 30000
  expenses:
    - id: "exp-001"
      date: "2026-01-15"
      amount: 1500
      currency: "USD"
      category: "operations"
      description: "Server hosting Q1"
      approved_by: "council"
  revenues:
    - id: "rev-001"
      date: "2026-02-01"
      amount: 25000
      currency: "USD"
      source: "Gitcoin Round 22"
      type: "grant"            # grant | donation | earned | investment
```

### 4. governance.yaml — Elections & Decisions (Required)

```yaml
schema_version: "2.0"
governance:
  model: "steward-council"     # solo-maintainer | consensus | steward-council | multisig | assembly | conviction | other
  description: null            # prose; required when model is other
  current_phase: "active"      # bootstrap | transition | active | sunset
  trunk: "main"               # optional (0.6): the branch decisions land on; see "The trunk" below
  roles:                       # who holds which role (0.6): see "Roles and rules" below
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
      type: "proposal"         # proposal | election | amendment | emergency
      status: "ratified"       # a free word: see the status groups below
      date: "2026-03-22"
      passed_by: "assembly"
      summary: "Transition from founder-led to council-based governance"
  elections:
    - id: "election-001"
      title: "Steward Council Election Q2 2026"
      status: "upcoming"       # upcoming | nominations | voting | completed
      nominations_open: "2026-04-09"
      voting_start: "2026-04-16"
      voting_end: "2026-04-23"
      seats: 5
      candidates: []
  infrastructure:              # deprecated in 0.6: these belong in systems.yaml (§15)
    safe: "0x..."
    hats_tree: null
    gardens: null
    snapshot: null
```

**Decision status** stays the instance's own word (`approved`, `executed`, `adopted`, `closed`, `open`…).
`schemas/decision-status.json` groups the words for display and for rules, `DECISIONS.md`'s own (`active`,
`superseded`, `proposed`, `withdrawn`) included; a word it does not hold shows as written:

| Group | Words |
|---|---|
| ratified | ratified, approved, adopted, executed, passed, accepted, enacted, closed, active, superseded |
| open | open, proposed, draft, voting, pending, in-review, discussion |
| rejected | rejected, declined, failed, vetoed, preference-not-ratified |
| expired | expired, lapsed |
| withdrawn | withdrawn, cancelled, canceled, retracted |

**Read leniently, never rewritten.** The `governance:` block above is the canonical shape. A file that is
missing is read as `solo-maintainer` (`validate:data` warns `no governance file; running as solo-maintainer`),
and so is one that states no `model` (it warns `no governance model declared; running as solo-maintainer`). A file with no
`governance:` key but top-level `model` or `decisions` (the vault hub) is read as if wrapped, and
`decision_model` is read as `model`. A file holding **several YAML documents** (separated by
`---`) is not read at all: `validate:data` reports it as an error, the instance doctor as a blocker, and the
admin answers `409`. Merge it into one document under `governance:` by hand; no migration does it, because
only the instance's people know where each part belongs.

#### Roles and rules (0.6)

`roles` and `rules` make the org's own governance something the platform can check. They are optional:
an org that writes neither runs on the solo default.

**Roles** are a map from a role id (lowercase letters, digits, `-`, `_`) to `{ members: [<member ids>] }`
or `{ all: true }` (every member of kind person). `roles: []` and `roles: null` mean none. Governance
roles are stated here and nowhere else: a member entry carries no governance role (the hub's
`roles: [{org, role}]` on a member is an affiliation, a different thing). A role the rules name must be
defined, except `maintainer`, which means every person while no role by that name is defined.

A role may instead be **sourced from a hat** (DAO-OS L5): `council: { hat: "eip155:42220:0x0000000d0001…" }`
(a hat ref) means whoever wears that hat exactly, not the hats above it. A role is exactly one of
`members`, `all: true` and `hat`. The hat must lie in the **membership tree**: the `hats-tree` System that
`governance.membership: { tree: <systems id> }` names, or the only `hats-tree` System when none is named
(several and none named is a warning). Who wears the hat is read from the readings each proposal records,
so offline validation needs no network. Written rules must leave someone able to propose: a `propose`
role that is not sourced from a hat needs a person with a git (`handles.git`, `handles.email`, `email`)
or wallet (`handles.wallet`, CAIP-10) handle, or `validate:data` reports an error.

**Rules** say, for each change class, who may propose and how it is decided:

| Field | Meaning |
|---|---|
| `id` | Required, unique. `Org-Rule` and a proposal's `rule` name it. |
| `applies_to` | A change class (`records`, `members`, `governance`, `identity`, `systems`, `treasury`, `operations`, `publication`), a split of one (`records:funding`), or `all`. The most specific rule wins; two rules may not cover the same target. |
| `propose` | The role that may propose. |
| `decide.method` | `direct` (the author decides alone), `approve` (`count` approvals), `consent` (`window` passes with no objection), `vote` (`quorum` members, `threshold` of the votes cast yes, within `window`), or `system` (the named system in `systems.yaml` decides: `by: system`, `system: <id>`). |
| `decide.by` | The role that decides. It may not contain an agent, and it must have members. |
| `decide.window` | An ISO 8601 duration of weeks, days, hours or minutes: `P7D`, `P2W`, `PT36H`. |
| `expires` | Optional, any method. An ISO 8601 duration after which a proposal under this rule lapses if nobody decided it. Without it a proposal lapses after `P30D` (an evaluator reads a per-proposal `ttl` too, but the ledger schema has no such key and nothing writes one in P2). A `consent` or `vote` window must be shorter than the expiry (this `expires`, else `P30D`); `validate:data` reports an error otherwise. |
| `self_approve` | Optional, `true` or `false` (anything else is an error); only `true` has an effect, and only `true` is kept in a proposal's stored rule snapshot. Under `approve`, the author's own approval then counts. Without it the author's approval does not count (four eyes). |

Unknown keys in a rule are errors, so a typo is caught rather than ignored.

**The solo default.** With `model: solo-maintainer` (or no model) and no `rules`, an org behaves as if it
had one rule: everything, proposed by a maintainer, decided `direct` by a maintainer. A model that is not
solo, with no `rules`, has no default: its changes wait for proposals (P2) until rules are written.

`validate:data` checks the rules' structure. `npm run validate:governance` also reads the git history: a
commit that touches a record the rules govern, whose author could not apply it alone, needs an
`Org-Proposal` trailer naming a ratified proposal. That is a warning locally and an error in CI
(`--strict`, or `CI=true`); it never stops a commit. Until `proposals.yaml` exists the trailer is checked by presence only: any text passes. A rule that names a split (`records:funding`) is accepted and does nothing until a change names that split. The 0.6 migration
(`scripts/migrations/v0.5-to-v0.6-governance-rules.mjs`) writes the roles that are certain, and prints
the ones it infers from `layer: core` / `stakeholder_group: core-team` and from the model, to be written with
`--confirm`.

**The trunk.** `governance.trunk` names the branch decisions land on. Without it the trunk is the branch
checked out when the server started. Every proposal write refuses, with the branch's name, while the
repository is on another branch. A valid name is a short branch name that `git check-ref-format --branch`
accepts and that also: does not begin with `+` (a forcing refspec), `-` (an option) or `/`; is not `@`,
does not hold `@{`, `..`, `//`, a space, a control character or any of `~ ^ : ? * [ \`; does not begin with `refs/`;
is not a name git keeps for its own state (`HEAD`, `AUTO_MERGE`, `MERGE_HEAD` and the other `*_HEAD` names);
is not `proposal` or `proposals` and does not begin with `proposal/` or `proposals/` (the proposal branches
use those names); does not end in `/`, `.` or `.lock`; has no part that begins with a dot; and uses letters, digits and `. _ / -` only, beginning with a letter or a digit. An invalid
name is an error in `validate:data`, and the server refuses every proposal write with the sentence that
says why.

**A decision recorded by a proposal** (0.6 P2) is a row of `decisions` that reads, in this order:

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

A withdrawn proposal leaves no row (nobody decided). The row is written by the server, in the same commit
that closes the proposal; `validate:governance` checks it against the evaluation. A proposal with a
`statement` also writes an entry in `DECISIONS.md`.

### 5. meetings.yaml — Meeting Records (Required)

```yaml
schema_version: "2.0"
meetings:
  - id: "mtg-20260301"
    title: "Weekly Stewards Sync"
    date: "2026-03-01"
    type: "sync"               # sync | assembly | workshop | standup | ad-hoc
    participants: ["luiz", "monty", "john"]
    duration_minutes: 60
    recording_url: null
    transcript_path: null
    summary: "Reviewed Q1 progress, discussed stewardship transition"
    decisions:
      - "Approved v3 governance proposal for community vote"
    action_items:
      - assignee: "luiz"
        task: "Draft voter education materials"
        due: "2026-03-08"
        status: "completed"
    tags: ["governance", "transition"]
```

### 6. ideas.yaml — Community Ideas & Hatching (Required)

```yaml
schema_version: "2.0"
ideas:
  - id: "idea-001"
    title: "Carbon Credit Verification Toolkit"
    status: "proposed"         # surfaced | proposed | approved | developing | hatched | archived
    source: "knowledge/carbon-markets/verification-gaps.md"
    submitted_by: "agent"      # "agent" | "symbient" | member-id
    champions: ["luiz"]
    ecosystem_gap: "No open-source MRV tools for small-scale projects"
    description: "Open-source toolkit for measuring, reporting, and verifying carbon credits"
    hatched_repo: null
    skills_needed: ["smart-contracts", "data-science"]
    resources: []
    compensation:
      model: null              # bounty | retroactive | grants | equity | null
      pool: null
    created: "2026-03-15"
    updated: "2026-03-15"
    votes: 0
    comments: []
```

**Idea Lifecycle:** surfaced → proposed → approved → developing → hatched → archived. See `docs/IDEA-HATCHING.md`.

**`submitted_by: "symbient"`** marks an entry surfaced by a symbient practice (Stage 1+, deep-weave only) — deliberately anonymous; it never identifies a particular being or habitat. See `skills/symbient/SKILL.md` → Surfacing rule.

### 7. funding-opportunities.yaml — Grants & Rounds (Optional)

```yaml
schema_version: "2.0"
funding_opportunities:
  - id: "fund-001"
    title: "Gitcoin GG24 Climate Round"
    type: "grants-round"       # grants-round | rfp | bounty | retroactive | investment
    platform: "gitcoin"
    status: "open"             # upcoming | open | closed | awarded
    deadline: "2026-04-15"
    amount_available: 500000
    currency: "USD"
    relevance: "high"          # high | medium | low
    url: "https://..."
    notes: ""
    applied: false
    application_id: null
```

### 8. relationships.yaml — Inter-Org Partnerships (Optional)

```yaml
schema_version: "2.0"
relationships:
  - id: "rel-001"
    partner: "Regen Network"
    type: "alliance"           # alliance | collaboration | funding | advisory | peer
    status: "active"           # active | dormant | completed | proposed
    since: "2024-06-01"
    contact: "Gregory Landua"
    description: "Shared knowledge commons and ecological credit methodology"
    touchpoints:
      - type: "quarterly-sync"
        last: "2026-02-15"
```

### 9. sources.yaml — Content Sources (Optional)

```yaml
schema_version: "2.0"
sources:
  - id: "refi-blog"
    name: "ReFi Blog"
    type: "blog"               # blog | podcast | newsletter | github | forum | social
    url: "https://blog.refidao.com"
    feed_url: "https://blog.refidao.com/rss"
    status: "active"           # active | paused | archived
    last_synced: "2026-03-01"
    sync_method: "rss"         # rss | api | manual | scrape
    content_count: 45
    tags: ["refi", "ecosystem"]
```

### 10. knowledge-manifest.yaml — Knowledge Commons (Optional)

```yaml
schema_version: "2.0"
knowledge_manifest:
  domains:
    - id: "carbon-markets"
      name: "Carbon Markets & MRV"
      description: "Carbon credit verification, measurement, reporting"
      coverage: "partial"      # none | partial | comprehensive
      page_count: 8
      sources: ["refi-blog", "refi-podcast"]
      last_updated: "2026-03-10"
  exchange:
    published_domains: ["carbon-markets"]
    subscribed_domains: []
```

### 11. events.yaml — Events & Milestones (Optional, v2)

```yaml
schema_version: "2.0"
events:
  - id: "event-001"
    title: "Q2 Community Assembly"
    type: "assembly"           # assembly | workshop | deadline | milestone | call | conference
    date: "2026-06-15"
    end_date: "2026-06-15"
    recurrence: null           # weekly | monthly | quarterly | null
    location: "online"         # online | [city] | hybrid
    url: null
    related_project: "proj-001"
    participants: []
    status: "upcoming"         # upcoming | completed | cancelled
    notes: ""
```

### 12. channels.yaml — Communication Channels (Optional, v2)

```yaml
schema_version: "2.0"
channels:
  - id: "telegram-main"
    platform: "telegram"       # telegram | discord | forum | email | slack | signal | matrix
    name: "Main Chat"
    url: "https://t.me/example"
    purpose: "General coordination and announcements"
    visibility: "public"       # public | members | core | private
    topics: []
    managed_by: "core-stewards"
    status: "active"           # active | archived | migrating
```

### 13. assets.yaml — Organizational Assets (Optional, v2)

```yaml
schema_version: "2.0"
assets:
  - id: "domain-example"
    type: "domain"             # domain | account | credential | brand | tool | document | contract
    name: "example.com"
    platform: null
    url: null
    owner: "core-stewards"
    status: "active"           # active | expired | pending | transferred
    renewal_date: "2027-01-15"
    notes: ""
```

### 14. knowledge-gaps.yaml — Knowledge Graph Gaps (Generated, v2)

Machine-generated by `scripts/graph-gaps.mjs` from `graphify-out/graph.json`. Only
the `status` field is hand-edited (`open → curated | dismissed`). Consumed by the
knowledge-curator skill.

```yaml
schema_version: "2.0"
gaps:
  - id: "a1b2c3d4e5f6"         # sha256(kind + sorted node_ids), 12 hex chars
    kind: "weak-community"     # orphan | ambiguous-edge | weak-community
    node_ids: ["docs_x_concept", "docs_y_concept"]
    summary: "community 12: 8 nodes, cohesion 0.05 < 0.15"
    status: "open"             # open | curated | dismissed
    detected: "2026-07-22"
```

### 15. systems.yaml — Outside Systems (Optional, 0.6)

The org's outside systems — a Safe, a Gardens pool, a Snapshot space, a Hats tree, a docs space — in one
place, with their addresses. `generate:schemas` reads its on-chain entries for `contracts.json` before
`federation.yaml` `identity` and `governance.yaml` `infrastructure`, which it still reads, with a warning,
until an instance has migrated (`scripts/migrations/v0.5-to-v0.6-canonical-records.mjs` copies them here and
leaves the originals as they are).

```yaml
schema_version: "1.0"
systems:
  - id: "treasury-safe"        # required, unique
    kind: "safe"               # required; known: safe | gardens-pool | snapshot-space | hats-tree | docs | database | repo | kms-connector | link
    name: "Treasury"           # required
    chain: "eip155:42220"      # CAIP-2; on-chain kinds (safe, gardens-pool, hats-tree) need chain and address
    address: "0x..."           # a 0x address for safe and gardens-pool; the tree id for hats-tree
    driver: "safe"             # which platform driver reads it; absent = a framed link
    section: "organization/treasury"
  - id: "shared-drive"
    kind: "docs"
    name: "Shared drive"
    url: "https://..."         # off-chain kinds need url
    embeddable: false
    notes: ""
```

An unknown `kind` is kept, with a warning, so that a module can add one.

### 16. boards.yaml — Boards (Optional, 0.6)

The org's boards: workspaces made of blocks (P4 spec §5). A board here with the id of a built-in board
(`home`, a section such as `projects`, the maps `organization` and `systems`) replaces it wholesale;
until then the framework's version is shown, and improves with upgrades. Changing a board is a staged
change like any other record (class `records`).

```yaml
schema_version: "1.0"
boards:
  - id: "treasury"                # lower case, digits, hyphens
    name: "Treasury & council"     # "{org}" is replaced by the org's name
    audience: "members"            # members | council | public | a role id
    layout: "grid"                 # grid | canvas | flow
    blocks:
      - id: "safe"
        type: "system"             # list | kanban | map | record | metric | system | note
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

- **Places follow the layout.** On a grid it is `{ col, span, row }`, with a span of 3–12 that ends by column 12; blocks may not overlap. On a canvas it is `{ x, y, w, h }` in pixels, at least 240 × 120. On a flow, blocks go in list order with no `place`.
- **Sources.** A records source names `kind` (one, a list, or `"*"` for any) or a built-in `section` (never both), then `where`, `sort` and `limit`:
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
  - A `note` holds `text` (Markdown) and no source.

### 17. proposals.yaml — Proposals (Ledger, 0.6)

The proposals of an org whose rules are not `direct` for the person changing a record: what was proposed,
what happened to it, who said what. It is a **ledger**: the proposal routes are its only writers, and the
change engine and the generic registry routes refuse it ("proposals are changed by their own routes").
`validate:governance` judges every commit that touches it (form, rule, standing), instead of exempting it.

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

- **Events.** `kind` is one of `approve`, `object` (`text` required), `vote` (`vote`: `yes`, `no` or `abstain`),
  `comment` (`text` required), `retract` (`of`: the event taken back), `revise` (new `ops` and `rev`), `replay`
  (the new `base`), `attach` and `system` (an outside reference, `ref`, and for `system` an `outcome`:
  `pending`, `executed`, `failed` or `mismatch`), and the closings `withdraw`, `reject`, `expire` and `ratify`.
  `by` is a member id, or `system:<id>` for a `system` event. An event never changes: a mistake is answered by a
  later event.
- **The ledger rule.** Only the server writes the file, one commit per event, with `Org-Actor`, `Org-Rule` and
  `Org-Proposal` trailers. `validate:governance` checks each commit that changes it: the author of an event is
  the commit's actor, the kind is one that actor may write, approvals and votes count only for the current
  `rev`, a closed proposal never changes, and a ratified one has its decision row and, in the same merge commit,
  exactly the content of its ops. Git authorship is the actor's claim until sign-in.
- **The clock tolerance.** An event's `at`, and a proposal's `opened`, must lie within ten minutes
  (`CLOCK_SKEW`, `PT10M`) of the committer date of the commit that adds them. The server refuses to write when
  its own clock is more than that behind the newest `at` in the ledger. Events need not be ordered (two
  machines interleave after a Sync).
- **Rules and the proposal.** A proposal lives until a person closes it: ratify, reject, expire and withdraw
  are acts of a person, and the clock only changes what the screen says. It lapses `P30D` after its last
  revision unless a rule's `expires` says otherwise.
- **Several classes.** A change touching classes that different rules govern is one proposal; its `rules` lists
  each distinct rule, and it is decided when every one is met.

### 18. library.yaml — Library receipts (0.6, DAO-OS L1)

What the org added from the library, one receipt per add, and whether it was removed since. Class `records`.
It is written only through the library's Add and Remove. `validate:data` catches a committed receipt with a sealed field
left `null`, and nothing else about a hand edit: a hand commit that rewrites a sealed receipt beside another governed
file is judged under that file's class, not `records` (the price of riding along, L1-E2).

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

- **Sealed.** While the change is staged, `by`, `at`, `decision`, every `base` (and, on removal, `removed.by/at/decision`)
  are `null`; Apply or Propose fills them. A committed receipt with any of them `null` is an error in `validate:data`.
- **Whole.** A change that holds a receipt creates every record the receipt names, and a removal deletes every one
  of them that is still there. Taking half of an add out of the tray is refused, and a receipt is never deleted or
  replaced: Remove sets `status` and `removed`, nothing else.
- **Rides along.** The change that writes a receipt is decided by the classes of the records it creates or deletes,
  never by the receipt's own `records` class, unless the change holds nothing else (L1-C5).
- **What it changes from the 2026-10-18 design** (ruling L1-R1):
  1. every receipt has an `id`, because F1 makes every collection entry addressable by id;
  2. `source` is `shelf`, the shelf's name (`framework`, `dao`), as CONTEXT.md calls it;
  3. `commit` is dropped: a commit cannot hold its own hash, and adding it would take a second, ungoverned commit;
  4. `decision` is added: `{ rule, change }` for a change applied directly, `{ proposal }` for one ratified;
  5. `created` holds `{ record, base }`, the SHA-256 of each record's canonical YAML as created, which is how a
     removal tells a record edited since the add; `adopted` is dropped, since nothing adopts in L1.
- `modified` (a list of the same `{ record, base }` shape) is reserved for L7's entries that change existing records.

---

## Framework-Only Registries

Some registries are only relevant for the **framework repo** (and potentially network hubs) — they track cross-instance state, not local organizational data. Individual instances do **not** need these files.

### instances.yaml — Downstream Instance State

Per-instance record of every downstream instance of this framework. Populated and updated by `npm run analyze:instances`.

Fields: `id`, `name`, `type`, `maturity` (`alpha|beta|production`), `repo`, `local_path`, `cloned`, `federation_network`, `federation_role`, `masterplan_version`, `framework_version`, `last_sync`, `agent_runtime[]`, `skills_extra[]`, `packages[]`, `data_registries_extra[]`, `drift[]`, `notes`.

### skills-matrix.yaml — Cross-Instance Skill Catalog

Every skill across the federation, with `owner`, `instances_using[]`, `in_framework`, `promotion_status` (`canonical|candidate|evaluating|instance-specific`). Surfaces promotion candidates. See `docs/SKILL-PROMOTION.md`.

### packages-matrix.yaml — Cross-Instance Package Catalog

Same shape as `skills-matrix.yaml` but for packages. Surfaces package divergence across instances.

### Extension Pattern for Instances

Instances MAY add their own registries beyond the canonical 14 (e.g., `tasks.yaml`, `pending-payouts.yaml`, `blog-articles.yaml`). When they do:

- Declare the extra registry in the framework's `data/instances.yaml` under `data_registries_extra[]` so drift monitoring knows about it.
- Keep it out of `.well-known/` generation unless adding a `/well-known/` endpoint is intentional.
- Follow canonical conventions (top-level key matches filename; `schema_version: "2.0"` header; entries with unique `id`).

---

## Recognized Extension Registries (Optional Patterns)

Instance-proven registry shapes worth reusing. Not part of the canonical 14; adopt as needed. (Consolidated from instance audits, 2026-07-15.)

### hermes-cron.yaml — Declarative Agent Cron Jobs

Proven in refi-bcn-os + refi-dao-os alongside `packages/hermes-integration`. Declares scheduled proactive-agent jobs (a chat gateway reconciles them on boot — e.g. `infra/hermes/entrypoint.sh`):

```yaml
schema_version: "1.0"
jobs:
  - id: "heartbeat-6h"
    schedule: "0 */6 * * *"      # cron, UTC
    deliver: "telegram"          # delivery channel
    channel: null                # channel/topic id (instance-specific)
    prompt: |
      Read HEARTBEAT.md and report anything urgent or overdue.
```

Keep channel ids and prompts instance-side; the registry shape + boot-reconciliation contract is the reusable part.

### Hub-Type Federation Registries — nodes / funds / initiatives / programs

Proven in regen-coordination-os (Hub-type instance). A network-of-networks graph for hubs coordinating multiple orgs — cross-referencing member nodes, on-chain treasuries, shared initiatives, and funding programs:

```yaml
# nodes.yaml — member/network node registry
nodes:
  - id: "node-example"
    name: ""
    network: ""                  # which federation/network it belongs to
    type: "LocalNode"
    location: ""
    status: "active"
    repo: null
    website: null

# funds.yaml — on-chain fund instances
funds:
  - id: "fund-example"
    type: "safe"                 # safe | gardens-pool | octant-vault | …
    network_chain: ""
    address: ""
    node: "node-example"         # → nodes.yaml
    signers: []
    status: "active"

# initiatives.yaml — cross-network initiatives
initiatives:
  - id: "initiative-example"
    name: ""
    networks: []
    status: "active"
    description: ""

# programs.yaml — funding/coordination programs
programs:
  - id: "program-example"
    name: ""
    category: "funding/artifact-based"   # funding/yield-protocol | funding/streaming | …
    status: "active"
```

Cross-references: `funds.node → nodes.id`, `initiatives.networks[] → nodes.network`, `programs ↔ funds`.

### Other observed instance extensions

- **`orgs.yaml`** (refi-bcn-os) — external-org/stakeholder directory with rings/clusters + JSON compile step for viz. Candidate for a future canonical `orgs.yaml` registry (generic shape, minus geography).
- **`figma-assets.yaml`** (refi-dao-os) — design-asset registry with `share_policy` permission governance (`public-view-no-duplication | duplicatable | private | tbd`) and commons-linkage fields.

---

## Schema Generation

```bash
npm run generate:schemas    # Generate .well-known/*.json from data/*.yaml
npm run validate:schemas    # Validate EIP-4824 compliance
npm run validate:data       # Validate data/*.yaml against the admin schemas
npm run validate:governance # The rules are well-formed, and the git history agrees with them
npm run analyze:instances   # Framework-only — scan downstream instances and write drift report
```

## Notion Sync

```bash
npm run sync:notion         # Bidirectional sync with Notion databases
```

See `docs/TOOL-SETUP.md` for Notion configuration and field mapping.

## Cross-References

| From | To | Via field |
|------|----|-----------|
| projects.yaml | members.yaml | lead, contributors |
| projects.yaml | ideas.yaml | related_ideas |
| projects.yaml | funding-opportunities.yaml | funding_source |
| meetings.yaml | members.yaml | participants |
| ideas.yaml | knowledge-manifest.yaml | source |
| events.yaml | projects.yaml | related_project |

The admin refuses to save an entry that names an id the target registry does not hold. `validate:data`
reports such a reference already in a file as a warning: meeting participants and project leads often name
people of other instances, by ids this one does not hold.

---

_Part of org-os v2.2.0 — see [FILE-STRUCTURE.md](FILE-STRUCTURE.md) for directory layout._
