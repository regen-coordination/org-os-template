// src/connectors/atproto.mjs — SPECCED STUB. AT Protocol (Bluesky) — federated social
// over DIDs + lexicons.
//
// IMPLEMENTATION SPEC (build here):
//  - auth: read is public via a PDS/AppView; write needs an app password / OAuth session.
//  - describe: type 'archive'; url = the account's PDS; steward = the handle; return_path = profile URL.
//  - pull(config, {cursor}): com.atproto.repo.listRecords over config.did for the configured
//    lexicon collections (e.g. app.bsky.feed.post); cursor = the repo `rev` / listRecords cursor.
//  - map(record): a lexicon record → signal (signal_type 'content'); text → title/notes,
//    at:// uri → source_lineage. Long threads may map to a single signal, not one per post.
//  - publish (future): com.atproto.repo.createRecord — DRAFT-ONLY; never auto-post.
import { makeStub } from './stub.mjs';

export const atprotoConnector = makeStub({
  name: 'atproto',
  protocol: 'AT Protocol (Bluesky)',
  type: 'archive',
  steward: 'AT Protocol handle',
  return_path: 'https://bsky.app',
  spec: 'AT Protocol / Bluesky. pull reads lexicon records via com.atproto.repo.listRecords '
    + 'over a DID since the repo rev cursor; map turns a lexicon record (e.g. app.bsky.feed.post) '
    + 'into a signal with the at:// uri as source_lineage. DID-based identity; read is public, '
    + 'writes need a session and stay draft-only.',
});
