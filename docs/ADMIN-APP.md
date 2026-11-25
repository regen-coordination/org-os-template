# Admin app

The admin app, called the Hub, is a web app for running an instance: its `data/*.yaml` records, the rules that decide changes to them, the proposals those rules call for, its boards, the outside systems it uses (a Safe, a Hats tree, a Gardens pool), and, since 0.7, the workspace: pages, collections, tasks and the conversation on them. It reads and writes the files in the instance's working tree, and every change it makes to them lands as a git commit carrying `Org-*` trailers. What is stricter than members is kept in a private store outside git. It runs on a member's own machine, or hosted for members from one container image. It began as the platform of the [0.6 architecture](superpowers/specs/2026-10-16-org-os-0.6-platform-architecture-design.md), on the [admin design](superpowers/specs/2026-07-23-admin-app-design.md).

**Status:** `in-dev` (the vocabulary of [Modules](MODULES.md)), in `packages/admin/`. Not built or not yet on: writes from a hosted Hub (a hosted Hub refuses `HOUSE_INSTANCE_WRITES=on` while known write defects are listed, `BEFORE_PILOT_OPEN` in `server/hosted/instance-writes.ts`), the federation write routes and the knowledge pages on a hosted Hub, link records on live atproto accounts, deploying a composed DAO on a real chain (tested against a fake node only), and regenerating `.well-known/` after a change. This page is written from the source, `packages/admin/README.md` and `CHANGELOG.md`; the package's vitest suite and its browser checks were not run for it. `packages/admin/README.md` lists every API route.

## Start it

Run it from the **framework checkout**. An instance does not receive `packages/admin` (`scripts/clone-framework.mjs` removes every package the config does not enable and vendors only the standards generator into `scripts/lib/`), so you point it at an instance with `--repo`.

```bash
npm install --prefix packages/admin          # once: the package has its own dependencies
npm run admin -- --repo ../my-instance        # build the UI, serve on http://localhost:4680
npm run open                                  # or the launcher, on http://localhost:4679/launch
```

`npm run admin` is `npm --prefix packages/admin run start --`: it builds the single-page app with Vite (`app/dist/`), then starts `server/index.ts` with `tsx`. One `--` on your command line is enough. With no options it serves the directory npm was run from (`INIT_CWD`). The server refuses to start unless the target directory has both `data/` and `federation.yaml`. `npm run admin:dev` runs the server alone with `tsx watch`; pair it with `npm run dev:app` inside `packages/admin/`.

| Option | Default | Meaning |
|---|---|---|
| `--repo <path>` | the directory you ran npm from | the instance to serve |
| `--port <n>` | `4680` | the port |
| `--hosted` (or `ORG_OS_HOSTED=1`) | off | hosted mode: with no session the caller is the public (below) |

**The launcher** (`npm run open`, `launcher/`) is one page where you open an instance by its folder or a git address, create one (it runs `clone:framework`), adopt a repository that is not org-os, or start joining a network. Each opened instance gets its own Hub on the next free port from 4680; the launcher stops them when you stop it, never pushes, and refuses to run hosted. What it writes is listed in [Opening an instance](OPENING.md).

**Locally** the server binds `127.0.0.1` only, and the address has no option. **Hosted**, it runs from the image in `deploy/hub/` (`hub serve`, which runs every start check first) and binds `ORG_OS_BIND`, `0.0.0.0` by default (`server/hosted/config.ts`). It answers only the host of `ORG_OS_PUBLIC_ORIGIN`, sets security headers, limits request rates, and refuses to start while the instance's remote is public and holds what only members may read (`ORG_OS_REMOTE_PRIVATE=confirmed` when it cannot ask). See [Setup: Host a Hub](SETUP.md#host-a-hub) and `deploy/hub/RAILWAY.md`.

## Who is acting

Every request is read for an actor (`server/request.ts`, `server/actor.ts`, `server/session/`):

- **Locally, with no session,** the actor is the member whose `handles.git` (or `email`) in `data/members.yaml` holds `git config user.email`. An address no member holds can read but not write; the *claim your handle* wizard (`wizards/claim-handle.yaml`, `lib/claim.mjs`) adds it to a member, and only while the org has written no rules.
- **Hosted, with no session,** the caller is the public: reading anything not public, and every write, answers `401`.
- **Signed in**, by one of three ways:
  - **An emailed link** (0.6.1). The Hub answers every address alike, sends a single-use link that works for 15 minutes, and sets a signed session cookie (EdDSA, 24 hours) that the org's other sites can verify with the public key alone. It keeps a keyed hash of each address, never the address. Hosted it needs `HOUSE_EMAIL_PEPPER`, `HOUSE_SESSION_PRIVATE_JWK`, `SESSION_COOKIE_NAME`, `RESEND_API_KEY` and `MAIL_FROM`; with none of them set it is not offered. Locally, with no mail settings, the link is printed to the log.
  - **A Bluesky or Certified account** (0.7.5). An AT Protocol OAuth round trip that asks for identity only (scope `atproto`) and writes nothing to the account; it ends in the same session cookie. Hosted it is a confidential client and is not offered until `HOUSE_ATPROTO_PRIVATE_JWK` is set; locally it is a loopback client. A member links or unlinks their own account at `/account-links`. Anyone whose account is linked to no person comes in as a **Guest**, with no Roles.
  - **A wallet** (Sign-in with Ethereum, `lib/siwe.mjs`), offered when `data/systems.yaml` holds a `hats-tree` System. The server writes the message and the browser's wallet signs it; the server holds no key. The hats an address wears are read from the tree when signing in and again before every act.
- **Roles.** A person signed in by link or account reads what their Roles allow: `steward`, `node-lead` or `network-member`, loaded with `npm --prefix packages/admin run -s house:roles -- load` from a JSON document on stdin and read on every request, so a removed Role stops at once. A person on the records with no Role reads what the public reads. A wallet session acts by its hats instead.
- **Commits** a session makes are authored by the Hub (`house@org-os.invalid`), with `Org-Actor` naming the member.

`/sign-out` ends the session and goes back to another of the org's sites.

## What is public, and what is kept from whom

`data/visibility.yaml` decides what the public may read (`lib/visibility.mjs`). A record or field kept stricter than *members* lives outside git in the private store, a SQLite file (`house.db`, `server/private/`) in `ORG_OS_PRIVATE_DIR` or else `<instance>/.org-os/private/`, which `.gitignore` must name. Every read goes through the gate, so a thing a viewer may not see has no title, count or backlink for them.

**Raw file reads by Role (0.7.2).** An optional `files:` section in `data/visibility.yaml` says who reads which `data/**` file whole: a level is `members`, `role:<Role>` or `hat:<hat ref>`; a path takes its own level, else the longest folder holding it, else `default`. A member a file is kept from gets that file's records only as the public gets them, wherever the Hub reads them, and their writes to such a record are refused before it is read. The person at the machine is never held back by it. An instance without the section reads as before. Details: `packages/admin/README.md`, "Which data files a Role reads".

**The agent layer (0.7.1).** On a Hub that signs people in, `memory/**`, `MEMORY.md`, `HEARTBEAT.md`, `docs/plans/**` and `docs/agent-plans/**` are read only by those who decide under the workspace rule that governs them (or, with no such rule, the org's `maintainer` role). Anyone else is answered as for a file that is not there.

**The private store's schema.** 0.7 moved the store to schema 3 and 0.7.5 to schema 4, each on first start. An older org-os refuses a newer store, so back the store up before an upgrade (below).

## What it can edit

The registries are listed once, in `lib/registries.mjs`: 24 files in `data/`, 18 collections and 6 documents. The knowledge commons' canon (`data/kb/`) and the records of an org's own collections (`data/collections/<id>.yaml`) are handled beside them.

- **Collections edited as records:** `members`, `projects`, `meetings`, `ideas`, `funding-opportunities`, `relationships`, `sources`, `events`, `channels`, `assets`, `knowledge-gaps`, `systems` and `tasks`: field rows on the record page, and a source editor for the whole entry.
- **Collections with their own routes:** `boards` (arranged on the board itself), `proposals` (the ledger, written only by the proposal routes), `library` (receipts, written only by the library's Add and Remove), and, on a hub, `federation-requests` and `invites` (written only by the federation routes).
- **Documents, edited whole:** `finances`, `governance`, `knowledge-manifest`, `visibility`, `collections` and `imports` have no field editor. Since 0.7 the source editor (`/files/<path>`) edits each whole, staged into your change and checked when staged and again when applied; a governance text that would lock the org out is refused, and one that widens what is public is a publication. The same editor edits `IDENTITY.md`, `federation.yaml`, an instance's own data files outside the list, and the agent layer.

`app/src/editors.ts` holds this table, and `app/src/editors.test.ts` fails when a governed file has no line in it. Each entry is checked with Ajv against a JSON Schema in `packages/admin/schemas/` (`_generic.schema.json` for any without its own), and its cross-references must resolve (`REFS` in `lib/data-validate.mjs`). An entry's `id` cannot change. Deleting an entry that another entry names is refused, listing what refers to it.

## The workspace (0.7)

The org's working surface, beside the records:

- **Pages** (`pages/<id>.md`, at `/p/<id>`): a tree of pages written through editing sessions, one commit per session, with three-way merges, Compare, Suggest (a page edit made a proposal), attachments, and Record a meeting.
- **Collections:** `tasks`, `meetings` and the org's own collections (`data/collections.yaml`, `data/collections/<id>.yaml`), or private ones in the store, each with Table, Board, Calendar, List and Map views and saved views.
- **Conversation:** comments on a page or a record, replies, mentions and notifications, in the private store and never in git; presence, in memory only; Turn into a task.
- **Imports:** `npm run import -- notion|fileverse <folder>`, mapped first, then applied as one commit with a receipt in `data/imports.yaml`. It runs while no Hub runs for the instance.
- **Sources** (`/sources`) says where everything the Hub shows comes from.
- **Council memory:** `npm run memory -- add --level <hat or role>` posts an entry the Council alone reads to the running Hub, as a record of the private collection `council-memory`.

A workspace write is judged under the `workspace` change class (`schemas/change-classes.json`); with no rule naming it, it is direct. An org's `all` rule does not reach the workspace.

## How a change is decided

Saving a record stages it in your **change**, one per actor, kept outside the repository (`~/.org-os/admin/<instance>-<hash>/changes/`; `ORG_OS_ADMIN_HOME` moves it). Each staged op carries a base, the SHA-256 of the entry's canonical YAML (`server/changes/canonical.ts`), so an entry someone else changed since is marked stale.

The records a change touches fall into classes (`schemas/change-classes.json`), and the rules in `data/governance.yaml` say, per class, how such a change is decided (`lib/rules.mjs`): `direct`, `approve`, `consent` (an objection window), `vote`, or `system` (an outside system such as a Safe). With no rules the solo default applies: the maintainer decides alone.

- **Apply**, when the rule lets you decide alone, makes one commit of the whole change, with the trailers `Org-Actor`, `Org-Change` and `Org-Rule` (`server/changes/`).
- **Propose**, otherwise, turns the change into an entry of `data/proposals.yaml` and builds a local branch `proposal/<id>` from it, never pushed. Members approve, object, vote or comment. **Ratify**, once the rule is met, is one merge commit carrying `Org-Proposal` and `Org-Decision` that also writes the decision row into `data/governance.yaml`, and an entry in `DECISIONS.md` when the proposal has a statement (`server/proposals/ratify.ts`). Nothing closes a proposal on its own when a window ends. Proposal writes refuse while the repository is off the trunk (`governance.trunk`, else the branch the server started on). See the [proposals design](superpowers/specs/2026-10-18-org-os-0.6-p2-proposals-design.md).
- **Sync and Share** reach other members' proposals through `origin`: Sync fetches and fast-forwards the trunk (merging when the histories diverged and only the ledger conflicts); Share pushes the trunk by an explicit refspec, never forced. Both ask for a confirmation first.

The older routes (`PUT`/`POST`/`DELETE /api/registries/...`) still work: each is a one-op change applied at once under Apply's checks, with the message `admin(<registry>): update|create|delete <id>`.

## How it writes

For each file a change touches, the server parses it with the `yaml` package's document model, changes only the lines of the fields that differ (comments, quoting and layout elsewhere survive), parses the result back, and refuses with `409` if any other entry or field would read differently. Then it writes the files and makes one commit of exactly those paths to the **currently checked-out branch**. A page is written the same way, one commit per editing session. If git refuses the commit, every file is put back and the answer is `503`.

Writes to the repository are serialised by one in-memory lock. A WebSocket (`/api/events`) watches `data/` and refreshes the page when a file changes from outside, for example from an editor or an agent. The server does not run `npm run generate:schemas`: `GET /api/generated` says when a ratify has left `.well-known/` behind, and you run it yourself (see [Data model](DATA-MODEL.md)).

## Beyond records

- **Boards** (`/b/<id>`): the 17 built-in boards in `packages/admin/boards/` and an instance's own in `data/boards.yaml`, each a layout of blocks (lists, kanban, maps, metrics, proposals, systems and the others in `app/src/blocks/`).
- **Systems** (`/systems`): each entry of `data/systems.yaml` is read by a driver (`server/systems/drivers.ts`: link, Safe, Hats tree, Snapshot space, Gardens community and pool, DAO URI registration) every five minutes, reaching only the hosts it declares and sending only reads. An action on a system, on a proposal, is prepared as a Safe transaction for the Safe's signers (`server/proposals/prepare.ts`); the server signs, sends and writes nothing.
- **Compose and deploy** (0.7, `/compose`, `/deploy`): a DAO (a Safe, a Hats tree and its hats, a signer gate, a Snapshot space, an ERC-4824 registration) is composed as records with `deployment.status: composed` and decided like any change; `/deploy` lists the deployment's steps and who signs each; **Read back** stages what the chain holds as live Systems. Built for Sepolia only, tested against a fake node. The Hub never signs. See [Data model](DATA-MODEL.md) and `packages/admin/README.md`, "Compose and deploy".
- **Federation** (0.7.4, `/federation`): look a hub up, ask to join its network, decide requests under a join policy, and publish link records to the org's own atproto account after a confirmation. The write routes are off on a hosted Hub. See [Federation: Joining a network](FEDERATION.md#joining-a-network).
- **Network accounts** (0.7.5): for an instance whose `data/kb/organization.yaml` lists local nodes, a node adds or withdraws its own atproto account by signing in with it (`/network-account`); stewards confirm or remove them at `/network-accounts`. `GET /api/network` and `GET /api/network/nodes/:id` are public reads.
- **The knowledge commons** (0.7, `/c/knowledge`): its setup and its entry pages, read through `packages/org-os-kms`; an edit to the canon is prepared, then applied in one commit. Local only: the hosted image does not carry kms.
- **Operations and jobs**: what a resource offers (a module's check, a fetch, a share) runs as a job with no shell, and anything that writes or reaches the network needs a single-use plan first. The server never commits for a job.
- **Library** (`/library`): entries a shelf offers (boards, rule sets, systems; another shelf such as dao-os can add DAO templates), previewed, then added through your change like any other edit.

**The instance's own look (0.7.1).** An instance can make the Hub its own without forking it, with files under `house/`: `house/skin.css` (token values that re-tint the house), `house/themes.yaml` and `house/themes.css` (themes a viewer picks in Appearance), `house/bar.yaml` (a bar of the org's sites), `house/nav.yaml` (sidebar groups, each drawn for the Roles it names) and its images (served at `/instance-assets/:name`). An instance without them sees the house's own look.

## Backups

Git keeps no history of the private store, so it is backed up on its own, encrypted. Locally, with a key file kept away from the machine (`npm run house:backup:key -- <file>` once, then `ORG_OS_BACKUP_KEY_FILE`), the running server takes a backup every 24 hours and keeps 14; `npm run house:backup` takes one now and `npm run house:restore -- <file>` restores one with the server stopped. Hosted, the server holds only a maintainer's public key (`ORG_OS_BACKUP_PUBLIC_KEY_FILE`) and seals a backup to it every 6 hours. **Back the store up before an upgrade that moves its schema** (0.7, 0.7.5). Details: `packages/admin/README.md`, "The private store's backup".

## Safety properties

What the code enforces:

- **Git vocabulary is a list.** `server/git.ts` runs a git command only if it and each of its flags are on `ALLOWED`; stash, clean, reset and any force flag are not, and `tests/server/git.vocabulary.test.ts` holds the list. Push exists only as the Share operation and, hosted with `ORG_OS_PUSH=on`, the fast-forward-only push of the Hub's own commits.
- **Commits go to a fixed set of paths.** A commit may write only under `data/`, `pages/`, `memory/`, `docs/plans/`, `docs/agent-plans/` and `federation/outgoing/`, or to `IDENTITY.md`, `federation.yaml`, `MEMORY.md` and `HEARTBEAT.md`; `DECISIONS.md` only in a ratify. Never `.git/`, `.org-os/` or `.well-known/`, and never a path git ignores (`assertWritablePath` in `server/git.ts`).
- **It does not commit work it did not make.** A file with uncommitted changes, or one git was told not to look at, refuses the write with `409 DIRTY`.
- **Nothing stricter than members enters git.** The texts about to be committed are checked against `data/visibility.yaml` first.
- **Who may call.** Before any route, `server/guard.ts` refuses a request addressed to a host other than the one the Hub serves, a browser request whose `Origin` is not the app's own page, and a write that is not `application/json`.
- **A hosted Hub writes nothing to its instance by default.** While `HOUSE_INSTANCE_WRITES` is `off`, every route that commits, stages or ratifies answers 403 `INSTANCE_READ_ONLY`; sign-in, comments, notifications and per-member state still work. It follows its remote instead, fast-forward only, every `ORG_OS_REFRESH_EVERY` (`15m`).

What to know before using it:

- **Apply commits to the branch you are on.** Only the proposal routes check for the trunk.
- **Locally it never pushes on its own.** Commits stay local until you Share or push.

## The files

| Path | What it is |
|---|---|
| `packages/admin/server/` | the Hono API: `index.ts` (start-up), `serve.ts` (the server), `app.ts` (the registry routes), `git.ts`, and a folder per area, among them `changes/`, `proposals/`, `governance/`, `session/`, `private/`, `visibility/`, `boards/`, `systems/`, `deploy/`, `federation/`, `network/`, `workspace/`, `knowledge/`, `hosted/`, `portal/`, `operations/`, `resources/`, `library/`, `wizards/` |
| `packages/admin/launcher/` | the launcher behind `npm run open` |
| `packages/admin/scripts/` | `hub.ts` (the hosted entrypoint), the backup, Roles, session-key and import commands |
| `packages/admin/lib/` | plain JavaScript shared with the root scripts: the registry list, rules, proposals, change classes, and `standards/`, the builder `npm run generate:schemas` uses |
| `packages/admin/app/` | the React single-page app (Vite, TanStack Query, wouter, React Flow for maps) |
| `packages/admin/schemas/`, `boards/`, `wizards/`, `library/` | the JSON Schemas, the built-in boards, the wizards, the framework's library shelf |
| `packages/admin/tests/`, `app/src/**/*.test.ts(x)` | the tests |
| `deploy/hub/` | the container image, its settings (`env.example`) and the runbook (`RAILWAY.md`) |

## Test it

```bash
npm run test:admin     # vitest: the server, the API and the app's components
```

It needs the install above. `npm test` inside `packages/admin/` is the same suite; `npm run e2e` there runs the browser paths in the installed Chrome, and `npm run e2e:hosted` walks a hosted, read-only Hub signed in by emailed links.
