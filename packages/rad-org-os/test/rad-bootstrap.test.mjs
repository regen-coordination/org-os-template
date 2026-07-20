import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, parseRid, parseDid } from '../bootstrap/rad-bootstrap.mjs';
import { WriteUnavailableError } from '../../org-os-host/src/errors.mjs';

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
  // git init + genesis commit must happen BEFORE rad init (rad init requires a commit on the default branch):
  const gitInitIdx = calls.findIndex((c) => c.startsWith('git init -b main'));
  const radInitIdx = calls.findIndex((c) => c.startsWith('rad init'));
  assert.ok(gitInitIdx !== -1, 'git init -b main was called');
  assert.ok(gitInitIdx < radInitIdx, 'git init happens before rad init');
  // wrote genesis files:
  assert.ok(Object.keys(writes).some((p) => p.endsWith('data/members.yaml')));
  assert.ok(Object.keys(writes).some((p) => p.endsWith('federation.yaml')));
});

test('bootstrap rejects an invalid visibility', async () => {
  await assert.rejects(() => bootstrap({ targetDir: '/x', name: 'n', visibility: 'secret', exec: async () => ({ code: 0, stdout: '', stderr: '' }), fs: {}, scaffold: async () => {} }), /visibility must be/);
});

test('bootstrap rejects when rad self returns an unparseable did (no malformed genesis)', async () => {
  const exec = async (bin, args) => {
    if (bin === 'rad' && args[0] === 'self') return { code: 0, stdout: 'no did here\n', stderr: '' };
    if (bin === 'rad' && args[0] === 'auth') return { code: 0, stdout: '', stderr: '' };
    if (bin === 'rad' && args[0] === 'init') return { code: 0, stdout: 'Initialized private repository rad:z3NEW\n', stderr: '' };
    if (bin === 'git' && args[0] === 'rev-list') return { code: 0, stdout: 'f'.repeat(40) + '\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const fs = { mkdir: async () => {}, writeFile: async () => {} };
  await assert.rejects(
    () => bootstrap({ targetDir: '/tmp/neworg', name: 'my-org', alias: 'luiz', visibility: 'private', exec, fs, scaffold: async () => {} }),
    /did:key/,
  );
});

test('bootstrap fails loudly (WriteUnavailableError) when rad is not installed', async () => {
  const exec = async (bin, args) => {
    if (bin === 'rad' && args[0] === 'auth') return { code: -1, stdout: '', stderr: 'spawn rad ENOENT' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const fs = { mkdir: async () => {}, writeFile: async () => {} };
  await assert.rejects(
    () => bootstrap({ targetDir: '/tmp/neworg', name: 'my-org', alias: 'luiz', visibility: 'private', exec, fs, scaffold: async () => {} }),
    WriteUnavailableError,
  );
});

test('bootstrap fails loudly (WriteUnavailableError) when the node is down', async () => {
  const exec = async (bin, args) => {
    if (bin === 'rad' && args[0] === 'self') return { code: 0, stdout: 'DID did:key:z6MkXY\n', stderr: '' };
    if (bin === 'rad' && args[0] === 'auth') return { code: 0, stdout: '', stderr: '' };
    if (bin === 'rad' && args[0] === 'init') return { code: 1, stdout: '', stderr: 'error: connection refused' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const fs = { mkdir: async () => {}, writeFile: async () => {} };
  await assert.rejects(
    () => bootstrap({ targetDir: '/tmp/neworg', name: 'my-org', alias: 'luiz', visibility: 'private', exec, fs, scaffold: async () => {} }),
    WriteUnavailableError,
  );
});

test('bootstrap stamps the genesis commit oid into federation.yaml metadata', async () => {
  const writes = {};
  const events = [];
  const exec = async (bin, args) => {
    if (bin === 'git' && args.includes('genesis: federation')) events.push('commit-federation');
    if (bin === 'rad' && args[0] === 'self') return { code: 0, stdout: 'DID did:key:z6MkXY\n', stderr: '' };
    if (bin === 'rad' && args[0] === 'init') return { code: 0, stdout: 'Initialized private repository rad:z3NEW\n', stderr: '' };
    if (bin === 'git' && args[0] === 'rev-list') return { code: 0, stdout: 'a'.repeat(40) + '\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const fs = {
    mkdir: async () => {},
    writeFile: async (p, c) => {
      writes[p] = c;
      if (p.endsWith('federation.yaml') && /genesis_commit: [0-9a-f]{40}/.test(c)) events.push('write-stamped-federation');
    },
  };
  await bootstrap({ targetDir: '/tmp/o', name: 'o', alias: 'a', visibility: 'private', seed: 's', exec, fs, scaffold: async () => {}, now: '2026-07-20T00:00:00Z' });
  const fedPath = Object.keys(writes).find((p) => p.endsWith('federation.yaml'));
  const fed = (await import('js-yaml')).default.load(writes[fedPath]);
  assert.equal(fed.metadata.genesis_commit, 'a'.repeat(40));
  // the stamped federation.yaml must be written BEFORE the federation commit, so the
  // stamp lands in git history (not just the working tree)
  assert.deepEqual(events, ['write-stamped-federation', 'commit-federation']);
});
