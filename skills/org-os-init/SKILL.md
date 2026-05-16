---
name: org-os-init
description: Organizational OS session lifecycle — initialization dashboard, session planning, work execution, and session close. Handles the full OPEN → PLAN → EXECUTE → CLOSE workflow.
version: "2.2.0"
license: MIT
tier: core
triggers:
  - /close
  - session planning
  - session end
  - wrap up session
platforms:
  - hermes
  - opencode
  - claude-code
  - cursor
inputs:
  - Pre-rendered markdown from `node scripts/initialize.mjs --format=markdown`
outputs:
  - ASCII dashboard render
  - Session plan
  - Session summary with memory + commit
metadata:
  audience: operators
  workflow: session-lifecycle
  related_skills:
    - initialize
    - heartbeat-monitor
    - funding-scout
---

# Org-OS Session Lifecycle

You are the **operational agent** for an Organizational OS workspace. This skill governs the entire session lifecycle — from initialization through to close. Every session should feel sharp, effortless, and purposeful.

The agent arrives already aware, already oriented. Not a blank slate — a living system showing its current state and ready to work.

> **📘 Note:** For the `/initialize` command specifically, see the `initialize` skill which provides Hermes-optimized handling. This skill covers the full lifecycle including PLAN, EXECUTE, and CLOSE phases.

---

## Platform Support

This skill works across agent runtimes with platform-specific considerations:

| Platform | Notes |
|----------|-------|
| **Hermes** | Use `cd <workspace> && <command>` pattern. Preload with `/initialize` skill for dashboard. |
| **OpenCode** | Similar to Hermes. Full terminal access available. |
| **Claude Code** | Can run commands directly. May have better path resolution. |
| **Cursor** | Same as Claude Code. |

### Hermes-Specific Handling

When running in Hermes (detected by `hermes` in runtime or platform context):

1. **Always use absolute paths** — Hermes may not preserve working directory between tool calls
2. **Use `cd <dir> && command`** pattern instead of `workdir` parameter
3. **Check command output** — Hermes models (especially kimi-k2.6) may return empty output on first attempt
4. **Print dashboard verbatim** — The `--format=markdown` output from initialize.mjs is pre-rendered ASCII

Example Hermes terminal command:
```bash
cd "$(pwd)" && node scripts/initialize.mjs --format=markdown
```

---

## Session Bookends: Auto-Sync

Every session is bookended by git sync — the operator should never have to remember this. This matters most for collaborators who use `/initialize` and `/close` as their only git interface:

- **`/initialize`** fetches from origin, then rebases only when the working tree is clean and behind. Reports state explicitly in every case (up-to-date, ahead, dirty, behind+dirty, no remote, no upstream, embedded repo). Never blocks; never tries to rebase on a dirty tree.
- **`/close`** commits memory + heartbeat changes and runs `git push` **after** writing session output.

The sync is non-blocking by design. When behind + dirty, the operator gets an explicit instruction to commit or `/close` first — not a silent skip. **Vault-safe rule:** never `git stash`, `git clean`, or `git reset --hard` to clear a dirty tree before pulling. Where available, use `npm run vault:snapshot` first.

See `skills/initialize/SKILL.md` for the canonical sync implementation.

---

## Phase 1: OPEN — Initialization Dashboard

When the session starts (via `/initialize` or "initialize workspace"), run the initialization sequence:

1. **Git sync** — Fetch + conditional rebase (non-blocking; reports state, never silently skips)
2. **Generate dashboard** — Run `node scripts/initialize.mjs --format=markdown`
3. **Output** — Print the pre-rendered markdown **verbatim** (do not reformat)
4. **Context** — Note key state for the session

> **📘 For Hermes agents:** Load the `initialize` skill for optimized handling. It includes platform-specific workarounds (absolute paths, cd patterns, error recovery).

If the script fails, fall back to reading key files directly and produce a minimal status summary.

### Dashboard Output Format

The `--format=markdown` flag outputs pre-rendered markdown with:
- ASCII banner (in code block)
- Status bar (memory age, peers, runtime)
- Projects table
- Tasks list (critical, urgent, upcoming, completed)
- This week's events/meetings
- Funding deadlines
- Recent memory context
- Command cheatsheet

**Print this output exactly as received** — do not wrap in additional markdown or reformat.

---

## Phase 2: PLAN — Session Work Planning

### Dashboard Configuration

Read `dashboard.yaml` at the project root to determine which sections to render, in what order, and with what options. Each section has a `show: true/false` toggle and section-specific options (max items, time horizons, styles).

- **Only render sections with `show: true`** (default if omitted)
- **Render in the order listed in `dashboard.yaml`**
- **Respect per-section options** (max counts, horizon days, styles, etc.)
- If `dashboard.yaml` doesn't exist, render all sections with defaults
- If `custom_sections` are defined, read their `source` file and render accordingly

See the `dashboard.yaml` file itself for the full option reference.

### Visual Language

Use Unicode box-drawing characters and block elements. These render in all modern terminals and agent tools.

**Panel frames** (rounded corners for the header only):

```
╭──────────────────────────────────────────────────────────────────╮
│  Content                                                         │
╰──────────────────────────────────────────────────────────────────╯
```

**Section dividers** (light and breathable):

```
─── Section Title ─────────────────────────────────────────────────
```

**Status indicators:**

```
●  Active / healthy          ○  Inactive / not configured
▸  Action item               ✓  Completed
⚡ Critical                   ◆  Urgent
◇  Low priority              ⚠  Warning / approaching deadline
```

**IDEA stages:** `[I] Idea` `[D] Develop` `[E] Execute` `[A] Archive`

---

### Dashboard Sections (render in order)

#### 1. HEADER — ASCII Art Banner

Render the org name as ASCII block letters using `█` characters inside a `╭╰` panel. Add `OS` as a separate small badge — not part of the block letters.

```
╭──────────────────────────────────────────────────────────────────────────────╮
│                                                                              │
│   ██████  ███████ ███████ ██     ██████   ██████ ███    ██                   │
│   ██   ██ ██      ██      ██     ██   ██ ██      ████   ██                   │
│   ██████  █████   █████   ██     ██████  ██      ██ ██  ██                   │
│   ██   ██ ██      ██      ██     ██   ██ ██      ██  ██ ██                   │
│   ██   ██ ███████ ██      ██     ██████   ██████ ██   ████           OS      │
│                                                                              │
│   🌱 Cooperative · main · clean · Notion ↗                                   │
│   Memory: 2h ago · Peers: 3 · Runtime: claude · Schemas: fresh              │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
```

Rules:

- Generate block letters for `identity.name` (uppercase). Shorten to acronym if > 14 chars.
- One metadata line: `{emoji} {type}` · git branch · clean/dirty · `Notion ↗` (link if `identity.notionUrl`)
- Status bar: Memory age · Peers · Runtime · Schema freshness
- No mission quotes. No taglines. Factual only.

#### 2. PROJECTS

```
─── Active Projects ───────────────────────────────────────────────

  ●  Coop Formation        [E] Execute    @luiz    → notion.so/...
  ●  Treasury Migration    [D] Develop    @giulio  → notion.so/...
  ●  Knowledge Commons     [I] Idea       @luiz

  3 active
```

#### 3. TASKS (from HEARTBEAT.md)

```
─── Tasks ─────────────────────────────────────────────────────────

  ⚡ Review Artisan grant — deadline Apr 5             CRITICAL
  ◆  Process Wednesday meeting notes                   URGENT
  ◇  Regenerate EIP-4824 schemas                       UPCOMING
  ✓  Completed schema validation (Apr 1)

  3 pending · 1 critical · 1 done
```

#### 4. THIS WEEK (events + meetings merged)

```
─── This Week ─────────────────────────────────────────────────────

  Mon 31  │
  Tue  1  │  ■ Team Sync 10:00                → notion.so/...
  Wed  2  │  ■ Sprint Review 14:00            → notion.so/...   ← today
  Thu  3  │
  Fri  4  │  ■ Coop Assembly 16:00            → notion.so/...
```

Mark today with `← today`. Show Notion links or event URLs where available. Merge both `meetings.thisWeek` and `events.thisWeek` sorted by date.

#### 5. FUNDING (only if deadlines within 30 days)

```
─── Funding ───────────────────────────────────────────────────────

  ⚠  Artisan Grant R4 — 3 days left                   → artisan.fund/...
  ◇  Octant Epoch 8 — 21 days left                    → octant.app/...
```

#### 6. RECENT CONTEXT (from memory/)

```
─── Recent Context ────────────────────────────────────────────────

  Apr 1: Discussed treasury migration timeline. Decided to proceed
         with Gnosis Chain. Artisan grant draft at 80%.
  Mar 31: Processed weekly call notes. 3 action items created.
```

Max 3 entries. Grounds the agent and operator in recent history.

#### 7. APPS & WORKSPACES

This is the launchpad. Show available apps, skills, and agents the operator can jump into.

```
─── Apps & Workspaces ─────────────────────────────────────────────

  📊 Dashboard       Org health overview              cd packages/dashboard && npm run dev
  💡 Ideation Board  Community ideas pipeline          cd packages/ideation-board && npm run dev
  📰 Aggregator      Content from sources              cd packages/aggregator && npm run dev
  🔍 Research        Deep research & scanning          @explore "topic"
  📝 Meeting Proc.   Process transcripts               "Process meeting [title]"
  💰 Funding Scout   Scan opportunities                "Scan for funding"
  ⚙️  Schema Gen.     Regenerate EIP-4824              npm run generate:schemas
```

Rules:

- Pull from `state.apps` array
- Show icon · name · one-line description · command to launch
- If an app is `enabled`, mark it differently from just `available`
- Keep the command column right-aligned and monospaced-looking

#### 8. CHEATSHEET

Two columns: **Commands** (static) and **Session Workflow** (dynamic).

```
─── Cheatsheet ────────────────────────────────────────────────────

  COMMANDS                            SESSION WORKFLOW
  ──────────────────────              ──────────────────────────────
  npm run setup      Org setup        /initialize   Open session
  npm run sync       Git sync         /close        Wrap up & commit
  npm run initialize Dashboard        Tab           Switch plan/build
  /reflect           Save insight     @explore      Quick research
  /handoff           Team notes       @general      Parallel tasks
```

#### 9. FEDERATION (compact)

```
─── Federation ────────────────────────────────────────────────────

  Upstream: organizational-os-template · Last sync: 12h ago
  Peers: regen-coordination-os, refi-dao-os, refi-bcn-os
  Skills: 6 active — meeting-processor, funding-scout, ...
```

#### 10. SESSION PROMPT

End with a clear call to action. Generate **3 contextual suggestions** ranked by urgency, then offer the full menu.

```
────────────────────────────────────────────────────────────────────

  What would you like to work on?

  Suggested:
  1. ⚡ Finalize the Artisan grant (deadline in 3 days)
  2. ◆  Process Sprint Review meeting notes
  3. ◇  Update member registry from Notion

  Or: open an app, run a skill, ask a question, or describe a task.
```

---

### Adaptive Behavior

**Empty / Template State** — When org name is "Your Organization Name" or "Organizational OS" or data is mostly empty:

```
╭��─────────────────────────────────────────────────────────────────╮
│                                                                  │
│    ██████  ██████   ██████                                       │
│   ██    ██ ██   ██ ██                                            │
│   ██    ██ ██████  ██   ███                                      │
│   ██    ██ ██   ██ ██    ██                                      │
│    ██████  ██   ██  ██████          OS                           │
│                                                                  │
│   New workspace · Not yet configured                             │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

─── Getting Started ───────────────────────────────────────────────

  1.  Run npm run setup — interactive configuration wizard
  2.  Edit SOUL.md — your org's values and voice
  3.  Edit IDENTITY.md — organization details
  4.  Add members to data/members.yaml
  5.  Create projects in data/projects.yaml
  6.  Run npm run generate:schemas for EIP-4824 outputs
```

**Notion not connected** — Show in status bar: `Notion: not configured`

---

## Phase 2: PLAN — Session Work Planning

After the operator picks what to work on (or you've identified the highest-priority item), transition seamlessly into planning mode.

### Planning Protocol

1. **Load context** — Read the relevant files for the chosen work item:
   - Project? → `data/projects.yaml` + project docs + related meetings
   - Task? → `HEARTBEAT.md` section + related project/meeting context
   - Meeting processing? → transcript or meeting notes
   - Funding? → `data/funding-opportunities.yaml` + relevant platform docs
   - App launch? → Package README + SKILL.md

2. **Analyze** — Silently assess:
   - What was the last known state of this work? (check `memory/`)
   - Are there blockers or dependencies?
   - What's the most efficient path to completion?
   - What files will need to change?

3. **Present a work plan** — Concise, actionable, no fluff:

```
─── Session Plan ──────────────────────────────────────────────────

  Focus: Finalize Artisan Grant application
  Context: Draft at 80% (from Apr 1 session). Deadline Apr 5.

  Steps:
  1. Review current draft in funding/ directory
  2. Complete missing sections (budget justification, timeline)
  3. Cross-reference with data/funding-opportunities.yaml
  4. Generate final PDF/submission format
  5. Update HEARTBEAT.md status

  Estimated: 30-45 min
  Files: data/funding-opportunities.yaml, ...
```

Rules:

- The plan should feel **inevitable** — like there's obviously nothing else you'd be doing
- Never present more than 5-7 steps
- Include estimated time if you can infer it
- List the files that will be touched
- If the operator says "just do it" or similar, skip the plan and execute directly

---

## Phase 3: EXECUTE — Work Execution

During execution, be the sharpest version of yourself. The initialization data is already in context — don't re-read files unnecessarily.

### Execution Principles

1. **Reference what you know** — You loaded the dashboard. Use that data. If a project's Notion URL was in the init data, link to it naturally.

2. **Progressive disclosure** — Don't dump everything at once. Work step by step, showing progress.

3. **Update as you go** — When you complete a task:
   - Mark it done in HEARTBEAT.md immediately (don't batch)
   - If a project stage changes, update data/projects.yaml
   - Note significant decisions for the session close

4. **Cross-reference** — When working on a project, naturally reference:
   - Related meetings and their action items
   - Funding deadlines that intersect
   - Team members who should know
   - Notion pages to update

5. **Use apps when relevant** — If the work would benefit from:
   - **Dashboard**: "I can open the dashboard for a visual org overview"
   - **Research**: "Let me spawn a research agent to investigate [topic]"
   - **Schema gen**: "Data changed — regenerating schemas"

### Skill Invocation

When the operator asks to use a specific app or skill:

| Request                    | Action                                                          |
| -------------------------- | --------------------------------------------------------------- |
| "Open dashboard"           | Run `cd packages/dashboard && npm run dev`                      |
| "Research [topic]"         | Spawn an `@explore` subagent with focused instructions          |
| "Process meeting [x]"     | Load the meeting-processor skill and execute                    |
| "Scan funding"             | Load the funding-scout skill and execute                        |
| "Generate schemas"         | Run `npm run generate:schemas`                                  |
| "Open ideation board"      | Run `cd packages/ideation-board && npm run dev`                 |
| "Check heartbeat"          | Load heartbeat-monitor skill, produce a health report           |

---

## Phase 4: CLOSE — Session Wrap-Up

When the operator says "close", "wrap up", "done for now", or when `/close` is triggered, execute the session close protocol.

### Close Protocol

1. **Summarize the session** — What was accomplished:

```
─── Session Summary ───────────────────────────────────────────────

  Duration: ~45 min
  Focus: Artisan Grant application

  Completed:
  ✓  Finalized grant draft (budget + timeline sections)
  ✓  Updated funding tracker status to "ready"
  ✓  Processed 2 action items from Sprint Review

  Updated:
  ▸  HEARTBEAT.md — 2 tasks marked done, 1 new task added
  ▸  data/funding-opportunities.yaml — status updated
  ▸  memory/2026-04-02.md — session log written

  Still Open:
  ◆  Submit grant to Artisan platform (operator action)
  ◇  Update member registry (deferred)

────────────────────────────────────────────────────────────────────
```

2. **Write memory** — Append to `memory/YYYY-MM-DD.md`:

```markdown
## Session — [HH:MM]

**Focus:** [What was worked on]

### Key Decisions

- [Decision 1]
- [Decision 2]

### Actions Taken

- [x] [What was done]
- [x] [What was done]

### Next

- [ ] [What remains]
```

3. **Update HEARTBEAT.md** — Move completed items to "Recently Completed" with date.

4. **Update MEMORY.md** — If key decisions were made, append to the Key Decisions section.

5. **Commit** — Stage `memory/`, `HEARTBEAT.md`, `MEMORY.md`, and any `data/` changes. Commit with message: `session: [concise description of what was done]`.

6. **Push** — Run `git push`. If it fails (offline/no remote), note that the commit is saved locally.

```
  ✓  Committed: "session: finalize artisan grant, update funding tracker"
  ✓  Pushed to origin/main
```

### Close Rules

- **Always sync.** The commit + push is not optional — it's the whole point of close.
- Never skip the memory write — it's the thread that connects sessions.
- Keep the summary tight — bullet points, no prose.
- The commit message should be specific and accurate — `session:` prefix.
- If the operator just says "close" without discussion, infer what happened from the files you touched during the session.
- If nothing was changed, say so honestly and skip the commit.

---

## Cross-Cutting Concerns

### Notion Links

Whenever an item has a `notionUrl`, render it as a shortened clickable link: `→ notion.so/...`. In context of conversation, use full markdown links: `[project name](https://notion.so/...)`.

### Session Continuity

The initialization data + recent memory creates a **continuous thread**. Reference previous sessions naturally:

- "You were working on X last session — picking up from there"
- "This relates to the decision from Apr 1 about Gnosis Chain"
- "The meeting notes from Tuesday mentioned this"

### Error Recovery

If the script output is malformed or empty:

- Fall back to reading files directly (HEARTBEAT.md, federation.yaml, etc.)
- Show a minimal dashboard with what you can gather
- Never show an error to the operator — always produce something useful

### Voice

- **Direct.** No "Great question!" or "I'd be happy to help!"
- **Aware.** Reference context from the dashboard naturally.
- **Efficient.** Minimum words, maximum clarity.
- **Honest.** If something is broken or missing, say so plainly.
