# rad-org-os — Public Artifacts & Roadmap Design

> **Date:** 2026-07-31 · **Status:** approved design (brainstorm output) · **Scope:** artifacts + roadmap only — no Radicle code this cycle.
>
> **Theme:** Turn the one-line `rad-org-os` module entry into a real public surface: a capability map (current + future), the first module detail page on the org-os site, a canonical framework doc, and the data/roadmap entries that make it a tracked workstream. Grounded in `docs/research/2026-07-31-radicle-state-of-network.md` (Radicle 1.9.1, July 2026).

---

## 1. Scope

**In scope:**
- Definition + capability map for rad-org-os (the content core all artifacts share).
- Website: `/modules/rad-org-os` — the site's **first module detail page**, establishing the pattern.
- Documentation: canonical `docs/RAD-ORG-OS.md`, on the site docs allowlist.
- Data & positioning: `modules.yaml` link, `data/projects.yaml` project, `POSITIONING.md` update, HEARTBEAT follow-ups.
- Research artifact: `docs/research/2026-07-31-radicle-state-of-network.md` (already committed alongside this spec).

**Not in scope (named follow-ons):**
- Any Radicle implementation code (substrate drivers, bootstrap path, KMS `radicle` connector `pull`, seed-node scripts).
- Outreach one-pager for grassroots-org sharing (follow-on once the page exists to link).
- A standalone rad-org-os repo, brand, or site.
- Dynamic `/modules/[id]` route generalization — deferred until a second module needs a detail page.

The original site spec (`2026-06-17-org-os-website-design.md` §1) deferred "per-module detail pages" to the Starlight step. This spec deliberately un-defers **one** page as a plain Astro page — no Starlight, no new framework.

---

## 2. Definition — what rad-org-os is

**One-liner (canonical):** *rad-org-os is the sovereign distribution of org-os — the full organizational stack running on Radicle, peer-to-peer, with no platform that can take it away. And in the other direction: the missing organization layer for Radicle.*

Four components under one name:

1. **Code-substrate abstraction** (framework seam). org-os stops assuming GitHub: a small driver interface — clone, sync, push, propose-change, publish-schema — with `github` and `radicle` drivers, selected by the existing `platforms.primary` field (`schemas/federation.yaml:393-401` already enumerates `radicle`; note no code reads that field yet). GitHub becomes *a* backend, not *the* backend.
2. **The Radicle-native distro.** Fork/seed/bootstrap/federate an org-os instance entirely over Radicle: `rad clone` instead of GitHub fork, patches instead of PRs, `did:key` identities as operator identities, seed nodes replacing the central remote.
3. **KMS `radicle` connector.** Already a specced stub in the connector-layer design (`2026-07-19-org-os-kms-connector-layer-design.md`): Radicle repos as knowledge sources. rad-org-os is the module that implements it.
4. **The org layer for Radicle** *(added from research).* Heartwood has **no org/team primitive** — only per-repo delegates + quorum. rad-org-os composes one from org-os's existing shapes: the instance repo as org index (member DIDs/RIDs in `data/members.yaml`), membership as seed-node allow-list policy, `federation.yaml` as network topology, delegate quorum as cryptographic multi-sig over canonical org state.

**Honest framing for all copy:** org-os is already ~90% substrate-agnostic — markdown, YAML, and git don't care where the remote lives. rad-org-os closes the last 10% (bootstrap, sync scripts, federation transport, operator flows) and proves it end-to-end. Today it is a design + roadmap, not shipped code; every artifact says so.

---

## 3. Capability map (now / next / later)

The content core, rendered on the site page, in the doc, and tracked as roadmap. Three tiers with strict honesty semantics: **now** = true today, **next** = committed roadmap (first implementation plans), **later** = exploration, published as exploration.

### Now — true today
- The entire file-based core (identity files, memory, data registries, EIP-4824 schemas, skills, session lifecycle) works on any git substrate; nothing in the org-os core calls GitHub APIs.
- `schemas/federation.yaml` lists `radicle` as a valid `platforms.primary` value — a declaration slot, not a feature; no code reads it yet.
- A `radicle` source driver is specified in the KMS connector-layer *design* — a written design, not shipped code (the connector layer itself is not yet implemented; there is no `connectors/` directory in `packages/org-os-kms/`).
- An org *can* seed an org-os instance on Radicle today — nothing breaks, but nothing assists. (Radicle itself supplies: DIDs, patches, issues, private repos via allow-list replication, seed nodes on RPi-class hardware, scriptable `rad` CLI, node event socket + webhooks adapter, CI broker with GitHub Actions bridge.)

### Next — committed roadmap
1. **Substrate driver interface** + `radicle` driver behind the framework's sync/bootstrap scripts (`github` driver = current behavior, extracted).
2. **Radicle bootstrap path** in the setup interview — "where does your org live?" → GitHub | Radicle; `rad init` + seeding instead of fork.
3. **Seed-node runbook** — home server / Raspberry Pi, systemd, seeding policy as membership, pinned Radicle ≥1.9.1.
4. **KMS `radicle` connector `pull`** — implement the stub against `radicle-httpd` read API + `rad` CLI.

### Later — exploration (published as such)
- **Federation transport over Radicle** — instances discover and sync each other p2p; gossip replaces webhook/cron sync.
- **Operator trunks as Radicle patches** — the existing per-operator-branch flow mapped to patches, with **delegate quorum as the merge gate** (org roles → repo delegates; canonical org state becomes cryptographically multi-sig).
- **DID ↔ `members.yaml` identity mapping** — members carry `did:key`; agent verifies authorship against delegates.
- **Agent as node-local daemon** — trigger on node event socket, act via `rad` CLI, read via `radicle-httpd` (the write API is unofficial; agents write through the CLI).
- **Private instances** for sensitive orgs — allow-list replication; flag plainly that Radicle private repos are *not* encrypted at rest.
- **CI + publishing** — radicle-ci-broker adapters; site publishing via Radicle Pages (paid Radicle Garden) or self-hosted.

---

## 4. Website page — `/modules/rad-org-os`

**File:** `site/src/pages/modules/rad-org-os.astro` — plain Astro page reusing `Layout`, `StatusBadge`, `SectionBlock`, existing tokens/theme. Zero client JS (site rule). Deterministic SVG/text for the architecture sketch.

**Anatomy (top to bottom):**
1. **Hero** — eyebrow `v0.5 module · in-dev`; title `rad-org-os`; lead: grassroots-first one-liner (draft, final copy at implementation): *"Your organization can't be deplatformed. rad-org-os runs the full org-os stack on Radicle — peer-to-peer, sovereign, no chokepoints."*
2. **Why** — three short blocks: (a) the grassroots story — orgs that can't depend on centralized platforms (citable: Radicle's own radicle.xyz ISP blocklisting → domain move with zero network impact; HardenedBSD standing up 6 global replicas in 24h); (b) sovereignty is hygiene for every org; (c) same files, different substrate — org-os is already 90% substrate-agnostic.
3. **Two-directional positioning** — one tight paragraph: sovereign distro for org-os users; the missing org layer for Radicle users.
4. **Capability map** — the §3 three tiers as three groups with status-badge styling consistent with `/modules` (now = live-style, next = in-dev-style, later = planned-style).
5. **Architecture sketch** — the substrate seam: org files → driver interface → GitHub | Radicle, in the site's systems style.
6. **Status banner + roadmap** — explicit: "in development; no Radicle code shipped yet; here's exactly what exists," linking the canonical doc and the KMS connector spec.
7. **CTA row** — read the docs (`/docs/rad-org-os`) · follow the repo · get in touch.

**Data change:** `site/src/data/modules.yaml` → `rad-org-os.link: /modules/rad-org-os` (card's "spec pending" becomes "learn more →").

**Copy rules (from POSITIONING.md §9 + research):** demonstrate, don't assert; no "Tech for Palestine" (unverified); disclose Radicle caveats where relevant (read-only official API, private repos not encrypted at rest, Pages is paid, CI is bring-your-own, mirroring covers code but not issues/patches); SOUL voice — plain, direct, technically precise, no corporate speak.

**Single-source rule (drift control).** `docs/RAD-ORG-OS.md` is the **canonical** capability map; the site page mirrors it. Corrections start in the doc, then propagate to the page in the same commit. This spec and its plan are point-in-time records — they are not kept in sync after the artifacts ship, so the ongoing drift surface is exactly two files.

---

## 5. Documentation

- **`docs/RAD-ORG-OS.md`** (canonical framework doc, source of truth for the module). Outline: Vision → The four components (§2) → Capability map (§3, kept in sync with the page) → Architecture (substrate seam, org-layer composition) → Roadmap & status → Relationship to Federation / KMS / bootstrap engine → FAQ ("why not just GitHub?", "is Radicle ready?", "what about private data?", "can we run both?" — yes, mirroring is the transition pattern).
- **Allowlist:** add to `site/src/data/docs-allowlist.ts` under a new **Modules** group: `{ file: "RAD-ORG-OS", slug: "rad-org-os", title: "rad-org-os", group: "Modules" }`.
- **`docs/POSITIONING.md`:** update §5 constellation table row for rad-org-os with the two-directional one-liner; add the domain-move proof point to §2's supporting list.
- **Research artifact:** `docs/research/2026-07-31-radicle-state-of-network.md` (committed with this spec) — internal; not on the allowlist.

## 6. Data & roadmap artifacts

- **`data/projects.yaml`** — add `rad-org-os` project (stage: Discovery, lead: github:luizfernandosg), `researchArtifacts: [docs/research/2026-07-31-radicle-state-of-network.md]` per research-praxis SOP; link this spec.
- **After data change (house rules):** `npm run generate:schemas && npm run validate:schemas && npm run generate:quilt`.
- **`HEARTBEAT.md`** — follow-up tasks: substrate-driver plan, Radicle bootstrap path, seed-node runbook, KMS radicle connector `pull` (the §3 "next" tier as queue entries).

## 7. Testing & verification

- **Site:** `cd site && npm test && npm run build` green; build's verify step passes; `/modules/rad-org-os` renders; `/docs/rad-org-os` resolves from the allowlist; modules card link works.
- **Data:** `validate:schemas` + `validate:structure` green after `projects.yaml` change; QUILT regenerated (never hand-edited).
- **Copy:** every factual Radicle claim on page/doc traces to the research artifact (spot-check at review).

## 8. Open decisions

- Final hero copy + whether the page shows Radicle network stats (~8k repos — honest but small; current lean: omit numbers, cite behaviors).
- CTA "follow the repo" target: GitHub repo now, Radicle RID once the framework repo is itself seeded (dogfooding step belongs to the implementation plans).

## 9. References

- `docs/research/2026-07-31-radicle-state-of-network.md` — Radicle capability inventory (grounds every claim here).
- `docs/superpowers/specs/2026-06-17-org-os-website-design.md` — site architecture, theming, page conventions.
- `docs/superpowers/specs/2026-07-19-org-os-kms-connector-layer-design.md` — `radicle` connector stub contract.
- `schemas/federation.yaml:393-401` — the `platforms.primary` enum (`github | gitlab | radicle | other`).
- `docs/POSITIONING.md` — voice, honest-positioning rules (§9).
