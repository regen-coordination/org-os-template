# org-os cockpit

The org-os fleet cockpit: a terminal UI (OpenTUI) that shows every workspace in the federation —
hub, framework, org instances — side by side with an embedded, guarded Pi agent session and
optional [herdr](https://herdr.dev) integration. One screen, three regions (rail · page · agent
pane) — see the layout sketch in the design spec §5.1.

- Design spec: `docs/superpowers/specs/2026-09-25-org-os-cockpit-design.md`
- Plan: `docs/superpowers/plans/2026-09-25-org-os-cockpit.md`
- Spike results and verified facts: `packages/tui/VERIFIED.md`

## Install

```bash
npm run tui:install
```

This installs `packages/org-state` and `packages/tui` with their exact pins (`@opentui/core@0.5.12`,
`@opentui/solid@0.5.12`, `solid-js@1.9.12`, `@earendil-works/pi-coding-agent@0.87.1`,
`@earendil-works/pi-ai@0.87.1`, `bun@1.4.2` as a **local** devDependency, `js-yaml@4.1.0`). It does
not touch any global Bun or Node install — the cockpit always runs on `packages/tui/node_modules/.bin/bun`.

The embedded agent pane needs its own Pi provider auth (`~/.pi/agent`, see Pi's own docs) to run
turns; without it every other page still works and the pane shows the auth error inline.

## Run

```bash
npm run tui
```

Run from anywhere inside the repo — the cockpit opens the workspace you invoked it from (the fleet
row containing your `cwd`, else the hub, else the framework).

Flags:

| Flag | Meaning |
|---|---|
| `--workspace <path\|id>` | Open a specific workspace instead of inferring it from `cwd` |
| `--page <id>` | Open directly on a given page |
| `--snapshot` | Render one frame headless and exit (for scripting/CI); combine with `--width`/`--height` |
| `--framework <path>` | Override the resolved framework root (defaults to this repo) |

## Keys

Focus cycles with `tab` / `shift+tab` between rail, page and agent pane. While the agent input has
focus, most global keys stand down so you can type; what stays live is `ctrl+p` (palette), `ctrl+a`
(toggle agent pane), `ctrl+n` (new session), `ctrl+x` (abort), `tab` / `shift+tab` (change focus),
`esc` (leave the input) and `ctrl+c` (twice to quit).

| Key | Action |
|---|---|
| `ctrl+p` or `:` | Command palette (pages, workspaces, actions, launch, lifecycle commands) |
| `?` | Help overlay (keys + page index) |
| `1`–`9` | Jump to fleet workspace N |
| `j`/`k`/`↓`/`↑`, `g`/`G` | Move selection / top / bottom (rail, page lists) |
| `enter` | Open selection (workspace → dashboard; row → entity page) |
| `esc` / `h` / `backspace` | Back (page history per workspace) |
| `r` | Refresh workspace |
| `e` | Open the page's source file in `$EDITOR` (herdr split when available, else suspend-and-run) |
| `a` | Action menu for the page |
| `L` | Launch menu (claude / pi / opencode × split / tab) |
| `ctrl+a` | Toggle / focus agent pane |
| `ctrl+n` | New agent session for this workspace |
| `ctrl+x` | Abort the running agent turn |
| `q` | Quit (asks if an agent turn is running); `ctrl+c` twice always quits |

Agent input: a single line — `enter` sends, `esc` leaves the input. Permission dialog: `y` allow
once, `s` allow for session, `n` / `esc` deny.

## herdr

Link the plugin once:

```bash
herdr plugin link "$(pwd)/packages/tui/herdr"
```

Then bind its actions in `~/.config/herdr/config.toml` (the cockpit never writes into that file
itself):

```toml
[[keys.command]]
key = "prefix+o"
type = "plugin_action"
command = "org-os-cockpit.open-cockpit"
description = "org-os cockpit in a split"

[[keys.command]]
key = "prefix+shift+o"
type = "plugin_action"
command = "org-os-cockpit.open-cockpit-tab"
description = "org-os cockpit in a tab"
```

Inside herdr, the cockpit does more than run in a pane:

- **Launching hosts into herdr panes.** The `L` launch menu and `Launch <host> in <split|tab>`
  palette entries use `herdr pane split` / `herdr tab create` + `herdr agent start` when in herdr
  (see "Launching hosts" below).
- **Agent badges on the fleet.** The rail and fleet page poll `herdr agent list` (every
  `herdr.pollMs`, paused after 10 minutes idle) and show each live agent's kind and state next to
  its workspace.
- **Reporting the embedded agent.** The cockpit calls `herdr pane report-agent` on every status
  change of its own Pi session (source `org-os-cockpit`, agent `pi`) and `pane release-agent` on
  exit, so the herdr agent panel shows the cockpit's own agent alongside launched ones.
- **Approval notifications.** A permission request raised while you may not be looking at the pane
  triggers `herdr notification show`.

Optionally, `herdr integration install claude|pi|opencode` wires agent-state reporting into a
launched host's own hooks. This is always the operator's call — the fleet page only *suggests* it
when `herdr integration status` reports an integration missing; the cockpit never runs the install
itself.

## Launching hosts

`L` (or the palette) launches `claude`, `pi` or `opencode` for the active workspace, trying
strategies in order until one works:

1. **herdr** (`HERDR_ENV=1` and `herdr` on PATH) — pane split or new tab, then `herdr agent start`.
2. **tmux** (`$TMUX` set) — `tmux split-window` or `tmux new-window`.
3. **zellij** (`$ZELLIJ` set) — `zellij run` or `zellij action new-tab`.
4. **Ghostty** (macOS) — a new Ghostty window in the workspace's directory
   (`open -na Ghostty.app --args --working-directory=<ws> -e <cli>`).
5. **suspend-and-run** (always available) — suspend the cockpit renderer, run the host in the
   foreground, resume when it exits.

Set a preferred strategy with `launch.prefer` in `config.json` (see Configuration) to skip straight
to it; the chain still falls through if the preferred strategy is unavailable. Launch never passes
prompts or flags you didn't choose, and the launched host keeps its own hooks (e.g. the vault guard
in `claude`'s `.claude/settings.json`).

## Configuration

`~/.config/org-os/cockpit/config.json` (override the directory with `ORG_OS_COCKPIT_HOME`):

```json
{
  "workspaces": [
    { "path": "/absolute/path/to/extra-instance-os", "label": "extra-instance" }
  ],
  "launch": { "prefer": "herdr" },
  "herdr": { "poll": true, "pollMs": 3000 }
}
```

- `workspaces[]` — extra fleet rows beyond the hub, framework and `data/instances.yaml` entries;
  each `path` must be absolute.
- `launch.prefer` — one of `herdr`, `tmux`, `zellij`, `ghostty`, `suspend`.
- `herdr.poll` / `herdr.pollMs` — whether to poll `herdr agent list`, and how often (minimum 1000ms).

`state.json` in the same directory is cockpit-managed (last workspace, and whether you last left
the agent pane open or closed) — don't hand-edit it.

## Safety

- **Vault guard first, fail-closed.** Every bash-like tool call from the embedded agent goes through
  `harness-kit`'s guard before anything else; a guard block can never be overridden by an approval,
  and a missing/crashing/timed-out guard also blocks.
- **Approvals.** Non-read-only tool calls that pass the guard ask the operator: `y` allow once,
  `s` allow for the rest of the session, `n`/`esc` deny, unanswered for 10 minutes → deny.
- **No mutating git from the cockpit.** The cockpit itself never runs a mutating git command; git
  reads (`status`, `log`) run with `GIT_OPTIONAL_LOCKS=0`.
- **Allow-listed scripts only.** Page actions of kind `script` may run only
  `initialize`, `generate:schemas`, `validate:schemas`, `validate:structure`, `doctor`, `knowledge`
  — anything else has to go through the guarded agent or the operator directly.
- **Launched hosts keep their own hooks.** Launching `claude`, `pi` or `opencode` into a split/tab/
  window adds no shell passthrough — each host runs with its own configured hooks.
- **Pi project trust is never granted by the cockpit.** A workspace's `.pi/` project resources
  (extensions, skills, prompts, settings) load into the embedded pane only after the operator has
  trusted that workspace in Pi itself (run `pi` there once); until then the pane shows a notice
  that `.pi/` isn't loaded. The vault guard and the approval flow apply either way — they're wired
  in as the cockpit's own inline extension, independent of Pi's project-trust decision.

## Auth & OQ-1

The embedded agent pane authenticates however Pi is configured (API key by default) — the cockpit
ships no subscription-login flow of its own. Whether the pane can run on the operator's Claude Max
subscription is still open (spec §11, OQ-1): current Agent SDK guidance restricts claude.ai
login/rate-limits to first-party surfaces, and Pi's own Anthropic login path hasn't been checked
yet. Until that's resolved, use the launch menu (`L` → `claude`) to work under Max today; the pane
keeps using Pi's configured provider auth.

## Acceptance checklist

Run inside herdr, then tick each box and copy the results into `packages/tui/VERIFIED.md`:

- [ ] Open the cockpit via the herdr plugin keybinding
- [ ] Fleet page shows the hub, the framework and every org instance
- [ ] Launch `claude` in a split (Max login; `.claude/` hooks active — `git stash list` is refused)
- [ ] An embedded Pi turn raises and resolves a permission approval
- [ ] `/close` via the palette writes today's memory log in a scratch copy
- [ ] The herdr agent panel shows the cockpit's own agent state

## Tests

```bash
npm run test:tui
```
