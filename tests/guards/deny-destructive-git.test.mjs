// Behavioural tests for the PreToolUse guard that actually enforces the
// destructive-git ban. These spawn the real guard with real hook payloads and
// assert on its exit code — the same signal Claude Code reads.
//
// This suite lives under root `tests/` on purpose: `npm test` globs
// `tests/**/*.test.mjs`, so a suite anywhere else (the older copy in
// packages/multica-bridge/test/ is the precedent) is invisible to every
// release gate. A safety control has to be inside the gate.
//
// Contract (Claude Code 2.1.x, https://code.claude.com/docs/en/hooks):
//   stdin  = JSON with { tool_name, tool_input: { command }, ... }
//   exit 2 = block the tool call, stderr goes to the model
//   exit 0 = no decision, normal permission flow continues
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
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
  'git stash --include-untracked',
  'git clean',
  'git clean -fd',
  'git   clean   -fdx',
  'git reset --hard',
  'git reset --hard HEAD~1',
  'git reset --hard origin/main',
  // the bypasses that defeat a prefix match — the reason this guard exists
  'git -c core.pager=cat stash list',
  'git --no-pager stash list',
  'git -C /tmp/scratch clean -fdx',
  'git -c x=y -C /tmp clean -f',
  'git reset -q --hard',
  'git reset HEAD~1 --hard',
  'git --git-dir=/tmp/x/.git reset --hard',
  // wrappers and chaining
  "sh -c 'git stash'",
  'ls && git clean -fd',
  'echo hi; git stash pop',
  'true || git clean -fd',
  'env FOO=1 git reset --hard',
  'sudo git clean -xfd',
  'xargs git clean -fd',
  'cat f.txt | xargs -I{} git stash',
  '/usr/bin/git stash',
  'git -C "$DIR" clean -fd',
  // long-option abbreviation: git accepts any unambiguous prefix, so
  // `git reset --ha` is exactly as destructive as `git reset --hard`
  'git reset --ha',
  'git reset --har',
  // dashed invocations: `-` is no longer a word boundary for the bare verb,
  // so these are matched explicitly (A6 keeps them blocked)
  'git-clean -fd',
  'git-stash',
  'git-stash push -u',
  '/usr/libexec/git-core/git-clean -fdx',
  // a subcommand we cannot resolve statically is refused, not guessed
  'git $CMD',
  'git $(echo clean)',
  'git ${VERB} -fd',
];

for (const command of BLOCKED) {
  test(`blocks: ${command}`, () => {
    const r = runBash(command);
    assert.equal(r.status, 2, `expected exit 2, got ${r.status} (stderr: ${r.stderr})`);
    assert.match(r.stderr, /vault|blocked|destructive|expansion/i);
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
  // ordinary release-session traffic
  'git worktree remove .claude/worktrees/v05-main',
  'git push origin main --follow-tags',
  'git -C ../refi-med-os status',
];

for (const command of ALLOWED) {
  test(`allows: ${command}`, () => {
    const r = runBash(command);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status} (stderr: ${r.stderr})`);
  });
}

// --- A6 regression fixtures -------------------------------------------------
// Both false-positive classes observed on 2026-08-28 (HEARTBEAT "Vault-safety
// guard over-matches `clean`"). Before A6, `\bclean\b` / `\bstash\b` were
// tested against the WHOLE command string with no requirement that the word sit
// in git subcommand position, and `-` and `/` count as word boundaries — so a
// filename and an unrelated echo were enough to block. These must stay allowed.
const A6_REGRESSIONS = [
  // observed false positive 1: the word merely echoed beside an unrelated git
  'echo "working tree clean" && git status',
  'echo "tree is clean"; git status --short',
  // observed false positive 2: the clean-room filename in a pathspec, which
  // forced the `git commit -F <file>` workaround six release handoffs teach
  'git add memory/reports/clean-room-bootstrap-2026-08-21.md',
  'git add docs/superpowers/reports/clean-room-bootstrap-2026-08-21.md',
  'git commit -m "docs: clean-room bootstrap findings"',
  'git log --oneline -- memory/reports/clean-room-bootstrap-2026-08-21.md',
  // a grep pattern beside a git-hooks path (the second observed case)
  'grep -rn clean scripts/git-hooks/',
  'grep -rn "stash" scripts/git-hooks/pre-commit',
  // commit messages naming the verbs are fine — they are not invocations
  'git commit -m "clean up the stash docs"',
  'git log --grep=stash',
  // `--hard` after an invocation boundary must not arm the previous `reset`
  'git reset HEAD -- file.txt && echo --hard',
  // a path that merely contains the word
  'cat scripts/lib/clean-utils.mjs && git status',
  'npm run vault:snapshot -- "before clean-room re-run"',
];

for (const command of A6_REGRESSIONS) {
  test(`A6 regression — allows: ${command}`, () => {
    const r = runBash(command);
    assert.equal(r.status, 0, `expected exit 2->0 after A6, got ${r.status} (stderr: ${r.stderr})`);
  });
}

test('documented out-of-scope commands are still not claimed to be caught', () => {
  // packages/multica-bridge/docs/SETUP.md "Known limitations" states the guard
  // does not cover these. Pinning it keeps the docs honest in both directions.
  for (const command of ['git checkout -- .', 'git restore .', 'rm -rf build']) {
    assert.equal(runBash(command).status, 0, `unexpectedly blocked: ${command}`);
  }
});

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

test('the guard is a single self-contained file with no imports', () => {
  // SETUP.md tells operators to copy exactly this file (plus settings.json)
  // into each new instance, so it must not grow a relative dependency.
  const source = readFileSync(guardPath, 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m, 'guard must not import anything');
  assert.doesNotMatch(source, /^\s*export\s/m, 'guard must not export — it is a script, not a module');
});

test('settings.json wires the guard as a PreToolUse hook on Bash', () => {
  const settings = JSON.parse(readFileSync(resolve(repoRoot, '.claude/settings.json'), 'utf8'));
  const entries = settings?.hooks?.PreToolUse ?? [];
  const wired = entries.some(
    (entry) =>
      /Bash/.test(entry.matcher ?? '') &&
      (entry.hooks ?? []).some((h) => (h.command ?? '').includes('deny-destructive-git.mjs')),
  );
  assert.ok(wired, 'no PreToolUse/Bash hook invoking deny-destructive-git.mjs');
});

test('the wired hook command fails closed if the guard cannot run at all', () => {
  // Claude Code treats any exit code other than 2 as a *non-blocking* error,
  // so a missing `node`, a deleted guard file or a syntax error would silently
  // reopen the boundary. `|| exit 2` maps every failure to a block.
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
