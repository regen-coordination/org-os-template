# The knowledge management system

`org-os-kms` is the part of org-os that turns an instance into a **knowledge commons**: a store of typed, reviewed, source-linked knowledge objects that lives in git next to the rest of the instance, can be pulled from and published to other instances, and can be shown on a site. It binds the `toolkit-framework` package (schemas, storage adapters, the review state model, the publication floor) into org-os's registries and session lifecycle. It does not replace the instance's own `data/*.yaml`; it adds a second store beside them.

**Status:** `in-dev` (the vocabulary of [MODULES](MODULES.md)). The package and its tests run (431, one skipped, all green on this branch); it is used by the maintainer's own instances and by no one else yet, so the operator experience beyond that is untested. Every command on this page was run against a scratch instance on this branch.

The commands are a CLI, `packages/org-os-kms/src/cli.mjs`. It has no `--help`: an unknown verb (including `--help`) prints `{"error": "unknown verb: …"}` and exits 1. The verbs are `lifecycle`, `bridge`, `render`, `federate`, `promote`, `init`, `publish`, `ingest`, `export` and `validate`; each is described below. All take `--dir <instance>` (default `.`). Output is JSON on stdout.

```bash
node packages/org-os-kms/src/cli.mjs <verb> [subcommand] [--flag value]
```

(`package.json` names the binary `org-os-kms`; inside an instance the packages are vendored, not installed, so the path above is the way to run it.)

## What it adds to an instance

- **Packages.** `packages/toolkit-framework` and `packages/org-os-kms`, vendored **side by side and unedited**. `org-os-kms` imports the framework through relative sibling paths (`src/framework.mjs`), so `node_modules/@org-os/kms` does not work. The one runtime dependency is `js-yaml`.
- **`kms.yaml`** at the instance root: the configuration (below). An instance without it is not a knowledge system; `org-os-kms` refuses it (`not an initialized instance (no kms.yaml)`).
- **A store**, by default `data/kb/` (below).
- **Optional extension packs**, sibling packages that add typed schemas (for example `org-os-territory`), switched on from `kms.yaml`. Extension packs have their own pages: [KMS-EXTENSION-PACKS](KMS-EXTENSION-PACKS.md) and, for the first pack, [TERRITORY-PACK](TERRITORY-PACK.md).
- **Optional public plane**, a second instance in its own repository that holds only what passed the publication gate. See [KMS-PLANES](KMS-PLANES.md).

How an instance gets these:

1. **At clone time.** Add a `kms:` block to the clone config (with `toolkit-framework` and `org-os-kms` enabled under `packages:`); `npm run clone:framework` then runs `org-os-kms init` for you. The block, including `public_plane:`, is documented in [SETUP-PATHS](SETUP-PATHS.md). A `kms:` block whose packages are not enabled is refused before anything is written.
2. **In an existing instance.** Vendor the two packages, then `node packages/org-os-kms/src/cli.mjs init --name <instance>`. `init` takes `--name`, `--adapter` (default `repo-data`), `--target` (default `.`) and `--dir`. It creates the store directory and `.workorders/`, writes `kms.yaml`, and stores the instance's own **self card**: a `source-system` object titled with the instance name, marked `maturity: raw`, `public_use` unset, with a placeholder `return_path`. Re-running `init` never renames an instance and repairs a missing or stale `self_ref` rather than duplicating the card.

## `kms.yaml`

`init` writes this much:

```yaml
instance: my-commons
adapter: repo-data
target: .
self_ref: data/kb/source-system.yaml#my-commons
peers: {}
framework: '@regen-commons/toolkit-framework'
```

`framework` is informational; no code reads it. `instance`, `adapter` and `target` are required (`target: ""` or `.` is valid; only an absent key is an error). Everything else is optional and read by the code as follows. Keys not in this table are not read by `org-os-kms`.

| Key | What it does |
|---|---|
| `adapter`, `target` | Which storage adapter holds the objects, and where (relative to the instance). Adapters: `repo-data`, `kb-folder`; `geo` is a documented stub that throws if used. |
| `self_ref`, `peers` | Adapter-issued references to the self card and to each registered peer's card. Written by `init` and `federate add`; do not edit by hand. |
| `peer_extensions` | `{ <peer slug>: <path> }`: a peer's published `extensions.yaml`, used by `federate check`. |
| `extensions` | List of extension pack names (sibling packages under `packages/`). Loaded before any command runs. |
| `connectors` | List of `{ name, config, cursor? }` for `ingest`. See [CONNECTORS](../packages/org-os-kms/docs/CONNECTORS.md). |
| `atproto` | `did`, `handle`, `pds`, `nsid_authority`, and the opt-in `standard_site` block. Needed to publish to, or pull from, an AT Protocol server. |
| `publish` | `apply`, `gate`, `static`, `static_dir`, `base_url`, `types_opt_in`, `types_opt_out`, `disclose_subscriptions`, and (public plane) `public_fields`, `nested_fields`. See [KMS-PLANES](KMS-PLANES.md) and [CONNECTORS](../packages/org-os-kms/docs/CONNECTORS.md). |
| `planes` | `public: { instance, dir? }` makes this instance a canon; `role: public` makes it a public plane; `canon_dir`, `regate`. See [KMS-PLANES](KMS-PLANES.md). |
| `geo.space` | When set, objects also get a `grc20Id` at first publish. |
| `render.site_data` | Where `render site` and the lifecycle write the index for a site (default `src/data/kms-index.json`). |
| `store.on_collision` | `merge` or `suffix` (default): read by the framework's own CLI (`toolkit-framework store`), not by `org-os-kms`. |

`federation_namespace`, which the clone can copy into `kms.yaml`, is not read by any code in `org-os-kms`; the federation namespace it reports is the constant `RegenOS`.

## The store and its entries

With the default `repo-data` adapter the store is `<target>/data/kb/<schema>.yaml`: one file per object type, each a mapping `entries:` keyed by **slug**. A reference to an entry is `<file>#<slug>` (for example `data/kb/resource.yaml#my-note`). The adapter also writes two derived files next to the objects: `data/kb/index.json` (counts by type and maturity, the review queue) and `data/kb/context.jsonld`. Both are rebuilt, never edited. The `kb-folder` adapter instead writes `objects/<schema>/*.yaml`; the rest of this page assumes `repo-data`.

An entry is a plain YAML mapping. The framework defines the types (`resource`, `encyclopedia-entry`, `claim-evidence`, `option-entry`, `organization`, `relationship-record`, `signal`, `track`, `implementation-record`, `concept-lineage`, `source-system`, `public-use-boundary` and others; `node packages/toolkit-framework/src/cli.mjs list-schemas` lists them) and each entry carries these state fields, on three independent axes:

- `maturity`: `raw`, `held`, `draft`, `candidate`, `source-linked`, `reviewed`, `field-informed`, `pattern-generating`, `deprecated`, `archived`.
- `public_use`: `internal-only`, `raw-lead`, `ok-with-caveat`, `source-linked-unreviewed`, `reviewed-for-explanation`, `reviewed-for-guidance`, `requires-community-consent`, `requires-domain-review`, `not-public-yet`, `deprecated`.
- `lifecycle_state`: `raw-lead` through `mature` and `compost`.

Plus `ai_assisted`, `source_lineage`, a `provenance` block, `id` (minted at first publication), `reviewed_by` and `last_reviewed`. Two rules are enforced by code (`invariants.mjs`): an `ai_assisted: true` object cannot claim `maturity: reviewed`, and a `raw` object cannot have a `reviewed-for-*` `public_use`.

## The life of an entry

1. **Capture.** An object enters as `raw`, `ai_assisted: true`, `public_use: not-public-yet`: from the framework's `ingest` work orders (`toolkit-framework ingest prepare <path>` then the agent skills `capture-and-route`, `register-source`), by hand, or from `org-os-kms ingest`, which forces those values on everything it pulls whatever the origin claimed.
2. **Review.** The framework has its own CLI, `node packages/toolkit-framework/src/cli.mjs` (below, `toolkit-framework`). `toolkit-framework review list` shows what awaits a human (`raw`, `held`, or `ai_assisted`). `toolkit-framework review promote <ref> --maturity reviewed --reviewer <name>` is the only path the framework provides to a higher maturity: `--reviewer` is mandatory beyond `raw`; it sets `ai_assisted: false`, `reviewed_by` and `last_reviewed`, and refuses a promotion that would break an invariant before writing anything. Setting `public_use` is an editorial edit to the YAML.
3. **Eligibility.** An entry becomes publishable when its type is publishable, its `public_use` is one of the four publishable values and its `maturity` is not `held`. For the two-plane flow, the stricter canon gate applies on top of that, including `maturity: reviewed`. See [KMS-PLANES](KMS-PLANES.md).
4. **Publication.** Plain `publish` applies only the framework floor (the floor in item 3) plus an optional `publish.gate` module: it does **not** apply the canon gate, so a `draft` with a publishable `public_use` is published. Use the two-plane flow when that matters. `publish` mints an `id` (a UUID, written into the source YAML so git keeps it), then writes to an AT Protocol server and/or a static surface. `export` projects the entry into a public plane.
5. **Retraction.** An origin that drops a record sets the local copy to `maturity: held` with `review_needs: retracted at origin …`; nothing is deleted. `held` also unpublishes: the next `publish` removes it from the server and the static surface.

## The commands

| Command | What it does |
|---|---|
| `init [--name N] [--adapter A] [--target T]` | Create the store and `kms.yaml` and the self card. |
| `lifecycle initialize` | Runs `config.load`, `index.rebuild`, `review.list`, `render.dashboard`, `render.site`. Writes `data/kb/index.json`, `data/kb/context.jsonld` and `src/data/kms-index.json`. Works. |
| `lifecycle close` | Declared as `csis-review` (agent skill), `bridge`, `emit-contributions` (agent skill), `federate.check`, `index.rebuild`, `render.site`, `render.dashboard`, `publish`, `sync.push`. **Run from the CLI it stops at `bridge`** (see below); run the pieces as separate verbs. |
| `bridge` | Upserts store objects into the org-os registries named in `src/bind.mjs` (for example `resource` into `data/resources.yaml`, `signal` into `data/signals.yaml`; `encyclopedia-entry` becomes markdown under `src/content/docs/kb/`). Upsert by `id` or title slug; never deletes rows. |
| `render` | With no argument prints the ASCII dashboard section. `render site` writes the index JSON for a site. `render map`, `render map html` and `federate frontier` belong to the federation map ([FEDERATION-MAP](FEDERATION-MAP.md)). |
| `federate add --card <file>` | Validate a peer's `source-system` card and store it as a peer; records it in `kms.yaml`. A peer card that slugs to the instance's own name is refused. |
| `federate check` | For each peer, checks fork-compatibility against its `peer_extensions` file, or reports it skipped. |
| `federate contribute --peer <slug>` | Draft only: returns the plan with the peer's `return_path`; applies nothing. |
| `ingest [--connector N] [--dry]` | Pull from the declared connectors. Not part of any lifecycle event. |
| `publish [--dry] [--apply]` | Plan or write the publication. Plan mode is not read-only; `--dry` is. Refused in a canon. In an instance with no plane role it applies only the framework floor (see "The life of an entry", item 4, and the warning in [KMS-PLANES](KMS-PLANES.md)). |
| `export` | Canon only: project what passes the gate into the public plane. |
| `validate` | Canon only: re-gate the public plane against the live canon. Exit 1 on any error. |
| `promote --from <dir> --to <dir>` | Not an entry promotion: compares a package directory with its canonical copy by checksum and lists `new`/`changed` files. It never copies (`applied` is always `false`). |

`ingest`, `publish`, the connectors, the standard.site documents and the exit-code rules are in [CONNECTORS](../packages/org-os-kms/docs/CONNECTORS.md).

**Exit codes.** `{error}` results (unknown verb, bad `federate` subcommand) exit 1. `publish`, `ingest` and `validate` also exit 1 on `ok: false`. Other verbs keep fail-soft results and exit 0.

A sequence that actually works in an existing instance (each step run against a scratch instance):

```bash
node packages/org-os-kms/src/cli.mjs init --name my-commons
node packages/org-os-kms/src/cli.mjs lifecycle initialize     # index + dashboard + site data
node packages/org-os-kms/src/cli.mjs ingest --dry             # only if connectors are declared
node packages/org-os-kms/src/cli.mjs bridge
node packages/org-os-kms/src/cli.mjs publish --dry            # read-only preview
# add `publish: { base_url: https://example.org }` to kms.yaml (or `publish: { static: false }`)
node packages/org-os-kms/src/cli.mjs publish                  # plan mode: mints ids, writes the static surface
git add -A && git commit                                       # ids, indexes, registries and public/ are all generated files
```

`publish` in plan mode (no `--apply`) still mints ids into your YAML and, unless `publish.static: false`, regenerates the static surface (`public/` by default; it requires `publish.base_url`). Commit the result before anything that pushes.

## Where its state lives

| Path | What | Written by |
|---|---|---|
| `kms.yaml` | Configuration, self and peer references | `init`, `federate add`; by hand |
| `data/kb/<schema>.yaml` | The objects | adapters, `ingest`, `publish` (ids), by hand |
| `data/kb/index.json`, `data/kb/context.jsonld` | Derived index and JSON-LD context | `lifecycle initialize` (`index.rebuild`) |
| `data/kms-published.json` | Manifest: which `id` is on the AT Protocol server at which `at://` address, with hashes. Includes the standard.site section | `publish --apply` |
| `data/kms-cursors.json` | Ingest cursors, one per connector (`kms.yaml` is never rewritten) | `ingest` |
| `public/` (or `publish.static_dir`) | Static JSON surface: `api/**`, `.well-known/knowledge.json` | `publish` (the whole `api/` subtree is wiped and rewritten) |
| `src/data/kms-index.json` (or `render.site_data`) | Index copy for a site | `render site`, `lifecycle initialize` |
| `data/resources.yaml` and other registries | Rows bridged from the store | `bridge` |
| `.workorders/` | Framework ingest work orders | `toolkit-framework ingest` |

## What is not built, and a broken path

- `lifecycle close` through the CLI: `bridge` reads `ctx.config`, which only the `config.load` step of `initialize` sets, and the CLI builds a fresh context per call. The result is `errors: ["bridge: Cannot read properties of undefined (reading 'adapter')"]` before any step runs. Use the individual verbs. Nothing wires `lifecycle close` into the agent `/close` command either.
- The `geo` storage adapter is a stub. Resolving each AT Protocol peer's own server (a DID document lookup) or reading from a relay is not implemented; all peers must be reachable on the one `atproto.pds`.
- The walk-up setup path (fork the repository, `npm run setup`) does not work for a newcomer; a clean-room test on 2026-08-21 found seven blockers. The supported route is the clone described in [SETUP-PATHS](SETUP-PATHS.md).

Next: [KMS-PLANES](KMS-PLANES.md) for the canon, the public plane and the publication gate; [CONNECTORS](../packages/org-os-kms/docs/CONNECTORS.md) for pulling and publishing; the package [README](../packages/org-os-kms/README.md). Publishing to standard.site and AT Protocol is in [KMS-PUBLISHING](KMS-PUBLISHING.md); the federation map is in [FEDERATION-MAP](FEDERATION-MAP.md).
