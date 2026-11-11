// src/house/icons.mjs — kms's glyphs: the sprite, the <use> reference, and the kind → glyph table
// (spec §4-7, L4 §3.9). One source per glyph (coordinator ruling R-6): the federation map's glyphs come
// from its MAP_ICONS (via fedmap.mjs); this file adds only the rest, path data copied from the house
// gallery's <symbol>s.
//
// The glyphs are drawn in the style of Lucide (https://lucide.dev), the house's base icon set
// (L4 §3.9, call C-27): 24-unit grid, 1.5px round stroke, `currentColor`. Lucide's licence
// (https://lucide.dev/license) — its copyright line is abridged here: the holder of the Feather
// portions is named in that file.
//
//   ISC License
//
//   Copyright (c) for portions of Lucide are held as part of Feather (MIT), 2013-2022.
//   All other copyright (c) for Lucide are held by Lucide Contributors 2022.
//
//   Permission to use, copy, modify, and/or distribute this software for any purpose with or
//   without fee is hereby granted, provided that the above copyright notice and this permission
//   notice appear in all copies.
//
//   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
//   SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
//   AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
//   WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
//   NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
//   PERFORMANCE OF THIS SOFTWARE.

import { MAP_ICONS } from './fedmap.mjs';

// The glyphs the map does not draw. `file` is the gallery's page glyph, `layers` its stacked-sheets
// glyph (named for the deployment kind it marks here).
const KMS_ICONS = {
  branch: '<circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="8" r="2"/><path d="M6.5 7.5v9M17.5 10c0 4-4.5 3.5-9.5 7"/>',
  quote: '<circle cx="7.5" cy="9.5" r="2.25" fill="currentColor"/><path d="M9.75 9.5c0 3.9-1.8 6.4-4.75 7.75"/><circle cx="16.5" cy="9.5" r="2.25" fill="currentColor"/><path d="M18.75 9.5c0 3.9-1.8 6.4-4.75 7.75"/>',
  sliders: '<path d="M5 7h8M17 7h2M5 17h2M11 17h8"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  hammer: '<path d="m13.5 9.5-8 8a1.6 1.6 0 0 0 2.3 2.2l8-8"/><path d="M11 6.5 14.5 3l6.5 6.5-3.5 3.5-2-2-1.5 1.5-3-3 1.5-1.5z"/>',
  route: '<circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="5.5" r="2"/><path d="M8 18.5h7.5a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6H16"/>',
  signal: '<circle cx="12" cy="12" r="1.75"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
  file: '<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3.5V8h4.5M9 12.5h6M9 16h4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  layers: '<path d="m12 4 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4"/><path d="m4 16 8 4 8-4"/>',
  pin: '<path d="M12 20.5s6-5.6 6-10.5a6 6 0 0 0-12 0c0 4.9 6 10.5 6 10.5z"/><circle cx="12" cy="10" r="2.25"/>',
  stream: '<path d="M3.5 8c2 0 2-1.5 4.25-1.5S9.75 8 12 8s2-1.5 4.25-1.5S18.5 8 20.5 8M3.5 12.5c2 0 2-1.5 4.25-1.5s2 1.5 4.25 1.5 2-1.5 4.25-1.5 2.25 1.5 4.25 1.5M3.5 17c2 0 2-1.5 4.25-1.5S9.75 17 12 17s2-1.5 4.25-1.5S18.5 17 20.5 17"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.75v.01"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  swap: '<path d="M4.5 8.5h14M15 5l3.5 3.5L15 12M19.5 15.5h-14M9 12l-3.5 3.5L9 19"/>',
  ext: '<path d="M9 5H6a1.5 1.5 0 0 0-1.5 1.5v11.5A1.5 1.5 0 0 0 6 19.5h11.5A1.5 1.5 0 0 0 19 18v-3M14 4.5h5.5V10M19.5 4.5 11 13"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="5" cy="6.5" r=".9" fill="currentColor"/><circle cx="5" cy="12" r=".9" fill="currentColor"/><circle cx="5" cy="17.5" r=".9" fill="currentColor"/>',
  map: '<circle cx="12" cy="5.5" r="2.25"/><circle cx="5.5" cy="18" r="2.25"/><circle cx="18.5" cy="18" r="2.25"/><path d="M11 7.5 6.6 16M13 7.5l4.4 8.5M7.75 18h8.5"/>',
  fit: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>',
  'chev-r': '<path d="m10 7 5 5-5 5"/>',
  braces: '<path d="M8.5 4.5H8A2 2 0 0 0 6 6.5v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h.5M15.5 4.5h.5a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  'dash-circle': '<circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.75"/>',
  // the commons index's views bar (Task 17): Table tab, + Filter, sort
  table: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M10 10v9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sort: '<path d="M7 4.5v15M4 16.5l3 3 3-3M14 7h6M14 12h4.5M14 17h3"/>',
};

// name → the inner markup of its <symbol viewBox="0 0 24 24">
export const ICONS = Object.freeze({ ...MAP_ICONS, ...KMS_ICONS });

function known(name) {
  if (!Object.hasOwn(ICONS, name)) throw new Error(`unknown icon: ${name}`);
  return name;
}

// The sprite: one <symbol id="i-<name>"> per name asked for, in the order asked, once each.
export function iconSprite(names = []) {
  const seen = new Set();
  const symbols = [];
  for (const n of names) {
    if (seen.has(known(n))) continue;
    seen.add(n);
    symbols.push(`<symbol id="i-${n}" viewBox="0 0 24 24">${ICONS[n]}</symbol>`);
  }
  return `<svg width="0" height="0" aria-hidden="true"><defs>${symbols.join('')}</defs></svg>`;
}

// A glyph in text: decorative (the words next to it carry the meaning).
export function icon(name, { cls = 'i' } = {}) {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${known(name)}"/></svg>`;
}

// Spec §4-7: one glyph per framework schema and pack type, and the map's kinds.
const GLYPHS = Object.freeze({
  'encyclopedia-entry': 'book', 'concept-lineage': 'branch', 'claim-evidence': 'quote', 'option-entry': 'sliders',
  'implementation-record': 'hammer', track: 'route', 'source-system': 'db', resource: 'file', signal: 'signal',
  'relationship-record': 'link', deployment: 'layers', place: 'pin', 'territorial-unit': 'pin', 'data-stream': 'stream',
  organization: 'inst', 'public-use-boundary': 'file',
  // the map: instance → framed record · knowledge peer → open book · source → database ·
  // ecosystem → sprout (a group) · this instance → the seal
  instance: 'inst', frontier: 'inst', 'knowledge-peer': 'book', source: 'db', ecosystem: 'sprout', self: 'seal',
});

// An unknown pack type falls back to the glyph of its maps_to_core type, then to the page glyph.
export function glyphFor(type, { mapsToCore } = {}) {
  if (Object.hasOwn(GLYPHS, type)) return GLYPHS[type];
  if (mapsToCore != null && mapsToCore !== type) return glyphFor(mapsToCore);
  return 'file';
}
