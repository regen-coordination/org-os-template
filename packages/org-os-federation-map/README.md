# @org-os/federation-map

The house map of an instance's *external* world: what feeds it (upstream instances, sources and
their ecosystems) above it, the instance at the centre with its peers beside it, what it feeds
below, and each peer-of-a-peer one hop further out from whoever reported it. The counterpart to the
internal note graph.

Design spec: the kms house interface design (§5.1–5.2), kept with the process records; see
[`docs/superpowers/history/org-os-0.7.md`](../../docs/superpowers/history/org-os-0.7.md).

## What is in here

- `src/layout.mjs`: the layered layout. Pure and zero-dependency; the same `map.json` always gives
  the same picture.
- `src/view.mjs`: each node's words, marks and links. `safeUrl` allow-lists link schemes.
- `src/static.mjs` and `src/map.css`: the map as static HTML (nodes, one edge SVG, the caption, the
  list twin) plus the small map. kms pre-draws this so its pages work without JavaScript.
- `src/element.mjs`: `<federation-map>`. It draws the same static map in its shadow root at the
  element's own width, using the real fonts, then adds selection, keys, List · Map, Fit, zoom and
  the `#node=<id>` deep link.

## Use

```html
<script src="dist/federation-map.iife.js"></script>
<federation-map src="/map.json"></federation-map>                                   <!-- fetch -->
<federation-map data-surface="vault"><script type="application/json">{…}</script></federation-map>
<federation-map mode="mini" href="/map/"><script type="application/json">{…}</script></federation-map>
```

- **Surface.** Without `data-surface` you get the public copy: no attention marks, no vault links,
  and unreached peers read "not mapped". `data-surface="vault"` gives the steward's copy.
- **Mini.** `mode="mini"` draws the small map: this instance and up to six neighbours, 188px tall.
  The whole element is one link (`href`, default `#`).
- **Keys.** Tab enters at this instance or the deep-link target. Arrow keys move along edges.
  Enter opens the node's first safe link, Space fills the caption, and Esc leaves the map. `v`
  toggles List · Map. ⌘0 fits; ⌘+ and ⌘− zoom between 50 and 200 %, as does ctrl-wheel.
- **Controls outside the element.** A button with `data-fm-view="list"` or `"map"`, or with
  `data-fm-fit`, drives the map its `aria-controls` names. With no `aria-controls`, it drives the
  page's first map. The element keeps each button's `aria-pressed` in step.
- **Building.** `npm run build` writes `dist/federation-map.iife.js` with `map.css` bundled as text.
  `src/index.mjs` used unbundled needs a bundler that loads `.css` as text.

## Theme

The element reads the house tokens from the page (`--paper`, `--edge`, …). When the page has none,
it uses the house values from `src/house-tokens.mjs`, which `scripts/sync-tokens.mjs` generates
from kms's `house-tokens.css`. Light and dark follow the reader's setting.

For one release the old `--fedmap-bg`, `--fedmap-text` and `--fedmap-font` are still read, as
aliases of `--sunken`, `--ink` and `--sans`.

Data plane: `org-os-kms render map` produces `map.json`. This package only draws it and never
reads YAML.
