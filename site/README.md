# org-os site

The org-os framework website + docs + live federation — one static Astro site.

## Run

```bash
npm install        # one-time
npm run dev        # aggregates federation.json, then http://localhost:4321/org-os-template/
npm run build      # aggregate → astro build → pagefind → verify  (static site → dist/)
npm test           # unit tests (manifest, links, themes, search, feedback, federation, modules)
```

Requires Node ≥22. Build/dev must run from this directory (`site/`).

The site is served under the `/org-os-template` base path (GitHub Pages project
page — see `base.config.mjs`), in dev as well as production, so the plain
`http://localhost:4321` root shows Astro's 404. Internal links go through
`withBase()` from `src/lib/base.ts`; `scripts/verify-build.mjs` fails the build
on any link that skips (or doubles) the prefix.

## How it works

- **Docs** are published from one manifest, `src/data/docs-manifest.mjs`: each entry names a markdown file anywhere in the repository, its address, title, section, order, summary and the commit it was checked against. Nothing is copied into `site/`. A file that is not in the manifest is not on the site.
- **Links between docs** are written as file links (`[x](FEDERATION.md)`), as the repository needs. `src/lib/remark-doc-links.mjs` turns a link to a published page into its site address and a link to any other repo file into its GitHub address at the release tag. A link that resolves to nothing fails the build.
- **Search** is Pagefind: `npm run build` indexes `dist/` after Astro builds it, and the index loads when the viewer first opens search. It does not exist under `npm run dev`, where Search falls back to the docs index — use `npm run build && npm run preview` to try it.
- **Federation** is aggregated at build by `scripts/aggregate-federation.mjs` from `../data/instances.yaml` + each sibling instance's `.well-known/` → `src/data/federation.json` (gitignored, regenerated each build). A missing/unreadable sibling degrades gracefully (node flagged `available: false`); the build never fails. The aggregator also copies org-os's own `.well-known/*.json` into `public/.well-known/`.
- **Themes**: light and dark, both loaded (`src/styles/theme.css`); `<html data-theme>` chooses, set before first paint by `src/lib/theme-boot.mjs` from the viewer's saved choice or the system setting. Palette/fonts/radius live in `src/styles/themes/`; structural tokens in `tokens.css`. `test/theme-contrast.test.mjs` holds both to WCAG AA.
- **Feedback** is a link to a prefilled GitHub issue under the `docs-feedback` label (`src/lib/feedback.mjs`). No backend, no script.
- **Graph**: the federation network on `/` and `/federation` is the `<federation-map>` web component.
- **Machine layer**: `/llms.txt` (generated from the manifest), `/federation.json`, and the surfaced `/.well-known/` EIP-4824 schemas.
- **Build checks**: `scripts/verify-build.mjs` fails the build on an invalid manifest, a page that did not build, a broken or unprefixed internal link on any page, a relative link left in the output, or a redirect that does not land.

## Pages

`/` · `/docs` (+ `/docs/<slug>`) · `/modules` (+ `/modules/rad-org-os`) · `/federation`

`/get-started` and `/about` are redirects (`src/data/redirects.mjs`).

## Adding a doc to the site

1. Write or pick the markdown file. It can live anywhere in the repository.
2. Check it against the code and note the commit you checked at.
3. Add an entry to `src/data/docs-manifest.mjs`.
4. `npm run build`. The build tells you if a link in it goes nowhere.

## The generator seam

`src/styles` + `src/components` + `src/lib` + `scripts/` are the reusable core; `src/data/` is org-os's own content (home copy, module mirror, docs manifest, redirects). This split is the basis for the future `org-os-website-generator` module — any instance would swap the data, keep the core.

## Deployment

Live at <https://regen-coordination.github.io/org-os-template/> — locked by the
v0.5 release masterplan (WS-D, operator decision 2026-08-28). Origin and base
path live in `base.config.mjs` (the single source of truth, consumed by
`astro.config.mjs`, `verify-build.mjs`, and the root README render);
`.github/workflows/deploy-pages.yml` deploys on every push to `main`.

## Open decisions (see spec §16)

A custom domain would be a new decision, made by changing `base.config.mjs`.
Specs: `../docs/superpowers/specs/2026-06-17-org-os-website-design.md` (the first
version) and `../docs/superpowers/specs/2026-10-10-site-docs-v2-design.md` (this one).

Built by the org-os framework. MIT.
