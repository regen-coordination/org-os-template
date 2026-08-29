# Berd Integration — Agent Surfaces

**Status:** agents dir verified live (2026-08-20) · skills dir verified from source/docs only (2026-08-29), live GUI confirmation **PENDING OPERATOR**
**Spec:** [`docs/superpowers/specs/2026-08-28-berd-integration-design.md`](../superpowers/specs/2026-08-28-berd-integration-design.md)
**Pinned:** Berd v0.6.2 (satisfies the design spec's ≥ v0.6.0 floor) · Goose commit `063694cf7` (2026-08-17, per Berd's own `goose-backend.lock.json` at tag `v0.6.2`)

## What Berd is

[Berd](https://github.com/block/berd) is Block's open-source desktop app for getting work done with AI agents (open-sourced 2026-08-19, Apache 2.0). It's a Tauri 2 + React 19 client over a Goose backend sidecar (`goose serve`, ACP WebSocket); Goose itself is pinned via `goose-backend.lock.json`. Berd auto-discovers project-local Agent Markdown under `.agents/agents/` when a project is open, publishes portable Agent Skills (e.g. `buzz-handoff`, which bridges Buzz channel context into agent conversations), and supports enterprise "distribution seams." Outside PRs are auto-closed — participation is issues-only.

## Verified surfaces

### Agents dir — `.agents/agents/` (verified live, 2026-08-20)

Confirmed by opening this repo as a Berd project: `.agents/agents/{operator,upstream}.md` are auto-discovered as Berd's project-local Agent Markdown. Canonical in-repo; `npm run sync:agents` (`scripts/sync-agents.mjs`) mirrors them one-way to `~/.agents/agents/`, marker-guarded on `managed_by: org-os`. See `DECISIONS.md` § "2026-08-20 · Berd personas are framework files" and `docs/AGENTIC-ARCHITECTURE.md` § "Berd Personas".

### Skills dir — `.agents/skills/` (verified from source/docs only, 2026-08-29 — live GUI confirmation PENDING OPERATOR)

**Finding: `.agents/skills/` is confirmed as the project-local Agent Skills discovery path, by two independent implementations that agree — but neither confirmation comes from opening this repo in the Berd app.**

**1. Berd's own native scanner** (the stronger, Berd-specific evidence — this is not Goose, it's Berd's Tauri layer): `src-tauri/src/commands/agent_skills.rs`.

- `provider_skill_dirs(provider_id)` maps a backend "provider family" to the directory names it scans: Claude → `.agents/skills` + `.claude/skills`; Codex → `.agents/skills` + `.codex/skills`; Gemini → `.gemini/skills` + `.agents/skills`; **`Standard` (the default/fallback family, i.e. Goose) → `.agents/skills` only.**
- `find_git_root` + `workspace_search_dirs` walk every directory from the opened workspace path's **git root down to the workspace path itself**, and `collect_skill_roots` joins each of those directories with the provider's skill-dir name(s), tagging every hit `SkillRootScope::Workspace` / `source_kind: "project"` — the highest-priority source (`skill_source_priority`: `"project" => 0`, ahead of `"global"` and `"app"`).
- This is exercised by the Tauri command `list_agent_skills`, which is what a Berd window calls to populate its own Skills UI (`src/features/skills/ui/SkillsGrid.tsx`, the search index, home-pin widgets). Its own test suite (`#[cfg(test)] mod tests`) constructs `.agents/skills/` fixtures under a fake git root and workspace subdirectory and asserts they're discovered (`lists_agents_skills_from_git_root_to_workspace`), including negative tests that reject symlinked skill directories/roots for safety.
- Berd's own repo dogfoods the same path for its contributor workflows: `.agents/skills/{assistive-ux,berdctl-new-command,code-review,create-pr,experimental-features}/`, referenced from its own `AGENTS.md` (e.g. "use `.agents/skills/experimental-features/SKILL.md` before adding..."). That's distinct from Berd's separately-published, portable `skills/` directory (installed via `npx skills add block/berd --skill <name>`) — but it's the same generic surface any opened project uses, not something contributor-only.

**2. Goose's own discovery** (a second, independent implementation — this is what actually decides what the LLM sees in-context, separate from Berd's UI lister above): documented at `documentation/docs/guides/context-engineering/using-skills.md` and implemented at `crates/goose/src/skills/mod.rs`, function `all_skill_dirs_with_config`, in the repo `aaif-goose/goose` (formerly `block/goose` — GitHub now redirects that path to the new org). Docs: "`.agents/skills/` — Project-level skills, scoped to the current project... Backward compatibility: goose also discovers skills from `.goose/skills/`, `.claude/skills/`, `~/.claude/skills/`... but `agents/skills/` is the recommended standard." Source, in literal discovery order (doc comment: "project dirs first, then global dirs"): `wd.join(".agents").join("skills")`, then `wd.join(".goose").join("skills")`, then `wd.join(".claude").join("skills")`.

- **Version alignment:** Berd `v0.6.2`'s `goose-backend.lock.json` pins Goose commit `063694cf769269c1f151416605687991fdcbc496` (2026-08-17) — between Goose `v1.46.0` (2026-08-12) and `v1.47.0` (2026-08-21), well after `v1.25.0` (2026-02-23), the release that made this built-in "Skills platform extension" (not the older, now-deprecated MCP "Skills extension" at `docs/mcp/skills-mcp.md`) the active mechanism. The pinned backend runs the code path quoted above, not the deprecated one.

Berd's UI-facing scanner and Goose's context-loading scanner are two separate Rust implementations, in two separate repos, that happen to converge on `.agents/skills/` for the default case. That convergence is the strongest evidence available short of opening the app — but it is still a source-level inference, not a runtime observation.

**One documented discrepancy, noted for honesty, not hidden:** Berd's `skills/README.md` points contributors at the third-party `npx skills add` CLI ([`vercel-labs/skills`](https://github.com/vercel-labs/skills)) to install published skills. That CLI's own source (`src/skills.ts`, `src/blob.ts`) targets `.goose/skills/` — the backward-compatibility path in both scanners above — as Goose's project-local install location, not `.agents/skills/`. Both scanners still find a skill installed there (it's second in each one's search order), it just isn't the recommended/highest-priority location. This repo's existing `.agents/skills/feynman/*` (hand-placed, no `managed_by` marker) already uses the recommended path.

**What is NOT verified:** whether this repo, opened as a workspace in the actual Berd desktop app, shows `.agents/skills/feynman/*` in its Skills UI and makes them loadable in a live session. Both code paths above say it should; confirming it end-to-end requires opening this repo in the Berd desktop GUI — deferred to the operator (Step 2 of the design spec's build task 1).

## The bridge

The design spec's module #4, `org-os-berd` (`modules/org-os-berd/module.yaml`, not yet built), will wrap the shipped personas layer plus a curated skills bridge: `scripts/sync-skills-berd.mjs` and `npm run sync:skills:berd` materialize a curated subset of `skills/` into `.agents/skills/<name>/` as committed, marker-guarded copies — the same one-way, `managed_by: org-os` pattern `sync-agents.mjs` already uses for `.agents/agents/`. This doc's verified path (`.agents/skills/`) is the copy target that bridge writes to; the manifest's exposure list and any `DEFAULT_TARGET` constant in the sync script should point here.

## Re-verification note

Berd ships frequently (three releases, v0.6.0 → v0.6.2, in four days as of this writing) and wraps a separately-versioned Goose backend. On any Berd minor bump — or any bump of the pinned Goose commit in `goose-backend.lock.json` — re-run this task's steps: re-check `documentation/docs/guides/context-engineering/using-skills.md` and `crates/goose/src/skills/mod.rs` in whatever repo `goose-backend.lock.json` names (currently `aaif-goose/goose`) for the discovery path and order, and re-run the live GUI confirmation (Step 2) against the new pin.
