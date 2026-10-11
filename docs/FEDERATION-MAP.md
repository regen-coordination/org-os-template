# Federation map

The federation map draws an instance's external world: the instances it federates with, the peers those peers list, and the sources and ecosystems its knowledge comes from. It is two pieces with one file between them. `org-os-kms` reads the instance's files and writes `map.json` (the data plane); `@org-os/federation-map` is a `<federation-map>` web component that reads `map.json` and draws it (the view). The package README calls it "the torch"; it is the counterpart of the internal note graph. The design is in [the federation map spec](superpowers/specs/2026-07-19-federation-map-design.md).

**Status.** Both packages are version `0.1.0`. Their tests pass (`org-os-federation-map` 19, the map-related `org-os-kms` suites 26 in this pass), and the map runs on the project site. [Modules](MODULES.md) lists the package under the federation module, which is `live` there. No operator other than the maintainer has run it on an instance of their own.

The commands, from the instance directory (all but the frontier fetch read and write local files only):

```bash
node packages/org-os-kms/src/cli.mjs render map                 # data/kb/map.json
node packages/org-os-kms/src/cli.mjs federate frontier          # ring 2: fetch peers' manifests, one hop out
node packages/org-os-kms/src/cli.mjs render map html            # renders/federation-map.html + renders/federation-portals.md
```

`render map` takes `--dir <instance>` (default `.`), `--out <path>` (default `data/kb/map.json`, relative to `--dir`) and `--surface web|vault` (default `web`). `render map html` takes `--dir` and `--out` (default `renders/federation-map.html`). Neither needs `kms.yaml`; the map degrades to what it finds. The only hard requirement is a `federation.yaml` with `identity.name`; without it the command stops with `no federation.yaml with identity in: <dir>`.

For how federation itself works (the manifest, trust levels, peers), see [Federation](FEDERATION.md). The knowledge system overview is `docs/KMS.md`, and publishing its output is `docs/KMS-PUBLISHING.md` (both written in the same pass).

## The three rings

| Ring | Nodes | Comes from |
|---|---|---|
| 1 | `instance` | `federation.yaml`: every entry of `peers`, `upstream` and `downstream`; and each key of `peers:` in `kms.yaml` (knowledge peers) |
| 2 | `frontier` | the cache written by `federate frontier`: the peers listed in each ring-1 peer's own `federation.yaml` |
| 3 | `source`, `ecosystem` | `data/source-systems.yaml` (sources) and `data/ecosystems.yaml` (curated ecosystems) |

The instance itself is `self`, in the centre (ring 0 in the drawing). A node is added once: if a frontier peer is already in ring 1, no new node is created and only an edge is added. An entry whose id equals the instance's own is skipped.

Edges carry a `kind`:

| Kind | From to | Meaning |
|---|---|---|
| `federation`, `upstream`, `downstream` | self to ring-1 instance | the section of `federation.yaml` the peer was listed in |
| `knowledge` | self to ring-1 instance | a peer named in `kms.yaml` |
| `frontier` | ring-1 instance to frontier node | listed in that peer's manifest |
| `provenance` | source to self; ecosystem to source | where knowledge came from; an ecosystem groups the sources it lists in `sources:` |

## Building `map.json`

`buildMap` (`src/map.mjs` in the knowledge-system package) does only filesystem reads: no network. What it takes, in order:

- **`federation.yaml`**: `identity.name`, `type`, `emoji`; `hub` becomes the self `url`. For each peer, upstream or downstream entry: `id` (or `name`), `name`, `type`, `trust`, `url`, `repo`, and `local_path`. If `local_path` (relative to `--dir`) exists, the node is `live: true`, `last_seen` is the generation time, and `counts` takes the length of `members` in that peer's `.well-known/members.json` and of `projects` in its `.well-known/projects.json` when those files exist. Otherwise `live: false`.
- **`kms.yaml`**: only the keys of `peers`; each becomes a bare ring-1 node.
- **`data/source-systems.yaml`**: each entry becomes a `source` node (`id` or `title`, `ecosystem`, `url`). If `data/kb/index.json` exists, its `total` is copied to `counts.objects`. `portal_web` or, with `--surface vault`, `portal_vault`, becomes the node's `portal` link. This file is not in the framework repository itself, so a framework checkout has no source nodes.
- **`data/ecosystems.yaml`**: `ecosystems:` with `id`, `name`, `url`, and `sources:` (ids of source nodes that are present).
- **`data/federation/frontier/<id>.json`**: the frontier cache. A snapshot for an id that is no longer a node is ignored.

Every file except `federation.yaml` is optional, and an unreadable or malformed file is treated as absent.

The shape of the result:

```json
{
  "version": "1",
  "generated_at": "2026-10-10T05:52:26.209Z",
  "self":  { "id": "org-os", "name": "org-os", "type": "Project", "emoji": "🧬", "url": null },
  "nodes": [
    { "id": "peer-os", "kind": "instance", "name": "Peer", "type": "LocalNode", "ring": 1,
      "trust": "full", "live": true, "url": "https://...", "repo": "owner/peer-os",
      "counts": { "members": 3, "projects": 26 }, "last_seen": "2026-10-10T05:52:26.209Z" },
    { "id": "child", "kind": "frontier", "name": "Child", "type": null, "ring": 2,
      "live": false, "url": null, "repo": null, "counts": {} },
    { "id": "src", "kind": "source", "ring": 3, "ecosystem": "eco", "portal": null, "counts": { "objects": 14 } },
    { "id": "eco", "kind": "ecosystem", "ring": 3, "url": "https://...", "counts": {} }
  ],
  "edges": [
    { "from": "org-os", "to": "peer-os", "kind": "downstream" },
    { "from": "peer-os", "to": "child", "kind": "frontier" },
    { "from": "src", "to": "org-os", "kind": "provenance" }
  ]
}
```

Node fields the view uses: `id` and `kind` are required; `name`, `type`, `ring`, `trust`, `live`, `url`, `repo`, `portal`, `ecosystem`, `counts` (any numeric map) and `last_seen` are optional. A `render map` run in this pass over a copy of this repository's `federation.yaml` and `data/ecosystems.yaml` gave 12 nodes (9 instances, 3 ecosystems) and 9 edges, all of kinds `federation` and `downstream`: ring 2 was empty because no frontier cache was copied, and the instances were all `live: false` because their `local_path` directories were not there.

## The frontier fetch

`federate frontier` (`src/frontier.mjs`) is the only step that can touch the network. For each entry of `peers`, `upstream` and `downstream`:

1. If its `local_path` holds a `federation.yaml`, that is read (source `local`); no network.
2. Otherwise, if the entry has a `repo` (`owner/name`), it fetches `https://raw.githubusercontent.com/<repo>/HEAD/federation.yaml`, with an 8-second timeout per peer.
3. Otherwise the peer is reported `skipped: no local_path or repo`.

The peers named in that manifest (`peers`, `upstream`, `downstream`, reduced to `id`, `name`, `repo`, `url`, `type`) are written to `data/federation/frontier/<id>.json` with `fetched_at` and `source`. A peer that cannot be reached is reported `unreached` and its existing cache file is left alone, so a failed fetch never blanks the map. `render map` reads only this cache, never the network. Per peer, failures never fail the command: it returns `ok: true` and a per-peer report, so read the report, not the exit code. A missing or unreadable `federation.yaml` does throw, and the exit code is 1. It is one hop only: peers of peers, not peers of those.

The cache files are tracked content in this repository, so commit them if you want the frontier in a build made elsewhere.

## The HTML artifact

`render map html` writes one self-contained file, `renders/federation-map.html` (or `--out`): the map data and the built component (`packages/org-os-federation-map/dist/federation-map.iife.js`) are both inlined, so it opens offline. It builds the map with `--surface vault`, so portal links use the vault surface (`obsidian://` links). It also writes `renders/federation-portals.md` (always at that path under `--dir`), a note listing every node grouped as Instances, Frontier, Sources and Ecosystems, each linking to `federation-map.html#node=<id>`, so a note can link into the map and the map's panel can link back out. Both files carry one shared timestamp.

The bundle is a committed build output. If you change the component, run `npm run build` inside `packages/org-os-federation-map` (it uses `esbuild`, a dev dependency) before rendering, or the artifact inlines the old one; `test/dist.test.mjs` checks that the committed bundle exists and is self-contained.

## The `<federation-map>` element

```html
<script type="module">import "./packages/org-os-federation-map/src/index.mjs";</script>
<federation-map src="/map.json"></federation-map>                 <!-- fetch -->
<federation-map mode="mini">                                      <!-- inline -->
  <script type="application/json">{ "self": {...}, "nodes": [...], "edges": [...] }</script>
</federation-map>
```

The import path above is relative to the page; adjust it to where the package sits. The package README writes the bare specifier `@org-os/federation-map`, which works only if the package is installed under that name; nothing in this repository shows it published to a registry (not verified). Without a bundler, load the committed standalone bundle `packages/org-os-federation-map/dist/federation-map.iife.js` with a plain `<script src>` instead.

Attributes:

| Attribute | Values | Effect |
|---|---|---|
| `src` | URL of a `map.json` | fetched when the element connects |
| `mode` | `full` (default), `mini` | `mini` has no pan, zoom, drag, click panel or tooltip, and shows labels only for the centre and ring-1 instances. Meant for a small preview. |

An inline `<script type="application/json">` child wins over `src`. Bad or missing data (not JSON, no `self.id`, no `nodes` array, a fetch error) renders a quiet empty state, `No federation data - run org-os-kms render map`, and never throws. Nodes without `id` or `kind`, and edges whose ends are not both known, are dropped.

Behaviour in `full` mode: the layout is a d3-force simulation with the rings pinned as orbits (radii 0.28, 0.42 and 0.55 of the smaller side of a 900 by 640 canvas), a fixed random seed and hashed starting angles, so the same data gives the same picture. Hovering a node lights it and its neighbours and dims the rest; clicking opens a side panel with the node's fields and its links (`visit`, `repository`, `federation.json` for instances with a `url`, and `portal`); dragging a node moves it; the wheel zooms; dragging the background pans; the centre node is fixed. `#node=<id>` in the page address lights and centres that node on load. Frontier nodes are faint embers with labels shown only when lit. Links in the panel are limited to `http(s):` and `obsidian:` addresses or same-page paths, and every value is escaped, because node fields can come from a remote peer's manifest. A visually hidden table lists nodes for screen readers, and the ember animation stops under `prefers-reduced-motion`.

Theme with custom properties on the element or an ancestor: `--fedmap-bg`, `--fedmap-self`, `--fedmap-instance`, `--fedmap-source`, `--fedmap-ember`, `--fedmap-text`, and `--fedmap-font`. The package exports `FederationMap`, `define`, `normalizeMap`, `buildLayout`, `RING_RADIUS`, `nodeRadius`, `renderSVG` and `esc`; importing it registers the element.

## How the project site uses it

`site/scripts/aggregate-federation.mjs` runs as `npm run aggregate` in `site/`. `npm run dev` runs it first; `npm run build` runs `npm run clean` first, then it (`site/package.json`). It does three things. Before any of them it checks that the three installs exist (the repository root, `packages/org-os-federation-map` and `site`) and, if one is missing, stops with a sentence that names it.

1. It reads `data/instances.yaml` and writes `site/src/data/federation.json`. That file holds six things: `root` (the framework's own `name`, `type` and `repo`); `nodes` (for each registered instance, only `name`, `type` and `repo`); `registered`, the number of registered instances; `operational`, the number of those whose maturity is `production` in the registry; `operationalDefinition`, one sentence that says how that count is set; and `generatedAt`, the time of the run. The registry's other fields, including its notes, are not published; `site/scripts/federation-aggregate.mjs` holds the three-field list (`PUBLIC_FIELDS`) and `site/scripts/verify-build.mjs` fails the build if more reaches `dist/`.
2. It calls `buildMap` on the repository root with the surface set to `web`, passes the result through `quietMap`, and writes it twice: `site/src/data/map.json` and `site/public/map.json`. `quietMap` removes `live: false` and a `last_seen` of `null` from each node. A node whose checkout was not beside the repository at build time (always the case in CI) therefore carries no status, and the map prints none. A node that was read keeps `live: true` and its `last_seen`.
3. It copies the repository's `.well-known/*.json` into `site/public/.well-known/`.

`site/src/components/FederationMapIsland.astro` renders `<federation-map src=".../map.json">`, imports the component from `packages/org-os-federation-map/src/index.mjs`, and offers a `mini` variant that links to the `/federation` page. The home page uses the `mini` variant; the `/federation` page uses the full map and, below it, a list of the registered instances (name, type and a link to the repository), read from `federation.json`. The site build does not run `federate frontier`, so the site's ring 2 is whatever is in the committed `data/federation/frontier/` cache.

## The files

| File | Role |
|---|---|
| `federation.yaml`, `kms.yaml` (`peers`), `data/source-systems.yaml`, `data/ecosystems.yaml`, `data/kb/index.json`, `<peer>/.well-known/{members,projects}.json` | read by `render map` |
| `data/federation/frontier/<id>.json` | written by `federate frontier`, read by `render map` |
| `data/kb/map.json` | written by `render map` (ignored by git in this repository) |
| `renders/federation-map.html`, `renders/federation-portals.md` | written by `render map html` |
| `packages/org-os-federation-map/dist/federation-map.iife.js` | the committed bundle inlined in the HTML |
