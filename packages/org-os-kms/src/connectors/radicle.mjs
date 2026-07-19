// src/connectors/radicle.mjs — SPECCED STUB. Peer-to-peer git (Radicle). No central API:
// read from a seeded Radicle node's Collaborative Objects (COBs).
//
// IMPLEMENTATION SPEC (build here):
//  - auth: read from a public seed node by repo RID (rad:z...); write needs the local rad key.
//  - describe: type 'repo'; url = the rad:// RID; return_path = the RID (issues/patches as COBs).
//  - pull(config, {cursor}): via `rad` CLI or the node HTTP API, list issue/patch COBs for
//    config.rid changed since cursor; cursor = the last COB object id (oid), opaque.
//  - map(cob): issue COB → signal (signal_type 'content'); patch COB → resource. Preserve the
//    COB oid in source_lineage.
//  - publish (future): create a signed COB on the local node via `rad issue`/`rad patch`.
import { makeStub } from './stub.mjs';

export const radicleConnector = makeStub({
  name: 'radicle',
  protocol: 'Radicle (p2p git COBs)',
  type: 'repo',
  steward: 'Radicle node operator',
  return_path: 'rad://',
  spec: 'Peer-to-peer git. pull lists issue/patch Collaborative Objects (COBs) for a seeded '
    + 'repo RID since an opaque COB-oid cursor (via the rad CLI / node HTTP API); map turns an '
    + 'issue COB into a signal and a patch COB into a resource, preserving the oid in '
    + 'source_lineage. No central API — everything is per-node and content-addressed.',
});
