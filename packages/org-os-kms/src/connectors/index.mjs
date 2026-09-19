// packages/org-os-kms/src/connectors/index.mjs — connector registry (composition root for source drivers).
// kms.yaml `connectors: [{ name, config, cursor? }]` names one of these; `ingest.pull` resolves it here (`cursor` only seeds data/kms-cursors.json).
import { atprotoConnector } from '../atproto/connector.mjs';
import { staticJsonConnector } from './static-json/index.mjs';

export const CONNECTORS = { atproto: atprotoConnector, 'static-json': staticJsonConnector };

export function getConnector(name, registry = CONNECTORS) {
  const c = registry[name];
  if (!c) throw new Error(`unknown connector: ${name} (available: ${Object.keys(registry).join(', ')})`);
  return c;
}

/** Core connectors plus the loaded extension packs'. Core wins: a pack connector named like a core one is a load error. */
export function mergeConnectors(packConnectors = {}) {
  for (const name of Object.keys(packConnectors)) {
    if (CONNECTORS[name]) throw new Error(`pack connector "${name}" collides with core`);
  }
  return { ...packConnectors, ...CONNECTORS };
}
