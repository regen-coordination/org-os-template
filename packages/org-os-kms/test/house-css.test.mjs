// The raw-value guard for kms's house stylesheets (spec §3.1, L4 §3; plan Task 12).
// Tokens only: no colour literal, every custom property defined in house-tokens.css, transitions
// name their properties, hover only where hover exists, deprecated rows never --o-dim (K-25, R-7),
// status words under 420px clipped, never display:none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const houseDir = join(here, '..', 'src', 'house');
const cssDir = join(houseDir, 'css');
const MAP_CSS_PATH = join(here, '..', '..', 'org-os-federation-map', 'src', 'map.css');

const GROUPS = ['base', 'atoms', 'rows', 'art'];
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const houseFiles = () => readdirSync(cssDir).filter((f) => f.endsWith('.css')).sort();
const read = (f) => stripComments(readFileSync(join(cssDir, f), 'utf8'));
const tokensCss = () => readFileSync(join(houseDir, 'house-tokens.css'), 'utf8');

// Blocks: [{ prelude, body, ancestors: [prelude…] }] for every rule and at-rule, by brace walking.
function blocks(css) {
  const out = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') {
      const prelude = css.slice(start, i).split(';').pop().trim();
      stack.push({ prelude, open: i, ancestors: stack.map((s) => s.prelude) });
      start = i + 1;
    } else if (c === '}') {
      const b = stack.pop();
      if (b) out.push({ prelude: b.prelude, body: css.slice(b.open + 1, i), ancestors: b.ancestors });
      start = i + 1;
    }
  }
  return out;
}

test('the four groups exist: base, atoms, rows, art', () => {
  for (const g of GROUPS) assert.ok(houseFiles().includes(`${g}.css`), g);
});

test('no colour literal in any src/house/css/*.css or map.css (same regexes as Task 7)', () => {
  const named = /(?<![\w-])(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|silver|gold|navy|teal|maroon|olive|lime|aqua|fuchsia|canvastext|canvas|buttontext|highlight|graytext)(?![\w-])/i;
  const files = [...houseFiles().map((f) => [f, read(f)]), ['map.css', stripComments(readFileSync(MAP_CSS_PATH, 'utf8'))]];
  for (const [f, css] of files) {
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, f);
    assert.doesNotMatch(css, /rgba?\(|hsla?\(/i, f);
    assert.doesNotMatch(css, named, f);
  }
});

test('every var(--x) used in the house groups and map.css is defined in house-tokens.css', () => {
  const defined = new Set([...tokensCss().matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  const files = [...houseFiles().map((f) => [f, read(f)]), ['map.css', stripComments(readFileSync(MAP_CSS_PATH, 'utf8'))]];
  for (const [f, css] of files) {
    const used = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]));
    assert.ok(used.size > 0, f);
    for (const v of used) assert.ok(defined.has(v), `${f}: ${v} is not a house token`);
  }
});

test('no transition names all', () => {
  for (const f of houseFiles()) {
    assert.doesNotMatch(read(f), /transition(-property)?\s*:[^;}]*(?<![\w-])all(?![\w-])/i, f);
  }
});

test('hover rules only inside @media (hover: hover)', () => {
  let hovers = 0;
  for (const f of houseFiles()) {
    for (const b of blocks(read(f))) {
      if (b.prelude.startsWith('@') || !/:hover\b/.test(b.prelude)) continue;
      hovers++;
      assert.ok(b.ancestors.some((a) => /^@media[^{]*\(hover:\s*hover\)/.test(a)), `${f}: ${b.prelude}`);
    }
  }
  assert.ok(hovers > 0, 'the groups have hover states (buttons, rows)');
});

test('kms CSS never uses --o-dim (K-25, R-7): deprecated rows are mute/faint text and an outlined tile', () => {
  for (const f of houseFiles()) assert.ok(!read(f).includes('--o-dim'), f);
  const rows = blocks(read('rows.css'));
  const rule = (sel) => rows.filter((b) => b.prelude.split(',').map((s) => s.trim()).includes(sel)).map((b) => b.body).join(';');
  assert.match(rule('.row.dep .t'), /color:\s*var\(--mute\)/);
  assert.match(rule('.row.dep .s'), /color:\s*var\(--faint\)/);
  assert.match(rule('.row.dep .ktile'), /background:\s*transparent/);
  assert.match(rule('.row.dep .ktile'), /border:[^;]*solid/);
  assert.doesNotMatch(rows.filter((b) => b.prelude.includes('.dep')).map((b) => b.body).join(';'), /opacity/);
});

// WCAG relative luminance of #rrggbb
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('the deprecated row’s text tokens keep AA contrast on the row surface, light and dark (K-25)', () => {
  const css = tokensCss();
  const light = css.slice(0, css.indexOf('@media'));
  const dark = css.slice(css.indexOf('[data-theme="dark"]'));
  const val = (block, name) => {
    const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'));
    return m ? m[1] : val(light, name); // dark falls back to light where it does not redefine
  };
  for (const [which, block] of [['light', light], ['dark', dark]]) {
    for (const fg of ['--mute', '--faint']) {
      for (const bg of ['--raised', '--paper', '--sunken']) {
        const r = contrast(val(block, fg), val(block, bg));
        assert.ok(r >= 4.5, `${which}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
      }
    }
  }
});

test('status words under 420px of row width are visually hidden (clipped), never display:none', () => {
  const rows = blocks(read('rows.css'));
  const at420 = rows.filter((b) => b.ancestors.some((a) => /^@container[^{]*max-width:\s*420px/.test(a)));
  for (const b of rows.filter((x) => x.prelude.startsWith('@container'))) assert.match(b.prelude, /^@container [a-z-]+ \(/, `named: ${b.prelude}`);
  assert.ok(at420.length > 0, 'rows.css has a 420px container block');
  for (const b of at420) assert.doesNotMatch(b.body, /display:\s*none/, b.prelude);
  const hide = at420.find((b) => /\.c-mark \.w\b/.test(b.prelude));
  assert.ok(hide, 'a 420px rule targets the mark’s word');
  assert.match(hide.body, /position:\s*absolute/);
  assert.match(hide.body, /clip-path:\s*inset\(50%\)/);
  assert.match(hide.body, /overflow:\s*hidden/);
  // and the date column, not the word, is what goes at 600
  const at600 = rows.filter((b) => b.ancestors.some((a) => /^@container[^{]*max-width:\s*600px/.test(a)));
  assert.ok(at600.some((b) => /display:\s*none/.test(b.body) && !/\.w\b/.test(b.prelude)));
});

test('base carries the shared rules: optical sizing, focus ring, skip link, sr-only, wrap, tabular figures, reduced motion', () => {
  const css = read('base.css');
  assert.match(css, /font-optical-sizing:\s*auto/);
  assert.match(css, /-webkit-font-smoothing:\s*antialiased/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*var\(--focus-w\) solid var\(--focus\)/);
  assert.match(css, /\.skip/);
  assert.match(css, /\.sr-only\s*\{[^}]*clip-path:\s*inset\(50%\)/);
  assert.match(css, /text-wrap:\s*balance/);
  assert.match(css, /text-wrap:\s*pretty/);
  assert.match(css, /tabular-nums/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test('the artifact bar is the spec §5.1 frame: 52px bar, seal on --solid, Sans 600 14 name, Mono time', () => {
  const css = read('art.css');
  assert.match(css, /\.art-bar\s*\{[^}]*min-height:\s*var\(--h-topbar\)/);
  assert.match(css, /\.seal\s*\{[^}]*background:\s*var\(--solid\)/);
  assert.match(css, /font:\s*var\(--fw-strong\) var\(--fs-body\)\/[^ ]+ var\(--sans\)/);
  assert.match(css, /\.art-bar[^{]*time\s*\{[^}]*var\(--mono\)/);
});

test('the date column is --w-dt; field rows stack by their own named container; no unscoped Fraunces class (K-16)', () => {
  const rows = read('rows.css');
  assert.match(rows, /\.krow \{[^}]*132px var\(--w-dt\)/);
  assert.match(rows, /\.fields-box \{[^}]*container:\s*fields \/ inline-size/);
  assert.match(rows, /@container fields \(max-width: 420px\)/);
  for (const f of houseFiles()) {
    assert.doesNotMatch(read(f), /(^|[\s,}])\.serif\b/, f);
    // the knowledge page's title (page.css `.ed-title`, Task 18) is the one house rule that may set Fraunces
    const display = blocks(read(f)).filter((b) => /var\(--display\)/.test(b.body)).map((b) => b.prelude);
    assert.deepEqual(display, f === 'page.css' ? ['.ed-title'] : [], `${f}: Fraunces belongs to the page title and the map's centre node only`);
  }
});
