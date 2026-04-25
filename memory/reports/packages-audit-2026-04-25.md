# Package Audit — 2026-04-25

**Generated:** 2026-04-25
**Source of truth audited:** `data/packages-matrix.yaml` (14 packages)
**Cross-checked against:** `data/instances.yaml` (5 instances) and `packages/` directory

## Inventory

| Package | Owner | In framework | Instances using (matrix) | Promotion status | Lifecycle (recommended) |
|---|---|---|---|---|---|
| agents-app | framework | true | [] | canonical | dormant |
| egregore-core | framework | true | [] | canonical | dormant |
| koi-bridge | framework | true | [] | canonical | dormant |
| koi-opal-bridge | framework | true | [] | canonical | dormant |
| opal-bridge | framework | true | [] | canonical | dormant |
| operations | framework | true | [refi-bcn-os, refi-dao-os] | canonical | active |
| paperclip-agents-app | framework | true | [] | canonical | dormant |
| regen-agents | framework | true | [refi-bcn-os, refi-dao-os] | canonical | active |
| webapps | framework | true | [refi-bcn-os, refi-dao-os] | canonical | active |
| dashboard | refi-bcn-os | false | [refi-bcn-os, refi-dao-os] | candidate | active (promote) |
| governance | refi-dao-os | false | [refi-dao-os] | evaluating | active |
| coordination | refi-dao-os | false | [refi-dao-os] | evaluating | active |
| connectors | dao-os | false | [dao-os] | instance-specific | active |
| core | dao-os | false | [dao-os] | instance-specific | active |

NOTE: lifecycle "dormant" applied where matrix declares zero `instances_using` AND `in_framework: true` — these are scaffolding kept warm for the federation. After cross-checking instance manifests (next section), several of these turn out to actually be used by `regen-coordination-os` and should be re-classified `active` once the matrix is corrected.

## Discrepancies

Cross-check of `data/packages-matrix.yaml.instances_using` vs `data/instances.yaml.<instance>.packages`:

### Matrix under-reports `regen-coordination-os` adoption
`regen-coordination-os` lists **12 packages** in `data/instances.yaml`, but the matrix does not reflect this anywhere:

| Package | Matrix `instances_using` | Actually used by |
|---|---|---|
| agents-app | [] | regen-coordination-os |
| egregore-core | [] | regen-coordination-os |
| koi-bridge | [] | regen-coordination-os |
| koi-opal-bridge | [] | regen-coordination-os |
| opal-bridge | [] | regen-coordination-os |
| paperclip-agents-app | [] | regen-coordination-os |
| operations | [refi-bcn-os, refi-dao-os] | + regen-coordination-os |
| regen-agents | [refi-bcn-os, refi-dao-os] | + regen-coordination-os |
| webapps | [refi-bcn-os, refi-dao-os] | + regen-coordination-os |
| dashboard | [refi-bcn-os, refi-dao-os] | + regen-coordination-os |

Root cause: `regen-coordination-os` was synced to framework v3.0 on 2026-04-24 (per `data/instances.yaml` notes) and inherited the full overlay; the matrix `instances_using` arrays were not updated to reflect this third consumer.

### Packages missing from matrix entirely
`regen-coordination-os` lists two packages that have **no entry** in `data/packages-matrix.yaml`:

- `coop` — present in `regen-coordination-os.packages` but no matrix row
- `regen-toolkit` — present in `regen-coordination-os.packages` but no matrix row

These need to be added to the matrix (Task 8) with appropriate owner/promotion classification, OR removed from the instance manifest if they are no longer real packages. Note `npm run analyze:instances` would normally surface these as `unmapped_packages`, but instance scanning currently fails from this worktree (`local_path_missing`) so the drift report shows clean.

### Other instances
- `refi-bcn-os.packages` ≡ matrix expectation — no drift
- `refi-dao-os.packages` ≡ matrix expectation — no drift
- `dao-os.packages` ≡ matrix expectation — no drift
- `openclaw.packages` is `[]` — no drift

## Physical existence check

All 9 packages with `in_framework: true` have a directory under `packages/`:

- packages/agents-app — present
- packages/egregore-core — present
- packages/koi-bridge — present
- packages/koi-opal-bridge — present
- packages/opal-bridge — present
- packages/operations — present
- packages/paperclip-agents-app — present
- packages/regen-agents — present
- packages/webapps — present

The 5 packages with `in_framework: false` (`dashboard`, `governance`, `coordination`, `connectors`, `core`) correctly have no framework directory.

## Retirement candidates

Packages with `instances_using: []` in matrix (per the matrix's current view):
- `agents-app`
- `egregore-core`
- `koi-bridge`
- `koi-opal-bridge`
- `opal-bridge`
- `paperclip-agents-app`

**However, after the discrepancy correction above, ALL six are actually consumed by `regen-coordination-os`.** Once the matrix is updated, **none of the framework packages should be retired**. The only true retirement candidates are zero — nothing in the matrix is unused.

## Recommendations

Per-package action items, intended as input to Task 8 (apply `lifecycle_status` to `data/packages-matrix.yaml`):

| Package | Action | `lifecycle_status` to apply | Notes |
|---|---|---|---|
| agents-app | keep | active | Update `instances_using` to include `regen-coordination-os` |
| egregore-core | keep | active | Update `instances_using` to include `regen-coordination-os` |
| koi-bridge | keep | active | Update `instances_using` to include `regen-coordination-os` |
| koi-opal-bridge | keep | active | Update `instances_using` to include `regen-coordination-os` |
| opal-bridge | keep | active | Update `instances_using` to include `regen-coordination-os`; opal-rollout workstream |
| operations | keep | active | Update `instances_using` to include `regen-coordination-os` |
| paperclip-agents-app | keep | active | Update `instances_using` to include `regen-coordination-os` |
| regen-agents | keep | active | Update `instances_using` to include `regen-coordination-os` |
| webapps | keep | active | Update `instances_using` to include `regen-coordination-os` |
| dashboard | promote | active | Used by 3 instances; promotion plan exists (`framework-dashboard-template`). Move to `in_framework: true` and flip `promotion_status: canonical`. Update `instances_using`. |
| governance | keep (evaluate) | active | Single-instance; evaluate jointly with dao-os DAO-module skills before promoting |
| coordination | keep (evaluate) | active | Single-instance; assess generalizability |
| connectors | keep | active | DAO-OS platform-specific; not a promotion target (the DAO-module skills are) |
| core | keep | active | DAO-OS platform-specific; not a promotion target |
| **coop** (missing from matrix) | add | active or planned | Add row with owner=`regen-coordination-os` and `instances_using: [regen-coordination-os]` — OR remove from `regen-coordination-os.packages` if obsolete |
| **regen-toolkit** (missing from matrix) | add | active or planned | Same treatment as `coop` |

### Summary recommendations for Task 8
1. Add `lifecycle_status` field to every package row.
2. Update `instances_using` for 10 packages to include `regen-coordination-os`.
3. Add two missing rows: `coop`, `regen-toolkit` (or scrub from instance manifest).
4. Promote `dashboard` to framework in a follow-up task (out of scope for the matrix patch; tracked separately).
5. No packages are candidates for `retired` lifecycle today.
