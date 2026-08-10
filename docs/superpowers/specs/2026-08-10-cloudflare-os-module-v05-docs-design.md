# Cloudflare OS as an org-os Module + v0.5 Self-Description — Design

**Date:** 2026-08-10
**Status:** Approved (brainstorm 2026-08-10)
**Related:**
- `docs/superpowers/specs/2026-08-08-cloudflare-os-org-os-integration-design.md` (the integration itself; M3–M4 plan derives from it, not from this spec)
- `docs/superpowers/specs/2026-08-02-org-os-v5-modularization-design.md` (module system; this spec conforms to its manifest format ahead of the engine)
- `docs/POSITIONING.md` (ratified four-layer thesis — the sole copy source)
- `docs/RAD-ORG-OS.md` (gains the substrate-seam section)

## 0. Summary and locked decisions

Cloudflare OS integration M0–M2 is built and locally verified (86 tests; adapter live against
the real GitHub API including the private refi-bcn pilot). What remains is deployment-dependent
operator work, plus the framing this spec supplies: **make the integration org-os's first real
module, and make org-os describe itself the way Cloudflare OS does** — a layered
self-description that turns the framework from a pile of docs into an adoptable product, and
closes the named gap with rad-org-os via the shipped substrate interface.

| Question | Decision |
|---|---|
| Deploy to Cloudflare now? | **No — later.** Deployment becomes an operator runbook checklist; this spec covers no deployed-workspace work |
| Module framing | **Manifest-first.** `modules/org-os-cloudflare-os/module.yaml` conforming to the approved v5 format; engine `adopt`s it when Phase 1 lands. No file moves |
| Docs scope | **In-repo spine + site wiring.** README rewrite + hand-authored `docs/MODULES.md` catalog + `landing.yaml`/`modules.yaml` wiring. GitHub Pages deploy stays its own queued plan |
| rad-org-os connection | **Explicit convergence doc.** RAD-ORG-OS.md gains a section declaring the shipped `Substrate` interface the shared driver seam |
| Program structure | **One new spec (this), three plans:** (1) module+docs plan from this spec; (2) M3–M4 plan from the approved integration spec; (3) deployment runbook as a docs deliverable inside plan 1, executed by the operator later |

## 1. The module: `modules/org-os-cloudflare-os/`

**Naming.** Integration modules are named after their external system (v5 backlog precedent:
`org-os-koi`, `org-os-hermes`) → `org-os-cloudflare-os`. Not `org-os-cloudflare`, which would
read as "org-os deployed on Cloudflare."

**Shape: hybrid manifest + package reference — no file moves.** The v5 spec's Hybrid decision
applied: code-heavy modules reference their package. `packages/cloudflare-os-integration/`
stays exactly where it is (tests, page-shim import path, adapter — nothing breaks). The module
directory contains only the manifest:

```
modules/org-os-cloudflare-os/
  module.yaml
```

```yaml
id: org-os-cloudflare-os
version: 1.0.0
type: integration
description: Cloudflare OS workspace integration — gatekeeper-org-os, page core, org-dashboard gadget
dependencies: [org-os-standards]
npm: "@org-os/cloudflare-os-integration"
files:
  # adopt-style: targets are the files' current canonical homes; no materialization needed
  docs/integrations/cloudflare-os.md: docs/integrations/cloudflare-os.md
  packages/cloudflare-os-integration/**: packages/cloudflare-os-integration/**
checks:
  - file-exists: packages/cloudflare-os-integration/src/adapter/gatekeeper-org-os/wrangler.jsonc
  - command: npm run test:cloudflare-os-integration
```

**Engine relationship.** The manifest conforms to the approved v5 field table so Phase 1's
`module -- adopt` records it without rework. Until the engine exists it is declarative-only —
no validation tooling ships with this spec (that is Phase 1's `module.schema.json`).
`org-os-cloudflare-os` becomes the first inhabitant of `modules/` and a live test of the
manifest format against a real integration.

**Honesty requirements.** The module's status is **pilot** — locally verified,
deployed-workspace verification pending — and the manifest's catalog entry says so.
`dependencies: [org-os-standards]` forward-references a module that doesn't exist yet; the
catalog marks that dependency `planned`. Neither claim is inflated.

## 2. The docs spine (org-os describing itself)

The Cloudflare OS self-description pattern (os.cloudflare.app), transplanted: **four layers
deep, three nouns wide** — *what it is* → *how it's organized* → *what you can do* → *run it
yourself*.

### 2.1 README.md rewrite (top of the spine)

Restructured to that layering, with all copy **sourced from `docs/POSITIONING.md`** — no new
copywriting:

1. **What org-os is** — one paragraph from POSITIONING's hero copy.
2. **How it's organized** — org-os's three nouns: **instances** (git repos that are the org),
   **modules** (versioned capabilities), **federation** (the network of instances). The agent
   runtime is presented as the cross-cutting layer.
3. **What you can do** — operator moments: dashboard, session lifecycle, knowledge commons,
   workspace chat + gadgets (the Cloudflare OS module is the evidence).
4. **Run it yourself** — pointer to the SETUP paths, unchanged.

Existing README content (scripts tables, structure detail) is re-homed downward or deferred to
linked docs — nothing deleted.

### 2.2 `docs/MODULES.md` — the hand-authored v0.5 module catalog

Replaces deprecated `docs/PACKAGES.md` as the catalog surface. One entry per module — the
7-module v5 tranche, the v5.x backlog, the site's existing module list (reconciled, see §3),
and `org-os-cloudflare-os` — each with exactly four fields:

- **What it is** (one line)
- **How it works** (2–3 sentences)
- **Status** (shared vocabulary, §3)
- **Links** (spec, docs, package — only ones that exist)

Header states plainly: *hand-authored until the module engine generates it* (v5 spec Phase 2),
so it is honest about being a snapshot and the future generator inherits a proven format.
`org-os-cloudflare-os` gets the flagship entry: status `pilot`, linking to the discovery doc
(`docs/integrations/cloudflare-os.md`), the adapter runbook, and the integration spec.

**Non-deliverable:** no new per-module doc pages in v0.5. The catalog links to docs that
already exist. Seven module monographs would sink the scope.

## 3. Site wiring (one story, one source)

Found during design: **three competing module lists** exist — the v5 spec tranche/backlog, the
site's `site/src/data/modules.yaml` (a different set: website-generator, kms, rad-org-os,
hermes, members-hub, ideation; different status vocab), and deprecated PACKAGES.md. And
`site/src/data/landing.yaml` still carries pre-positioning hero copy.

**Fix: a single canonical chain.**

```
POSITIONING.md  →  README.md + site landing.yaml     (narrative)
docs/MODULES.md →  site/src/data/modules.yaml        (catalog)
```

- **`landing.yaml`** — hero/eyebrow/subtitle replaced with POSITIONING's ratified copy. (This
  absorbs the already-open `org-os-website` wiring task — it is the same edit.)
- **`modules.yaml`** — re-authored as a mirror of MODULES.md: the union list, reconciled. The
  site's current entries are absorbed into MODULES.md, not discarded — most map onto the v5
  backlog; `rad-org-os` is listed as **the sovereign distribution**, serving the product
  framing directly. A header comment names MODULES.md as canon.
- **Status vocabulary reconciled** to one progression used by both files:
  `planned → in-dev → pilot → live`. (`org-os-cloudflare-os` = `pilot`.)
- **MODULES.md doubles as a site docs page for free** — the site already renders curated
  `../docs` via its content-collection loader; add MODULES.md to the docs allowlist and the
  catalog appears under `/docs` with zero extra plumbing.

Out of scope, unchanged: the GitHub Pages deploy stays its own queued plan
(`docs/agent-plans/github-pages-deploy.md`); this spec ensures that when it fires, what goes
live already tells the right story.

## 4. The substrate seam (`docs/RAD-ORG-OS.md`)

A new ~30-line section, **"The substrate seam (shipped 2026-08)"**:

- The tested `Substrate` interface — `readFile / listDir / head / proposeChange`,
  `SubstrateError` codes (`NOT_FOUND`, `UPSTREAM`), ETag/TTL cache semantics — from
  `packages/cloudflare-os-integration` is declared **the starting point for the rad-org-os
  driver interface**.
- Two implementations exist today: `MemorySubstrate` (tests), `GitHubSubstrate` (live). A
  Radicle driver means implementing the same contract over `radicle-httpd` + the `rad` CLI.
- The open task "plan the substrate driver interface" starts from this shipped contract and
  **extends** it: `clone / sync / push / publish-schema` are *instance-lifecycle* operations,
  deliberately not part of the read/write substrate, and get designed in that task — not
  retrofitted here.

No restructuring of RAD-ORG-OS.md beyond adding the section.

## 5. Deployment runbook (operator checklist, written now — executed later)

Appended to `docs/integrations/cloudflare-os.md` as a checkbox sequence, consolidating what is
already scattered across the adapter README and the M0–M2 plan's blocked tasks:

1. Deploy the `cloudflare-os-starter` fork to the Cloudflare account (M0 Task 1).
2. Copy in `gatekeeper-org-os` per the adapter runbook; set `ORG_OS_INSTANCES`,
   `ORG_OS_GITHUB_TOKEN` (fine-grained, `contents:read`, scoped to `refibcn`).
3. Configure the model (OpenCode Go via the Ollama compat slot — documented in the runbook).
4. Run M1 acceptance chat (4 questions + provenance sha traceability) → record evidence in
   §"M1 acceptance evidence".
5. Install the org-dashboard gadget: paste `blueprints/org-dashboard/gadget.html`, write the
   ~3-line `rpc.mjs` binding shim (§D4), run acceptance incl. the STALE badge check.
6. Export the blueprint → commit the `.gadget` archive next to the HTML (§D6 flow).
7. Flip the module catalog entry `pilot → live` and update the manifest description if needed.

This is a docs deliverable of plan 1. Its *execution* is operator work on the CF account,
deliberately outside every plan.

## 6. Verification and error handling

- `npm run validate:structure` stays green with `modules/` present (add an allowance if the
  new top-level dir trips it).
- `cd site && npm run build` green with the new yaml.
- `npm test` and `npm run test:cloudflare-os-integration` untouched-green.
- No new test infrastructure — this is docs plus one manifest.
- **Drift handling:** every mirrored artifact carries a pointer to its canon
  (`modules.yaml` → MODULES.md; README narrative → POSITIONING.md; manifest ↔ v5 field
  table), so drift always has a defined resolution direction.

## 7. Deliberately out of scope

- Module engine work (v5 Phase 1 has its own plan).
- GitHub Pages deploy (queued plan with its own open decisions).
- Per-module doc pages.
- Any M3–M4 code (writes, `org-inbox`, federation-map gadget — plan 2, from the integration
  spec).
- Any copy not derivable from POSITIONING.md.
- Substrate driver interface design (its own future brainstorm, now seeded by §4).

## 8. Program map (what happens after this spec)

| # | Artifact | Source | Content |
|---|---|---|---|
| 1 | [`2026-08-10-cloudflare-os-module-v05-docs.md`](../plans/2026-08-10-cloudflare-os-module-v05-docs.md) (10 tasks) | **this spec** | §1 manifest, §2 spine, §3 wiring, §4 seam section, §5 runbook text |
| 2 | [`2026-08-10-cloudflare-os-m3-m4.md`](../plans/2026-08-10-cloudflare-os-m3-m4.md) (13 tasks) | integration spec (2026-08-08) | 4 write capabilities + `org-inbox` via `proposeChange` (PR-only), federation-map gadget + instances view, `npm run selftest` wiring; webhook invalidation stays Phase 2 |
| 3 | Operator deployment session | §5 runbook, extended by plan 2 | executed whenever the operator sits down with the CF account; flips the module `pilot → live` |

Plan 1 opens with a Task 0 that folds three post-approval discoveries back into this spec: the
module engine's `validateManifest()` already exists (so the manifest is validated by real
tooling), `README.md` is generated from `templates/README.framework.md` (so the template is the
edit target), and the README's doc list is an alphabetical slice with empty blurbs that would
never have surfaced `MODULES.md`.
