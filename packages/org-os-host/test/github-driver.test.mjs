import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGithubDriver } from '../src/github/driver.mjs';

// A recording fake exec: returns queued responses by matched command.
function fakeExec(responses) {
  const calls = [];
  const exec = async (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const key = `${bin} ${args.join(' ')}`;
    for (const [pattern, res] of responses) if (key.includes(pattern)) return res;
    return { code: 0, stdout: '', stderr: '' };
  };
  exec.calls = calls;
  return exec;
}

test('resolveRemote: github slug → scheme github', () => {
  const d = makeGithubDriver({ exec: fakeExec([]) });
  const r = d.resolveRemote('regen-coordination/org-os');
  assert.equal(r.scheme, 'github');
  assert.match(r.fetchUrl, /github\.com\/regen-coordination\/org-os/);
});

test('fetchFile: prefers a local clone when local_path exists', async () => {
  // entry with local_path pointing at a dir we control via a fake reader.
  const d = makeGithubDriver({
    exec: fakeExec([]),
    readLocal: (p) => (p.endsWith('federation.yaml') ? 'name: local-org' : null),
  });
  const out = await d.fetchFile({ local_path: '../refi-bcn-os' }, 'federation.yaml');
  assert.equal(out, 'name: local-org');
});

test('fetchFile: falls back to raw.githubusercontent when no local_path', async () => {
  const fetchFn = async (url) => {
    assert.match(url, /raw\.githubusercontent\.com\/regen-coordination\/org-os\/HEAD\/federation\.yaml/);
    return { ok: true, text: async () => 'name: remote-org' };
  };
  const d = makeGithubDriver({ exec: fakeExec([]), fetchFn });
  const out = await d.fetchFile({ repo: 'regen-coordination/org-os' }, 'federation.yaml');
  assert.equal(out, 'name: remote-org');
});

test('fetchFile: returns null (never throws) when unreachable', async () => {
  const fetchFn = async () => { throw new Error('network down'); };
  const d = makeGithubDriver({ exec: fakeExec([]), fetchFn });
  const out = await d.fetchFile({ repo: 'x/y' }, 'federation.yaml');
  assert.equal(out, null);
});

test('fetchFile: returns null on non-ok HTTP response', async () => {
  const d = makeGithubDriver({ exec: fakeExec([]), fetchFn: async () => ({ ok: false, text: async () => 'nope' }) });
  assert.equal(await d.fetchFile({ repo: 'x/y' }, 'federation.yaml'), null);
});

test('getCanonical: reads default branch from git', async () => {
  const exec = fakeExec([
    ['symbolic-ref', { code: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' }],
  ]);
  const d = makeGithubDriver({ exec });
  const c = await d.getCanonical({ local_path: '.' });
  assert.equal(c.defaultBranch, 'main');
  assert.equal(c.threshold, 1);         // github has no quorum → threshold 1
  assert.deepEqual(c.delegates, []);
});

test('getDrift: parses ahead/behind from rev-list --left-right --count', async () => {
  const exec = fakeExec([
    ['rev-parse --abbrev-ref', { code: 0, stdout: 'main\n', stderr: '' }],
    ['rev-list --left-right --count', { code: 0, stdout: '2\t3\n', stderr: '' }],
  ]);
  const d = makeGithubDriver({ exec });
  const drift = await d.getDrift({ local_path: '.' });
  assert.equal(drift.behind, 3);
  assert.equal(drift.ahead, 2);
  assert.equal(drift.canonicalRef, 'main');
});

test('getCanonical/getDrift run git in the peer local_path (cwd threaded)', async () => {
  const exec = fakeExec([
    ['symbolic-ref', { code: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' }],
    ['rev-parse --abbrev-ref', { code: 0, stdout: 'main\n', stderr: '' }],
    ['rev-list', { code: 0, stdout: '0\t0\n', stderr: '' }],
  ]);
  const d = makeGithubDriver({ exec });
  await d.getCanonical({ local_path: '../refi-bcn-os' });
  await d.getDrift({ local_path: '../refi-bcn-os' });
  assert.ok(exec.calls.every((c) => c.bin !== 'git' || c.opts?.cwd === '../refi-bcn-os'),
    'every git call for a peer entry threads cwd = local_path');
});

import { runHostDriverContract } from './contract.mjs';

test('push: runs git push origin <branch>', async () => {
  const exec = fakeExec([['push origin', { code: 0, stdout: '', stderr: '' }]]);
  const d = makeGithubDriver({ exec });
  const res = await d.push({ branch: 'luizfernando' });
  assert.equal(res.ok, true);
  assert.ok(exec.calls.some((c) => c.args.join(' ') === 'push origin luizfernando'));
});

test('openChange: calls gh pr create with title and base', async () => {
  const exec = fakeExec([['pr create', { code: 0, stdout: 'https://github.com/x/y/pull/7\n', stderr: '' }]]);
  const d = makeGithubDriver({ exec });
  const ref = await d.openChange({ title: 'T', body: 'B', base: 'main' });
  assert.match(ref.id, /pull\/7/);
  const call = exec.calls.find((c) => c.bin === 'gh');
  assert.ok(call.args.includes('--title') && call.args.includes('T'));
  assert.ok(call.args.includes('--base') && call.args.includes('main'));
});

test('createIssue: calls gh issue create with title', async () => {
  const exec = fakeExec([['issue create', { code: 0, stdout: 'https://github.com/x/y/issues/3\n', stderr: '' }]]);
  const d = makeGithubDriver({ exec });
  const issue = await d.createIssue({ title: 'Bug', body: 'desc' });
  assert.match(issue.id, /issues\/3/);
});

test('webUrl: builds github blob URL from repo + path', () => {
  const d = makeGithubDriver({ exec: fakeExec([]) });
  const url = d.webUrl({ repo: 'regen-coordination/org-os' }, 'BOOTSTRAP.md');
  assert.equal(url, 'https://github.com/regen-coordination/org-os/blob/main/BOOTSTRAP.md');
});

test('github driver satisfies the HostDriver contract suite', async () => {
  // Provide fakes that make read calls return contract-valid shapes.
  const exec = fakeExec([
    ['symbolic-ref', { code: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' }],
    ['rev-parse --abbrev-ref', { code: 0, stdout: 'main\n', stderr: '' }],
    ['rev-list', { code: 0, stdout: '0\t0\n', stderr: '' }],
  ]);
  const fetchFn = async () => { throw new Error('offline'); }; // fetchFile → null, allowed
  await runHostDriverContract(() => makeGithubDriver({ exec, fetchFn }), { assert });
});
