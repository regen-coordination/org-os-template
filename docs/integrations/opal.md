# OPAL

**Status in short: do not rely on this yet.** The bridge's core is a stub, its command line writes nothing, and no instance uses it. Records elsewhere in the repository call it "production-ready"; the code does not support that.

OPAL is an external project: a "knowledge garden" for Claude Code that extracts entities (people, organizations, patterns, concepts) from documents into a staging area that a person reviews before anything is kept. It is created by omniharmonic (per the bridge's own setup docs) and lives outside this repository. What org-os holds is a TypeScript bridge to it, in `integrations/opal/`.

**Status:** planned for rollout. `data/packages-matrix.yaml` lists `opal-bridge` as `canonical` / `planned` (note: "Rollout planned (opal-rollout workstream)."), and `federation.yaml` calls it "production-ready; rollout pending". Read the second phrase with care: the bridge's core is a skeleton (see below), and no instance uses it.

## Where the code is

| Path | What is there |
|---|---|
| `integrations/opal/` | The bridge: `package.json` (`@org-os/opal-bridge`, binary `opal-bridge`), `src/`, `tests/`, `docs/` (architecture, API reference, setup guide, workflows, FAQ), `examples/`, `scripts/`. This is the real location. |
| `packages/opal-bridge/` | Only a deploy script (`scripts/deploy-to-node.sh`, which differs from the copy in `integrations/opal/scripts/`) and a CI workflow file. It has no source, no `package.json`. Earlier docs pointed here for the bridge; that was wrong. |
| `packages/koi-opal-bridge/` | A separate, unfinished package joining OPAL and KOI. See [KOI](koi.md). |

There is no module manifest under `modules/`, no skill under `skills/`, and no root npm script for OPAL.

## What must be installed outside the repository

- **OPAL itself**, cloned somewhere the bridge can reach. The bridge checks that the OPAL directory exists and contains a `CLAUDE.md`, and fails with "OPAL not found" or "not properly initialized" otherwise. OPAL's own commands (`/process`, `/review`, `/ask`, `/quest`, `/handoff`) are its, not org-os's.
- Node 18 or later, and `npm install` inside `integrations/opal/` followed by `npm run build` (not run here; the root install does not cover it).
- A config file whose top-level key is `opal-bridge`, with `opal_path` and `profile`. The CLI reads `federation.yaml` by default (`-c <path>` changes it). It reads that top-level `opal-bridge` key and nothing else, so write it there:

```yaml
opal-bridge:
  opal_path: "../opal"   # relative to the instance root, where you run the CLI
  profile: "regen"
```

A separate, larger loader in `src/integration/config-loader.ts` merges org-os and OPAL configuration and can write `federation.yaml`; the CLI does not use it.

## Commands

After `npm run build` inside `integrations/opal/`, run the built file with node from the instance root, so the default `federation.yaml` and `opal_path` resolve against it: `node integrations/opal/dist/cli.js <command>`. Do not use `npx opal-bridge`: the root `package.json` has no workspace or dependency for it, so `npx` would look for a package of that name on the public registry. (`npm link` inside `integrations/opal/` also installs the `opal-bridge` binary.)

| Command | What it does today |
|---|---|
| `status` | Prints a green "connected" with profile and pending count. This is not a real check: the underlying call is a stub that never fails, so it reports connected with nothing contacted. Only starting the bridge checks that the OPAL directory and its `CLAUDE.md` exist. Version is empty and count is always zero. |
| `process <file>` | Reads the file and extracts entities with three regular expressions (two capitalised words as a person, "X DAO/Network/Council/Coop" as an organization, "Word wordtion/ing/ment" as a pattern), then prints them with a confidence fixed per type (0.7 person, 0.8 organization, 0.6 pattern). It does not call OPAL and writes nothing. |
| `review` | Lists pending entities by reading OPAL's `_staging/` folder, but the parser returns an empty list, so it always reports none. It is a listing, not an interactive review. |
| `approve <id>`, `reject <id>` | Print a success message ("Approved: ...") that is not true: they do not move or delete anything. |
| `ask <query>` | Calls the same stub, so it returns no results. |
| `quest`, `quest-continue`, `handoff`, `activity` | Print success text (for example "Updated quest", "Handoff created") while writing no quest or handoff file. |

There is no `setup` command and no `--opal-path` or `--profile` option; earlier versions of this page described both.

## The integration layer

`src/integration/` is the larger part of the package, about 4,000 lines in five modules, exported from `src/integration/index.ts`:

| Module | Purpose, from the source |
|---|---|
| `entity-mapper.ts` | Maps OPAL entities to org-os records (members, projects, patterns, meetings, decisions) and writes pattern markdown and YAML data files. |
| `meeting-pipeline.ts` | Processes transcripts; recognises `meetily`, `otter`, `fathom`, `read` and manual sources by file name; writes YAML. One part is a labelled placeholder (calendar lookup). |
| `git-sync.ts` | Branch, commit and pull-request handling over `git` and the `gh` CLI. |
| `schema-bridge.ts` | Writes schema and bridge files between OPAL templates and org-os data. |
| `config-loader.ts` | The configuration merge described above. |

The command-line tool does not call this layer. Whether it works end to end was not verified: it is exercised only by the package's tests, which need OPAL-shaped fixtures.

## Tests

`tests/` has two files (`opal-adapter.test.ts`, `integration.test.ts`, about 1,040 lines) with fixtures in `tests/fixtures/`, run with `npm test` inside `integrations/opal/`. Both import `OpalBridge` from `src/index.ts`, so they test the stubbed core. They were not run for this page: jest is not installed in the repository root and installing it needs the network. Treat the "full coverage" claims in the package's own `TESTING_SUMMARY.md` as unverified.

## What it writes and where

Today the CLI writes nothing. Designed output, in the integration layer: entity files under the instance's `knowledge/`, and edits to `data/` registries such as `members.yaml`, `projects.yaml` and `meetings.yaml`, after a person approves. Run it in a scratch copy first.

## Not built or not verified

- A real connection to OPAL: extraction, staging and approval are simulated or logged only.
- The CLI-to-integration-layer wiring, and any auto-processing of new content.
- Sync to KOI: see [KOI](koi.md).
- `packages/opal-bridge/` does not build: its CI file expects a package that is not there, and GitHub only reads workflow files at the repository root `.github/`, so that file never runs.
