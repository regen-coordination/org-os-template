#!/usr/bin/env bash
# Symlinks the hermes integration into a hermes-agent checkout.
#
# Required env:
#   HERMES_HOME   — path to the hermes-agent repo
# Recommended env:
#   ORG_OS_ROOT   — path to this org-os repo (printed at the end if unset)

set -euo pipefail

if [ -z "${HERMES_HOME:-}" ]; then
  echo "ERROR: set HERMES_HOME to the path of your hermes-agent checkout." >&2
  echo "  example: export HERMES_HOME=~/code/hermes-agent" >&2
  exit 1
fi

if [ ! -d "$HERMES_HOME" ]; then
  echo "ERROR: HERMES_HOME does not point to a directory: $HERMES_HOME" >&2
  exit 1
fi

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORG_OS_ROOT_DEFAULT="$(cd "$PKG_DIR/../.." && pwd)"

HERMES_SKILLS_DIR="$HERMES_HOME/skills"
TOOL_TARGET_DIR="$HERMES_HOME/tools"

if [ ! -d "$HERMES_SKILLS_DIR" ] || [ ! -d "$TOOL_TARGET_DIR" ]; then
  echo "ERROR: $HERMES_HOME does not look like a hermes-agent checkout " >&2
  echo "       (expected to find skills/ and tools/ subdirectories)." >&2
  exit 1
fi

# Primary multi-page skill (drives the org_os_page tool with any id).
mkdir -p "$HERMES_SKILLS_DIR/org_os_pages"
ln -sf "$PKG_DIR/SKILL.md" "$HERMES_SKILLS_DIR/org_os_pages/SKILL.md"
echo "✓ Linked /org_os_pages skill   → $HERMES_SKILLS_DIR/org_os_pages/SKILL.md"

# Slash-command skills: /dashboard and /initialize.
for cmd in dashboard initialize; do
  mkdir -p "$HERMES_SKILLS_DIR/$cmd"
  ln -sf "$PKG_DIR/skills/$cmd/SKILL.md" "$HERMES_SKILLS_DIR/$cmd/SKILL.md"
  echo "✓ Linked /$cmd skill        → $HERMES_SKILLS_DIR/$cmd/SKILL.md"
done

# Tool registration.
ln -sf "$PKG_DIR/tools/org_os.py" "$TOOL_TARGET_DIR/org_os.py"
echo "✓ Linked org_os tool         → $TOOL_TARGET_DIR/org_os.py"
echo
echo "─── Manual steps remaining ─────────────────────────────────────────────────"
echo
echo "1. Add 'org_os' to a toolset in $HERMES_HOME/toolsets.py"
echo "   (typically the _HERMES_CORE_TOOLS list)"
echo
if [ -z "${ORG_OS_ROOT:-}" ]; then
  echo "2. Set ORG_OS_ROOT in your shell:"
  echo "   export ORG_OS_ROOT=$ORG_OS_ROOT_DEFAULT"
else
  echo "2. ORG_OS_ROOT is already set: $ORG_OS_ROOT ✓"
fi
echo
echo "3. Restart hermes; the org_os_page tool should appear in /tools listings."
