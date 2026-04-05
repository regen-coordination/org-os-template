# SKILL-SPECIFICATION.md — How to Write and Share Skills

Version: 2.0.0

## Overview

Skills define what agents can do in an org-os workspace. Each skill is a markdown file with YAML frontmatter that teaches an agent a specific capability. Skills are the primary mechanism for extending agent behavior — they are portable, composable, and version-controlled alongside the workspace they serve.

Skills follow a three-tier model:
- **Core skills** ship with the org-os framework and are available to all instances.
- **Custom skills** are created by individual instances for their unique needs.
- **Shared skills** are custom skills that have been promoted to the framework after proving their value.

## Skill File Format

Every skill lives at `skills/[skill-name]/SKILL.md`. The skill name must be kebab-case. The YAML frontmatter defines metadata; the markdown body defines behavior.

### Directory Convention

```
skills/
  meeting-processor/
    SKILL.md
  funding-scout/
    SKILL.md
  my-custom-skill/
    SKILL.md
    templates/          # optional: templates used by the skill
    examples/           # optional: example inputs/outputs
```

### Frontmatter Schema

The YAML frontmatter block is required. All fields are documented below.

```yaml
---
name: skill-name              # kebab-case identifier (must match directory name)
version: 1.0.0               # semver — bump on behavior changes
description: One-line description of what this skill does
author: organizational-os     # who wrote it (framework or instance name)
category: operations          # operations | coordination | knowledge | capital | infrastructure
triggers:                     # phrases that activate this skill
  - "process meeting"
  - "meeting transcript"
inputs:                       # what the skill needs to run
  - transcript (text or file path)
  - date (ISO 8601)
outputs:                      # what the skill produces
  - data/meetings.yaml entry
  - memory/YYYY-MM-DD.md log
dependencies:                 # other skills this depends on
  - schema-generator
tier: core                    # core | custom | shared
metadata:                     # runtime-specific configuration
  openclaw:
    requires:
      env: []                 # environment variables needed
      bins: []                # binaries needed (e.g., "node")
      config: []              # config files needed
---
```

#### Field Reference

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | Yes | string | Kebab-case identifier, must match directory name |
| `version` | Yes | string | Semantic version (MAJOR.MINOR.PATCH) |
| `description` | Yes | string | One-line summary of the skill's purpose |
| `author` | No | string | Creator identifier (`organizational-os` for core skills) |
| `category` | No | string | One of: `operations`, `coordination`, `knowledge`, `capital`, `infrastructure` |
| `triggers` | Yes | list | Natural language phrases that activate this skill |
| `inputs` | Yes | list | What the skill requires to run |
| `outputs` | Yes | list | What the skill produces (file paths, data entries) |
| `dependencies` | No | list | Other skills that must be available |
| `tier` | No | string | `core` (framework), `custom` (instance), or `shared` (promoted) |
| `metadata` | No | object | Runtime-specific config (OpenClaw, Cursor, etc.) |

### Body Structure

The markdown body follows a standard structure. All sections are recommended; "When to Use" and "Procedure" are required.

#### 1. When to Use

Describe the conditions under which this skill should activate. Include both positive triggers ("use when...") and negative triggers ("do NOT use when...").

```markdown
## When to Use

- When you receive a raw meeting transcript or recording
- When someone pastes meeting notes to be formatted and filed
- When asked to "process", "clean up", or "file" meeting notes

## When NOT to Use

- For informal chat logs — use knowledge-curator instead
- For async decisions (no meeting) — write directly to project page
```

#### 2. Procedure

Step-by-step instructions the agent follows. Number the steps. Be explicit about file paths, formats, and decision points.

```markdown
## Procedure

### Step 1: Receive Input
Accept any of:
- Raw transcript text (paste or file)
- Pre-formatted notes to standardize
- File path to a transcript file

### Step 2: Extract Structure
From the transcript, identify:
- **Date**: Look for explicit date, or infer from context
- **Participants**: Speaker labels, names mentioned
- **Key decisions**: "we decided", "agreed to", "confirmed"
- **Action items**: "will [do X]", "[Name] to [do X]"

### Step 3: Write Output
Save to: `packages/operations/meetings/YYMMDD [Meeting Title].md`
```

#### 3. Output Format

Define the exact format of each output. Use code blocks for templates. Specify file paths relative to workspace root.

```markdown
## Output Format

### Meeting Note Template
Save to: `packages/operations/meetings/YYMMDD [Meeting Title].md`

---
categories: [Meetings]
date: YYYY-MM-DD
attendees: [Name1, Name2]
type: sync
---
# Meeting Title

## Key Decisions
- Decision 1

## Action Items
- [ ] Task (Owner — due: YYYY-MM-DD)
```

#### 4. Error Handling

Table or list of failure modes and what the agent should do.

```markdown
## Error Handling

| Situation | Action |
|-----------|--------|
| Input is unclear or truncated | Note gaps explicitly; do not infer |
| Required field cannot be determined | Leave empty, add note for human review |
| Dependency skill unavailable | Log warning, proceed without that step |
| Output directory missing | Create it, log the creation in memory |
```

#### 5. Examples

Concrete input/output examples. These are critical for agent accuracy.

```markdown
## Examples

### Example 1: Simple Sync Meeting
**Input:** "We met with Alice and Bob on 2024-12-15 to discuss Q1 planning..."
**Output:** Meeting note at `packages/operations/meetings/241215 Q1 Planning Sync.md`
```

## Core Skills Reference

The framework ships with 9 core skills. All instances inherit these.

| # | Skill | Category | Purpose | Inputs | Outputs |
|---|-------|----------|---------|--------|---------|
| 1 | `meeting-processor` | operations | Process meeting transcripts into structured organizational records | Transcript (text/file), date, participants | Meeting note in `packages/operations/meetings/`, memory log, HEARTBEAT updates |
| 2 | `funding-scout` | coordination | Identify, track, and report on funding opportunities | Search criteria, org profile from IDENTITY.md | `data/funding-opportunities.yaml` entries, HEARTBEAT deadline alerts |
| 3 | `knowledge-curator` | knowledge | Aggregate, organize, and share knowledge from channels and operational activity | Source content (URLs, text, files), topic | `knowledge/` pages, `data/sources.yaml` entries, `data/knowledge-manifest.yaml` updates |
| 4 | `capital-flow` | capital | Monitor treasury state, queue transactions, and coordinate capital movements | Transaction details, treasury addresses from IDENTITY.md | Transaction queue entries, treasury reports, HEARTBEAT alerts |
| 5 | `schema-generator` | infrastructure | Auto-generate EIP-4824 schemas from operational data | `data/*.yaml` files | `.well-known/*.json` schemas |
| 6 | `heartbeat-monitor` | infrastructure | Proactive organizational health monitoring and task tracking | HEARTBEAT.md, data files, memory logs | Heartbeat reports, urgency classifications, stale-task alerts |
| 7 | `bootstrap-interviewer` | infrastructure | Guided interview for new organization setup (v2) | Operator responses to interview questions | SOUL.md, IDENTITY.md, data/members.yaml, data/projects.yaml, federation.yaml |
| 8 | `idea-scout` | knowledge | Scan knowledge commons for ecosystem gaps and surface ideas (v2) | `knowledge/` content, `data/knowledge-manifest.yaml` | `ideas/*.md` idea files, `data/ideas.yaml` entries |
| 9 | `workspace-improver` | infrastructure | Autonomous improvement loop following the autoresearch pattern (v2) | MASTERPLAN.md directions, evaluation metrics | Data improvements, knowledge gap fills, skill drafts, memory logs |

Skills marked **(v2)** were added in org-os v2.0.0.

### Core Skill Dependencies

```
meeting-processor ──> schema-generator
funding-scout ──> heartbeat-monitor
knowledge-curator ──> schema-generator
capital-flow ──> heartbeat-monitor
idea-scout ──> knowledge-curator
workspace-improver ──> heartbeat-monitor
bootstrap-interviewer ──> schema-generator
```

## Custom Skills

Custom skills are instance-specific capabilities created in the instance's `skills/` directory. They follow the exact same format as core skills but address needs unique to that organization.

### When to Create a Custom Skill

- The capability is specific to your organization's workflow
- No core skill covers the need
- The behavior is complex enough to warrant documentation (more than a few steps)
- Multiple sessions would benefit from the same instructions

### Examples from Active Instances

**refi-bcn-os** — Barcelona cooperative operations:
```yaml
---
name: cooperative-ops
version: 1.0.0
description: Manage Barcelona cooperative operational workflows
triggers:
  - "cooperative update"
  - "coop operations"
inputs:
  - cooperative status data
  - member activity reports
outputs:
  - data/cooperative-status.yaml
  - operational reports
tier: custom
---
```

**refi-dao-os** — Steward council facilitation:
```yaml
---
name: governance-facilitator
version: 1.0.0
description: Facilitate steward council governance processes
triggers:
  - "governance process"
  - "council decision"
  - "proposal review"
inputs:
  - proposal text
  - governance timeline from data/governance.yaml
outputs:
  - governance decision records
  - MEMORY.md updates
  - HEARTBEAT.md governance tasks
tier: custom
---
```

### Naming Custom Skills

- Use kebab-case: `my-skill-name`
- Avoid collisions with core skill names
- Be descriptive: `podcast-processor` over `processor`
- Prefix with domain if ambiguous: `grant-tracker` over `tracker`

## Shared Skills — Promotion Protocol

When a custom skill proves valuable across multiple sessions and could benefit other organizations, it can be promoted to the framework as a shared skill.

### 5-Step Promotion Process

#### Step 1: Create

Build the skill as a custom skill in your instance's `skills/` directory. Follow the standard format. Use it in real sessions.

#### Step 2: Prove Value

The skill must demonstrate value over time:
- Used successfully in at least 5 sessions
- Produces consistent, correct outputs
- Has been refined based on agent feedback and operator corrections
- Error handling covers real failure modes encountered

#### Step 3: Propose to Framework

Submit the skill for framework inclusion:
- Open a PR against the org-os framework repository
- Place the skill in `skills/[skill-name]/SKILL.md`
- Include a brief rationale: what problem it solves, why it's general-purpose
- Reference the instances where it has been tested

Alternatively, declare the skill in your `federation.yaml` under shared skills:
```yaml
skills:
  shared:
    - name: podcast-processor
      version: 1.0.0
      source: refi-dao-os
      status: proposed
```

#### Step 4: Framework Review

The framework maintainers review the skill:
- Is it general enough for multiple organization types?
- Does it follow the specification format?
- Are there conflicts with existing core skills?
- Is the scope well-defined (one clear capability)?
- Are inputs/outputs documented with file paths?

If accepted, the skill is generalized (instance-specific references removed) and merged.

#### Step 5: Other Instances Inherit

Once merged into the framework, other instances receive the skill via:
```bash
npm run sync:upstream
```

The skill moves from `tier: custom` to `tier: shared` (or `tier: core` if adopted as a core skill).

## Skill Discovery

Agents find and activate skills through three mechanisms.

### 1. Trigger Matching

When the operator's message matches a skill's `triggers` list, the agent activates that skill. Matching is fuzzy — the agent looks for semantic similarity, not exact string matches.

Example: The operator says "can you clean up these meeting notes from yesterday?" The agent matches this to the `meeting-processor` skill via the triggers "process meeting" and "meeting transcript".

### 2. Explicit Invocation

The operator names the skill directly:
- "Run the funding-scout skill"
- "Use schema-generator to update the schemas"
- "Activate heartbeat-monitor"

### 3. Contextual Activation

Skills can activate as part of another skill's procedure. For example:
- `meeting-processor` calls `schema-generator` after writing meeting data
- `funding-scout` calls `heartbeat-monitor` to register deadline alerts
- `workspace-improver` may invoke any skill as part of its improvement loop

Dependencies declared in frontmatter signal these relationships. The agent checks that dependent skills are available before running a skill that requires them.

### Discovery at Startup

During the startup sequence (see `AGENTIC-ARCHITECTURE.md`), the agent reads `skills/*/SKILL.md` to build its skill inventory. This happens after reading the core files (MASTERPLAN, SOUL, IDENTITY, etc.) and before entering the operational loop.

## Versioning

Skills use semantic versioning (semver):

- **MAJOR** (1.0.0 to 2.0.0): Breaking change to inputs, outputs, or behavior
- **MINOR** (1.0.0 to 1.1.0): New capability added, backward-compatible
- **PATCH** (1.0.0 to 1.0.1): Bug fix, wording improvement, no behavior change

When a core skill is updated in the framework, instances receive the update via `npm run sync:upstream`. The agent logs version changes in `memory/YYYY-MM-DD.md`.

## Best Practices

### Keep Skills Focused
Each skill should do one thing well. If a skill has more than 6-8 steps in its procedure, consider splitting it into two skills with a dependency relationship.

### Include Concrete Examples
Examples are the most important part of a skill for agent accuracy. Include at least one complete input-to-output example. Real examples from actual sessions are better than synthetic ones.

### Define Clear Inputs and Outputs
Every input should specify its type (text, file path, YAML data) and whether it is required or optional. Every output should specify the exact file path pattern where it will be written.

### Reference Data Files by Path
Always use workspace-relative paths: `data/meetings.yaml`, not "the meetings file". This removes ambiguity and helps agents locate files correctly.

### Test with the Agent Before Committing
Run the skill in a real session before committing it. Watch for:
- Does the agent follow the procedure in order?
- Are the outputs in the correct format and location?
- Does error handling cover the failure modes you encountered?
- Are triggers specific enough to avoid false activations?

### Write for the Agent, Not the Human
Skills are instructions for an AI agent. Be explicit about what to do at each step. Avoid vague directives like "process the data appropriately" — instead specify the exact transformation.

### Keep Triggers Specific
Triggers that are too broad cause false activations. "process" is too broad; "process meeting transcript" is better. Include 2-5 triggers per skill.

### Document What NOT to Do
The "When NOT to Use" section prevents skill misapplication. This is especially important when skills have overlapping domains (e.g., `knowledge-curator` vs. `meeting-processor` for processing notes).

---

_Part of org-os v2.0.0 — see [AGENTIC-ARCHITECTURE.md](AGENTIC-ARCHITECTURE.md) for the complete agent operating model._
