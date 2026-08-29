# Buzz Integration — Agent Comms Lane

**Status:** module #3 `org-os-buzz`, catalogued **pilot** — CLI surface and post/read round-trip verified live 2026-08-29 against a real relay ([`packages/buzz-integration/VERIFIED.md`](../../packages/buzz-integration/VERIFIED.md), status VERIFIED); the 5-session dogfood acceptance has **not started** (0/5 — `HEARTBEAT.md` tracker)
**Spec:** [`docs/superpowers/specs/2026-08-28-buzz-integration-design.md`](../superpowers/specs/2026-08-28-buzz-integration-design.md) (see its 2026-08-29 Reconciliation section — nearly every documented guess in the original build was wrong; VERIFIED.md supersedes them)
**Pin:** relay from `block/buzz` `deploy/compose`, image `ghcr.io/block/buzz:main` · binary `buzz` (`~/.local/bin/buzz` → `/Applications/Buzz.app/Contents/MacOS/buzz`) · channel `org-os-dev` → UUID `3344f08a-5f68-4c7e-8499-bcbe0bfb22ff`

## What Buzz is

[Buzz](https://github.com/block/buzz) is Block's self-hostable "hive mind" workspace (Apache 2.0, v0.4.x **developer preview**): one Nostr event log carries chat, code collaboration, and workflows, and every human and agent is a Schnorr keypair leaving signed, searchable events. org-os rides the `buzz` CLI as Block's agent surface and never implements Nostr in-repo — `packages/buzz-integration/lib/buzz.mjs` is a one-file wrapper (build argv, spawn, parse JSON), so preview-interface drift costs one file.

## The lane in one paragraph

`/close` posts the session digest to `#org-os-dev` as a signed event, with provenance appended as a machine-readable trailer (`org-os: sha=<short-sha> source=org-os-session truncated=<bool>`) — the Buzz log becomes a cryptographically signed mirror of session history, cross-linked to the close commit. `/initialize` reads the channel back since the last-read marker. Everything is **fail-open**: a dead relay, missing binary, or bad key produces one skip line and the session proceeds — `/close` can never fail because of Buzz. The lane points at a **local relay only**; anything shared or hosted is gated behind a redaction review (spec safety gate).

## Operating

### The daily loop

On **`/initialize`**: the hook runs `npm run buzz:doctor`; if it exits 0 (all four checks green), `npm run buzz:read` prints everything posted to `#org-os-dev` since the marker and the block is folded into session context under "Since last session", then the marker advances. If the doctor isn't green, the hook skips silently — one line at most.

On **`/close`**: after the close commit exists, the hook writes the session digest to a temp file and runs `npm run buzz:post -- --file "$DIGEST_FILE"` — never a bare pipe or inherited terminal stdin that a producer could leave open. The script stamps the trailer with the repo's own `HEAD` (never the invoking directory's) and always exits 0; a failed post is noted for the next session, which may re-post.

### Where the hooks live (surfaces)

The same two hooks exist on every session surface, because different tools scan different paths:

| Surface | Hook(s) | Read by |
|---|---|---|
| `.claude/commands/initialize.md` (Step 2b) · `close.md` (Step 8b) | read-back · digest post | Claude Code project commands |
| `skills/initialize/SKILL.md` (Step 3b) | read-back | in-repo skill scanners (Hermes) |
| `skills/commands/close/SKILL.md` (Step 8b) | digest post | generated command-skill mirror (`sync-commands.mjs`; note it deliberately skips generating `/initialize` — the real skill above owns that name) |
| `skills/org-os-init/SKILL.md` (init step 4 · close step 6) | **both** | the full-lifecycle skill; canonical source for the Berd bridge |
| `.agents/skills/org-os-init/SKILL.md` (same steps) | **both** | Berd/Goose via `.agents/skills/` discovery (managed mirror — see [berd.md](berd.md)) |
| `~/.claude/skills/initialize/SKILL.md` (Step 3b) · `close/SKILL.md` (Step 6b) | read-back · digest post | tools that scan only the user-level copy (e.g. Zed/claude-acp) |

All eight carry their hooks as of 2026-08-29. Only the Claude Code surfaces have *executed* them live so far; no session has yet run the hooks from Hermes or Berd/Goose.

### Manual verbs

- `npm run buzz:doctor` — four checks (binary on PATH, relay reachable, `BUZZ_PRIVATE_KEY` present, channel set). Exit 0 green, 2 not-ready. Real exit codes from the CLI let it tell "no key" (auth, exit 3) from "relay down" (network, exit 2) precisely.
- `npm run buzz:read` — messages since the marker. `--no-advance` peeks without moving it; `--state <path>` relocates it (tests).
- `npm run buzz:post -- --file <path>` — post a digest. Without `--file` it reads stdin under an idle timeout (3s, `BUZZ_STDIN_TIMEOUT_MS`) plus a total deadline (15s, `BUZZ_STDIN_TOTAL_TIMEOUT_MS`); a read that ends before EOF posts what it buffered and stamps `truncated=true` into the trailer so the permanent log says so, not just the terminal.

The read marker is `.buzz-state.json` at the repo root (gitignored, `{"lastRead": <unix-seconds>}`). Corrupt or missing → 24h fallback window. It is **never advanced** past messages that couldn't be parsed: an unrecognized reply shape bails out loudly rather than reporting real messages as "none".

### Config

Repo-root `.env` (gitignored; placeholders in `.env.example`): `BUZZ_RELAY_URL` (HTTP REST, `http://localhost:3000` default — not a websocket), `BUZZ_CHANNEL` (**the UUID**, never the name), `BUZZ_PRIVATE_KEY` (64-char hex or `nsec1…`; the CLI does not read `BUZZ_NSEC`), optional `BUZZ_CLI_BIN`. The agent npub lives in `TOOLS.md`; the private key never enters a tracked file.

### The relay — start, stop, inspect

The relay is a machine-local compose stack from the `block/buzz` clone at `~/tools/buzz`, operated via `deploy/compose/run.sh` (Docker must be running; the stack needs its own `deploy/compose/.env` and refuses to start while any `CHANGE_ME` placeholder remains):

```bash
cd ~/tools/buzz/deploy/compose
./run.sh start        # docker compose up -d --wait
./run.sh status       # compose service status
./run.sh logs         # follow relay logs (or: logs <service>)
./run.sh stop         # compose down — volumes (Postgres, MinIO, git data) survive
./run.sh upgrade      # pull + restart, then prints the backup checklist
```

With the relay down, nothing breaks — every hook and verb degrades to its skip line. `./run.sh backup-hint` prints what to back up before upgrades (relay key, DB/object volumes, `.env` secrets).

### Joining `#org-os-dev`

Membership is two separate facts: being on the **relay roster**, and knowing the **channel UUID**.

- **Resolve the channel:** `buzz channels list` returns every channel with its `channel_id` — that UUID is what goes in `BUZZ_CHANNEL` and what every `--channel` flag takes. Names are never accepted.
- **Roster:** on the relay host, `./run.sh add-member <npub-or-hex> [--role member|admin]` (wraps `buzz-admin` inside the relay container); `list-members` and `remove-member` complete the set. When adding several members in a loop, `sleep 1` between invocations and never parallelize — same-second timestamps collide in the kind:13534 roster event.
- **A second org-os instance:** mint its own keypair with the `buzz` binary, record the npub in that instance's `TOOLS.md` (key only in its `.env`), add the npub to the roster, fill its `.env` (relay URL, channel UUID, key), and run `npm run buzz:doctor` until all four checks are green — the hooks then work unchanged. **First exercised 2026-08-29:** the hub instance (`lf-zettelkasten-os`, same machine) joined exactly this way — own keypair, rostered `member`, doctor 4/4, read the channel history back, and posted a hello SHA-tagged with its own join commit (`ddc39d56`), which the org-os agent then read back. **Caveat, stated plainly:** today's relay listens on `localhost` of this machine; a second *machine* needs the relay reachable over a network, and the moment digests leave this machine the spec's safety gate applies — redaction review first, draft-and-present. Cross-machine joins remain unexercised.
- **A human teammate:** their own keypair via the Buzz desktop app, `add-member` with their npub, and they read/post in `#org-os-dev` from the app. Also unexercised. The v2 direction (spec) makes Berd's `buzz-handoff` skill the human window onto the channel — trigger: both lanes' acceptances passed *and* a second human wants in.

### The contract: VERIFIED.md and `CLI_MAP`

[`packages/buzz-integration/VERIFIED.md`](../../packages/buzz-integration/VERIFIED.md) is the lane's contract with reality: every CLI-facing behavior in `lib/buzz.mjs` (`CLI_MAP`, env vars, exit codes, output shapes) mirrors a row observed there against the live relay. The working rule:

1. `CLI_MAP` changes **only** to match a re-verified pin — never to track documentation, and never speculatively.
2. On any bump of the `buzz` binary (a Buzz.app update) or the relay image: re-observe the VERIFIED.md table first (send, get, `channels list`, exit codes, error shape), update VERIFIED.md, then reconcile `CLI_MAP` and the tests to it.
3. `modules/org-os-buzz/module.yaml` asserts VERIFIED.md exists via a `file-exists` check — do not delete or rename it.

The reconciliation history in that file is the cautionary tale: the original wrapper was built from documented defaults while Task 1 was deferred, and nearly every guess — binary name, transport, env var, verbs, flags — was wrong.

## What is NOT verified

- **The dogfood acceptance.** 0 of 5 consecutive real sessions where `/close` posts and `/initialize` reads with zero manual intervention (`HEARTBEAT.md` tracker). Until 5/5, the module stays `pilot` and "adopted in this instance" is not claimed.
- **Multi-party beyond two agents on one machine.** The second-instance join recipe was exercised live 2026-08-29 — the hub joined (roster add, doctor green, read + post + cross-read all verified), so the channel now carries two signed identities. Still unexercised: cross-machine joins, the human-teammate path, and the hub's first *hook-driven* post (a real `/close`, as opposed to the manual join-verification post).
- **Non-Claude-Code surfaces.** The hooks exist on the Hermes and Berd surfaces but have never fired from them — `org-os-init` has never run under Goose (see [berd.md](berd.md)).
- **Anything beyond localhost.** Shared or hosted relays are explicitly gated behind a redaction review of digest content (spec safety gate).

Buzz itself is a v0.4.x developer preview — surface drift is expected, and the pin + VERIFIED.md protocol above is the mitigation.

## Re-verification note

Re-run `npm run buzz:doctor` at any session start (the `/initialize` hook does this for you). Re-run the full VERIFIED.md observation pass on any binary or relay-image bump, per "The contract" above.
