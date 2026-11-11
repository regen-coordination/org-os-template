// src/house/fonts.mjs
// The three house fonts (Fraunces roman, Geist, Geist Mono; Latin subset, OFL), vendored in
// assets/fonts/ and turned into @font-face CSS. No kms page ever asks a font host for anything.
//   house  + inline   → data: URIs (single-file outputs)
//   house  + relative → `${base}<file>` (written pages; copyFonts puts the files there)
//   system            → '' (the token stacks fall back)
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'fonts');

export const FONT_CSS_CAP = 512 * 1024;

export const FONT_FILES = [
  { family: 'Fraunces', file: 'fraunces-latin-normal.woff2', weight: '300 600', style: 'normal' },
  { family: 'Geist', file: 'geist-latin.woff2', weight: '400 600', style: 'normal' },
  { family: 'Geist Mono', file: 'geist-mono-latin.woff2', weight: '400 500', style: 'normal' },
];

const LICENCES = ['OFL-Fraunces.txt', 'OFL-Geist.txt'];

// Latin range, as in the admin fonts.css the files come from.
const LATIN_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

export function fontFaceCss({ mode = 'house', embed = 'inline', base = '_kms/fonts/' } = {}) {
  if (mode === 'system') return '';
  return FONT_FILES.map((f) => {
    const src = embed === 'relative'
      ? `${base}${f.file}`
      : `data:font/woff2;base64,${readFileSync(join(ASSETS, f.file)).toString('base64')}`;
    return `@font-face {
  font-family: "${f.family}";
  font-style: ${f.style || 'normal'};
  font-weight: ${f.weight};
  font-display: swap;
  src: url("${src}") format("woff2");
  unicode-range: ${LATIN_RANGE};
}
`;
  }).join('\n');
}

export function copyFonts(destDir) {
  mkdirSync(destDir, { recursive: true });
  const names = [...FONT_FILES.map((f) => f.file), ...LICENCES];
  for (const n of names) copyFileSync(join(ASSETS, n), join(destDir, n));
  return names;
}
