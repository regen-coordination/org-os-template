# org-os Cockpit — Design Spec (OpenTUI · Pi · herdr)

**Date:** 2026-09-25
**Status:** the architecture (§4 below, "§1" in the dialogue) was approved in dialogue (operator session
2026-09-25). Everything else was decided by the agent under an explicit operator delegation ("proceed with all sections, specs, implementation plan and
proper execution — I'm going to sleep"). **Flagged for operator morning review**; nothing here is
pushed, merged or tagged until then.
**Branch / worktree:** `feat/org-os-cockpit` · `~/.cache/lf-worktrees/org-os-cockpit` (off local `main` @ `c249ba0`)
**Supersedes:** the frozen Ink-based `tui-dashboard` design (`docs/agent-plans/tui-dashboard.md` +
`tui-dashboard-implementation.md`) — see §14 Governance.
**Depends on / coordinates with:** `2026-09-25-pi-harness-design.md` (branch `feat/pi-harness`,
awaiting written review) — see §10 for the amendments this spec asks of it.

**Verified surfaces (2026-09-25):**

- **OpenTUI** (`github.com/anomalyco/opentui`): `@opentui/core` / `@opentui/solid` **0.5.12**.
  Runs on **Bun ≥ 1.3**, or Node ≥ 26.4 only with ESM + `--experimental-ffi` (core README).
  Solid binding: `jsxImportSource: "@opentui/solid"`, `bunfig.toml` `preload = ["@opentui/solid/preload"]`,
  `render()`, `testRender(node, {width, height})`, intrinsic elements `box text scrollbox ascii_font
  input textarea select tab_select code line_number diff` plus text modifiers (`span b i u a br`). opencode runs it in production.
- **Pi** (`@earendil-works/pi-coding-agent` **0.87.1**, Node ≥ 22.19): SDK `createAgentSession({cwd,
  sessionManager, model, resourceLoader, tools, customTools, …})`, `session.prompt/steer/followUp/abort/dispose`,
  `session.subscribe(event => …)` (`message_update` with `assistantMessageEvent.text_delta`,
  `message_end`, `agent_end`, `agent_settled`), inline extension factories via `DefaultResourceLoader`,
  persistent `SessionManager` (tree JSONL). Extensions can hook `tool_call` and block.
- **herdr 0.9.1** (installed; server 0.9.0 running on the operator's Mac): terminal workspace
  manager for coding agents. CLI with JSON output over a socket API (protocol 22): `pane split
  --current --direction right|down --cwd --no-focus`, `tab create --cwd`, `agent start <name>
  --kind pi|claude|opencode|… --pane <id>`, `agent list` (→ `AgentInfo{pane_id, workspace_id, cwd,
  agent, agent_status, name, title}`), `agent focus`, `pane report-agent <pane> --source --agent
  --state idle|working|blocked|unknown`, `pane release-agent`, `pane report-metadata --title`,
  `notification show <title> --body --sound request`. Plugins: `herdr-plugin.toml` with `[[panes]]`
  (`placement = "split"`) and `[[actions]]` bound to keys in `~/.config/herdr/config.toml`.
  Inside a managed pane herdr injects `HERDR_ENV=1`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`,
  `HERDR_PANE_ID` (and `HERDR_BIN_PATH` for plugins).
- **Operator machine:** Ghostty; tmux installed (not active); herdr installed; `claude` 2.1.282,
  `opencode` 1.18.31, `hermes` on PATH; **`pi` not installed**; Node 24.19; Bun 1.2.18 (too old);
  npm `bun` package 1.4.2 available.

---

## 1. Goal

A terminal **cockpit** from which the operator runs their whole org-os fleet day to day — the hub
(`lf-zettelkasten-os`), the framework (`org-os`) and every instance in `data/instances.yaml` — with:

- **navigable pages** over each workspace's data plane (dashboard, tasks, projects, plans,
  decisions, memory, this week) and a **fleet** overview across all of them;
- an **embedded agent pane** driven by **Pi** (in-process, via its SDK), guarded by the vault guard
  and gated by operator approval;
- a **launch path** that opens the real `claude` / `pi` / `opencode` CLI in the selected workspace
  (herdr split or tab first), so the operator's own host logins, hooks and limits apply;
- **herdr as the host environment**: the cockpit lives in a herdr pane, launches agents into herdr
  panes, shows herdr's live agents per workspace, and reports its own agent state back to herdr.

Success (primary user = the operator, daily driver): the operator starts the day with `npm run tui`
(or a herdr keybinding), picks a workspace, reads its state without opening files, runs an agent
session in the pane or launches a host, and closes the session with `/close` — without leaving the
cockpit.

## 2. Understanding (said vs. assumed)

**Said by the operator (2026-09-25):**

- "Build the full TUI / harness for org-os" on OpenTUI.
- Harness meaning: **cockpit + drive agents** (no LLM loop of org-os's own).
- Primary user: **me, daily driver**. Scope: **fleet cockpit**.
- Architecture: **A — one process, headless core** (Solid renderer).
- Pi's role: **Pi primary in v1; Claude Agent + opencode adapters in v1.1** (revising an earlier
  "both adapters in v1" after the Pi harness spec surfaced).
- Launch path accepted: cockpit opens the real `claude` CLI (Max login applies); Max usage *inside*
  the pane is an **explicit open question** (OQ-1), answered from current Anthropic terms and Pi's
  auth docs, not assumed.
- "I'll be using / to be integrated with **herdr**."
- Proceed through spec → plan → execution unattended.

**Assumed by the agent (flagged for review):**

- The cockpit is the **interactive mode of the CLI surface** (interfaces spec §4), not a fifth
  surface: data-plane client, no server, no write path of its own (§3.1).
- herdr integration uses herdr's **CLI with JSON output**, not the raw socket protocol, in v1 (§6).
- Runtime is **Bun** (local, pinned devDependency), because OpenTUI on Node needs
  `--experimental-ffi`; this reverses the §1-dialogue lean toward Node 26 (§3.4).
- `harness-kit` v1 carries only what a v1 consumer uses (guard bridge + workspace detection); the
  todo reducer named in the §1 dialogue moves there when the cockpit renders Pi todos (v1.1).
- The frozen `tui-dashboard` plan is superseded by this spec via an operator-directive entry in
  `DECISIONS.md` (§9).

## 3. Decisions (locked)

| # | Question | Decision |
|---|---|---|
| D1 | Surface classification | **Interactive mode of the CLI surface.** Reads the data plane directly (fs + read-only git), introduces **no server** and **no write path**: repo writes happen only through agents and npm scripts (both "trusted local processes" per `2026-08-29-org-os-interfaces-design.md` §3). No interfaces-spec amendment needed. |
| D2 | Architecture | **One Bun process**: `core/` (headless, no OpenTUI imports) + `ui/` (`@opentui/solid`), joined by a typed command/event **bus**. The bus is the future daemon seam; no daemon now (a daemon would be a new server → would need an interfaces-spec amendment). |
| D3 | Agent engine (v1) | **Pi, embedded in-process** via `createAgentSession()`. One `AgentBackend` interface sized for the v1.1 `claude.ts` (Agent SDK) and `opencode.ts` (`@opencode-ai/sdk`) adapters. |
| D4 | Launch path (v1) | `launch` action opens the real host CLI (`claude`, `pi`, `opencode`) in the workspace. Strategy chain: **herdr** → tmux → zellij → Ghostty new window → suspend-and-run fallback. |
| D5 | herdr | **Primary host environment.** Plugin manifest to open the cockpit as a split/tab; launch via `pane split` + `agent start`; fleet shows herdr's live agents mapped by `cwd`; cockpit reports its embedded agent's state (`report-agent`) and raises `notification show` on approval requests. CLI JSON transport, polling (no socket subscription in v1). |
| D6 | Runtime | **Bun ≥ 1.3**, installed as an exact-pinned local devDependency (`bun@1.4.2`) of `packages/tui` — the operator's global Bun is not touched. A Node launcher (`packages/tui/bin/cockpit.mjs`) finds a suitable Bun and explains clearly if none. Fallback to Node 26.4 + `--experimental-ffi` **only** if spike T0 shows Pi's SDK cannot run under Bun. |
| D7 | Shared code | `packages/harness-kit/` (dependency-free `.mjs`): `guard-bridge.mjs`, `workspace.mjs`. `packages/org-state/`: `page-core` moved out of `cloudflare-os-integration` (re-export shim left at the old path) + new loaders. |
| D8 | Guard | `scripts/guards/deny-destructive-git.mjs` stays the single source. Bridge resolution: `<workspace>/scripts/guards/deny-destructive-git.mjs`, else the framework's canonical copy resolved **relative to `harness-kit`** (`../../scripts/guards/…`, present in every clone). **No byte copy.** Fail **closed** (exit 2 block · exit 0 allow · anything else block). |
| D9 | Permission policy | Order: guard (bash-like tools) → policy. Read-only tools (`read`, `grep`, `find`, `ls`) auto-allow; mutating tools (`bash`, `edit`, `write`, unknown) ask the operator: **allow once / allow for this session (per tool) / deny**. A request left unanswered for 10 minutes is denied. |
| D10 | Lifecycle commands | Cockpit-issued `/initialize`, `/close`, `/sync`, `/commit`, `/handoff` expand from the **canonical `.claude/commands/<name>.md`** of the active workspace (frontmatter stripped, `$ARGUMENTS` substituted) and are sent as a normal prompt — host-independent, no copies. The cockpit's own "initialize" is native: refresh + render dashboard, no model call. |
| D11 | Auth | The pane uses whatever provider auth **Pi** is configured with (`~/.pi/agent/…`). The cockpit ships **no** login flow. Max usage inside the pane = **OQ-1** (§11). Max usage today = the launch path. |
| D12 | Cockpit state | Only under `~/.config/org-os/cockpit/` (`config.json` operator-edited, `state.json` UI state). Nothing written into any repo by the cockpit itself. |
| D13 | Dependencies | Exact pins: `@opentui/core@0.5.12`, `@opentui/solid@0.5.12`, `solid-js@1.9.12`, `@earendil-works/pi-coding-agent@0.87.1`, `bun@1.4.2`, `js-yaml` (existing). Installed only by the opt-in `npm run tui:install` (the default framework install carries none of them). |
| D14 | Pages v1 | `fleet`, `dashboard`, `tasks`, `projects`, `project/<id>`, `plans`, `decisions`, `decision/<n>`, `memory`, `memory/<date>`, `this-week`. |
| D15 | Governance | Operator directive un-freezes the TUI line (portfolio memo §4 row 6) for this cockpit; recorded in `DECISIONS.md`; `tui-dashboard*.md` stamped superseded; `QUEUE.md` gains the entry (§14). |

## 4. Architecture (§1 — approved)

```
packages/harness-kit/             NEW · dependency-free .mjs · node --test
├── guard-bridge.mjs              resolveGuard(ws) · runGuard(cmd, ws) → {allow} | {block, reason}  (fail-closed)
├── workspace.mjs                 findWorkspace(cwd) · isWorkspace(dir) · readWorkspaceName(dir)
└── test/

packages/org-state/               MOVED from packages/cloudflare-os-integration/src/page-core (+ re-export shim)
├── build-state.mjs               files map → structured state (pure, existing)
├── parse-helpers.mjs             (existing)
├── render-page.mjs               markdown pages (backs `npm run page`)
├── loaders/                      NEW, pure: heartbeat.mjs · memory.mjs · decisions.mjs · plans.mjs · funding.mjs
├── read-files.mjs                NEW: fs → files map for a workspace (the only fs-touching module)
└── test/

packages/tui/                     NEW · the cockpit · Bun
├── bin/cockpit.mjs               Node launcher: locate Bun ≥1.3 (local devDep first), exec src/main.tsx
├── bunfig.toml                   preload = ["@opentui/solid/preload"]
├── herdr/                        herdr plugin: herdr-plugin.toml + scripts/{cockpit,open-cockpit,open-cockpit-tab}.sh
├── src/main.tsx                  flags → boot core → mount UI
├── src/core/                     headless; `bun test`
│   ├── bus.ts                    typed Command (UI→core) / CoreEvent (core→UI); in-process emitter
│   ├── config.ts                 ~/.config/org-os/cockpit/{config,state}.json (read/merge/write state only)
│   ├── fleet.ts                  discover workspaces: hub ancestor + framework + instances.yaml local_path + config extras
│   ├── workspace.ts              one workspace: read-files → org-state; watcher (debounced); read-only git status
│   ├── pages/                    resolvers → PageData (fleet, dashboard, tasks, projects, plans, decisions, memory, this-week)
│   ├── commands.ts               lifecycle command expansion from .claude/commands/<name>.md
│   ├── actions.ts                action catalog: script (allow-listed npm scripts) · open ($EDITOR) · agent (send prompt) · launch
│   ├── launch.ts                 host launch strategy chain (pure selector + effectful runners)
│   ├── herdr.ts                  HerdrClient over the `herdr` CLI (JSON); availability; polling
│   ├── gate.ts                   guard → policy → operator approval (awaits UI answer via bus)
│   └── agents/
│       ├── backend.ts            AgentBackend + AgentSession interfaces · AgentEvent union
│       └── pi.ts                 Pi SDK adapter + inline cockpit extension (tool_call → gate)
└── src/ui/                       @opentui/solid
    ├── App.tsx                   layout, focus regions, key routing
    ├── Rail.tsx · PageView.tsx · AgentPane.tsx · StatusBar.tsx
    ├── blocks/                   Table · List · KeyValue · Markdown · Notice
    └── overlays/                 Palette · Help · PermissionDialog · ActionMenu · LaunchMenu
```

**Boundaries.** The UI reads only state published on the bus and changes things only by sending
commands. Adapters never touch the UI; every tool permission goes through `gate.ts`. `org-state`
and `harness-kit` are pure and testable under `node --test` without OpenTUI, Pi or Bun.
`AgentBackend` is sized so v1.1 adapters drop in without core changes.

## 5. Screen model & navigation (§2)

### 5.1 Layout

```
┌ org-os · refi-bcn-os · main ● dirty · 4 urgent ───────────── herdr ● 2 agents · pi ◐ working ┐
│ FLEET          │ dashboard                                   │ AGENT · pi · claude-opus-5     │
│ ▸ lf-zettel  H │ ReFi Barcelona · LocalNode                  │ you  what's blocking payouts?  │
│   org-os     F │ ── Urgent ─────────────────────────────     │ pi   Reading data/pending-…    │
│   refi-bcn ! 2 │ ◇ Pay March invoices            (critical)  │ ⚙ read data/pending-payouts ✓  │
│   refi-dao     │ ── This week ──────────────────────────     │ ⚙ bash git log -5 …        ✓  │
│   regen-coord  │ Thu  Council call                           │ …                              │
│   …            │ ── Projects (6) ───────────────────────     │ ┌───────────────────────────┐  │
│                │ …                                           │ │ > _                       │  │
├────────────────┴─────────────────────────────────────────────┴───────────────────────────────┤
│ tab focus · ctrl+p palette · g go · a actions · L launch · ctrl+n new session · ? help · q quit│
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Header** (1 line): workspace name, branch + dirty, urgent-task count; right side herdr status
  (hidden outside herdr) and agent state.
- **Rail** (left): fleet list — `H` hub, `F` framework, instance rows with urgent count and `!`
  on drift/missing path; live herdr agent glyphs per row.
- **Page view** (center): the current page, breadcrumb in its title.
- **Agent pane** (right): transcript + input for the active workspace's Pi session.
- **Status bar** (1 line): context-sensitive key hints.

**Responsive.** ≥ 140 cols: all three regions. 100–139: rail + page, agent pane toggled
(`ctrl+a`) as a right overlay at 50%. < 100: single region at a time, rail collapses to a
workspace switcher in the palette. Target minimum 80×24.

### 5.2 Focus & keys

Focus regions cycle with `tab` / `shift+tab` (rail → page → agent). Global keys work unless a text
input has focus (then only `esc`, `ctrl+p`, `ctrl+c` are global).

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

Agent input: a single line — `enter` sends, `esc` leaves the input (multi-line input is v1.1).
**Permission dialog:** `y` allow once, `s` allow for session, `n` / `esc` deny; keys are ignored for
~250 ms after the dialog appears so a keystroke in flight can't answer it.

### 5.3 Pages

Every resolver returns the same shape:

```ts
type PageRef = { page: string; id?: string }
type PageData = {
  ref: PageRef; title: string; subtitle?: string
  blocks: Block[]                 // rendered top to bottom
  actions: ActionRef[]            // page actions (menu `a`)
  sources: string[]               // repo-relative files (for `e`)
  errors: string[]                // soft errors → Notice blocks, never throw
}
type Block =
  | { kind: "table"; columns: string[]; rows: { key: string; cells: string[]; target?: PageRef }[] }
  | { kind: "list"; heading?: string; items: { key: string; label: string; detail?: string; badge?: string; target?: PageRef }[] }
  | { kind: "kv"; pairs: [string, string][] }
  | { kind: "markdown"; text: string }
  | { kind: "notice"; level: "info" | "warn" | "error"; text: string }
```

| Page | Source | Content |
|---|---|---|
| `fleet` | all workspaces | Row per workspace: name, type, branch/dirty, last memory log age, open/urgent HEARTBEAT counts, drift (framework `instances.yaml`), live herdr agents (kind · state). `enter` → dashboard. |
| `dashboard` | org-state `buildState` + loaders | Identity, urgent tasks, this week, projects summary, recent memory (3), federation peers — the `/initialize` content, structured. |
| `tasks` | `HEARTBEAT.md` | Tasks grouped by heading, checkbox state, done count. |
| `projects` / `project/<id>` | `data/projects.yaml` | Table; entity page with fields + linked tasks. |
| `plans` | `docs/agent-plans/QUEUE.md` (framework) · `docs/plans/QUEUE.md` (hub) | Markdown view of the queue. |
| `decisions` / `decision/<n>` | `DECISIONS.md` | Heading list (date · title · status); detail = section markdown. |
| `memory` / `memory/<date>` | `memory/*.md` | Daily logs newest first; viewer. |
| `this-week` | `data/events.yaml`, `data/meetings.yaml`, funding deadlines, urgent tasks | Date-ordered buckets. |

Missing source → empty-state `notice`, not an error. Malformed YAML → `notice` naming the file;
the rest of the page renders.

### 5.4 Palette & overlays

Palette entries are generated: `Go to <page>` (current workspace) · `Switch to <workspace>` ·
`Action: <label>` · `Launch <host> in <split|tab>` · `Agent: /initialize|/close|/sync|/commit|/handoff`
· `Agent: new session` · `Toggle agent pane` · `Help`. Fuzzy match on label. Overlays are modal and
close on `esc`.

## 6. Agent pane, gate & launch (§3)

### 6.1 Backend interface

```ts
interface AgentBackend {
  id: "pi" | "claude" | "opencode"
  available(): Promise<{ ok: true } | { ok: false; reason: string }>
  open(opts: { workspace: Workspace; resume: "continue" | "new"; gate: Gate }): Promise<AgentSession>
}
interface AgentSession {
  id: string; backend: AgentBackend["id"]; model?: string
  prompt(text: string): Promise<void>      // resolves when the turn settles
  abort(): Promise<void>
  subscribe(fn: (e: AgentEvent) => void): () => void
  dispose(): Promise<void>
}
type AgentEvent =
  | { type: "status"; status: "idle" | "working" | "blocked" | "error"; detail?: string }
  | { type: "user"; text: string }
  | { type: "text_delta"; delta: string }
  | { type: "assistant_end"; text: string }
  | { type: "tool_start"; callId: string; tool: string; summary: string }
  | { type: "tool_end"; callId: string; ok: boolean; summary: string }
  | { type: "notice"; level: "info" | "warn" | "error"; text: string }
```

### 6.2 Pi adapter (`agents/pi.ts`)

- `open()` → `createAgentSession({ cwd: workspace.root, sessionManager: <persistent>, resourceLoader })`.
  `resume: "continue"` continues the most recent Pi session for that `cwd` if one exists (else new).
- `resourceLoader` = `DefaultResourceLoader` with:
  - the **inline cockpit extension** (always): `tool_call` handler → `await gate.check({tool, input,
    workspace})` → `{ block: true, reason }` or allow;
  - `packages/pi-integration` from the framework root **if it exists** (pi-harness landed) — its
    tools/prompts/guard load as in Pi's own TUI; otherwise one info notice "org-os Pi tools not
    installed (pi-harness not landed)";
  - the workspace's `skills/` as an extra skill path unless its `.pi/settings.json` already lists it.
- Pi's **project trust** (settled by spike T2, `packages/tui/VERIFIED.md`): the cockpit never grants
  trust. Pi's own trust store decides whether a workspace's `.pi/` resources load; when a `.pi/`
  directory exists the pane shows a notice telling the operator to trust it by running `pi` there
  once. The cockpit's inline extension (guard + approvals) loads regardless.
- Event mapping: `message_update/text_delta` → `text_delta`; `message_end` (assistant) →
  `assistant_end`; tool execution start/end → `tool_*` (summary = tool name + first 80 chars of the
  primary argument); `agent_end`/`agent_settled` → `status: idle`; exceptions → `status: error` +
  `notice`. While `gate` awaits the operator → `status: blocked`.
- Model: whatever Pi resolves by default; shown in the pane header. Model switching is v1.1.

### 6.3 Gate (`gate.ts`)

```
tool_call ─► is bash-like (bash, powershell)? ─yes─► harness-kit runGuard(cmd, ws)
                     │                                   ├─ block → deny(reason)   [fail-closed]
                     no                                  └─ allow ─┐
                     ▼                                             ▼
             read-only tool? ── yes ─► allow            session allow-list hit? ─ yes ─► allow
                     │ no                                          │ no
                     ▼                                             ▼
             ask operator (bus: PermissionRequested) ─► y once / s session / n deny / 10 min → deny
```

The guard runs even when the operator would approve — approval can never override a guard block.

### 6.4 Launch (`launch.ts`)

Pure selector `chooseStrategy(env, prefs) → Strategy`, then an effectful runner.

| Order | Condition | Split | Tab / window |
|---|---|---|---|
| 1 | `HERDR_ENV=1` and `herdr` on PATH | `herdr pane split --current --direction <right if cockpit pane wide else down> --cwd <ws> --no-focus` → `herdr agent start <name> --kind <host> --pane <id>` | `herdr tab create --cwd <ws> --label <ws>:<host>` → `agent start` in its root pane |
| 2 | `$TMUX` set | `tmux split-window -h -c <ws> <cli>` | `tmux new-window -c <ws> <cli>` |
| 3 | `$ZELLIJ` set | `zellij run --cwd <ws> -- <cli>` | `zellij action new-tab --cwd <ws>` + run |
| 4 | macOS + Ghostty | — | new Ghostty window in `<ws>` running `<cli>` (exact invocation verified in spike T4) |
| 5 | always | suspend renderer → run `<cli>` in foreground (cwd `<ws>`) → resume | same |

Agent name for herdr: `<ws-slug>-<host>` (lowercased, `[a-z0-9-]`, ≤ 32 chars, `-2`… on collision).
Hosts: `claude`, `pi`, `opencode` (v1); herdr kinds match. Launch never passes prompts or flags the
operator didn't choose; the host's own hooks (vault guard in `.claude/settings.json`) apply.

### 6.5 Lifecycle commands (`commands.ts`)

`expandCommand(ws, name, args)` reads `<ws>/.claude/commands/<name>.md`, strips YAML frontmatter,
replaces `$ARGUMENTS` with `args`, returns the text. Missing file → error notice, nothing sent.
`/initialize` from the cockpit palette = native refresh + dashboard; "Agent: /initialize" sends the
expanded command to the pane.

## 7. herdr integration (§4)

- **Detection:** `HERDR_ENV=1` → herdr mode; binary = `HERDR_BIN_PATH` or `herdr` on PATH. Outside
  herdr, every herdr feature is hidden and launch falls through the strategy chain.
- **Transport:** `HerdrClient.run(args[]) → parsed JSON` via `Bun.spawn`, 5 s timeout; CLI errors
  (JSON on stderr, exit 1) → typed `HerdrError`. No raw socket protocol in v1.
- **Fleet live agents:** while in herdr, poll `herdr agent list` every 3 s (paused when the cockpit
  is idle for 10 min); map each `AgentInfo.cwd ?? foreground_cwd` to the fleet workspace whose root
  is its longest prefix; show `agent · agent_status` in the rail and fleet page; `enter` on an agent
  row → `herdr agent focus <pane_id>`.
- **Reporting the embedded agent:** on every pane status change →
  `herdr pane report-agent $HERDR_PANE_ID --source org-os-cockpit --agent pi --state <idle|working|blocked> --seq <n>`;
  on exit → `pane release-agent`. On workspace switch → `pane report-metadata $HERDR_PANE_ID
  --source org-os-cockpit --title "org-os · <ws>"`.
- **Approval notifications:** a permission request while the operator may not be looking →
  `herdr notification show "org-os: approval needed" --body "<tool> in <ws>" --sound request`.
- **Plugin:** `packages/tui/herdr/herdr-plugin.toml` — `[[panes]] id="cockpit" placement="split"
  command=["./scripts/cockpit.sh"]`; actions `open-cockpit` (split) and `open-cockpit-tab` (new
  tab; switching to an already-open cockpit tab is v1.1). Installed by the operator with
  `herdr plugin link <abs path>`; keybindings documented, never written into the operator's
  `config.toml` by the cockpit.
- **Agent-state integrations** for launched hosts (`herdr integration install claude|pi|opencode`)
  are surfaced as a suggestion on the fleet page when `herdr integration status` reports them
  missing — operator-run, never automatic (they write into `~/.claude/hooks` etc.).

## 8. Data flow, errors, safety (§5)

**Boot:** launcher → Bun → `main.tsx` parses flags (`--workspace <path>`, `--page <id>`,
`--snapshot` for a one-frame headless render) → `fleet.discover(invocationCwd)` → load the active
workspace (others lazily, fleet page loads summaries for all) → mount UI → start watcher and (in
herdr) the agent poll.

**Fleet discovery:** framework root = the repo containing the running cockpit (resolved from the
launcher's own path, `packages/tui/../..`); hub = nearest ancestor of the framework root that
`isWorkspace` (the Zettelkasten vault);
instances = framework `data/instances.yaml` `local_path` resolved against the framework root;
plus `config.json` `workspaces[]` (absolute paths, labels). Missing paths render as `missing` rows.
The **active** workspace at boot = `--workspace`, else the fleet workspace containing the invocation
`cwd`, else the hub, else the framework.

**Workspace load:** `read-files.mjs` reads a fixed list of paths (the ones org-state loaders need)
into a files map; `buildState` + loaders produce state; resolvers produce `PageData` on demand.
Watcher: `fs.watch` on `data/`, `memory/`, and the root files (`HEARTBEAT.md`, `MEMORY.md`,
`DECISIONS.md`, `federation.yaml`, the queue file), debounced 300 ms → reload → `WorkspaceUpdated`.
Git: `git status --porcelain=v1 --branch` and `git log -1 --format=%cr` only (read-only), after
load, after each agent turn, and on `r`.

**Errors (never crash the cockpit):**

| Failure | Behaviour |
|---|---|
| Source file missing / malformed | Page `notice`; rest renders |
| Workspace path missing | Fleet row `missing`; selecting it shows why |
| Bun too old / missing | Launcher exits 1 with `npm run tui:install` instructions |
| Pi SDK load/auth failure | Agent pane shows the error + how to configure Pi; pages keep working |
| Guard script missing / crash / timeout (15 s) | Tool **blocked** with the cause (fail-closed) |
| herdr CLI error / timeout | One status-bar notice; herdr features degrade; launch falls to next strategy |
| Launch strategy fails | Next strategy in the chain; last resort suspend-and-run |
| Uncaught UI/core error | Error boundary overlay with the stack and "r to reload page"; process stays up |

**Vault safety.** The cockpit never runs a mutating git command itself. Actions of kind `script`
run only npm scripts from an allow-list (`initialize`, `generate:schemas`, `validate:schemas`,
`validate:structure`, `doctor`, `knowledge`); anything else must be done by an agent (guarded) or
by the operator. The embedded agent's bash goes through the fail-closed guard *before* approval.
Launched hosts carry their own guard hooks. The cockpit adds no shell passthrough.

## 9. Testing (§6)

- **`harness-kit`, `org-state`** — `node --test`: guard exit mapping (0/2/other/timeout/missing),
  resolution order, workspace detection on fixtures (nested, none, hub-in-vault), `read-files` on a
  fixture workspace, every new loader (happy, missing, malformed), and the **existing**
  `cloudflare-os-integration` tests unchanged through the re-export shim; `npm run page` output
  byte-identical before/after the move for every supported page.
- **`packages/tui` core** — `bun test`: bus, config merge, fleet discovery on a fixture tree
  (hub/framework/instances/missing/extra), workspace reload on file change, every page resolver
  against fixtures, command expansion, gate decision table (incl. guard-block-beats-approval and
  timeout-deny), launch strategy selection table, HerdrClient against an **injected fake runner**
  (JSON fixtures shaped by `herdr api schema`), agent-to-workspace cwd mapping.
- **Pi adapter** — `bun test` with a scripted fake model provider (mechanism from spike T2): a
  model turn emitting `bash("git stash list")` is **blocked** by the guard; a `write` call raises a
  permission request and honours allow/deny; events normalize to `AgentEvent`.
- **UI** — `testRender` at 160×45, 120×40 and 80×24: layout regions, rail navigation, page drill-in
  and back, palette filter + select, permission dialog y/s/n, agent pane streaming render.
- **Smoke** — `bun src/main.tsx --snapshot --page fleet` against the framework repo exits 0 and
  prints a frame containing every discovered workspace.
- **Acceptance (operator, recorded in `packages/tui/VERIFIED.md`)** — inside herdr: open via plugin
  keybinding; fleet shows hub/framework/instances; launch `claude` in a split (Max login, `.claude/`
  hooks active: `git stash list` refused); embedded Pi turn with an approval; `/close` via palette
  writes today's memory log in a scratch copy; herdr agent panel shows the cockpit agent's state.

## 10. Sequencing & spikes (§7)

**Spikes first**, each with a decision rule, results recorded in `packages/tui/VERIFIED.md`:

- **T0 — runtime.** `bun@1.4.2` (local) runs `@opentui/solid` render + `testRender`, **and** imports
  `@earendil-works/pi-coding-agent` and creates an in-memory session. Both → Bun. Pi fails under Bun
  → Node 26.4 `--experimental-ffi` path for the whole app (re-run T0 there). Both fail → stop and
  report.
- **T1 — OpenTUI surface.** Confirm element names/props used by §5 (`box`, `text`, `scrollbox`,
  `input`/`textarea`, `select`, key handling hook, renderer `suspend`/`resume` or equivalent,
  markdown/code rendering). Missing suspend → strategy 5 uses "print instructions and exit" instead.
- **T2 — Pi embedding.** Inline extension factory via `DefaultResourceLoader`; `tool_call` block
  result shape; scripted fake provider for tests; session continue-most-recent for a `cwd`;
  project-trust behaviour under the SDK; extra skill paths. Each item: proven → as designed;
  not available → the named fallback (fake provider → drive via RPC mode in tests; no extra skill
  paths → rely on `.pi/settings.json`).
- **T3 — herdr shapes.** Response shapes for `agent list`, `pane split`, `tab create`,
  `agent start`, `report-agent` taken from `herdr api schema` (never by probing the operator's live
  session from outside herdr). Live behaviour verified only in operator acceptance.
- **T4 — Ghostty launch.** Find the documented macOS invocation for a new Ghostty window with cwd +
  command. Not documented → drop strategy 4 (chain continues to 5).

**Build order:** spikes → `harness-kit` → `org-state` move + loaders → core (bus, config, fleet,
workspace, pages, commands, actions, gate, launch, herdr) → Pi adapter → UI shell → pages → agent
pane + dialogs → herdr plugin + reporting → launcher + npm scripts → docs + governance → full
verification. Core, `harness-kit` and `org-state` do not depend on the pi-harness branch.

**Amendments this spec asks of `2026-09-25-pi-harness-design.md`** (not applied here; that spec
lives on `feat/pi-harness` in another worktree):

1. `lib/guard.mjs` and `lib/workspace.mjs` become imports from `packages/harness-kit/` (single
   implementation).
2. Drop the bundled byte copy + `sync:pi-guard`: in every supported distribution (framework local
   path, pinned git source) the whole repo is present, so `harness-kit` resolves the canonical
   `scripts/guards/deny-destructive-git.mjs` by relative path.
3. Out-of-scope note: interactive SDK embedding by the cockpit is covered by this spec, distinct
   from the deferred "headless org agent via RPC/SDK".

## 11. Open questions

- **OQ-1 — Can the embedded agent pane run on the operator's Claude Max subscription?**
  *Answer from:* (a) Anthropic's current terms and Agent SDK docs, fetched at resolution time;
  (b) Pi's current auth docs for its Anthropic provider. *On record today:* the Agent SDK overview
  states "Unless previously approved, Anthropic does not allow third party developers to offer
  claude.ai login or rate limits for their products, including agents built on the Claude Agent
  SDK. Use the API key authentication methods …". Pi's Anthropic login has **not** been checked.
  *Interim:* the pane uses Pi's configured provider auth (API key by default); Max usage goes
  through the launch path; the cockpit ships no subscription-login flow. *Resolve before:* any
  auth UI for the pane; record answer + sources in `DECISIONS.md`.

## 12. Out of scope (v1)

- Embedded Claude Agent (`@anthropic-ai/claude-agent-sdk`) and opencode (`@opencode-ai/sdk`)
  adapters — **v1.1**, behind `AgentBackend`.
- A daemon / background sessions / multiple frontends (would need an interfaces-spec amendment).
- Editing registries (the admin app is the steward write path) — the cockpit is read + act.
- herdr raw-socket event subscription (v1 polls the CLI); `--tmux` self-relaunch.
- Model switching, Pi todo rendering, multi-session-per-workspace UI, theming, Windows.
- Skills / packages / ideas / members / funding pages beyond the `this-week` deadline feed.
- Installing herdr agent integrations or editing `~/.config/herdr/config.toml` on the operator's behalf.
- Adopting the cockpit in instance repos (it runs from the framework and reads instances in place).

## 13. Constraints honored

- **Vault safety:** no stash/clean/reset anywhere in this work; the cockpit issues no mutating git;
  guard fail-closed and single-sourced; approvals can't override a guard block; work happens in a
  separate worktree; nothing pushed without the operator.
- **Interfaces contract:** no new server, no new write path (D1).
- **Draft-and-present:** herdr plugin linking, herdr integrations, Pi install and any push/PR/tag are
  operator actions, documented, not performed.
- **Framework thinking:** fleet discovery works from any framework clone + `config.json`; nothing is
  hard-coded to this operator's paths.
- **Third-party code:** exact pins, opt-in install only.

## 14. Governance

- **`DECISIONS.md`** — new top entry *"2026-09-25 · Operator directive: org-os cockpit (OpenTUI · Pi ·
  herdr) un-freezes the TUI line"*: Status active; Scope framework / operator-ux / agent-runtime;
  Decision = D1–D6 in one paragraph; Why = daily-driver need stated by the operator, Pi harness
  convergence, herdr as host, interfaces contract satisfied (no server, no write path); the portfolio
  memo's row-6 trigger (admin M2 + daily-use gap / second operator) is **overridden by operator
  directive**, not fired; Refs = this spec, the plan, the pi-harness spec.
- **`docs/agent-plans/tui-dashboard.md` + `tui-dashboard-implementation.md`** — release-status
  banner updated to *"Superseded 2026-09-25 by `2026-09-25-org-os-cockpit-design.md` (OpenTUI, not
  Ink)"*; content preserved.
- **`docs/agent-plans/QUEUE.md`** — tui-dashboard leaves the Frozen row-6 cell and appears under
  Superseded with the pointer; a new line under *Next after release* records **org-os-cockpit**
  (operator-directive Active, plan link, workstream operator-interfaces).
- **`data/packages-matrix.yaml`** — entries for `tui`, `harness-kit`, `org-state`
  (`owner: framework`, `in_framework: true`, `promotion_status: canonical`,
  `lifecycle_status: active`, notes).
- **`CHANGELOG.md`** — `[Unreleased]` bullets for the three packages.
- **`packages/opencode-integration/README.md`** — its `org_os_tui` tool already shells out to
  `npm run tui`; the script now exists (note the Ink wording is superseded).
- **Docs** — `packages/tui/README.md` (install, run, keys, herdr plugin, acceptance checklist),
  `packages/harness-kit/README.md`, `packages/org-state/README.md`, a herdr row in
  `docs/HOST-INTEGRATION.md`.

## 15. Revision log

- **2026-09-25 (planning, after spikes T0–T4):** §6.2 project trust settled (no trust dialog; notice
  instead); §7 tab action not idempotent in v1; §9 herdr tests use an injected runner. The plan also
  adds: fleet-page "herdr agents" list whose rows focus the agent in herdr (§7 "enter on an agent
  row"), an error boundary around the page view plus process-level error notices (§8), and a gate
  `onSettle` hook so the approval dialog clears on timeout/cancel. Plan:
  `docs/superpowers/plans/2026-09-25-org-os-cockpit.md`.
- **2026-09-25 (after the final review):** §5.2 agent input is single-line in v1 (the shift+enter
  newline was never built; README matches); the approval dialog ignores keys for ~250 ms after it
  appears. Interactive mode mounts once the active workspace is loaded and loads the rest of the
  fleet in the background (§8 "others lazily"); startup notices are buffered until the UI subscribes.
