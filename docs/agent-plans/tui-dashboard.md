---
id: tui-dashboard
title: "TUI Dashboard + Agent-Rendered Pages"
status: frozen
priority: null
scope: framework
depends_on: []
created: 2026-04-25
started: null
completed: null
estimated_sessions: null
tags: [tui, dashboard, ink, operator-ux, packages, agent-runtime]
workstream: operator-interfaces
implementation_plan: tui-dashboard-implementation.md
---

> **Release status (2026-08-28):** Deferred to v0.6+ — portfolio memo 2026-08-21 §4 row 6 (frozen behind admin-app M2 + named-demand trigger). Convergence: [v0.5 release masterplan](../superpowers/plans/2026-08-28-v0.5-release-masterplan.md).

## Goal

Develop the dashboard and a thorough TUI interface for org-os, with dedicated pages per section, entity, and cross-cut. Same data layer powers both the standalone interactive Ink TUI and the agent-rendered ASCII output that operators see in Claude Code today. Every page is reachable from both modes.

## Why

The current `/initialize` dashboard is a single rich ASCII render with no drill-down — operators see a poster, not a navigable interface. Drill-downs today happen by hand (read this YAML, scan that markdown). Three forces converge:

1. **Operator UX gap** — viewing detailed state about one project, instance, or plan requires multiple file reads. A page model removes that friction.
2. **Two render targets, one data layer** — the ASCII dashboard rendered in chat and a future interactive TUI both need the same source data, parsed and structured the same way. Building this data layer once unblocks both surfaces (and a future web port — see Decisions taken: web).
3. **Framework leverage** — once shipped at framework level, every instance gets the TUI for free. The hub adds its own custom pages via `dashboard.yaml`; instances do not need to fork.

Related plans (this work coordinates with):

- `framework-dashboard-template` (web React+Vite dashboard, scoping) — TUI ships first; web becomes a thin renderer over the same data layer once TUI is proven.
- `obsidian-interface` (scoping) — Obsidian as primary operator interface for editing and reading; TUI is the operational dashboard. Complementary, not overlapping.
- `obsidian-canvas-interface` (scoping, depends on obsidian-interface) — visual layer; not in scope here.

## Decisions taken (during brainstorming)

| # | Question | Choice | Rationale |
|---|---|---|---|
| 1 | Runtime | **Both layered** — interactive standalone TUI + agent-rendered, sharing one data layer | Cheap path (agent-rendered) covers chat; rich path (TUI) covers terminal. Single data source avoids dup logic. |
| 2 | Page depth | **Section + entity + cross-cut** | Section pages alone are a YAML viewer; cross-cut pages (`health`, `this-week`, `promotions`, `attention`) are where synthesis lives. |
| 3 | Web dashboard relationship | **TUI first, web later as thin renderer** | Don't build two things at once. Shared data + page model makes web port cheap when wanted. |
| 4 | Tech stack | **Ink** (React-for-terminals, Node) | Pure Node, fits existing `.mjs` toolchain, mature ecosystem (`ink-table`, `ink-text-input`, etc.). Used by GitHub CLI, Cloudflare Wrangler. |
| 5 | Read/write surface | **Read-only + action launcher** | Direct writes collide with agent edits. Action launcher delegates mutation to npm scripts and prompt-copy to clipboard. |
| 6 | Generic vs hub-tuned | **Pluggable pages via `dashboard.yaml` manifest** | Extends the existing `custom_sections` pattern. Framework ships generic pages; hub adds its 3 custom pages via config, no fork. |
| 7 | Agent integration | **Two modes, same binary** — interactive TTY mode + stdout-print mode | Same Ink components render to live terminal or one-shot stdout. Agent embeds print output inline; operator drives interactive TUI separately. |
| 8 | Phasing | **Walking skeleton + manifest** — ship core + 3 representative pages first; fill out incrementally | Validates architecture (data layer, manifest, render core, action launcher, two modes) end-to-end early. Remaining pages are mostly data-fetch + layout once core is stable. |

## Architecture

Two new framework packages, one shared:

```
org-os/
├── packages/
│   ├── tui-data/                    NEW — pure Node, no UI
│   │   ├── src/
│   │   │   ├── load.mjs             reads data/*.yaml, MEMORY.md, HEARTBEAT.md, DECISIONS.md, memory/*, federation.yaml
│   │   │   ├── manifest.mjs         reads dashboard.yaml + custom_sections, produces flat Page[] registry
│   │   │   ├── pages/               one resolver per page type
│   │   │   │   ├── section.mjs      section page resolver
│   │   │   │   ├── entity.mjs       entity page resolver
│   │   │   │   └── cross-cut.mjs    synthesis (health, this-week, decisions, promotions, attention)
│   │   │   ├── actions.mjs          action catalog (script, open, prompt)
│   │   │   └── watch.mjs            chokidar watcher → emits change events
│   │   └── package.json
│   │
│   ├── tui/                         NEW — Ink renderer
│   │   ├── src/
│   │   │   ├── App.jsx              root, owns navigation state + jumplist
│   │   │   ├── pages/               Section.jsx, Entity.jsx, CrossCut.jsx
│   │   │   ├── components/          Header, Breadcrumb, StatusBar, Table, List, KeyValue, RelatedColumn, ActionMenu, CommandPalette, HelpOverlay
│   │   │   ├── chrome.jsx           shared layout, full-width, alternate-screen
│   │   │   └── modes/
│   │   │       ├── interactive.jsx  TTY entry: full keyboard nav + file-watch + color
│   │   │       └── print.jsx        stdout entry: one page → flush → exit, ANSI stripped
│   │   ├── bin/org-tui              executable shim
│   │   └── package.json
│   │
│   ├── opencode-integration/        NEW — opencode plugin
│   │   ├── src/index.mjs            registers org_os_page + org_os_tui tools via @opencode-ai/plugin
│   │   ├── README.md                install: add to opencode.json `plugin`
│   │   └── package.json
│   │
│   └── hermes-integration/          NEW — hermes skill + tool
│       ├── SKILL.md                 hermes skill manifest (frontmatter)
│       ├── tools/org_os.py          registers org_os_page tool in hermes's registry
│       ├── README.md                install: symlink into hermes's skills/ and tools/
│       └── package.json             (npm metadata only; install is symlink-based)
│
├── scripts/
│   └── initialize.mjs               UPDATED — thin wrapper, delegates to tui-data/load.mjs (output JSON contract preserved)
│
├── skills/org-os-init/SKILL.md      UPDATED — adds `npm run page <id>` reference for in-chat drill-downs
│
├── DECISIONS.md                     NEW — canonical decisions log (already created during brainstorming)
└── MEMORY.md                        UPDATED — Key Decisions section delegates to DECISIONS.md (already done)
```

**Why split `tui-data` from `tui`:**

- `tui-data` has zero UI dependencies. Unit-testable, reusable. Same module powers `/initialize` ASCII, the Ink TUI, the agent-print mode, and a future web port.
- `tui` only does rendering and input handling. New renderers (web) can swap in without touching `tui-data`.

**Entry points:**

| Command                                   | Mode           | What it does                                                                                    |
| ----------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| `npm run tui` (or `bin/org-tui`)          | interactive    | Boots Ink, mounts file-watch, full keyboard nav, fills terminal width                           |
| `npm run page <id>`                       | agent-print    | Resolves one page, renders to stdout, exits. ANSI stripped, markdown-clean output               |
| `npm run initialize`                      | data           | Returns the same JSON it does today (refactored internally, contract preserved)                 |
| `/initialize` (Claude Code slash command) | agent-rendered | Existing behavior preserved — agent reads `dashboard.yaml` and renders ASCII per the skill spec |
| opencode tool `org_os_page` / `org_os_tui` | host-pane     | Spawned by opencode plugin into a managed tmux/zellij pane (see Host integration)               |
| hermes skill / tool `org_os_page`         | host-tool      | Registered in hermes's tool registry; shells out to `npm run page <id>` (see Host integration)  |

## Host integration

The TUI is a subprocess in all hosts; depth of integration varies. This section documents what each host gets out of the box.

### Compatibility matrix

| Host           | Surface                            | Mechanism                                                                                                                                                       |
| -------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standalone     | Full interactive Ink TUI           | `npm run tui` in any terminal. Full-width, file-watch, keyboard nav.                                                                                            |
| Claude Code    | Embedded-in-chat pages, modal TUI  | Agent calls `npm run page <id>` and embeds output as markdown text. Operator can `npm run tui` for modal interactive (takes over terminal until quit).          |
| opencode       | Managed pane via plugin            | Ship `packages/opencode-integration/` as an opencode plugin. Plugin registers `org_os_page` and `org_os_tui` tools; opencode's multiplexer (tmux/zellij) spawns/attaches the TUI in a sibling pane. Lifecycle managed by opencode. |
| hermes         | Skill + tool via skill manifest    | Ship `packages/hermes-integration/` as a hermes skill (`SKILL.md` frontmatter) plus `tools/org_os.py` that registers `org_os_page` in hermes's tool registry. Slash-command auto-discovery via the registry's central wiring. |
| tmux/zellij    | Sibling pane, host-agnostic        | Operator runs `npm run tui` in a separate pane. No integration needed; works everywhere.                                                                         |

### Why subprocess (not embedded UI)

Agent CLIs are single-tenant: one TTY surface. A "live pane next to the chat" requires either a multiplexer (tmux/zellij) or a host that owns the entire screen (hermes does, opencode partly). Claude Code is sequential text in chat — it can spawn a modal subprocess but cannot host a persistent live UI alongside its conversation. Subprocess + multiplexer is the universal lower bound; the agent-print mode is the universal embedded fallback.

### Hermes-inspired refinements (v1)

Adopted from hermes's Ink TUI (same architecture as ours):

- **Alternate-screen rendering** — interactive mode enters alt-screen on launch, restores normal screen on quit. No scrollback clutter, clean fullscreen.
- **Bracketed-paste safety** — guard `<TextInput>` in command palette and search against terminal paste injection.
- **Mouse-friendly selection** — uniform-background row highlight (avoid `inverse` SGR) so terminal copy gestures work.
- **Slash-command autocomplete** — fuzzy match + tab completion in command palette (`:`).

Deferred to v2:

- **JSON-RPC host-control interface** — expose page resolvers over newline-delimited JSON-RPC (hermes pattern) so a host runtime can drive the TUI programmatically.
- **Differential streaming** — for action-launcher output panes.

## Page model & inventory

Three page types, all rendered by the same component shell:

### Section pages (one per dashboard section)

| Page id | Source | Description |
|---|---|---|
| `dashboard` | all | The full lush home view — today's `/initialize` content |
| `projects` | `data/projects.yaml` | Every project, all stages, leads, members, start dates, related plans |
| `tasks` | `HEARTBEAT.md` | Every task, full categories, no top-N truncation |
| `plans` | `docs/agent-plans/` + `QUEUE.md` | Active / queued / scoping / completed |
| `instances` | `data/instances.yaml` (hub-only) | Maturity, framework version, last sync, drift count, links |
| `federation` | `federation.yaml` | Network, peers, upstream, packages, knowledge commons |
| `members` | `data/members.yaml` | Roles, joined dates, layer, status |
| `ideas` | `data/ideas.yaml` | Ideas with status, champions |
| `funding` | `data/funding-opportunities.yaml` | Upcoming, active, deadlines |
| `calendar` | `data/events.yaml` + meetings | This week + upcoming |
| `memory` | `memory/*.md` + `MEMORY.md` | Recent log entries + key memory index |
| `decisions` | `DECISIONS.md` | Authoritative chronological decisions log |
| `skills` | `skills/` + `data/skills-matrix.yaml` (hub-only) | Canonical skills + promotion candidates |
| `packages` | `packages/` + `data/packages-matrix.yaml` (hub-only) | Canonical packages + promotion candidates |

### Entity pages (one specific item, addressed by id)

| Pattern | Example | Content |
|---|---|---|
| `project/<id>` | `project/v2-stabilization` | Full project state, linked plans, related memory entries, decisions, members |
| `instance/<id>` | `instance/refi-bcn-os` | Instance state, last sync, drift detail, divergent files, federation link |
| `plan/<id>` | `plan/federation-protocol` | Full plan markdown, status, dependencies, related project, history |
| `idea/<id>` | `idea/idea-001-hatching-pipeline` | Idea status, champions, related projects |
| `member/<id>` | `member/luizfernandosg` | Role, layer, joined, owned projects/plans |
| `skill/<id>` | `skill/research` | Promotion status, owners, instances using, notes |
| `package/<id>` | `package/dashboard` | Same shape as skill |
| `decision/<date-slug>` | `decision/2026-04-24-versioning-system` | Single decision detail page (parses sections from `DECISIONS.md`) |

### Cross-cut pages (synthesis across registries)

| Page id | Aggregates |
|---|---|
| `health` | Instance drift + last sync + skill freshness + schema staleness — system-wide health snapshot |
| `this-week` | Calendar + meetings + funding deadlines + critical/urgent tasks in date order |
| `promotions` | Skill candidates + package candidates + criteria-met items, ranked by readiness |
| `attention` | What genuinely needs the operator now: critical tasks + drift > threshold + scoping plans idle > N days + skills failing criteria |

(A `decisions` cross-cut was considered but folded into the `decisions` section page above, which already reads from `DECISIONS.md` directly.)

### Page manifest (in `dashboard.yaml`)

Built-in pages auto-register. Custom pages declared in `dashboard.yaml`:

```yaml
schema_version: "2.0"

# Existing sections + custom_sections preserved unchanged — agent-rendered ASCII path uses them today.

# NEW: theme block (optional, additive)
theme:
  primary: green
  accent: cyan
  dim: gray

# NEW: pages block (optional, additive — for instance-defined custom pages)
pages:
  - id: promotions
    type: cross-cut
    title: "Promotion Candidates"
    source:
      - data/skills-matrix.yaml
      - data/packages-matrix.yaml
    filter:
      promotion_status: [candidate, ready]
    render: list
    actions:
      - id: open-skill-promotion-doc
        label: "Open SKILL-PROMOTION.md"
        kind: open
        path: docs/SKILL-PROMOTION.md
```

## Navigation & UX

Screen layout (interactive Ink mode, 120×40 reference):

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 🧬 org-os · framework+hub · main↯dirty   mem 51m · 5 inst · live ●           │ ← header (1 line)
├──────────────────────────────────────────────────────────────────────────────┤
│ dashboard › projects › project: v2-stabilization                             │ ← breadcrumb (1 line)
├──────────────────────────────────────────────────────────────────────────────┤
│   v2.0.0 Stabilization                                                       │
│   Stage: Develop · Lead: @luizfernandosg · Started: 2026-04-05               │
│                                                                              │
│   ▎Linked plans (3)              ▎Related memory (2)                         │
│   ▸ versioning-system  ✓ done    Apr 24: Self-hosting inauguration           │
│   ▸ federation-protocol queued   Apr 15: /initialize self-executing          │
│   ▸ framework-dashboard scoping                                              │
│                                                                              │
│   ▎Linked decisions (3)          ▎Members (1)                                │
│   2026-04-24 Versioning system   @luizfernandosg (maintainer)                │
│   2026-04-24 Self-hosting                                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ [j/k] move  [enter] open  [esc] back  [a] actions  [/] search  [?] help  [q] │ ← status bar
└──────────────────────────────────────────────────────────────────────────────┘
```

### Keyboard model (vim-flavored, terminal-native)

| Key | Action |
|---|---|
| `j` / `k` / `↓` / `↑` | Move selection within page |
| `enter` | Drill into focused entity |
| `esc` / `h` | Back one level |
| `g` / `G` | Top / bottom of page |
| `tab` / `shift-tab` | Next / previous page in nav order |
| `/` | Fuzzy search across pages + entities |
| `:` | Command palette (`:projects`, `:project v2-stabilization`, `:help`) |
| `?` | Help overlay (keybindings + page list) |
| `r` | Force refresh |
| `e` | Open underlying file in `$EDITOR` |
| `a` | Action menu for current page/entity |
| `c` | Copy agent prompt (from action menu) to clipboard |
| `Ctrl-o` / `Ctrl-i` | Jumplist back/forward |
| `q` | Quit |

### Page visual templates

- **Section page** — title + count + summary; table or list of entities, cursor highlighted; footer with filter / sort options.
- **Entity page** — title + status row; 2-column body — left: structured fields (key/value); right: related items (linked plans, decisions, memory entries, members).
- **Cross-cut page** — title + filters; chronological or grouped buckets with bucket headers (e.g., decisions grouped by month).

### Theming

- Per-instance via `dashboard.yaml.theme: {primary, accent, dim, success, warning, danger}` — chalk color names or hex.
- Default palette: green primary (org-os brand), cyan accent, gray dim.
- `mode: 'agent-print'` strips all color (markdown-clean output).

### File-watch refresh (interactive mode only)

- `chokidar` watches: `data/`, `memory/`, `HEARTBEAT.md`, `MEMORY.md`, `DECISIONS.md`, `federation.yaml`, `dashboard.yaml`, `docs/agent-plans/`.
- Debounced 300ms re-render on change.
- Status-bar `live ●` indicator: yellow during reload, green when fresh.

### Help overlay (`?`)

Modal listing keybindings + the full page index (auto-generated from manifest) with each page's command-palette shortcut.

## Data flow

```
   data/*.yaml                                                     ┌──────────────┐
   memory/*.md           ┌─ load.mjs ──▶ ┌─ Sources ─┐             │  Interactive │
   HEARTBEAT.md          │               │ raw       │             │  Ink TUI     │
   MEMORY.md         ────┤ parse + cache │ structs   │     ┌─ Pages component
   DECISIONS.md          │               └───────────┘     │       │ (TTY render)│
   federation.yaml       │                                 │       └──────────────┘
   docs/agent-plans/     │                                 │
   dashboard.yaml        │                                 │       ┌──────────────┐
                         │                                 │       │  Agent-print │
                         │                                 │       │  mode        │
                         └─ manifest.mjs ──▶ Page registry ┘       │ (stdout +    │
                                  ▲                                │  ANSI strip) │
                                  │                                └──────────────┘
                            chokidar watcher
                            (interactive only)
```

### Load layer (`packages/tui-data/src/load.mjs`)

- Pure functions: `loadProjects()`, `loadInstances()`, `loadDecisions()`, `loadMemory()`, etc. — one per source.
- Each returns `{ source, items, errors, lastModified }`.
- Errors are first-class: never throw, always return `errors: [...]`. Renderer shows degraded views with error banners rather than crashing.
- Cache: in-memory `Map<sourcePath, parsedResult>` keyed by mtime. Invalidated by file-watch events.
- Cold-start cost: ~50ms full load on this repo. Warm reads: <1ms.

### Manifest layer (`packages/tui-data/src/manifest.mjs`)

- Reads `dashboard.yaml` + `custom_sections` + a built-in `BUILTIN_PAGES` registry.
- Produces flat `Page[]`: `{ id, type, title, source, render, actions, filter? }`.
- Validates page sources resolve to real files at registry build time (errors collected, not thrown).
- Entity pages registered as templates: `{ pattern: 'project/<id>', template: 'project-entity', source: 'data/projects.yaml' }` — `<id>` resolved at runtime.

### Page resolvers (`packages/tui-data/src/pages/`)

- One module per page type: `section.mjs`, `entity.mjs`, `cross-cut.mjs`.
- Each exports `resolve(pageId, manifest, sources) → PageData` — pure function.
- `cross-cut.mjs` does synthesis (e.g., `health` aggregates `instances + skills-matrix + schema mtime`).
- Page data shape uniform: `{ title, summary, fields[], items[], related[], actions[] }` — renderer doesn't care which type.

### Two entry points, same path

- **`bin/org-tui`** (interactive) — boots Ink, mounts file-watcher, renders `<App mode='interactive'>`. App owns nav state + jumplist; pages are pure components fed by resolvers.
- **`npm run page <id>`** (agent-print) — calls `resolve(id)` once, renders `<Page mode='agent-print'>` via Ink's `render(<Page/>, {stdout})`, exits. `chalk.level=0` strips ANSI. Output embeds in agent responses without escape sequences.

### Schema/validation

- `tui-data` does soft validation only (logs warnings, never blocks render).
- Hard validation lives in `npm run validate:schemas` — separate concern, untouched.

### Edge cases

- Missing source file → page renders empty-state message, not error.
- Malformed YAML → page renders banner: `⚠ data/projects.yaml line 12: unexpected token` + rest of dashboard works.
- Missing manifest entry referenced by `dashboard.yaml.custom_sections` → manifest layer surfaces `manifest_errors` page listing every misconfiguration.

## Action launcher

Three action kinds, all read-only-from-the-data-perspective:

### 1. Run-script actions

```yaml
actions:
  - id: regenerate-schemas
    label: "Regenerate EIP-4824 schemas"
    kind: script
    run: "npm run generate:schemas"
    affects: [".well-known/"]
```

Pressing `a` opens an action menu. Selection runs the script in a child process, streams stdout into a transient pane, shows pass/fail and links to changed files on exit.

### 2. Open-file actions

```yaml
actions:
  - id: edit-this-plan
    label: "Edit plan file"
    kind: open
    path: "{{entity.file}}"
```

Templates resolve at execution time (`{{entity.file}}` → `docs/agent-plans/federation-protocol.md`).

### 3. Copy-prompt actions

```yaml
actions:
  - id: draft-project-update
    label: "Draft project update"
    kind: prompt
    template: |
      Draft a one-paragraph status update for the {{entity.name}} workstream.
      Stage: {{entity.stage}}. Linked plans: {{entity.plans}}.
```

TUI renders the assembled prompt in a preview pane; `c` copies to system clipboard via `clipboardy`. Operator pastes into Claude Code conversation. No direct agent dispatch.

### Built-in actions (free on every page)

- `e` — open underlying source file in `$EDITOR`
- `r` — force refresh
- `c` — copy current page rendering as plain text
- `:` — command palette → jump to any page

### Action context is page-aware

Action declared on `projects` section page sees `{{section.items}}`; same action declared on `project/<id>` entity page sees `{{entity}}`. Template engine is intentionally minimal (Mustache-style, no logic) — keeps action catalog declarative.

### Safety

- Run-script actions list `affects` paths upfront so operator knows what changes.
- Destructive actions (writing outside `memory/`, `.well-known/`, `node_modules/`) require confirm prompt. None declared at v1 — all v1 actions are additive or idempotent.
- Prompt-copy actions are sandboxed — only touch clipboard.

## Walking-skeleton v1 scope

What ships when this lands:

### Code

- `packages/tui-data/` — full data layer (load, manifest, three resolvers, file-watch, actions catalog).
- `packages/tui/` — Ink core: `<App>`, `<Header>`, `<Breadcrumb>`, `<StatusBar>`, `<Table>`, `<List>`, `<KeyValue>`, `<RelatedColumn>`, `<ActionMenu>`, `<CommandPalette>`, `<HelpOverlay>`.
- `bin/org-tui` — interactive entry point.
- `package.json` scripts: `tui`, `page` (e.g., `npm run page projects`).
- `scripts/initialize.mjs` refactored to delegate to `tui-data` (output JSON contract preserved).
- `skills/org-os-init/SKILL.md` updated to mention `npm run page <id>` for in-chat drill-downs.

### Pages shipped in v1 (4 pages, prove all three types end-to-end)

1. `dashboard` — section page, the home view (today's `/initialize` content via Ink for interactive, via print for agent).
2. `projects` — section page over `data/projects.yaml`.
3. `project/<id>` — entity page template.
4. `this-week` — cross-cut page aggregating calendar + meetings + funding deadlines + critical tasks.

### Pages registered in manifest as `coming-soon` placeholders

Help overlay (`?`) shows the full nav graph from day one. Each is one resolver + one render call away from being real:

`tasks`, `plans`, `instances`, `federation`, `members`, `ideas`, `funding`, `calendar`, `memory`, `decisions`, `skills`, `packages`, `health`, `promotions`, `attention`, plus entity templates for `instance/`, `plan/`, `idea/`, `member/`, `skill/`, `package/`, `decision/`.

### Actions shipped in v1

- `regenerate-schemas` (script — dashboard, data pages)
- `analyze-instances` (script — dashboard, instances pages)
- `edit-this-plan` (open — plan entity pages)
- `edit-this-project-yaml` (open — project entity pages)
- `draft-project-update` (prompt-copy — project entity pages)
- Built-ins (`e`, `r`, `c`, `:`) on every page.

### `dashboard.yaml` schema extension (additive, backwards-compatible)

```yaml
schema_version: "2.0"

# existing sections + custom_sections preserved unchanged
sections: { ... }
custom_sections: [ ... ]

# NEW (optional)
theme:
  primary: green
  accent: cyan
  dim: gray

# NEW (optional)
pages: [ ... ]
```

### Dependencies added

| Package | Version | Purpose |
|---|---|---|
| `ink` | ^4 | Terminal renderer |
| `ink-text-input` | latest | Text input primitive |
| `ink-select-input` | latest | Selectable list |
| `ink-table` | latest | Table widget |
| `ink-spinner` | latest | Loading spinner |
| `chokidar` | ^3 | File watch |
| `clipboardy` | ^4 | Clipboard |
| `chalk` | ^5 | Colors (already in Ink stack) |
| `js-yaml` | ^4 | YAML parsing (already in `package.json`) |
| `gray-matter` | ^4 | Frontmatter parsing (already in `package.json`) |

### Out of scope for v1

- Web port (deferred per Decision #3).
- Multi-vault / cross-instance live views (single-repo only at v1; cross-instance state already covered by hub-only `instances` registry).
- Custom theming editor in-TUI (set via `dashboard.yaml`, no UI).
- Plugin system for instance-defined page renderers (manifest covers data + simple render modes; full plugin SDK later).

## Testing strategy

### 1. Data-layer unit tests (`packages/tui-data/test/`)

High coverage, fast. Highest risk — breaks the whole TUI if wrong.

- Per-source loader: golden fixtures in `test/fixtures/data/*.yaml` covering happy path + malformed + missing required fields.
- Resolver tests: given a `Page` + sources, assert `PageData` shape matches snapshot.
- Manifest builder: assert built-in pages register, custom pages override correctly, `manifest_errors` page surfaces misconfigurations.
- Cache invalidation: simulate file-watch events, assert only affected pages re-resolve.

Tooling: `vitest` (or `node --test` if avoiding deps). Target: 80%+ on `packages/tui-data/`.

### 2. Renderer snapshot tests (`packages/tui/test/`)

Ink supports `ink-testing-library`. Snapshot rendered output of each page given mock data.

- One snapshot per page per mode (`interactive`, `agent-print`).
- Snapshot help overlay, command palette, action menu, error banners.
- CI fails on unintended diffs.

### 3. End-to-end smoke (`scripts/test-tui.mjs`)

Runs against this repo's real `data/`:

- `npm run page dashboard` exits 0 and emits non-empty stdout.
- `npm run page projects` exits 0 and includes "v2.0.0 Stabilization".
- `npm run page project/v2-stabilization` exits 0 and shows linked plans.
- `npm run page health` exits 0 and reports drift counts matching `data/instances.yaml`.

Wired into `package.json` `test` alongside existing schema/structure validators.

### Manual / interactive (documented in `packages/tui/README.md`)

- Boot `npm run tui`, verify keyboard nav, jumplist, fuzzy search, file-watch refresh on `touch data/projects.yaml`.
- Verify action launcher: `regenerate-schemas` finishes and updates `.well-known/`.
- Verify clipboard copy: prompt-copy on a project, paste, verify content.

## Backwards compatibility — what must not break

This is purely additive. Every existing entry point and contract is preserved.

| Existing surface | Status after this work | Notes |
|---|---|---|
| `/initialize` (Claude Code slash command) | **Unchanged** | Skill spec preserved. Agent still reads `dashboard.yaml` and renders ASCII per existing rules. The new `npm run page <id>` is an optional supplement, not a replacement. |
| `/close` slash command | **Unchanged** | Untouched. |
| `npm run initialize` | **Same JSON output** | Internal refactor delegates to `tui-data/load.mjs`. Output schema verified by snapshot test against current output. |
| `dashboard.yaml` | **Backwards-compatible** | Existing `sections` and `custom_sections` keys keep working with their current semantics. New `theme` and `pages` keys are optional additions. |
| `skills/org-os-init/SKILL.md` | **Extended, not rewritten** | Adds a paragraph mentioning `npm run page <id>` for drill-downs. Existing OPEN/PLAN/EXECUTE/CLOSE flow stays. |
| `MEMORY.md` Key Decisions section | **Already migrated** | Section now delegates to `DECISIONS.md` (done during brainstorming). Index role of MEMORY.md preserved. |
| `DECISIONS.md` | **New file, doesn't replace anything** | Added during brainstorming. Authoritative for decisions log. |
| `npm run generate:schemas` | **Unchanged** | The TUI calls it via action launcher, but the script itself is untouched. |
| `npm run validate:schemas` | **Unchanged** | Untouched. |
| `npm run validate:structure` | **Unchanged** | Untouched. |
| `npm run analyze:instances` | **Unchanged** | Same as `generate:schemas` — invoked via action menu, script untouched. |
| `.well-known/*.json` generation | **Unchanged** | Schema generator untouched. |
| Existing 10 framework skills | **Unchanged** | None touched. |
| Plan pipeline (`scoping → queued → active → completed`) | **Unchanged** | Plan files in `docs/agent-plans/` consumed read-only by the TUI; no changes to pipeline conventions. |
| Federation protocol | **Unchanged** | `federation.yaml` consumed read-only. |
| All 13 data registries | **Unchanged** | `data/*.yaml` consumed read-only by TUI. Only edits happen via `npm run generate:schemas` (which already happens today). |
| `npm install` / lockfile | **Additive deps only** | New dependencies (Ink stack + chokidar + clipboardy + gray-matter) are scoped to the new packages. Existing dependencies untouched. |

**Verification gates before merging v1:**

1. Run current `/initialize` — output identical to baseline (snapshot diff).
2. Run `npm run initialize` — JSON output identical to baseline.
3. Run `npm run generate:schemas && npm run validate:schemas && npm run validate:structure && npm run analyze:instances` — all pass with no new warnings.
4. Verify all 5 instances still resolve in the hub view.
5. New `npm run page dashboard` produces output that, when stripped of formatting, contains the same factual data as `npm run initialize`.

## Open questions (low-priority, can resolve during implementation)

1. **Test framework choice** — `vitest` adds a dev-dep; `node --test` is built-in but ergonomically rougher. Default to `node --test` unless implementation friction surfaces.
2. **Color in agent-print mode** — strict ANSI strip is the default. Should we offer a `--color` flag for terminals that DO render colors when piped? Defer; YAGNI for v1.
3. **Page-not-found behavior** — `npm run page bogus-id` should exit non-zero with a list of valid pages. Confirm exit code conventions match existing scripts.
4. **Telemetry** — none planned; the TUI is local-only. Confirm at v1 release.
5. **Windows compatibility** — Ink generally works; chokidar has WSL caveats. Confirm tested on macOS + Linux at v1; document Windows as best-effort.

## Tasks (preliminary — will firm up via writing-plans skill next)

- [ ] Scaffold `packages/tui-data/` with package.json, src/, test/
- [ ] Implement `load.mjs` for each source (data/*.yaml, MEMORY.md, HEARTBEAT.md, DECISIONS.md, memory/*, federation.yaml, docs/agent-plans/)
- [ ] Implement `manifest.mjs` with built-in page registry + `dashboard.yaml` extension parser
- [ ] Implement page resolvers (`section.mjs`, `entity.mjs`, `cross-cut.mjs`)
- [ ] Implement `actions.mjs` catalog and template engine
- [ ] Implement `watch.mjs` chokidar wrapper with debounced event emitter
- [ ] Unit tests for tui-data layer
- [ ] Refactor `scripts/initialize.mjs` to delegate to tui-data; verify JSON contract preserved
- [ ] Scaffold `packages/tui/` with package.json, src/, bin/
- [ ] Implement `<App>`, navigation state, jumplist
- [ ] Implement chrome components: `<Header>`, `<Breadcrumb>`, `<StatusBar>`
- [ ] Implement page components: `<Section>`, `<Entity>`, `<CrossCut>`
- [ ] Implement primitives: `<Table>`, `<List>`, `<KeyValue>`, `<RelatedColumn>`
- [ ] Implement modals: `<ActionMenu>`, `<CommandPalette>`, `<HelpOverlay>`
- [ ] Implement `interactive.jsx` and `print.jsx` mode entry points
- [ ] Implement four v1 pages (dashboard, projects, project/<id>, this-week)
- [ ] Snapshot tests for each page in each mode
- [ ] End-to-end smoke tests
- [ ] Wire `npm run tui` and `npm run page` scripts in package.json
- [ ] Update `skills/org-os-init/SKILL.md` to reference `npm run page <id>`
- [ ] Update `dashboard.yaml` with `theme` block (optional)
- [ ] Verify all existing scripts (`generate:schemas`, `validate:*`, `analyze:instances`) still pass
- [ ] Verify `/initialize` output unchanged (snapshot diff against baseline)
- [ ] Document in `packages/tui/README.md` and `packages/tui-data/README.md`
- [ ] Move plan to `queued`, then `active`, then `completed` per pipeline convention

## Related

- **`framework-dashboard-template`** (scoping) — Web React+Vite dashboard. Becomes a thin renderer over `packages/tui-data/` once this lands.
- **`obsidian-interface`** (scoping) — Obsidian as primary operator interface. Complementary; this TUI does not replace Obsidian, it provides the operational dashboard view.
- **`obsidian-canvas-interface`** (scoping) — Canvas as visual layer. Out of scope here.
- **`v2-stabilization`** (parent workstream) — TUI is a stabilization deliverable for the operator-interfaces workstream.

## Next step

Implementation plan is written: see [`tui-dashboard-implementation.md`](tui-dashboard-implementation.md) — 28 tasks across 5 phases (data foundation → page resolvers → TUI scaffolding → v1 pages + interactive → refactor + verify), with bite-sized TDD steps, exact file paths, and 5 verification gates that confirm no regressions to existing functionality.

When ready to execute, either:
- Dispatch via `superpowers:subagent-driven-development` (recommended — fresh subagent per task), or
- Run inline via `superpowers:executing-plans` (batch execution with checkpoints).

Plan moves to `active` status when execution begins.
