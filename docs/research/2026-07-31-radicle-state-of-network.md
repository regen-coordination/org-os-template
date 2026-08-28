# Radicle — State of the Network (research, 2026-07-31)

> Adversarially-sourced capability inventory of Radicle (radicle.dev, Heartwood protocol, Radworks ecosystem) as of 2026-07-31. Feeds the rad-org-os artifacts design (`docs/superpowers/specs/2026-07-31-rad-org-os-artifacts-design.md`). Raw findings; claims carry source + date. Not for publication as-is.

## 1. Version & maturity

- **Current stable: Radicle 1.9.1** (2026-05-21); 1.9.0 "Hawthorn" shipped 2026-05-19 ([release post](https://radicle.dev/2026/05/19/radicle-1.9.0)). Heartwood actively developed (mirror last pushed 2026-07-30). Rust workspace, edition 2024, MSRV 1.88.
- **2025 shipped:** 1.2.0 (Jun 2025, perf), 1.2.1, 1.3.0 (Aug 2025: initial **Windows support**, **canonical reference rules** `xyz.radicle.crefs`, sans-I/O `radicle-protocol` crate), 1.4, 1.5; **Radicle Desktop** GUI released Jun 2025 ([LWN](https://lwn.net/Articles/1025405/)).
- **2026 shipped:** 1.6.0 (Jan: clap CLI, shell completions), 1.7.0 (Mar: **security fix**, connection-level node blocking), 1.7.1, 1.8.0 (fixes for replay/graft attacks on signed refs), 1.9.x (I2P integration work, revision ranges, node version advertising).
- **Domain move (2026-04-23):** radicle.xyz → **radicle.dev** (project) + **radicle.network** (Explorer/hosted content) after ISP blocklisting of radicle.xyz; bootstrap seeds now `iris/rosa.radicle.network` ([domain-move post](https://radicle.dev/2026/04/23/domain-move)). The p2p network itself was unaffected — a live demonstration of the sovereignty thesis.

## 2. Capabilities today

| Capability | Status | Notes |
|---|---|---|
| Identities | ✅ | `did:key` per node/user; repo identity doc versioned, signed |
| Repos (RID) | ✅ | `rad:z…` IDs; gossip replication; `git-remote-rad` helper |
| Patches (PR equiv) | ✅ | COBs; revisions with base..head, range-diff friendly (1.9.0) |
| Issues | ✅ | COBs; `rad issue`; local notifications via `rad inbox` |
| Delegates / multi-sig | ✅ | Quorum `votes >= delegates/2+1` for identity changes; canonical branch = commit agreed by threshold of delegates; since 1.3.0, per-ref canonical rules (crefs) |
| Private repos | ✅ | Selective replication to allow-listed DIDs; **not encrypted at rest** — visibility-by-replication only |
| Seeding | ✅ | Seed nodes with open/selective policies; systemd unit; Raspberry Pi-class hardware OK ([seeder guide](https://radicle.dev/guides/seeder)) |
| Web UI | ✅ | Radicle Explorer; public instance **radicle.network** (was app.radicle.xyz) |
| CI | ⚠️ | `radicle-ci-broker` (Lars Wirzenius): listens to node events, dispatches adapters — native local runner (no isolation), container, GitHub Actions, Woodpecker, Tekton, Kraken CI ([architecture](https://pages.radicle.liw.fi/ci-broker/architecture.html), [blog 2025-07-23](https://radicle.dev/2025/07/23/using-radicle-ci-for-development)) |
| Static sites | ✅ (paid) | **Radicle Pages** via **Radicle Garden** (€4.99/mo managed node, 5 GB, run by Better Internet Foundation): push to `pages` branch → `*.radicle.page` ([radicle.garden](https://radicle.garden/)) |
| Desktop GUI | ✅ | Radicle Desktop (Jun 2025), works against local node |

## 3. Gaps vs GitHub (what an org would notice)

- **No push notifications/email** — `rad inbox` is local-pull; no hosted notification service.
- **No discussions, wikis, projects/boards, releases UI, cross-network code search.**
- **CI is BYO**: broker + adapter on your own node; native runner unsandboxed; Garden hosted CI "in development"; webhooks to external CI supported.
- **Access control granularity:** delegate-or-not per repo; no read tiers beyond private-repo allow lists; no branch protection beyond crefs; no org-level roles.
- **Official `radicle-httpd` JSON API is read-only** (writes were removed). A [cytechmobile fork (radicle-http-api)](https://github.com/cytechmobile/radicle-http-api) restores authenticated CRUD (`/api/v1/sessions`, Bearer tokens) — unofficial.
- **No org/team primitive** (see §6). No mobile app.

## 4. Ecosystem & adoption

- Network (Apr 2026, [FAQ](https://radicle.dev/faq)): **~8,000 repos, 600+ nodes weekly** on public seeds — small but real.
- **HardenedBSD** exploring Radicle after GitLab issues; 6 global replicas stood up in 24h ([Radicle Org Q1 2026 update](https://community.radworks.org/t/radicle-org-q1-2026-update/3723)).
- **No evidence found of Tech for Palestine on Radicle** — treat as unverified; do not publish.
- Radicle dogfoods itself (heartwood, explorer canonical on-network).
- **Funding healthy:** Radworks DAO approved ~**$2.994M USDC through 2026** for Drips, Radicle Garden, Radworks App teams (Dec 2025); 7.5M RAD locked/vesting to 2029; Radicle Org Q1 2026 spend CHF ~123k, 13% under budget; **Better Internet Foundation** (Swiss non-profit, ex-Radicle Foundation) is steward. ~9–16 contributors per release.

## 5. Automation / agent angle

- **rad CLI fully scriptable** (issues, patches, id, sync); nodes run headless via systemd; RPi-class hardware fine.
- **Event stream:** radicle-node exposes a local event socket the CI broker consumes; a **webhooks adapter** turns node events into HTTP callbacks ([tutorial](https://hackmd.io/@mzampetakis/r1a_gsk9T)).
- **HTTP:** `radicle-httpd` = read-only JSON API (`/api/v1`); writes via CLI (or the unofficial cytechmobile fork). An agent's natural write path is the CLI against a local node.

## 6. Org/team primitives

**None.** Purely per-repo delegate sets + thresholds; the Ethereum-anchored "orgs" of the old Radicle Link era are gone in Heartwood. No namespaces, no shared team ACLs. An "organization" must be composed: shared seed node (membership = seeding policy/allow list), overlapping delegate sets, and convention (e.g. an org index repo). **This is the rad-org-os opening: org-os becomes the missing org layer.**

## 7. Interop

- [mirror-to-radicle GitHub Action](https://github.com/gsaslis/mirror-to-radicle); [Mic92/radicle-sync](https://github.com/Mic92/radicle-sync) (daily bidirectional checks); Radicle+GitHub **MCP server** ([fovi-llc/radicle-mcp](https://mcpservers.org/servers/fovi-llc/radicle-mcp)).
- Official pattern: push both remotes, review on Radicle, [GitHub Actions as CI adapter](https://radicle.xyz/2025/05/30/radicle-with-github-actions).
- No official bidirectional issue/PR bridge; FAQ suggests cron mirroring.

## 8. Implications for rad-org-os

1. **Perfect substrate match:** git + markdown + YAML org state replicates natively; repo identity doc + delegate quorum gives cryptographic multi-sig governance of canonical org state for free — map org roles → delegates, decisions → identity/crefs changes or patches.
2. **The org layer must be built in-repo:** Radicle has no orgs, so rad-org-os *is* the org primitive — index repo listing member RIDs/DIDs, federation.yaml-style topology, seeding policy as membership.
3. **Agent loop is viable today:** headless node + event socket/webhook adapter (trigger) + rad CLI (act) + radicle-httpd (read). Design agents as node-local daemons, not SaaS bots.
4. **Plan around gaps:** notifications → agent-generated digests; discussions → issue COBs or markdown; CI → broker + container adapter or GitHub Actions bridge during transition; publishing → Radicle Garden Pages or self-hosted.
5. **Risks:** small network (~8k repos); API write path unofficial; private repos unencrypted at rest; recent security churn (1.7/1.8) argues for pinning ≥1.9.1. Funding through 2026 and steady cadence indicate a healthy project.

## Sources

[radicle.dev 1.9.0](https://radicle.dev/2026/05/19/radicle-1.9.0) (2026-05-19) · [domain move](https://radicle.dev/2026/04/23/domain-move) (2026-04-23) · [1.6.0](https://radicle.dev/2026/01/14/radicle-1.6.0) (2026-01-14) · [1.2.0](https://radicle.dev/2025/06/02/radicle-1.2.0) (2025-06-02) · [1.3.0 coverage](https://biggo.com/news/202508131944_Radicle_1.3.0_Windows_Support) (2025-08-12) · [LWN Radicle Desktop](https://lwn.net/Articles/1025405/) (2025-06) · [Radicle CI blog](https://radicle.dev/2025/07/23/using-radicle-ci-for-development) (2025-07-23) · [CI broker docs](https://pages.radicle.liw.fi/ci-broker/architecture.html) · [radicle.garden](https://radicle.garden/) · [Radicle Org Q1 2026 update](https://community.radworks.org/t/radicle-org-q1-2026-update/3723) · [FAQ](https://radicle.dev/faq) (Apr 2026 stats) · [protocol guide](https://radicle.dev/guides/protocol) · [radicle-http-api fork](https://github.com/cytechmobile/radicle-http-api) · [webhooks tutorial](https://hackmd.io/@mzampetakis/r1a_gsk9T) · [GitHub Actions pattern](https://radicle.xyz/2025/05/30/radicle-with-github-actions) (2025-05-30) · Messari/CMC Radworks funding notes (Dec 2025)
