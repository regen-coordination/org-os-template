#!/usr/bin/env bash
# Pane entrypoint: run the cockpit launcher from this repository.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export ORG_OS_INVOKED_FROM="${ORG_OS_INVOKED_FROM:-$PWD}"
exec node "$here/../../bin/cockpit.mjs" "$@"
