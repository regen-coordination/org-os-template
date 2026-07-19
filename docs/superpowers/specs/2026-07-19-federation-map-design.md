---
id: federation-map
title: "org-os Federation Map — 'The Torch' (Design)"
date: 2026-07-19
status: approved-design
location: packages/org-os-federation-map/ + packages/org-os-kms/ + site/
---

# org-os Federation Map — "The Torch"

> **Theme:** A sleek, interactive map of the world *outside* an instance — federated instances, knowledge sources, provenance, and the ecosystems they live in. The deliberate counterpart to the internal note graph (Obsidian graph view / note-web): two linked views, one instrument pointed inward, one outward. Considering the dark forest, this is a torch — it shows the fires you know, the embers one hop beyond, and gives you links to walk toward them.

## 1. Decisions made during brainstorming

| Question | Decision |
|---|---|
| Surfaces | **A + C** — a reusable package instances embed (public sites), plus an operator-side vault artifact openable next to Obsidian's graph. |
| Scope vs internal graph | **Two linked views (portals)** — the map is strictly external; crossings between internal graph and federation map are explicit deep-links, not one blended space. |
| Depth into the forest | **Frontier + curated ecosystems** — fetch peers' published `/federation.json` to render peers-of-peers as dim frontier nodes; plus hand-curated ecosystem nodes from a small YAML. |
| Visual language | **Hybrid** — orbital structure (deterministic rings by hop-distance) × constellation physics (d3-force, draggable, kin to Obsidian's graph) × torchlight atmosphere (luminosity falls off with distance; frontier = embers). |
| Packaging | **Framework-agnostic web component** (`<federation-map>`), d3-force as only dep. A thin Astro wrapper in `site/` gives Astro-native ergonomics without lock-in (revisit a real Astro library later if warranted). |

## 2. Architecture — strict view/data split

```
org-os-kms (data plane — already the binder)          org-os-federation-map (view plane — NEW)
┌─────────────────────────────────────┐               ┌──────────────────────────────────┐
│ federate frontier  → fetch peers'   │               │ <federation-map> custom element  │
│   /federation.json, cache snapshots │   map.json    │  d3-force (only dep)             │
│ render map         → aggregate:     │ ────────────► │  SVG in shadow DOM               │
│   federation.yaml + kms.yaml peers  │               │  themeable via CSS custom props  │
│   + KB provenance + ecosystems.yaml │               │  modes: full | mini              │
│ render map --html  → self-contained │               └──────────────────────────────────┘
│   vault artifact (data inlined)     │                 consumers:
└─────────────────────────────────────┘                 · site/ /federation (Astro island)
                                                        · site/ home (mini)
                                                        · renders/federation-map.html (vault)
                                                        · any instance site (refibcn-site, …)
```

Principles:

- **kms owns aggregation.** It already owns `federate` and `render`; the map is a third render target. The component never reads YAML — it consumes one JSON file.
- **The component is dumb and portable.** Data in, pixels out. Swap the host, keep the view; swap the view, keep the data — the same seam philosophy as kms itself.
- **Instances inherit the map** by taking the kms profile update and embedding one element. No per-instance graph code.

## 3. Data — `map.json` v1

Produced by `org-os-kms render map`. Inputs, all optional except `federation.yaml`:

| Input | Contributes |
|---|---|
| `federation.yaml` | self identity; ring-1 instance nodes (peers, upstream, downstream) with trust + sync direction |
| `kms.yaml` `peers` | ring-1 knowledge-peer nodes / `knowledge` edges |
| KB (`data/kb/index.json` + source-systems + provenance records) | `source` nodes with object counts; `provenance` edges to the nodes they feed |
| `data/ecosystems.yaml` (new, optional) | curated `ecosystem` nodes; grouping of sources into ecosystems |
| `data/federation/frontier/*.json` (cached snapshots) | ring-2 `frontier` nodes + `frontier` edges (peers-of-peers not already in ring 1) |

Shape (v1):

```jsonc
{
  "version": "1",
  "generated_at": "…",
  "self": { "id": "org-os", "name": "org-os", "type": "Project", "emoji": "🧬", "url": "…" },
  "nodes": [
    { "id": "refi-bcn-os", "kind": "instance", "name": "ReFi Barcelona", "type": "LocalNode",
      "ring": 1, "trust": "full", "live": true, "url": "…", "repo": "…",
      "counts": { "members": 3, "projects": 26 }, "last_seen": "…" },
    { "id": "koi-network", "kind": "source", "ring": 3, "ecosystem": "regen-commons",
      "counts": { "objects": 14 }, "portal": "obsidian://… or /docs/…" }
  ],
  "edges": [
    { "from": "org-os", "to": "refi-bcn-os", "kind": "downstream" }
  ]
}
```

- `node.kind`: `instance` (ring 1) · `frontier` (ring 2) · `source` / `ecosystem` (outer band, ring 3).
- `edge.kind`: `federation` · `upstream` · `downstream` · `knowledge` · `provenance` · `frontier`.
- `portal` is **surface-relative**: the builder emits `obsidian://` links for the vault render target and web paths for the site target.
- Dedup rule: a frontier candidate already present in ring 1 is dropped (the edge is kept, retargeted at the ring-1 node).

### Frontier fetch is a separate op

`org-os-kms federate frontier` fetches each ring-1 peer's published `/federation.json` (fallback `/.well-known/federation.json`) and writes cached snapshots to `data/federation/frontier/<peer>.json` with `fetched_at`. `render map` reads only the cache — it is pure and offline, and **never fails the build**. Stale cache beats broken build.

### `data/ecosystems.yaml` (new)

```yaml
ecosystems:
  - id: regen-commons
    name: Regen Commons
    url: https://…
    sources: [koi-network, regen-registry]   # source-system ids grouped under this ecosystem
```

## 4. Component — `<federation-map>`

Package: `packages/org-os-federation-map`. Custom element, SVG inside shadow DOM, themeable via CSS custom properties (`--fedmap-accent`, `--fedmap-bg`, …). Only dependency: `d3-force` (plus `d3-zoom`/`d3-drag` if not hand-rolled — implementation's choice, keep the dep list minimal). Data via `src="map.json"` attribute or an inline `<script type="application/json">` child.

### Layout (orbital × constellation)

- `forceRadial` pins nodes to ring radii: self at center; ring 1 instances; ring 2 frontier; ring 3 sources/ecosystems. Sources gravitate angularly toward the instances they feed via link force.
- Within rings: `forceLink` + `forceManyBody` + collision → organic settling; nodes draggable.
- **Deterministic start:** initial angle = hash(node id). Same data → same map; no `Math.random`.

### Torchlight

- Radial gradient centered on self; node/edge luminosity falls off by ring.
- Frontier nodes are ember-colored, faintly pulsing (CSS animation; disabled under `prefers-reduced-motion`).
- Hover casts light: adjacent nodes/edges brighten to full, the rest dims further.

### Interaction

- Hover → tooltip card: name, type, trust, live dot, counts, last-seen.
- Click → slide-in detail panel: full metadata + outbound links (visit site, repo, its `/federation.json`) + the `portal` link inward when present. Outbound links are the torch's purpose — walking toward the fires.
- Pan/zoom in full mode; `#node=<id>` deep-link focuses and lights a node on load.
- **Mini mode** (`mode="mini"`): no pan/zoom, no panel, sparse labels; the whole element links to `/federation`.
- Accessibility: `role="img"` + aria-label; a visually-hidden table of nodes/edges doubles as the no-JS fallback.

## 5. Portals (the two linked views)

- **Map → internal:** node `portal` links. Vault artifact: `obsidian://` URIs into notes/note-web. Site: `/docs/…` pages when published.
- **Internal → map:** boundary notes (KB objects with external provenance) gain one line — `[View in federation map](renders/federation-map.html#node=<id>)` — stamped by kms during `render map --html`. On the site, doc pages that mention a mapped node carry the same deep-link.
- The vault artifact is a **single self-contained HTML** (component + data inlined) at `renders/federation-map.html`, so the round-trip works offline from inside Obsidian.

## 6. Degradation (dark-forest-proof)

| Missing | Behavior |
|---|---|
| Peer publishes no `/federation.json` | Node renders from your manifest alone, badged "unreached" — visibly darker |
| Frontier fetch fails / offline | `render map` uses cached snapshots; build never fails |
| No `kms.yaml` / no KB | Map renders from `federation.yaml` alone; sources band absent |
| No `ecosystems.yaml` | No ecosystem nodes |
| Empty/invalid `map.json` | Component renders a quiet empty-state, not a crash |

## 7. Testing

- **Builder (kms):** `node --test` fixtures — sample `federation.yaml` + `kms.yaml` + KB index + frontier snapshots → snapshot-assert `map.json`; every degradation row in §6 asserted.
- **Frontier op:** fixture HTTP responses → cache write/reuse; failure → stale-cache path.
- **Component:** registers, renders N nodes/edges from fixture JSON, deep-link focus works (jsdom smoke test); determinism test (two renders → same positions).
- **Site:** existing `site/test` pattern — build succeeds with sibling repos absent.

## 8. Phasing

1. **P1 — the map exists:** `org-os-federation-map` component + kms `render map` (federation.yaml + kms peers + KB sources) + swap `site/` `/federation` static SVG for the island (+ mini on home).
2. **P2 — the frontier:** `federate frontier` op + cached snapshots + `data/ecosystems.yaml` + frontier/ecosystem rendering.
3. **P3 — the portals:** `render map --html` vault artifact + boundary-note stamping + deep-link polish.

## 9. Out of scope (explicitly)

- Runtime liveness pings from the browser (CORS-dependent; build-time `live` flag only for now).
- Multi-hop frontier (>1 hop past ring 1).
- An Astro-native component library (thin wrapper in `site/` only; revisit later).
- Editing federation data from the map (read-only view).
