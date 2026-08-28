// Base-path helpers for the GitHub Pages project deployment.
//
// The site is served from a sub-path (see base.config.mjs), so a root-absolute
// href like "/docs" resolves to the wrong place — it would leave the project
// and hit the user page. Every internal reference has to carry the prefix.
//
// import.meta.env.BASE_URL comes from `base` in astro.config.mjs, so this stays
// correct if the deploy path ever changes; nothing here hardcodes it.

// Astro prepends a forward slash to `base` but does NOT append one under the
// default trailingSlash: "ignore" (only "always" adds it) — so BASE_URL is
// "/org-os-template" as-is and the strip below is a no-op that exists to keep
// this correct under either trailingSlash setting.
const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

/**
 * Prefix a root-absolute internal path with the deployment base.
 *
 * Idempotent: an already-prefixed path is returned unchanged, so it is safe to
 * layer — a data file carrying a pre-prefixed value, or a caller wrapping a
 * component that also calls withBase, cannot produce "/base/base/x" (which
 * would pass the build gate's prefix check and 404 in production).
 *
 * Left untouched: anything that is not root-absolute (relative paths,
 * "#anchor", "mailto:", absolute URLs) and protocol-relative "//host" URLs, so
 * every href can be routed through this — including data-driven values that
 * may be internal or external. Deliberately no typeof guard: a non-string here
 * means malformed data, and throwing at build time (startsWith explodes)
 * points at the bad entry instead of shipping a garbage href.
 */
export function withBase(path: string): string {
  if (!path.startsWith('/')) return path;
  if (path.startsWith('//')) return path; // protocol-relative URL, not internal
  if (
    path === BASE ||
    path.startsWith(`${BASE}/`) ||
    path.startsWith(`${BASE}#`) ||
    path.startsWith(`${BASE}?`)
  ) {
    return path; // already prefixed (or BASE is empty and no prefix is needed)
  }
  return `${BASE}${path}`;
}
