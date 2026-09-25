# @org-os/org-state

Pure org-os workspace state: files map → structured state, loaders, and markdown pages (backs `npm run page`).

## What Moved and Why

Three modules moved from `packages/cloudflare-os-integration/src/page-core/` into this new shared package (2026-09-25):

- `build-state.mjs` — core state builder
- `parse-helpers.mjs` — frontmatter and checkbox parsing
- `render-page.mjs` — page renderers for org-state dashboard + page list

These modules are **pure functions** with no side effects, making them reusable across consumers without the Cloudflare integration.

## Consumers

1. **Cloudflare OS gatekeeper** (`packages/cloudflare-os-integration`) — re-exports via shims at old paths; tests unchanged
2. **`scripts/page-shim.mjs`** — transitional markdown rendering for `npm run page <id>`
3. **TUI renderer** (`packages/tui`) — future full dashboard implementation

## Purity Rule

Only `read-files.mjs` touches the filesystem. All other modules are pure state transformers.

## Tests

Run tests with `npm test --prefix packages/org-state` or `npm run test:org-state` from root.

Shim test verifies that old `page-core/` paths still re-export the same functions after the move — no behavior changed.
