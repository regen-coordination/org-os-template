# Extension packs for the knowledge system

An extension pack is a sibling package of `org-os-kms` that adds new typed knowledge objects to an instance — schemas, entity types, optionally a connector and a registry file — without editing the toolkit framework. An instance opts in with one line in `kms.yaml`. Without that line nothing changes.

**Status:** pilot. The mechanism is built and tested (`packages/org-os-kms/src/extensions.mjs`). One pack exists, [`org-os-territory`](TERRITORY-PACK.md), and no instance runs it yet. `data/packages-matrix.yaml` lists it as `evaluating` and `dormant` with an empty `instances_using`.

Read first: the knowledge system overview (`docs/KMS.md`) and the two planes and the publication gate (`docs/KMS-PLANES.md`). This page only covers the pack mechanism.

## What a pack is

A directory under `packages/`, next to `org-os-kms` and `toolkit-framework`:

```
packages/<pack>/
  pack.yaml                 # required: name (= directory name), version, requires, types
  schemas/*.yaml            # object schemas, each `extends: frontmatter`
  extension-entities.yaml   # { entities: { <type>: { maps_to_core, description } } }
  profile/profile.yaml      # optional: registry_bindings: { <schema>: data/<file>.yaml }
  connectors/index.mjs      # optional: export const CONNECTORS = { <name>: <connector> }
```

`pack.yaml` is the only file the loader insists on. A minimal one, from `org-os-territory`:

```yaml
name: org-os-territory          # must equal the directory name
version: 0.1.0
requires:
  framework: ">=0.3.0"
  kms: ">=0.1.0"
types: [territorial-unit, data-stream]   # publish-eligible types; each needs a schema in schemas/
```

- **`requires`** accepts only the keys `framework` and `kms`, and only ranges of the form `">=x.y.z"`. The loader compares them with the `version` in `packages/toolkit-framework/package.json` and `packages/org-os-kms/package.json`. Any other range (`^1.0.0`) or key is a load error.
- **`types`** are the schema names the pack makes eligible for publication. Eligible is not published; see below.
- **`extension-entities.yaml`** declares the pack's Layer-B entities. Each must carry `maps_to_core`, naming a real Layer-A core type, so a peer that does not know the entity can still read it as that core type. A pack whose entity maps to something else will not load.
- **`schemas/`** holds one YAML file per object type. The file name is the schema name, and the object's `type`. Field enums are enforced by `validateObject`; unknown fields on an object are allowed (the model is open).
- **`profile/profile.yaml`** is read only for `registry_bindings`: where `org-os-kms bridge` writes objects of the pack's schemas.
- **`connectors/index.mjs`** is code that gets executed (see Trust, below).

## Turning a pack on

Three things have to be true: the pack is on disk, `kms.yaml` names it, and, if you want its objects published, `kms.yaml` opts its types in.

```yaml
# kms.yaml
extensions: [org-os-territory]
publish:
  base_url: https://example.org      # required: the static surface fails without it
  types_opt_in: [territorial-unit]
```

**On disk.** `loadExtensions` looks for `<pack>` as a sibling of `org-os-kms` (the parent directory of the `org-os-kms` package). Names must match `^[a-z0-9][a-z0-9-]*$`; a path such as `../evil` is refused. For a new instance cloned with `npm run clone:framework`, vendor the pack like any other package and name it in the clone config:

```yaml
# in the config file passed to: npm run clone:framework -- --target <dir> --config <file>
packages:
  toolkit-framework: true
  org-os-kms: true
  org-os-territory: true
kms:
  extensions: [org-os-territory]
```

`scripts/clone-framework.mjs` refuses the config before writing anything if `kms.extensions` names a pack not enabled under `packages`, or if the `kms:` block lacks `toolkit-framework` or `org-os-kms`. It then writes `extensions` into the new `kms.yaml`, and into the public plane's `kms.yaml` when the config asks for one. For an instance that already exists, copy the pack directory next to `org-os-kms` and add the line by hand.

Walkup setup (fork the repository, run `npm run setup`, answer an interview) is not a working path for a newcomer: a clean-room test on 2026-08-21 found it broken in seven blocker-level ways. Clone is the supported route.

**Loading.** Any command that reads `kms.yaml` through `loadKmsConfig` loads the packs first (`bridge`, `publish`, `ingest`, `lifecycle`, `federate check`, `render site`; `render map` deliberately does not read `kms.yaml`), as does `export`/`validate` via `loadCommonsPolicy`. A declared pack that is missing, has no `pack.yaml`, has the wrong `name`, fails `requires`, or collides with something already registered stops the command with an error that names the pack. No op runs against a half-loaded instance. `packs-e2e.test.mjs` asserts this: a missing pack makes `publish` throw before anything is written.

## What a pack changes

Registered with the framework at load time:

| Thing | Effect |
|---|---|
| Schemas | `schemas/*.yaml` join the list from `listSchemas()`, so objects of those types validate. |
| Entities | `extension-entities.yaml` entries join the framework's Layer-B set (`extensionEntities()`). |
| Opt-in types | `pack.yaml` `types` join the framework's opt-in set, next to core's `source-system` and `public-use-boundary`. |
| Registry bindings | `profile.yaml` `registry_bindings` tell `bridge` which `data/*.yaml` file a schema populates. A schema with no binding goes to `data/misc.yaml`. |
| Connectors | names from `connectors/index.mjs` join the registry used by `ingest`. |
| Lexicons | `generateAll` writes an AT Protocol lexicon for every type, pack types included, under the instance's own `atproto.nsid_authority` (a unit becomes `<authority>.territorialUnit`). |

In what the instance publishes (only for types listed in `publish.types_opt_in`, and only for objects that pass the same floor and field projection as core types — private fields such as `notes` are stripped):

- `public/api/context.jsonld` gains a term per pack entity (`territorial-unit` resolves to `https://regen-commons.org/ns/territorial-unit`), listing only this instance's packs.
- `public/api/<type>.json` and `public/api/<type>/<id>.json` exist for each opted-in type.
- `.well-known/knowledge.json` lists the pack type's NSID in `exchange.published_domains` when the instance has an `nsid_authority`.
- `public/.well-known/extensions.yaml` is generated, and only for an instance that declares at least one pack. It is the instance's whole Layer-B set — the framework's own extension entities plus the pack's — as type names, `maps_to_core` and a description, with no instance data. A peer runs `federateCheck` over it to learn whether the entities map to real core types. On the peer side, `kms.yaml` `peer_extensions: { <peer-slug>: <path> }` points `federate check` at a saved copy; with no entry the peer is skipped.
- With AT Protocol publishing configured, the records go to the PDS as `<authority>.<camelCaseType>` collections, and the `atproto` connector lists those collections when pulling from peers that run the same pack.

Running `bridge` and then `publish` in a scratch instance with no PDS configured produced `data/territorial-units.yaml`, `public/api/territorial-unit.json`, the context term and `extensions.yaml`.

**Running the commands.** `org-os-kms` is a `bin` entry of the package, not an npm script of this repository. From a checkout run `node packages/org-os-kms/src/cli.mjs <verb> --dir <instance>`. Plain `publish` is not a preview: the static surface is on by default, so it writes `public/` and mints UUID `id`s into the tracked `data/kb/*.yaml` files, even with no PDS configured. `publish --dry` writes and mints nothing; `--apply` adds the PDS write; `publish.static: false` with no `atproto` block turns both off. Commit the generated files before pushing.

## What a pack cannot do

Installing a pack never widens what an instance publishes. The types become eligible; the operator's `types_opt_in` is the only thing that makes them publish, and objects still have to clear the publication gate and the `public_use` floor. `packs-e2e.test.mjs` covers three cases: a pack not opted in publishes nothing of its own, an opted-in unit publishes without its `notes`, and a `not-public-yet` data stream stays out.

Core wins everywhere. Each of these is a load error naming the pack, never a shadow:

- a schema named like a core schema, or like an earlier pack's;
- an entity named like a core or Layer-B entity, or like an earlier pack's;
- a registry binding for a core schema, or for a schema another pack already bound;
- a `types` entry with no schema in the pack's own `schemas/`.

A connector name that collides is caught later, when `ingest` runs, not at load: `pack connector "x" collides with core` (a core name such as `atproto` or `static-json`) or `collides with pack <other>`.

A pack has no way to change core schemas, the review axes, relationships or invariants, to touch the private-field list, or to depend on another pack. `requires` can only name the framework and kms.

## Trust

`pack.yaml`, `extension-entities.yaml`, `profile.yaml` and the schemas are read as data. `connectors/index.mjs` is not: `ingest` dynamically imports it for every declared pack, whether or not one of its connectors is configured. A pack is code you run. Vendor it from a source you trust, pinned to a tag, unedited, with the care you give `org-os-kms` itself. For the same reason the public-plane export loads a pack named in a plane's own `kms.yaml` only after it has confirmed that directory really is the commons the canon names.

## Writing a pack

1. Create `packages/<name>/` and a `pack.yaml` with `name` equal to the directory, a `version`, `requires` and `types`.
2. Add `schemas/<type>.yaml` for each type: `id`, `version`, `extends: frontmatter`, `required`, and `fields`. Keep fields flat (string, boolean, integer, array of strings, or an `enum`) because the lexicon generator needs flat fields. See `packages/org-os-territory/schemas/territorial-unit.yaml`.
3. Add `extension-entities.yaml` mapping each type to a core type. Quote any description that contains commas or colons: the framework's own file is written as inline `{ ... }` mappings, and an unquoted comma splits the description into stray keys (`packages/org-os-territory/test/entities.test.mjs` guards its own file against this).
4. Optional: `profile/profile.yaml` with `registry_bindings`, and `connectors/index.mjs`.
5. Test it with `makePack` from `packages/org-os-kms/test/extensions.test.mjs`, which builds a pack in a temporary directory and loads it. Run it against the real instance flow with the `bridge` and `publish` verbs in a scratch directory before enabling it anywhere.

```bash
cd packages/org-os-kms
node --test test/extensions.test.mjs test/packs-e2e.test.mjs   # 22 tests
```

## Not built

- Downgrade on ingest. A peer without the pack does not request the pack's collections, but nothing converts an unknown type to its `maps_to_core` when one arrives.
- Version ranges beyond `>=x.y.z`, and dependencies between packs.
- Pack state is process-global. The CLI runs one instance per process; a host that walks several instances in one process must call `resetPacks()` and `resetRegistryBindings()` between them.

## Files

- Reads: `kms.yaml` (`extensions`, `publish.types_opt_in`, `peer_extensions`), `packages/<pack>/pack.yaml`, `schemas/`, `extension-entities.yaml`, `profile/profile.yaml`, `connectors/index.mjs`.
- Writes (through the ordinary ops): `data/<registry>.yaml` per the pack's bindings (`bridge`), `public/api/…` and `public/.well-known/extensions.yaml` (`publish`).
- Code: `packages/org-os-kms/src/extensions.mjs`, `bind.mjs`, `src/static/surface.mjs`; `packages/toolkit-framework/src/index.mjs` (`registerPack`, `toJsonLdContext`) and `publishable.mjs`.
- Reference: [org-os-kms README](../packages/org-os-kms/README.md), [connector and publishing reference](../packages/org-os-kms/docs/CONNECTORS.md) (section 13), [packages](PACKAGES.md), [federation](FEDERATION.md).

Next: [the territory pack](TERRITORY-PACK.md), a worked example. Publishing in detail is in `docs/KMS-PUBLISHING.md`.
