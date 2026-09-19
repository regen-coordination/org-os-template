// demo/build.mjs — capture → inline → demo/dist/index.html. Usage: node demo/build.mjs [--skip-suites] [--out <path>]
// The output is a single self-contained file: styles, the renderer, the wiring and the captured facts are all inlined.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture } from './capture.mjs';
import * as R from './render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), 'utf8');
export const DEFAULT_OUT = join(here, 'dist', 'index.html');
// render.mjs is a plain ES module (the tests import it); the page inlines it as classic script text, so its `export` keywords go.
export const stripExports = (src) => src.replace(/^export\s+(?=(?:const|function|async function)\b)/gm, '');
// Facts travel inside <script type="application/json">: `<` and the JS line separators are escaped so the block can never end itself.
const LS = String.fromCharCode(0x2028); const PS = String.fromCharCode(0x2029);
export const safeJson = (o) => JSON.stringify(o).replaceAll('<', '\\u003c').replaceAll(LS, '\\u2028').replaceAll(PS, '\\u2029');

export function assemble(facts, src = {}) {
  const secs = R.sections();
  const nav = secs.map((s) => `<a href="#${s.id}">${R.esc(s.nav)}</a>`).join('');
  const body = secs.map((s) => `<section id="${s.id}" aria-labelledby="${s.id}-h"><h2 id="${s.id}-h">${R.esc(s.title)}</h2>${s.lead ? `<p class="lead">${s.lead}</p>` : ''}<div class="mount" data-section="${s.id}">${s.render(facts)}</div></section>`).join('\n');
  return (src.template ?? read('template.html'))
    .replace('/*__STYLES__*/', () => src.styles ?? read('styles.css'))
    .replace('<!--HEADER-->', () => R.renderHeader(facts))
    .replace('<!--NAV-->', () => nav)
    .replace('<!--SECTIONS-->', () => body)
    .replace('<!--FOOTER-->', () => R.renderFooter(facts))
    .replace('__FACTS__', () => safeJson(facts))
    .replace('/*__RENDER__*/', () => stripExports(src.render ?? read('render.mjs')))
    .replace('/*__APP__*/', () => src.app ?? read('app.js'));
}

export async function build({ skipSuites = false, out = DEFAULT_OUT } = {}) {
  const facts = await capture({ skipSuites });
  const html = assemble(facts);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  return { out, bytes: Buffer.byteLength(html), facts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = { skipSuites: args.includes('--skip-suites') };
  const i = args.indexOf('--out');
  if (i >= 0) opt.out = resolve(args[i + 1]);
  build(opt).then((r) => console.log(`demo page written: ${r.out} (${Math.round(r.bytes / 1024)} KB)`)).catch((e) => { console.error(e.message); process.exit(1); });
}
