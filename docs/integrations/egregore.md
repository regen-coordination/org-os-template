# Egregore

Egregore is an external project by Curve Labs: shared, git-based memory for teams that use Claude Code, driven by slash commands (`/reflect`, `/handoff`, `/quest`, `/ask`, `/activity`, `/save`). org-os does not contain Egregore. What the repository holds is `packages/egregore-core/`, which is a README and one small adapter that lets OpenCode's `/ask "Reflect: ..."` pattern write the same kind of files.

**Status:** dormant. `data/packages-matrix.yaml` lists `egregore-core` as `canonical` / `dormant`, with no instance using it. The adapter runs; nothing else in the framework calls it, and it has no tests.

## What exists in the repository

| Path | What it is |
|---|---|
| `packages/egregore-core/README.md` | Describes the upstream project and how it could be added. Its own status line reads "IDEA: Integrate". |
| `packages/egregore-core/opencode-adapter/opencode-to-egregore.js` | About 290 lines of CommonJS, no dependencies. Exports `EgregoreOpencodeAdapter`. |
| `packages/egregore-core/opencode-adapter/package.json` | Package `@org-os/egregore-opencode-adapter`. Scripts: `test` (just runs the file, which prints the memory repo path, user and counts, and creates `./egregore-memory` with `git init` in the working directory) and `demo`. |

There is no module manifest under `modules/`, no skill under `skills/`, no root npm script, and no script that reads Egregore settings. `federation.yaml` carries a `packages.egregore: false` toggle that does nothing for the adapter (`clone:framework` keys packages by directory name, which would be `egregore-core`). The OpenCode init skill (`.opencode/skills/org-os-init/SKILL.md`) mentions Egregore as an optional enabled app. Setup does not offer an "Egregore-assisted" path that installs anything.

## What must be installed outside the repository

- **Egregore itself** (`github.com/Curve-Labs/egregore-core`), which provides the Claude Code slash commands. Nothing in org-os installs it, and no submodule is configured here. This page does not describe the upstream commands beyond naming them, because they are not in this repository.
- **Git**, with `user.name` set (the adapter uses it as the author, and it commits with the local git identity).
- **Node.js**, to run the adapter.

## The OpenCode adapter

The adapter keeps a plain git repository of markdown files and commits to it on every call. The repository location is `options.memoryRepo`, else the `EGREGORE_MEMORY_REPO` environment variable, else `./egregore-memory` relative to the working directory. If it does not exist the adapter creates it and runs `git init`. The author is `options.user`, else `EGREGORE_USER`, else `git config user.name`. Setting `EGREGORE_ADAPTER_DEBUG=true` turns on logging.

```javascript
const { EgregoreOpencodeAdapter } = require('./opencode-to-egregore');

const adapter = new EgregoreOpencodeAdapter({ memoryRepo: './egregore-memory', user: 'name' });
await adapter.handleAsk('Reflect: key insight from today');
```

`handleAsk(input)` routes by prefix; anything else comes back as `{ passThrough: true, input }`.

| Input prefix | Method | Writes (inside the memory repo) |
|---|---|---|
| `Reflect:` | `reflect(text)` | `reflections/<date>-<ms>.md`, then a commit |
| `Handoff:` | `handoff(text, { assignee })` | `handoffs/<date>-<hh-mm-ss>.md`, then a commit |
| `Quest:` | `quest(topic, { continue: id })` | `quests/<ID>.md` (8-character random ID); with `continue`, appends an update. Commits |
| `Show activity` / `Show recent` | `activity(limit)` | Nothing. Returns `git log --oneline` and counts of the three folders |

The adapter has no `/ask`-to-team routing, no `/save` (no push), and no `/decision` command. It never pushes, so sharing the memory repo with a team is something you set up on that repository yourself.

Checked by running it in a scratch directory: `reflect`, `handoff` and `quest` each created their file and a commit. The assignee and the quest `continue` option are only reachable by calling the methods directly, not through `handleAsk`.

## Known problem

`handleAsk('Show activity')` (and `Show recent ...`) returns `{ success: false, error }`: the matched prefix leaves an empty string, which is passed as the `limit` argument, so the adapter runs `git log --oneline -` and git rejects it. Calling `adapter.activity()` directly works.

## Not built or not verified

- Any link between Egregore memory and `MEMORY.md`, `HEARTBEAT.md`, `memory/`, OPAL or KOI. The earlier version of this page described these; no code in the repository does it.
- Whether any instance runs Egregore today. A frontier file for one instance lists an `egregore` repository, but that is a pointer, not evidence of use.
- The upstream commands and their behaviour.
