import { test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { buildMembersYaml, buildFederationYaml, buildGenesisStamp } from '../bootstrap/generate.mjs';

test('buildMembersYaml makes the operator a did:key member (canonical from genesis)', () => {
  const doc = yaml.load(buildMembersYaml({ did: 'did:key:z6MkABC', alias: 'luiz', github: 'luizsg' }));
  const m = doc.members[0];
  assert.equal(m.id, 'did:key:z6MkABC');       // canonical id IS the did
  assert.equal(m.handles.github, 'luizsg');     // optional alias for reach
  assert.equal(m.alias, 'luiz');
});

test('buildMembersYaml omits github handle when not provided', () => {
  const doc = yaml.load(buildMembersYaml({ did: 'did:key:z6MkABC', alias: 'luiz' }));
  assert.equal(doc.members[0].handles?.github, undefined);
});

test('buildFederationYaml sets radicle canonical + rid + seed', () => {
  const doc = yaml.load(buildFederationYaml({ rid: 'rad:z3xyz', seed: 'https://seed.example', name: 'my-org', threshold: 1 }));
  assert.equal(doc.platforms.canonical, 'radicle');
  assert.equal(doc.platforms.seed_node, 'https://seed.example');
  assert.equal(doc.identity.rid, 'rad:z3xyz');
  assert.equal(doc.governance.proposal_threshold, 1);
});

test('buildGenesisStamp returns a metadata block with the genesis commit oid', () => {
  const meta = buildGenesisStamp({ commit: 'a'.repeat(40), now: '2026-07-20T00:00:00Z' });
  assert.equal(meta.genesis_commit, 'a'.repeat(40));
  assert.equal(meta.last_sync_commit, null);
  assert.equal(meta.created, '2026-07-20T00:00:00Z');
});
