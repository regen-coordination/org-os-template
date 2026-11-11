// demo/build.mjs — capture → inline → demo/dist/index.html. Usage: node demo/build.mjs [--skip-suites] [--out <path>]
// The output is a single self-contained file, drawn in the house (spec §5.9): kms's page shell — house tokens, its base, atoms, rows and
// artifact-frame CSS, the house fonts inlined, the glyph sprite — plus the report's own layout (styles.css), the renderer, the wiring and
// the captured facts. kms is read by sibling path at build time only; nothing the page loads is fetched.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { page, artBar, mark, note, callout } from '../../org-os-kms/src/house/html.mjs';
import { icon } from '../../org-os-kms/src/house/icons.mjs';
import { capture } from './capture.mjs';
import * as R from './render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), 'utf8');
export const DEFAULT_OUT = join(here, 'dist', 'index.html');
export const TITLE = 'Packs for the knowledge plane';
// render.mjs is a plain ES module (the tests import it); the page inlines it as classic script text, so its `export` keywords go.
export const stripExports = (src) => src.replace(/^export\s+(?=(?:const|function|async function)\b)/gm, '');
// Facts travel inside <script type="application/json">: `<` and the JS line separators are escaped so the block can never end itself.
const LS = String.fromCharCode(0x2028); const PS = String.fromCharCode(0x2029);
export const safeJson = (o) => JSON.stringify(o).replaceAll('<', '\\u003c').replaceAll(LS, '\\u2028').replaceAll(PS, '\\u2029');
// P-10: size budgets are measured with the inlined @font-face block removed (the fonts are a known constant).
export const withoutFontFaces = (html) => html.replace(/@font-face\s*\{[^}]*\}\s*/g, '');

// The house atoms the renderer draws with, rendered once by kms with R.SLOT where the words go (see render.mjs).
export const GLYPHS = ['check', 'chev-r', 'info'];
export const MARKS = ['done', 'open', 'ok', 'aged', 'failed'];
export function atoms() {
  return {
    icon: Object.fromEntries(GLYPHS.map((n) => [n, icon(n)])),
    mark: Object.fromEntries(MARKS.map((m) => [m, mark(m, { word: R.SLOT })])),
    note: note(R.SLOT),
    callout: callout({ html: R.SLOT }),
  };
}
Object.assign(R.ATOMS, atoms());

// The page's one script: the renderer, the same atoms, then the wiring.
export function pageScript(src = {}) {
  return `${stripExports(src.render ?? read('render.mjs'))}\nObject.assign(ATOMS, ${safeJson(atoms())});\n${src.app ?? read('app.js')}`;
}

export function assemble(facts, src = {}) {
  const secs = R.sections();
  const nav = `<ol>${secs.map((s) => `<li><a href="#${s.id}"><span class="no">${R.sectionNo(s)}</span>${R.esc(s.nav)}</a></li>`).join('')}</ol>`;
  const body = secs.map((s) => `<section id="${s.id}" class="rsec" aria-labelledby="${s.id}-h"><div class="lbl"><h2 id="${s.id}-h"><span class="no">${R.sectionNo(s)}</span> ${R.esc(s.title)}</h2>${s.lead ? `<p>${s.lead}</p>` : ''}</div><div class="mount" data-section="${s.id}">${s.render(facts)}</div></section>`).join('\n');
  const bar = artBar({ name: TITLE, sub: `a report from real runs · captured <time datetime="${R.esc(facts.meta.capturedAt)}">${R.day(facts.meta.capturedAt)}</time>` });
  const inner = (src.template ?? read('template.html'))
    .replace('<!--BAR-->', () => bar)
    .replace('<!--NAV-->', () => nav)
    .replace('<!--INTRO-->', () => R.renderIntro(facts))
    .replace('<!--SECTIONS-->', () => body)
    .replace('<!--FOOTER-->', () => R.renderFooter(facts))
    .replace('__FACTS__', () => safeJson(facts));
  return page({ title: `${TITLE} — a report from real runs`, extraCss: [src.styles ?? read('styles.css')], icons: GLYPHS, body: inner, script: pageScript(src) });
}

export async function build({ skipSuites = false, out = DEFAULT_OUT } = {}) {
  const facts = await capture({ skipSuites });
  const html = assemble(facts);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  return { out, bytes: Buffer.byteLength(html), leanBytes: Buffer.byteLength(withoutFontFaces(html)), facts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = { skipSuites: args.includes('--skip-suites') };
  const i = args.indexOf('--out');
  if (i >= 0) opt.out = resolve(args[i + 1]);
  build(opt).then((r) => console.log(`demo page written: ${r.out} (${Math.round(r.bytes / 1024)} KB; ${Math.round(r.leanBytes / 1024)} KB without the font block)`)).catch((e) => { console.error(e.message); process.exit(1); });
}
