// src/connectors/index.mjs — the connector registry. name -> connector object. Mirrors the
// framework's storage-adapter registry shape (getAdapter/listAdapters). The lifecycle op and
// CLI resolve connectors through here; concrete protocol drivers live in sibling files.
import { githubConnector } from './github.mjs';
import { koiConnector } from './koi.mjs';
import { geoConnector } from './geo.mjs';
import { radicleConnector } from './radicle.mjs';
import { atprotoConnector } from './atproto.mjs';
import { synthefyConnector } from './synthefy.mjs';

const CONNECTORS = {
  github: githubConnector,
  koi: koiConnector,
  geo: geoConnector,
  radicle: radicleConnector,
  atproto: atprotoConnector,
  synthefy: synthefyConnector,
};

export function listConnectors() { return Object.keys(CONNECTORS); }

export function getConnector(name) {
  const c = CONNECTORS[name];
  if (!c) throw new Error(`unknown connector: ${name} (available: ${listConnectors().join(', ')})`);
  return c;
}
