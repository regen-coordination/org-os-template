import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_FILES, FONT_CSS_CAP, fontFaceCss, copyFonts } from '../src/house/fonts.mjs';
import { loadKmsConfig } from '../src/config.mjs';
import { writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'assets', 'fonts');
const adminDir = join(here, '..', '..', 'admin', 'app', 'src', 'design', 'fonts');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

test('each font file starts with wOF2', () => {
  assert.equal(FONT_FILES.length, 3);
  for (const f of FONT_FILES) {
    assert.equal(readFileSync(join(assets, f.file)).subarray(0, 4).toString('latin1'), 'wOF2', f.file);
  }
});

test('bytes equal the admin copies when present', (t) => {
  if (!existsSync(adminDir)) return t.skip('packages/admin font folder absent (kms vendored alone)');
  for (const f of [...FONT_FILES.map((x) => x.file), 'OFL-Fraunces.txt', 'OFL-Geist.txt']) {
    assert.equal(sha(join(assets, f)), sha(join(adminDir, f)), f);
  }
});

test('inline CSS has three @font-face with the exact families, within the cap', () => {
  const css = fontFaceCss({ mode: 'house', embed: 'inline' });
  assert.equal((css.match(/@font-face/g) || []).length, 3);
  for (const fam of ['Fraunces', 'Geist', 'Geist Mono']) assert.ok(css.includes(`font-family: "${fam}";`), fam);
  assert.equal((css.match(/data:font\/woff2;base64,/g) || []).length, 3);
  assert.ok(css.includes('font-display: swap'));
  assert.ok(css.includes('unicode-range: U+0000-00FF'));
  const bytes = Buffer.byteLength(css);
  console.log(`inline @font-face block: ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB); cap ${FONT_CSS_CAP}`);
  assert.ok(bytes <= FONT_CSS_CAP);
});

test('system mode yields an empty string', () => {
  assert.equal(fontFaceCss({ mode: 'system' }), '');
  assert.equal(fontFaceCss({ mode: 'system', embed: 'relative' }), '');
});

test('relative mode references _kms/fonts/<file> and embeds no data', () => {
  const css = fontFaceCss({ mode: 'house', embed: 'relative' });
  for (const f of FONT_FILES) assert.ok(css.includes(`url("_kms/fonts/${f.file}")`), f.file);
  assert.ok(!css.includes('data:'));
  assert.ok(fontFaceCss({ embed: 'relative', base: '../_kms/fonts/' }).includes('url("../_kms/fonts/geist-latin.woff2")'));
});

test('copyFonts writes the three fonts and two licences', () => {
  const dest = mkdtempSync(join(tmpdir(), 'kms-fonts-'));
  const written = copyFonts(dest).sort();
  assert.deepEqual(written, [
    'OFL-Fraunces.txt', 'OFL-Geist.txt', 'fraunces-latin-normal.woff2', 'geist-latin.woff2', 'geist-mono-latin.woff2',
  ]);
  for (const w of written) assert.equal(sha(join(dest, w)), sha(join(assets, w)));
});

test('no font host appears in any file under src/', () => {
  const walk = (d) => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const re = /fonts\.googleapis|fonts\.gstatic|typekit|bunny/i;
  for (const p of walk(join(here, '..', 'src'))) {
    if (/\.(woff2?|png|jpe?g)$/.test(p)) continue;
    assert.ok(!re.test(readFileSync(p, 'utf8')), p);
  }
});

test('loadKmsConfig defaults render.fonts to house and keeps system', () => {
  const mk = (extra) => {
    const dir = mkdtempSync(join(tmpdir(), 'kms-fontscfg-'));
    writeFileSync(join(dir, 'kms.yaml'), `instance: t\nadapter: repo-data\ntarget: "."\n${extra}`);
    return dir;
  };
  assert.equal(loadKmsConfig(mk('')).render.fonts, 'house');
  assert.equal(loadKmsConfig(mk('render:\n  fonts: system\n')).render.fonts, 'system');
  assert.equal(loadKmsConfig(mk('render:\n  other: 1\n')).render.fonts, 'house');
});
