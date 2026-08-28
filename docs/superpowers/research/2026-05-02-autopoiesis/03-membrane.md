# 03 — Membrane

> Aspect 3 of the autopoiesis matrix. Instance-primary, framework-secondary.
> What's *in* the instance? What's not? Where's the cell wall?

The "membrane" is metaphor. The mechanism is a small set of files plus one validator that, together, decide which artifacts on disk count as part of the org-os instance, which are host-workspace residue, and which are external services to be referenced by name only. This note traces those files and their checks today.

## Mechanism (step by step)

A new file appears in the instance directory tree. Whether it counts as in-membrane is decided by four overlapping authorities, in this order:

1. **`docs/FILE-STRUCTURE.md`** — the canonical directory spec. Lists 9 required root agentic files (`MASTERPLAN.md`, `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, `HEARTBEAT.md`, `TOOLS.md`, `BOOTSTRAP.md`), 5 required configuration files (`CLAUDE.md`, `README.md`, `federation.yaml`, `dashboard.yaml`, `package.json`), and 6 required directories (`data/`, `.well-known/`, `memory/`, `skills/`, `packages/`, `scripts/`). Optional roots: `LICENSE`, `repos.manifest.json`, `SYSTEM-CANVAS.canvas`. Optional dirs: `knowledge/`, `ideas/`, `docs/`, `repos/`, `.claude/`. Anything outside these slots is undeclared — present but unsanctioned.

2. **`scripts/validate-structure.mjs`** — the immune system. Mechanically enforces the spec: walks `requiredRootFiles[]`, `requiredDirs[]`, `requiredDataFiles[]`, `expectedSchemas[]`, then asserts each `skills/*/` has a `SKILL.md`, `federation.yaml` has `identity` + `federation` + `agent` sections, `package.json` has `generate:schemas` + `validate:schemas`, and `package.json.version` major.minor matches `federation.yaml.metadata.framework_version`. Failures exit non-zero. This is the only structural antibody currently wired.

3. **`data/*.yaml` schema-on-read** — content-shape membrane. `docs/DATA-MODEL.md` defines 13 canonical registries and the `schema_version: "2.0"` header convention. The actual schema gate is `scripts/generate-all-schemas.mjs`: it reads `data/members.yaml` and emits `.well-known/members.json` (DAOstar-shaped). Anything not matching the implicit shape silently drops. There is no JSON Schema validator on `data/*.yaml` itself — the schema lives in the generator's destructuring code.

4. **`.gitignore`** — the literal "outside." Excludes `node_modules/`, `repos/*` (except `repos/README.md`), `dist`, `build`, `out`, `*.log`, `.DS_Store`, `*.pem`, `.env*`, `.vscode/*`, `.idea/`, swap files, `__pycache__`, `.worktrees/`, `.claude/worktrees/`. These are explicitly host-workspace residue: present in the directory, deliberately excluded from the instance's git identity. `.gitignore.test` (a 1-line file containing `.opencode/agents/`) is itself an undocumented artifact — possibly a leftover.

**Trace for a hypothetical new file:**

- Drop `data/tasks.yaml` → not in `requiredDataFiles[]` or `optionalDataFiles[]`, validator silent. Generator ignores it (no `tasks` case). It exists, but is invisible to `.well-known/`. `DATA-MODEL.md` §"Extension Pattern for Instances" sanctions this if declared in framework's `data/instances.yaml.data_registries_extra[]`. So: in-membrane (instance extension), invisible to the external EIP-4824 surface. Soft permeable spot.
- Drop `skills/research/SKILL.md` → validator counts it (`skillsWithSkillMd`) but `data/skills-matrix.yaml` is the canonical promotion ledger; without an entry there, the skill is orphaned at federation level. Currently `research` skill is listed as `candidate` in matrix but has no `skills/research/` directory — matrix points to a phantom. Membrane leak (matrix → disk drift).
- Drop `notes.md` at root → no rule, no check, gets committed if `git add`-ed. Pure undeclared content. Membrane has no answer; this is the gap.
- Drop `.opencode/skills/org-os-init/` → host-runtime mirror of the canonical `skills/org-os-init/`. `.opencode/` is not in `optionalDirs[]` — validator doesn't see it. Two copies of the same skill exist (`skills/org-os-init/SKILL.md` + `.opencode/skills/org-os-init/SKILL.md`). The membrane has no opinion about which is canonical.

**External services** are kept outside via two channels: `federation.yaml.peers[]`, `federation.yaml.downstream[]`, `federation.yaml.integrations.{agent_runtimes,knowledge_infrastructure,meeting_processing,publishing,grants}` reference everything by repo URL + role. `TOOLS.md` holds endpoints/credentials by reference. There are no hardcoded service paths in the registries. (`integrations/opal/` is the one anomaly — an in-tree integration, not just a reference.)

## Prior art

1. **Maturana & Varela — autopoiesis & selective permeability.** A cell is defined by the network of processes that produces and maintains the boundary that contains those processes. `validate-structure.mjs` + `FILE-STRUCTURE.md` is org-os's analogue: the boundary spec and the boundary-maintainer co-define what is "self."
2. **JSON Schema as boundary contract.** `.well-known/*.json` is the published, machine-readable face of the instance. EIP-4824 is the contract; `generate-all-schemas.mjs` is the projection. The boundary is "what schemas successfully render" — the rest is internal organs.
3. **Schema-on-write databases (Postgres) vs schema-on-read (S3/Snowflake JSON).** org-os today is **schema-on-read**: `data/*.yaml` is loosely typed YAML, validated only when the generator or dashboard reads it. A schema-on-write membrane would reject malformed YAML at `git add` time. The plan `system-reliability` proposes moving toward this.
4. **Beer's VSM — System 1/System 2 boundary.** "What does the system do" vs. "what does the environment do." `federation.yaml` is org-os's S2 boundary: it lists peers (other systems) and integrations (environment). Anything *inside* the manifest's identity section is system; anything *outside* is environment, named but not contained.
5. **Nix store paths — boundary by hash.** Nix decides "in or out" by content-addressable hash. org-os decides "in or out" by *path-and-name* (validator checks `data/members.yaml` exists, not what it hashes to). This is weaker — renames pass; corruption passes; only absence fails.

## Invariants / failure modes

**Invariants that MUST hold for the membrane to be intact:**

1. Every required root file in `FILE-STRUCTURE.md` exists at the instance root. (Enforced by validator.)
2. `data/` contains the 6 required registries. (Enforced.)
3. Every directory in `skills/` contains a `SKILL.md`. (Enforced.)
4. `federation.yaml` has `identity`, `federation`, `agent` sections. (Enforced.)
5. `package.json.version` major.minor matches `federation.yaml.metadata.framework_version` (or version starts with `0.`). (Enforced.)
6. `.well-known/*.json` is regenerated after any `data/*.yaml` change. (NOT enforced — operator must remember `npm run generate:schemas`.)
7. Every entry in `data/skills-matrix.yaml` with `in_framework: true` corresponds to a `skills/<id>/SKILL.md` directory. (NOT enforced.)
8. Every package in `data/packages-matrix.yaml` with `in_framework: true` exists at `packages/<id>/`. (NOT enforced.)
9. External services are referenced via `federation.yaml.integrations[]` or `TOOLS.md`, never hardcoded inside `data/` or scripts. (NOT enforced; convention only.)

**Failure modes observed today:**

- **Matrix-to-disk drift.** `data/skills-matrix.yaml` declares `karpathy-guidelines`, `expert-feynman`, plus 9 `superpowers-*` entries as `in_framework: true`. Confirmed on disk. But the matrix could lie at any moment — there is no check tying matrix entries to filesystem presence. Membrane leak waiting to happen.
- **`.well-known/` out of sync with `data/`.** Several `.well-known/*.json` files (`activities.json`, `contracts.json`, `finances.json`, `members.json`, `knowledge.json`) are <200 bytes — likely stubs or empty arrays. The external EIP-4824 surface currently lies about (or under-reports) what `data/` contains.
- **Two skill registries.** `skills/` (canonical, 22 dirs) and `.opencode/skills/` (host-runtime, 1 dir: `org-os-init`). No reconciliation. `.opencode/` is not even in the validator's `optionalDirs[]`. Same situation possible for `.claude/agents/`, `.claude/commands/`.
- **`.gitignore.test`** at root — undocumented file. Either dev artifact or leak. Validator doesn't see it.
- **`MASTERPROMPT.md` legacy file** — validator warns but does not fail. Soft membrane.
- **`schemas/` directory** at root — older JSON-LD schemas (`agents.json-ld`, `meetings.json-ld`, etc.) plus a `federation.yaml` copy. Not in `FILE-STRUCTURE.md`, not in validator. Vestigial — pre-`.well-known/` artifact.
- **No JSON Schema validation on `data/*.yaml`.** A typo'd `members.yaml` will pass `validate:structure` (file exists), pass `generate:schemas` (silently drop bad rows), and produce a wrong `members.json`. The membrane lets malformed content through unchecked.
- **Untracked content.** `git status` at session start shows `MASTERPROMPT.md`, `docs/HOST-INTEGRATION.md`, `packages/hermes-integration/`, `packages/opencode-integration/`, 11 `skills/superpowers-*/` and `skills/{expert-feynman,karpathy-guidelines,initialize}/`, `scripts/page-shim.mjs` — all untracked. The instance has lots of content the git membrane has not yet absorbed.

## Open questions

1. **Is `memory/` in-membrane or host-workspace?** Required directory, but a hub vault's `memory/2026-04-29.md` and an instance's `memory/2026-04-29.md` are different documents in different cells. The membrane currently treats `memory/` as fully internal — but the hub (`Zettelkasten/`) explicitly warns against destructive ops on `memory/` because it propagates via Syncthing. Cross-instance, `memory/` is permeable to OS-level sync.
2. **Are `.claude/`, `.opencode/`, `.openhands/` in-membrane?** `.claude/` is in `optionalDirs[]`; `.opencode/` is not listed anywhere; `.openhands/` doesn't exist yet. Three roughly equivalent host-runtime dirs, each treated differently. The membrane has no consistent policy on agent-host configuration.
3. **Is `node_modules/` part of the instance?** `.gitignore`'d — clearly not committed. But `npm run validate:structure` requires `js-yaml` to be installable, so the *capability* is in-membrane while the *artifact* is not. Nix-style content addressing would force a decision.
4. **Is the parent vault's `.obsidian/` in any membrane?** It exists at `Zettelkasten/.obsidian/` (host workspace), not at any instance level. The `obsidian-interface` plan proposes shipping a recommended `.obsidian/` config inside `packages/obsidian-interface/` — promoting host config to in-membrane. Not yet decided.
5. **Are `repos/`-cloned external repos in-membrane?** `.gitignore` excludes `repos/*` except `README.md`. So clones are explicitly *out* of the git membrane but physically in the directory tree. `repos.manifest.json` is the boundary contract. This is the cleanest "external" boundary in the system today.
6. **Where do `docs/agent-plans/` plans live, conceptually?** `FILE-STRUCTURE.md` lists them as instance documentation, but plans like `federation-protocol`, `system-reliability`, `package-integration` are *framework* concerns scoped at this repo. The plan-as-instance-artifact vs. plan-as-framework-development-tool distinction is unresolved.
7. **What's the membrane status of `scripts/page-shim.mjs`, `MASTERPROMPT.md`, the new `docs/HOST-INTEGRATION.md`?** All untracked. Either they're in-membrane and need committing, or they're scratch and need removing. The git index is currently the only honest answer.
8. **Should `data/instances.yaml` and `data/skills-matrix.yaml` live in `data/` at all?** They're framework-only. A separate `framework-data/` (or `meta/`) directory would prevent operators of downstream instances from accidentally inheriting them during `sync:upstream`.

## Existing-plan touchpoints

- **`package-integration`** — directly about packages as in-membrane artifacts. Open question 1 ("consumption mechanism: toggle / npm / vendored / mixed") *is* the membrane question for packages. Today `federation.yaml.packages.{coordination,governance,...}` toggles exist but flipping them does not materialize a package in an instance — the toggle and the on-disk state are decoupled. Plan must decide: does activating a package put files inside the instance's tree (vendored), or reference an external one (npm)?
- **`federation-protocol`** — the membrane is exactly what gets shared/excluded across federation. `.well-known/` is the outward face; `knowledge-manifest.yaml.exchange.published_domains[]` is the explicit publish list. The plan's "test `.well-known/` discovery between instances" task is a membrane-permeability test.
- **`system-reliability`** — validation IS membrane enforcement. The plan's failure-mode-1 ("data integrity") and failure-mode-3 ("federation drift") are both membrane concerns. Pre-commit hooks would convert today's "operator-remembered" invariants (regenerate schemas, no matrix drift) into hard membrane edges.
- **`obsidian-interface`** — the host vault is *outside* the instance membrane today; this plan grafts an interface onto it. Open question 3 ("read-only vs read-write — should Obsidian notes write back to `data/*.yaml`?") is the load-bearing membrane question: does the operator interface live inside the cell wall or outside it?
- **`versioning-system`** (recently completed) — the major.minor match between `package.json.version` and `federation.yaml.metadata.framework_version` is now a hard validator check. This is the strongest membrane invariant currently enforced.
- **`instance-bootstrap`** — defines membrane *birth*. What does the cell wall look like on day zero? The plan should specify which files must exist before the instance is "alive" (and therefore validatable).

## Framework-level note

Where does the framework end and an instance begin? The line is drawn by **provenance**, not by location: `data/instances.yaml`, `data/skills-matrix.yaml`, `data/packages-matrix.yaml`, and `scripts/analyze-instances.mjs` are framework-only — they describe the federation, not this org's reality. The other 13 registries listed in `DATA-MODEL.md` plus the 9 root agentic files are instance-canonical and exist (in identical shape, different content) in every downstream instance. Skills and packages are bidirectional: `skills/` and `packages/` ship with the framework as canonical defaults, and instances may add their own (tracked in the matrices for promotion). The cleanest framework/instance membrane today is the `customizations[]` block in `federation.yaml` — it explicitly lists which paths this *particular* instance (the framework repo, currently self-hosting) maintains beyond the canonical spec. Every downstream instance has its own `customizations[]`. That block is the closest thing org-os has to a per-cell genome diff against the canonical body plan.
