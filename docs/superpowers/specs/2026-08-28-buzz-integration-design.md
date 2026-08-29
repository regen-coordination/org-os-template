# Buzz × org-os Integration — Design Spec

**Date:** 2026-08-28
**Status:** design approved (operator session 2026-08-28); build gated behind the v0.5 tag — enters the queue as v0.6 Active #4
**Buzz:** https://github.com/block/buzz — Block's self-hostable "hive mind" workspace (announced 2026-07-21; Apache 2.0; v0.4.x developer preview). One Nostr event log (NIP-01) carries chat, code collaboration, and workflows; every human and agent is a Schnorr keypair leaving signed, searchable events. Stack: Rust relay (Axum + Postgres/Redis/MinIO), Tauri desktop, Flutter mobile, `deploy/compose/` for self-hosting. Agent surfaces: `buzz-cli` (JSON in/out, built for LLM tool calls) and `buzz-acp` (ACP harness for Goose/Codex/Claude Code). Engineering post: https://engineering.block.xyz/blog/buzz · hosted option: buzz.xyz

## Goal

Adopt Buzz as a communication lane for org-os development — dogfooded in this instance: org-os sessions become first-class, cryptographically signed members of a Buzz community, posting what they did (`/close`) and reading what happened since (`/initialize`). The deeper fit: org-os is git-file event sourcing, Buzz is Nostr event sourcing; v1 cross-links the two logs — every digest event carries the SHA of the close commit it describes.

This resolves the "Buzz — pointer needed from operator" row in the interop surface matrix ([interop-plugin-architecture.md](../../agent-plans/interop-plugin-architecture.md)) and follows its principles: org-os stays the substrate, not the runtime; standards-first, bridges-second; integrations are modules with honest maturity labels.

## Decisions (locked)

| Question | Decision |
|---|---|
| V1 surface | **Agent-lane first** via `buzz-cli` — Buzz becomes a comms lane beside Telegram/Hermes. No workspace migration, no production relay operation. (Over: self-hosted-workspace-first — infra burden during release crunch; substrate-mapping-first — no lived dogfood.) |
| Relay | **Local dev relay** (Buzz compose stack, `ws://localhost:3000`). Keys and event log stay on this machine. Graduation to VPS/hosted is a v2 decision. |
| Sequencing | **Plan now, build after the v0.5 tag.** Spec + implementation plan + queue entry land now; no build before the tag (masterplan freeze respected). Slots in as v0.6 Active #4. |
| V1 loop | `/initialize` reads `#org-os-dev` since the last-read marker into session context; `/close` posts the session digest as a signed event tagged with the close commit SHA. |
| Bridge shape | **Approach B — bridge module `org-os-buzz`**: `packages/buzz-integration/` + `modules/org-os-buzz/module.yaml`, manifest-first, module #3 behind instance-doctor. (Over A: skill-hook-only prose — unreusable, unpromotable, a fourth extension mechanism; over C: ACP-native — the v2 direction, below.) |
| Protocol stance | Ride `buzz-cli` as Block's standard agent surface; never implement Nostr in-repo. Pin a buzz release in the manifest; re-verify documented behavior at build start (preview software). |
| Identity | One Schnorr keypair minted for the org-os agent. npub recorded in TOOLS.md; nsec only in `.env`. Human keypair (desktop app) optional, out of v1. |
| V2 direction | **Approach C, named:** `buzz-acp` — org-os sessions running inside Buzz as a member; shared relay opening the lane to Regen Knowledge Commons; approval-by-reaction on decisions; HEARTBEAT tasks as threads. Revisit trigger: 5-session acceptance passes **and** a second human wants in. |

## Architecture

```
┌────────────────────────── org-os repo ──────────────────────────┐
│  skills: /initialize ──reads──┐        /close ──posts──┐        │
│                               ▼                        ▼        │
│              packages/buzz-integration/  (thin Node wrapper)    │
│              lib/buzz.mjs · post-digest · read-since · doctor   │
│              modules/org-os-buzz/module.yaml  (module #3)       │
└───────────────────────────────┬─────────────────────────────────┘
                                │ shells out, JSON in/out
                                ▼
                          buzz-cli (pinned release)
                                │ NIP-01 over ws://localhost:3000
                                ▼
                 local Buzz relay (compose: Postgres/Redis/MinIO)
                        #org-os-dev channel · signed event log
```

Everything protocol-shaped lives in `buzz-cli` — the wrapper is one file deep, so preview-interface drift costs one file.

## Components

### `packages/buzz-integration/` (mirrors the `hermes-integration` precedent)

- `lib/buzz.mjs` — core API: `postEvent()`, `readChannel({ since })`, `status()`
- `scripts/post-digest.mjs` → `npm run buzz:post` — takes the `/close` digest, posts to `#org-os-dev`
- `scripts/read-since.mjs` → `npm run buzz:read` — messages since the last-read marker (`.buzz-state.json`, gitignored; falls back to a 24h window if corrupt/missing)
- `scripts/doctor.mjs` → `npm run buzz:doctor` — checks: buzz-cli present at pinned version, relay reachable, keypair present, channel joined

### `modules/org-os-buzz/module.yaml`

Manifest-first module #3, `lifecycle_status: experimental`, buzz-cli pinned as an external dependency. Registers right behind instance-doctor (#2) — a third real manifest is further pressure toward the v0.6 module engine while adding zero new mechanisms.

### Skill hooks

Both optional; both degrade to a one-line skip when unconfigured or the relay is down:

- `/initialize`: if `buzz:doctor` is green, render a "Buzz `#org-os-dev` since last session" block into session context.
- `/close`: after memory write **and commit**, post the digest.

Exact touchpoints (repo `skills/org-os-init/SKILL.md` vs user-level session skills) are resolved in the implementation plan.

## Data flow

- **Close:** write memory → commit → `buzz:post` publishes the digest event **tagged with the commit SHA** → relay stores it signed. The Buzz log becomes a cryptographically signed mirror of session history, cross-linked to the repo. If the post fails, the close still succeeds; the failure is noted for the next session.
- **Initialize:** `buzz:read` fetches `#org-os-dev` since the marker → rendered into the dashboard context → marker advances.

## Config & keys

- `.env` (gitignored): `BUZZ_RELAY_URL=ws://localhost:3000`, `BUZZ_NSEC=<agent secret key>`, `BUZZ_CHANNEL=org-os-dev`. `.env.example` gains placeholder lines (same pattern as `NOTION_API_KEY`).
- `TOOLS.md` → Communication Channels gains a `### Buzz` section: relay URL, channel, agent npub — no secrets, per the file's own rule.
- **Safety gate:** the lane points at the *local* relay only. Before it ever points at a shared or hosted relay, a redaction review of digest content is required — session digests are org-internal, and draft-and-present applies to anything leaving the machine.

## Error handling

| Failure | Behavior |
|---|---|
| Relay down (local compose not running — will be common) | Hooks print `buzz: relay unreachable — skipped`; session lifecycle proceeds. `/close` can **never** fail because of Buzz. |
| buzz-cli missing / version drift | `buzz:doctor` catches it; hooks check once and skip quietly. |
| Preview-software drift (Buzz is v0.4.x) | buzz-cli pinned in `module.yaml`; build task 1 re-verifies documented behavior against the pin. |
| Last-read marker corrupt/missing | Fall back to a 24h window. |
| Post fails after commit | Close succeeds; failure recorded; next session may re-post. |

## Testing & acceptance

- **Unit:** wrapper functions against fixture JSON (buzz-cli mocked).
- **Integration (scripted, local):** compose relay up → `buzz:doctor` green → post event → read it back → assert content + signature + SHA tag.
- **Dogfood acceptance (the real gate):** **5 consecutive real sessions** where `/close` posts and `/initialize` reads with zero manual intervention. Only then is "adopted in this instance" claimed.
- `npm run validate:structure` passes with module #3 registered.

## Sequencing

**Now (pre-tag):** this spec committed · implementation plan written · queue gains **buzz-integration** as v0.6 Active #4 · interop matrix row updated. No build.

**Post-tag build order:**
1. Pin + spike-verify — relay up via compose, mint keypair, post and read back one hello event (the feasibility check deferred at planning time)
2. Package + module manifest
3. Skill hooks
4. 5-session dogfood acceptance
5. Graduation checkpoint — VPS/hosted relay + Approach C exploration, only on trigger

## Constraints honored

- **Substrate, not runtime** — Buzz brings a coordination surface; the repo stays canonical. No org truth lives only in Buzz.
- **Standards-first** — buzz-cli is Block's own agent-standard surface; no bespoke Nostr code.
- **Honest maturity** — `lifecycle_status: experimental`; Buzz itself labeled as a developer preview throughout.
- **Release freeze** — nothing in this spec authorizes pre-tag build work.

## Reconciliation (2026-08-29)

Task 1 (deferred at build time — Docker/just/hermit/buzz-cli/goose were all
absent from the build machine) ran against a live local relay. Nearly every
documented guess in the shipped wrapper was wrong. The real surface, recorded
in full in `packages/buzz-integration/VERIFIED.md`:

- The binary is **`buzz`**, not `buzz-cli`.
- The relay is an **HTTP REST** endpoint (`POST /query`) at
  `http://localhost:3000` by default — not a websocket; `ws://` was wrong.
- The identity env var is **`BUZZ_PRIVATE_KEY`** (accepts 64-char hex or
  `nsec1…` bech32) — the CLI does not read `BUZZ_NSEC` at all.
- The verbs are `messages send`, `messages get`, and `channels list`/`create`
  — not the single-word `post` / `read` / `status` guessed in the plan.
  `--channel` takes a UUID, never a channel name.
  There is **no `--json` flag** (stdout is always JSON) and **no `status`
  subcommand** (`channels list` is the connectivity/auth probe).
- Exit codes are real and distinguishable: `0` success, `1` bad input, `2`
  relay/network error (retryable), `3` auth error — `status()` now reports
  "no key" vs "relay down" precisely instead of guessing from one bundled
  probe.

**Provenance design change, approved by the operator:** the `--tag` flag this
spec's Decisions table implicitly assumed (tagging each event `sha=`,
`source=`, `truncated=`) does not exist on the real CLI. Provenance is
carried instead as a machine-readable trailer appended to the message
content itself, separated from the digest body by a blank line:

```
org-os: sha=<short-sha> source=org-os-session truncated=<true|false>
```

Content is part of the signed event, so provenance still survives in the
permanent log and is greppable on read-back — the original design's intent
(a cryptographically signed, SHA-cross-linked mirror of session history) is
preserved; only the transport of that provenance changed. The original
Decisions table above is left as-is (it recorded the *intent*, not a flag
that turned out not to exist); this section is the correction.

`packages/buzz-integration/lib/buzz.mjs`, its scripts, and
`tests/buzz-integration/` were reconciled to the verified surface in the same
pass. See `packages/buzz-integration/VERIFIED.md` for the full command/output
table and git history for the exact diff.
