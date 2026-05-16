---
name: initialize
description: Open an org-os session — sync repo, render dashboard, propose 3 contextual work suggestions ranked by urgency. Mirrors Claude Code's /initialize.
version: "0.1.0"
platforms: [darwin, linux]
metadata:
  hermes:
    tags: [org-os, dashboard, session-lifecycle]
    category: integrations
    config:
      - name: ORG_OS_ROOT
        description: "Path to the operator's org-os repo. Required."
        required: true
---

# /initialize — open an org-os session

When the operator invokes `/initialize`, follow these steps in order:

1. **Sync the repo** (best-effort, don't block on offline). Run a shell command in the org-os repo:

   ```
   git pull --rebase --quiet 2>&1 || echo "sync: no remote or offline — continuing with local state"
   ```

   Use whatever shell-execution mechanism is available. If none, skip silently.

2. **Render the dashboard** by calling `org_os_page` tool with `page_id="dashboard"`. Embed the output verbatim.

3. **Propose 3 contextual suggestions** for what to work on, ranked by urgency:
   - Anything in **Critical** or **Urgent** tasks first
   - Then **funding deadlines** within 7 days
   - Then any **instance** with drift > 1 or last sync > 30 days
   - If none of those apply, suggest the highest-priority queued plan from the **Plans** section

   Present as a numbered list. End with: "Or describe what you'd like to work on."

4. **Wait for the operator's choice.** Do NOT silently execute any of the suggestions.

If `org_os_page` returns an `ERROR:` message, surface it directly and prompt the operator to check `ORG_OS_ROOT`.
