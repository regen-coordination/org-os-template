// src/connectors/geo.mjs — SPECCED STUB. Read side of the Geo knowledge graph
// (IPFS + The Graph / Geo Browser). Pairs with toolkit-framework's geo STORAGE adapter
// (the write/persist side) — same protocol, both seams specced.
//
// IMPLEMENTATION SPEC (build here):
//  - auth: read is public over a space id; writes (future publish) need a Geo wallet/signer.
//  - describe: type 'database'; url = geobrowser.io space; return_path = the space's edit URL.
//  - pull(config, {cursor}): query the Geo read API (The Graph) for triples in config.space
//    changed since cursor; cursor = the last-seen edit/block index (opaque).
//  - map(tripleSet): assemble one entity's triples into a KB object, deserializing via the
//    kernel's JSON-LD @context (toolkit-framework toJsonLdContext()); pick schema by rdf:type
//    (default 'resource', resource_type from the entity's type).
//  - publish (future): content-add one triple-set per object serialized through the @context.
import { makeStub } from './stub.mjs';

export const geoConnector = makeStub({
  name: 'geo',
  protocol: 'Geo (IPFS + The Graph)',
  type: 'database',
  steward: 'Geo space steward',
  return_path: 'https://www.geobrowser.io',
  endpoint: 'https://www.geobrowser.io',
  spec: 'Read side of the Geo knowledge graph (IPFS + The Graph). pull queries the Geo read API '
    + 'for triples in a space since an opaque edit-index cursor; map assembles an entity from its '
    + 'triples via the kernel JSON-LD @context and picks a schema by rdf:type (default resource). '
    + 'Pairs with the framework geo storage adapter (write side).',
});
