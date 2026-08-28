// Single source of truth for where this site is deployed.
//
// The site ships to GitHub Pages as a *project* page, so it is served from a
// sub-path rather than the domain root. Every root-absolute internal reference
// therefore needs the prefix, and more than one consumer needs to know it:
// astro.config.mjs (which turns it into import.meta.env.BASE_URL for
// src/lib/base.ts), and scripts/verify-build.mjs (which greps the built HTML).
// Keeping it here stops those from drifting apart.
//
// Locked by the v0.5 release masterplan (WS-D): deploy repo
// regen-coordination/org-os-template, live at
// https://regen-coordination.github.io/org-os-template/
export const SITE_ORIGIN = 'https://regen-coordination.github.io';
export const BASE_PATH = '/org-os-template';

/** The full public URL, no trailing slash. */
export const SITE_URL = `${SITE_ORIGIN}${BASE_PATH}`;
