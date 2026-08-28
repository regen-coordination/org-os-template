---
aspect: 02-identity
title: "Identity & Continuity — what persists across forks, restarts, and sync"
scope: instance-primary, framework-secondary
created: 2026-05-02
---

# Aspect 2 — Identity & Continuity

> **Frame:** Identity is INVARIANT. Trace the mechanism by which it is *constituted* in files, not the process by which it changes. Where does "self" live, and what must hold for the instance to remain itself?

---

## Mechanism (step by step)

What today counts as "instance identity" is **a constellation of files** at the instance root, none of them cryptographic, none of them content-hashed, all of them human-edited markdown/yaml. There is no single primary key. Identity is constituted as the *agreement* between several independent declarations:

1. **`SOUL.md`** — character, mission, values, voice, boundaries. Free-form prose. Last paragraph (`## Continuity`) explicitly says *"This file persists between sessions"* — i.e. SOUL is asserted, by self-reference, to be the carrier of trans-session identity. (`/Users/luizfernando/.../org-os/SOUL.md:62-64`.) **Marked `maintain_on_sync: true`** in `federation.yaml customizations:` (line 204-207) — this is the mechanism that keeps SOUL from being overwritten by `sync:upstream`.

2. **`IDENTITY.md`** — structured fields: `Name`, `Type`, `Emoji`, `daoURI`, `Primary Chain`, `Treasury`, `Hats Tree ID`, `Snapshot Space`, `Decision Model`, `Network`, `Node ID`, `Hub Role`, `Upstream`. For org-os today everything on-chain is `N/A (solo phase)`. `Node ID: org-os` is the closest thing to a federated handle. The file also encodes **evolution triggers** (solo→OSS→DAO) that change which fields fill in — identity-as-trajectory rather than identity-as-snapshot.

3. **`federation.yaml` `identity:` block** (lines 9-22) — duplicates a subset of IDENTITY.md in machine-readable form: `name`, `type`, `emoji`, `role`, `daoURI`, `chain`, `safe`, `hats`, `gardens`, `onchain_registration`. **This is the field the schema generator and orchestration scripts read.** IDENTITY.md is for humans/agents; `federation.yaml.identity` is for tooling. Drift between the two is currently caught by nothing automated — only by the `bootstrap-interviewer` skill at genesis and human review thereafter.

4. **`package.json.version`** (`3.0.0`) + **`federation.yaml.metadata.framework_version`** (`"3.0"`) + **`federation.yaml.version`** (`"3.0"`) — version triplet. The instance "knows it is org-os v3" from these three fields agreeing. `scripts/update-version.mjs` is the only writer that keeps them in lockstep; `scripts/validate-structure.mjs` Section 8 ("Version Consistency", added in v3.0) enforces the agreement.

5. **`MEMORY.md` + `memory/YYYY-MM-DD.md` + `DECISIONS.md`** — narrative continuity. MEMORY.md is the index over decisions; DECISIONS.md is the authoritative chronological log; `memory/*.md` are append-only daily session logs. These are what makes "this is the *same* org-os I left yesterday" rather than just "this is *an* org-os instance." They are not validated, not generated — purely accreted human/agent text.

6. **`data/instances.yaml`** (FRAMEWORK-ONLY) — when the framework hub looks at downstream instances, *this* file is its registry. Each row keys by `id` (e.g. `refi-bcn-os`) and records `repo`, `local_path`, `framework_version`, `last_sync`, `drift`. **This is the authoritative external view of an instance's identity** from the hub's perspective — but the instance itself does not carry this file (instances do not list themselves). So instance identity is a two-sided declaration: the instance asserts itself in its own `IDENTITY.md`/`federation.yaml`; the hub assents in its `data/instances.yaml`. Mismatch is possible and currently uncaught.

7. **The git repo + remote URL** — implicit, but load-bearing. `https://github.com/luizfernandosg/refi-bcn-os` is what makes refi-bcn-os refi-bcn-os in practice. There is no `.org-os-id` file, no UUID, no DID. The repo URL plus the `id:` string in `instances.yaml` are the de-facto primary key.

### How a new session reads identity back

Per `AGENTS.md:21-32`, every session opens by reading: `MASTERPLAN → SOUL → IDENTITY → USER → MEMORY → memory/today.md → HEARTBEAT → TOOLS → federation.yaml → validate:schemas`. The agent reconstructs "who am I" from this read sequence on every cold start. There is no single bootstrap-state object; the agent assembles identity from these files each time.

### What survives `sync:upstream`, what gets overwritten

**There is no `scripts/sync-upstream.mjs` on disk today** (despite `package.json` exposing it as a script — this is a known broken reference; the file simply does not exist in `scripts/`). The semantic intent is documented via `federation.yaml customizations:` (lines 203-223): paths flagged `maintain_on_sync: true` are protected. Currently protected: `SOUL.md`, `IDENTITY.md`, `data/`, `memory/`, `skills/`. Everything else (root agent files like `AGENTS.md`, `BOOTSTRAP.md`, `CLAUDE.md`, `MASTERPLAN.md`, `dashboard.yaml`, `package.json`, all `scripts/`, all `docs/`, `.well-known/` templates) is intended to be overwritten by the framework on sync.

The `regen-coordination-os` 2026-04-24 sync (notes in `federation.yaml:98` and `data/instances.yaml:112`) is the only logged real-world precedent: "Instance identity files (SOUL, IDENTITY, USER, HEARTBEAT, MEMORY, TOOLS, README, federation.yaml, data/) preserved." That list is *broader* than the `customizations:` block declares — meaning the actual sync practice (manual, at the moment) preserves more than the protocol formally promises.

### What survives a fresh clone (`scripts/clone-framework.mjs`, planned in v3.5)

Per the v3.5 release design (`docs/superpowers/specs/2026-04-25-org-os-3-5-release-design.md` §4, step 4): a fresh clone explicitly *resets* `MEMORY.md` Key Decisions, **clears `memory/`**, resets `HEARTBEAT.md`, resets `MASTERPLAN.md`, resets `DECISIONS.md`. The new instance gets a brand-new identity declared by the `bootstrap-interviewer` (step 5). **Continuity does not survive a fresh clone — by design.** A clone is a *birth*, not a *fork-with-history*.

This is the load-bearing distinction: **sync = same instance, updated framework**. **Clone = new instance, same framework**. Today there is no codified "fork = new instance, inheriting partial history."

---

## Prior art

1. **Ship of Theseus** (philosophical baseline) — every plank replaced over time; is it the same ship? org-os is exactly this: every script can be replaced via `sync:upstream`, every package can be re-vendored via `sync:packages` (planned), but the operator-facing claim is that the instance remains itself. The `customizations:` whitelist is the explicit answer to the Theseus question — *these* planks are the ship; the rest is replaceable rigging.

2. **Maturana & Varela — operational closure** — a system is autopoietic if it produces and maintains its own components. For an org-os instance: identity is operationally closed when the agent, reading the files it itself maintains (`SOUL.md`, `IDENTITY.md`, `MEMORY.md`, `memory/`), reproduces the same operating context across sessions. Closure breaks when sync overwrites a file the instance was supposed to author.

3. **Git's commit-as-content-hash** — git makes a repo's history identity-bearing: the commit hash IS the identity of the snapshot, no external registry needed. org-os does not use this. A fork at commit `abc123` that diverges is no longer recognizable as the same instance to the framework hub except via the `id:` string and remote URL — both human-assigned. **This is a gap.** Adopting git commit identity (tag the genesis commit, carry it forward as `genesis_commit` in `federation.yaml`) would give cryptographic fork-tracking for free.

4. **W3C Decentralized Identifiers (DID)** — `did:key`, `did:web`, `did:pkh`. org-os has the *slot* (`daoURI` in `federation.yaml.identity`, IDENTITY.md `On-Chain Identity` section) but every entry is `N/A (solo phase)`. The trajectory in IDENTITY.md (`Solo → OSS → DAO`) explicitly defers crypto-identity to the DAO phase. **No instance today has a verifiable identity beyond a GitHub URL.**

5. **Biology — DNA as identity carrier across cell divisions** — every cell in a body shares (mostly) the same DNA; lineage is traceable through the genome. The closest org-os analogue is `framework_version` plus `customizations:` plus the `data/*.yaml` schemas — what's *invariant* is the structure of the data model and the names of the canonical files; what *varies* is content. The "DNA" of org-os is the file-structure spec (`docs/FILE-STRUCTURE.md`) and the data model (`docs/DATA-MODEL.md`). Sync upgrades this DNA; the instance retains it.

---

## Invariants / failure modes

**Invariants (what MUST hold for the instance to remain itself):**

- `IDENTITY.md` `Name` and `Node ID` MUST not change across sessions without an explicit rename ritual (today: no such ritual is defined). If `Node ID` changes, the hub's `data/instances.yaml` row no longer points at the same instance.
- `federation.yaml.identity.name` MUST equal `IDENTITY.md` `Name`. (Not enforced.)
- `package.json.version`, `federation.yaml.version`, `federation.yaml.metadata.framework_version` MUST agree on `major.minor`. (Enforced by `validate-structure.mjs` §8.)
- `data/instances.yaml.<row>.id` (in the framework hub) MUST equal the instance's own `federation.yaml.identity.name`-or-derived-id. (Not enforced; relies on convention `id == repo basename`.)
- `memory/` MUST be append-only. Daily file `memory/YYYY-MM-DD.md` MUST not be overwritten on second-write within the same day. (Documented convention in `CLAUDE.md` and `AGENTS.md:48`; not mechanically enforced — agent discipline only.)
- `DECISIONS.md` MUST be chronologically append-only. (Convention only.)

**Failure modes (concrete things that break identity):**

- **`SOUL.md` overwritten in sync → identity lost.** Mitigated today by `customizations: maintain_on_sync: true`, but the actual `sync-upstream.mjs` script does not exist on disk — so the protection is currently aspirational. Real sync work has been done manually (per 2026-04-24 regen-coordination-os notes); the manual operator preserved more than the protocol formally requires.
- **`memory/` purged on fresh clone → no continuity.** This is *intended* (the v3.5 clone engine explicitly clears `memory/`). It also means: cloning org-os to seed a "fork-with-history" is not possible today; the operator would have to copy `memory/` manually post-clone.
- **Two instances claim the same `id` → conflict.** `data/instances.yaml` would have two rows with the same `id:`. `analyze-instances.mjs` does not currently dedupe-check on `id`. The `bootstrap-interviewer` does not check the framework hub's existing rows before assigning an id.
- **`federation.yaml.identity` and `IDENTITY.md` drift.** No validator catches this. The `regen-coordination-os` row records three known structural drift items (`no_federation_section`, `missing_governance_yaml`, `missing_dao_json`) — a precedent that drift exists silently until someone runs `analyze:instances`.
- **Version triplet drift.** Caught by `validate-structure.mjs §8`. Has actually happened: pre-v3.0, `package.json.version` was `2.0.0` while `federation.yaml.metadata.framework_version` had moved to `"3.0"`. Reconciled in the v3.0.0 release commit.
- **A fork (in the git sense) without an entry in `data/instances.yaml`** is invisible to the hub — i.e., the instance exists from its own perspective but does not exist from the framework's perspective. Discovery is currently manual.
- **`Node ID` (`org-os`) is reused for the framework AND the framework's self-row in any future `data/instances.yaml` self-listing.** Today the framework deliberately does not list itself as an instance; if it ever does, naming collision is likely.
- **The remote URL changes (e.g., repo transferred between GitHub orgs).** `data/instances.yaml.<row>.repo` becomes stale. `last_sync` keeps ticking against the wrong remote. No automated detection.

---

## Open questions

1. **Is the `data/instances.yaml` row authoritative for an instance's identity, or is the instance's own `IDENTITY.md` / `federation.yaml.identity`?** Today: ambiguous. The hub treats `instances.yaml` as truth-of-record; the instance treats its own files as truth-of-self. Resolution direction unclear: a federation might want hub-authoritative; a local-autonomy-first framing wants instance-authoritative.

2. **How do we distinguish a *fork* from a *clone*?** A clone is a new instance with no shared history (per v3.5 design). A fork would be a divergent copy that retains history but operates independently. Today neither word has a mechanical definition. Should forks register in `data/instances.yaml` with `forked_from: <parent_id>` and a `genesis_commit:`?

3. **What is org-os's crypto-identity story?** IDENTITY.md leaves slots (`daoURI`, `Primary Chain`, `Registration Contract`) but every value is `N/A (solo phase)`. Will instances eventually carry a DID? A signing key in `federation.yaml.identity.public_key`? A `did:web:<repo-url>` would be cheap and immediately verifiable.

4. **What's the rename ritual?** If `refi-bcn-os` becomes `refi-cat-os` (Catalonia-wide), what files change, in what order, and how does the hub recognize "this is the same instance with a new name" rather than "old instance vanished, new instance appeared"? No documented procedure today.

5. **Should `genesis_commit` and `framework_version_at_birth` be recorded?** A new instance scaffolded from framework v3.0 vs. v3.5 has materially different DNA, and `last_sync` records only the most recent version. Birth-version is currently lost. (`refi-med-os` was scaffolded 2026-04-28 from v3.0 — recoverable from git log of the initial commit, but not surfaced in the registry.)

6. **`SOUL.md` says "This file persists between sessions"** — but persists where, against what threats? It's not signed, not hashed, not externally pinned. A malicious or sloppy `sync:upstream` could clobber it; the only defense is the `customizations:` whitelist, which itself lives in a sync-managed file.

7. **Are skills part of identity?** `customizations: skills/` is `maintain_on_sync: true`, but the skills directory is also the framework's source-of-canonical-skills. An instance's skill mix (e.g., refi-bcn-os has `research`; refi-dao-os has `research` + `karpathy-guidelines`) is identity-bearing in practice — but not declared as such anywhere.

8. **Does `MEMORY.md` content count as identity, or just history?** If the instance's name and federation entry are unchanged but `MEMORY.md` Key Decisions is wiped, is it the same instance? Today's intuition: yes (it's amnesiac, but it's still the same instance). If so, identity is *thinner* than continuity — the file declarations carry identity; memory carries continuity; they can dissociate.

---

## Existing-plan touchpoints

- **`docs/agent-plans/instance-bootstrap.md`** — explicitly the genesis ritual that *stamps* an identity. Open question 4 of that plan ("Selection storage — extend `federation.yaml` `packages:` block, or introduce a new `instance.manifest.yaml`?") is upstream of "where does identity live." The v3.5 release design (§4, §6) commits to the engine resetting MEMORY/memory/HEARTBEAT/MASTERPLAN/DECISIONS at clone time and re-stamping identity via the wizard — which means the clone engine IS the identity-genesis mechanism today.

- **`docs/agent-plans/federation-protocol.md`** — peers must identify each other for knowledge exchange. Currently relies on `federation.yaml peers:` containing names + repos + trust levels. No cryptographic verification step in the plan; if implemented as currently scoped, peer identity is "whatever the peer says it is, anchored by repo URL." DID/key-based identity would slot in here.

- **`docs/agent-plans/versioning-system.md`** (completed v3.0.0, see CHANGELOG) — its identity-versioning contribution: the `validate-structure.mjs §8 Version Consistency` check. This is the only mechanical identity-invariant the framework currently enforces. It defends one specific failure mode (version triplet drift) and is the model for any future identity-invariant validators.

- **`docs/superpowers/specs/2026-04-25-org-os-3-5-release-design.md` §4** — the cloning engine specification. Its identity-bearing decisions: (a) explicit strip list of framework-only artifacts, (b) explicit reset list of identity-instance files, (c) `bootstrap-interviewer` re-runs to author fresh `IDENTITY.md` content, (d) `framework_version` pinned at clone time. This is currently the most concrete design for "what identity is at birth."

- **`scripts/analyze-instances.mjs`** (existing) + **`data/instances.yaml`** (existing) — together they're the framework hub's view of instance identity. `drift` field is the diff between expected (canonical) shape and actual instance shape. Drift is identity's negative space: the larger the drift, the less recognizably "an org-os instance" the row is.

- **`docs/agent-plans/system-reliability.md`** (queued for v3.5) — pre-commit + CI validators will *enforce* what is currently *suggested* (`validate:structure`, `validate:schemas`). Once enforced, identity invariants gain teeth: the version triplet can no longer drift silently, malformed YAML can no longer corrupt registries.

---

## Framework-level note

**What makes org-os *org-os* across versions and forks?** Not the version number — that's monotonic and changes by design. Not the maintainer or the repo URL — those are contingent. The framework's own identity is the **canonical file structure plus the data model**: the agreement that an org-os instance has root files `SOUL.md / IDENTITY.md / MEMORY.md / HEARTBEAT.md / federation.yaml / package.json` (etc.), that `data/` contains specific named YAML registries with EIP-4824 emission to `.well-known/`, that the agent boot sequence reads those files in a specified order, and that skills follow the `skills/<name>/SKILL.md` shape. **Strip all the content out of any instance and the empty shape is still recognizably org-os.** This shape is enforced by `validate-structure.mjs`, declared in `docs/FILE-STRUCTURE.md` and `docs/DATA-MODEL.md`, versioned via `framework_version`, and propagated by sync. A fork that retains the shape but renames everything is still org-os; a fork that keeps every name but flattens `data/*.yaml` into one file is no longer org-os. The shape is the DNA; the content is the cell.
