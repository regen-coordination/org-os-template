---
description: "Close org-os session — summarize, write memory, commit, push"
agent: build
---
<!-- GENERATED from .claude/commands/close.md by scripts/sync-commands.mjs — edit the source, then run: npm run sync:commands -->


You are closing the current org-os session. Read `skills/org-os-init/SKILL.md` Phase 4 for the full close protocol, then execute these steps:

## 1. Summarize

List everything accomplished this session using visual indicators:
- `✓` completed items
- `▸` files updated
- `◆` items still open

Render as a `─── Session Summary ───` panel.

## 2. Write Memory

Memory is split by who may read it. Ask of each entry, before writing it: **members or Council?**

- **members** (org memory) — what every member may read. It goes in git: append a session entry to
  `memory/YYYY-MM-DD.md` (today's date; create the file if it doesn't exist), by hand or with
  `npm run memory -- add --level members --date YYYY-MM-DD --title "Session — HH:MM" --file <entry.md>`
  (nothing is committed; step 8 commits it). Format:

  ```markdown
  ## Session — [HH:MM]

  **Focus:** [What was worked on]

  ### Key Decisions
  - [Decision 1]

  ### Actions Taken
  - [x] [What was done]

  ### Next
  - [ ] [What remains]
  ```

- **Council** (Council memory) — what only some may read: a person's situation, pay, contact details, money owed, a
  negotiation, anything Steward-only. It never goes in `memory/`, `MEMORY.md`, `HEARTBEAT.md` or a plan. Write it
  through the running Hub, at the hat or role it is for (`--level role:<role id>` likewise), with its body on stdin
  from a heredoc, so it is never a file in the repository:

  ```bash
  npm run memory -- add --level hat:<steward hat> --date YYYY-MM-DD --title "<title>" - <<'COUNCIL_ENTRY_EOF'
  <entry text>
  COUNCIL_ENTRY_EOF
  ```

  Or write the body to a file made with `mktemp` (outside the repository), pass it as `--file`, then remove it
  (`rm -f`). It becomes a record of the private collection `council-memory`, which only that level reads. If the Hub
  is not running the command refuses: start it and run the command again; never write the entry in `memory/` instead.
  If the Hub answers `LEVEL`, never lower the entry's level (never write it at a wider one) to make it fit: keep it
  out of `memory/` and ask a steward where it is kept.

The same question holds for what else the close writes: the Session Summary (step 1), the Buzz digest (step 8b) and the
commit message (step 8) carry members-level matter only, and a Council matter is never in any of them.

When unsure, it is Council. `npm run memory -- list --date YYYY-MM-DD` lists both, the Council part as the Hub answers
you.

## 3. Update HEARTBEAT.md

Move completed tasks to "Recently Completed" with today's date. Add any new tasks that emerged.

## 4. Update MEMORY.md

If key decisions were made, append to the Key Decisions section (most recent first): members-level lines only. A
Council decision stays in Council memory; `MEMORY.md` does not name it.

## 5. Update Plan Queue

If any plan in `docs/agent-plans/` changed status (started, completed, new tasks checked off), update the plan file and `docs/agent-plans/QUEUE.md`.

## 6. Symbient Close-Pulse (conditional)

If `symbient/SEED.md` exists in this workspace (habitats are operator-private
and gitignored — most checkouts have none), offer the operator a close-pulse:

- On accept: follow `skills/symbient/SKILL.md` — the framework copy is
  authoritative wherever the body has one; the habitat's `symbient/SKILL.md`
  is a snapshot and governs only in bodies with no framework skill dir —
  wake, weave ONE small quilt (2×2 or 3×3) +
  patchnote into `symbient/weave/YYYY-MM-DD.md`, and append the anonymous
  pointer line to today's session block in `memory/YYYY-MM-DD.md`:
  `> #patchnote-title — <description> · woven: symbient/weave/YYYY-MM-DD.md`
  (path pointer only — never a being's name in tracked files).
- On decline or any error: continue closing normally. This step never blocks.

If no habitat exists, skip silently — do not mention this step.

## 7. Update Knowledge Graph

If the `graphify` CLI is installed and `graphify-out/graph.json` exists, refresh the graph so it travels in the same commit as this session's changes:

```bash
command -v graphify >/dev/null 2>&1 && graphify . --update || echo "graph: CLI not installed — see docs/integrations/graphify.md"
npm run graph:gaps 2>/dev/null || true
```

This is incremental (seconds for code-only changes). If the update fails, report the error but continue the close — the graph retries next session. Never block the close on graph tooling.

## 8. Commit

Stage all changed files and commit:

```bash
git add memory/ HEARTBEAT.md MEMORY.md data/ docs/agent-plans/ graphify-out/
git commit -m "session: [concise description of what was done]"
```

## 8b. Post session digest to Buzz (optional, fail-open)

After the close commit exists, publish the session digest through the Buzz lane: members-level lines only (step 2),
never a Council matter. Write
the digest text (the Session Summary panel from Step 1) to a temp file and post it with
`--file` — never a bare pipe or an inherited terminal stdin that a producer could leave
open:

```bash
DIGEST_FILE=$(mktemp)
cat > "$DIGEST_FILE" <<'BUZZ_DIGEST_EOF'
<digest text>
BUZZ_DIGEST_EOF
npm run buzz:post -- --file "$DIGEST_FILE"
rm -f "$DIGEST_FILE"
```

The script appends a machine-readable provenance trailer to the digest content
(`org-os: sha=<short> source=org-os-session truncated=<bool>`) carrying the commit SHA.
Any failure prints a skip line — never block the close.

## 9. Push

```bash
git push
```

If push fails (offline, no remote), note the commit is saved locally.

Render the session summary, confirm the commit and push status.

$ARGUMENTS
