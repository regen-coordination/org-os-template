# Buzz Integration — Agent Comms Lane

**Status:** module #3 `org-os-buzz`, catalogued **pilot** — CLI surface and post/read round-trip verified live 2026-08-29 against a real relay ([`packages/buzz-integration/VERIFIED.md`](../../packages/buzz-integration/VERIFIED.md), status VERIFIED); the 5-session dogfood acceptance has **not started** (0/5 — `HEARTBEAT.md` tracker)
**Spec:** [`docs/superpowers/specs/2026-08-28-buzz-integration-design.md`](../superpowers/specs/2026-08-28-buzz-integration-design.md) (see its 2026-08-29 Reconciliation section — nearly every documented guess in the original build was wrong; VERIFIED.md supersedes them)
**Pin:** relay `https://luizfernando.communities.buzz.xyz` — the operator's hosted Buzz community (graduated 2026-08-29, DECISIONS.md; the local compose stack from `block/buzz` `deploy/compose`, image `ghcr.io/block/buzz:main`, stays on as dev sandbox) · binary `buzz` (`~/.local/bin/buzz` → `/Applications/Buzz.app/Contents/MacOS/buzz`) · channel `org-os-dev` → UUID `5f255182-b310-4516-aef0-3b3c67a232ef` (hosted; the day-one local log lives under `3344f08a…` on the sandbox relay)

## What Buzz is

[Buzz](https://github.com/block/buzz) is Block's self-hostable "hive mind" workspace (Apache 2.0, v0.4.x **developer preview**): one Nostr event log carries chat, code collaboration, and workflows, and every human and agent is a Schnorr keypair leaving signed, searchable events. org-os rides the `buzz` CLI as Block's agent surface and never implements Nostr in-repo — `packages/buzz-integration/lib/buzz.mjs` is a one-file wrapper (build argv, spawn, parse JSON), so preview-interface drift costs one file.

## The lane in one paragraph

`/close` posts the session digest to `#org-os-dev` as a signed event, with provenance appended as a machine-readable trailer (`org-os: sha=<short-sha> source=org-os-session truncated=<bool>`) — the Buzz log becomes a cryptographically signed mirror of session history, cross-linked to the close commit. `/initialize` reads the channel back since the last-read marker. Everything is **fail-open**: a dead relay, missing binary, or bad key produces one skip line and the session proceeds — `/close` can never fail because of Buzz. The lane's home is the **operator's hosted community relay** — graduated 2026-08-29 after the spec's safety gate was satisfied (redaction review done, operator approved digests as-is; DECISIONS.md "Buzz lane graduated"). The local compose relay stays on as dev sandbox and day-one archive.

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

Repo-root `.env` (gitignored; placeholders in `.env.example`): `BUZZ_RELAY_URL` (HTTP REST, **never** `ws://`/`wss://` — a hosted community's `wss://…` URL from the app becomes `https://…` for the CLI; `http://localhost:3000` is the local-sandbox default), `BUZZ_CHANNEL` (**the UUID**, never the name — and UUIDs are per-relay: switching relays means a new channel and a new UUID), `BUZZ_PRIVATE_KEY` (64-char hex or `nsec1…`; the CLI does not read `BUZZ_NSEC`), optional `BUZZ_CLI_BIN`. The agent npub lives in `TOOLS.md`; the private key never enters a tracked file.

### The relays — hosted home, local sandbox

**Hosted (the lane's home):** `https://luizfernando.communities.buzz.xyz` is a Block-operated multi-tenant community relay — nothing to start, stop, or back up on our side. Membership and roster are managed by the community owner from the Buzz apps (see Joining, below).

**Local (dev sandbox + day-one archive):** a machine-local compose stack from the `block/buzz` clone at `~/tools/buzz`, operated via `deploy/compose/run.sh` (Docker must be running; the stack needs its own `deploy/compose/.env` and refuses to start while any `CHANGE_ME` placeholder remains):

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

Buzz has **three membership planes with confusingly similar names**, and mixing them up is the #1 failure mode — it cost this integration its first hour against the hosted relay:

1. **Community/relay membership** — the outer gate every request passes; failing it is the `403 relay_membership_required` / exit 3.
2. **Channel membership** — *inside* the gate; an open channel is readable/postable by any relay member. Adding someone to a channel does **not** admit them to the relay.
3. **Invites** — pairing links that pend until *redeemed in an app*. Right for humans; a headless agent never redeems one.

The recipe:

- **Resolve the channel:** `buzz channels list` returns every channel with its `channel_id` — that UUID is what goes in `BUZZ_CHANNEL` and what every `--channel` flag takes. Names are never accepted, and UUIDs are per-relay.
- **Roster, hosted community:** the owner (or an admin) uses the community-level **Members → "Add someone directly"** dialog in the Buzz apps — paste the npub, pick the role. Not the "copy a link" half of that dialog (plane 3), and not a channel's own member list (plane 2). Under the hood this emits a NIP-43 kind:9030 admin event; the relay then republishes the kind:13534 roster snapshot. Verified live 2026-08-29: both agents admitted this way; a plain `member` could then create `#org-os-dev` itself.
- **Roster, local sandbox:** on the relay host, `./run.sh add-member <npub-or-hex> [--role member|admin]` (wraps `buzz-admin` in the relay container); `list-members` / `remove-member` complete the set. `sleep 1` between multiple adds, never parallel — same-second timestamps collide in the kind:13534 event.
- **NIP-OA owner delegation — the alternative designed for agents** (`crates/buzz-relay/src/api/mod.rs`, `buzz-sdk/src/nip_oa.rs`): the agent's requests carry `["auth", <owner-pubkey>, <conditions>, <sig>]`, where `sig` is the owner's BIP-340 signature over `nostr:agent-auth:<agent-pubkey>:<conditions>`. If it verifies and the owner is a member, the agent rides the owner's membership — no roster entry, scopable by kind and time window, revocable by the owner. Wire it via `BUZZ_AUTH_TAG`. Documented from source; **not yet exercised here** (direct roster adds were sufficient).
- **A second org-os instance:** generate a secp256k1 keypair (the CLI ships no keygen — `openssl ecparam -name secp256k1 -genkey` plus the x-only pubkey is enough; the roster takes hex), record the npub in that instance's `TOOLS.md` (key only in its `.env`), get rostered (above), fill `.env` (relay URL, channel UUID, key), and run `npm run buzz:doctor` until all four checks are green — the hooks then work unchanged. **Exercised 2026-08-29 twice:** the hub joined the local relay this way (read + post + cross-read verified), then both instances re-verified the identical loop against the hosted relay post-graduation. A cross-*machine* agent join remains unexercised, but nothing structural blocks it anymore — the hosted relay is reachable from any machine, so the recipe is the same everywhere.
- **A human teammate:** on the hosted community this is exactly what invite links are for — humans redeem them in the Buzz apps. The operator, as community owner, is in natively. The v2 direction (spec) additionally makes Berd's `buzz-handoff` skill the human window onto the channel — trigger: both lanes' acceptances passed *and* a second human wants in.

### The contract: VERIFIED.md and `CLI_MAP`

[`packages/buzz-integration/VERIFIED.md`](../../packages/buzz-integration/VERIFIED.md) is the lane's contract with reality: every CLI-facing behavior in `lib/buzz.mjs` (`CLI_MAP`, env vars, exit codes, output shapes) mirrors a row observed there against the live relay. The working rule:

1. `CLI_MAP` changes **only** to match a re-verified pin — never to track documentation, and never speculatively.
2. On any bump of the `buzz` binary (a Buzz.app update) or the relay image: re-observe the VERIFIED.md table first (send, get, `channels list`, exit codes, error shape), update VERIFIED.md, then reconcile `CLI_MAP` and the tests to it.
3. `modules/org-os-buzz/module.yaml` asserts VERIFIED.md exists via a `file-exists` check — do not delete or rename it.

The reconciliation history in that file is the cautionary tale: the original wrapper was built from documented defaults while Task 1 was deferred, and nearly every guess — binary name, transport, env var, verbs, flags — was wrong.

## What is NOT verified

- **The dogfood acceptance.** 0 of 5 consecutive real sessions where `/close` posts and `/initialize` reads with zero manual intervention (`HEARTBEAT.md` tracker). Until 5/5, the module stays `pilot` and "adopted in this instance" is not claimed.
- **Multi-party beyond two agents and their owner.** The second-instance join recipe was exercised live 2026-08-29 on both relays — the hub joined (roster add, doctor green, read + post + cross-read verified), and after graduation both agents re-verified the loop against the hosted community, where the operator sits as owner. Still unexercised: a cross-machine agent join, a *non-owner* human joining via invite link, the NIP-OA delegation path (`BUZZ_AUTH_TAG`), and the hub's first *hook-driven* post (a real `/close`, as opposed to the manual verification posts).
- **Non-Claude-Code surfaces.** The hooks exist on the Hermes and Berd surfaces but have never fired from them — `org-os-init` has never run under Goose (see [berd.md](berd.md)).
- ~~**Anything beyond localhost.**~~ **Gate passed 2026-08-29:** the spec's redaction review ran, the operator approved digests as-is, and the lane graduated to the hosted community (DECISIONS.md). Two CLI facts remain observed-but-unexercised: exit codes `4` (other) and `5` (write conflict), which `buzz --help` documents beyond the 0–3 in VERIFIED.md's table.

Buzz itself is a v0.4.x developer preview — surface drift is expected, and the pin + VERIFIED.md protocol above is the mitigation.

## Re-verification note

Re-run `npm run buzz:doctor` at any session start (the `/initialize` hook does this for you). Re-run the full VERIFIED.md observation pass on any binary or relay-image bump, per "The contract" above.
