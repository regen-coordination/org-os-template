// packages/org-os-kms/src/pages/render-entry.mjs — a knowledge page (`public/k/<schema>/<id>.html`) and its steward's
// preview (spec §5.5, §5.6, §6, §7, §8; L4 §8.6, §9.2–9.3, §10.1; gallery §05–06). Pure: one Entry of the page model
// and its commons in, one HTML string out.
//
// Read-only house body: no editor bar, no save state, no presence, no comments. The frame (sidebar, rail, phone bar,
// menu sheet, ⌘K) is the commons index's (render-index.mjs `frame`). The article: meta line, the title — the only
// Fraunces on the page (K-16) —, the description as the lead, one callout (the caveat, or "Deprecated — superseded
// by …", K-25), the body fields in FIELD_MAP order headed by their labels (K-15), the related entries as an embedded
// record block, "Where this comes from", the foot. The aside: About this entry (field rows), Neighbourhood (the small
// map, L4 §8.6), Referenced by.
//
// Public side (rule 1–2, K-13): no clay, no lock, nothing internal — even when handed a preview model, internal rows
// are dropped and counts taken again, so a page citing an internal entry and a page citing nothing are the same
// bytes. The one count the page cannot take again is neighbours.more (rows past the small map's cut, not in the
// model): handed a preview model, it may count internal entries, so the public page shows none. Every href is relative to `k/<schema>/` (`../../…`) or a safe http(s) URL; none starts with `/` (P-8: a
// peer's at:// address shows "from <peer>" with no link).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { page, dataRow, fieldRows, callout, visibility, mark, esc } from '../house/html.mjs';
import { icon } from '../house/icons.mjs';
import { renderSmallMap, mapCss } from '../house/fedmap.mjs';
import { MATURITY_MARK } from './labels.mjs';
import { frame, client, FRAME_CSS, houseGlyph, outHref, plural, time, fontOpts, visible } from './render-index.mjs';

let pageCss = null;
const PAGE_CSS = () => (pageCss ??= readFileSync(fileURLToPath(new URL('../house/css/page.css', import.meta.url)), 'utf8'));

const UP = '../../';
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const counted = (n, one, many) => `${NUM[n] ?? n} ${n === 1 ? one : many}`;

// A link from k/<schema>/: http(s) out as is; a site-root path made relative; anything else (at://, a scheme, `/…`)
// has no link.
function linkFor(h) {
  if (typeof h !== 'string' || !h) return null;
  if (/^https?:\/\//i.test(h)) return outHref(h);
  if (/^[a-z][a-z0-9+.-]*:/i.test(h) || /^[/\\]/.test(h) || /[\u0000- ]/.test(h)) return null;
  return `${UP}${h}`;
}

// ── prose ───────────────────────────────────────────────────────────────────
// A field's text as the canon holds it: an array arrives as lines (a list); blank lines part paragraphs; bare
// http(s) URLs become links (underlined in --edge).
const URL_RE = /https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'”’]/g;
function inline(text) {
  let out = ''; let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const h = outHref(m[0]);
    out += esc(text.slice(last, m.index)) + (h ? `<a href="${esc(h)}">${esc(m[0])}</a>` : esc(m[0]));
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}
const BULLET = /^[-*•]\s+/;
const lines = (b) => b.split('\n').map((l) => l.trim()).filter(Boolean);
const list = (ls) => `<ul>${ls.map((l) => `<li>${inline(l.replace(BULLET, ''))}</li>`).join('')}</ul>`;
function prose(text) {
  const blocks = String(text ?? '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length === 1 && lines(blocks[0]).length > 1) return list(lines(blocks[0]));
  return blocks.map((b) => { const ls = lines(b); return ls.length > 1 && ls.every((l) => BULLET.test(l)) ? list(ls) : `<p>${inline(ls.join(' '))}</p>`; }).join('');
}
const lead = (text) => String(text ?? '').split(/\n\s*\n/).map((b) => lines(b).join(' ')).filter(Boolean).map((p) => `<p class="lead">${inline(p)}</p>`).join('');

// ── rows ────────────────────────────────────────────────────────────────────
const markKey = (m) => (m ? Object.keys(MATURITY_MARK).find((k) => MATURITY_MARK[k].word === m.word && MATURITY_MARK[k].shape === m.shape) : null);
const markOf = (m) => { const k = markKey(m); return k ? mark(k) : ''; };

/**
 * renderEntry(entry, commons, { preview, fonts, now, mapHref }) → HTML string.
 *   entry    one of commons.entries (the page model, model.mjs)
 *   preview  the steward's preview (renders/preview/): band, broken refs in clay with their fix, the lock on
 *            internal entries, a failed peer read in clay
 *   fonts    'house' | 'system' | { mode, embed: 'inline'|'relative', base } (base from the site root)
 *   now      ISO time the pages were generated (an "Updated" date in another year shows its year)
 *   mapHref  where the federation map is, from the site root (omitted: no map link, R-32)
 *   json     false: no JSON links, top bar or foot (the preview writes no API tree, R-33)
 */
export function renderEntry(e, commons, { preview = false, fonts = 'house', now = null, mapHref = null, json: withApi = true } = {}) {
  if (!e) throw new Error('renderEntry: no entry');
  if (!preview && e.internal) throw new Error(`renderEntry: ${e.id} is internal and has no public page`);
  const { entries, kinds } = visible(commons, preview);
  const instance = commons.instance ?? 'Knowledge commons';
  const bySlug = new Map((commons.entries ?? []).map((x) => [x.slug, x]));
  const shown = (r) => preview || !r.internal;
  const glyphOfRow = (r) => { const x = bySlug.get(r.slug); return x ? houseGlyph(x.schema, x.glyphType) : houseGlyph(undefined, r.glyphType); };
  const map = mapHref ? linkFor(mapHref) : null;
  const glyph = houseGlyph(e.schema, e.glyphType);

  const related = (e.related ?? []).filter(shown);
  const backlinks = (e.backlinks ?? []).filter(shown);
  const neighbours = (e.neighbours?.items ?? []).filter(shown);
  // trusted as given only in the preview, or from a public model (no internal entry anywhere in it, none cut here)
  const nearMore = preview || (neighbours.length === (e.neighbours?.items ?? []).length && !(commons.entries ?? []).some((x) => x.internal))
    ? (e.neighbours?.more ?? 0) : 0;
  const broken = preview ? (e.broken ?? []) : [];

  // where a peer's entry comes from: "from <peer> ↗", its read age; in the preview, a failed read in clay
  // In a row (`inRow`) the row itself is the link, so the words carry only the ↗; elsewhere the peer's name links out.
  const fromPeer = (o, { inRow = false } = {}) => {
    if (!o) return '';
    const out = outHref(o.href);
    const who = out && !inRow ? `<a href="${esc(out)}">${esc(o.peer)} ↗</a>` : `${esc(o.peer)}${out ? ' ↗' : ''}`;
    let s = `<span class="ext">${icon('link')}from ${who}</span>`;
    if (preview && o.failed) s += `<span class="age failed">couldn’t read${o.readAge ? ` · last ${esc(o.readAge)} ago` : ''}</span>`;
    else if (o.readAge) s += `<span>read ${esc(o.readAge)} ago</span>`;
    return s;
  };

  // ── the meta line, title, lead, the one callout ───────────────────────────
  const meta = `<div class="kp-meta"><span class="eyebrow">${esc(e.kindLabel)}${e.pageType ? ` · ${esc(e.pageType)}` : ''}</span>`
    + (preview && e.internal ? visibility('internal') : visibility('public'))
    + (preview && e.awaiting ? mark('needs', { word: 'Awaiting review' }) : '')
    + (e.origin ? fromPeer(e.origin) : '')
    + (e.updated ? `<span>Updated ${time(e.updated, now ?? e.updated)}</span>` : '')
    + (backlinks.length ? `<span>${plural(backlinks.length, 'backlink', 'backlinks')}</span>` : '')
    + '</div>';

  let note = '';
  if (e.deprecated) {
    const succ = (commons.entries ?? []).find((x) => e.deprecated.byHref && (x.href === e.deprecated.byHref || x.origin?.href === e.deprecated.byHref));
    const seen = e.deprecated.byTitle && !(succ && succ.internal && !preview);
    const href = seen ? linkFor(e.deprecated.byHref) : null;
    const by = seen ? (href ? `<a href="${esc(href)}">${esc(e.deprecated.byTitle)}</a>` : esc(e.deprecated.byTitle)) : '';
    note = callout({ cls: 'dep', html: by ? `<b>Deprecated</b> — superseded by ${by}.` : '<b>Deprecated.</b> This entry is no longer kept current.' });
  } else if (e.caveat) {
    const i = e.caveat.indexOf('. ');
    note = callout({ cls: 'caveat', html: i > 0 ? `<b>${esc(e.caveat.slice(0, i + 1))}</b> ${esc(e.caveat.slice(i + 2))}` : esc(e.caveat) });
  }

  // ── the body fields, in FIELD_MAP order, headed by their labels ───────────
  const fields = (e.body ?? []).map((b) => `<h2 class="fh" id="f-${esc(b.field)}">${esc(b.label)}</h2>${prose(b.text)}`).join('');

  // ── related: an embedded record block of data rows (preview: broken refs as clay rows) ──
  let relatedHtml = '';
  if (related.length || broken.length) {
    const peers = new Set(related.filter((r) => r.peer).map((r) => r.peer));
    const own = related.filter((r) => !r.peer).length;
    const from = own && peers.size ? `from this commons and ${counted(peers.size, 'peer', 'peers')}` : own ? 'from this commons' : peers.size ? `from ${counted(peers.size, 'peer', 'peers')}` : '';
    const head = `<div class="embed-h">${icon('link', { cls: 'i s14' })}<span>${plural(related.length, 'entry', 'entries')}</span>`
      + `${broken.length ? `<span class="bad">${plural(broken.length, 'broken reference', 'broken references')}</span>` : ''}`
      + `${from ? `<span class="end">${from}</span>` : ''}</div>`;
    const rows = related.map((r) => {
      const peerEntry = r.peer ? bySlug.get(r.slug) : null;
      const sub = [preview && r.internal ? visibility('internal') : '', esc(r.kindLabel),
        r.peer ? fromPeer(peerEntry?.origin ?? { peer: r.peer, href: r.href }, { inRow: true }) : ''].filter(Boolean).join(' ');
      return dataRow({ href: linkFor(r.href), glyph: glyphOfRow(r), dashed: !!r.peer, title: r.title, sub, end: markOf(r.mark), cls: r.mark?.shape === 'closed' ? 'dep' : '' });
    }).join('') + broken.map((b) => `<li><div class="row broken"><span class="ktile attn">${icon('alert')}</span>`
      + `<span class="main"><span class="t"><code>${esc(b.slug)}</code></span><span class="s">${esc(b.fix)}</span></span>`
      + `<span class="end">${mark('needs', { word: 'Broken reference' })}</span></div></li>`).join('');
    relatedHtml = `<h2 class="h-sec" id="h-related">Related</h2><div class="embed">${head}<ul class="rows">${rows}</ul></div>`;
  }

  // ── where this comes from: the sources it cites, as record mentions; how to cite ──
  const sources = [];
  const addSource = (x) => { if (x && shown(x) && !sources.includes(x)) sources.push(x); };
  if (e.cite) for (const x of entries) if (x.schema === 'source-system' && (x.body ?? []).some((b) => b.field === 'how_to_credit' && b.text === e.cite)) addSource(x);
  for (const r of related) { const x = bySlug.get(r.slug); if (x?.schema === 'source-system') addSource(x); }
  let fromHtml = '';
  if (sources.length || e.cite) {
    const mention = (x) => {
      const h = linkFor(x.origin ? x.origin.href : x.href);
      const inner = `${icon(houseGlyph(x.schema, x.glyphType))}${esc(x.title)}`;
      return h ? `<a class="mention rec" href="${esc(h)}">${inner}</a>` : `<span class="mention rec">${inner}</span>`;
    };
    const names = sources.map(mention);
    const joined = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
    fromHtml = `<h2 class="h-sec" id="h-from">Where this comes from</h2>`
      + (joined ? `<p>From ${joined}.</p>` : '')
      + (e.cite ? `<p id="cite">How to cite: ${esc(e.cite)}</p>` : '');
  }

  // ── the foot ──────────────────────────────────────────────────────────────
  const foot = `<footer class="kp-foot"><span>${preview && e.internal ? `Internal to ${esc(instance)} — not published` : `Published by ${esc(instance)}`}</span>`
    + (e.atUri ? `<code class="uri">${esc(e.atUri)}</code>` : '')
    + (withApi ? `<a href="${esc(linkFor(e.apiHref))}">JSON</a>` : '')
    + (e.cite ? '<a href="#cite">How to cite</a>' : '')
    + '</footer>';

  const articleHtml = `<article class="kp-body">${meta}<h1 class="ed-title">${esc(e.title)}</h1>${lead(e.lead)}${note}`
    + `<div class="prose">${fields}</div>${relatedHtml}<div class="prose">${fromHtml}</div>${foot}</article>`;

  // ── the aside: About this entry, Neighbourhood, Referenced by ─────────────
  const rkey = e.atUri ? e.atUri.split('/').filter(Boolean).pop() : '';
  const value = (v) => {
    if (e.mark && v === e.mark.word) return markOf(e.mark);
    if (e.atUri && v === e.atUri) {
      return `<button class="addr" type="button" data-copy="${esc(e.atUri)}" aria-label="Copy the record’s AT URI" title="${esc(e.atUri)}" hidden>`
        + `${esc(rkey)}<span class="ic">${icon('copy', { cls: 'i cp' })}${icon('check', { cls: 'i ok' })}</span></button>`
        + `<code class="addr" data-nojs title="${esc(e.atUri)}">${esc(rkey)}</code>`;
    }
    return esc(v);
  };
  const about = [...(e.about ?? []).map(([l, v]) => [l, value(v)]), ...(e.extra ?? []).map((x) => [x.label, esc(x.value)])];

  const PH = '#kms-nb-';
  const targets = [];
  const nb = neighbours.map((r, i) => {
    const h = linkFor(r.href);
    if (h) targets[i] = h;
    return { id: r.slug, name: r.title, glyph: glyphOfRow(r), href: h ? `${PH}${i}` : null, away: !!r.peer };
  });
  // renderSmallMap's own link check (federation-map safeUrl) admits only http(s) and same-origin paths that start with
  // `/`; this page's links are relative (`../../…`). The map is drawn with placeholder fragments and each is swapped
  // for the link linkFor() already checked.
  let mini = neighbours.length
    ? renderSmallMap({ name: e.title, glyph }, nb, { more: nearMore, moreHref: map ? `${PH}more` : undefined })
    : '';
  mini = mini.replace(new RegExp(`href="${PH}(\\d+|more)"`, 'g'), (_, k) => `href="${esc(k === 'more' ? map : targets[Number(k)])}"`);

  const refRows = backlinks.map((r) => dataRow({ href: linkFor(r.href), glyph: glyphOfRow(r), dashed: !!r.peer, title: r.title,
    sub: preview && r.internal ? visibility('internal') : '', cls: r.mark?.shape === 'closed' ? 'dep compact' : 'compact' })).join('');

  const asideHtml = `<aside class="kp-aside" aria-label="About this entry">`
    + `<section aria-labelledby="h-about"><h2 id="h-about">About this entry</h2>${fieldRows(about)}</section>`
    + (mini ? `<section aria-labelledby="h-near"><h2 id="h-near">Neighbourhood</h2>${mini}</section>` : '')
    + (refRows ? `<section aria-labelledby="h-refs"><h2 id="h-refs">Referenced by <span class="faint">${backlinks.length}</span></h2><ul class="rows surf">${refRows}</ul></section>` : '')
    + '</aside>';

  const kindHref = `${UP}k/${e.schema}/index.html`;
  const kindKnown = kinds.some((k) => k.schema === e.schema);
  const crumbs = `<a href="${UP}index.html">Commons</a><span class="slash" aria-hidden="true"></span>`
    + (kindKnown ? `<a href="${kindHref}">${esc(e.kindLabel)}</a>` : `<span>${esc(e.kindLabel)}</span>`)
    + `<span class="slash" aria-hidden="true"></span><b aria-current="page">${esc(e.title)}</b>`;
  const tools = withApi ? `<a class="btn sm ghost has-ico" href="${esc(linkFor(e.apiHref))}">${icon('braces')}JSON</a>` : '';

  const bodyHtml = frame({
    instance, did: commons.did, kinds, total: entries.length, up: UP, current: kindKnown ? e.schema : null, preview, map,
    crumbs, tools, where: e.kindLabel, skip: 'Skip to the entry', api: withApi,
    main: `<main id="main"><div class="content kpage"><div class="kp-grid">${articleHtml}${asideHtml}</div></div></main>`,
  });

  return page({
    title: `${preview ? 'Preview · ' : ''}${e.title} · ${instance}`, groups: ['base', 'atoms', 'rows'],
    extraCss: [FRAME_CSS(), mapCss(), PAGE_CSS()], ...fontOpts(fonts, UP),
    icons: ['file', 'x', 'search', 'list', 'map', ...kinds.map((k) => k.glyph)], body: bodyHtml,
    script: `(${client})();(${copyClient})();`,
  });
}

// The record chip copies the AT URI (L4 §7.5): the glyph turns to a check, a polite "Copied", back after 1.6s.
// Without a script the chip is plain text (the copy button stays `hidden`). Serialised into the page: closes over
// nothing in this module.
export function copyClient() {
  const doc = document;
  const live = doc.getElementById('live');
  const put = (t) => (navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(t) : Promise.reject(new Error('no clipboard')));
  const fallback = (t) => {
    const ta = doc.createElement('textarea');
    ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    doc.body.append(ta); ta.select();
    let ok = false;
    try { ok = doc.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  };
  doc.querySelectorAll('[data-nojs]').forEach((n) => n.remove());
  for (const b of doc.querySelectorAll('button[data-copy]')) {
    b.hidden = false;
    let timer = 0;
    b.addEventListener('click', () => {
      const t = b.dataset.copy;
      const done = () => {
        b.setAttribute('data-copied', '');
        if (live) live.textContent = live.textContent === 'Copied the record’s AT URI' ? 'Copied the record’s AT URI ' : 'Copied the record’s AT URI';
        clearTimeout(timer);
        timer = setTimeout(() => b.removeAttribute('data-copied'), 1600);
      };
      put(t).then(done, () => { if (fallback(t)) done(); b.focus(); });
    });
  }
}
