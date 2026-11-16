// src/index.mjs — the package's surface. Importing it defines <federation-map> (in a browser).
export { FederationMap, MapController, define, nodePanelHTML, safeUrl } from './element.mjs';
export { normalizeMap } from './parse.mjs';
export { layoutMap, nearestInDirection, LAYOUT, EDGE_WORDS } from './layout.mjs';
export { nodeView, statusLine, captionSentence } from './view.mjs';
export { renderStaticMap, renderListTwin, renderSmallMap, renderCaption, esc, ICONS_USED } from './static.mjs';
export { MAP_ICONS, mapSprite } from './icons.mjs';
export { HOUSE_TOKENS_CSS } from './house-tokens.mjs';
import { define } from './element.mjs';
define();
