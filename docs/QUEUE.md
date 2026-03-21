# Task Queue — Organizational OS Agent

**Version:** 1.0  
**Purpose:** Prioritized task management for org-os operations  
**Updated:** Daily during heartbeat checks

---

## Queue Philosophy

**Pull-based, not push-based.** The agent picks tasks from this queue during natural breaks in conversation — not interrupting the user unless P0 critical.

**Principles:**
1. **Visible work** — All tasks recorded, nothing "mental noted"
2. **Prioritized** — P0 (critical) → P1 (high) → P2 (medium) → P3 (low)
3. **Categorized** — Easy to batch similar work
4. **Time-bounded** — Tasks without deadlines drift

---

## Priority Levels

| Level | Response Time | Examples |
|-------|---------------|----------|
| **P0** — Critical | Immediate (< 1 hour) | Security issues, broken federation, data loss |
| **P1** — High | Same day | Feature completion, urgent review, deadline approaching |
| **P2** — Medium | This week | Improvements, documentation, testing |
| **P3** — Low | When convenient | Research, nice-to-haves, exploration |

---

## Current Queue

### P0 — Critical (None currently)

```
[Empty — good!]
```

### P1 — High

```
ID: KOI-IMPL-001
Task: Complete KOI bridge connection to coordinator
Added: 2026-03-21
Due: 2026-03-28
Notes: Skeleton implemented, needs real coordinator URL and testing
Blockers: Waiting for coordinator endpoint from BlockScience

ID: OPAL-TEST-001
Task: Test OPAL bridge in refi-bcn-os with real meeting
Added: 2026-03-21
Due: 2026-03-25
Notes: Package deployed, needs actual meeting transcript to process
Blockers: None — ready to test

ID: FED-SECRET-001
Task: Configure GitHub Secrets for federation workflows
Added: 2026-03-21
Due: 2026-03-26
Notes: Workflows created but need NODE_PUSH_TOKEN, PEER_SYNC_TOKEN
Blockers: Need token from org admin
```

### P2 — Medium

```
ID: REGEN-AGENTS-001
Task: Implement 4 Regen custom agents (agriculture, commons, impact, bioregional)
Added: 2026-03-21
Due: 2026-04-15
Notes: Specs complete from swarm, implementation started but incomplete
Blockers: None — can proceed incrementally

ID: COPYFAIR-001
Task: Technical implementation of CopyFair attribution
Added: 2026-03-21
Due: 2026-04-30
Notes: Charter drafted, needs code for value tracking
Blockers: Waiting for spec finalization

ID: DOC-EXAMPLES-001
Task: Add example knowledge (sample decisions, patterns, insights)
Added: 2026-03-21
Due: 2026-04-07
Notes: Templates exist, need concrete examples from actual work
Blockers: None
```

### P3 — Low

```
ID: SUPER-AGENT-001
Task: Build super-agent coordination layer
Added: 2026-03-21
Due: 2026-05-31
Notes: Architecture in skills-agent-dojo-design.md, needs implementation
Blockers: Depends on 4 specialist agents being ready first

ID: RESEARCH-KOI-001
Task: Research KOI integration patterns from other orgs
Added: 2026-03-21
Due: As convenient
Notes: Look at Metagov, BlockScience deployments for patterns
Blockers: None — background research
```

---

## Completed Recently

```
ID: OPAL-DEPLOY-001 | Status: ✅ Complete | Date: 2026-03-21
Task: Deploy OPAL bridge to refi-bcn-os
Notes: Successfully deployed and committed

ID: KOI-SKELETON-001 | Status: ✅ Complete | Date: 2026-03-21
Task: Create KOI bridge skeleton implementation
Notes: All TypeScript files created, ~700 lines

ID: FED-TEST-001 | Status: ✅ Complete | Date: 2026-03-21
Task: Create federation test suite
Notes: test-federation.sh created and validated

ID: DOC-PRACTICAL-001 | Status: ✅ Complete | Date: 2026-03-21
Task: Create practical knowledge commons guide
Notes: practical-knowledge-commons.md and quickref created
```

---

## Queue Workflow

### Adding Tasks

**Method 1:** User adds directly (edit this file)
```markdown
ID: [PREFIX]-[NUMBER]
Task: [Description]
Added: [YYYY-MM-DD]
Due: [YYYY-MM-DD or "As convenient"]
Notes: [Context, blockers, links]
```

**Method 2:** Agent adds during conversation
> "Remember to [task]"
> → Agent adds to P2 or P3 (unless user specifies priority)

### Processing Tasks

**Agent's daily heartbeat check:**
1. Review this QUEUE.md
2. Check deadlines approaching (< 48 hours)
3. Check P0/P1 items
4. If work needed → alert user
5. If nothing urgent → continue background work

**User-initiated work:**
1. Pick task from queue
2. Work on it
3. Mark complete or update status

### Completing Tasks

```bash
# Update QUEUE.md
# Move from Current Queue to Completed Recently
# Add completion date

# Then commit
git add docs/QUEUE.md
git commit -m "queue: Complete [ID] — [brief description]"
```

---

## Categories

Tasks are tagged by category for batching:

| Category | Prefix | Typical Work |
|----------|--------|--------------|
| **Infrastructure** | INFRA- | Package development, setup, configuration |
| **Knowledge** | KNOW- | Documentation, capture, curation |
| **Governance** | GOV- | Decisions, council, voting |
| **Operations** | OPS- | Meetings, projects, funding |
| **Integration** | INT- | External tools, APIs, sync |
| **Documentation** | DOC- | Guides, examples, architecture |
| **Research** | RES- | Exploration, learning, prototypes |
| **Agent Development** | AGENT- | Skill building, training, testing |

---

## Integration with GitHub

**For complex tasks, create GitHub Issue:**
1. Add to QUEUE.md with note: "See GitHub Issue #XXX"
2. Link issue back to QUEUE.md
3. Update QUEUE.md when issue closes

**QUEUE.md remains source of truth** for agent's daily checks.

---

## Rhythm

**Daily (during heartbeat):**
- [ ] Review P0/P1 items
- [ ] Check approaching deadlines
- [ ] Update any completed tasks

**Weekly (Monday mornings):**
- [ ] Full queue review
- [ ] Reprioritize as needed
- [ ] Add new tasks from conversations
- [ ] Archive old completed tasks (move to separate file)

**Monthly:**
- [ ] Strategic review — are priorities right?
- [ ] Clean up completed items (> 30 days old)
- [ ] Check for stale P3 items (convert to P2 or close)

---

## Template for New Tasks

```markdown
ID: [CATEGORY]-[NUMBER]
Task: [Clear, actionable description]
Added: YYYY-MM-DD
Due: YYYY-MM-DD or "As convenient"
Priority: P0/P1/P2/P3
Category: infrastructure/knowledge/governance/operations/integration/documentation/research/agent
Notes:
- Context: [Why this matters]
- Blockers: [What's stopping progress]
- Links: [Related files, issues, docs]
- Estimated effort: [hours/days]
```

---

## Alert Triggers

Agent alerts user when:
- **P0 task** added or discovered
- **P1 task** within 24 hours of deadline
- **Task blocked** for > 3 days
- **No progress** on P1+ items for > 1 week

Otherwise, queue is checked silently during heartbeats.

---

## File Location

- **This file:** `docs/QUEUE.md` (canonical)
- **Backup/archive:** `docs/QUEUE-archive-YYYY-MM.md` (monthly snapshots)
- **Agent cache:** `.agent/queue-cache.json` (for quick checks)

---

*Pull-based task management — visible, prioritized, actionable*
