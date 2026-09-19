# org-os-territory

An **org-os-kms extension pack**: it gives a knowledge instance a sense of place.

- **`territorial-unit`** — a bounded unit of territory on one named layer (`administrative`,
  `landscape`, `ecological`, `hydrological`, `custom`). Maps to the framework's core `place`.
- **`data-stream`** — one dataset, endpoint or feed that a `source-system` offers, catalogued
  by the places and the kinds of work it serves, with an explicit `trust` tier and `licence`.
- **`unit_refs`** — a convention, not a schema change: any object may carry
  `unit_refs: [<unit_id>, …]`. The framework's model is open, so this needs nothing from core.

## Install

Vendor this directory next to `org-os-kms` and `toolkit-framework`, unedited and pinned to a
tag, then opt in:

```yaml
# kms.yaml
extensions: [org-os-territory]
publish:
  types_opt_in: [territorial-unit]   # only if you want units published — pack types never publish by default
```

Requires `toolkit-framework >= 0.3.0` and `org-os-kms >= 0.1.0`. Objects land in
`data/territorial-units.yaml` and `data/data-streams.yaml` on `bridge`.

## Conventions

- **`unit_id`** is `<layer>:<level>:<name>` — `landscape:unit:plana-de-vic`. It is what
  `unit_refs`, `part_of` and `overlaps_with` point at, and it is not the UUID `id` minted at
  publish.
- **`level` is a free string.** Levels are local vocabulary: Catalunya's `municipi → comarca →
  vegueria` are not Brazil's.
- **`part_of` stays inside a layer; `overlaps_with` crosses layers.** Both are the framework's
  Layer-A predicates, not new ones.
- **`codes`** are `"<scheme>:<value>"` strings (`idescat:08`, `one_earth:PA20`) because AT Proto
  lexicon fields are flat.
- **Geometry is a file**, referenced by `geometry_ref`. It is never inline and never published.
- **Overlap shares are derived data.** They live in the generated sidecar
  `data/territory-overlaps.json`; `validateOverlaps` is its contract.

## Query by place

```js
import { indexUnits, unitsFor, objectsIn } from './src/units.mjs';

const index = indexUnits(units);                       // throws on duplicate ids and bad part_of
objectsIn('administrative:comarca:osona', objects, index);   // everything in Osona and beneath it
unitsFor(project, index);                              // { units: [refs + ancestors], unknown: [...] }
```

An unknown `unit_ref` is reported in `unknown`, never thrown — whether it is an error is your
instance's lint to decide.

## Not here (yet)

Real geometry and any Catalunya data, the script that computes overlaps, a map, hatching a
unit into its own instance (`node_did` / `node_repo` are reserved for it), and
downgrade-on-ingest for peers that do not load this pack.

## Test

```bash
node --test
```

## Demo

A single-file HTML page that shows what extension packs and this pack do — every result on it captured from the real code, nothing mocked:

```bash
cd packages/org-os-territory
npm run demo                        # runs the scenarios and the three package suites → demo/dist/index.html
node demo/build.mjs --skip-suites   # faster: skips the suite counts
node demo/build.mjs --out /tmp/demo.html
```

The build fails if any scenario's expectation is not met, so the page cannot show a result the code did not produce. The Catalunya sample is **illustrative** (example names, placeholder codes except `one_earth:PA20`, invented overlap shares, no geometry). `demo/dist/` is gitignored.
