---
name: superpowers-brainstorming
version: 5.0.7
description: You MUST use this before any creative work — creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation.
author: obra (Jesse Vincent)
license: MIT
category: engineering
metadata:
  openclaw:
    requires:
      env: []
      bins: []
      config: []
---

# Brainstorming Ideas Into Designs

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval.

<HARD-GATE>
Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it. This applies to EVERY project regardless of perceived simplicity.
</HARD-GATE>

## Anti-Pattern: "This Is Too Simple To Need A Design"

Every project goes through this process. A todo list, a single-function utility, a config change — all of them. "Simple" projects are where unexamined assumptions cause the most wasted work. The design can be short (a few sentences for truly simple projects), but you MUST present it and get approval.

## Checklist

Complete these in order:

1. **Explore project context** — check files, docs, recent commits
2. **Ask clarifying questions** — one at a time, understand purpose/constraints/success criteria
3. **Propose 2-3 approaches** — with trade-offs and your recommendation
4. **Present design** — in sections scaled to their complexity, get user approval after each section
5. **Write design doc** — save to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and commit
6. **Spec self-review** — quick inline check for placeholders, contradictions, ambiguity, scope
7. **User reviews written spec** — ask user to review the spec file before proceeding
8. **Transition to implementation** — invoke `superpowers:writing-plans` skill to create implementation plan

## The Process

**Understanding the idea:**
- Check out the current project state first (files, docs, recent commits)
- If the request describes multiple independent subsystems, flag this immediately. Decompose into sub-projects.
- Ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible
- Focus on: purpose, constraints, success criteria

**Exploring approaches:**
- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option

**Presenting the design:**
- Scale each section to its complexity
- Ask after each section whether it looks right
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify

**Design for isolation and clarity:**
- Break the system into smaller units with one clear purpose each
- Each unit should have well-defined interfaces
- Can someone understand what a unit does without reading its internals?
- Smaller, well-bounded units are easier to reason about

**Working in existing codebases:**
- Explore current structure before proposing changes
- Follow existing patterns
- Include targeted improvements as part of the design if existing code has problems
- Don't propose unrelated refactoring

## After the Design

**Documentation:**
- Write validated design to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
- Commit the design document to git

**Spec Self-Review:**
1. **Placeholder scan:** Any "TBD", "TODO", incomplete sections? Fix them.
2. **Internal consistency:** Do sections contradict each other?
3. **Scope check:** Focused enough for a single implementation plan?
4. **Ambiguity check:** Could any requirement be interpreted two ways?

Fix issues inline. No need to re-review — just fix and move on.

**User Review Gate:**
After spec review, ask user to review before proceeding:
> "Spec written and committed to `<path>`. Please review it and let me know if you want to make any changes before we start writing out the implementation plan."

Wait for user response. Only proceed once approved.

**Implementation:**
- Invoke the `superpowers:writing-plans` skill
- Do NOT invoke any other skill. `writing-plans` is the next step.

## Key Principles

- **One question at a time** — Don't overwhelm
- **Multiple choice preferred** — Easier to answer
- **YAGNI ruthlessly** — Remove unnecessary features
- **Explore alternatives** — Always propose 2-3 approaches
- **Incremental validation** — Present design, get approval before moving on
- **Be flexible** — Go back and clarify when something doesn't make sense
