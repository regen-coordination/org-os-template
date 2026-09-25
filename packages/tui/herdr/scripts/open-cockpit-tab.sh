#!/usr/bin/env bash
set -uo pipefail
herdr_bin="${HERDR_BIN_PATH:-herdr}"
exec "$herdr_bin" plugin pane open --plugin org-os-cockpit --entrypoint cockpit --placement tab --focus
