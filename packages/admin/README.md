# @org-os/admin

Local-first admin app for any org-os instance: schema-driven editing of the
`data/*.yaml` registries with comment-preserving YAML round-trip; every change
is a structured git commit. M1 of the design in
`docs/superpowers/specs/2026-07-23-admin-app-design.md`.

## Run

From an instance root:

    npm run admin        # build UI + serve on http://localhost:4680
    npm run admin:dev    # server only, tsx watch (pair with `npm run dev:app` here for HMR)

Flags: `--repo <path>` (default: invoking directory), `--port <n>` (default 4680).
Binds 127.0.0.1 only — no auth by design in v1.

## Scope (M1)

- 11 collection registries editable; `finances`, `governance`,
  `knowledge-manifest` read-only.
- Direct mode only: saves commit to the current branch as
  `admin(<registry>): <verb> <id>`. Proposals land in M3.
- Nested structures edit as YAML sub-fields.

## Test

    npm test             # vitest: server services, API, form component
