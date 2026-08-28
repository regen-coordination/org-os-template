# @org-os/opencode-integration

opencode plugin: registers two tools that bridge to the org-os TUI.

## What it does

This integration provides two surfaces in opencode:

### 1. Tools (auto-invoked by the agent)

| Tool | Purpose |
|---|---|
| `org_os_page` | Render any org-os page and return the text. Use for in-conversation drill-down. |
| `org_os_tui` | Launch the interactive Ink TUI in a managed pane. opencode's multiplexer (tmux/zellij) handles the pane lifecycle. |

### 2. Slash commands (operator-typed)

Drop these into `.opencode/commands/` (project) or `~/.config/opencode/commands/` (global) — see `commands/` directory in this package.

| Command | Purpose |
|---|---|
| `/dashboard` | Render the org-os dashboard (same content as Claude Code's `/initialize`) |
| `/initialize` | Open a session: sync repo + render dashboard + propose 3 work suggestions |
| `/org-projects` | Workstream table |
| `/org-decisions` | Full decisions log |
| `/org-this-week` | Meetings, events, deadlines, hot tasks |

Both surfaces shell out to `npm run page <id>` (and `npm run tui`) in the operator's org-os repo. The repo path is resolved from `directory` / `worktree` / `project.directory` in the opencode plugin context, falling back to `ORG_OS_ROOT` env var, then `process.cwd()`.

## Installation

### Tools (plugin)

In your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@org-os/opencode-integration"]
}
```

For project-scoped use, install at `.opencode/plugins/`. For global use, install at `~/.config/opencode/plugins/`.

### Slash commands

Run the install script from inside your opencode project (or org-os repo):

```bash
# Project-level (creates .opencode/commands/ in cwd):
./install-commands.sh

# Global (~/.config/opencode/commands/):
./install-commands.sh --global

# Explicit project path:
./install-commands.sh /path/to/your/project
```

The script symlinks all `commands/*.md` files; opencode picks them up on next launch.

## Page ids

The full list lives in `packages/tui-data/src/builtin-pages.mjs` of the org-os repo. Common ids:

- `dashboard` — full home view
- `projects` — workstreams
- `project/<id>` — specific project entity (e.g. `project/v2-stabilization`)
- `instances` — federation instance health (hub-only)
- `tasks` — full HEARTBEAT.md task list
- `plans` — agent-plans pipeline
- `this-week` — calendar + funding deadlines + critical tasks
- `health` — system health snapshot (hub-only)
- `decisions` — chronological decision log
- `decision/<slug>` — single decision detail
- `promotions` — skill + package promotion candidates (hub-only)
- `attention` — what genuinely needs the operator now

## Requirements

- The org-os repo with the TUI installed (`npm install` in the org-os root).
- opencode with multiplexer integration (tmux or zellij) for the `org_os_tui` tool. The `org_os_page` tool works without a multiplexer.
- Node.js ≥ 22.

## Status

**Live today** via `scripts/page-shim.mjs` in the org-os repo, which supports 7 pages: `dashboard`, `projects`, `tasks`, `instances`, `decisions`, `plans`, `this-week`. When Task 12 of `docs/agent-plans/tui-dashboard-implementation.md` lands, the shim is replaced by the full Ink renderer and all ~25 pages become available — no changes needed here.

## Behavior when unavailable

If `npm run page <id>` fails (e.g., the page id isn't in the shim's catalog), the tool returns an actionable error message listing the available pages rather than crashing the agent.

## Architecture

The plugin is intentionally thin — it just wraps the existing org-os entry points. All page rendering, navigation, and action handling lives in the org-os repo's `packages/tui-data/` and `packages/tui/` packages. Updating the TUI updates this integration automatically.
