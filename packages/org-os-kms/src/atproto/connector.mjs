// packages/org-os-kms/src/atproto/connector.mjs — pull peers' repos. Cursor {did: {rev, seen}}: skip unchanged peers; full list + seen-diff for retractions.
import * as fw from '../framework.mjs';
import { createClient as defaultCreateClient } from './client.mjs';

const originDid = (uri) => uri.split('/')[2];

export function createAtprotoConnector({ createClient = defaultCreateClient } = {}) {
  return {
    name: 'atproto', protocol: 'AT Protocol (XRPC listRecords)', capabilities: { ingest: true, subscribe: false, publish: false },
    describe(config) { return { title: 'AT Proto peers', type: 'knowledge-garden', steward: 'federation', return_path: (config.peers || []).join(',') || 'none', endpoint: config.pds }; },
    async pull(config, { cursor }) {
      const next = { ...(cursor || {}) };
      const peers = config.peers || [];
      if (!peers.length) return { records: [], cursor: next, retracted: [], errors: [] };
      const wanted = Array.isArray(config.types) && config.types.length ? config.types : null;
      if (wanted) { const unknown = wanted.filter((t) => !fw.ALL_TYPES.includes(t)); if (unknown.length) throw new Error(`atproto connector: unknown types: ${unknown.join(', ')}`); }
      const schemas = wanted ? fw.ALL_TYPES.filter((s) => wanted.includes(s)) : fw.ALL_TYPES;
      const limit = Number.isInteger(config.limit) && config.limit > 0 ? config.limit : Infinity;   // fixtures only
      const client = createClient({ pds: config.pds });
      const records = []; const retracted = []; const errors = [];
      for (const did of peers) {
        try {
          const { rev } = await client.getLatestCommit({ did });
          const prev = next[did] || { rev: null, seen: [] };
          if (prev.rev === rev) continue;
          const listed = [];
          for (const schema of schemas) {
            if (records.length + listed.length >= limit) break;
            const page = await client.listAllRecords({ repo: did, collection: fw.nsidFor(schema, config.nsid_authority) });
            listed.push(...page.slice(0, limit - records.length - listed.length));
          }
          const seen = listed.map((r) => r.uri);
          if (limit === Infinity) for (const u of prev.seen) if (!seen.includes(u)) retracted.push(u);   // a limited pull cannot know what was retracted
          records.push(...listed); next[did] = { rev, seen };
        } catch (e) { errors.push({ did, error: e.message }); }
      }
      return { records, cursor: next, retracted, errors };
    },
    map(record, config) {
      if (!record.value || typeof record.value !== 'object') return [];
      const { uri, value } = record;
      const schema = fw.typeForNsid(value.$type, config.nsid_authority);
      if (!schema) return [];
      const claimedSourceUri = typeof value.sourceUri === 'string' ? value.sourceUri : null;
      const sourceUri = claimedSourceUri || uri;
      if (originDid(sourceUri) === config.self) return [];
      if (claimedSourceUri) {
        const claimedOriginDid = originDid(claimedSourceUri);
        if (claimedOriginDid !== originDid(uri) && (config.peers || []).includes(claimedOriginDid)) return [];
      }
      const { $type, id, ...rest } = value;
      return [{ schema, object: { ...fw.publicView(rest), sourceUri, viaUri: uri } }];
    },
  };
}
export const atprotoConnector = createAtprotoConnector();
