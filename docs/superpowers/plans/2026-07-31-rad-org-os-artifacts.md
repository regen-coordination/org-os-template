# rad-org-os Public Artifacts Implementation Plan

> **Release status (2026-08-28):** Deferred to v0.6+ — portfolio memo §4 row 11; branch feat/rad-org-os (55 commits) preserved per masterplan WS-E. Referenced branch v0.5 is now archive/v0.5. Convergence: [v0.5 release masterplan](2026-08-28-v0.5-release-masterplan.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the rad-org-os public surface — canonical doc, first module detail page, and data/roadmap entries — per the approved spec `docs/superpowers/specs/2026-07-31-rad-org-os-artifacts-design.md`.

**Architecture:** Pure content + static-site work on branch `v0.5` of the org-os repo. The site is Astro 5, zero client JS; docs render from `../docs/*.md` via an allowlist; `site/scripts/verify-build.mjs` is the build-integrity "test suite" — we extend its `REQUIRED` list first (red), then add content (green). Data changes regenerate `.well-known/` + `docs/QUILT.md` via npm scripts.

**Tech Stack:** Astro 5 (`site/`), Node ≥22, js-yaml, `node --test`, npm scripts (`generate:schemas`, `validate:schemas`, `generate:quilt`, `validate:structure`).

**Working directory note:** framework commands run in the repo root (`03 Libraries/org-os/`); site commands MUST run in `site/`. All factual Radicle claims trace to `docs/research/2026-07-31-radicle-state-of-network.md` — do not invent new ones. Banned in public copy: "Tech for Palestine" (unverified). Required caveats where relevant: official Radicle HTTP API is read-only; private repos are not encrypted at rest; Radicle Pages is a paid service.

---

### Task 1: Canonical doc `docs/RAD-ORG-OS.md` + docs allowlist

**Files:**
- Create: `docs/RAD-ORG-OS.md`
- Modify: `site/scripts/verify-build.mjs:6-18` (REQUIRED list)
- Modify: `site/src/data/docs-allowlist.ts:4-13`

- [ ] **Step 1: Add the failing build requirement**

In `site/scripts/verify-build.mjs`, add one line to the `REQUIRED` array after `"docs/federation/index.html",`:

```js
  "docs/rad-org-os/index.html",
```

- [ ] **Step 2: Run the build to verify it fails**

Run: `cd site && npm run build`
Expected: build completes, then verify step prints `MISSING: dist/docs/rad-org-os/index.html` and exits non-zero.

- [ ] **Step 3: Write `docs/RAD-ORG-OS.md`** (repo root `docs/`, NOT `site/`)

Full content:

````markdown
# rad-org-os — the sovereign distribution

> **Status: in development.** This document is the module's source of truth: what rad-org-os is, what works today, what's on the roadmap, and what's still exploration. No Radicle-specific code has shipped yet — this page says exactly what exists. Research grounding: `docs/research/2026-07-31-radicle-state-of-network.md` (Radicle 1.9.1, July 2026).

**rad-org-os is the sovereign distribution of org-os — the full organizational stack running on [Radicle](https://radicle.dev), peer-to-peer, with no platform that can take it away. And in the other direction: the missing organization layer for Radicle.**

## Why

**Some organizations can't depend on centralized platforms.** Accounts get suspended, repos get taken down, domains get blocklisted. Radicle demonstrated the alternative on itself: when ISPs blocklisted radicle.xyz in April 2026, the project moved domains — and the peer-to-peer network wasn't affected at all. Nothing was lost, because nothing lived at an address someone else controlled. HardenedBSD, after platform trouble of its own, stood up six global Radicle replicas in 24 hours.

**Sovereignty is hygiene for every org.** You don't need to be at risk to want your organization's memory, decisions, and data replicated across machines your members control instead of a single vendor's database.

**Same files, different substrate.** org-os is already ~90% substrate-agnostic: identity files, memory, registries, schemas, and skills are markdown, YAML, and git — none of it calls a GitHub API. rad-org-os closes the last 10%: bootstrap, sync scripts, federation transport, and operator flows that currently assume GitHub.

## The four components

1. **Code-substrate abstraction** — a small driver interface (clone, sync, push, propose-change, publish-schema) with `github` and `radicle` drivers, selected by the `platforms.primary` field an instance already declares in its `federation.yaml`. GitHub becomes *a* backend, not *the* backend.
2. **The Radicle-native distro** — fork/seed/bootstrap/federate an instance entirely over Radicle: `rad clone` instead of GitHub fork, patches instead of PRs, `did:key` identities as operator identities, seed nodes replacing the central remote.
3. **KMS `radicle` connector** — the knowledge-management connector-layer *design* specifies `radicle` as one of its source drivers; rad-org-os implements it once that layer lands (Radicle repos as knowledge sources).
4. **The org layer for Radicle** — Radicle's Heartwood protocol has no org/team primitive: only per-repo delegates and quorum. rad-org-os composes an organization from org-os's existing shapes: the instance repo as org index (member DIDs in `data/members.yaml`), membership as seed-node replication policy, `federation.yaml` as network topology, and delegate quorum as cryptographic multi-sig over the org's canonical state.

## Capability map

### Now — true today

- The entire file-based core works on any git substrate; an org *can* seed an org-os instance on Radicle today — nothing breaks, but nothing assists yet.
- `schemas/federation.yaml` already lists `radicle` as a valid `platforms.primary` value. Precisely: that is a declaration slot, not a feature — no code reads it yet (`gitlab` is listed on the same line, and there is no GitLab support either).
- A `radicle` source driver is specified in the KMS connector-layer design. To be exact: that is a written design, not shipped code — the connector layer itself is not yet implemented.
- Radicle itself supplies the primitives (v1.9.x): DID identities, patches, issues, private repos (allow-list replication), seed nodes on Raspberry-Pi-class hardware, a fully scriptable `rad` CLI, a node event socket with a webhooks adapter, and CI via broker adapters including a GitHub Actions bridge.

### Next — committed roadmap

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

**Is Radicle ready?** The protocol is stable and actively maintained (1.9.x, 2026; funded through 2026; steady release cadence). The network is small (~8,000 repos). rad-org-os treats it as ready for pilots, not as a mass-migration target.

**What about private data?** Private repos replicate only to allow-listed DIDs, but are not encrypted at rest. Sensitive orgs should treat seed-node control as part of their threat model.

**Can we run both?** Yes — mirroring GitHub↔Radicle is the documented transition pattern (push both remotes; community sync tools exist). The substrate abstraction is designed to make "both" a configuration, not a fork.

---

*Spec: `docs/superpowers/specs/2026-07-31-rad-org-os-artifacts-design.md` · Research: `docs/research/2026-07-31-radicle-state-of-network.md`*
````

- [ ] **Step 4: Add the allowlist entry**

In `site/src/data/docs-allowlist.ts`, add after the `OPERATOR-GUIDE` line (keeps existing groups contiguous; new group renders last on the docs index):

```ts
  { file: "RAD-ORG-OS",           slug: "rad-org-os",            title: "rad-org-os",              group: "Modules" },
```

- [ ] **Step 5: Run the build to verify it passes**

Run: `cd site && npm run build`
Expected: `OK: dist/docs/rad-org-os/index.html` and `link check: done`, exit 0. (The docs-index link check auto-covers the new `/docs/rad-org-os` link.)

- [ ] **Step 6: Commit**

```bash
git add docs/RAD-ORG-OS.md site/src/data/docs-allowlist.ts site/scripts/verify-build.mjs
git commit -m "docs(rad-org-os): canonical module doc, on the site allowlist (Modules group)"
```

---

### Task 2: Module detail page `/modules/rad-org-os`

**Files:**
- Create: `site/src/pages/modules/rad-org-os.astro`
- Modify: `site/scripts/verify-build.mjs` (REQUIRED list)
- Modify: `site/src/data/modules.yaml:13-17` (link)
- Modify: `site/src/pages/llms.txt.ts:12-17` (Pages list)

- [ ] **Step 1: Add the failing build requirement**

In `site/scripts/verify-build.mjs` `REQUIRED`, after `"modules/index.html",` add:

```js
  "modules/rad-org-os/index.html",
```

- [ ] **Step 2: Run the build to verify it fails**

Run: `cd site && npm run build`
Expected: `MISSING: dist/modules/rad-org-os/index.html`, exit non-zero.

- [ ] **Step 3: Create the page**

`site/src/pages/modules/rad-org-os.astro` — full content (plain Astro, zero client JS, reuses `Layout` + `StatusBadge`; capability copy mirrors `docs/RAD-ORG-OS.md`):

```astro
---
import Layout from "../../components/Layout.astro";
import StatusBadge from "../../components/StatusBadge.astro";

const now = [
  { t: "Substrate-agnostic core", b: "Identity files, memory, registries, schemas, skills — markdown, YAML, and git. Nothing in the core calls a GitHub API. An org can seed an instance on Radicle today; nothing breaks, but nothing assists yet." },
  { t: "Radicle in the federation schema", b: "schemas/federation.yaml lists radicle as a valid platforms.primary value — a declaration slot, not a feature. No code reads it yet." },
  { t: "KMS connector seam — on paper", b: "The knowledge-management connector-layer design specifies a radicle source driver: Radicle repos as knowledge sources. Written design, not shipped code — the connector layer isn't implemented yet." },
  { t: "Radicle supplies the primitives", b: "DID identities, patches, issues, private repos, seed nodes on Raspberry-Pi-class hardware, a scriptable CLI, and node events agents can consume (Radicle 1.9.x). CI exists but is bring-your-own." },
];
const next = [
  { t: "Substrate driver interface", b: "clone · sync · push · propose-change · publish-schema, with github and radicle drivers behind the framework's scripts, selected by platforms.primary." },
  { t: "Radicle bootstrap path", b: "“Where does your org live?” in the setup interview — rad init + seeding instead of a GitHub fork." },
  { t: "Seed-node runbook", b: "Home server or Raspberry Pi, systemd, seeding policy as membership, Radicle pinned ≥1.9.1." },
  { t: "KMS radicle connector", b: "Implement the specced stub: pull knowledge from Radicle repos via the read API + CLI." },
];
const later = [
  { t: "Federation transport over Radicle", b: "Instances discover and sync each other peer-to-peer; gossip replaces webhook/cron sync." },
  { t: "Operator trunks as patches", b: "Per-operator branches become Radicle patches; delegate quorum is the merge gate — canonical org state becomes cryptographically multi-sig." },
  { t: "DID ↔ members mapping", b: "Members carry did:key; agents verify authorship against the delegate set." },
  { t: "Agent as node-local daemon", b: "Trigger on node events, act via the rad CLI, read via radicle-httpd. (Official HTTP API is read-only — agents write through the CLI.)" },
  { t: "Private instances", b: "Allow-list replication for sensitive orgs. Stated plainly: not encrypted at rest — seed-node control is part of the threat model." },
  { t: "CI + publishing", b: "radicle-ci-broker adapters; publishing via Radicle Pages (paid Radicle Garden service) or self-hosted." },
];
const tiers = [
  { key: "now", label: "Now", status: "live", desc: "True today", items: now },
  { key: "next", label: "Next", status: "in-dev", desc: "Committed roadmap", items: next },
  { key: "later", label: "Later", status: "planned", desc: "Exploration — published as exploration", items: later },
] as const;
---
<Layout title="rad-org-os" current="modules" description="rad-org-os — the sovereign distribution of org-os: the full organizational stack on Radicle, peer-to-peer. And the missing organization layer for Radicle.">
  <div class="container">
    <p class="eyebrow">v0.5 module · <span class="mono">rad-org-os</span> <StatusBadge status="in-dev" /></p>
    <h1>Your organization can't be deplatformed.</h1>
    <p class="prose lead">rad-org-os runs the full org-os stack on <a href="https://radicle.dev">Radicle</a> — peer-to-peer, sovereign, no chokepoints. Same files, different substrate.</p>

    <section class="why">
      <article class="surface pad">
        <h3>For orgs that can't depend on platforms</h3>
        <p>Accounts get suspended; domains get blocklisted. Radicle proved the alternative on itself: when ISPs blocklisted radicle.xyz in 2026, the project changed domains and the p2p network wasn't affected at all. HardenedBSD stood up six global replicas in 24 hours.</p>
      </article>
      <article class="surface pad">
        <h3>Sovereignty is hygiene</h3>
        <p>You don't need to be at risk to want your org's memory, decisions, and data replicated across machines your members control — instead of one vendor's database.</p>
      </article>
      <article class="surface pad">
        <h3>Both directions</h3>
        <p>A sovereign distribution for org-os users — and, since Radicle has no org/team primitive of its own, the missing <em>organization layer</em> for Radicle: membership, memory, governance, and federation composed from files and delegate quorum.</p>
      </article>
    </section>

    <section>
      <h2>Capability map</h2>
      <p class="prose">Three tiers with strict honesty semantics — what's true today, what's committed, what's exploration.</p>
      {tiers.map((tier) => (
        <div class="tier">
          <div class="tier-head">
            <h3>{tier.label}</h3>
            <StatusBadge status={tier.status} />
            <span class="tier-desc">{tier.desc}</span>
          </div>
          <div class="grid">
            {tier.items.map((it) => (
              <article class="surface pad item">
                <h4>{it.t}</h4>
                <p>{it.b}</p>
              </article>
            ))}
          </div>
        </div>
      ))}
    </section>

    <section>
      <h2>Architecture</h2>
      <pre class="diagram mono" aria-label="Architecture: org files feed a substrate driver interface with github and radicle drivers">{`        org files (markdown · YAML · git)
   identity · memory · data/ · .well-known/ · skills/
                      │
             substrate driver interface
      clone · sync · push · propose-change · publish-schema
              ┌───────┴────────┐
           github            radicle
        (remote, PRs)   (seed nodes, patches,
                         DIDs, delegate quorum)`}</pre>
    </section>

    <section class="status surface pad">
      <h2>Status — honest</h2>
      <p class="prose">In development. No Radicle-specific code has shipped yet. What exists today: the substrate-agnostic core, the <code>radicle</code> option in the federation schema, and the specced KMS connector stub. The roadmap above is the work. Full detail in the <a href="/docs/rad-org-os">rad-org-os doc</a>; the connector contract lives in the KMS connector-layer spec in the repo.</p>
    </section>

    <div class="ctas">
      <a class="mono link" href="/docs/rad-org-os">read the docs →</a>
      <a class="mono link" href="https://github.com/regen-coordination/org-os-template">follow the repo →</a>
      <a class="mono link" href="/federation">see the federation →</a>
    </div>
  </div>
</Layout>
<style>
.container { padding-block: var(--space-12) var(--space-24); }
.lead { max-width: 60ch; font-size: var(--text-lg); }
.eyebrow :global(.badge) { vertical-align: middle; margin-left: var(--space-2); }
section { margin-top: var(--space-16); }
.pad { padding: var(--space-5); }
.why { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--space-4); }
.why h3, .item h4 { margin: 0 0 var(--space-2); }
.why p, .item p { margin: 0; font-size: var(--text-sm); color: var(--color-muted); line-height: var(--leading-snug); }
.tier { margin-top: var(--space-8); }
.tier-head { display: flex; align-items: center; gap: var(--space-3); border-bottom: var(--border-hair) solid var(--color-line-2); padding-bottom: var(--space-2); margin-bottom: var(--space-4); }
.tier-head h3 { margin: 0; }
.tier-desc { font-size: var(--text-sm); color: var(--color-faint); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--space-4); }
.diagram { overflow-x: auto; padding: var(--space-5); font-size: var(--text-sm); line-height: 1.5; color: var(--color-muted); background: var(--color-surface, transparent); border: var(--border-hair) solid var(--color-line-2); border-radius: var(--radius-2, 8px); }
.status h2 { margin-top: 0; }
.ctas { display: flex; flex-wrap: wrap; gap: var(--space-6); margin-top: var(--space-12); }
</style>
```

Note: if the build errors on any CSS var not present in `tokens.css` there is no failure mode (unknown vars just resolve to fallback/initial) — but if `surface`/`prose`/`eyebrow`/`container`/`mono`/`link` global classes render oddly, compare with `site/src/pages/modules.astro` + `about.astro` and match their usage; those classes are the site's global vocabulary.

- [ ] **Step 4: Link the card + llms.txt**

`site/src/data/modules.yaml` — change the rad-org-os entry's `link`:

```yaml
  - id: rad-org-os
    name: rad-org-os
    status: in-dev
    summary: Radicle-native sovereign p2p infrastructure for grassroots orgs.
    link: /modules/rad-org-os
```

`site/src/pages/llms.txt.ts` — in the `Pages` section, after the Modules line, add:

```ts
    `- [rad-org-os](${base}/modules/rad-org-os): sovereign Radicle-native distribution — module page`,
```

- [ ] **Step 5: Run tests + build to verify green**

Run: `cd site && npm test && npm run build`
Expected: unit tests pass; verify prints `OK: dist/modules/rad-org-os/index.html`, exit 0.

- [ ] **Step 6: Visual sanity check (optional but recommended)**

Run: `cd site && npm run preview` and open `http://localhost:4321/modules/rad-org-os` — hero, three why-cards, three capability tiers with badges, diagram, status block, CTAs. Card on `/modules` now shows "learn more →".

- [ ] **Step 7: Commit**

```bash
git add site/src/pages/modules/rad-org-os.astro site/src/data/modules.yaml site/src/pages/llms.txt.ts site/scripts/verify-build.mjs
git commit -m "feat(site): /modules/rad-org-os — first module detail page"
```

---

### Task 3: POSITIONING.md updates

**Files:**
- Modify: `docs/POSITIONING.md:48-49` (§2 proof points) and `docs/POSITIONING.md:122` (§5 row)

- [ ] **Step 1: Update the §5 constellation row**

Replace the line:

```markdown
- **rad-org-os** *(in-dev)* — Radicle-native sovereign p2p infra for grassroots orgs
```

with:

```markdown
- **rad-org-os** *(in-dev)* — the sovereign distribution: full org-os stack on Radicle, p2p, no deplatformable chokepoints — and the missing org layer for Radicle (which has no org/team primitive). Doc: `docs/RAD-ORG-OS.md` · page: `/modules/rad-org-os`
```

- [ ] **Step 2: Add the domain-move proof point to §2**

In the "Supporting proof points for copy" list (after the "**Vault-safe by design**" bullet), insert:

```markdown
- **The sovereignty thesis has a live demonstration** — Radicle's own radicle.xyz was ISP-blocklisted (2026-04); the project moved domains and the p2p network was unaffected. rad-org-os builds the org layer on exactly that property (research: `docs/research/2026-07-31-radicle-state-of-network.md`).
```

- [ ] **Step 3: Commit**

```bash
git add docs/POSITIONING.md
git commit -m "docs(positioning): rad-org-os two-directional story + sovereignty proof point"
```

---

### Task 4: `data/projects.yaml` project + regenerate schemas/quilt

**Files:**
- Modify: `data/projects.yaml` (append to `projects:` list)
- Regenerated: `.well-known/*.json`, `docs/QUILT.md` (never hand-edit QUILT)

- [ ] **Step 1: Append the project entry**

At the end of the `projects:` list in `data/projects.yaml`, append (match 2-space indent of siblings):

```yaml
  - id: "rad-org-os"
    name: "rad-org-os"
    status: "Discovery"
    lead: "github:luizfernandosg"
    members: ["github:luizfernandosg"]
    startDate: "2026-07-31"
    description: "Sovereign distribution of org-os on Radicle + the missing org layer for Radicle. Artifacts shipped 2026-07 (doc, module page, roadmap); next: substrate driver interface, Radicle bootstrap path, seed-node runbook, KMS radicle connector. Spec: docs/superpowers/specs/2026-07-31-rad-org-os-artifacts-design.md"
    researchArtifacts:
      - "docs/research/2026-07-31-radicle-state-of-network.md"
```

- [ ] **Step 2: Regenerate + validate**

Run (repo root): `npm run generate:schemas && npm run validate:schemas && npm run generate:quilt`
Expected: schemas regenerate including the new project; validation passes; `docs/QUILT.md` regenerated (expect a new project pod; diff will be mechanical).

- [ ] **Step 3: Structure check**

Run: `npm run validate:structure`
Expected: `Instance passes structural validation` (52+ passed, 0 failed; 2 pre-existing warnings are known).

- [ ] **Step 4: Commit**

```bash
git add data/projects.yaml .well-known/ docs/QUILT.md
git commit -m "feat(data): rad-org-os project registered (Discovery) + schema/quilt regen"
```

---

### Task 5: HEARTBEAT.md roadmap tasks

**Files:**
- Modify: `HEARTBEAT.md` (under `### Technical` in `## Active Tasks`)

- [ ] **Step 1: Add the four "next"-tier tasks**

Under `### Technical`, after the last `Finalize ... scoping` line, add:

```markdown
- [ ] rad-org-os: plan the substrate driver interface (clone/sync/push/propose-change/publish-schema; github + radicle drivers) — spec §3 "next"
- [ ] rad-org-os: add Radicle bootstrap path to the setup interview (rad init + seeding)
- [ ] rad-org-os: write the seed-node runbook (home server / RPi, systemd, seeding policy as membership, Radicle ≥1.9.1)
- [ ] rad-org-os: implement KMS `radicle` connector `pull` (stub → radicle-httpd read API + rad CLI)
```

- [ ] **Step 2: Commit**

```bash
git add HEARTBEAT.md
git commit -m "chore(heartbeat): rad-org-os roadmap follow-ups (substrate driver, bootstrap, runbook, connector)"
```

---

### Task 6: Final verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full site check**

Run: `cd site && npm test && npm run build`
Expected: all unit tests pass; verify prints `OK:` for every REQUIRED entry including `docs/rad-org-os/index.html` and `modules/rad-org-os/index.html`; `link check: done`; exit 0.

- [ ] **Step 2: Framework check**

Run (repo root): `npm run validate:schemas && npm run validate:structure`
Expected: both green.

- [ ] **Step 3: Copy audit against research**

Re-read `site/src/pages/modules/rad-org-os.astro` + `docs/RAD-ORG-OS.md` and confirm: (a) every Radicle factual claim appears in `docs/research/2026-07-31-radicle-state-of-network.md`; (b) "Tech for Palestine" appears nowhere; (c) the three required caveats are present (read-only API → in "Agent as node-local daemon" items + doc; not-encrypted-at-rest → "Private instances" items + doc FAQ; Pages is paid → "CI + publishing" items + doc). Fix any drift so page and doc stay mirrored.

- [ ] **Step 4: Working-tree check + wrap-up**

Run: `git status --short` — expect only pre-existing untracked noise (`graphify-out/`, `site/test-results/`, older plan files); no unstaged modifications left behind.
Then follow superpowers:verification-before-completion before claiming done. Do NOT push; the operator decides when `v0.5` goes to origin (per repo practice).

---

## Self-review notes (checked at plan-writing time)

- **Spec coverage:** §2 definition → doc + page copy (Tasks 1–2); §3 capability map → doc + page tiers (1–2); §4 page anatomy → Task 2 (hero/why/positioning/tiers/diagram/status/CTA all present; "two-directional positioning" folded into the third why-card); §5 docs → Task 1 + Task 3; §6 data/roadmap → Tasks 4–5; §7 testing → verify-build extensions + Task 6; §8 open decisions resolved conservatively: no network stats on the page (behaviors cited instead), CTA targets GitHub repo for now (Radicle RID comes with dogfooding).
- **Types:** `StatusBadge` accepts exactly `"planned" | "in-dev" | "live"` — tier statuses map now→live, next→in-dev, later→planned and the `as const` keeps literal types.
- **No placeholders:** all file contents are complete above.
