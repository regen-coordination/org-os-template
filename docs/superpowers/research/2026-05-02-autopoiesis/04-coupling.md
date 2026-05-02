---
aspect: 4
title: Structural Coupling — instance ↔ host artifacts
date: 2026-05-02
level: instance-primary
kind: invariant
---

# Aspect 4 — Structural Coupling

> An instance never lives in vacuum. It always lands inside *something* — a vault, a repo, a runtime, a network. "Structural coupling" is the question of which files an instance touches in that host, with what permissions, and what the host learns back. The user's pitch — *"overlay onto an existing project / KB"* — is this aspect, named.

## Mechanism (step by step)

There are five concrete host couplings live today. Each has a different graft surface. I trace each by *file path + I/O direction* rather than by adjective.

### 1. Obsidian vault (parent vault → org-os submodule)

The instance `org-os` (this repo) is a **git submodule** of the parent vault `lf-zettelkasten-os`. Concretely:

- `Zettelkasten/.gitmodules` declares `03 Libraries/org-os` → `regen-coordination/organizational-os-template`.
- `Zettelkasten/03 Libraries/org-os/.git` is a **gitdir pointer** (`gitdir: ../../.git/modules/03 Libraries/org-os`), not a real `.git` dir — i.e. the host vault owns the submodule's git metadata.
- `Zettelkasten/.gitignore` excludes `.obsidian/workspace`, `.obsidian/cache`, `.stversions/`, `*.sync-conflict-*` — i.e. the host *declares* which Obsidian-managed and Syncthing-managed paths are NOT shared territory.

What goes INTO the host (one-way, write):
- The submodule directory itself (`03 Libraries/org-os/`) — appears as a folder among Obsidian notes. Obsidian treats `*.md` inside it as ordinary notes (graph, search, backlinks all work).
- Symlinks placed by `packages/opencode-integration/install-commands.sh` and `packages/hermes-integration/install.sh` — but these target *agent host* configs, not the vault.

What is READ FROM the host:
- Nothing structural today. The instance does not read the vault's daily notes, weeklies, or `260*/250*/240*` Zettelkasten branches. The vault is a *container* for the instance, not a data source.

Bidirectional / contested:
- `.obsidian/` config (plugins, hotkeys, themes) — the **proposed** `obsidian-interface` package would write here (`docs/agent-plans/obsidian-interface.md` §"Output shape" — recommended plugins, Dataview queries, CSS snippets, install via `npm run setup:obsidian`). Today, **not implemented** — this is the load-bearing absence.
- The proposed `obsidian-canvas` package would generate `*.canvas` files into the vault and would need a "regenerate vs. preserve layout" contract (Q1 of `obsidian-canvas-interface.md`). Also unimplemented.

Vault-safety as coupling contract: `Zettelkasten/CLAUDE.md` defines six hard rules — never `git stash`, never `git clean`, never `git reset --hard` while uncommitted vault content exists, never delete `*.md`/`*.canvas`/`*.base` at root or in `260*/250*/240*/memory/` without confirmation, never drop stashes, and the same rules apply inside org-instance submodules. This is the **invariant of the coupling**: the instance is permitted to extend the vault but not to mutate the vault's precious user content.

### 2. Agent host (Claude Code, opencode, hermes) — slash-command coupling

`docs/HOST-INTEGRATION.md` is the canonical doc for this graft surface. The instance does not run the agent host; it *registers* with one.

- **Claude Code:** `.claude/commands/initialize.md`, `.claude/commands/close.md` placed inside the instance — Claude Code discovers them automatically. One-way write (instance → host config).
- **opencode:** `packages/opencode-integration/install-commands.sh` symlinks `commands/*.md` into either project-level `.opencode/commands/` or global `~/.config/opencode/commands/`. Symlink, not copy — the instance owns the source of truth, the host owns the lookup path. Read-only from instance's POV (host runs commands, doesn't write back).
- **hermes:** `packages/hermes-integration/install.sh` symlinks `SKILL.md` into `$HERMES_HOME/skills/` and `tools/org_os.py` into `$HERMES_HOME/tools/`. The script then **prompts the operator** to manually edit `toolsets.py` — a coupling step the script can't safely automate (host's source code).

Across all three: the instance places known-named files at known paths inside host config dirs. The host runs unmodified.

### 3. Multica server — runtime coupling (deferred, spec-only)

`docs/superpowers/specs/2026-04-25-multica-integration-design.md` describes the *next* host class: a self-hosted multica server (Postgres+pgvector + Go server) brought up by `packages/multica-integration/install.sh` via bundled `docker-compose.yml`. Coupling is more invasive than the agent-host case:

- WRITE into host: docker volumes, a workspace named after the org's `IDENTITY.md`, slash-command markdown registered via multica CLI, every open `HEARTBEAT.md` task pushed as a multica issue (one-way, write-only in phase a).
- READ from host: multica server `/health`, multica issue state for diff/idempotency.
- Idempotency contract: `sha1(category + "|" + normalize(text))` keys multica issues — so re-running the bridge upserts, never duplicates (D7).
- Recoverability: `uninstall.sh` mirrors with `docker compose down -v` — the graft is reversible.

Status: spec-approved, not implemented as of 2026-05-02.

### 4. GitHub repos — content coupling

`repos.manifest.json` lists 9 external repos that the instance clones into `repos/` for ingestion (e.g. `ReFi-Barcelona`, `Regenerant-Catalunya`, `Local-ReFi-Toolkit`). `.gitignore` line `repos/*` (with `!repos/README.md`) treats clones as ephemeral — the instance reads them, indexes them, but does NOT track them in its own git history.

- WRITE into host: nothing (we only clone). For org-os the framework, this is pure read.
- READ from host: source files (used by `knowledge-curator`, `idea-scout`, autoresearch).
- Bidirectional case: at the parent-vault level, `.gitmodules` records 7+ submodule mounts (e.g. `refi-bcn-os/repos/ReFi-Barcelona`) — the vault has *committed* the coupling, not just listed it.

### 5. External integrations — knowledge-system coupling

`federation.yaml integrations` declares external systems that the instance is wired to *talk to* but doesn't host:
- `koi-net` / `koi-net-integration` — real-time sync layer.
- `OPAL` (`integrations/opal/` is a submodule with its own `package.json`, `tsconfig.json`, `tests/`) — meeting transcript → schema extraction.
- `quartz-refi-template` — documentation-site publishing.
- `grants-os` — grants platform.

These are coupled by reference (URL + role), not by file overlay. They become real graft surfaces when the matching integration package is built (e.g. `opal-bridge`, `koi-bridge` — both `canonical` in `packages-matrix.yaml`, both with `instances_using: []` today).

### Hub-as-graft (the org-os-under-vault case is itself one of these)

The hub case (org-os instance lives at `03 Libraries/org-os` inside an Obsidian vault) is *itself* coupling case #1 viewed from inside the instance. The instance experiences itself as the graft; the host experiences the instance as a submodule + a folder of `.md` files that Obsidian treats as ordinary notes. Same physical fact, two perspectives. This duality is the load-bearing observation of the aspect.

## Prior art

1. **Maturana & Varela, *Autopoiesis and Cognition* (1980).** Structural coupling = mutually triggered structural changes between a system and its medium, *without* either determining the other. Maps cleanly here: Obsidian doesn't determine what org-os does; org-os doesn't determine what Obsidian does; they perturb each other through shared file-system state.
2. **Endosymbiosis (Margulis).** Mitochondria inside eukaryotic cells: kept their own DNA, lost autonomy in others, became metabolically essential. The org-os submodule inside the vault is the same shape — its own git history, but its lifecycle is now bound to the host's.
3. **Unix overlay filesystems (OverlayFS, AUFS).** Lower layer (host) is read-mostly; upper layer (instance) is the writable diff. Whiteouts mark deletions without touching the lower layer. The `customizations:` block in `federation.yaml` is exactly this pattern: each entry says "this path is an addition, maintain on sync" — i.e. the upper-layer file list.
4. **Kubernetes operators.** A controller that manages host resources (CRDs, pods) under explicit "what I own" semantics — owner-references prevent the operator from touching things it didn't create. The vault-safety rules are the same idea, expressed as prose constraints rather than runtime guards.
5. **Christopher Alexander, *A Pattern Language* / *The Timeless Way of Building*.** A pattern is woven *into* existing fabric — windows on the south side adapt to the building you have, not the building you wish you had. The "overlay onto existing KB" pitch is this, but it is currently more aspiration than mechanism (see open question 3).

## Invariants / failure modes

**Invariants that MUST hold:**

- **I1. The instance never deletes host artifacts without operator confirmation.** Codified in `Zettelkasten/CLAUDE.md` for the vault case (rules 4 + 6). No equivalent codification for the agent-host or multica cases yet — failure mode latent.
- **I2. The instance writes only to known, declared graft-surface paths.** For the vault: paths under `03 Libraries/org-os/` plus declared `customizations:` (`SOUL.md`, `IDENTITY.md`, `data/`, `memory/`, `skills/`). For agent hosts: `.claude/commands/`, `.opencode/commands/`, `$HERMES_HOME/{skills,tools}/`. For multica: docker-compose stack + workspace + named issues.
- **I3. The graft is recoverable.** `uninstall.sh` exists for multica. Symlinks are removable for opencode/hermes. The submodule is removable from the vault via `git submodule deinit + rm -rf`. No path leaves orphans.
- **I4. The host can be removed without breaking the instance core.** The instance's `data/`, `skills/`, `docs/`, `scripts/`, `packages/` work standalone — `npm run validate:structure` and `npm run validate:schemas` do not depend on Obsidian, opencode, multica, or any external repo being present. Verified by the framework-repo case (no parent vault).
- **I5. The host's source-of-truth files are never overwritten silently.** `.gitignore` excludes `.obsidian/workspace.json` and `.obsidian/cache` — they are not part of the coupling surface. Vault-safety rules forbid `git clean` and `git stash` precisely because both would treat untracked vault content as expendable.

**Failure modes observed or anticipated:**

- **Vault-safety incidents.** `Zettelkasten/CLAUDE.md` references `docs/VAULT-SAFETY.md` as a recovery runbook (snapshot refs → stash trees → `.stversions/` → `git fsck` dangling blobs). The existence of the runbook is evidence the failure mode has occurred.
- **Obsidian sync-conflict files.** `.gitignore` carries `*.sync-conflict-*` — Syncthing has produced conflicts already (see `Zettelkasten/.obsidian/workspace.sync-conflict-20260325-133350-QMF2OFH.json`). These are coupling-surface noise that must be excluded.
- **Submodule drift / rot.** The org-os submodule pinned in the vault may lag behind the framework HEAD; the vault commit references a specific SHA. `npm run sync:upstream` is the discipline against this.
- **Manual-edit step in hermes install.** `install.sh` ends with "Manually add `org_os` to a toolset in `toolsets.py`" — the coupling is *not* fully automated; an operator who skips the step gets a half-installed graft with no warning.
- **Selection persistence undecided.** `instance-bootstrap.md` Q4 — where do per-instance package/skill selections persist? `federation.yaml packages:` block exists but its activation mechanism is undefined ("flipping a flag does not currently materialize the package in an instance" — `package-integration.md`). Until resolved, the coupling is declarative-without-execution.
- **Live-data canvas vs. snapshot.** `obsidian-canvas-interface.md` Q5 asks whether canvases pull live federation state or snapshot only — affects whether the canvas is a static graft or a live coupling.

## Open questions

1. **Is `.stversions/` part of the coupling surface?** Today it is excluded by `.gitignore` (parent vault) but it is also the *recovery surface* per `VAULT-SAFETY.md`. So the coupling status is asymmetric: invisible during normal ops, load-bearing during recovery. Should the instance know about it explicitly?
2. **What's the contract when an instance is grafted INSIDE a host repo?** A software project adds `org-os/` as a directory — what does the host learn back, what may the instance not touch (e.g. `package.json`, `.github/workflows/`)? No spec today. The vault case is one species; software-project case is the next species.
3. **Bidirectional vs. one-way: which is default per host type?** Multica = one-way write (phase a) by explicit decision; vault Dataview queries = read-only by proposed default; obsidian-canvas would be regenerate (overwrite) by default with operator-arranged-position carve-outs. There is no shared rule.
4. **Selection persistence.** Is `federation.yaml packages:` the source of truth for "what is grafted"? Or does each package own its own activation marker? `instance-bootstrap.md` Q4 + `package-integration.md` Q1 collide on this.
5. **Coupling discovery.** Today the instance does not enumerate its own grafts. There is no `npm run coupling:list` that prints "you are grafted onto: vault X, opencode Y, hermes Z, multica W." A self-aware system should know its own graft surface.
6. **The "overlay onto existing project" claim has *no* implementation today for arbitrary projects.** The vault case works because the graft surface (folder of markdown + a submodule) happens to match what Obsidian already does. The multica case works because multica has an extension API. Generic project overlay (drop org-os into any repo) is not specified anywhere — gap.

## Existing-plan touchpoints

- `docs/agent-plans/obsidian-interface.md` — *the* canonical host-graft plan. Q3 ("read-only vs read-write") and Q4 ("bidirectional sync") are coupling questions.
- `docs/agent-plans/obsidian-canvas-interface.md` — Q1 (regenerate vs. preserve layout) and Q5 (live vs. snapshot federation) are coupling questions.
- `docs/superpowers/specs/2026-04-25-multica-integration-design.md` — the only fully-specified host-graft case. The "self-installing package with bundled docker-compose" pattern is the proposed canonical mechanism for this aspect.
- `docs/agent-plans/non-tech-onboarding.md` — the web wizard couples to GitHub Pages + Actions; selection happens *before* graft.
- `docs/agent-plans/package-integration.md` — Phase 3 ("consumption mechanism") is the load-bearing decision: how does an instance *materialize* the packages it has selected? That decision shapes every future host coupling.
- `docs/agent-plans/instance-bootstrap.md` — Phase 1 ("strip framework-only artifacts from a fresh clone") is the inverse coupling op: deciding what *not* to graft.
- `docs/HOST-INTEGRATION.md` — already-written framework doc covering opencode + hermes. The "Adding a new host" section (5 steps) is the de-facto coupling protocol for agent hosts.
- `data/packages-matrix.yaml` — packages prefixed `*-bridge` / `*-integration` (`koi-bridge`, `koi-opal-bridge`, `opal-bridge`, `multica-integration`, `hermes-integration`, `opencode-integration`) are exactly the packages whose role is to mediate host coupling. Half are `instances_using: []` — coupling potential, not yet realised.

## Framework-level note

The framework's structural coupling is to **standards bodies and ecosystem tooling** rather than to file systems. EIP-4824 (DAO Identity) and DAOIP-5 are the upstream perturbing surfaces — they change, the framework's `.well-known/` schemas regenerate, instances absorb the perturbation through `npm run generate:schemas`. Similarly, the framework couples to **npm, GitHub, Docker Hub, and the agent-runtime ecosystem** (Claude Code, opencode, hermes, multica) without controlling any of them; each is a `peer` in `federation.yaml integrations` rather than a dependency the framework owns. The `repos.manifest.json` + `customizations:` pattern carries up to the framework level: the framework declares what it is (template-content) versus what it grafts onto (other repos). The same Maturana–Varela invariant applies recursively: standards perturb the framework, the framework perturbs instances, instances perturb hosts — and at no level does either side determine the other.
