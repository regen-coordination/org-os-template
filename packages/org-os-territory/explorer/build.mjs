// explorer/build.mjs — capture → inline → explorer/dist/index.html. Usage: node explorer/build.mjs [--out <path>]
// One self-contained file, drawn in the house (spec §5.8, gallery §07): kms's page shell — house tokens, its base, atoms, rows and
// artifact-frame CSS, the house fonts inlined, the glyph sprite — plus the explorer's own layout (styles.css), tour + model + renderer +
// wiring, and the captured facts. kms is read by sibling path at build time only (as the packs report does); nothing the page loads is
// fetched. The first paint is pre-rendered.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { page, artBar, mark, note, callout, band, kindTile, fieldRows } from '../../org-os-kms/src/house/html.mjs';
import { icon } from '../../org-os-kms/src/house/icons.mjs';
import { safeJson, withoutFontFaces } from '../demo/build.mjs';
import { capture } from './capture.mjs';
import { initialState, view } from './model.mjs';
import * as R from './render.mjs';

export { withoutFontFaces };
const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), 'utf8');
export const DEFAULT_OUT = join(here, 'dist', 'index.html');
export const TITLE = 'A territory in org-os';
export const MODULES = ['tour.mjs', 'model.mjs', 'render.mjs'];
// The modules are plain ESM (the tests import them); the page inlines them as one classic script, so import lines and `export` keywords go.
export const inlineModule = (src) => src.replace(/^import\s[^;]*;\s*$/gm, '').replace(/^export\s+(?=(?:const|function|async function)\b)/gm, '');

// The house atoms the renderer draws with, rendered once by kms with R.SLOT (and R.SLOT2) where the words go (see render.mjs).
export const GLYPHS = ['pin', 'swap', 'stream', 'file', 'lock', 'info', 'chev-r', 'eye', 'check'];
const KTILES = ['pin', 'swap', 'stream', 'file'];
export function atoms() {
  return {
    icon: Object.fromEntries(GLYPHS.map((n) => [n, icon(n)])),
    ktile: Object.fromEntries(KTILES.map((g) => [g, kindTile(g)])),
    mark: { open: mark('open', { word: R.SLOT }) },
    note: note(R.SLOT),
    callout: callout({ html: R.SLOT }),
    band: band({ html: R.SLOT, action: R.SLOT2 }),
    fields: fieldRows([]).replace('</dl>', `${R.SLOT}</dl>`),
  };
}
Object.assign(R.ATOMS, atoms());

// The page's one script: tour, model and renderer, the same atoms, then the wiring.
export function pageScript(src = {}) {
  return `${MODULES.map((f) => inlineModule(read(f))).join('\n')}\nObject.assign(ATOMS, ${safeJson(atoms())});\n${src.app ?? read('app.js')}`;
}

export function assemble(facts, src = {}) {
  const v = view(initialState(), facts);
  const bar = artBar({ name: TITLE, sub: 'org-os-territory · explorer · illustrative sample', tools: `<div class="xp-tools" id="tools">${R.renderTools(v)}</div>` });
  const body = read('template.html')
    .replace('<!--BAR-->', () => bar)
    .replace('<!--BAND-->', () => R.renderBand(v))
    .replace('<!--APP-->', () => R.renderApp(v))
    .replace('__FACTS__', () => safeJson(facts));
  return page({ title: `${TITLE} — an illustrative explorer`, extraCss: [read('styles.css')], icons: GLYPHS, body, script: pageScript(src) });
}

export async function build({ out = DEFAULT_OUT } = {}) {
  const facts = await capture();
  const html = assemble(facts);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  return { out, bytes: Buffer.byteLength(html), leanBytes: Buffer.byteLength(withoutFontFaces(html)), facts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  build(i >= 0 ? { out: resolve(args[i + 1]) } : {})
    .then((r) => console.log(`explorer written: ${r.out} (${Math.round(r.bytes / 1024)} KB; ${Math.round(r.leanBytes / 1024)} KB without the font block)`))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
