# org-os site

The org-os framework website + docs + live federation — one static Astro site.

## Run

```bash
npm install        # one-time
npm run dev        # aggregates federation.json, then http://localhost:4321/org-os-template/
npm run build      # aggregate → astro build → verify  (static site → dist/)
npm test           # unit tests for the federation aggregator
```

Requires Node ≥22. Build/dev must run from this directory (`site/`).

The site is served under the `/org-os-template` base path (GitHub Pages project
page — see `base.config.mjs`), in dev as well as production, so the plain
`http://localhost:4321` root shows Astro's 404. Internal links go through
`withBase()` from `src/lib/base.ts`; `scripts/verify-build.mjs` fails the build
on any link that skips (or doubles) the prefix.

## How it works

- **Docs** render from `../docs/*.md` via Astro's `glob()` content loader (single source of truth; the on-site set is curated in `src/data/docs-allowlist.ts`). No markdown is copied into `site/`.
- **Federation** is aggregated at build by `scripts/aggregate-federation.mjs` from `../data/instances.yaml` + each sibling instance's `.well-known/` → `src/data/federation.json` (gitignored, regenerated each build). A missing/unreadable sibling degrades gracefully (node flagged `available: false`); the build never fails. The aggregator also copies org-os's own `.well-known/*.json` into `public/.well-known/`.
- **Theme**: a light "systems" theme. Palette/fonts/radius live in `src/styles/themes/systems.css`; structural tokens in `tokens.css`; swap the one `@import` in `theme.css` to retheme the whole site (a `systems-dark.css` stub proves the swap).
- **Graph**: the federation network on `/` and `/federation` is pure deterministic SVG — zero client JS.
- **Machine layer**: `/llms.txt`, `/federation.json`, and the surfaced `/.well-known/` EIP-4824 schemas.

## Pages

`/` · `/modules` · `/federation` · `/docs` (+ `/docs/<slug>`) · `/get-started` · `/about`

## The generator seam

`src/styles` + `src/components` + `scripts/` are the reusable core; `src/data/*.yaml` is org-os's own content (landing copy, module roadmap, docs allowlist). This split is the basis for the future `org-os-website-generator` module — any instance would swap the data, keep the core.

## Deployment

Live at <https://regen-coordination.github.io/org-os-template/> — locked by the
v0.5 release masterplan (WS-D, operator decision 2026-08-28). Origin and base
path live in `base.config.mjs` (the single source of truth, consumed by
`astro.config.mjs`, `verify-build.mjs`, and the root README render);
`.github/workflows/deploy-pages.yml` deploys on every push to `main`.

## Open decisions (see spec §16)

Accent color and the final curated-docs allowlist are not yet locked (a custom
domain would be a new decision, made by changing `base.config.mjs`). Spec:
`../docs/superpowers/specs/2026-06-17-org-os-website-design.md`.

Built by the org-os framework. MIT.
