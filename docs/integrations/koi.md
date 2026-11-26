# KOI

KOI-net is an external protocol for sharing knowledge between nodes as events about identified resources. A resource is named by a RID (`rid:<scheme>:<type>:<identifier>[@version]`), and nodes exchange `NEW`, `UPDATE` and `FORGET` events through a coordinator. It is developed outside this repository.

org-os holds two TypeScript packages that were written toward it, `packages/koi-bridge/` and `packages/koi-opal-bridge/`. Both are first drafts: source files with no tests, and their command-line tools mostly print messages. Nothing in org-os has been run against a real KOI network.

**Status:** dormant. `data/packages-matrix.yaml` lists both packages as `canonical` / `dormant`, with no instance using them.

## What must exist outside the repository

- A **KOI-net coordinator** to connect to, and its URL. No verified public one is named here. `koi-opal-bridge` carries a default URL in its `setup` option, which nothing in this repository confirms.
- Node.js and the packages' dependencies, installed with `npm install` inside the package (not run here; the packages are not part of the root install). `koi-bridge` needs `commander` and `node-fetch`.
- Nothing in the root `package.json`, `skills/` or `modules/` refers to KOI. `federation.yaml` lists `koi-net` and `koi-net-integration` as knowledge-infrastructure repositories under `organizational-os/`, which is a pointer only.

## packages/koi-bridge

Six source files, about 740 lines, plus `package.json` (`@org-os/koi-bridge`, binary `koi-bridge`) and `tsconfig.json`. Scripts: `build` (`tsc`), `test` (`jest`), `setup`. There are no test files and no jest configuration, so `npm test` has nothing to run.

| File | What is actually in it |
|---|---|
| `src/rid.ts` | `RIDManager`: parse, stringify, validate and compare RIDs; generators for the `orgos` and `koinet` schemes. Self-contained and the most complete part. |
| `src/events.ts` | `EventManager`: register handlers per event type and emit events. In-process only. |
| `src/bridge.ts` | `KoiBridge`: an HTTP client that POSTs to `/nodes/register`, `/events/broadcast`, `/events/poll`, `/bundles/fetch`, `/query` and GETs `/status` on the coordinator, with an optional bearer key. Those endpoint names are the package's assumption; they were not checked against KOI-net. |
| `src/git-sync.ts` | `GitSync`: finds files changed under `knowledge/` and `data/` since the last commit it saw, builds a RID derived from the path (slashes become dashes and the extension is dropped, so `knowledge/a/b.md` becomes `rid:orgos:file:knowledge-a-b`) and emits a local `NEW` event. It does not send that event to the coordinator. `handleIncomingEvent` only logs. With `autoSync` it writes a `.git/hooks/post-commit` hook that runs `npx koi-bridge sync`, replacing any hook already there; unless the package is installed in that repository, `npx` would look for it on the public registry. |
| `src/index.ts` | `KoiBridgePackage`, tying the above together. |
| `src/cli.ts` | Commands `setup`, `sync`, `query`, `poll`, `status`. Each only prints text. `setup` echoes its options and saves nothing; `status` always prints "Not configured"; `sync`, `query` and `poll` contain a comment where the work would go. |

Checked by reading the source. A type-check (`tsc --noEmit`) in the worktree stops at the missing `commander` and `node-fetch` modules, as expected without an install.

So an operator cannot do anything useful with the `koi-bridge` command today. The library classes can be imported and used from your own code; only `RIDManager` and `EventManager` work without a coordinator.

Configuration keys such as `koi-bridge.coordinator_url` or a sync schedule that earlier versions of this page showed for `federation.yaml` are not read by any code. The CLI's `setup` does not write them.

## packages/koi-opal-bridge

Six source files (about 1,270 lines) joining an OPAL adapter, a KOI client and a "unified" API with a sync orchestrator; binary `koi-opal` with `setup`, `status`, `sync`, `opal process|review`, `koi sync|broadcast` and `ask`. It has no tests. Its OPAL adapter produces its entities with a regular-expression placeholder, `setup` prints its options and writes nothing, and its README is a design: files it lists (`scripts/`, `templates/`, `src/opal/ingest.ts`, `src/koi/rid.ts`) are not in the package, and its `setup`/`sync-loop` npm scripts point at `dist/scripts/*`, which no source produces. Treat it as a design sketch.

The intended flow, which is the design and not behaviour: OPAL extracts entities, a person approves them, and approved ones are broadcast as KOI events. See [OPAL](opal.md).

## What it would write

Nothing is written today by the CLI. The library's only side effects are the `post-commit` hook above and local events held in memory.

## Not built

- Registering with a coordinator, broadcasting, polling and applying incoming events as a working loop, with tests.
- Reading connection settings from `federation.yaml`.
- Any integration with the rest of org-os (scripts, skills, `data/`).
- Graph federation through KOI, mentioned in [Graphify](graphify.md), is planned only.
