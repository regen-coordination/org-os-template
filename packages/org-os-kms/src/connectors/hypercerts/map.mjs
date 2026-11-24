// packages/org-os-kms/src/connectors/hypercerts/map.mjs — pure mappers: a Hypercerts / Certified record → kms candidates.
// Input records are the client's flat shape `{ uri, cid, did, value, profile? }` (`value` = the record).
// Field names were read from live records and the OpenAPI on 2026-11-20 (an update's body is `description`, a
// linearDocument; its activity link is `subjects[].uri`; an organization's display name lives on the profile record).
//
// The mapper never sets `maturity`, `public_use` or `ai_assisted`: `runConnector` stores every candidate raw and
// not-public-yet whatever the origin says. Funding receipts, galleries, photos, audio and anything else are not mapped.

const CONTEXT_MAX = 400;
const TEST_TITLE = /\b(test|qa|e2e|demo)\b/i;
const EVIDENCE = new Set(['evidence', 'report', 'audit']);

/** True for no title (or blank), or a title naming a test, QA, e2e or demo run. */
export function isTestTitle(title) {
  if (typeof title !== 'string' || !title.trim()) return true;
  return TEST_TITLE.test(title);
}

/** Plain text of a `pub.leaflet.pages.linearDocument` body, a descriptionString object, or a plain string. */
export function leafletText(body) {
  if (typeof body === 'string') return body;
  if (!body || typeof body !== 'object') return '';
  if (typeof body.value === 'string') return body.value;
  if (!Array.isArray(body.blocks)) return '';
  const paragraphs = [];
  for (const b of body.blocks) {
    const text = b?.block?.plaintext;
    if (typeof text === 'string' && text.length) paragraphs.push(text);
  }
  return paragraphs.join('\n\n');
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const subjectUri = (value) => (Array.isArray(value?.subjects) ? value.subjects.map((s) => s?.uri).find((u) => typeof u === 'string') : undefined);

function mapOrganization(rec) {
  const title = str(rec.profile?.displayName) ?? str(rec.value?.legalName);
  if (!title) return [];
  const types = Array.isArray(rec.value?.organizationType) ? rec.value.organizationType.filter((t) => typeof t === 'string') : [];
  const url = str(rec.profile?.website) ?? str(rec.value?.urls?.find?.((u) => typeof u?.url === 'string')?.url);
  const object = { title, type: 'organization', sourceUri: rec.uri };
  if (types.length) object.org_type = types.join(', ');
  if (url) object.url = url;
  return [{ schema: 'organization', object }];
}

function mapActivity(rec) {
  const title = str(rec.value?.title);
  if (!title) return [];
  const context = (str(rec.value?.shortDescription) ?? str(leafletText(rec.value?.description)))?.slice(0, CONTEXT_MAX);
  const object = { title, type: 'implementation-record', source_position: 'self-report', record_stage: 'in-progress', sourceUri: rec.uri };
  if (context) object.context = context;
  return [{ schema: 'implementation-record', object }];
}

function mapAttachment(rec, activityTitles) {
  const ct = rec.value?.contentType;
  const subject = subjectUri(rec.value);
  const name = (subject && activityTitles.get(subject)) || subject || rec.uri;
  if (EVIDENCE.has(ct)) {
    return [{ schema: 'claim-evidence', object: {
      title: `${ct} for ${name}`, type: 'claim-evidence', claim: `attached as ${ct} to ${name}`,
      evidence: rec.uri, evidence_stance: 'neutral', sourceUri: rec.uri } }];
  }
  if (ct === 'update') {
    const langs = Array.isArray(rec.value?.langs) && rec.value.langs.length ? `\n[langs: ${rec.value.langs.join(', ')}]` : '';
    return [{ schema: 'signal', object: {
      title: `update on ${name}`, type: 'signal', signal_type: 'implementation',
      notes: `${leafletText(rec.value?.description)}${langs}`, sourceUri: rec.uri } }];
  }
  return [];
}

/** @param {{ kind: string, rec: object, activityTitles?: Map<string,string> }} input @returns {Array<{ schema: string, object: object }>} */
export function mapRecord({ kind, rec, activityTitles = new Map() }) {
  if (!rec || typeof rec !== 'object') return [];
  if (kind === 'organization') return mapOrganization(rec);
  if (kind === 'activity') return mapActivity(rec);
  if (kind === 'attachment') return mapAttachment(rec, activityTitles);
  return [];
}
