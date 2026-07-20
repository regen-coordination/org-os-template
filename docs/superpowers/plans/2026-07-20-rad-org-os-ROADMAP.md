# rad-org-os — Implementation Roadmap (plan index)

> **For agentic workers:** this is the index for the rad-org-os v1 build. The spec is [`docs/superpowers/specs/2026-07-20-rad-org-os-design.md`](../specs/2026-07-20-rad-org-os-design.md). v1 = Tiers 1+2. The work is decomposed into **four sequenced plans**, each of which produces working, testable software on its own and builds on the prior. Write and execute them in order.

**Why decomposed:** the spec spans several independently-testable subsystems (host abstraction, the Radicle driver, bootstrap/seed-node, governance+command+federation wiring). Per the writing-plans scope rule, each becomes its own plan. Plan 1 pins the `HostDriver` interface and a reusable contract test suite that Plans 2–4 depend on, so it is written first and in full; Plans 2–4 are written when reached (they depend on concrete interface signatures and live `rad` CLI/API output formats best pinned during Plan 1/2 implementation, so writing their bite-sized code now would require unverified guesses).

## Plan sequence

| # | Plan | Ships | File | Status |
|---|------|-------|------|--------|
| 1 | **Host abstraction foundation** | `@org-os/host` package: `HostDriver` interface + registry, driver resolver keyed on `platforms.canonical`, behavior-preserving `github` driver, a reusable driver-contract test suite, and `frontier.mjs` refactored to route through the seam. GitHub cohort behavior unchanged. | [`2026-07-20-rad-org-os-1-host-abstraction.md`](2026-07-20-rad-org-os-1-host-abstraction.md) | **✅ shipped** — merged to `v0.5` (14 commits, 25 host + 65 kms tests green, full subagent-driven review) |
| 2 | **Radicle driver (`@org-os/rad`)** | `packages/rad-org-os`: `rad-cli.mjs` (write path via one `execRad` chokepoint), `httpd.mjs` (read path, radicle-httpd API v6.1.0), `cob.mjs` (COB↔registry), `identity.mjs` (did:key + delegate/threshold). Implements `HostDriver`; passes Plan 1's contract suite; integration test against a local `radicle-node`. | [`2026-07-20-rad-org-os-2-radicle-driver.md`](2026-07-20-rad-org-os-2-radicle-driver.md) | **✅ shipped** — merged to `v0.5` (12 commits; `@org-os/rad` passes the HostDriver contract; 27 rad + 26 host + 66 kms tests green; live read-path integration against `seed.radicle.xyz`; full subagent-driven review incl. a Critical silent-write fix). Remaining live debt: `rad id update` flags + a real patch/issue creation round-trip (need `rad node start`). |
| 3 | **Bootstrap & seed-node** | `rad-bootstrap` (zero→live Radicle-first genesis) + seed-node recipe (`Dockerfile`/`compose.yml`/`compose.tor.yml`/`seeding-policy.md`) + the 3-tier availability chooser. | [`2026-07-20-rad-org-os-3-bootstrap-seed-node.md`](2026-07-20-rad-org-os-3-bootstrap-seed-node.md) | **written + live-verified** — 5 tasks, TDD; `rad auth`/`rad init`/`rad node` flags pinned to live `rad 1.8.0`; gated real-bootstrap integration |
| 4 | **Governance, commands & federation wiring** | `xyz.radicle.crefs` quorum-governed `main` mapping; route `/commit /sync /handoff /close /initialize` through the driver; refactor `clone-linked-repos.mjs` + `sync-upstream.mjs` + `sync-github.mjs`→`sync.mjs`; additive `federation.yaml`/`members.yaml`/`instances.yaml` fields; `.well-known` served-from-node; dual-stack mirroring; sovereign-runtime audit + `rad-skill` adoption. | `2026-07-20-rad-org-os-4-governance-commands-federation.md` | pending |

## Deferred (not in this roadmap)

- **Tier 3** — replace the 3 GitHub Actions workflows with `radicle-ci-broker` adapters; full GitHub-Pages → node hosting rebuild. Designed in the spec, built later; lands on the seed-node recipe from Plan 3.
- **Local-LLM runtime** — separate module near `org-os-hermes`. Plan 4 only guarantees runtime-agnosticism, not the runtime itself.

## Plan 2 prerequisites (carried over from Plan 1's final review)

Plan 1 shipped and merged; its final code review surfaced items to resolve **at the start of Plan 2**, when the second (`radicle`) driver actually exists to validate against:

1. **Per-entry driver routing in the frontier crawl.** `frontier.mjs` currently calls `resolveDriver(fed, …)` keyed on the *hub's* `platforms.canonical`, then fetches each peer with that one driver. Once a `radicle` driver is registered, a github-canonical hub crawling a `rid`-only peer (or vice-versa) would silently degrade to `unreached`. Fix: select per-entry by the peer's scheme (`resolveRemoteScheme(entry.rid || entry.repo)`), not the hub's canonical. (Inert today — only `github` is registered.)
2. **Uniform `cwd` + `local_path` composition.** `fetchFile` resolves `join(cwd, entry.local_path, path)` while `getCanonical`/`getDrift` pass `{ cwd: entry.local_path }` (which *replaces* the driver's base `cwd` via `callCwd ?? cwd`). Aligned only because frontier runs with `cwd:'.'`. Make the composition uniform before other call sites use a non-`.` driver cwd.
3. **`fetchFile`'s `ref` arg is ignored when `local_path` is present** (returns the working-tree file regardless of requested ref). Document this as the contract's intended semantics so the `radicle` driver's `fetchFile` matches rather than diverges.
4. **`whoami()` returns real identity in the radicle driver.** github's `whoami` returns `{ id: null, handle: null }` (no shell-out); the radicle driver's `whoami` should return the node's real `did:key`. The strengthened contract only requires an `id` property to exist.
5. **github `resolveRemote('rad:…')` mislabels a rad id as github** (`{scheme:'github', fetchUrl:'…/rad:z…'}`). Inert (the resolver never routes a rad id to the github driver), but add a guard for robustness.

Already resolved in Plan 1 (do not redo): typed-errors export; per-call `cwd` forwarding in `exec`; null-slug guards in `clone`/`webUrl`; the approved `skipped:'unreached'` frontier diagnostic on degraded reads; and the contract suite now asserts write-path shape + fail-loudly against both the reference and github drivers.

## Cross-cutting rules (all plans)

- **Vault safety** (root `CLAUDE.md`): never `git stash`/`clean`/`reset --hard`; `npm run vault:snapshot` before large ops. The driver must never introduce a destructive git op.
- **Writes fail loudly** (spec): the `radicle` driver never falls back to HTTP for writes; missing `rad`/down node → actionable error.
- **Behavior-preserving refactors**: the `github` driver reproduces current script/command behavior exactly; golden tests assert this before the `radicle` driver is wired.
- **Commit to the operator trunk, not `main`** (per `/commit` skill). Structural files (`data/*.yaml`, `federation.yaml`, `.well-known/`) are PR-gated.
