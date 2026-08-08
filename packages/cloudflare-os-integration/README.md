# @org-os/cloudflare-os-integration

Org-os side of the Cloudflare OS integration. Holds the `gatekeeper-org-os` core exposing org-os instances (registries, pages, federation, context) as read capabilities over a swappable substrate, plus gadget blueprints. The org-os repo is canonical; the Cloudflare OS deployment holds only thin adapter wiring.

Design spec: `../../docs/superpowers/specs/2026-08-08-cloudflare-os-org-os-integration-design.md`.

## Layout

```
packages/cloudflare-os-integration/
├── package.json
├── README.md
├── src/
│   ├── page-core/       # parse-helpers.mjs, build-state.mjs, render-page.mjs (pure, runtime-agnostic)
│   ├── substrate/       # memory-substrate.mjs, github-substrate.mjs
│   ├── gatekeeper/      # instances.mjs, context-bundle.mjs, capabilities.mjs
│   └── adapter/         # README.md — wiring into the Cloudflare OS fork
├── blueprints/
│   └── org-dashboard/   # gadget.html
└── test/
    ├── fixtures/instance-a/
    └── *.test.mjs
```

## Test

```bash
npm test
```

Runs all tests in `test/*.test.mjs` via `node --test`. Also reachable from the repo root as
`npm run test:cloudflare-os-integration`.

`scripts/page-shim.mjs` in the repo root imports `src/page-core/render-page.mjs` directly, so its
output is byte-identical to the renderers it replaced — the parity check in the M0–M2 plan's
Task 17 is the gate on any change to those renderer bodies.
