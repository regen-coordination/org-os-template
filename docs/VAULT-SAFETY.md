# Workspace Safety Protocol

**Audience:** Claude Code, Cursor, OpenCode, Hermes, and any other coding agent operating in an org-os workspace. Human operators should also follow it.

> "Vault" in the script names (`vault:snapshot`, `vault:audit`) preserves the original vocabulary from the Obsidian-flavored hub where this protocol was born. The protocol applies to **any org-os workspace** where untracked content is precious — instances with operator-authored memory, daily notes, drafts, planning artifacts, or knowledge bases.

**Why this exists:** On 2026-04-25, an agent ran `git stash --include-untracked` before an upstream merge to clean the working tree, completed the merge, and never popped the stash. ~50 days of vault notes silently vanished from the working tree. Syncthing then propagated the deletions to other devices. Everything was eventually recovered — `.stversions/`, dangling git blobs, and `stash@{0}^3` — but recovery took hours and several richer versions were nearly lost.

This protocol exists so that no agent ever does that again.

---

## The Iron Rules

These apply to **every command that touches the working tree** in any org-os workspace where untracked content matters (instances with `memory/`, daily notes, drafts, etc. — which is most of them):

1. **Never `git stash` in the workspace.** Not `stash push`, not `stash --include-untracked`, not `stash --keep-index`. The workspace's working tree may include 50–90% precious untracked content. Stash hides it; you will forget to pop. Use a snapshot ref instead (see "Safe Pattern" below).

2. **Never `git clean` in the workspace.** Not `clean -fd`, not `clean -fdx`, not `clean -i`. Those untracked files are content, not build artifacts.

3. **Never `git reset --hard` while the working tree has uncommitted content.** Snapshot first.

4. **Never `git checkout -- <path>` or `git restore <path>` without first confirming the file is reproducible.** It overwrites local edits silently.

5. **Never delete or `mv` files under `memory/`, `data/`, or root markdown files (`*.md`, `*.canvas`, `*.base`)** without explicit user confirmation. That includes "cleanup" passes and "let me archive this".

6. **Never run any of the above on submodules either.** Org instances under `03 Libraries/*-os/` (or wherever instances live) are separate repos but share the same content-preservation rule.

7. **`--no-verify` is forbidden** unless the user explicitly authorizes it for a specific commit.

8. **If you find existing stashes** (`git stash list` shows entries), do **not** drop them. They are forensic evidence. Ask before touching.

If a workflow seems to require breaking one of these rules, stop and ask.

---

## The Safe Pattern (use this before any risky op)

A risky op is anything that rewrites history or sweeps the working tree: merge, rebase, pull, reset, checkout across diverged branches, clean, stash, or large `git add -A` followed by selective unstaging.

### One command (preferred)

```bash
npm run vault:snapshot -- "before <reason>"
```

This creates a permanent git ref at `refs/snapshots/<timestamp>-<reason>` capturing the entire working tree (tracked + untracked + ignored-but-present), without touching your tree. You stay on your current branch with all your edits intact. The snapshot is recoverable indefinitely via `git show refs/snapshots/<name>`.

### Manual equivalent (if the script is unavailable)

```bash
SNAP=$(git stash create --include-untracked) && \
  git update-ref "refs/snapshots/$(date +%Y%m%d-%H%M%S)-manual" "$SNAP" && \
  echo "Snapshot saved: refs/snapshots/$(date +%Y%m%d-%H%M%S)-manual"
```

`git stash create` (note: **create**, not `push`) writes a stash *object* without modifying your working tree or the stash list. Pinning it with `update-ref` makes it survive `git gc`.

### After the risky op — always verify

```bash
npm run vault:audit
```

Compares current root-level content count against the latest snapshot. Loud failure (exit 1) if any file is missing.

---

## Recovery Runbook (when content goes missing)

Check sources in this order. **Do not delete or skip a source until the next one has been confirmed.**

### 1. Snapshot refs (created by `npm run vault:snapshot`)

```bash
git for-each-ref refs/snapshots/   # list all snapshots
git ls-tree -r <snapshot-ref>      # see contents of one
```

Restore one file:
```bash
git cat-file -p <snapshot-ref>:"<filename>" > "<filename>"
```

### 2. Stash trees (especially `^3` for untracked content)

```bash
git stash list
git ls-tree "stash@{0}^3"       # untracked files in stash 0
git ls-tree "stash@{0}^2"       # work tree (modified tracked)
git ls-tree "stash@{0}^"        # index
```

Restore one file from a stash:
```bash
git cat-file -p "stash@{0}^3":"<filename>" > "<filename>"
```

### 3. Sync-tool version history (if applicable)

Syncthing's `.stversions/` at the workspace root holds time-stamped copies of files that were modified or deleted locally. Filenames are `{name}~YYYYMMDD-HHMMSS.md`.

```bash
ls .stversions/ | grep "<date-prefix>"    # find versions of a note
cp ".stversions/<name>~<ts>.md" "<name>"  # restore
```

The newest stversion is usually best, but verify content — if the loss propagated from another peer, the freshest stversion may be older than what was on disk at deletion.

### 4. Dangling git blobs (`git fsck`)

When a commit gets orphaned (rebase, reset, dropped stash) its blobs become unreachable but stay in the object database for ~14 days.

```bash
git fsck --unreachable --no-reflogs > /tmp/blobs.txt
# search blobs by content
while read kind type hash; do
  [ "$kind" = "unreachable" ] && [ "$type" = "blob" ] && \
    git cat-file -p "$hash" 2>/dev/null | grep -q "<unique content marker>" && \
    echo "$hash"
done < /tmp/blobs.txt
```

Dump a blob:
```bash
git cat-file -p <hash> > "<filename>"
```

### 5. Reflog

```bash
git reflog --date=iso       # local branch history
git reflog show stash       # stash history (deleted entries still recoverable here)
```

### 6. Agent worktrees

```bash
ls .claude/worktrees/                                    # snapshots from prior agent sessions
find .claude/worktrees -maxdepth 3 -name "<filename>"
```

### 7. OS-level backups (last resort)

```bash
mdfind -name "<filename>"                  # macOS Spotlight index
tmutil listbackups                         # macOS Time Machine (if configured)
ls ~/.Trash/                               # macOS trash
```

---

## What "Safe" Looks Like (acceptance check)

Before you claim a risky op is complete, run:

```bash
npm run vault:audit
```

It should report **0 missing files vs. the pre-op snapshot**. If it doesn't, recover before doing anything else.

---

## Encoding gotcha

Many workspace filenames use em-dash `–` (U+2013), accented characters (`á`, `ç`, `ã`, `ñ`), and emoji. When restoring from `git cat-file` or `git ls-tree`, **always quote the destination filename** so the shell preserves UTF-8. Avoid `printf '%b'` decoding — it produces literal `\303\241` filenames. If you see octal escape sequences in `ls`, you wrote files under wrong names; rename or re-restore properly.

---

## Case study — 2026-04-25 incident (lf-zettelkasten-os hub)

**Trigger:** A session ran `git stash push --include-untracked -m "WIP changes before upstream merge"` to clean the tree before pulling upstream `org-os` changes.

**Damage:** ~50 untracked notes (daily/weekly/meeting/planning, dating back to March) disappeared from the working tree. Syncthing detected the local deletions and:
- saved old snapshots into `.stversions/` (incomplete — Syncthing's last snapshot per file was from 1–24 hours before the stash);
- propagated deletions to other Syncthing peers, also wiping them on those devices.

**Why it wasn't caught immediately:** the merge succeeded with no conflicts; the agent reported success and ended the session. The user noticed only when opening Obsidian and seeing broken wikilinks.

**Recovery:**
- 6 notes from `.stversions/` (partial — older than disk state at deletion).
- 4 notes from `git fsck --unreachable` dangling blobs (draft versions).
- 43 full notes from `stash@{0}^3` (authoritative — actual pre-merge state).

**Lesson:** the rule "never stash" was already in memory, but a brand-new session didn't read it before deciding to stash. Memory is best-effort; **`docs/VAULT-SAFETY.md` and the project's `CLAUDE.md` / `AGENTS.md` are guaranteed to be in every session's context**. That's why this protocol now lives in framework documentation, propagated to every instance.
