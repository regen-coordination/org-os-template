# packages/tui — VERIFIED

Facts this package relies on, each checked by running code (not by reading docs alone).

## Spikes — 2026-09-25 (Bun 1.4.2 local, macOS arm64)

| Spike | Result | Decision |
|---|---|---|
| T0 runtime | `@opentui/solid@0.5.12` `testRender` + `captureCharFrame` pass under `bun test`; `@earendil-works/pi-coding-agent@0.87.1` imports and runs a session under Bun | **Bun** is the runtime (local devDependency `bun@1.4.2`). Node 26.4 path not needed. |
| T1 OpenTUI | Elements `box text input textarea select scrollbox code diff markdown …`; hooks `useKeyboard`, `useTerminalDimensions`, `useRenderer`; `renderer.suspend()/resume()`; test `mockInput.pressKey(key, {ctrl})`, `typeText`, `pressEnter`, `waitForFrame`. **`useKeyboard` also receives keys while an `<input>` is focused** → the app routes keys by focus (`ui/keys.ts`). `<markdown>` renders nothing without a tree-sitter style in tests → the cockpit renders markdown itself (`core/markdown.ts`). | as stated |
| T2 Pi embedding | `DefaultResourceLoader({cwd, agentDir, extensionFactories, additionalExtensionPaths, additionalSkillPaths})` + `reload()`; inline factory `pi.on("tool_call", e => ({block:true, reason}))` blocks — result arrives as `tool_execution_end` with `isError: true` and the reason as text; the model continues. Faux provider: `fauxProvider()` from `@earendil-works/pi-ai/providers/faux` registered via `pi.registerProvider(faux.provider)`; `SessionManager.inMemory/create/continueRecent(cwd)`. Session events: `agent_start turn_start message_start message_update message_end tool_execution_start tool_execution_end turn_end agent_end agent_settled`. | as stated; the tool_call handler is the gate. Project `.pi/` trust is **not** granted by the cockpit — Pi's own trust store decides; the cockpit shows a notice. |
| T3 herdr shapes | From `herdr api schema` (protocol 22): envelope `{id, result: {type, …}}`; `agent_list → agents[]` of `AgentInfo{pane_id, workspace_id, cwd, foreground_cwd, agent, display_agent, agent_status, name, title}`; `pane split → pane_info.pane`; `tab create → tab_created.root_pane`; `agent start → agent_started.agent`. Never probed against the live session. | CLI JSON transport, polling. |
| T4 Ghostty | Ghostty 1.3.1 help: on macOS the CLI cannot launch the app; use `open -na Ghostty.app --args --working-directory=<dir> -e <cmd>`. | launch strategy 4 as stated |

## Acceptance (operator, pending)

To be filled after the operator's first run inside herdr — see README "Acceptance".

## Build verification — 2026-09-25 04:45 -03

| Gate | Result |
|---|---|
| harness-kit tests | 9 pass |
| org-state tests | 12 pass |
| cloudflare-os-integration tests (via shims) | 84 pass / 2 fail (pre-existing, TZ-dependent, fail identically at the base commit) |
| tui tests (bun + launcher) | 112 pass (108 bun + 4 launcher) |
| root `npm test` | 582 pass |
| validate:schemas / validate:structure | pass / pass |
| `npm run page` × 7 | ok |
| `--snapshot` fleet 160×40 / dashboard 80×24 | exit 0 / exit 0 |

Not verified here (needs the operator): live herdr (plugin link, launch into splits, report-agent, notifications), a real Pi provider turn, `claude` launched with Max login, the acceptance list in README §10.
