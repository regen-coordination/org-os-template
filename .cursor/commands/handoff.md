---
description: "Generate a compact handoff prompt — sync an operator's trunk, point them at a doc/section (or task) to work on, commit to their trunk, PR to main. Use when the user types /handoff or says \"hand this to <operator>\", \"make a handoff prompt\"."
---
<!-- GENERATED from .claude/commands/handoff.md by scripts/sync-commands.mjs — edit the source, then run: npm run sync:commands -->


You are generating a **handoff prompt** — a compact, copy-paste brief another operator pastes into THEIR clone of this org-os instance (any agent/editor) to pick up a piece of work. It self-syncs their trunk with plain git (no dependency on `/sync` existing), points them at the target, and ends with a clean trunk→`main` PR.

The output is the deliverable. Keep it minimal.

## Step 1: Parse the ask

`$ARGUMENTS` = `<operator> <target> [the ask…]`
- **operator → trunk:** resolve the operator's trunk slug from the instance's operator roster (`data/members.yaml`, or the trunk branches on the remote: `git branch -r`). If ambiguous, ask which trunk.
- **target:** a repo doc (`docs/SOME-DOC.md` or a bare filename, optionally a `§N`/heading) **or** a task id (`task-…`, resolve from `data/tasks.yaml`).
- **the ask:** the rest — one clause naming the concrete deliverable. If absent, infer from the target; if still unclear, ask ONE question. Don't over-ask.

## Step 2: Resolve link + trunk

- **Live link:** derive the repo's web URL from `git remote get-url origin` → `https://github.com/<org>/<repo>/blob/main/<docpath>` (append `#<anchor>` only if confident it resolves; otherwise name the section inside the ask). For a task, link the same repo path to `data/tasks.yaml` and cite the id.
- Confirm the trunk slug from Step 1.

## Step 3: Emit the prompt (a single paragraph the operator pastes into their instance)

The prompt is an **instruction to THEIR agent** (Claude Code / OpenCode / Cursor / Zed) — natural language; the agent does the git sync, the edits, and the PR. Output ONLY this filled template in a code block, nothing else:

```
In <REPO-NAME>: sync my `<TRUNK>` trunk with `main` — fetch, switch to <TRUNK>, merge `origin/main` (fast-forward if possible, else a merge commit), push. Then open <LINK> and <ASK>. Commit to <TRUNK> and open a PR to `main`.
```

Rules:
- One paragraph, no shell fences — the agent decides the exact commands.
- `<ASK>` = section (`§N`) + the concrete deliverable, one clause.
- If the target operator's trunk is far-behind/messy (e.g. a committed venv), extend the sync clause in-line: `(if it conflicts, keep origin/main for shared files; if a venv is tracked, untrack it + gitignore)`.

**Why it's portable:** the sync is described as plain git, so the agent runs it identically regardless of which slash-commands that clone has. After it, the operator's trunk ⊇ `main`, so their PR merges cleanly — and for a badly-behind trunk it doubles as the catch-up.

## Radicle-canonical variant

Everything above is the **github-canonical (default)** path — unchanged. If `federation.yaml` has `platforms.canonical: radicle`, branch instead:

- **Step 2 (resolve link):** the doc link comes from `driver.webUrl(rid, path)` — an `app.radicle.xyz/nodes/<seed>/<rid>/tree/<ref>/<path>` URL — instead of deriving `https://github.com/<org>/<repo>/blob/main/<docpath>` from `git remote get-url origin`. `rid` is `federation.yaml identity.rid` (or the target instance's `data/instances.yaml` `rid` field).
- **Step 3 (emit the prompt):** the paste-prompt's sync clause becomes `rad clone <rid>` (first time) or `rad sync` + pull from the canonical branch (already have it) instead of `fetch`/`merge origin/main`; the PR-to-main close reads as opening a **patch** — `git push rad HEAD:refs/patches` — against the identity-threshold-governed main, not a GitHub PR.
