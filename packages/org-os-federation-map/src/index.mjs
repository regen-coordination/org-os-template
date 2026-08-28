// src/index.mjs
export { FederationMap, define } from './element.mjs';
export { normalizeMap } from './parse.mjs';
export { buildLayout, RING_RADIUS, nodeRadius } from './sim.mjs';
export { renderSVG, esc } from './svg.mjs';
import { define } from './element.mjs';
define();
