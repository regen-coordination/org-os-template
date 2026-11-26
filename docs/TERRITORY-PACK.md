# The territory pack

`org-os-territory` is the one [extension pack](KMS-EXTENSION-PACKS.md) that exists today. It gives a knowledge instance a sense of place: bounded units of territory on named layers (a municipality, a landscape unit, a bioregion, a river basin), the datasets that describe them, and a way to say that any other object belongs to a place.

**Status:** pilot, not adopted. The package has 71 tests, but `data/packages-matrix.yaml` records it as `evaluating` / `dormant` with no instance using it. The sample data in the demo and explorer is illustrative. There is no real geometry, no real overlap computation and no data for any actual territory in the package.

Read the pack mechanism first: how a pack is declared, loaded and kept from widening what you publish is on [the extension packs page](KMS-EXTENSION-PACKS.md). This page is the worked example.

## What it adds

Two entity types, one convention, one generated sidecar.

| Name | Kind | Maps to core | What it is |
|---|---|---|---|
| `territorial-unit` | entity type, schema | `place` | A bounded unit on one layer. |
| `data-stream` | entity type, schema | `artifact` | One dataset, endpoint or feed that a source system offers. |
| `unit_refs` | convention | — | Any object may carry `unit_refs: [<unit_id>, …]` to say which units it concerns. |
| `data/territory-overlaps.json` | sidecar contract | — | Cross-layer overlap shares, derived data. |

Both types are publish-eligible (`types: [territorial-unit, data-stream]`) and neither publishes unless the instance lists it in `publish.types_opt_in`. The pack requires `toolkit-framework >= 0.3.0` and `org-os-kms >= 0.1.0` (currently `0.3.0` and `0.1.0`).

### `territorial-unit`

Required: `title`, `unit_id`, `layer`, `level`.

| Field | Meaning |
|---|---|
| `unit_id` | Stable slug `<layer>:<level>:<name>`, for example `landscape:unit:plana-de-vic`. Unique in the instance. It is what every reference uses; it is not the UUID `id` minted when the object is published. |
| `layer` | One of `administrative`, `landscape`, `ecological`, `hydrological`, `custom`. |
| `level` | A free string inside the layer (`municipi`, `comarca`, `catalogue-area`, `basin`). Levels are local vocabulary: Catalunya's `municipi`, `comarca`, `vegueria` are not Brazil's. |
| `part_of` | `unit_id` of the parent, on the same layer. The framework's own `part_of` predicate. |
| `overlaps_with` | `unit_id`s on other layers. The framework's `overlaps_with` predicate, without shares. |
| `codes` | Strings `"<scheme>:<value>"` such as `idescat:08` or `one_earth:PA20`, flat because AT Protocol lexicon fields are flat. |
| `geometry_ref` | Repo-relative path to a GeoJSON file. Never inline (records cap at 1 MB), and nothing in the pack reads it. |
| `area_km2` | Integer. |
| `defined_by` | Slug of the `data-stream` authoritative for this unit's boundary. |
| `node_did`, `node_repo` | Reserved for a unit that later hatches into an instance of its own. Empty today; nothing reads them. |

### `data-stream`

Required: `title`, `source_system`, `access`. The `source-system` card is the provider treated as a peer (steward, reuse conditions, return path); the stream is one thing the provider offers, catalogued so that "what data exist for this unit and this kind of work" can be answered before anything is ingested.

| Field | Meaning |
|---|---|
| `source_system` | Slug of the provider's source-system card. |
| `access` | One of `open-api`, `graphql`, `wfs`, `wms`, `download`, `scrape`, `manual`. |
| `trust` | One of `official`, `verified-community`, `unverified`. |
| `licence` | Short SPDX-style form (`CC-BY-4.0`). Prose conditions stay on the source-system card. |
| `url`, `format`, `cadence` | The endpoint, its format (`geojson`, `shp`, `csv`), and how often it changes. |
| `unit_refs`, `layer_refs` | The units and layers it covers or informs. |
| `relevant_for` | Open vocabulary; the schema comment seeds `watershed`, `food-systems`, `restoration`, `energy`, `housing`, `participation`, `funding`, `governance`. |
| `connector` | Name of the connector that ingests it, or empty. The pack ships no connector. |

### Layers and nesting

`part_of` never crosses a layer, and `overlaps_with` always does. The two are checked in code: `indexUnits` throws on a `part_of` that names a missing unit, crosses layers or forms a cycle. A landscape unit is therefore not "inside" a comarca; it overlaps one, and the share of the overlap is derived data. Shares live in the sidecar `data/territory-overlaps.json`:

```json
{ "version": 1, "method": "how the shares were computed",
  "overlaps": [ { "a": "landscape:unit:plana-de-vic", "b": "administrative:comarca:osona",
                  "share_a": 0.93, "share_b": 0.42 } ] }
```

`validateOverlaps(doc, index)` is its contract and reports every problem rather than the first: wrong `version`, missing `method`, unknown `unit_id`, a pair on the same layer, a duplicate pair, a share outside `(0, 1]`. The sidecar is never a knowledge object and is never published.

## How an operator uses it

Turn it on as described on the extension packs page: vendor `packages/org-os-territory` next to `org-os-kms`, pinned to a tag and unedited, add `extensions: [org-os-territory]` to `kms.yaml`, and add `publish.types_opt_in: [territorial-unit]` if you want units published. The static surface also needs `publish.base_url: https://…`; without it `publish` fails. In a clone config, enable `packages.org-os-territory` and put `extensions: [org-os-territory]` under `kms:`.

Then write units as ordinary knowledge objects in the store. With the default `repo-data` adapter that is `data/kb/territorial-unit.yaml`:

```yaml
entries:
  plana-de-vic:
    title: Plana de Vic
    type: territorial-unit
    unit_id: landscape:unit:plana-de-vic
    layer: landscape
    level: unit
    public_use: ok-with-caveat
```

and the same for `data-stream`. The commands are the ordinary knowledge-system ones; the pack adds no CLI verb:

```bash
node packages/org-os-kms/src/cli.mjs bridge --dir <instance>    # unit and stream objects → data/territorial-units.yaml, data/data-streams.yaml
node packages/org-os-kms/src/cli.mjs publish --dir <instance>   # writes public/ and mints ids into data/kb/; --dry previews; --apply adds the PDS write
```

`org-os-kms` is a `bin` entry of the package, not an npm script, so from a checkout the CLI is `node packages/org-os-kms/src/cli.mjs`. Plain `publish` is not a preview: the static surface is on by default, so it writes `public/` and mints UUID `id`s into the tracked `data/kb/*.yaml` files even with no PDS configured; `publish.static: false` with no `atproto` block turns both off. In a scratch instance, `bridge` wrote `data/territorial-units.yaml` (key `territorial_units`); `publish` with no PDS configured wrote the static surface — `public/api/territorial-unit.json`, `public/api/context.jsonld` (with `territorial-unit` and `data-stream` terms) and `public/.well-known/extensions.yaml` — and minted a UUID `id` into the object in `data/kb/territorial-unit.yaml`. Commit those generated files before pushing; the minted ids change tracked store files.

## Querying by place

The query code is a library, not a command. `src/units.mjs` is pure (no I/O, no geometry) and exports three functions; only the demo, the explorer and the tests call them. No kms command, CLI verb or instance code does.

```js
import { indexUnits, unitsFor, objectsIn } from './src/units.mjs';

const index = indexUnits(units);                          // throws on duplicate or missing unit_id and on a bad part_of
objectsIn('administrative:comarca:osona', objects, index); // everything in Osona and beneath it
unitsFor(project, index);                                  // { units: [refs and ancestors], unknown: [...] }
```

`objectsIn` includes descendants by default; pass `{ includeDescendants: false }` for only what is placed directly on the unit. A `territorial-unit` counts as being in itself. `objectsIn` throws `unknown unit_id` if the unit you ask about is not in the index. An unknown `unit_ref` on an object is returned in `unknown`, never thrown: whether a dangling reference is an error is the instance's lint to decide.

## The demo and the explorer

Both build a single self-contained HTML file from the real code, with the Catalunya sample in `demo/sample.mjs`. Every result on the page was captured by running the code at build time; the browser only switches between recorded answers. The sample names are examples, the codes are placeholders (only `one_earth:PA20` is a real code), the overlap shares are invented, and the board is a schematic, not a map.

```bash
cd packages/org-os-territory
npm run demo        # engineering verification report → demo/dist/index.html
npm run explorer    # place-centred page for non-engineers → explorer/dist/index.html
```

- **Demo** — seven sections: what changed in the framework and what did not, loading a pack, the guarantees (a pack never widens what is published; one instance never sees another's pack), ways to load a pack wrongly and the error each gives, the territory model, data streams and federation, and a verified section with suite counts. `node demo/build.mjs --skip-suites` skips the suite counts, and the build fails if any scenario's expectation is not met. `--out <path>` chooses the file.
- **Explorer** — for people who work with places rather than code. Click a place to see what is placed in it, what it overlaps on other layers, which data streams exist for it, and what a peer organisation would see, depending on what you share and whether the peer has the pack. A six-step tour runs over the same screen.

`dist/` is gitignored; build the file and open it locally. Both builds produce their files (checked with the demo's `--skip-suites`); the pages were built but not exercised in a browser.

## Tests

```bash
cd packages/org-os-territory && node --test                                   # 71 tests
cd packages/org-os-kms && node --test test/extensions.test.mjs test/packs-e2e.test.mjs   # the loader and the real pack through bridge and publish
```

`packs-e2e.test.mjs` is the integration test for this pack: with no pack, `publish` produces the core surface only; with the pack but no opt-in, its types bridge but do not publish; with the opt-in, a unit publishes without its `notes` and a `not-public-yet` data stream does not.

## Not built

- Real geometry, any real territory's data, and the script that computes overlap shares. The sidecar's format and validator exist; nothing generates it.
- A map. The explorer's board is a schematic.
- Hatching a unit into its own instance (`node_did`, `node_repo` are placeholders).
- Downgrade on ingest for a peer without the pack.
- A command-line way to query by place, and a lint that checks `unit_refs` in a store.

## Files

- Pack: `packages/org-os-territory/` — `pack.yaml`, `extension-entities.yaml`, `schemas/territorial-unit.yaml`, `schemas/data-stream.yaml`, `profile/profile.yaml` (registry bindings), `src/units.mjs`, `src/overlaps.mjs`, `demo/`, `explorer/`, `test/`.
- Instance files it reads and writes: `kms.yaml`, `data/kb/territorial-unit.yaml`, `data/kb/data-stream.yaml`, `data/territorial-units.yaml`, `data/data-streams.yaml`, `data/territory-overlaps.json` (sidecar, by convention).
- Reference: [package README](../packages/org-os-territory/README.md), [org-os-kms README](../packages/org-os-kms/README.md).
