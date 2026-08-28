import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const hookPath = resolve(repoRoot, 'scripts/git-hooks/pre-push');

function runHook(stdinLines) {
  return spawnSync('sh', [hookPath], { input: stdinLines, encoding: 'utf8' });
}

test('hook script exists', () => {
  assert.ok(existsSync(hookPath), `missing ${hookPath}`);
});

test('blocks pushing agent/* branches', () => {
  const r = runHook('refs/heads/agent/MUL-1 1111111 refs/heads/agent/MUL-1 2222222\n');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /agent\//);
});

test('allows pushing normal branches', () => {
  const r = runHook('refs/heads/feat/multica-operator 1111111 refs/heads/feat/multica-operator 2222222\n');
  assert.equal(r.status, 0);
});

test('blocks a mixed push containing an agent ref', () => {
  const r = runHook(
    'refs/heads/feat/x 1111111 refs/heads/feat/x 2222222\n' +
    'refs/heads/agent/MUL-9 1111111 refs/heads/agent/MUL-9 2222222\n'
  );
  assert.equal(r.status, 1);
});
