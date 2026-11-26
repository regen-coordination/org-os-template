# Host Integration

org-os works from any agent host that can read files and run shell commands. Two hosts beyond Claude Code get a packaged integration: **opencode** and **hermes**. Both give the agent a tool, `org_os_page <id>`, that renders an org-os page into the conversation.

> **What exists.** `npm run page <id>` runs `scripts/page-shim.mjs`, which renders seven pages: `dashboard`, `projects`, `tasks`, `instances`, `decisions`, `plans`, `this-week`. `dashboard` is `scripts/initialize.mjs --format=markdown`; the other six are rendered by `packages/cloudflare-os-integration/src/page-core/render-page.mjs` from `initialize.mjs`'s JSON state. The shim reads `DECISIONS.md` and the `QUEUE.md` in the framework's `agent-plans` directory under `docs/`, and hands them to the renderer as strings (the `decisions` and `plans` pages); the renderer itself reads no files. An instance made by the cloning engine keeps its queue at `docs/plans/QUEUE.md`, which the shim does not read, so the `plans` page does not work in an instance: it prints "QUEUE.md not found" (read from the code, not run against a clone). Any other id exits with status 2 and lists the seven.
>
> **What does not exist.** An interactive terminal UI. The plans `tui-dashboard.md` and `tui-dashboard-implementation.md`, in the framework's `agent-plans` directory under `docs/`, describe a `packages/tui` and `packages/tui-data` with a larger page catalogue and an `npm run tui` command; none of those packages or scripts is in this repository. The opencode tool `org_os_tui` still tries to run `npm run tui` and will fail until that exists; the page ids in the hermes tool's description (`health`, `attention`, `project/<id>` and the rest) are likewise not rendered yet.

## Compatibility matrix

| Host | Slash commands | How it connects |
|---|---|---|
| Standalone | none | `npm run page <id>` in any terminal |
| Claude Code | `/initialize`, `/close`, `/commit`, `/handoff`, `/skills`, `/sync` (`.claude/commands/`) | Reads `CLAUDE.md` and the skills. `skills/org-os-init/` is the session skill. The agent can run `npm run page <id>` for a drill-down. |
| Cursor | the same six, in `.cursor/commands/` | Slash commands only |
| **opencode** | `/dashboard`, `/initialize`, `/org-projects`, `/org-decisions`, `/org-this-week` from the integration package; `/close`, `/commit`, `/handoff`, `/skills`, `/sync` from `.opencode/commands/` | [`packages/opencode-integration/`](../packages/opencode-integration/README.md): a plugin registering `org_os_page` and `org_os_tui`, plus `commands/*.md` installed with `install-commands.sh` (`ln -sf`, so its `initialize.md` replaces any existing `.opencode/commands/initialize.md` of the same name, including the one this repository ships) |
| **hermes** | `/dashboard`, `/initialize`, `/org_os_pages` | [`packages/hermes-integration/`](../packages/hermes-integration/README.md): a Python tool `org_os_page` and three skills that hermes registers as slash commands; installed with `install.sh` |

## Why a subprocess

Agent CLIs have one terminal surface, so a live pane beside the chat needs a multiplexer (tmux or zellij) or a host that owns the screen. The integrations therefore stay thin: they shell out to `npm run page <id>` in the org-os repository and return the text. All page logic stays in this repository's scripts, so an upgrade to the renderer reaches every host without changes to the integrations.

## Install

### opencode

Register the plugin in `opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@org-os/opencode-integration"]
}
```

For project scope the package README says to place the plugin under `.opencode/plugins/`, and for global scope `~/.config/opencode/plugins/` (taken from the README; no code in this repository loads from those paths, so not verified). Whether `@org-os/opencode-integration` is published to npm was not checked (no network); the package is in this repository at `packages/opencode-integration/`. The plugin finds the org-os root from opencode's plugin context (`directory`, `worktree`, `project.directory`), then `ORG_OS_ROOT`, then the current directory.

Slash commands:

```bash
cd packages/opencode-integration
./install-commands.sh            # symlinks commands/*.md into ./.opencode/commands/
./install-commands.sh --global   # into ~/.config/opencode/commands/
./install-commands.sh /path/to/project
```

Details: [`packages/opencode-integration/README.md`](../packages/opencode-integration/README.md).

### hermes

```bash
export HERMES_HOME=/path/to/hermes-agent   # a hermes-agent checkout with skills/ and tools/
export ORG_OS_ROOT=/path/to/this/org-os-instance
cd packages/hermes-integration && ./install.sh
```

The script symlinks `SKILL.md` into `$HERMES_HOME/skills/org_os_pages/`, the `dashboard` and `initialize` skills into `$HERMES_HOME/skills/`, and `tools/org_os.py` into `$HERMES_HOME/tools/`. Then add `"org_os"` to a toolset by hand (typically `_HERMES_CORE_TOOLS`) and restart hermes. The script's closing message names `$HERMES_HOME/toolsets.py`, while the header of `tools/org_os.py` names `hermes_cli/toolsets.py`; which is right depends on your hermes version and was not verified here.

Details: [`packages/hermes-integration/README.md`](../packages/hermes-integration/README.md).

## Adding a host

For a host such as goose or aider:

1. Create `packages/<host>-integration/` with the host's plugin or skill manifest.
2. Register one tool, `org_os_page(page_id)`, that runs `npm run page --silent -- <id>` in the org-os root (`ORG_OS_ROOT`).
3. Add a row to the matrix above.

## Tests

`cd packages/opencode-integration && node --test test/*.test.mjs` runs the plugin's smoke tests (3 pass on this branch).
