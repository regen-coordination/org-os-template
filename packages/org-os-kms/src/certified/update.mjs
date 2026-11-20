// src/certified/update.mjs — a node's update, built as the exact Certified feed record and EXPORTED as a draft file (kms plan Task 9).
// The bundle never holds a node's credentials and never logs in: it writes `renders/certified-updates/<slug>.json` for whoever holds
// the node's own session to put (Phase 2, a refi-dao-os Hub feature). Nothing here takes a client; nothing reads `notes`.
import { join } from 'node:path';
import * as fw from '../framework.mjs';
import { loadKmsConfig } from '../config.mjs';
import { atomicWrite } from '../atomic-write.mjs';
import { slugFromRef } from '../manifest.mjs';
import { isClaim, isDate } from '../claims.mjs';
import { textToLeaflet } from './leaflet.mjs';

const COLLECTION = 'org.hypercerts.context.attachment';
const present = (v) => v !== undefined && v !== null && v !== '';

/**
 * signal: a kms `signal` object. The report text is `signal.update_text`, a plain field on the node's own signals: NOT `notes`, which
 * is in PRIVATE_FIELDS (publicView removes it) and where Task 3 deliberately keeps ingested Certified text. subject: { uri, cid? }, an
 * AT-URI of the node's activity, collection or profile. The record is built from a short list of named fields, so nothing else on
 * the signal (notes, reviewed_by, work_order, consent_atproto, …) can reach it. createdAt is injected: the clock is read at the op edge.
 * Keys follow the golden post: $type, contentType, createdAt, description (the Leaflet body), subjects, title; langs only when the signal has them.
 */
export function buildUpdateRecord(signal, { subject, createdAt }) {
  if (typeof signal?.update_text !== 'string' || !signal.update_text.trim()) throw new Error('buildUpdateRecord: the signal has no update_text (the text is never read from notes)');
  if (!subject?.uri || !String(subject.uri).startsWith('at://')) throw new Error('buildUpdateRecord: the subject is not an AT-URI');
  if (!createdAt) throw new Error('buildUpdateRecord: createdAt is required');
  const record = {
    $type: COLLECTION,
    contentType: 'update',
    createdAt,
    description: textToLeaflet(signal.update_text),
    subjects: [{ $type: 'com.atproto.repo.strongRef', uri: subject.uri, ...(subject.cid ? { cid: subject.cid } : {}) }],
    title: signal.title,
  };
  if (Array.isArray(signal.langs) && signal.langs.length) record.langs = signal.langs.filter((l) => typeof l === 'string');
  return record;
}

/** → { eligible: true } or { eligible: false, reason }. The signal is the node's own update, with the node's yes or the node's own authorship. */
function eligibility(object) {
  if (!fw.isPublishable(object, { schema: 'signal', types: ['signal'] })) return { reason: `public_use is ${object.public_use ?? 'missing'} or the signal is held: not publishable` };
  if (!present(object.certified_subject)) return { reason: 'no certified_subject: the AT-URI of the node\'s activity, collection or profile' };
  if (!String(object.certified_subject).startsWith('at://')) return { reason: 'certified_subject is not an AT-URI' };
  // The node's yes by name (consent_atproto), or the node's own authorship: an update the node wrote itself, not a claim about it.
  const own = !isClaim(object) && object.publisher === 'node';
  if (!own && !isDate(object.consent_atproto)) return { reason: 'no consent_atproto date, and the signal is not the node\'s own (publisher: node)' };
  if (typeof object.update_text !== 'string' || !object.update_text.trim()) return { reason: 'no update_text' };
  return { eligible: true };
}

/**
 * One draft file per eligible `signal` of type implementation, under renders/certified-updates/ (outDir). Off unless publish.certified_drafts
 * is true. An ingested record (it has a sourceUri) is somebody else's post, never ours: ignored and counted, not a skip. Never logs in:
 * no client is created or accepted here. Idempotent (same input and `now`, same bytes). The draft is a file for the operator to hand on.
 * → { ok, report: { written, skipped: [{ id, reason }], ignored: { ingested } } }
 */
export async function exportUpdateDrafts({ dir = '.', config, outDir, now } = {}) {
  const cfg = config || loadKmsConfig(dir);
  if (cfg.publish?.certified_drafts !== true) {
    return { ok: false, report: { written: [], skipped: [], ignored: { ingested: 0 }, error: 'Certified update drafts are off: set publish.certified_drafts: true in kms.yaml (the export only writes files; it never logs in)' } };
  }
  const target = join(dir, cfg.target);
  const out = outDir || join(dir, 'renders', 'certified-updates');
  const createdAt = now || new Date().toISOString();
  const report = { written: [], skipped: [], ignored: { ingested: 0 } };
  for (const { schema, object, ref } of fw.getAdapter(cfg.adapter).list(target)) {
    if (schema !== 'signal' || object.signal_type !== 'implementation') continue;
    const slug = slugFromRef(ref);
    if (present(object.sourceUri)) { report.ignored.ingested++; continue; }
    const v = eligibility(object);
    if (!v.eligible) { report.skipped.push({ id: slug, reason: v.reason }); continue; }
    const subject = { uri: object.certified_subject, ...(present(object.certified_subject_cid) ? { cid: object.certified_subject_cid } : {}) };
    const record = buildUpdateRecord(object, { subject, createdAt });
    const file = join(out, `${slug}.json`);
    const draft = {
      draft: true,
      collection: COLLECTION,
      for: slug,
      note: 'A draft for the node\'s own session to put into its own repository. The bundle holds no node credentials and has not put this record anywhere.',
      needs: subject.cid ? [] : ['certified_subject_cid'],
      record,
    };
    atomicWrite(file, JSON.stringify(draft, null, 2) + '\n');
    report.written.push(file);
  }
  return { ok: true, report };
}
