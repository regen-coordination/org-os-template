// packages/org-os-kms/src/pages/model.mjs — the page model for the opt-in commons pages (spec §5.4–5.6). PURE:
// no file reads, no clock (`now` is passed in), no HTML. Later tasks render it (index, knowledge page, writer, preview).
//
// Rule 2 / K-13: on the public side a ref to an internal entry and a ref to nothing are the same thing — dropped —
// in related, backlinks, neighbours and counts, so a reader can never learn that a private entry exists. Only the
// steward's preview lists internal entries and broken refs.
import * as fw from '../framework.mjs';
import { publicViewOf } from '../claims.mjs';
import { FIELD_MAP } from '../atproto/standard-site.mjs';
import { REF_ARRAY_FIELDS } from '../refs.mjs';
import { slugFromRef } from '../manifest.mjs';
import { labelFor, kindLabel, MATURITY_MARK, CAVEATS, glyphFor, publicUseWord } from './labels.mjs';
// the map's age words ("10 min", "2 h", "3 d"): one clock vocabulary across the house. This module is loaded only
// with the pages, which draw anyway (R-38), so reaching the map package here costs nothing vendored alone.
import { age } from '../house/fedmap.mjs';

const BROKEN_FIX = 'No entry with this name. Fix the reference or publish the entry.';
const NEIGHBOURS_MAX = 6;
const SUMMARY_MAX = 240;
// Fields that are shown elsewhere on the page (head, aside, relations) or never as a field row.
const NOT_EXTRA = new Set(['title', 'type', 'id', 'page_type', 'maturity', 'public_use', 'lifecycle_state', 'ai_assisted', 'high_risk',
  'domain', 'function', 'source_lineage', 'source_system', 'steward', 'review_needs', 'last_reviewed', 'currentness', 'audience', 'grc20Id',
  'sourceUri', 'viaUri', 'url', 'superseded_by', 'updated', 'provenance', ...REF_ARRAY_FIELDS]);

const asText = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).join('\n') : typeof v === 'string' ? v.trim() : '');
const oneLine = (s) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > SUMMARY_MAX ? `${t.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : t; };
const scalar = (v) => ['string', 'number', 'boolean'].includes(typeof v);
const safeHttp = (u) => { if (typeof u !== 'string') return null; try { const p = new URL(u).protocol; return p === 'http:' || p === 'https:' ? u : null; } catch { return null; } };
const hostOf = (u) => { try { return new URL(u).host; } catch { return null; } };
const didOf = (uri) => uri.slice('at://'.length).split('/')[0];

export function buildCommons({ items, allItems = items, manifest, config = {}, knowledge = null, reads = {}, now, mode = 'public' }) {
  const preview = mode === 'preview';
  const ownDid = config.atproto?.did ?? knowledge?.did ?? null;
  const entities = fw.extensionEntities?.() ?? {};
  const publicRefs = new Set(items.map((i) => i.ref));
  const pool = preview
    ? [...allItems, ...items.filter((i) => !allItems.includes(i))].filter((i) => i.schema !== 'person')
    : items;
  const ownUris = new Set(Object.values(manifest?.objects ?? {}).map((m) => m.atUri).filter(Boolean));

  // ── pass 1: one entry per item, without relations ───────────────────────────
  const entries = pool.map((it) => {
    const { schema, ref } = it;
    const o = publicViewOf(it.object, { schema, publisher: config.publish?.claim_publisher });
    const slug = slugFromRef(ref);
    const id = String(o.id ?? slug);
    const settings = config.atproto?.standard_site;
    const map = { ...(FIELD_MAP[schema] || {}), ...(settings?.fields?.[schema] || {}) };
    const pack = (config.packs || []).find((p) => (p.manifest?.types || p.types || []).includes(schema)) ?? null;
    const lab = (f) => labelFor(f, { config, pack });
    // `lead` is the whole description (what the page renders as its lead); `summary` is its one-line form for rows.
    const lead = asText(o[map.description ?? 'summary'] ?? o.description ?? '');
    const summary = oneLine(lead);
    const shown = new Set([map.description, ...(map.body || [])].filter(Boolean));
    const body = (map.body || []).filter((f) => f !== map.description).map((f) => ({ field: f, label: lab(f), text: asText(o[f]) })).filter((b) => b.text);
    const extra = Object.entries(o).filter(([k]) => !NOT_EXTRA.has(k) && !shown.has(k)).flatMap(([k, v]) => {
      const val = Array.isArray(v) ? (v.every(scalar) ? v.join(', ') : '') : scalar(v) ? String(v) : '';
      return val ? [{ label: lab(k), value: val }] : [];
    });
    const url = safeHttp(o.url) ?? safeHttp(o.sourceUri);
    let origin = null;
    if (typeof o.sourceUri === 'string' && o.sourceUri && !(o.sourceUri.startsWith('at://') && didOf(o.sourceUri) === ownDid)) {
      const did = o.sourceUri.startsWith('at://') ? didOf(o.sourceUri) : null;
      const conn = (config.connectors || []).find((c) => (did && c.config?.peers?.includes(did)) || (c.config?.base_url && o.sourceUri.startsWith(c.config.base_url)));
      const rd = reads?.[conn?.name] ?? reads?.[did] ?? null;
      origin = {
        peer: config.peers?.[did]?.name ?? (url && hostOf(url)) ?? did ?? hostOf(o.sourceUri) ?? 'a peer',
        href: url,
        readAge: rd?.ok_at ? age(rd.ok_at, now) : null,
        failed: preview && !!rd?.error,
      };
      origin._read = !!rd?.ok_at ? (conn?.name ?? did) : null;
    }
    const internal = preview && !publicRefs.has(ref);
    const mat = MATURITY_MARK[o.maturity] ?? null;
    const atUri = manifest?.objects?.[id]?.atUri ?? null;
    const updated = typeof (o.updated ?? o.last_reviewed) === 'string' ? (o.updated ?? o.last_reviewed).slice(0, 10) : null;
    const e = {
      schema, id, slug, title: String(o.title ?? slug), summary, lead, kindLabel: kindLabel(schema), glyphType: glyphFor(schema, entities),
      pageType: o.page_type ?? null, maturity: o.maturity ?? null, mark: mat, publicUse: o.public_use ?? null,
      caveat: CAVEATS[o.public_use] ?? null, deprecated: null, updated,
      href: `k/${schema}/${id}.html`, apiHref: `api/${schema}/${id}.json`, atUri, internal,
      awaiting: preview && fw.isAwaitingReview(it.object), origin, body, extra,
      related: [], backlinks: [], neighbours: { items: [], more: 0 }, about: [], cite: null,
      _o: o, _lab: lab,
    };
    if (preview) e.broken = [];
    return e;
  }).sort((a, b) => a.kindLabel.localeCompare(b.kindLabel) || a.title.localeCompare(b.title));

  // ── resolution: slug / id / own AT URI / a peer copy's sourceUri → entry ────
  const bySlug = new Map(); const byId = new Map(); const byUri = new Map();
  for (const e of entries) {
    if (!bySlug.has(e.slug)) bySlug.set(e.slug, e);
    byId.set(e.id, e);
    if (e.atUri) byUri.set(e.atUri, e);
    for (const u of [e._o.sourceUri, e._o.viaUri]) if (typeof u === 'string' && !byUri.has(u)) byUri.set(u, e);
  }
  const lite = (e) => ({ slug: e.slug, title: e.title, kindLabel: e.kindLabel, glyphType: e.glyphType, href: e.origin ? e.origin.href : e.href, peer: e.origin ? e.origin.peer : null, mark: e.mark, ...(preview ? { internal: e.internal } : {}) });
  // → { entry } | { row } | null (unresolved: dropped publicly, "broken" in the preview)
  const resolve = (ref) => {
    if (typeof ref !== 'string' || !ref.trim()) return null;
    if (ref.startsWith('at://')) {
      if (byUri.has(ref)) return { entry: byUri.get(ref) };
      if (didOf(ref) === ownDid || ownUris.has(ref)) return null;
      const rkey = ref.split('/').filter(Boolean).pop();
      return { row: { slug: rkey, title: rkey, kindLabel: 'Entry', glyphType: 'file', href: null, peer: didOf(ref), mark: null } };
    }
    const hit = bySlug.get(ref) ?? byId.get(ref);
    return hit ? { entry: hit } : null;
  };

  // ── pass 2: relations ──────────────────────────────────────────────────────
  const incoming = new Map(entries.map((e) => [e, []]));
  for (const e of entries) {
    const seen = new Set();
    for (const f of REF_ARRAY_FIELDS) for (const ref of [].concat(e._o[f] ?? [])) {
      const r = resolve(ref);
      if (!r) { if (preview && typeof ref === 'string' && ref.trim() && !e.broken.some((b) => b.slug === ref)) e.broken.push({ slug: ref, fix: BROKEN_FIX }); continue; }
      const row = r.entry ? lite(r.entry) : r.row;
      const key = r.entry ? `e:${r.entry.id}` : `p:${ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      e.related.push(row);
      if (r.entry && r.entry !== e) incoming.get(r.entry).push(e);
    }
    const sup = e._o.superseded_by;
    if (e.maturity === 'deprecated' || e.publicUse === 'deprecated') {
      const s = resolve(sup);
      e.deprecated = { byTitle: s?.entry?.title ?? null, byHref: s?.entry ? (s.entry.origin ? s.entry.origin.href : s.entry.href) : null };
    }
  }
  for (const e of entries) {
    const seen = new Set();
    e.backlinks = incoming.get(e).filter((b) => !seen.has(b.id) && seen.add(b.id)).sort((a, b) => a.title.localeCompare(b.title)).map(lite);
    const near = [];
    const nseen = new Set();
    for (const r of [...e.related.filter((x) => x.href !== null || bySlug.has(x.slug)), ...e.backlinks]) {
      if (r.peer && !r.href && !bySlug.has(r.slug)) continue;
      if (nseen.has(r.slug)) continue;
      nseen.add(r.slug); near.push(r);
    }
    e.neighbours = { items: near.slice(0, NEIGHBOURS_MAX), more: Math.max(0, near.length - NEIGHBOURS_MAX) };
    const lin = e._o.source_system ?? e._o.source_lineage;
    const src = lin ? pool.find((i) => i.schema === 'source-system' && (slugFromRef(i.ref) === lin || i.object.title === lin || i.object.url === lin)) : null;
    e.cite = src ? (asText(publicViewOf(src.object, { schema: src.schema }).how_to_credit) || null) : null;
    const lab = e._lab;
    const row = (l, v) => (v ? [[l, v]] : []);
    e.about = [...row(lab('kind'), e.kindLabel), ...row(lab('page_type'), e.pageType ? kindLabel(e.pageType) : null), ...row(lab('maturity'), e.mark?.word ?? e.maturity),
      ...row(lab('public_use'), publicUseWord(e.publicUse)), ...row(lab('currentness'), asText(e._o.currentness)), ...row(lab('audience'), asText(e._o.audience)),
      ...row(lab('steward'), asText(e._o.steward)), ...row(lab('record'), e.atUri)];
  }

  // ── the commons ─────────────────────────────────────────────────────────────
  const kindMap = new Map();
  for (const e of entries) kindMap.set(e.schema, (kindMap.get(e.schema) ?? 0) + 1);
  const kinds = [...kindMap].map(([schema, count]) => ({ schema, label: kindLabel(schema), glyphType: glyphFor(schema, entities), count })).sort((a, b) => a.label.localeCompare(b.label));
  const peersRead = new Set(entries.map((e) => e.origin?._read).filter(Boolean)).size;
  // counts.sources comes from knowledge.json (already public), not from the entries.
  const sources = Array.isArray(knowledge?.sources) ? knowledge.sources.length : entries.filter((e) => e.schema === 'source-system').length;
  for (const e of entries) { delete e._o; delete e._lab; if (e.origin) delete e.origin._read; }
  return {
    instance: config.instance ?? null, did: ownDid, sentence: knowledge?.description ?? knowledge?.about ?? null,
    counts: { entries: entries.length, kinds: kinds.length, sources, peersRead }, kinds, entries,
    needsReview: preview ? entries.filter((e) => e.awaiting) : [],
  };
}
