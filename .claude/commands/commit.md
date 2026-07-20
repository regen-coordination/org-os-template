---
description: Guided vault-safe commit — stage, write a conventional message, commit to your operator trunk (never main), push. Use when the user types /commit or says "commit this", "save my work", "commit and push".
---

You are making a guided commit on this org-os clone. **Vault-safe: NEVER `git stash`, `git clean`, or `git reset --hard`.**

## Step 1: Guard the branch

```bash
git rev-parse --abbrev-ref HEAD
```

If the branch is **`main`**: STOP. `main` is integration-only. Tell the operator to switch to their operator trunk first: `git switch <operator>` (their operator slug), or create it with `bash scripts/operator-setup.sh <operator>`. Do not commit to `main`.

## Step 2: Show what will be committed

```bash
git status
git diff --stat
```

Summarize the changes in plain language. If clearly-unrelated changes are bundled in (e.g. someone else's in-progress work), **flag it** and offer to stage selectively instead of `git add -A` — don't absorb another operator's scope into this commit.

## Step 3: Stage + commit

```bash
git add -A          # or stage selectively per Step 2
```

Write a **conventional commit** message — `type(scope): summary` — that describes the real change. Types: `feat`, `fix`, `docs`, `session`, `data`, `design`, `chore`. Then:

```bash
git commit -m "<message>"
```

## Step 4: Push

```bash
git push 2>&1 || echo "push failed — if 'no upstream', run: git push -u origin $(git rev-parse --abbrev-ref HEAD)"
```

If push fails on auth/permissions, report it plainly (the operator may need write access to the repo).

## Step 5: Report

One line: what was committed (short hash + summary) and whether it pushed. If the commit touched **shared structural files** (`data/*.yaml`, `HEARTBEAT.md`, `MEMORY.md`, `federation.yaml`, `scripts/`, `.well-known/`, `docs/plans/`), remind: these are PR-gated — open a PR to `main` (or flag for the weekly merge-consolidation) rather than expecting them to auto-promote.

## Radicle-canonical variant

Everything above is the **github-canonical (default)** path — unchanged, and what every existing clone uses. If `federation.yaml` has `platforms.canonical: radicle`, branch instead:

- **Step 1 (guard):** same idea, different name — there's no `main` PR-gate; the guard is the identity-doc quorum. Structural/shared-file changes still shouldn't land as a direct push to the canonical branch without review.
- **Step 3 (stage + commit):** unchanged — `git add` + a conventional commit message, committed locally exactly as above.
- **Step 4 (push):** structural changes (touching the identity-threshold-governed main) go out as a **patch**, not a branch push: `git push rad HEAD:refs/patches -o patch.message="<summary>"` (this is how `openChange` in `@org-os/rad`'s driver opens a patch — there is no `rad patch open`). A personal/operator branch that isn't targeting main can still `git push rad <branch>`.
- **Step 5 (report):** report the patch id (parsed from the push's stderr, e.g. "✓ Patch <oid> opened") instead of a PR link; note it awaits the identity-doc `threshold` of delegate signatures rather than a GitHub review.

$ARGUMENTS
