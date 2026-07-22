---
description: Close org-os session — summarize, write memory, sync & commit
---

Load the **org-os-init** skill for the session close protocol (Phase 4: CLOSE).

You are now closing this session. Execute the full close protocol:

1. **Summarize** — List everything accomplished this session (completed tasks, files changed, decisions made). Use the `✓` / `▸` / `◆` indicators from the skill's visual language.

2. **Write memory** — Append a session entry to `memory/YYYY-MM-DD.md` (today's date). Create the file if it doesn't exist. Include: focus area, key decisions, actions taken, what remains.

3. **Update HEARTBEAT.md** — Move any completed tasks to "Recently Completed" with today's date. Add any new tasks that emerged.

4. **Update MEMORY.md** — If key decisions were made, append to the Key Decisions section (most recent first).

5. **Update Knowledge Graph** — If the `graphify` CLI is installed and `graphify-out/graph.json` exists, refresh the graph so it travels in the same commit as this session's changes:

```bash
command -v graphify >/dev/null 2>&1 && graphify . --update || echo "graph: CLI not installed — see docs/integrations/graphify.md"
npm run graph:gaps 2>/dev/null || true
```

This is incremental (seconds for code-only changes). If the update fails, report the error but continue the close — the graph retries next session. Never block the close on graph tooling.

6. **Show git status and commit**:

```
!`git status --short 2>/dev/null`
```

Stage all changes in memory/, HEARTBEAT.md, MEMORY.md, data/, and graphify-out/ — then commit with a descriptive message like `session: [focus area summary]`. Show the result.

7. **Sync** — Push to remote:

```
!`git push --quiet 2>&1 || echo "push: no remote or offline — commit saved locally"`
```

8. **Egregore handoff** — If egregore is enabled in this workspace, offer to `/handoff` context for the next session or team member.

Render the session summary using the visual format from the skill, then confirm the sync completed.
