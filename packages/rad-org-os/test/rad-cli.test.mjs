import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRadCli } from '../src/rad-cli.mjs';
import { WriteUnavailableError } from '../../org-os-host/src/errors.mjs';

// fake exec: returns queued {code,stdout,stderr} by matched command; records calls.
function fakeExec(map, { throwOnSpawn = false } = {}) {
  const calls = [];
  const exec = async (bin, args) => {
    calls.push({ bin, args });
    if (throwOnSpawn) return { code: -1, stdout: '', stderr: 'spawn rad ENOENT' };
    const key = `${bin} ${args.join(' ')}`;
    for (const [needle, res] of map) if (key.includes(needle)) return res;
    return { code: 0, stdout: '', stderr: '' };
  };
  exec.calls = calls;
  return exec;
}

test('run() returns stdout on success', async () => {
  const cli = makeRadCli({ exec: fakeExec([['self', { code: 0, stdout: 'DID did:key:z6Mkabc\n', stderr: '' }]]) });
  const out = await cli.run(['self']);
  assert.match(out, /did:key:z6Mkabc/);
});

test('run() throws WriteUnavailableError when rad is not installed', async () => {
  const cli = makeRadCli({ exec: fakeExec([], { throwOnSpawn: true }) });
  await assert.rejects(() => cli.run(['self']), (e) => {
    assert.ok(e instanceof WriteUnavailableError);
    assert.match(e.hint || '', /install rad|node/i);
    return true;
  });
});

test('run() throws WriteUnavailableError when the node is unreachable', async () => {
  const cli = makeRadCli({ exec: fakeExec([['sync', { code: 1, stdout: '', stderr: 'error: node is not running' }]]) });
  await assert.rejects(() => cli.run(['sync']), (e) => e instanceof WriteUnavailableError);
});

test('run() throws a plain Error on other non-zero exits', async () => {
  const cli = makeRadCli({ exec: fakeExec([['patch', { code: 1, stdout: '', stderr: 'error: bad usage' }]]) });
  await assert.rejects(() => cli.run(['patch']), (e) => !(e instanceof WriteUnavailableError) && e instanceof Error);
});
