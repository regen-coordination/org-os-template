#!/usr/bin/env bash
# Pre-commit hook for org-os.
# Lives in .github/hooks/, installed into .git/hooks/ via npm run install:hooks.
# Bypass with: git commit --no-verify (use sparingly).

set -e

CHANGED=$(git diff --cached --name-only --diff-filter=ACM)

# Always run structure validator (fast)
echo "[pre-commit] validate:structure ..."
npm run --silent validate:structure || {
  echo "[pre-commit] validate:structure FAILED — fix or use --no-verify if intentional"
  exit 1
}

# Run schema validator only if data/*.yaml touched
if echo "$CHANGED" | grep -q '^data/.*\.yaml$'; then
  echo "[pre-commit] validate:schemas (data/*.yaml changed) ..."
  npm run --silent validate:schemas || {
    echo "[pre-commit] validate:schemas FAILED"
    exit 1
  }
fi

echo "[pre-commit] OK"
