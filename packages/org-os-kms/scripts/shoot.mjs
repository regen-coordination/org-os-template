#!/usr/bin/env node
// Dev-only page checker: screenshots, reflow, outbound requests, console errors, axe.
// Usage: node scripts/shoot.mjs --html <file.html> --out <dir> --name <surface>
//   [--widths 1440,390] [--themes light,dark] [--reflow 390,320] [--axe] [--full-page]
//   [--assert-inside <selector>] [--allow-file-reads] [--no-js]
// Every check runs in every theme: axe and --assert-inside at each width, reflow at each reflow width.
// --assert-inside: every .node and .elabel box (shadow roots pierced) lies inside the selector's box.
// --allow-file-reads: let the page's file:// scripts read local files (a page that links a local
// stylesheet, e.g. the federation-map demo: axe's CSSOM preload reads it). Off by default — kms's pages
// are single files and need no such permission.
// --no-js: open the page with JavaScript disabled (a viewer that strips scripts); every check still runs.
// With scripts off a page's timers never fire, so axe cannot run there: it runs on the no-JS page's DOM,
// its <script> elements removed, loaded into a scripted page of the same size and theme.
// Exit 0 clean, 1 findings, 2 a dependency cannot be resolved.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export function parseArgs(argv) {
  const o = { widths: [1440, 390], themes: ['light', 'dark'], reflow: [390, 320], axe: false, fullPage: false, assertInside: null, allowFileReads: false, noJs: false };
  const nums = (s) => s.split(',').map((x) => Number(x.trim())).filter((n) => n > 0);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--html') o.html = val();
    else if (a === '--out') o.out = val();
    else if (a === '--name') o.name = val();
    else if (a === '--widths') o.widths = nums(val());
    else if (a === '--themes') o.themes = val().split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--reflow') o.reflow = nums(val());
    else if (a === '--axe') o.axe = true;
    else if (a === '--full-page') o.fullPage = true;
    else if (a === '--assert-inside') o.assertInside = val();
    else if (a === '--allow-file-reads') o.allowFileReads = true;
    else if (a === '--no-js') o.noJs = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  for (const k of ['html', 'out', 'name']) if (!o[k]) throw new Error(`missing --${k}`);
  return o;
}

// Resolution order: KMS_SHOOT_MODULES, packages/admin, this package.
function resolver(id) {
  const roots = [];
  if (process.env.KMS_SHOOT_MODULES) roots.push(resolve(process.env.KMS_SHOOT_MODULES));
  roots.push(resolve(here, '../../admin'), resolve(here, '..'));
  for (const dir of roots) {
    try {
      const req = createRequire(join(dir, 'package.json'));
      return { path: req.resolve(id), req };
    } catch { /* try next */ }
  }
  return null;
}

const viewport = (w) => ({ width: w, height: w >= 600 ? 900 : 844 });

// In the page: every `.node` and `.elabel` with a box, under each element matching `selector` (shadow
// roots pierced), must lie inside that element's box. Elements not shown (zero size) are skipped.
function insideCheck(selector) {
  const hosts = [...document.querySelectorAll(selector)];
  if (!hosts.length) return { checked: 0, outside: [`no element matches ${selector}`] };
  const outside = [];
  let checked = 0;
  const walk = (root, fn) => {
    for (const el of root.querySelectorAll('*')) { fn(el); if (el.shadowRoot) walk(el.shadowRoot, fn); }
  };
  hosts.forEach((host, h) => {
    const hb = host.getBoundingClientRect();
    const test = (el) => {
      if (!el.matches('.node, .elabel')) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      checked++;
      const t = 0.5;
      if (r.left < hb.left - t || r.top < hb.top - t || r.right > hb.right + t || r.bottom > hb.bottom + t) {
        const what = `${el.className} ${el.dataset.id ?? el.dataset.edge ?? ''}`.trim();
        outside.push(`${selector}[${h}] ${what}: ${[r.left, r.top, r.right, r.bottom].map(Math.round)} outside ${[hb.left, hb.top, hb.right, hb.bottom].map(Math.round)}`);
      }
    };
    walk(host, test);
    if (host.shadowRoot) walk(host.shadowRoot, test);
  });
  if (!checked) outside.push(`no .node or .elabel shown under ${selector}`);
  return { checked, outside };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pw = resolver('playwright-core');
  const axeMod = opts.axe ? resolver('axe-core') : { path: null };
  if (!pw || !axeMod) {
    const missing = !pw ? 'playwright-core' : 'axe-core';
    console.error(`cannot resolve ${missing}. Install it somewhere and point KMS_SHOOT_MODULES at the directory that contains its node_modules/.`);
    process.exitCode = 2;
    return;
  }
  const { chromium } = pw.req('playwright-core');
  const axePath = axeMod.path;

  const htmlPath = resolve(opts.html);
  if (!existsSync(htmlPath)) { console.error(`no such file: ${opts.html}`); process.exitCode = 2; return; }
  const url = pathToFileURL(htmlPath).href;
  mkdirSync(opts.out, { recursive: true });

  const report = { reflow: [], requests: [], consoleErrors: [], axe: [], inside: [] };
  const requests = new Set();
  const consoleErrors = new Set();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: opts.allowFileReads ? ['--allow-file-access-from-files'] : [] });

  // html: load this markup instead of the file (the --no-js axe run)
  async function open(width, scheme, { js = !opts.noJs, html = null } = {}) {
    const ctx = await browser.newContext({ viewport: viewport(width), colorScheme: scheme, deviceScaleFactor: 1, javaScriptEnabled: js });
    const page = await ctx.newPage();
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith('file:') || u.startsWith('data:')) return route.continue();
      requests.add(u);
      return route.abort();
    });
    page.on('pageerror', (e) => consoleErrors.add(String(e)));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const loc = m.location()?.url;
      if (loc && requests.has(loc)) return; // already reported as a request
      consoleErrors.add(m.text());
    });
    if (html != null) await page.setContent(html, { waitUntil: 'load' });
    else await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    return { ctx, page };
  }

  try {
    for (const theme of opts.themes) {
      for (const width of opts.widths) {
        const { ctx, page } = await open(width, theme);
        try {
          await page.screenshot({ path: join(opts.out, `${opts.name}-${width}-${theme}.jpg`), type: 'jpeg', quality: 80, fullPage: opts.fullPage });
          if (opts.assertInside) {
            const r = await page.evaluate(insideCheck, opts.assertInside);
            report.inside.push({ width, theme, checked: r.checked, outside: r.outside });
          }
          if (opts.axe) {
            let target = { ctx, page };
            if (opts.noJs) {
              const html = await page.evaluate(() => {
                const d = document.documentElement.cloneNode(true);
                for (const s of d.querySelectorAll('script')) s.remove();
                return `<!DOCTYPE html>${d.outerHTML}`;
              });
              target = await open(width, theme, { js: true, html });
            }
            try {
              await target.page.addScriptTag({ path: axePath });
              const res = await target.page.evaluate((tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }), AXE_TAGS);
              for (const v of res.violations) report.axe.push({ width, theme, id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(' ')) });
            } finally {
              if (target.ctx !== ctx) await target.ctx.close();
            }
          }
        } finally {
          await ctx.close();
        }
      }
      for (const width of opts.reflow) {
        const { ctx, page } = await open(width, theme);
        try {
          const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
          report.reflow.push({ width, theme, scrollWidth, innerWidth });
        } finally {
          await ctx.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  report.requests = [...requests];
  report.consoleErrors = [...consoleErrors];
  writeFileSync(join(opts.out, `${opts.name}-report.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  const bad = report.reflow.some((r) => r.scrollWidth > r.innerWidth) || report.requests.length || report.consoleErrors.length
    || report.axe.length || report.inside.some((r) => r.outside.length);
  process.exitCode = bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => { console.error(e.message); process.exitCode = 2; });
}
