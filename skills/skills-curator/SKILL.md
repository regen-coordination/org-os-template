---
name: skills-curator
version: 1.0.0
description: Curate the right agent skills + libraries before building any new initiative (Phase 0 of the project lifecycle)
author: organizational-os
category: infrastructure
triggers:
  - "curate skills"
  - "skills curation"
  - "phase 0"
  - "what skills should we use"
  - "scope skills for"
  - "before we build"
inputs:
  - initiative description (1–3 sentence brief)
  - tech stack hints (frontend framework, language, deploy target if known)
  - design surface hints (visual system, accessibility, motion, color)
  - skill marketplaces to scan (defaults: agentskills.io, skills.sh, github.com/VoltAgent/awesome-design-md, github.com/anthropics/skills)
outputs:
  - docs/plans/YYYY-MM-DD-skills-curation.md (ranked candidates + chosen install set + deferred list)
  - skills installed at `.agents/skills/<name>/` (or platform equivalent)
  - npm dependency hints captured in the curation doc (not installed yet — that's the build phase)
dependencies: []
tier: core
---

# Skills Curator

## When to Use

**Before any non-trivial initiative.** Specifically:

- Before `superpowers:writing-plans` runs for an implementation plan that introduces new domains (frontend, design system, ML, data pipeline, etc.)
- After `superpowers:brainstorming` produces a design spec
- When an operator says "what skills should we use", "scope skills for", or asks for a "Phase 0"
- When a new project crosses 2+ specialized domains and the agent stack hasn't been picked

**Skip when:**
- The initiative is a routine task in an already-equipped project (no new domains)
- The skill stack is locked by an existing convention (e.g., the project's CLAUDE.md mandates specific skills)

## Why It Exists

Building well requires the right tools. Picking tools mid-build creates rework and inconsistency. Phase 0 separates *deciding what to use* from *building with it* — the same way that brainstorming separates *deciding what to build* from *building it*.

This skill produces a single artifact (`docs/plans/YYYY-MM-DD-skills-curation.md`) that any later phase can audit. It also creates a clean retrospective surface: at v1 of the initiative, every chosen skill gets a promote/improve/drop verdict against measured value.

## Procedure

### Step 1 — Read the design spec or brief

Read the initiative's design spec (typically at `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`) or the operator's brief. Extract:

- **Domains involved** (e.g., frontend, design system, color, animation, accessibility, data pipeline, deploy, testing)
- **Tech stack constraints** (e.g., Astro + React, vanilla, framework-locked)
- **Design surface needs** (component library, color manipulation, motion, a11y)
- **Process needs** (TDD, parallel agents, code review)

### Step 2 — Identify candidate sources

Default sources to scan:

- **`agentskills.io`** — community skill marketplace
- **`skills.sh`** — skill marketplace
- **`github.com/VoltAgent/awesome-design-md`** — design.md templates and design-system skills
- **`github.com/anthropics/skills`** — official Anthropic skill catalog
- **Already-installed superpowers skills** (process layer — usually already present)
- **Project-local skills** at `skills/`, `.agents/skills/`, or instance equivalent

The operator may add or substitute sources in the brief.

### Step 3 — Dispatch a research agent

Dispatch a single subagent (`general-purpose` or `Explore`) with a focused brief:

> "Find skills matching {domain1, domain2, domain3} from {sources}. For each candidate, return: name, source URL, install command, one-line fitness assessment, and any compatibility notes (frameworks supported, peer-deps, license). Rank by fitness for this initiative. Cap at 12 candidates."

The agent's report is the raw input for the next step — do not act on its summary alone.

### Step 4 — Triage candidates into three buckets

For each candidate, assign:

- **Install** — clear fitness, no major risk, ride-along value during the build
- **Defer** — interesting but not immediately needed; revisit at later phase
- **Drop** — poor fit (wrong framework, abandoned, license incompatible, redundant with already-installed)

A healthy curation: 4–6 installs, 4–8 deferrals, the rest dropped.

### Step 5 — Produce the curation doc

Write `docs/plans/YYYY-MM-DD-skills-curation.md` with this structure:

```markdown
# Skills Curation — <Initiative Name>

**Date:** YYYY-MM-DD
**Initiative:** <link to design spec>
**Curated by:** skills-curator skill, dispatched agent <agent-id>

## Domains in scope

- <domain 1>
- <domain 2>
- ...

## Process skills (already available, no install)

| Skill | Used for |
|---|---|
| superpowers:brainstorming | <phase> |
| superpowers:writing-plans | <phase> |
| ... | ... |

## Implementation skills — INSTALL

| Skill | Source | Install command | Why |
|---|---|---|---|
| <name> | <url> | `<cmd>` | <one-line fitness> |

## Implementation skills — DEFER

| Skill | Source | Reason to defer |
|---|---|---|
| <name> | <url> | <reason> |

## Inspiration / library references (npm deps, not skills)

| Reference | Cited in | Use |
|---|---|---|
| <name> | DESIGN.md §<n> | <use case> |

## Promotion contract

After v1 of <initiative> ships, each installed skill gets a verdict in the retrospective:
- **Promote** — works as expected, becomes a standard org-os skill
- **Improve-then-promote** — needs a fix or fork before promotion
- **Drop** — didn't deliver value; uninstall

Retrospective doc: `docs/plans/YYYY-MM-DD-<initiative>-retrospective.md` (created by retrospective skill at v1)
```

### Step 6 — Install the chosen skills

For each "Install" row, run the install command. Verify the skill is loaded:

- For Claude Code: skill appears in `Skill` tool listing
- For other harnesses: per harness convention

### Step 7 — Log the curation

Append to today's `memory/YYYY-MM-DD.md`:

```markdown
## Skills curation — <initiative>

- Curation doc: `docs/plans/YYYY-MM-DD-skills-curation.md`
- Installed: <count> skills (<list>)
- Deferred: <count>
- Dropped: <count>
- Next: invoke superpowers:writing-plans against the design spec
```

## Output Format

### Curation doc (`docs/plans/YYYY-MM-DD-skills-curation.md`)

See Step 5 for the full template.

## Project Lifecycle Position

```
brainstorming                    →  produces design spec
    ↓
SKILLS-CURATOR (this skill)      →  produces skills curation doc + installs skills
    ↓
writing-plans                    →  produces implementation plan
    ↓
executing-plans (+ subagents)    →  builds the thing
    ↓
verification-before-completion   →  validates
    ↓
finishing-a-development-branch   →  merges / ships
    ↓
retrospective                    →  promote/improve/drop verdicts on chosen skills
```

This skill is **always Phase 0** of any new initiative that introduces new domains. It precedes implementation planning.

## Error Handling

- If the design spec doesn't exist, ask the operator for a brief (1–3 sentences) and proceed
- If a skill's install command fails, log the failure in the curation doc and mark the skill as DEFERRED with the failure mode
- If two candidates conflict (same domain, mutually exclusive — e.g., two color-manipulation skills), pick one and note the alternate as DEFERRED
- If the dispatched research agent returns fewer than 4 candidates, broaden the source list and re-dispatch once

## Examples

### Example 1: Frontend initiative with design system

**Initiative brief:** "Build an Astro + React app with shadcn/ui, OKLCH-driven design tokens, and motion utilities"

**Domains in scope:** frontend (Astro), design system, color (OKLCH), motion, accessibility

**Sources scanned:** agentskills.io, skills.sh, awesome-design-md, oklch.fyi/skill

**Outcome:**
- INSTALL: oklch-color, design-md-template, shadcn-installer, a11y-audit (4 skills)
- DEFER: storybook-builder, css-pruner (2 skills)
- DROP: 4 candidates (wrong framework or abandoned)

### Example 2: Data pipeline initiative

**Initiative brief:** "Aggregate funding data from federation YAML + GitHub + Gitcoin into normalized Zod-validated schema"

**Domains in scope:** data adapters, schema validation, GitHub API, deduplication

**Outcome:**
- INSTALL: zod-schema-helper, github-api-wrapper (2 skills)
- DEFER: gitcoin-graphql-skill (works but adds peer-dep weight; revisit if Gitcoin becomes hot path)
- DROP: 3 candidates (overlapping with already-installed)
