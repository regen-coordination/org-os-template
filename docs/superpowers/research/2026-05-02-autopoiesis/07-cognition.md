# 07 — Cognition / Evolution

> Aspect: how an instance learns. Promotion of skills, extraction of patterns from memory, modification of own configuration in light of experience. Process aspect.

## Mechanism (step by step)

Trace one example end to end: the `research` skill, the only currently-tracked promotion candidate that meets the ≥2-instance bar.

**Step 1 — Pattern lives in instances (not yet noticed by the framework).**
Two instances independently grow a `research` skill: `refi-bcn-os/skills/research/` and `refi-dao-os/skills/research/`. Each was created by the operator inside that instance, with no central coordination. At this point the framework has no record.

**Step 2 — Discovery scan (script).**
`scripts/analyze-instances.mjs` (`npm run analyze:instances`) walks every cloned instance's `skills/` directory. For each skill name found, it checks two sets:
- `frameworkSkills` (directories present in `org-os/skills/`)
- `knownSkills` (ids in `data/skills-matrix.yaml`)

For every instance-local skill not in `frameworkSkills`, the script emits `undeclared_skill:<name>` if the instance's `skills_extra` list in `data/instances.yaml` doesn't list it, and `unmapped_skill:<name>` if `skills-matrix.yaml` doesn't track it. Output goes to `memory/reports/instances-drift-YYYY-MM-DD.md` and to a console summary that pre-aggregates `unmapped_skills` at the top.

This script is the only automated extractor of cross-instance pattern data. There is exactly one report on disk: `memory/reports/instances-drift-2026-04-24.md`. It is run weekly by operator habit, per HEARTBEAT.md → "Weekly: run `npm run analyze:instances` and review drift report."

**Step 3 — Operator triages, hand-edits the matrix.**
A drift report lists `unmapped_skill:research` (or similar). The operator reads `docs/SKILL-PROMOTION.md` criteria (≥2 instances, generalizability, tests, docs), decides `research` qualifies, and hand-edits `data/skills-matrix.yaml`:

```yaml
- id: "research"
  owner: "refi-bcn-os"
  instances_using: ["refi-bcn-os", "refi-dao-os"]
  in_framework: false
  promotion_status: "candidate"
  notes: "Present in two operational instances..."
```

There is no script that promotes a skill from "discovered as unmapped" to `promotion_status: candidate`. The transition is a manual diff in YAML.

**Step 4 — Idea ledger mirror.**
The same finding is logged into `data/ideas.yaml` as `idea-006-promote-research-skill`, status `approved`, `submitted_by: agent`, `source: cross-instance scan 2026-04-24`. This is the only place where the *intent to promote* is tracked separately from the matrix's *state*. There is no foreign-key link between `ideas.yaml` and `skills-matrix.yaml` — the relationship lives in the prose `notes` field.

**Step 5 — Promotion (manual, per `docs/SKILL-PROMOTION.md` workflow).**
The operator (or an agent under the operator's direction):
1. Reconciles the two instances' implementations — extracts a common core.
2. Copies `SKILL.md` and supporting files into `org-os/skills/research/`.
3. Updates `skills-matrix.yaml`: `in_framework: true`, `promotion_status: canonical`, `owner: framework`.
4. Logs a `DECISIONS.md` entry.
5. Commits.

No script does this. No PR template enforces the steps. The doc describes the workflow; an agent or human follows it.

**Step 6 — Sync downstream.**
`docs/SKILL-PROMOTION.md` step 5 says "instances adopt the framework version on their next sync." The mechanism: `npm run sync:upstream`. The script: `scripts/sync-upstream.mjs`.

**The script does not exist.** `package.json` defines `"sync:upstream": "node scripts/sync-upstream.mjs"` but `scripts/sync-upstream.mjs` is absent. `scripts/validate-structure.mjs:226` lists `sync:upstream` as a *recommended* script. The validator notes its presence by name in `package.json` but doesn't execute it. So step 6 is a documented intent with no implementation.

**Step 7 — New skill loaded by future agent sessions.**
Per `docs/AGENTIC-ARCHITECTURE.md` → "Discovery at Startup": "during the startup sequence, the agent reads `skills/*/SKILL.md` to build its skill inventory." For instances that *do* receive the promoted skill (today, only by manual `cp -r` from framework to instance), the next `/initialize` finds the new directory and incorporates it. For instances that don't, the framework canonical version drifts from instance reality.

**The loop, written end-to-end:**
pattern grows in 2 instances → `analyze:instances` flags `unmapped_skill` → operator reads drift report → operator hand-edits `skills-matrix.yaml` to `candidate` → operator hand-edits `ideas.yaml` to mirror → operator (or agent) hand-extracts common core to `framework/skills/<name>/` → operator hand-edits `skills-matrix.yaml` to `canonical` → operator hand-writes `DECISIONS.md` entry → instance maintainers eventually `cp` or pull → next `/initialize` discovers the skill.

Automation appears at exactly one link: detection (Step 2). Everything else is operator brain plus YAML editing.

A second cognition path sits inside `skills/workspace-improver/SKILL.md` — the autoresearch loop. Its scope is *intra-instance*: read MASTERPLAN → identify gap → make scoped change → measure (`npm run validate:schemas`, HEARTBEAT count) → keep or revert → log to `memory/YYYY-MM-DD.md`. It is allowed to "draft new skill definitions in `skills/`" but explicitly forbidden from modifying `MASTERPLAN.md`, `SOUL.md`, `IDENTITY.md`, `federation.yaml`. So workspace-improver can *draft* new patterns but can't *promote* them; promotion always exits to the manual cross-instance loop above.

## Prior art

- **Christopher Alexander, *A Pattern Language*** — patterns earn their place by repeated successful instantiation. The ≥2-instance bar in `docs/SKILL-PROMOTION.md` is structurally the same idea: a pattern that occurs once is happenstance; one that recurs across independent contexts is a pattern. `non-criteria` ("not a candidate just because the originating maintainer asks for it") encodes Alexander's "patterns earn promotion through use, not advocacy."
- **Karpathy's autoresearch (`karpathy/autoresearch`)** — explicitly cited in `skills/workspace-improver/SKILL.md` and `docs/AGENTIC-ARCHITECTURE.md`. Mapping: `MASTERPLAN.md = program.md`, `data/*.yaml + skills/ = train.py`, `HEARTBEAT.md metrics = val_bpb`, `memory/YYYY-MM-DD.md = experiment log`. This is the framework's chosen metaphor for intra-instance learning.
- **Friston / active inference** — agent acts to reduce surprise / prediction error. workspace-improver's keep-or-revert step (Step 6: "if metrics regressed: revert") is a coarse local approximation: the agent retains changes that don't increase prediction error against the metric set, drops those that do. The metrics are crude (schema validation pass/fail, HEARTBEAT pending count) — `idea-005-autoresearch-metrics` flags this gap.
- **Kahneman's System 1 / System 2** — a promoted skill is operator System-2 behavior compiled into agent System-1 behavior. Once `research` lives in `framework/skills/`, every future session loads it as part of skill inventory at startup; the operator no longer thinks through "should I do research that way?" because the agent will trigger-match the skill automatically.
- **Evolutionary algorithms (selection over variation)** — the skills-matrix is the gene pool, the ≥2-instance criterion is the fitness gate, instances are the variation generators, sync:upstream is the (intended) reproduction mechanism. The selection pressure is currently provided entirely by the operator.

## Invariants / failure modes

What CLOSES the loop: pattern noticed → tracked in matrix → promoted via doc workflow → installed into framework → loaded at startup → used in real sessions → reinforces matrix entry on next scan.

What BREAKS it, link by link, with concrete file evidence:

- **Pattern noticed in single instance only → never reaches ≥2 → stays instance-local forever.** Five DAO-module skills (`safe-treasury`, `hats-governance`, `gardens-governance`, `karma-reputation`, `eip4824-identity`) sit at `instances_using: ["dao-os"]` since 2026-04-24 with no path forward. The criterion is correct but produces no movement when only one instance has the pattern. Compare with `karpathy-guidelines` and the eleven `superpowers-*` skills, which were promoted unilaterally with `instances_using: []` — they bypassed the criterion entirely. The framework has two ingestion modes (organic-bottom-up via ≥2 rule, top-down by maintainer fiat) and only the second has been used at scale.
- **Pattern recurs in memory but the noticing scope is files-on-disk only.** `analyze-instances.mjs` looks at `skills/` directories. It doesn't read `memory/YYYY-MM-DD.md`, doesn't grep `MEMORY.md`, doesn't scan `DECISIONS.md`. A pattern that appears as a recurring decision-shape in memory (e.g. "draft-and-present before sending external comm" appears in many sessions) is invisible to the discovery layer unless someone codifies it as a `skills/<name>/` directory first. The substrate that cognition is supposed to operate on (memory) is not actually read by the cognition mechanism.
- **Promoted but never installed in instances.** `sync:upstream` is referenced from `package.json`, `validate-structure.mjs`, `docs/SKILL-PROMOTION.md` step 5, `docs/AGENTIC-ARCHITECTURE.md` "Other instances inherit," and `docs/SKILL-SPECIFICATION.md` step 5. The implementing script `scripts/sync-upstream.mjs` does not exist on disk. So a promoted skill enters `org-os/skills/` and stays there; instances do not pull it. The full set of canonical skills (`workspace-improver`, `idea-scout`, `bootstrap-interviewer`, the eleven `superpowers-*` skills, `expert-feynman`, `karpathy-guidelines`) carry `instances_using: []` or near-empty arrays — partly because they're new, partly because there is no mechanism to install them.
- **Installed but stale matrix.** `skills-matrix.yaml` is hand-maintained. `analyze-instances.mjs` writes a drift report; nothing writes back to the matrix. So `instances_using` lists go stale silently. The drift report is forensic, not corrective.
- **Drafted but never proposed.** workspace-improver may draft skill definitions in `skills/`. There is no convention for marking a draft (e.g. `tier: draft` or filename suffix), no path for elevating it to candidate, and no scan that finds drafted skills and surfaces them in the next drift report. Drafts live and die in `memory/YYYY-MM-DD.md`.
- **No back-channel from instance to framework.** When an instance finds a framework skill *useful*, that signal does not flow back. `instances_using` only changes when the operator manually edits the matrix. There is no telemetry, no agent log of "I activated `meeting-processor` 14 times this month and it succeeded 12 times." The reinforcement loop is not closed.
- **Non-criteria are doc-only.** "It exists in only one instance" and "the originating maintainer asks for it" are listed as non-criteria in `SKILL-PROMOTION.md`, but the eleven `superpowers-*` skills and `expert-feynman` got `promotion_status: canonical` while still showing `instances_using: []`. The `non-criteria` are not enforced anywhere — they're operator self-discipline.

The shortest summary: **detection is a script, everything else is the operator's hands.** The loop closes today only because the operator personally walks each link.

## Open questions

1. **Where should pattern extraction from memory live?** The current set of skills includes `workspace-improver` (inside one instance, looks at MASTERPLAN + HEARTBEAT) and `analyze-instances` (across instances, looks at `skills/` directories). Neither reads `memory/YYYY-MM-DD.md` or `DECISIONS.md` for recurring shapes. Should there be a `pattern-extractor` skill that scans memory for repeated decision templates? Or should `idea-scout` (currently scoped to "scan knowledge for ecosystem gaps") be widened?
2. **Is skill promotion intentionally manual, or just unimplemented?** `docs/SKILL-PROMOTION.md` describes the workflow as a sequence of edits; nothing in the doc commits to manual-by-design. The bigger gap is the missing `sync-upstream.mjs`, which is *also* described but absent. Both reads as "designed, scheduled, not yet implemented" rather than deliberately manual.
3. **What is the trigger for re-evaluating a candidate?** Once a skill is `candidate`, no script downgrades it to `evaluating` or upgrades it to `canonical`. `research` has been a candidate since 2026-04-24 and is still a candidate. There is no SLA, no decay rule, no re-scan that would say "this candidate has been stale for 30 days, escalate or close."
4. **How does an instance signal back to framework that a pattern works?** `instances_using` is the only field that carries this and it's hand-maintained. Should agents, on `/close`, append a record to a per-skill usage log? Should `analyze-instances` count skill *invocations* (e.g., trigger-match counts in session logs) rather than just file presence?
5. **Where does the demotion path actually run?** `SKILL-PROMOTION.md` says "if a canonical skill stops being used or diverges materially across instances, demote to `promotion_status: evaluating` and open an issue." There is no script that detects "stops being used" and no convention for "open an issue" inside this self-hosted repo.
6. **Are `data/ideas.yaml` and `data/skills-matrix.yaml` redundant?** Idea `idea-006-promote-research-skill` and skills-matrix entry `research` describe the same thing. Two registries with no foreign key means they will drift. Pick one as authoritative or define the relationship.

## Existing-plan touchpoints

- **`docs/agent-plans/package-integration.md`** — explicitly mirrors the skill-promotion pipeline at the package level: phase 1 audit (parallels `analyze:instances`), phase 2 lifecycle doc (parallels `SKILL-PROMOTION.md`), phase 3 integration mechanism (parallels the missing `sync:upstream`). The plan's open question 5 ("Boundary with skills — some candidates overlap with skill candidates, e.g. governance") indicates the cognition layer may need *one* promotion engine that handles both. The DAO-module candidates in `skills-matrix.yaml` and the dashboard candidate in `packages-matrix.yaml` are the same pattern at different granularities.
- **`framework-evolution` workstream** (`data/projects.yaml` row) — described as "longer-horizon: new instance specs, support for new org types, federation at scale (10+ nodes)." The framework-level half of cognition (cross-instance pattern flow → canonical) lives here in concept; nothing in the workstream description names it as cognition. It's the natural home for a `framework-as-autopoietic-system` follow-up plan (gestured at in the autopoiesis spec, Phase 3).
- **`non-tech-onboarding` and `obsidian-interface` plans** — themselves outputs of the cognition loop, on the meta level. Both are operator-noticed patterns ("CLI literacy is a barrier," "Obsidian is the primary daily surface") that have been promoted to plans, not yet to skills or packages. They are skill-promotion-on-the-plan-level: a recurring need across instances elevated to canonical infrastructure work.
- **`skill-promotion` workstream** — already exists as a workstream row in `data/projects.yaml`. It currently has no plan file in `docs/agent-plans/`. The implementation gap (missing `sync-upstream.mjs`, missing draft-promotion path, missing demotion automation) is the latent agenda for that workstream.
- **`idea-005-autoresearch-metrics`** in `data/ideas.yaml` — directly names the measurement gap inside the intra-instance loop: "no objective criteria decide what counts as improvement." Resolving it makes the workspace-improver's keep-or-revert decision meaningful and feeds back into what counts as a promote-able pattern.

## Framework-level note

Skill promotion *is* the framework's cognition. The framework "learns" by reading across instances (`analyze-instances.mjs` walks `data/instances.yaml`'s cloned children), filtering for ≥2-instance pattern recurrence, and elevating selected patterns into its own canonical `skills/`. The codebase houses this cognition at three locations: the discovery script (`scripts/analyze-instances.mjs`), the matrix (`data/skills-matrix.yaml`), and the workflow doc (`docs/SKILL-PROMOTION.md`). The cognition is gestured at but not implemented at three more: the missing `scripts/sync-upstream.mjs` (which would close the loop by propagating canonical skills back to instances), the absent draft→candidate promotion path inside `workspace-improver`, and the absent memory-pattern extractor that would let recurring *decision shapes* (not just file-system shapes) become candidates. The framework's own skills folder shows this asymmetry directly: the eleven `superpowers-*` skills, `expert-feynman`, and `karpathy-guidelines` were promoted top-down by the maintainer (`instances_using: []`), while only `research` sits as a true bottom-up candidate. The framework's cognition is currently roughly 90% operator brain, 10% script — and the script is the cheap part (file enumeration). The expensive parts (reading memory, deciding generalizability, reconciling divergent implementations, writing the common core, propagating it back) are entirely manual.
