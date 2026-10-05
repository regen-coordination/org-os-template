// packages/org-os-kms/src/atproto/standard-site.mjs — every published entry ALSO as a standard.site document (docs/CONNECTORS.md §14).
// The <authority>.<schema> record stays the entry (what peers exchange); the site.standard.document is its readable rendering and
// points back at it. One site.standard.publication per commons. Plan (pure) then apply, like publish.mjs. Opt-in: atproto.standard_site.
import { createHash } from 'node:crypto';
import * as fw from '../framework.mjs';
import { slugFromRef } from '../manifest.mjs';
import { contentHash } from './publish.mjs';

export const PUBLICATION = 'site.standard.publication';
export const DOCUMENT = 'site.standard.document';
// Limits from the published lexicons (maxGraphemes / maxLength in UTF-8 bytes).
const LIMITS = { title: [500, 5000], name: [500, 5000], description: [3000, 30000], tag: [128, 1280] };
const MAX_RECORD_BYTES = 1_000_000;
const TID_RE = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/; // BCP-47 shape; never defaulted

// Which fields of each framework schema render as the document's description and body. Prose only, in reading order, and
// only fields that survive publicView(). No labels are added between them: a label would have to be in some language.
// A schema not listed here (e.g. an extension pack's) gets a title-only document unless standard_site.fields maps it.
export const FIELD_MAP = Object.freeze({
  'encyclopedia-entry': { description: 'summary', body: ['summary', 'known_tensions'] },
  'concept-lineage': { description: 'short_description', body: ['short_description', 'toolkit_usage', 'adjacent_meanings', 'important_distinctions'] },
  'claim-evidence': { description: 'claim', body: ['claim', 'evidence'] },
  'option-entry': { description: 'use_cases', body: ['use_cases', 'not_for', 'context', 'scale', 'failure_modes'] },
  'implementation-record': { description: 'context', body: ['context', 'what_worked', 'what_failed', 'adaptations', 'what_returns_to_commons'] },
  track: { description: 'starting_context', body: ['audience', 'starting_context', 'outcome'] },
  'source-system': { description: 'what_it_curates', body: ['what_it_curates', 'why_it_matters', 'how_to_credit', 'reuse_conditions'] },
});
const TAG_FIELDS = ['domain', 'function'];

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (s) => { let n = 0; for (const _ of segmenter.segment(s)) n++; return n; };
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const over = (s, [g, b]) => graphemes(s) > g || bytes(s) > b;
// Cut on a grapheme boundary so a letter is never separated from its combining mark; the text itself is not re-normalised.
function truncate(s, [maxG, maxB]) {
  if (!over(s, [maxG, maxB])) return s;
  let out = ''; let n = 0;
  for (const { segment } of segmenter.segment(s)) {
    if (n + 1 > maxG - 1 || bytes(out) + bytes(segment) > maxB - 3) break;
    out += segment; n++;
  }
  return `${out.trimEnd()}…`;
}

// A syntactically valid TID (the lexicons' record-key type) derived from a seed, so re-publishing lands on the same record.
// The 53 timestamp bits are hash bits pinned into 2005–2023: stable, always in the past, and not a real time.
export function tidFor(seed) {
  const h = createHash('sha256').update(String(seed)).digest();
  const ts = (1n << 50n) | (h.readBigUInt64BE(0) >> 15n);
  let v = (ts << 10n) | BigInt(h.readUInt16BE(8) & 0x3ff);
  let out = '';
  for (let i = 0; i < 13; i++) { out = '234567abcdefghijklmnopqrstuvwxyz'[Number(v & 31n)] + out; v >>= 5n; }
  return out;
}

const asText = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).join('\n') : typeof v === 'string' ? v.trim() : '');

// One entry → its plan-time document record. `publishedAt`, `updatedAt` and the strongRef's cid are stamped at apply.
export function toDocument({ schema, object, ref }, { did, authority, publicationUri, settings = {} }) {
  const slug = slugFromRef(ref);
  const o = fw.publicView(object);
  if (typeof o.title !== 'string' || !o.title.trim()) return { skipped: 'no title: a document needs one' };
  const errors = []; let warning;
  const map = { ...(FIELD_MAP[schema] || {}), ...(settings.fields?.[schema] || {}) };
  const record = { $type: DOCUMENT, site: publicationUri, title: o.title };
  if (over(o.title, LIMITS.title)) errors.push(`title exceeds ${LIMITS.title[0]} graphemes`);

  const pattern = settings.paths?.[schema] ?? settings.paths?.default;
  if (pattern) record.path = encodeURI(pattern).replace(/%7B(slug|id|schema)%7D/g, (_, k) => encodeURIComponent({ slug, id: object.id, schema }[k]));
  else warning = `no path pattern for ${schema}: the document has no web URL and cannot be verified`;

  const description = asText(o[map.description]);
  if (description) record.description = truncate(description, LIMITS.description);
  const body = (map.body || []).map((f) => asText(o[f])).filter(Boolean).join('\n\n');
  if (body) record.textContent = body;

  const tags = [];
  for (const f of settings.tag_fields || TAG_FIELDS) for (const raw of [o[f]].flat()) {
    const t = typeof raw === 'string' ? raw.trim().replace(/^#+/, '').trim() : '';
    if (!t || tags.includes(t)) continue;
    if (over(t, LIMITS.tag)) errors.push(`tag exceeds ${LIMITS.tag[0]} graphemes: ${truncate(t, [24, 240])}`); else tags.push(t);
  }
  if (tags.length) record.tags = tags;

  // The lexicon has no language field; `langs` (BCP-47, as in app.bsky.feed.post) is what other writers use. Omitted when unknown.
  const lang = (settings.language_field && o[settings.language_field]) || settings.language;
  if (lang) {
    const langs = [lang].flat();
    if (langs.every((l) => typeof l === 'string' && LANG_RE.test(l))) record.langs = langs; else errors.push(`language is not a BCP-47 tag: ${JSON.stringify(lang)}`);
  }

  record.content = { $type: `${authority}.entryRef`, entry: { uri: `at://${did}/${fw.nsidFor(schema, authority)}/${object.id}` }, schema };
  if (bytes(JSON.stringify(record)) > MAX_RECORD_BYTES) errors.push('document exceeds 1 MB');
  return { record, errors, warning };
}

function publicationRecord(config, errors) {
  const s = config.atproto.standard_site;
  const name = s.title ?? s.name;
  if (typeof name !== 'string' || !name.trim()) errors.push('title is required (the publication name)');
  else if (over(name, LIMITS.name)) errors.push(`title exceeds ${LIMITS.name[0]} graphemes`);
  const url = (s.url ?? config.publish?.base_url ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/.test(url)) errors.push('url is required (an http(s) site base URL; falls back to publish.base_url)');
  if (s.language !== undefined && ![s.language].flat().every((l) => typeof l === 'string' && LANG_RE.test(l))) errors.push(`language is not a BCP-47 tag: ${JSON.stringify(s.language)}`);
  for (const [k, p] of Object.entries(s.paths || {})) if (typeof p !== 'string' || !p.startsWith('/')) errors.push(`paths.${k}: a path pattern must start with "/"`);
  if (s.publication_rkey !== undefined && !TID_RE.test(String(s.publication_rkey))) errors.push('publication_rkey must be a TID (13 base32-sortable characters)');
  const record = { $type: PUBLICATION, url, name };
  if (typeof s.description === 'string' && s.description.trim()) record.description = truncate(s.description.trim(), LIMITS.description);
  if (typeof s.show_in_discover === 'boolean') record.preferences = { showInDiscover: s.show_in_discover };
  return record;
}

// Where the publication's verification file goes under the site root: /.well-known/site.standard.publication[/<path of the url>].
export function wellKnownPath(url) {
  const path = new URL(url).pathname.replace(/\/+$/, '');
  return `.well-known/${PUBLICATION}${path}`;
}

export function planStandardSite({ items, entryPlan, manifest, did, authority, config }) {
  const settings = config.atproto.standard_site;
  const previous = { publication: manifest.standardSite?.publication ?? null, documents: manifest.standardSite?.documents ?? {} };
  const plan = { ok: true, errors: [], publication: null, create: [], update: [], delete: [], skip: [], withheld: [], warnings: [], previous };
  const fail = () => ({ ...plan, ok: false, publication: null, create: [], update: [], delete: [], skip: [] });

  const configErrors = [];
  const pubRecord = publicationRecord(config, configErrors);
  if (configErrors.length) { plan.errors.push({ config: 'atproto.standard_site', errors: configErrors }); return fail(); }
  const pubRkey = settings.publication_rkey || previous.publication?.rkey || tidFor(`${did}/${PUBLICATION}`);
  const pubHash = contentHash(pubRecord);
  const samePub = previous.publication?.rkey === pubRkey;
  plan.publication = { action: !samePub ? 'create' : previous.publication.hash === pubHash ? 'skip' : 'update', collection: PUBLICATION, rkey: pubRkey, record: pubRecord, hash: pubHash,
    ...(samePub && previous.publication.hash !== pubHash ? { swapRecord: previous.publication.cid } : {}) };
  const publicationUri = `at://${did}/${PUBLICATION}/${pubRkey}`;

  const entryChanged = new Set([...entryPlan.create, ...entryPlan.update].map((op) => op.id));
  const seen = new Set();
  for (const item of items) {
    const id = item.object.id; const slug = slugFromRef(item.ref);
    const { record, errors, warning, skipped } = toDocument(item, { did, authority, publicationUri, settings });
    if (skipped) { plan.withheld.push({ id, slug, reason: skipped }); continue; }
    if (errors.length) { plan.errors.push({ slug, errors }); continue; }
    if (warning) plan.warnings.push({ slug, warning });
    seen.add(id);
    const hash = contentHash(record);
    const prev = previous.documents[id];
    const op = { id, slug, collection: DOCUMENT, rkey: prev?.rkey || tidFor(id), record, hash };
    if (!prev) plan.create.push(op);
    // The document also follows its entry: a new entry version means a new strongRef, even when the rendering is unchanged.
    else if (prev.hash === hash && !entryChanged.has(id) && prev.entryCid === manifest.objects[id]?.cid) plan.skip.push(id);
    else plan.update.push({ ...op, swapRecord: prev.cid });
  }
  for (const [id, prev] of Object.entries(previous.documents)) if (!seen.has(id)) plan.delete.push({ id, slug: prev.slug, collection: DOCUMENT, rkey: prev.rkey });
  return plan.errors.length ? fail() : plan;
}

// `entries` = the manifest objects as they stand AFTER the entry apply: a document is only written for an entry that is on the PDS.
export async function applyStandardSite(plan, { client, did, entries, now = () => new Date().toISOString() }) {
  if (!plan.ok) throw new Error('applyStandardSite called with a failed plan');
  const { previous } = plan;
  const state = { publication: previous.publication, documents: {} };
  const out = { applied: { publication: 'skipped', created: 0, updated: 0, deleted: 0 }, failures: [], state };
  const pub = plan.publication;
  if (pub.action !== 'skip') {
    try {
      const { uri, cid } = await client.putRecord({ repo: did, collection: pub.collection, rkey: pub.rkey, record: pub.record, swapRecord: pub.swapRecord });
      state.publication = { rkey: pub.rkey, atUri: uri, cid, hash: pub.hash, url: pub.record.url };
      out.applied.publication = pub.action === 'create' ? 'created' : 'updated';
    } catch (e) {
      // No publication, no documents: they would point at a record that is not there.
      out.failures.push({ id: 'publication', error: e.message }); state.documents = previous.documents; out.applied.publication = 'failed';
      return out;
    }
  }
  for (const id of plan.skip) state.documents[id] = previous.documents[id];
  for (const [kind, ops] of [['created', plan.create], ['updated', plan.update]]) {
    for (const op of ops) {
      const prev = previous.documents[op.id];
      try {
        const entry = entries[op.id];
        if (!entry?.atUri || !entry?.cid) throw new Error('the entry record is not published');
        const publishedAt = prev?.publishedAt ?? now();
        const record = { ...op.record, content: { ...op.record.content, entry: { uri: entry.atUri, cid: entry.cid } }, publishedAt, ...(prev ? { updatedAt: now() } : {}) };
        const { uri, cid } = await client.putRecord({ repo: did, collection: op.collection, rkey: op.rkey, record, swapRecord: op.swapRecord });
        state.documents[op.id] = { slug: op.slug, rkey: op.rkey, atUri: uri, cid, hash: op.hash, entryCid: entry.cid, publishedAt };
        out.applied[kind]++;
      } catch (e) { out.failures.push({ id: op.id, error: e.message }); if (prev) state.documents[op.id] = prev; }
    }
  }
  for (const op of plan.delete) {
    try { await client.deleteRecord({ repo: did, collection: op.collection, rkey: op.rkey }); out.applied.deleted++; }
    catch (e) { out.failures.push({ id: op.id, error: e.message }); state.documents[op.id] = previous.documents[op.id]; }
  }
  return out;
}
