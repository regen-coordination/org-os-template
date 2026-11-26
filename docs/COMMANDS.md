# Commands

Every command an operator runs: the slash commands an agent understands, and the `npm run` scripts in `package.json`. Run scripts from the instance root.

## Slash commands

Slash commands are markdown files in `.claude/commands/`, the single source. `npm run sync:commands` regenerates the copies other tools read (`.opencode/commands/`, `.cursor/commands/`, and `skills/commands/<name>/SKILL.md` for Hermes). They are instructions an agent follows, not shell commands: type them in Claude Code, OpenCode or Cursor.

| Command | What it does |
|---|---|
| `/initialize` | Open a session: `git pull --rebase` (skipped offline or in an embedded repo), run `npm run initialize:markdown` for the dashboard, note the session context, wait for you. (`skills/initialize` is the same flow as a skill.) |
| `/close` | Close a session: summarise, write memory, update `HEARTBEAT.md`, `MEMORY.md` and the plan queue, refresh the knowledge graph, commit, push. Since 0.7 it asks of each memory entry "members or Council?": a members entry is appended to `memory/YYYY-MM-DD.md` (in git); a Council entry goes to the running Hub with `npm run memory` and never into `memory/`, `MEMORY.md`, `HEARTBEAT.md`, a plan or the commit message. When unsure, it is Council (`.claude/commands/close.md`). |
| `/sync` | Vault-safe sync: fetch, fast-forward your operator trunk only, report drift against `main`. Never stashes, cleans or hard-resets. |
| `/commit` | Guided commit on your operator trunk (refuses `main`): show changes, stage, conventional message, push. |
| `/handoff` | Generate a copy-paste prompt that lets another operator pick up a piece of work from their own clone. |
| `/skills` | Run `npm run generate:skills` and print `SKILLS.md`, with anomalies and promotion status. |

`/sync` is not `npm run sync`: there is no `sync` script. The interactive helper `scripts/sync-github.mjs` exists but is not wired into `package.json`; run `node scripts/sync-github.mjs status|pull|push|full` if you want it.

## Setting up and updating an instance

| Command | What it does |
|---|---|
| `npm run clone:framework -- --target <dir> --config <file>` | Generate a new instance from this framework. Also `--dry`, `--force`, `--no-git`, `--commit-unverified`. The recommended path; see [`SETUP.md`](SETUP.md) and [`ADOPT-WITH-AN-AGENT.md`](ADOPT-WITH-AN-AGENT.md). |
| `npm run clone:manifest` | Regenerate `tests/clone-manifest.txt`, the file list a fresh clone must match. Framework maintainers. |
| `npm run setup` | In-place wizard (org type, name, description, base URL, packages, agent runtime, network, emoji, Notion). Needs a real interactive terminal: an agent or non-TTY shell cannot drive it. It edits the repository where it runs, and it is not a working path for a newcomer (see `BOOTSTRAP.md` and `README.md`); use `clone:framework`. |
| `npm run sync:upstream` | In an instance: pull framework changes (stages: dirty-tree refusal, `.sync-freeze` check, fetch, rebase, migrate, sync packages, validate, receipt in `memory/`). Options: `-- --yes` (required to actually sync; without it the command prints the commit count and changes nothing), `-- --dry`. Not for repositories that share no history with the framework. |
| `npm run sync:packages` | Copy the packages enabled in `federation.yaml` from the framework into the instance. |
| `npm run migrate` | Run every framework migration from the instance's `framework_version` up to the current one (`scripts/migrate.mjs`). `-- --dry` lists them; `-- --target <version>` sets the target; `-- <dir>` migrates another instance with this repository's migrations, which is how `doctor sync` runs it. 0.5 → 0.6 has two: `v0.5-to-v0.6-canonical-records` (writes `data/systems.yaml`) and `v0.5-to-v0.6-governance-rules` (roles and rules in `data/governance.yaml`; it writes only what is certain, prints the rest, and takes `--confirm roles,rules` when run on its own). The two pre-0.5 scripts never run on a 0.x instance; an instance still stamped 1.x–3.5 is read as 0.5. See [`VERSIONING.md`](VERSIONING.md). |
| `npm run open` | The launcher: builds the Hub, then serves `http://localhost:4679/launch` (`--port` changes it), where you open an instance by folder or git address, create one, adopt a repository that is not org-os, or start joining a network. Each opened instance gets its own Hub from port 4680 up. Binds 127.0.0.1, never pushes, refuses to run hosted. Framework checkout only. See [`OPENING.md`](OPENING.md). |
| `npm run doctor` | Read-only assessment scorecard of an instance (`-- --dir <path>`, `--json`, `--strict`); `npm run doctor -- sync` repairs and syncs with a receipt (`--dry-run` shows the plan). |
| `npm run install:hooks` | Install the versioned git hooks (pre-commit runs `validate:structure`, plus `validate:schemas` when `data/*.yaml` is staged, and then `validate:data` and `validate:governance` as warnings only where those scripts exist; in a linked worktree with no `node_modules` it skips them all; pre-push refuses to push `agent/*` branches). It does not block commits to `main`: only the `/commit` instructions and `scripts/hooks/pre-commit`, installed by `scripts/operator-setup.sh`, do. `-- --uninstall` removes them. |
| `npm run bootstrap:local` | `clone:repos`, then `npm install`. |
| `npm run clone:repos` | Clone the repositories listed in `repos.manifest.json` into `repos/` (`node scripts/clone-linked-repos.mjs --dry-run` previews). |
| `npm run repos:manifest -- [<dir>]` | Write `repos.manifest.json` from the repo Systems in `data/systems.yaml` that carry a `mount`; entries no System names are kept, and the file is written only when it changes (`scripts/repos-manifest.mjs`). `npm run generate:schemas` runs it after the generator. |
| `npm run index:repos` | Index the cloned repositories (`repos.index.manifest.json`); `--changed` limits it to changed repos. Same script as `knowledge:index`. |

## Every day

| Command | What it does |
|---|---|
| `npm run initialize` | Gather instance state as JSON (what `/initialize` reads). |
| `npm run initialize:markdown` | The same state rendered as the markdown dashboard. |
| `npm run page <id>` | One dashboard page as markdown: `dashboard`, `projects`, `tasks`, `instances`, `decisions`, `this-week`, `plans`. |
| `npm run generate:schemas` | Regenerate `.well-known/` (EIP-4824 and the rest) from `data/*.yaml`, `federation.yaml` and `content/meetings/`, `content/projects/`. It writes only what `data/visibility.yaml` makes public, and nothing until `identity.daoURI` is set. It then runs `repos:manifest`. In an instance it runs the copy in `scripts/lib/standards/`, without the schema check. Run after changing data. See [`EIP4824-GUIDE.md`](EIP4824-GUIDE.md) and [Data model](DATA-MODEL.md). |
| `npm run validate:schemas` | Identity and schema validation (`scripts/validate-identity.mjs`); with a `daoURI`, also the published files against their schemas and a scan for withheld values. |
| `npm run validate:data -- <dir>` | Every `data/*.yaml` against the admin's JSON Schemas (`scripts/validate-data.mjs`); warnings never fail. Framework checkout only: it needs `packages/admin` (`npm install --prefix packages/admin`, else exit 2), so an instance receives neither the script nor the npm entry. With no path it checks the current directory. |
| `npm run validate:governance -- <dir>` | The rules in `data/governance.yaml` are well-formed, and the git history agrees with them (`scripts/validate-governance.mjs`). History findings are warnings, errors with `--strict` or `CI=true`; `--max <n>` (default 500), `--range <rev-range>`. Framework checkout only, like `validate:data`. |
| `npm run validate:structure` | Check the file and folder structure. |
| `npm run selftest` | Run every validator and optional capability check (`validate:data` and `validate:governance` are skipped while `packages/admin` has no `node_modules`); exit 1 on a failure, exit 2 when there are only warnings (`-- --verbose`, `-- --skip <name>`). |
| `npm run version:check` | Check that `package.json`, `federation.yaml`, `CHANGELOG.md`, `VERSION.md` and `MASTERPLAN.md` agree on the version. |
| `npm run version:update <x.y.z>` | Bump the version across those files and roll the changelog; does not commit or tag. |
| `npm run generate:skills` | Rebuild `SKILLS.md` and `.well-known/skills.json` from the skills found in the workspace. |
| `npm run generate:quilt` | Re-weave `docs/QUILT.md` from `data/*.yaml`. |
| `npm run render:templates` | Render the framework's own README and GETTING-STARTED from `templates/`. |
| `npm run generate:dashboard` | Write the static `packages/dashboard/dashboard.html` (`node packages/dashboard/generate.mjs --json` prints the raw state). |
| `npm run admin -- --repo ../my-instance` | The Hub (admin app) on `http://localhost:4680` for the instance's records, rules, proposals, boards and workspace; a change is applied as a git commit or proposed, as the rules say. Run it from the framework checkout: an instance does not carry the app. See [Admin app](ADMIN-APP.md). `npm run admin:dev` runs the server in watch mode. |
| `npm run memory -- add --level <level> --date <YYYY-MM-DD> --title <t> (--file <md> \| -)`, `npm run memory -- list --date <YYYY-MM-DD>` | The agent layer's memory, split by who may read it (`scripts/memory.mjs`). `--level members` appends to `memory/<date>.md` and commits nothing; a stricter level (`hat:<hat ref>`, `role:<role id>`) is posted to the running Hub (`--hub <url>`, else `ORG_OS_HUB_URL`, else `http://localhost:4680`) as a Council memory record, and is refused when no Hub runs. `list` prints the day's org memory headings and the Council entries the Hub shows you. Ships to instances (node built-ins and js-yaml only). |
| `npm run import -- notion\|fileverse <folder> [--map <file>] [--apply] [--repo <instance>]` | Import a Notion Markdown & CSV export or a Fileverse pull into the workspace, with no Hub running for the instance. Without `--apply` it writes nothing in the instance: it prints a report and writes a map beside the export to edit (each database's collection, its level, its fields; people linked to member ids). With `--apply`: one workspace commit, its private part in the private store, and a receipt in `data/imports.yaml` that names no private item. Framework checkout only; `--repo` names the instance, else the folder npm was run from (`packages/admin/scripts/import.ts`). |
| `npm run house:backup:key -- <file>`, `house:backup`, `house:restore -- <file>` | The admin's private store (`house.db`, outside git): make a key file once, take an encrypted backup (`-- --verify <file>` checks one), restore one with the server stopped. The key is `ORG_OS_BACKUP_KEY_FILE`; `--repo <path>` names the instance (`packages/admin/scripts/house-backup.ts`). Framework checkout only. |
| `node scripts/claim-handle.mjs --repo <dir> --owner --member <id> --git <email>` | The owner's claim, for an org that has locked itself out (no rule covers `members`, or the role that proposes under it holds nobody with a git or wallet handle; with no rules and a solo model it never is, `lockedOut` in `packages/admin/lib/claim.mjs`): adds one handle to one person and commits it. Refused otherwise (`--wallet <CAIP-10>` instead of `--git`, `--dry` to preview). Not an npm script; framework checkout only. Its other form is run by the admin app's *claim your handle* wizard. |

## Vault safety

Run these before any merge, rebase, pull, reset or large checkout, and again after. See [`VAULT-SAFETY.md`](VAULT-SAFETY.md).

| Command | What it does |
|---|---|
| `npm run vault:snapshot -- "<reason>"` | Pin the working tree, tracked and untracked files with their uncommitted edits (not gitignored ones), to a permanent ref `refs/snapshots/<timestamp>-<slug>`, without touching the tree, the index or the stash list. Before 0.7.4 it held the tracked tree only (see [Workspace safety](VAULT-SAFETY.md)). |
| `npm run vault:audit` | Compare the root content files against the latest snapshot; exit 1 if any disappeared. `-- <ref>` audits against a specific snapshot. |

## Knowledge base

| Command | What it does |
|---|---|
| `npm run compile:knowledge` | Compile raw sources (meetings, projects, funding) into pages under `knowledge/`, then update the index. |
| `npm run lint:knowledge` | Health checks on the knowledge base: structure, freshness, links, completeness. |
| `npm run knowledge` | `compile:knowledge` then `lint:knowledge`. |
| `npm run knowledge:compile` / `knowledge:lint` / `knowledge:update-index` | The same steps one at a time (`knowledge:compile` compiles without updating the index). |
| `npm run knowledge:normalize` | Normalise knowledge-base frontmatter (titles, aliases, non-standard fields). |
| `npm run knowledge:index` | Index linked repositories (same script as `index:repos`). |
| `npm run graph:status` | Read-only stats on the Graphify graph (`graphify-out/graph.json`); never fails when it is missing. |
| `npm run graph:gaps` | Extract knowledge gaps from the graph into `data/knowledge-gaps.yaml` (`-- --check` prints without writing). |
| `npm run graph:update` | Run `graphify . --update` if the CLI is installed; otherwise print a pointer to [`integrations/graphify.md`](integrations/graphify.md). |

## Federation and fleet

| Command | What it does |
|---|---|
| `npm run analyze:instances` | Scan the instances in `data/instances.yaml` (framework only), compare declared and found state, write a drift report to `memory/reports/` (`-- --json`). |
| `npm run check:divergence` | Advisory: compare each instance's copy of a framework script against the canonical one (`-- --instances "<a>,<b>"`, `-- --script <file>`). |
| `npm run sync:agents` | Install the Berd agent personas from `.agents/agents/` to `~/.agents/agents/`. Flags: `--dry-run`, `--adopt`, `--source <dir>`, `--target <dir>`. |
| `npm run sync:skills:berd` | Copy the curated skills into `.agents/skills/` for Berd. |
| `npm run sync:commands` | Regenerate the other tools' command directories from `.claude/commands/`. |

## Integrations

| Command | What it does |
|---|---|
| `npm run buzz:doctor`, `buzz:post`, `buzz:read` | Buzz integration: check the connection, post a session digest, read since a point. See [`integrations/buzz.md`](integrations/buzz.md). |
| `npm run paper:doctor`, `paper:call`, `paper:push-tokens`, `paper:lint-tokens` | Paper integration: check, call a tool, push or lint design tokens. See [`integrations/paper.md`](integrations/paper.md). |
| `npm run paperclip` | Paperclip agents app, dev server (`tsx watch`). |

## Development and tests

| Command | What it does |
|---|---|
| `npm test` | `node --test "tests/**/*.test.mjs"`. |
| `npm run test:multica-bridge`, `test:cloudflare-os-integration`, `test:admin` | Test suites of those packages. |
| `npm run format` | `prettier --write`. |
| `npm run deploy:pages` | Build deployable web-app packages into `_site/`. Its list of packages (`dashboard`, `ideation-board`, `aggregator`, `system-canvas`) mostly does not exist in this repository, so it currently has little to build. |

## Scripts that are broken in this version

These are in `package.json` but cannot work today. Do not rely on them.

- `npm run docs` — calls `npx quartz`, but the repository has no `quartz/` directory or Quartz config.
- `npm run paperclip:server`, `npm run paperclip:build` — call `dev:server` and `build:ui` in `packages/paperclip-agents-app`, which defines neither (it has `dev`, `build`, `start`).
- `npm run check` — runs the graph self-tests, then `tsc --noEmit`, then `prettier --check`. There is no root `tsconfig.json` (only package-level ones), so `tsc` prints its help instead of checking and the script cannot pass. Run `node scripts/graph-status.mjs --test`, `node scripts/graph-gaps.mjs --test` or `npx prettier . --check` directly.
- `npm run build:site`, `npm run serve:site` — run Quartz inside `repos/refi-bcn-knowledge`, a repository that is not in `repos.manifest.json`, so `clone:repos` cannot produce it and nothing in this repository provides it.
- `npm run sync` — does not exist (see the note under slash commands).

## Tips

- Commit messages: say what changed and why ("Add new team members and update meeting notes"), not "Update files".
- Before anything that rewrites many files, run `npm run vault:snapshot` (tracked and untracked files since 0.7.4; not gitignored ones), then `npm run vault:audit` afterwards.
- Never `git stash`, `git clean` or `git reset --hard` in a workspace that holds untracked notes; the agent settings deny them.

## See also

- [`SETUP.md`](SETUP.md)
- [`OPERATOR-GUIDE.md`](OPERATOR-GUIDE.md)
- [`EIP4824-GUIDE.md`](EIP4824-GUIDE.md)
- [`PACKAGES.md`](PACKAGES.md)
- Issues: https://github.com/regen-coordination/org-os-template/issues
