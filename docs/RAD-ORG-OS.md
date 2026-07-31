# rad-org-os — the sovereign distribution

> **Status: in development.** This document is the module's source of truth and the canonical copy of the capability map below; the module page at `/modules/rad-org-os` mirrors it, so corrections start here. No Radicle-specific code has shipped yet — this page says exactly what exists. Research grounding: `docs/research/2026-07-31-radicle-state-of-network.md` (compiled 2026-07-31; Radicle 1.9.1 released 2026-05-21).

**rad-org-os will be the sovereign distribution of org-os — the full organizational stack running on [Radicle](https://radicle.dev), peer-to-peer, on infrastructure no single platform can withdraw. And in the other direction: the missing organization layer for Radicle.**

## Why

**Some organizations can't depend on centralized platforms.** Accounts get suspended, repos get taken down, domains get blocklisted. Radicle demonstrated the alternative on itself: when ISPs blocklisted radicle.xyz in April 2026, the project moved domains — and the peer-to-peer network wasn't affected at all. Nothing was lost, because nothing lived at an address someone else controlled. HardenedBSD, after platform trouble of its own, stood up six global Radicle replicas in 24 hours.

**The same argument holds without the risk.** You don't need to be a target to want your organization's memory, decisions, and data replicated across machines your members control instead of a single vendor's database.

**Same files, different substrate.** org-os's core is already substrate-agnostic: identity files, memory, registries, schemas, and skills are markdown, YAML, and git, and no script in the framework calls the GitHub API (checkable: nothing in `scripts/` invokes `api.github.com` or `gh`). What still assumes GitHub is the plumbing around the edges — bootstrap, sync scripts, federation transport, and operator flows. That is the work rad-org-os does.

## The four components

1. **Code-substrate abstraction** — a small driver interface (clone, sync, push, propose-change, publish-schema) with `github` and `radicle` drivers, selected by the `platforms.primary` field an instance already declares in its `federation.yaml`. GitHub becomes *a* backend, not *the* backend.
2. **The Radicle-native distro** — fork/seed/bootstrap/federate an instance entirely over Radicle: `rad clone` instead of GitHub fork, patches instead of PRs, `did:key` identities as operator identities, seed nodes replacing the central remote.
3. **KMS `radicle` connector** — the knowledge-management connector-layer *design* (`docs/superpowers/specs/2026-07-19-org-os-kms-connector-layer-design.md`) specifies `radicle` as one of its source drivers; rad-org-os implements it once that layer lands (Radicle repos as knowledge sources).
4. **The org layer for Radicle** — Radicle's Heartwood protocol has no org/team primitive: only per-repo delegates and quorum. rad-org-os composes an organization from org-os's existing shapes: the instance repo as org index (member DIDs in `data/members.yaml`), membership as seed-node replication policy, `federation.yaml` as network topology, and delegate quorum as cryptographic multi-sig over the org's canonical state.

## Capability map

### Now — true today

- The entire file-based core works on any git substrate; an org *can* seed an org-os instance on Radicle today — nothing breaks, but nothing assists yet.
- `schemas/federation.yaml` already lists `radicle` as a valid `platforms.primary` value. Precisely: that is a declaration slot, not a feature — no code reads it yet (`gitlab` is listed on the same line, and there is no GitLab support either).
- A `radicle` source driver is specified in the KMS connector-layer design. To be exact: that is a written design, not shipped code — the connector layer itself is not yet implemented.
- Radicle itself supplies the primitives (1.9.x): DID identities, patches, issues, private repos (allow-list replication), seed nodes on Raspberry-Pi-class hardware, a fully scriptable `rad` CLI, and a node event socket with a webhooks adapter. CI exists but is bring-your-own: a broker plus an adapter you run yourself (the native runner is unsandboxed; hosted CI is still in development).

### Next — committed roadmap

Tracked as the `rad-org-os` project in `data/projects.yaml`, with the individual items queued in `HEARTBEAT.md`.

1. **Substrate driver interface** + `radicle` driver behind the framework's sync/bootstrap scripts (the current GitHub behavior becomes the extracted `github` driver).
2. **Radicle bootstrap path** in the setup interview — "where does your org live?" → GitHub or Radicle; `rad init` + seeding instead of fork.
3. **Seed-node runbook** — home server or Raspberry Pi, systemd, seeding policy as membership, Radicle pinned ≥1.9.1.
4. **KMS `radicle` connector `pull`** — implemented against the `radicle-httpd` read API + `rad` CLI.

### Later — exploration, published as exploration

- **Federation transport over Radicle** — instances discover and sync each other peer-to-peer; gossip replaces webhook/cron sync.
- **Operator trunks as Radicle patches** — the per-operator-branch flow mapped to patches, with delegate quorum as the merge gate: org roles become repo delegates, and the canonical org state becomes cryptographically multi-sig.
- **DID ↔ members mapping** — members carry `did:key`; agents verify authorship against the delegate set.
- **Agent as node-local daemon** — trigger on the node event socket, act via the `rad` CLI, read via `radicle-httpd`. (The official HTTP API is read-only; agents write through the CLI.)
- **Private instances** — allow-list replication for sensitive orgs. Caveat stated plainly: Radicle private repos are *not* encrypted at rest; visibility is enforced by replication policy.
- **CI and publishing** — radicle-ci-broker adapters; site publishing via Radicle Pages (a paid Radicle Garden service) or self-hosted.

## Architecture

```
        org files (markdown · YAML · git)
   identity · memory · data/ · .well-known/ · skills/
                      │
             substrate driver interface
      clone · sync · push · propose-change · publish-schema
              ┌───────┴────────┐
           github            radicle
        (remote, PRs)   (seed nodes, patches,
                         DIDs, delegate quorum)
```

## Relationship to the rest of org-os

- **Federation protocol** — `federation.yaml` stays the topology source of truth; rad-org-os adds a transport, not a new model.
- **KMS** — the `radicle` connector slots into the existing connector layer (see the KMS connector-layer spec).
- **Bootstrap engine** — the interview gains a substrate question; the cloning engine gains a `rad` path.

## FAQ

**Why not just GitHub?** For most orgs GitHub is fine — and stays the default. rad-org-os exists for orgs that need infrastructure nobody can take away, and for anyone who wants their org's canonical state replicated on member-controlled machines.

**Is Radicle ready?** The protocol is stable and actively maintained — 1.9.x with a steady release cadence, stewarded by a Swiss non-profit, with Radworks funding approved through end-2026 and RAD vesting to 2029. The network is small: roughly 8,000 repos and 600+ nodes weekly on public seeds (Radicle's own figures, April 2026). rad-org-os treats it as ready for pilots, not as a mass-migration target.

**What about private data?** Private repos replicate only to allow-listed DIDs, but are not encrypted at rest. Sensitive orgs should treat seed-node control as part of their threat model.

**Can we run both?** Yes, with one caveat: mirroring GitHub↔Radicle is the documented transition pattern (push both remotes; community sync tools exist), but it mirrors *code* only. Issues and patches are Radicle collaborative objects with no official bidirectional bridge, so those live on one side or the other. The substrate abstraction is designed to make "both" a configuration, not a fork.

---

*Spec: `docs/superpowers/specs/2026-07-31-rad-org-os-artifacts-design.md` · Research: `docs/research/2026-07-31-radicle-state-of-network.md`*
