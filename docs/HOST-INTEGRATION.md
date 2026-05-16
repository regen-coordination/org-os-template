# Host Integration

org-os ships first-class integrations for two agent hosts beyond the standalone CLI: **opencode** and **hermes**. Every host gets the same surface — call `org_os_page <id>` to render any org-os page in the conversation, and (where the host supports it) `org_os_tui` to launch the interactive TUI in a managed pane.

> **Status (2026-04-25):** Integrations are **live today** via `scripts/page-shim.mjs`, which renders 7 pages (`dashboard`, `projects`, `tasks`, `instances`, `decisions`, `plans`, `this-week`) using the existing `scripts/initialize.mjs` JSON output and `DECISIONS.md`. When the full TUI renderer ships (Task 12 of `docs/agent-plans/tui-dashboard-implementation.md`), the `npm run page` script retargets to `packages/tui/src/modes/print.mjs` and unlocks the full ~25-page catalog. No changes required in opencode or hermes — they pick up the upgrade transparently.

## Compatibility matrix

| Host          | Slash commands                       | Tools / mechanism                                                                                                                  |
| ------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Standalone    | n/a                                  | `npm run tui` (interactive Ink), `npm run page <id>` (one-shot). Works in any terminal.                                              |
| Claude Code   | `/initialize`, `/close`              | Existing skill at `skills/org-os-init/`. Agent embeds `npm run page <id>` output for drill-downs.                                    |
| **opencode**  | `/dashboard`, `/initialize`, `/org-projects`, `/org-decisions`, `/org-this-week` | [`packages/opencode-integration/`](../packages/opencode-integration/) — npm plugin (tools: `org_os_page`, `org_os_tui`) **plus** `commands/*.md` slash-command templates installed via `install-commands.sh`. |
| **hermes**    | `/dashboard`, `/initialize`, `/org_os_pages` | [`packages/hermes-integration/`](../packages/hermes-integration/) — Python tool (`org_os_page`) **plus** three skills (`SKILL.md` + `skills/dashboard/`, `skills/initialize/`) auto-registered as slash commands by hermes. Install via `install.sh`. |
| tmux/zellij   | n/a                                  | Sibling pane, host-agnostic. None needed.                                                                                          |

## Why subprocess (not embedded UI)

Agent CLIs are single-tenant: one TTY surface. A "live pane next to the chat" requires either a terminal multiplexer (tmux/zellij) or a host that owns the entire screen (hermes does, opencode partly via its multiplexer integration). Claude Code is sequential text in chat — it can spawn a modal subprocess but cannot host a persistent live UI alongside its conversation. Subprocess + multiplexer is the universal lower bound; the agent-print mode (`npm run page <id>`) is the universal embedded fallback.

## Install

### opencode

```jsonc
// opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@org-os/opencode-integration"]
}
```

Project-scoped: install at `.opencode/plugins/`. Global: `~/.config/opencode/plugins/`. The plugin auto-detects the org-os root from opencode's plugin context (`directory` / `worktree` / `project.directory`) and falls back to `ORG_OS_ROOT` env var.

Tools registered: `org_os_page(page_id)`, `org_os_tui()`. opencode's multiplexer integration handles pane lifecycle for the TUI.

Full README: [`packages/opencode-integration/README.md`](../packages/opencode-integration/README.md).

### hermes

```bash
export HERMES_HOME=~/code/hermes-agent
export ORG_OS_ROOT=~/code/org-os
cd packages/hermes-integration && ./install.sh
```

The script symlinks `SKILL.md` and `tools/org_os.py` into hermes's `skills/` and `tools/` directories. After running, manually add `"org_os"` to a toolset in `$HERMES_HOME/toolsets.py` (typically `_HERMES_CORE_TOOLS`).

Tool registered: `org_os_page(page_id)`. Returns markdown-clean text from `npm run page <id>`.

Full README: [`packages/hermes-integration/README.md`](../packages/hermes-integration/README.md).

## Pages reachable

The full list lives in `packages/tui-data/src/builtin-pages.mjs`. All hosts get the same pages.

| Type | IDs |
|---|---|
| Section | `dashboard`, `projects`, `tasks`, `plans`, `instances`, `federation`, `members`, `ideas`, `funding`, `calendar`, `memory`, `decisions`, `skills`, `packages` |
| Entity | `project/<id>`, `instance/<id>`, `plan/<id>`, `idea/<id>`, `member/<id>`, `skill/<id>`, `package/<id>`, `decision/<slug>` |
| Cross-cut | `health`, `this-week`, `promotions`, `attention` |

## Architecture

Both integrations are intentionally thin shims over the same two entry points: `npm run page <id>` (one-shot render to stdout, ANSI-stripped, embeds in chat) and `npm run tui` (interactive Ink TUI). All page logic, data resolution, and navigation lives in `packages/tui-data/` and `packages/tui/`. Updating the TUI updates every host integration automatically.

```
        ┌─────────────────────────┐
        │  packages/tui-data      │  pure Node, no UI
        │  loaders + manifest +   │
        │  resolvers + actions    │
        └────────────┬────────────┘
                     │
       ┌─────────────┼─────────────────────────────┐
       │             │                             │
┌──────▼──────┐ ┌────▼──────┐ ┌──────────────────▼──────────────────┐
│ packages/   │ │ scripts/  │ │  packages/{opencode,hermes}-        │
│ tui (Ink)   │ │ initialize│ │  integration                        │
│             │ │           │ │  (shim → npm run page / npm run tui)│
│ interactive │ │ JSON for  │ │                                     │
│ + print     │ │ /init     │ │  hosts: opencode, hermes            │
└─────────────┘ └───────────┘ └─────────────────────────────────────┘
```

## Adding a new host

To add support for, say, `goose` or `aider`:

1. Create `packages/<host>-integration/`.
2. Implement the host's plugin/skill manifest format.
3. Register a single tool `org_os_page(page_id)` that shells out to `npm run page <id>` in `ORG_OS_ROOT`.
4. (Optional) Register a second tool `org_os_tui()` if the host has multiplexer integration.
5. Add a row to the compatibility matrix above.

The pattern is the same across all hosts because the page resolution layer is host-agnostic.
