# IDEA-HATCHING.md — Knowledge → Ideas → Hatched Projects

Version: 2.0.0

## Overview

org-os isn't just internal operations — it's a **coordination layer for ecosystem development**. An org consolidates its repos, knowledge, and community intelligence. From that base, it identifies ecosystem gaps and hatches projects to fill them.

## The Pipeline

```
knowledge/               ideas/                  hatched repos
┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐
│ Blog posts   │    │ Community    │    │ Standalone project   │
│ Podcast eps  │───▶│ submissions  │───▶│ repo with org-os     │
│ Research     │    │ Agent-       │    │ workspace files,     │
│ Meeting      │    │ surfaced     │    │ deployed agent,      │
│ insights     │    │ gaps         │    │ community stewards   │
└──────────────┘    └──────────────┘    └──────────────────────┘
     (ingest)          (curate)              (hatch & develop)
```

## Stage 1: Knowledge → Idea Extraction

The `knowledge-curator` skill processes external content (blog, podcast, meetings, docs) into structured knowledge pages in `knowledge/`.

The `idea-scout` skill then scans knowledge for:
- **Ecosystem gaps**: "there is no...", "missing...", "need for..."
- **Repeated themes**: Topics appearing across multiple sources
- **Unmet needs**: Problems described without solutions
- **Emerging trends**: New patterns not yet addressed
- **Cross-domain opportunities**: Insights from combining domains

Surfaced ideas go into `data/ideas.yaml` with status `surfaced`.

Community members can also submit ideas directly via:
- The `ideation-board` web app
- Markdown files in `ideas/`
- Chat interface (Telegram bot)

## Stage 2: Idea Lifecycle

```
surfaced → proposed → approved → developing → hatched → archived
   ↑          ↑          ↑           ↑           ↑
 agent    community   council    developers  repo created
```

### Status Definitions

| Status | Who | What happens |
|--------|-----|-------------|
| `surfaced` | Agent | Detected from knowledge analysis. Needs human review. |
| `proposed` | Community member | Formally proposed with champion(s). Open for discussion. |
| `approved` | Council/community | Approved for development. Resources allocated. |
| `developing` | Developers | Active development. May have working prototype. |
| `hatched` | Operator/agent | Spawned as independent repo with org-os workspace. |
| `archived` | Anyone | Completed, abandoned, or superseded. |

### ideas.yaml Schema

```yaml
ideas:
  - id: "idea-042"
    title: "Carbon Credit Verification Toolkit"
    status: "developing"
    source: "knowledge/carbon-markets/verification-gaps.md"
    submitted_by: "agent"      # "agent" or member-id
    champions: ["luiz", "monty"]
    ecosystem_gap: "No open-source MRV tools for small-scale projects"
    description: "Build an open-source toolkit for MRV at small scale"
    hatched_repo: null
    skills_needed: ["smart-contracts", "data-science", "field-ops"]
    resources: []
    compensation:
      model: null              # bounty | retroactive | grants | equity | null
      pool: null
    created: "2026-03-15"
    updated: "2026-03-15"
    votes: 0
    comments: []
```

## Stage 3: Hatching — Idea → Project Repo

When an idea reaches `approved` status and development resources are available:

### Hatching Process

1. **Scaffold repo**: Create new repo from org-os template
2. **Pre-populate knowledge**: Copy relevant pages from parent org's `knowledge/`
3. **Set identity**: Generate SOUL.md, IDENTITY.md from idea description
4. **Link federation**: Add `federation.yaml` with upstream link to parent org
5. **Register**: Add hatched_repo URL to the idea's `ideas.yaml` entry
6. **Deploy agent**: The hatched repo has its own agent that inherits parent skills

### Federation Link

The hatched repo federates back to the parent org:

```yaml
# In hatched repo's federation.yaml
federation:
  upstream:
    - repo: "github.com/refi-dao/refi-dao-os"
      sync: true
  network: "regen-coordination"
```

The parent org lists it as downstream:

```yaml
# In parent org's federation.yaml
federation:
  downstream:
    - name: "MRV Toolkit"
      repo: "github.com/refi-dao/mrv-toolkit"
      hatched_from: "idea-042"
```

### What the Hatched Repo Gets

- org-os workspace structure (AGENTS.md, SOUL.md, etc.)
- Relevant knowledge from parent org
- Core skills from the framework
- Federation link back to parent
- Initial MASTERPLAN.md based on the idea description
- Community stewards from the idea's champions

## Stage 4: Community Development

Once hatched, the project repo is open for community contribution:

- Community members deploy agents on the repo to develop it
- The repo leverages the parent org's knowledge, skills, and workflows
- Progress feeds back to the parent org via federation
- The `ideation-board` shows hatching status

## Compensation (Future-Ready)

Not built in v2, but the data model supports future compensation:

- `compensation.model` in ideas.yaml tracks reward mechanism
- Links to `data/funding-opportunities.yaml` for grant-funded ideas
- Links to `data/finances.yaml` for bounty pools
- Gardens conviction voting can prioritize which ideas get funded

Possible models:
- **Bounty**: Fixed reward for completing the idea
- **Retroactive**: Reward based on impact after completion
- **Grants**: External funding secured for the idea
- **Equity**: Share in the hatched project's value

## Ideation Board Integration

The `packages/ideation-board/` web app shows the full lifecycle:

- Browse all ideas with status filters
- Submit new ideas (web form)
- Vote on ideas (community signal)
- Track ideas through the pipeline
- See hatched repos with links

## Impact

This pipeline transforms an org from a passive knowledge holder into an active ecosystem developer. By processing knowledge into ideas and hatching ideas into projects, the org takes agency in filling ecosystem gaps — coordinating community effort toward the most impactful opportunities.

---

_Part of org-os v2.0.0 — see [AGENTIC-ARCHITECTURE.md](AGENTIC-ARCHITECTURE.md) for the broader agent model._
