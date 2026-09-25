# Host Integration

org-os ships first-class integrations for two agent hosts beyond the standalone CLI: **opencode** and **hermes**. Every host gets the same surface — call `org_os_page <id>` to render any org-os page in the conversation, and (where the host supports it) `org_os_tui` to launch the interactive TUI in a managed pane.

> **Status (2026-09-25):** Two surfaces are live. `npm run page <id>` (one-shot markdown for chat) is served by `scripts/page-shim.mjs`, which renders 7 pages (`dashboard`, `projects`, `tasks`, `instances`, `decisions`, `plans`, `this-week`) from `scripts/initialize.mjs` JSON through the shared renderers in `packages/org-state`. `npm run tui` is the **org-os cockpit** (`packages/tui`): an OpenTUI fleet view with an embedded, guarded Pi agent pane and herdr integration; `npm run tui -- --snapshot --page <id>` renders one frame headless to stdout for scripts and CI. Design: [`docs/superpowers/specs/2026-09-25-org-os-cockpit-design.md`](superpowers/specs/2026-09-25-org-os-cockpit-design.md) (it supersedes the Ink TUI plan). No changes are required in opencode or hermes — they keep calling the same two scripts.

## Compatibility matrix

| Host          | Slash commands                       | Tools / mechanism                                                                                                                  |
| ------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Standalone    | n/a                                  | `npm run tui` (the OpenTUI cockpit, `packages/tui`; `-- --snapshot` for one headless frame), `npm run page <id>` (one-shot markdown). Works in any terminal. |
| Claude Code   | `/initialize`, `/close`              | Existing skill at `skills/org-os-init/`. Agent embeds `npm run page <id>` output for drill-downs.                                    |
| **opencode**  | `/dashboard`, `/initialize`, `/org-projects`, `/org-decisions`, `/org-this-week` | [`packages/opencode-integration/`](../packages/opencode-integration/) — npm plugin (tools: `org_os_page`, `org_os_tui`) **plus** `commands/*.md` slash-command templates installed via `install-commands.sh`. |
| **hermes**    | `/dashboard`, `/initialize`, `/org_os_pages` | [`packages/hermes-integration/`](../packages/hermes-integration/) — Python tool (`org_os_page`) **plus** three skills (`SKILL.md` + `skills/dashboard/`, `skills/initialize/`) auto-registered as slash commands by hermes. Install via `install.sh`. |
| **herdr**     | n/a                                  | [`packages/tui/herdr`](../packages/tui/herdr) plugin + herdr CLI JSON — org-os cockpit in a split/tab via plugin; cockpit launches `claude`/`pi`/`opencode` into herdr panes; live agent badges; approval notifications. **Status:** v0.1 (2026-09-25), operator acceptance pending. |
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

Host tools (`org_os_page`) call `npm run page <id>`, so every host gets the same pages.

| Surface | Page IDs |
|---|---|
| `npm run page <id>` (`scripts/page-shim.mjs` over `packages/org-state`) | `dashboard`, `projects`, `tasks`, `instances`, `decisions`, `plans`, `this-week` |
| Cockpit (`npm run tui`, `packages/tui/src/core/pages/`; `--page <id>`) | `fleet`, `dashboard`, `tasks`, `projects`, `plans`, `decisions`, `memory`, `this-week`; entity pages `project`, `decision`, `memory` (by date) |

## Architecture

Both integrations are intentionally thin shims over the same two entry points: `npm run page <id>` (one-shot markdown to stdout, embeds in chat) and `npm run tui` (the interactive OpenTUI cockpit). Workspace reading and parsing live in `packages/org-state/` (plain Node, no UI), which both `scripts/page-shim.mjs` and the cockpit in `packages/tui/` build on — so a loader fix reaches every host integration automatically.

```
        ┌─────────────────────────┐
        │  packages/org-state     │  pure Node, no UI
        │  file readers, loaders, │
        │  page renderers         │
        └────────────┬────────────┘
                     │
       ┌─────────────┴───────────────┐
       │                             │
┌──────▼──────────┐ ┌────────────────▼────┐ ┌─────────────────────────────────────┐
│ packages/tui    │ │ scripts/page-shim   │ │  packages/{opencode,hermes}-        │
│ OpenTUI cockpit │ │ (+ initialize JSON) │ │  integration                        │
│ npm run tui     │ │ npm run page <id>   │ │  (shim → npm run page / npm run tui)│
│ + --snapshot    │ │ markdown for chat   │ │                                     │
│                 │ │                     │ │  hosts: opencode, hermes            │
└─────────────────┘ └─────────────────────┘ └─────────────────────────────────────┘
```

## Adding a new host

To add support for, say, `goose` or `aider`:

1. Create `packages/<host>-integration/`.
2. Implement the host's plugin/skill manifest format.
3. Register a single tool `org_os_page(page_id)` that shells out to `npm run page <id>` in `ORG_OS_ROOT`.
4. (Optional) Register a second tool `org_os_tui()` if the host has multiplexer integration.
5. Add a row to the compatibility matrix above.

The pattern is the same across all hosts because the page resolution layer is host-agnostic.
