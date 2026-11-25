# Federation

An org-os instance is a git repository. Federation, in this repository, means three concrete things: a manifest (`federation.yaml`) in which an instance names its peers, its upstream and its downstream; machine-readable files in `.well-known/` that other tools can fetch; and a handful of scripts that read the manifest. Beyond git and plain HTTPS fetches, the one network protocol is atproto: since 0.7.4 an instance can ask to join a hub's network, and each side publishes its half of the membership link as a record in its own atproto account (see [Joining a network](#joining-a-network)). There is no trust enforcement and no automatic data exchange between instances. This page says what each part does today and, section by section, what is only described and not built.

Status: the manifest, the lineage stamp, `sync:upstream`, `analyze:instances`, the schema generator, the federation map, and joining a network with its link records on atproto (0.7.4, in the admin app) are built. The link records have been tested against a mocked atproto server, not yet run on live accounts (see [Before the live pilot](#before-the-live-pilot)). Knowledge exchange between peers, skill broadcast, trust levels and koi-net sync are not (see [Not built](#not-built)).

Every instance today is run by the maintainer; the federation graph is real files but a single operator's network. The "fork and answer an interview" setup path does not work for a newcomer; cloning with `npm run clone:framework` is the supported route (see [Setup](SETUP.md)).

## federation.yaml

The manifest lives at the repository root. This repository's own is the working example. Its first lines:

```yaml
version: "0.7"
spec: "organizational-os/0.5"
identity:
  name: "org-os"
  type: "Project"
```

`version` and `spec` carry the framework's major.minor when `npm run clone:framework` writes them (both from the root `package.json`). On a version bump `scripts/update-version.mjs` rewrites `version` and `metadata.framework_version` but not `spec`, which is why this repository's `spec` still says `0.5`. Older text, including `schemas/federation.yaml`, still says `3.0`; that is the number from before the 2026-06-17 re-baseline and is not what the code writes. No script reads `spec`.

### What the validators require

`npm run validate:structure` also requires `.well-known/dao.json`, `members.json` and `projects.json` once `identity.daoURI` is set (not before: without it nothing is generated), parses every `.well-known/*.json`, and requires `metadata.framework_version`. Its federation check (section 6) fails an instance unless `federation.yaml` has: `identity`, `identity.name`, `identity.type`, at least one of `network` / `peers` / `upstream` / `downstream` (or a legacy `federation:` wrapper key), and an `agent` section. A missing `knowledge-commons` section is a warning only.

`npm run validate:schemas` ([`scripts/validate-identity.mjs`](../scripts/validate-identity.mjs)) checks: `identity.name` and `identity.type` equal the `Name` and `Type` lines of `IDENTITY.md`; `metadata.framework_version` is exactly major.minor (`"0.7"`, not `"0.7.5"`); `metadata.genesis_commit` is a 40-hex SHA (missing is a warning, so a first sync can seed it); `metadata.last_sync_commit` is a 40-hex SHA or null. With `identity.daoURI` set it also checks the published `.well-known/` files against their schemas and scans them for withheld values (see the [EIP-4824 guide](EIP4824-GUIDE.md)). `--strict` turns warnings into failures; a directory argument validates another instance.

Neither validator checks the `type` enum, trust values or any other field value. [`schemas/federation.yaml`](../schemas/federation.yaml) lists enums, but it is a description, not something code loads; and its `agent.runtime` and `upstream.type` lists no longer match the files in use.

### Field reference

"Read by" names the code that consumes the field. A field with none is documentation for humans and agents only.

**identity**

| Field | Meaning | Read by |
|---|---|---|
| `name` | Organisation name (required) | validators; schema generator; map |
| `type` | One of `DAO`, `Cooperative`, `Foundation`, `Project`, `LocalNode`, `PersonalNode`, `RegionalNode`, `Hub`, `Network`, `Other` (required; list from `schemas/federation.yaml`, not enforced) | validators; schema generator (decides the `type` of `dao.json` and `members.json`: `DAO`, `Foundation`, `Person`, `Entity` or `Organization`); map |
| `scope`, `role` | Free-form qualifier of the node within its type (`role` is used by this repo: `framework-upstream + orchestration-hub`) | nothing |
| `emoji` | Display glyph | map |
| `language` | BCP-47 working language; stamped at clone time | agents |
| `short_description` | One-line description | schema generator (`dao.json` description) |
| `daoURI` | `https` URL of the instance's `dao.json` | schema generator: every id and URI in `.well-known/` is built from it; if empty, `generate:schemas` writes nothing, and `validate:structure` does not require the `.well-known/` files |
| `attestation_issuers[]` | `name`, `issuer` | schema generator: `attestation-issuers.json` (DAOIP-3) |
| `chain`, `safe`, `gardens` | Chain id (CAIP-2), Safe address, Gardens address | schema generator, as a 0.5 fallback only: when `data/systems.yaml` has no on-chain System, `safe` and `gardens` become entries of `contracts.json`, with a warning to move them there |
| `hats` | Hats Protocol tree id | nothing (a `hats-tree` System in `data/systems.yaml` is what gets published) |
| `did` | The org's atproto DID: `did:plc:` and 24 base32 characters, or `did:web:` and a host. The account its link records are written from (see [Link records on atproto](#link-records-on-atproto)). Anything else is ignored, with a warning | the admin's Federation page; kms, which checks it equals the `did` under `atproto` in `kms.yaml` |
| `onchain_registration` | `enabled`, `chain`, `contract_address` | schema generator, as a fallback: the address is listed in `contracts.json` when `data/systems.yaml` has no `daouri-registration` System. Nothing registers anything |

**Network and relations**

| Field | Meaning | Read by |
|---|---|---|
| `network` | Name of the network | validator (counts as participation); `initialize` dashboard |
| `hub` | Hub repository, as an `https://` URL | map (self node URL); read as one item of `networks` |
| `networks[]` | For an instance in more than one network: `name` (required), `hub` (`url` is read the same way when there is no `hub`), `role` (`node`, `hub`…). When set, `network` and `hub` are ignored | the admin's Federation page; schema generator (`federation.json`) |
| `join` | How others join this instance's network: `policy` (`closed`, `invite`, `open-with-approval`, `open`), `types`, `asks`, `where` (a public `https://` address), `decision` (under `open`). Unknown `policy`: ignored, and `validate:schemas` says so. See [Hosting a network](#hosting-a-network-the-join-policy) | the admin's Federation page; schema generator (`federation.json`) |
| `peers[]` | `name`, `repo`, `url`, `trust` (`full` / `read` / `read-write` / `none`), and since 0.7.4 `since`, `decision`, `visibility` (`public` by default, or `private`: never published), `relationship` (free-form; only `node`, on a hub, can make a peer a member), `did`, `link` (`memberOf`, `hasMember`, `peerOf`, or `none` to keep the peer off atproto) and `requested`. `repo` is a path relative to this instance or a folder above it, a GitHub `owner/repo`, or a URL | `initialize` (count, table with trust); map (ring 1); frontier fetch; the admin's Federation page (link state, link records) |
| `upstream[]` | The framework this instance derives from: `id`/`repository`, `url`, `last_sync`, `sync_frequency`, `type`, `relationship` | `sync-upstream` (uses `upstream[0].url`); `initialize`; instance-doctor (compares the declared URL with the git `upstream` remote; reads `type`/`relationship`/`last_sync` as prose pedigree); map; frontier |
| `downstream[]` | Instances derived from this one: `name`, `id`, `repo`, `url`, `type`, `local_path`, `cloned`, `trust`, `sync_direction`, `note` | map; frontier. `local_path` is how the map finds a sibling checkout to read counts from. `sync_direction` is not read |

`trust` is stored and displayed, and the admin's federation reader warns on a value outside the list. Nothing enforces it: no script pushes to a `full` peer or refuses a `none` peer; an accepted join writes `trust: read`. `remote_name` in an upstream entry is not read; `sync-upstream` uses a git remote literally named `upstream`.

An older file may keep `network`, `hub`, `networks` or `peers` inside a `federation:` block. They are still read from there when the top level has none of them, and `validate:schemas` asks you to move them to the top level. Asking to join refuses until they are moved.

**Link state.**

Whether a link is real depends on both sides, so it is worked out each time from both `federation.yaml` files and never stored. In N0 a peer is in one of four states (joining a network adds `requested`, `left` and atproto records: see [Joining a network](#joining-a-network)):

| State | Meaning |
|-------|---------|
| `mutual` | You list them and they list you back |
| `claimed` | You list them, but they do not list you |
| `not-an-instance` | The folder exists but has no `federation.yaml`: it is a repo, not an org-os instance. Map it as a System in `data/systems.yaml` |
| `unknown` | Their side can't be read from here: the folder is missing, the file is broken, or the peer is only a URL |

`npm run validate:schemas` turns `claimed`, `not-an-instance` and `unknown` into warnings, except an `unknown` peer known only by a URL or a GitHub `owner/repo`, which there is no folder to check for. It never fails because of them, except under `--strict`. Nothing in a `peers` list is ever moved or removed for you.

**agent**: `runtime`, `workspace`, `skills[]`, `channels[]`, `proactive`, `heartbeat_interval`. Only `runtime` and the length of `skills` are read (`initialize`). The skill list is not checked against `skills/`; to see which skills an instance actually has, run `npm run generate:skills` (see [Skill specification](SKILL-SPECIFICATION.md)).

**knowledge-commons**: `enabled`, `shared-domains[]`, `sync-protocol` (`git` / `koi-net` / `manual`), `publish{meetings,projects,funding}`, `subscribe[]`. Read by `initialize` and the cloud build state for display (enabled flag, protocol, domains). No code publishes or pulls anything because of it. See [Not built](#not-built).

**integrations**: grouped lists (`agent_runtimes`, `knowledge_infrastructure`, `meeting_processing`, `publishing`, `grants`) of `name`, `repo`, `url`, `role`. Informational.

**packages**: a map of package id to boolean. `npm run sync:packages` reads it to decide which framework packages to copy into the instance; `initialize` reads it for the dashboard. The ids are those of `data/packages-matrix.yaml` (see [Packages](PACKAGES.md)); this repository's own list is only a framework default for downstream clones.

**customizations[]**: `path`, `reason`, `type` (`addition` / `override` / ...), `maintain_on_sync`. `sync-upstream` reads the list, logs how many entries it holds and writes that count into the sync receipt. It does not use the paths to protect anything: the update is `git pull --rebase upstream main`, and git, not this list, decides what survives. Treat the list as a record of intent.

**governance**, **platforms**: `maintainers[]`, `decision_model`, `proposal_threshold`; `primary`, `deployment`, `domain`, `mirrors[]`. Informational; no code reads them.

**metadata**: `created`, `last_updated`, `framework_version`, `self_hosting_since`, `bootstrap_date`, `bootstrap_operator`, `genesis_commit`, `last_sync_commit`. The last four are the lineage stamp described below.

### What `clone:framework` writes

A new instance's manifest is short: `version`, `spec`, `identity` (`name`, `type`, `short_description`, optional `emoji` and `language`), `network`, `peers: []`, one `upstream` entry (`id: "org-os-template"`, the canonical URL `https://github.com/regen-coordination/org-os-template.git`, `last_sync`), `downstream: []`, `agent` (`runtime: "claude-code"`, `skills`), `packages`, and `metadata` (including `genesis_commit`, `last_sync_commit: null`). Everything else in the reference above you add by hand. A configured upstream URL that is not the canonical repository is replaced and the substitution is logged. Source: [`scripts/clone-framework.mjs`](../scripts/clone-framework.mjs), stage 6.

## The lineage stamp

`metadata.genesis_commit` is the SHA of the framework's first commit at the moment the instance was cloned; `metadata.last_sync_commit` is the framework `HEAD` at the last sync, or `null` if never synced (also correct for the framework itself). Together they let you ask which framework state an instance was born from and how far it has moved since. `npm run validate:schemas` checks their shape; instance-doctor's lineage check reads them and flags instances that claim a pedigree in prose without a SHA.

## Syncing from upstream

Run from inside an instance:

```bash
npm run sync:upstream -- --dry    # print the stages, change nothing (does not fetch)
npm run sync:upstream             # fetch, count new commits, print the count, exit 0 having changed nothing
npm run sync:upstream -- --yes    # do the sync: rebase, migrate, sync packages, validate, stamp
```

There is no interactive prompt: without `--yes` the command only reports how many commits it would apply. With no new commits it prints "Already up to date" and exits 0. `--dry` skips the fetch, so it fails with "Could not read upstream/main" if the `upstream` remote was never fetched.

The stages ([`scripts/sync-upstream.mjs`](../scripts/sync-upstream.mjs)): refuse on a dirty working tree (take a snapshot first; see [Vault safety](VAULT-SAFETY.md)); refuse if a `.sync-freeze` file exists; read `upstream[0].url` (add the `upstream` remote if missing, fetch it); count new commits on `upstream/main`; `git pull --rebase upstream main`; run `npm run migrate`; run `npm run sync:packages`; run `validate:structure` and `validate:schemas` (a failure stops before the stamp is updated); write `last_sync_commit` and `last_updated` into `federation.yaml` (seeding `genesis_commit` on the first sync); write `memory/sync-YYYY-MM-DD.md`.

This is a rebase onto the framework's history. It works for an instance cloned from the framework so that history is shared. It is not for an instance that shares no history with the framework; those port framework changes deliberately (the overlay path of the [instance doctor](INSTANCE-DOCTOR.md)).

## Watching your instances: `analyze:instances`

The framework repository keeps `data/instances.yaml`, a registry of every instance it knows (id, type, maturity, `local_path`, declared extra skills and packages). `npm run analyze:instances` (`--json` for JSON on stdout) walks each instance that is cloned beside it and compares what it finds with what is declared: missing `MASTERPLAN.md` or `federation.yaml`, a `framework_version` that differs from the registry, skills or packages not in `data/skills-matrix.yaml` / `data/packages-matrix.yaml`, data registries outside the canonical list. It writes `memory/reports/instances-drift-YYYY-MM-DD.md`. Drift is informational; the exit code stays 0. `npm run check:divergence` is a related advisory check that compares an instance's scripts with the framework's. Individual instances do not need `data/instances.yaml`.

## `.well-known/`

Each instance publishes files under `.well-known/` that other tools can fetch over HTTPS. `npm run generate:schemas` writes them from `federation.yaml` `identity`, the `data/*.yaml` registries and the Markdown records in `content/meetings/` and `content/projects/`, through the standards builder in `packages/admin/lib/standards/`. It writes nothing without `identity.daoURI`, and only what `data/visibility.yaml` makes public. The files: `dao.json`, `members.json`, `proposals.json`, `activities.json`, `contracts.json` and `governance.md` (EIP-4824); `grant-pools.json` and `applications.json` (DAOIP-5, when there is a public pool; `applications.json` only in the admin's live copy); `attestation-issuers.json` (DAOIP-3, when `identity.attestation_issuers` names one); and the org-os extras `meetings.json`, `projects.json`, `finances.json`, `ideas.json`, `knowledge.json` and `federation.json`. Which file comes from which record, and how they are checked, is in the [EIP-4824 guide](EIP4824-GUIDE.md). `skills.json` is separate: `npm run generate:skills` writes it from `skills/`.

`.well-known/federation.json` publishes this instance's own public claims: its networks, its join terms and the peers it is willing to name. A peer is listed only when its `url` is a public `https:` address and it is not `visibility: private`. Notes, contacts, relationships and local paths are never published, and peers held back are only counted. A network's `hub` and the `join.where` are published the same way: only as a public `https:` address (`github.com/<owner>/<repo>` written without `https://` counts as one). Anything else, such as a local path or a name with no dot like `https://nas/`, is left out, and `validate:schemas` warns about it.

An instance does not receive `packages/admin`; `clone:framework` and the instance doctor's sync copy the builder's core into its `scripts/lib/` ([`scripts/lib/standards-vendor.mjs`](../scripts/lib/standards-vendor.mjs)), so it writes the same files. `*.json.template` files sit beside them; `clone:framework` strips the generated files from a new instance and renders its own `dao.json` from the template. A workflow, `.github/workflows/generate-schemas.yml`, regenerates and commits `.well-known/` on pushes that touch `data/`, `content/meetings/`, `content/projects/` or `federation.yaml`, and daily.

Discovery works as follows: a tool that knows an instance's `daoURI` fetches `dao.json`, which links to the other files by URL. The federation map reads `members.json` and `projects.json` from sibling checkouts (counts), not from the network; the public site's build (`site/scripts/aggregate-federation.mjs`) reads sibling instances' the same way, and does not publish this repository's own `.well-known/` (see [Federation map](FEDERATION-MAP.md#how-the-project-site-uses-it)).

## Joining a network

A node asks to join a hub's network. The hub decides under its own rules. Then each side publishes one public
record, and the link is mutual once both have. Everything here happens on the Federation page of the admin
(`/federation`), and every step that reaches the network asks you to confirm it first.

### Hosting a network: the join policy

The hub says how others join in its `join` block (above). The Federation page's Join policy form writes it, as
an `identity` change under your rules: committed if your rule lets you decide alone, staged otherwise.

| Policy | What happens to a request |
|--------|---------------------------|
| `closed` | Refused. No `join` block means `closed`. |
| `invite` | Accepted on arrival when it carries a valid invite; refused otherwise. |
| `open-with-approval` | **Recommended.** Anyone can ask. The hub decides under its own rules. |
| `open` | Accepted on arrival, under a standing decision you name (`join.decision`). Without one it works as `open-with-approval`. |

`types` limits who may ask, and every entry of `asks` must be answered. A request that fails either is refused.

When a request arrives under `open-with-approval`, it goes one of two ways:

- If your rule for `identity` lets you decide alone, it is **held** for you. Accept it, or refuse it with a reason.
- Otherwise it becomes a proposal under **From outside**, and it is accepted when the proposal is ratified.

Either way, accepting adds one `peers` entry for the node, with `relationship: node` and a `decision`. The hub
builds that entry from the request's checked fields only. It never applies anything else a request carries, and it
never writes the node's `did`: set it afterwards through the [migration list](#the-migration-list), before
publishing `hasMember`. A request addressed to another hub is refused.

Every request the hub receives is recorded in its git, in `data/federation-requests.yaml`: who asks (`name`, `type`,
`url`), the network, the answers to your asks, and, when you refuse one, your reason. If the hub's repository is
public, so is that record.

### Asking to join

1. Look the hub up by its address. This reads its `federation.json`.
2. Answer its asks and choose **Ask**. This writes your own change: the network and the hub's peer entry in
   `federation.yaml`, with `requested`, and the request itself in `federation/outgoing/<id>.yaml`. It is committed
   when your rule lets you change `identity` alone, and staged otherwise. Nothing is sent. The hub's `did` goes into
   its peer entry only when **Check links** has tied it to the hub (see [The migration list](#the-migration-list));
   otherwise the migration list suggests it later.
3. If it was staged, apply it under your rules. Sending waits until the request is on your trunk.
4. Send it. If it went by GitHub, follow the answer, and **Record it** once the hub accepts. This sets the peer's
   `decision`.

A request holds org-level facts only: its id, when it was made, who asks (`name`, `type`, `url`), the hub, the
network and the answers. It has no field for a person's contact. It is committed to git on both sides (yours in
`federation/outgoing/`, the hub's in `data/federation-requests.yaml`), so it is public wherever the repository is.

### How a request travels

| Way | What it needs | The answer |
|-----|---------------|------------|
| File | Nothing. You get a file, and pass it on by any channel. The hub imports it. | Told by the same channel. |
| GitHub | The hub's `where` is a GitHub repo, and `gh` is installed and signed in on your machine. The request becomes an issue there. | The hub replies by closing the issue; **Check the answer** reads it. |

Hosted, peer-to-peer and atproto requests are listed but not built yet. A request is never published on atproto.

A request sent as a file, invited or not, has no Record step. Once the hub lists you, the link is mutual by
files, and your `memberOf` is published without a recorded decision. Run **Check links**, then **Publish links**.

### Invites

The hub makes an invite for one org, one type and one network. It is valid for 1 to 90 days and can be used once.
The hub shows its link once (`…/federation.json#invite=<token>`). Send it privately.

- The hub keeps only the token's SHA-256 hash, in `data/invites.yaml`. An invite works once that file is on its trunk.
- The asking node keeps the token outside git, in its state folder. Its request file in git never holds it.
- An invited request always goes as a file. GitHub refuses it, so the token never lands in a public issue.

### Link records on atproto

Each side publishes one record in its own atproto repository:

- **`<authority>.link`** holds `subject` (the other side's DID), `relation` (`memberOf`, `hasMember` or `peerOf`),
  `network` (optional) and `createdAt`.
- **`<authority>.profile`** (key `self`) holds `networks: [{ hub, name }]`, the hub's DID and the network's name,
  beside the profile's `name` and `createdAt`.

The pairs are `memberOf` ↔ `hasMember` and `peerOf` ↔ `peerOf`. A link is mutual on atproto when both sides have
published their record. The link state can say `mutual` before that: it means both sides' statements agree (your
`federation.yaml`, and their record). If your own record isn't published yet, a drift line says so: `Not published
yet.` The hub publishes `hasMember` after it accepts and has set the node's `did`. The node publishes `memberOf`
after it has recorded the acceptance, or, for a request sent as a file (which has no Record step), once the hub lists
it and the link is mutual by files.

**Never published:** private peers (`visibility: private`), peers without a public `https` url, requests, answers,
invites, decision references, notes and contacts. Kept-back peers are counted, never named. If a peer becomes
private, its old record is withdrawn.

**Which account writes them:** the org's own, through kms. `kms.yaml` names it under `atproto` (`did`, `handle`,
`pds`), and that `did` must equal `identity.did` in `federation.yaml`. The app password is read from the server's
environment, `ATPROTO_APP_PASSWORD`. It is never stored, shown or logged.

**Publishing:** run **Check links** first, then **Publish links**. The plan is built from `federation.yaml` on your
trunk and shows how many links it publishes and withdraws. It writes the network and a receipt outside the
repository; it never changes a file. A run that would leave you no link record refuses to withdraw two or more at once.

**Precedence.** Your side of a link is `federation.yaml`, decided under your rules; your record is published from
it and never read back into it. Once the other side has a profile record, their records decide their side, and
their files are only a cross-check. Without a profile record, their files decide. A read that fails never moves a
link: the last reading stays, with its date.

**The authority** is the network's lexicon domain. Until the network sets one, it is the placeholder
`example.orgosnetwork`. Nothing under an `example.` authority is written to a live account: publishing refuses it.

### The migration list

The Federation page lists each public peer with the DID and the relation a record for it would carry, from your
trunk's `federation.yaml` and what the last **Check links** read. Setting a peer's `did` or `link` there is one
`federation.yaml` edit, an `identity` change under your rules. It publishes nothing by itself; **Publish links** does,
later.

It is how DIDs get into `federation.yaml`. It writes a DID only when a confirmed **Check links** tied it to that peer:
a `did:web` for the peer's own host; a handle that is the peer's host and names the DID back; or the peer's
`federation.json` naming the DID while the DID's own profile names the peer's url. A peer's word alone ties nothing.
A hub's acceptance never writes the member's DID (a request carries none), so a hub sets it here after accepting.
**Ask** writes the hub's DID only under the same test.

### What each link state means

| State | Meaning |
|-------|---------|
| `mutual` | You list them, and they list you back: their record, or their files when they have no profile record. |
| `claimed` | You list them, but they don't list you, and you haven't recorded a decision. |
| `requested` | You asked, and the hub hasn't answered yet (your peer entry has `requested`). |
| `left` | You recorded a decision, and they no longer list you: they withdrew their record, or left. |
| `not-an-instance` | The folder is a repo, not an org-os instance. |
| `unknown` | Their side can't be read from here, or hasn't been checked yet. |

A record of yours that `federation.yaml` doesn't allow, or a link `federation.yaml` wants but you haven't
published, is drift. It is shown on the page with its fix, and the fix is always a confirmed publish.

### Leaving

Withdrawing a request after it was accepted is leaving. It is your governed change first: the network entry goes
from `federation.yaml`. Then publish, so your record is withdrawn. The hub then sees the link as `left`.

### Before the live pilot

The pilot on copies against a mocked PDS passed (`docs/superpowers/plans/2026-11-22-network-n2-atproto-acceptance.md`).
Running it for real is a separate go, and it needs:

- the hub council's join policy, decided and written in the hub's `join` block;
- an atproto account for each org, named in its `kms.yaml` under `atproto`, with its app password in that server's
  environment (`ATPROTO_APP_PASSWORD`);
- the network's lexicon domain. The placeholder `example.orgosnetwork` is refused on live accounts;
- `networks` and `peers` at the top level of each `federation.yaml`. An instance that nests them under
  `federation:` is told to move them to the top level, and asking refuses until they are moved.

## The federation map

The map renders an instance's external world: ring 1 are the instances in `peers`, `upstream` and `downstream` (plus `kms.yaml` knowledge peers); ring 2 are their own peers, one hop out; ring 3 are source systems (`data/source-systems.yaml`, counts from `data/kb/index.json`) and ecosystems (`data/ecosystems.yaml`). Commands are the `org-os-kms` CLI ([`packages/org-os-kms/src/cli.mjs`](../packages/org-os-kms/src/cli.mjs)). There is no root npm script and no `org-os-kms` on your PATH unless the package is installed; run it with node, from the instance root. The instance needs `packages/org-os-kms/` (it arrives through `sync:packages` only if the package is enabled, not verified here):

```bash
node packages/org-os-kms/src/cli.mjs federate frontier --dir .          # fetch each listed instance's federation.yaml into data/federation/frontier/
node packages/org-os-kms/src/cli.mjs render map --dir .                 # write data/kb/map.json
node packages/org-os-kms/src/cli.mjs render map html --dir .            # write renders/federation-map.html and renders/federation-links.md
```

`federate frontier` (over `peers`, `upstream` and `downstream`) reads an instance's `federation.yaml` from its `local_path` checkout if present, else from `raw.githubusercontent.com/<repo>/HEAD/federation.yaml` with an 8-second timeout. A failure keeps the previous cached snapshot. This is the only code in the repository that fetches a peer's manifest over the network, and the map reads only the cache. The view is the `<federation-map>` web component in [`packages/org-os-federation-map`](../packages/org-os-federation-map/README.md), used on the public site. Design: [federation map design](superpowers/specs/2026-07-19-federation-map-design.md). The page [Federation map](FEDERATION-MAP.md) covers it in full.

The same CLI has `federate add --card <file> --dir .` (registers a knowledge peer into `kms.yaml`, not into `federation.yaml`), `federate check` (fork-compatibility of peer extension files) and `federate contribute --peer <slug> --dir .`, which only returns a draft for a human to approve and never writes to the peer. See the [kms package README](../packages/org-os-kms/README.md).

## Hatched projects (a convention)

An idea in `data/ideas.yaml` moves through `surfaced → proposed → approved → developing → hatched → archived` (the header of that file; the process is in [Idea hatching](IDEA-HATCHING.md)). When a hatched project gets its own repository, the convention is to list it in the parent's `downstream` and to give the child an `upstream` entry pointing at the parent. Nothing automates this; it is two edits to two manifests, and the map then draws the edge.

## Reference: minimal federation.yaml

This is the federation.yaml part of what `clone:framework` produces (the clone also writes `metadata.bootstrap_date` and `bootstrap_operator`, and a real `genesis_commit`; both are optional). It satisfies the federation checks of both validators; `validate:structure` also needs the rest of the instance tree:

```yaml
version: "0.7"
spec: "organizational-os/0.7"
identity:
  name: "My Organization"
  type: "Project"
network: ""
peers: []
upstream:
  - id: "org-os-template"
    url: "https://github.com/regen-coordination/org-os-template.git"
    last_sync: "2026-01-01"
downstream: []
agent:
  runtime: "claude-code"
  skills: []
packages:
  knowledge_base: true
metadata:
  framework_version: "0.7"
  genesis_commit: null
  last_sync_commit: null
```

(`genesis_commit` null is a warning only; the clone fills in the real SHA.) `IDENTITY.md` must carry matching `- **Name:**` and `- **Type:**` lines or `validate:schemas` fails.

## Not built

The earlier version of this page specified the following as a protocol. None of it is implemented; a manifest can declare it, and nothing acts on the declaration.

- **Knowledge exchange.** `knowledge-commons.publish` and `subscribe` do not cause anything to be published or pulled. There is no `federation-sync` module and no `knowledge-exchange` package. `.well-known/knowledge.json` is generated, but from `data/knowledge-manifest.yaml` (shape: `knowledge_manifest.domains` and `exchange`), not by scanning `knowledge/`; with no domains declared it is empty. Peers are read by hand (`ls ../peer/knowledge/`) or through the kms export/validate path in the [kms package README](../packages/org-os-kms/README.md).
- **koi-net sync.** `sync-protocol: koi-net` is an accepted value and nothing more. The bridge code that exists is in `packages/koi-bridge` and `packages/koi-opal-bridge`; their own READMEs say what they do. The trust tiers (`core` / `trusted` / `public`) and rate limits once listed here are not implemented in this repository.
- **Trust levels** on `peers` (see above).
- **Skill broadcast.** There is no hub-to-peer skill distribution and no network-wide skill catalogue. An instance copies a skill directory from another and lists it itself; promotion into the framework is in [Skill promotion](SKILL-PROMOTION.md).
- **Hub aggregation.** No `nodes.yaml`, no aggregator package, no system-canvas package. `data/instances.yaml` plus `analyze:instances` is the framework's own, local, equivalent.
- **Role enforcement.** "Hub", "peer", "resource library" and "hatched project" are conventions of `identity.type` and of how you fill the lists. The one exception: on a hub, a peer with `relationship: node` can be published as a member (`hasMember`).
- **`customizations` protection**, **`sync_direction`**, **on-chain registration** (see above).
