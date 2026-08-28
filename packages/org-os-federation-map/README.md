# @org-os/federation-map — "the torch"

Interactive map of an instance's *external* world: federated instances (ring 1),
frontier peers-of-peers (ring 2, embers), sources/ecosystems (ring 3). The
deliberate counterpart to the internal note graph — two linked views.

Design spec: `../../docs/superpowers/specs/2026-07-19-federation-map-design.md`.

## Use

```html
<script type="module">import "@org-os/federation-map";</script>
<federation-map src="/map.json"></federation-map>          <!-- fetch -->
<federation-map mode="mini"><script type="application/json">{…}</script></federation-map>  <!-- inline -->
```

Data plane: `org-os-kms render map` produces `map.json`. This package is
view-only — data in, pixels out. Theme via CSS custom properties
(`--fedmap-bg`, `--fedmap-self`, `--fedmap-instance`, `--fedmap-source`,
`--fedmap-ember`, `--fedmap-text`).
