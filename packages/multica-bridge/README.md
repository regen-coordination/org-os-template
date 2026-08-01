# @org-os/multica-bridge

Integration between [multica](https://github.com/multica-ai/multica) and this
org-os instance. Spec: `docs/superpowers/specs/2026-07-24-multica-org-os-integration-design.md`.

**Phase 1 (this package today):** the "org-os operator" — a multica agent
persona (`personas/org-os-operator.md`) that executes multica issues inside
this repo on the `claude` runtime, bound via a `local_directory` project
resource. Setup runbook: `docs/SETUP.md`.

**Phase 2 (planned):** `npm run multica:sync` — projects `data/*.yaml`,
skills, and heartbeat cron into multica (issues, skills, autopilots) and
reconciles changes back. Yaml + git stay canonical.

## Safety model

- Repo `.claude/settings.json` wires a `PreToolUse` guard
  (`scripts/guards/deny-destructive-git.mjs`) that inspects the actual Bash
  command string and blocks `git stash` / `git clean` / `git reset --hard` for
  every Claude session in this repo, regardless of flag order or inserted git
  global options (vault-safety). The `permissions.deny` entries beside it are
  prefix matches — cheap defense-in-depth, bypassable on their own, which is
  why the guard exists.
- `scripts/git-hooks/pre-push` refuses to push `agent/*` branches — operator
  work is merged locally after human review, never published by the agent.
  Install both hooks with `npm run install:hooks`.
- The persona mandates draft-and-present for anything external.

## Tests

`npm test` (from this directory) — persona lint, settings guard, hook behavior.
