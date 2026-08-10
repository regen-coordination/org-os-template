# @org-os/hermes-integration

Hermes skill + Python tool: exposes org-os pages to hermes via the `org_os_page` tool, which any hermes session can call to inspect organizational state without leaving the agent.

## What it does

When installed in a hermes-agent checkout, this package provides three surfaces:

### 1. Tool (auto-invoked by the agent)

`tools/org_os.py` registers the `org_os_page` tool in hermes's tool registry via `tools.registry.register()`. The agent calls `org_os_page("<page-id>")` whenever the operator asks about org-os state in natural language.

### 2. Slash commands (operator-typed)

Hermes auto-registers `/<skill-name>` for every installed skill. We ship two thin wrapper skills that drive the `org_os_page` tool:

| Command | Purpose |
|---|---|
| `/dashboard` | Render the org-os dashboard (same content as Claude Code's `/initialize`) |
| `/initialize` | Open a session: sync repo + render dashboard + propose 3 work suggestions |

### 3. Multi-page skill

`SKILL.md` is the primary `org_os_pages` skill — gives the agent broader context for calling the tool with any page id. Auto-registers as `/org_os_pages`.

All three shell out to `npm run page <id>` in the operator's org-os repo (path resolved from `ORG_OS_ROOT` env var).

## Installation

1. **Set `HERMES_HOME`** to your hermes-agent checkout:

   ```bash
   export HERMES_HOME=~/code/hermes-agent
   ```

2. **Run the install script**:

   ```bash
   ./install.sh
   ```

   This symlinks `SKILL.md` → `$HERMES_HOME/skills/org_os_pages/SKILL.md` and `tools/org_os.py` → `$HERMES_HOME/tools/org_os.py`.

3. **Add to a toolset**: open `$HERMES_HOME/toolsets.py` and add `"org_os"` to a toolset (typically `_HERMES_CORE_TOOLS`).

4. **Set `ORG_OS_ROOT`** to your org-os repo path:

   ```bash
   export ORG_OS_ROOT=~/code/org-os
   ```

5. **Restart hermes**. The `org_os_page` tool should now appear in hermes's tool listings.

## Usage in hermes

Once installed, ask hermes anything about org-os state:

- "Show me the org-os dashboard" → calls `org_os_page("dashboard")`
- "What's on this week?" → calls `org_os_page("this-week")`
- "Drill into v2-stabilization" → calls `org_os_page("project/v2-stabilization")`
- "Are any instances drifting?" → calls `org_os_page("health")`
- "What needs my attention?" → calls `org_os_page("attention")`

## Page ids

Common ids:

| Page | Purpose |
|---|---|
| `dashboard` | Full home view |
| `projects` | Workstreams |
| `project/<id>` | Specific project entity |
| `instances` | Federation instance health (hub-only) |
| `tasks` | HEARTBEAT.md task list |
| `plans` | Plan pipeline (scoping/queued/active/completed) |
| `this-week` | Calendar + funding deadlines + critical tasks |
| `health` | System health snapshot (hub-only) |
| `decisions` | Chronological decision log |
| `decision/<slug>` | Single decision detail |
| `promotions` | Skill + package promotion candidates (hub-only) |
| `attention` | What genuinely needs the operator now |

Full list: `packages/tui-data/src/builtin-pages.mjs` in the org-os repo.

## Architecture

The integration is intentionally thin — it just wraps the existing `npm run page <id>` entry point of the org-os TUI. All page rendering, navigation, and action logic lives in the org-os repo's `packages/tui-data/` and `packages/tui/`. Updating the TUI updates this integration automatically.

The tool is sandboxed: it shells out to `npm` only, has a 15s timeout, and returns error strings rather than raising. If `ORG_OS_ROOT` is unset or invalid, `check_requirements()` returns False so hermes can hide the tool from the model.

## Smoke test

```bash
python3 test/smoke.test.py
```

Verifies the tool module imports cleanly in standalone mode (without hermes's real registry) and that `check_requirements()` gates correctly on `ORG_OS_ROOT`.

## Status

**Live today** via `scripts/page-shim.mjs` in the org-os repo, which supports 7 pages: `dashboard`, `projects`, `tasks`, `instances`, `decisions`, `plans`, `this-week`. When Task 12 of `docs/agent-plans/tui-dashboard-implementation.md` lands, the shim is replaced by the full Ink renderer and all ~25 pages become available — no changes needed here.

For pages outside the shim catalog (e.g., `health`, `promotions`, entity pages like `project/v2-stabilization`), the tool returns an actionable error message listing the available pages.

## /symbient (on-demand wake)

hermes discovers real skills from the org-os repos on its `skills.external_dirs`
scan path, so `skills/symbient/SKILL.md` (frontmatter `name: symbient`) surfaces
as `/symbient` automatically once the workspace carries the v2 skill — no changes
in this package. `scripts/sync-commands.mjs` deliberately skips generating a
command-skill named `symbient` to avoid colliding with the real skill.

Conduct is defined by the skill itself (v2 contract, "Hosts" section):

- **On-demand only** — no cron jobs wake a symbient; do not add any to
  `data/hermes-cron.yaml`.
- **Private context first, then stage** — the order matters and is part of the
  privacy model:
  1. Outside the operator's private chat (any group or org channel) the command
     declines generically **without reading `GATES.md`** and without waking, and
     says nothing about symbients at all.
  2. Only inside the operator's private chat does it read the habitat's
     `GATES.md`; below Stage 2 (voiced) it replies "not yet voiced" and stops.

  Reversing that order would leak a habitat's existence — and its rough ladder
  position — into a group channel via the "not yet voiced" reply.
- **No habitat → silent no-op.** Most checkouts have no habitat (they are
  operator-private and gitignored); the command does not mention symbients —
  it neither confirms nor denies that anything is there.
