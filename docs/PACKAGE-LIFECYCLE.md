# PACKAGE-LIFECYCLE — Promotion, Integration, Retirement

Mirrors `docs/SKILL-PROMOTION.md` for packages. Covers full lifecycle from promotion candidate to canonical to retirement.

## States (from `packages-matrix.yaml.lifecycle_status`)

| State | Meaning |
|---|---|
| `active`  | Currently used by ≥1 instance. Maintained. |
| `dormant` | In framework but no instances currently using. Kept as scaffolding. |
| `planned` | Approved for inclusion; not yet built (or not yet promoted from instance). |
| `retired` | No longer maintained; existing consumers should migrate. |

## Promotion criteria (instance-originated → framework-canonical)

A package becomes a **promotion candidate** when:

1. Used by ≥2 instances independently.
2. Pattern is generic enough to apply to other org types (not specific to one org's quirks).
3. An originating instance owner agrees to transfer maintenance.

## Promotion workflow

1. Update `packages-matrix.yaml`: `promotion_status: candidate` → `canonical` after review.
2. Move/copy package source from originating instance to `packages/<id>/` in framework.
3. Update `owner: framework`.
4. Add to canonical packages list (default opt-in via `federation.yaml.packages: { <id>: true }`).
5. Set `lifecycle_status: active` (since at least one instance now consumes the canonical version).
6. Document in this file (or a sister catalogue) if non-trivial.

## Integration mechanism (vendored, sync-pulled)

Instances consume framework packages via:

1. Toggle in instance's `federation.yaml.packages: { <id>: true }`.
2. `npm run sync:packages` materializes enabled packages into local `packages/<id>/`.
3. Pin to framework version via `federation.yaml.metadata.framework_version`.
4. Updates pulled by re-running `npm run sync:packages` or (when autopoiesis Phase 2 lands) `npm run sync:upstream`.
5. Disabled packages: warned about, not deleted (operator uses `npm run sync:packages -- --prune`).

## Retirement criteria

- Zero instances using for ≥6 months → `lifecycle_status: dormant`
- Dormant + no planned use → `lifecycle_status: retired`
- Retired packages stay in repo for git history; new instances cannot opt them in.

## Ownership transfer (on promotion)

- Originating instance becomes a **consumer** (federation.yaml toggle).
- Framework takes maintenance ownership; PRs land in framework repo.
- Originating instance's local `packages/<id>/` becomes a vendored copy from framework after first `sync:packages` run.

## When to graduate to npm publish

- Package stable across ≥3 framework releases.
- External demand (org outside the federation network wants to install it).
- Someone willing to own publishing discipline (CI publish, semver, deprecation notices).
- Until all three: stay vendored.

## Related

- `docs/SKILL-PROMOTION.md` — sister doc for skills.
- `data/packages-matrix.yaml` — the registry (validates `lifecycle_status ∈ {active, dormant, planned, retired}`).
- `scripts/sync-packages.mjs` — the materialization mechanism (TDD-tested).
- `scripts/check-divergence.mjs` — advisory for script (and, in future, package) drift.
