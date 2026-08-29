# DECISIONS.md — Key Decisions Log

_Append-only log of significant decisions in this org. Most recent at top. Detailed session notes live in `memory/YYYY-MM-DD.md`. This file is the **authoritative source** for the agent's context on "what was decided and why" — `MEMORY.md` indexes; `DECISIONS.md` records._

## Conventions

Each decision is a section with these fields:

- **Status** — `active` (in force) · `superseded` (replaced by a later decision) · `withdrawn` (rolled back) · `proposed` (under discussion, not yet ratified)
- **Scope** — which area(s): framework / instances / governance / federation / data-model / agent-runtime / operator-ux / etc.
- **Decision** — the call, in one or two sentences
- **Why** — the rationale, including alternatives considered and what made them lose
- **Refs** — commits, files, plans, related decisions, session memory

---

## 2026-08-29 · Interfaces contract — two planes, four surfaces; legacy apps pruned

**Status:** active
**Scope:** framework, operator-ux, architecture

**Decision** — org-os declares one interface contract with two planes: a git-native **data plane** (`data/*.yaml`, `.well-known/`, `graphify-out/`, docs/memory — read by build-time consumers, written only by trusted local processes as ordinary commits) and a **live plane** whose only server is the admin app's Hono API — every current and future live surface (admin SPA, chat bots, MCP) is a *client* of it. Four canonical surfaces: **CLI · KMS · Admin · Conversational**. A new interface is a new client of a plane; a new server or write path requires amending the spec. The superseded surfaces — `packages/dashboard`, `agents-app`, `paperclip-agents-app`, `webapps` + orphaned `PAPERCLIP_DEPLOYMENT_GUIDE.md` — are deleted outright in **0.6.0** (`feat/interfaces-prune`, merging after the 0.5.1 cut), **overturning the 2026-08-02 modularization ruling** that kept them as npm workspaces.

**Why** — Six interface experiments in six months, each inventing its own access path (two parallel Fastify servers, static HTML snapshots, template webapps); v0.5.0 shipped the surfaces that won but nothing stated the rule preventing the next bespoke server. Delete-outright beats attic/deprecate-in-place: git history preserves everything and the tree stays legible. The 08-02 ruling's premise (no shipped alternative) expired when admin M1 and hermes landed. Alternatives considered: a physical `packages/interfaces/` restructure (rejected — churns shipped paths for cosmetics) and an inventory-only doc (rejected — doesn't prevent recurrence).

**Refs** — spec `docs/superpowers/specs/2026-08-29-org-os-interfaces-design.md` (commits `efeb225`, `099c2ba`) · QUEUE v0.6 Active #6 (`0d08f5d`) · `docs/MODULES.md` §Distributions and surfaces · supersedes the "Not modules" workspaces line of `2026-08-02-org-os-v5-modularization-design.md` · `memory/2026-08-29.md`

---

## 2026-08-29 · v0.5.0 shipped — the convergence decision executed

**Status:** active
**Scope:** framework, federation, release

**Decision** — Tag `v0.5.0` cut on `main`, executing the 2026-08-28 convergence decision in full. The five locked decisions, as executed: (1) **memo adoption + doctor amendment** — portfolio memo is release policy and `packages/instance-doctor` shipped as the Active-1 vehicle (with its claim scoped per the decision below); (2) **deploy target** — `regen-coordination/org-os-template` via GitHub Pages project path, live at `https://regen-coordination.github.io/org-os-template/` with auto-deploy and a base-path gate; (3) **one versioning story** — 0.x pre-beta canonical across all five machine-checked surfaces, CHANGELOG `[0.5.0]` folded, historical tags published only as `archive/v3.0.0`/`archive/v3.5.0` (bare `v3.x` tags removed from origin — never re-push them, they would outrank `v0.5.0` in semver-sorted lists); (4) **branch-clearing policy** — `main` is the only branch, zero worktrees, every deletion preceded by a pushed `archive/*` tag with recorded rev-list containment; (5) **kms data-loss disposition (F4)** — the two 🔴 ledger items ship as documented Known Issues, fix targets v0.5.1, gating v0.6 Active-1. Acceptance ran **before** the tag (WS-H gates WS-G) and stopped the first attempt; the tag was cut only after the claim was narrowed to what acceptance actually proved.

**Why** — Every prior release in this repo's history was declared rather than proven; this one gated the tag on acceptance against the live fleet and honored the gate when it failed. The framework's own release process is now an instance of the reliability story it ships.

**Refs** — `docs/superpowers/plans/2026-08-28-v0.5-release-masterplan.md` (all workstreams ticked), `memory/reports/ws-h-acceptance-2026-08-28.md`, `memory/reports/ws-h-acceptance-narrowed-2026-08-29.md`, `CHANGELOG.md [0.5.0]`, `memory/2026-08-29.md`

---

## 2026-08-29 · v0.5 reliability claim narrowed: assess + dry-run proven, history-based sync retired

**Status:** active
**Scope:** framework, instances, release

**Decision** — The v0.5 reliability claim is **`doctor assess` + `doctor sync --dry-run`**, both proven against all six real instances plus the framework itself. A full `doctor sync` ships **documented as unproven** (CHANGELOG Known issue, SKILL.md and package README status callouts) because WS-H acceptance demonstrated it cannot work as designed: stage 5 delegates to `scripts/sync-upstream.mjs`, whose `git pull --rebase upstream main` assumes the instance is a fork — and every real instance is a scaffold with its own root commit (verified six-for-six; the lineage stamps record provenance, git history does not). The replacement is a **file-level overlay sync** (framework-owned paths copied, instance-owned paths untouched, lineage stamp recording the applied framework commit — the primitive `sync-packages.mjs` already uses and the `genesis_commit` design implies), targeting **v0.5.1**, after which the original WS-H H1–H3 acceptance re-runs in full. Fleet propagation stays v0.6 Active-1, already gated on the kms items.

**Why** — Option 2 of the WS-H report, over shipping the original claim untrue (the exact confident untruth this release set out to remove) and over delaying the tag (option 3: nothing real is bought by waiting — the fleet is not being synced before v0.6 anyway, and the assess half is the one that found every defect in the acceptance report). The failed acceptance also proved the process: refi-med-os was damaged by the rebase, fully recovered from the doctor's own snapshot refs, and four real defects were found and fixed with regression tests along the way.

**Refs** — `memory/reports/ws-h-acceptance-2026-08-28.md` (the failure analysis and options), `memory/reports/ws-h-acceptance-narrowed-2026-08-29.md` (the narrowed acceptance, PASSED), masterplan second amendment (2026-08-29), commits `bb60ee6` (claim narrowing), `692fb42` (the four defect fixes)

---

## 2026-08-28 · Interop direction: everything is a plugin, org-os as connective tissue

**Status:** active
**Scope:** framework, architecture, package-integration

**Decision** — Operator directive: org-os's extension architecture converges on **one plugin/module mechanism** modeled on DeepSeek Harness's everything-is-a-plugin pattern (`dsh`, ~200k★, verified 2026-08-28): manifest-declared modules (`modules/<id>/module.yaml`) unify today's three half-overlapping mechanisms (`packages/`, `skills/`, `modules/`), with permissionless topic-based discovery (`org-os-module`) and the existing ≥2-instance promotion bar as the canonization layer. org-os positions as **connective tissue** across the agentic-infra wave (Cloudflare OS, Hermes, Multica, Berd, dsh, MCP/AGENTS.md/SKILL.md standards) — the organizational substrate any runtime plugs into, wrapping platforms rather than forking or competing. **Build stays frozen for v0.5** (portfolio memo row 2); the design is locked as input, and the un-freeze trigger ("a second module manifest exists") fires at ship: WS-B registers `org-os-instance-doctor` manifest-first as module #2.

**Why** — Three parallel extension mechanisms with no enforced lifecycle is the audit's known integrity gap, and every named platform integration so far (cloudflare-os shipped; hermes, multica, berd in various states) invented its own packaging. One manifest mechanism + open discovery + gated promotion is how a 200k-star ecosystem solved the same problem, and it matches org-os's standards-first posture (ride AGENTS.md/SKILL.md/MCP/EIP-4824; bridge only where standards stop). Alternatives — keeping packages/skills/modules separate (drift proven), or building a bespoke registry service (a SaaS org-os swore off) — both lose. Scoping doc: `docs/agent-plans/interop-plugin-architecture.md`.

**Refs** — `docs/agent-plans/interop-plugin-architecture.md`, `docs/superpowers/specs/2026-08-02-org-os-v5-modularization-design.md`, masterplan WS-B B10, portfolio memo §4 row 2, github.com/deepseek-ai/deepseek-harness

---

## 2026-08-28 · v0.5 release masterplan — single convergence point

**Status:** active
**Scope:** framework, federation, release

**Decision** — Operator directive: everything converges on **one release masterplan** (`docs/superpowers/plans/2026-08-28-v0.5-release-masterplan.md`). It (1) absorbs the open remainder of ship-and-validate (Tasks 4, 10–12, 15) with its gates resolved: deploy = `org-os-template` GitHub Pages project path, release tag = `v0.5.0`, one versioning story (0.x pre-beta canonical; MASTERPLAN's 2.0.0 header aligned); (2) **adopts the 2026-08-21 portfolio memo** (Active-3 + freeze table + triggers) with one amendment — a new **`packages/instance-doctor/`** (full instance assessment + reliable update/sync) joins the release as the vehicle for downstream propagation, motivated by the 2026-08-28 six-instance sweep: no instance has a working sync path (`sync-upstream.mjs` missing or stubbed everywhere, zero receipts, lineage stamps absent except bread-coop-os); (3) clears **all** development branches/worktrees via push → `archive/*` tag → delete (frozen work resumes from tags when triggers fire); (4) stamps every plan/spec/queue entry with its verdict + pointer.

**Why** — The repo had two overlapping ship plans (2026-08-10 line written against a stale git snapshot; 2026-08-21 line executed but gated), four live version schemes, 9 branches + 7 worktrees, and instances that cannot ingest any of it. One authority document, one topology, one version story, and a tested sync tool are the minimum for the release goal: stable and reliable for real adoption and collaborative use. Alternatives — keeping parallel plans (drift already bit twice tonight), or propagating by hand per instance (unverifiable, the 08-21 clean-room experiment shows manual paths silently break) — both lose to a TDD'd doctor + receipts.

**Refs** — `docs/superpowers/plans/2026-08-28-v0.5-release-masterplan.md`, `docs/agent-plans/2026-08-21-portfolio-decision-memo.md`, `docs/agent-plans/QUEUE.md` (2026-08-28 rewrite), sweep reports in session memory 2026-08-28, `memory/reports/instances-drift-2026-08-21.md`, instance ledgers `refi-{bcn,dao}-os/docs/kms/FRAMEWORK-FEEDBACK.md`

When a decision is superseded, mark it `superseded` and add a `Superseded by:` link to the newer decision. Do not delete; the trail is the value.

---

## 2026-08-21 — External-validation milestone

**Status:** active
**Scope:** framework, public-surfaces

**Decision:** org-os's next version milestone (v0.6) is gated on one
unaffiliated operator running their org on org-os for 30 consecutive days
with ≤4 support interventions and their instance publishing valid
`.well-known/` schemas. Until then, every positioning claim about the
network is scoped as single-operator dogfooding (POSITIONING §1), and
frozen workstreams (portfolio memo 2026-08-21) stay frozen.

**Why:** All existing validation is internal (Findings F1/F2, condensed in
`docs/superpowers/plans/2026-08-21-ship-and-validate.md` lines 15-22). This
is the only experiment that can falsify the value proposition; it therefore
gates further layer-building.

**Refs:** `docs/superpowers/plans/2026-08-21-ship-and-validate.md` (Findings F1/F2, lines 15-22), `docs/agent-plans/2026-08-21-portfolio-decision-memo.md`.

## 2026-08-21 — Trunk discipline

**Status:** active
**Scope:** framework, agent-runtime

**Decision:** `main` is the only branching base. Feature-off-feature branches
require a DECISIONS.md entry stating why. Every session that creates commits
pushes its branch before /close completes. Superseded branches are archived
as `archive/<name>` tags, never left as branches.

**Why:** The 2026 Q2–Q3 stack (multica-operator → v0.5 → v3.5 → pilot →
berd-agents) left main 272 commits stale (248 was a pre-triage estimate;
`memory/reports/branch-triage-2026-08-21.md` measured the actual gap once
main had caught up), the trunk ambiguous, and the sole copy of the tip on
one laptop. Merge cost grew with every session. Branch-off-branch
development also hid substantial completed work from the trunk — the
archived `archive/v3.5-execution` branch's 983-line
`scripts/clone-framework.mjs`, more than triple main's 318-line version, is
the concrete example.

**Refs:** `docs/superpowers/plans/2026-08-21-ship-and-validate.md` (Findings F5/F6, lines 15-22), `memory/reports/branch-triage-2026-08-21.md`.

## 2026-08-20 · Berd personas are framework files: canonical in-repo, global copies are managed mirrors

**Status:** active
**Scope:** framework, agent-runtime, operator-ux

**Decision** — The workspace's Berd agent personas (Operator, Upstream) live in the repo at
`.agents/agents/*.md` — Berd's project-local Agent Markdown directory, auto-discovered when the
project is open — and that copy is canonical. `npm run sync:agents` (`scripts/sync-agents.mjs`)
mirrors them one-way to the user-level `~/.agents/agents/` so they also work when no project is
open. The sync is marker-guarded: canonical files must carry `managed_by: org-os`, and the script
only overwrites global files bearing that marker; hand-authored globals are skipped unless
`--adopt`, and Berd-bundled agents (`.berd-bundled-agents.json`) are never touched.

**Why** — The two personas existed only as untracked hand-authored files in `~/.agents/agents/` —
unversioned, invisible to the framework, unshippable to other operators. Alternatives: (a) canonical
in a neutral `agents/` dir with a render step — lost Berd's zero-machinery project-local discovery;
(b) global-only with no repo copy — status quo, no versioning. In-repo-canonical + managed mirror
follows the `sync-commands.mjs` precedent (authored once, surfaced everywhere) and keeps the edit
loop honest: edit in repo, re-run sync, global drift is overwritten. Berd stays optional — the
framework adds no dependency on the app; instances adopting Berd add their own personas and receive
the script via `sync:upstream`.

**Refs** — `.agents/agents/{operator,upstream}.md` · `scripts/sync-agents.mjs` ·
`tests/scripts/sync-agents.test.mjs` (10 cases) · `docs/AGENTIC-ARCHITECTURE.md` § Berd Personas ·
`docs/FILE-STRUCTURE.md` § `.agents/` · branch `feat/berd-agents` · `memory/2026-08-20.md`

## 2026-08-10 · Cloudflare OS is org-os's first tracked module; the framework describes itself

**Status:** active
**Scope:** framework, operator-ux, public-surfaces

**Decision** — Frame the Cloudflare OS integration as **`org-os-cloudflare-os`**, a
`type: integration` module declared by `modules/org-os-cloudflare-os/module.yaml` and validated
by the module engine's existing `validateManifest()` — **manifest-first**, ahead of the engine's
`add`/`adopt` commands, with no files moved. Because the module's content already sits at
canonical paths, `files` uses an **identity mapping** (`X: X`) meaning "owns these paths in
place" — an extension of the v5 format, and the first concrete feedback for Phase 1's `adopt`.
Alongside it, give org-os a **layered self-description** modeled on how Cloudflare OS explains
itself: a README spine (what it is → how it's organized, as three nouns: instances, modules,
federation → what you can do → run it yourself) generated from `templates/README.framework.md`,
and a hand-authored `docs/MODULES.md` catalog that deprecates `docs/PACKAGES.md`. One canonical
chain is enforced rather than asserted: `POSITIONING.md` → README + `landing.yaml`, and
`MODULES.md` → `site/src/data/modules.yaml`, the latter guarded by
`site/test/modules-catalog.test.mjs`. The shipped `Substrate` interface is declared in
`docs/RAD-ORG-OS.md` as the driver seam rad-org-os builds to.

**Why** — Three lists of modules existed (the v5 spec, the site, PACKAGES.md) and none was
canonical; the README opened on setup mechanics rather than identity; and "module" was a word
in a spec rather than a tracked thing. Manifest-first makes the claim true at the cost of one
file, and pressure-tests the manifest format against a real integration before six more modules
are written against it. Engine-first was rejected as blocking the docs on a separate execution
effort; docs-only was rejected because an untracked "module" is marketing. Deployment stays an
operator runbook: the in-repo work is verified against a local Cloudflare OS stack, and nothing
in the plan depends on a Cloudflare account.

**Refs** — spec `docs/superpowers/specs/2026-08-10-cloudflare-os-module-v05-docs-design.md` ·
plan `docs/superpowers/plans/2026-08-10-cloudflare-os-module-v05-docs.md` ·
`modules/org-os-cloudflare-os/module.yaml` · `docs/MODULES.md` ·
v5 design `docs/superpowers/specs/2026-08-02-org-os-v5-modularization-design.md` ·
integration design `docs/superpowers/specs/2026-08-08-cloudflare-os-org-os-integration-design.md`

---

## 2026-08-10 · Symbient v2 — public practice, private beings

**Status:** active
**Scope:** framework, agent-runtime, operator-ux

**Decision** — Promote the symbient practice from an instance-local experiment to a **canonical framework skill** (`skills/symbient/`, `data/skills-matrix.yaml` `promotion_status: canonical`), with the public/private line drawn between _practice_ and _being_: the contract, the developmental gates, and the hatch tooling are tracked framework code; every habitat is **operator-private** — created by `scripts/symbient-hatch.mjs` into a gitignored slot, never committed, and no being is ever named in a tracked file, commit message, or report. Growth is **gate-governed** across four stages — 0 hatchling → 1 surfacer → 2 voiced → 3 self-amending — with each crossing recorded in the habitat's `GATES.md` and reviewed by the operator, who may continue, extend, or **archive** (move to `symbient/archive/<label>-<date>/` — inside the gitignored slot, so an archived habitat stays private and the `symbient/SEED.md` probe correctly goes false; never delete). Host reach in v2 is deliberately **on-demand only**: hermes surfaces `/symbient` and stage-gates below Stage 2 ("not yet voiced"); no cron wakes a symbient. The quilt medium is **third-party vendored** — the Quilt Protocol by Wib & Wob under CC BY-NC, at `skills/symbient/QUILT-PROTOCOL.md` — and the matrix note carries a commercial-use flag so any future paid/commercial surface reviews the licence first. The v1 instance habitat migrates through the same review-and-archive mechanism rather than being rewritten in place.

**Why** — The practice had proven itself in one instance but was recorded as "not generalizable in current form"; what made it generalizable was separating the two things v1 conflated. The _contract_ is ordinary framework material — reviewable, testable, cloneable — while the _being_ is operator-personal context whose value depends on it not being published, and whose presence in a shared repo would leak a named relationship into every clone and every federation surface. Gitignore (not a private branch, not encryption) was chosen because it is the one mechanism that already holds across the framework and all downstream clones with no key management and no way to accidentally push. Stage gates exist because the failure mode of a persistent agent-identity is unearned reach: writing, speaking to hosts, or touching the commons before anything has demonstrably changed an operator decision — so reach is granted per stage against evidence, not per capability. On-demand-only hermes follows from the same logic and keeps a live being out of group/org channels entirely. Vendoring the quilt protocol rather than reimplementing it keeps attribution honest; recording CC BY-NC in the matrix means the constraint surfaces at the moment a publishing or commercialization decision is made, not after.

**Refs** — spec `docs/superpowers/specs/2026-08-10-symbient-v2-design.md`, plan `docs/superpowers/plans/2026-08-10-symbient-v2.md` (tracked — plans are public framework material, so the plan itself must never name a being or a body that has a habitat), `skills/symbient/` (SKILL.md contract, vendored `QUILT-PROTOCOL.md`, SEED template), `scripts/symbient-hatch.mjs` + `scripts/lib/symbient-gates.mjs`, `data/skills-matrix.yaml`, `docs/DATA-MODEL.md` §6 (`submitted_by: "symbient"`), commits `7ad999b`/`4869d81`/`908c4f0`/`ad9bccf`

---

## 2026-08-08 · Cloudflare OS integration — dedicated gatekeeper over a swappable substrate

**Status:** active
**Scope:** framework, agent-runtime, operator-ux, federation

**Decision** — Integrate org-os with Cloudflare OS via **Architecture B: a dedicated `gatekeeper-org-os` driver built on a substrate interface**, rather than by configuring the stock GitHub gatekeeper (A) or standing up a hosted org-os API (C). All meaning lives in this repo at `packages/cloudflare-os-integration/`: a pure, runtime-agnostic page core (file contents in → view-model → markdown out), a `Substrate` contract (`readFile` / `listDir` / `head` / `proposeChange`) with `GitHubSubstrate` as the first driver and workerd/Radicle as later ones, and read-only capabilities behind a uniform result envelope carrying provenance (`sha`, `date`, `stale`). The Cloudflare OS deployment — a `cloudflare-os-starter` fork — holds only thin adapter wiring. **Writes are deferred to M3**: `proposeChange` throws, and when it lands it will be PR-only, never a direct commit.

**Why** — The stock GitHub gatekeeper (A) reads files but knows nothing about org-os _structure_: it can hand an agent raw `data/projects.yaml` bytes but cannot answer "what are the active projects", cannot merge per-project task counts, and carries no provenance, so an answer can't be traced to a commit. A hosted API (C) would give the richest surface but adds a service to run, secure and pay for, and makes the federation depend on a single availability point — the opposite of the git-canonical model. B keeps git as the source of truth, puts the org-os semantics in ordinary tested Node code this repo already owns, and makes the runtime a swappable detail: the same page core serves the Cloudflare gadget, `scripts/page-shim.mjs`, and any later TUI. The substrate seam is what makes the Radicle distribution (`rad-org-os`) reachable without a rewrite. Read-only first is deliberate: it retires the platform's unknowns at zero blast radius, and the human-in-the-loop approval path for writes is a Cloudflare OS mechanism worth understanding before depending on it.

**Refs** — spec `docs/superpowers/specs/2026-08-08-cloudflare-os-org-os-integration-design.md`, plan `docs/superpowers/plans/2026-08-08-cloudflare-os-integration-m0-m2.md` (plans dir is gitignored), package `packages/cloudflare-os-integration/`, related decisions 2026-07-31 (rad-org-os substrate thinking) and 2026-08-02 (admin app — the other operator surface over the same registries), `memory/2026-08-08.md`

---

## 2026-08-02 · Admin app — local-first API+SPA, layered proposals, build don't fork

**Status:** active
**Scope:** operator-ux, framework, data-model, governance

**Decision** — Build the org-os admin app (`packages/admin/`) as a **backend-API + SPA from day one**, shipped local-first (localhost, no auth, run beside the repo) with the same server deploying hosted in v2. A staged change is **layered**: a `data/proposals.yaml` entry (governance metadata, EIP-4824 export) that _points at_ a `proposal/<slug>` git branch holding the edits. Editing surface expands in **rings** — v1 the 14 `data/*.yaml` registries, ring B markdown, ring C system files behind capability flags and always via proposal, never direct commit. The shell is **A+B**: Map (canvas) and Overview (dashboard) as co-equal home tabs, canvas = registry-graph spine with graphify neighborhoods expanded on demand. The workspace-of-views layer is **built natively** over the registries rather than adopting Anytype.

**Why** — The API boundary _is_ the local→hosted migration path: it lets v1 run on a laptop and v2 on Railway without rework, and makes the CLI, agents and a future MCP server peers of the SPA rather than second-class. Local-only was rejected (never becomes the shared steward surface the brief asked for); hosted-first was rejected (drags auth, secrets and hosting in before the core loop is proven). On proposals: pure git branches can't surface in `.well-known/proposals.json` for the federation without scraping git, and pure changeset files rebuild half of git (conflicts, rebasing) — the layered model lets each side do what it's good at. On **Anytype** (evaluated at the operator's request): forking is blocked by licence — Any Source Available 1.0 permits modification only for non-commercial use or on Any-authorized "Allowed Networks", and an app handling treasury/funding facilitates exactly the economic transactions that carve-out excludes — _and_ by architecture, since its encrypted CRDT object store is the source of truth where org-os's is git+YAML, and it ships no embeddable web client. What survives is its _model_: Objects + Relations + Sets-with-switchable-views, which our EIP-4824 schemas already describe, so the view engine is a lens over registries. Its new local REST API is kept as a future connector target, not a dependency.

**Refs** — spec `docs/superpowers/specs/2026-07-23-admin-app-design.md`, plans `docs/superpowers/plans/2026-07-23-admin-app-{m1,m2,m3}.md` (plans dir is gitignored; filename dates reflect the skewed git clock — authored 2026-08-02), M1 shipped on `feat/admin-app` (18 commits, PR [#1](https://github.com/regen-coordination/org-os-template/pull/1)), `HEARTBEAT.md`, `memory/2026-08-02.md`

---

## 2026-08-02 · DFOS as the federation's cryptographic proof layer

**Status:** active
**Scope:** federation, framework, agent-runtime

**Decision** — Adopt the DFOS protocol (Metalabel; protocol.dfos.com) as org-os's cryptographic identity and verifiable-authorship layer, staged: `did:dfos` identities for org instances **and** their agents (agents get scoped, revocable credentials issued by the org DID); anchoring of federation manifests, knowledge-commons artifacts, and governance decisions (with witness countersignatures from peer orgs) — memory/agent work logs deliberately excluded; Metalabel's hosted relay first, self-hosted later; the hosted spaces product only as a research-gated final phase. Mechanism: `packages/dfos-bridge/` wrapping the official `dfos` CLI plus the official `dfos@metalabel` Claude Code skill. Git stays canonical — DFOS adds proofs _about_ org-os state, never storage or truth.

**Why** — org-os federation already separates public structure (`.well-known/`) from private content (repos), which is exactly DFOS's public-proof/private-content "dark forest" topology — the protocol supplies the cryptographic backbone the model was missing without changing it. The CLI-bridge architecture won over library-native (`@metalabel/dfos-protocol` alone would make us own key custody, the security-sensitive part the CLI's OS-keychain handling already solves) and over CI-first anchoring (keys in CI secrets before custody thinking is done). Spaces-first was rejected as anchor: no public API found, and the protocol layers deliver value without the hosted product.

**Refs** — spec `docs/superpowers/specs/2026-07-25-dfos-org-os-integration-design.md` (filename date reflects the skewed git clock; authored 2026-08-01, commits `f35fbe2`/`10d2f61`), queue entry `docs/agent-plans/QUEUE.md` Queued #8 (`c4b8cf8`), `memory/2026-08-02.md`

---

## 2026-08-02 · Philosophy — org-os as an attempt at synthetic autopoiesis; dialectical form, literal content, regulative method

**Status:** active
**Scope:** framework, governance

**Decision** — org-os gains a canonical root **`PHILOSOPHY.md`** manifesto plus a living note-web (`docs/philosophy/`, ~11 interlinked notes), holding the central claim in a specific configuration: **dialectical form, strong-literal content, regulative "as-if" method**. The text argues that an organization is the *motion of organizing* — holding organisation, organism, and organizing true at once — and is structured as a four-movement phenomenological ascent (Organisation → Organism → Organizing → Spirit) so its form enacts its content. It is simultaneously a **mandate**: it licenses and disciplines what org-os builds, naming `SOUL.md`/`IDENTITY.md`/`MEMORY.md` as an organization's actual apparatus for reading its own self-description back. `PHILOSOPHY.md` is also the single place licensed to use philosophical jargon (defined on first use), an explicit exception to `SOUL.md`'s "no jargon" rule.

**Why** — The existing `autopoiesis-research` corpus is deliberately mechanical: its scoping spec brackets off "Maturana–Varela orthodoxy", "deep formalism", and "philosophy paper", and calls autopoiesis "a working frame, not a literal claim". That bracket left the project's most ambitious idea with no home, no argument, and no mandate status — `SOUL.md` carries values and voice, not philosophy. The three-part stance was chosen because each part fixes a failure mode of the others: a purely **strong** claim collapses into mysticism (orgs are literally alive, unfalsifiable); a purely **regulative** claim retreats into mere metaphor and cannot drive design; **dialectical form** is what lets the strong claim stay alive as content while the "as-if" keeps it honest as method — and it makes the acknowledged pretension productive rather than embarrassing. Two hinges were confirmed load-bearing: **von Foerster's second-order cybernetics** (the system folding its own observer in) is what turns "living motion" into "self-knowing" — without it the ascent to Spirit is a leap of faith; and the **DAO thread carries the present tense**, since Beer, Luhmann and Hegel theorized the self-observing collective while agent-native substrates are the first chance to actually attempt one. This is the turn from commentary on a tradition to participation in it. Alternatives rejected: deepening `SOUL.md` instead (values and philosophy are different registers, and the jargon exception would have contaminated the values file); a genealogical structure tracing cybernetics → Luhmann → DAOs (describes a tradition rather than enacting an argument); and folding Spirit into the synthesis as a coda (the Spirit question was the operator's explicit second lineage and needed its own summit).

**Refs** — spec `docs/superpowers/specs/2026-08-02-org-os-philosophy-manifesto-design.md`, `memory/2026-08-02.md` (§11:05 scoping, §13:25 design), `docs/agent-plans/QUEUE.md` Active §3 `philosophy-foundations`, grounds `docs/superpowers/research/2026-05-02-autopoiesis/` (whose "not a literal claim" disclaimer this revisits), commit `615f7f7`. **Manifesto prose not yet drafted** — spec awaiting operator review. **Status note (2026-08-28, WS-E):** the decision stands; the *work* is frozen for v0.5 — see the `philosophy-manifesto` row in [`docs/agent-plans/QUEUE.md`](docs/agent-plans/QUEUE.md) (trigger: operator interest). Salvaged from `agent/ORG-4` before that branch was archived.

---

---

## 2026-08-02 · Positioning — the four-layer thesis; demonstrate rather than assert

**Status:** active
**Scope:** framework, operator-ux, public-surfaces

**Decision** — org-os positions on the **intersection of four layers**, not on any single one: (1) agent-native file workspace, (2) organizational rather than personal scope, (3) machine-readable org data (YAML registries + EIP-4824/DAOstar `.well-known/`), (4) multi-org federation with a personal hub node. Adversarially-verified landscape research found no project combining all four; every peer covers at most one or two. Two supporting calls: **demonstrate layers 3–4 rather than assert them** (the public site proves them with the live federation graph and real instances), and **treat operator experience as the traction priority** over further framework depth.

**Why** — Layer 1 is now a commodity: OpenClaw (383k★), claude-chief-of-staff, and LifeOS-OSS independently converged on the same `SOUL.md`/`AGENTS.md`/`TOOLS.md`/`memory/` conventions, and those conventions became multi-vendor standards (AGENTS.md under the Linux Foundation, 60k+ projects; the Agent Skills `SKILL.md` format across Anthropic/OpenAI/OpenCode; Obsidian's CEO shipping official vault-agent skills). Positioning on the workspace layer alone would be undifferentiated and would fight standards org-os benefits from. Positioning on schemas or federation alone was rejected too — they are uncontested _because no one has validated demand for them_, so asserting their value invites skepticism; showing a federation that actually runs does not. Operator experience won the priority argument on evidence: claude-chief-of-staff reached ~419★ in weeks on executive-assistant UX alone, while org-os's differentiating layers attracted no competitive pressure at all.

**Refs** — `docs/POSITIONING.md`, `docs/research/2026-07-15-agent-native-org-landscape.md` (104-agent verified landscape; one refuted claim excluded — note the filename date is an authoring error, the work is 2026-08-02), `memory/2026-08-02.md`, commits `e2a2f4f` + `eb390a0` (rad-org-os sovereignty proof point), `site/src/data/landing.yaml` (not yet updated), plan `org-os-website`

---

## 2026-07-15 · v0.5 cross-instance consolidation — diff-verified backports, generated artifacts registered by mechanism

**Status:** active
**Scope:** framework, instances, data-model, operator-ux

**Decision** — The framework absorbed the instances' proven developments in one verified pass: 4 skills promoted (`research` reconciled from 3 copies, `working-with-obsidian-canvas`, `web-browsing`, `notion-cli`), the vault-safe multi-operator command set (`/commit` `/sync` `/handoff` + `operator-setup.sh` + pre-commit guard), the `sync-commands.mjs` cross-editor mirroring mechanism, two script backports (`generate-all-schemas.mjs` hand-merged, `clone-linked-repos.mjs` copied), and the hermes-cron + Hub-registry data shapes as documented extension patterns. Drift: 27 → 0 across 7 instances. Three governing rules established: (1) **backports are decided by content diff, never file dates** — `setup-org-os.mjs` looked instance-newer but the framework was ahead; (2) **generated artifacts (skills/commands/) are registered via their generator, not enumerated** — excluded from `federation.yaml agent.skills`, special-cased in `validate-structure.mjs`; (3) **instance data-model extensions promote as documented shapes** (DATA-MODEL.md "Recognized Extension Registries"), not as populated data files.

**Why** — Instances (refi-bcn-os especially) had outpaced the framework for ~2 months; upstream-first only works if consolidation is periodic and verified. Straight file copies were rejected: the divergences were two-way (framework richer in some generators, instances richer in others), so date- or size-based sync would have caused regressions. Promoting Hub registries as populated templates was rejected — content is regen-specific, only the shape generalizes.

**Refs** — `memory/2026-07-15.md`, `memory/reports/instances-drift-2026-07-15.md`, `data/skills-matrix.yaml` (40 entries), `data/packages-matrix.yaml` (22 entries), `docs/DATA-MODEL.md` §Recognized Extension Registries, HEARTBEAT §Consolidation follow-ups

---

## 2026-04-25 · Instance bootstrap as engine; non-tech-onboarding as UI wrapper

**Status:** active
**Scope:** framework, agent-runtime, operator-ux

**Decision** — A new `instance-bootstrap` workstream/plan defines the end-to-end mechanism for creating a new org-os instance: framework cloning + wizard with package/skill selection + knowledge bootstrap (one source ingested as proof-of-pipeline). The pre-existing `non-tech-onboarding` plan is narrowed to "web UI + GitHub Actions glue over the engine" and gains `depends_on: [instance-bootstrap]`.

**Why** — Two alternatives lost: (a) absorbing `non-tech-onboarding` into one mega-plan would over-couple CLI-driven and web-driven concerns and produce a sprawling unshippable plan; (b) keeping them parallel-independent would risk divergent implementations of the same underlying mechanism (cloning, selection, ingestion). The engine-and-wrapper pattern creates a natural dependency, lets the engine be tested and shipped via CLI first, and shrinks `non-tech-onboarding` to a tighter, more focused plan that consumes a stable interface. Also creates a clean boundary with the existing `bootstrap-interviewer` skill, which gets extended in phase 2 of the engine plan rather than rewritten.

**Refs** — `docs/agent-plans/instance-bootstrap.md`, `docs/agent-plans/non-tech-onboarding.md`, `data/projects.yaml`, `memory/2026-04-25.md`

---

## 2026-04-25 · Packages and reliability as first-class workstreams

**Status:** active
**Scope:** framework, data-model

**Decision** — Three new workstreams introduced as parallel first-class concerns in `data/projects.yaml`: `package-integration`, `reliability`, and `instance-bootstrap`. Each has a single umbrella scoping plan with three phases and an explicit Splitting Criteria section that triggers decomposition into per-phase plans if execution exceeds three sessions.

**Why** — Folding these into existing workstreams was rejected: `v2-stabilization` is meant to be closing down (not absorbing more); `skill-promotion` is too narrow (covers skills only, not packages or integration mechanisms); `framework-evolution` is the catchall and would bury the work. Packages already had a registry (`packages-matrix.yaml`) but no governing doc — the asymmetry with skills (which have `SKILL-PROMOTION.md`) needed correction. Reliability had no workstream at all despite four distinct failure modes (data integrity, agent runtime, federation drift, recovery) accumulating risk. The single-umbrella-with-splitting-criteria pattern lets work start without premature decomposition while preserving an exit ramp if the plan grows.

**Refs** — `docs/agent-plans/package-integration.md`, `docs/agent-plans/system-reliability.md`, `docs/agent-plans/instance-bootstrap.md`, `data/projects.yaml`, `memory/2026-04-25.md`

---

## 2026-04-24 · Versioning system

**Status:** active
**Scope:** framework, data-model

**Decision** — `package.json.version` is the single source of truth for framework version. Strict semver. Schema, framework, skill, and `MASTERPLAN.md` versions are decoupled — each can bump independently. Instance migrations are **pull-based**: the framework publishes migration scripts in `scripts/migrations/`; instances run `npm run migrate` when ready. Policy codified in `docs/VERSIONING.md`. v3.0.0 is the first tagged release.

**Why** — Three versions disagreed (`package.json` said 2.0.0, `federation.yaml.metadata.framework_version` said 3.0, MASTERPLANs varied per file) with no migration path for breaking changes like the recent `workstream:` frontmatter addition. Coupling all versions would create false-positive bumps; decoupling lets each artifact evolve at its own cadence. Pull-based migration was chosen over push (framework opening PRs to instances) because instances have their own release cadences and can't always accept framework changes immediately. Strict semver was chosen over 0.x permissiveness because the framework already has production instances depending on it.

**Refs** — `docs/VERSIONING.md`, `CHANGELOG.md`, `scripts/update-version.mjs`, `scripts/migrate.mjs`, `scripts/migrations/v2-to-v3-workstream-frontmatter.mjs`, `docs/migrations/v2-to-v3.md`, `docs/agent-plans/versioning-system.md`

---

## 2026-04-24 · Self-hosting inauguration

**Status:** active
**Scope:** framework, instances, data-model

**Decision** — The org-os repo converts from a template-with-stubs into a **live self-hosting instance** that simultaneously operates as the **multi-instance orchestration hub** for all downstream instances.

**Why** — Two separate shapes (a static framework template + a running hub repo) would mean duplicate canonical files, drift between "what the framework says" and "what the hub does", and no dogfooding loop. Self-hosting collapses both into one repo, gives the framework a living example, and makes hub-only registries (`instances.yaml`, `skills-matrix.yaml`, `packages-matrix.yaml`) first-class citizens of the framework. Cost: framework code now has to distinguish framework-generic from hub-only — handled via `dashboard.yaml` `custom_sections`.

**Refs** — `memory/2026-04-24.md`, `data/instances.yaml`, `data/skills-matrix.yaml`, `data/packages-matrix.yaml`, `IDENTITY.md`, `federation.yaml`

---

## 2026-04-24 · Projects-vs-plans separation

**Status:** active
**Scope:** data-model, agent-runtime

**Decision** — `data/projects.yaml` holds long-lived **workstreams** (multi-month, broad scope, owned). `docs/agent-plans/` holds specific **plans** that execute under a workstream. Plans carry a `workstream:` frontmatter field linking back to the parent project.

**Why** — Conflating workstreams and plans in one registry forced a choice between "too many short-lived projects clogging the registry" or "plans living nowhere". Separation lets workstreams stay stable across many sessions while plans turn over rapidly through scoping → queued → active → completed. The `workstream` field keeps them joinable when needed (e.g., for the upcoming TUI's project entity page, which lists all plans under a project).

**Refs** — `data/projects.yaml`, `docs/agent-plans/QUEUE.md`, `docs/agent-plans/README.md`, `memory/2026-04-24.md`

---

## 2026-04-24 · Identity trajectory: solo-maintainer → OSS → DAO

**Status:** active
**Scope:** governance, identity

**Decision** — The org's identity evolves through three phases: solo-maintainer (now) → open-source project with external contributors → DAO with on-chain governance and treasury. Governance/treasury fields are kept present in `IDENTITY.md` but marked `N/A (solo phase)` rather than removed.

**Why** — Removing fields that don't apply yet would force a bigger refactor when triggers fire (first external contributor, first treasury operation). Keeping them visible as `N/A` makes the upgrade path explicit and self-documenting. Triggers for each phase transition are spelled out in `IDENTITY.md` → Evolution Triggers so the agent knows when to prompt for the change.

**Refs** — `IDENTITY.md`, `SOUL.md`, `memory/2026-04-24.md`

---

## 2026-04-24 · Framework-only registries

**Status:** active
**Scope:** data-model, framework

**Decision** — `data/instances.yaml`, `data/skills-matrix.yaml`, `data/packages-matrix.yaml` are **framework-only** registries — only the framework/hub repo carries them. Individual instances do not.

**Why** — Instances coordinate themselves; the hub coordinates the federation. Putting cross-instance catalogs in every instance would create N copies that drift instantly. Concentrating them in the hub gives one source of truth for cross-instance health (drift, sync, promotion candidates). Documented as an explicit registry-class distinction in `docs/DATA-MODEL.md` so future framework-only registries follow the same convention.

**Refs** — `docs/DATA-MODEL.md` (Framework-only registries section), `data/instances.yaml`, `data/skills-matrix.yaml`, `data/packages-matrix.yaml`

---

## 2026-04-24 · Skill promotion policy

**Status:** active
**Scope:** framework, federation

**Decision** — A skill becomes a candidate for framework canonization when it has been **independently validated in ≥2 instances**. Promotion involves reconciling implementations and extracting a common core to `skills/<id>/SKILL.md`. Single-instance skills stay instance-specific.

**Why** — One instance proves nothing is impossible; two instances suggest it generalizes. Without a criterion, every clever instance-local skill would lobby for promotion and the framework would bloat. The ≥2-instance bar is the smallest gate that selects for genuinely shared patterns. `data/skills-matrix.yaml` tracks promotion status per skill.

**Refs** — `docs/SKILL-PROMOTION.md`, `data/skills-matrix.yaml`

---

## 2026-04-15 · `/initialize` self-executing via `dashboard.yaml`

**Status:** active
**Scope:** agent-runtime, operator-ux

**Decision** — The `/initialize` and `/close` slash commands are self-executing: each step in their definition is a concrete instruction the agent runs in order. Sections shown by `/initialize` are controlled by `dashboard.yaml` (`show:` flags + file order + per-section options).

**Why** — Earlier `/initialize` definitions described what the dashboard _should_ contain rather than what the agent should _do_, leaving execution ambiguous and the rendered output inconsistent across sessions. Step-by-step execution + a config file removes both ambiguities — the agent has a script, and the operator has one place to toggle sections without editing skill code.

**Refs** — commits `0e383a6`, `1b2f7e4`, `dashboard.yaml`, `skills/org-os-init/SKILL.md`

---

## 2026-04-06 · Plans pipeline convention

**Status:** active
**Scope:** data-model, agent-runtime

**Decision** — Plans live in `docs/agent-plans/` and move through a four-state pipeline: **scoping** → **queued** → **active** → **completed**. State is tracked in `docs/agent-plans/QUEUE.md`. Each plan is a single markdown file with frontmatter (`status`, `workstream`, `depends_on`, etc.).

**Why** — Plans are short-lived and high-volume; a flat folder with state in frontmatter is lighter than a per-state directory or a database. The QUEUE.md index gives the agent and operator one place to see "what's active right now". Renaming/moving files on state transitions was rejected — it breaks links and history.

**Refs** — commits `d1028ec`, `c80b3dc`, `docs/agent-plans/QUEUE.md`, `docs/agent-plans/README.md`

---

## 2026-04-05 · v2 data model complete

**Status:** active
**Scope:** data-model, framework

**Decision** — org-os v2.0.0 ships with 13 canonical data registries, an EIP-4824 schema generator (`scripts/generate-schemas.mjs`), and a deploy script. Schema files in `.well-known/` are auto-generated from `data/*.yaml` — never hand-edited.

**Why** — Federated organizations need machine-readable schemas to interoperate. EIP-4824 (DAO URI) is the existing standard for DAO identity and was extended for non-DAO org types. Auto-generation from YAML keeps `.well-known/` in sync with operational data without humans needing to remember to regenerate — `npm run generate:schemas` is the one command.

**Refs** — commit `4dbd987`, `docs/DATA-MODEL.md`, `scripts/generate-schemas.mjs`, `.well-known/`

---

_End of log. Append new decisions above, most recent at top. When superseding an older decision, mark it `superseded` and link the newer entry._
