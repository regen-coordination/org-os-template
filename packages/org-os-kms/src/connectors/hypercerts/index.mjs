// packages/org-os-kms/src/connectors/hypercerts/index.mjs — pull from Hypercerts / Certified (api.hypercerts.dev), read-only.
// kms.yaml: connectors: [{ name: hypercerts, config: { follows_of: <DID>, dids: [<DID>…], constellation?: { enabled: true, base? } } }]
//
// Scope: the accounts `follows_of` follows on Certified plus `dids`; with neither the run refuses (never the whole directory).
// Cursor (data/kms-cursors.json): { seen: { organization: [AT-URI…], activity: […], attachment: […] } } — the URIs kept
// by the last good listing of each collection.
// Retraction (`retracted`, matched by sourceUri in runConnector) is computed per collection and only when that
// collection listed successfully, and only over DIDs still in scope: unfollowing an account is not a retraction (its
// records stay, and their URIs leave `seen`), and a listing that failed half-way retracts nothing.
import { createHypercertsClient, DEFAULT_BASE } from './client.mjs';
import { resolveScope } from './scope.mjs';
import { mapRecord, isTestTitle } from './map.mjs';
import { createConstellationClient, enrichWithBacklinks } from './links.mjs';

const COLLECTIONS = ['organization', 'activity', 'attachment'];
const didOfUri = (uri) => String(uri).split('/')[2];
const orgName = (rec) => rec.profile?.displayName ?? rec.value?.legalName;

export function createHypercertsConnector({ createClient = createHypercertsClient, createLinks = (cfg) => createConstellationClient({ base: cfg.base, timeoutMs: cfg.timeoutMs }) } = {}) {
  return {
    name: 'hypercerts', protocol: 'Hypercerts / Certified public XRPC API (read-only)', capabilities: { ingest: true, subscribe: false, publish: false },
    describe(config = {}) {
      const base = config.base || DEFAULT_BASE;
      return { title: 'Hypercerts / Certified (api.hypercerts.dev)', type: 'dataset', steward: 'external', return_path: base, endpoint: base };
    },
    async pull(config = {}, { cursor } = {}) {
      const client = createClient({ base: config.base, timeoutMs: config.timeoutMs });
      const scope = await resolveScope(config, client);          // throws when unscoped: the run fails, nothing is read
      const inScope = new Set(scope);
      const previous = { organization: [], activity: [], attachment: [], ...(cursor?.seen || {}) };
      const errors = [];
      const listed = {};                                          // collection → in-scope records, only when the listing succeeded

      const list = {
        organization: () => client.getOrganizations(scope),
        activity: () => client.listActivities({ authors: scope }),
        attachment: () => client.listAttachments({ authors: scope }),
      };
      for (const collection of COLLECTIONS) {
        try { listed[collection] = (await list[collection]()).filter((r) => inScope.has(didOfUri(r.uri))); }
        catch (e) { errors.push({ collection, error: e.message }); }
      }

      // Filters: test-titled and untitled organizations and activities; attachments about a test-titled activity,
      // or carrying a test title of their own. An attachment with no title is kept (updates often have none).
      // When the activity listing failed, the titles are unknown, so an attachment is kept only if every activity it
      // is about was kept by the last good listing (`previous.activity`); otherwise it is HELD for this run: not
      // stored, not retracted, left in the cursor as it was, and said in `errors`.
      const testActivities = new Set((listed.activity || []).filter((r) => isTestTitle(r.value?.title)).map((r) => r.uri));
      const knownGood = new Set(previous.activity);
      const activityUnknown = !listed.activity;
      const held = new Set();
      // Fail closed: a subject entry with no readable uri (missing, null, a plain string) cannot be checked, so it holds.
      // A `subjects` that is present but not an array (string, object, number) cannot be read at all: it holds too, and on a
      // healthy listing it has no readable subject, so it is kept like an empty list. Missing or null is an empty list.
      const subjectsOf = (r) => { const s = r.value?.subjects; return Array.isArray(s) ? s : []; };
      const subjectsUnreadable = (r) => { const s = r.value?.subjects; return s != null && !Array.isArray(s); };
      const aboutUnchecked = (r) => activityUnknown && (subjectsUnreadable(r) || subjectsOf(r).some((s) => typeof s?.uri !== 'string' || !knownGood.has(s.uri)));
      const keep = {
        organization: (r) => !isTestTitle(orgName(r)),
        activity: (r) => !isTestTitle(r.value?.title),
        attachment: (r) => {
          const t = r.value?.title;
          if (typeof t === 'string' && t.trim() && isTestTitle(t)) return false;
          if (aboutUnchecked(r)) { held.add(r.uri); return false; }
          return !subjectsOf(r).some((s) => testActivities.has(s?.uri));
        },
      };
      const kept = {};
      for (const collection of COLLECTIONS) if (listed[collection]) kept[collection] = listed[collection].filter(keep[collection]);

      const activityTitles = new Map((kept.activity || []).map((r) => [r.uri, r.value.title]));
      const records = []; const retracted = []; const seen = {};
      for (const collection of COLLECTIONS) {
        if (!kept[collection]) { seen[collection] = previous[collection]; continue; }     // failed listing: nothing retracted, cursor unchanged
        const now = new Set(kept[collection].map((r) => r.uri));
        seen[collection] = [...now, ...[...held].filter((u) => collection === 'attachment' && previous.attachment.includes(u) && !now.has(u))];
        for (const uri of previous[collection]) if (!now.has(uri) && !held.has(uri) && inScope.has(didOfUri(uri))) retracted.push(uri);
        for (const rec of kept[collection]) records.push({ kind: collection, rec, activityTitles });
      }
      if (held.size) errors.push({ collection: 'attachment', error: `held ${held.size} attachment(s) this run: the activity listing failed, so it could not be checked whether they are about a test activity (none stored or retracted)` });
      const result = { records, cursor: { seen }, retracted, errors };
      // Optional enrichment (links.mjs): only with `constellation.enabled === true`. It reads, after everything above is
      // decided, and can change nothing above: a failure lands in `enrichment` only, and its answers never feed `retracted`.
      if (config.constellation?.enabled === true) {
        const subjects = ['activity', 'organization'].flatMap((c) => (kept[c] || []).map((r) => r.uri));
        const { subjects: found, requests, error } = await enrichWithBacklinks(createLinks(config.constellation), subjects);
        result.enrichment = { constellation: { subjects: found, requests, ...(error ? { error } : {}) } };
      }
      return result;
    },
    map(record) { return mapRecord(record); },
  };
}
export const hypercertsConnector = createHypercertsConnector();
