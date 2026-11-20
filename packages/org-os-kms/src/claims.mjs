// src/claims.mjs — claim and supersede (kms plan Task 8, spec 6.3).
// A CLAIM is an ordinary object that carries claim fields: ReFi DAO publishes it from the instance's own account, on a node's
// behalf, so the node shows up before it has an account of its own. Nothing about a node leaves without its yes BY NAME:
//   claim_for         what the claim is about: the node's website URL, or its DID once known
//   claim_status      claimed | superseded
//   claim_node_did    the node's DID when it has one (the DID half of the supersede match)
//   claim_checked_on  the date the node checked the claim
//   consent_atproto   the date the node said yes, by name, to publishing to the open network. Evidence kept at home: never in a record
//   superseded_by     the AT-URI of the node's own record (set by reconcile; kept at home)
// The record is marked publisher = the configured publisher (publish.claim_publisher, e.g. ReFi DAO), subject = claim_for.
// Everything is off by default: publish.claims must be exactly `true`.
import { join } from 'node:path';
import * as fw from './framework.mjs';
import { loadKmsConfig } from './config.mjs';
import { planeRole } from './planes/role.mjs';
import { publicEntryFor } from './planes/public-fields.mjs';
import { packPublishRules } from './pack-publish.mjs';

const present = (v) => v !== undefined && v !== null && v !== '';

/** An object is a claim when it carries any claim field. Any one is enough: a half-filled claim is still a claim and must pass the floor. */
export function isClaim(object) {
  return Boolean(object) && typeof object === 'object' && ['claim_for', 'claim_status', 'claim_node_did'].some((k) => present(object[k]));
}

/**
 * A real calendar date: a YAML date (a Date) or a `YYYY-MM-DD` string, optionally followed by a time. `yes`, `someday`, the empty
 * value and an impossible day (2026-02-31, 2025-02-29) are not dates: Date.parse rolls 2026-02-31 over to 3 March, so the day is
 * checked against the month. (An UNQUOTED 2026-02-31 in YAML is rolled over by the parser itself before this sees it; quote dates.)
 */
export function isDate(v) {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?![\d])/.exec(v);
  if (!m || Number.isNaN(Date.parse(v))) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d;
}

/**
 * → { ok } or { ok: false, reason }. An object with no claim field is not affected. A claim is publishable only if
 * publish.claims is exactly true, it is still `claimed`, it says what it is for, the node's consent date is a date, and a
 * publisher is configured to be named. Checked in the op (selectPublic) and again in planPublish; no instance gate can widen it.
 */
export function claimFloor(object, config = {}) {
  if (!isClaim(object)) return { ok: true };
  if (config.publish?.claims !== true) return { ok: false, reason: 'claim floor: publish.claims is not on, so nothing is published on a node\'s behalf' };
  if (object.claim_status !== 'claimed') return { ok: false, reason: `claim floor: claim_status is ${object.claim_status ?? 'missing'}, only a claim in status "claimed" is published` };
  if (typeof object.claim_for !== 'string' || !object.claim_for.trim()) return { ok: false, reason: 'claim floor: a claim must say what it is for (claim_for)' };
  if (!isDate(object.consent_atproto)) return { ok: false, reason: 'claim floor: no consent_atproto date, so the node has not said yes by name to publishing about it' };
  const p = config.publish?.claim_publisher;
  if (typeof p !== 'string' || !p.trim()) return { ok: false, reason: 'claim floor: publish.claim_publisher is not set, so a claim would not name who publishes it' };
  return { ok: true };
}

const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
const HOME_ONLY = ['consent_atproto', 'superseded_by'];
/** The claim fields a record carries even when its type declares a public_fields whitelist. */
export const CLAIM_RECORD_FIELDS = ['claim_for', 'claim_status', 'claim_node_did', 'claim_checked_on', 'publisher'];

/** The object without the evidence a claim keeps at home (the node's consent date, the superseded_by pointer). The one place that list lives. */
export function withoutHomeFields(object) {
  const out = {};
  for (const [k, v] of Object.entries(object)) if (!HOME_ONLY.includes(k)) out[k] = v;
  return out;
}

/** The marks that make a record a claim to anyone who reads it: without all three it looks like the node's own record. */
export const CLAIM_IDENTITY_MARKS = ['claim_for', 'claim_status', 'publisher'];

/** → the claim marks a shared lexicon doc does not declare (empty = it carries them). */
export function missingClaimMarks(doc) {
  const props = doc?.defs?.main?.record?.properties ?? {};
  return CLAIM_IDENTITY_MARKS.filter((k) => !(k in props));
}

/**
 * A visibility-gated pack type is cut to its declared public_fields before it is planned, and that cut would drop the claim fields
 * with the rest, so a claim would reach the plan, the static API and the pages as a plain object. Put back what makes it a claim
 * (the marks and the consent date the floor re-checks); the allow-list cut (claimView) then decides what is shown.
 */
export function carryClaim(original, cut) {
  if (!cut || !isClaim(original)) return cut;
  const out = { ...cut };
  for (const k of [...CLAIM_RECORD_FIELDS, 'consent_atproto']) if (original[k] !== undefined) out[k] = original[k];
  return out;
}

/** What a claim shows of itself, besides its marks (CLAIM_RECORD_FIELDS) and what its schema declares public. */
export const CLAIM_CONTENT_FIELDS = ['id', 'title', 'type', 'public_use', 'url', 'description'];

/**
 * What a claim looks like as a record source, the static API entry and the page: a CUT, not a copy. A claim is ReFi DAO's record
 * about a node, and the operator keeps things beside it (a contact, who raised it, notes) that must never leave. It carries an
 * allow-list: CLAIM_CONTENT_FIELDS, the claim marks, `publisher` (stamped), and what the commons field policy
 * (planes/public-fields.mjs, publicEntryFor) declares public for the schema. The consent date and superseded_by stay home
 * (withoutHomeFields); dates are plain strings. A visibility-gated pack type is already cut to its own declared public_fields
 * before this (planPublish), and only its claim marks are added back.
 */
export function claimView(object, publisher, schema = object?.type) {
  const home = withoutHomeFields(object);
  const declared = publicEntryFor(schema, home);
  const keep = new Set([...CLAIM_CONTENT_FIELDS, ...CLAIM_RECORD_FIELDS, ...(packPublishRules(schema)?.public_fields ?? [])]);
  const out = {};
  for (const [k, v] of Object.entries(home)) {
    if (k in declared) out[k] = day(declared[k]);
    else if (keep.has(k)) out[k] = day(v);
  }
  if (publisher !== undefined) out.publisher = publisher;
  return out;
}

/** An object as the static API, the pages and standard.site show it: the framework's public view; for a claim, its allow-list cut (claimView). */
export function publicViewOf(object, { schema, publisher } = {}) {
  return fw.publicView(isClaim(object) ? claimView(object, publisher, schema ?? object.type) : object);
}

// ---- reconcile ----

/**
 * Lowercase host, no `www.`, no scheme, no trailing slash, no fragment. The port (unless it is the scheme's default) and the
 * query STAY: `?id=1` and `?id=2` are two pages and `:8443` is another site. The fragment goes because the browser reads it and
 * never sends it, so `#a` and `#b` are the same document on the server.
 */
export function normalizeUrl(u) {
  if (typeof u !== 'string' || !u.trim()) return null;
  const s = u.trim();
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.port ? `:${url.port}` : ''}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch { return s.toLowerCase().replace(/#.*$/, '').replace(/\/+$/, ''); }
}
const didOf = (uri) => (typeof uri === 'string' ? /^at:\/\/(did:[^/]+)\//.exec(uri)?.[1] ?? null : null);

/**
 * When an ingested record of the SAME schema is the node's own, EVERY claim of that schema for that node is superseded:
 * claim_status superseded, superseded_by the node's record, maturity held. The next `publish` then drops it (the floor refuses
 * `held`; the plan deletes it from the instance's repo through the manifest). Per-record matching lost: it is fuzzy, and once the
 * node speaks for itself we stop speaking for it. A record retracted at origin (held) is not the node speaking. Idempotent. The
 * node's record is never written.
 * "The node's own" means its author is the node: when the claim carries claim_node_did, the record's sourceUri DID must be it, and
 * a url is never enough (a directory can list a node's url under its own DID). Only a claim with NO DID known falls back to the
 * normalised url (query and port kept), and that match is reported as `matched: 'url'`, counted in `urlOnly` and named in `note`:
 * a url says where a page lives, not who wrote the record.
 * → { ok, report: { dry, superseded: [{ ref, by, matched: 'did' | 'url' }], unmatched, urlOnly, note? } }
 */
export async function reconcileClaims({ dir = '.', config, dry = false } = {}) {
  const cfg = config || loadKmsConfig(dir);
  if (planeRole(cfg) === 'public') {
    return { ok: false, report: { dry, superseded: [], unmatched: 0, urlOnly: 0, error: 'this instance is a public plane: it receives only what its canon exports. Reconcile claims in the canon.' } };
  }
  const adapter = fw.getAdapter(cfg.adapter);
  const target = join(dir, cfg.target);
  const all = adapter.list(target);
  const open = all.filter((it) => isClaim(it.object) && it.object.claim_status === 'claimed');
  const bySchema = new Map();
  for (const it of all) {
    if (isClaim(it.object) || it.object.maturity === 'held' || typeof it.object.sourceUri !== 'string' || !it.object.sourceUri) continue;
    if (!bySchema.has(it.schema)) bySchema.set(it.schema, []);
    bySchema.get(it.schema).push(it.object);
  }
  // A claim is matched one way only: by its node's DID when it has one, else by url. Pass 1 finds which nodes have spoken for
  // themselves, pass 2 supersedes every claim of the schema for those nodes.
  const keyOf = (c) => {
    const did = c.object.claim_node_did; const url = normalizeUrl(c.object.claim_for);
    if (present(did)) return { key: `${c.schema}|did:${did}`, matched: 'did', hit: (o) => didOf(o.sourceUri) === did };
    if (url) return { key: `${c.schema}|url:${url}`, matched: 'url', hit: (o) => normalizeUrl(o.url) === url };
    return null;
  };
  const spoken = new Map(); // key -> the node's record sourceUri
  for (const c of open) {
    const k = keyOf(c); if (!k || spoken.has(k.key)) continue;
    const o = (bySchema.get(c.schema) ?? []).find(k.hit);
    if (o) spoken.set(k.key, o.sourceUri);
  }
  const superseded = []; let unmatched = 0;
  for (const c of open) {
    const k = keyOf(c); const by = k && spoken.get(k.key);
    if (!by) { unmatched++; continue; }
    superseded.push({ ref: c.ref, by, matched: k.matched });
    if (!dry) adapter.update(target, c.ref, { claim_status: 'superseded', superseded_by: by, maturity: 'held', review_needs: `superseded by the node's own record ${by}` });
  }
  const urlOnly = superseded.filter((s) => s.matched === 'url').length;
  return { ok: true, report: { dry, superseded, unmatched, urlOnly, ...(urlOnly ? { note: `${urlOnly} of ${superseded.length} ${urlOnly === 1 ? 'claim was' : 'claims were'} superseded on a url-only match: the claim has no claim_node_did, so the record's author was not checked. Set claim_node_did to match by DID.` } : {}) } };
}
