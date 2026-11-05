#!/usr/bin/env bash
# Pre-commit hook for org-os.
# Lives in .github/hooks/, installed into .git/hooks/ via `npm run install:hooks`.
# Bypass with: git commit --no-verify (use sparingly; requires explicit user OK).

set -e

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# A linked worktree with no node_modules (the admin builds a proposal's branch in one, under its state directory):
# every check below runs node scripts that import packages from node_modules, which only the main checkout holds,
# so each would refuse the commit for a reason that has nothing to do with it. Skip them there and say so; the main
# checkout and CI still run them.
GIT_DIR_HERE="$(cd "$(git rev-parse --git-dir)" && pwd -P)"
GIT_COMMON_HERE="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
if [ "$GIT_DIR_HERE" != "$GIT_COMMON_HERE" ] && [ ! -d "$ROOT/node_modules" ]; then
  echo "→ pre-commit: node checks skipped: this is a linked worktree with no node_modules (validate:structure, validate:schemas, validate:data and validate:governance need it). The main checkout and CI run them." >&2
  exit 0
fi

# Always: structural validation (fast)
echo "→ pre-commit: validate:structure"
npm run --silent validate:structure

# Conditional: schema validation if any data/*.yaml staged
if git diff --cached --name-only | grep -qE '^data/.*\.ya?ml$'; then
  if [ -f "scripts/validate-identity.mjs" ]; then
    echo "→ pre-commit: validate:schemas (data/*.yaml touched)"
    npm run --silent validate:schemas || {
      echo "✗ Schema validation failed. Fix or use --no-verify (with explicit user OK)."
      exit 1
    }
  else
    echo "→ pre-commit: validate:schemas skipped (scripts/validate-identity.mjs lands in v3.6 autopoiesis)"
  fi

  # Warnings only: a local commit is never blocked by validate:data (F1 spec §3.5).
  # CI runs it as a gate. New clones carry no copy of the script, so it is skipped there.
  # doctor sync's overlay copies scripts/ into an instance, this script included; without
  # packages/admin it exits 2 (cannot run), which the `|| echo` absorbs like any problem.
  if [ -f "scripts/validate-data.mjs" ]; then
    echo "→ pre-commit: validate:data (warnings only)"
    node scripts/validate-data.mjs . || echo "⚠ validate:data found problems (above). Warnings only: the commit goes ahead."
  fi
  # The same for the rules and the history (0.6 F2): a warning here, an error in CI.
  if [ -f "scripts/validate-governance.mjs" ]; then
    echo "→ pre-commit: validate:governance (warnings only)"
    node scripts/validate-governance.mjs . || echo "⚠ validate:governance found problems (above). Warnings only: the commit goes ahead."
  fi
fi

# Advisory: warn on vault-safety violations if any (non-blocking)
# Currently no enforcement — vault-safety is operator discipline, not automated.

echo "✓ pre-commit checks passed"
