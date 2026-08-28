# org-os-kms Connector Layer — Design Spec

**Date:** 2026-07-19
**Status:** implemented on frozen branch (v0.6+; portfolio memo row 12)
**Package:** `packages/org-os-kms` (+ a portable contract in `packages/toolkit-framework`)

## Summary

Make `@org-os/kms` a cohesive, composable knowledge-base substrate by adding a **connector layer**: a new portable seam where external protocols (GitHub, KOI, Radicle, atproto, Synthefy, Geo) each become a pluggable *source driver*. An instance's knowledge base is then "set up" by declaring, in `kms.yaml`, which connectors it composes — turning protocol integration into configuration.

This effort ships:
- A **Connector contract** (framework-side, portable) + a `runConnector` orchestration.
- **Two real connectors** — `github`, `koi`.
- **Four specced stubs** — `geo`, `radicle`, `atproto`, `synthefy` (registered, discoverable, `pull` throws `NOT_IMPLEMENTED`; docstring *is* the implementation spec).
- A **cohesion fix** — per-instance `kms.yaml` binding overrides (removes the only real cross-instance code drift, in refi-dao-os).
- Validation against **refi-dao-os** (primary proving ground) and **org-os** (cold-start).

Explicit non-goals this pass: live `subscribe`, real `publish`/contribute-back, the refi-bcn-os paradigm migration, and Notion/Synthefy implementations. All are named follow-ons.

## Context: what exists today

The `toolkit-framework` already has two clean extension seams, but **no transport/protocol abstraction**:

1. **Storage-adapter contract** (`toolkit-framework/src/storage.mjs`) — a 5-method interface (`store / list / update / index / writeIndex`); registry of `kb-folder`, `repo-data`, `geo`. `geo.mjs` is a *documented stub* mapping the contract onto an external network (IPFS + The Graph) — the precedent for "a protocol as a place knowledge lives."
2. **`source-system` schema** (`toolkit-framework/schemas/source-system.yaml`) — "THE federation primitive." Every external environment is a peer *card* with a `return_path` contribute-back hook. `org-os-kms/src/registry-bridge.mjs` bridges these into `data/source-systems.yaml`.

Federation today is peer-cards + ontology-compatibility (K4) + **draft-only** contribute-back (`federate.mjs`, `sync.push`). Nothing knows *how* to reach an external protocol and pull/push objects. That gap is what this design fills.

**org-os-kms module shape** (the module we extend): `framework.mjs` is the single seam to the framework; `bind.mjs` holds the declarative binding tables (`REGISTRY_BINDINGS`, `LIFECYCLE_BINDINGS`); `ops.mjs` is the op registry / wiring hub; `executor.mjs` runs lifecycle op sequences; `cli.mjs` is the composition root; `registry-bridge.mjs`, `render.mjs`, `federate.mjs`, `promote.mjs`, `config.mjs` are focused leaves. 44/44 tests passing at baseline.

**Protocol readiness** (from workspace inventory):
| Protocol | State |
|---|---|
| **KOI** | Extensive but skeleton — `packages/koi-bridge` (TS, RID model, HTTP client: `/events/poll`, `/bundles/fetch`, `/query`), `packages/koi-opal-bridge` (`UnifiedKnowledgeAPI.search({sources})`), live `regen-koi` MCP (`https://regen.gaiaai.xyz/api/koi`). Real substrate to wrap. |
| **GitHub** | Git/repo plumbing only (`repos.manifest.json`, `clone-linked-repos.mjs`, `github:` fields). No knowledge-object adapter. |
| **Radicle** | None — planning notes only. |
| **atproto** | None. |
| **Synthefy** | None — entirely new; protocol docs unknown. |
| **Geo** | Storage-adapter stub exists (`geo.mjs`); no read/connector side. |

**Cross-instance reality** (note: `regen-toolkit` no longer exists standalone — **`org-os` is the canonical baseline**):
- **refi-dao-os** — near-canonical adopter: 104 typed KB entries (`data/kb/`, 8 schemas + index.json), KOI-wired, GitHub repos. Only drift = 5 vendored source edits repointing `encyclopedia-entry` Starlight→Quartz; the file itself flags this as awaiting per-instance binding overrides. Branch `main`, not a submodule.
- **refi-bcn-os** — *paradigm fork*: no KMS/toolkit code; bespoke `scripts/compile-knowledge.mjs` + "symbient" system; 660-md corpus in a separate GitHub repo (`refi-bcn-knowledge`) + Notion. Branch `luizfernando`, not a submodule.
- **org-os** — canonical baseline; KB is an empty scaffold (`knowledge/INDEX.md`, `data/knowledge-manifest.yaml` domains `[]`).

## Architecture

### The new seam

A **Connector** is a source driver: it knows how to reach one external protocol, present itself as a `source-system` peer, and turn that protocol's native objects into framework KB candidates. It plugs in *in front of* the existing pipeline — it does not replace storage or federation.

### Placement

The **contract + orchestration** live framework-side (portable, like `storage.mjs`); the **concrete connectors + registry + composition** live in org-os-kms. The framework never depends on org-os-kms — org-os-kms registers *into* the framework's seam.

```
toolkit-framework/                      ← portable, host-agnostic (the CONTRACT)
  src/connector.mjs        NEW  — Connector contract + registry helpers + runConnector() orchestration
  src/ingest.mjs           (existing — connectors feed this)
  src/storage.mjs          (existing — objects land here)
  schemas/source-system.yaml (existing — a connector IS one)

org-os-kms/                             ← the org-os host binding (the CONNECTORS)
  src/connectors/
    index.mjs              NEW  — connector registry (name → connector)
    github.mjs             NEW  — real
    koi.mjs                NEW  — real
    radicle.mjs            NEW  — specced stub (NOT_IMPLEMENTED)
    atproto.mjs            NEW  — specced stub
    synthefy.mjs           NEW  — specced stub
    geo.mjs                NEW  — specced stub (read side of the Geo graph)
  src/ops.mjs              +op  — `ingest.pull` lifecycle op
  src/framework.mjs        +re-export runConnector + connector contract
  src/bind.mjs             +CONNECTOR_DEFAULTS table
  profile/profile.yaml     +connector composition block
  docs/CONNECTORS.md       NEW  — layer documentation
```

### Data flow (one ingest cycle)

```
kms.yaml declares:  connectors: [ {name: github, config:{...}}, {name: koi, config:{...}} ]
        │
        ▼
ops `ingest.pull`  ──for each declared connector──▶  registry.get(name) → connector
        │
        ▼
framework.runConnector(connector, {config, cursor, storageAdapter}):
   1. connector.describe(config)     → source-system card ──▶ upsert as a peer (federate seam)
   2. connector.pull(config,{cursor})→ { records[], cursor }        (network read; read-only)
   3. records.flatMap(map)           → [{schema, object}] KB candidates  (foreign → framework schema)
   4. framework ingest + store       → storage adapter persists, maturity = raw
   5. everything lands in review_queue (csis-review gates before it's canonical)
        │
        ▼
cursor persisted in kms.yaml (per-connector) so the next pull is incremental
```

### Invariants

1. **Read-only outbound this pass.** `pull` does network reads only. `publish`/`subscribe` are *declared capabilities* on the contract but unimplemented; contribute-back stays draft-and-present via existing `federate.mjs`.
2. **Everything enters through review.** No connector writes canonical registries directly; ingested objects are `raw` maturity and pass `csis-review`. Consolidation never silently overwrites (upsert-by-id, non-destructive).
3. **A connector *is* a source-system.** `describe()` returns the federation card, so pulling from a protocol automatically registers it as a first-class peer — connectors and federation unify.

## The Connector contract

Defined framework-side in `connector.mjs`, in the style of the storage-adapter docstring contract. A connector is a plain object:

```
Connector = {
  name:         string,              // 'github' | 'koi' | 'radicle' | 'atproto' | 'synthefy' | 'geo'
  protocol:     string,              // human label, e.g. 'GitHub REST/GraphQL', 'KOI-net'

  // — identity —
  describe(config)      → source-system object   // this source AS a federation peer card
                                                 // (title, type, steward, return_path, endpoint)

  // — ingest (built now) —
  pull(config, {cursor})  → { records: [...], cursor: <opaque> }
                          // fetch foreign records since cursor; cursor is connector-opaque
                          // (a commit SHA, a KOI event seq, an atproto rev) — never parsed outside
  map(record, config)     → [{ schema, object }]   // ONE foreign record → 0..n KB candidates,
                                                    // each validating against a framework schema

  // — capability declaration (designed, mostly deferred) —
  capabilities:  { ingest: true, subscribe: false, publish: false },

  // — optional, only if a capability is true —
  subscribe?(config, onEvent)  → unsubscribe()     // live NEW/UPDATE/FORGET (KOI-native; deferred)
  publish?(config, records)    → { applied:false, draft }   // contribute-back; DRAFT-ONLY when built
}
```

### Contract semantics

- **`map` is pure and total.** Given a foreign record + config it returns validated KB candidates or `[]` — no network, no I/O. This is the one method each protocol *must* get right, and it is trivially unit-testable against fixture records. `pull` (impure, network) and `map` (pure, translation) are deliberately split so tests never hit the network.
- **Cursors are connector-opaque tokens**, exactly like storage refs — the orchestrator stores and replays them but never inspects them. Enables incremental pulls without the framework knowing each protocol's change model.
- **`describe()` is the federation bridge.** Its output is a real `source-system` object that flows through `registry-bridge.mjs` into `data/source-systems.yaml`. "I pull from KOI" and "KOI is my peer" are the same fact.
- **Capabilities gate dispatch.** `runConnector` only calls `subscribe`/`publish` if the connector declares them true. A stub declares `{ ingest:true, subscribe:false, publish:false }` and its `pull` throws `NOT_IMPLEMENTED` — registered and discoverable, not live.
- **`runConnector(connector, ctx)`** (framework orchestration) is the single place that sequences `describe → pull → map → ingest → store → review` and persists the returned cursor. Connectors stay dumb drivers; all lifecycle/error policy lives in one tested function.

## Composition & lifecycle

### Composition in `kms.yaml`

```yaml
instance: refi-dao
framework: "@regen-commons/toolkit-framework"
adapter: repo-data                 # existing — where objects land
target: .                          # existing

connectors:                        # NEW — the composition block
  - name: github
    config:
      repos: ["ReFiDAO/refi-dao-os", "ReFiDAO/refi-dao-content"]
      include: [issues, discussions, releases, markdown]
    cursor: null                   # written back after each pull (incremental)
  - name: koi
    config:
      coordinator: "https://regen.gaiaai.xyz/api/koi"
      rid_scope: "rid:orgos:org:refi-dao"
    cursor: null
```

An instance's knowledge base is *defined* by this list. Stub connectors are declarable too — they throw `NOT_IMPLEMENTED` on pull until built, so the config surface is stable ahead of the implementations.

### Lifecycle integration

- New op **`ingest.pull`** in `ops.mjs` (`kind:'exec'`, `write:true` → fail-hard): reads `kms.yaml.connectors`, resolves each via the org-os-kms connector registry, calls `framework.runConnector` for each, writes cursors back, returns a per-connector report (records pulled, candidates mapped, errors).
- **Binding placement:**
  - `close` lifecycle: `[ingest.pull, csis-review, bridge, emit-contributions, federate.check, index.rebuild, render.site, render.dashboard, sync.push]` — `ingest.pull` runs **first**, so the pull → review → bridge order holds: freshly pulled objects land as `raw`, `csis-review` gates them in the same session, then `bridge` writes only reviewed/promoted content into registries. (Original baseline `close` began `[csis-review, bridge, ...]`; we prepend `ingest.pull`.)
  - `initialize` stays read-only (no pull on open) — see the KB on open, refresh it on close. Keeps session-open fast and side-effect-free.
- **Manual/targeted run** via CLI: `org-os-kms ingest --connector github` (and `--dry` to pull+map+report without storing) for iterating on one source without a full lifecycle cycle.

### Profile / bind twin

`profile/profile.yaml` gains a `connectors:` block documenting available connectors + default composition; `bind.mjs` gains a `CONNECTOR_DEFAULTS` table mirrored by the profile (same twin pattern as `REGISTRY_BINDINGS`/`LIFECYCLE_BINDINGS`).

## The six connectors

Each: `describe()` card type · what `pull` fetches (cursor) · what `map` produces · notes.

### Built for real

**`github.mjs`** — `source-system` type `repo`.
- **pull:** over configured repos, fetch issues, discussions, releases, tracked markdown via the GitHub API (`gh` CLI first — already a workspace dependency, no token wrangling; REST fallback). **Cursor** = per-repo `updated_at` high-water mark (issues/discussions support `since`), incremental.
- **map:** issue/discussion → `signal` or `claim-evidence` (title, body, author→steward, url); release → `resource`; curated markdown doc → `encyclopedia-entry`. Per-`include`-type rules, fixture-tested.
- **contribute-back (deferred):** `publish` drafts a GitHub issue/PR body via `return_path`; draft-only.

**`koi.mjs`** — `source-system` type `knowledge-garden`.
- **pull:** wrap the existing `koi-bridge` client + live `regen-koi` MCP. `POST /events/poll` for `NEW/UPDATE/FORGET`, `bundles/fetch` for contents. **Cursor** = KOI event sequence / RID watermark. Reuse the RID model and HTTP surface — wrap, not rebuild.
- **map:** a KOI bundle → the framework schema matching its RID type; the RID is preserved in the object's provenance so KOI identity survives round-trips. `FORGET` maps to a review-flagged retraction (never a silent delete).
- **subscribe (declared, deferred):** KOI's event stream is the natural home for the future `subscribe` capability.

### Specced stubs

Registered, discoverable; `pull` throws `NOT_IMPLEMENTED`. Each file's docstring *is* the implementation spec: auth model, `describe` card type, `pull` cursor model, `map` target schemas, contribute-back path. `capabilities` declared honestly (`{ ingest:true, subscribe:false, publish:false }`), but `describe()` returns a valid card even in stub form.

- **`geo.mjs`** — type `database`. Read side of the Geo knowledge graph (IPFS + The Graph). Spec: `pull` = Geo read API over the instance's space; `map` = triple-set → KB object via the kernel's JSON-LD `@context`. Pairs with the existing geo *storage* stub — same protocol, both seams specced.
- **`radicle.mjs`** — type `repo`. p2p-git. Spec: `pull` = read a Radicle node's COBs (issues/patches) over a seeded RID; cursor = COB oid; contribute-back via signed COB. Grounds the abstraction against decentralized git (no central API).
- **`atproto.mjs`** — type `forum`/`archive`. Spec: `pull` = repo CAR / `com.atproto.repo.listRecords` over a DID + lexicon; cursor = repo `rev`; `map` = lexicon record → `signal`. Grounds it against federated social + DID identity.
- **`synthefy.mjs`** — type `database` (provisional). Marked **OPEN — needs protocol docs**; TODO enumerated (auth, object model, cursor). Honestly flagged as the one unknown.

**What the four stubs buy us:** the contract is validated against a central API (geo/The Graph), decentralized git (radicle), DID-based federated social (atproto), and an unknown (synthefy) — four maximally different shapes — proving `describe/pull/map/cursor/capabilities` is general, at doc cost only.

## Cohesion pass (folded in)

1. **Per-instance binding overrides in `kms.yaml`.** `registry-bridge.mjs`/`bind.mjs` read `kms.yaml.registry_bindings` as an override layer over the `REGISTRY_BINDINGS` defaults. refi-dao-os then drops its 5 vendored source edits and expresses the Quartz path as *config*. Removes the only real cross-instance code drift and is a precondition for connectors composing cleanly per-instance.
2. **Keep `framework.mjs` the single framework seam** — route `runConnector`/contract re-exports through it (no new back-doors). `connectors/index.mjs` is the only new composition root; `ops.mjs` stays the wiring hub. Preserves the module's "one seam, one hub, one composition root" shape.
3. **README + `docs/CONNECTORS.md`** so the layer is discoverable.

## Consolidation as proving ground

Scoped as validation, not open-ended merge.

- **Primary target: refi-dao-os.** Real adopter (104 typed entries, KOI-wired, GitHub repos). Success = run `github` + `koi` connectors on `close`, land new candidates in the review queue, csis-review them, bridge into existing `data/kb` — *without* disturbing the 104 existing entries (upsert-by-id, non-destructive). End-to-end proof the layer works on a live KB.
- **Secondary target: org-os canonical.** Empty scaffold — pulling from its own GitHub repo populates it from zero, proving cold-start.
- **refi-bcn-os: explicit follow-on, not this pass.** Paradigm fork (no KMS code; bespoke compiler + symbient; corpus in separate GitHub repo + Notion). Adopting the connector layer there is its own migration. This design gives it an on-ramp: the `github` connector pointed at `refi-bcn-knowledge` is the natural first bridge. Notion (which bcn uses) isn't in the five — flagged as a likely 7th connector, not built.

**Scope guardrail:** this effort ships the connector layer + 2 real connectors + 4 stubs + the binding-override cohesion fix, validated against refi-dao-os and org-os. The full bcn paradigm merge, live `subscribe`, real `publish`, and Notion/Synthefy implementations are named follow-ons.

## Error handling

- **`ingest.pull` is `write:true` → fail-hard.** A network or mapping failure stops the op cleanly (no half-written KB), consistent with the executor's existing write-op policy. The op returns a structured per-connector report so partial progress before the failure is visible.
- **`pull` network errors** surface as the connector's failure; `runConnector` does not swallow them. Cursor is only advanced after a successful store, so a failed pull re-fetches from the last good cursor (at-least-once, idempotent via upsert-by-id).
- **`map` returning `[]`** is valid (record not relevant) — not an error.
- **Stub `pull`** throws `NOT_IMPLEMENTED` with the connector name; `ingest.pull` reports it per-connector and continues to the next connector (a declared-but-unbuilt connector must not abort a live one). This is the one exception to fail-hard, scoped narrowly to `NOT_IMPLEMENTED`.
- **`FORGET`/retraction** never deletes; maps to a review-flagged object.

## Testing

- **Pure `map` unit tests** per connector against fixture foreign records (GitHub issue JSON, KOI bundle) → expected `{schema, object}` candidates validating against framework schemas.
- **`runConnector`** tested with a fake in-memory connector (no network): verifies the `describe → pull → map → store → review` sequence, cursor persistence, and capability gating.
- **`ingest.pull` op** tested with injected deps (like existing `executor`/`ops` tests): reads a fixture `kms.yaml`, resolves connectors from a fake registry, asserts the per-connector report.
- **Stub contract test:** each stub returns a valid `describe()` card and throws `NOT_IMPLEMENTED` on `pull`.
- **Idempotency e2e:** pull twice → no duplicate KB entries (mirrors existing bridge tests).
- **Binding-override test:** `kms.yaml.registry_bindings` overrides `REGISTRY_BINDINGS`; absent key falls back to default.
- Baseline to preserve: existing 44/44 tests stay green.

## Open questions / follow-ons

- **Synthefy protocol docs** — unknown object model/auth/cursor; stub flagged OPEN.
- **Notion connector** — not in the five, but refi-bcn-os needs it; likely 7th connector.
- **Live `subscribe`** — KOI event stream is the target; deferred.
- **Real `publish`/contribute-back** — must stay draft-and-present; deferred.
- **refi-bcn-os paradigm migration** — separate project; `github` connector is the on-ramp.
