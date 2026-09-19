// explorer/build.mjs — capture → inline → explorer/dist/index.html. Usage: node explorer/build.mjs [--out <path>]
// One self-contained file: styles, tour + model + renderer + wiring, and the captured facts are all inlined; the first paint is pre-rendered.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeJson } from '../demo/build.mjs';
import { capture } from './capture.mjs';
import { initialState, view } from './model.mjs';
import { renderApp } from './render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), 'utf8');
export const DEFAULT_OUT = join(here, 'dist', 'index.html');
export const MODULES = ['tour.mjs', 'model.mjs', 'render.mjs'];
// The modules are plain ESM (the tests import them); the page inlines them as one classic script, so import lines and `export` keywords go.
export const inlineModule = (src) => src.replace(/^import\s[^;]*;\s*$/gm, '').replace(/^export\s+(?=(?:const|function|async function)\b)/gm, '');

export function assemble(facts) {
  const scripts = [...MODULES.map((f) => inlineModule(read(f))), read('app.js')].join('\n');
  return read('template.html')
    .replace('/*__STYLES__*/', () => read('styles.css'))
    .replace('<!--APP-->', () => renderApp(view(initialState(), facts)))
    .replace('__FACTS__', () => safeJson(facts))
    .replace('/*__SCRIPTS__*/', () => scripts);
}

export async function build({ out = DEFAULT_OUT } = {}) {
  const facts = await capture();
  const html = assemble(facts);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  return { out, bytes: Buffer.byteLength(html), facts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  build(i >= 0 ? { out: resolve(args[i + 1]) } : {}).then((r) => console.log(`explorer written: ${r.out} (${Math.round(r.bytes / 1024)} KB)`)).catch((e) => { console.error(e.message); process.exit(1); });
}
