# Berd Integration

**Module:** `org-os-berd`, catalogued `pilot` ([manifest](../../modules/org-os-berd/module.yaml), [catalogue entry](../MODULES.md)). Built and partly verified; not in production use. Design: [Berd integration design](../superpowers/specs/2026-08-28-berd-integration-design.md).

[Berd](https://github.com/block/berd) is Block's open-source desktop app for working with AI agents; per the maintainer's notes it is a Tauri client over a Goose backend (upstream claim, not checked here). When a project is open, Berd discovers project-local agent personas in `.agents/agents/` and agent skills in `.agents/skills/`. This module puts org-os content in both places, so a Berd/Goose agent opened on an instance works with the instance's own personas and skills.

## What is verified, and what is not

| Level | State |
|---|---|
| Built | Personas, the skills bridge, its drift check and its tests exist in the repository. |
| Verified against a live service | Personas: opening an instance as a Berd project auto-discovered `.agents/agents/operator.md` and `upstream.md` (2026-08-20). Skills: `goosed skills list`, run from the repository root against the `goosed` binary bundled inside Berd.app, found all five bridged skills at `.agents/skills/<name>` with parsed frontmatter and non-zero token counts (2026-08-29, Berd v0.6.2). |
| Exercised for real work | Not done. No bridged skill has been invoked under Goose to do real work, no full session (initialize, work, close) has been driven from Berd, and the Berd GUI's own Skills panel has not been observed showing these skills. The tracker is `HEARTBEAT.md`, "Berd bridge dogfood acceptance". |
| In production use | No. The module stays `pilot` until that tracker completes. |

The live checks were run by the maintainer on their own machine; this page was checked against the repository on this branch, and the checks above that need Berd were not re-run.

## What it connects to

- **Berd**, a desktop app installed on the operator's machine. Nothing in the repository installs it.
- The **Goose backend** Berd bundles. The Goose commit it pins changes between Berd releases (upstream claim, not checked here).

Outside the repository you need Berd installed and the instance opened as a Berd project. Per Berd's own policy as the maintainer recorded it, outside pull requests are not taken and participation is by issue (not checked here).

## Commands

```bash
npm run sync:agents                        # mirror .agents/agents/*.md to ~/.agents/agents/
npm run sync:skills:berd                   # materialize the five curated skills into .agents/skills/
npm run sync:skills:berd -- --check        # drift gate: in-sync / drift / missing per skill, exit 1 on drift
npm run sync:skills:berd -- --dry-run      # preview a run
npm run sync:skills:berd -- --adopt        # take over a target directory that is not a managed mirror
```

`sync:agents` also accepts `--dry-run` and `--adopt`. It writes outside the repository, to `~/.agents/agents/`; the skills sync writes only inside it.

## What it writes and where

**Personas.** `.agents/agents/operator.md` and `upstream.md` are the canonical copies, tracked in the repository. `scripts/sync-agents.mjs` copies them one way to `~/.agents/agents/` so they also work when no project, or another project, is open. It overwrites a target only when its frontmatter carries `managed_by: org-os`, never touches an agent listed in Berd's `.berd-bundled-agents.json`, and skips hand-authored files unless `--adopt` is passed. Every canonical persona must itself carry `managed_by: org-os`, `name` and `description`. See [Agentic architecture](../AGENTIC-ARCHITECTURE.md) for the personas.

**Skills.** `scripts/sync-skills-berd.mjs` copies a curated set of `skills/<name>/` directories to `.agents/skills/<name>/`, byte for byte (permission bits included; a symlink is an error), except that `SKILL.md` gains one line, `managed_by: org-os`, before the closing frontmatter fence. That marker is the permission to overwrite on later runs. A target directory that holds files and is not a managed mirror is left alone unless `--adopt` is passed. `.agents/skills/feynman/` is hand-authored, carries no marker and is never touched.

**The curated list lives in the manifest.** The entries of `modules/org-os-berd/module.yaml` that map `skills/<name>` to `.agents/skills/<name>` are the list the script reads. Today it holds five skills: `org-os-init`, `meeting-processor`, `heartbeat-monitor`, `knowledge-curator`, `funding-scout`. To bridge another skill or remove one, edit the manifest and re-run the sync. The manifest's own comment says only Goose-verified skills belong in the list; the five are discovery-verified but none has been exercised under Goose, so the list runs ahead of its own rule.

## Day to day

- **Edit the canonical skill, never the mirror.** After changing anything under `skills/<name>/`, run `npm run sync:skills:berd` and commit both sides. A run with nothing to do reports `unchanged`. A hand edit to a managed mirror is replaced by the next sync.
- **The drift gate.** `--check` recomputes the expected mirror in memory (bytes, permission bits, exact file set, marker present), compares, and exits 1 on any `drift` or `missing`; hand-authored targets are reported and ignored. It runs as one of the module's checks in `module.yaml` and as an optional step in `npm run selftest` (skipped when the script or manifest is absent). A red result means one side was edited without syncing: sync, then commit. On this branch it reports all five skills `in-sync`.
- **Run gate suites from the primary checkout, not a git worktree.** `HEARTBEAT.md` records a known issue: `analyze-instances.mjs`, which `selftest` runs, overwrites the tracked drift report with placeholders when run from a worktree.
- **Running a session from Berd.** Open the instance as a Berd project; the personas and the five skills are discovered. `org-os-init` carries the full session lifecycle (dashboard, plan, execute, close) and both Buzz hooks (see [Buzz](buzz.md)), so a Goose-driven session is meant to land in the same memory, `HEARTBEAT.md`, commit and Buzz loop as any other. That has not been demonstrated.
- **Discovery probe.** To see what Goose finds, run `goosed skills list` from the instance root, using the `goosed` binary inside the installed Berd.app.

## Why `.agents/skills/`

Recorded from reading Berd and Goose source on 2026-08-29, and not re-read in this pass: Berd's native scanner and Goose's own skill loader each treat `.agents/skills/` as the project-local skills path, and Goose lists it ahead of `.goose/skills/` and `.claude/skills/`. The live `goosed skills list` run above is the empirical confirmation. One caveat from the same reading: the third-party `npx skills add` command installs Berd's published skills into `.goose/skills/`, a backward-compatible location that is still found but is not the recommended one.

## Re-verifying

On any Berd minor release, or a change to the Goose commit pinned in Berd's `goose-backend.lock.json`, re-run `goosed skills list` and re-check Goose's skill-discovery documentation for the directory order.
