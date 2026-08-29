---
id: interop-plugin-architecture
title: "Interop & everything-is-a-plugin — org-os as connective tissue"
status: scoping
priority: null
scope: framework
depends_on: [v0.5-release]
created: 2026-08-28
workstream: framework-evolution + package-integration
---

> **Release status (2026-08-28):** Design input for v0.6 — build stays frozen per the portfolio memo (module engine, row 2), but the un-freeze trigger ("a second module manifest exists") fires at v0.5 ship: WS-B registers `modules/org-os-instance-doctor/module.yaml` as the second tracked module. Convergence: [v0.5 release masterplan](../superpowers/plans/2026-08-28-v0.5-release-masterplan.md).

## Operator directive (2026-08-28)

org-os should be **connective tissue**: the repo-structured substrate that connects agentic platforms into a collaborative agentic environment for organizational development and knowledge commoning — easy to plug into, easy to plug things into. Adopt the **everything-is-a-plugin** model (per DeepSeek Harness) for org-os's modules/packages, and maximize interoperability with the current agentic-infra wave rather than competing with it.

## The reference model — DeepSeek Harness (`dsh`)

Verified 2026-08-28 (github.com/deepseek-ai/deepseek-harness): open-source agent harness, ~200k★, MIT, TypeScript/pnpm, developer preview. The relevant properties to adopt, not the codebase:

1. **Everything is a plugin** — tools, models, agents, tasks all integrate through one plugin mechanism (composition framework: Cordis) instead of N bespoke extension points.
2. **Topic-based community discovery** — plugins are found via a `dsh-plugin` GitHub topic; the registry is the ecosystem itself, not a gatekept index.
3. **Manifest-configured lifecycle** — declarative config; the harness owns init/composition/lifecycle.
4. **Honest maturity signaling** — "developer preview / breaking changes" stated up front (matches our 0.x pre-beta stance).

## What this means for org-os

**Today org-os has three half-overlapping extension mechanisms:** `packages/` (18 dirs, no enforced lifecycle — audit gap), `skills/` (Agent Skills format + promotion pipeline), `modules/` (v5 manifest-first; engine frozen; one module: `org-os-cloudflare-os`). The v5 modularization spec (2026-08-02) already points the right way; this directive settles its open architecture question:

- **One mechanism: the module manifest.** Packages, skills bundles, and host integrations all become modules declared by `modules/<id>/module.yaml` (validated by the shipped `validateManifest()`), with per-file checksums, dependencies, and lifecycle — `packages/` and `skills/` become materialization targets, not parallel registries. `data/packages-matrix.yaml` / `skills-matrix.yaml` collapse into generated views over module state.
- **Topic-based discovery:** an `org-os-module` GitHub topic mirrors `dsh-plugin` — any repo can publish a module; `federation.yaml` + `.well-known/modules.json` advertise what an instance runs. Promotion (≥2 instances) stays the canonization bar; discovery becomes permissionless.
- **Host integrations are modules, symmetrically:** org-os plugs INTO harnesses (a dsh plugin / Claude Code plugin / OpenClaw workspace exposing an org-os instance), and harness bridges plug into org-os (`org-os-cloudflare-os` is the existing proof). Wrap, don't fork.

## Interop surface matrix (ride standards, bridge platforms)

| Surface | Status | Note |
|---|---|---|
| AGENTS.md / SKILL.md / CLAUDE.md file conventions | **shipped** | The commodity layer org-os already rides (Linux Foundation / cross-vendor) |
| MCP | **shipped in practice** | mcp-builder skill; instances consume MCP servers; candidate: org-os instance AS an MCP server (read capabilities exist in cloudflare-os-integration's page core) |
| EIP-4824 `.well-known/` | **shipped** | The machine-readable org layer no harness has |
| Cloudflare OS | **M0–M2 shipped**; deploy half frozen (memo row 0) | First tracked module; `Substrate` interface is the declared driver seam |
| Hermes | **shipped** (`packages/hermes-integration`) | Local runtime + Telegram gateway lane |
| Multica | frozen (memo row 8) | Trigger: stable self-hosted release |
| Berd | **built + discovery-verified, catalogued `pilot`** (2026-08-28 spec; built on `feat/v06-integrations` as v0.6 Active #5; verified 2026-08-29) | github.com/block/berd — Block's desktop app over Goose/ACP, open-sourced 2026-08-19 (its "formalize when it stabilizes" trigger fired). Module #4 `org-os-berd` = personas + curated skills bridge into `.agents/skills/`; personas layer verified live, and `goosed skills list` now confirms all five bridged skills are discovered and parsed live — exercise-under-Goose + Task 5's pruning pass still pending (HEARTBEAT.md tracker). Spec: [berd design](../superpowers/specs/2026-08-28-berd-integration-design.md) |
| Buzz | **built + verified, catalogued `pilot`** (2026-08-28 spec; built on `feat/v06-integrations` as v0.6 Active #4; verified end-to-end 2026-08-29) | github.com/block/buzz — Block's Nostr-based workspace (chat+forge+workflows, one signed event log; humans and agents as keypair peers). Agent-lane bridge = module #3 `org-os-buzz`, fail-open `/close`-posts / `/initialize`-reads hooks verified live against a real relay and the real `buzz` binary (`packages/buzz-integration/VERIFIED.md`); 5-session dogfood acceptance still pending (HEARTBEAT.md tracker). Spec: [buzz design](../superpowers/specs/2026-08-28-buzz-integration-design.md) |
| dsh plugin (org-os ↔ dsh) | to scope | The new reference harness; 200k★ ecosystem reach |
| A2A / agent-to-agent protocols | watch | Adopt when a federation peer needs it, per standards-first principle |

## Principles (constraints on the design)

1. **org-os stays the substrate, not the runtime** (POSITIONING §7: "they provision agent workers; org-os provides the organizational substrate any runtime's agents operate on"). Plugins bring runtimes to the org; org-os brings the org to runtimes.
2. **Standards-first, bridges-second:** prefer riding AGENTS.md/SKILL.md/MCP/EIP-4824 over bespoke adapters; a bridge module is the fallback, not the default.
3. **Git-native manifests, permissionless discovery, gated canonization** — the promotion pipeline is the trust layer, the topic is the reach layer.
4. **Honest maturity labels** on every module (`lifecycle_status` already exists — enforce it in the manifest).

## Scope & sequencing

- **v0.5 (in the release, already planned):** `org-os-instance-doctor` ships manifest-first as module #2 (masterplan WS-B B10) → fires the engine trigger for v0.6.
- **v0.6 (this doc's build phase, at un-freeze):** brainstorm → spec update of the v5 modularization design with the plugin/discovery model above → module engine (`loadRegistry/add/adopt/update`) built against ≥2 real manifests → migrate 2–3 existing packages (hermes-integration, federation-map, kms) to manifests as the acceptance test → publish the `org-os-module` topic convention in docs/FEDERATION.md + SKILL-PROMOTION.md.
- **Research tail:** dsh plugin prototype (org-os instance exposed inside dsh). Buzz identification and Berd formalization both resolved 2026-08-28 (specs above).
