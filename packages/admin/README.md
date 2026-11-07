# @org-os/admin

Local-first admin app for any org-os instance: schema-driven editing of the
`data/*.yaml` registries with comment-preserving YAML round-trip; every change
is a structured git commit. M1 of the admin design, grown into the platform board of
`docs/superpowers/specs/2026-10-15-platform-board-design.md`.

## Run

From an instance root:

    npm run admin        # build UI + serve on http://localhost:4680
    npm run admin:dev    # server only, tsx watch (pair with `npm run dev:app` here for HMR)

To choose the port, or to serve another instance, put the flags after `--`:

    npm run admin -- --port 4691 --repo ../another-instance

Flags: `--repo <path>` (default: the directory you ran the command from),
`--port <n>` (default 4680). The same flags work with `npm run admin:dev`.
`tests/readme.test.ts` runs the command above as written.

Binds 127.0.0.1 only. Who may read and change what is decided by the mode, sign-in and the org's levels
(below).

## Modes

The same server runs in one of two modes, chosen at start (DAO-OS L5 spec §3):

- **local** (the default): with no session, whoever is at the machine acts as the member whose `handles.git`
  (or `email`) holds `git config user.email`, exactly as in 0.6. Sign-in is there whenever the org names a
  membership tree. The private store is `<instance>/.org-os/private/`, which `.gitignore` must name.
- **hosted** (`--hosted`, or `ORG_OS_HOSTED=1`): with no session the caller is the public. Reading anything not
  public, and every write, asks for a session (401 `SIGN_IN`). The session cookie gains `Secure`; the private
  store is `ORG_OS_PRIVATE_DIR` (a volume); the server refuses to start while the remote is public and holds what
  only members may read (`ORG_OS_REMOTE_PRIVATE=confirmed` when it cannot read whether it is). Binding to a public
  address, and the write routes listed as L9 carries in the L5 rulings log, are L9's.

## Sign-in

Sign-in with Ethereum (EIP-4361, signed with EIP-191 `personal_sign`) from the browser's own wallet. The server
writes the message and never signs or holds a key; the client asks the wallet for `eth_requestAccounts`,
`eth_accounts`, `eth_chainId` and `personal_sign` only.

| Call | Answer |
|---|---|
| `GET /api/session` | `{ mode, signIn: { chainId, tree } \| null, signedIn: false }` (`signIn` is null with no tree, or with the private store down), or the session: `{ mode, signedIn: true, actor, account, hats: [{ hat, name }], expiresAt, stale?, unread?, band? }`. `stale`: past the grace; `unread`: no reading kept yet (after a restart, while the tree cannot be read). With either, the hats are not known and `band` is the sentence to show |
| `POST /api/session/nonce` `{ address }` | `{ nonce, message }`: the message to sign, valid 10 minutes; 400 not an address, 409 `NO_TREE`, 429 too many waiting, 503 `NO_STORE` |
| `POST /api/session` `{ nonce, signature }` | the session, with its cookie (`house_session`, `HttpOnly; SameSite=Strict`, 24 h); `{ signedIn: false, notMember: true }` when the address wears no hat of the tree; 401 for a nonce or signature refused; 409 `NO_TREE` or another refused reading; 502 when the tree could not be read; 503 `NO_STORE` |
| `DELETE /api/session` | 204; the session ends and its cookie is cleared |
| `GET /api/actor` | who the request acts as |
| `GET /api/visibility` | for members: the tree's hats, the hats worn, the levels they may give, the policy, and `writable` (the collections they may write, so may narrow) |
| `POST /api/visibility/narrow` `{ target, level }` | narrows a record, a collection or a field at once (`{ commit, moved }`); a widening is proposed instead (409 `WIDENS`) |

- **Who you are.** A session acts as the member whose `handles.wallet` lists the address, exactly one; otherwise
  as the address itself (CAIP-10), named by the lowest hat it wears ("Council · 0x0000…00A1").
- **Hats** are read from the org's Hats tree when signing in and again before every act. Reads use a reading at
  most 5 minutes old; an act always reads again, so a hat taken off on chain stops the next act. When the tree
  cannot be read, a session keeps its last reading for an hour, then reads as the public with a band that says
  why; nothing ever says "not a member" for a tree that could not be read.
- **In the app** `/sign-in` is the card; signed in, the identity in the frame shows the hats worn, and its menu
  ends with Sign out. A 401 anywhere in hosted mode goes to `/sign-in?next=<where you were>`.
- **Commits** a session makes are authored by the Hub (`house@org-os.invalid`), with `Org-Actor` the member id or
  the address, and, for a direct apply, `Org-Hat: <hat ref> @<block>` naming each hat it acted under (to propose and
  to decide). `npm run validate:governance` reads them offline.

## The private store

Everything stricter than *members* — a record or collection kept at a hat or role, and a field
`data/visibility.yaml` restricts, such as `members.email` once it is narrowed — lives in one SQLite file outside
git (`house.db`), never in the repository. Git keeps placeholders where a proposal holds private data, and the
narrowing commit takes a value out of the files (its earlier versions stay in the history, which members could
already read). Reads merge the store into what git holds for those admitted to each level; anyone else sees that a
field is restricted (`restricted: { field: level }`), never its value. When the store is missing or cannot be
opened, the git side keeps serving, private reads and writes are refused, and Home says why. Narrowing
`members.email` never removes a member's identity: a member with no `handles.git` gets it, set to the e-mail, in
the same commit.


### Backup

The server opens one private store at start (`house.db`, L5 spec §10): in `ORG_OS_PRIVATE_DIR`, else
`<instance>/.org-os/private/`, which `.gitignore` must name. A store that cannot be opened leaves the git side
serving and says why on Home ("Needs you"). Git keeps no history of this file, so it is backed up on its own,
encrypted (AES-256-GCM) under a key that a maintainer holds:

    npm run house:backup:key -- ~/keys/house.key     # once: 32 random bytes, mode 600
    export ORG_OS_BACKUP_KEY_FILE=~/keys/house.key
    npm run house:backup                             # a backup now
    npm run house:backup -- --verify <file>          # everything a restore does but the move
    npm run house:restore -- <file>                  # with this instance's server stopped

- **The key** stays outside the repository and outside the store's folder (both are refused): "Keep a copy of
  this key away from this machine. Without it no backup can be read." A lost key is a lost backup.
- **A backup** is a consistent copy of the store (`VACUUM INTO`, taken between writes), sealed and written as
  `house-<UTC time>.db.enc` (`ORGOSPS1`, a 12-byte IV, the ciphertext, the 16-byte tag) to `ORG_OS_BACKUP_DIR`
  (default `<private dir>/backups/`), with a line in `manifest.jsonl` there: its SHA-256, schema version and row
  counts. Nothing in clear is written outside the store's own folder.
- **The server** takes one every `ORG_OS_BACKUP_EVERY` (default 24 h; `ms`, `s`, `m`, `h` or `d`, as `12h`), at
  start too when the newest is older than that, and keeps the newest `ORG_OS_BACKUP_KEEP` (default 14). With no key
  set it takes none; in hosted mode that, like any failed backup, is on Home: "The private store was not backed up:
  <why>."
- **A restore** refuses while the server for this repository runs (its pid file), opens the backup into the store's
  folder, runs `PRAGMA integrity_check` and checks the schema version, keeps the current file as
  `house.db.before-restore-<time>`, and moves the restored one in. A wrong key is "This backup cannot be read with
  that key."; a changed or damaged file "This backup has been changed or is damaged; it was not restored."
- **Off the machine.** Copying the backup folder elsewhere (another disk, object storage, a second host) is set up
  per deployment (L9). The files are sealed, so the copy may go where the key does not; keep the key's own copy apart
  from them.

## API

The app is one client of this API; a script or an agent is another.

| Call | Answer |
|---|---|
| `GET /api/status` | organization name, current branch, clean or dirty |
| `GET /api/registries` | the registries present, with kind and entry count |
| `GET /api/registries/:name` | the entries, or the document for a read-only registry |
| `GET /api/schemas/:name` | the JSON Schema the forms are drawn from |
| `PUT /api/registries/:name/:id` | replace one entry; commits `admin(<name>): update <id>` |
| `POST /api/registries/:name` | add one entry; commits `admin(<name>): create <id>` |
| `DELETE /api/registries/:name/:id` | remove one entry; commits `admin(<name>): delete <id>` |
| `WS /api/events` | `registry-changed` when a file under `data/` changes, and (`visibility`) after a narrowing |

What a caller can rely on:

- **A save is one commit that touches only the lines it changed.** A one-field
  edit is a one-line diff when the value sits on one line; saving an entry
  unchanged makes no commit.
- **A save changes the entry it was asked to change and nothing else.** Before
  a file is written, the new text is parsed back and compared with the file as
  it was: every other entry, and every field of the edited entry that the
  request did not change, must read exactly as before. Numbers are compared by
  the value the file's digits spell, not as JavaScript numbers: `10`, `10.0`
  and `1e1` are one number, 12345678901234567890 and 12345678901234567000 are
  two. If anything else would differ, the answer is `409` naming the entry and
  field, and nothing is written. The sentence gives the advice about long
  numbers only when a long number is the cause.
- **A save never commits work it did not make.** If the registry file already
  has uncommitted changes (staged or not), the save is refused with `409`
  naming the file, before anything is written. Uncommitted work in other files
  is left alone and does not block a save. A registry file that git has been
  told not to look at (`git update-index --assume-unchanged` or
  `--skip-worktree`) is refused the same way, naming the flag and the command
  that clears it: git calls such a file clean whatever it holds.
- **A save ends in a commit or changes nothing.** If git refuses the commit
  (another git command is running, or a commit hook says no) the file is put
  back, the git index is as it was, and the answer is `503` with the reason.
- **A delete leaves no reference pointing at nothing.** Deleting an entry that
  another entry names is refused with `409` listing what refers to it. The
  fields checked are the ones a write checks: a project's `lead`,
  `contributors`, `related_ideas` and `funding_source`, a meeting's
  `participants`, an event's `related_project`.
- **Errors are JSON with a sentence.** `{"error": "..."}`, or
  `{"errors": [{"field", "message"}]}` for `422`.

| Status | When |
|---|---|
| `400` | the body is not a JSON object; or the `Host` header is not an address the server can read (upper case, or something before the name) |
| `403` | the request is addressed to a host other than localhost, or comes from a web page that is not the app's own (`Origin`); or the registry is read-only |
| `404` | no such registry, entry or `/api/` address |
| `409` | an entry with that id already exists; the registry file has uncommitted changes, or git was told not to look at it; the registry file is not valid YAML, or reuses a value that is not there (a read of that file answers `409` too); the entry to delete is still referred to; or the save cannot be written without changing something else (see below) |
| `415` | a write without `content-type: application/json` |
| `422` | the entry fails its schema, names an entry that does not exist, or holds a field named `__proto__` |
| `503` | git refused the commit; nothing was changed |

Three things in a hand-written file that a save will refuse rather than guess at:

- **A value other entries reuse.** In YAML, `&name` marks a value (an anchor)
  and `*name` reuses it (an alias). Changing or deleting a value that carries
  an anchor would change every entry that reuses it, so it answers `409`
  naming the anchor and the entries. Changing the entry that holds the alias
  is fine: it gets its own value. A read shows an alias as the value it stands for.
- **A number that cannot be rewritten exactly.** An integer of any length is
  kept digit for digit in the file. `GET` answers in JSON, which carries about
  16 digits, so a longer integer reads rounded; sending the rounded number
  back in a save does not change the file. That holds inside a list or an
  object too: a request replaces such a value whole, and where the file held a
  longer integer that reads as the number sent, the file's digits are written.
  (The one case that is refused, `409`: two different long integers in the
  same field that read as the same JSON number, because the request cannot say
  which it means.) A decimal with more digits than a JavaScript number keeps
  is safe as long as its line is not rewritten; it is refused with `409` when
  the save has to re-serialize the file (see Scope), or replaces the list or
  object that holds it.

  How the file spells a number never refuses a save. A request replaces a
  list or an object whole, so a number inside it that the request did not
  change is written again from the request: `10.0` comes back as `10`, `1e3`
  as `1000`, `0x1F` as `31`, `.5` as `0.5`. The value is the same; the
  spelling, and with it whether another YAML reader calls the number an
  integer or a float, is not kept. A number on a line of its own keeps its
  spelling, unless the whole file is written again (see Scope). `tests/write-third-review.test.ts` holds this over 27 spellings in
  12 shapes of list and object.

  Two limits follow from JSON and are not refused, so a caller has to know
  them. A new integer of more than about 16 digits cannot be sent: it arrives
  rounded, and where it rounds to the integer the file already holds, the
  save answers `200` and changes nothing. And `.inf`, `.nan` and a number too
  large for JSON (`1e400`) read as `null`; inside a list or object that a
  request replaces they are written back as `null`.
- **A file that is not valid YAML.** A key written twice in one entry, a
  second document after a line `---`, a tab used to indent: every save to that
  file answers `409` saying what is wrong and at which line and column, until
  the file is corrected by hand. Reads still answer what the YAML library can
  make of the file. One fault stops reads as well: `*name` where no value
  before it carries `&name`. There is no value to show, so reads and saves of
  that registry answer `409` naming the alias, its line and column, and what
  to write in its place; the other registries are not affected.

One field name is refused in a request: `__proto__`, at any depth (`422`). It
is valid JSON and YAML, but it is the one key that ordinary JavaScript in a
caller (`target[key] = value`) turns into something other than data. An entry
that already holds it in the file loses it when saved without it; the app's
form leaves it out of what it sends and says so above the fields. `constructor`,
`toString` and the like are ordinary field names.

A caller that is not a browser sends no `Origin` header and needs only the JSON
content type:

    curl -X PUT localhost:4680/api/registries/members/ana \
      -H 'content-type: application/json' -d '{"id": "ana", "name": "Ana Silva"}'

## The board

`/` opens the board used last: **Organization** (projects, people, funding, partners, ideas, a
knowledge-gaps summary) or **Systems** (modules, crew roles and seats, the fleet, sources,
channels, KMS connectors). A card shows its kind, name, status, what needs you (when anything
does), and who changed it when. Click a card for its panel: facts, links (↗ = on the other
board), actions, history, and **Edit** for a record M1 can edit. ⌘K finds any card, operation
or registry. Card positions you drag are kept per board, outside the repository; "Reset layout"
clears them.

`npm run e2e` runs the golden path in the installed Chrome (playwright-core, `channel: 'chrome'`).

## Resources and graph

| Call | Answer |
|---|---|
| `GET /api/graph/:board` | `{ board, nodes, edges, portals }` for `organization` or `systems` |
| `GET /api/resources?board=&kind=` | the resources, filtered |
| `GET /api/resources?kind=system` | the outside systems in `data/systems.yaml`; `facts.driver` holds the driver's read (`ok`, `readAt`, `error`, `facts`, `sections`, `open`), read again every 5 minutes, each read limited to 8 s; only the server's reader has the network, and a driver reaches only the https hosts it declares |
| `GET /api/resources/:id` | `{ resource, edges, neighbours }`; encode the id (`person%3Agithub%3Ax`) |
| `GET`/`PUT`/`DELETE /api/layout/:board` | the positions you dragged |
| `WS /api/events` | also `resources-changed { ids }`, `job-started`, `job-output`, `job-finished` |

A source that is missing or unreadable is a card saying why (`kind: "absent"`), never an error.
The same graph without a server: `readResources(repo)` from `server/resources/index.ts`.

## Operations and jobs

| Call | Answer |
|---|---|
| `GET /api/operations?resource=<id>` | what that resource offers, and why an action is unavailable |
| `GET /api/operations` | every available operation on every resource |
| `POST /api/operations/:op/plan` `{ resource, params }` | the exact command, what it may write, its time limit, and — when it changes something or reaches the network — a nonce |
| `POST /api/jobs` `{ nonce }` | runs a planned operation (`202`, the job) |
| `POST /api/jobs` `{ op, resource, params }` | runs an operation that only reads, without a plan |
| `GET /api/jobs?resource=`, `GET /api/jobs/:id`, `DELETE /api/jobs/:id` | jobs, one job with its log, cancel |

What a caller can rely on:

- **Nothing runs through a shell.** Each operation builds an argument list. A module's command
  check runs the text its `module.yaml` declares, split on whitespace, only after the
  confirmation — and never when the text holds a shell character or names stash, clean, reset or
  a force flag.
- **Nothing that changes a file, a running agent, or reaches the network runs without a plan.**
  A nonce works once and for 2 minutes, and runs exactly the command its plan showed. Without
  one: `403`. Used or expired: `409`.
- **The platform never commits for a job.** It names every file a job changed; a change outside
  the paths the operation declares ends it `finished-with-surprises`, and a commit a job makes
  anyway moves HEAD and is reported the same way. Nothing is put back.
- **One job per resource, two at a time.** A second on the same resource answers `409`.
- **Jobs and layouts live in `~/.org-os/admin/<instance>-<hash>/`** (`ORG_OS_ADMIN_HOME` moves
  it). A job a stopped server left running is marked `interrupted` at the next start and never
  re-run.

## Changes

Every edit from the platform is staged in the actor's change (one per actor, kept in the admin
state directory, never in the repository) and applied as one commit under the org's rule.

| Route | Does |
|---|---|
| `GET /api/actor` | who this caller is: the member whose `handles.git` holds `git config user.email`, or `{ unknown: <email> }` |
| `GET /api/changes` | the actor's change: `ops`, their `classes`, the `rule` (`direct`, `sentence`, `source`), which ops are `stale`, each record's `current` entry |
| `POST /api/changes/ops` `{ ops }` | stage ops (`update` with `set`, `create`/`replace` with `value`, `delete`; `record` is `<registry>:<id>`); `422 { errors: [{ record, field, message }] }` |
| `DELETE /api/changes/ops/:n` | take op `n` out; `422 { errors }` when other ops need it |
| `POST /api/changes/ops/:n/rebase` `{ keep }` | bring a stale op up to date: `theirs` drops the fields both sides changed, `mine` re-bases |
| `DELETE /api/changes` | discard the change (`204`) |
| `POST /api/changes/apply` | one commit with `Org-Actor`, `Org-Change`, `Org-Rule` trailers; `409 { stale }`, `403 { reason }`, `422 { errors }`, `503` |
| `WS /api/events` | also `changes` after every write to a change |

The `PUT/POST/DELETE /api/registries/...` routes keep their success contract. Each is now a one-op
change applied at once under exactly Apply's checks (403 `{ reason, error }` for an actor git cannot
match or a rule that is not direct; 409 `{ error, code: 'DIRTY', paths }` for a file with uncommitted
edits), never touching the tray, and its commit carries the same trailers.

## What the Hub edits

Every governed file has a stated path through the Hub (ruling F-L3-3): the registries in `lib/registries.mjs`, the
files `schemas/change-classes.json` classes, and an instance's own data files. `app/src/editors.ts` holds the table;
this one is written from it, and `app/src/editors.test.ts` fails when either list names a file the table leaves out.
A registry page of a file with no path yet says "Read only here: a change to this file has no path in the Hub yet."

| File | How the Hub edits it |
|---|---|
| data/members.yaml; data/projects.yaml; data/meetings.yaml; data/ideas.yaml; data/funding-opportunities.yaml; data/relationships.yaml; data/sources.yaml; data/events.yaml; data/channels.yaml; data/assets.yaml; data/knowledge-gaps.yaml; data/systems.yaml | The record editor: field rows, and the whole-entry source editor on the record page. |
| data/boards.yaml | Arrange and block settings on the board, and the source editor on the record page. |
| data/proposals.yaml, the proposals ledger | Its own routes, by design: propose, approve, ratify and the rest write it, never an edit. |
| data/library.yaml, the library’s receipts | Its own routes, by design: the library’s Add and Remove. |
| the published files under .well-known/ | Generated from the data files, never edited (L8’s builder). |
| data/finances.yaml; data/knowledge-manifest.yaml; IDENTITY.md; federation.yaml | Read only here. The source editor comes with L6; until then a change to it has no path in the Hub. |
| data/governance.yaml, the rules | Read only here. The source editor comes with L6; until then a change to it has no path in the Hub. It is never staged today (R-L5-11.7): a later edit path must run the governance check (§7.6). |
| data/visibility.yaml, what is public | Read only here. The source editor comes with L6; until then a change to it has no path in the Hub. Narrowing a record has its own route (L5); widening one is a publication, decided as a proposal. |
| an instance’s own data files outside the registry list, such as data/horizon.yaml and data/access-grants.yaml | Read only here. The source editor comes with L6; until then a change to it has no path in the Hub. Rules govern each as a record of the org. |

## Governance (read-only)

| Route | Does |
|---|---|
| `GET /api/governance` | `{ model, description, rules, decisions, problems }`: the rules in force as sentences, decisions from `governance.yaml` and `DECISIONS.md` newest first, and what is wrong with the file. `model` is null when the file states none (the solo default, named in `problems`) |
| `GET /api/governance/decisions/:anchor` | `{ markdown }`: one `DECISIONS.md` section; 404 for an anchor it does not hold |

## Proposals

When a rule says a change needs more than the author, the tray's primary action reads *Propose*. A proposal is an
entry in `data/proposals.yaml`, the ledger (`docs/DATA-MODEL.md`, registry 17); its content is the staged ops, and
`proposal/<id>` is a branch built from them on this machine, never pushed. Every write is one commit on the
trunk, inside the repository's write lock, and a refused move is `409 { code: 'REFUSED', machine: 'proposal', state, event, reason }`.
Every route below answers the proposal as the caller sees it (a `ProposalView`: `derived`, `evaluation`, `rules`,
`stale`, `needsYou`, `can`, `cannot`, `check`, `branchState`), with what the write said beside it.

| Route | Does |
|---|---|
| `GET /api/proposals` | every proposal as a view |
| `GET /api/proposals/:id` | the view, the diff of the branch (`diff`, `note` when there is none) and each op's record now (`current`); for a member, when the proposal waits on a Safe, it also reads the outside system once per window and records a changed reading |
| `POST /api/proposals` `{ title, rationale, statement? }` | turn the actor's change into a proposal; `201` |
| `POST /api/proposals/:id/events` `{ kind, text?, vote?, of?, ref? }` | `approve`, `object`, `vote`, `comment`, `retract`, `attach`, `withdraw` |
| `POST /api/proposals/:id/load` | *Revise*: stage the proposal's ops into the author's tray, marked `revises`; answers the tray's change |
| `POST /api/proposals/:id/revise` `{ ops }` | *Update proposal*: new ops, a new `rev`; earlier approvals stop counting |
| `POST /api/proposals/:id/replay` `{ choose? }` | build the branch again on the trunk tip; on a stale proposal the author sends `choose: mine` or `theirs` |
| `POST /api/proposals/:id/prepare` `{ to, value, data, operation }` | the Safe transaction and its hash for a `system` rule; reads the nonce, posts and writes nothing |
| `POST /api/proposals/:id/check` | read the outside system now; may append a `system` event |
| `POST /api/proposals/:id/ratify` | when the rule is met: one merge commit with `Org-Actor`, `Org-Rule`, `Org-Proposal`, `Org-Decision`, the ledger and the decision row in it; `{ commit, decision }` plus the view. Any failure after the merge began ends in `git merge --abort`, the one undo |
| `POST /api/proposals/:id/close` `{ outcome }` | `rejected`, `expired` or `withdrawn` |
| `GET /api/generated` | `{ behind, since? }`: whether a ratify changed what `.well-known/` is generated from and `.well-known/` has not followed. Local history only; there is no regeneration here: run `npm run generate:schemas` and commit |

Ratify, reject and expire are acts of a person; the server never closes a proposal because a window ended. Writes
refuse while the repository is off the trunk (`governance.trunk`, else the branch the server started on).

### Sync and Share

Members on different machines reach each other's proposals through the shared remote, which is `origin` only.
Neither is automatic; both are on the instance's own card, with or without a fleet.

| Route or operation | Does |
|---|---|
| `fetch` (`POST /api/operations/fetch/plan`, then `POST /api/jobs`) | the one network read: `git fetch origin`, after a confirmation. It changes no file |
| `GET /api/sync` | `{ ahead, behind, trunk, state, fetchedAt, sentence }`, read from the last fetch; no network |
| `POST /api/sync` `{ nonce }` | with the nonce of a planned fetch: fetch, then fast-forward the trunk; or, when the two histories diverged, merge them if git merges them cleanly or if the only file in conflict is the ledger, `data/proposals.yaml` (merged by id, events unioned); any other conflict is refused in words and nothing is touched. It needs git 2.38 or later for the merge |
| `share` (an operation) | push the trunk to `origin` by an explicit `refs/heads/<trunk>` refspec, never forced, after a confirmation. The page follows the job to its end and says what the remote did; a push the remote rejects (it has commits this clone lacks) is reported, "Sync, then Share again", and never retried |

Propose, Revise, Ratify and the closings refuse with "Sync first" when the last fetch is older than 15 minutes or shows
commits the trunk lacks. Right after your own Share the last fetch still counts: the remote then differs from what you
fetched only by what you pushed. Every git process the server starts runs with `GIT_OPTIONAL_LOCKS=0`, so a read never
takes git's index lock, and `GIT_TERMINAL_PROMPT=0`, so a fetch or a push that needs credentials fails in words instead
of waiting on the server's terminal.

#### When Sync cannot merge: recovering by hand

Two cases need a person and git, outside the platform. In both, the remote holds what the others shared, and your
clone holds work the remote refused.

- **Two members ratified the same proposal.** The first Share wins; the second is rejected, and its Sync refuses,
  because both clones added a decision row to `data/governance.yaml` (and, with a statement, an entry to
  `DECISIONS.md`). The remote's ratification stands. Clone the remote again into a new folder and work from there
  (`git clone <remote> <new folder>`, then start the platform on it); your old clone keeps your commits, so you can
  read what you did after the ratify and do it again in the new clone. Nothing is lost on the remote, and nobody else
  needs to do anything.
- **Two proposals with the same id, of the shape before the random suffix** (`p-<date>-<NNN>`, minted before this
  release when two members proposed on the same day before either had fetched the other's). Sync refuses: "both sides
  opened a proposal with this id". The proposal already on the remote keeps its id. The member whose proposal did not
  reach the remote clones the remote again as above, stages the same change in the new clone and proposes it again;
  it gets an id of the current shape (`p-<date>-<NNN>-<xxxx>`). Approvals given to the unshared one were never shared,
  so they are asked for again. An id of the current shape does not collide this way.

## Library

`/library` in the app: what an organization builds itself from. It reads the framework's shelf and every shelf the
instance registers, previews an entry (what adding it would change, written nowhere), and **adds** and **removes**
entries through the change engine: Add stages the entry's records in your change, the tray's, and your rules decide it
when you apply or propose that change, like any other.

| Route | Does |
|---|---|
| `GET /api/library` | `{ sources, shelves, entries, problems }`: each entry as a row (kind, title, summary, version, source, standing, what it adds in a line, whether this org has what it needs, and `added`: its receipts still in force, `{ receipt, at }`). No values |
| `GET /api/library/:id` | One entry's manifest, with its `installs`; 404 for an id it does not hold |
| `GET /api/library/:id/preview` | What adding it would change, without adding it: the records it would create and their change classes, who decides each under the rule in force, what it needs and whether the org has it, the `fields` it asks for (name, description, default, required), the hosts a driver would reach (read only), `cannotAdd` (the sentence that keeps it from being added, or null), the `refusal` with the next free id when its id is taken, and its `receipts` (`{ id, at, by }`) |
| `POST /api/library/:id/add` | `{ config? }`: stages the entry's records and its receipt in your change, as one. Answers your change; 409 `{ code: 'NOT_ADDABLE', error }`, 409 `{ code: 'TAKEN', error, nextFreeId }`, 422 `{ errors: [{ record, field: 'config.<name>', message }] }`, 403 for a reader who is no member, 404, 400 for a body that is not `{}` or `{ config: {...} }` |
| `GET /api/library/receipts` | Every receipt in `data/library.yaml`, removed ones too |
| `GET /api/library/receipts/:id/removal` | What removing that add would do, without removing it: each record it created, `as added`, `edited` (since the add) or `gone`, with the records that still name it; `asks` (the edited ones); who decides; a `refusal` when it was already removed |
| `POST /api/library/receipts/:id/remove` | `{ take? }`: stages the deletes of what the add created and the receipt's removal. Answers your change; 409 `{ code: 'ASK', asks, error }` when `take` does not name every edited record, 409 `{ code: 'REMOVED', error }`, 422 `{ errors }` from the change engine's own delete check (a record another record still names), 403 for a reader who is no member, 404, 400 for a body that is not `{}` or `{ take: [...] }` |

Preview and the two removal reads write nothing. Every other verb on these addresses is the API's own "no such address".

**Shelves.** A shelf is a folder: `shelf.yaml` (`name`, `title`, `entries: [<kind>:<slug>]`) and one
`<kind>/<slug>/entry.yaml` per entry. Every entry is checked against the framework's `library/entry.schema.json`, and its
`source` must be the shelf's `name`. The framework's own shelf is `library/`, named `framework`; `library/first-set.yaml`
names what it serves (the design's recommended first set), the 15 built-in boards are listed as *Built in* when it says
`built_in_boards: true` (previewable, never added), and one bad entry refuses that whole shelf, in words. An instance
registers other shelves in `federation.yaml`:

```yaml
library:
  shelves:
    - path: shelves/dao   # relative to the instance root, or absolute
```

A registered shelf that cannot be read, or one bad entry in it, leaves out only that shelf or that entry, and
`problems` says so in a sentence (a shelf missing or malformed, an entry that fails the schema or says it comes from
another shelf, an id the framework already serves: the framework's copy wins). The list never answers 500 for it.

**Config.** An entry's `installs` may hold `"${config.<name>}"` (quoted in YAML) in a record id and in any string of
`value` or `set`. A string that is exactly a placeholder becomes the value given, with its type; a string that holds one
has it written in. Every placeholder must name a property of the entry's `config`, or the entry is refused when the
shelf is read. Add checks the config against the entry's `config` (its properties, `required`, nothing else), with
defaults applied; each problem comes back as a 422 on `config.<name>`, and the page says it beside that field. Preview
uses the defaults only, and leaves a placeholder without one as it is written.

**Receipts.** An add stages, beside the entry's records, a receipt in `data/library.yaml` (class `records`), one per
add: its `id` (the entry id with `:` → `-`, then `-2`, `-3`…), `entry`, `version`, `shelf`, `created` (each record and
`base`, the SHA-256 of its canonical YAML as created), `status` (`installed` or `removed`), `by`, `at` and `decision`
(`{ rule, change }` for a change applied directly, `{ proposal }` for one ratified), and `removed`. While staged, `by`,
`at`, `decision` and every `base` are null; they are **sealed** where the change is applied (`by` the member, the day,
the rule and the change's id) or proposed (the proposer, the day, the proposal's id; Revise seals again). A committed
receipt with any of them null is an error in `validate:data`. A removal is sealed the same way, into `removed`.

A receipt rides along in class judgement: an add is decided by the classes of what it creates, and the receipt's own
class counts only in a change that holds nothing else. Apply, Propose and the tray keep an add or a removal whole: the
receipt does not go without its records, nor its records without it.

**Refusals, in this order (the first that applies is said):** a built-in board; an entry that adds nothing; an entry
that changes records the org already has (a rule set says its own sentence); an entry whose maturity is `raw`; one that
needs something this org does not have yet (read through your own staged change); a record id that is already taken
when the entry has no `id` in its config. A taken id the person can change is not a refusal of the entry: the preview
offers the next free id, and Add answers 409 `TAKEN` with it.

**Remove** undoes exactly what an add created. A record edited since the add is deleted with its edits only when `take`
names it, and it must name all of them, or nothing is staged (409 `ASK`); the page asks first, naming them. A record
already gone is skipped and said as gone. A record another record still names is refused by the change engine's own
delete check, and the removal preview lists those records in advance. The records are read through your own change,
as their referrers are: one you deleted there is gone, one you edited there is edited. If records were edited after you
opened the removal, the page looks again and names them rather than saying the API's sentence.

**Not here yet:** entries that change records the org already has (rule sets among them) come with L7; the toolkit's
knowledge shelf (waits on the licence decision); update to a newer version; *Preview on my data*; the *For this org*
ranking; the doctor's drift check.

## Scope (M1)

- 12 collection registries editable (`systems`, the org's outside systems, since
  0.6); `finances`, `governance`, `knowledge-manifest` read-only. `governance`
  is read as instances write it: the `governance:` wrapper, a flat file, or
  `decision_model`; a file of several YAML documents answers `409`.
- Direct mode only: saves commit to the current branch as
  `admin(<registry>): <verb> <id>`, with three trailers: `Org-Actor`, the id of
  the member whose `handles.git` (or email) holds `git config user.email`
  (anyone else is refused, 403); `Org-Change`, a `chg_...` id that is never
  stored; and `Org-Rule: <rule id>/direct`, the id of the rule that governed the
  change (`solo` under the solo default), comma-joined when several rules did.
  Proposals land in M3.
- Nested structures edit as YAML sub-fields. A save rewrites only the lines of
  the fields that changed: comments, quoting, line lengths, indentation and
  line endings (LF or CRLF) elsewhere in the file are left as they are.
  Replacing a whole nested object/array drops comments *inside that value*;
  one written on a single line (`[a, b]`) stays on a single line.
- Two cases re-serialize the whole file, in the YAML library's own layout: an
  entry written in flow style (`- {id: a, ...}`), and deleting the last entry
  of a list. The data is checked as for any save (above), so every value
  stays the same value; but the text of entries nobody edited can change, and
  the commit's diff is then longer than the edit. Seen so far: flow entries
  beside the edited one are laid out again (seen in review), and a number may
  be written in another form of the same value (this list is held by
  `tests/write-second-review.test.ts`): `0x1F` as `0x1f`, `1e3` as `1e+3`,
  `.5` as `0.5`, `+1` as `1`, `012` as `12`, `.NaN` as `.nan`, `!!int "3"`
  as `!!int 3`.
- Each save reads the file four times (to edit, twice to check, to answer) and
  runs git four times (is the file hidden from git, is it clean, add, commit).
  The reads took about 0.3 s on a 5,000-line registry; that was measured
  before the first of those git questions was added.

## Wizards

A wizard is data in `wizards/<id>.yaml` (checked by `lib/wizards.mjs`), walked by the wizard machine
(`lib/machines/wizard.mjs`: intro, steps, review, running, done or failed) and drawn by the wizard part
(`app/src/wizards/WizardFrame.tsx`, shown in each state on `/parts`). One decision per screen; every
screen says what it writes; nothing is written before the review is confirmed, and `running` is entered
from the review and nowhere else. Answers in progress are a draft kept outside the repository.

| Route | Does |
|---|---|
| `GET /api/wizards`, `GET /api/wizards/:id` | the wizards, and one whole |
| `GET /api/wizards/:id/draft`, `PUT …`, `DELETE …` | the draft (`{ index, answers }`, at most 16 KB), kept in `~/.org-os/admin/<instance>/wizards/`. Discarding deletes only that file |
| `GET /api/bootstrap/claim` | whether the claim below is open here, and who may be claimed |
| `POST /api/bootstrap/claim/plan` `{ member }` or `{ create: { name } }` | the exact line, the address as git reports it, the commit and its trailers, the command, and a single-use nonce (120 s). The server reads the address itself; the body never carries one. Refusals are `409 { error }` |
| `POST /api/bootstrap/claim/confirm` `{ nonce }` | re-checks everything on freshly read files, runs `scripts/claim-handle.mjs`, commits once with `Org-Actor: unknown <address>` and `Org-Rule: bootstrap/claim`. `409` if anything changed since the plan; `503 WRITTEN_NOT_COMMITTED` if git refuses the commit |

**W2a, claim your handle** (`/wizards/claim-handle`; the read-only notice links to it). The change loop
refuses an actor it cannot name, so the first write of an instance whose git address no member holds
cannot go through it. The claim is the one way round: it adds that address to a member who holds none,
and only where nobody has written a rule about who members are (`lib/claim.mjs`, `rulesAreImpliedSolo`:
the model is `solo-maintainer` or unstated, `rules` is absent or empty, and `data/governance.yaml` can be
read; a file that is present and cannot be read refuses). It also refuses a known actor, two holders, a
member who already holds an address or is not a person, a members file with uncommitted changes, and an
address git has never seen author a commit on the branch served. That last is a sanity check, not a
proof: author addresses are public in `git log`. Undo it with `git revert` of its one commit.

**W1, first screens** (`/wizards/open-instance`). Collects what the framework's `clone:framework` reads
and shows that command and its config at the review. It runs nothing: creating a folder is a write path
this app does not have. It stops before "how it decides" and "starting set" (they need the library and
rules) and before "run".

## The Hub's look

The Hub is drawn with one element set, the "house": a frame (sidebar, top bar, tray, inspector), atoms, rows, record
headers, collection views, maps, governance parts and the workspace chrome. What each element is and when it is used
is in the L4 element-set spec, `docs/superpowers/specs/2026-10-29-dao-os-l4-element-set-design.md` (§10–§15 bind).
The look it was drawn from is the approved gallery, `docs/design/dao-os-element-gallery.html`, with its screenshots in
`docs/design/gallery-shots/`. Where the two disagree, the spec wins and the gallery is fixed.

Every element is drawn, in each of its states, from fixtures alone on `/parts` (an index, then one page a group:
`/parts/tokens`, `/parts/atoms`, `/parts/rows`, `/parts/views`, `/parts/map`…). That is the place to look at a part,
and `npm run e2e:parts` compares it against stored images. A few of those images are committed as the record of the
look, in `docs/design/house-record/` (WebP, light, at most 150 KiB each).

Each group's rules live in its own sheet under `app/src/design/css/` (`controls`, `states`, `atoms`, `frame`,
`parts`, `rows`, `needs`, `views`, `workspace`, `governance`, `map`, `library`, `door`, and `utilities` last, so a
text helper wins over a group's rule of the same weight). `design.css` only imports them. `design/legacy.test.ts`
fails when a sheet draws a class no element names, or an element names a class no sheet draws that is not on its
commented list of hooks (a class a library reads, or a test finds a part by).

## Skins

The look is a skin: a CSS file of token values in `app/src/design/skins/`. No part, block or page holds a colour,
size, space, rule, corner, shadow or movement of its own; the sheets draw only with `var(--token)`, and a test fails
when a raw value appears (a colour in hex, a function or a name, a length, a weight, a family, a keyword size, in a
stylesheet or in a style object of any shape).

Two skins ship:

- **`house` is the default and the fallback.** It is the Hub's look: warm paper, raised surfaces, one moss for what
  is selected, staged or yours, one clay for what needs a person, and ink for the one primary action. `house.css`
  owns the plain `:root`, so a page is drawn in house from the first byte, before any script has run, and an unknown
  skin id falls back to it. ⌘K names it "Skin: Hub".
- **`bare` is a test skin.** It keeps P1's Index look (mono labels, square edges, no motion), so the tests can show that
  a skin changes the look without touching a part, and that every token has a value. The guards in `css.test.ts` read
  its values.

`sleek` and `sample` are gone.

**Fonts.** The house sets type in three self-hosted variable fonts: Fraunces (`--display`: the greeting, the door),
Geist (`--sans`: everything else) and Geist Mono (`--mono`: ids, addresses, wells). The WOFF2 files sit in
`app/src/design/fonts/` with their OFL licences, latin and latin-ext. They are copied from the
`@fontsource-variable/*` packages (named, with a hash per file, at the top of `fonts.css`), not depended on. No font
host is asked: `fonts.test.ts` fails if a client file names one, or if a file's hash changes. Bare draws in the
system's own stacks.

**Icons.** `design/Icon.tsx` draws every icon: Lucide outlines (`lucide-react`, pinned), plus the four house glyphs
(`hat`, `safe`, `pool`, `seal`) in `glyphs.ts`. The stroke is `--icon-stroke`, and the sizes are `xs sm md lg`
(`--ic-xs` … `--ic-lg`: 13, 14, 16 and 20). An icon is `aria-hidden` unless it is given a label, since the words
beside it carry the meaning. Arrows and chevrons mirror under `dir="rtl"`. `kindIcon(kind)` names the glyph of a
record's kind (spec §3.9).

Tokens come in groups (each skin's file is written in this order):

- **colour**: `--paper --ink --mute --faint --rule --wash --attn --raised --edge --solid --on-solid --focus`, and the
  house's surfaces and pairs, `--pop` (menus, the palette, sheets), `--sunken` (wells, the map canvas, board
  columns), `--wash-strong`, `--rule-strong`, `--on-accent`, `--attn-soft` and `--map-dot`. Then the roles a skin may
  draw apart from them: `--accent` and `--accent-soft` (selection, a staged change, what is yours), `--row-hover`,
  `--nav-ink`, `--nav-on-bg`, `--input-fill`, `--input-edge` and `--block-bg` (a block's surface against the page).
  Bare sets each to the colour it drew, by naming another token (`--accent: var(--ink)`) or `transparent`.
- **type**: the families (`--display --sans --mono`, and `--soft`, Fraunces' softness), `--fs-*` (`--fs-d-*` for the
  door), `--lh-*`, `--fw-*` and `--ls-*`. Then the faces a skin chooses for a kind of text: `--label-font` and
  `--label-case` (the small labels over rows and fields, and the section heads), `--font-btn`, `--nav-on-weight`, and
  `--font-data` / `--data-nums` (what carries data: meta lines, status, dates, chips, segments, tabs, counts). The
  house reads them all in Geist as written; bare draws labels and section heads in mono capitals, and data in mono.
- **space**: `--sp-1` … `--sp-18`, in order (16 to 18 are the door's rhythm).
- **rules, marks, corners, depth, motion**: `--rule-w*`, `--stroke-w`, `--focus-w` (the ring), `--input-bw` (an input's
  four borders: bare draws only the underline); the corners `--radius-xs`, `--radius-sm`, `--radius-ctl` (buttons),
  `--radius-input`, `--radius` (surfaces, map nodes, cards), `--radius-pop`, `--radius-lg`, `--radius-plate`,
  `--radius-chip` and `--radius-step` (a wizard step marker); the depth `--shadow-card`, `--shadow-raise`,
  `--shadow-pop` and `--scrim`; the motion `--dur`, `--dur-1`, `--dur-press`, `--dur-2`, `--dur-3`, `--dur-flow`, `--ease`
  and `--press-scale`. Bare's durations are `0s`, so it moves nothing.
- **structure**: `--w-*`, `--h-*` (the shell, rows, controls, panels and each element's own), `--o-dim` (what is
  closed or out of reach), and for a field `--input-pad` and `--input-w`.
- **the workspace**: the editor's, the comment thread's and the mention picker's own widths and type.
- **icons**: `--ic-xs --ic-sm --ic --ic-lg` and `--icon-stroke`.
- **markup a skin shows**: `--block-pad` (padding inside a block), `--divider` (the page's structural lines, apart from
  the edge of a control), `--nav-pad` (a menu entry), and three that show markup bare hides: `--icon-display` (the icon
  before a menu entry), `--brand-dot-display` (the org's seal beside its name) and `--product-display` (the product's
  name in the menu foot). Bare sets each to what it drew before the token existed (padding 0, the edge colour, `none`).

To add a skin `calm`:

1. Copy `skins/bare.css` to `skins/calm.css` and replace `bare` with `calm` in its three selectors
   (`:root[data-skin="calm"]` for light, the same under `prefers-color-scheme: dark` with `:not([data-theme="light"])`,
   and with `[data-theme="dark"]`). Change values; keep every token. Leave the plain `:root` to house.
2. Add `@import './calm.css';` to `skins/index.css`, after `house.css`, and `{ id: 'calm', label: 'Calm' }` to
   `skins/index.ts`.
3. Run `npm test`. `skins/skins.test.ts` fails if a token is missing, if a colour has no dark value, or if the file is
   not registered and imported. `skins/contrast.test.ts` fails if a pair cannot be read (below).

Contrast is a property of the tokens, so it is tested in both dark blocks (the one under the system preference and the
one under the viewer's choice, which must hold the same values). For every skin, in light and in dark, text (`--ink`,
`--mute`, `--faint`, `--attn`, `--accent`) must reach 4.5:1 on every surface it sits on (`--paper`, `--raised`,
`--pop`, `--sunken`, `--wash`, `--accent-soft`, `--attn-soft`, `--row-hover`, `--input-fill`, `--block-bg`,
`--nav-on-bg`). The edge of a control, a selection and the focus ring must reach 3:1. `--rule` is a hairline for
decoration and is not measured; a skin that draws a boundary a person needs to find with it is wrong. Bare's `--faint`
text is under the floor, as P1 drew it; the test lists that as a known exception and fails when it stops being true.

**What a skin cannot change.** Layout geometry is not a skin. The code computes the position of a block on a canvas
board (`boards/layout.ts`: a cell of 88, a row of 360, a gap of 16, in pixels), the mini map (`record/MiniMap.tsx`) and
the map's layout (`map/layers.ts`), and it does so in numbers, not tokens. The widths and gaps a skin does set
(`--w-*`, `--h-cell`, the `--sp-*` scale and so `--sp-11`, the board gap between blocks on a grid or in a flow, and the
type scale, which sets a card's height) sit on top of those numbers. A skin that moves them far from the house's can
make blocks on a canvas board touch or overlap by a few pixels, and the grid and flow layouts will not tell it. Keep
them near the house's, and look at `/b/systems`, `/b/organization` and `/parts`. Reading the canvas gap from the token
would close this; it is not done.

A skin is chosen per viewer, with ⌘K ("Skin: Bare", "Skin: Hub"; the palette offers it only when there is a choice),
and is kept in this browser. `index.html` sets it from that choice before the stylesheet is used, so the first frame is
already drawn in it; `main.tsx` then checks it against the skins the client ships. The instance default is a client
setting: build with `VITE_ORG_OS_SKIN=calm npm run build`; an unknown id falls back to `house`. The instance's own data
has no field for it yet, so the default is per build.

## Sign-in by email, Roles and the read-only switch

A person signs in with a link sent to their email address. No wallet and no Hats tree is needed; when the org names
a tree, "Sign in with a wallet" is offered beside it.

| Call | Answer |
|---|---|
| `POST /api/session/email` `{ email, return? }` | 202 and the same sentence for every address, known or not, limited or not. The answer is made before anyone is looked up; a known person within the limits then gets a link. |
| `POST /api/session/link` `{ token }` | spends the link once and sets the session cookie: `{ signedIn: true, return }`. An unknown, used or expired link, or a person removed since, is one 401. |
| `GET /api/session` | adds `methods` (`email`, and `wallet` when a tree exists), the signed-in `person` (id, name, Roles, nodes) and `instanceWrites` |
| `DELETE /api/session` | ends the session at the house and clears both cookies |

- **The link** is `<hub>/sign-in/link?token=…`. It works once, for 15 minutes. The page asks for one click before it
  posts the token, so a mail scanner that opens the link leaves it working. Afterwards it goes to `return`: a path in
  the Hub, or an https address on the cookie's domain. Anything else goes to the Hub's root.
- **Limits:** 3 asks per address and 10 per client in any 15 minutes. A limited ask gets the same answer as any other.
- **No addresses are kept.** The house stores a keyed hash of each address (HMAC-SHA-256 with
  `HOUSE_EMAIL_PEPPER`, after trimming and lower-casing it), never the address itself, and logs neither.
- **The cookie** is a compact JWS (EdDSA, Ed25519) holding `{ iss, sub, roles, nodes, iat, exp, jti }`, for 24 hours:
  `Domain` from `SESSION_COOKIE_DOMAIN`, `Path=/; Secure; HttpOnly; SameSite=Lax`. The org's other sites verify it with
  the public key alone. The house reads the Roles from its store on every request, so a Role removed at a reload
  stops at the house at once. Under 12 hours left, the cookie is re-issued with the current Roles.
- **No Role:** a person on the records who holds no Role is signed in, but reads what the public reads. They see only
  their own Profile (`GET /api/actor`) and can act on nothing.

| Variable | Hosted | Locally |
|---|---|---|
| `HOUSE_EMAIL_PEPPER` | required: 32 bytes or more, as hex (`openssl rand -hex 32`) | a fixed, public pepper |
| `HOUSE_SESSION_PRIVATE_JWK` | required: `npm run -s house:session-key -- new` | a key made for the run |
| `SESSION_COOKIE_NAME` | required; not `__Host-`, not the wallet session's | `house_person_dev` |
| `SESSION_COOKIE_DOMAIN` | the Hub's host or a domain it is inside; unset keeps the cookie on the Hub's host | none |
| `RESEND_API_KEY`, `MAIL_FROM` | required (the sender: an address, or `Name <address>`) | both or neither; with neither, the link is printed to the log |
| `HOUSE_INSTANCE_WRITES` | `off` by default | `on` by default |

Hosted with none of the sign-in variables set, the email method is not offered and the server still starts. Setting
only some of them stops the start, and the refusal names the missing variables, never a value.

### Roles: `npm run -s house:roles -- load`

The Roles come from a JSON document read on **stdin only**: `{ roles_version, people: [{ id, name, email_keys, roles,
nodes }] }`, as `schemas/roles-doc.schema.json` describes. The Roles are `steward`, `node-lead` and
`network-member`. Loading replaces the whole table. The command prints counts only: no name, id or key. A document
containing an address (anything with `@`) is refused. The org builds the document from its own records.

### The session key: `npm run -s house:session-key`

- `-- new` prints a private Ed25519 JWK on one line and nothing else. Put it in `HOUSE_SESSION_PRIVATE_JWK`.
- `<private JWK> | … -- public` reads the private key on stdin and prints its public JWK, without `d`. The org's
  sites read it as `HOUSE_SESSION_PUBLIC_JWK`.

### The read-only switch: `HOUSE_INSTANCE_WRITES`

While it is `off`, the house writes nothing to its instance:

- Every route that commits, stages or ratifies answers 403 `INSTANCE_READ_ONLY`, "This Hub is read-only until
  writes are turned on. Nothing was written." That covers records, the tray, the library, proposals, the narrowing,
  sync, the push's retry, the claim and commands. A write route the table (`server/hosted/instance-writes.ts`) does
  not name is refused too.
- Sign-in, sign-out, wizard drafts and board layouts still work. They are kept outside the instance.
- A proposal's page builds no branch and records no reading. The private store is not reconciled at start. No push
  runs, whatever `ORG_OS_PUSH` says.
- `GET /api/status` says `instanceWrites: "off"`, and the app hides the tray and every other write control.

Only `on` and `off` are accepted; any other value stops the start. A hosted house will not start with `on` while
`BEFORE_PILOT_OPEN` lists known write defects. Each release that fixes one removes it from the list.

## The private store's backup

The server opens one private store at start (`house.db`, L5 spec §10): in `ORG_OS_PRIVATE_DIR`, else
`<instance>/.org-os/private/`, which `.gitignore` must name. A store that cannot be opened leaves the git side
serving and says why on Home ("Needs you"). Git keeps no history of this file, so it is backed up on its own,
encrypted (AES-256-GCM) under a key that a maintainer holds:

    npm run house:backup:key -- ~/keys/house.key     # once: 32 random bytes, mode 600
    export ORG_OS_BACKUP_KEY_FILE=~/keys/house.key
    npm run house:backup                             # a backup now
    npm run house:backup -- --verify <file>          # everything a restore does but the move
    npm run house:restore -- <file>                  # with this instance's server stopped

- **The key** stays outside the repository and outside the store's folder (both are refused): "Keep a copy of
  this key away from this machine. Without it no backup can be read." A lost key is a lost backup.
- **Sealed to a public key (hosted, L9 §7.1).** A hosted Hub must not hold what opens its own backups, so it seals
  them to a maintainer's X25519 public key (`ORGOSPK1`) and uses no symmetric key:

      npm run house:backup:keypair -- ~/keys/backup.key ~/keys/backup.pub   # on a maintainer's machine, once
      export ORG_OS_BACKUP_PUBLIC_KEY_FILE=~/keys/backup.pub                # the only key the server holds
      ORG_OS_BACKUP_PRIVATE_KEY_FILE=~/keys/backup.key npm run house:backup -- --verify <file>   # for that run only

  Locally the public key is optional; when it is set it is used instead of `ORG_OS_BACKUP_KEY_FILE`. L5's `ORGOSPS1`
  files still open with their key file. Hosted with no public key, Home says "The private store was not backed up:
  no public key is set. …".
- **A backup** is a consistent copy of the store (`VACUUM INTO` on the store's read connection, a snapshot that
  holds no write lock and waits for none), sealed and written as
  `house-<UTC time>.db.enc` (`ORGOSPS1`, a 12-byte IV, the ciphertext, the 16-byte tag) to `ORG_OS_BACKUP_DIR`
  (default `<private dir>/backups/`), with a line in `manifest.jsonl` there: its SHA-256, schema version and row
  counts. Nothing in clear is written outside the store's own folder. `ORG_OS_BACKUP_DIR` inside the repository is
  refused when hosted, and locally unless git ignores it. A copy or a restore cut short leaves a `.backup-*` folder or
  a `house.db.restoring-*` file in the store's folder; the next server to start (with no other running) removes it
  and says so in its log.
- **The server** takes one every `ORG_OS_BACKUP_EVERY` (default 24 h; `ms`, `s`, `m`, `h` or `d`, as `12h`), at
  start too when the newest is older than that, and keeps the newest `ORG_OS_BACKUP_KEEP` (default 14). With no key
  set it takes none; in hosted mode that, like any failed backup, is on Home: "The private store was not backed up:
  <why>."
- **A restore** refuses while the server for this repository runs (its pid file), opens the backup into the store's
  folder, runs `PRAGMA integrity_check` and checks the schema version, keeps the current file as
  `house.db.before-restore-<time>`, and moves the restored one in. A wrong key is "This backup cannot be read with
  that key."; a changed or damaged file "This backup has been changed or is damaged; it was not restored."
- **Off the machine.** Copying the backup folder elsewhere (another disk, object storage, a second host) is set up
  per deployment (L9). The files are sealed, so the copy may go where the key does not; keep the key's own copy apart
  from them.

## Test

    npm test                          # vitest: server services, API, the elements and pages
    npm run typecheck                 # tsc, no emit
    npm run e2e                       # the golden path, the claim wizard, the proposals walk (two clones) and sign-in, in Chrome
    npm run e2e:parts                 # every /parts group, at 1440 and 390, light and dark, against its stored images
    npm run e2e:parts -- --group map  # one group
    npm run e2e:parts -- --update     # store what it sees (the first run on a machine, or after a redraw)
    npm run e2e:reflow                # every route and /parts group at 390 and 320 (and 700, rtl, text 200 %, forced colours)
    npm run e2e:routes                # every route of the Hub, seeded, at 1440 and 390, light and dark, against its stored images
    npm run e2e:routes -- --update    # store what it sees
    npm run e2e:a11y                  # axe (WCAG 2.2 AA tags) on every route and /parts group; the live region with a modal open
    npm run e2e:keys                  # the golden paths by keyboard alone, at 1440 and 1000
    npx tsx tests/e2e/gallery-compare.mts <dir>   # after e2e:parts: the gallery's shots beside this build's, in one page

The stored `/parts` images are kept out of git (`app/e2e/parts/`), and so are the route shots (`app/e2e/routes/`) and the
reflow walk's text-200 % and forced-colours shots (`app/e2e/reflow/`); the first `e2e:parts` or `e2e:routes` on a
machine is a `--update`. `-- --group <id> --record` writes that group's committed record files to `docs/design/house-record/`,
after a passing compare, for the groups `tests/e2e/shoot.mts` names. `gallery-compare` refuses a `<dir>` inside a git
repository: the page it writes is a look, not something to commit.

A test is ended after 30 s: the limit is there to end a hang. On a machine
busy with other work, raise it for one run:

    ADMIN_TEST_TIMEOUT_MS=120000 npm test
