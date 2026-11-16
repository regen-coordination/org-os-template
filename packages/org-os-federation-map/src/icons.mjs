// src/icons.mjs — the map's glyphs, one source for every host (coordinator ruling R-6).
// static.mjs references them by `iconHref(name)`; hosts include `mapSprite()` once per document
// (the <federation-map> component in its shadow root, kms pages in their own sprite).
//
// The glyphs are drawn in the style of Lucide (https://lucide.dev), the house's base icon set
// (L4 §3.9, call C-27): 24-unit grid, 1.5px round stroke, `currentColor`. The path data is the house
// gallery's. Lucide's licence (https://lucide.dev/license) — its copyright line is abridged here:
// the holder of the Feather portions is named in that file.
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

import { ICONS_USED } from './static.mjs';

// name → the inner markup of its <symbol viewBox="0 0 24 24"> (exactly ICONS_USED in static.mjs)
export const MAP_ICONS = Object.freeze({
  inst: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 12.5h8M8 16h5"/>',
  book: '<path d="M4 5.5c2.8-.8 5.5-.5 8 1.2v13c-2.5-1.7-5.2-2-8-1.2z"/><path d="M20 5.5c-2.8-.8-5.5-.5-8 1.2v13c2.5-1.7 5.2-2 8-1.2z"/>',
  db: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  seal: '<path d="M12 3.5c3 2.6 5.5 5.9 5.5 9.4a5.5 5.5 0 0 1-11 0c0-3.5 2.5-6.8 5.5-9.4z" fill="currentColor" stroke="none"/>',
  sprout: '<path d="M12 20v-8"/><path d="M12 12c0-3.5-2.5-6-6.5-6 0 3.8 2.6 6 6.5 6zM12 14c0-3.1 2.2-5.5 6.5-5.5 0 3.4-2.4 5.5-6.5 5.5z"/><path d="M7 20h10"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  alert: '<path d="M12 4.5 21 19.5H3z"/><path d="M12 10v4M12 17v.01"/>',
});

// The sprite: one <symbol id="i-<name>"> per known name asked for, in the order asked, once each.
export function mapSprite(names = ICONS_USED) {
  const seen = new Set();
  const symbols = [];
  for (const n of names) {
    if (seen.has(n) || !Object.hasOwn(MAP_ICONS, n)) continue;
    seen.add(n);
    symbols.push(`<symbol id="i-${n}" viewBox="0 0 24 24">${MAP_ICONS[n]}</symbol>`);
  }
  return `<svg width="0" height="0" aria-hidden="true"><defs>${symbols.join('')}</defs></svg>`;
}
