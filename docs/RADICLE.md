# RADICLE.md — rad-org-os operator guide

`rad-org-os` is the Radicle-canonical path through org-os: instead of GitHub +
`git`, an instance's canonical repository lives on the
[Radicle](https://radicle.xyz) peer-to-peer network, addressed by a `rad:` RID
instead of a `github.com/<org>/<repo>` URL, governed by Radicle's native
identity-doc quorum instead of branch-protection rules, and (optionally) run with
an open-model agent runtime instead of a proprietary one. It is **additive**: every
existing github-canonical instance is unaffected — `platforms.canonical` defaults
to `github`, and `resolveDriver`/`resolveRemoteScheme` (`@org-os/host`) fall back to
the github driver whenever no `rad:` id is present.

This doc is the operator-facing companion to the design spec
([`docs/superpowers/specs/2026-07-20-rad-org-os-design.md`](superpowers/specs/2026-07-20-rad-org-os-design.md))
and its four implementation plans
([roadmap](superpowers/plans/2026-07-20-rad-org-os-ROADMAP.md)). Read those for the
architecture and research; read this for "how do I actually run one."

## What ships

- **`@org-os/host`** — the `HostDriver` interface + registry + resolver
  (`resolveDriver`, `resolveRemoteScheme`), keyed on `federation.yaml
  platforms.canonical`. Registers a behavior-preserving `github` driver by default.
- **`@org-os/rad`** (`packages/rad-org-os`) — the Radicle `HostDriver`: reads via the
  `radicle-httpd` JSON API (degrade gracefully — never throw on a read), writes via
  the `rad` CLI (fail loudly with a `WriteUnavailableError` + actionable hint when
  `rad` is missing or the local node is down — never a silent HTTP fallback).
- **`rad-bootstrap`** — zero → live self-owned org-os on Radicle, no GitHub account
  required.
- **A seed-node recipe** — Docker + Tor profile + a 3-tier availability chooser.
- **Governance mapping** — `governance.proposal_threshold` → the identity-doc
  `threshold` over `delegates` (main's quorum, natively enforced by Radicle — no
  explicit `crefs` rule is possible for the default branch); `buildCrefs()` for
  *additional* protected ref patterns (e.g. release tags).
- **Command routing** — `/commit /sync /handoff /close /initialize` each gained a
  "Radicle-canonical variant" section (`.claude/commands/*.md`) alongside their
  existing github instructions.
- **Data-model additions** — see `docs/DATA-MODEL.md` for the additive `did` (member
  id scheme), `rid` (instances/peers), and `canonical`/`seed_node` (federation.yaml
  platforms) fields.

## Quickstart: zero → live

```bash
node packages/rad-org-os/bootstrap/cli.mjs ./my-org \
  --name my-org --private --seed https://my-node.example
```

This needs a running local `rad` node (`rad node start`) and a passphrase
(`RAD_PASSPHRASE`) — it is an **operator-gated** live action, same as any real
network write. What it does:

1. `rad self` → reads your node's real `did:key` (your member id — see
   `docs/DATA-MODEL.md`'s id-scheme rule).
2. Git-inits the target dir, writes the genesis files (`members.yaml`,
   `federation.yaml`, …), makes the genesis commit.
3. `rad init` → registers the repo, mints the RID (`rad:z...`).
4. Stamps the genesis commit's oid into `federation.yaml metadata.genesis_commit`
   (`packages/rad-org-os/bootstrap/rad-bootstrap.mjs` + `bootstrap/generate.mjs`
   `buildGenesisStamp`).

Then run a seed node (below) so your repo stays reachable while you're offline.

## Seed node + availability

Your local node only serves your repo while it's running. A **seed node** — a
lightweight `rad-node` you leave running (a $5 VPS, a spare machine, or a managed
service) — keeps it fetchable at all times. The recipe lives in
`packages/rad-org-os/seed-node/` (`Dockerfile`, `compose.yml`, `compose.tor.yml`,
`seeding-policy.md`).

Three availability tiers (`packages/rad-org-os/bootstrap/availability.mjs`), most
sovereign first:

| Tier | What | Private repos? | Trust |
|---|---|---|---|
| `self-hosted` | Our Docker recipe, your own box | Yes | none — maximum sovereignty |
| `garden` | `radicle.garden` managed node (€4.99/mo) | Yes, with a caveat | garden operators |
| `public` | Core-team public seeds (iris / rosa / seed.radicle.xyz) | **No** — public repos only | public |

**Honest framing, read before choosing "private":** Radicle's `--private` gives
**selective replication**, not encryption at rest. A private repo is invisible to
nodes off its allow-list, but every allow-listed node — including a managed seed
like Garden — can read the full plaintext content. Low-threat groups wanting
reliability can use a managed or self-hosted seed interchangeably; high-threat
organizing should self-host with the Tor profile (`compose.tor.yml`) and add no
third-party seeds to the allow-list. See `seed-node/seeding-policy.md` for the full
statement.

## Runtime: open-model by default, Claude by choice

`rad-bootstrap` writes `federation.yaml agent.runtime: open-model` by default on the
Radicle-first path — a new group's stack is Radicle + open-model end-to-end unless
an operator opts into something else. Choosing Claude (or any other agent) is a
config choice, not a hard dependency anywhere in `rad-org-os`. The local-LLM runtime
itself (model selection, inference hosting) is out of scope here — it's a separate
module planned near `org-os-hermes`; this package only guarantees the driver/CLI
layer never assumes a proprietary model or host.

### Sovereign-runtime audit — verified

Grepped the Radicle-native command paths and `@org-os/rad` for hard Claude/Anthropic
assumptions:

```
grep -riE 'anthropic|claude' packages/rad-org-os .claude/commands
```

Result: `packages/rad-org-os` (the driver, bootstrap, seed-node, governance, and
their tests) has **zero** hits — nothing in the package assumes a specific model or
vendor. The only hits in `.claude/commands/*.md` are prose that names "Claude Code"
as one of several coding agents a human might be using (alongside OpenCode, Cursor,
Zed) when following the command's instructions — descriptive, not load-bearing; the
git/rad commands themselves work identically regardless of which agent runs them.
**Runtime-agnostic: verified** — no fix required.

## Agent-facing `rad` guidance (`rad-skill`)

rad-org-os's command skills drive the `rad` CLI directly, so an agent operating a
Radicle-canonical instance needs guidance on `rad` workflows (`rad issue`, `rad
patch`, `rad sync`, `rad id`, seeding). Rather than author this from scratch, we
build on **`rad-skill`** — an external Claude Code plugin, *"guidance for Radicle — a
peer-to-peer code collaboration protocol"*:

- **RID:** `rad:zvBj4kByGeQSrSy2c4H7fyK42cS8`
- **Delegate:** `hdh` (did:key `z6Mkfu…qT9n`), public, threshold 1
- **Distribution:** seeded on `iris.radicle.network` — itself agent tooling shipped
  over Radicle rather than a GitHub marketplace, a live proof-of-thesis for the
  sovereign-distribution story this package tells.

**Adoption mode: adopt.** `rad-skill` is Claude-Code-specific, which tensions with
org-os's runtime-agnostic goal, so we treat its `rad`-workflow *content* as the
reusable asset — re-expressed as a runtime-neutral org-os skill under `skills/` —
rather than vendoring it wholesale. It's registered as a `candidate` in
`data/skills-matrix.yaml` pending that re-expression work (tracked as Open Decision
5 in the design spec — adoption still needs the plugin's full contents retrieved via
`rad clone rad:zvBj4kByGeQSrSy2c4H7fyK42cS8` or the httpd tree API, plus a licence
check, before the runtime-neutral skill can be authored).

## Live verification (operator-gated)

The **read** path needs no key and is verified against a public seed any time:

```bash
cd packages/rad-org-os && RAD_INTEGRATION=1 node --test test/integration.test.mjs
```

The **write** path (bootstrap-create, `rad id update`) signs with your Radicle key, so
it needs your passphrase — supplied via the environment so it never lands in the repo:

```bash
RAD_PASSPHRASE='…' bash packages/rad-org-os/scripts/live-verify.sh
```

That runner starts your node, runs the gated bootstrap end-to-end (creating a private
scratch repo in `~/.radicle` storage — unannounced, harmless), prints the governance
apply commands, and stops the node. Governance (`threshold` / `crefs`) is applied
interactively via `rad id update`; `main`'s quorum *is* the identity `threshold`
(Radicle disallows an explicit `crefs` rule for the default branch), and `buildCrefs()`
in `src/governance.mjs` generates the `xyz.radicle.crefs` payload for additional
protected ref patterns (e.g. release tags).

## Cross-references

- Design spec: [`docs/superpowers/specs/2026-07-20-rad-org-os-design.md`](superpowers/specs/2026-07-20-rad-org-os-design.md)
- Roadmap (4 plans): [`docs/superpowers/plans/2026-07-20-rad-org-os-ROADMAP.md`](superpowers/plans/2026-07-20-rad-org-os-ROADMAP.md)
- Data-model additions: [`docs/DATA-MODEL.md`](DATA-MODEL.md)
- Federation protocol (base, github-canonical): [`docs/FEDERATION.md`](FEDERATION.md)
