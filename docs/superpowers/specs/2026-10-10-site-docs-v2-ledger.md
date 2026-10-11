# Site and docs v2 — the content ledger

This is the record of the content pass of the docs rewrite (spec: [`2026-10-10-site-docs-v2-design.md`](2026-10-10-site-docs-v2-design.md), §5; plan: [`../plans/2026-10-10-site-docs-v2-content.md`](../plans/2026-10-10-site-docs-v2-content.md)). It says, page by page, what was checked, what was found wrong, what was changed, and what could not be checked.

## What the pass did

Every page that was on the site, every page the spec's structure called for, and the package-level connectors page were checked against the code and either confirmed, corrected, rewritten, or written new. The pass was split into seventeen units of about three pages each, grouped by the code they describe (setup, operating, workspace safety, the knowledge system, modules, integrations, reference, concepts).

**Base commit.** The pass started from `214e2e4d06eed1f646c26ae938cb0d0c858af99f`, the last commit of plan 1 (the site frame). Units that started later record the commit they were at in their own "Checked at" line; each page's `verified` field in `site/src/data/docs-manifest.mjs` is that commit.

**Method.** For each page the unit agent listed its checkable claims (commands, flags, file and directory names, field names, counts, statuses, what a script is said to do), checked each one against the code on the branch (reading the script, running a read-only command, running a test file, or running a writing command only against a scratch directory), and settled the page's fate:

- **kept**: every claim holds;
- **corrected**: the page stands, wrong claims fixed in place;
- **rewritten**: more wrong or stale than right, written again from the code;
- **merged**: its true content moved into another page; the file stays in the repository, off the site;
- **dropped**: it describes something that does not exist or is not documentation; the file stays in the repository, off the site;
- **new**: written from the code, the tests and the package README.

A claim that could not be verified was either removed or kept and marked in the text. Another document was never taken as evidence.

**Review.** Every page was written or verified by one agent and then reviewed against the code by a second agent that had not written it: the reviewer spot-checked at least five claims per page and every command line, looked for unmarked unverifiable claims, and checked the constraints (voice, honest scope, no private paths, links only to tracked files, the fate). Findings went back to the unit agent once. The fragments below carry the review rounds that changed anything.

**Integration.** The last task wired the pages into the manifest, turned the "unverified allowed" flag off, added the fragment check to the build and the drift report (`npm run drift` in `site/`), and fixed what the build named. Where a review round changed a page's slug, title or summary, the later note won.

## Published and not published

Forty-six pages are on the site. Three files stay in the repository and are not published: `docs/AGENT-MODES.md` (merged into the agentic architecture page), `docs/integrations/koi.md` and `docs/integrations/egregore.md` (dropped: nothing an operator can run or configure). The twelve addresses the site already served keep resolving.

## Summary

| Page | Fate | Slug | Unit |
|---|---|---|---|
| `docs/SETUP.md` | rewritten | `setup` | U01 |
| `docs/SETUP-PATHS.md` | corrected | `setup-paths` | U01 |
| `docs/ADOPT-WITH-AN-AGENT.md` | corrected | `adopt-with-an-agent` | U01 |
| `docs/OVERVIEW.md` | new | `overview` | U02 |
| `docs/TOOL-SETUP.md` | rewritten | `tool-setup` | U02 |
| `docs/HOST-INTEGRATION.md` | corrected | `host-integration` | U02 |
| `docs/OPERATOR-GUIDE.md` | corrected | `operator-guide` | U03 |
| `docs/COMMANDS.md` | rewritten | `commands` | U03 |
| `docs/PLANS.md` | rewritten | `plans` | U04 |
| `docs/IDEA-HATCHING.md` | rewritten | `idea-hatching` | U04 |
| `docs/RELIABILITY.md` | corrected | `reliability` | U04 |
| `docs/VAULT-SAFETY.md` | corrected | `vault-safety` | U05 |
| `docs/VAULT-SAFETY-CASE-STUDY.md` | corrected | `vault-safety-case-study` | U05 |
| `docs/VERSIONING.md` | corrected | `versioning` | U05 |
| `docs/migrations/v2-to-v3.md` | corrected | `migration-v2-to-v3` | U05 |
| `docs/migrations/v3-to-v3-5.md` | corrected | `migration-v3-to-v3-5` | U05 |
| `docs/INSTANCE-DOCTOR.md` | new | `instance-doctor` | U06 |
| `docs/FILE-STRUCTURE.md` | rewritten | `file-structure` | U07 |
| `docs/DATA-MODEL.md` | rewritten | `data-model` | U07 |
| `docs/FEDERATION.md` | rewritten | `federation` | U08 |
| `docs/EIP4824-GUIDE.md` | rewritten | `eip4824` | U08 |
| `docs/SKILL-SPECIFICATION.md` | rewritten | `skill-specification` | U09 |
| `docs/SKILL-PROMOTION.md` | corrected | `skill-promotion` | U09 |
| `docs/PACKAGES.md` | rewritten | `packages` | U09 |
| `docs/PACKAGE-LIFECYCLE.md` | corrected | `package-lifecycle` | U09 |
| `docs/KMS.md` | new | `kms` | U10 |
| `docs/KMS-PLANES.md` | new | `kms-planes` | U10 |
| `packages/org-os-kms/docs/CONNECTORS.md` | corrected | `kms-connectors` | U10 |
| `docs/KMS-EXTENSION-PACKS.md` | new | `kms-extension-packs` | U11 |
| `docs/TERRITORY-PACK.md` | new | `territory-pack` | U11 |
| `docs/KMS-PUBLISHING.md` | new | `kms-publishing` | U12 |
| `docs/FEDERATION-MAP.md` | new | `federation-map` | U12 |
| `docs/MODULES.md` | corrected | `modules` | U13 |
| `docs/RAD-ORG-OS.md` | corrected | `rad-org-os` | U13 |
| `docs/ADMIN-APP.md` | new | `admin-app` | U13 |
| `docs/integrations/berd.md` | rewritten | `berd` | U14 |
| `docs/integrations/buzz.md` | rewritten | `buzz` | U14 |
| `docs/integrations/paper.md` | corrected | `paper` | U14 |
| `docs/integrations/cloudflare-os.md` | rewritten | `cloudflare-os` | U14 |
| `docs/integrations/egregore.md` | dropped | not published | U15 |
| `docs/integrations/graphify.md` | corrected | `graphify` | U15 |
| `docs/integrations/koi.md` | dropped | not published | U15 |
| `docs/integrations/opal.md` | rewritten | `opal` | U15 |
| `docs/ARCHITECTURE.md` | rewritten | `architecture` | U16 |
| `docs/AGENTIC-ARCHITECTURE.md` | rewritten | `agentic-architecture` | U16 |
| `docs/AGENT-MODES.md` | merged into docs/AGENTIC-ARCHITECTURE.md | not published | U16 |
| `docs/PATTERNS.md` | rewritten | `patterns` | U17 |
| `docs/AUTORESEARCH.md` | rewritten | `autoresearch` | U17 |
| `docs/ECOSYSTEM.md` | rewritten | `ecosystem` | U17 |

49 source files were settled; 46 are published.

## Found in the code, not fixed

The pass edited documentation only. Where a page was wrong because the code is wrong, the page now says what the code does, and the problem is listed here for the operator. Nothing in this section was changed in the code. Each item was found by reading the code or running it in a scratch directory, and is recorded in the unit that found it.

### The two that matter most to an operator

**(a) The workspace snapshot does not capture untracked files, and reports a clean tree when only untracked files are present.** `npm run vault:snapshot` builds its snapshot with a plumbing call that ignores the flag meant to include untracked files, so the snapshot tree holds tracked files only. In a scratch repository an untracked file was absent from the snapshot ref, and `npm run vault:audit` reported it only as "added". When the only changes are untracked files, the command prints that the working tree is clean. `doctor sync` has the same gap, because its snapshot stage uses the same call. The script's header and the older safety page promised the opposite, and the workspace-safety rules that agents are told to follow rely on this command to protect untracked notes. The safety page now has a "Known gap" section and a first step that protects untracked notes by hand (copy them aside, or commit them to a throwaway branch). Found by the workspace-safety unit (U05) and tested in a scratch repository; the review asked for and recorded an independent confirmation. `AGENTS.md`, `templates/AGENTS.instance.md` and the cheatsheet partials still recommend the command without the caveat; they are not site pages and are left for the operator, together with the fix in the two scripts. The final review also found the same claim in the Commands, Architecture and Instance doctor pages; those are corrected.

**(b) Running the knowledge system's publish directly on a canon applies only the basic check and publishes draft-maturity entries.** `org-os-kms publish` applies only the framework's own floor. On a canon, an entry that is still at draft maturity is published if its `public_use` allows it. The stricter canon gate (maturity, review) runs only in a plane's own publish, in `export` and in `validate`. An operator who publishes a canon straight to a server or a static surface can therefore publish entries that the two-plane model says must not leave. Found by the knowledge-system units (U10, U12); described on the planes and publishing pages.

### Records that contradict each other, and files that should not be public

- Two tracked agent definition files under `.agents/agents/` contain private workspace paths of the maintainer, and four files under `.opencode/agents/` are written for one operator's private workspace. They are tracked in a public repository and predate this branch. (U15 and U16 found them; the paths are not repeated here.)
- `AGENTS.md` section 2 describes an automatic 30-minute memory sync (a `.memory-sync.sh` script run by a cron entry) that is not in the repository. The `generate-schemas.yml` workflow watches `content/meetings/**` and `content/projects/**`, which do not exist. (U16, U17.)
- The framework repository has four different names: in `package.json` (`repository`), in the git remote and the hub entry of `federation.yaml`, in `repos.manifest.json`, and in the `federation.yaml` peers. `ECOSYSTEM.md` states the disagreement instead of picking one. (U01, U17.)
- `data/instances.yaml` holds `local_path: ../…` sibling paths and an `openclaw` entry with no repository. `repos/README.md` says `pnpm`; the repository uses npm. (U17.)
- `MASTERPLAN.md` section 6 and `AGENTS.md` section 6 give different lists of what an agent may do on its own. The `workspace-improver` skill lists a writable `ideas/` directory that does not exist. (U17.)
- `federation.yaml` and the packages matrix call OPAL "production-ready"; the OPAL bridge core is a stubbed skeleton. (U15.)
- `docs/ARCHITECTURE.md` says `scripts/modules.mjs` reads the module manifests and writes `data/modules.yaml` and `.well-known/modules.json` in an instance. `docs/MODULES.md` (checked against the code) says the script is 70 lines, exports `validateManifest()` and three constants, has no command line, and that no instance has a `data/modules.yaml`. The two pages disagree; the architecture page was not changed in meaning at integration, which only added links. (Found at integration; to be settled by the owner of the architecture page.)
- The `organizational-os` name in `federation.yaml`, `package.json` and `.well-known/dao.json` points at a GitHub organisation that is not registered: the addresses under it answer 404, and the published identity addresses in `dao.json` use `organizational-os.github.io`. The Ecosystem page no longer links them. Whoever registers the name would serve this project's published addresses; the files are not changed here. (Final review.)
- Two parallel hook systems: `npm run install:hooks` (the versioned hooks; does not block commits to `main`) and `scripts/operator-setup.sh` (`scripts/hooks`, which does). A clone set up with the second makes `install:hooks` refuse without `--force`. (U04; recorded here for the operator.)
- The clone rewrites the literal framework plans path in the docs it copies, so a sentence that names both folders cannot be written with the literal. Overview, File structure, Host integration, Versioning, Modules and the v2-to-v3 migration page now name the framework's folder without it; the clone test checks they come out unchanged. (Final review.)
- `scripts/modules.mjs` is a 70-line validator with no command line; its header comment still claims it reads manifests and writes `data/modules.yaml` and `.well-known/modules.json`, which is where the Architecture page got the claim. The page is corrected; the comment is not. (Final review.)

### Setup, scripts and commands

- Four npm scripts cannot work: `docs` (no `quartz` directory), `paperclip:server` and `paperclip:build` (the target package has no `dev:server` or `build:ui`), and `deploy:pages` (it lists packages that mostly do not exist). `scripts/sync-github.mjs` has no npm script. `build:site` and `serve:site` need a repository that nothing provides. `npm run check` cannot pass: there is no root `tsconfig.json`, so the compiler prints its help. (U03.)
- `npm run admin` cannot take `--repo` or `--port` after a single `--`; the root script starts npm again, so the flags need `-- --`. (U13.)
- `skills/org-os-init/SKILL.md` and `scripts/initialize.mjs` still refer to the deleted `packages/ideation-board` and `packages/aggregator`. (U03.)
- The `plans` page shim reads `docs/agent-plans/QUEUE.md`, but an instance made by the clone keeps its queue at `docs/plans/QUEUE.md`, so `npm run page plans` prints "QUEUE.md not found" in an instance (read from the code, not run). (U02.)
- `federation.yaml` `packages:` lists `meetings`, `projects`, `finances`, `coordination`, `web3`, `egregore`, which `setup-org-os.mjs` writes and `sync-packages.mjs` rejects. `federation.yaml` also carries `packages.knowledge_base: true`, so `npm run sync:packages` fails today. `npm run setup` writes package keys that do not match directory names. (U09.)
- `packages/opencode-integration/src/index.mjs` and `packages/hermes-integration/tools/org_os.py` refer to TUI packages that are not in the repository. (U02.)

### Versioning, migration and the instance doctor

- `npm run migrate` selects no migration on the 0.5 line: it reads the numbers in the migration file names as `2.0 -> 3.0` and rejects them because `3.0` is greater than `0.5`. `migrate -- --target` is not a flag (the script knows only `--dry`). The two migration pages run the scripts with `node` instead. (U05.)
- `npm run validate:structure` skips the major.minor comparison when `package.json` starts with `0`. (U05.)
- Instance doctor: the `migrations-dir-missing` check looks at `<instance>/migrations/`, but `scripts/migrate.mjs` uses `scripts/migrations/` and no sync stage creates the root directory, so the warning never clears and its hint is false. A second `doctor sync` on the same date overwrites that day's receipt, including replacing a successful receipt with an aborted one (observed). The overlay stage copies files but adds no npm scripts for them. (U06.)

### Federation, EIP-4824 and the schemas

- `scripts/test-federation.sh` hardcodes a path under `/root` and cannot run elsewhere. `schemas/federation.yaml` is stale (it says 3.0, its enums do not match, and nothing loads it). (U08.)
- `sync-upstream`'s header says paths in `customizations[].maintain_on_sync` are preserved; the code only counts them and runs a plain pull with rebase. (U08.)
- `validate-identity.mjs` does not check `meetings.json`, `ideas.json` or `knowledge.json`. `generate-all-schemas.mjs` sets the `dao.json` type from `identity.type` and `governanceURI` to a page nothing generates. This repository's own `dao.json` is hand-written, with URLs on a former organisation name. Nothing reads `onchain_registration` or `hats`. (U08.)
- `federate frontier` returns `ok: true` even when peers were not reached. (U09.)
- `scripts/analyze-instances.mjs` leaves `knowledge-gaps` and `ecosystems` out of its list of registries, so an instance that has them would get `undeclared_data_registry`. (U07.)

### Registries and the admin app

- `packages/admin/server/registries.ts` expects `finances` as a wrapper key, while `generate-all-schemas.mjs` and `data/finances.yaml` are flat (`budgets`, `expenses`, `revenues`); the wrapper makes `generate:schemas` write an empty `finances.json`. (U07.)
- The admin schemas reject real values: funding status has no `pending` (the funding-scout skill writes it), and `governance.model` has no `solo-maintainer`. The admin projects schema lists `title` and `started`, while this repository's projects use `name` and `startDate`. (U07.)

### Skills and packages

- The packages matrix lacks `admin`, `cloudflare-os-integration` and `multica-bridge`, and marks `dashboard` as not in the framework; it says the territory pack has 18 tests, and the package has 71. The skills matrix lacks `knowledge-graph`. `SKILLS.md` is stale (35 skills listed, 36 present). (U09, U11.)
- `skills/notion-cli/SKILL.md` starts with an HTML comment, so the skill walker sees no frontmatter. `skills/idea-scout` has a `docs/docs/ideas` path typo. `skills/skills-curator` refers to a retrospective skill that does not exist. (U04, U09.)
- `docs/INSTANCE-DOCTOR.md` and the new knowledge-system pages are not in `scripts/lib/clone-excludes.mjs`, so they ship to every generated instance (as the other docs do); the recorded clone manifest was regenerated for them at integration. (U07; see the integration report.)

### The knowledge system

- `lifecycle close` from the CLI fails at its bridge step (`ctx.config` is undefined). The CLI has no `--help`. A bare `init` leaves a self card that `validate` rejects. `planes.canon` and `federation_namespace` in `kms.yaml` are written by the clone and read by nothing. (U10.)
- `org-os-kms publish` mints UUIDs into tracked `data/kb/*.yaml` files even when no PDS is configured. (U10, U12.)
- `packages/toolkit-framework/schemas/extension-entities.yaml` has inline mappings with unquoted commas and colons that parse into stray keys, and the generated `public/.well-known/extensions.yaml` ships them. (U11.)
- The territory query library (`units.mjs`, `overlaps.mjs`) has no importer and no CLI. (U11.)
- `CONNECTORS.md` tells the operator to put `ATPROTO_APP_PASSWORD` in `.env`, but nothing loads `.env`. (U10.)
- No `radicle` connector stub exists, although the connector-layer design says four stubs are registered. (U13.)

### Integrations

- Two `daysUntil` tests in `packages/cloudflare-os-integration` fail outside UTC (84 of 86 pass at UTC+2; all pass with `TZ=UTC`). `proposeChange` throws a plain `Error` in both substrates, so a caller cannot tell it from an upstream failure. The adapter's `sync-core.mjs` defaults `ORG_OS_REPO` to a path on the maintainer's machine, and its `wrangler.jsonc` ships the maintainer's example instances and a work-branch ref. (U13, U14.)
- Buzz: `loadConfig` defaults `BUZZ_CHANNEL` to a name the CLI rejects. (U14.)
- Egregore: the adapter's "Show activity" runs a malformed `git log`. KOI: the `koi-bridge` CLI commands only print text, it has no tests, and its git-sync would overwrite an existing post-commit hook. OPAL: `packages/opal-bridge` has no source and no `package.json`, and its CI workflow sits where GitHub never runs it; the `koi-opal-bridge` README lists files that do not exist; `integrations/opal` stubs `process`, `approve`, `reject`, `review` and `ask`. (U15.)
- `scripts/modules.mjs` has a header comment listing `list`, `add`, `adopt` and `registry` commands and a "Phase 1"; the file implements none of it. (U13.)

### Site data fixed at integration

Two things the content pass reported in `site/` were fixed at integration and are listed for the record: the summaries in `site/src/data/modules.yaml` for the Paper module ("live verification pending" is stale; the token round trip was verified on 2026-09-02) and the Hermes module; and the capability map and page of `rad-org-os` (`site/src/data/rad-org-os.yaml`, `site/src/pages/modules/rad-org-os.astro`), which said the module was "in development" and that a KMS connector layer was not implemented, where the catalog says `planned` and the layer exists (it has no `radicle` connector). The page and the data now match `docs/RAD-ORG-OS.md`.

## The units

One section per unit, as the unit agent left it, with the review rounds that changed anything. Where a review note changed a page's slug, title, summary or fate, it is the later note that counts.

## U01 — Start: setup and adoption
Checked at: 214e2e4d06eed1f646c26ae938cb0d0c858af99f

### docs/SETUP.md
- Fate: rewritten
- Manifest: slug `setup` · title "Setup" · section start · summary "Create an instance: clone the framework, generate from a config, check with the doctor, publish its schemas." · covers `scripts/clone-framework.mjs`, `scripts/doctor.mjs`, `packages/instance-doctor`, `templates/`, `tests/clone-framework-health.test.mjs`, `package.json`
- Changed:
  - Old page described forking `organizational-os-template`, `npm run setup`, Quartz, a CNAME under `quartz/static/`, a Pages deploy workflow and a Cursor-rules step: none of this matches the code. Rewritten around the real path: `clone:framework` with a config, `generate:schemas`/validate, `doctor`, add a remote, bootstrap-interviewer.
  - GitHub org: the old `organizational-os/organizational-os-template` is not the remote; `git remote -v` and the clone's own canonical-upstream constant say `regen-coordination/org-os-template`. Used that.
  - Removed `federation.yaml` `packages: meetings/projects/...` example, the `identity.daoURI` hand-edit step, the `baseUrl` troubleshooting, the `../../organizational-os/packages/framework/` link and the Discussions link.
  - Added the clone flags table, the honest-scope note, a publishing section stating what the clone does and does not ship, the `doctor sync` pointer.
- Checked: `node scripts/clone-framework.mjs --help`/source (flags `--target --config --dry --force --no-git --commit-unverified`, required org.name/org.type, canonical upstream); ran the clone with the ADOPT config into scratch; ran `generate-all-schemas`, `validate-identity`, `validate-structure` there (14 and 50 checks passed); `node scripts/doctor.mjs --dir` before/after schemas (2 blockers, then only `git-remote-absent`); `doctor sync --dry-run` plan; instance contents (`.github/workflows/generate-schemas.yml` only, `scripts/deploy-pages.mjs` present, no quartz); `package.json` engines; `node --test tests/clone-kms.test.mjs tests/clone-locale.test.mjs tests/clone-framework-health.test.mjs` (31 pass); doctor argument parser (subcommand first).
- Not verified: that GitHub Issues is enabled on the repository (link kept, it is the origin remote); `npm install` inside a generated instance (used the framework's node_modules via NODE_PATH); `git push` to a remote.

### docs/SETUP-PATHS.md
- Fate: corrected
- Manifest: slug `setup-paths` · title "Setup variants: knowledge system and language" · section start · summary "Config variants of the one setup path: a kms: block and org.language." · covers `scripts/clone-framework.mjs`, `templates/`, `tests/clone-kms.test.mjs`, `tests/clone-locale.test.mjs`
- Changed:
  - Dropped the "superseded / stub" framing; links to SETUP.md for the walk-through. Kept the kms and language sections (they match the code).
  - Links to root files `BOOTSTRAP.md` and `templates/GETTING-STARTED.md` changed to https GitHub URLs (they are outside `docs/`).
  - Stated that `kms.store` is copied verbatim and that `on_collision` is not read anywhere in `packages/org-os-kms` (it appears only in the fixture).
  - `npm run setup` paragraph made concrete (script name, why not recommended).
  - Shortened the history section; the 374-line / 2026-03-21 / three-paths claim was confirmed in git history.
- Checked: clone-framework lines 86-120 (kms validation messages), 328-349 (language rules), 600-622 (`identity.language`); `templates/pt-BR`, `templates/partials`, `templates/scaffold`; QUEUE.md has four sections; fixtures exist; the three clone tests pass; `packages/org-os-kms/docs/CONNECTORS.md` has "Two planes"; `export`/`validate` verbs in the kms cli; `git show` of the original page for the history claim.
- Not verified: the exact list of labels kept in English (read from the page; `tests/clone-locale.test.mjs` passes but was not read line by line).

### docs/ADOPT-WITH-AN-AGENT.md
- Fate: corrected
- Manifest: slug `adopt-with-an-agent` · title "Adopt with an AI agent" · section start · summary "A copy-paste recipe an AI coding agent follows to generate and verify an instance." · covers `scripts/clone-framework.mjs`, `scripts/doctor.mjs`, `packages/instance-doctor`, `skills/bootstrap-interviewer`
- Changed:
  - Genesis stamp: `genesis_commit` is the framework's root commit (`git rev-list --max-parents=0`), not "the commit you were generated from"; corrected and described `last_sync_commit`.
  - "Keeping up to date": claim that sync was dry-run only was stale; the file-level overlay exists in `run-sync.mjs`/`overlay.mjs` (CHANGELOG Unreleased, landed after the v0.5.0 tag). Rewritten with the two commands, and the caveat about the tag.
  - Org type list marked as free text. HTML entities removed. The 2026-08-29 "verified" footer replaced by this unit's own check.
- Checked: ran steps 3-5 in scratch with the page's exact config; skills `bootstrap-interviewer org-os-init heartbeat-monitor knowledge-curator` and `packages/operations` exist; doctor result as above; `doctor sync --dry-run` printed the nine-stage plan including the overlay; CHANGELOG Unreleased text; clone-framework genesis code.
- Not verified: step 1 `git clone`/`npm install` over the network; the Cursor/OpenCode/ChatGPT claims in the intro (generic, not testable here).

### Review round 1 (applied)
- SETUP.md and ADOPT step 4: added the commit after `generate:schemas`; verified in the scratch instance (nine untracked `.well-known/` files, `git add -A && git commit` leaves a clean tree, doctor then shows only `git-remote-absent`).
- SETUP.md and ADOPT: added the plain statement that the fork/`npm run setup`/interview path is not working for a newcomer (2026-08-21 clean-room test, seven blockers, not re-tested), facts checked against README.md and POSITIONING.md "Bootstrap status".
- SETUP-PATHS.md: the two links are relative again (`../BOOTSTRAP.md`, `../templates/GETTING-STARTED.md`); the concern about https links is withdrawn.
- SETUP.md: workflow triggers listed in full (data, content/meetings, content/projects, federation.yaml, daily, manual).

### Concerns for the controller
- `package.json` `repository.url` still says `github.com/organizational-os/organizational-os-template.git` (and `tests/fixtures/instance-config-kms.yaml` uses that upstream); `git remote -v` says `regen-coordination/org-os-template`. Not mine to edit; docs use the latter.

## U02 — Start: overview, tool setup, host integration
Checked at: 214e2e4d06eed1f646c26ae938cb0d0c858af99f

### docs/OVERVIEW.md
- Fate: new
- Manifest: slug `overview` · title "Overview" · section start · summary "What org-os is, what an instance contains, and which page documents each part" · covers `IDENTITY.md, federation.yaml, data, skills, .well-known, schemas, templates, package.json`
- Changed: written from the repository root, `data/`, `skills/`, `.well-known/`, `package.json`, `scripts/initialize.mjs`; wording of the one-line definition and the honest-scope paragraph follows `docs/POSITIONING.md` section 1 (not linked, it is a draft).
- Checked: `ls` of root, `data/` (18 yaml), `.well-known/` (11 generated + templates), `schemas/`, `skills/` (36 SKILL.md; `skills/commands/` holds close, commit, handoff, skills, sync); `package.json` scripts initialize, initialize:markdown, generate:schemas, validate:schemas, validate:structure, doctor, vault:snapshot, generate:skills, clone:framework; `node scripts/initialize.mjs` default format is JSON (line 30); `node scripts/doctor.mjs` ran read-only (0 blockers); `scripts/clone-framework.mjs` lines 417-419 mark instances/skills-matrix/packages-matrix as framework-only; `scripts/generate-all-schemas.mjs` generate* functions and the dao.json early return until `daoURI`; `docs/FEDERATION.md` trust enum full/read/none; every linked doc is tracked (`git ls-files`); AGENTS.md nine-step list.
- Review fixes: startup sequence corrected to ten steps in AGENTS.md's real order; framework-versus-new-instance differences added from `scripts/clone-framework.mjs` stages 3, 4b, 6e and `scripts/lib/clone-excludes.mjs` TOP_LEVEL_ALLOW/DENY (no modules/, integrations/, site/, VERSION.md, CHANGELOG.md, docs/agent-plans; empty memory/ with .gitkeep; docs/plans/ + docs/superpowers/*; registry resets; frontier cache removed; .well-known templates only; blank knowledge/INDEX.md).
- Not verified: the clone differences were read from the engine source and deny-list, not by running a clone; counts of 18 data files and 36 skills are counted on this branch.

### docs/TOOL-SETUP.md
- Fate: rewritten
- Manifest: slug `tool-setup` · title "Tool setup" · section start · summary "Credentials, the Notion dashboard read, and what host MCP config this repository does and does not ship" · covers `scripts/initialize.mjs, .env.example, TOOLS.md, skills/notion-cli, .claude, .cursor, .opencode`
- Changed:
  - removed `npm run sync:notion`, `:pull`, `:push`, the field-mapping table and the conflict-resolution rule: none of those scripts exist; stated plainly that the sync is not built.
  - removed the four per-host Notion MCP JSON blocks and the GitHub MCP block: they named packages (`@anthropic/notion-mcp`, `@anthropic/github-mcp`) that are not referenced anywhere in the repo and could not be verified, and put MCP config in `.claude/settings.json` and `.opencode/config.json` (the real files are `.claude/settings.json` = guard hook only, `.opencode/opencode.json` = instructions). Replaced by a marked-unverified paragraph and a table of what the repo keeps per host.
  - replaced the invented TOOLS.md table (`members.yaml | abc123`) with the format `initialize.mjs` actually matches (Projects:, Meetings:, Members: + 32-char id).
  - added the real behaviour: `NOTION_API_KEY` read via `@notionhq/client`, read-only, three databases; `.env` loaded via dotenv; `NOTION_API_TOKEN` for the vendored `ntn` skill.
  - Telegram line now says CHAT-INTERFACE.md is a spec; Safe line points to IDENTITY.md Treasury section and the capital-flow skill; dropped "Version: 2.0.0" and the "Part of org-os v2.0.0" footer.
- Checked: `scripts/initialize.mjs` lines 15, 1000-1050, 1236-1250; `package.json` (no sync:notion scripts; `@notionhq/client` dependency); `.env.example`; `.gitignore` (.env, .env*.local); `.claude/settings.json`, `.opencode/opencode.json`, `.cursor/commands/`; `skills/notion-cli/SKILL.md`; `skills/capital-flow/SKILL.md`; `IDENTITY.md` Treasury section; `docs/CHAT-INTERFACE.md` tracked and a spec; grep for telegram in scripts (only command-sync mentions).
- Not verified: how each third-party host configures a Notion MCP server (no network, no host installed); the page says so and gives no package name.

### docs/HOST-INTEGRATION.md
- Fate: corrected
- Manifest: slug `host-integration` · title "Host integration" · section operate · summary "The opencode and hermes integrations, the page command they call, and what is not built" · covers `scripts/page-shim.mjs, packages/opencode-integration, packages/hermes-integration, packages/cloudflare-os-integration/src/page-core, .claude/commands, .opencode`
- Changed:
  - removed the claim that `packages/tui`, `packages/tui-data`, `npm run tui`, `packages/tui/src/modes/print.mjs` and a ~25-page catalogue exist: none do. Now states what exists (7 pages) and that `org_os_tui` will fail; flagged that the hermes tool description lists page ids that are not rendered.
  - removed the "Pages reachable" table and the architecture diagram (both described the missing packages); rewrote the architecture paragraph as the real subprocess shim; page rendering lives in `packages/cloudflare-os-integration/src/page-core/render-page.mjs`, not `initialize.mjs` alone.
  - matrix: dropped `npm run tui`; Claude Code and Cursor now list the six real commands; opencode row adds the five commands from `.opencode/commands/`.
  - hermes: added the toolsets path inconsistency between install.sh and org_os.py; opencode: added `install-commands.sh` usage and the `--global` / explicit-path forms.
  - removed the "Status (2026-04-25)" banner dates and "Task 12" promise framing.
- Checked: `npm run page` for dashboard, projects, tasks, instances, decisions, plans, this-week (exit 0) and `health` (exit 2); `scripts/page-shim.mjs`; `render-page.mjs` SUPPORTED_PAGES; `packages/opencode-integration/src/index.mjs` (tool names, `npm run tui` spawn), `commands/`, `install-commands.sh`, README; `packages/hermes-integration/install.sh`, `SKILL.md`, `skills/`, `tools/org_os.py`; `ls packages` (no tui, tui-data); `node --test` in opencode-integration (3 pass); `.claude/commands`, `.cursor/commands`, `.opencode/commands` listings.
- Review fixes: `plans` page - the shim (not the renderer) reads `docs/agent-plans/QUEUE.md` and passes it as `plansRaw`; noted that a cloned instance's queue is `docs/plans/QUEUE.md`, which the shim does not read (read from code, not run on a clone); plugin install locations marked as from the package README; links point at the packages' READMEs; `install-commands.sh` uses `ln -sf` so it overwrites a same-named `.opencode/commands/initialize.md`.
- Not verified: opencode plugin locations (README only); whether `@org-os/opencode-integration` is published on npm (no network; the page says so); hermes toolsets path (no hermes checkout); `packages/hermes-integration/test/smoke.test.py` not run (needs hermes).

## U03 — Operate: operator guide and commands
Checked at: 214e2e4d06eed1f646c26ae938cb0d0c858af99f

### docs/OPERATOR-GUIDE.md
- Fate: corrected
- Manifest: slug `operator-guide` · title "Operator guide" · section operate · summary "What an operator can do at each level of technical comfort, from chat to direct editing." · covers `package.json, packages/admin, packages/dashboard, scripts/page-shim.mjs, .claude/commands`
- Changed:
  - Level 1 promised a web dashboard, ideation board and aggregator; `packages/ideation-board` and `packages/aggregator` do not exist and nothing is hosted. Rewritten to what runs locally: `generate:dashboard` (static HTML), `admin` (localhost:4680, edits registries, commits), `page <id>`.
  - Level 3 examples used `packages/ideation-board` (`npm run dev`) and `packages/knowledge-exchange/scripts/process-knowledge.js` (neither exists); replaced with real commands (`validate:structure`, `initialize:markdown`, `doctor`, `vault:snapshot`).
  - Level 0 claimed Telegram/web chat with no setup; reworded to an agent session, Hermes integration noted, chat front end marked not built in.
  - Task table: removed "Browse aggregated content"; "Submit an idea" at L1 now points at the admin app.
  - Removed "Version: 2.0.0" (framework is 0.5.x), the "non-tech" title claim, and the community Telegram line (unverifiable); GitHub issues URL added from `git remote`.
  - Added honest-scope paragraph; Level 2 text kept (matches ADOPT-WITH-AN-AGENT flow and `clone:framework`).
- Checked: `ls packages` (no ideation-board, aggregator, knowledge-exchange); `packages/admin/README.md` and `schemas/ideas.schema.json`; `packages/dashboard/README.md` and `package.json`; `scripts/page-shim.mjs` SUPPORTED list; `.claude/commands/close.md`; ran `validate:schemas`, `validate:structure`, `version:check`, `initialize:markdown`, `graph:status`, `migrate --dry`; `git remote -v`.
- Not verified: that a Telegram/web chat front end can be hosted on top of Hermes (stated as up to the host, unverified); `bootstrap-interviewer` and `doctor assess` steps in Level 2 are U01's pages.

### docs/COMMANDS.md
- Fate: rewritten
- Manifest: slug `commands` · title "Commands" · section operate · summary "Every slash command and npm script an operator runs, grouped by task." · covers `package.json, .claude/commands, scripts`
- Changed:
  - `npm run sync` and its subcommands (status/pull/push/full) do not exist: no `sync` in package.json; `scripts/sync-github.mjs` is orphaned. Removed the whole section; `/sync` documented as the real fast-forward-only slash command.
  - `/generate:schemas`, `/validate:schemas`, `/sync:upstream`, `/clone:repos`, `/bootstrap:local` were presented as slash commands; they are npm scripts. Only six slash commands exist (`.claude/commands`): initialize, close, sync, commit, handoff, skills. `/initialize` was said to run `npm run setup`; it renders the dashboard.
  - `sync:upstream` described as pulling from "the organizational-os template repository"; rewritten from the script's stages (dirty tree refusal, freeze lock, rebase, migrate, packages, validate, receipt).
  - Added every operator-run script missing from the page (doctor, clone:framework, clone:manifest, migrate, vault:*, version:*, knowledge:*, graph:*, selftest, analyze:instances, check:divergence, install:hooks, generate:skills/quilt/dashboard, render:templates, admin, page, initialize*, sync:commands/agents/packages/skills:berd, buzz:*, paper:*, test:*). A script check confirmed every package.json script is named in the page.
  - Documented three broken scripts rather than hiding them: `docs` (no quartz directory), `paperclip:server`/`paperclip:build` (target package lacks `dev:server`/`build:ui`); `deploy:pages` lists packages that mostly do not exist.
  - Dead link `OPERATOR-GUIDEBOOK.md` replaced with `OPERATOR-GUIDE.md`; template GitHub URLs (organizational-os/...) replaced with the remote's regen-coordination/org-os-template; removed emoji and the beginner git tutorial built around the nonexistent `npm run sync`.
- Checked: package.json scripts (all of them, mechanically against the page, plus a check that every `npm run X` in both pages exists except the deliberately documented `sync`); header and flags of each script in `scripts/` (`clone-framework`, `sync-upstream`, `vault-*`, `update-version`, `migrate`, `initialize`, `selftest`, `install-hooks`, `graph-*`, `compile-knowledge`, `analyze-instances`, `check-divergence`, `deploy-pages`, `sync-commands`); ran `node scripts/doctor.mjs --help`, `clone-framework.mjs --help`, `migrate --dry`; read `.claude/commands/*.md`, `.cursor/commands`, `skills/commands`, `.claude/settings.json`; `ls quartz` (absent); `packages/paperclip-agents-app/package.json`; relative links all resolve to tracked files.
- Not verified: behaviour of write-capable scripts (`generate:schemas`, `compile:knowledge`, `sync:*`, `clone:repos`, `setup`) was taken from their source, not run; Buzz/Paper subcommand descriptions come from script names and the integration pages (U14's scope); `setup` was described briefly from the prompts in its source.

### Review round 1 (COMMANDS.md, OPERATOR-GUIDE.md)
- install:hooks row corrected: `.github/hooks/pre-commit.sh` runs validate:structure (+ validate:schemas when data/*.yaml staged); it does not block main. The main-blocking hook is `scripts/hooks/pre-commit` (installed by `operator-setup.sh`) and the /commit instructions. Pre-push `agent/*` refusal confirmed in `install-hooks.mjs`.
- build:site/serve:site moved to the broken list: `repos.manifest.json` has no refi-bcn-knowledge entry (grep count 0).
- `npm run check` moved to the broken list: no root tsconfig.json (`ls` fails), so tsc --noEmit cannot check.
- setup row: TTY-only, in-place, not a newcomer path (BOOTSTRAP.md line 7, README.md lines 70-80 read).
- selftest: exit 1 on failure, 2 on warnings only (selftest.mjs lines 223-225).
- sync:agents flags confirmed in script: --dry-run, --adopt, --source, --target.
- Headings: OPERATOR-GUIDE.md now `# Operator guide`; COMMANDS.md already `# Commands`.
- Total claims corrected in this round: 6.

## U04 — Operate: plans, ideas, reliability
Checked at: 214e2e4d06eed1f646c26ae938cb0d0c858af99f

### docs/PLANS.md
- Fate: rewritten
- Manifest: slug `plans` · title "Plans" · section operate · summary "How plans and the plan queue are kept, and what the session dashboard reads from them" · covers `scripts/initialize.mjs`, `scripts/clone-framework.mjs`, `templates/scaffold/docs/plans/QUEUE.md`, `docs/agent-plans/README.md`, `skills/skills-curator`
- Changed:
  - Said every instance uses `docs/agent-plans/`. Generated instances use `docs/plans/` (clone stage 6e scaffolds it and repoints docs); the framework repo alone keeps `agent-plans`. Both are now explained. The framework path is written as "the `agent-plans` directory under `docs/`" on purpose: stage 6e rewrites the literal string `docs/agent-plans/` in a clone's docs, which would turn the contrast sentence into nonsense there.
  - QUEUE.md format replaced by the scaffold's real sections (Active, Queued, Backlog, Completed) and the exact rules `initialize.mjs` parses (four headings, `[title](file) — description` items; `Scoping` ignored; `scoping` plans counted in no stage).
  - Added `workstream` frontmatter field (from the framework plan README); noted `frozen`/`superseded` exist only as framework-queue conventions.
  - Agent behaviour restated from `.claude/commands/initialize.md` and `close.md`; "1-3 active" and "approval before starting" marked as convention, not enforced.
  - Phase 0: skills-curator output path confirmed; removed the claim of a retrospective step as a skill (none exists in `skills/`); removed the unlinked-to-site `../skills/` link; dropped the stale version stamps ("Version: 2.0.0", footer).
- Checked: `scripts/initialize.mjs` lines 880-990 (loadPlans, plans pipeline), `scripts/clone-framework.mjs` stage 6e, `templates/scaffold/docs/plans/QUEUE.md`, `docs/agent-plans/README.md` and QUEUE.md, `.claude/commands/initialize.md` and `close.md`, `skills/skills-curator/SKILL.md`, `ls skills`, `grep ^status docs/agent-plans/*.md`.
- Not verified: the "operator approval before a queued plan starts / new plans start at scoping" workflow and "cross-repo plans tracked in the framework's queue" are not found in the commands, skills or plan README; kept, marked in the text as unverified conventions. Scope example fixed to the README's `framework | instance:<id>`.

### docs/IDEA-HATCHING.md
- Fate: rewritten
- Manifest: slug `idea-hatching` · title "Idea hatching" · section operate · summary "The ideas registry, the idea-scout skill, the status lifecycle, and hatching an idea into a repo by hand" · covers `data/ideas.yaml`, `skills/idea-scout`, `scripts/initialize.mjs`, `scripts/generate-all-schemas.mjs`
- Changed:
  - Removed the `packages/ideation-board` web app, web form, voting, "ideation board shows hatching status" (no such package or app in the repo), the `ideas/` markdown-submission folder (does not exist) and the Telegram submission channel (only a chat-interface doc idea, no idea-intake code).
  - Hatching stage rewritten as a manual procedure using `clone:framework`; stated plainly that no script hatches a repo and no code reads `hatched_from`, `votes`, `comments` or `compensation`. `docs/MODULES.md` lists `org-os-ideas` as `planned`.
  - Kept the status lifecycle, the entry schema (marked which fields tools write but nothing reads), and what idea-scout does (inputs, gap patterns, duplicate check, output, memory log).
  - Added what exists: dashboard "Ideas" pipeline (statuses surfaced..hatched), `.well-known/ideas.json` via `generate:schemas`, new instance starts with `ideas: []` (tests/clone-framework-health.test.mjs).
  - Noted the skill's own inconsistency (`docs/docs/ideas/` in its header vs `docs/ideas/` in its procedure).
- Checked: `skills/idea-scout/SKILL.md`, `data/ideas.yaml` (9 entries: 5 surfaced, 2 proposed, 1 approved, 1 developing, 0 hatched; fields id..updated, no votes/comments), `scripts/initialize.mjs` (ideas pipeline), `scripts/generate-all-schemas.mjs` generateIdeas, `scripts/clone-framework.mjs` line 474, `ls packages`, `grep -ri "ideation-board\|telegram"`, `federation.yaml` downstream entries, `docs/MODULES.md` org-os-ideas.
- Review fixes: optional template-only fields (`hatched_repo`, `resources`, `compensation`, `votes`, `comments`) labelled as absent from every framework entry; title line is `# Idea hatching`.
- Not verified: the steps of manual hatching (2-5) are advice, not code; they are labelled as manual. The federation upstream/downstream example snippet was cut because its field shape (`sync`, `hatched_from`) does not match the real `federation.yaml`.

### docs/RELIABILITY.md
- Fate: corrected
- Manifest: slug `reliability` · title "Reliability" · section operate · summary "Which checks run when, what selftest covers, drift and divergence reports, and recovery steps" · covers `scripts/selftest.mjs`, `.github/workflows/validate.yml`, `.github/workflows/drift.yml`, `.github/hooks/pre-commit.sh`, `scripts/install-hooks.mjs`, `scripts/analyze-instances.mjs`, `scripts/check-divergence.mjs`, `scripts/update-version.mjs`
- Changed:
  - Pre-commit layer: removed "`vault:audit` advisory" (the hook says vault-safety is operator discipline, no enforcement); added that it needs `npm run install:hooks`, the pre-push `agent/*` guard, and the separate `scripts/hooks/pre-commit` main-blocker.
  - CI layer: exact triggers (push to main/release/**, PR to main) and exact steps from validate.yml; check-divergence runs only inside selftest; added generate-schemas.yml.
  - Federation SLA (30/90 days, healthy/drifted/dormant) removed: not implemented anywhere. Replaced with the real drift items `analyze-instances` reports and the fact it always exits 0.
  - Selftest list rewritten to the actual eight checks in order (selftest.mjs): added check:divergence, berd mirror, test:admin and the skip keys; fixed "failure if critical drift" (cannot fail); "(if installed)" is really "skipped if missing".
  - Failed sync / migration claims made accurate (sync:upstream refuses dirty tree and `.sync-freeze`, rebases; migration log exists only for v3-to-v3.5; `migrate --dry`).
  - Version triplet is now five surfaces; "data integrity" no longer claims `dashboard.yaml` or `data/*.yaml` field validation (only `validate-structure` presence checks; nothing touches dashboard.yaml).
  - Stale "v3.5 addition/new v3.5" tags removed; added link to VAULT-SAFETY.md.
- Checked: `scripts/selftest.mjs`, `.github/workflows/{validate,drift}.yml`, `.github/hooks/pre-commit.sh`, `scripts/hooks/pre-commit`, `scripts/git-hooks/pre-push`, `scripts/install-hooks.mjs`, `scripts/analyze-instances.mjs`, `scripts/check-divergence.mjs` (ran `--help`: "No instances discovered"), `scripts/sync-upstream.mjs` header, `scripts/sync-packages.mjs` header, `scripts/migrate.mjs` header, `scripts/update-version.mjs --check` (ran: all agree, 0.5.0), `package.json` scripts, `grep dashboard.yaml scripts/`, `docs/VAULT-SAFETY.md` headings.
- Review fixes: added the `core.hooksPath` -> `scripts/hooks` interaction with `install:hooks` (checked in operator-setup.sh and install-hooks.mjs); punctuation of failure modes 3-5; title `# Reliability`.
- Not verified: did not run `npm run selftest` (it runs analyze:instances, which writes into `memory/reports/` of this checkout). Selftest contents were read from source. Recovery steps (reflog, `git checkout <sha> -- file`) are standard git, not repo code. Whether CI failures block merge depends on GitHub branch protection (not in the repo); the page now says so.

## U05 — Operate: workspace safety, versioning, migrations
Checked at: 214e2e4d06eed1f646c26ae938cb0d0c858af99f

### docs/VAULT-SAFETY.md
- Fate: corrected
- Manifest: slug `vault-safety` · title "Workspace safety" · section operate · summary "Rules and snapshot/audit scripts for risky git operations, what they miss, and how to recover files." · covers `scripts/vault-snapshot.mjs, scripts/vault-audit.mjs, scripts/sync-upstream.mjs, packages/instance-doctor/src/run-sync.mjs`
- Changed:
  - CODE FINDING, stated on the page: `vault:snapshot` calls the snapshot-creating plumbing call with `-u`, which `create` ignores; the snapshot tree holds tracked files only. Tested in a scratch repo: an untracked file was absent from the ref and `vault:audit` only reported it as "added". The old page promised "tracked + untracked + ignored-but-present". Rewrote that claim as a "Known gap", added a summary of what the tooling does not cover, and noted the script's header comment is wrong too. Not fixed in code (docs-only pass).
  - Manual equivalent: dropped the ineffective `--include-untracked`, and computed the ref name once (two `date` calls could differ).
  - `vault:audit`: now states what it compares (root `.md/.canvas/.base/.yaml/.yml`), the optional ref argument, exit codes 1 and 2; says subdirectories are not compared.
  - Recovery step 2 (`^3`) marked as applying only to the stash command trees, not snapshot refs; `/tmp` paths replaced; worktrees step marked conditional (no `.claude/worktrees/` in this repo).
  - Added that `doctor sync` snapshots first and `sync:upstream` refuses on a dirty tree (checked in source).
  - Link to the case study was a GitHub URL; now a relative link.
- Checked: `scripts/vault-snapshot.mjs`, `scripts/vault-audit.mjs` (read, and run in a scratch repo: snapshot, audit with and without a deleted file, exit codes 0 and 1); `package.json` (`vault:snapshot`, `vault:audit`, `doctor`, `sync:upstream`); `scripts/sync-upstream.mjs` stage 1; `packages/instance-doctor/src/sync.mjs` and `run-sync.mjs` snapshot step; `node scripts/doctor.mjs --help`; `ls .claude/worktrees` (absent).
- Not verified: the recovery runbook commands for `.stversions/`, `git fsck`, reflog, `mdfind`, `tmutil` were not run (standard git/OS behaviour); the iron rules are policy, not claims.

### docs/VAULT-SAFETY-CASE-STUDY.md
- Fate: corrected
- Manifest: slug `vault-safety-case-study` · title "Workspace safety case study" · section operate · summary "The 2026-04-25 incident where a stash of the working tree hid weeks of untracked notes, and how they were recovered." · covers `docs/VAULT-SAFETY.md`
- Changed: removed the private hub name; removed "kept out of generated instances", which no script supports (grep of `clone-framework.mjs` and `render-templates.mjs` finds no exclusion; the page says this was not verified); the stash `^3` ref described in words.
- Checked: grep for the page name in `scripts/` and `templates/`.
- Not verified: the incident narrative (dates, counts of recovered notes) is first-hand history with no code to check; left as written.

### docs/VERSIONING.md
- Fate: corrected
- Manifest: slug `versioning` · title "Versioning" · section operate · summary "How the 0.x line is numbered, what bumps what, the five version surfaces, and the release steps." · covers `package.json, scripts/update-version.mjs, scripts/migrate.mjs, scripts/validate-structure.mjs, VERSION.md, CHANGELOG.md`
- Changed:
  - Enforcement section was wrong: `validate:structure` skips the major.minor comparison when the `package.json` version starts with `0.`, and a missing CHANGELOG entry is a warning, not a failure, and not tied to a tag. Rewritten from `scripts/validate-structure.mjs` section 8.
  - Instance migration steps 3-4: `npm run migrate` reads file-name numbers as legacy majors, so neither shipped migration runs on `0.5`; it also does not update `framework_version` (`doctor sync` re-stamps). Stated, with a pointer to the migration guides.
  - MASTERPLAN example named two real instances and framework v3.0.0; replaced with neutral instances on `0.5.0`.
  - Lineage-stamp heading "(v3.5+)" relabelled; plan directory note (`docs/agent-plans/` vs `docs/plans/`).
  - The `0.x` explanation, milestone table, five surfaces and release process were checked and left as they were.
- Checked: `VERSION.md`, `package.json` (`version:update`, `version:check`, `test`, `test:admin`, `selftest`), `scripts/update-version.mjs` (header, semver and "must be greater" check, CHANGELOG promotion, VERSION.md and MASTERPLAN.md rewrite), `.github/workflows/` (`validate.yml`, `drift.yml`, `generate-schemas.yml` exist), `git tag -l` (`archive/v3.0.0`, `archive/v3.5.0`, `v0.5.0` exist), `site/package.json` (`build`, `test`), CHANGELOG `[Unreleased]` heading, `packages/instance-doctor/src/checks/versions.mjs` (`framework-version-stale`).
- Not verified: the release-process step list was not executed (it tags and pushes); `gh workflow disable/enable` and the "crons race" are operational history from the changelog.

### docs/migrations/v2-to-v3.md
- Fate: corrected (historical; first lines say it speaks in the legacy line and who, if anyone, still needs it)
- Manifest: slug `migration-v2-to-v3` · title "Migration: v2 to v3 (legacy numbering)" · section operate · summary "Historical: adding workstream frontmatter to old plans; written in the pre-0.5 numbering." · covers `scripts/migrations/v2-to-v3-workstream-frontmatter.mjs, scripts/migrate.mjs`
- Changed: opening note on numbering (legacy `1.x-3.5`, current `0.5`, `0.5` later than `3.5`) and on need (only an instance still on 2.x with `docs/agent-plans/`). CODE FINDING: `npm run migrate` cannot select this script on the current framework (file name read as `2.0 -> 3.0`, rejected because `3.0 > 0.5`); steps now run it with `node`. The script throws if `docs/agent-plans/` is missing: stated. Inference fallback `v2-stabilization` flagged as likely wrong for other instances. Rollback command qualified (it overwrites that directory). Issue URL made a link. Step 4 `git add -A` replaced with an explicit path.
- Checked: `scripts/migrate.mjs` (regex and range logic; `node scripts/migrate.mjs --dry` prints "No migrations to run"), `scripts/migrations/v2-to-v3-workstream-frontmatter.mjs` (whole), `scripts/clone-framework.mjs` (fresh clones scaffold `docs/plans/`), CHANGELOG entries.
- Not verified: the script was not run against a real old instance; "older tooling ignores the field" is marked untested; the `identity.role` and `downstream` bullets come from the changelog.

### docs/migrations/v3-to-v3-5.md
- Fate: corrected (historical; first lines say numbering and need)
- Manifest: slug `migration-v3-to-v3-5` · title "Migration: v3 to v3.5 (legacy numbering)" · section operate · summary "Historical: seeding the lineage stamp and package lifecycle on old instances; pre-0.5 numbering." · covers `scripts/migrations/v3-to-v3-5-consolidation.mjs, scripts/migrate.mjs, scripts/sync-upstream.mjs`
- Changed: opening note (legacy numbering, `0.5` is later than `3.5`; still useful only to seed `genesis_commit`, `last_sync_commit`, `lifecycle_status` on an old instance; current path is `doctor sync`). CODE FINDINGS: `npm run migrate -- --target v3.5` is not a flag (`migrate.mjs` knows only `--dry`) and the script is not selected on `0.5` (file name read as `3.0 -> 3.0`); steps now run it with `node`. `git pull upstream main` replaced with `npm run sync:upstream`. "5 skills + 5 scripts" count removed (unverifiable); the named-instance md5 known issue replaced with a pointer to the SKILL-PROMOTION table, marked not re-checked. "Force framework_version upgrade" line reworded. References made relative links to tracked files (checked with `git ls-files --error-unmatch`). Snapshot step notes that untracked files are not captured.
- Checked: `scripts/migrations/v3-to-v3-5-consolidation.mjs` (whole), `scripts/migrate.mjs`, `scripts/sync-upstream.mjs` (exit code 2 on `.sync-freeze`, dirty-tree refusal), `packages/instance-doctor/src/run-sync.mjs` (migrate stage runs `npm run migrate --if-present`, then re-stamps), `package.json` scripts named (`check:divergence`, `install:hooks`, `generate:skills`, `selftest`, `validate:*`).
- Not verified: the migration script was read, not run; the v3.5 highlight bullets (cloning engine, reliability layer, skills section) are copied from the old page and marked as such.

### Review round 1 fixes
- VAULT-SAFETY: added "Protect untracked notes first" (copy aside or commit to a throwaway branch), stated the false "Working tree clean" message when only untracked files exist, that `doctor sync` has the same gap, that every restore overwrites silently (restore to `.recovered` first), "no output means no ref" for the manual form, "tracked or staged", fsck output outside the workspace, "by default" for the 14 days; rule 1 no longer says a snapshot protects untracked notes; summary reworded.
- CASE-STUDY: removed the "guaranteed in every session" claim; figures marked approximate; capitalisation fixed.
- VERSIONING: `--destructive` and logging marked as policy not implemented by the shipped scripts.
- Migrations: single route stated and script-copy caveat (v2-to-v3); optional `packages-matrix.yaml` in `git add`; `.recovered` restore; revert wording (v3-to-v3-5).
- Not done: the reviewer's side note (AGENTS.md and instance templates recommend the snapshot without the caveat) is outside this unit; the real fix is in `scripts/vault-snapshot.mjs`. VERSIONING status line left as is.

## U06 — Operate: instance doctor
Checked at: 214e2e4d06eed1f646c26ae938cb0d0c858af99f

### docs/INSTANCE-DOCTOR.md
- Fate: new
- Manifest: slug `instance-doctor` · title "Instance doctor" · section operate · summary "Check whether an instance is healthy and update it safely: doctor assess and doctor sync." · covers `packages/instance-doctor, scripts/doctor.mjs, skills/instance-doctor`
- Changed:
  - Written from `packages/instance-doctor/src` (cli, report, assess, six checks, sync, run-sync, overlay), the package README and the skill (used only to find what to read).
  - Finding table lists the codes and levels read from the check source; the stage list and the overlay's owned/never-touched paths are from `sync.mjs`/`overlay.mjs`.
- Checked: ran `npm run doctor` (real scorecard quoted, trimmed); generated `scratch/U06/inst` with `clone:framework` and a config; ran assess (2 blockers, 5 warnings), `--json --no-validators`, `sync --dry-run`, real `sync` (all nine stages ok; fetch worked over the network; overlay added 29 files; 0 blockers, 4 warnings after), then a second sync with a dirty overlay-owned file (aborted at snapshot, names the file, exit 1); inspected the resulting git state, receipt and snapshot refs; `node --test tests/instance-doctor/*.test.mjs` (167 pass).
- Not verified: the "accepted against a real instance" statement is the package README's claim (its report is not in this repo); said so on the page. Hint text that says `structure-invalid` clears after `generate:schemas` rests on U01's run, not mine. Behaviour on an instance whose `upstream` points at a wrong repository was read from source, not run.

### Code findings (not docs; for the operator)
- `checks/machinery.mjs` `migrations-dir-missing` looks at `<instance>/migrations/` (`snapshot.mjs:233`), but `scripts/migrate.mjs` uses `scripts/migrations/` and no sync stage creates the root directory, so the warning never clears and its hint ("doctor sync creates it") is false.
- A second `doctor sync` on the same date overwrites `memory/reports/sync-receipt-<date>.md`, including replacing a successful receipt with an aborted one (observed).
- `docs/MODULES.md` describes sync stage 5 as `sync-upstream`; the code stage is `overlay` (U13's page).
- Links to the README and SKILL are relative file links (review fix).
- Review fixes: added package-json-missing, not-a-git-repo, version-scheme-unknown, structure-warnings, schemas-warnings to the table; sample marked trimmed; --strict marked assess-only.

## U07 — Reference: file structure and data model
Checked at: ff1e1f2d4bdb0eff924946c987ebdd8fb7646028 (HEAD when the unit started; the brief names 214e2e4, an ancestor of it)

### docs/FILE-STRUCTURE.md
- Fate: rewritten
- Manifest: slug `file-structure` · title "File structure" · section reference · summary "The repository tree, what a generated instance gets from it, and what validate:structure requires" · covers `scripts/validate-structure.mjs`, `scripts/lib/clone-excludes.mjs`, `scripts/clone-framework.mjs`, `scripts/generate-all-schemas.mjs`, `.well-known/`, `templates/scaffold/`
- Changed:
  - Added the framework-versus-instance split (copied / written fresh / not copied), taken from `TOP_LEVEL_ALLOW`/`TOP_LEVEL_DENY`/`EXCLUDE_*` and confirmed by a real clone in the scratch directory (node scripts/clone-framework.mjs --no-git with tests/fixtures/instance-config.yaml, then generate:schemas, validate:structure, validate:schemas in the clone: 50 passed, 0 failed, 7 warnings).
  - Removed or corrected: BOOTSTRAP.md and dashboard.yaml listed as required (the validator does not check them); "9-step startup sequence" (AGENTS.md has ten items); "federation manifest v3.0" for the root file (root is 0.5; v3.0 is schemas/federation.yaml); `.well-known` sources (dao.json is template + federation identity, contracts.json is federation identity.safe/gardens, not IDENTITY.md); skills.json missing from the table; root `ideas/` directory (idea pages go to `docs/ideas/`); knowledge `_index.yaml`/`exchange-log.yaml` tree (scripts write `<domain>/index.md` and `knowledge/README.md`; exchange-log is referenced nowhere); "9 core skills" table (37 skill dirs exist); the eight-package tree (only `dashboard` of those exists; 22 package dirs, with no common layout); `sync-notion.mjs` row (no such script); `SYSTEM-CANVAS.canvas` (not in the repository); `.claude/agents/` (does not exist); `.agents` tree (replaced by a pointer); "7 checks" (validator has 9 sections plus 8b); `federation.yaml` required sections ("federation" -> participation via network/peers/upstream/downstream or legacy section); Hub/Resource Library variations table (no code reads instance type; `aggregator` package does not exist); TOOLS.md "Notion workspace IDs" (env var names and Notion settings); docs plans directory (instance gets docs/plans, framework docs/agent-plans).
  - Added the files and directories the old page omitted: dashboard.yaml role, DECISIONS.md, GETTING-STARTED.md, schemas/, templates/, tests/, modules/, integrations/, site/, renders/, graphify-out/, .cursor/, .opencode/, .github/, .hermes/, ecosystems.yaml, knowledge-gaps.yaml.
  - Title line plain; version line and "Part of org-os v2.0.0" footer removed.
- Checked: ls of the repo root and every directory named; `scripts/validate-structure.mjs` read in full and run against the repository and the scratch clone; `scripts/lib/clone-excludes.mjs` and `scripts/clone-framework.mjs` read in full; clone run and compared with `comm` against the framework's scripts/ and docs/; `scripts/generate-all-schemas.mjs` and `scripts/generate-skills.mjs` read; package.json scripts; `ls packages/*` counted (22 dirs; 16 package.json, 17 README, 12 src, 1 SKILL.md); skills count 37; `git ls-files --error-unmatch` on every linked doc.
- Not verified: the clause "appended to and never overwritten" for memory is the rule stated in AGENTS.md section 2, not enforced by code; the `idea-scout` skill's reading of a per-domain `_index.yaml` is stated from the skill text only. The "20 dropped npm scripts" figure is from the fixture config run and varies with the config.

### docs/DATA-MODEL.md
- Fate: rewritten
- Manifest: slug `data-model` · title "Data model" · section reference · summary "Every data/*.yaml registry: top-level key, fields, types, who reads it, and what is not enforced" · covers `data/`, `packages/admin/schemas/`, `packages/admin/server/registries.ts`, `scripts/generate-all-schemas.mjs`, `scripts/validate-structure.mjs`, `scripts/validate-identity.mjs`, `scripts/initialize.mjs`, `scripts/graph-gaps.mjs`, `scripts/analyze-instances.mjs`
- Changed:
  - Count: "14 total" replaced by a counted table: 18 YAML files in data/ (14 the validator knows, 3 framework-only, plus `ecosystems.yaml`, which was undocumented).
  - New section "What the code actually checks": no framework script validates registry fields; validate:schemas does not read data/; only the admin app's JSON Schemas (`packages/admin/schemas`) define types/enums/required (only `id`).
  - Conventions corrected: top-level key does not always match the filename (finances flat, `opportunities`, `knowledge_manifest`, `gaps`); statuses are not all lowercase kebab-case (`Discovery`, `Develop`); `schema_version` absent in ecosystems.yaml.
  - finances: the page showed a `finances:` wrapper and fields (`total`, `allocations`, `approved_by`, `type`) that nothing reads; generate-all-schemas reads top-level `budgets`/`expenses`/`revenues` (wrapper gives an empty finances.json, tested in scratch). Replaced with the fields in the shipped file's example.
  - funding-opportunities: key is `opportunities` (scaffold, skill, this repo) or `funding_opportunities`; two entry shapes documented (funding-scout skill vs admin schema) with their different status vocabularies.
  - members/projects: this repo's real entries use `name`, `startDate`, `members`, `github:` ids; documented as such. governance `model` includes `solo-maintainer` (scaffold) which the admin enum lacks. `ideas.source` is a file path, removed from the cross-reference table.
  - packages-matrix is not "the same shape" as skills-matrix: `lifecycle_status` added; skills-matrix `notes` and `deprecated` added. instances.yaml is read, not populated, by analyze:instances.
  - `npm run sync:notion` removed (no such script); "validate EIP-4824 compliance" corrected to what validate:schemas does.
  - Added knowledge-gaps id derivation and kinds, ecosystems.yaml, the KMS-created registries (`REGISTRY_BINDINGS`), and the analyze:instances canonical list.
  - Sibling-instance extension shapes (hermes-cron, hub registries, orgs, figma-assets) kept but explicitly marked as not verifiable in this repository; sibling-instance names and the infra/hermes path removed.
  - Title line plain; version line and footer removed.
- Checked: all 18 data/*.yaml opened or shape-dumped with js-yaml (counts above are from that); `packages/admin/schemas/*.json` and `server/registries.ts`, `server/schema.ts` read; `scripts/generate-all-schemas.mjs`, `validate-identity.mjs`, `validate-structure.mjs`, `graph-gaps.mjs`, `analyze-instances.mjs`, `initialize.mjs` (registry loaders) read; `skills/funding-scout/SKILL.md`; `templates/scaffold/data/*`; `packages/org-os-kms/src/{bind,map}.mjs`; finances wrapper behaviour run in scratch.
- Not verified: the hermes-cron and hub-registry shapes, orgs.yaml, figma-assets.yaml (files live in sibling instances; marked in the text); the entry fields of governance `decisions` beyond what this repo's two entries show; KMS-created registry fields (defined in packages/toolkit-framework, another unit's pages).

### Code problems found (not fixed)
- `packages/admin/server/registries.ts` declares finances with top-level key `finances` (a wrapper), but `scripts/generate-all-schemas.mjs` and the shipped `data/finances.yaml` use top-level `budgets`/`expenses`/`revenues`. The two disagree.
- The admin schema enums reject real values: `funding-opportunities` status has no `pending` (the funding-scout skill's value); `governance.model` has no `solo-maintainer` (scaffold and this repo). Governance is read-only in admin M1 so it does not bite there; funding does on save.
- `scripts/analyze-instances.mjs` `canonicalRegistries` omits `knowledge-gaps` and `ecosystems`, so they would be reported as `undeclared_data_registry` in an instance that has them.
- `packages/admin/schemas/projects.schema.json` lists `title`/`started`, but this repo's own projects use `name`/`startDate`.
- `docs/INSTANCE-DOCTOR.md` and the new `docs/KMS*.md` pages are not in `scripts/lib/clone-excludes.mjs`; once committed they will ship to every instance (and `tests/clone-manifest.txt` will need updating).

### Pages by other units mentioned in plain text
- KMS.md (U10), mentioned in DATA-MODEL.md as "the knowledge system has its own pages".

### Review round 1 (U07)
- DATA-MODEL: finances section now says use the flat shape, the admin app reads a `finances:` wrapper (flat file shows empty there), document registries are read-only in admin, the readers disagree; removed dangling "Who reads what"; null rule reworded (enums have no null branch); commented-example claim limited to the eight empty registries; dashboard rule adds "past deadline is dropped"; KMS.md is now a relative link; minors: lineage-stamp check, projects `members`/`researchArtifacts`, knowledge-gaps merge rule, "tested in scratch" narration replaced by a code reference.
- FILE-STRUCTURE: 37 = 36 skills + commands container; walkup path "not re-tested since", single-operator honesty line.
- Left open: history narration ("earlier version of this page") in a few places; compensation/milestones convention subfields not restored; knowledge.json field mapping not spelled out.

## U08 — Federation and EIP-4824
Checked at: 214e2e4d06eed1f646c26ae938cb0d0c858af99f

### docs/FEDERATION.md
- Fate: rewritten
- Manifest: slug `federation` · title "Federation" · section reference · summary "federation.yaml fields and who reads them, the lineage stamp, sync, drift report, .well-known, the map" · covers `federation.yaml`, `scripts/sync-upstream.mjs`, `scripts/analyze-instances.mjs`, `scripts/validate-identity.mjs`, `scripts/generate-all-schemas.mjs`, `packages/org-os-kms/src/federate.mjs`, `packages/org-os-kms/src/frontier.mjs`, `packages/org-os-kms/src/map.mjs`, `schemas/federation.yaml`
- Changed:
  - Dropped "Federation Protocol Specification v3.0": the manifest in this repo is `version "0.5"` / `spec "organizational-os/0.5"` (written from package.json by clone-framework stage 6); no script reads `spec`.
  - Field reference rebuilt from the real file and a "Read by" column from grepping the consumers; fields nothing reads are said so (`trust`, `sync_direction`, `remote_name`, `heartbeat_interval`, `proactive`, `governance`, `platforms`, `hats`, `onchain_registration`).
  - Corrected: `customizations[].maintain_on_sync` does not protect paths (sync-upstream only counts them; the update is `git pull --rebase upstream main`, not a merge); the validators do not check enums; required set is what validate-structure section 6 and validate-identity actually enforce.
  - Added what the code does that the page lacked: lineage stamp, the 10 sync-upstream stages, `analyze:instances`, `federate frontier`/`render map`, what clone-framework writes.
  - Cut sections for unbuilt things into one "Not built" list: knowledge exchange protocol (no `federation-sync.mjs`, no `knowledge-exchange` package, `knowledge-commons` only displayed), koi-net trust tiers and rate limits, skill sharing protocol, hub `nodes.yaml`/aggregator/system-canvas, federation roles, "npm run setup configures federation" walkthrough.
  - Replaced the wrong hatching lifecycle (`idea -> proposal -> project -> archived`) with the one in the header of `data/ideas.yaml`, marked hatched-downstream wiring as a convention.
  - Replaced the minimal manifest by the shape clone-framework emits; ran it through validate-identity in scratch.
  - Title line made plain; links made relative.
- Checked: read `federation.yaml`, `scripts/generate-all-schemas.mjs`, `validate-identity.mjs`, `validate-structure.mjs` §6, `sync-upstream.mjs` (whole), `analyze-instances.mjs`, `clone-framework.mjs` stages 3, 6, 6c, `initialize.mjs` loaders, `sync-packages.mjs`, `packages/org-os-kms/src/{cli,federate,frontier,map}.mjs`, instance-doctor `checks/machinery.mjs`, `checks/lineage.mjs`; grepped for every field name across scripts/ and packages/*/src; `ls packages` (no aggregator, knowledge-exchange, system-canvas, web3); ran validate-identity on the minimal manifest in `scratch/U08`.
- Not verified: `federate add`/`check` (delegate to `packages/toolkit-framework` `federateAdd`/`federateCheck`; described from the CLI dispatch only, not run); koi-bridge behaviour (pointed at its README, not read); `.github/workflows/generate-schemas.yml` was read, not run.

### docs/EIP4824-GUIDE.md
- Fate: rewritten
- Manifest: slug `eip4824` · title "EIP-4824" · section reference · summary "The .well-known files org-os generates, from what, how they are checked, and what is not built on-chain" · covers `scripts/generate-all-schemas.mjs`, `scripts/validate-identity.mjs`, `.well-known/`, `.github/workflows/generate-schemas.yml`
- Changed:
  - Replaced the "MUST implement" required-fields claim and the validation list (it claimed URI reachability, JSON-LD context and required-field checks; the validator only parses seven files and checks `@context`+`name` of dao.json).
  - Added the table of the ten files the generator writes, with real sources (`dao.json` only when `identity.daoURI` is set; `members.json` publishes ids only; `type` of dao.json is `identity.type`).
  - Stated that `ideas.json`/`knowledge.json` are not linked from dao.json and that `/governance` is not generated.
  - On-chain: `../packages/web3/on-chain-registration/` does not exist; no contract, no deploy script, nothing reads `onchain_registration`/`hats`; said "Not built". Removed unsupported DAOstar/Snapshot/Tally integration claims.
  - Removed dead references to `organizational-os-framework/...` and "GitHub Actions on data changes" kept (it is real: `generate-schemas.yml`).
  - Published a real publishing sequence (set daoURI, generate, validate, commit `.well-known/`, push).
- Checked: ran `generate-all-schemas.mjs` and `validate-identity.mjs` on a copy in `scratch/U08` (10 files generated, 14 checks passed, dao.json rendered from the template); read the workflow; `git ls-files .well-known`; `find` for .sol/hardhat/web3 (none); grep for `onchain_registration`/`updateDaoURI` consumers (none).
- Not verified: that external indexers (DAOstar) accept the generated files (no network checks).

### Review fixes (second pass)
- FEDERATION.md: sync:upstream now documents `--yes` (bare command only reports and exits 0; no prompt; `--dry` does not fetch); org-os-kms commands now `node packages/org-os-kms/src/cli.mjs ... --dir .` with the caveat that the package must be present; validate:schemas file list named exactly; ring 3 source file is `data/source-systems.yaml`; "passes both validators" narrowed; added validate:structure well-known/framework_version requirements, update-version.mjs, check:divergence, frontier over peers/upstream/downstream; instance doctor linked to INSTANCE-DOCTOR.md.
- EIP4824-GUIDE.md: title line `# EIP-4824`; validate:structure well-known requirement added.
- Verified against sync-upstream.mjs 112-147 and validate-structure.mjs 135-161. Not verified: whether an instance carries packages/org-os-kms/.

## U09 — Skills and packages reference
Checked at: 6ac4d4adcef6005a559f80cc4b05a86b668f9deb

### docs/SKILL-SPECIFICATION.md
- Fate: rewritten
- Manifest: slug `skill-specification` · title "Skill specification" · section reference · summary "SKILL.md layout, the frontmatter fields that exist, and how skills are discovered and indexed" · covers `skills/, scripts/lib/discover-skills.mjs, scripts/generate-skills.mjs, scripts/sync-commands.mjs, scripts/sync-skills-berd.mjs, SKILLS.md`
- Changed: 8 claims corrected or removed. Required-field table (version/triggers/inputs/outputs "required") replaced by counts of fields actually present (triggers/inputs/outputs in 9 of 35, tier in 9, version in 31) and a statement that only a frontmatter block, name and description are read; "9 core skills" list corrected (tier: core is on a different nine; skill count 36); `federation.yaml skills.shared` block removed (not in the file, read by nothing); sync:upstream route qualified; discovery section rewritten from discover-skills.mjs/generate-skills.mjs (anomalies, unmapped, commands); skills/commands explained; invented custom-skill YAML examples (cooperative-ops, governance-facilitator) dropped; "5 sessions" promotion rule moved out (see SKILL-PROMOTION).
- Checked: counted skills/*/SKILL.md (36), parsed all frontmatter with a script (field counts), name==dir for all 35, read discover-skills.mjs parser (line regex), generate-skills.mjs, grep for readers of triggers/tier (none), federation.yaml agent.skills + initialize.mjs/clone-framework.mjs readers, heading counts in SKILL.md bodies, sync-skills-berd.mjs header, sync-upstream.mjs header.
- Not verified: that runtimes (Claude Code, OpenClaw) use `description`/`metadata.openclaw` as stated; marked as convention, not enforced.

### docs/SKILL-PROMOTION.md
- Fate: corrected
- Manifest: slug `skill-promotion` · title "Skill promotion" · section reference · summary "How a skill moves from an instance into the framework, and what the skills matrix records" · covers `data/skills-matrix.yaml, scripts/validate-structure.mjs, scripts/analyze-instances.mjs, scripts/check-divergence.mjs`
- Changed: 7 claims corrected. Added statuses table (validator list of five); `analyze:instances` description corrected (it reports undeclared_skill/unmapped_skill, does not count instances); candidates table replaced (research is now canonical; five dao-os candidates, matrix counts 32/4/5/1); two links to sibling-instance repos made plain text (untracked); script-divergence table marked historical/not re-verified; knowledge-aliases.yaml claim corrected (not shipped); promotion-sync step names doctor sync.
- Checked: python over data/skills-matrix.yaml (42 entries, statuses, in_framework vs disk), validate-structure.mjs check 9, analyze-instances.mjs lines 150-175, check-divergence.mjs (`--help` run: no instances), DECISIONS.md F4 entry, CHANGELOG [0.5.0] known issues.
- Not verified: the known-divergences hashes and instance states (need sibling instance checkouts); marked in the page. Ledger item counts (TF-1..6, ~18) not checked (ledgers live in other repositories).

### docs/PACKAGES.md
- Fate: rewritten
- Manifest: slug `packages` · title "Packages" · section reference · summary "The 22 packages under packages/, what each is, its matrix status, and how an instance gets one" · covers `packages/, data/packages-matrix.yaml, scripts/sync-packages.mjs, scripts/clone-framework.mjs`
- Changed: about 30 claims removed or corrected. The conceptual registry (knowledge_base, meetings, projects, finances, coordination, webapps, web3, egregore; package.yaml; check:updates / update:package(s); version pinning in federation.yaml; egregore git submodule; "Chains supported"; React/Fastify stack; package combinations) removed: none exists. Replaced by a table of the 22 real directories with matrix lifecycle/promotion and one line each from README/package.json/matrix notes; added sections on how an instance gets a package, layout reality, and a note on what was removed. Deprecation banner dropped (the page is now current).
- Checked: `ls packages` (22), package.json/README presence loop, matrix vs disk (admin, cloudflare-os-integration, multica-bridge unlisted; dashboard in_framework false but present), package READMEs, module.yaml package pointers (4 of 5 modules; berd none), grep package.json for the removed scripts (absent), `find packages -name package.yaml` (none), federation.yaml packages map vs sync-packages.mjs (dry run against scratch dir: "meetings" errors, webapps and instance-doctor copy), setup-org-os.mjs options.
- Not verified: README claims about each package's behaviour are repeated from the READMEs/matrix notes, not run (agents-app, paperclip-agents-app, hermes, opencode, koi, regen-agents).

### docs/PACKAGE-LIFECYCLE.md
- Fate: corrected
- Manifest: slug `package-lifecycle` · title "Package lifecycle" · section reference · summary "How a package is registered, promoted into the framework, delivered to instances and retired" · covers `data/packages-matrix.yaml, scripts/sync-packages.mjs, scripts/validate-structure.mjs, scripts/clone-framework.mjs`
- Changed: 8 claims corrected. Added which statuses are validated (lifecycle_status only) and current counts; the version-pin step removed (nothing resolves it); "when autopoiesis Phase 2 lands" replaced (sync:upstream exists and runs sync:packages); sync:packages requirement that the key be a real directory added with the failing-meetings example; clone path added; retirement marked as unenforced policy; matrix gaps listed; check-divergence scoped to scripts.
- Checked: validate-structure.mjs lines 344-370, sync-packages.mjs full read, tests/sync-packages.test.mjs (5 pass), clone-framework.mjs stage 5, sync-upstream.mjs header, python counts over the matrix.
- Not verified: "graduate to npm" thresholds (policy); the promotion workflow steps are policy, not executed.

### Review round 1 (fixes applied)
- PACKAGES / PACKAGE-LIFECYCLE: now state that `federation.yaml` has `knowledge_base: true` (other keys false) and that `sync:packages` fails on it today; `npm run setup` still writes the conceptual keys; egregore-core described as an adapter script plus README; matrix-gap sentence for the eight entries without directories; `active` wording flagged as differing from the matrix header.
- SKILL-PROMOTION / SKILL-SPECIFICATION: `doctor sync` removed as a route for skills (overlay.mjs FRAMEWORK_OWNED = scripts/, templates/); real routes are clone and `sync:upstream`. Instance feedback ledger section (unverifiable sibling-instance detail) cut to the F4 decision readable in DECISIONS.md/CHANGELOG. Readers of frontmatter and sync-commands targets/collision corrected. Ledger entry "Not verified" for the ledgers is now moot (content removed).

## U10 — The knowledge management system (Knowledge)
Checked at: 214e2e4d06eed1f646c26ae938cb0d0c858af99f

### docs/KMS.md
- Fate: new
- Manifest: slug `kms` · title "The knowledge management system" · section knowledge · summary "What org-os-kms adds to an instance: kms.yaml, the store, an entry's life, the commands, where state lives." · covers `packages/org-os-kms/src/cli.mjs, packages/org-os-kms/src/config.mjs, packages/org-os-kms/src/ops.mjs, packages/org-os-kms/src/bind.mjs, packages/org-os-kms/profile, packages/toolkit-framework/src`
- Changed: written from README, cli.mjs, config.mjs, ops.mjs, bind.mjs, executor.mjs, federate.mjs, registry-bridge.mjs, render.mjs, cursors.mjs, manifest.mjs, the framework's instance.mjs / storage.mjs / review.mjs / publishable.mjs / invariants.mjs / schemas/review-maturity.yaml and the clone's stage 7b. Status `in-dev` taken from `site/src/data/modules.yaml` (read only).
- Checked: ran in `scratch/U10/` (a canon, a plane, a plain instance): `init`, `lifecycle initialize`, `lifecycle close`, `render`, `render site` path, `ingest --dry`, `bridge`, `publish --dry`, `publish` (with and without `publish.base_url`), `promote`, `federate <bad>`; `node packages/org-os-kms/src/cli.mjs --help` (unknown verb, exit 1); `node --test` in the package (431 tests, 430 pass, 1 skipped); every relative link target exists.
- Not verified: `toolkit-framework ingest prepare` and the agent skills named in "Capture" were read, not run. `kb-folder` layout taken from the adapter source, not run. `federate add/check/contribute` read from source and tests, not run.

### docs/KMS-PLANES.md
- Fate: new
- Manifest: slug `kms-planes` · title "The two planes and the publication gate" · section knowledge · summary "Canon and public plane, the publication gate and its refusal reasons, export, validate, re-gating." · covers `packages/org-os-kms/src/planes, packages/org-os-kms/src/gate.mjs, packages/org-os-kms/src/ops.mjs`
- Changed: written from `src/planes/*` (publication-gate, role, paths, export-commons, validate-commons, validate-published-kb, write-published-kb, public-fields, select-for-publication, safe-write, kb-loader, kms-config), the `publish` and `ingest.pull` ops, `scripts/clone-framework.mjs` stage 7b, and `test/planes/`. Refusal reasons are quoted from the code.
- Checked: ran a scratch canon (`scratch/U10/canon`) and plane: `export` (5 skipped with reasons: `maturity is draft`, `held prefix: repos/Corpus/private/`, `no source_lineage`, `unresolvable source_lineage: …` for a URL and for an unregistered repo), `validate` before and after fixing the plane's self card (the three `init`-card errors), a hand edit in the plane (`published copy diverges…`), an unallowlisted canon field (`canon field(s) not on the public allowlist`), `public_fields` extension and the private-field refusal, `publish` in canon (refused), plane `--dry` (regate clean), `ingest` in a plane (refused), a hold added in the canon after export (plane `publish` refused with `regate` failed). A probe script (`scratch/U10/gate-probe.mjs`) called `isPublishable` on 24 shaped objects and every quoted reason string came from its output. `node --test test/planes/*.test.mjs`: 226 pass.
- Not verified: the symlink and hard-link refusals of `export` were read from `export-commons.mjs` / `safe-write.mjs` and their tests, not reproduced by hand. The `canon-not-found` branch was read from `ops.mjs` and `role.test.mjs`, not reproduced. The sequence's commit steps were reasoned from which files `export` and `publish` write (git itself not run in scratch).

### packages/org-os-kms/docs/CONNECTORS.md
- Fate: corrected
- Manifest: slug `kms-connectors` · title "Connectors, ingest and publishing" · section knowledge · summary "Pulling from AT Protocol and static sources, publishing to a server and a static surface, standard.site." · covers `packages/org-os-kms/src/connectors, packages/org-os-kms/src/atproto, packages/org-os-kms/src/executor.mjs, packages/org-os-kms/src/cursors.mjs, packages/org-os-kms/src/static`
- Changed (about 14 claims):
  - title no longer says "(operator guide)"; intro no longer asserts everything was checked, and tells the reader the CLI has no `--help`;
  - exit codes: `validate` also exits 1 on `ok: false` (`FAIL_ON_NOT_OK` in `cli.mjs`);
  - `lifecycle close` from the CLI stops at `bridge` (reproduced); section now says so;
  - removed the `regen-toolkit` examples (§2, §12): no such instance in the repository;
  - `.well-known` list: added `site.standard.publication` and fixed "three files" wording;
  - §7: `atproto.did` is merged as `self`;
  - §8: removed "no instance in this plan activates it"; the claim that every re-pulled record is flagged `updated at origin` was stale (unchanged records are skipped via `sameContent`); the "reviewed + ai_assisted can never receive updates" claim replaced by what the code does (the incoming `ai_assisted` is dropped);
  - §9: the "Correction" that `sameStoredObject` does not exist was wrong on this branch (`toolkit-framework/src/util.mjs` exports it); replaced with what the adapter does;
  - §3: made explicit that plain `publish` applies the framework floor only, not the canon gate (reproduced: a `draft` published); added `types_opt_out`;
  - §13: the "A pack cannot…" list replaced with what the loader reads;
  - §14: the bridge path is `src/content/docs/kb/<slug>.md`;
  - "Two planes": rewritten as a summary that matches the code (full gate description, `planes.canon` is not read, hard links also refused) and points to KMS-PLANES.
- Checked: read `ops.mjs` (publish, ingest.pull), `executor.mjs`, `connectors/index.mjs`, `connectors/static-json/*`, `atproto/connector.mjs`, `atproto/publish.mjs`, `atproto/standard-site.mjs` (limits, FIELD_MAP, TID derivation, plan/apply order, manifest state), `atproto/client.mjs`, `cursors.mjs`, `identity.mjs`, `manifest.mjs`, `registry-bridge.mjs`, `static/surface.mjs`, `extensions.mjs`, framework `connector.mjs`, `pack-registry.mjs`, `index.mjs registerPack`; ran `ingest --dry`, `publish`, `bridge`, planes verbs in scratch; package tests 431 pass.
- Not verified: AT Protocol behaviour against a real server (no network commands run; the PDS interaction was read from `client.mjs` and the fake-client tests); the lexicon DNS TXT step (§11) and the standard.site verification steps (§14, site side) are conventions of those protocols, flagged in the page as not checked by code; "vendor pinned to a tag" (§6) is guidance, not code. The pack-connector execution claim (§13) was read from `loadPackConnectors`, not run.
- Note for the controller: the page links to `../../../docs/KMS.md` and `../../../docs/KMS-PLANES.md`, which are untracked until this unit is committed. Two code problems are listed in the report.

### Review round 1 fixes
- KMS-PLANES.md: added a boxed warning after the intro (plain `publish` applies only the framework floor; reproduced again in scratch: a `draft` with `ok-with-caveat` was published to `public/api/resource.json`), a safe sequence, and a command-by-command, plane-by-plane table of which check runs where (export/validate fail with `no public plane is configured` outside a canon: reproduced). Fixed the closing bullet: the canon gate runs in `export`, `validate` and a plane's `publish` re-gate. Added the base_url note to the sequence.
- KMS.md: `framework` key marked informational; "item 3" wording; `publish` row cross-references the warning.
- CONNECTORS.md: sibling-instance example replaced with Example Commons / example.org.
- Links to KMS-EXTENSION-PACKS, TERRITORY-PACK, KMS-PUBLISHING, FEDERATION-MAP added in all three pages; all relative targets exist.

## U11 — Knowledge: extension packs and the territory pack
Checked at: 4b1151e060ed4b064eedd41347b832da923d6819

Two pages, not one: the pack mechanism (any pack, how to write one, what it changes and cannot change) and the territory pack (its entity types, query library, sidecar, demo, explorer) have different readers and different code; the second would be a thin appendix inside the first.

### docs/KMS-EXTENSION-PACKS.md
- Fate: new
- Manifest: slug `kms-extension-packs` · title "Extension packs" · section knowledge · summary "How a pack adds typed objects to the knowledge system, how to enable one, how to write one" · covers `packages/org-os-kms/src/extensions.mjs, packages/org-os-kms/src/bind.mjs, packages/org-os-kms/src/static/surface.mjs, packages/toolkit-framework/src/index.mjs, packages/toolkit-framework/src/publishable.mjs`
- Changed: written from the code. Mentions in plain text (not linked, not yet tracked): docs/KMS.md, docs/KMS-PLANES.md, docs/KMS-PUBLISHING.md.
- Checked: read extensions.mjs, bind.mjs, config.mjs, planes/kms-config.mjs, static/surface.mjs, ops.mjs (publish, ingest), cli.mjs verbs, toolkit-framework registerPack / extensionEntities / toJsonLdContext / optInTypes, pack-registry.mjs, scripts/clone-framework.mjs (kms.extensions validation, stage 7b), federate.mjs (peer_extensions). Ran `node --test` on extensions.test.mjs and packs-e2e.test.mjs (22 pass). Ran bridge and publish (no PDS) in scratch/U11/inst: got data/territorial-units.yaml, public/api/territorial-unit.json, context.jsonld terms, .well-known/extensions.yaml, a minted id written into data/kb. Compared package.json versions (framework 0.3.0, kms 0.1.0) with the requires check.
- Not verified: the AT Protocol side (collections written to a PDS, connector listing peers' pack collections) is read from source and the fake-client test only; no network command run. Export's "pack loaded only after the commons is confirmed" is from a code comment, not run.

### docs/TERRITORY-PACK.md
- Fate: new
- Manifest: slug `territory-pack` · title "The territory pack" · section knowledge · summary "territorial-unit and data-stream: the worked extension pack, its query library, demo and explorer" · covers `packages/org-os-territory`
- Changed: written from README, pack.yaml, schemas, src, tests, demo and explorer sources. Status stated as pilot/not adopted (data/packages-matrix.yaml: evaluating, dormant, instances_using empty).
- Checked: read schemas/*.yaml, extension-entities.yaml, profile.yaml, src/units.mjs, src/overlaps.mjs, demo/sample.mjs and render.mjs section list, explorer/tour.mjs and build.mjs. `node --test` in org-os-territory: 71 pass. Built demo (--skip-suites) and explorer into scratch: both wrote a file. Ran the bridge/publish sequence in scratch.
- Not verified: the built demo and explorer pages were not opened in a browser; the "no instance adopts it" statement is the packages matrix's, not independently checkable.

Review round 1: fixed `base_url` in both kms.yaml snippets; plain `publish` described as writing public/ and minting ids (--dry, --apply, static:false); CLI invoked as `node packages/org-os-kms/src/cli.mjs`; "nothing imports units.mjs" corrected to demo/explorer/tests only; connector collision moved out of load errors; objectsIn throws on unknown unit_id; first-person and "this branch" wording removed; clone config line added.

## U12 — Publishing and the federation map
Checked at: 4b1151e060ed4b064eedd41347b832da923d6819 (HEAD when started; the brief named 214e2e4, an ancestor of it)

### docs/KMS-PUBLISHING.md
- Fate: new
- Manifest: slug `kms-publishing` · title "Publishing from the knowledge system" · section knowledge · summary "publish: records on an atproto PDS, standard.site documents, the static surface, what it refuses" · covers `packages/org-os-kms/src/atproto/, packages/org-os-kms/src/ops.mjs, packages/org-os-kms/src/static/, packages/org-os-kms/src/manifest.mjs, packages/toolkit-framework/src/publishable.mjs`
- Changed: written from the source and tests. Deliberately did not copy `packages/org-os-kms/docs/CONNECTORS.md` (U10 verifies it); where they overlap every statement was re-read from `ops.mjs`, `atproto/*.mjs`, `publishable.mjs`, `planes/role.mjs`. Differences from CONNECTORS.md: this page says the password is read from `process.env` only (CONNECTORS.md section 11 says "in `.env`", but no code loads a `.env` file); it records the tag history honestly.
- Checked: read `src/atproto/{client,connector,publish,standard-site}.mjs`, `ops.mjs` publish op, `cli.mjs`, `config.mjs`, `manifest.mjs`, `gate.mjs`, `planes/role.mjs`, `static/surface.mjs` (head), `toolkit-framework/src/{publishable,lexicon}.mjs`, `bind.mjs` (close binding); `git for-each-ref` on the three `kms-atproto-v0.1*` tags; grep that no code writes `com.atproto.lexicon.schema` records; ran `node --test` on test/atproto-*.test.mjs, standard-site-op, publish-op, e2e-atproto (58 pass, 1 skipped = live e2e). Only fake-fetch tests; nothing contacted a network.
- Not verified: that the `kms-atproto-v0.1` tag (2026-09-19) followed a passing live-PDS run (its message is silent; rc1/rc2 messages say the run was pending) — stated on the page as unrecorded. The module status `in-dev` is taken from `docs/MODULES.md` and `site/src/data/modules.yaml`. Static surface internals beyond the files listed were not read line by line (only head of `surface.mjs`).

- Review fixes (second pass): added the static-surface failure (writeStaticSurface throws without base_url, after PDS writes; exit 1) and the configure-first order; narrowed the password-scrubbing claim to the login/network and standard.site errors; added grc20Id minting (identity.mjs, geo.space) and `.well-known/extensions.yaml` to the file lists; byte limits; verification file conditional; "no live run is recorded"; links to KMS-EXTENSION-PACKS.md and TERRITORY-PACK.md (tracked). KMS.md and KMS-PLANES.md remain plain text (not tracked).

### docs/FEDERATION-MAP.md
- Review fixes (second pass): bare `@org-os/federation-map` import replaced by the relative path with an explicit "not verified" note on the bare specifier and the dist bundle alternative; frontier throws on missing federation.yaml; aggregate wording corrected.
- Fate: new
- Manifest: slug `federation-map` · title "Federation map" · section knowledge · summary "map.json, the frontier fetch, the HTML artifact and the <federation-map> element" · covers `packages/org-os-kms/src/map.mjs, packages/org-os-kms/src/frontier.mjs, packages/org-os-kms/src/render-map-html.mjs, packages/org-os-federation-map/src/, site/scripts/aggregate-federation.mjs`
- Changed: written from source. The package README comment `render map --html` style usage is not used; the real CLI form is `render map html` (checked in `cli.mjs`).
- Checked: read `map.mjs`, `frontier.mjs`, `render-map-html.mjs`, `cli.mjs` render/federate branches, all of `org-os-federation-map/src` (element, parse, sim; svg.mjs grep), `site/scripts/aggregate-federation.mjs`, `site/src/components/FederationMapIsland.astro`, `site/package.json` build script. Ran in scratch (`.superpowers/.../scratch/U12/inst`, a copy of `federation.yaml` and `data/ecosystems.yaml`): `render map` (12 nodes, 9 edges) and `render map html` (wrote map html and portals note). Ran the package tests (19 pass) and kms map/frontier/render-map-html/cli tests (26 pass).
- Not verified: `federate frontier` was not run (it can fetch from raw.githubusercontent.com); described from source and `frontier.test.mjs`. Pointer interactions (drag, wheel, hash focus) read from source, not exercised in a browser. "Only the maintainer has run it" follows the repository's single-operator scope, not a measurement.

## U13 — Modules
Checked at: 33668237a177ae86438a353cff75b0987ceb8e25 (HEAD when I started; the brief names 214e2e4d06eed1f646c26ae938cb0d0c858af99f, an earlier commit on the same branch)

### Required changes in site/src/data/modules.yaml (exact list; nothing else changes)
| id | field | old | new |
|---|---|---|---|
| rad-org-os | status | in-dev | planned |
| org-os-territory | status | in-dev | pilot |
| org-os-hermes | summary (optional, untested) | Local agent runtime + Telegram gateway, replacing OpenClaw. | Integration with the Hermes agent runtime: an org-os page tool and three slash-command skills. |

Both status changes are required by `site/test/modules-catalog.test.mjs`. Why: rad-org-os has no code (planned = specified, not built); org-os-territory is built, 71 tests, no instance uses it (pilot). Also check `site/src/data/rad-org-os.yaml` and `site/src/pages/modules/rad-org-os.astro` wording. No id or name changes.

### docs/MODULES.md
- Fate: corrected
- Manifest: slug `modules` · title "Modules" · section modules · summary "The catalog of org-os modules, each with what it is, how it works and a status." · covers `modules/`, `scripts/modules.mjs`, `packages/`, `skills/`, `site/src/data/modules.yaml`
- Changed:
  - title `# Modules` (was "the org-os v0.5 catalog"); intro no longer implies generation. `scripts/modules.mjs` is 70 lines, exports only `validateManifest()`, has no CLI and there is no npm script; the page is hand-written and says so. States that 5 of 20 entries have a manifest and that `data/modules.yaml` per instance does not exist.
  - instance-doctor: sync stage 5 is `overlay`, not `sync-upstream` (sync.mjs `planSync`); the 2026-08-28 sweep claim marked not reproducible; "acceptance runs in WS-H before the tag" replaced by what the repo shows (167 tests pass, no acceptance report recorded); link to INSTANCE-DOCTOR.md.
  - cloudflare-os: "86 tests green" corrected (84 pass in a UTC+2 timezone, 86 with TZ=UTC); live-verification claims marked as recorded elsewhere, not re-run; added that `proposeChange()` throws "M3 — not implemented".
  - berd: removed "verified live in the Berd app since 2026-08-20" as a standing claim (marked as recorded in docs/integrations/berd.md); `--check` run: 5 in sync; HEARTBEAT tally has no tick; added `npm run sync:agents`.
  - buzz: trimmed the status paragraph; `status` maps to `buzz channels list`; tally 0/5 in HEARTBEAT; live-relay claims marked not re-run.
  - paper: "<=3 metered calls" made exact (get_tokens, create_tokens, set_tokens); removed "twin of an instance's lint:brand" (no such script here); status text now says the token round trip was run (VERIFIED.md) and drawing a composition is the remaining gate; noted there is no `.mcp.json` in this repo.
  - standards: engine described as validate-only. federation: 5 downstream plus qualifiers (a sibling instance is a test instance, a sibling instance awaiting bootstrap). pm, funding, heartbeat: wording made exact (heartbeat `check` integration not built). knowledge: removed `@org-os/knowledge-commons` package (does not exist; only in a plan). Core tranche note: framework's own meetings and funding registries are empty.
  - website generator: allowlist is `docs-manifest.mjs`; federation aggregation is `site/scripts/aggregate-federation.mjs`; no command targets another instance.
  - kms: names the real package, connectors (`atproto`, `static-json`; no `radicle`, `geo`, `synthefy`), pointers to KMS pages. territory: link to TERRITORY-PACK.md and KMS-EXTENSION-PACKS.md; changed to `pilot` (built, 71 tests, no instance uses it). hermes: rewritten (a Python tool and three skills; Telegram gateway is not in this repo; "replacing OpenClaw" is a plan, `federation.yaml` still lists openclaw). admin: status text rewritten (packages/admin is on this branch; PR link and "not merged" removed; link to ADMIN-APP.md and the now-tracked design spec). ideas, members-hub: say what exists vs what the module will add; both stay `planned`. rad-org-os: status `planned`.
- Checked: ran `node scripts/modules.mjs list` (no output), read it in full; `ls modules packages skills`; read the five `module.yaml`; `node --test tests/instance-doctor/*.test.mjs` (167 pass); `npm run test:cloudflare-os-integration` (84/86, TZ=UTC 86/86); `node scripts/sync-skills-berd.mjs --check`; `node --test tests/buzz-integration tests/paper-integration` (119 pass); read `planSync` in sync.mjs; federation.yaml `downstream`; `packages/org-os-territory` tests (71 pass) and `pack.yaml`; `packages/org-os-kms/src/connectors/index.mjs`; `site/test/modules-catalog.test.mjs` (5 of 6 pass; the sixth is the expected rad-org-os mismatch).
- Not verified: every "live" status (pm, meeting-processor, funding, federation) rests on the maintainer using them; the framework's own registries are empty, so the code cannot show production use. Live-relay, Berd-app, Paper-desktop and Cloudflare verifications are recorded in other files and were not re-run. The 7-peer count and the 2026-08-28 sweep are as the page states.

### docs/RAD-ORG-OS.md
- Fate: corrected
- Manifest: slug `rad-org-os` · title "rad-org-os" · section modules · summary "The planned org-os distribution on Radicle: what is designed, what exists, what is not built." · covers `docs/RAD-ORG-OS.md`, `packages/cloudflare-os-integration/src/substrate/`, `schemas/federation.yaml`, `packages/org-os-kms/src/connectors/`
- Changed:
  - title plain `# rad-org-os`; status "planned"; stated that no Radicle code exists (the word appears only in a comment in memory-substrate.mjs, a blurb in scripts/render-templates.mjs and the schema enum value).
  - "the connector layer itself is not yet implemented" was stale: it exists (atproto, static-json) but has no radicle connector, not even the stub the design describes.
  - "`api.github.com` appears nowhere in the repo" was false: `GitHubSubstrate` calls it. "three GitHub-only workflows" was four.
  - substrate table: `proposeChange` is not built in either implementation (throws a plain `Error`); error set note; "shipped 2026-08" heading made non-dated; external Radicle facts (blocklist story, repo and node counts, funding, 1.9.x primitives) marked as from the research note, not verified.
  - spec and research links made relative file links.
- Checked: grep for radicle (hits: the comment, the blurb, the enum) across scripts, packages, schemas, HEARTBEAT, projects.yaml; `schemas/federation.yaml` enum; substrate sources (`memory-substrate.mjs`, `github-substrate.mjs`); `.github/workflows/` (4 files); `data/projects.yaml` entry `rad-org-os`; HEARTBEAT items; `site/src/pages/modules/rad-org-os.astro` exists.
- Not verified: all claims about Radicle itself and the web-visible events; the capability-map "Later" items are exploration.

### docs/ADMIN-APP.md
- Fate: new
- Manifest: slug `admin-app` · title "Admin app" · section modules · summary "A local web page to edit an instance's data registries with forms; one git commit per save." · covers `packages/admin/`
- Changed: written from `packages/admin/` (README, server/, app/, schemas/, tests/) and the root `admin` scripts. Covers start-up (port 4680, 127.0.0.1 only, `INIT_CWD`, `--repo`, `--port`), the 14 registries (11 editable, 3 read-only), validation, how it writes and commits (`admin(<registry>): <verb> <id>`, current branch, one file, never pushes), safety properties and gaps, files, tests.
- Checked: read `server/index.ts`, `app.ts`, `registries.ts`, `registry.ts`, `schema.ts`, `git.ts`, `watcher.ts`, `app/src/api.ts`, `ws.ts`, `YamlField.tsx`, `RegistryPage.tsx`, the design spec headings; counted 47 test cases by grep; confirmed in a scratch stand-in script (npm 11.17) that one `--` drops flag names through the root script's second npm call and two `--` pass them, and documented the two-`--` form.
- Not verified: the server was not started and the test suite was not run (package dependencies are not installed here; installing needs the network). Behaviour such as 403/422 statuses and commit contents is read from source. The cross-site request risk is stated as untested.

### Code problems (not fixed)
- `scripts/modules.mjs` header comment lists `list | add | adopt | registry` commands and "Phase 1"; the file implements none of it (70 lines, exports `validateManifest` only).
- `packages/cloudflare-os-integration/test/parse-helpers.test.mjs`: two `daysUntil` tests fail outside UTC (UTC+2: 84/86); pass with `TZ=UTC`.
- `MemorySubstrate.proposeChange` / `GitHubSubstrate.proposeChange` throw a plain `Error`, indistinguishable from an upstream failure once writes are wired (the code's own comment says so).
- `npm run admin` cannot take `--repo`/`--port` with a single `--` (the root script re-invokes npm); needs `-- --`.
- Radicle: no `radicle` connector stub exists although `docs/superpowers/specs/2026-07-19-org-os-kms-connector-layer-design.md` says four stubs are registered.
- `modules/org-os-instance-doctor/module.yaml` check `npm run doctor -- --help` passes, but `site/src/data/modules.yaml` hermes summary is stale (see top).

### Review fixes (second pass)
- ADMIN-APP.md: start section now says run from the framework checkout (instances do not receive packages/admin: `scripts/lib/clone-excludes.mjs`, `scripts/selftest.mjs`), `npm run admin -- -- --repo <instance>`.
- MODULES.md: territory `pilot`; the three bare `live` lines now state their basis; the four live statuses declared unverifiable from the code; links to KMS.md, KMS-PLANES.md, KMS-PUBLISHING.md, FEDERATION-MAP.md; radicle.dev; "exports validateManifest() and three constants"; test-count wording.
- RAD-ORG-OS.md: "finds nothing" replaced with the three actual mentions.
- Code problem to add: `data/packages-matrix.yaml:53` says the territory pack has 18 tests; it has 71.

## U14 — Modules: integration pages
Checked at: 33668237a177ae86438a353cff75b0987ceb8e25

### docs/integrations/berd.md
- Fate: rewritten
- Manifest: slug `berd` · title "Berd integration" · section modules · summary "Berd personas and a curated skills bridge into .agents/skills/: what is verified, the sync commands, the drift gate." · covers `modules/org-os-berd, scripts/sync-agents.mjs, scripts/sync-skills-berd.mjs, .agents`
- Changed:
  - Replaced a long source-reading log (Rust file names, function names, release dates) with a verification table (built / live-verified / exercised for real work / production use) and short dated statements.
  - Removed `/tmp/goose-skills.txt`, the `/Applications/...` binary path and "plan Task 5" session-log phrasing; the discovery probe is now described as "the goosed binary inside the installed Berd.app".
  - Kept the source-level discovery reasoning in one paragraph marked "recorded 2026-08-29, not re-read in this pass".
  - Added commands, flags, what each script writes, the `~/.agents/agents/` side effect, the manifest-as-exposure-list rule and the worktree caveat.
  - Dropped the claim that the Goose commit `063694cf7` / Berd v0.6.2 pin is documented in the design spec (the spec does not contain them); v0.6.2 is kept only as the version of the 2026-08-29 live run.
- Checked: `modules/org-os-berd/module.yaml`; `node scripts/sync-skills-berd.mjs --check` (5 in-sync); `scripts/sync-skills-berd.mjs` and `scripts/sync-agents.mjs` headers and flags; `package.json` scripts `sync:agents`, `sync:skills:berd`; `scripts/selftest.mjs` lines 136-143 (skipKey berd); `.agents/agents/`, `.agents/skills/` listing; `HEARTBEAT.md` tracker and worktree known issue; `docs/MODULES.md` entry; `DECISIONS.md` 2026-08-20 entry.
- Not verified: the 2026-08-20 and 2026-08-29 live runs (need Berd.app; taken from `HEARTBEAT.md`, `docs/MODULES.md`, stated as the maintainer's runs); Berd and Goose source claims in "Why .agents/skills/" (external repositories; marked as not re-read). `sync:agents` was not run (writes to the home directory).

### docs/integrations/buzz.md
- Fate: rewritten
- Manifest: slug `buzz` · title "Buzz integration" · section modules · summary "Signed session digests to a Buzz relay on /close, read back on /initialize: setup, commands, verification." · covers `modules/org-os-buzz, packages/buzz-integration, tests/buzz-integration`
- Changed:
  - Restructured as status table, connections, setup, commands, outputs, hooks, contract.
  - Removed machine paths (`~/.local/bin/buzz`, `/Applications/Buzz.app/...`, `~/tools/buzz`), channel UUIDs, the maintainer's hosted relay address (now `https://<name>.communities.buzz.xyz`) and the machine-local `~/.claude/skills` surface row.
  - Replaced "Step 2b / 8b / 3b / 6b" step numbers with file names (only `initialize.md` Step 2b and `skills/initialize` Step 3b were confirmed).
  - Added: the `.env` variables including the code default `BUZZ_CHANNEL=org-os-dev` (which the CLI rejects, since it needs a UUID), doctor's 5-second probe, the marker-file behaviours, and the test count (62).
  - Kept the three-membership-planes explanation and the NIP-OA note, marked unexercised.
- Checked: `modules/org-os-buzz/module.yaml`; `packages/buzz-integration/{lib/buzz.mjs,scripts/*.mjs,VERIFIED.md}`; `node --test tests/buzz-integration/*.test.mjs` (62 pass, stub binary); `package.json` scripts; `.env.example`; `.gitignore` (`.buzz-state.json`); grep of the hook text in the six surface files; `HEARTBEAT.md` tracker; `docs/MODULES.md` entry.
- Not verified: the live local and hosted relay runs (taken from `VERIFIED.md`, stated with dates); the `deploy/compose` `run.sh` verbs and `add-member` (external repository, carried over from the old page); NIP-OA wiring (marked unexercised); the 0/5 dogfood tally is the `HEARTBEAT.md` figure, not re-counted.

### docs/integrations/paper.md
- Fate: corrected (substantially restructured; claims largely held)
- Manifest: slug `paper` · title "Paper integration" · section modules · summary "Push brand tokens into a Paper design file, lint drift, and draft compositions on the canvas." · covers `modules/org-os-paper, packages/paper-integration, tests/paper-integration, skills/paper-design`
- Changed:
  - Removed the real Paper file id and file name; removed the claim that "Task 10, drawing a composition, is the only remaining gate" without qualification: `VERIFIED.md` records a composition built on a real artboard on 2026-09-02, while the catalogue (`docs/MODULES.md`, `site/src/data/modules.yaml`, `data/skills-matrix.yaml`) still says the instance prototype is pending. The page now states both and says the repository records no sign-off.
  - `paper:call` exit-1-on-`isError` kept: confirmed in `scripts/call.mjs` line 85, which supersedes the "recorded not yet fixed" note in the `VERIFIED.md` reconciliation log.
  - Added test count (57), required-tool list, lookup order for `PAPER_FILE_ID`, the `set_tokens`/`set_text_content` note (row 23), and the facts from rows 16-17 and 19.
  - Dropped the per-host registration snippets for Cursor, Claude Desktop, Copilot and OpenCode (unverified, from Paper's docs); the page says they exist and are unexercised.
  - Dropped the unverified pricing line (Pro tier) and the list of 34 tool names beyond the five required.
- Checked: `modules/org-os-paper/module.yaml`; `packages/paper-integration/{lib/paper.mjs,scripts/*.mjs,VERIFIED.md}`; `node --test tests/paper-integration/*.test.mjs` (57 pass, stub server); `package.json` scripts; `.env.example`; `docs/MODULES.md`; `site/src/data/modules.yaml` (in-dev).
- Not verified: everything observed in Paper Desktop (stated as `VERIFIED.md` rows with date); the free-tier limit of 100 calls a week (Paper's pricing, from the old page and `.env.example`).

### docs/integrations/cloudflare-os.md
- Fate: rewritten
- Manifest: slug `cloudflare-os` · title "Cloudflare OS integration" · section modules · summary "Read-only gatekeeper that lets a Cloudflare OS workspace query org-os instances: capabilities, setup, verification." · covers `modules/org-os-cloudflare-os, packages/cloudflare-os-integration, scripts/page-shim.mjs`
- Changed:
  - The old page was a milestone-0 discovery log (D1-D7, "answers drive Tasks 13 and 18", a task checklist with empty "to be filled" sections, a path in the maintainer's home directory). Replaced with an operator page: what it is, a verification table, connections, the five capabilities and the envelope, setup in order, security posture, commands, what it writes.
  - Dropped the upstream-platform research (Cap'n Web, ambient singletons, blueprint archive format, approval-queue semantics) that cannot be checked in this repository; the parts the code relies on are described by what the code does.
  - Removed the maintainer's instance coordinates and branch from the setup text, the a home-directory path default of `sync-core.mjs`, and the deploy status "pending Task 1".
  - Stated the test result honestly: 86 tests, 84 pass; two `daysUntil` tests fail outside UTC.
  - Corrected: the old page claimed the gadget `rpc.mjs` is a three-line shim "confirmed against upstream"; it is marked here as read from source and not observed live.
- Checked: `modules/org-os-cloudflare-os/module.yaml`; `packages/cloudflare-os-integration/{README.md,package.json,src/**,blueprints/**}` including `capabilities.mjs`, `instances.mjs`, `github-substrate.mjs` (60,000 ms TTL), `context-bundle.mjs` (64,000-character cut, five decisions), `render-page.mjs` (`SUPPORTED_PAGES`, seven), `org-os.ts` (method names, `authorizeObservation`, unconditional `addObserver`), adapter `wrangler.jsonc`/`sync-core.mjs`; `npm run test:cloudflare-os-integration` (84/86) and again with `TZ=UTC` (86/86); `npm run page -- decisions` runs.
- Not verified: the 2026-08-08/09 local-stack runs, the live GitHub reads and the model-provider check (from the adapter README; stated with dates); upstream Cloudflare OS behaviour; the starter fork URL and deploy page.

### Notes for the controller
- Fates: berd rewritten, buzz rewritten, paper corrected, cloudflare-os rewritten.
- `modules.yaml` summary for org-os-buzz says "to a local Buzz relay"; the lane's home has been a hosted relay since 2026-08-29 (U13 owns `site/src/data/modules.yaml`).

### Review round 1 (fixes applied)
- cloudflare-os.md: capabilities now described as `session.instance(id).getX(...)` with `listInstances()` and binding `ORG_OS`; core envelope vs adapter return and throw documented (error code dropped); gadget shim step spells out the three adaptations and stays marked untested; setup step 2 gains `pnpm install && pnpm run-local` and the `GATEKEEPER_ORG_OS` / 200 check; upstream claims marked; `npm run page` note says it runs `initialize.mjs` (prints a "Checking Notion API" line).
- buzz.md: compose and `run.sh` / roster verbs marked as maintainer notes of the external repository, not re-read; upstream licence/preview claim marked; doctor-green evidence cited to `HEARTBEAT.md`.
- paper.md: instance `.env` is one directory above the `--tokens` file; row list uses the log's wording; 100-call limit marked as Paper's pricing, not checked; example token renamed `--example-color-blue`.
- berd.md: Tauri/Goose, pinned-commit and pull-request policy statements marked as upstream claims not checked.
- Open (other owners): `gadget.html` and `org-os.ts` still cite sections "§D4"/"§D7" of the old page; adapter README says it is mirrored into this page.

## U15 — Integrations: Egregore, Graphify, KOI, OPAL
Checked at: 48cf5dd07515bbaa6cb2e2ed00f4d5db936f69d2 (HEAD when started; the brief named 214e2e4d06eed1f646c26ae938cb0d0c858af99f)

### docs/integrations/egregore.md
- Fate: dropped (ruling: corrected file stays in the repository, not on the site; nothing an operator can run or configure)
- Changed:
  - Removed "Integrated & Active in a sibling instance", "production-ready", "Git submodule configured", the claimed `npm run setup` "Egregore-assisted" path, the federation.yaml block that nothing reads, the OPAL/KOI/MEMORY.md/HEARTBEAT integration claims, the `/decision` example, and the `(3 files)` count.
  - Stated what exists: README plus one 294-line CommonJS adapter, no tests, matrix status dormant; what is external (Egregore itself, its slash commands).
  - Documented adapter behaviour per method (files written, commit, env vars) from the source.
- Checked: read `opencode-to-egregore.js` in full; ran reflect/handoff/quest/activity through `handleAsk` in the scratch directory (files and commits created); `git ls-files` and grep of `package.json`, `federation.yaml`, `skills/`, `modules/`, `scripts/`, `.gitmodules` (absent) for Egregore; `data/packages-matrix.yaml` row.
- Not verified: whether any instance runs Egregore; upstream command behaviour (kept as plain statement that they are external).

### docs/integrations/graphify.md
- Fate: corrected
- Manifest: slug `graphify` · title "Graphify" · section modules · summary "Repo-local knowledge graph built by the external Graphify CLI; org-os reads it and tracks gaps." · covers `skills/knowledge-graph, scripts/graph-status.mjs, scripts/graph-gaps.mjs, graphify-out, .claude/commands/close.md`
- Changed:
  - Page was mostly accurate; replaced the diagram and roadmap with a command table, a what-is-committed table, and the live numbers (2,906 nodes, 4,678 links, one build of 355 files at 789,296 input tokens).
  - Moved phase-C and the queued follow-ups into a "Not built" section; noted `compile:knowledge` does not read the graph.
  - Removed the unverified "tree-sitter / Gemini key / no API key" claims and the "11 .sql files" figure was kept out (counted 11 tracked, but the claim's meaning is about extraction and cannot be checked without the CLI).
  - Added `graph:update`, `graph:status`, `graph:gaps` flags and the gap thresholds.
- Checked: `package.json` scripts; `skills/knowledge-graph/SKILL.md`; `.claude/commands/close.md` step 7; `AGENTS.md` query-first section; `.gitignore` lines 69-73; `git ls-files graphify-out`; `cost.json`; ran `npm run graph:status` and `node scripts/graph-gaps.mjs --test` (pass) and `--check`-equivalent path via the test; read both scripts.
- Not verified: upstream name, addresses, install commands (CLI not run, no network); marked in the page.

### docs/integrations/koi.md
- Fate: dropped (ruling: corrected file stays in the repository, not on the site; nothing an operator can run or configure)
- Changed:
  - Removed the topology diagram, "planned commands" table, federation.yaml block (no code reads it), RID type table of examples, latency target, effort estimate, sibling-repository file references and the unverified coordinator URL.
  - Replaced "skeleton, implementation not started" with what the source shows: about 840 lines, RIDManager and EventManager complete, HTTP client written to assumed endpoints, git-sync only emits local events, CLI prints text, no tests, no jest config.
  - Added `koi-opal-bridge` (separate package, design sketch; README lists files that do not exist).
- Checked: read every file in `packages/koi-bridge/src`, `package.json`, README; `tsc --noEmit` in the package (fails only on uninstalled `commander`/`node-fetch`); listed `koi-opal-bridge` tree and read its cli, adapter, orchestrator; grep for KOI in root scripts/skills/modules/federation.yaml; matrix rows.
- Not verified: KOI-net coordinator API (endpoint names are the package's assumption); no install or run was done (needs network).

### docs/integrations/opal.md
- Fate: rewritten (published, framed as a status page: do not rely on it yet)
- Manifest: slug `opal` · title "OPAL" · section modules · summary "OPAL is external; the bridge lives in integrations/opal and its core is a stubbed skeleton." · covers `integrations/opal, packages/opal-bridge, packages/koi-opal-bridge`
- Changed:
  - Corrected the location: the code is `integrations/opal/`, not `packages/opal-bridge/` (which holds a deploy script and a CI file only).
  - Removed "Complete & Ready", `setup` command and `--opal-path/--profile` flags (not in the CLI), "23 commands", the `4,053 lines / 15 test files / full coverage` figures (counted: 5,680 lines in src+tests, 2 test files), the federation.yaml block under `knowledge-commons` (the CLI reads a top-level `opal-bridge` key), the "egregore:" commit diagram and unverified output destinations.
  - Documented each CLI command's real behaviour (regex extraction, stubbed review/approve/reject/ask) and the integration layer's modules, which the CLI does not call.
- Checked: read `src/index.ts`, `src/cli.ts`, `src/integration/index.ts`, grep of the integration modules for writes, `package.json`, `jest.config.js`, TESTING_SUMMARY; compared the two `deploy-to-node.sh` copies (differ); matrix and `federation.yaml` status.
- Not verified: the integration layer working end to end; the test suite (jest is not installed at the root, installing needs the network); OPAL's own commands and the expansion of its name (the bridge's `package.json` says "Open Protocol Agent Librarian", its README says "Open Protocol for AI Learning"; the page does not expand it).

### Review round 1 fixes
- opal: `npx` instruction replaced by `node integrations/opal/dist/cli.js` (npm link alternative); status-page opening added; `status` connected line explained as not a real check; per-type confidence; success-text note; matrix quote; attribution of omniharmonic.
- koi: RID derivation, line count (741), npx caveat on the hook, default coordinator URL in koi-opal-bridge.
- graphify: SQL-extra statements marked as unverified upstream; snapshot date; gaps step in /close.
- egregore: `packages.egregore: false` toggle and OpenCode init skill mention; activity returns success:false; npm test side effect.

## U16 — Concepts: architecture, agentic architecture, agent modes
Checked at: 48cf5dd07515bbaa6cb2e2ed00f4d5db936f69d2 (worktree HEAD; the brief named 214e2e4, an ancestor)

### docs/ARCHITECTURE.md
- Fate: rewritten
- Manifest: slug `architecture` · title "Architecture" · section concepts · summary "The six layers of the framework, what is in each, and why it is built from files" · covers `AGENTS.md, federation.yaml, data/, .well-known/, skills/, scripts/, packages/, modules/, .claude/settings.json, .github/workflows/`
- Changed:
  - Dropped the version/date/"Production-Ready" header and the v3.1 diagram: it showed a central knowledge-commons layer with OPAL/Egregore/KOI capture, Hub Sync, specialist/generalist/council agents, a hub with nine pilot nodes, Monday/Friday sync schedules, and Telegram/Discord/Gardens/Hats/Safe/Celo integrations. None is running code (`federation.yaml` has `knowledge-commons.enabled: false`; the only schedules are `drift.yml` weekly and `generate-schemas.yml` daily).
  - New diagram and six layers taken from the tree: identity+memory, registries (18 files in data/, 11 generated .well-known json, 8 schemas files), skills (36) and synced host commands, federation manifest and scripts that read it, knowledge, optional packages (22) and modules (5).
  - Added the design choices the code supports (pull-based `sync-upstream`, clone with genesis_commit, guard hook, draft-and-present) and an explicit "not built" section.
  - Honest-scope paragraph added; links to OVERVIEW, INSTANCE-DOCTOR, COMMANDS, KMS-EXTENSION-PACKS, TERRITORY-PACK and other tracked pages.
- Checked: `ls` of root, data/, schemas/, .well-known/, skills/, packages/, modules/; `package.json` scripts; headers of generate-all-schemas, sync-upstream, analyze-instances, check-divergence, sync-commands, sync-packages, modules, generate-skills, doctor; `.github/workflows/*`; `.claude/settings.json`; `scripts/hooks/pre-commit` and operator-setup.sh; `federation.yaml`; AGENTS.md; clone-framework (genesis_commit); every relative link with `git ls-files --error-unmatch`.
- Not verified: that `npm run initialize` prints peers from federation.yaml (taken from reading the loader in scripts/initialize.mjs, not from a run). docs/KMS.md, docs/KMS-PLANES.md, docs/KMS-PUBLISHING.md are untracked in this checkout and are mentioned as plain text.

### docs/AGENTIC-ARCHITECTURE.md
- Fate: rewritten
- Manifest: slug `agentic-architecture` · title "Agentic architecture" · section concepts · summary "The ten-step startup sequence, what an agent may edit, skills, personas and hosts" · covers `AGENTS.md, BOOTSTRAP.md, MASTERPLAN.md, skills/, .agents/, .claude/, .opencode/, .cursor/, scripts/sync-agents.mjs, scripts/sync-skills-berd.mjs, scripts/sync-commands.mjs`
- Changed:
  - Startup sequence corrected from 9 steps to AGENTS.md's 10 (the tenth is the parity check) and the order restated from AGENTS.md.
  - Replaced the invented "file roles / update frequency" table with the approvals AGENTS.md section 6 actually states; marks which files AGENTS.md does not name.
  - MASTERPLAN structure: the page showed a template with Workfronts/Safety Policy sections that no template has; now describes the scaffold (Mandate, Activations, Character) and the framework's own file.
  - Bootstrapping: removed the claim of a web form (BOOTSTRAP.md: none today); kept the six-topic interview.
  - Skills: kept only skills that exist; fixed the skill-format snippet away (spec lives in SKILL-SPECIFICATION); removed `cooperative-ops` and `governance-facilitator` skill examples (not skills in this repo); removed `sync:upstream` as the promotion route.
  - Agent Modes section replaced by the personas that exist (`.agents/agents/operator.md`, `upstream.md`), Berd sync scripts and skills bridge, kept from the old text after checking each script flag. Named modes in `.claude/agents/` removed: that directory does not exist and nothing reads such files.
  - Removed `ideas/` as an agent-writable directory (does not exist), the evaluation-metrics table (targets like "within 7 days" are not measured by any script except schema validation), the "Telegram MCP" list and the runtime list (OpenClaw/OpenCode runtimes replaced by a table of what is actually in the repo per host).
  - Added "Not built" (web form, modes, `.memory-sync.sh`, enforcement).
- Checked: AGENTS.md sections 1, 2, 6, 9; skills/*/SKILL.md frontmatter (bootstrap-interviewer, workspace-improver, idea-scout, org-os-init); BOOTSTRAP.md; templates/scaffold/MASTERPLAN.md headings; MASTERPLAN.md headings; `.agents/`, `.opencode/`, `.cursor/`, `.claude/`; scripts/sync-agents.mjs and sync-skills-berd.mjs headers and flags; modules/org-os-berd/module.yaml; scripts/selftest.mjs berd step; `.gitignore` (feynman); `.memory-sync.sh` absent (only a paperclip package file of similar name).
- Not verified: Berd loading the mirrored skills at runtime (stated as not observed, pointer to berd.md); `npm run graph:update` behavior without the graphify CLI (read from package.json only).

### docs/AGENT-MODES.md
- Fate: merged into docs/AGENTIC-ARCHITECTURE.md (the personas that exist, and a plain statement that the mode system was never built); the file is left in place, not on the site
- Manifest: (omitted)
- Changed: nothing in the file. Basis: `.claude/agents/` does not exist; `grep` for `governance-facilitator`, `content-processor`, `ideation-curator`, `aggregator-indexer`, `network-facilitator`, `cooperative-ops` finds them only in docs and plans, never in skills, scripts, packages or agent files. The `activation:` frontmatter is read by nothing.
- Checked: `ls .claude .agents .opencode`, repo-wide grep excluding node_modules.
- Not verified: nothing.

### Review round 1 (fixes)
- ARCHITECTURE.md: KMS, KMS planes, KMS publishing and Federation map are now relative links; docs/ADMIN-APP.md plain text (untracked; link later). The "not built" section now separates not built (knowledge-commons centre, council agent, schedules, chain/chat integrations) from `packages/regen-agents` (TypeScript, four specialists plus super-agent, no tests, nothing in scripts/ calls it; matrix says two instances use it, not confirmable here) and from dormant/draft `koi-bridge`, `koi-opal-bridge`, `egregore-core` (matrix lifecycle dormant, no tests, no caller). Added the openclaw/regen-eliza note and `regen-agents` in layer 6.
- AGENTIC-ARCHITECTURE.md: `/initialize` is backed by `initialize`, `/close` by `org-os-init`; personas sentence now says "framework's own personas are two Berd files" and notes `.opencode/agents/` (four vault-specific files, no names or paths repeated), added to the OpenCode row; AGENTS.md peer-references inconsistency noted in one clause.
- Verified: regen-agents README/src/matrix, koi/egregore READMEs and matrix, skills/org-os-init/SKILL.md line 38.

## U17 — Concepts: patterns, autoresearch, ecosystem
Checked at: 48cf5dd07515bbaa6cb2e2ed00f4d5db936f69d2 (HEAD when started; the brief named 214e2e4d06eed1f646c26ae938cb0d0c858af99f)

### docs/PATTERNS.md
- Fate: rewritten
- Manifest: slug `patterns` · title "Patterns" · section concepts · summary "Seven working conventions of org-os instances, each tied to where it is written and what enforces it" · covers `AGENTS.md, templates/AGENTS.instance.md, MASTERPLAN.md, HEARTBEAT.md, skills/commands/close`
- Changed:
  - Title and "discovered across deployed instances" framing replaced; added honest single-operator scope.
  - Startup sequence: nine steps starting at MASTERPROMPT.md -> the ten steps of AGENTS.md section 1 (no MASTERPROMPT.md exists in the framework).
  - Cut "evidence" bullets about ReFi DAO/BCN/Regen Coord (unverifiable from this repo).
  - Model tiers: kept as guidance (AGENTS.md section 3), said no script enforces it, model names dated.
  - Workfronts: HEARTBEAT.md does not use a "Workfront" template; stated.
  - Safety: pointed at AGENTS.md section 6; MASTERPLAN section 6 is a different (framework-dev) list.
  - Success metrics: kept; removed the "Immediate Next Actions" block (not in MASTERPLAN or template).
  - Auto-commit every 30 minutes: removed (no script or workflow); replaced by /close behaviour.
  - Cut "Living System" (no mechanism) and "Recommendations" (replaced by the clone route + walkup warning).
  - Federation: added that knowledge-commons is enabled:false and no workflow pushes skills.
- Checked: AGENTS.md sections 1-6; MASTERPLAN.md sections 5-6; HEARTBEAT.md headings; skills/commands/close/SKILL.md; skills/heartbeat-monitor/SKILL.md; federation.yaml; grep for Kimi/Big-Pickle/MASTERPROMPT/auto-sync across scripts, package.json, .github; package.json scripts (initialize, vault:snapshot, vault:audit).
- Not verified: that the patterns are used identically in sibling instances (not inspected; claims about them removed).

### docs/AUTORESEARCH.md
- Fate: rewritten
- Manifest: slug `autoresearch` · title "Autoresearch" · section concepts · summary "The workspace-improver skill: a manual improvement loop, how to run it, and what is not built" · covers `skills/workspace-improver, MASTERPLAN.md, data/skills-matrix.yaml`
- Changed:
  - Cut the autoresearch-to-org-os mapping table and design-principles padding; page now describes the one thing that exists (the skill) and how an operator invokes it (trigger phrases).
  - Removed claim that it runs in "scheduled autonomous sessions": federation.yaml proactive:false; the two scheduled workflows (drift, generate-schemas) do not run it.
  - Noted `ideas/` directory does not exist; added USER.md to the do-not-modify list (as the skill says).
  - Added "What is not built": no automated metrics, no schedule, no memory/ record of any run, empty sources/knowledge in the framework, MASTERPLAN lists autoresearch metrics as open.
- Checked: skills/workspace-improver/SKILL.md; grep "Autoresearch Session" in memory/ (none); .github/workflows schedules; package.json scripts named in the skill (compile:knowledge, lint:knowledge, validate:schemas, generate:schemas exist); data/skills-matrix.yaml (canonical, used by a sibling instance); knowledge/ (INDEX.md only); data/sources.yaml (empty).
- Not verified: whether the skill was ever run in a sibling instance (the instance was not inspected).

### docs/ECOSYSTEM.md
- Fate: rewritten
- Manifest: slug `ecosystem` · title "Ecosystem" · section concepts · summary "Org-os instances, related projects and external systems, as recorded in this repository" · covers `federation.yaml, data/instances.yaml, data/ecosystems.yaml, repos.manifest.json`
- Changed:
  - Restructured into instances / related projects / external systems; stated that every instance is run by the maintainer.
  - Links only for organisation-owned repositories whose address is recorded (regen-coordination, ReFiDAO, refibcn, organizational-os); personal-account repositories named in plain text; no local paths.
  - Removed entries with no record in the repository: regen-toolkit-interface, becoming-constellations, refi-vision-forum-posts, ReFi-DAO-Website, regen-coordination-hub (is a sibling instance), ecosystem-canvas, the organizational-os-framework/template layer rows and the ASCII flow diagrams.
  - Added instances missing before: regen-toolkit (nested), a sibling instance (fictional test), a sibling instance; dao-os marked a dev platform, not an instance.
  - Dropped the link to ECOSYSTEM-MAP.md in the maintainer's vault.
- Checked: data/instances.yaml, federation.yaml (downstream, integrations), data/ecosystems.yaml, repos.manifest.json, package.json repository field, git remote, ls integrations, packages/koi-bridge.
- Not verified: that the linked https addresses resolve or are public (no network use).

### Code / record problems (not fixed)
- `package.json` repository (organizational-os/organizational-os-template) vs git remote and federation.yaml hub (regen-coordination/org-os-template) vs repos.manifest.json (regen-coordination/org-os-framework, org-os-template) vs federation.yaml peers (organizational-os-framework): four different names for the framework repo.
- `data/instances.yaml` lists `local_path: ../…` sibling paths and an `openclaw` entry with repo null.
- `repos/README.md` says `pnpm run clone:repos`; the repo uses npm.
- Pages other units write, mentioned in plain text: none beyond tracked ones (FEDERATION.md, SETUP.md, SKILL-PROMOTION.md, VAULT-SAFETY.md, ADOPT-WITH-AN-AGENT.md, AGENTIC-ARCHITECTURE.md are all tracked and linked).

### Review fixes (second pass)
- ECOSYSTEM: personal-account notes and rows removed (ReFi-Barcelona, ecosystem-canvas dropped; grants-os named plain); a sibling instance line now states only `federation_role: hub` / `regen-coordination`; unrecorded descriptions replaced by "where it is recorded"; Framework repositories section added (repos.manifest.json + federation peers, records disagree); change-log line deleted.
- PATTERNS: AGENTS.md section 2 auto-sync noted as still describing a script not in the repo; "recorded disagreements" and "early 2026" removed; autonomous "federation.yaml peer references" added; title `# Patterns`.
- AUTORESEARCH: title `# Autoresearch`.
- Open: AGENTS.md section 2 should be corrected (outside this unit).

## After the content pass — 2026-10-11, the website steward

Not part of the seventeen units. Recorded here because the ledger is where the site says what it
checked and what it could not.

**The pages the content pass never read.** The home page, the modules page and the federation
page are not manifest pages and carry no `verified` stamp. The spec left the federation page
"unchanged apart from fresh data", so no unit read it. Read on 2026-10-11 from the built files:

- The federation page printed the `notes` field of `data/instances.yaml` whole for each of the
  eight instances, and marked every one "offline" because no sibling checkout exists at build.
  `federation.json` carried every registry field, notes included. **Changed** (`9bf41f2`): name,
  type and repository only; no status; the verifier now holds it.
- The home page said "8 instances", the row count of the registry. **Changed**: it counts the
  instances whose maturity is `production` (two today) and prints the definition.
- `map.json` held no registry notes (checked: `grep -c notes dist/map.json` → 0). It marked 32 of
  35 nodes `live: false`, which the map element prints as "unreached". **Changed**: the site drops
  the false flag when it writes the file.

**Checked, by command.** `npm run build` in `site/` prints `registry check: 24 private sentences
from data/instances.yaml looked for in 82 built files, none found elsewhere`.

**Could not check.** What the map element shows in a browser after the change; the panel's text
was read in `packages/org-os-federation-map/src/element.mjs:175` and not seen.

**Found, not fixed (not the site's to fix).**

- `docs/ECOSYSTEM.md:26` quotes the registry's description of `dao-os` ("a DAO-module development
  platform, not an operational instance"). The verifier names it as an allowed quotation and
  prints it on every build. Whether the sentence stays is `commons-steward`'s.
- `docs/FEDERATION-MAP.md:121` says the site writes `buildMap`'s result as it is and that
  `federation.json` is "the instance registry"; both changed in `9bf41f2`. The page covers
  `site/scripts/aggregate-federation.mjs`, so `npm run drift` reports it as drifted until the
  document is corrected and re-stamped. Handed to `commons-steward`.
- The federation page lists all eight registry entries, among them a test fixture and an agent
  runtime, by name and type. The operator's decision covers what is printed for each entry, not
  which entries are listed; a field that says which entries are public would be a change to
  `data/instances.yaml`, which is `engineer`'s.
- A fresh checkout needs three installs, not the two `roles/website.md` names (`7a872e3`).

## After the Part A review — 2026-10-11, the website steward

The reviewer passed Part A with three findings against the leak check; `commons-steward`
corrected the two documents named above (`ff97a7b`, merged here as `5a6563d`).

**The leak check, changed.** It now looks for three things (rules and reasons in
`site/README.md`, "The registry guard"): a whole sentence whatever its case; any 40 letters in a
row of a note, whatever stands between them; and the drift flags and local paths. Each file is
read as written and with its markup removed, with `\uXXXX` escapes decoded. The exception for
`docs/ECOSYSTEM.md` is gone, and no list of exceptions is left.

**Checked, by command.** `npm run build` in `site/` prints `registry check: 24 private sentences,
8 notes (any 40 letters in a row of one) and 14 flags and local paths from data/instances.yaml
looked for in 82 built files, as written and with markup removed: none found`. Thirteen
injections into the built home page, the reviewer's five among them: every one that should fail
the verifier does, the control passes, and the page was restored byte for byte.

**Could not check, or does not catch.**

- An excerpt shorter than 40 letters that is not a whole sentence passes: "resolve that tree
  before any propagation" (35 letters) was injected and the verifier exited 0. The length cannot
  drop to 32 while `docs/ECOSYSTEM.md` reads as it does (next list).
- One-word values that are ordinary words, dates, versions and booleans are not looked for.
- No test ran on old code case by case: the new test file imports a function the old code does
  not have, so against the old code it failed as a whole. The reviewer's table is the record of
  what the old code let through.

**`docs/FEDERATION-MAP.md`, read against the code and re-stamped at `5a6563d`.** The section "How
the project site uses it" was read beside `site/scripts/aggregate-federation.mjs`,
`federation-aggregate.mjs`, `installs.mjs`, `FederationMapIsland.astro`, `InstanceCard.astro` and
the two pages. It holds, with two imprecisions that do not change what a reader would do:

- "run … first by `npm run build`": `build` runs `clean` before `aggregate`. True of `dev`.
- `federation.json` is said to hold the three fields and two counts; it also holds `root`,
  `operationalDefinition` and `generatedAt`.

Nothing else under the page's covers changed since `4b1151e`
(`git diff --stat 4b1151e HEAD -- <covers>` names only `aggregate-federation.mjs`).

**Found, not fixed (not the site's to fix).** `docs/ECOSYSTEM.md` still restates three of the
registry's notes in nearly their words; it names `data/instances.yaml` as its source for one.

| ECOSYSTEM.md | The note | Shared |
| --- | --- | --- |
| line 24, "acceptance-test instance for `clone:framework`" | "Acceptance-test instance for clone-framework.mjs" | 39 letters |
| line 37, "mounted at `repos/refi-mediterranean/`" | "mounted at repos/refi-mediterranean/" | 32 letters |
| line 20, "Cooperative in formation." | "Cooperative-in-formation." | the whole sentence but its hyphens |

The check passes them: the first two are under 40 letters, and a whole sentence is matched with
its punctuation. Whether a document may restate a note is the operator's; the wording is
`commons-steward`'s. If the first two are reworded, `RUN_LENGTH` can drop to 32.

**The operational count.** The definition printed beside it now ends "The maintainer sets that
value by hand; the site does not measure it." The registry's dates of last sync are not public
fields, so the page cannot say how old the label is.

### After the review of the tightened site (2026-10-11, later)

**The home panel.** It said "Run in your instance" and listed `npm run doctor`. Checked by
practice: a clone of the reference fixture was made in a scratch directory with
`scripts/clone-framework.mjs --no-git`; in it `npm run doctor` printed "instance-doctor is not
present in this checkout", `npm run validate:structure` ran and reported, and
`node scripts/initialize.mjs --format=markdown` exited 0; from the framework checkout
`npm run doctor -- --dir <the clone>` printed a scorecard. The panel now prints each command
under the place it is run, and `site/test/command-where.test.mjs` reads `tests/clone-manifest.txt`.
Could not check: an instance made before the clone engine, or one that vendored the doctor
package; the test proves a command is present, not that it passes on a given instance.

**`docs/ECOSYSTEM.md` and `docs/FEDERATION-MAP.md`, second pass (`b65fd8d`), read against the
code and re-stamped at the merge, `8587d21`.**

- ECOSYSTEM, each changed row beside its source: refi-bcn-os is a downstream entry with
  `trust: "full"` (`federation.yaml`); the refi-med-os entry's note says its bootstrap is pending
  and names `ReFiDAO/ReFi-Mediterranean`; `regen-toolkit` appears nowhere in `federation.yaml`
  (`grep -c` gives 0) and `CHANGELOG.md` records its own remote, its place inside the
  regen-coordination-os checkout and a sync that aborted with no `last_sync_commit`;
  bread-coop-os has `repo: ""`, `README.md` line 21 says the engine produced it, and
  `tests/fixtures/bread-coop-config.yaml` line 4 says "Fictional"; `docs/SKILL-PROMOTION.md`
  lists the five skills with owner `dao-os`. The rest of the page was read beside the registry
  (types and maturities of the six rows), `repos.manifest.json`, `data/ecosystems.yaml`,
  `package.json` and the git remote: it holds.
- FEDERATION-MAP: `site/package.json` has `build` as `clean` then `aggregate`, and `dev` as
  `aggregate` first; the built `federation.json` has exactly the six keys the page names, and
  `root` and each node have `name`, `type`, `repo`. Both imprecisions noted above are gone.
- `npm run drift`: no page has drifted.

**The excerpt length, measured.** The three restatements in the table above are gone from the
document. On the real build the longest run any built file shares with a note is now 32 letters:
`tests/fixtures/bread-coop-config.yaml`, the path of a public file, in the ecosystem page. Then
29 (a repository address, a public field) and 24. `RUN_LENGTH` stays 40, and the sentence above
that it "can drop to 32" was wrong: the longest single name inside a note is 36 letters, and a
document may cite that name on its own account (`CHANGELOG.md` does), so 36 or less would fail a
build on a name and not on an excerpt. 40 is that name and one joining word. The build now
prints the measured number each time, and `site/test/registry-leaks.test.mjs` fails when the
longest name moves. Does not catch, still: an excerpt of 39 letters or fewer that is not a whole
sentence.

**Wide tables.** Every markdown table in the docs (102) is built inside a region that can be
focused and is named after its columns; the verifier fails on one outside. Seen at 375px on
`/docs/commands` in both themes; measured there with the keyboard. Could not check: a table
written as raw HTML (none exists; the verifier would report it), a screen reader, a real phone.

**Unlisted entries (2026-10-11, the operator's decision).** `data/instances.yaml` has eight
entries; two are marked `listed: false` (`bread-coop-os`, `openclaw`; `9cd5b2a`). The site now
leaves them out.

- Checked, on the build: `federation.json` has six nodes (ReFi Barcelona, ReFi DAO, DAO OS, Regen
  Coordination, ReFi Mediterranean, Regen Web3 Toolkit), `registered` 6, `operational` 2, the same
  six keys as before and no `listed`; the federation page has six `<li data-instance>`; the home
  page says 2 operational of 6 registered. The verifier prints each of these.
- Checked, that the guards fail: with `isListed` made to return true, seven tests of
  `site/test/federation-aggregate.test.mjs` fail; with "Bread Cooperative" written into the built
  list, "openclaw" into the built `federation.json` and an 8 into the home page's count,
  `npm run verify` exits 1 with six `REGISTRY:` lines that name the entry and the count.
- Checked, the rule: only the literal `false` unlists. A missing field, `null`, or a mistyped
  `"false"` keeps the entry on the list (the root test `tests/scripts/instances-listed.test.mjs`
  already fails on a value that is not a boolean).
- The leak check still reads all eight entries: an unlisted entry's notes, flags and local path
  are as private as any other's (24 sentences, 8 notes, 14 flags and paths, none found).
- **The map is not changed, and it disagrees with the list.** It is drawn from `federation.yaml`
  (`buildMap`), which has no `listed`. The built `map.json` has nine ring-1 instance nodes, among
  them `bread-coop-os` ("Bread Cooperative", type Cooperative) and `openclaw` (type AgentRuntime),
  each with no link and no counts. The `mini` map on the home page labels ring-1 nodes, so a
  visitor reads both names there, beside "of 6 registered", and again on `/federation` above a
  list of six. Whether the map should follow the list is the operator's; the change would be in
  `packages/org-os-kms` or `federation.yaml` (`engineer`'s), not in `site/`.
- `docs/ECOSYSTEM.md`, a published page, still has a row for bread-coop-os and a line for
  openclaw. It is a document about the ecosystem and says the first is fictional; the decision
  was about the federation page's list. Not changed; named here so it is a choice and not an
  oversight.
- Re-stamped at `7a80443`, each read against the one covered path that changed since its stamp
  (`data/instances.yaml`, two added `listed: false` lines and nothing else, by `git diff`):
  `data-model` (the `listed` paragraph beside `isListed`, `registryView` and the root test, which
  passes; eight entries; `grep` finds no reader of `listed` in `scripts/` or `packages/*/src`, so
  the drift analysis, the quilt and the dashboard do read every entry); `federation-map` (step 1
  beside the built `federation.json` and the verifier); `overview`, `architecture` and
  `ecosystem` (what each says of the registry does not depend on the new field: the file's
  existence, its place in the framework repository, and the six rows' types and maturities).
- Seen, in headless Chrome on a throwaway profile at 1280px, light theme, from `astro preview`:
  `/federation` shows the map with "Bread Cooperative" and "openclaw" labelled as green ring-1
  nodes, and below it "The 6 instances the framework's registry lists" and six rows; the home
  page says "2 operational instances, of 6 registered" above a small map on which both names
  can be read.
- Could not check: phone width, the dark theme, a screen reader's reading of the map's table.

**What the closing review left (2026-10-11, review of `6eacb24`).**

- **Page width.** Measured in headless Chrome (155, a throwaway profile, mobile emulation, the
  site served from `dist/` under its base path) on the 51 built pages that are not redirects, by
  `npm run widths`. Before: at 375px six pages were wider than the screen (`data-model` 404px,
  `federation-map` 534, `federation` 447, `kms-connectors` 395, `migration-v2-to-v3` 380,
  `versioning` 380: the reviewer's six, to the pixel) and at 320px fourteen (those, and `buzz`,
  `cloudflare-os`, `file-structure`, `migration-v3-to-v3-5`, `modules`, `overview`, `plans`).
  On every one the element reaching past the edge was inline `<code>` holding a path, an address
  or a dotted field name; on `kms-connectors` it was `subscribed_domains` in a heading. After
  the one rule (`.doc :not(pre) > code { overflow-wrap: break-word }`): each of the 51 pages is
  exactly as wide as the screen at both widths. `break-word` and not `anywhere`, so a table's
  narrowest width is unchanged and a wide table still scrolls in its region.
- The measurement is kept as `npm run widths`; it needs Chrome on the machine and is not in the
  build or in CI. The build's tests hold the rule in the stylesheet, not the widths: a new
  cause of overflow that is not inline code in a doc (a wide image, a long word in a heading
  outside `<code>`, a page that is not a doc) passes `npm test` and is caught only by running
  `npm run widths`.
- Could not check: a real phone, Safari, Firefox, text enlarged by the reader, widths under 320px.
- **A mistyped `listed`.** `listed: "false"`, `no`, `off`, `0`, an empty value, a list and a
  mapping each stop `npm run aggregate`, the first step of the build, with one sentence naming
  the entry. Checked on the real registry by writing `listed: "false"` on `openclaw`, running
  `npm run aggregate` (it stopped, and wrote no `federation.json` line) and `npm run verify`
  (it fails with the same sentence first), then restoring the file. This corrects the line
  above that says a mistyped `"false"` keeps the entry on the list: it no longer builds.
  `docs/DATA-MODEL.md` still says "any other value, or none, keeps the entry in"; handed to
  `commons-steward`.
- **Characters that are not seen.** The reviewer's three (soft hyphen, non-breaking hyphen,
  zero-width space between words) each have a case that failed on the old code. A sentence is
  now compared without its spaces, so a zero-width space in place of a space is read too. The
  real build still finds nothing (24 sentences, 8 notes, 14 flags and paths). Not looked for:
  a letter replaced by one that looks like it; `site/README.md` says so.
- **Corners and motion.** Every radius in the sources is one of the three tokens or 50%, and
  the only animation is the mark's cursor; the test now reads both, with cases that fail.
- Re-stamped at `14d0f46`: `federation-map`, read against the one covered path that changed
  (`site/scripts/aggregate-federation.mjs`: `aggregate` is now called inside a `try`, and the
  script exits with the registry's sentence when `listed` is mistyped). What the page says of
  the script is still true: the install check comes first, it does three things, and step 1
  reads the registry and leaves out the entries marked `listed: false`. The page does not say
  that a mistyped `listed` stops the run; that is an omission, named in the handoff to
  `commons-steward`, not a false claim.
- **Left as it is: finding 3.** The unlisted guard looks where the site lists instances
  (`<li data-instance>`, `federation.json`) and at marked counts. It does not look for the two
  names in every built file, because two things print them on purpose today: `docs/ECOSYSTEM.md`
  and the map. A wider check waits on the operator's decision about the map.
