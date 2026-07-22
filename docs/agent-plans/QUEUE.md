# Plan Queue — org-os (framework)

> Last updated: 2026-07-23

## Active

1. [v0.5-release](v0.5-release.md) — Trunk repair (~230 unmerged commits), identity de-contamination, dashboard fix, green validators, v0.5.0 tag. Absorbs queue item 6 (repo-check-health) as Phase 4.

## Queued
1. [future-instance-specs](future-instance-specs.md) — Write specs for regen-coordination-os and regen-toolkit
2. [federation-protocol](federation-protocol.md) — End-to-end federation exchange testing and docs
3. **graphify-knowledge-pages** — `compile:knowledge` gains a graph source: community summaries → `knowledge/` page stubs via `graphify export --wiki`. Needs content-authority design (generated stubs must not drown curated pages). Depends on: graphify integration (shipped).
4. **graphify-knowledge-lint** — `lint:knowledge` cross-checks `knowledge/INDEX.md` against graph reality (orphaned pages, undocumented god nodes). Depends on: graphify-knowledge-pages.
5. **validate-structure-v3-audit** — audit remaining validate:structure checks against the v3.0 flat manifest format (the `federation section` drift fixed during graphify work may not be the only one).
6. **repo-check-health** — `npm run check` is currently broken independent of graphify: no `tsconfig.json` (so `tsc --noEmit` exits 1) and ~22 files fail `prettier --check`. Add a tsconfig or drop the tsc clause, and run `prettier --write` across the pre-existing offenders so `npm run check` can pass cleanly.

## Scoping
- [non-tech-onboarding](non-tech-onboarding.md) — Web wizard bootstrap + GitHub Actions backend
- [framework-dashboard-template](framework-dashboard-template.md) — Reusable dashboard package template

## Completed
- ~~[v2-phase1-framework](v2-phase1-framework.md)~~ — Framework standards, docs, skills, data model, session lifecycle
