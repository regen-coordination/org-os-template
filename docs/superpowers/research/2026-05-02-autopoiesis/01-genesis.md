# 01 — Genesis

> Aspect 1 of the autopoiesis research. Instance-level primary, framework-level secondary.
> What's the minimal seed that yields a viable instance? How is one born today?

## Mechanism (step by step)

The most recent live birth — `refi-med-os` on 2026-04-29 — is the only end-to-end record of the Genesis process working. It is the ground truth here, not the prose in `BOOTSTRAP.md`. Reconstructed from `memory/2026-04-29.md` and the resulting tree at `03 Libraries/refi-med-os/`:

1. **Operator decides "I want a new instance"** — no script triggers this. It is a human intent.

2. **Operator hand-scaffolds the canonical shape.** Per the memory log: 12 root files, 6 dirs, 15 `data/*.yaml` registries, 4 skills (`bootstrap-interviewer`, `org-os-init`, `initialize`, `schema-generator`), and the scripts `initialize.mjs`, `generate-all-schemas.mjs`, `validate-structure.mjs`, `validate-schemas.mjs`, `setup-org-os.mjs`, `clone-linked-repos.mjs`. **No script does this copy.** The maintainer cherry-picked files from the framework by hand. Confirmed by `Grep "scaffold"` in `scripts/`: zero matches.

3. **Operator hand-writes `validate-schemas.mjs`** because the framework's `package.json` (line 22) points `validate:schemas` at `scripts/validate-identity.mjs` which does not exist. This is a Genesis bug recorded in 2026-04-29 carry-overs as "Pre-existing framework bug noticed but not fixed."

4. **Operator runs `git init -b main && npm install`.**

5. **Operator runs `npm run generate:schemas` and `npm run validate:schemas` and `npm run validate:structure`** — these pass. The instance is now structurally valid per `scripts/validate-structure.mjs`: required root files, required dirs, required `data/*.yaml`, three required `.well-known/*.json`, at least one skill, federation.yaml has identity+federation+agent, package.json has the schema scripts.

6. **Operator hand-writes `.well-known/dao.json`** because "the schema generator reads but doesn't create it" (memory log). Another Genesis gap.

7. **Operator copies `.claude/commands/initialize.md` and `close.md`** verbatim from the framework. The scaffold step missed them — recorded as a mid-session bug fix at commit `b023435`.

8. **Operator pushes to GitHub** (`gh repo create ReFiDAO/refi-med-os --public`).

9. **Operator registers the instance back into the framework** by adding entries to `data/instances.yaml` and to `federation.yaml downstream:`. `npm run analyze:instances` is gestured at in `data/instances.yaml` line 4 ("Populated by npm run analyze:instances") but the registration here was hand-edited.

10. **Operator writes `BOOTSTRAP.md` for the new instance** — a custom one (different from the framework's). It documents what's already done and instructs the operator to run `/initialize`, then trigger the `bootstrap-interviewer` skill manually.

11. **At this point the instance is "alpha"** per `data/instances.yaml`: maturity field is set, but the `notes` field reads "Bootstrap pending — identity/members/projects are TBD-stubs; operator follows BOOTSTRAP.md + one-pager to complete the bootstrap-interviewer flow."

12. **The bootstrap-interviewer skill (`skills/bootstrap-interviewer/SKILL.md`) is a *prompt*, not a *program*.** It tells an LLM agent how to interview the operator and which files to write (`SOUL.md`, `IDENTITY.md`, `data/members.yaml`, `data/projects.yaml`, `data/channels.yaml`, `federation.yaml`). The skill never runs unless an agent loads it; the agent loads it only if `/initialize` notices `TBD via bootstrap interview` markers and decides to invoke it.

13. **The interview "completes"** when the agent has filled the stubs and reported a summary. There is no machine check that fires here — `validate:structure` passes whether the stubs are filled or not, because it checks for *file existence*, not *content non-stubness*.

So the actual mechanism is: **manual scaffold by maintainer → `git init` + npm install → schema/structure validators pass on stubs → push → manual federation registration → operator invokes `/initialize` in the new repo → agent maybe invokes `bootstrap-interviewer` → agent writes content into pre-existing stub files.**

There is **no `scripts/scaffold-instance.mjs`**. There is **no `npm create org-os@latest`**. There is **no GitHub template-repo configuration**. The `bootstrap:local` script (package.json:14) is `npm run clone:repos && npm install` — that clones *content sources* from `repos.manifest.json` into `repos/`, it does not clone the framework. The `instance-bootstrap` plan (`docs/agent-plans/instance-bootstrap.md`) explicitly names this gap (line 30): "There is **no script today that clones the framework into a new instance directory**."

## Prior art

- **Von Neumann self-replicating constructor (universal constructor + tape).** The org-os framework is the constructor; the `data/*.yaml` registries + identity markdown are the tape. Today the constructor is a human reading prose in `BOOTSTRAP.md`. Von Neumann's whole point was that the constructor must be *mechanical* — the description executes itself. org-os has not crossed that line.
- **Fertilized egg → organism (zygote with totipotent state).** `refi-med-os` at scaffold-time is a fertilized egg: every file is present but most are stubs marked `TBD via bootstrap interview`. The "differentiation" happens through the interview. Useful frame because it says: presence of all canonical files at t=0 is *normal*, the content fills in over the first session(s).
- **Nix flakes / Guix declarative reproducibility.** A flake is a single declarative file that fully reproduces a build. org-os has no equivalent — there is no `instance.flake` or `org-os.lock` that says "given this seed, produce this instance." `instance-bootstrap` plan open question 4 asks whether to introduce `instance.manifest.yaml`.
- **GitHub template repositories.** The cheapest possible Genesis mechanism: marking `org-os` as a template gives a "Use this template" button that creates a new repo with the same tree, no fork relationship. Mentioned in `instance-bootstrap` plan open question 1. Not configured today.

## Invariants / failure modes

What must hold for Genesis to "close the loop" (zero → viable instance)?

**Required for viability (working definition):**
- [V1] All required root files exist (`MASTERPLAN.md`, `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, `HEARTBEAT.md`, `TOOLS.md`, `CLAUDE.md`, `README.md`, `federation.yaml`, `package.json`) — checked by `validate-structure.mjs` lines 55–72.
- [V2] Required dirs exist (`data/`, `.well-known/`, `memory/`, `skills/`, `packages/`, `scripts/`) — lines 84–95.
- [V3] Required `data/*.yaml` registries exist (members, projects, finances, governance, meetings, ideas) — lines 108–115.
- [V4] At least three `.well-known/*.json` schemas exist and are valid JSON — lines 140–162.
- [V5] At least one skill with a `SKILL.md` — lines 167–187.
- [V6] `federation.yaml` has identity + federation + agent sections — lines 198–202.
- [V7] `package.json` has `generate:schemas` and `validate:schemas` scripts — lines 220–222.

**Failure modes:**
- **F1: Stub viability.** All seven invariants above can hold while every identity file is a literal `TBD` stub. The instance "passes validation" but a `/initialize` against it produces a meaningless dashboard. Validation is structural, not semantic.
- **F2: Wizard halfway through.** `bootstrap-interviewer` is an LLM prompt. If the agent crashes, drops context, or the operator wanders off mid-interview, partial state lands in some files and not others. There is no transactional commit; no resume marker.
- **F3: Hand-scaffold drift.** Each manual scaffold is slightly different from the last. `refi-med-os` shipped with 4 skills; the framework currently has 22 (`Bash ls skills/`). Which subset constitutes a "fresh instance" is not codified anywhere — the `bootstrap-interviewer` plan (open question 4) explicitly flags this.
- **F4: Broken-tooling-as-skin.** The new instance inherits the framework's bug that `validate:schemas` points at a non-existent script. The maintainer caught this by hand for `refi-med-os` and patched it; an automated Genesis would propagate the bug.
- **F5: Federation registration is decoupled.** Steps 9 and 11 above happen in the *parent* (framework) repo, not the *child*. A new instance can be born and never appear in `data/instances.yaml`. There is no callback. `npm run analyze:instances` exists (per the comment in `data/instances.yaml:4`) but is not run automatically post-Genesis.
- **F6: Two `BOOTSTRAP.md`s diverge.** The framework's `BOOTSTRAP.md` (3 phases, prose) and the instance-specific one written for `refi-med-os` are different files with different intents. There is no single bootstrap document — the operator gets whichever the maintainer happened to write.
- **F7: No script-level "seed → run" pipeline.** `package.json` has `setup` (interactive wizard on already-cloned repo) and `clone:repos` (clones content sources, not framework). There is nothing in between. The seed-to-viable-instance arc requires a human walking 13 steps.

## Open questions

1. **Is `data/instances.yaml` a registry of *born* instances or *intended* instances?** It currently mixes both — `refi-med-os` is "alpha, bootstrap pending" while `refi-bcn-os` is "production." A hypothetical instance that exists only as a plan (e.g. regen-coordination-os pre-2026-04-24) was historically tracked via plan documents, not this registry. Pick a meaning.
2. **Is `validate-structure.mjs` the definition of "viable," or just a structural check?** Its 7 categories (above) are the closest thing to a viability spec. Either elevate it to *the* definition, or distinguish "structurally complete" from "operationally viable" (e.g. content-ness check: no field equals `TBD via bootstrap interview`).
3. **Where does selection live?** `instance-bootstrap` plan open question 4. Options: extend `federation.yaml packages:` block, add a `skills:` parallel block, or introduce `instance.manifest.yaml`. Today selection doesn't live anywhere — the maintainer picked 4 skills for `refi-med-os` by typing them.
4. **Should the framework be cloned, forked, or template-instantiated?** `refi-med-os` was effectively *copy-paste*: no upstream remote points at the framework as origin (`federation.yaml` separately tracks the relationship). A real fork would give `git fetch upstream` for free. A template repo would not.
5. **What initiates Genesis?** `npm create org-os@latest`? A `scripts/scaffold-instance.mjs` run *inside the framework* that creates a sibling directory? A separate scaffolder repo? The `instance-bootstrap` plan defers this to phase 1.
6. **Does the LLM-driven interview need to remain LLM-driven?** `setup-org-os.mjs` already exists as a deterministic `@clack/prompts` wizard. It overlaps with `bootstrap-interviewer` (both ask org name, type, mission, etc.) but writes different files. Two parallel mechanisms, neither knowing about the other.
7. **What is "self-hosting" for the framework itself?** `MEMORY.md` references "self-hosting inauguration 2026-04-24" and `BOOTSTRAP.md:5` says "the org-os repo itself is bootstrapped as of 2026-04-24." The framework treats itself as an instance. But Genesis-of-the-framework was a different (irreducibly historical) act than Genesis-of-an-instance. Are they the same kind of birth?

## Existing-plan touchpoints

- **`instance-bootstrap`** (`docs/agent-plans/instance-bootstrap.md`, status: queued, priority 5, est. 4 sessions) — *this is the plan that closes Genesis*. Phase 1 = cloning mechanism, Phase 2 = wizard with selection, Phase 3 = knowledge bootstrap proof-of-pipeline. Open questions 1, 2, 3, 4, 5 of this research map directly to its open questions 1, 4, 4, 1, 1 respectively. The research findings here should feed into Phase 1 scoping when that plan goes active.
- **`non-tech-onboarding`** (status: scoping, depends_on `instance-bootstrap`) — Genesis via web wizard. Same engine, different operator skin. The viability invariants V1–V7 must survive whatever path the operator takes.
- **`future-instance-specs`** (status: queued, priority 1) — defines what `regen-coordination-os` and `regen-toolkit` *should be* as instances before they're born. This is "intended seed" complement to "actual scaffold." Fits with open question 1 above.
- **`package-integration`** (status: queued) — overlaps with `instance-bootstrap` Phase 2 on package selection storage. Genesis cannot be closed independently of how packages get materialized.
- **Add: `genesis-determinism`** (proposed, scoping) — a smaller plan to remove the failure modes F1, F4, F6 *before* `instance-bootstrap` lands: fix the broken `validate:schemas` script reference, write a `viable-vs-structural.md` spec distinguishing F1, consolidate the two `BOOTSTRAP.md`s. These are all 1-session fixes that make `instance-bootstrap` Phase 1 cleaner.

## Framework-level note

The framework gives birth to an instance today by being copied. There is no `git fork`, no template-repo button, no `npm create` scaffolder — `refi-med-os` (2026-04-29) was hand-built file-by-file from the framework as visual reference, then registered back into the parent's `data/instances.yaml` and `federation.yaml downstream:` by hand. What's "inherited" is whatever subset of the framework tree the maintainer remembers to copy (4 of 22 skills for `refi-med-os`); what's "invented per-instance" is identity (`SOUL.md`, `IDENTITY.md`), operator (`USER.md`), federation peers, and an instance-specific `BOOTSTRAP.md` that diverges from the framework's. Lineage tracking is one-way: the child doesn't know its parent (no upstream remote in `federation.yaml` for `refi-med-os`), but the parent knows its child via the `data/instances.yaml` registry. The framework, in other words, is currently more like a *species manual* a midwife consults than a *constructor* that runs.
