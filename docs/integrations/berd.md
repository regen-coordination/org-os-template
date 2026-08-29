# Berd Integration — Agent Surfaces

**Status:** agents dir verified live (2026-08-20) · skills dir discovery verified live 2026-08-29 via `goosed skills list` (see "Verified 2026-08-29" below) — supersedes the source/docs-only PENDING-OPERATOR marker for _discovery_; exercising a bridged skill under Goose to do real work is still unverified
**Spec:** [`docs/superpowers/specs/2026-08-28-berd-integration-design.md`](../superpowers/specs/2026-08-28-berd-integration-design.md)
**Pinned:** Berd v0.6.2 (satisfies the design spec's ≥ v0.6.0 floor) · Goose commit `063694cf7` (2026-08-17, per Berd's own `goose-backend.lock.json` at tag `v0.6.2`)

## What Berd is

[Berd](https://github.com/block/berd) is Block's open-source desktop app for getting work done with AI agents (open-sourced 2026-08-19, Apache 2.0). It's a Tauri 2 + React 19 client over a Goose backend sidecar (`goose serve`, ACP WebSocket); Goose itself is pinned via `goose-backend.lock.json`. Berd auto-discovers project-local Agent Markdown under `.agents/agents/` when a project is open, publishes portable Agent Skills (e.g. `buzz-handoff`, which bridges Buzz channel context into agent conversations), and supports enterprise "distribution seams." Outside PRs are auto-closed — participation is issues-only.

## Verified surfaces

### Agents dir — `.agents/agents/` (verified live, 2026-08-20)

Confirmed by opening this repo as a Berd project: `.agents/agents/{operator,upstream}.md` are auto-discovered as Berd's project-local Agent Markdown. Canonical in-repo; `npm run sync:agents` (`scripts/sync-agents.mjs`) mirrors them one-way to `~/.agents/agents/`, marker-guarded on `managed_by: org-os`. See `DECISIONS.md` § "2026-08-20 · Berd personas are framework files" and `docs/AGENTIC-ARCHITECTURE.md` § "Berd Personas".

### Skills dir — `.agents/skills/` (source/docs verified 2026-08-29; live discovery verified 2026-08-29 — see "Verified 2026-08-29" below)

**Finding: `.agents/skills/` is confirmed as the project-local Agent Skills discovery path, by two independent implementations that agree — but neither confirmation comes from opening this repo in the Berd app.**

**1. Berd's own native scanner** (the stronger, Berd-specific evidence — this is not Goose, it's Berd's Tauri layer): `src-tauri/src/commands/agent_skills.rs`.

- `provider_skill_dirs(provider_id)` maps a backend "provider family" to the directory names it scans: Claude → `.agents/skills` + `.claude/skills`; Codex → `.agents/skills` + `.codex/skills`; Gemini → `.gemini/skills` + `.agents/skills`; **`Standard` (the default/fallback family, i.e. Goose) → `.agents/skills` only.**
- `find_git_root` + `workspace_search_dirs` walk every directory from the opened workspace path's **git root down to the workspace path itself**, and `collect_skill_roots` joins each of those directories with the provider's skill-dir name(s), tagging every hit `SkillRootScope::Workspace` / `source_kind: "project"` — the highest-priority source (`skill_source_priority`: `"project" => 0`, ahead of `"global"` and `"app"`).
- This is exercised by the Tauri command `list_agent_skills`, which is what a Berd window calls to populate its own Skills UI (`src/features/skills/ui/SkillsGrid.tsx`, the search index, home-pin widgets). Its own test suite (`#[cfg(test)] mod tests`) constructs `.agents/skills/` fixtures under a fake git root and workspace subdirectory and asserts they're discovered (`lists_agents_skills_from_git_root_to_workspace`), including negative tests that reject symlinked skill directories/roots for safety.
- Berd's own repo dogfoods the same path for its contributor workflows: `.agents/skills/{assistive-ux,berdctl-new-command,code-review,create-pr,experimental-features}/`, referenced from its own `AGENTS.md` (e.g. "use `.agents/skills/experimental-features/SKILL.md` before adding..."). That's distinct from Berd's separately-published, portable `skills/` directory (installed via `npx skills add block/berd --skill <name>`) — but it's the same generic surface any opened project uses, not something contributor-only.

**2. Goose's own discovery** (a second, independent implementation — this is what actually decides what the LLM sees in-context, separate from Berd's UI lister above): documented at `documentation/docs/guides/context-engineering/using-skills.md` and implemented at `crates/goose/src/skills/mod.rs`, function `all_skill_dirs_with_config`, in the repo `aaif-goose/goose` (formerly `block/goose` — GitHub now redirects that path to the new org). Docs: "`.agents/skills/` — Project-level skills, scoped to the current project... Backward compatibility: goose also discovers skills from `.goose/skills/`, `.claude/skills/`, `~/.claude/skills/`... but `agents/skills/` is the recommended standard." Source, in literal discovery order (doc comment: "project dirs first, then global dirs"): `wd.join(".agents").join("skills")`, then `wd.join(".goose").join("skills")`, then `wd.join(".claude").join("skills")`.

- **Version alignment:** Berd `v0.6.2`'s `goose-backend.lock.json` pins Goose commit `063694cf769269c1f151416605687991fdcbc496` (2026-08-17) — between Goose `v1.46.0` (2026-08-12) and `v1.47.0` (2026-08-21), well after `v1.25.0` (2026-02-18), the release that made this built-in "Skills platform extension" (not the older, now-deprecated MCP "Skills extension" at `docs/mcp/skills-mcp.md`) the active mechanism. The pinned backend runs the code path quoted above, not the deprecated one.

Berd's UI-facing scanner and Goose's context-loading scanner are two separate Rust implementations, in two separate repos, that happen to converge on `.agents/skills/` for the default case. That convergence is the strongest evidence available short of opening the app — but it is still a source-level inference, not a runtime observation.

**One documented discrepancy, noted for honesty, not hidden:** Berd's `skills/README.md` points contributors at the third-party `npx skills add` CLI ([`vercel-labs/skills`](https://github.com/vercel-labs/skills)) to install published skills. That CLI's own source (`src/skills.ts`, `src/blob.ts`) targets `.goose/skills/` — the backward-compatibility path in both scanners above — as Goose's project-local install location, not `.agents/skills/`. Both scanners still find a skill installed there (it's second in each one's search order), it just isn't the recommended/highest-priority location. This repo's existing `.agents/skills/feynman/*` (hand-placed, no `managed_by` marker) already uses the recommended path.

**What is NOT verified:** functional exercise under Goose. `goosed skills list` (see "Verified 2026-08-29" below) confirms discovery and parsing empirically — the five bridged skills plus `feynman` are found and parsed with real, non-zero token counts — but no agent has actually invoked one of them under Goose to do work, and no one has opened this repo in the Berd desktop GUI to confirm the Skills UI itself renders them. Both remain open; see `HEARTBEAT.md`'s Berd dogfood-acceptance tracker.

## Verified 2026-08-29 — live discovery confirmation

`/Applications/Berd.app/Contents/MacOS/goosed skills list`, run from the repo root against
Berd's own bundled `goosed` binary (the actual runtime, not source-level inference), discovered
**all five** bridged skills at their `.agents/skills/<name>` paths — `funding-scout`,
`heartbeat-monitor`, `knowledge-curator`, `meeting-processor`, `org-os-init` — each with parsed
frontmatter and non-zero description/content token counts, confirming Goose parsed them
successfully rather than merely listing the directory. The 19 hand-authored `feynman`
sub-skills were discovered too and are untouched by the bridge. Evidence captured at
`/tmp/goose-skills.txt`.

This is stronger evidence than the live-GUI check this doc originally deferred to the operator
(Step 2 of the design spec's build task 1) — it exercises Berd's actual bundled Goose backend
directly, not a UI screenshot — and it **supersedes the PENDING-OPERATOR marker above for
discovery**. It does **not** supersede it for functional use: no agent has invoked a bridged
skill under Goose to do real work, so that half of Step 2, and the plan's Task 5 pruning pass
that depends on it, remain open (see `HEARTBEAT.md`'s Berd dogfood-acceptance tracker).

## The bridge

The design spec's module #4, `org-os-berd` (`modules/org-os-berd/module.yaml`), is built and catalogued `pilot`: it wraps the shipped personas layer plus a curated skills bridge — `scripts/sync-skills-berd.mjs` and `npm run sync:skills:berd` materialize a curated subset of `skills/` into `.agents/skills/<name>/` as committed, marker-guarded copies, the same one-way, `managed_by: org-os` pattern `sync-agents.mjs` already uses for `.agents/agents/`. This doc's verified path (`.agents/skills/`) is the copy target that bridge writes to; the manifest's exposure list points here. Discovery is now confirmed live (`goosed skills list`, above); what remains open is functional exercise, not discovery: no materialized skill has yet been invoked under Goose to do real work (see "What is NOT verified" above) — that's why the module is `pilot` rather than `live`. See `docs/MODULES.md`'s `org-os-berd` entry for the current status summary.

## Operating

How an operator runs the bridge day to day, now that it exists. (The Buzz lane's counterpart
runbook is [buzz.md](buzz.md); the two lanes meet in `org-os-init`, which is both a bridged
skill here and a carrier of both Buzz session hooks.)

**Edit canon, never the mirror.** The five bridged skills live canonically in
`skills/<name>/`; `.agents/skills/<name>/` is a materialized view. After touching any
canonical skill, run `npm run sync:skills:berd` and commit both sides — the sync is
idempotent (`unchanged` when in sync, `update` when canon moved). Never hand-edit a managed
mirror: the `managed_by: org-os` line in its frontmatter is the overwrite permission, and the
next sync replaces the whole directory. `.agents/skills/feynman/` carries no marker and is
never touched; `--adopt` is the only takeover path for unmanaged targets, and `--dry-run`
previews any run.

**Curation lives in the manifest.** The materialization entries in
`modules/org-os-berd/module.yaml` (`skills/<name>: .agents/skills/<name>`) *are* the exposure
list — to bridge another skill or pull one, edit the manifest and re-run the sync. The rule is
that only Goose-verified skills may appear there; right now the list runs ahead of its own
rule — all five entries are discovery-verified but none has been exercised under Goose (see
below), which is exactly what plan Task 5's verdict-and-pruning pass exists to fix.

**The drift gate.** `npm run sync:skills:berd -- --check` recomputes the expected mirror in
memory (bytes, permission bits, exact file set, marker present) and byte-compares — reporting
`in-sync` / `drift` / `missing` per skill, exit 1 on any drift or missing entry
(`hand-authored` targets are reported and ignored). It is wired in twice: as the module's own
`checks:` command in `module.yaml`, and as an optional step in `npm run selftest`
(`skipKey: "berd"`). A red `--check` means someone edited a side without syncing — regenerate
and commit. Caveat: run gate suites from the primary checkout, not a git worktree —
`analyze-instances.mjs` overwrites the tracked drift report with placeholders when run from a
worktree (`HEARTBEAT.md` known issue).

**Running a session from Berd.** Open this repo as a Berd project: the personas
(`.agents/agents/{operator,upstream}.md`) and the five bridged skills are auto-discovered.
`org-os-init` is the session vehicle — it carries the full lifecycle (dashboard, PLAN →
EXECUTE → CLOSE) plus both Buzz hooks (channel read-back on initialize, digest post after the
close commit), so a Goose-driven session is supposed to land in the same memory → HEARTBEAT →
commit → Buzz loop as a Claude Code session. The discovery probe, when in doubt:
`/Applications/Berd.app/Contents/MacOS/goosed skills list` from the repo root.

**What remains unverified — stated plainly.** Discovery and parsing are proven; **function is
not**. No bridged skill has ever been exercised under Goose to do real work; the per-skill
"Goose verification" table this doc is meant to carry (plan Task 5) is unwritten and the
pruning pass hasn't run; no full org-os session (initialize → work → close) has been driven
from Berd/Goose; the 5-real-uses acceptance tally stands at 0/5; and the Berd GUI's own Skills
panel has never been observed rendering these skills (only `goosed` CLI discovery has). The
module stays `pilot` until the `HEARTBEAT.md` tracker completes.

## Re-verification note

Berd ships frequently (three releases, v0.6.0 → v0.6.2, in four days as of this writing) and wraps a separately-versioned Goose backend. On any Berd minor bump — or any bump of the pinned Goose commit in `goose-backend.lock.json` — re-run this task's steps: re-check `documentation/docs/guides/context-engineering/using-skills.md` and `crates/goose/src/skills/mod.rs` in whatever repo `goose-backend.lock.json` names (currently `aaif-goose/goose`) for the discovery path and order, and re-run the live GUI confirmation (Step 2) against the new pin.
