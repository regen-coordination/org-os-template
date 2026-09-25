# Pi × org-os Harness — Design Spec

**Date:** 2026-09-25
**Status:** design approved in dialogue (operator session 2026-09-25); awaiting written review, then `writing-plans`
**Pi:** https://pi.dev — "a minimal agent harness" by Earendil Inc. (MIT). npm `@earendil-works/pi-coding-agent`, **v0.87.1** (released 2026-09-22), source `github.com/earendil-works/pi/packages/coding-agent`. Surfaces verified against the v0.87.1 docs on 2026-09-25: context files (`AGENTS.md` / `CLAUDE.md`, walked up from cwd), project `.pi/` (`settings.json`, `extensions/`, `skills/`, `prompts/`, `SYSTEM.md`, `APPEND_SYSTEM.md`), Agent Skills discovery in `.agents/skills/`, TypeScript extensions loaded through `jiti`, Pi packages (npm / git / local path) with a `pi` key in `package.json`. Everything under `.pi/` and project `.agents/skills/` loads only after **project trust** is granted. Pi deliberately ships **no** MCP, subagents, permission popups, plan mode, or todo list.
**Not installed on the operator's Mac at design time** (`pi` not on PATH; only `~/.pi/memory/` exists).

## Goal

Make Pi a first-class org-os host, so **any operator in any instance** can run their org-os sessions in Pi, with the same parity Claude Code has today. That covers the session lifecycle, the vault-safety guard, the skills, and the startup context. On top of that come org-os-native tools and the pieces Pi leaves out (subagents, task tracking, MCP).

It is a framework feature, not a personal setup. It must reach instances that share no git history with the framework, and operators who aren't Luiz. It must also be impossible for it to weaken vault safety.

## Understanding (what was said vs. assumed)

**Said by the operator:**

- Purpose: **framework feature for all**, not a personal daily driver and not (yet) a headless agent runtime.
- v1 scope: **core parity + org-os native tools + Pi's missing pieces + MCP bridge**, all four.
- Third-party code: **own the core, pin the opt-ins**. The default install carries zero third-party executable code. `pi-subagents` and `pi-mcp-adapter` are exact-pinned in an opt-in profile.
- Shape: **approach A**, a Pi package plus a thin committed `.pi/` pointer per repo, also installable globally.
- Distribution (revised mid-design, see below): **instances pin the framework as a Pi git package**, and `pi:adopt` writes the files.

**Assumed (approved with the design):**

- No npm publication in v1. The git source is the distribution channel.
- `scripts/guards/deny-destructive-git.mjs` stays the single source of truth for guard logic, and Pi calls it as a subprocess.
- `.claude/commands/*.md` stays the single source for lifecycle commands, and `sync:commands` gains a Pi target.
- `skills/` stays canonical for skills. `.agents/skills/` holds Berd mirrors derived from it.

**Discovered during design, and it changed the design:** none of the five instances shares git history with the framework (`git merge-base HEAD upstream/main` is empty for refi-bcn-os, regen-coordination-os, refi-med-os and bread-coop-os; refi-dao-os has no upstream remote). So neither `sync:upstream` nor `sync:packages` can deliver `packages/pi-integration` today. This matches the Paper spec's 2026-09-02 note, "no instance can pull framework packages yet". Distribution therefore goes through Pi's own package mechanism, which needs no shared history.

## Decisions (locked)

| Question | Decision |
| --- | --- |
| Pi's job in org-os | **A host, like opencode and hermes.** Operators run interactive org-os sessions in Pi. (Over: personal daily driver, where portability comes second; headless org agent via RPC/SDK, deferred.) |
| Shape | **Pi package + thin pointer.** `packages/pi-integration/` is a conventional Pi package. Each repo commits a small `.pi/settings.json`. The root `package.json` carries a `pi` manifest, so the framework repo itself is installable as a Pi git package. (Over: everything committed under `.pi/`, which is not installable outside a repo, hard to unit-test and breaks the `packages/<host>-integration` pattern; a global npm package only, which needs a publish pipeline, per-operator installs and version skew.) |
| Distribution to instances | **Pinned git source.** An instance's `.pi/settings.json` declares `git:github.com/regen-coordination/org-os-template@pi-v<x.y>`. Pi clones and installs it on first trust. The repo is public, about 4.9 MB, with 6 light runtime deps. Per-component tags follow the `kms-territory-v0.1` precedent. (Over: `sync:packages`, broken by the lack of shared history; npm publication, with no `@org-os` scope today.) |
| Distribution to the framework repo | **Local path** `../packages/pi-integration`: the development loop. |
| Adoption | **Explicit, operator-run.** `npm run pi:adopt -- --target <instance-dir>` runs from the framework against a sibling instance (the instance-doctor precedent). It writes `.pi/settings.json` and `.pi/mcp.json`, shows the diff, and the operator commits inside the instance. Nothing is pushed. |
| Third-party code | **Own core, pin opt-ins.** Guard, lifecycle, page tool, status and todo are all org-os code. `pi-subagents@0.71.0` and `pi-mcp-adapter@2.37.0` sit in `profiles/extras.json` and are installed only at user level, by `npm run pi:extras`, after confirmation. Never written to a committed file. |
| Guard source of truth | **`scripts/guards/deny-destructive-git.mjs`**, called as a subprocess with the Claude hook payload shape. The package bundles a byte-identical copy as a fallback for workspaces that lack the script (refi-bcn-os and refi-dao-os today). A drift test enforces that the copy is identical. |
| Guard failure mode | **Fail closed.** Exit 2 blocks the command, exit 0 allows it, and anything else (missing script, spawn error, timeout over 15 s, unexpected exit) blocks. Every other component fails **open** with a visible notice. |
| Guard coverage | The model's `bash` (and `powershell`) tool calls **and** the operator's own `!cmd` lines (`user_bash`). That is stricter than Claude Code, deliberately. Active inside an org-os workspace or any directory tree containing `.obsidian`. Dormant elsewhere, so a global install never gets in the way in unrelated repos. |
| Subagents and the guard | **Every subagent child in a vault workspace must run the guard, or subagents are refused there.** pi-subagents foreground children do not load parent extensions, so the harness has to inject the guard. The mechanism is settled by spike S3. The fallback is to degrade the feature, never the guard. |
| Lifecycle commands | **Prompt templates generated from `.claude/commands/`** (`/initialize`, `/close`, `/sync`, `/commit`, `/handoff`, `/skills`). Pi supports `$ARGUMENTS`, so bodies are copied verbatim. No extension code. |
| Skills | Pi reads them in place: `skills: ["../skills", "!../skills/commands/**"]`. The Hermes-only thin command-skills are excluded because they would duplicate the prompts. `skills/` wins over the `.agents/skills/` Berd mirrors (spike S4). |
| Custom Pi agents | **None in v1.** The built-ins `scout`, `worker` and `reviewer` cover what the superpowers skills ask for. `subagents.agentExcludeDirs: [".agents"]` stops the old-style discovery from parsing `.agents/skills/**/SKILL.md` and the Berd personas as agents. |
| MCP | **Committed `.pi/mcp.json`** (Pi-only, so Claude Code never prompts about it) declaring lazy `notion` (official server, exact-pinned) and `github` (GitHub's hosted endpoint) servers. Secrets come only through `${NOTION_API_KEY}` / `${GITHUB_TOKEN}` interpolation. The file is inert until `pi-mcp-adapter` is installed. |
| Startup | Pi loads `AGENTS.md` natively. The extension only shows a one-line notice on session start. It never auto-runs `/initialize` and never modifies the system prompt. |
| Pi version floor | **0.87.** Older versions get a one-line warning on session start. The host-provided packages are `peerDependencies: "*"`, never bundled. |

## Architecture

```
                       .claude/commands/*.md          scripts/guards/deny-destructive-git.mjs
                       (canonical commands)           (canonical guard logic)
                                │                                  │
                  npm run sync:commands              npm run sync:pi-guard (byte copy)
                                │                                  │
                                ▼                                  ▼
 packages/pi-integration/ ── prompts/*.md ──────────── guard/deny-destructive-git.mjs
   extensions/org-os/index.ts ──► lib/{workspace,page,status,todo,standdown,subagents}.mjs
   extensions/vault-guard.ts  ──► lib/guard.mjs ──spawn──► <workspace guard> or bundled guard
   skills/org-os-pi/SKILL.md          profiles/extras.json          VERIFIED.md
                                │
        ┌───────────────────────┼──────────────────────────────────────────┐
        │                       │                                          │
 framework repo           instance repo                              operator (optional)
 .pi/settings.json        .pi/settings.json                          pi install git:…/org-os-template
  packages: [../packages   packages: [git:github.com/regen-           → ~/.pi/agent/settings.json
   /pi-integration]         coordination/org-os-template@pi-v0.1]     (same package identity as
                           (written by npm run pi:adopt)               an instance pin: project wins)
```

Pi identifies a git package by its repository URL, ignoring the ref, and a project entry replaces the personal entry. So an operator's global install plus an instance's pin loads **once**. Only inside the framework repo do two copies exist (a local path and a git source are different identities). There, the global copy stands down (see `standdown.mjs`).

## Components

### `packages/pi-integration/package.json`

`@org-os/pi-integration`, `version: 0.1.0`, `type: module`, `keywords: ["pi-package", "org-os"]`, `engines.node >= 22`. Pi manifest:

```json
"pi": {
  "extensions": ["./extensions/org-os/index.ts", "./extensions/vault-guard.ts"],
  "skills": ["./skills"],
  "prompts": ["./prompts/*.md"]
}
```

`peerDependencies`: `@earendil-works/pi-coding-agent`, `typebox`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui` (the ones actually imported), all `"*"`. No runtime `dependencies`.

### Root `package.json`

Gains a `pi` manifest that points into `packages/pi-integration/` (the same three resource lists, prefixed). It exposes **only** the harness resources. The framework's own `skills/` never leak into an instance through the package, because instances load their own `skills/` through their own settings. It also gains the scripts `sync:pi-guard`, `pi:extras`, `pi:adopt` and `test:pi`.

### `extensions/vault-guard.ts` → `lib/guard.mjs`

A standalone extension file. It has to be loadable on its own, because it is the file injected into subagent children.

- `pi.on("tool_call")` for `toolName` `bash` or `powershell`, and `pi.on("user_bash")`.
- Activation scope: `findWorkspace(cwd)` succeeds, **or** an ancestor contains `.obsidian`. Otherwise it returns `undefined` (no opinion).
- `resolveGuard(workspaceRoot)`: prefers `<workspace>/scripts/guards/deny-destructive-git.mjs`, and falls back to the package's `guard/deny-destructive-git.mjs`.
- `runGuard(command)`: `spawnSync(process.execPath, [guardPath], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }), timeout: 15000 })`.
  - exit 2 → `{ block: true, reason: stderr.trim() || "blocked by org-os vault guard" }`
  - exit 0 → `undefined`
  - anything else → `{ block: true, reason: "org-os vault guard unavailable (<detail>); blocking fail-closed" }`
- A `user_bash` block returns the equivalent block result, and the reason names the guard, so the operator knows to use a normal terminal if they really mean it.
- Pure logic (scope, resolution, result mapping) lives in `lib/guard.mjs` so `node --test` can exercise it without Pi.

### `guard/deny-destructive-git.mjs`

A byte copy of `scripts/guards/deny-destructive-git.mjs`, written by `npm run sync:pi-guard` (`scripts/sync-pi-guard.mjs`). The guard file is already designed to be copied: it's self-contained, with no imports or exports.

### `extensions/org-os/index.ts`

A thin wrapper that registers:

- **`lib/workspace.mjs`**, `findWorkspace(cwd)`: walks up to the nearest directory holding `package.json`, `federation.yaml`, `data/` and `memory/` (the `/initialize` rule). It returns `{ root, name }`, where the name is read from `federation.yaml`, with the directory basename as a fallback.
- **Tool `org_os_page(page_id)`** (`lib/page.mjs`): runs `npm run page --silent -- <id>` in the workspace root. The model-facing output is capped at 2,000 lines / 50 KB, and when truncated it says so, along with the command to get the full page. A non-zero exit throws, which Pi turns into a failed tool result. `details: undefined`.
- **Command `/org [page]`** (default `dashboard`): runs the same renderer and shows the result in the transcript through a custom message, without a model turn.
- **Status footer** (`lib/status.mjs`): `⬡ <name> · <branch> · ● dirty|✓ clean · <n> tasks`. The task count is read once at `session_start` (from `node scripts/initialize.mjs` JSON, and omitted if that fails). Branch and dirty state are refreshed at `turn_end` with two cheap git reads. It only shows when `ctx.hasUI`, and any error drops the footer silently.
- **Tool `todo` + command `/todos`** (`lib/todo.mjs`): `list | add | toggle | clear`. State lives in the tool-result `details` and is rebuilt from `ctx.sessionManager.getBranch()` at `session_start`, so it follows `/tree` and `/fork`. Adapted from Pi's MIT `examples/extensions/todo.ts`. The state logic is a pure function.
- **Session notice:** "org-os workspace: <name> — /initialize to open a session". Shown once, only when a workspace is detected.
- **Stand-down** (`lib/standdown.mjs`): only relevant when the package loads from a personal (global) install **and** the workspace ships `packages/pi-integration/` itself (that is, the framework repo). The personal copy handles `project_trust`. If trust is granted, it sets `active = false`, and every handler and command checks `active` when called. If trust is declined, it stays active, so there is never a gap without a guard. Spike S2 confirms how Pi treats duplicate command names.
- **Subagent guard enforcement** (`lib/subagents.mjs`): implements whichever mechanism spike S3 selects (see Config). When enforcement can't be established in a vault workspace, a `tool_call` handler for `subagent` blocks with: "subagents are disabled here because the org-os vault guard could not be attached to child sessions."
- **Version check:** a one-line warning at `session_start` when the Pi version is below 0.87.

### `prompts/*.md`

Generated by a new **Pi target in `scripts/sync-commands.mjs`**: `dir: packages/pi-integration/prompts`, frontmatter `description` (plus `argument-hint` when the source uses `$ARGUMENTS`), `keepArguments: true`, and the existing `GENERATED` marker. Stale generated files are removed, following the existing target behaviour.

### `skills/org-os-pi/SKILL.md`

Harness notes the model loads on demand. They cover:

- how superpowers actions map in Pi: "dispatch a subagent" goes to `subagent` if installed, otherwise the work runs sequentially and Pi says so; `TodoWrite` / "track tasks" goes to `todo`
- what is opt-in (`npm run pi:extras`)
- the fact that the vault guard covers bash only, not MCP tools
- a pointer to `docs/integrations/pi.md`

### `profiles/extras.json`

```json
{ "packages": [
  { "source": "npm:pi-subagents@0.71.0",   "why": "subagent tool for superpowers-style delegation" },
  { "source": "npm:pi-mcp-adapter@2.37.0", "why": "MCP client for .pi/mcp.json (Notion, GitHub)" }
] }
```

Only exact versions are allowed. A range, a tag or a missing version is rejected by `pi:extras` and by a test.

### `scripts/pi-extras.mjs` → `npm run pi:extras [-- --dry | --remove | --check]`

- Prints the plan (source, version, why, the target `~/.pi/agent/settings.json`) and asks for confirmation.
- Runs `pi install <source>` for each entry. That's user level, with **no `--local`, ever**.
- Idempotent: already-installed pinned entries are reported and skipped.
- `--remove` runs `pi remove`.
- `--check` compares each pin with `npm view <name> version` and reports, without installing.
- If `pi` is not on PATH, it exits 1 with the install command from pi.dev.

### `scripts/pi-adopt.mjs` → `npm run pi:adopt -- --target <dir> [--ref pi-v0.1] [--dry]`

- Refuses unless `<dir>` passes `findWorkspace`.
- Writes the instance `.pi/settings.json` and `.pi/mcp.json` (see Config), and adds Pi runtime paths to the instance `.gitignore` (spike S6).
- Never overwrites a hand-edited `.pi/settings.json`. It merges org-os keys only, and prints a diff when it would change operator-owned keys.
- Prints the diff and the exact `git add` paths. It never commits or pushes.

### `packages/instance-doctor` check

A new check, `pi-harness`: reports `missing` when there is no `.pi/settings.json`, `behind` when its pinned `pi-v*` ref is older than the framework's latest `pi-v*` tag, and `ok` otherwise. It also shows up in the drift report.

### `VERIFIED.md`

Records the Pi, pi-subagents and pi-mcp-adapter versions actually exercised, the result of each spike, and the acceptance run. It follows the Paper precedent.

## Config

**Framework `.pi/settings.json`** (committed):

```json
{
  "packages": ["../packages/pi-integration"],
  "skills": ["../skills", "!../skills/commands/**"],
  "subagents": { "agentExcludeDirs": [".agents"] }
}
```

**Instance `.pi/settings.json`** (written by `pi:adopt`):

```json
{
  "packages": ["git:github.com/regen-coordination/org-os-template@pi-v0.1"],
  "skills": ["../skills", "!../skills/commands/**"],
  "subagents": { "agentExcludeDirs": [".agents"] }
}
```

**`.pi/mcp.json`** (framework and instances):

```json
{
  "mcpServers": {
    "notion": { "command": "npx", "args": ["-y", "@notionhq/notion-mcp-server@2.5.2"], "env": { "NOTION_TOKEN": "${NOTION_API_KEY}" } },
    "github": { "url": "https://api.githubcopilot.com/mcp/", "headers": { "Authorization": "Bearer ${GITHUB_TOKEN}" } }
  }
}
```

Verified 2026-09-25:

- `@notionhq/notion-mcp-server` 2.5.2 is Notion's official server, and `NOTION_TOKEN` is its recommended auth env. The version is exact-pinned, because `npx` executes third-party code and the extras pinning policy applies.
- `@modelcontextprotocol/server-github` is **deprecated** on npm, so GitHub uses GitHub's hosted MCP endpoint (`github/github-mcp-server` README) with a PAT in the `Authorization` header. There is no local process at all.
- `pi-mcp-adapter` supports `${VAR}` interpolation in `env` and `headers`.
- The org-os `.env` uses `NOTION_API_KEY`, which is why it's mapped to `NOTION_TOKEN`.

**Subagent guard injection.** Candidates, in order of preference. Spike S3 picks the first one proven by a real run:

1. `subagents.defaultSubagentOnlyExtensions` written with an absolute path at runtime. The extension resolves its own `vault-guard.ts` path and supplies it through the pi-subagents settings API or `pi.events`, if one exists.
2. A `tool_call` handler on `subagent` that rewrites the input so every launch carries the guard in `subagentOnlyExtensions` (`tool_call` may mutate input).
3. Neither is provable → the subagent tool is blocked in vault workspaces (see Components).

For the framework repo only, option 1 can be a static relative path in `.pi/settings.json`. Instances cannot use that, because the package lives in Pi's install directory.

## Data flow

- **A lifecycle command:** the operator types `/close`. Pi expands `prompts/close.md` (generated from `.claude/commands/close.md`), and the model follows the same protocol it follows in Claude Code (`skills/org-os-init` Phase 4). Every git call it makes goes through the `bash` tool, and so through the guard.
- **A blocked command:** the model emits `bash("git -c core.pager=cat stash list")`. `vault-guard` sees `tool_call` and spawns the workspace guard with `{tool_name:"Bash", tool_input:{command}}`. The guard exits 2 with its reason, `{block:true, reason}` goes back to Pi, and the model sees the refusal and rephrases.
- **Adoption:** in the framework, `npm run pi:adopt -- --target ../refi-bcn-os` shows the diff, and the operator commits in refi-bcn-os. The next `pi` in refi-bcn-os prompts for trust; Pi clones `org-os-template@pi-v0.1` and loads the extensions, prompts and org-os-pi skill; the instance's own `skills/` load from its settings.

## Error handling

| Failure | Behaviour |
| --- | --- |
| Guard script missing / crashes / times out / exits unexpectedly | **Block** (fail closed) and name the cause. |
| Workspace guard missing | Fall back to the bundled copy silently. The bundled copy missing too → block. |
| `npm run page` fails or the page is unknown | A failed tool result with stderr. `/org` shows the error in the transcript. |
| `scripts/initialize.mjs` fails at session start | The footer omits the task count. No notice spam. |
| Not an org-os workspace | Extension dormant. The guard is active only under `.obsidian`. |
| Pi < 0.87 | One warning line. Continue. |
| Project trust declined | Project resources don't load (Pi's rule). A personal install stays fully active, including the guard. |
| Pinned package unreachable (offline first trust) | Pi's own package error. `instance-doctor` reports `pi-harness: missing`. |
| Subagent guard can't be attached | The `subagent` tool is blocked in vault workspaces with an explanation. |
| Extension factory | Never throws, and never starts processes, timers or watchers (Pi lifecycle rule). Session-scoped work starts in `session_start` and is cleaned up idempotently in `session_shutdown`. |

## Testing

**Unit** (`node --test packages/pi-integration/test/*.test.mjs`, no Pi runtime; the logic lives in `lib/*.mjs`):

- The guard bridge maps exit 2 to a block carrying the guard's stderr, exit 0 to allow, and a missing file, non-zero-non-2 exit or timeout to a block. It builds the payload correctly and covers `bash`, `powershell` and `user_bash`.
- Guard resolution (workspace over bundled) and activation scope (org-os, `.obsidian`, neither).
- The existing `tests/guards/` fixture suite, re-run against the bundled copy, plus a byte-identity drift test.
- `findWorkspace` on fixtures (nested, none, hub-in-vault).
- `org_os_page` truncation and error mapping (with a stubbed runner).
- The todo state logic, including rebuilding from a branch.
- `sync:commands` Pi target: generated bodies equal the sources, `$ARGUMENTS` is kept, the marker is present, stale files are removed, and running it twice is idempotent.
- `pi:extras` rejects non-exact versions and never touches `.pi/settings.json` (fixture HOME).
- `pi:adopt` output against fixture instances: fresh, already adopted, hand-edited.
- Both committed `.pi/settings.json` and `.pi/mcp.json` parse, contain the locked keys, and hold no literal secrets.

**Integration** (`npm run test:pi`, skipped with a clear message when Pi's SDK is not installed):

- Pi's SDK with a **scripted fake model provider** (`pi.registerProvider`) that emits a fixed tool call. That proves a real in-Pi block of `git stash list`, deterministically and with no API keys.
- Extension registration: the `org_os_page`, `todo`, `/org` and `/todos` tools and commands are present, and the prompts from the package are listed.
- The stand-down behaviour (spike S2 fixture).

**Acceptance** (manual, written up in `memory/reports/pi-harness-acceptance-<date>.md` and summarised in `VERIFIED.md`):

1. A clean-room scratch copy of an instance, then `pi:adopt`, then `pi`, then trust. `/initialize` renders the dashboard verbatim.
2. The guard refuses `git stash list` from the model and from `!git stash list`.
3. `/close` writes `memory/YYYY-MM-DD.md`, and the operator approves the commit.
4. `pi:extras` installs both pins. For every built-in pi-subagents agent, a child asked to run `git stash list` inside the vault workspace is **refused**. This is the subagent gate.
5. With `pi-mcp-adapter` installed and `NOTION_API_KEY` set, `/mcp` lists `notion` as lazy, and one read call succeeds.

## Sequencing

1. **Spikes, done first and recorded in `VERIFIED.md`.** Each one has a decision rule, so there are no open questions downstream.
   - S1: Do `.ts` entry points importing `lib/*.mjs` load under Pi's jiti? No → author the entries as `.js` ESM.
   - S2: Duplicate command names across two loaded copies, and the `project_trust` hook. Stand-down works → keep it. It doesn't → document "don't install globally inside the framework repo" and warn at session start.
   - S3: Subagent guard injection. Take the first candidate in Config proven by a real child run. Otherwise block subagents in vault workspaces.
   - S4: Can settings exclude the `.agents/skills/` mirrors, so that `skills/` wins? Yes → exclude them. No → accept Pi's first-wins collision warning, because the mirrors are derived from `skills/` and drift-checked in CI. Also resolve `agentExcludeDirs` paths the same way.
   - S5: A scripted fake provider through the SDK. Works → integration tests as specified. Doesn't → drive `pi --mode rpc` with a fake provider extension loaded via `-e`.
   - S6: Where project-scoped git packages install, so those paths can be gitignored in the framework and by `pi:adopt`.
2. Guard bridge, bundled guard, `sync:pi-guard`, and the guard tests.
3. Workspace detection, `org_os_page`, `/org`, the status footer, the todo tool, the session notice, the version check.
4. The `sync:commands` Pi target and prompts, plus the `org-os-pi` skill.
5. The framework `.pi/settings.json` and `.pi/mcp.json`, the root `pi` manifest, and stand-down.
6. `profiles/extras.json`, `pi:extras`, and subagent guard enforcement (S3 outcome).
7. `pi:adopt` and the `instance-doctor` `pi-harness` check.
8. Docs: new `docs/integrations/pi.md`, a row in the compatibility table in `docs/HOST-INTEGRATION.md`, a Pi section in `docs/TOOL-SETUP.md`, `data/packages-matrix.yaml`, `CHANGELOG.md`, package `README.md`.
9. Integration tests, then the acceptance run, then a PR from `feat/pi-harness` to `main`. The `pi-v0.1` tag is pushed only after the operator approves it, because the tag is what instances pin to.

## Out of scope (named so nobody infers them)

- A headless / RPC / SDK org agent (Buzz digests, drift reports, Telegram) through Pi. Phase 2 at the earliest.
- Publishing to npm and an `@org-os` npm scope.
- Custom Pi subagents (Pi-flavoured Operator / Upstream personas).
- Themes, a custom `SYSTEM.md` / `APPEND_SYSTEM.md`, keybindings.
- Guarding MCP tool calls. `docs/integrations/pi.md` states that the vault guard covers shell execution only.
- Widening the guard's verb list, which stays a separate operator decision per `docs/VAULT-SAFETY.md`.
- Adopting Pi in any instance repo as part of this work. `pi:adopt` exists, and running it against an instance is the operator's per-instance call.
- Replacing `sync:upstream` / fixing the missing shared history between framework and instances (a real problem, recorded, not solved here).

## Constraints honored

- **Vault safety:** the guard is fail-closed and single-sourced, covers operator `!cmd` too, and extends to subagent children or subagents get refused. No step of this work runs stash, clean or reset. The work happens in a separate worktree (`~/.cache/lf-worktrees/pi-harness`).
- **Draft-and-present:** `pi:extras` confirms before installing, `pi:adopt` shows diffs and never commits, and the release tag waits for operator approval.
- **Framework thinking:** it works for any instance and any operator, regardless of git history, through a public pinned git source.
- **Single sources:** commands (`.claude/commands/`), guard (`scripts/guards/`), skills (`skills/`) are never forked by hand. Generators and drift tests keep the copies honest.
- **No third-party executable code by default:** the opt-ins are exact-pinned, installed per operator at user level, and never committed.
