# Skill specification

A skill is a directory under `skills/` with a `SKILL.md`: YAML frontmatter plus a markdown body that tells an agent how to do one thing in an org-os workspace. This repository has 36 skills (`ls skills/*/SKILL.md | wc -l`); a new instance carries the subset its clone config selected. Skills are version-controlled with the workspace they serve.

What the tooling enforces is small. Most of the rest of this page is convention.

## File and directory

```
skills/
  meeting-processor/
    SKILL.md
  my-custom-skill/
    SKILL.md
    scripts/        # optional: anything the skill ships with it
    templates/      # optional
```

- The directory name is kebab-case and should equal the `name` in the frontmatter. All 35 skills that have parseable frontmatter satisfy this today.
- `skills/commands/` is not a skill. It holds five generated command skills (`close`, `commit`, `handoff`, `skills`, `sync`), mirrored from `.claude/commands/` by `npm run sync:commands` (`scripts/sync-commands.mjs`, which also writes `.opencode/commands/` and `.cursor/commands/`, and skips a command whose name collides with a real skill, which is why `initialize` is not among the five). Edit the source in `.claude/commands/`, not the mirror.

## Frontmatter

The frontmatter block must be the first thing in the file: `---`, YAML, `---`. A `SKILL.md` that does not start with it is reported as a `no-frontmatter` anomaly (see below).

The readers in this repository are `scripts/lib/discover-skills.mjs` (for the generated index), `scripts/initialize.mjs` (name and description, for the dashboard) and `scripts/sync-skills-berd.mjs` (which injects `managed_by`). The first parses it line by line with a simple `key: value` pattern. It takes the skill's `id` from `name` (falling back to the directory name) and `description` and `version` for the generated index. It does not read `triggers`, `inputs`, `outputs`, `dependencies`, `tier` or `category` and does not validate them. Multi-line and nested values are not parsed by it, so keep `name`, `description` and `version` as single-line values.

Fields found in the 36 `SKILL.md` files here (35 have frontmatter):

| Field | Found in | Meaning |
|---|---|---|
| `name` | 35 | Identifier. The only field every skill has with `description`. |
| `description` | 35 | What it does and when to use it. Agent runtimes use this to decide whether to load the skill, so state both. |
| `version` | 31 | Semantic version. Bump on behaviour changes. |
| `metadata` | 26 | Runtime configuration. The framework skills carry `metadata.openclaw.requires` with `env`, `bins`, `config` lists. |
| `author` | 24 | `organizational-os` for framework skills. |
| `category` | 24 | Values in use: `engineering` (10), `infrastructure` (5), `operations` (3), `knowledge` (2), `capital`, `coordination`, `research`, `capability` (1 each). |
| `license` | 16 | `MIT` or a pointer to a `LICENSE.txt` (vendored skills). |
| `triggers`, `inputs`, `outputs` | 9 | Phrases that activate the skill; what it needs; what it writes. |
| `tier` | 9 | `core` in all nine. `custom` and `shared` are described below but no skill here uses them. |
| `dependencies` | 7 | Other skills it uses. |

A few skills carry one-off fields (`platforms`, `domain`, `display_name`, `stability`, `last_evaluated`). Vendored skills (`artifacts-builder`, `frontend-design`, `mcp-builder`, `notion-cli`, the `superpowers-*` set) keep the frontmatter they came with.

`triggers`, `inputs` and `outputs` are good practice for a skill you write; they are not required by any script. Write them if you want a reader, or an agent, to know when the skill applies and where its files land.

## Body

Recommended structure, which the framework skills follow in part (19 of 36 have a "When to Use" heading, nine "When NOT to Use", nine "What This Is", seven "Procedure"):

1. **When to Use** and **When NOT to Use**: positive and negative triggers. The negative list matters where skills overlap (`knowledge-curator` against `meeting-processor`).
2. **Procedure**: numbered steps, with explicit file paths, formats and decision points.
3. **Output format**: the exact shape of what is written, with workspace-relative paths (`data/meetings.yaml`, not "the meetings file").
4. **Error handling**: what the agent does when an input is missing or a dependency is not there.
5. **Examples**: at least one complete input and output.

Write for the agent. Say what to do at each step; avoid "process the data appropriately".

## The framework skills

The skills the original 2.0 spec called "core" still exist: `meeting-processor`, `funding-scout`, `knowledge-curator`, `capital-flow`, `schema-generator`, `heartbeat-monitor`, `bootstrap-interviewer`, `idea-scout`, `workspace-improver`. They are no longer the whole set, and `tier: core` is not on those nine: it is set on `bootstrap-interviewer`, `idea-scout`, `initialize`, `org-os-init`, `research`, `paper-design`, `skills-curator`, `symbient` and `workspace-improver`.

The authoritative inventory is [`SKILLS.md`](../SKILLS.md), generated by `npm run generate:skills`. Rerun it before relying on its counts: the committed copy was last generated 2026-08-28 and says 35 workspace skills, where the directory now holds 36.

## Discovery

`npm run generate:skills` (or the `/skills` command) runs `scripts/generate-skills.mjs`. It walks three places:

- the workspace's `skills/<name>/SKILL.md`;
- the user's `~/.claude/skills/` (user skills);
- plugin skill directories (this scan is switched off in the generator).

It cross-references `data/skills-matrix.yaml` and writes `SKILLS.md` and `.well-known/skills.json`. The walker's result is authoritative about what exists on disk; the matrix supplies owner, instance adoption and promotion status. It reports:

- **anomalies**: a skill directory without `SKILL.md`, a `SKILL.md` without frontmatter, an unreadable file;
- **on disk but not in the matrix** (today: `knowledge-graph`);
- **in the matrix as `in_framework` but missing from disk** (today: `commands`, because its `SKILL.md` files sit one level down).

`skills/notion-cli/SKILL.md` currently starts with an HTML comment before its frontmatter, so the walker reports it as having no frontmatter.

At session start the agent reads `skills/*/SKILL.md` to build its inventory; see [Agentic architecture](AGENTIC-ARCHITECTURE.md). `agent.skills` in `federation.yaml` lists the skills the workspace declares; `scripts/initialize.mjs` reads it for the dashboard, and the clone (`npm run clone:framework`) uses the `skills` list in its config to decide which `skills/<id>/` directories a new instance gets.

Other scripts that touch skills:

| Script | What it does |
|---|---|
| `npm run sync:commands` | Mirrors `.claude/commands/*.md` into `skills/commands/<name>/SKILL.md`. |
| `npm run sync:skills:berd` | Copies the curated skills into the Berd runtime's `.agents/skills/` and injects `managed_by: org-os` into the copy's frontmatter. Reads `modules/org-os-berd/module.yaml`; see the Berd integration page. |
| `npm run analyze:instances` | Compares instances with the matrices; flags `unmapped_skill` and `undeclared_skill`. |

## Tiers, custom and shared skills

The `tier` field is descriptive: `core` ships with the framework, `custom` is written in one instance, `shared` is a custom skill promoted to the framework. Nothing reads it. What does decide a skill's standing is its row in `data/skills-matrix.yaml`, described in [Skill promotion](SKILL-PROMOTION.md).

To add a custom skill: create `skills/<kebab-name>/SKILL.md` in your instance, avoid the names of framework skills, name it for what it does (`podcast-processor`, not `processor`), add it to `agent.skills` in `federation.yaml`, and run `npm run generate:skills` to see that the walker finds it. To move it upstream, follow the promotion workflow. The `federation.yaml` `skills.shared` block that earlier versions of this page showed is not read by any script and is not in the shipped `federation.yaml`.

## Versioning

Semantic versions: major for a change to inputs, outputs or behaviour that breaks a caller, minor for a backwards-compatible capability, patch for wording and fixes. Framework skills reach a new instance at clone time and an existing one through `npm run sync:upstream` (a git rebase, so only where history is shared with the framework); `npm run doctor -- sync` overlays `scripts/` and `templates/` only and does not carry skills. See [Package lifecycle](PACKAGE-LIFECYCLE.md) for the same cycle applied to packages.

## Practice

- One skill, one capability. If the procedure passes six to eight steps, split it.
- Test the skill in a real session before you commit it: does the agent follow the steps in order, write to the right paths, and not fire on unrelated requests?
- Keep triggers specific: "process meeting transcript", not "process".
