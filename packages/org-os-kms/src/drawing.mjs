// src/drawing.mjs — the surfaces that draw are loaded only when asked (spec §9, R-38).
// kms runs vendored alone (packages/toolkit-framework + packages/org-os-kms, docs/SETUP-PATHS.md): its CLI, ops
// and static surface never import the house, the pages or the map statically. Three surfaces draw —
// `render map html`, `render pages --preview` and `publish` with publish.pages: true — and they need the sibling
// map package; each loads its module through here, which says so plainly when the sibling is not there.
export const MAP_PACKAGE = 'org-os-federation-map';

export class MissingMapPackage extends Error {}

const LOADERS = {
  'map-html': () => import('./render-map-html.mjs'),
  pages: () => import('./pages/write.mjs'),
};

// what: the surface that asked, as the operator knows it ('render map html', 'publish.pages', …)
export async function loadDrawing(name, what) {
  try {
    return await LOADERS[name]();
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes(MAP_PACKAGE)) {
      throw new MissingMapPackage(`${what} needs the map package ${MAP_PACKAGE} beside org-os-kms `
        + `(packages/${MAP_PACKAGE}), and it is not there. Vendor it to draw; every other verb runs without it.`);
    }
    throw e;
  }
}
