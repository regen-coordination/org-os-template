# rad-org-os — Radicle Backend for org-os — Design Spec

**Date:** 2026-07-20
**Status:** Approved design, ready for implementation plan
**Packages:** `packages/org-os-host` (NEW — the host-provider interface) · `packages/rad-org-os` (NEW — the `radicle` driver + all sovereign-infra deliverables)
**Module name (pre-existing):** `rad-org-os` — listed `in-dev` at `docs/POSITIONING.md:122` and `site/src/data/modules.yaml:13` ("Radicle-native sovereign p2p infrastructure for grassroots orgs"). This spec is that module's full design.
**Workstream:** federation-protocol (new sub-track: sovereign-infra)

## Summary

Make org-os able to **fully run on [Radicle](https://radicle.xyz) instead of GitHub** — peer-to-peer git hosting, collaboration, and identity on the Heartwood protocol — so the framework and its agents can be adopted by activist, community, and political organizing groups who need sovereignty, privacy, and censorship-resistance rather than a dependence on a centralized host.

The shape is **one backend module the whole federation can flip to, plus a Radicle-first bootstrap path so new communities never touch GitHub** ("A-with-B packaging"):

- **A — a host-provider abstraction.** A new `@org-os/host` package defines a `HostDriver` interface. Every script and command skill that currently shells `git`/`gh` or fetches from `raw.githubusercontent.com` is refactored to call the interface. Two drivers implement it: `github` (a behavior-preserving wrapper of today's behavior) and `radicle` (new). `federation.yaml → platforms.canonical` selects the active driver per repo.
- **B — a Radicle-first bootstrap.** A `rad-bootstrap` command + a self-hostable seed-node recipe let a new group go from nothing to a live, self-owned org-os whose home, identity, and governance are all their own keys and node — no GitHub account, no proprietary model required.

**Ships (v1 = Tiers 1+2):** the host interface + both drivers; the `rad-org-os` package (rad-CLI write path, radicle-httpd read path, COB mapper, did:key identity); `rad-bootstrap`; a seed-node recipe with three availability tiers; a did:key identity model mapped onto org-os governance via Radicle's native identity document and `xyz.radicle.crefs` quorum rules; the four write commands (`/commit /sync /handoff /close`) and `/initialize` routed through the driver; additive federation/data-model fields; `.well-known/` served from the org's own node; and a thin "sovereign-runtime" audit guaranteeing nothing rad-org-os ships assumes a proprietary model or host.

**Deferred (Tier 3 — designed, not built):** replacing the three GitHub Actions workflows with `radicle-ci-broker` adapters, and the full GitHub-Pages → node hosting rebuild. Designed so nothing blocks them; the seed-node recipe is where CI lands later.

**Separate module (out of scope):** the actual local-LLM runtime (model selection, inference hosting). rad-org-os only guarantees runtime-agnosticism; the runtime itself belongs near `org-os-hermes`.

## Context: what exists today

From a full codebase sweep, the GitHub coupling is not just hosting — it is also the **identity layer** and the **collaboration model**:

- **Identity = GitHub handle.** Member/lead IDs are literally `github:luizfernandosg` in `data/members.yaml:11` and every `.well-known/*.json`. The DID slot exists but is explicitly deferred (`docs/superpowers/research/2026-05-02-autopoiesis/02-identity.md:58`: "No instance today has a verifiable identity beyond a GitHub URL"). org-os has **zero cryptographic signing** today.
- **Remote scheme.** `repos.manifest.json` (9 hardcoded `github.com` `.git` URLs, consumed by `scripts/clone-linked-repos.mjs`); `federation.yaml` peer/downstream `url`/`repo` slugs + `hub`; `federation.yaml.upstream[].url` consumed by `scripts/sync-upstream.mjs`.
- **Frontier fetch.** `packages/org-os-kms/src/frontier.mjs:38` fetches each peer's `federation.yaml` from `raw.githubusercontent.com`.
- **Collaboration model.** `/commit /sync /handoff /close` (dual-defined at `.claude/commands/*.md` → `skills/commands/*/SKILL.md`) assume `origin`/`main` + GitHub PRs, trunk-per-operator. `/handoff` hardcodes a `github.com/<org>/<repo>/blob/main/<path>` URL (`skills/commands/handoff/SKILL.md:21`). `/initialize` runs a session sync against `@{u}` and renders a peers panel.
- **Automation & hosting.** Three GitHub Actions workflows (`validate.yml`, `drift.yml` auto-commit, `generate-schemas.yml` auto-commit); `.well-known/dao.json` hardcodes `organizational-os.github.io` URIs; `federation.yaml platforms.deployment: github-pages`.
- **Provenance.** The lineage stamp (`federation.yaml.metadata.genesis_commit` / `last_sync_commit`, plain SHAs) is validated for *shape* by `scripts/validate-identity.mjs` — no signatures.
- **Prior art in-repo.** The KMS connector-layer plan (`docs/superpowers/plans/2026-07-19-org-os-kms-connector-layer.md`) already specs a **stub Radicle connector** in `@org-os/kms` — but scoped to *knowledge ingestion* (COB → signal). This spec keeps that connector read-only/ingestion-side and does **not** fuse hosting/collaboration into it.

## Research basis (Radicle, 2025–2026 — adversarially verified)

Verified by direct fetch of `radicle.dev` docs and the live `seed.radicle.xyz` radicle-httpd API (18 claims, majority at 3-0 adversarial votes; see Appendix A). The load-bearing facts:

1. **The httpd API is read-only.** Upstream `radicle-httpd` (live: v0.25.0, apiVersion 6.1.0) removed all write endpoints; only a community fork keeps them. **Consequence:** reads go over HTTP JSON API; **writes must shell out to the `rad` CLI.** This asymmetry is baked into the driver contract.
2. **Governance is native and quorum-based.** Each repo has an identity document at `refs/rad/id` = delegates (did:key) + a signature `threshold`; the RID is derived from the *initial* doc, so it is stable while the doc mutates (self-certifying, TUF-inspired). Radicle 1.3.0 (Aug 2025) added `xyz.radicle.crefs` — per-ref-pattern protected-branch rules with a DID allow-list + quorum threshold. Delegates can explicitly be **bots**.
3. **"Private" = selectively replicated, not encrypted at rest.** `rad init --private` + a DID allow-list (`rad id update --allow`) + ChaCha20-Poly1305 transport — but any allow-listed node and every delegate can read the full contents. High-threat users get a Tor / no-trusted-seed setup.
4. **Identity is per-device did:key** (Ed25519). No device-linking yet; each device/agent is its own DID.
5. **Self-hosting is cheap.** Seed node = Linux VPS, 1–2 GB RAM, shared CPU, 10 GB disk, public static IP, port 8776. Two seeding policies (open/selective).
6. **CI is node-operator-coupled.** `radicle-ci-broker` runs alongside a node, event-driven over a Unix socket, dispatching to adapters (webhooks, GitHub Actions, Woodpecker, Kraken). Opt-in per seed-node operator, not per-repo.
7. **Project health is good.** Releases 1.2→1.5 across 2025; ~$7M Radworks-funded to date; RAD governs the Radworks treasury; `radicle.garden` managed-node service now stewarded by **The Better Internet Foundation** (Swiss non-profit).

## Architecture

### The host-provider seam (Approach A)

One new package, `@org-os/host`, defines the `HostDriver` interface and a resolver. Everything that touches `git`/`gh`/`raw.githubusercontent` calls the interface; drivers are selected by `federation.yaml → platforms.canonical`.

```
packages/
  org-os-host/                 # @org-os/host — interface + driver registry + resolver
    src/
      driver.mjs               # HostDriver contract (JSDoc-typed) + registry
      resolve.mjs              # picks driver from federation.yaml platforms.canonical
      github/driver.mjs        # wraps today's git + gh behavior (behavior-preserving)
      radicle/driver.mjs       # thin — re-exports from @org-os/rad
  rad-org-os/                  # @org-os/rad — radicle driver + all B/C deliverables
    src/
      driver.mjs               # implements HostDriver
      rad-cli.mjs              # WRITE path — shells `rad`, one execRad() chokepoint
      httpd.mjs                # READ path — radicle-httpd JSON API client
      cob.mjs                  # COB <-> registry mapper (collaboration, not ingestion)
      identity.mjs             # did:key minting + delegate/threshold model
    bootstrap/
      rad-bootstrap.mjs        # Radicle-first genesis
    seed-node/
      Dockerfile  compose.yml  compose.tor.yml  seeding-policy.md
```

### The `HostDriver` interface

The read/write split is part of the contract because the httpd API is read-only and only `rad` can write:

```js
HostDriver {
  // identity & addressing
  resolveRemote(idOrUrl) -> { scheme, fetchUrl, canonical }   // "github:" | "rad:"
  whoami() -> { id, did?, handle? }

  // READ path  (github: git/gh · radicle: radicle-httpd JSON API)
  clone(remote, dest)
  fetchFile(remote, path, ref?) -> string      // replaces frontier.mjs raw-GitHub fetch
  listPeers(remote) -> Peer[]                   // delegates/seeds <-> collaborators
  getCanonical(remote) -> { defaultBranch, threshold, delegates[] }
  getDrift(remote) -> { behind, ahead, canonicalRef }   // for /initialize + /sync

  // WRITE path  (github: git push + gh · radicle: rad CLI shell-out)
  push(branchOrPatch)
  openChange({title, body, base}) -> ChangeRef  // github PR <-> rad patch
  createIssue(cob) / commentIssue(...)          // github issue <-> xyz.radicle.issue COB
  syncUpstream(upstreamRef)                      // github fetch/merge <-> rad sync
  webUrl(remote, path) -> string                // github blob URL | app.radicle.xyz URL
}
```

**Refactored call sites (behavior-preserving for the GitHub cohort):** `scripts/clone-linked-repos.mjs`, `scripts/sync-upstream.mjs`, `scripts/sync-github.mjs` (→ `sync.mjs`), `packages/org-os-kms/src/frontier.mjs:38`, and the command skills `/commit /sync /handoff /close /initialize`. Each becomes a call to `resolveDriver(repo).<method>()` instead of a direct git/gh shell-out. The `github` driver reproduces current behavior exactly; verified against current behavior before the `radicle` driver is wired.

### The `radicle` driver internals (`@org-os/rad`)

- **`rad-cli.mjs` (write path).** Thin wrapper over `rad`; every mutating method routes through one `execRad({cmd,args})` chokepoint (mockable without a node). Mappings: `push()` → `git push rad`; `openChange()` → `rad patch` (returns patch ID as `ChangeRef`); `createIssue`/`commentIssue` → `rad issue open`/`rad issue comment`; `syncUpstream()` → `rad sync` + pull from the upstream RID's canonical branch; `clone()` → `rad clone <rid>`.
- **`httpd.mjs` (read path).** Client for `radicle-httpd` (API v6.1.0), pointed at the org's own seed node with public seeds as fallback for *public* repos only. `fetchFile` → `GET /api/v1/repos/:rid/blob/:ref/:path`; `getCanonical` → `GET /api/v1/repos/:rid`; `listPeers` → identity-doc delegates + `/api/v1/repos/:rid/nodes`. Read-only by contract.
- **`cob.mjs` (COB ↔ registry, collaboration side).** Bidirectional: `xyz.radicle.issue` ↔ org-os issue/idea; `xyz.radicle.patch` ↔ a change; preserves the COB OID in `source_lineage`. Distinct from the KMS ingestion connector.
- **`identity.mjs` (did:key + delegates).** Wraps `rad auth` (Ed25519 → did:key); reads/writes the identity doc's delegate set + threshold; `addDelegate(did)` / `setThreshold(n)`. Handles "agent is its own DID."

**Hard rule — writes fail loudly, never silently fall back to HTTP.** Because upstream httpd is read-only, if `rad` isn't installed or the local node is down, writes error with an actionable message ("start your node" / "install rad") rather than degrading. This keeps the sovereignty guarantee honest: writes always go through the operator's own signed node. Reads may degrade to a public seed (public repos) or to "last known" cached state.

## Identity & governance

### Member identity — scheme tracks canonicality

A member `id` is a URI whose scheme must match the instance's `platforms.canonical`:

- **Radicle-first instances** mint members as `did:key:z6Mk…` from genesis, with `handles.github` as an optional alias.
- **Migrating instances** keep `github:` IDs, add a `did` field on adoption, and flip the canonical `id` to `did:` only when the instance flips `platforms.canonical`.
- `.well-known/*.json` generation emits the id matching the canonical scheme. `scripts/validate-identity.mjs` gains a coherence check: member-id scheme ↔ canonical platform.

### The org's identity IS the Radicle identity document

We map onto Radicle's native model rather than inventing an identity layer:

| org-os concept | Radicle mechanism |
|---|---|
| `governance.maintainers[]` | identity-doc `delegates[]` (did:key) |
| `governance.proposal_threshold` | identity-doc `threshold` |
| an org-os agent as a governed actor | a delegate whose DID is the agent's key (bots are first-class) |
| protected `main` / PR-to-main gate | `xyz.radicle.crefs` rule on `refs/heads/main` (allow-list + quorum threshold) |
| stable org identity across delegate churn | RID (derived from the *initial* identity doc — self-certifying) |

**Quorum-governed `main`.** Today `/commit`'s "never commit to main, PR-gated" is a *convention* checked by a skill. On Radicle it becomes *protocol-enforced*: a `crefs` rule on `refs/heads/main` means main cannot advance without a quorum of delegate signatures. `federation.yaml governance.proposal_threshold` → the `crefs` threshold; shared structural files (`data/*.yaml`, `.well-known/`, `federation.yaml`) live behind it. The default-branch rule is synthesized from `threshold`+`delegates` automatically (the protocol disallows an explicit override), so we author `crefs` only for *additional* protected patterns.

**Signed provenance — the lineage stamp gets teeth.** Every published ref is signed under `refs/rad/sigrefs` by the pushing DID. On a Radicle-canonical instance the lineage stamp is automatically backed by delegate signatures; `validate-identity.mjs` can verify genesis/sync commits were signed by a delegate DID — turning "trust the SHA" into "verify the signature," with no new crypto code from us.

**Multi-device reality.** did:key is per-device with no linking yet, so a human with laptop + phone + a server-side agent has three DIDs. The identity doc lists whichever should be delegates; the rest are contributors. `identity.mjs` documents this as the normal multi-device story.

## Bootstrap & seed-node deliverables (Approach B / C)

### `rad-bootstrap` — Radicle-first genesis

The Radicle analogue of `scripts/clone-framework.mjs`. One command takes a group from nothing to a live self-owned org:

1. `rad auth` → mint the operator's `did:key` (sovereign identity — no account, no server).
2. Scaffold org-os framework files (reuse `clone-framework.mjs` copy logic).
3. `rad init --private` (default for activist groups) or `--public` → create the RID, register the `rad` remote, write the identity doc (operator = sole delegate, threshold 1).
4. Mint `data/members.yaml` with the operator as `did:key:…` (canonical from genesis).
5. Write `federation.yaml` with `platforms.canonical: radicle`, the RID as the repo address, and the org's seed node as the primary httpd endpoint.
6. Author the `crefs` protected-`main` rule from the initial threshold.
7. Genesis stamp: `metadata.genesis_commit` = the first signed commit's OID.

### Seed-node recipe — the org's sovereignty anchor

Dockerized `radicle-node` + `radicle-httpd`, runnable on any \$5 VPS or spare laptop (verified requirements: 1–2 GB RAM, shared CPU, 10 GB disk, public static IP, port 8776). Contents: `Dockerfile` + `compose.yml` (node + read-only httpd gateway); a **seeding-policy** config (`rad seed`/`unseed` — seeds the org's own repos + chosen peer repos, keeping federation repos available); a **public-reach** path (public repos additionally announce to `iris.radicle.network`/`rosa.radicle.network` while the org's node stays authoritative); and a **Tor `compose.tor.yml`** profile for high-threat use that needs no trusted seed.

### Availability spectrum (Q6)

`rad-bootstrap` presents these as a step-2 choice; `httpd.mjs` reads interchangeably from any (same `radicle-httpd` API):

| Tier | Option | Sovereignty | Ops | Trust surface | Best for |
|---|---|---|---|---|---|
| 1 | **Self-hosted seed node** (our recipe) | Maximum | You run it | None | Default; any group that can run one container |
| 2 | **radicle.garden** managed node (€4.99/mo) | High (keep keys) | Zero | Garden operators + at-rest caveat | Non-technical groups wanting reliability without infra |
| 3 | **Public core-team seeds** (iris / rosa) | Reach only | Zero | Public, no control | Public repos — discovery, not a home |

**Honest framing (required in docs):** "private" = selective replication (invisible/inaccessible to non-allow-listed nodes) but **not encryption at rest** — every allow-listed node and every delegate can read the repo. `radicle.garden` reintroduces a commercial third party under the same at-rest caveat, so it is the *reliability* option, not the *censorship-resistance* option. High-threat activist groups are pointed to self-hosted or the Tor profile.

**Not recentralized:** the federation runs one seed node (serves the frontier API + seeds public framework repos), but each org runs its own; the federation node is a convenience mirror for public content, never the home of anyone's private repo.

## Collaboration workflow & dual-stack canonicality

### Command mapping

| Command | GitHub today | Radicle (via driver) |
|---|---|---|
| `/commit` | commit to operator trunk, push `origin`, PR structural files | `git push rad` on operator's branch; structural changes → `rad patch` against quorum-gated `main` |
| `/sync` | `git fetch origin` + `merge --ff-only` | `rad sync` + fast-forward from canonical branch |
| `/handoff` | paste-prompt → clone, PR to main; `github.com/…/blob/main/…` link | paste-prompt → `rad clone <rid>`, edit, `rad patch`; `driver.webUrl()` → `app.radicle.xyz/…` link |
| `/close` | commit session memory, push `origin` | `git push rad` (memory is a normal signed push) |
| `/initialize` — session sync | fetch + behind/ahead vs `@{u}` + optional `pull --rebase` | `rad sync`, then behind/ahead via `driver.getDrift(rid)` against the canonical branch |
| `/initialize` — dashboard | local git plumbing + peers from raw-GitHub frontier | local git plumbing **unchanged** (a Radicle repo is a normal git repo); peers panel via `driver.listPeers()` |

**Notes.** (1) `/handoff`'s hardcoded `github.com/…/blob/main` line becomes `driver.webUrl(rid, path)`. (2) Patch-per-operator replaces trunk-per-operator — each operator's refs already live under their node namespace (`refs/namespaces/<nid>/…`) and a `rad patch` *is* the proposal; the "never commit to main" guard becomes protocol-enforced, so the skill's convention-check degrades to a reminder. (3) The `@{u}` assumption breaks (no GitHub-style upstream on a Radicle repo) but the local git plumbing does not — `getDrift` supplies the reference point, and the existing vault-safe "report, don't block" rules carry over. (4) **Offline is the normal case, not an error** — the dashboard renders fully from the local repo with the node down; unreachable seed = soft "last known" state.

### Dual-stack during migration (Q4)

A migrating repo has both `origin` (GitHub) and `rad` remotes. `platforms.canonical` decides authority:

- `canonical: github` → commands behave exactly as today; a post-commit hook mirrors to `rad` (best-effort, non-blocking).
- `canonical: radicle` → commands route to the `radicle` driver; a hook mirrors to `origin` for reach.
- The lineage stamp (`last_sync_commit`) always points at the canonical side.

Mirroring is **one-directional per canonicality and best-effort** — a failed mirror never fails the canonical write; it retries on the next command. No two-way sync (a conflict-generating trap we avoid).

**Cohort split (Q4/Q5):** new Radicle-first instances are Radicle-canonical from genesis; existing repos (org-os framework, refi-bcn-os, refi-dao-os, regen-coordination-os, the hub) stay GitHub-canonical with a rad mirror and flip when their operator opts in. No forced migration.

## Federation & data-model changes

All additive — no registry rewrite:

- **`federation.yaml`:** new `platforms.canonical: github | radicle` and `platforms.seed_node` (the org's httpd endpoint); peers/downstream/upstream each gain an optional `rid: "rad:z…"`. The resolver prefers `rid` when canonical is radicle, else the github `url`.
- **`repos.manifest.json`, `hub`, `upstream[].url`:** each gains an optional `rid` sibling. `clone-linked-repos.mjs` routes through the driver, so a `rid` entry clones via `rad clone`.
- **Frontier crawl:** `frontier.mjs:38` reads each peer's `federation.yaml` via `driver.fetchFile(rid, 'federation.yaml')` over httpd. `data/federation/frontier/*.json` cache format unchanged.
- **`members.yaml`:** `did` field + the id-scheme rule. **`instances.yaml`:** `rid` + per-instance `canonical`.
- **`.well-known/dao.json`:** the hardcoded `github.io` URIs become templated off `platforms.seed_node`, so a Radicle-canonical org serves discovery from its own node (`GET /api/v1/repos/:rid/blob/HEAD/.well-known/…`). This is the one Tier-3-adjacent piece done in v1 — a URI-template change, because discovery can't depend on GitHub Pages for a GitHub-free cohort. The full hosting rebuild stays Tier 3.
- **Validation/generation:** `validate-identity.mjs` + `validate-structure.mjs` gain Radicle-aware checks; `generate:schemas` / `generate:quilt` read the canonical scheme.

## Sovereign-runtime compat layer (thin — the "B" half of Q2)

- **Runtime-agnostic audit:** verify skills and command bodies don't hard-assume Claude/Anthropic; fix any Claude-only assumptions found on the Radicle-native command paths. `federation.yaml agent.runtime` already exists.
- **Bootstrap default:** `rad-bootstrap` writes `agent.runtime` to an open-model option by default in the Radicle-first path, so a new group's stack is Radicle + open-model end-to-end — while an operator may still choose Claude.
- **Out of scope:** building/packaging a local-LLM runtime, model selection, inference hosting (separate future module near `org-os-hermes`).

## Error handling & degradation

- **Writes:** fail loudly with actionable errors when `rad` is missing or the node is down. Never fall back to HTTP writes (upstream httpd is read-only).
- **Reads:** degrade — public repos fall through to a configured public seed; otherwise return cached "last known" state. Private repos never touch public seeds.
- **Offline / local-first:** the normal operating mode. `/initialize` and dashboards render fully from the local repo; seed unreachability is a soft state, not a failure.
- **Mirroring:** best-effort, one-directional; failures are logged and retried, never block the canonical write.
- **Vault safety:** all existing vault-safe rules (never stash/clean/reset-hard, snapshot before large operations) are preserved; the driver never introduces a destructive git op.

## Testing strategy

- **Unit — write path:** mock the single `execRad()` chokepoint; assert correct `rad` command/args for every mutating method without a node.
- **Unit — read path:** mock the `radicle-httpd` HTTP client; assert endpoint construction and response parsing against captured fixtures from the live API (heartwood RID).
- **Contract tests:** run the same `HostDriver` contract suite against both the `github` and `radicle` drivers to guarantee interface parity.
- **Behavior-preservation:** golden tests asserting the `github` driver reproduces current script/command behavior before and after the refactor.
- **Integration:** a local `radicle-node` + `radicle-httpd` in CI (or the seed-node compose) for an end-to-end `rad-bootstrap` → `rad patch` → quorum-merge round-trip.
- **COB round-trip:** create an issue/patch COB, read it back via httpd, assert `source_lineage` OID preservation.

## Scope fence

- **In (v1, Tiers 1+2):** `@org-os/host` interface + `github` driver (behavior-preserving) + `radicle` driver + `@org-os/rad` (rad-cli/httpd/cob/identity) + `rad-bootstrap` + seed-node recipe (3 availability tiers + Tor) + did:key identity & `crefs` governance mapping + the four write commands + `/initialize` + federation/data-model additions + `.well-known` served-from-node + runtime-agnostic audit.
- **Deferred (Tier 3, designed-not-built):** replacing the three GitHub Actions workflows with `radicle-ci-broker` adapters; full GitHub-Pages → node hosting rebuild. The seed-node recipe is where CI lands later.
- **Separate module:** the local-LLM runtime.

## Open decisions (for implementation-plan phase)

1. **Package boundary between `org-os-host` and `rad-org-os`:** confirm the `radicle/driver.mjs` in `org-os-host` stays a thin re-export vs. registering `@org-os/rad` directly into the registry.
2. **CI for integration tests:** whether to run a real `radicle-node` in GitHub Actions during the dual-stack period, or gate integration tests behind the seed-node compose only.
3. **Open-model CLI target** for the sovereign-runtime default (OpenCode + Ollama vs. another) — pick during the runtime-agnostic audit.
4. **First dogfood instance:** which repo flips to `platforms.canonical: radicle` first (recommend a fresh Radicle-first pilot rather than migrating a live instance).

## Appendix A — Verified research claims (source + adversarial vote)

1. Delegate-based governance; a delegate can be a bot, identified by a DID; repos start with one delegate and grow. — docs.radicle.xyz/guides/protocol (3-0)
2. Private repos via visibility attribute + per-DID allow list; **not encrypted at rest**; delegates always retain access. — protocol guide (3-0)
3. Issues/patches/identities are COB types (`xyz.radicle.{issue,patch,id}`) under `refs/cobs`; new COB types definable without protocol changes. — protocol guide (3-0)
4. COBs are CRDT-based, signed by author, creatable offline; extensible via reverse-DNS type IDs. — guides/user (3-0)
5. Private repos: `rad id update --allow`, ChaCha20-Poly1305 transport, need a trusted seed or Tor; not encrypted at rest. — guides/user (3-0)
6. Identity = per-device Ed25519 did:key; no device linking yet; delegates can be group/person/bot. — guides/user (3-0)
7. No advanced patch code-review yet; no formal security audit; public repos auto-seeded by iris + rosa. — guides/user (3-0)
8. Refs live under per-node namespace `refs/namespaces/<nid>/…`; canonical refs synthesized. — radicle.xyz/2025/08/12/canonical-references (3-0)
9. Canonical default branch computed from `defaultBranch`+`threshold`+`delegates`; canonical on threshold agreement. — canonical-references (3-0)
10. `xyz.radicle.crefs` generalizes canonical refs: per-pattern rules with `allow` DIDs + `threshold`. — canonical-references (3-0)
11. Canonical rules identify signers by did:key; changes need a delegate quorum. — canonical-references (3-0)
12. Radicle 1.3.0 (2025-08-12) introduced `crefs` with allow-list + quorum threshold. — radicle.xyz/2025/08/12/radicle-1.3.0 (3-0)
13. Default-branch rule synthesized from `threshold`+`delegates`; explicit override disallowed, checked at `rad id update`. — radicle-1.3.0 (2-1)
14. Canonical-JSON identity doc at `refs/rad/id`; RID derived from initial doc → stable RID, mutable doc, self-certifying (TUF-inspired). — docs.radicle.xyz (3-0)
15. `rad init --private`: unannounced, replicated only to allow-listed peers; privacy covers data/time/RID/COBs/collaborators; ChaCha20-Poly1305. — docs.radicle.xyz (2-0)
16. Issues/patches/review as CRDT COBs; offline/local-first; published refs signed under `refs/rad/sigrefs`; delegates can be bots. — docs.radicle.xyz (3-0)
17. Live heartwood RID `rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5`, default branch `master`, 5 delegates, threshold 1, seeded by 278 nodes. — app.radicle.xyz (3-0)
18. `xyz.radicle.crefs` restricts `refs/tags/releases/*` to 3 DIDs at threshold 2 — higher than the repo's overall threshold of 1. — app.radicle.xyz (3-0)

Supporting (verified pre-synthesis; some verifier votes truncated by a spend limit): radicle-httpd exposes an unauthenticated read API at `/api/v1` (v0.25.0, apiVersion 6.1.0; endpoints `/repos`, `/repos/:rid`, `/node`, `/nodes/:nid`, `/delegates/…`); the official write endpoints were removed upstream (community fork `radicle-http-api` preserves them); `radicle-ci-broker` (Rust, maintained into 2026) is event-driven over a Unix socket with adapters (webhooks/GHA/Woodpecker/Kraken); seed node needs ~1–2 GB RAM / 10 GB disk / port 8776; ~$7M Radworks-funded; `radicle.garden` managed-node service by The Better Internet Foundation.
