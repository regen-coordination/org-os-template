#!/usr/bin/env bash
# Live verification of the operator-gated rad-org-os WRITE path.
#
# These steps sign with your Radicle key, so they need your passphrase — supply it
# via the environment so it never lands in a file or shell history you don't control:
#
#     RAD_PASSPHRASE='…your passphrase…' bash packages/rad-org-os/scripts/live-verify.sh
#
# What it does (all reversible):
#   1. starts your local Radicle node (needs the key unlocked)
#   2. runs the gated bootstrap integration → proves zero→live: creates a PRIVATE
#      scratch repo in your ~/.radicle storage (unannounced; not pushed anywhere)
#   3. prints the governance (crefs / threshold) apply command, which is interactive
#      via `rad id update` and left for you to run against a real repo
#   4. stops the node
#
# The read path (getRepo / fetchFile against a public seed) needs NO key and is
# already covered by `RAD_INTEGRATION=1 node --test test/integration.test.mjs`.
set -euo pipefail

# Homebrew rad on macOS; adjust if rad is elsewhere on your PATH.
command -v rad >/dev/null || export PATH="/opt/homebrew/bin:${PATH}"

if ! command -v rad >/dev/null; then
  echo "✗ rad is not installed. Install it: curl -sSf https://radicle.dev/install | sh"
  exit 1
fi
if [ -z "${RAD_PASSPHRASE:-}" ]; then
  echo "✗ RAD_PASSPHRASE is not set. Re-run as:"
  echo "    RAD_PASSPHRASE='…' bash packages/rad-org-os/scripts/live-verify.sh"
  echo "  (your Radicle key passphrase — it stays in your environment, never in the repo)"
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel)"
STARTED_NODE=0
cleanup() {
  if [ "$STARTED_NODE" = "1" ]; then
    echo "==> Stopping the node"
    rad node stop || true
  fi
}
trap cleanup EXIT

echo "==> rad $(rad --version)"
echo "==> Identity: $(rad self --did 2>/dev/null || rad self 2>/dev/null | sed -n 's/^DID *//p' | head -1)"

echo "==> Starting your Radicle node"
if rad node start; then STARTED_NODE=1; fi
sleep 2
rad node status || true

echo
echo "==> Bootstrap end-to-end (creates a PRIVATE scratch repo in ~/.radicle storage)"
cd "${ROOT}/packages/rad-org-os"
RAD_INTEGRATION=1 node --test test/bootstrap-integration.test.mjs

echo
echo "==> Governance apply (operator-gated, interactive):"
echo "    - main's quorum IS the identity threshold — set at genesis (threshold 1) or change via:"
echo "        rad id update --repo <RID>        # edit 'threshold' / add delegates"
echo "    - protect ADDITIONAL refs (e.g. release tags) by adding an 'xyz.radicle.crefs'"
echo "      payload to the identity doc via the same 'rad id update' editor. Generate the"
echo "      payload with buildCrefs() (packages/rad-org-os/src/governance.mjs); paste it in."
echo
echo "✓ Live write-path verification complete."
echo "  Cleanup: the private scratch repo remains in local storage (unannounced, harmless)."
echo "  List it with 'rad ls' and remove it from storage if you wish."
