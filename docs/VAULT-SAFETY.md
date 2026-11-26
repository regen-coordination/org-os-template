# Workspace Safety Protocol

**Audience:** Claude Code, Cursor, OpenCode, Hermes, and any other coding agent operating in an org-os workspace. Human operators should also follow it.

> "Vault" in the script names (`vault:snapshot`, `vault:audit`) preserves the original vocabulary from the Obsidian-flavored hub where this protocol was born. The protocol applies to **any org-os workspace** where untracked content is precious — instances with operator-authored memory, daily notes, drafts, planning artifacts, or knowledge bases.

**Why this exists:** an agent once stashed a workspace's untracked content before a merge and never popped it; weeks of notes vanished and a sync tool propagated the deletions to other devices. Recovery took hours. The incident is written up in [the case study](VAULT-SAFETY-CASE-STUDY.md).

**What the tooling covers, and what it does not.** `npm run vault:snapshot` pins the working tree to a git ref: tracked files with their uncommitted edits, and untracked files. It does **not** capture gitignored files. Before 0.7.4 it captured the tracked tree only, so a snapshot ref made before then gives no protection to new notes that were never added to git (see "The Safe Pattern" below). `npm run vault:audit` checks only the content files at the workspace root. The rules below are the real protection; the scripts are a convenience.

This protocol exists so that no agent ever does that again.

---

## The Iron Rules

These apply to **every command that touches the working tree** in any org-os workspace where untracked content matters (instances with `memory/`, daily notes, drafts, etc. — which is most of them):

1. **Never `git stash` in the workspace.** Not `stash push`, not `stash --include-untracked`, not `stash --keep-index`. The workspace's working tree may include 50–90% precious untracked content. Stash hides it; you will forget to pop. Take a snapshot ref instead (see "Safe Pattern" below).

2. **Never `git clean` in the workspace.** Not `clean -fd`, not `clean -fdx`, not `clean -i`. Those untracked files are content, not build artifacts.

3. **Never `git reset --hard` while the working tree has uncommitted content.** Snapshot first.

4. **Never `git checkout -- <path>` or `git restore <path>` without first confirming the file is reproducible.** It overwrites local edits silently.

5. **Never delete or `mv` files under `memory/`, `data/`, or root markdown files (`*.md`, `*.canvas`, `*.base`)** without explicit user confirmation. That includes "cleanup" passes and "let me archive this".

6. **Never run any of the above on submodules or nested instance repos either.** They are separate repos but share the same content-preservation rule.

7. **`--no-verify` is forbidden** unless the user explicitly authorizes it for a specific commit.

8. **If you find existing stashes** (`git stash list` shows entries), do **not** drop them. They are forensic evidence. Ask before touching.

If a workflow seems to require breaking one of these rules, stop and ask.

---

## The Safe Pattern (use this before any risky op)

A risky op is anything that rewrites history or sweeps the working tree: merge, rebase, pull, reset, checkout across diverged branches, clean, stash, or large `git add -A` followed by selective unstaging. `npm run doctor sync` starts with a snapshot made the same way as `vault:snapshot`; `npm run sync:upstream` refuses to run on a dirty working tree and tells you to snapshot and commit first.

### Protect gitignored content first

The snapshot below holds tracked and untracked files, but not gitignored ones. If something precious sits in a gitignored path (a private folder, local state), do one of these before any risky operation. Neither depends on the snapshot script:

- copy it aside, outside the working tree, for example `cp -R "private" "<a folder outside this workspace>/private-copy"` (adjust to the paths that matter); or
- for content that may be committed, commit it to a throwaway branch: `git switch -c backup/before-<reason>`, `git add -f <the paths>`, `git commit -m "backup before <reason>"`, then switch back. A commit is permanent and recoverable from the reflog and the branch.

Only then take the snapshot.

### One command

```bash
npm run vault:snapshot -- "before <reason>"
```

This creates a permanent git ref at `refs/snapshots/<timestamp>-<reason>` (the reason is lower-cased and cut to 60 characters in the ref name) capturing the working tree (tracked + untracked; gitignored files are not captured), without touching your tree, your index or your stash list. You stay on your current branch with all your edits intact. The snapshot is recoverable indefinitely via `git ls-tree -r <ref>` and `git cat-file -p`.

### Manual equivalent (if the script is unavailable)

```bash
TMPIDX=$(mktemp) && rm "$TMPIDX" && \
  GIT_INDEX_FILE="$TMPIDX" git read-tree HEAD && \
  GIT_INDEX_FILE="$TMPIDX" git add -A -- . && \
  TREE=$(GIT_INDEX_FILE="$TMPIDX" git write-tree) && \
  SNAP=$(git commit-tree "$TREE" -p HEAD -m "vault-snapshot: manual") && \
  REF="refs/snapshots/$(date +%Y%m%d-%H%M%S)-manual" && \
  git update-ref "$REF" "$SNAP" && rm -f "$TMPIDX" && \
  echo "Snapshot saved: $REF"
```

This stages the whole working tree into a throwaway index (`GIT_INDEX_FILE`), writes it as a tree and wraps it in a commit on `HEAD`. Your real index, working tree and stash list are never touched. Pinning it with `update-ref` makes it survive `git gc`.

Do **not** use `git stash create --include-untracked` (or `-u`) for this: `stash create` takes no options, so the flag becomes part of the message and no untracked file is captured. Until 2026-11-07 both this pattern and the script did exactly that, so every snapshot ref made before that date holds the tracked tree only. `doctor sync`'s own snapshot stage made the same call until 2026-11-08, so its `refs/snapshots/*-doctor-sync` refs from before then hold the tracked tree only too.

### After the risky op — always verify

```bash
npm run vault:audit
```

Compares the content files at the workspace root (`*.md`, `*.canvas`, `*.base`, `*.yaml`, `*.yml`) against the latest snapshot ref, or against a ref you name (`npm run vault:audit -- <ref>`). It exits 1 and lists the files if any are missing, and exits 2 if no snapshot exists. Files in subdirectories such as `memory/` and `data/` are inside the snapshot, but the audit does not compare them, and files that were never in the snapshot (gitignored ones, or untracked ones in a snapshot made before 0.7.4) cannot be reported as lost.

---

## Recovery Runbook (when content goes missing)

Check sources in this order. **Do not delete or skip a source until the next one has been confirmed.**

**Every restore command below overwrites its destination silently if the file already exists**, possibly with an older copy. Before restoring, run `ls "<filename>"`. If the file exists, restore to a different name (`> "<filename>.recovered"`), compare the two, and only then replace one with the other.

### 1. Snapshot refs (created by `npm run vault:snapshot`)

```bash
git for-each-ref refs/snapshots/   # list all snapshots
git ls-tree -r <snapshot-ref>      # see contents of one
```

Snapshots made before 2026-11-07 hold tracked files only (see the note under "Manual equivalent"); for untracked notes lost before then, go straight to sources 2–4.

Restore one file:
```bash
git cat-file -p <snapshot-ref>:"<filename>" > "<filename>"
```

### 2. Stash trees (especially `^3` for untracked content)

This applies only when someone ran `git stash push`; snapshot refs from `vault:snapshot` have no `^3` parent.

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

When a commit gets orphaned (rebase, reset, dropped stash) its blobs become unreachable but stay in the object database for about 14 days by default (git's `gc.pruneExpire`; it is not a guarantee).

```bash
git fsck --unreachable --no-reflogs > "<a path outside the workspace>/unreachable-blobs.txt"
# search blobs by content
while read kind type hash; do
  [ "$kind" = "unreachable" ] && [ "$type" = "blob" ] && \
    git cat-file -p "$hash" 2>/dev/null | grep -q "<unique content marker>" && \
    echo "$hash"
done < "<a path outside the workspace>/unreachable-blobs.txt"
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

Only if your agent tool keeps worktrees there; this repository has no `.claude/worktrees/` directory.

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

It should report `missing:  0` against the pre-op snapshot. If it doesn't, recover before doing anything else. A clean audit compares only the content files at the workspace root; check `git status` too.

---

## Encoding gotcha

Many workspace filenames use em-dash `–` (U+2013), accented characters (`á`, `ç`, `ã`, `ñ`), and emoji. When restoring from `git cat-file` or `git ls-tree`, **always quote the destination filename** so the shell preserves UTF-8. Avoid `printf '%b'` decoding — it produces literal `\303\241` filenames. If you see octal escape sequences in `ls`, you wrote files under wrong names; rename or re-restore properly.
