import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCrefs, mainQuorum } from '../src/governance.mjs';

test('mainQuorum maps governance.proposal_threshold to the identity threshold', () => {
  const q = mainQuorum({ governance: { proposal_threshold: 2, maintainers: [{ id: 'did:key:z6MkA' }, { id: 'did:key:z6MkB' }] } });
  assert.equal(q.threshold, 2);
  assert.deepEqual(q.delegates, ['did:key:z6MkA', 'did:key:z6MkB']);
  // main is governed by the identity threshold directly — NOT a crefs rule
  assert.equal(q.mainRuleIsImplicit, true);
});

test('buildCrefs makes per-pattern rules for ADDITIONAL protected refs', () => {
  const crefs = buildCrefs([
    { pattern: 'refs/tags/releases/*', allow: ['did:key:z6MkA', 'did:key:z6MkB'], threshold: 2 },
  ]);
  assert.equal(crefs['refs/tags/releases/*'].threshold, 2);
  assert.deepEqual(crefs['refs/tags/releases/*'].allow, ['did:key:z6MkA', 'did:key:z6MkB']);
});

test('buildCrefs rejects a rule targeting the default branch (Radicle disallows it)', () => {
  assert.throws(() => buildCrefs([{ pattern: 'refs/heads/main', allow: ['did:key:z6MkA'], threshold: 1 }]),
    /default branch.*disallowed|refs\/heads\/main/);
});
