// packages/org-os-kms/src/connectors/hypercerts/index.mjs — pull from Hypercerts / Certified (api.hypercerts.dev), read-only.
// kms.yaml: connectors: [{ name: hypercerts, config: { follows_of: <DID>, dids: [<DID>…] } }]
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

const COLLECTIONS = ['organization', 'activity', 'attachment'];
const didOfUri = (uri) => String(uri).split('/')[2];
const orgName = (rec) => rec.profile?.displayName ?? rec.value?.legalName;

export function createHypercertsConnector({ createClient = createHypercertsClient } = {}) {
  return {
    name: 'hypercerts', protocol: 'Hypercerts / Certified public XRPC API (read-only)', capabilities: { ingest: true, subscribe: false, publish: false },
    describe(config = {}) {
      const base = config.base || DEFAULT_BASE;
      return { title: 'Hypercerts / Certified (api.hypercerts.dev)', type: 'dataset', steward: 'external', return_path: base, endpoint: base };
    },
    async pull(config = {}, { cursor } = {}) {
      const client = createClient({ base: config.base });
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
      const testActivities = new Set((listed.activity || []).filter((r) => isTestTitle(r.value?.title)).map((r) => r.uri));
      const keep = {
        organization: (r) => !isTestTitle(orgName(r)),
        activity: (r) => !isTestTitle(r.value?.title),
        attachment: (r) => {
          const t = r.value?.title;
          if (typeof t === 'string' && t.trim() && isTestTitle(t)) return false;
          return !(r.value?.subjects || []).some((s) => testActivities.has(s?.uri));
        },
      };
      const kept = {};
      for (const collection of COLLECTIONS) if (listed[collection]) kept[collection] = listed[collection].filter(keep[collection]);

      const activityTitles = new Map((kept.activity || []).map((r) => [r.uri, r.value.title]));
      const records = []; const retracted = []; const seen = {};
      for (const collection of COLLECTIONS) {
        if (!kept[collection]) { seen[collection] = previous[collection]; continue; }     // failed listing: nothing retracted, cursor unchanged
        const now = new Set(kept[collection].map((r) => r.uri));
        seen[collection] = [...now];
        for (const uri of previous[collection]) if (!now.has(uri) && inScope.has(didOfUri(uri))) retracted.push(uri);
        for (const rec of kept[collection]) records.push({ kind: collection, rec, activityTitles });
      }
      return { records, cursor: { seen }, retracted, errors };
    },
    map(record) { return mapRecord(record); },
  };
}
export const hypercertsConnector = createHypercertsConnector();
