# Migration: v2.x → v3.0.0

**Target audience:** any org-os instance running framework v2.x.

**Estimated time:** 5 minutes. Idempotent — safe to re-run.

## What changed in v3.0.0

See the full [CHANGELOG](../../CHANGELOG.md) entry. Migration-relevant summary:

- Plans in `docs/agent-plans/` gained a `workstream:` frontmatter field linking them to a long-lived workstream in `data/projects.yaml`.
- Three new framework-only registries exist on the framework repo (`data/instances.yaml`, `data/skills-matrix.yaml`, `data/packages-matrix.yaml`). **Instances do NOT need these** — they live on the framework/hub only.
- Versioning system formalized. `package.json.version` is the single source of truth; `federation.yaml.metadata.framework_version` mirrors major.minor.
- `federation.yaml` schema: `identity.role` field added (optional for instances); `downstream` array format clarified.

## Who needs to act

**Required:**
- Any instance that has plans in `docs/agent-plans/` and wants them to reference workstreams.

**Optional:**
- Instances that want to participate in the framework's skill-promotion workflow — add the skills matrix locally if desired (not required).

**Not affected:**
- Instances without a `docs/agent-plans/` directory.
- Instances that don't run `analyze:instances` or `validate:structure`.

## Steps

From the instance repo root:

```bash
# 1. Pull latest from the framework upstream
npm run sync:upstream

# 2. Run migrations (idempotent)
npm run migrate

# 3. Review what changed
git diff docs/agent-plans/

# 4. Commit if satisfied
git add -A && git commit -m "chore: migrate to framework v3.0.0"
```

## What `npm run migrate` does

1. Reads current framework version from `package.json` (code) and instance framework version from `federation.yaml.metadata.framework_version`.
2. Runs every migration script in `scripts/migrations/` whose version range applies.
3. For v2→v3, that's `v2-to-v3-workstream-frontmatter.mjs`:
   - Scans every `docs/agent-plans/*.md`.
   - Adds `workstream: <inferred>` frontmatter field if missing.
   - Flags any file where the inference is uncertain for operator review.

## How to verify

```bash
# Every plan now has a workstream field
grep -L "^workstream:" docs/agent-plans/*.md | grep -v QUEUE.md | grep -v README.md
# (empty output = all plans migrated)

# Validation passes
npm run validate:structure
```

## Rollback

Migrations are non-destructive (additive frontmatter only). To rollback:

```bash
git checkout HEAD~1 -- docs/agent-plans/
```

Or keep the changes — they don't break anything on a v2.x framework. Plans with an unknown `workstream` field are silently ignored by older tooling.

## If something goes wrong

- The migration script prints every change it makes. Review the output.
- If a plan gets the wrong workstream, edit it manually. The script is idempotent — it won't touch a plan that already has the field.
- Open an issue at `github.com/regen-coordination/org-os-template`.
