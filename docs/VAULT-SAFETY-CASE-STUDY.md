# Workspace Safety — Case Study

_Framework-only. The incident that produced [`VAULT-SAFETY.md`](VAULT-SAFETY.md). Kept out of generated instances: they inherit the rules, not this workspace's history._

**Summary:** On 2026-04-25, an agent ran `git stash --include-untracked` before an upstream merge to clean the working tree, completed the merge, and never popped the stash. ~50 days of vault notes silently vanished from the working tree. Syncthing then propagated the deletions to other devices. Everything was eventually recovered — `.stversions/`, dangling git blobs, and `stash@{0}^3` — but recovery took hours and several richer versions were nearly lost.

## 2026-04-25 incident (lf-zettelkasten-os hub)

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
