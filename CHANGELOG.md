# Changelog

All notable changes to **org-os** (the framework) are documented here. The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org) within a given line — but note the **2026-06-17 `0.x` pre-beta re-baseline** (see `[0.5.0]`), a one-time deliberate, non-SemVer renumbering of `3.5 → 0.5`.

For the policy that governs what counts as a version bump, see [`docs/VERSIONING.md`](docs/VERSIONING.md).

## [Unreleased]

_(Append changes here as they land.)_

## [0.7.6] — 2026-11-26

**0.7.6 is the docs read against 0.7, and one fix in `org-os-kms publish`.** The public site now publishes the v2
docs with the newcomer and reference pages rewritten for 0.7 (the Hub, sign-in, hosting, the private store, federation
on atproto, kms 0.2.0). `org-os-kms publish` now runs the canon gate in an instance with no plane role whose knowledge
base holds canon control data, so a `draft` there is no longer published. No store or data migration; nothing to do on
upgrade unless such an instance relied on drafts going out (*Upgrading*).

### Added

- **The site's docs, v2.** The public site publishes the 46 pages listed in
  `site/src/data/docs-manifest.mjs`, each stamped with the commit it was last read against. The newcomer
  and reference pages were re-read against 0.7.5 for this release; the stamps say which commit each page stands on. `npm run drift` in `site/` names a page whose covered
  code has changed since. Tables scroll in a named region a keyboard reaches, no page scrolls sideways at
  375 or 320px (`npm run widths`), and a doc search index covers every page.

### Changed

- **The site follows the registry's `listed` flag everywhere.** An entry marked `listed: false` is off
  the federation list, out of both counts and, now, off the map, with whatever was reached only through
  it. The map carries no `url` or `repo` that is not `https`, that is a folder inside another repository,
  that is a private repository, or that is under a GitHub name nobody has registered
  (`site/scripts/map-addresses.mjs`); the build fails if one gets through.
- **The site no longer publishes the repository's `.well-known/` files.** They are the hand-written
  0.5 files, and the generator builds every address from the `daoURI`'s origin, so it cannot write them
  for a site served under a sub-path. The repository's `dao.json` now points at the raw files in
  `regen-coordination/org-os-template`, not at `organizational-os.github.io`: nobody has registered
  that GitHub name.
- **`generate-schemas.yml` installs `packages/admin`'s dependencies in the framework**, so the generator
  can run its schema check once `identity.daoURI` is set. An instance, which has no `packages/admin`,
  skips the step.

### Fixed

- **`org-os-kms publish` runs the canon gate in a canon-shaped instance with no plane role.**
  Such an instance published on the framework floor alone, so an entry with `maturity: draft` and
  `public_use: ok-with-caveat` was minted an id and written to `public/`. When its knowledge base
  holds canon control data (a source card that claims or holds corpus paths, or a public-use
  boundary), the selection (`selectPublic`, which `publish`, the steward's preview and kms-admin
  share) now also runs the gate `export` runs (`packages/org-os-kms/src/planes/canon-gate.mjs`),
  in every mode and before any id is minted, and `publish` reports `canonGate`. Malformed control
  data refuses the publish (`refused: 'canon-control-data'`). Canons and public planes are
  unchanged.
- **`npm run drift` in `site/` prints its whole report into a pipe.** `process.exit` cut it at the first
  64 KB.

### Upgrading

- Nothing to migrate. An instance with no `planes` key in `kms.yaml` whose knowledge base holds a source card that
  claims or holds corpus paths, or a `public-use-boundary` record, now has the canon gate applied by `publish`: entries
  it published before as `maturity: draft` stay back, and malformed cards or boundaries refuse the publish
  (`refused: 'canon-control-data'`). Run `org-os-kms publish --dry` to see what changes before applying.

## [0.7.5] — 2026-11-25

**0.7.5 releases sign-in with a Bluesky or Certified account, and a network's node accounts (#36).** #36 merged just
before 0.7.4's release commit, so 0.7.4's code already carries it; 0.7.5 is the release that names it and says how to
take it. It is off on a hosted Hub until the operator sets its key, and nothing is ever written to anyone's account:
the sign-in asks for identity only (scope `atproto`). **The private store moves to schema 4 on first start: back it up
first** (*Upgrading*).

### Added

- **Sign in with a Bluesky or Certified account** (`packages/admin`, #36), beside the emailed link. An AT Proto OAuth
  round-trip, identity only, that ends in the same shared session cookie the emailed link issues:
  - Hosted, a confidential client (`HOUSE_ATPROTO_PRIVATE_JWK`, ES256), whose id is
    `https://<hub>/oauth/client-metadata.json`; locally on http, a loopback client.
  - Every round-trip starts by a click on a Hub page (`POST /api/session/atproto/start`, JSON); there is no GET start.
    A typed handle must be a handle, never an address. The callback checks the flow cookie of the browser that started
    it, and no token is kept after it.
  - A linked account signs in as its person, with their Roles. Anyone else comes in as a **Guest**: `sub guest:<did>`,
    `roles: []`, kept in its own table, which a Roles load never touches.
  - A member links or unlinks their own account (`/account-links`).
  - Certified's sign-in page can carry the Hub's colour (`HOUSE_ATPROTO_BRAND_COLOR`, `#rrggbb`) and its "Sign in with
    Atmosphere" button. A handle typed there comes to `/sign-in/atmosphere`, which only fills it in on the page the
    round-trip started from.
- **A network's node accounts** (#36). For an instance whose `data/kb/organization.yaml` lists local nodes:
  - A node adds or withdraws its own account by signing in with it (`/network-account`). It goes live at once when the
    account matches the node (a handle on the node's own website host, or one its record names), and otherwise waits
    for a steward. A person's linked account is never a node's, and an account holds one node.
  - Stewards see New (Remove) and Waiting (Confirm, Decline) at `/network-accounts`, and read the export
    (`GET /api/network/export`). A steward's removal sticks: the same account is then held for a steward.
  - Two public reads: `GET /api/network` (node, DID, handle, apps; nodes removed in the last 14 days) and
    `GET /api/network/nodes/:id`.
- **`/sign-out`**: ends the session and goes back to another of the org's sites (judged by the I6 return rule).

### Changed

- `issueSession` is the one issuing path, for the emailed link too.
- `DELETE /api/session?return=` answers the judged next address; without `return` it still answers 204.
- `readPersonCookie` reads a Guest's cookie, which is not re-issued (it ends after 24 hours).
- New writes are named in `INSTANCE_WRITES` / `HOSTED_WRITES`; the stewards' board writes only to the private store, so
  it works while `HOUSE_INSTANCE_WRITES=off`.
- New dependency: `@atproto/oauth-client-node` 0.5.21 (exact).

### Upgrading

- **Back up the private store before 0.7.5 first starts.** It moves to schema 4 (five new tables; every existing row is
  kept). An older org-os refuses a schema-4 store, so rolling back past 0.7.5 means restoring that backup.
- To offer the sign-in on a hosted Hub, set `HOUSE_ATPROTO_PRIVATE_JWK` (`deploy/hub/env.example`). Without it the
  routes answer 404 "not offered". The client's id is tied to the Hub's address: set it on the address the Hub keeps.
- The org's other sites read a Guest's cookie as no member. The v2.5 Hub, the Ideas site and the Commons have tests
  for this in their own repositories.

### Known, not changed

- A sign-in that fails partway can leave its OAuth session rows in the store; two tabs signing in at once spoil each
  other's round-trip; a local Hub opened at `localhost` (not `127.0.0.1`) may fail the loopback sign-in.
- A double click can file the same pending claim twice; Confirm says nothing when a node's record lists no channel.
- The granted scope is not checked against `atproto` after the callback.

## [0.7.4] — 2026-11-25

**0.7.4 releases what merged after 0.7.3: federation on atproto (N0–N2), `org-os-kms` 0.2.0 with the needs/offers pack,
and a `vault:snapshot` that captures untracked files.** All of it is additive. Nothing is published by updating: every
atproto write needs an account in `kms.yaml`, an app password in the server env and an operator's confirmation, and the
network's record types use a placeholder authority, refused on a live account, until the network has its own domain.

### Added

- **Federation on atproto, N0–N2** (`packages/admin`, #32). An instance knows its peers, opens other instances from a
  launcher, and joins a network:
  - A node asks to join (`POST /api/federation/ask`, by file or GitHub issue). The hub refuses, accepts under a
    decision, or proposes, under its join policy; an accepted join carries the `Org-Rule: federation/join` trailer.
  - Each side publishes its half of a public membership link to its own PDS (`memberOf`, `hasMember`). The link's state
    (mutual, claimed, requested, left, not-an-instance, unknown) is read from both repositories, never stored.
  - `federation-requests` and `invites` are never widened past members. An invite token is stored as its sha256 only.
    A DID enters `federation.yaml` only through the migration list, bound on both sides.
  - Every atproto write is planned on the trunk and confirmed; a delete goes through only if the record is unchanged,
    and withdrawing two or more records at once is refused.
  - The 9 federation write routes are instance writes and are **off on a hosted Hub** (403) until hosted federation has
    its own review. The receive, decide and invites routes honour the 0.7.3 `files:` section.
  - New pages: Federation and the launcher. New docs: `docs/OPENING.md`, `docs/FEDERATION.md` § Joining a network.
- **`org-os-kms` 0.2.0** (#31). Every new key is off or absent by default:
  - A read-only Hypercerts connector, scoped by `follows_of` and `dids` (it refuses to run unscoped), with an optional
    Constellation backlink lookup (`constellation.enabled`).
  - The `org-os-needs-offers` pack: `need` and `offer` types with a required `visibility` level, published in a shared
    lexicon. The shipped lexicons (`example.commons.need|offer`) are placeholders, and `apply` refuses them.
  - A matching-only floor in core: a need or offer that is not `visibility: public` never reaches a public output, and
    references to non-public objects are scrubbed by value from every one.
  - Claims for a node: published in the instance's own account only with a by-name consent date from the node, cut to
    an allow-list, and superseded by the node's own record.
  - Certified update drafts, written as a file for the node's own session to post. The bundle never holds a node's
    credentials.

### Changed

- **`networkFetch` is https-only and public-only** (#32): an `ORG_OS_RPC` that resolves to a private address is refused.
- **`validate-identity` warns** about a `networks` block nested under `federation:` and asks to move it to the top level.
  It fails only under `--strict`.
- **The framework's OpenCode agents are generic** (#34). The four `.opencode/agents/*` files described one operator's
  notes vault and are removed; `.agents/agents/operator.md` and `upstream.md` no longer name a path on disk;
  `clone-excludes` keeps `.opencode/agents` out of new instances.
- **The dashboard's lifecycles are declared once** (`scripts/lib/lifecycles.mjs`, #34). A closed opportunity is no longer
  listed as upcoming, the projects bar counts the stages the data uses, values outside a lifecycle are shown instead of
  dropped, and QUEUE items with a `Plan:` link are parsed.

### Fixed

- **`vault:snapshot` captures untracked files** (#33). It called `git stash create -u`, but `stash create` takes no
  options, so a snapshot held the tracked tree only: the untracked notes it exists to protect were never in it. It now
  builds the snapshot from a temporary index of tracked and untracked files (gitignored files stay out), without touching
  the working tree, the index or the stash list. `doctor sync` takes its pre-sync snapshot the same way, and
  `docs/VAULT-SAFETY.md` says what a snapshot captures. **Snapshots made before 0.7.4 hold the tracked tree only.**
- **The kms copy of the house tokens** lacked `--w-sites`; it is regenerated, and `house-tokens.test.mjs` passes (#34).

### Upgrading

- An instance that keeps its own copy of `scripts/vault-snapshot.mjs` should take this release's copy; until then its
  snapshots miss untracked files.
- Members joined before N2 need a `link: hasMember` before their hub can publish them.

### Known, not changed

- `docs/OPENING.md` describes `npm run open`, which a bare clone without `packages/admin` does not have.
- Whether an `open` acceptance should wait for both sides' files before publishing `hasMember`, and a "withdraw all"
  override for the mass-delete guard, are open for the operator.
- The needs/offers lexicons and the network's record authority are placeholders. What the kms scrub does not catch is
  listed in `packages/org-os-kms/docs/CONNECTORS.md`.

## [0.7.3] — 2026-11-23

**0.7.3 closes what 0.7.2's `files:` section still let a member be told of a file kept from them.** It comes from a
fresh review of 0.7.2's last round and from the minors both earlier reviews deferred. An instance without a `files:`
section is unchanged.

### Fixed

- **Writes into a kept file** (`packages/admin`). 0.7.2 said a write to a record of a kept file is refused before the
  record is read; these paths did not refuse:
  - `POST /api/meetings` and *Turn into a task* (`POST /api/comments/:id/task`, for a task kept in git) made the record,
    and the id they chose (`…-2`) said whether one existed. Both now answer 422 before any id is read, alike for an id
    that exists and one that does not.
  - Library Add and Remove staged ops on records of kept files, and Remove's answer held the whole record. Both now
    answer 422 before staging, and Remove refuses before its receipt is worked out.
- **Every answer that carries the tray withholds alike** (`readableTray`): Library Add and Remove, the deploy read-back
  and a proposal's Load now answer as `GET /api/changes` does, so a record op on a kept file staged before it was kept
  shows no `before` or `current`. The tray's `state` no longer says `stale` for a staleness it withholds.
- **The person at the machine** is never gated by `files` over the WebSocket again: the connection's viewer kept no mark
  of it, so with a section they stopped hearing presence and comment events on kept records, and saw ids for names.
- **WebSocket events** (`registry-changed`, `resources-changed`): a registry, or a card read from a file, kept from a
  member reaches them only as the public would hear it.
- **`GET /api/registries/:name?from`** gives no from marks, and **`…/:id/changed`** answers 404, to a member the
  registry's file is kept from.
- **The library**: `GET /api/library` (`added`) and an entry's preview (`receipts`) list no receipt to a member
  `data/library.yaml` is kept from; a removal's preview names no record of a kept file, nor its state or referrers.
- **The canon at run time**: a key written inside `data/kb/` (which the check refuses) used to be passed over, so that
  file read at the canon's looser level. Now such a key narrows the whole canon, and two levels that are not ordered
  close it.
- **The policy check** reads a custom collection's own file (`data/collections/<id>.yaml`) when it refuses a key that
  would open a collection with field levels whole.

### Tests

- `tests/workspace/file-reads.073*.test.ts`: each fix's test, seen failing first. The review's probes are kept as tests.
  The sweep now also looks for other members' names after a second person's commit.

### Known, not changed

- The house's own configuration routes (`/api/boards`, `/api/collections`, `/api/visibility`, `/api/standards`) stay
  the declared exceptions.
- A kept file's records come as the public gets them, store-kept fields included.
- A link label typed into a page is its author's text; the @ picker offers no kept record there.
- *Take theirs* on a withheld record op still reads the kept record (which op is dropped says how it changed), and a
  typed mention of a Node Lead on a Steward-only record says they were told when they are not. Both need writes on.
- The map's `changed.by` names everyone as the generic member does, the person at the machine included (R11).

## [0.7.2] — 2026-11-23

**0.7.2 lets an instance say which Roles read which data files, and keeps a kept file's records from those it is kept
from wherever the house reads them.** An instance without a `files:` section sees 0.7.1 unchanged.

### Added

- **Raw file reads by Role** (`packages/admin`, 0.7.2). An optional `files:` section in `data/visibility.yaml` says who
  reads which `data/**` file whole:
  ```yaml
  visibility:
    files:
      default: role:steward             # every data/** path not listed
      paths:
        data/projects.yaml: members     # any signed-in member
        data/kb/**: members             # a folder
  ```
  - A level is `members`, `role:<Role>` (the Roles table's: `steward`, `node-lead`, `network-member`) or `hat:<hat ref>`.
    A path takes its own level, else the longest `data/<folder>/**` holding it, else `default`, so a file added later is
    held at the default until listed. A token that can't be read admits nobody. The canon is read as one: `data/kb/**`
    may be listed, a path inside it may not.
  - It governs `GET /api/files` and everything that takes its reader: `/api/editors`' `readable`, staging and Keep mine
    on that path, the ledger read whole (C2), proposal diffs and file ops.
  - `GET /api/registries`, `/api/registries/:name` (and `…/:id/changed`) and the map (`/api/resources`) give a member
    the records of a file kept from them as the public is given them: what the collection makes public stays theirs.
  - The same holds for every other read of such a record: comments and mentions on it (the record is not there for that
    member: no thread, no anchor matched against its text, no notification naming it), `GET /api/governance`, member
    names wherever they are said (`displayNames`), the knowledge routes (the canon is `data/kb/**`), proposals (the
    ledger, and record ops on a kept registry withheld as file ops are), and the staging tray (a record op on a kept
    registry is refused as a path no rule governs, and one staged before the file was kept is shown withheld).
  - The @ picker (`/api/mentionables`) offers a record only from a file every reader of the target may read. Presence
    (its route and its WebSocket event) and the map's `changed.by` say a member's name only to a viewer who may read the
    members file; a presence event on a record of a kept file is not sent to one it is kept from. System actions
    (`/api/systems/:id/actions`), the library's receipts and the import list on `/api/sources` follow their files.
  - A write to a record of a kept file (`/api/registries/…`, `/api/workspace/records`, Keep mine in the tray) is refused
    before the record is read, so its answer says nothing of whether the id is there.
  - `role:` is judged against the viewer's Roles-table Roles (`hubRoles`, set for a person signed in by emailed link),
    never a governance role of the same name. A wallet session holds none, so it reads only `members` and `hat:` paths.
  - Left to the house, as its own configuration, whatever `files` says of their files: `/api/boards`,
    `/api/collections`, `/api/visibility` and `/api/standards`.
  - The person at the machine reads as before. A `?as` preview is judged as the viewer it previews.
  - The policy check (`doctor`, a staged edit of `data/visibility.yaml`) refuses `public`, a path outside `data/`, a
    `role:` that is no Roles-table Role, an empty section, and any key (a path, a folder, the default) that opens a
    file with field levels below `role:steward` (a file is read whole). Removing the section or widening a level is a
    publication (§11.2). A section that can't be read, empty, or a file that can't be read for any reason but its
    absence closes every data file. `schemas/visibility.schema.json` takes `files`.
  - **Opt-in:** an instance without a `files:` section sees 0.7.1 unchanged. 0.7.1 refuses the section
    (`additionalProperties`), so an instance adds it only once its house runs 0.7.2.

## [0.7.1] — 2026-11-20

**0.7.1 lets an instance make the house its own without forking it, and keeps the agent layer to those who decide.**
An instance without the new files sees 0.7.0 unchanged.

### Added

- **Instance seams for the house** (`packages/admin`, #27). Each reads a file the instance keeps:
  - `house/skin.css` is layered over the house's styles, and `house/themes/*` are offered in Appearance (a chosen
    theme survives a reload; "Toggle dark" returns to the instance's own look).
  - A shared sites bar: the lockup, a site switcher and the theme control, as the instance's sibling sites draw it.
  - The instance's images under `house/`, served at `/instance-assets/:name`; its mark reaches the org seal. The bar,
    themes and sidebar are answered at `/api/instance/*`.
  - `house/nav.yaml` groups the sidebar, each item drawn for the Roles it names (`audience`); sections it doesn't name
    stay under a collapsed More, and `hidden` keeps a slot without drawing it. The phone's More sheet draws the same
    groups.
  - Meetings, events, tasks and knowledge-store organizations read as records; a meeting's `short_title` names it in
    lists.
  - `open_decisions` in `data/governance.yaml`, beside `decisions`: the Decisions page lists them as "Open decisions",
    ahead of the decided ones, and "Decided" counts only the decided.

### Security

- **The agent layer is no longer served to every signed-in member** (`packages/admin`). On a 0.7.0 Hub that signs
  people in, anyone with a Role could open `memory/**`, `MEMORY.md`, `HEARTBEAT.md`, `docs/plans/**` and
  `docs/agent-plans/**` in the source editor (`GET /api/files`), and read them in a proposal's text and diff. Now only
  those who decide under the workspace rule that governs those files read them: the members of the rule's deciding
  role, or, where the org has written no workspace rule, of its own `maintainer` role. Anyone else is answered exactly
  as for a file that is not there and is shown no link to it. They cannot stage, revise, replay, load or apply an edit
  to it. They see proposals, the ledger and its revisions without that file's text, path or diff (the rest of each
  proposal is unchanged), and crew's seats recorded in `memory/crew/` are not on their map. The person at the machine
  reads these files as before. An org that writes no workspace rule and defines no `maintainer` role should name one
  in `data/governance.yaml`: until it does, nobody signed in to its hosted Hub reads these files.

## [0.7.0] — 2026-11-11

**0.7 adds the workspace to the house:** pages, collections, tasks, imports and conversation, beside
the records, rules and proposals 0.6 brought. It also adds the knowledge commons' pages (kms-admin,
local only) and compose and deploy (DAO-OS L7): a DAO composed as records, its deployment prepared
step by step, and what the chain holds read back. The house never signs. 0.7 has breaking changes:
read **Upgrading from 0.6** below before you sync.

### Added

- **The workspace** (`packages/admin`, DAO-OS L6). The org's working surface, in the house's
  words. What members (or the public) read is in git; what is stricter is kept in the private store,
  down to one field, one title or one comment. Every read goes through the visibility gate.
  - **Pages** (`pages/<id>.md`, `/p/<id>`): a tree of pages written in the Hub's Markdown dialect
    through editing sessions (one commit per session), three-way merges and Compare, Suggest (a
    page edit as a proposal), attachments, and Record a meeting (a meeting and its notes page).
  - **Collections**: `tasks` and `meetings`, the org's own collections (`data/collections.yaml`,
    `data/collections/<id>.yaml`) and private ones, each with Table, Board, Calendar, List and Map
    views, saved views, and inline edits batched into one commit.
  - **Conversation**: comments on a page or a record, replies, mentions and notifications, in the
    private store, never in git; presence (in memory only); Turn into a task.
  - **Imports**: `npm run import -- notion|fileverse <folder> [--map <file>] [--apply]`, a Notion
    export or a Fileverse pull, mapped first, applied as one commit with a receipt in
    `data/imports.yaml` that names no private item.
  - **Sources and the source editor**: `/sources` says where everything the Hub shows comes from;
    `/files/<path>` edits a governed file whole, staged into a change.
  - **Council memory** (`npm run memory`) and **moving a private thing into the repository** by a
    publication decision.
- **The knowledge commons' pages (kms-admin)**: `/c/knowledge`, its setup and its entry pages,
  read through `packages/org-os-kms`. An edit to the canon (`data/kb/`) is prepared, then applied in
  one commit under the org's rules. Local only in 0.7 (see *Upgrading*).
- **Compose and deploy** (DAO-OS L7). Compose a DAO (a template wizard) and `/compose`, a canvas over
  the org's composed Systems: a Safe, a Hats tree and its hats, a signer gate, a Snapshot space and
  an ERC-4824 registration, kept in `data/systems.yaml` with `deployment.status: composed` and
  decided like any change. `/deploy` prepares the deployment step by step, and **Read back** stages
  what the chain holds as live Systems, in one ordinary change. The Hub reads, plans and stages; a
  signer signs in the Safe app or their own wallet. Built for Sepolia, tested against a fake node; the
  proof on a fork of a test DAO follows in its own release.
- **Library receipts' `modified`** (L7-D11): an add that changes a record the org already had lists
  it, and a removal gives back the version it replaced.
- **The `workspace` change class** in `schemas/change-classes.json`: pages, tasks, meetings,
  collections, imports, `data/kb/`, `memory/`, `MEMORY.md`, `HEARTBEAT.md`, `docs/plans/` and
  `docs/agent-plans/`. With no rule naming it, a workspace write is direct (`workspace/direct`).
- **`e2e:hosted`**: a walk of a hosted, read-only Hub signed in by emailed links, as a staging Hub
  runs, beside the workspace and compose walks in `e2e`.
- **Example DAO is the one sample org.** The fixtures 0.7 adds (the workspace, compose, library,
  knowledge, kms and federation map) use it and synthetic addresses, as 0.6's do.

### Fixed

The first two are in 0.6.1 and 0.6.2's hosting; 0.7 fixes them, and no 0.6 patch carries the fix.

- **A hosted Hub's `/sign-in` offers the emailed link.** 0.6.1 built the email form but never put it
  on the page, so a member of a hosted Hub could not ask for a link from the Hub. It now offers
  what `GET /api/session`'s `methods` says. A local Hub's `/sign-in` stays the wallet's.
- **Signing in by emailed link no longer breaks the Hub's frame.** The sidebar and the read-only band
  read the wallet's hats from a session that has none, and threw for anyone signed in by email.
  Such a person now reads as their member name, with their Roles. A person with no Role is told
  "You are signed in, but you have no Role here yet."
- **A read-only Hub says Read only.** While instance writes are off, a workspace page draws no save
  state and its meta line says Read only (it read "Saved · direct"), and presence never says editing.

### Changed

- **The portal link appears only with a portal origin**: in the sidebar, the org switcher, the
  setup checklist, `g d` and ⌘K, when `GET /api/session` answers an https `portal`, and it points
  there. A local Hub, or a hosted one with no portal origin, shows none. The house's own `/portal`
  page (the sample page) and its words say portal; `/door` still lands on it, and a hosted Hub still
  sends both to the portal origin.
- **A read-only Hub still writes conversation and per-member state**: see *Upgrading*.
- **The private store is at schema 3**: see *Upgrading*.
- **Member mentions are labelled by who may read them**: see *Upgrading*.
- **An emailed-link person's name** is said to others only as the members file's visibility allows,
  else as their member id; their own session still tells them their name.

### Removed

- **`ORG_OS_DOOR_ORIGIN`, `ORG_OS_DOOR_DIR` and `ORG_OS_DOOR_EVERY`**, deprecated in 0.6.2, are no
  longer read. A Hub with one still set stops at start with a sentence naming its new name
  (`ORG_OS_PORTAL_ORIGIN`, `ORG_OS_PORTAL_DIR`, `ORG_OS_PORTAL_EVERY`), and `hub check` says the
  same.
- **`door` in `GET /api/session`**, deprecated in 0.6.2: read `portal`.

### Upgrading from 0.6

Sync, then `npm ci --prefix packages/admin` (the editor brings new dependencies), then
`npm run validate:data`. **Back up the private store before 0.7 first starts** (below).

**Breaking changes**

- **A policy that keeps a required System field above members now fails validation** (PF-R279). A
  deployed System must keep `id`, `kind`, `name`, `chain`, `address` and `url` in the repository,
  so `data/visibility.yaml` may not set `systems.fields.<field>` to a hat or a role level:
  `validate:data` reports "A deployed System must keep its <field> in the repository, so <field>
  cannot be kept above members: give it members or public.", and every writer of the policy refuses
  it (422 `REQUIRED_IN_GIT` for a narrowing). It holds with no System deployed yet. Widen the field
  to members or public. A System kept whole as a private record is not affected.
- **The door's old setting names are not read** (above). Rename them before you start a 0.7 Hub.
- **Meetings, memory and plans move to the `workspace` class.** `data/meetings.yaml`, `memory/**`,
  `MEMORY.md`, `HEARTBEAT.md`, `docs/plans/**` and `docs/agent-plans/**` were `records` (or no
  class); they are `workspace` now, and an org's `all` rule does not reach the workspace. With no
  rule naming `workspace` (or one of its targets, such as `workspace:meetings`), their writes are
  direct. Name one in `data/governance.yaml` to keep them decided.

**The private store (schema 3).** The store moves to schema 3 the first time a 0.7 Hub opens it. It
gains the workspace's tables; `comments`, `mentions` and `notifications` gain `written_level`, and
`mentions` gain `created`. **There is no rollback to 0.6 without a backup**: run
`npm run house:backup` (or copy the store's folder, `.org-os/private/` by default, with the Hub
stopped) before the first start.

**The conversation keeps the level it was written at.** Every comment, reply, mention and notification
records its target's level when written, and is read only by someone admitted to that level and to
the target's level now. When a page is widened, in the Hub or outside it, its earlier talk stays
with those who could read it before. At the first 0.7 start, existing rows are given their target's
level at that moment, so **start 0.7 before you widen anything**: a page widened or made again
outside the Hub before then keeps its old talk at the wider level.

**What a read-only Hub still writes** (`HOUSE_INSTANCE_WRITES=off`). Comments (post, resolve,
reopen, delete), notifications read, read marks, a collection's view state and presence: the private
store's conversation and per-member state. Everything else the workspace writes is refused 403
`INSTANCE_READ_ONLY`, even where its target is the private store: pages and editing sessions,
collections and saved views, records, meetings, Council memory, the knowledge commons, the deploy
read-back, and a comment's **Turn into a task**, which writes a task.

**Member mentions.** A member mention (`[@Name](hub:member/<id>)`) is written with the name the
text's loosest reader may read (the public's in a public text, any member's otherwise), else the
member's id, and read back as the name the viewer may read. A write that mentions a member is refused
503 `MEMBERS_UNREADABLE` while `data/members.yaml` is there but cannot be read. A reference-style
member link (or one over lines, or with a title) is refused 422: write it inline. Text written
outside the Hub with such a link is shown as a sentence saying so, not as its body.

**The portal link** shows only when the Hub is hosted with an https `ORG_OS_PORTAL_ORIGIN`.

**kms-admin is local only.** The hosted image does not carry `packages/org-os-kms`, so the knowledge
commons' pages work on a member's own Hub, not on a hosted one.

**Wizard drafts from a local 0.6 Hub are left behind.** 0.7 keeps each member's draft under their own
name, so a draft a local 0.6 Hub saved (`<wizard id>-1.json` in its state folder) is not offered
again. Finish or restart that wizard; the old file can be deleted. A hosted 0.6.1/0.6.2 draft is
still offered to its member.

### Notes

- **Design and history.** What 0.7 adds is described in `packages/admin/README.md` and
  `docs/DATA-MODEL.md`. How 0.7 was built, and where its process records went:
  `docs/superpowers/history/org-os-0.7.md`.
- **New and changed schemas** (`packages/admin/schemas/`): `collections`, `tasks` and `imports` are
  new. `systems` gains the composed and deployed keys (`deployment`, `ens`, `hats`, `signer_gate`,
  `relates`, `role`, `position`, `order`; `docs/DATA-MODEL.md`); `meetings` gains `notes` (its notes
  page); `proposals` gains `suggested` and a `file` op; `library` gains `modified`, and `created` may
  be empty when `modified` is not.
- **Clones** gain `scripts/memory.mjs`, `scripts/lib/compose.mjs` and `scripts/lib/deployments.mjs`.
- **CI.** The admin suite is about 8,030 tests. The `Validate` job's limit stays 30 minutes.

## [0.6.2] — 2026-11-08

**0.6.2 names the hosted Hub's public site the portal.** The site 0.6.1 called the door is the
portal. The three settings that point a Hub at it now carry that name, and the old names keep
working until 0.7. Nothing here migrates an instance's files.

### Changed

- **The portal's settings** (`packages/admin`, hosted): `ORG_OS_PORTAL_ORIGIN`,
  `ORG_OS_PORTAL_DIR` (default `/srv/portal`) and `ORG_OS_PORTAL_EVERY` replace
  `ORG_OS_DOOR_ORIGIN`, `ORG_OS_DOOR_DIR` (default `/srv/door`) and `ORG_OS_DOOR_EVERY`.
  `deploy/hub/env.example` and `RAILWAY.md` use the new names.
- **`GET /api/session`** answers `portal`, the portal's origin or null, when hosted.
- **The members' side sends `/portal` to the portal**, as it did `/door`, when a portal origin
  is set. Both now keep the path under them and the query: `/door/decisions?q=2` lands on
  `<portal>/decisions?q=2`.
- The L9 build modules moved from `server/door/` to `server/portal/`
  (`collectPortalInput`, `scanPortal`, `PortalInput`).

### Deprecated

- **`ORG_OS_DOOR_ORIGIN`, `ORG_OS_DOOR_DIR` and `ORG_OS_DOOR_EVERY`** are still read, until
  0.7. Each one prints a warning at start that names its replacement, and `hub check` prints it
  too. If an old name and its new name are both set to different values, the Hub refuses to
  start. `ORG_OS_DOOR_DIR`'s folder is used as it is set: nothing is moved.
- **`door` in `GET /api/session`** repeats `portal` until 0.7.

### Notes

- The house's own pages still say "door": the `/door` page, the frame's "Public door" and the
  sign-in card's "Read the public door". They move to "portal" with the house's rename of the
  page itself.

## [0.6.1] — 2026-11-08

**0.6.1 lets an org run the house as its members' Hub.** It runs hosted from one container
image (DAO-OS L9), people sign in with an emailed link instead of a wallet, and every write to the
instance is off by default when hosted: the Hub reads its instance and follows the remote,
fast-forward only. On a member's own machine the house still writes, as in 0.6.0. Nothing here
migrates an instance's files.

### Added

- **Sign-in by emailed link** (`packages/admin`). `POST /api/session/email` answers 202 with the
  same sentence for every address. The lookup, the link and the mail happen after the answer, so
  the response time does not show whether an address is known. `POST /api/session/link` spends
  a single-use, 15-minute link and sets a signed session cookie (EdDSA JWS, 24 h, re-issued with
  less than 12 h left). Its name and domain come from `SESSION_COOKIE_NAME` and
  `SESSION_COOKIE_DOMAIN`. The org's other sites verify the cookie with the public key alone.
  No wallet and no Hats tree is needed; with a tree, the wallet stays on offer.
- **The house keeps keyed hashes of addresses** (`HOUSE_EMAIL_PEPPER`), never the addresses.
  Rate limits: 3 asks per address and 10 per client in 15 minutes, each answered alike.
- **Roles** (`steward`, `node-lead`, `network-member`) are loaded with
  `npm run -s house:roles -- load` from a JSON document on stdin. The house reads them on every
  request, so a removed Role takes effect at once. A person with no Role reads what the public reads.
- **`npm run -s house:session-key -- new | public`** makes the private Ed25519 JWK
  (`HOUSE_SESSION_PRIVATE_JWK`) and derives its public half (`HOUSE_SESSION_PUBLIC_JWK`).
- **The app:** the email form on the sign-in card, `/sign-in/link` (one click posts the token,
  and the token is removed from the address bar), and the identity menu naming a person's Roles.
- **`HOUSE_INSTANCE_WRITES`**: `off` by default when hosted, `on` locally. While off, every
  route that writes to the instance answers 403 `INSTANCE_READ_ONLY`. Proposal pages build no
  branch, the start-up reconcile is skipped, no push runs whatever `ORG_OS_PUSH` says, and the app
  hides its write controls. A hosted house refuses `on` while `BEFORE_PILOT_OPEN` lists known
  write defects.
- **A read-only house follows its remote** (`ORG_OS_REFRESH_EVERY`, `15m` by default, `off`
  for never). While writes are off, the hosted house fetches `origin` at start and on that
  interval, and moves its trunk forward, fast-forward only. A diverged history, a copy off its
  trunk or a refused fast-forward stops it until the next start. The Sources page shows the
  refresh as a row for members, and Home's "Needs you" shows a stop or a warning.
- **The house runs hosted** (`packages/admin`, DAO-OS L9). One container image
  (`deploy/hub/Dockerfile`, base pinned by digest) starts `hub serve`, which runs every start check
  first (`hub check`; Node 22.13 or later). Hosted, the house answers one configured host and
  origin, sets the session cookie as `__Host-`, adds security headers and an access log, limits
  request rates, and answers `GET /api/health` with `{ ok }` only. `deploy/hub/RAILWAY.md` and
  `env.example` say how to run it on a container service with one volume.
- **One writer, and its push** (L9). Every hosted commit is the Hub's own. The trunk is pushed
  fast-forward only and the push stops on a diverged remote; `ORG_OS_PUSH=off` runs no push, and
  any value but `on` or `off` stops the start. Every write route is classified when hosted.
- **Backups sealed to a maintainer's public key** (`npm run house:backup`, `house:backup:keypair`,
  `house:restore`), taken without the write lock.

### Fixed

- **`selftest` names the test that failed.** A failed check now reports the failing tests' names
  (vitest's `FAIL` headers, node --test's spec and TAP reports; `scripts/lib/test-failures.mjs`),
  where it printed the output's last three lines. On `main` at `3e12c24f` that tail was only a
  code frame line, `213|     })`.
- **Three admin tests no longer race the polite region.** `EntryPreview` and `Removal` say a
  refusal through `announce()`, which runs in an effect after the note is drawn. The tests checked
  what was said as soon as the note was found, which a loaded machine can do before the effect
  runs. They now wait for it.
- **`doctor sync` honours `.sync-freeze`.** An instance pinned with `.sync-freeze` was refused by
  `sync-upstream.mjs` but not by `doctor sync`, which went on to overlay the framework. It now
  refuses before the snapshot: nothing is written, the file's text is printed, and it exits 1.
  `--dry-run` says the instance is frozen.

### Changed

- **CI `Validate` may run 30 minutes, up from 20.** A green run takes 18–19 minutes since 0.6.
- `GET /api/session` now reports `methods`, the signed-in `person` and `instanceWrites`. With no
  Hats tree, sign-in is still offered by email.
- `deploy/hub/env.example` names the sign-in variables and `HOUSE_INSTANCE_WRITES=off`.

### Notes

- **The house record is back:** `docs/design/house-record/` holds the 17 shots
  `tests/e2e/shoot.mts` names, re-shot from the example fixtures (light, WebP, at most 150 KiB
  each). The record-weight check in `packages/admin/tests/e2e/shoot.test.ts` is required again,
  and it also fails when a named shot is missing.

## [0.6.0] — 2026-11-05

**0.6 adds the house:** `packages/admin`, one Hub per org over its records, rules, proposals and
systems, and the framework pieces it stands on. Everything under *Added*, *Fixed* and *Changed*
below also ships here: it landed on `main` after the `v0.5.0` tag and was staged for a 0.5.1
that this release replaces.

**If your instance syncs from `main` HEAD, pin it to `v0.5.0` before this merges**, then upgrade
on purpose: sync, then `node scripts/migrate.mjs --dry --target 0.6` to see what the 0.6
migrations will do, then the same without `--dry`. The migrations ask before writing anything
they inferred.

### 0.6

- **The house (`packages/admin`).** Records, rules, proposals, systems and boards, drawn with one
  element set (spec: `docs/superpowers/specs/2026-10-29-dao-os-l4-element-set-design.md`;
  gallery: `docs/design/dao-os-element-gallery.html`). A sign-in page and a read-only mode;
  records shown by their declared visibility. The change engine stages, applies and replays
  edits. The proposals ledger records approve, object and vote events, and the rule evaluator
  decides them. Readers for Safe, Hats, Gardens and Snapshot, tested on recorded fixtures. It
  replaces the old admin app's components.
- **Canonical records.** Roles and handles in `data/members.yaml`, systems from
  `infrastructure`, `validate:data` with its schemas, and `claim-handle`.
- **Governance rules.** `roles` and `rules` in `data/governance.yaml`, a solo default, and
  `validate:governance`.
- **Migrations 0.5 → 0.6.** Canonical records and governance rules, run by `migrate` and the
  instance doctor, which also declares each field's visibility.
- **Standards.** The `.well-known/` generator (EIP-4824 `dao.json` and its members, projects and
  proposals) honours field visibility and is vendored into clones.
- **Clones** copy committed files only, checked against `tests/clone-manifest.txt`.
- **Example fixtures.** The house's fixtures are an example org ("Example DAO") with synthetic
  addresses and transaction hashes.
- **Design and history.** The architecture is
  `docs/superpowers/specs/2026-10-16-org-os-0.6-platform-architecture-design.md`. How 0.6 was
  built: `docs/superpowers/history/org-os-0.6.md`.

**Known issues**, carried from the 0.5.1 staging notes and not re-checked on 0.6: the two 🔴
**kms data-loss** fixes are still open. The two 0.5 admin defects (YAML reflow rewriting a
whole registry on a one-field edit, and the per-registry write lock racing `.git/index.lock`) have
not been re-checked against the house.

### Added

- **`docs/ADOPT-WITH-AN-AGENT.md`** — the copy-paste recipe for driving setup from Claude Code,
  Cursor or a ChatGPT connector. Non-interactive end to end, so an agent can complete it without
  a TTY. Verified by executing it against a fresh clone of `main`.
- **`data/instances.yaml` now declares `regen-toolkit`** — a real instance (own remote,
  `federation.yaml`, 23 registries, own scaffold root) nested at
  `regen-coordination-os/repos/regen-toolkit`. It was undeclared, so `analyze:instances`, every
  drift report and the v0.5 fleet sweep were blind to it. Assess-only: its tree carries ~2,275
  uncommitted files.
- **Session kit** (`docs/sessions/`) — narrative, live demo script, FAQ, a one-pager rendered
  through `render:templates` so its numbers stay live, plus the branch-instance and scheduling
  drafts for the Regen Knowledge Commons session.
- **`tests/clone-framework-health.test.mjs`** gains a no-leak test, and **`packages/admin/tests/real-data.test.ts`**
  is new: it runs the admin app's own validator over this repository's real registries, which is
  the regression that would have caught every admin defect fixed below.

### Fixed

- **`doctor sync` can now actually sync an instance** — the 🔴 architectural Known Issue that
  narrowed v0.5.0's reliability claim is closed. Stage 5 no longer delegates to a
  `git pull --rebase upstream main` that assumes fork lineage; a **file-level overlay**
  (`packages/instance-doctor/src/overlay.mjs`) copies framework-owned paths in, leaves everything
  the organization owns untouched, never deletes, and lets the lineage stamp record which
  framework commit was applied. Accepted end to end against `refi-med-os` — the very instance the
  rebase corrupted — with all nine stages green, 0 blockers, identity and root commit intact, and
  a second run reporting a clean no-op. Full record:
  `memory/reports/overlay-acceptance-2026-08-29.md`.
- **`doctor sync`'s dirty-tree gate refused over work it was never going to touch.** The refusal
  was written for the rebase above, which rewrote the whole working tree — so any uncommitted file
  anywhere genuinely was at risk. The overlay writes a computed, narrow list, and the gate never
  followed. It now intersects the uncommitted paths with the overlay plan's `add`+`update` set
  (`unchanged` is not a write), and `buildOverlayPlan()` is shared with the overlay stage so the
  gate and the writer cannot drift apart. Measured across the fleet: **3,256 uncommitted files
  across six instances, exactly one genuine collision** — the coarse form was blocking all seven
  unsynced instances. Safety is unchanged where it matters: a real collision still aborts, still
  after the snapshot ref is written, still naming the exact files; an uncommitted *deletion* of a
  file the overlay would restore counts as a collision; and when no plan can be computed the gate
  falls back to refusing any dirty tree. The `working-tree-dirty` hint and `skills/instance-doctor/SKILL.md`
  claimed "sync refuses to run on a dirty tree" and are corrected.
- **Four instances synced on the strength of it** — `bread-coop-os` (8 → 5 blockers),
  `regen-coordination-os` (9 → 8), `dao-os` (3 → 3) and `regen-toolkit` (4 → 4, with 3,005
  uncommitted files of which **zero** were committed or touched). All four kept their root commit
  and identity, took 3 sync commits each, and left a snapshot ref. None reached zero blockers, so
  all four aborted at `re-assess` and **none carries a `last_sync_commit` stamp**: every remaining
  blocker is instance-owned content (`.well-known/` identity leakage, `CHANGELOG.md` version
  claims, `package.json` script targets) that the overlay is forbidden to touch. Fleet propagation
  is now blocked on per-instance content repair, not on sync tooling. `refi-bcn-os` and
  `refi-dao-os` were deliberately left unsynced — production, and refi-dao gates v0.6 Active-1.
  Full record: `memory/reports/fleet-sync-2026-08-29.md`.
- **The recommended setup path shipped the framework's own content.** A fresh instance carried
  the maintainer's member entry, 13 framework projects, framework ideas/ecosystems/relationships,
  the framework's `SOUL.md` and API endpoints, and its federation frontier cache — the 2026-08-21
  clean-room B4/B5 leak, still alive in the engine path. `clone-framework` stage 4b now resets
  instance-owned registries and operator files, so identity is stripped **by construction**
  rather than by operator diligence. Clean-room re-run against public `main`: zero leaks.
- **The admin app could not open or save this repository's own data.** Schemas were derived from
  `DATA-MODEL.md`'s examples rather than real registries: `projects` 0/13 valid (status enum vs
  the real `Discovery`/`Develop`), `relationships` 0/7 (touchpoints typed as objects; real data is
  strings, plus `null` rejected on optional fields). `projects.status`/`type` are no longer enums —
  fleet evidence shows the vocabulary is instance-defined and genuinely differs — and optional
  fields across all 14 schemas accept `null`, which is how an unset field is written in these YAML
  registries.
- **A funding-opportunities data-loss path.** The admin hardcoded the top-level key
  `funding_opportunities`; four of five real instances use `opportunities`. The UI showed an empty
  registry for a populated file, then appended to a *new* second top-level key on create, splitting
  one list in two. `RegistryDef` now carries aliases and every call site resolves against the
  document.
- **The admin entity form showed one entity's data under another's heading.** `EntityForm` seeds
  its draft once and had no `key`, so selecting a different row reused the instance; saving then
  422'd on an id mismatch, or 409'd as a duplicate after `+ New`.
- **CI could not run the instance-doctor suite.** Fixture repos had no git identity and runners
  have no global one, so the doctor's own commit stages died with `fatal: empty ident name` —
  `validate.yml` was red while local runs passed on the developer's global config.
- **`version:update` left two of the five version surfaces stale.** It bumped package.json,
  federation.yaml and the CHANGELOG but not `VERSION.md` or `MASTERPLAN.md`, and because
  `version:check` compares major.minor the gap passed silently — cutting a patch release would
  have shipped a `VERSION.md` reading the previous version. Bump mode now moves every surface it
  checks.
- **`AGENTS.md` §11 pointed at the wrong upstream.** Now the canonical `org-os-template`. Executing
  the fix corrected the record: `org-os-framework` and `organizational-os-framework` are the *same*
  repository (the latter is a former name GitHub redirects), so the "three circulating names" were
  two repos. The legacy one is archived with a README pointing here.

### Changed

- **One honest setup path** across the quickstart trio. `BOOTSTRAP.md`, the README and
  `docs/OPERATOR-GUIDE.md` now tell one story: the cloning engine as a generator, with
  `npm run setup` framed as the in-place TTY-only alternative and its real nine prompts listed.
  Closes clean-room findings **B1**, **M2**, **M4** and **m2**; `OPERATOR-GUIDE` Level 2 stops
  promising a web form that does not exist.
- Site `/get-started` rewritten to that path; the agent recipe joins the curated docs allowlist;
  `POSITIONING.md` numbers re-verified against the tagged release.

## [0.5.0] — 2026-08-29

**The beta.** The release that makes org-os stable and reliable enough for real adoption and
collaborative use: a consolidated trunk, a public site, a package that can assess any
downstream instance, one coherent versioning story, and a branch topology that is just `main`.

**Version-scheme re-baseline (deliberate, non-SemVer).** Declared **2026-06-17**, shipped here.
org-os adopts a `0.x` **pre-beta** scheme to signal pre-1.0 maturity honestly. The line previously
numbered `1.x → 2.x → 3.x → 3.5` (four milestones) is designated **v0.5** — the fifth. `0.5 < 3.5`
is intentional and reflects "pre-beta", not a regression; SemVer ordering does not apply across
this re-baseline. **This paragraph is the single source of truth for the cross-scheme map**;
`docs/VERSIONING.md` restates it and `packages/instance-doctor` implements it. Historical tags are
published as `archive/v3.0.0` / `archive/v3.5.0`, never bare, so they cannot outrank `v0.5.0` in a
semver-sorted list.

### Added

- **`packages/instance-doctor`** — the reliability centrepiece. `doctor assess` runs six checks
  over any instance (identity coherence + template leakage, lineage stamps, cross-scheme version
  surfaces, machinery integrity, structure/schemas, freshness) and prints a BLOCKER/WARN/OK
  scorecard with `--json` and blocker exit codes — **proven against all six real instances plus
  the framework itself in the 2026-08-28 acceptance run**, where it surfaced every defect that
  run reported. `doctor sync` runs nine stages — snapshot, ensure-upstream, fetch,
  inject-machinery, sync-upstream, migrate, generate-schemas, re-assess, receipt — aborting on
  the first failure so an instance is never left half-migrated. **Its `--dry-run` planning half
  is proven; a full sync is not** — the same acceptance run found the strategy it delegates to
  cannot apply to scaffolded instances (see Known issues), so v0.5's proven surface is
  `assess` + `sync --dry-run`. Hub mode (`npm run doctor -- --dir ../other-instance`) is what
  breaks the bootstrap deadlock: an instance cannot repair its own updating mechanism using its
  own updating mechanism, so the framework supplies it. Ships `skills/instance-doctor/SKILL.md`,
  `npm run doctor`, and `modules/org-os-instance-doctor/module.yaml` — the **second tracked
  module**, which fires the module-engine un-freeze trigger for v0.6.
- **Admin app M1** — `packages/admin/` lands on trunk after eight months on a branch, with its 44
  tests wired into `npm test`, `selftest` and CI so they cannot go quiet again.
- **Public site, live** — `https://regen-coordination.github.io/org-os-template/`, auto-deploying
  on push to `main`, with a base-path gate asserting every internal link carries `/org-os-template`
  exactly once.
- **symbient v2** — practice promoted to framework capability: `skills/symbient/` (contract +
  vendored Quilt Protocol by Wib & Wob, CC BY-NC), `scripts/symbient-hatch.mjs` +
  `scripts/lib/symbient-gates.mjs` (the canonical GATES.md parse — no production code calls it
  yet; all stage-gating is agent-honored, and any host reading GATES.md programmatically must use
  this module), conditional close-pulse in `/close`, hermes on-demand surfacing. Habitats are
  operator-private (gitignored).
- **Federation map** — `@org-os/federation-map`, an interactive map of an instance's external
  world (ring 1 instances · ring 2 frontier peers-of-peers · ring 3 sources/ecosystems), plus the
  kms data plane behind it (`render map`, `federate frontier`, offline vault artifact).
- **kms + quilt** — `@org-os/kms` binds `@regen-commons/toolkit-framework` into org-os as both a
  module and the default knowledge profile.
- **Cloudflare OS integration M0–M2** — the `gatekeeper-org-os` adapter, a pure page core shared
  with `page-shim`, GitHub/memory substrates, and the org-dashboard gadget. First tracked module.
- **graphify integration** — knowledge-graph ingest via `graphify export --wiki` +
  `compile:knowledge`, with `graph:status` / `graph:gaps` surfaced in the dashboard.
- **Autopoiesis Phase 2** — cascade closure: the 10-stage `scripts/sync-upstream.mjs`,
  `scripts/validate-identity.mjs`, and the `genesis_commit` / `last_sync_commit` lineage stamp.

### Changed

- **One versioning story.** `version:check` now reads **five** surfaces, not three — `package.json`,
  `federation.yaml`, `CHANGELOG.md`, root `VERSION.md`, and the `MASTERPLAN.md` header. The two it
  could not previously see were the two that were wrong: `VERSION.md` said `1.0.0` and
  `MASTERPLAN.md` said `2.0.0` while the framework was on `0.5.0`. Both corrected.
  `docs/VERSIONING.md` rewritten around the `0.x` line: `0.minor` is a milestone counter, `1.0.0`
  is reserved as a claim rather than a number, and `3.x` is demoted to Historical.
- **`clone-framework.mjs` no longer produces a broken instance.** It emitted one with 7 doctor
  blockers seconds after creation. It now renders the instance's own `.well-known/dao.json`,
  strips the framework's generated `.well-known/*.json` and CHANGELOG, reads the framework version
  instead of hardcoding `3.5`, writes the canonical upstream URL rather than a legacy spelling,
  and drops npm scripts pointing at files the instance never receives.
  `tests/clone-framework-health.test.mjs` fails the build if any of it regresses.
- **CI enforces the release gate.** `validate.yml` runs `npm test` and the site build/tests, with
  the stale soft-fail on `validate:schemas` removed.
- **Branch topology cleared to `main`.** Nine branches and five worktrees retired behind 18
  `archive/*` tags, each annotated with its restore command; proof in
  `memory/reports/branch-triage-2026-08-28.md`.
- **The vault-safety guard** stopped over-matching: `clean` / `stash` / `reset --hard` are matched
  only in git subcommand position, so pathspecs and commit messages naming them no longer trip it.
- **Status debt cleared** — `MASTERPLAN.md`'s Activations section (a v2-era checklist long after
  every item shipped) now points at the live queue; `docs/SETUP-PATHS.md` reduced to an honest
  stub; the README states one recommended bootstrap path and how to verify it.

### Removed

- `MASTERPROMPT.md` — superseded by `MASTERPLAN.md` + `AGENTS.md`.
- `npm run quartz` and `npm run setup:cursor` — both pointed at files that have never existed in
  this repository's history, and `setup:cursor` was documented in two places as if it worked.

### Known issues

Shipped knowingly and documented rather than quietly.

Two **data-loss** defects in the kms layer, found by production use in `refi-dao-os` and
recorded in its framework-feedback ledger:

- 🔴 **`kms store` silently overwrites objects sharing a title-slug** (ledger B5) — at scale this
  loses knowledge objects without an error.
- 🔴 **kms provenance criticals** (ledger section D, two items).

**Disposition (WS-F4):** the fix targets **v0.5.1**, and these items **gate v0.6 Active-1**
(downstream propagation) — the fleet is not synced onto a knowledge store that can lose data.
Data loss is exempt from the portfolio freeze table. Both instance feedback ledgers are now
registered as recognized upstream inputs in `docs/SKILL-PROMOTION.md`.

One architectural finding from the release's own acceptance run (WS-H, 2026-08-28 —
`memory/reports/ws-h-acceptance-2026-08-28.md`):

- 🔴 **A full `doctor sync` cannot yet sync any real instance.** Stage 5 delegates to
  `scripts/sync-upstream.mjs`, whose `git pull --rebase upstream main` assumes the instance is a
  *fork* of the framework — but every real instance is a *scaffold* with its own root commit
  (verified six-for-six), so the rebase conflicts and leaves the repo mid-rebase. The lineage
  stamps record the true provenance; git history does not. The v0.5 reliability claim is
  therefore **`assess` + `sync --dry-run`**, both proven against the live fleet.

**Disposition (operator decision 2026-08-29, per the WS-H report's option 2):** replace the
history-based sync with a **file-level overlay** (framework-owned paths copied, instance-owned
paths untouched, lineage stamp recording the applied framework commit — the primitive
`sync-packages.mjs` already uses) in **v0.5.1**, then re-run WS-H acceptance in full. Fleet
propagation stays v0.6 Active-1, already gated on the kms items above.

Also known, and *not* fixed here: `npm run setup` (the in-place wizard) remains TTY-only and has
not been re-tested end to end since the 2026-08-21 clean-room run. Use `clone:framework`.

### Follow-ups (flagged, not done here)

- Downstream instances still record legacy `framework_version` values (`3.0`/`3.5`). Propagation
  across the fleet is v0.6 Active-1, gated on the kms items above; `doctor sync` is the vehicle.
- Six different repository names have circulated as "the framework" and every instance declares a
  wrong one. All six are recorded in `packages/instance-doctor`'s `KNOWN_WRONG_UPSTREAMS`;
  reconciling the repositories themselves is a separate operator action.

## [3.5.0] — 2026-05-16

The "Consolidation + Ready for Real Orgs" release. Formalizes ~12 months of accreted skills, packages, scripts, and structural innovations across the framework and downstream instances into a single coherent release. Plus the missing machinery (reliability layer, package lifecycle, cloning engine, cascade closure) that makes the framework genuinely self-serve.

### Consolidation backbone (Tier 1)
- 9 superpowers-* skills (brainstorming, executing-plans, finishing-a-development-branch, requesting-code-review, subagent-driven-development, systematic-debugging, test-driven-development, using-git-worktrees, writing-plans).
- 3 expertise skills: expert-feynman, karpathy-guidelines, initialize.
- 2 host-integration packages: hermes-integration (Hermes runtime tool + skill bundle), opencode-integration (npm plugin + 5 slash commands: /dashboard, /initialize, /org-projects, /org-decisions, /org-this-week).
- 5 promoted P0 skills from instances (≥2 adoption): frontend-design, artifacts-builder, skill-creator, mcp-builder (Anthropic-vendored, generalized); meeting-notes-transcription-fixer (framework-authored).
- 5 promoted P0 scripts (≥3 instance adoption, mostly byte-identical): compile-knowledge, index-linked-repos, lint-knowledge, normalize-kb-frontmatter (refactored to load aliases from data/knowledge-aliases.yaml), update-knowledge-index.
- Hub vault-safety pattern promoted to framework: scripts/vault-snapshot.mjs, scripts/vault-audit.mjs, docs/VAULT-SAFETY.md (193 lines: iron rules + safe pattern + 7-layer recovery runbook + 2026-04-25 incident case study).
- scripts/check-divergence.mjs — advisory md5 comparison across instances vs framework canonical.
- scripts/page-shim.mjs — transitional bridge for `npm run page <id>` (renders 7 pages until TUI ships in v3.6+).
- Matrix integrity pass: data/skills-matrix.yaml rewritten with honest promotion_status; data/packages-matrix.yaml extended with `lifecycle_status` field (active/dormant/planned/retired). docs/SKILL-PROMOTION.md extended with Script-Level Reconciliation section + Known Divergences table.

### Operator-facing surface (Tier 2)
- System reliability layer: docs/RELIABILITY.md, scripts/selftest.mjs aggregator, scripts/install-hooks.mjs + .github/hooks/pre-commit.sh, .github/workflows/{validate,drift}.yml.
- Version triplet check: `npm run version:check` verifies package.json, federation.yaml, and CHANGELOG.md all agree.
- Skills section: scripts/lib/discover-skills.mjs walker, scripts/generate-skills.mjs → SKILLS.md + .well-known/skills.json, /skills slash command.

### Real-org-ready machinery (Tier 3)
- Package integration: docs/PACKAGE-LIFECYCLE.md, scripts/sync-packages.mjs (TDD, 5 tests).
- One-pager templates: templates/render.mjs (~95-LOC mustache renderer, 9 tests), templates/README.{framework,instance}.md, templates/GETTING-STARTED.md, templates/partials/{cheatsheet,federation}.md, scripts/render-templates.mjs.
- Cloning engine: scripts/clone-framework.mjs (8-stage non-interactive bootstrap, 4 tests).
- Acceptance test: bread-coop-os bootstrapped end-to-end (registered in data/instances.yaml as framework_version: "3.5").

### Cascade machinery (Tier 4)
- Autopoiesis Phase 2 (Loop C cascade closure): scripts/sync-upstream.mjs (10-stage pull-based sync with vault-safety + .sync-freeze guard + receipt logging), scripts/validate-identity.mjs (IDENTITY.md ↔ federation.yaml agreement + lineage stamp shape).
- Lineage stamp in federation.yaml.metadata: `genesis_commit` (immutable, 40-hex SHA from framework's root commit) + `last_sync_commit` (mutable).

### Changed
- Validator: fixed long-standing bogus "federation section" check; added section 9 enforcing lifecycle_status + promotion_status enum values; pre-release version exemption.
- IDENTITY.md type narrowed to controlled vocabulary "Project"; validate-identity now enforces agreement with federation.yaml.identity.type.
- BOOTSTRAP.md gained "Quick Path: Cloning Engine (v3.5+)" section.
- AGENTS.md gained top-level "Workspace Safety" section.
- README.md regenerated from templates (replaces "GitHub-based operational workspace template" framing).
- 28 skills now in framework (up from 11 in v3.0); 11 packages (up from 9).

### Added (framework infrastructure)
- .github/workflows/{validate,drift}.yml — CI on push/PR + weekly scheduled drift report.
- .github/hooks/pre-commit.sh — installable via `npm run install:hooks`.
- tests/ directory with 23 node:test cases.
- npm scripts added: vault:snapshot, vault:audit, knowledge:{compile,index,lint,normalize,update-index}, check:divergence, selftest, version:check, install:hooks, generate:skills, sync:packages, render:templates, clone:framework, test.

### Fixed
- Duplicate `initialize` entry in package.json scripts.
- Missing .well-known/dao.json (was only .template).
- Pre-commit hook tolerates missing scripts/validate-identity.mjs (was hard-failing before P12 landed it).

## [3.0.0] — 2026-04-24

First tagged release under the proper versioning system. Consolidates the work done since the v2.0.0 launch and inaugurates org-os as a self-hosting, multi-instance orchestration hub.

### Added

- **Versioning system.** `docs/VERSIONING.md` policy, this `CHANGELOG.md`, `scripts/update-version.mjs`, `scripts/migrations/`, and a `validate:structure` consistency check.
- **Self-hosting inauguration.** Stubs in `SOUL.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `MEMORY.md` replaced with real org-os-development content. `BOOTSTRAP.md` gained a bootstrap-done note.
- **Instance orchestration layer.** Three new framework-only registries: `data/instances.yaml` (per-instance state), `data/skills-matrix.yaml` (cross-instance skill catalog), `data/packages-matrix.yaml` (cross-instance package catalog). Documented in `docs/DATA-MODEL.md` → "Framework-only registries".
- **`npm run analyze:instances`** — scans every downstream instance for drift, writes a dated report to `memory/reports/`.
- **`workstream` frontmatter field** on all plans in `docs/agent-plans/`. Ties specific plans to long-lived workstreams in `data/projects.yaml`.
- **`docs/SKILL-PROMOTION.md`** — criteria and workflow for promoting skills from instance-local to framework-canonical.
- **`docs/agent-plans/README.md`** — documents the plan-pipeline conventions.
- **Three new workstreams in `data/projects.yaml`:** `instance-orchestration`, `skill-promotion`, `opal-rollout`, `operator-interfaces`.
- **Four new scoping plans:** `obsidian-interface`, `obsidian-canvas-interface`, `versioning-system`, plus earlier `framework-dashboard-template`.
- **`dashboard.yaml` custom sections** for instances, skill-promotion candidates, and package-promotion candidates (tuned for the framework/orchestration-hub view).
- **`federation.yaml` rewired** to reflect framework-upstream + orchestration-hub role. All 5 known downstream instances enumerated: `refi-bcn-os`, `refi-dao-os`, `dao-os`, `openclaw`, `regen-coordination-os`.
- **`scripts/initialize.mjs` extended** to load ideas, instances, and skill candidates into the state payload.

### Changed

- **`package.json.version`** bumped `2.0.0` → `3.0.0` to reconcile with `federation.yaml.metadata.framework_version` which had already moved to `3.0`.
- **`federation.yaml` v3.0 spec** formalized: `identity.role` field, `downstream` array with per-instance `cloned`/`local_path`/`sync_direction`, `agent.skills` aligned with the actual `skills/` directory (10 entries, previously listed 6).
- **`/initialize` behavior** now controlled by `dashboard.yaml` sections (started in v2 via commit `1b2f7e4`; formalized here). Sections can be toggled and reordered without code changes.

### Fixed

- `federation.yaml` agent skills list no longer drifts from reality.
- `scripts/initialize.mjs` no longer emits empty `ideas` / `instances` arrays when those registries are populated.

### Breaking

- Downstream instances should run `npm run migrate` to pick up the `workstream` frontmatter convention and (if they host the framework-only registries) seed them.
- The migration path is documented in [`docs/migrations/v2-to-v3.md`](docs/migrations/v2-to-v3.md).

## [2.0.0] — 2026-04-06

Framework standards release. Published as the foundation all v2 instances build on.

### Added

- **v2.0.0 framework documentation suite:** `docs/FILE-STRUCTURE.md`, `docs/DATA-MODEL.md`, `docs/AGENTIC-ARCHITECTURE.md`, `docs/SKILL-SPECIFICATION.md`, `docs/FEDERATION.md`, `docs/OPERATOR-GUIDE.md`, and more.
- **13 canonical data registries** with schema templates: `members`, `projects`, `finances`, `governance`, `meetings`, `ideas` (required); `funding-opportunities`, `relationships`, `sources`, `knowledge-manifest`, `events`, `channels`, `assets` (optional).
- **EIP-4824 schema generator** — `scripts/generate-all-schemas.mjs` emits `.well-known/*.json` from `data/*.yaml`.
- **Plan pipeline** — `docs/agent-plans/` with `scoping → queued → active → completed` lifecycle (commit `d1028ec` / `c80b3dc`).
- **10 core skills:** `bootstrap-interviewer`, `capital-flow`, `funding-scout`, `heartbeat-monitor`, `idea-scout`, `knowledge-curator`, `meeting-processor`, `org-os-init`, `schema-generator`, `workspace-improver`.
- **Session lifecycle** — `/initialize` and `/close` slash commands powered by the `org-os-init` skill.
- **`scripts/validate-structure.mjs`** — validates an instance against the canonical spec.

## Pre-v2.0.0

Incubation. See git history for granular changes. Notable milestones:

- `ef40d06` — first `/initialize` dashboard command with Notion integration.
- `a31b336` — full session lifecycle with apps, auto-sync, and `/close`.
- `ff5f568` — unified agent models framework.
- `a2feec4` — egregore, koi, opal integrations landed.
- `12ef2f9` — 4 Regen agents + knowledge initiation plan.

[Unreleased]: https://github.com/regen-coordination/org-os-template/compare/v0.7.6...HEAD
[0.7.6]: https://github.com/regen-coordination/org-os-template/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/regen-coordination/org-os-template/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/regen-coordination/org-os-template/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/regen-coordination/org-os-template/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/regen-coordination/org-os-template/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/regen-coordination/org-os-template/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/regen-coordination/org-os-template/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/regen-coordination/org-os-template/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/regen-coordination/org-os-template/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/regen-coordination/org-os-template/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/regen-coordination/org-os-template/compare/archive/v3.5.0...v0.5.0
[3.5.0]: https://github.com/regen-coordination/org-os-template/compare/v3.0.0...v3.5.0
[3.0.0]: https://github.com/regen-coordination/org-os-template/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/regen-coordination/org-os-template/releases/tag/v2.0.0
