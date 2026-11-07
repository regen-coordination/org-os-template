# Federation

An org-os instance is a git repository. Federation, in this repository, means three concrete things: a manifest (`federation.yaml`) in which an instance names its peers, its upstream and its downstream; machine-readable files in `.well-known/` that other tools can fetch; and a handful of scripts that read the manifest. There is no network protocol beyond git and plain HTTPS fetches, no trust enforcement and no automatic data exchange between instances. This page says what each part does today and, section by section, what is only described and not built.

Status: the manifest, the lineage stamp, `sync:upstream`, `analyze:instances`, the schema generator and the federation map are built. Knowledge exchange between peers, skill broadcast, trust levels and koi-net sync are not (see [Not built](#not-built)).

Every instance today is run by the maintainer; the federation graph is real files but a single operator's network. The "fork and answer an interview" setup path does not work for a newcomer; cloning with `npm run clone:framework` is the supported route (see [Setup](SETUP.md)).

## federation.yaml

The manifest lives at the repository root. This repository's own is the working example. Its first lines:

```yaml
version: "0.6"
spec: "organizational-os/0.5"
identity:
  name: "org-os"
  type: "Project"
```

`version` and `spec` carry the framework's major.minor when `npm run clone:framework` writes them (both from `package.json`; the framework is `0.6.0`). On a version bump `scripts/update-version.mjs` rewrites `version` and `metadata.framework_version` but not `spec`, which is why this repository's `spec` still says `0.5`. Older text, including `schemas/federation.yaml`, still says `3.0`; that is the number from before the 2026-06-17 re-baseline and is not what the code writes. No script reads `spec`.

### What the validators require

`npm run validate:structure` also requires `.well-known/dao.json`, `members.json` and `projects.json` once `identity.daoURI` is set (not before: without it nothing is generated), parses every `.well-known/*.json`, and requires `metadata.framework_version`. Its federation check (section 6) fails an instance unless `federation.yaml` has: `identity`, `identity.name`, `identity.type`, at least one of `network` / `peers` / `upstream` / `downstream` (or a legacy `federation:` wrapper key), and an `agent` section. A missing `knowledge-commons` section is a warning only.

`npm run validate:schemas` ([`scripts/validate-identity.mjs`](../scripts/validate-identity.mjs)) checks: `identity.name` and `identity.type` equal the `Name` and `Type` lines of `IDENTITY.md`; `metadata.framework_version` is exactly major.minor (`"0.6"`, not `"0.6.0"`); `metadata.genesis_commit` is a 40-hex SHA (missing is a warning, so a first sync can seed it); `metadata.last_sync_commit` is a 40-hex SHA or null. With `identity.daoURI` set it also checks the published `.well-known/` files against their schemas and scans them for withheld values (see the [EIP-4824 guide](EIP4824-GUIDE.md)). `--strict` turns warnings into failures; a directory argument validates another instance.

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
| `onchain_registration` | `enabled`, `chain`, `contract_address` | schema generator, as a fallback: the address is listed in `contracts.json` when `data/systems.yaml` has no `daouri-registration` System. Nothing registers anything |

**Network and relations**

| Field | Meaning | Read by |
|---|---|---|
| `network` | Name of the network | validator (counts as participation); `initialize` dashboard |
| `hub` | Hub repository | map (self node URL) |
| `peers[]` | `name`, `repo`, `url`, `trust` (`full` / `read` / `none`) | `initialize` (count, table with trust); map (ring 1); frontier fetch |
| `upstream[]` | The framework this instance derives from: `id`/`repository`, `url`, `last_sync`, `sync_frequency`, `type`, `relationship` | `sync-upstream` (uses `upstream[0].url`); `initialize`; instance-doctor (compares the declared URL with the git `upstream` remote; reads `type`/`relationship`/`last_sync` as prose pedigree); map; frontier |
| `downstream[]` | Instances derived from this one: `name`, `id`, `repo`, `url`, `type`, `local_path`, `cloned`, `trust`, `sync_direction`, `note` | map; frontier. `local_path` is how the map finds a sibling checkout to read counts from. `sync_direction` is not read |

`trust` is stored and displayed. Nothing enforces it: no script pushes to a `full` peer or refuses a `none` peer. `remote_name` in an upstream entry is not read; `sync-upstream` uses a git remote literally named `upstream`.

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

The stages ([`scripts/sync-upstream.mjs`](../scripts/sync-upstream.mjs)): refuse on a dirty working tree (take a snapshot first, which holds tracked files only: protect untracked notes too, see [Vault safety](VAULT-SAFETY.md)); refuse if a `.sync-freeze` file exists; read `upstream[0].url` (add the `upstream` remote if missing, fetch it); count new commits on `upstream/main`; `git pull --rebase upstream main`; run `npm run migrate`; run `npm run sync:packages`; run `validate:structure` and `validate:schemas` (a failure stops before the stamp is updated); write `last_sync_commit` and `last_updated` into `federation.yaml` (seeding `genesis_commit` on the first sync); write `memory/sync-YYYY-MM-DD.md`.

This is a rebase onto the framework's history. It works for an instance cloned from the framework so that history is shared. It is not for an instance that shares no history with the framework; those port framework changes deliberately (the overlay path of the [instance doctor](INSTANCE-DOCTOR.md)).

## Watching your instances: `analyze:instances`

The framework repository keeps `data/instances.yaml`, a registry of every instance it knows (id, type, maturity, `local_path`, declared extra skills and packages). `npm run analyze:instances` (`--json` for JSON on stdout) walks each instance that is cloned beside it and compares what it finds with what is declared: missing `MASTERPLAN.md` or `federation.yaml`, a `framework_version` that differs from the registry, skills or packages not in `data/skills-matrix.yaml` / `data/packages-matrix.yaml`, data registries outside the canonical list. It writes `memory/reports/instances-drift-YYYY-MM-DD.md`. Drift is informational; the exit code stays 0. `npm run check:divergence` is a related advisory check that compares an instance's scripts with the framework's. Individual instances do not need `data/instances.yaml`.

## `.well-known/`

Each instance publishes files under `.well-known/` that other tools can fetch over HTTPS. `npm run generate:schemas` writes them from `federation.yaml` `identity`, the `data/*.yaml` registries and the Markdown records in `content/meetings/` and `content/projects/`, through the standards builder in `packages/admin/lib/standards/`. It writes nothing without `identity.daoURI`, and only what `data/visibility.yaml` makes public. The files: `dao.json`, `members.json`, `proposals.json`, `activities.json`, `contracts.json` and `governance.md` (EIP-4824); `grant-pools.json` and `applications.json` (DAOIP-5, when there is a public pool; `applications.json` only in the admin's live copy); `attestation-issuers.json` (DAOIP-3, when `identity.attestation_issuers` names one); and the org-os extras `meetings.json`, `projects.json`, `finances.json`, `ideas.json` and `knowledge.json`. Which file comes from which record, and how they are checked, is in the [EIP-4824 guide](EIP4824-GUIDE.md). `skills.json` is separate: `npm run generate:skills` writes it from `skills/`.

An instance does not receive `packages/admin`; `clone:framework` and the instance doctor's sync copy the builder's core into its `scripts/lib/` ([`scripts/lib/standards-vendor.mjs`](../scripts/lib/standards-vendor.mjs)), so it writes the same files. `*.json.template` files sit beside them; `clone:framework` strips the generated files from a new instance and renders its own `dao.json` from the template. A workflow, `.github/workflows/generate-schemas.yml`, regenerates and commits `.well-known/` on pushes that touch `data/`, `content/meetings/`, `content/projects/` or `federation.yaml`, and daily.

Discovery works as follows: a tool that knows an instance's `daoURI` fetches `dao.json`, which links to the other files by URL. The federation map reads `members.json` and `projects.json` from sibling checkouts (counts), not from the network; the public site's build (`site/scripts/aggregate-federation.mjs`) copies this repository's `.well-known/` into the site and reads sibling instances' the same way.

## The federation map

The map renders an instance's external world: ring 1 are the instances in `peers`, `upstream` and `downstream` (plus `kms.yaml` knowledge peers); ring 2 are their own peers, one hop out; ring 3 are source systems (`data/source-systems.yaml`, counts from `data/kb/index.json`) and ecosystems (`data/ecosystems.yaml`). Commands are the `org-os-kms` CLI ([`packages/org-os-kms/src/cli.mjs`](../packages/org-os-kms/src/cli.mjs)). There is no root npm script and no `org-os-kms` on your PATH unless the package is installed; run it with node, from the instance root. The instance needs `packages/org-os-kms/` (it arrives through `sync:packages` only if the package is enabled, not verified here):

```bash
node packages/org-os-kms/src/cli.mjs federate frontier --dir .          # fetch each listed instance's federation.yaml into data/federation/frontier/
node packages/org-os-kms/src/cli.mjs render map --dir .                 # write data/kb/map.json
node packages/org-os-kms/src/cli.mjs render map html --dir .            # write renders/federation-map.html and the portal index
```

`federate frontier` (over `peers`, `upstream` and `downstream`) reads an instance's `federation.yaml` from its `local_path` checkout if present, else from `raw.githubusercontent.com/<repo>/HEAD/federation.yaml` with an 8-second timeout. A failure keeps the previous cached snapshot. This is the only code in the repository that fetches a peer's manifest over the network, and the map reads only the cache. The view is the `<federation-map>` web component in [`packages/org-os-federation-map`](../packages/org-os-federation-map/README.md), used on the public site. Design: [federation map design](superpowers/specs/2026-07-19-federation-map-design.md). The page [Federation map](FEDERATION-MAP.md) covers it in full.

The same CLI has `federate add --card <file> --dir .` (registers a knowledge peer into `kms.yaml`, not into `federation.yaml`), `federate check` (fork-compatibility of peer extension files) and `federate contribute --peer <slug> --dir .`, which only returns a draft for a human to approve and never writes to the peer. See the [kms package README](../packages/org-os-kms/README.md).

## Hatched projects (a convention)

An idea in `data/ideas.yaml` moves through `surfaced → proposed → approved → developing → hatched → archived` (the header of that file; the process is in [Idea hatching](IDEA-HATCHING.md)). When a hatched project gets its own repository, the convention is to list it in the parent's `downstream` and to give the child an `upstream` entry pointing at the parent. Nothing automates this; it is two edits to two manifests, and the map then draws the edge.

## Reference: minimal federation.yaml

This is the federation.yaml part of what `clone:framework` produces (the clone also writes `metadata.bootstrap_date` and `bootstrap_operator`, and a real `genesis_commit`; both are optional). It satisfies the federation checks of both validators; `validate:structure` also needs the rest of the instance tree:

```yaml
version: "0.6"
spec: "organizational-os/0.6"
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
  framework_version: "0.6"
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
- **Role enforcement.** "Hub", "peer", "resource library" and "hatched project" are conventions of `identity.type` and of how you fill the lists. No code treats them differently.
- **`customizations` protection**, **`sync_direction`**, **on-chain registration** (see above).
