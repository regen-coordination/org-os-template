#!/usr/bin/env bash
# Symlinks the opencode slash commands into a project's .opencode/commands/
# directory (or the global ~/.config/opencode/commands/ if --global passed).
#
# Usage:
#   ./install-commands.sh                    # project-level (.opencode/commands/)
#   ./install-commands.sh --global           # global (~/.config/opencode/commands/)
#   ./install-commands.sh /path/to/project   # explicit project root

set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMANDS_SRC="$PKG_DIR/commands"

if [ ! -d "$COMMANDS_SRC" ]; then
  echo "ERROR: $COMMANDS_SRC does not exist." >&2
  exit 1
fi

if [ "${1:-}" = "--global" ]; then
  TARGET_DIR="$HOME/.config/opencode/commands"
elif [ -n "${1:-}" ] && [ -d "$1" ]; then
  TARGET_DIR="$1/.opencode/commands"
else
  TARGET_DIR="$(pwd)/.opencode/commands"
fi

mkdir -p "$TARGET_DIR"

for f in "$COMMANDS_SRC"/*.md; do
  name="$(basename "$f")"
  ln -sf "$f" "$TARGET_DIR/$name"
  echo "✓ Linked $name → $TARGET_DIR/$name"
done

echo
echo "Slash commands installed. In opencode you can now use:"
echo "  /dashboard         — render the org-os dashboard"
echo "  /initialize        — open a session (sync + dashboard + suggestions)"
echo "  /org-projects      — workstream table"
echo "  /org-decisions     — decisions log"
echo "  /org-this-week     — meetings, events, deadlines"
echo
echo "Each command runs 'npm run page --silent -- <id>' in the cwd opencode is launched from."
echo "Make sure that cwd is your org-os repo, or set ORG_OS_ROOT and update the command files accordingly."
