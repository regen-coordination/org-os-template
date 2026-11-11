// src/house/fedmap.mjs — the one door from kms into the federation map package (plan Task 12).
// kms surfaces (the vault map artifact, knowledge pages, the packs' pages by sibling path) import the
// map's layout, view, static HTML, glyphs and stylesheet from here, so the relative path to the sibling
// package is written once.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export { layoutMap } from '../../../org-os-federation-map/src/layout.mjs';
export { nodeView, age, safeUrl } from '../../../org-os-federation-map/src/view.mjs';
export { renderStaticMap, renderListTwin, renderSmallMap, ICONS_USED, esc as fmEsc } from '../../../org-os-federation-map/src/static.mjs';
export { MAP_ICONS, mapSprite } from '../../../org-os-federation-map/src/icons.mjs';

// The text of the map's stylesheet (tokens only; the host's <style> carries house-tokens.css before it). Read when a
// page is drawn, not at import (R-38): importing this module does no work beyond loading the map's modules.
let mapCssText;
export function mapCss() {
  mapCssText ??= readFileSync(fileURLToPath(new URL('../../../org-os-federation-map/src/map.css', import.meta.url)), 'utf8');
  return mapCssText;
}
