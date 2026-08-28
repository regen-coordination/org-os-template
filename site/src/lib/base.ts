// Base-path helpers for the GitHub Pages project deployment.
//
// The site is served from a sub-path (see base.config.mjs), so a root-absolute
// href like "/docs" resolves to the wrong place — it would leave the project
// and hit the user page. Every internal reference has to carry the prefix.
//
// import.meta.env.BASE_URL comes from `base` in astro.config.mjs, so this stays
// correct if the deploy path ever changes; nothing here hardcodes it.

/** BASE_URL is normalised by Astro to always have a trailing slash ("/" when unset). */
const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

/**
 * Prefix a root-absolute internal path with the deployment base.
 *
 * Left untouched: anything that is not root-absolute (relative paths, "#anchor",
 * "mailto:", and absolute URLs like "https://…"), so it is safe to route every
 * href through this — including ones that come from data files where the value
 * may be either internal or external.
 */
export function withBase(path: string): string {
  if (typeof path !== 'string' || !path.startsWith('/')) return path;
  if (path.startsWith('//')) return path; // protocol-relative URL, not internal
  return `${BASE}${path}` || '/';
}

/** Absolute public URL for a root-absolute internal path (for llms.txt, meta tags). */
export function absoluteUrl(path: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}${withBase(path)}`;
}
