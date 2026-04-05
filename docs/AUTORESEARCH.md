# AUTORESEARCH.md — Autonomous Workspace Improvement Pattern

Version: 2.0.0

## Overview

Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch), org-os adopts an **autonomous iterative improvement loop** where agents don't just operate within the workspace — they improve it.

The autoresearch model: `program.md` (human-written instructions) guides an agent that modifies `train.py` (the single editable surface), runs experiments with fixed time budgets and clear metrics, and keeps/discards changes based on results. Humans wake up to improved systems.

## Applied to org-os

| autoresearch concept | org-os equivalent | Role |
|---------------------|-------------------|------|
| `program.md` | `MASTERPLAN.md` | Human-written directions, activations, research agenda |
| `train.py` | `data/*.yaml` + `skills/` + `knowledge/` | The editable surface agents improve |
| `val_bpb` | HEARTBEAT.md metrics | Clear success criteria |
| experiment log | `memory/YYYY-MM-DD.md` | What was tried, what worked |

## The Loop

```
1. Read MASTERPLAN.md     → understand current directions
2. Identify improvement   → knowledge gap, stale data, missing skill
3. Make scoped change     → process a source, fill a gap, draft a skill
4. Evaluate               → schemas pass? HEARTBEAT count down? coverage up?
5. Log results            → memory/ with before/after metrics
6. Keep or revert         → based on evaluation
7. Repeat
```

## MASTERPLAN.md as program.md

MASTERPLAN.md is the most important human-authored file in org-os. It's how operators steer autonomous agent behavior over time.

Operators write:
- **Activations**: What the agent should focus on right now
- **Research directions**: What knowledge gaps to fill, what processes to improve
- **Success metrics**: How to evaluate whether improvements worked
- **Boundaries**: What NOT to change autonomously

Agents read MASTERPLAN.md at the start of every session and use it to prioritize improvement work.

## Scoped Modification

Agents have a clearly defined editable surface:

### May modify autonomously
- `data/*.yaml` — Fill gaps, update stale records
- `knowledge/` — Process new content, expand coverage
- `memory/` — Log all activity
- `skills/` — Draft new skill definitions
- `ideas/` — Surface ideas from knowledge analysis
- `.well-known/` — Regenerate schemas
- `HEARTBEAT.md` — Update task status

### Human-controlled (never modify autonomously)
- `SOUL.md` — Organization identity and values
- `IDENTITY.md` — Governance infrastructure
- `federation.yaml` — Network relationships
- `MASTERPLAN.md` — Strategic direction
- `package.json` — Dependencies and scripts

This mirrors autoresearch's constraint: agents modify `train.py` but never `prepare.py` or `program.md`.

## Fixed Evaluation Surface

Every improvement must be measured. Standard metrics:

| Metric | Measurement | Target |
|--------|------------|--------|
| Schema validation | `npm run validate:schemas` | Pass |
| HEARTBEAT pending | Count of unchecked `- [ ]` items | Decreasing |
| Knowledge coverage | Domains with `comprehensive` coverage | Increasing |
| Data freshness | Registries with `last_updated` within 7 days | Increasing |
| Idea pipeline | Active ideas (surfaced → developing) | Growing |
| Data completeness | Non-null required fields percentage | Increasing |

## Experiment Logging

Every improvement attempt is logged in `memory/YYYY-MM-DD.md`:

```markdown
## Autoresearch Session [HH:MM]

### Improvement: [title]
**Direction:** [MASTERPLAN activation or priority]
**Before:** [metric = value]
**Action:** [what was done]
**After:** [metric = value]
**Result:** Kept / Reverted
**Notes:** [observations]
```

This creates an audit trail. Operators can review accumulated improvements on their next session.

## Implementation

The `workspace-improver` skill in `skills/workspace-improver/SKILL.md` implements this pattern. It:

1. Reads MASTERPLAN.md for current directions
2. Identifies the highest-priority improvement
3. Measures baseline metrics
4. Makes a scoped change
5. Evaluates the result
6. Keeps or reverts
7. Logs everything

See the skill definition for detailed procedure and examples.

## Design Principles

1. **One change per cycle**: Each improvement is independently evaluable and reversible
2. **Measure first**: Always record baseline before changing anything
3. **Clear boundaries**: Agents know exactly what they can and cannot modify
4. **Human steering**: MASTERPLAN.md is the only way to change agent direction
5. **Transparent logging**: Every action logged with before/after metrics
6. **Conservative by default**: When in doubt, don't change — flag for human review

---

_Part of org-os v2.0.0 — see [AGENTIC-ARCHITECTURE.md](AGENTIC-ARCHITECTURE.md) for the broader agent operating model._
