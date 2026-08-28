---
name: superpowers-subagent-driven-development
version: 5.0.7
description: Use when executing implementation plans with independent tasks in the current session. Dispatches fresh subagent per task with two-stage review after each.
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

# Subagent-Driven Development

Execute plan by dispatching fresh subagent per task, with two-stage review after each: spec compliance review first, then code quality review.

**Why subagents:** You delegate tasks to specialized agents with isolated context. By precisely crafting their instructions and context, you ensure they stay focused and succeed at their task. They should never inherit your session's context or history — you construct exactly what they need. This also preserves your own context for coordination work.

**Core principle:** Fresh subagent per task + two-stage review (spec then quality) = high quality, fast iteration

## When to Use

Use when:
- You have an implementation plan with independent tasks
- You want to stay in the current session (no context switch)
- Tasks are mostly independent (not tightly coupled)

**vs. Executing Plans:** Same session, fresh subagent per task, two-stage review, faster iteration.

**vs. Manual execution:** Subagents follow TDD naturally, fresh context per task, parallel-safe.

## The Process

1. **Read plan** — extract all tasks with full text, note context, create TodoWrite
2. **Per task:**
   - Dispatch implementer subagent with full task text + context
   - Answer any questions from implementer
   - Implementer implements, tests, commits, self-reviews
   - Dispatch spec reviewer subagent — confirm code matches spec
   - If issues: implementer fixes, re-review
   - Dispatch code quality reviewer subagent — review implementation quality
   - If issues: implementer fixes, re-review
   - Mark task complete
3. **After all tasks:**
   - Dispatch final code reviewer for entire implementation
   - Use `superpowers:finishing-a-development-branch` to complete

## Model Selection

Use the least powerful model that can handle each role:

- **Mechanical tasks** (1-2 files, clear specs): fast/cheap model
- **Integration/judgment** (multi-file, pattern matching): standard model
- **Architecture/design/review**: most capable model

## Handling Implementer Status

Implementer subagents report one of four statuses:

- **DONE:** Proceed to spec compliance review.
- **DONE_WITH_CONCERNS:** Read concerns. If about correctness/scope, address before review. If observations, note and proceed.
- **NEEDS_CONTEXT:** Provide missing context and re-dispatch.
- **BLOCKED:** Assess blocker:
  1. Context problem → provide more context, re-dispatch same model
  2. Needs more reasoning → re-dispatch with more capable model
  3. Task too large → break into smaller pieces
  4. Plan is wrong → escalate to human

**Never** ignore an escalation or force the same model to retry without changes.

## Red Flags

**Never:**
- Start implementation on main/master without explicit consent
- Skip reviews (spec compliance OR code quality)
- Proceed with unfixed issues
- Dispatch multiple implementation subagents in parallel
- Make subagent read plan file (provide full text instead)
- Skip scene-setting context
- Ignore subagent questions
- Accept "close enough" on spec compliance
- Skip review loops
- Let implementer self-review replace actual review
- Start code quality review before spec compliance is ✅
- Move to next task while either review has open issues

## Integration

**Required workflow skills:**
- `superpowers:using-git-worktrees` — REQUIRED: Set up isolated workspace before starting
- `superpowers:writing-plans` — Creates the plan this skill executes
- `superpowers:requesting-code-review` — Code review template for reviewer subagents
- `superpowers:finishing-a-development-branch` — Complete development after all tasks

**Subagents should use:**
- `superpowers:test-driven-development` — Subagents follow TDD for each task

**Alternative workflow:**
- `superpowers:executing-plans` — Use for parallel session instead of same-session execution
