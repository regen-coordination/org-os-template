# Admin app

The admin app is a local web page for editing an instance's `data/*.yaml` registries through forms. It runs on your machine, reads and writes the files in the instance's working tree, and makes one git commit for every save, create or delete.

**Status:** `in-dev` (the vocabulary of [Modules](MODULES.md)). Milestone M1 of the [design](superpowers/specs/2026-07-23-admin-app-design.md) is built and is in `packages/admin/`. The design's proposals workflow, the canvas view, the markdown and system-file editing, and authentication are not built. The package has 47 test cases (vitest). They were not run for this page, because the package's dependencies are not installed in the checkout it was written from and installing them needs the network. Everything below is read from the source.

## Start it

Run it from the **framework checkout**. An instance does not receive `packages/admin` (the clone leaves it out), so the app cannot be started from inside an instance; you point it at one with `--repo`.

```bash
npm install --prefix packages/admin     # once: the package has its own dependencies
npm run admin -- -- --repo ../my-instance    # build the UI, serve on http://localhost:4680
```

`npm run admin` is `npm --prefix packages/admin run start`: it builds the single-page app with Vite (`app/dist/`), then starts the server with `tsx`. With no options it edits the directory npm was run from (`INIT_CWD`), which here is the framework itself. The server refuses to start unless the target directory has both `data/` and `federation.yaml`.

| Option | Default | Meaning |
|---|---|---|
| `--repo <path>` | the directory you ran npm from | the instance to edit |
| `--port <n>` | `4680` | the port |

Because the root script calls npm a second time, the options need two `--` separators, as in `npm run admin -- -- --repo ../my-instance --port 4700`. With one, npm swallows the flag names and passes only the values (checked with a stand-in script under npm 11). The server binds `127.0.0.1` only; the address is fixed in `server/index.ts` and has no option.

`npm run admin:dev` runs the server alone with `tsx watch` (no UI build). Pair it with `npm run dev:app` inside `packages/admin/` for hot reload; the Vite dev server proxies `/api` to port 4680. If `app/dist/` is missing the server still starts and says so; only the API is served.

## What it can edit

It knows 14 registries, the files in `data/`:

- **Eleven collections, editable:** `members`, `projects`, `meetings`, `ideas`, `funding-opportunities`, `relationships`, `sources`, `events`, `channels`, `assets`, `knowledge-gaps`. Each is a list of entries with an `id`. You can create, change and delete entries.
- **Three documents, read-only:** `finances`, `governance`, `knowledge-manifest`. The page shows them as YAML and the API answers `403` to a write.

A registry file that is missing from `data/` is not listed. `funding-opportunities` accepts either the top-level key `opportunities` or `funding_opportunities`, whichever the file already uses, so the app does not split the data in two.

Each form is generated from a JSON Schema in `packages/admin/schemas/` (one per registry, `_generic.schema.json` for any without its own). Simple fields get inputs; nested structures (arrays of objects, maps) are edited as YAML text in a textarea.

Each write is checked before it is saved:

- the entry is validated against the registry's schema (Ajv); a failure answers `422` with the field errors;
- cross-references must resolve: `projects.lead` and `projects.contributors` to `members`, `projects.related_ideas` to `ideas`, `projects.funding_source` to `funding-opportunities`, `meetings.participants` to `members`, `events.related_project` to `projects`. If the target registry file is absent, the check is skipped;
- an update cannot change an entry's `id`.

Deleting an entry is not checked for references to it.

## How it writes

For a change, the server:

1. parses the registry file with the `yaml` package's document model, so comments and formatting survive;
2. changes only the keys that differ. A scalar edited in place keeps its quote style. Replacing a whole nested object or array drops comments inside that value; the rest of the file is untouched;
3. writes the file in `data/` of the working tree;
4. commits that one file to the **currently checked-out branch**, with the message `admin(<registry>): update <id>`, `admin(<registry>): create <id>` or `admin(<registry>): delete <id>`.

Writes to the same registry are serialised in memory, so two saves cannot interleave. A WebSocket (`/api/events`) watches `data/` and refreshes the page when a file changes from outside, for example from an editor or an agent.

It does not run `npm run generate:schemas`, so `.well-known/` is not regenerated after an edit; run it yourself before you push (see [Data model](DATA-MODEL.md)).

## Safety properties

What the code enforces:

- **Git vocabulary is three verbs.** `server/git.ts` can ask for status, `add` and `commit`. There is no stash, clean, reset or force, by design.
- **Commits stay inside `data/`.** A path outside `data/` makes the commit function throw before anything is staged.
- **Only the registry file is committed.** The commit names the one path, so other staged or modified files are left alone.
- **Local only.** It listens on `127.0.0.1`.

What it does not do, and what to know before using it:

- **It commits the whole file, not just your edit.** If the registry file already had uncommitted changes of yours, they go into the app's commit.
- **The write comes before the commit.** If the commit fails, for example a git hook rejects it, the file stays changed in the working tree and nothing is committed.
- **No authentication.** Anything on the machine that can reach `localhost:4680` can write. The API has no origin or CORS check and reads the body as JSON whatever its content type. The risk from a web page open in your browser was not tested.
- **It never pushes.** Commits stay local until you push.
- **Not a gate.** It does not use the proposals queue; every save goes straight to the current branch. Commit or copy aside anything you cannot lose, then take a snapshot (tracked files only), as in [Vault safety](VAULT-SAFETY.md).

## The files

| Path | What it is |
|---|---|
| `packages/admin/server/` | the Hono API: `index.ts` (start-up), `app.ts` (routes), `registries.ts` (the 14 registries), `registry.ts` (YAML read and write), `schema.ts` (validation), `git.ts`, `watcher.ts` |
| `packages/admin/app/` | the React single-page app (Vite, TanStack Query, wouter) |
| `packages/admin/schemas/` | the JSON Schemas that drive the forms |
| `packages/admin/tests/`, `app/src/components/EntityForm.test.tsx` | the tests; `tests/real-data.test.ts` checks the schemas against this repository's own `data/` |

The API: `GET /api/status`, `GET /api/registries`, `GET /api/registries/:name`, `GET /api/schemas/:name`, `PUT /api/registries/:name/:id`, `POST /api/registries/:name`, `DELETE /api/registries/:name/:id`.

## Test it

```bash
npm run test:admin     # vitest: the server services, the API and the form component
```

It needs the install above. `npm test` inside `packages/admin/` is the same suite.
