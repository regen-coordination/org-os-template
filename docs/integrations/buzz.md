# Buzz Integration

**Module:** `org-os-buzz`, catalogued `pilot` ([manifest](../../modules/org-os-buzz/module.yaml), [catalogue entry](../MODULES.md)). Built and verified against live relays; not in production use. Design: [Buzz integration design](../superpowers/specs/2026-08-28-buzz-integration-design.md) (its 2026-08-29 reconciliation section records that nearly every guess in the first build was wrong; [`VERIFIED.md`](../../packages/buzz-integration/VERIFIED.md) supersedes them).

[Buzz](https://github.com/block/buzz) is Block's self-hostable workspace built on one Nostr event log (Apache 2.0 and a v0.4.x developer preview, per the maintainer's notes; upstream claims, not checked here). Every human and agent is a keypair that leaves signed events. org-os uses it as a comms lane between sessions: `/close` posts a digest of the session to a channel as a signed event, and `/initialize` reads the channel back. The lane is fail-open: a dead relay, a missing binary or a bad key produces one skip line and the session carries on. `/close` cannot fail because of Buzz.

Nothing in the repository speaks Nostr. [`packages/buzz-integration/lib/buzz.mjs`](../../packages/buzz-integration/lib/buzz.mjs) builds arguments for the `buzz` command-line binary, runs it, and parses its JSON, so a change in the preview's interface costs one file.

## What is verified, and what is not

| Level | State |
|---|---|
| Built | Wrapper, three scripts and the session hooks exist; the 62 tests in `tests/buzz-integration/` pass on this branch (they use a stub binary, not a relay). |
| Verified against a live service | 2026-08-29, against a local relay (Block's `deploy/compose`, image `ghcr.io/block/buzz:main`) and the real `buzz` binary: `buzz:doctor` all four checks green (recorded in `HEARTBEAT.md`), `buzz:post` posted a digest, `buzz:read` read it back with its provenance trailer intact. The same day the same loop was re-verified against a Block-hosted community relay (the maintainer's), including a non-member being refused and a roster add admitting the agent. Every row of the CLI contract in `VERIFIED.md` was observed, not assumed. |
| Not exercised | Exit codes 4 (other) and 5 (write conflict), which `buzz --help` documents. Owner delegation via `BUZZ_AUTH_TAG` (NIP-OA). A cross-machine agent join. A non-owner human joining by invite link. A post driven by a real `/close` on the second instance (its verification posts were made by hand). The hooks on the Hermes and Berd/Goose surfaces: they exist but have never fired from those tools. |
| In production use | No. The acceptance is five consecutive real sessions where `/close` posts and `/initialize` reads with no manual intervention; the tracker in `HEARTBEAT.md` ("Buzz lane dogfood acceptance") stood at 0 of 5. |

## What it connects to

- A **Buzz relay** reached over HTTP REST (`POST /query`), never a websocket. Either a hosted community relay (`https://<name>.communities.buzz.xyz`) or one you run yourself from the `block/buzz` repository's `deploy/compose` stack (Docker). The compose verbs, its `.env` rules and the roster commands below are from the maintainer's notes on the Buzz repository of 2026-08-29 and were not re-read in this pass: the stack needs its own `.env` and refuses to start while any `CHANGE_ME` placeholder remains, and `./run.sh` offers `start`, `status`, `logs`, `stop`, `upgrade` and `backup-hint`.
- The **`buzz` binary**, from the Buzz desktop app or built from the Buzz repository. Not the name `buzz-cli`. Nothing in this repository installs it. Name a different path with `BUZZ_CLI_BIN`.
- A **channel** on that relay, and an **agent keypair** rostered on the relay.

## Setup

Put these in the instance's `.env` (gitignored; placeholders are in `.env.example`):

| Variable | Meaning |
|---|---|
| `BUZZ_RELAY_URL` | Relay base URL. `http://` or `https://`, never `ws://` or `wss://`: a hosted community's `wss://` address from the app becomes `https://` for the CLI. Default `http://localhost:3000`. |
| `BUZZ_CHANNEL` | The channel's **UUID**, never its name. UUIDs are per relay: a new relay means a new channel and a new UUID. List them with `buzz channels list`. (If unset, the code defaults to the literal name `org-os-dev`, which the CLI rejects.) |
| `BUZZ_PRIVATE_KEY` | The agent's key, 64-character hex or `nsec1...`. The CLI does not read `BUZZ_NSEC`. |
| `BUZZ_CLI_BIN` | Optional; only if `buzz` is not on `PATH`. |

The private key belongs only in `.env`, never in a tracked file. The agent's public key (npub) is recorded in the instance's `TOOLS.md`. Quote any `.env` value containing `#`.

The Buzz CLI ships no key generator; any secp256k1 pair works (for example `openssl ecparam -name secp256k1 -genkey`, taking the x-only public key). Then get the agent admitted, and confirm with `npm run buzz:doctor`.

### Joining a relay: three membership planes

Mixing these up is the usual failure.

1. **Community or relay membership** is the outer gate every request passes. Failing it gives `403 relay_membership_required` and exit code 3.
2. **Channel membership** is inside that gate. An open channel can be read and posted by any relay member. Adding someone to a channel does not admit them to the relay.
3. **Invite links** pend until someone redeems them in a Buzz app. Right for humans; a headless agent never redeems one.

To admit an agent on a hosted community, the owner or an admin uses the community-level Members, "Add someone directly" dialog in the Buzz apps: paste the npub, pick a role. On a relay you run, the maintainer's notes give `./run.sh add-member <npub-or-hex> [--role member|admin]` on the relay host (upstream, not checked here; `list-members` and `remove-member` complete the set; wait a second between multiple adds, because same-second timestamps collide). A plain `member` was enough to create the channel itself on the hosted relay.

A second org-os instance joins the same way: its own keypair, its own npub in its `TOOLS.md`, rostered, then its own `.env` with the relay URL, the channel UUID and its key. Run `npm run buzz:doctor` until green; the hooks then work unchanged. NIP-OA owner delegation (the agent's requests carry an `auth` tag signed by the owner, wired through `BUZZ_AUTH_TAG`) is an alternative that avoids a roster entry; it is described from Buzz source and has not been exercised here.

## Commands

```bash
npm run buzz:doctor                      # four checks; exit 0 ready, 2 not ready
npm run buzz:read                        # messages since the read marker
npm run buzz:read -- --no-advance        # peek without moving the marker
npm run buzz:post -- --file <path>       # post a digest from a file
```

- **`buzz:doctor`** checks that the binary runs, that the relay answers (it runs `buzz channels list`, with a 5-second limit), that `BUZZ_PRIVATE_KEY` is set, and that a channel is set. It uses the CLI's real exit codes to tell a missing or invalid key (3) from an unreachable relay (2).
- **`buzz:read`** prints what was posted to the channel since the marker as `- [timestamp] content` lines under a heading, then advances the marker. `--state <path>` relocates the marker file (used by tests). A reply that is not a JSON array makes it print a skip line and leave the marker alone, so real messages are never reported as none.
- **`buzz:post`** appends a provenance trailer to the digest, separated by a blank line, and posts it as one signed event:

  ```
  org-os: sha=<short-sha> source=org-os-session truncated=<true|false>
  ```

  The sha is the framework repository's own `HEAD`, not the invoking directory's. Without `--file` it reads standard input with an idle timeout of 3 seconds (`BUZZ_STDIN_TIMEOUT_MS`) and a total limit of 15 seconds (`BUZZ_STDIN_TOTAL_TIMEOUT_MS`); a read cut short posts what it buffered and sets `truncated=true`. Prefer `--file`. It always exits 0.

All three are fail-open. Only `doctor` signals state through its exit code.

## What it writes and where

- **Remote:** one signed event per `/close`, in the channel.
- **Local:** `.buzz-state.json` at the repository root (gitignored), `{"lastRead": <unix-seconds>}`. If it is missing or corrupt, the next read looks back 24 hours. If it cannot be written, `buzz:read` prints a skip line and carries on.
- Nothing else. The key and relay settings stay in `.env`.

## How the session hooks use it

On `/initialize`, the hook runs `buzz:doctor`; only if it exits 0 does it run `buzz:read`, and it folds the output into the session context under "Since last session". On `/close`, after the close commit exists, the hook writes the digest to a temporary file and runs `buzz:post -- --file`, never a bare pipe. A failed post is noted for the next session, which may post again.

The hooks are written into each surface that starts or closes a session, because different tools read different paths:

| File | Hook |
|---|---|
| `.claude/commands/initialize.md` | read-back |
| `.claude/commands/close.md` | digest post |
| `skills/initialize/SKILL.md` | read-back |
| `skills/commands/close/SKILL.md` | digest post (generated command-skill mirror; the generator skips `/initialize` because the real skill owns that name) |
| `skills/org-os-init/SKILL.md` | both (canonical source for the Berd bridge) |
| `.agents/skills/org-os-init/SKILL.md` | both (managed mirror, see [Berd](berd.md)) |

Some tools read a user-level skill copy instead of the project one; those copies are outside the repository and are not covered here. Only the Claude Code surfaces have executed the hooks live.

## The contract with the real CLI

[`VERIFIED.md`](../../packages/buzz-integration/VERIFIED.md) records what the real `buzz` binary does: `messages send --channel <UUID> --content <text>` returns `{"accepted":true,"event_id":...}`; `messages get --channel <UUID> [--since <unix-seconds>]` returns a JSON array of events; `channels list` returns an array with `channel_id` fields and is the connectivity and auth probe; stdout is always JSON; there is no `--json`, `--tag`, `--version` or `status`; errors are JSON on standard error; exit codes are 0 success, 1 bad input, 2 relay or network error, 3 auth error. The working rule:

1. `CLI_MAP` in `lib/buzz.mjs` changes only to match a re-verified pin, never to follow documentation.
2. On any new `buzz` binary or relay image, re-observe the `VERIFIED.md` table first, update it, then reconcile `CLI_MAP` and the tests.
3. `modules/org-os-buzz/module.yaml` checks that `VERIFIED.md` exists. Do not rename it.

Buzz itself is a developer preview, so interface drift is expected; re-run `npm run buzz:doctor` at the start of a session (the `/initialize` hook does).
