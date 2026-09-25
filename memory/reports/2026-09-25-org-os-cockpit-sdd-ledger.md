# SDD ledger — plan: docs/superpowers/plans/2026-09-25-org-os-cockpit.md

Spec: docs/superpowers/specs/2026-09-25-org-os-cockpit-design.md (binding authority)
Worktree: ~/.cache/lf-worktrees/org-os-cockpit · branch feat/org-os-cockpit · merge base c249ba0
Operator delegated all gates (asleep). No push / merge / tag.

## Pre-flight scan (2026-09-25)

### Cross-task interface rows

| Tasks | Producer → consumer | Finding |
|---|---|---|
| T1 ↔ T6 | harness-kit `findEnclosingWorkspace/isWorkspace/readWorkspaceName` → fleet.ts | consistent (same names, `{root,name}` shape) |
| T1 ↔ T10 | `runGuard(cmd, root)` → Gate default guard | consistent (returns `{allow, reason?}`) |
| T1/T2/T4 | root package.json scripts (`test:harness-kit`, `test:org-state`, `tui`, `tui:install`, `test:tui`) | sequential edits of one file, no overlap |
| T2 ↔ T3 | org-state package.json declares `./index.mjs`, `./read-files.mjs` exports before T3 creates them | harmless (exports resolve lazily) |
| T3 ↔ T7 | `readWorkspaceFiles`, `WATCH_PATHS`, `loadWorkspaceState`, `yamlErrors` → workspace.ts | consistent |
| T3 ↔ T9 | `ROOT_FILES` includes `package.json` → `workspaceScripts(files)` | consistent |
| T5 ↔ all | types.ts (PageRef, Block, WorkspaceInfo, AgentEvent, Command, HOSTS, LIFECYCLE_COMMANDS, LaunchStrategy…) | consistent across T6–T18 |
| T6 ↔ T7,T8,T9,T14,T18 | `makeFleetFixture()` (hub/fw/inst-a/ghost; fw `.claude/commands/close.md`; inst-a HEARTBEAT urgent=2, project "Cockpit") | consumers' expectations match fixture |
| T7 ↔ T8/T14 | `LoadedWorkspace`, `summarize`, `loadWorkspace(info,{now,run,git})` | consistent |
| T8 ↔ T14 | `resolvePage`, `sourceFor`, `FleetRow`, fleet "herdr-agent" target → Cockpit intercept | consistent |
| T10 ↔ T13 ↔ T14 | `GateRequest/GateDecision`, `GateLike`, `Gate({ask,guard,onSettle})` | consistent |
| T11 ↔ T12 | `splitPane/createTab/startAgent/closePane` → launchHost | consistent |
| T11 ↔ T14 | `listAgents/integrationStatus/reportAgent/releaseAgent/reportTitle/notify/runInPane/focusAgent/splitPane` → Cockpit; fakes.ts implements the same subset | consistent |
| T12 ↔ T14 | `launchHost`, `viableStrategies`, `detectLaunchEnv`, `LaunchEnv` | consistent |
| T13 ↔ T14 | `AgentBackend/AgentSession.prompt(text, display?)`, `reduceTranscript` | consistent |
| T14 ↔ T15–T18 | `CockpitSnapshot`, `CockpitLike`, `actions()` | consistent |
| T15 ↔ T16/T17 | routeKey, computeLayout, regionsFor, pageLines/navCount/targetAt/windowFor/selectedLineIndex, transcriptLines, buildEntries/actionEntries/launchEntries/filterEntries, truncate/padLine/displayWidth | consistent |
| T16 ↔ T17 | T16 stubs AgentPane/Palette/Help/PermissionDialog; T17 replaces | **CONFLICT R1** (see below) |
| T16 ↔ T18 | `App` props `{cockpit,onQuit,runForeground?,initialAgentOpen?}` | consistent |
| T4 ↔ T19 | `herdr/scripts/cockpit.sh` → `../../bin/cockpit.mjs` | path resolves to packages/tui/bin |

### Per-task self-consistency rows

| Task | Tests vs code / files | Finding |
|---|---|---|
| T1 | workspace + guard-bridge tests match code (name parsing cases, fail-closed mapping, timeout) | clean |
| T2 | baseline compare notes clock-derived diffs | clean |
| T3 | fixtures ↔ loader expectations (heartbeat sections, decisions separators, funding daysLeft w/ TZ note, ws-bad → 2 yaml errors) | clean |
| T4 | launcher tests use `exists` option present in `findBun` signature | clean |
| T5 | config test expects 2 errors (patched), clamp 1000 | clean |
| T6 | ids hub/fw/inst-a/ghost/side; dedupe of hub path | clean |
| T7 | watcher debounce 200 ms / wait 800 ms; urgent=2 | clean (timing-sensitive; watch in review) |
| T8 | pages incl. herdr agents list | clean |
| T9 | close.md in fw fixture; sync.md missing → error | clean |
| T10 | onSettle added; cancelAll at end of session test | clean |
| T11 | argv table matches client methods | clean |
| T12 | strategy table, agentName rules | clean |
| T13 | Pi faux tests (BLOCKED summary, first user event, retries off via settingsManager) | clean; runtime risk (Pi internals) |
| T14 | fakes subset covers every herdr call Cockpit makes in tests | clean |
| T15 | windowFor formula (patched) matches test | clean |
| T16 | three-column test asserts transcript text "All green." while AgentPane is still a stub | **CONFLICT R1** |
| T17 | typing test uses one tab (patched) | clean |
| T18 | fixture snapshot contains "Grant report"; repo snapshot "Fleet" + "org-os" | clean |
| T19 | Bun TOML import; bash -n | clean |
| T20 | docs edits; validate gates | clean |
| T21 | verification only | clean |

### Rulings

- Ruling: R1 — Task 16's three-column test drops the single assertion `expect(f).toContain("All green.")` (its AgentPane is a stub until Task 17); Task 17's "agent pane shows transcript, model and status" test covers transcript rendering — spec §5.1 requires the agent pane to show the transcript and T17 is where that component is built — cost if wrong: none (coverage retained in T17).

## Task log
- Task 1: dispatched (base b087e03, implementer haiku)
- Task 1: ⚠️ trailer check resolved — Co-Authored-By present on 7db6695
- Task 1: minor (deferred): harness-kit README:96 + test title name "Claude Code" when describing the hook contract — branding rule is scoped to UI labels; docs name the real hook system. Final review to confirm.
- Task 1: minor (deferred): report line-count inconsistency (bookkeeping only)
- Task 1: complete (commits b087e03..7db6695, review clean)
- Task 2: dispatched (base 7db6695, implementer haiku)
- Task 2: controller check — cloudflare-os-integration has 2 failing tests (daysUntil midnight/past-dates, TZ-dependent) at BASE 7db6695 as well as HEAD: pre-existing, not caused by the move. Ruling: out of scope for this plan; surfaced in the final report — cost if wrong: none (unchanged code).
- Task 2: ⚠️ trailer check resolved — present on f8dabf0; pre-existing daysUntil failures confirmed by controller
- Task 2: minor (deferred): org-state README mentions read-files.mjs before Task 3 adds it (self-resolves at Task 3)
- Task 2: complete (commits 7db6695..f8dabf0, review clean)
- Task 3: dispatched (base f8dabf0, implementer haiku)
- Task 3: Ruling: plan-mandated finding (index.mjs omits MEMORY_LIMIT + listProjectFiles re-exports, contradicting the brief's own Interfaces "re-exports all of the above") — fix it: the Interfaces contract binds over the sample code — cost if wrong: none (additive export)
- Task 3: minor (deferred): listProjectFiles untested (no packages/operations/projects fixture); readWorkspaceFiles read-error path untested
- Task 3: fix round 1/5 (1 addressed, 0 open; commits 2fd637e..c89a9a9)
- Task 3: complete (commits f8dabf0..c89a9a9, review clean after fix)
- Task 4: dispatched (base c89a9a9, implementer sonnet)
- Task 4: ⚠️ trailer verified by controller (present on b783439)
- Task 4: minor (deferred): bin/cockpit.mjs child spawn has no "error" listener (TOCTOU → uncaught stack trace); plan-inherited
- Task 4: minor (deferred): npm allow-scripts also lists bun@1.4.2 postinstall (binary works without it here; re-check on fresh clone/other OS)
- Task 4: complete (commits c89a9a9..b783439, review clean)
- Task 5: dispatched (base b783439, implementer haiku)
- Task 5: minor (deferred): implementer report's GREEN evidence was pasted from an unrelated run (reviewer re-ran: 14 pass / 37 expects) — code fine
- Task 5: complete (commits b783439..18db1ed, review clean)
- Ruling: implementers move from haiku to sonnet from Task 6 on — Task 5's haiku report carried fabricated-looking evidence, and the loop depends on trustworthy reports — cost if wrong: higher token spend per task
- Task 6: dispatched (base 18db1ed, implementer sonnet)
- Task 6: minor (deferred): readInstanceRegistry swallows non-ENOENT read errors (EACCES → zero instances, no error); id-collision suffix path untested
- Task 6: complete (commits 18db1ed..3955c3c, review clean)
- Task 7: dispatched (base 3955c3c, implementer sonnet)
- Task 7: minor (deferred): watcher dirs not recursive (Linux misses nested changes; macOS FSEvents masks it); watcher test timing-based but stable 4/4 runs
- Task 7: complete (commits 3955c3c..038fda0, review clean)
- Task 8: dispatched (base 038fda0, implementer sonnet)
- Task 8: Ruling: implementer's commit trailer names Claude Sonnet 5 (its harness attribution) instead of the plan's Opus 5.5 line — accepted as-is, no history rewrite; global-constraints clarified to "your harness's attribution line, else the Opus line" — accurate attribution beats a literal copy — cost if wrong: cosmetic trailer inconsistency across commits
- Task 8: minor (deferred): RESOLVERS/SOURCES object lookups can hit Object.prototype keys (e.g. "constructor") — guard with Object.hasOwn if pages ever accept free text
- Task 8: minor (deferred): no test for resolvePage's resolver-throws → error-notice branch
- Task 8: minor (deferred): this-week's no-state guard duplicates needState (plan-verbatim)
- Task 8: complete (commits 038fda0..8e86f8b, review clean)
- Task 9: dispatched (base 8e86f8b, implementer sonnet)
- Ruling: Task 7's watcher test flaked once (0 callbacks: writes landed before macOS FSEvents stream was live) — schedule a one-file fix after Task 9's review: wait ~150 ms after watchWorkspace() before writing, keep the exactly-1-call assertion — a flaky test would poison Task 21 verification — cost if wrong: 150 ms added to the suite
- Task 9: minor (deferred): actions tests don't assert allow-listed-but-undefined scripts are excluded; runScript truncation + malformed package.json branch untested
- Task 9: complete (commits 8e86f8b..83a5754, review clean)
- Task 7: post-completion flake fix dispatched (base 83a5754, implementer haiku)
- Task 10: dispatched (base 797ae6b, implementer sonnet)
- Task 7: post-completion flake fix complete (commits 83a5754..797ae6b, re-review clean: 5/5 focused runs)
- Task 11: dispatched (base 426213e, implementer sonnet; runs while Task 10 is in review)
- Task 10: minor (deferred): gate.check() lacks an inline comment pinning the guard→read-only→session→ask precedence; no per-tool session revoke
- Task 10: complete (commits 797ae6b..426213e, review clean)
- Task 12: dispatched (base 39c2f85, implementer sonnet; runs while Task 11 is in review)
- Task 11: minor (deferred): integrationStatus() wiring, createTab missing-id path and startAgent 45 s timeout untested (brief-inherited)
- Task 11: complete (commits 426213e..39c2f85, review clean)
- Task 13: dispatched (base 113793e, implementer sonnet; runs while Task 12 is in review)
- Task 12: minor (deferred): agentName can exceed 32 chars past 99 collisions; no paneCols==120 boundary test; closePane cleanup failure swallowed silently
- Task 12: complete (commits 39c2f85..113793e, review clean)
- Task 13: Ruling: Critical (plan-mandated) — DefaultResourceLoader without a settingsManager defaults projectTrusted=true, so untrusted .pi/extensions run in-process outside the gate (reviewer probe confirmed). Fix: mirror Pi CLI trust (hasTrustRequiringProjectResources + ProjectTrustStore), one SettingsManager with projectTrusted shared by loader and session, notice only when untrusted, extraSkillPaths defers to .pi/settings.json only when trusted, test that an untrusted .pi/extensions fixture does NOT run — spec §6.2/T2 "never grants trust" binds over plan code — cost if wrong: none (strictly safer)
- Task 13: Ruling: Important (plan-mandated) — shadow `working` flag races Pi's run state (back-to-back prompt dropped, bogus error/idle). Fix: serialize prompts on an in-flight promise set synchronously; queue follow-ups without emitting status:error; prompt() resolves when the run settles; add back-to-back test — backend.ts contract "resolves when the run settles" — cost if wrong: prompts queue instead of steering mid-run
- Task 13: minor (deferred): abort shown as error notice (stopReason aborted); persistent sessions ignore custom agentDir (pass getDefaultSessionDir(cwd, agentDir)); listener throw/unbounded buffer; pi.test uses repo frameworkRoot (breaks when pi-harness lands); deny test lacks asked/tool_end asserts; no gate-throws test; pending gate prompt not cancelled on abort/dispose
- Task 13: fix round 1/5 (2 addressed, 0 open; commits d5131cf..7281d31)
- Task 13: minor (deferred): prompt serialization drops live mid-run steering (follow-ups queue after the run) — consistent with backend contract; revisit if steering wanted
- Task 13: complete (commits 113793e..7281d31, review clean after fix)
- Task 14: dispatched (base 7281d31, implementer sonnet)
- Task 15: dispatched (base d2cb6e4, implementer sonnet; runs while Task 14 is in review)
- Task 15: minor (deferred): tsc --noEmit not clean package-wide (no @types/bun, no js-yaml types, a workspace.ts type mismatch) — typecheck not in plan; final review to triage
- Task 14: Ruling: Important (plan-mandated) — stop() racing start()/agent open leaves poll interval, watcher, session alive and emits after stop (probe-confirmed) — fix with `stopped` guards after awaits + in startWatch/startPolling/emitState/notice, dispose late-opened sessions — spec §8 lifecycle — cost if wrong: none
- Task 14: Ruling: Important (plan-mandated) — agent-new-session leaves pending approvals; a later "session" answer grants the fresh session (probe-confirmed); no updateReport — fix: deny that workspace's pending requests before resetSession, then updateReport — spec D9 approvals are per session — cost if wrong: operator must re-answer after new session
- Task 14: Ruling: elevate Minor "no local .catch on fire-and-forget calls" to the fix loop — reviewer verified Bun exits on an unhandled rejection; spec §8 "never crash the cockpit" — cost if wrong: a few extra catch handlers
- Task 14: minor (deferred): open-page to unknown workspace skips fleet check; stale uiState spread in saveUiState; idle clock not injectable; untested anchors (poll pause, timeout/cancel clearing, working report, stop teardown, broken registry); reloads can finish out of order; "new" can become "continue" if an open is in flight; `as any` typing in tests
- Task 15: minor (deferred): level→icon ternary repeated in page-model/transcript-view (+ theme color ternary)
- Task 15: complete (commits d2cb6e4..9b0061b, review clean)
- Task 16: dispatched (base 4d04a27, implementer sonnet; carries Ruling R1; runs while Task 14 fix is in re-review)
- Task 14: fix round 1/5 (3 addressed, 0 open; commits 9b0061b..4d04a27)
- Task 14: minor (deferred): late-REJECTING backend.open after stop still calls updateReport → one extra self-caught herdr.reportAgent (no timer/session leak)
- Task 14: complete (commits 7281d31..4d04a27 excl. 9b0061b, review clean after fix)
- Task 16: minor (deferred): AgentPane invocation duplicated (inline vs overlay); `(overlay() as any)` bypasses union narrowing; no App-level test of ctrl+c twice
- Task 16: complete (commits 4d04a27..92c84dd, review clean)
- Task 17: dispatched (base 92c84dd, implementer sonnet)
- Task 17: minor (deferred): tsc flags <input onSubmit> intersection type in AgentPane (runtime fine)
- Task 18: dispatched (base 08efad8, implementer sonnet; runs while Task 17 is in review)
- Task 17: ⚠️ resolved by controller — dialog key-blocking + first-request targeting live in App.tsx (verified in Task 16 review: modal() folds dialogOpen; onAnswer uses permissions[0]) and are exercised by overlays.test "permission dialog…" (j ignored, s → p1 only)
- Task 17: minor (deferred): dialog y/n/esc paths and palette arrow navigation untested
- Task 17: complete (commits 92c84dd..08efad8, review clean)
- Task 19: dispatched (base 755d76d, implementer sonnet; runs while Task 18 is in review)
- Task 20: dispatched (base de0493b, implementer sonnet; runs while Tasks 18/19 are in review)
- Task 18: Ruling: Important (plan-mandated) — quit() latches `quitting` before `await cockpit.stop()`; a throw in stop()/destroy() leaves an unhandled rejection that only posts a notice and every later quit no-ops (exitOnCtrlC false) → hang. Fix: try/catch/finally so renderer.destroy() + process.exit(0) always run — spec §8 never crash / always quittable — cost if wrong: none. Fix queued until Task 20's implementer finishes (no concurrent implementers)
- Task 18: minor (deferred): quit()/error-recovery path untested (interactive); second smoke test doesn't assert empty stderr
- Task 19: Ruling: Important — README keys section wrong vs routeKey (ctrl+a/n/x + tab/shift+tab also live while the agent input is focused) — fix the sentence
- Task 19: Ruling: controller-confirmed gap — README omits the Pi project-trust statement the dispatch required (cockpit never grants trust; .pi/ loads only after trusting in Pi) — add it to Safety — operators need it to understand missing .pi resources — cost if wrong: one paragraph
- Task 19: fix queued until Task 20's implementer finishes
- Task 18: fix round 1/5 (1 addressed, 0 open; commits 2c52888..691e577)
- Task 18: complete (commits 08efad8..755d76d + 691e577, review clean after fix)
- Task 20: minor (deferred, fix in final wave): docs/HOST-INTEGRATION.md top blurb + Standalone row still reference the superseded Ink plan ("Task 12", "npm run tui (interactive Ink)", page retarget to src/modes/print.mjs)
- Task 20: complete (commits de0493b..2c52888, review clean)
- Task 21: dispatched (base f55afd8, implementer sonnet)
- Task 19: fix round 1/5 (2 addressed, 0 open; commits 691e577..f55afd8)
- Task 19: complete (commits 755d76d..de0493b + f55afd8, review clean after fix)
- Task 21: minor (deferred, fix in final wave): bun suite prints 11 MaxListenersExceededWarning (TerminalConsoleCache) from test/ui/overlays.test.tsx — test output not pristine (likely undisposed testRender renderers)
- Task 21: complete (commits f55afd8..85e6021, review clean)
- Final review: dispatched (range c249ba0..85e6021, model fable)
- Final review (fable): Ready to merge WITH FIXES — 0 Critical, 3 Important, 11 Minor; deferred-minor triage: T20 HOST-INTEGRATION + T21 MaxListeners → fix before merge, rest keep deferred
- Ruling: final fix wave = Important 1 (startup notices dropped + mount after full fleet load), Important 2 (ErrorBoundary never resets), Important 3 (README shift+enter/state.json claims; HOST-INTEGRATION stale Ink refs), T21 afterEach renderer destroy, plus minors folded in because they bite daily use or safety: PermissionDialog arming delay (stray keystroke could approve a write), root-dir watch for atomic saves (Obsidian/vim), Object.hasOwn page lookup (--page constructor crash), pane status "blocked" while approval pending, runForeground failure notice, this-week wording, palette "Agent: new session", bus listener errors → no console.error over the renderer — each is small and in files the wave already touches — cost if wrong: a slightly larger fix diff
- Ruling: remaining deferred minors stay deferred per final-review triage (listed in the final report)
- Final fix wave: dispatched (base 85e6021, implementer opus)
- Final fix wave: re-review — all findings ADDRESSED (commits 85e6021..c1f6414); 1 new Minor
- Final: parked — workspace.ts addDir: statSync(…,{throwIfNoEntry:false}) still throws on EACCES/ELOOP/ENOTDIR before the watch try/catch → activation/switch could crash if data/ memory/ docs dirs error on stat — Ruling: real but rare (permission-denied/broken-symlink dir in a workspace); no second fix wave per process; surfaced to the operator as a one-line fix (wrap the stat in the existing try) — cost if wrong: a crash on a pathological workspace
- Final: spec aligned with shipped behaviour (a18c253)
- Final verification (controller): tui 125/125 + launcher 4/4 (no warnings), harness-kit 9/9, org-state 12/12; real-fleet --snapshot (framework = the live org-os checkout, hub = the vault) exit 0 in 1.9 s, 10 workspaces rendered, stderr empty
