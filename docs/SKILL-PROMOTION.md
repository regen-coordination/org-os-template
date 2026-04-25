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
