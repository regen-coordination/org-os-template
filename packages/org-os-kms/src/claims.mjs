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

const present = (v) => v !== undefined && v !== null && v !== '';

/** An object is a claim when it carries any claim field. Any one is enough: a half-filled claim is still a claim and must pass the floor. */
export function isClaim(object) {
  return Boolean(object) && typeof object === 'object' && ['claim_for', 'claim_status', 'claim_node_did'].some((k) => present(object[k]));
}

/** A real calendar date: a YAML date (a Date) or a `YYYY-MM-DD…` string. `yes`, `someday` and the empty value are not dates. */
function isDate(v) {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
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
  if (!present(object.claim_for)) return { ok: false, reason: 'claim floor: a claim must say what it is for (claim_for)' };
  if (!isDate(object.consent_atproto)) return { ok: false, reason: 'claim floor: no consent_atproto date, so the node has not said yes by name to publishing about it' };
  const p = config.publish?.claim_publisher;
  if (typeof p !== 'string' || !p.trim()) return { ok: false, reason: 'claim floor: publish.claim_publisher is not set, so a claim would not name who publishes it' };
  return { ok: true };
}

const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
const HOME_ONLY = ['consent_atproto', 'superseded_by'];
/** The claim fields a record carries even when its type declares a public_fields whitelist. */
export const CLAIM_RECORD_FIELDS = ['claim_for', 'claim_status', 'claim_node_did', 'claim_checked_on', 'publisher'];

/** What a claim looks like as a record source: consent date and superseded_by stay home, dates are plain strings, publisher is stamped. */
export function claimView(object, publisher) {
  const out = {};
  for (const [k, v] of Object.entries(object)) if (!HOME_ONLY.includes(k)) out[k] = day(v);
  out.publisher = publisher;
  return out;
}

// ---- reconcile ----

/** Lowercase host, no `www.`, no scheme, no query or trailing slash. */
export function normalizeUrl(u) {
  if (typeof u !== 'string' || !u.trim()) return null;
  const s = u.trim();
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}`;
  } catch { return s.toLowerCase().replace(/\/+$/, ''); }
}
const didOf = (uri) => (typeof uri === 'string' ? /^at:\/\/(did:[^/]+)\//.exec(uri)?.[1] ?? null : null);

/**
 * When an ingested record of the SAME schema is the node's own (its sourceUri DID is the claim's claim_node_did, or its url
 * is the claim's claim_for), EVERY claim of that schema for that node is superseded: claim_status superseded, superseded_by the
 * node's record, maturity held. The next `publish` then drops it (the floor refuses `held`; the plan deletes it from the
 * instance's repo through the manifest). Per-record matching lost: it is fuzzy, and once the node speaks for itself we stop
 * speaking for it. A record retracted at origin (held) is not the node speaking. Idempotent. The node's record is never written.
 * → { ok, report: { dry, superseded: [{ ref, by }], unmatched } }
 */
export async function reconcileClaims({ dir = '.', config, dry = false } = {}) {
  const cfg = config || loadKmsConfig(dir);
  if (planeRole(cfg) === 'public') {
    return { ok: false, report: { dry, superseded: [], unmatched: 0, error: 'this instance is a public plane: it receives only what its canon exports. Reconcile claims in the canon.' } };
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
  // Pass 1: which nodes have spoken for themselves, by DID or by normalised url. Pass 2: every claim for those nodes, same schema.
  const spoken = new Map(); // `${schema}|did:<did>` / `${schema}|url:<url>` -> the node's record sourceUri
  for (const c of open) {
    const did = c.object.claim_node_did; const url = normalizeUrl(c.object.claim_for);
    for (const o of bySchema.get(c.schema) ?? []) {
      const hit = (did && didOf(o.sourceUri) === did) || (url && normalizeUrl(o.url) === url);
      if (!hit) continue;
      if (did) spoken.set(`${c.schema}|did:${did}`, o.sourceUri);
      if (url) spoken.set(`${c.schema}|url:${url}`, o.sourceUri);
      break;
    }
  }
  const superseded = []; let unmatched = 0;
  for (const c of open) {
    const did = c.object.claim_node_did; const url = normalizeUrl(c.object.claim_for);
    const by = (did && spoken.get(`${c.schema}|did:${did}`)) || (url && spoken.get(`${c.schema}|url:${url}`)) || null;
    if (!by) { unmatched++; continue; }
    superseded.push({ ref: c.ref, by });
    if (!dry) adapter.update(target, c.ref, { claim_status: 'superseded', superseded_by: by, maturity: 'held', review_needs: `superseded by the node's own record ${by}` });
  }
  return { ok: true, report: { dry, superseded, unmatched } };
}
