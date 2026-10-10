# Skill promotion

How a skill graduates from instance-local to framework-canonical, and how the registry that records it is checked. The registry is `data/skills-matrix.yaml`, a framework-only file (a cloned instance does not get it). The same process for packages is in [Package lifecycle](PACKAGE-LIFECYCLE.md).

## Criteria

A skill becomes a **promotion candidate** when:

1. **≥ 2 instances have implemented it** — independent validation that the pattern generalizes.
2. **Generalizability review passes** — the skill's purpose is broader than one instance's domain.
3. **Tests exist** — either in the originating instance or in the promotion PR.
4. **Docs exist** — a `SKILL.md` following [`docs/SKILL-SPECIFICATION.md`](SKILL-SPECIFICATION.md).

Tracked in `data/skills-matrix.yaml` under `promotion_status: candidate`.

## Statuses

`promotion_status` is the only status field in the skills matrix. `scripts/validate-structure.mjs` (check 9, run by `npm run validate:structure`) fails an entry whose value is not one of these five:

| Status | Meaning |
|---|---|
| `canonical` | Shipped in the framework and adopted by at least one instance. |
| `evaluating` | Shipped in the framework, no instance adoption yet. |
| `candidate` | Proposed for promotion into the framework. |
| `instance-specific` | Kept local to one instance, not generalisable. |
| `deprecated` | Superseded; kept for compatibility. |

Each entry also carries `owner`, `instances_using`, `in_framework` and `notes`. Only the status is validated. `npm run generate:skills` additionally reports a skill that is on disk but has no matrix row (today `knowledge-graph`) and a matrix row marked `in_framework` with no directory (today `commands`), and gives an unmapped workspace skill the status `evaluating` in `SKILLS.md`.

Current counts (`data/skills-matrix.yaml`, 42 entries): 32 canonical, 4 evaluating (`capital-flow`, `paper-design`, `skills-curator`, `instance-doctor`), 5 candidate, 1 instance-specific (`notion-sync`). None is deprecated. The matrix header defines `candidate` as "present in at least two instances"; the five current candidates are each used by one instance (see below), so the field is applied as "proposed", not as that rule.

## Workflow

1. **Detect** — `npm run analyze:instances` scans each instance's `skills/` and, for every skill the framework does not have, reports `undeclared_skill` (not listed in the instance's `skills_extra`) and `unmapped_skill` (no row in `skills-matrix.yaml`). It does not count instances, so spotting a skill present in two is read off its report. It reads sibling instance checkouts, so it needs them on disk.
2. **Triage** — maintainer reviews candidates in `data/skills-matrix.yaml`. For each, decide: promote, keep instance-specific, or deprecate.
3. **Reconcile** — if two instances have divergent implementations, extract the common core. Leave instance-specific extensions in the instances.
4. **Move** — copy the SKILL.md and any supporting files into `skills/<name>/`. Update `skills-matrix.yaml` to set `in_framework: true`, `promotion_status: canonical`, `owner: framework`.
5. **Sync downstream** — a new instance gets the skill at clone time (`npm run clone:framework`, per its `skills` list). An existing instance gets it through `npm run sync:upstream`, which is a git rebase and works only where the instance shares history with the framework. `npm run doctor -- sync` does not carry skills: its overlay covers `scripts/` and `templates/` only (`packages/instance-doctor/src/overlay.mjs`). Once the framework copy is in, the local copy can be removed.
6. **Log** — record the decision in `MEMORY.md` under Key Decisions.

## Non-criteria

A skill is **not** a candidate just because:

- It exists in only one instance (single data point — validate first).
- The originating maintainer asks for it (patterns earn promotion through use, not advocacy).
- It's popular in the broader ecosystem (if org-os instances don't use it, org-os doesn't need it).

## Current candidates

`data/skills-matrix.yaml` is the authoritative list. The table was last compared with it on 2026-10-10:

| Skill | Owner | Instances | Note |
|---|---|---|---|
| `safe-treasury` | dao-os | dao-os | Framework has no treasury layer. |
| `hats-governance` | dao-os | dao-os | Framework has no governance-protocol layer. |
| `gardens-governance` | dao-os | dao-os | Same. |
| `karma-reputation` | dao-os | dao-os | Evaluate generality first. |
| `eip4824-identity` | dao-os | dao-os | Overlaps with the framework's `schema-generator`; evaluate first. |

`research`, listed here in the first version as the high-priority candidate, has since been promoted: it is `canonical` and lives in `skills/research/`. `notion-sync` (owner `refi-bcn-os`) is `instance-specific`: its pattern is framework-worthy, the skill as written is bound to one workspace.

## Demotion

Skills can also move the other way: if a canonical skill stops being used or diverges materially across instances, demote to `promotion_status: evaluating` and open an issue.

---

## Framework feedback from instances

Instances also produce written feedback about the framework itself. Only one decision about it is recorded in this repository: the two data-loss defects in the kms layer, found in an instance, ship as documented Known Issues in `CHANGELOG.md` `[0.5.0]`, their fix targets 0.5.1, and they gate propagating the framework to the fleet (decision F4 in `DECISIONS.md`). The instance-side feedback ledgers themselves live in the instance repositories and are not described here.

---

## Script-level reconciliation

The same idea extends to **scripts**: the framework's `scripts/` directory absorbs knowledge-pipeline and validation scripts proven across two or more instances.

Use `npm run check:divergence` to compare every instance's `scripts/<name>` against the framework canonical. The script never modifies files — it's purely advisory. Output classifies each instance script as `IDENTICAL`, `DIVERGES`, or `MISSING`.

### Known divergences (recorded at the v3.5.0 release, not re-checked)

The table below is a historical record. Re-deriving it needs the instance repositories checked out beside this one, which was not done for this page, so none of the hashes or instance states are verified; rerun `npm run check:divergence` for the current picture.

| Script | Instance | Status | Notes |
|---|---|---|---|
| `compile-knowledge.mjs` | refi-dao-os | DIVERGES (`73f9b36d…` vs canonical `655f3015…`) | Same 744-line shape, refi-dao-os has local edits. Manual reconciliation deferred to refi-dao-os cascade (Phase 14, post-2026-05-19 Steward Council election). Origin: refi-bcn-os + regen-coordination-os byte-identical → adopted as canonical. |
| `update-knowledge-index.mjs` | refi-dao-os | DIVERGES (`fd325a5c…` vs canonical `7ac0f0d4…`) | Same 257-line shape, refi-dao-os has local edits. Same reconciliation plan as above. |
| `validate-structure.mjs` | refi-bcn-os, refi-dao-os | DIVERGES | Both share `22807921b28f` vs canonical `5265162ab3e5` — these instances are on older versions; framework has v3.5 enhancements. Auto-resolves on cascade. |
| `setup-org-os.mjs` | refi-bcn-os, refi-dao-os | DIVERGES | Same as above — instances on older versions. Auto-resolves on cascade. |

### Reconciliation procedure

1. Run `npm run check:divergence` to enumerate.
2. For each divergent script, `diff scripts/<name> ../<instance>/scripts/<name>` to classify the divergence:
   - **(a) bug fix worth porting back to framework** — open a PR upstream
   - **(b) instance-specific behavior to keep local** — note in this section
   - **(c) drift to discard** — let the cascade overwrite (instance opts in)
3. The operator chooses adopt/keep/merge per script during cascade. Never auto-resolve divergences.
4. Anti-pattern to avoid: **do not** build three-way merge tooling for script reconciliation. The divergence count is small enough to handle manually; tooling adds maintenance debt for marginal benefit.

### Normalizing per-instance configuration

When a promoted script needs per-instance configuration (paths, terminology dictionaries, alias maps), externalize the configuration to a `data/*.yaml` file rather than editing the script. Example: `scripts/normalize-kb-frontmatter.mjs` takes an aliases file (`--aliases <path>`, conventionally `data/knowledge-aliases.yaml`, which an instance supplies; the framework does not ship one). This keeps the framework version generic and lets instances configure without forking.
