import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, parseRid, parseDid } from '../bootstrap/rad-bootstrap.mjs';

test('parseRid extracts a rad: RID from rad init output', () => {
  assert.equal(parseRid('Initialized public repository rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5\n'), 'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5');
  assert.equal(parseRid('no rid'), null);
});

test('parseDid extracts a did:key from rad auth / rad self output', () => {
  assert.equal(parseDid('DID did:key:z6MkfuXgBSe5G8U6d5NuVbvrbuXRwzYjKJWPPddXgbVjqT9n\n'), 'did:key:z6MkfuXgBSe5G8U6d5NuVbvrbuXRwzYjKJWPPddXgbVjqT9n');
});

test('bootstrap runs auth → init → writes members/federation, returns rid + did', async () => {
  const calls = [];
  const writes = {};
  const exec = async (bin, args) => {
    calls.push(`${bin} ${args.join(' ')}`);
    if (bin === 'rad' && args[0] === 'self') return { code: 0, stdout: 'DID did:key:z6MkXY\n', stderr: '' };
    if (bin === 'rad' && args[0] === 'auth') return { code: 0, stdout: '', stderr: '' };
    if (bin === 'rad' && args[0] === 'init') return { code: 0, stdout: 'Initialized private repository rad:z3NEW\n', stderr: '' };
    if (bin === 'git' && args[0] === 'rev-list') return { code: 0, stdout: 'f'.repeat(40) + '\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const fs = {
    mkdir: async () => {},
    writeFile: async (p, c) => { writes[p] = c; },
  };
  const res = await bootstrap({
    targetDir: '/tmp/neworg', name: 'my-org', alias: 'luiz', visibility: 'private',
    seed: 'https://my-node.example', exec, fs, scaffold: async () => {},
  });
  assert.equal(res.rid, 'rad:z3NEW');
  assert.equal(res.did, 'did:key:z6MkXY');
  // used the verified flags:
  assert.ok(calls.some((c) => c.startsWith('rad auth --alias luiz')));
  assert.ok(calls.some((c) => c.includes('rad init') && c.includes('--private') && c.includes('--name my-org')));
  // wrote genesis files:
  assert.ok(Object.keys(writes).some((p) => p.endsWith('data/members.yaml')));
  assert.ok(Object.keys(writes).some((p) => p.endsWith('federation.yaml')));
});

test('bootstrap rejects an invalid visibility', async () => {
  await assert.rejects(() => bootstrap({ targetDir: '/x', name: 'n', visibility: 'secret', exec: async () => ({ code: 0, stdout: '', stderr: '' }), fs: {}, scaffold: async () => {} }), /visibility must be/);
});
