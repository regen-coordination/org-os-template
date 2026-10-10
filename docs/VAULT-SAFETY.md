# Workspace Safety Protocol

**Audience:** Claude Code, Cursor, OpenCode, Hermes, and any other coding agent operating in an org-os workspace. Human operators should also follow it.

> "Vault" in the script names (`vault:snapshot`, `vault:audit`) preserves the original vocabulary from the Obsidian-flavored hub where this protocol was born. The protocol applies to **any org-os workspace** where untracked content is precious — instances with operator-authored memory, daily notes, drafts, planning artifacts, or knowledge bases.

**Why this exists:** an agent once stashed a workspace's untracked content before a merge and never popped it; weeks of notes vanished and a sync tool propagated the deletions to other devices. Recovery took hours. The incident is written up in [the case study](VAULT-SAFETY-CASE-STUDY.md).

**What the tooling covers, and what it does not.** `npm run vault:snapshot` pins the files git already knows about (tracked or staged), including uncommitted edits to them, to a git ref. It does **not** capture untracked files (tested on this version; see "The Safe Pattern" below), so it gives no protection to new notes that were never added to git. What does protect untracked notes today is copying them aside or committing them (see "Protect untracked notes first"). `npm run vault:audit` checks only the content files at the workspace root. The rules below are the real protection; the scripts are a convenience.

This protocol exists so that no agent ever does that again.

---

## The Iron Rules

These apply to **every command that touches the working tree** in any org-os workspace where untracked content matters (instances with `memory/`, daily notes, drafts, etc. — which is most of them):

1. **Never `git stash` in the workspace.** Not `stash push`, not `stash --include-untracked`, not `stash --keep-index`. The workspace's working tree may include 50–90% precious untracked content. Stash hides it; you will forget to pop. Protect untracked notes first (copy aside or commit them, see "Safe Pattern" below), and take a snapshot ref for the tracked files.

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

A risky op is anything that rewrites history or sweeps the working tree: merge, rebase, pull, reset, checkout across diverged branches, clean, stash, or large `git add -A` followed by selective unstaging. `npm run doctor sync` starts with a snapshot made the same way as `vault:snapshot` (so it has the same gap with untracked files); `npm run sync:upstream` refuses to run on a dirty working tree and tells you to snapshot and commit first.

### Protect untracked notes first

The snapshot below does not hold untracked files. Before any risky operation, check `git status --short` for lines starting `??`, then do one of these. Neither depends on the snapshot script:

- copy them aside, outside the working tree, for example `cp -R "memory" "<a folder outside this workspace>/memory-copy"` (adjust to the paths that matter); or
- commit them to a throwaway branch: `git switch -c backup/before-<reason>`, `git add <the untracked paths>`, `git commit -m "backup before <reason>"`, then switch back. A commit is permanent and recoverable from the reflog and the branch.

Only then take the snapshot.

### One command (tracked files)

```bash
npm run vault:snapshot -- "before <reason>"
```

This creates a permanent git ref at `refs/snapshots/<timestamp>-<reason>` (the reason is lower-cased and cut to 60 characters in the ref name) without touching your tree or your stash list. You stay on your current branch with all your edits intact. If git sees no changes to tracked files, the script prints "Working tree clean" and points the ref at `HEAD`.

**Known gap.** The ref points at a commit made by `git stash create`, which records the files git already knows about (tracked, or added to the index) plus your uncommitted edits to them. Untracked files are not in it, although the script passes `-u`. This was tested in a scratch repository on this version: an untracked `untracked.md` was absent from the snapshot tree, and `vault:audit` listed it only as "added". Untracked notes (new daily notes, drafts) are therefore not protected by the snapshot. Commit them, or copy them aside, before a risky operation. The script's own header comment still promises untracked and ignored files; that comment is wrong for the same reason.

**The "Working tree clean" message is false reassurance here.** If your only precious content is untracked (new daily notes, say), git sees no tracked changes, the script prints "Working tree clean" and the ref points at `HEAD`, which holds none of those notes (reproduced in a scratch repository). The message does not mean there is nothing untracked.

The snapshot is recoverable indefinitely via `git ls-tree -r <ref>` and `git cat-file -p`.

### Manual equivalent (if the script is unavailable)

```bash
NAME="refs/snapshots/$(date +%Y%m%d-%H%M%S)-manual"
SNAP=$(git stash create) && git update-ref "$NAME" "$SNAP" && echo "Snapshot saved: $NAME"
```

No output means no ref was made: `create` printed nothing because there were no tracked changes.

`git stash create` (note: **create**, not `push`) writes a stash *object* without modifying your working tree or the stash list. Pinning it with `update-ref` makes it survive `git gc`. Like the script, it leaves untracked files out; the `--include-untracked` flag the earlier version of this page used has no effect on `create`.

### After the risky op — always verify

```bash
npm run vault:audit
```

Compares the content files at the workspace root (`*.md`, `*.canvas`, `*.base`, `*.yaml`, `*.yml`) against the latest snapshot ref, or against a ref you name (`npm run vault:audit -- <ref>`). It exits 1 and lists the files if any are missing, and exits 2 if no snapshot exists. Files in subdirectories such as `memory/` and `data/` are inside the snapshot, but the audit does not compare them, and files that were never in the snapshot (untracked ones) cannot be reported as lost.

---

## Recovery Runbook (when content goes missing)

Check sources in this order. **Do not delete or skip a source until the next one has been confirmed.**

**Every restore command below overwrites its destination silently if the file already exists**, possibly with an older copy. Before restoring, run `ls "<filename>"`. If the file exists, restore to a different name (`> "<filename>.recovered"`), compare the two, and only then replace one with the other.

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

It should report `missing:  0` against the pre-op snapshot. If it doesn't, recover before doing anything else. A clean audit does not prove untracked notes are safe, for the reason given above; check `git status` too.

---

## Encoding gotcha

Many workspace filenames use em-dash `–` (U+2013), accented characters (`á`, `ç`, `ã`, `ñ`), and emoji. When restoring from `git cat-file` or `git ls-tree`, **always quote the destination filename** so the shell preserves UTF-8. Avoid `printf '%b'` decoding — it produces literal `\303\241` filenames. If you see octal escape sequences in `ls`, you wrote files under wrong names; rename or re-restore properly.
