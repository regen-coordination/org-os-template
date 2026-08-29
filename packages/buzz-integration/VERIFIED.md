# buzz — VERIFIED.md

**Status: VERIFIED — 2026-08-29.** Task 1 of the buzz-integration plan ran
against a real `buzz` binary and a live local relay. Nearly every guess
encoded in the original `CLI_MAP` (built from documented defaults when Task 1
was deferred — Docker/just/hermit/buzz-cli/goose were all absent from the
build machine) was wrong: wrong binary name, wrong transport, wrong env var,
wrong verbs, wrong flags, wrong output shapes, and an invented `--tag` flag
that does not exist. This file records what was actually observed and
supersedes every prior "assumed" row below.

## Pin

| Field | Value |
|---|---|
| Relay | Local, via `deploy/compose` from `block/buzz`, image `ghcr.io/block/buzz:main` |
| Binary | `buzz` (NOT `buzz-cli`) — `~/.local/bin/buzz`, a symlink to `/Applications/Buzz.app/Contents/MacOS/buzz` |
| Verification date | 2026-08-29 |
| Verified by | Operator, against the running local relay |
| Resolved channel | `org-os-dev` → UUID `3344f08a-5f68-4c7e-8499-bcbe0bfb22ff` |

## Environment variables the CLI itself reads

| Variable | Purpose | Verified default / accepted forms |
|---|---|---|
| `BUZZ_RELAY_URL` | Relay endpoint | `http://localhost:3000` by default. **HTTP REST** (`POST /query`) — not a websocket. `ws://` is wrong. |
| `BUZZ_PRIVATE_KEY` | Agent identity | Accepts **either** 64-char hex **or** `nsec1…` bech32. (The old `BUZZ_NSEC` name is not read by the CLI at all.) |

## CLI surface (intent → command → observed output shape)

There is **no `--json` flag** anywhere — stdout is always JSON, unconditionally.
There is **no `--tag` flag** — provenance now travels as a trailer appended to
message content (operator decision, 2026-08-29 reconciliation; see
`scripts/post-digest.mjs`). There is **no `status` subcommand**; `channels
list` is the verified connectivity/auth probe. `--channel` always takes a
**UUID**, never a channel name — names resolve via `channels list`.

| Intent | Verified command | Observed output shape |
|---|---|---|
| post | `buzz messages send --channel <UUID> --content <text>` (or `--content -` to read the body from stdin) | Top-level JSON object: `{"accepted":true,"event_id":"<64hex>","mention_pubkeys":[],"message":""}` |
| read | `buzz messages get --channel <UUID> [--since <unix-seconds>] [--limit <n>]` | Top-level JSON **array** (not `{events:[...]}`), each item `{content, created_at, id, kind, pubkey, tags}`; `created_at` is unix seconds. Empty result is `[]`. |
| connectivity/auth probe | `buzz channels list` | Top-level JSON **array**, each item `{channel_id, created_at, description, name}` — note the id field is `channel_id`, not `id` |
| channel creation | `buzz channels create --name <name> --type stream --visibility open [--description <text>]` | (not exercised by the wrapper; recorded for completeness) |

## Errors

JSON on **stderr**, shape `{"error":"<category>","message":"<detail>","retryable":<bool>}`.

## Exit codes (verified by running each case)

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Bad input (invalid UUID, unknown subcommand) |
| `2` | Relay/network error (connection refused) — `retryable:true` |
| `3` | Auth error (missing/invalid key) |

`lib/buzz.mjs`'s `status()` uses exit `3` to report a key problem and exit `2`
to report a relay-down problem, instead of guessing from a single bundled
probe.

## Provenance trailer (replaces the planned `--tag` design)

The original design tagged each posted event `sha=`, `source=`, `truncated=`
via a `--tag` flag. That flag does not exist in the real CLI. The operator
decided (2026-08-29): carry provenance as a machine-readable trailer appended
to the message content, separated from the digest body by a blank line:

```
org-os: sha=<short-sha> source=org-os-session truncated=<true|false>
```

Content is part of the signed event, so provenance still survives in the
permanent log and is greppable on read-back — preserving the original
design's intent without the nonexistent flag.

## Reconciliation history

- **2026-08-28 (build time):** Task 1 deferred — Docker was not running;
  `just`, `hermit`, `buzz-cli`, and `goose` were all absent from the machine.
  `CLI_MAP` was built from documented guesses.
- **2026-08-29 (this reconciliation):** Task 1 ran against a live local
  relay (`deploy/compose`, image `ghcr.io/block/buzz:main`) and the real
  `buzz` binary. Every row above was observed directly, not assumed.
  `packages/buzz-integration/lib/buzz.mjs`'s `CLI_MAP`, `loadConfig`, and
  `status()` were reconciled to match; see git history for the exact diff.

## Downstream consumers of this file

- `packages/buzz-integration/lib/buzz.mjs` — `CLI_MAP` comment points here.
- `modules/org-os-buzz/module.yaml` asserts this file exists via a
  `file-exists` check — do not delete or rename it.
- `TOOLS.md` Buzz section points here.
