// packages/org-os-kms/src/connectors/hypercerts/links.mjs — OPTIONAL backlink enrichment from Constellation (microcosm).
// Off by default, never required, never a source of record: kms.yaml `config.constellation: { enabled: true, base? }`.
//
// What it answers: "which records on the network link to this activity or organization?" Constellation indexes every
// string in every record that parses as an at-uri, a DID or a URL, so no lexicon work is needed. What it cannot do:
// it has no full-network backfill, so an empty answer is "no links SEEN", never "no links", and the connector must not
// act on it. It is one maintainer's best-effort service; every call is fail-soft (see index.mjs).
//
// Two GETs, read 2026-11-20 (research note 2026-11-20-microcosm-atproto-indexing, R7; one live GET to confirm the
// getBacklinks shape the same day):
//   /links/all/count?target=<uri>                              → { links: { <collection>: { ".<path>": <n> } } }
//   /xrpc/blue.microcosm.links.getBacklinks?subject=<uri>&source=<collection>:<path>&limit=1..100
//                                                              → { total, records: [{ did, collection, rkey }], cursor }
// `source` carries the path WITHOUT the leading dot that /links/all/count prints. Look up the form the record wrote:
// a handle-form at-uri is indexed under the handle, so a lookup by DID will not find it.
// Like the Hypercerts client: an allowlist of paths and keys, GET only, a generic user agent, and a response body is
// never copied into an error.

export const CONSTELLATION_BASE = 'https://constellation.microcosm.blue';
export const LINKS_USER_AGENT = 'org-os-kms (read-only)';
export const DEFAULT_MAX_REQUESTS = 50;
const COUNT = '/links/all/count';
const BACKLINKS = '/xrpc/blue.microcosm.links.getBacklinks';
export const ALLOWED_LINK_PARAMS = { [COUNT]: ['target'], [BACKLINKS]: ['subject', 'source', 'limit'] };

export class ConstellationError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'ConstellationError'; this.status = status; }
}

export function createConstellationClient({ base = CONSTELLATION_BASE, fetchImpl = globalThis.fetch } = {}) {
  async function raw(path, params = {}) {
    const allowed = ALLOWED_LINK_PARAMS[path];
    if (!allowed) throw new ConstellationError(`constellation: path ${path} is not allowed (read-only client)`);
    const url = new URL(path, base || CONSTELLATION_BASE);
    for (const [key, value] of Object.entries(params)) {
      if (!allowed.includes(key)) throw new ConstellationError(`constellation: parameter "${key}" is not allowed on ${path} (allowed: ${allowed.join(', ')})`);
      if (value !== undefined && value !== null) url.searchParams.append(key, String(value));
    }
    let res;
    try { res = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json', 'user-agent': LINKS_USER_AGENT } }); }
    catch (e) { throw new ConstellationError(`constellation: ${path} could not be reached (${e.code || e.name || 'network error'})`); }
    if (!res.ok) throw new ConstellationError(`constellation: ${path} answered HTTP ${res.status}`, res.status);
    try { return await res.json(); }
    catch { throw new ConstellationError(`constellation: ${path} answered something that is not JSON`, res.status); }
  }
  return {
    raw,
    /** { <collection>: { ".<path>": n } } — what links to `target`, as counts. {} = none SEEN (no backfill). */
    async countLinks(target) {
      const body = await raw(COUNT, { target });
      if (!body || typeof body.links !== 'object' || body.links === null || Array.isArray(body.links)) throw new ConstellationError(`constellation: ${COUNT} sent an unexpected response (no "links" object)`);
      return body.links;
    },
    /** One page (at most 100) of the records that link to `subject` from `collection` at `path` (leading dot optional). */
    async getBacklinks(subject, collection, path, limit = 100) {
      const body = await raw(BACKLINKS, { subject, source: `${collection}:${String(path).replace(/^\./, '')}`, limit: Math.min(Math.max(1, limit | 0), 100) });
      if (!body || !Array.isArray(body.records)) throw new ConstellationError(`constellation: ${BACKLINKS} sent an unexpected response (no "records" list)`);
      return { total: typeof body.total === 'number' ? body.total : body.records.length, records: body.records.map((r) => ({ did: r.did, collection: r.collection, rkey: r.rkey })) };
    },
  };
}

/**
 * Counts, then one page of backlinks per source that has any, for each subject. Stops at the first failure or when the
 * request cap is reached; a subject is recorded only when all its calls finished. Never throws.
 * @returns {Promise<{ subjects: Record<string, { counts: object, backlinks: Record<string, { total: number, records: object[] }> }>, requests: number, error?: string }>}
 */
export async function enrichWithBacklinks(client, subjects, { maxRequests = DEFAULT_MAX_REQUESTS } = {}) {
  const out = { subjects: {}, requests: 0 };
  const capped = () => { if (out.requests >= maxRequests) { out.error = `constellation: request cap (${maxRequests}) reached; the rest were not looked up`; return true; } return false; };
  try {
    for (const subject of subjects) {
      if (capped()) break;
      out.requests++; const counts = await client.countLinks(subject);
      const backlinks = {}; let stopped = false;
      for (const [collection, paths] of Object.entries(counts)) {
        for (const path of Object.keys(paths || {})) {
          if (capped()) { stopped = true; break; }
          out.requests++; backlinks[`${collection}:${path}`] = await client.getBacklinks(subject, collection, path, 100);
        }
        if (stopped) break;
      }
      if (stopped) break;
      out.subjects[subject] = { counts, backlinks };
    }
  } catch (e) { out.error = e.message; }
  return out;
}
