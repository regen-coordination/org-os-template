// packages/org-os-kms/src/connectors/static-json/index.mjs — a static source: read-only JSON + discovery doc, no protocol client.
import { createHash } from 'node:crypto';
import * as openhaven from './openhaven.mjs';

export const MAPPERS = { openhaven };

export function createStaticJsonConnector({ fetchImpl = globalThis.fetch, mappers = MAPPERS } = {}) {
  const get = async (url) => { const r = await fetchImpl(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.text(); };
  return {
    name: 'static-json', protocol: 'static JSON over HTTPS', capabilities: { ingest: true, subscribe: false, publish: false },
    describe(config) { return { title: `Static source ${new URL(config.base_url).hostname}`, type: 'dataset', steward: 'external', return_path: config.base_url, endpoint: config.base_url + (config.index || '/api/index.json') }; },
    async pull(config, { cursor }) {
      const indexBody = await get(config.base_url + (config.index || '/api/index.json'));
      const hash = createHash('sha256').update(indexBody).digest('hex');
      if (hash === cursor) return { records: [], cursor };
      const mapper = mappers[config.mapper];
      if (!mapper) throw new Error(`static-json: unknown mapper ${config.mapper}`);
      const records = [];
      for (const collection of config.collections || mapper.collections) for (const item of JSON.parse(await get(config.base_url + collection))) records.push({ collection, item });
      return { records, cursor: hash };
    },
    map(record, config) { return mappers[config.mapper].map(record); },
  };
}
export const staticJsonConnector = createStaticJsonConnector();
