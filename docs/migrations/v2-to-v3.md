# Migration: v2.x → v3.0.0

> **Version numbering: this page speaks in the legacy line (`1.x → 2.x → 3.x → 3.5`).** In 2026-06 the framework renumbered itself to `0.5` (see [VERSIONING.md](../VERSIONING.md) and `VERSION.md`), and `0.5` is *later* than `3.5`. Everything below that says "v2", "v3" or "v3.0.0" names a milestone of the old line, not a version you can download now.
>
> **Does an operator still need this page?** Almost never. It matters only for an instance that still declares `framework_version: "2.x"` (or older) and still keeps plans in `docs/agent-plans`. To bring such an instance onto the current framework, one route is `npm run sync:upstream` (step 1 below); `npm run doctor -- sync --dry-run` then `npm run doctor -- sync` is the other (see [VERSIONING.md](../VERSIONING.md)). Neither applies the frontmatter change below, so run the script in step 2 yourself. Fresh clones do not use the old `agent-plans` directory (they scaffold `docs/plans/`), and have nothing to migrate.

**Estimated time:** a few minutes. The script is idempotent: re-running changes nothing the second time.

## What changed in v3.0.0

See the full [CHANGELOG](../../CHANGELOG.md) entry. Migration-relevant summary:

- Plans in `docs/agent-plans` gained a `workstream:` frontmatter field linking them to a long-lived workstream in `data/projects.yaml`.
- Three framework-only registries were added on the framework repo (`data/instances.yaml`, `data/skills-matrix.yaml`, `data/packages-matrix.yaml`). Instances do not need them.
- Versioning was formalised: `package.json.version` is the single source of truth and `federation.yaml.metadata.framework_version` mirrors major.minor (still true, see [VERSIONING.md](../VERSIONING.md)).
- `federation.yaml` gained an optional `identity.role` field and a clarified `downstream` array format (taken from the changelog, not re-checked here).

## Who needs to act

**Required:**
- Any instance that has plans in `docs/agent-plans` and wants them to reference workstreams.

**Optional:**
- Instances that want to participate in the framework's skill-promotion workflow — add the skills matrix locally if desired (not required).

**Not affected:**
- Instances without a `docs/agent-plans` directory.
- Instances that don't run `analyze:instances` or `validate:structure`.

## Steps

From the instance repo root:

```bash
# 1. Snapshot, then bring the instance up to date with the framework
# (commit or copy aside any untracked notes first: the snapshot does not hold them)
npm run vault:snapshot -- "before v2-to-v3 migration"
npm run sync:upstream -- --yes

# 2. Run the migration script directly (if the file is missing after step 1,
#    copy it from a framework checkout: whether the sync brings it in was not verified)
node scripts/migrations/v2-to-v3-workstream-frontmatter.mjs

# 3. Review what changed
git diff docs/agent-plans

# 4. Commit if satisfied, naming the paths you changed
git add docs/agent-plans && git commit -m "chore: migrate plans to workstream frontmatter"
```

Why step 2 runs the script by hand: `npm run migrate` (`scripts/migrate.mjs`) reads each script's range from its file name, and the pre-0.5 numbering (`v2-to-v3-…`, read as `2 → 3`) and the 0.x numbering (`v0.5-to-v0.6-…`) never mix. A legacy-numbered script never runs on an instance stamped `0.x` or for a `0.x` target, and an instance still stamped `2.x` migrating to a `0.x` target is read as `0.5`. So neither `sync:upstream` nor the doctor's migrate stage (`--target 0.6`) selects it. Run it with `node` as shown.

## What the script does

`scripts/migrations/v2-to-v3-workstream-frontmatter.mjs`:

- Scans every `.md` file in `docs/agent-plans` except `QUEUE.md` and `README.md`. If `docs/agent-plans` does not exist the script stops with an error instead of skipping.
- Adds a `workstream: <inferred>` field before the closing `---` if it is missing. The inference matches the plan `id` to a built-in map of plan ids and prefixes, and falls back to `v2-stabilization`, which is probably wrong for an instance with its own workstreams: review every plan it touched.
- Flags files with no frontmatter, no `id`, or an inferred workstream that is not in `data/projects.yaml`.

## How to verify

```bash
# Every plan now has a workstream field
(cd docs/agent-plans && grep -L "^workstream:" *.md | grep -v QUEUE.md | grep -v README.md)
# (empty output = all plans migrated)

# Validation passes
npm run validate:structure
```

## Rollback

Migrations are non-destructive (additive frontmatter only). To rollback:

```bash
git checkout HEAD~1 -- docs/agent-plans
```

This overwrites the files in that directory with their previous committed state, so use it only after the migration commit and only if nothing else changed there since. Or keep the changes: the added field is plain frontmatter, and tooling that does not know it should ignore it (not tested).

## If something goes wrong

- The migration script prints every change it makes. Review the output.
- If a plan gets the wrong workstream, edit it manually. The script is idempotent — it won't touch a plan that already has the field.
- Open an issue at [github.com/regen-coordination/org-os-template](https://github.com/regen-coordination/org-os-template/issues).
