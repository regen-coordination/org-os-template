// Behavioural tests for the PreToolUse guard that actually enforces the
// destructive-git ban. Unlike settings.test.mjs (which only checks that the
// deny-list strings exist), these tests spawn the real guard with real hook
// payloads and assert on its exit code — the same signal Claude Code reads.
//
// Contract (Claude Code 2.1.x, https://code.claude.com/docs/en/hooks):
//   stdin  = JSON with { tool_name, tool_input: { command }, ... }
//   exit 2 = block the tool call, stderr goes to the model
//   exit 0 = no decision, normal permission flow continues
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const guardPath = resolve(repoRoot, 'scripts/guards/deny-destructive-git.mjs');

function runGuard(payload) {
  return spawnSync(process.execPath, [guardPath], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
  });
}

function runBash(command) {
  return runGuard({
    session_id: 'test',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  });
}

test('guard script exists', () => {
  assert.ok(existsSync(guardPath), `missing ${guardPath}`);
});

const BLOCKED = [
  // plain spellings the prefix deny-list already caught
  'git stash',
  'git stash push -u',
  'git clean -fd',
  'git reset --hard',
  'git reset --hard HEAD~1',
  // the bypasses that defeat a prefix match — the reason this guard exists
  'git -c core.pager=cat stash list',
  'git --no-pager stash list',
  'git -C /tmp/scratch clean -fdx',
  'git reset -q --hard',
  'git reset HEAD~1 --hard',
  'git --git-dir=/tmp/x/.git reset --hard',
  // wrappers and chaining
  "sh -c 'git stash'",
  'ls && git clean -fd',
  'echo hi; git stash pop',
  'env FOO=1 git reset --hard',
  '/usr/bin/git stash',
  // long-option abbreviation: git accepts any unambiguous prefix, so
  // `git reset --ha` is exactly as destructive as `git reset --hard`
  'git reset --ha',
  'git reset --har',
];

for (const command of BLOCKED) {
  test(`blocks: ${command}`, () => {
    const r = runBash(command);
    assert.equal(r.status, 2, `expected exit 2, got ${r.status} (stderr: ${r.stderr})`);
    assert.match(r.stderr, /vault|blocked|destructive/i);
  });
}

const ALLOWED = [
  'git status',
  'git status --short',
  'git commit -m "reset the counter"',
  'git log --oneline',
  'git log --oneline -20',
  'npm run generate:schemas',
  'git reset --soft HEAD~1',
  'git reset HEAD -- file.txt',
  'git diff --cached',
  'npm test --prefix packages/multica-bridge',
  'ls -la .git/hooks',
  'git add packages/multica-bridge/README.md',
];

for (const command of ALLOWED) {
  test(`allows: ${command}`, () => {
    const r = runBash(command);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status} (stderr: ${r.stderr})`);
  });
}

test('non-Bash tool calls pass through', () => {
  const r = runGuard({
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: '/tmp/git-stash-notes.md' },
  });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status} (stderr: ${r.stderr})`);
});

test('fails closed on unparseable payload', () => {
  const r = runGuard('not json at all');
  assert.equal(r.status, 2, `expected exit 2, got ${r.status} (stderr: ${r.stderr})`);
});

test('fails closed when the command field is missing', () => {
  const r = runGuard({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} });
  assert.equal(r.status, 2, `expected exit 2, got ${r.status} (stderr: ${r.stderr})`);
});

test('settings.json wires the guard as a PreToolUse hook on Bash', async () => {
  const { readFileSync } = await import('node:fs');
  const settings = JSON.parse(readFileSync(resolve(repoRoot, '.claude/settings.json'), 'utf8'));
  const entries = settings?.hooks?.PreToolUse ?? [];
  const wired = entries.some(
    (entry) =>
      /Bash/.test(entry.matcher ?? '') &&
      (entry.hooks ?? []).some((h) => (h.command ?? '').includes('deny-destructive-git.mjs')),
  );
  assert.ok(wired, 'no PreToolUse/Bash hook invoking deny-destructive-git.mjs');
});

test('the wired hook command fails closed if the guard cannot run at all', async () => {
  // Claude Code treats any exit code other than 2 as a *non-blocking* error,
  // so a missing `node`, a deleted guard file or a syntax error would silently
  // reopen the boundary. `|| exit 2` maps every failure to a block.
  const { readFileSync } = await import('node:fs');
  const settings = JSON.parse(readFileSync(resolve(repoRoot, '.claude/settings.json'), 'utf8'));
  const command = settings.hooks.PreToolUse.flatMap((e) => e.hooks ?? []).find((h) =>
    (h.command ?? '').includes('deny-destructive-git.mjs'),
  ).command;
  assert.match(command, /\|\|\s*exit 2/, `hook command is not fail-closed: ${command}`);
});

test('the fail-closed wrapper blocks when the guard is missing', () => {
  const r = spawnSync(
    'sh',
    ['-c', `node "${resolve(repoRoot, 'scripts/guards/does-not-exist.mjs')}" || exit 2`],
    { input: '{}', encoding: 'utf8' },
  );
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}`);
});
