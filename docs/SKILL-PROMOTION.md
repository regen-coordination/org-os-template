# Skill Promotion

How a skill graduates from instance-local to framework-canonical.

## Criteria

A skill becomes a **promotion candidate** when:

1. **≥ 2 instances have implemented it** — independent validation that the pattern generalizes.
2. **Generalizability review passes** — the skill's purpose is broader than one instance's domain.
3. **Tests exist** — either in the originating instance or in the promotion PR.
4. **Docs exist** — a `SKILL.md` following `docs/SKILL-SPECIFICATION.md`.

Tracked in `data/skills-matrix.yaml` under `promotion_status: candidate`.

## Workflow

1. **Detect** — `npm run analyze:instances` flags skills present in ≥ 2 instances but not in framework. Also flags skills present in any instance but not in `skills-matrix.yaml` (`unmapped_skill`).
2. **Triage** — maintainer reviews candidates in `data/skills-matrix.yaml`. For each, decide: promote, keep instance-specific, or deprecate.
3. **Reconcile** — if two instances have divergent implementations, extract the common core. Leave instance-specific extensions in the instances.
4. **Move** — copy the SKILL.md and any supporting files into `skills/<name>/`. Update `skills-matrix.yaml` to set `in_framework: true`, `promotion_status: canonical`, `owner: framework`.
5. **Sync downstream** — instances adopt the framework version on their next sync. Their local copy can be removed.
6. **Log** — add an entry to `MEMORY.md` → Key Decisions.

## Non-criteria

A skill is **not** a candidate just because:

- It exists in only one instance (single data point — validate first).
- The originating maintainer asks for it (patterns earn promotion through use, not advocacy).
- It's popular in the broader ecosystem (if org-os instances don't use it, org-os doesn't need it).

## Current Candidates (as of 2026-04-24)

See `data/skills-matrix.yaml` for the authoritative list. Candidates at inauguration:

| Skill | Owner | Instances | Priority |
|---|---|---|---|
| `research` | refi-bcn-os | refi-bcn-os, refi-dao-os | High — meets ≥ 2 criterion |
| `safe-treasury` | dao-os | dao-os | Medium — framework gap (treasury layer) |
| `hats-governance` | dao-os | dao-os | Medium — framework gap |
| `gardens-governance` | dao-os | dao-os | Medium — framework gap |
| `karma-reputation` | dao-os | dao-os | Low — evaluate generality first |
| `eip4824-identity` | dao-os | dao-os | Low — overlaps with framework's schema-generator, evaluate first |

## Demotion

Skills can also move the other way: if a canonical skill stops being used or diverges materially across instances, demote to `promotion_status: evaluating` and open an issue.

---

## Script-Level Reconciliation (added v3.5.0)

The same promotion mechanism extends to **scripts**. The framework's `scripts/` directory grows by absorbing knowledge-pipeline and validation scripts proven across ≥2 instances.

Use `npm run check:divergence` to compare every instance's `scripts/<name>` against the framework canonical. The script never modifies files — it's purely advisory. Output classifies each instance script as `IDENTICAL`, `DIVERGES`, or `MISSING`.

### Known divergences (as of v3.5.0 release)

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

When a promoted script needs per-instance configuration (paths, terminology dictionaries, alias maps), externalize the configuration to a `data/*.yaml` file rather than editing the script. Example: `data/knowledge-aliases.yaml` consumed by `scripts/normalize-kb-frontmatter.mjs`. This keeps the framework version generic and lets instances configure without forking.
