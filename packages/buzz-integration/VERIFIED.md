# buzz-cli — VERIFIED.md

**Status: PENDING.** The pin and the CLI-surface verification described below
have **not** been performed. `packages/buzz-integration/lib/buzz.mjs`
currently encodes `CLI_MAP` as **unverified documented defaults** taken from
the buzz-integration implementation plan — nobody has run these commands
against a real `buzz-cli` or a live relay.

## Why this file exists in this state

Task 1 of the plan (clone + pin `block/buzz`, stand up its Docker relay, mint
an agent keypair, and record the verified `buzz-cli` invocations) requires the
operator's environment. At the time this wrapper (Task 2) was built:

- Docker was not running.
- `just`, `hermit`, `buzz-cli`, and `goose` were all absent from the machine.

So Task 1 could not run, and nothing here has been verified. This stub exists
so downstream tasks (module manifest checks, TOOLS.md pointers) have a file
to point at, and so the next operator has a form to fill in rather than a
blank page.

## What the operator must do (Task 1)

1. Clone `block/buzz` and pin a specific commit/tag (record it below).
2. `just setup && just build && just dev` — bring up the local Docker relay
   (`ws://localhost:3000` by default).
3. Mint an agent keypair (nsec/npub) with `buzz-cli`. Put the npub in
   `TOOLS.md`; the nsec goes **only** in `.env` as `BUZZ_NSEC` — never in any
   tracked file.
4. Exercise `buzz-cli` directly: post one event to a channel, read it back,
   check status. Record the **actual observed** command forms, flags, and
   output shapes in the table below, replacing every "pending" cell.
5. Reconcile `packages/buzz-integration/lib/buzz.mjs`'s `CLI_MAP` (and the
   corresponding argv assertions in `tests/buzz-integration/buzz-lib.test.mjs`)
   against what was actually observed. Only change `CLI_MAP` to match a
   re-verified pin — never guess.
6. Update the Status line at the top of this file from PENDING to VERIFIED,
   with the date and pinned version.

## Pin

| Field | Value |
|---|---|
| `block/buzz` commit/tag pinned | pending |
| `buzz-cli` version (`buzz-cli --version`) | pending |
| Verification date | pending |
| Verified by | pending |

## CLI surface (intent → command → output shape)

The command column shows what `CLI_MAP` in `lib/buzz.mjs` *currently assumes*
(unverified). Fill in "Observed command" and "Observed output shape" once
Task 1 runs, then reconcile `CLI_MAP` to match.

| Intent | Assumed command (current `CLI_MAP`, unverified) | Observed command | Observed output shape |
|---|---|---|---|
| post | `buzz-cli post --channel <channel> --content <content> [--tag k=v ...] --json` | pending | pending |
| read | `buzz-cli read --channel <channel> [--since <unix-seconds>] --json` | pending | pending |
| status | `buzz-cli status --relay <relayUrl> --json` | pending | pending |
| version check | `buzz-cli --version` | pending | pending |

## Downstream consumers of this file

- `packages/buzz-integration/lib/buzz.mjs` — `CLI_MAP` comment points here.
- A later module manifest (`modules/org-os-buzz/module.yaml`) asserts this
  file exists via a `file-exists` check — do not delete or rename it.
- `TOOLS.md` Buzz section will point here once Task 1 lands.
