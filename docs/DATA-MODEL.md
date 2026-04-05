# DATA-MODEL.md — org-os Data Model Specification

Version: 2.0.0

## Overview

org-os structures all organizational data as YAML registries in `data/`. These files are the single source of truth — all schemas, dashboards, and agent queries read from them.

After any data change: `npm run generate:schemas && npm run validate:schemas`

### Conventions

- Top-level key matches the filename (e.g., `members:` in `members.yaml`)
- Each entry has a unique `id` field
- Dates use ISO 8601 format (`YYYY-MM-DD`)
- Status fields use lowercase kebab-case
- Add `schema_version: "2.0"` header to each file

---

## Registries (13 total)

### 1. members.yaml — People & Roles (Required)

```yaml
schema_version: "2.0"
members:
  - id: "luiz"
    name: "Luiz Fernando"
    role: "Core Steward"
    layer: "core"              # core | contributor | community | observer
    status: "active"           # active | inactive | alumni
    joined: "2023-01-15"
    left: null
    skills: ["governance", "engineering", "coordination"]
    handles:
      github: "luizfernandosg"
      telegram: "@luizfernando"
      email: "luiz@example.com"
    affiliations: []
```

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
  model: "steward-council"     # steward-council | multisig | assembly | conviction
  current_phase: "active"      # bootstrap | transition | active | sunset
  infrastructure:
    safe: "0x..."
    hats_tree: null
    gardens: null
    snapshot: null
  decisions:
    - id: "gov-001"
      title: "Adopt Distributed Stewardship Model"
      type: "proposal"         # proposal | election | amendment | emergency
      status: "ratified"       # draft | voting | ratified | rejected | expired
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
```

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
    submitted_by: "agent"      # "agent" | member-id
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

---

## Schema Generation

```bash
npm run generate:schemas    # Generate .well-known/*.json from data/*.yaml
npm run validate:schemas    # Validate EIP-4824 compliance
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

---

_Part of org-os v2.0.0 — see [FILE-STRUCTURE.md](FILE-STRUCTURE.md) for directory layout._
