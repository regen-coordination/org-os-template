---
name: sync
description: "Vault-safe sync — fetch, fast-forward your operator trunk, report drift vs main. Never stashes. Use when the user types /sync or says \"sync\", \"pull latest\", \"catch up with the team\"."
---
<!-- GENERATED from .claude/commands/sync.md by scripts/sync-commands.mjs — edit the source, then run: npm run sync:commands -->


You are syncing this org-os clone with the shared remote. **Vault-safe: NEVER `git stash`, `git clean`, or `git reset --hard`.** Only ever fast-forward; never run an unattended merge/rebase that could rewrite many notes.

## Step 1: Read state

```bash
git rev-parse --abbrev-ref HEAD                 # current branch
git fetch --quiet origin 2>/dev/null && echo "fetched" || echo "offline — local state only"
git status --porcelain | wc -l                  # uncommitted file count
```

## Step 2: Branch logic

- **On `main`** → `main` is integration-only. Tell the operator to switch to their trunk (`git switch <operator>`; their operator slug). Don't pull onto main here.
- **No upstream** (`git rev-parse --abbrev-ref @{u}` fails) → the branch isn't tracking a remote. Tell them: `git push -u origin <branch>`.
- **Uncommitted changes present** → do NOT fast-forward (it could collide). Report the dirty files and suggest running `/commit` first.
- **Clean + has upstream** → continue to Step 3.

## Step 3: Fast-forward only

```bash
git merge --ff-only @{u} 2>&1 || echo "not fast-forwardable — your branch has diverged from its upstream; review before merging"
```

(Fast-forward on a clean tree is snapshot-exempt: Step 2 guaranteed no uncommitted content exists, and an ff only moves the branch pointer over committed history — nothing can be lost.)

## Step 4: Report drift vs main — and offer to pull it in

```bash
git rev-list --left-right --count origin/main...HEAD 2>/dev/null | awk '{print "vs origin/main: behind "$1", ahead "$2}'
# If behind, show WHICH shared files main has that this trunk lacks (the actionable part):
git diff --stat HEAD...origin/main -- '*.md' 'data/*.yaml' 'docs/**' 'skills/**' 'packages/**' '.claude/**' 2>/dev/null | tail -12
```

Report in 2–3 lines: current branch, whether it fast-forwarded, ahead/behind `origin/main`, and any uncommitted files.

**`main` is the shared consolidation layer** — teammates' merged plans, data, and tooling land there, and your trunk does **not** receive them automatically. Fast-forwarding your trunk (Step 3) only pulls *your own* pushed history, not main's. So a file a teammate consolidated to `main` (e.g. a plan doc) will be missing from your trunk until you pull `main` in — this is the #1 "I don't have that file" gotcha.

Therefore, **if behind `main`**: name a few of the missing files from the `--stat` above (so the operator can see what they're missing), then **offer** to `git merge origin/main` — but **ask first** (a merge can pull canvas/structural changes that deserve review; reconcile canvases in the Obsidian UI, never programmatically). Passing `main` as the argument (`/sync main`) is explicit consent — proceed with the merge. On consent, **snapshot before the merge** (vault rule: snapshot before any real merge):

```bash
node scripts/vault-snapshot.mjs "before merging origin/main into $(git rev-parse --abbrev-ref HEAD)" 2>/dev/null \
  || node ../../scripts/vault-snapshot.mjs "before merging origin/main" 2>/dev/null \
  || echo "snapshot script unavailable — confirm with the operator before merging"
git merge origin/main
```

## Radicle-canonical variant

Everything above is the **github-canonical (default)** path — unchanged. If `federation.yaml` has `platforms.canonical: radicle`, branch instead:

- **Step 1 (read state):** replace `git fetch origin` with the radicle driver's sync — `driver.syncUpstream()` (i.e. `rad sync`), which exchanges refs with the node's seeds. If the node isn't reachable, that's the normal offline case (see Step 2 of `/initialize`'s radicle variant) — report "offline — local state only", not an error.
- **Step 2/3 (branch logic + fast-forward):** unchanged in spirit — still never fast-forward over uncommitted changes. Where github compares against `@{u}`/`origin/main`, radicle compares against the canonical branch reported by `driver.getDrift(rid)` (`{ behind, ahead, canonicalRef }`).
- **Step 4 (drift vs main):** replace the `origin/main` rev-list/diff with `driver.getDrift(rid)` for the ahead/behind counts, and `driver.webUrl(rid, path)` links (instead of a `github.com/.../blob/main/...` URL) when naming which shared files the canonical branch has that this trunk lacks. A merge of the canonical branch in, when behind, still needs explicit operator consent and a vault snapshot first — same as the github path.
