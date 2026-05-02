# 08 — Federation / Multicellularity

> Aspect 8 of the autopoiesis matrix. Instance-primary, framework-secondary.
> An instance as one cell among peers: how does it discover, identify, exchange with, and integrate from others?

"Federation" is a name. The mechanism is a YAML file at the repo root, a `.well-known/` directory of JSON schemas, a folder of git clones in `repos/`, and a small set of scripts — only some of which exist. This note traces the actual files and where the loop closes vs. doesn't.

## Mechanism (step by step)

A new org-os repository is born (genesis). To become a federation peer it must do six things, each backed by a concrete file:

1. **Declare identity in `federation.yaml`.** Every instance has `federation.yaml` at repo root. The `identity` block (`name`, `type`, `daoURI`, `chain`, `safe`) is the cell's name tag. The `network` field (e.g. `regen-coordination`, `refi-dao`) is the federation it claims membership in. The `hub` field names the aggregation point. Verified: `org-os/federation.yaml`, `refi-bcn-os/federation.yaml`, `refi-dao-os/federation.yaml`, `refi-med-os/federation.yaml` — all present and v3.0-shaped.

2. **List peers in `federation.yaml.peers[]`** with `name`, `repo`, `url`, `trust ∈ {full, read, none}`. This is the only place in the codebase where one instance declares another instance exists. The list is hand-maintained — there is no `discover-peers.mjs`. Trust is a tag, not enforced by anything: `trust: "full"` just means "I think I'd accept input from this peer if a mechanism existed." No signatures, no authn.

3. **Publish machine-readable surface in `.well-known/`.** `scripts/generate-all-schemas.mjs` reads `data/*.yaml` and emits `.well-known/{members,projects,meetings,proposals,activities,contracts,finances,ideas,knowledge}.json` (DAOstar-context shaped, EIP-4824 family). This is the cell's "antigen" — the data face other peers can read without opening the repo. Generation is on-demand only: `npm run generate:schemas`. There is no auto-regeneration on `data/` change, no pre-commit hook, no CI.

4. **Discover peers via `repos.manifest.json` + clone.** `scripts/clone-linked-repos.mjs` reads the top-level manifest (9 repos hardcoded today: framework, template, refi-dao-os, ReFi-Barcelona, refi-bcn-website, regenerant-catalunya, regen-coordination-os, local-refi-toolkit, organizational-os) and `git clone`s each into `repos/` — or `git pull`s if already present. This is the actual peer discovery: filesystem co-location after a manual clone step. Note: the manifest **does not include `refi-med-os`** (added 2026-04-28) — the manifest has drifted from `federation.yaml.downstream[]`.

5. **Exchange knowledge via filesystem read.** `docs/FEDERATION.md` describes two protocols:
   - **`sync-protocol: git`** (default): the consumer reads peer's `knowledge/<domain>/*.md` directly, either via shared workspace (`ls ../refi-dao-os/knowledge/regenerative-finance/`) or via `git clone` to a temp dir. A "federation-sync.mjs" / aggregator package is referenced in the doc but **does not exist** in `scripts/` or `packages/` today. The mechanism is documented, not implemented.
   - **`sync-protocol: koi-net`** (real-time, optional): bridge through `packages/koi-bridge/` and `packages/koi-opal-bridge/` — out-of-tree integration. Exists as scaffolding but not wired to `federation.yaml.knowledge-commons`.

6. **Sync upstream framework changes.** `docs/FEDERATION.md` and `package.json` advertise `npm run sync:upstream` → `node scripts/sync-upstream.mjs`. Verified: **`scripts/sync-upstream.mjs` does not exist**. The script is a documented promise. Today the actual sync mechanism is manual: operator runs `git fetch upstream && git merge upstream/main --no-commit` and respects `federation.yaml.customizations[].maintain_on_sync`. Direction is one-way: `framework → instance`, `sync_direction: "framework→instance"` in every `downstream[]` entry.

**Trace for a hypothetical peer-to-peer knowledge exchange:**

- refi-dao-os updates `data/projects.yaml` → operator runs `npm run generate:schemas` → `.well-known/projects.json` rewrites → operator commits + pushes to GitHub.
- refi-bcn-os: the operator runs `git pull` in `repos/refi-dao-os/` (or browses GitHub). Reads the new `projects.json`. Manually copies relevant pages into local `knowledge/incoming/`. Updates own `data/`. Regenerates schemas. Commits.
- The **loop closes here only via the operator carrying the data across**. There is no script that detects "peer X's `.well-known/projects.json` changed" and triggers ingestion. The "federation-sync" loop is human-mediated end-to-end; the file format is machine-readable but the trigger and the integration step are not.

**Skill sharing.** `data/skills-matrix.yaml` (framework-only registry) tracks `promotion_status: candidate | promoted | retired` per skill, with `instances_using[]` listing where it appears. `npm run analyze:instances` (`scripts/analyze-instances.mjs`) walks `data/instances.yaml.local_path` for each instance, lists `<instance>/skills/`, and writes `memory/reports/instances-drift-YYYY-MM-DD.md`. This is the only working *drift-detection* mechanism in the federation today. It runs on the framework, not on instances. Promotion itself (copy skill from instance to framework) is manual: `cp ../refi-bcn-os/skills/cooperative-ops.md skills/`.

**Federation events that exist:** `federation.yaml` edits (commit-tracked), `data/instances.yaml` updates (manual), `analyze:instances` drift reports (on-demand), `clone:repos` clones (on-demand), `generate:schemas` runs (on-demand). **Federation events that don't exist:** auto-discovery, peer-publishes-pings-subscribers, signature verification, conflict resolution, bidirectional sync, automated knowledge ingestion.

## Prior art

1. **ActivityPub / Fediverse.** Each Mastodon instance exposes WebFinger (`.well-known/webfinger`) and an actor inbox (`/users/<id>/inbox`) for push delivery. org-os exposes `.well-known/dao.json` (identity) and `.well-known/{members,projects,...}.json` (state) but has **no inbox** — there's no push endpoint. Fediverse is push, org-os is pull-by-clone. The standard (DAOstar/EIP-4824) plays WebFinger's role; the inbox layer is unbuilt.
2. **Multicellularity & cell signaling (biology).** Yeast → metazoa transitions required gap junctions (direct cytoplasm sharing), paracrine signaling (local diffusion), and immune recognition (self/non-self markers). org-os has filesystem co-location (`repos/<peer>/` ≈ gap junctions), `.well-known/` reads (≈ paracrine), and `trust:` tags (≈ aspirational MHC). Real immune recognition (signature verification) is absent: any clone with a valid `federation.yaml` would be accepted as a peer.
3. **Beer's VSM — recursion (System 1 of System 1).** Each instance is a viable system; the federation is a viable system *of* viable systems. Each instance has its own S3 (`HEARTBEAT.md`, `analyze-instances.mjs` for the framework hub). The federation-level S3 (cross-instance audit) exists *only* at the framework hub — `analyze-instances.mjs` lives in `org-os/scripts/`, no peer runs it. The recursion is one level deep, asymmetric.
4. **Web of Trust (PGP) vs. DID/CAIP.** PGP's signature graph would let an instance verify "this `federation.yaml` was signed by a key whose owner is in my trust set." org-os has none of this — `trust: "full"` is a string in YAML. `identity.daoURI` + `identity.chain` (CAIP-2) point toward DID-style on-chain identity; `onchain_registration.enabled: false` everywhere today, so the rail exists but is unused.
5. **DNS / git submodules.** `federation.yaml.peers[].url` + `repos.manifest.json` is org-os's "DNS" — name-to-URL resolution. `repos/` is the resolved cache. `git submodule` would give cryptographic pinning (commit SHA per peer); org-os uses bare `git clone` so there's no integrity pin — `npm run clone:repos` always pulls `main`'s tip.

## Invariants / failure modes

**Invariants that must hold for the federation loop to close:**

1. Every peer A and B: A appears in B.federation.yaml.peers[] *iff* B appears in A.federation.yaml.peers[]. (Symmetry.)
2. The framework's `data/instances.yaml.instances[]` covers every live downstream instance.
3. The framework's `federation.yaml.downstream[]` matches `data/instances.yaml`.
4. `repos.manifest.json` lists every repo in `federation.yaml.downstream[].repo`.
5. Every instance regenerates `.well-known/*.json` after `data/*.yaml` changes.
6. `federation.yaml.metadata.framework_version` matches `package.json.version` (already enforced by `validate-structure.mjs`).
7. Skill canonicality: a skill ID exists in at most one place's `skills-matrix.yaml` as `in_framework: true`.

**Observed failure modes today:**

- **Symmetry broken (HEARTBEAT-flagged).** `refi-med-os` was added to `org-os/federation.yaml.downstream[]` and `data/instances.yaml` on 2026-04-29. Peer instances `refi-dao-os/federation.yaml.peers[]` and `refi-bcn-os/federation.yaml.peers[]` do **not** list it (verified by reading both files). HEARTBEAT.md task: "Tell maintainers of refi-dao-os, refi-bcn-os, regen-coordination-os to add `refi-med-os` to their `federation.yaml peers:` lists on next sync." This is a manual reconciliation queue, not an automated propagation.
- **Manifest drift.** `repos.manifest.json` lists 9 repos; `federation.yaml.downstream[]` lists 6 instances; `data/instances.yaml` lists 7 entries (incl. `openclaw`, an `AgentRuntime` not a data instance). All three should be co-derived but are hand-maintained — `repos.manifest.json` doesn't include `refi-med-os`, doesn't include `regen-coordination-os` matching the new framework v3.0 record exactly.
- **Promised script missing.** `scripts/sync-upstream.mjs` is referenced from `package.json:20`, `docs/FEDERATION.md:135`, and `docs/agent-plans/package-integration.md:57`. File doesn't exist. The `sync:upstream` command silently fails. Operators rely on raw git, which means `customizations[].maintain_on_sync` is *advisory* — nothing enforces it during merge.
- **No knowledge sync engine.** `docs/FEDERATION.md` describes a "federation-sync.mjs" and an aggregator package that resolves `subscribers` to `peers` and pulls knowledge. Neither exists in `scripts/` or `packages/`. `.well-known/knowledge.json` at the framework root is **empty stub** (`"domains": [], "exchange": {"published_domains": [], "subscribed_domains": []}`).
- **`.well-known/` staleness.** No auto-regeneration. `.well-known/members.json` is 136 bytes — likely stale or empty. The external surface lies about the internal state until an operator runs `generate:schemas`.
- **Trust is decorative.** Every entry in every observed `federation.yaml` shows `trust: "full"` or `trust: "read"`. There is no code path that branches on `trust`. A consumer reading a peer's `.well-known/` doesn't verify a signature, doesn't check a key, doesn't reject `trust: "none"` peers — because there is no consumer code at all.
- **Skill-canonical conflict unresolved.** `data/skills-matrix.yaml` lists `research` as a candidate present in refi-bcn-os and refi-dao-os; both instances independently maintain `skills/research/`. There is no protocol for "two instances claim the same skill name with diverging content" — first-to-promote wins, but the matrix has no version field per instance.
- **Federation drift accumulates undetected.** `data/instances.yaml.last_sync`: `refi-bcn-os` 2026-03-19, `refi-dao-os` 2026-03-06, `dao-os` 2026-04-02. No SLA defined for "stale" (open question in `system-reliability` plan). The drift report is informational; nothing alerts.

The loop **closes** today only at the framework-hub edge: framework changes → operator runs `git merge upstream/main` in each instance → instance evolves. The peer-to-peer loop (refi-dao ↔ refi-bcn) **does not close in code** — only in the operator's head and Telegram messages.

## Open questions

1. **Is sync truly bidirectional or only `framework → instance`?** Every observed `sync_direction` is `"framework→instance"`. `docs/FEDERATION.md` implies peer-to-peer knowledge exchange via `subscribe[]`, but no consumer script exists. Bidirectional in spec; unidirectional in code.
2. **What's the trust model — git access, signatures, none?** Today: git push permission on the peer's repo = "trust." No signatures, no DID resolution, no key registry. `identity.onchain_registration.enabled: false` everywhere. Should `daoURI` resolution become the trust anchor?
3. **How does an instance signal acceptance of upstream changes?** Currently: no signal. Framework releases v3.0; instances at-will pull and merge. `last_sync` is updated by hand in `data/instances.yaml`. No "I'm on framework v3.0" handshake.
4. **What's the protocol when two instances claim the same skill canonical?** `skills-matrix.yaml.skills[].instances_using[]` lists multiple — but if their `SKILL.md` content has diverged, no merge protocol exists. `package-integration` plan open question 5 ("boundary with skills") punts on this.
5. **Should `repos.manifest.json` be derived from `federation.yaml.downstream[]`?** Today they're hand-maintained in parallel and have already drifted (refi-med-os missing from manifest). Deriving manifest from federation.yaml + instances.yaml would close one drift loop.
6. **Where does `federation.yaml.knowledge-commons.subscribe[]` get consumed?** Spec says subscribers → consumer reads peer's `.well-known/knowledge.json`. No consumer in tree. Is knowledge-exchange a v3.x package waiting to be built (`packages/knowledge-exchange/` in `docs/FEDERATION.md` line 577 — directory does not exist) or a v2.0 package that was deferred?
7. **Is the hub designation enforced?** `federation.yaml.network: "regen-coordination"` + `federation.yaml.hub: "github.com/regen-coordination/org-os-template"` (currently the framework). But `data/instances.yaml` shows two `federation_role: "hub"` entries (`refi-dao-os` for `regen-coordination` network, `regen-coordination-os` for same). Two hubs in one network. No tie-breaker rule.
8. **Should `analyze:instances` propagate to peers?** Today only the framework hub runs it. Should each instance also analyze its declared peers? The recursion is currently one-deep; multicellular biology suggests deeper.
9. **What happens to `repos/<peer>/` when `npm run clone:repos` runs against a stale manifest?** It silently doesn't clone the missing entries. Should clone-linked-repos read `federation.yaml.downstream[]` directly?

## Existing-plan touchpoints

- **`federation-protocol`** (queued, priority 2) — *the* federation plan. Tasks: verify both instances have complete `knowledge-manifest.yaml`; test refi-dao-os ↔ refi-bcn-os knowledge exchange both directions; test `.well-known/` discovery between instances; document protocol with concrete `curl`/`fetch` examples; test skill-promotion-from-instance pipeline. This is the plan that would convert the documented-but-unimplemented sync into running code, and surface (1) and (4) above.
- **`instance-bootstrap`** (queued, priority 5) — phase 1 open question: cloning mechanism. A born instance must register with the federation (add itself to upstream `federation.yaml.downstream[]`, get added to peers' `peers[]`). Today entirely manual; the symmetry failure mode (refi-med-os missing from peers) is exactly what bootstrap automation would prevent.
- **`package-integration`** (queued, priority 3) — phase 3 open question 1 (consumption mechanism: toggle / npm / vendored / mixed) decides how packages flow across federation. If "vendored," packages move via the same `sync:upstream` rail (currently broken — script missing). If "npm," federation reduces to package version pinning. The plan owns the load-bearing decision for *what flows* between cells.
- **`system-reliability`** (queued, priority 4) — failure mode 3 ("federation drift") and open question 4 ("federation SLAs") are this aspect's enforcement layer. Phase 3 task: "Scheduled GitHub Actions workflow: weekly `analyze:instances` + drift report committed to `memory/reports/`." Would convert today's on-demand `analyze:instances` into a heartbeat. This is where the federation loop would gain a real timer.
- **`v2-phase1-framework`** (a dependency of `federation-protocol`) — already-completed Phase 1 work (docs, skills, data model). Federation builds on this substrate.
- **`obsidian-canvas-interface`** — `SYSTEM-CANVAS.canvas` is supposed to render the network visually (per `docs/FEDERATION.md:328` mention of `system_canvas` package). Today `packages/` has no `system-canvas/` directory. Federation visibility for operators is a planned but unbuilt UI layer.

## Framework-level note

Federation IS the framework view: the population of org-os instances is the framework's population. The framework's existence is justified by being the standard the instances federate around — `docs/FEDERATION.md` defines what it means to *be* an org-os, and `data/instances.yaml` + `federation.yaml.downstream[]` enumerate who currently is one. The framework-hub asymmetry (every `sync_direction: "framework→instance"`, `analyze-instances.mjs` only at the hub, `skills-matrix.yaml` only at the hub) is a deliberate v3.0 simplification: in this phase the framework is the only "viable system of viable systems" and instances are leaves. The peer-to-peer sub-federation (refi-dao-os declaring itself `federation_role: hub` for the `refi-dao` network with refi-bcn-os and refi-med-os as spokes) is a second recursion level present in data but not yet in code. The deeper framework-as-autopoietic-system pass — where the framework's own birth, identity, metabolism, and self-maintenance are examined — is deferred to a follow-up plan; this note treats the framework only as the federation's name registry and standards body.
