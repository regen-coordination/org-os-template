# Admin app

The admin app is a local web server and page for running an instance: its `data/*.yaml` records, the rules that decide changes to them, the proposals those rules call for, its boards, and the outside systems it uses (a Safe, a Hats tree, a Gardens pool). It runs on your machine, reads and writes the files in the instance's working tree, and every change it makes lands as a git commit carrying `Org-*` trailers. In 0.6 it is the platform of the [0.6 architecture](superpowers/specs/2026-10-16-org-os-0.6-platform-architecture-design.md): a new client on the server that milestone M1 of the [admin design](superpowers/specs/2026-07-23-admin-app-design.md) built.

**Status:** `in-dev` (the vocabulary of [Modules](MODULES.md)), in `packages/admin/`. Not built: an edit path for `data/governance.yaml`, `data/finances.yaml`, `data/knowledge-manifest.yaml`, `data/visibility.yaml`, `IDENTITY.md` and `federation.yaml` (the app shows them read only); serving on any address but `127.0.0.1`; regenerating `.well-known/` after a change. The package's vitest suite and its browser checks were not run for this page. Everything below is read from the source.

## Start it

Run it from the **framework checkout**. An instance does not receive `packages/admin` (`scripts/clone-framework.mjs` removes every package the config does not enable and vendors only the standards generator into `scripts/lib/`), so the app cannot be started from inside an instance; you point it at one with `--repo`.

```bash
npm install --prefix packages/admin          # once: the package has its own dependencies
npm run admin -- --repo ../my-instance        # build the UI, serve on http://localhost:4680
```

`npm run admin` is `npm --prefix packages/admin run start --`: it builds the single-page app with Vite (`app/dist/`), then starts `server/index.ts` with `tsx`. Because the root script ends in `--`, one `--` on your command line is enough. With no options it serves the directory npm was run from (`INIT_CWD`), which here is the framework itself. The server refuses to start unless the target directory has both `data/` and `federation.yaml`.

| Option | Default | Meaning |
|---|---|---|
| `--repo <path>` | the directory you ran npm from | the instance to serve |
| `--port <n>` | `4680` | the port |
| `--hosted` (or `ORG_OS_HOSTED=1`) | off | hosted mode: with no session the caller is the public (below) |

The server binds `127.0.0.1` only, in either mode; the address is fixed in `server/serve.ts` and has no option. `npm run admin:dev` runs the server alone with `tsx watch` (no UI build); pair it with `npm run dev:app` inside `packages/admin/`. If `app/dist/` is missing the server still starts and says so; only the API is served.

## Who is acting

Every request is read for an actor (`server/request.ts`, `server/actor.ts`):

- **Locally, with no session,** the actor is the member whose `handles.git` (or `email`) in `data/members.yaml` holds `git config user.email`. An address no member holds can read but not write; the *claim your handle* wizard (`wizards/claim-handle.yaml`, `lib/claim.mjs`) adds it to a member, and only while the org has written no rules.
- **Signed in,** the actor is the member whose `handles.wallet` lists the address, else the address itself. Sign-in is Sign-in with Ethereum (`lib/siwe.mjs`, `server/session/`): the server writes the message and the browser's wallet signs it; the server holds no key. It is offered when `data/systems.yaml` holds a `hats-tree` system (`governance.membership.tree` picks one when there are several, `membershipTree` in `lib/rules.mjs`). The hats an address wears are read from that tree when signing in and again before every act. Commits a session makes are authored by `house@org-os.invalid`, with the member in `Org-Actor`.
- **Hosted, with no session,** the caller is the public: reading anything not public, and every write, answers `401`. A hosted server refuses to start while `origin` is public, or while it cannot read whether it is, unless `ORG_OS_REMOTE_PRIVATE=confirmed` (`server/visibility/remote.ts`); a local one says so on Home.

What the public may read is set in `data/visibility.yaml` (`lib/visibility.mjs`). A record or field kept stricter than *members* lives outside git in a SQLite file, `house.db` (`server/private/`), in `ORG_OS_PRIVATE_DIR` or else `<instance>/.org-os/private/`, which `.gitignore` must name; `npm run house:backup` writes an encrypted copy of it, and the server takes one every 24 hours by default once `ORG_OS_BACKUP_KEY_FILE` names a key (`server/private/backup.ts`).

## What it can edit

The registries are listed once, in `lib/registries.mjs`: 19 files in `data/`.

- **Twelve collections, edited as records:** `members`, `projects`, `meetings`, `ideas`, `funding-opportunities`, `relationships`, `sources`, `events`, `channels`, `assets`, `knowledge-gaps`, `systems`. Each is a list of entries with an `id`: field rows on the record page, and a source editor for the whole entry.
- **Three collections with their own routes:** `boards` (arranged on the board itself), `proposals` (the ledger, written only by the proposal routes) and `library` (receipts, written only by the library's Add and Remove).
- **Four documents, read only:** `finances`, `governance`, `knowledge-manifest`, `visibility`. A write through the registry routes answers `403`.

`app/src/editors.ts` holds this table, and `app/src/editors.test.ts` fails when a governed file has no line in it. `funding-opportunities` accepts either the top-level key `opportunities` or `funding_opportunities`, whichever the file already uses. A registry file that is missing from `data/` is not listed.

Each entry is checked with Ajv against a JSON Schema in `packages/admin/schemas/` (one per registry, `_generic.schema.json` for any without its own), and its cross-references must resolve (`REFS` in `lib/data-validate.mjs`: a project's `lead`, `contributors`, `related_ideas` and `funding_source`, a meeting's `participants`, an event's `related_project`). An entry's `id` cannot change. Deleting an entry that another entry names is refused, listing what refers to it.

## How a change is decided

Saving a record stages it in your **change**, one per actor, kept outside the repository (`~/.org-os/admin/<instance>-<hash>/changes/`; `ORG_OS_ADMIN_HOME` moves it). Each staged op carries a base, the SHA-256 of the entry's canonical YAML (`server/changes/canonical.ts`), so an entry someone else changed since is marked stale.

The records a change touches fall into classes (`schemas/change-classes.json`), and the rules in `data/governance.yaml` say, per class, how such a change is decided (`lib/rules.mjs`): `direct`, `approve`, `consent` (an objection window), `vote`, or `system` (an outside system such as a Safe). With no rules the solo default applies: the maintainer decides alone.

- **Apply**, when the rule lets you decide alone, makes one commit of the whole change, with the trailers `Org-Actor`, `Org-Change` and `Org-Rule` (`server/changes/`).
- **Propose**, otherwise, turns the change into an entry of `data/proposals.yaml` and builds a local branch `proposal/<id>` from it, never pushed. Members approve, object, vote or comment. **Ratify**, once the rule is met, is one merge commit carrying `Org-Proposal` and `Org-Decision` that also writes the decision row into `data/governance.yaml`, and an entry in `DECISIONS.md` when the proposal has a statement (`server/proposals/ratify.ts`). Nothing closes a proposal on its own when a window ends. Proposal writes refuse while the repository is off the trunk (`governance.trunk`, else the branch the server started on). See the [proposals design](superpowers/specs/2026-10-18-org-os-0.6-p2-proposals-design.md).
- **Sync and Share** reach other members' proposals through `origin`: Sync fetches and fast-forwards the trunk (merging when the histories diverged and only the ledger conflicts); Share pushes the trunk by an explicit refspec, never forced. Both ask for a confirmation first.

The older routes (`PUT`/`POST`/`DELETE /api/registries/...`) still work: each is a one-op change applied at once under Apply's checks, with the message `admin(<registry>): update|create|delete <id>`.

## How it writes

For each file a change touches, the server parses it with the `yaml` package's document model, changes only the lines of the fields that differ (comments, quoting and layout elsewhere survive), parses the result back, and refuses with `409` if any other entry or field would read differently. Then it writes the files and makes one commit of exactly those paths to the **currently checked-out branch**. If git refuses the commit, every file is put back and the answer is `503`.

Writes to the repository are serialised by one in-memory lock. A WebSocket (`/api/events`) watches `data/` and refreshes the page when a file changes from outside, for example from an editor or an agent. The server does not run `npm run generate:schemas`: `GET /api/generated` says when a ratify has left `.well-known/` behind, and you run it yourself (see [Data model](DATA-MODEL.md)).

## Beyond records

- **Boards** (`/b/<id>`): the 15 built-in boards in `packages/admin/boards/` and an instance's own in `data/boards.yaml`, each a layout of blocks (lists, kanban, maps, metrics, proposals, systems and the others in `app/src/blocks/`).
- **Systems** (`/systems`): each entry of `data/systems.yaml` is read by a driver (`server/systems/drivers.ts`: link, Safe, Hats tree, Snapshot space, Gardens community and pool, DAO URI registration) every five minutes, reaching only the hosts it declares and sending only reads. An action on a system (adding a Safe owner, giving a hat), on a proposal, is prepared as a Safe transaction for the Safe's signers (`server/proposals/prepare.ts`); the server signs, sends and writes nothing.
- **Operations and jobs**: what a resource offers (a module's check, a fetch, a share) runs as a job with no shell, and anything that writes or reaches the network needs a single-use plan first. The server never commits for a job.
- **Library** (`/library`): entries a shelf offers (boards, rule sets, systems), previewed, then added through your change like any other edit.

## Safety properties

What the code enforces:

- **Git vocabulary is a list.** `server/git.ts` runs a git command only if it and each of its flags are on `ALLOWED`; stash, clean, reset and any force flag are not, and `tests/server/git.vocabulary.test.ts` holds the list. Push exists only as the Share operation, whose command `server/operations/catalogue.ts` builds.
- **Commits stay inside `data/`.** A data commit throws on a path outside `data/` before anything is staged; a ratify merge may stage `DECISIONS.md` as well, and nothing else.
- **It does not commit work it did not make.** A registry file with uncommitted changes, or one git was told not to look at, refuses the write with `409 DIRTY`.
- **Nothing stricter than members enters git.** The texts about to be committed are checked against `data/visibility.yaml` first.
- **Who may call.** Before any route, `server/guard.ts` refuses a request addressed to a host other than localhost, a browser request whose `Origin` is not the app's own page, and a write that is not `application/json`.

What to know before using it:

- **Apply commits to the branch you are on.** Only the proposal routes check for the trunk.
- **It never pushes on its own.** Commits stay local until you Share or push.

## The files

| Path | What it is |
|---|---|
| `packages/admin/server/` | the Hono API: `index.ts` (start-up), `serve.ts` (the server), `app.ts` (the registry routes), `git.ts`, `registry.ts`, and a folder per area: `changes/`, `proposals/`, `governance/`, `session/`, `private/`, `visibility/`, `boards/`, `systems/`, `operations/`, `resources/`, `library/`, `wizards/` |
| `packages/admin/lib/` | plain JavaScript shared with the root scripts: the registry list, rules, proposals, change classes, and `standards/`, the builder `npm run generate:schemas` uses |
| `packages/admin/app/` | the React single-page app (Vite, TanStack Query, wouter, React Flow for maps) |
| `packages/admin/schemas/`, `boards/`, `wizards/`, `library/` | the JSON Schemas, the built-in boards, the wizards, the framework's library shelf |
| `packages/admin/tests/`, `app/src/**/*.test.ts(x)` | the tests |

`packages/admin/README.md` lists every API route and its answers.

## Test it

```bash
npm run test:admin     # vitest: the server, the API and the app's components
```

It needs the install above. `npm test` inside `packages/admin/` is the same suite; `npm run e2e` there runs the browser paths in the installed Chrome.
