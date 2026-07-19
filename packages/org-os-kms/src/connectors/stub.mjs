// src/connectors/stub.mjs — factory for a specced-but-unbuilt connector (the geo.mjs
// precedent generalized). A stub is a first-class, discoverable connector: describe()
// returns a valid source-system card, capabilities declare ingest-only, map() returns [],
// and pull() throws NOT_IMPLEMENTED. `spec` carries the implementation contract as prose so
// the file IS the design doc for building it later.
import { NOT_IMPLEMENTED } from '../framework.mjs';

export function makeStub({ name, protocol, type, steward, return_path, endpoint, spec }) {
  return {
    name,
    protocol,
    spec,
    capabilities: { ingest: true, subscribe: false, publish: false },
    describe(config = {}) {
      const card = {
        title: config.title || `${protocol} source`,
        type,
        steward: config.steward || steward,
        return_path: config.return_path || return_path,
      };
      if (endpoint) card.url = config.url || endpoint;
      return card;
    },
    pull() {
      throw new Error(`${NOT_IMPLEMENTED}: connector "${name}" (${protocol}) — see the spec docstring in src/connectors/${name}.mjs`);
    },
    map() { return []; },
  };
}
