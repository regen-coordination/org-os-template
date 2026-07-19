---
description: "Close org-os session — summarize, write memory, commit, push"
agent: build
---
<!-- GENERATED from .claude/commands/close.md by scripts/sync-commands.mjs — edit the source, then run: npm run sync:commands -->


You are closing the current org-os session. Read `skills/org-os-init/SKILL.md` Phase 4 for the full close protocol, then execute these steps:

## 1. Summarize

List everything accomplished this session using visual indicators:
- `✓` completed items
- `▸` files updated
- `◆` items still open

Render as a `─── Session Summary ───` panel.

## 2. Write Memory

Append a session entry to `memory/YYYY-MM-DD.md` (today's date). Create the file if it doesn't exist. Format:

```markdown
## Session — [HH:MM]

**Focus:** [What was worked on]

### Key Decisions
- [Decision 1]

### Actions Taken
- [x] [What was done]

### Next
- [ ] [What remains]
```

## 3. Update HEARTBEAT.md

Move completed tasks to "Recently Completed" with today's date. Add any new tasks that emerged.

## 4. Update MEMORY.md

If key decisions were made, append to the Key Decisions section (most recent first).

## 5. Update Plan Queue

If any plan in `docs/agent-plans/` changed status (started, completed, new tasks checked off), update the plan file and `docs/agent-plans/QUEUE.md`.

## 5b. Update Tech Tree

Did anything ship, start, or die this session? If yes:
- Native nodes (capability/integration/standard): update `status` in `data/tech-tree.yaml`.
- Ref-backed nodes (module/skill/idea): update the **source registry** (`packages-matrix.yaml` / `skills-matrix.yaml` / `ideas.yaml`) — never the tree.
- New work with no node yet: add the node + a `part-of` edge.

Then:

```bash
npm run validate:tech-tree && npm run resolve:tech-tree
```

## 6. Commit

Stage all changed files and commit:

```bash
git add memory/ HEARTBEAT.md MEMORY.md data/ docs/agent-plans/ site/src/data/
git commit -m "session: [concise description of what was done]"
```

## 7. Push

```bash
git push
```

If push fails (offline, no remote), note the commit is saved locally.

Render the session summary, confirm the commit and push status.

$ARGUMENTS
