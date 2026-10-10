# Package lifecycle

How a package is registered, promoted from an instance into the framework, delivered to instances, and retired. It mirrors [Skill promotion](SKILL-PROMOTION.md) for packages. The registry is `data/packages-matrix.yaml`, a framework-only file (a cloned instance does not get it). The list of packages and what each does is in [Packages](PACKAGES.md).

Most of this is a policy that the maintainer applies by editing the matrix. Two things are enforced by code: the value of `lifecycle_status`, and the copying of enabled packages. They are marked below.

## Two status fields

Each matrix entry has `id`, `owner`, `instances_using`, `in_framework`, `notes` and two statuses.

**`lifecycle_status`**: where the package is in its life. Checked by `npm run validate:structure` (`scripts/validate-structure.mjs`, check 9): an entry without it gives a warning, and a value outside the four below fails the check.

| State | Meaning |
|---|---|
| `active` | Matrix header: used by at least one instance; maintained. Several `active` entries list no instance, so in practice it also covers active framework use. |
| `dormant` | In the framework, no instance using it. Kept as scaffolding. |
| `planned` | Approved for inclusion; not yet built, or not yet promoted from an instance. |
| `retired` | No longer maintained; consumers should migrate. |

**`promotion_status`**: how far it has got toward being framework-canonical. Values in use: `canonical`, `evaluating`, `candidate`, `instance-specific`. Unlike the skills matrix, no script validates this field for packages, so a typo passes.

Current counts (`data/packages-matrix.yaml`, 27 entries): by lifecycle, 19 active, 6 dormant, 2 planned, 0 retired; by promotion, 13 canonical, 7 evaluating, 6 instance-specific, 1 candidate. Three directories under `packages/` have no entry: `admin`, `cloudflare-os-integration`, `multica-bridge`. The `dashboard` entry says `in_framework: false` and is owned by an instance, but `packages/dashboard/` exists in the framework. In the other direction, eight entries have no directory under `packages/` (`governance`, `coordination`, `connectors`, `core`, `maps`, `hub`, `coop`, `regen-toolkit`; all `in_framework: false`), so 27 entries sit against 22 directories.

## Promotion criteria (instance-originated to framework-canonical)

A package becomes a **promotion candidate** when:

1. Two or more instances use it independently.
2. The pattern applies to other kinds of organisation, not to one organisation's quirks.
3. The originating instance's owner agrees to hand over maintenance.

`npm run analyze:instances` lists package directories an instance has that the matrix does not know (`unmapped_package`), which is how a new candidate surfaces. It needs the instance repositories checked out beside this one. The only candidate in the matrix today is `dashboard`.

## Promotion workflow

1. In `data/packages-matrix.yaml`, set `promotion_status: candidate`, then `canonical` after review.
2. Copy the package source from the originating instance into `packages/<id>/` in the framework.
3. Set `owner: framework` and `in_framework: true`.
4. Make it available to opt in: an instance enables it with `<id>: true` under `packages:` in its `federation.yaml`.
5. Set `lifecycle_status: active` once at least one instance consumes the canonical version.
6. Document it in [Packages](PACKAGES.md) if it is not obvious from its README.

On promotion the originating instance becomes a consumer: the framework owns maintenance, pull requests land in the framework repository, and the instance's local `packages/<id>/` is replaced by the framework copy on its next `sync:packages`.

## Delivery to instances (vendored, copied)

Packages are vendored, not installed from a registry. There are two paths.

1. **Clone.** `npm run clone:framework` takes the `packages:` map from the clone config and removes every directory under the new instance's `packages/` that is not set to `true` (`scripts/clone-framework.mjs`, stage 5). It writes the same map into the new instance's `federation.yaml`.
2. **Sync.** `npm run sync:packages` (`scripts/sync-packages.mjs`) reads `packages:` from the instance's `federation.yaml` and copies each package set to `true` from the framework's `packages/<id>/` into the instance. A package present locally but not enabled is reported with a warning and left alone; `--prune` removes it; `--dry` writes nothing; `--framework <dir>` and `--target <dir>` choose the two ends; `--enabled a,b` replaces the federation map. Its test is `tests/sync-packages.test.mjs` (five tests, passing). `npm run sync:upstream` runs this as one of its stages.

The key under `packages:` has to be a directory name directly under the framework's `packages/`. `sync-packages` exits with an error for an id that is not one. The `packages:` map in this repository's `federation.yaml` has `knowledge_base: true`, which is not such a directory, so `npm run sync:packages` run against it today stops with `Package "knowledge_base" enabled but not in framework`. The other keys there (`meetings`, `projects`, `finances`, `coordination`, `webapps`, `web3`, `egregore`) are `false`; only `webapps` matches a directory, and enabling any of the rest fails the same way (checked with `--enabled` against a scratch directory). `npm run setup` still writes these keys. The meetings and projects templates live at `packages/operations/meetings` and `packages/operations/projects`, inside the `operations` package.

There is no version pin per package. `metadata.framework_version` in `federation.yaml` records which framework version an instance was cloned or synced from; nothing resolves a package version from it.

## Retirement

The criteria are policy; no script applies them:

- No instance using a package for six months: set `lifecycle_status: dormant`.
- Dormant with no planned use: set `lifecycle_status: retired`.
- A retired package stays in the repository for its history. Nothing stops a new instance from enabling it; the matrix is advice to the maintainer.

The matrix has no retired package today.

## Graduating to npm

Stay vendored until all three hold: the package has been stable across at least three framework releases, someone outside the federation wants to install it, and someone will own the publishing discipline (CI publish, semver, deprecation notices). Several packages carry an `@org-os/…` name in their `package.json`; this page does not claim any of them is on npm.

## Related

- [Skill promotion](SKILL-PROMOTION.md): the sister page for skills.
- `data/packages-matrix.yaml`: the registry.
- `scripts/sync-packages.mjs`: the copying mechanism.
- `scripts/check-divergence.mjs`: advisory comparison of an instance's `scripts/` with the framework's; it does not look at packages.
