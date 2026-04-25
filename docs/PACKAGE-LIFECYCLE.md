# Package Lifecycle

How a package moves through promotion, integration, and retirement. Sister doc to `docs/SKILL-PROMOTION.md`.

## States

Tracked in `data/packages-matrix.yaml` under `lifecycle_status`.

| State | Meaning |
|---|---|
| `active` | Currently used by ≥ 1 instance. Maintained. |
| `dormant` | In framework but no instances currently using. Kept as scaffolding. |
| `planned` | Approved for inclusion; not yet built. |
| `retired` | No longer maintained; existing consumers should migrate. |

## Promotion Criteria

A package becomes a **promotion candidate** when:

1. **≥ 2 instances have implemented it independently** — independent validation that the pattern generalizes.
2. **Generalizable** — the pattern is broad enough to apply to other org types, not specific to one org's quirks.
3. **An originating instance owner agrees to transfer maintenance** — promotion requires a willing handoff.

Tracked in `data/packages-matrix.yaml` under `promotion_status: candidate`.

## Promotion Workflow

1. **Detect** — packages present in ≥ 2 instances but not in framework surface as candidates in `data/packages-matrix.yaml`.
2. **Triage** — maintainer reviews candidates. For each, decide: promote, keep instance-specific, or deprecate.
3. **Reconcile** — if two instances have divergent implementations, extract the common core. Leave instance-specific extensions in the instances.
4. **Move** — copy/move the package source from the originating instance into `packages/<id>/` in framework. Update `packages-matrix.yaml`: set `promotion_status: canonical`, `owner: framework`.
5. **Register** — add to canonical packages list in `federation.yaml.packages` (default-off; opt-in by instances).
6. **Document** — add an entry in `docs/PACKAGES.md` (canonical catalog).
7. **Log** — add an entry to `MEMORY.md` → Key Decisions.

## Integration (Vendored, Sync-Pulled)

Instances consume framework packages via:

1. Toggle in instance's `federation.yaml.packages: { <id>: true }`.
2. `npm run sync:packages` materializes enabled packages into the local `packages/<id>/`.
3. Pin to a framework version via `federation.yaml.framework_version`.
4. Updates pulled by re-running `npm run sync:packages` or `npm run sync:upstream`.
5. Disabled packages: warned about, not deleted (operator opts in to deletion via `npm run sync:packages -- --prune`).

## Ownership Transfer (on Promotion)

- Originating instance becomes a **consumer** — toggles the package on in its `federation.yaml`.
- Framework takes maintenance ownership; PRs land in the framework repo.
- Originating instance's local `packages/<id>/` becomes a vendored copy from framework, no longer hand-edited.

## Retirement Criteria

- Zero instances using for ≥ 6 months → `lifecycle_status: dormant`.
- Dormant + no planned use → `lifecycle_status: retired`.
- Retired packages stay in the repo for git history; new instances cannot opt them in.

## Non-Criteria

A package is **not** a candidate just because:

- It exists in only one instance (single data point — validate first).
- The originating maintainer asks for it (patterns earn promotion through use, not advocacy).
- It's popular in the broader ecosystem (if org-os instances don't use it, org-os doesn't need it).

## Graduating to npm Publish

A vendored framework package can graduate to a published npm package when **all three** hold:

- Stable across ≥ 3 framework releases.
- External demand exists (an org outside the federation network wants to install it).
- Someone is willing to own publishing discipline (CI publish, semver, deprecation notices).

Until all three: stay vendored.

## Related

- `docs/SKILL-PROMOTION.md` — sister doc for skills.
- `data/packages-matrix.yaml` — the registry.
- `scripts/sync-packages.mjs` — the materialization mechanism.
