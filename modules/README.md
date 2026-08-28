# modules/

Framework-side home of org-os **modules** — versioned units of organizational capability, each
described by a `module.yaml` manifest. See
[`docs/superpowers/specs/2026-08-02-org-os-v5-modularization-design.md`](../docs/superpowers/specs/2026-08-02-org-os-v5-modularization-design.md)
for the system design and [`docs/MODULES.md`](../docs/MODULES.md) for the operator-facing catalog.

## Current state

The module **engine** is partially built: `scripts/modules.mjs` validates manifests
(`validateManifest()`, mirrored by `schemas/module.schema.json`). Registry loading, `add`,
`adopt`, drift and health checks are v5 Phase 1–3 work and are not implemented yet. There is no
`data/modules.yaml` in any instance.

So a manifest here is, today, a **declaration**: it names a capability, its version, and the
files it owns. `tests/scripts/module-manifests.test.mjs` keeps every manifest valid and its id
matched to its directory, so the registry that Phase 1 builds will load a clean set.

## In-place modules

A module whose content already lives at canonical instance paths — an existing package, a
shipped doc — uses an **identity mapping** in `files`:

```yaml
files:
  packages/thing: packages/thing
```

Read as: *this module owns these paths where they are.* Nothing is copied. Phase 1's `adopt`
must treat an identity mapping as "already installed — checksum in place" rather than copying a
file onto itself.
