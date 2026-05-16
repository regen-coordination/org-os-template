---
description: Open an org-os session — render dashboard and propose work (mirrors Claude Code's /initialize)
agent: build
---

The operator is starting an org-os session. Mirror Claude Code's `/initialize` behavior:

1. **Sync** the repo first (best-effort, don't block on offline):

!`git pull --rebase --quiet 2>&1 || echo "sync: no remote or offline — continuing with local state"`

2. **Render the dashboard** verbatim:

!`npm run page --silent -- dashboard`

3. **Propose 3 contextual suggestions** for what to work on, ranked by urgency:
   - Anything in Critical/Urgent tasks first
   - Then funding deadlines within 7 days
   - Then any instance with drift > 1 or last sync > 30 days
   - If none of those, suggest the highest-priority queued plan from the Plans section

Present the suggestions as a numbered list and end with: "Or describe what you'd like to work on."

Do **not** silently execute any of the suggestions — wait for the operator to pick.
