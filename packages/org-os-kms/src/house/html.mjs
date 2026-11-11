// src/house/html.mjs — the house page shell, atoms and rows as HTML strings (spec §4, §5.1, §8;
// L4 §6.1, §7, §9.2–9.3). Every kms surface builds on these: the vault map artifact, the commons index
// and knowledge pages, and (by sibling path) the packs report and the territory explorer.
//
// Pure: no DOM, no clock (callers pass `now`), no network. Text arguments are escaped here; arguments
// documented as html are inserted as given (the caller built them from these helpers or escaped them).
// A page is one document: one <style> (tokens, the CSS groups asked for, the fonts, extra CSS), one
// sprite, nothing fetched.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fontFaceCss } from './fonts.mjs';
import { ICONS, iconSprite, icon } from './icons.mjs';
import { age } from './fedmap.mjs';
import { MATURITY_MARK } from '../pages/labels.mjs';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

// Links are an allow-list. Browsers drop tabs, newlines and leading C0 controls from a URL, so
// `java\tscript:` runs as `javascript:`; every U+0000–U+0020 is stripped before the test, and the
// cleaned value is what is emitted. Browsers also read `\` as `/` in a URL (`/\host`, `\\host` are
// another host), so any `\` is refused. Allowed: http(s), obsidian and mailto; `#…`, `?…`; `/…` (not
// `//…`, another host), `./…`, `../…`; and a bare relative path with no `:` before its first `/`, `?`
// or `#`. Everything else is null (the row is drawn without a link).
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const SAFE_SCHEMES = new Set(['http', 'https', 'obsidian', 'mailto']);
export function safeHref(u) {
  if (typeof u !== 'string') return null;
  const s = u.replace(/[\u0000-\u0020]/g, '');
  if (!s || s.includes('\\')) return null;
  if (/^[#?]/.test(s) || /^\.{1,2}\//.test(s)) return s;
  if (s.startsWith('/')) return s.startsWith('//') ? null : s;
  const m = s.match(SCHEME);
  if (m) return SAFE_SCHEMES.has(m[1].toLowerCase()) ? s : null;
  return s.split(/[/?#]/, 1)[0].includes(':') ? null : s;
}

// ── CSS ─────────────────────────────────────────────────────────────────────

const GROUPS = ['base', 'atoms', 'rows', 'art'];
const cssCache = new Map();
function cssFile(rel) {
  if (!cssCache.has(rel)) cssCache.set(rel, readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
  return cssCache.get(rel);
}

// tokens + the group files, in the order asked, + extra CSS strings
export function houseCss(groups = GROUPS, { extra = [] } = {}) {
  const parts = [cssFile('./house-tokens.css')];
  for (const g of groups) {
    if (!GROUPS.includes(g)) throw new Error(`unknown css group: ${g}`);
    parts.push(cssFile(`./css/${g}.css`));
  }
  for (const x of extra) if (x) parts.push(x);
  return parts.join('\n');
}

// ── the page ────────────────────────────────────────────────────────────────

// Inline code: only `</script` ends the element, so that alone is escaped (`<\/script` reads the same).
const scriptSafe = (code) => String(code).replace(/<\/(script)/gi, '<\\/$1');

export function page({ title, lang = 'en', groups = GROUPS, extraCss = [], fonts = 'house', fontEmbed = 'inline', fontBase,
  icons = [], body = '', script = '', bodyClass = '' } = {}) {
  const css = houseCss(groups, { extra: [fontFaceCss({ mode: fonts, embed: fontEmbed, base: fontBase }), ...extraCss] });
  // the sprite: what the caller asked for, plus every glyph the body references
  const used = [...String(body).matchAll(/href="#i-([a-z0-9-]+)"/g)].map((m) => m[1]).filter((n) => Object.hasOwn(ICONS, n));
  return `<!DOCTYPE html>
<html lang="${esc(lang)}" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
${css}
</style>
</head>
<body${bodyClass ? ` class="${esc(bodyClass)}"` : ''}>
${iconSprite([...icons, ...used])}
${body}
${script ? `<script>${scriptSafe(script)}</script>\n` : ''}</body>
</html>
`;
}

// The artifact bar (spec §5.1): seal on --solid, the instance name, a sub line (html; a <time> in it is
// set in Mono), trailing tools (html).
export function artBar({ name, sub = '', tools = '' }) {
  return `<header class="art-bar"><span class="seal">${icon('seal')}</span>`
    + `<div class="what"><h1 class="art-name">${esc(name)}</h1>${sub ? `<span class="art-sub">${sub}</span>` : ''}</div>`
    + `${tools ? `<div class="tools">${tools}</div>` : ''}</header>`;
}

// ── atoms ───────────────────────────────────────────────────────────────────

// L4 §6.1 marks other than the maturity ones, with their default words.
const L4_MARKS = Object.freeze({
  needs: 'Needs you', staged: 'Staged', stale: 'Changed since staged', open: 'Open', ok: 'Up to date',
  done: 'Decided', running: 'Reading…', failed: 'Couldn’t read', closed: 'Withdrawn', aged: 'Old read',
});

// Spec §4-6: a maturity (or an L4 mark) as its shape, aria-hidden, and its word as text. `wordless`
// keeps the word for screen readers only.
export function mark(maturity, { wordless = false, word } = {}) {
  let shape, w;
  if (Object.hasOwn(MATURITY_MARK, maturity)) ({ shape, word: w } = MATURITY_MARK[maturity]);
  else if (Object.hasOwn(L4_MARKS, maturity)) { shape = maturity; w = L4_MARKS[maturity]; }
  else throw new Error(`unknown mark: ${maturity}`);
  return `<span class="sm ${shape}"><i aria-hidden="true"></i><span class="${wordless ? 'sr-only' : 'w'}">${esc(word ?? w)}</span></span>`;
}

// L4 §7.10: globe "Public"; lock "Internal only" (the steward's preview).
const VIS = { public: ['globe', 'Public'], internal: ['lock', 'Internal only'] };
export function visibility(kind) {
  if (!Object.hasOwn(VIS, kind)) throw new Error(`unknown visibility: ${kind}`);
  return `<span class="vis">${icon(VIS[kind][0])}${VIS[kind][1]}</span>`;
}

// L4 §7.14: the kind glyph on a wash tile; dashed for what comes from a peer.
export function kindTile(glyph, { dashed = false } = {}) {
  return `<span class="ktile${dashed ? ' dashed' : ''}">${icon(glyph)}</span>`;
}

// L4 §7.4: the one line for empty, loading, error, not-yet. `tone`: '' | 'empty' | 'error'.
export function note(text, { glyph = 'info', tone = '' } = {}) {
  return `<p class="note${tone ? ` ${esc(tone)}` : ''}">${icon(glyph)}<span>${esc(text)}</span></p>`;
}

// House §10.1 callout (a page's caveat): glyph + html.
export function callout({ glyph = 'info', html, cls = '' }) {
  return `<div class="callout${cls ? ` ${esc(cls)}` : ''}">${icon(glyph)}<div>${html}</div></div>`;
}

// House §5.9 band, static (preview / view as): eye + html + an optional action (html).
export function band({ html, action = '', glyph = 'eye' }) {
  return `<div class="band static">${icon(glyph)}<span>${html}</span>${action}</div>`;
}

// L4 §7.9 read age, relative: 'Read 4 min ago', 'Read 2 h ago', 'Read 3 d ago'; '' when unknown.
export function readAge(iso, now) {
  const a = age(iso, now);
  return a ? `Read ${a} ago` : '';
}

// ── rows ────────────────────────────────────────────────────────────────────

// L4 §9.2 data row, inside <ul class="rows">. title is text; sub, markHtml and end are html. With a
// mark the row is a `krow`: tile · main · mark column · end column (the end — a date — drops under
// 600px of row width; the mark's word is visually hidden under 420px). Deprecated rows pass
// cls: 'dep' (closed mark, mute title, faint second line, outlined tile — K-25).
export function dataRow({ href, glyph, dashed = false, title, sub = '', end = '', markHtml = '', cls = '' }) {
  const link = safeHref(href);
  const classes = ['row', markHtml ? 'krow' : '', cls].filter(Boolean).join(' ');
  const inner = kindTile(glyph, { dashed })
    + `<span class="main"><span class="t">${esc(title)}</span>${sub ? `<span class="s">${sub}</span>` : ''}</span>`
    + `${markHtml ? `<span class="c-mark">${markHtml}</span>` : ''}<span class="end">${end}</span>`;
  return link
    ? `<li><a class="${esc(classes)}" href="${esc(link)}">${inner}</a></li>`
    : `<li><div class="${esc(classes)}">${inner}</div></li>`;
}

// A group head inside the same list: label, count, optional end (html, e.g. an "All 31" link).
export function groupRow({ label, count, end = '' }) {
  return `<li class="grp-h"><span>${esc(label)}</span><span class="c">${esc(count)}</span>${end ? `<span class="end">${end}</span>` : ''}</li>`;
}

// L4 §9.3 field rows: [[label (text), value (html)]] → <dl> in a box that is its own container
// (`fields`), so labels stack above values when the box, not some ancestor, is under 420px.
export function fieldRows(pairs = []) {
  return `<div class="fields-box"><dl class="fields">${pairs.map(([l, v]) => `<dt>${esc(l)}</dt><dd>${v}</dd>`).join('')}</dl></div>`;
}
