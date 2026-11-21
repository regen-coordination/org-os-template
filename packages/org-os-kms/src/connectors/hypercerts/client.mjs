// packages/org-os-kms/src/connectors/hypercerts/client.mjs — read-only client for the public Hypercerts XRPC API.
//
// Contract read 2026-11-20 from hypercerts-org/api `docs/openapi.json` (main; its `servers` lists the test host,
// production is https://api.hypercerts.dev). Every operation is `GET /xrpc/<NSID>`, no authentication, no writes.
// Array parameters go as repeated, unbracketed values (style form, explode true). `limit` is 1..100, `cursor` pages.
//
//   operation (NSID)                         permitted query keys                                   list key       DID filter
//   app.certified.graph.listActorFollowing   actor* sortDirection limit cursor                      following      `actor` (whose follows)
//   org.hypercerts.claim.listActivities      authors hasOrganizationRecord contributors             activities     `authors` (max 100)
//                                            involvedActors uris sortDirection limit cursor
//   org.hypercerts.context.listAttachments   authors uris subjects contentTypes                     attachments    `authors` (max 100)
//                                            sortDirection limit cursor
//   app.certified.actor.listOrganizations    organizationTypes visibility sortDirection limit       actors         none (the whole directory)
//                                            cursor
//   app.certified.actor.getOrganizations     actors* (1..100 DIDs)                                  organizations  `actors` — not paged
//
// DECISION RULE (plan Task 1 Step 1): an operation accepts a DID filter, so the per-DID branch holds. Activities and
// attachments are read per scoped DID through `authors`. Organizations have no author filter on the list call, and the
// directory is thousands of records, so the connector reads them through `getOrganizations` (named DIDs only);
// `listOrganizations` stays on the client for a whole-directory read nobody runs by default.
//
// Every response is a *view*, not a bare record: `{ uri, cid, did, author, record }`. The client flattens each to
// `{ uri, cid, did, value }` (`value` = the record), so mappers do not care about the wrapper.
// An unknown query parameter makes the live server answer with a Lua stack trace (verified 2026-11-13), so `call`
// refuses to send any key not in ALLOWED_PARAMS and never copies a response body into an error.

import { withTimeout, timeoutOf, RequestTimeout, DEFAULT_TIMEOUT_MS } from './timeout.mjs';
export { DEFAULT_TIMEOUT_MS };
export const DEFAULT_BASE = 'https://api.hypercerts.dev';
export const USER_AGENT = 'org-os-kms (read-only)';
const MAX_PAGES = 1000;
const MAX_DIDS = 100;

const PAGING = ['sortDirection', 'limit', 'cursor'];
export const ALLOWED_PARAMS = {
  'app.certified.graph.listActorFollowing': ['actor', ...PAGING],
  'org.hypercerts.claim.listActivities': ['authors', 'hasOrganizationRecord', 'contributors', 'involvedActors', 'uris', ...PAGING],
  'org.hypercerts.context.listAttachments': ['authors', 'uris', 'subjects', 'contentTypes', ...PAGING],
  'app.certified.actor.listOrganizations': ['organizationTypes', 'visibility', ...PAGING],
  'app.certified.actor.getOrganizations': ['actors'],
};

export class HypercertsError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'HypercertsError'; this.status = status; }
}

/** The one request path: allowlist check, GET, error mapping. Returns the parsed JSON body. */
export async function call(fetchImpl, base, op, params = {}, { timeoutMs } = {}) {
  const allowed = Object.hasOwn(ALLOWED_PARAMS, op) ? ALLOWED_PARAMS[op] : undefined;   // own keys only: '__proto__' is not an operation
  if (!allowed) throw new HypercertsError(`hypercerts: operation ${op} is not allowed (read-only client)`);
  const url = new URL(`/xrpc/${op}`, base);
  for (const [key, value] of Object.entries(params)) {
    if (!allowed.includes(key)) throw new HypercertsError(`hypercerts: parameter "${key}" is not allowed on ${op} (allowed: ${allowed.join(', ')})`);
    if (value === undefined || value === null) continue;
    for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(v));
  }
  try {
    return await withTimeout(timeoutOf(timeoutMs), async (signal) => {
      let res;
      try { res = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json', 'user-agent': USER_AGENT }, signal }); }
      catch (e) { throw new HypercertsError(`hypercerts: ${op} could not be reached (${e?.code || e?.name || 'network error'})`); }
      if (!res.ok) throw new HypercertsError(`hypercerts: ${op} answered HTTP ${res.status}`, res.status);
      try { return await res.json(); }
      catch { throw new HypercertsError(`hypercerts: ${op} answered something that is not JSON`, res.status); }
    });
  } catch (e) {
    if (e instanceof RequestTimeout) throw new HypercertsError(`hypercerts: ${op} ${e.message}`);
    throw e;
  }
}

const view = (v) => ({ uri: v.uri, cid: v.cid, did: v.did, value: v.record });
const orgRecord = (actor) => {
  if (!actor?.organization?.record) return null;
  return { ...view(actor.organization), profile: actor.profile?.record ?? null };
};
const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

export function createHypercertsClient({ base = DEFAULT_BASE, fetchImpl = globalThis.fetch, pageSize = 100, timeoutMs } = {}) {
  const limit = Math.min(Math.max(1, pageSize | 0), 100);

  async function listAll(op, params, key, pick) {
    const out = []; let cursor; const seen = new Set();
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await call(fetchImpl, base, op, { ...params, limit, ...(cursor ? { cursor } : {}) }, { timeoutMs });
      if (!body || !Array.isArray(body[key])) throw new HypercertsError(`hypercerts: ${op} sent an unexpected response (no "${key}" list)`);
      for (const item of body[key]) { const r = pick(item); if (r) out.push(r); }
      if (!body.cursor) return out;
      if (seen.has(body.cursor)) throw new HypercertsError(`hypercerts: ${op} repeated a cursor; stopping`);
      seen.add(body.cursor); cursor = body.cursor;
    }
    throw new HypercertsError(`hypercerts: ${op} did not finish in ${MAX_PAGES} pages; stopping`);
  }

  // `authors`: when given, one paged listing per batch of up to 100 DIDs; when omitted, the whole collection.
  async function byAuthors(op, key, authors, extra = {}) {
    if (authors === undefined) return listAll(op, extra, key, view);
    const out = [];
    for (const group of chunks([...new Set(authors)], MAX_DIDS)) out.push(...await listAll(op, { ...extra, authors: group }, key, view));
    return out;
  }

  return {
    // The followed accounts: { did (the followed account), uri/cid (the follow record), value (the follow record) }.
    async listFollowing(did) {
      return listAll('app.certified.graph.listActorFollowing', { actor: did }, 'following',
        (f) => ({ did: f.did, uri: f.follow?.uri, cid: f.follow?.cid, value: f.follow?.record }));
    },
    listActivities: ({ authors } = {}) => byAuthors('org.hypercerts.claim.listActivities', 'activities', authors),
    listAttachments: ({ authors } = {}) => byAuthors('org.hypercerts.context.listAttachments', 'attachments', authors),
    listOrganizations: () => listAll('app.certified.actor.listOrganizations', {}, 'actors', orgRecord),
    // Organizations for named DIDs only; an actor with no organization record yields nothing.
    async getOrganizations(dids) {
      const out = [];
      for (const group of chunks([...new Set(dids)], MAX_DIDS)) {
        const body = await call(fetchImpl, base, 'app.certified.actor.getOrganizations', { actors: group }, { timeoutMs });
        if (!body || !Array.isArray(body.organizations)) throw new HypercertsError('hypercerts: app.certified.actor.getOrganizations sent an unexpected response (no "organizations" list)');
        for (const r of body.organizations) { const o = orgRecord(r.organization); if (o) out.push(o); }
      }
      return out;
    },
  };
}
