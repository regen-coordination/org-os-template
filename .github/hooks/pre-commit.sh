#!/usr/bin/env bash
# Pre-commit hook for org-os.
# Lives in .github/hooks/, installed into .git/hooks/ via `npm run install:hooks`.
# Bypass with: git commit --no-verify (use sparingly; requires explicit user OK).

set -e

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

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
fi

# Advisory: warn on vault-safety violations if any (non-blocking)
# Currently no enforcement — vault-safety is operator discipline, not automated.

echo "✓ pre-commit checks passed"
