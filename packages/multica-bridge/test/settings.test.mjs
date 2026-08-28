// SCOPE: this file checks that the deny-list *strings* are present in the
// checked-in settings — nothing more. It does NOT verify that enforcement
// works, and it cannot: `permissions.deny` entries are prefix matches that a
// reordered flag or an inserted git global option walks straight past
// (`git -c core.pager=cat stash list`). Actual enforcement lives in the
// PreToolUse guard and is covered by deny-destructive-git.test.mjs, plus
// manual `claude -p` probes with harmless commands — spinning up a real
// Claude session inside a unit test is not economical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const settingsPath = resolve(repoRoot, '.claude/settings.json');

test('checked-in claude settings exist', () => {
  assert.ok(existsSync(settingsPath), `missing ${settingsPath}`);
});

test('destructive git ops are denied', () => {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const deny = settings?.permissions?.deny ?? [];
  for (const rule of [
    'Bash(git stash:*)',
    'Bash(git clean:*)',
    'Bash(git reset --hard:*)',
  ]) {
    assert.ok(deny.includes(rule), `missing deny rule: ${rule}`);
  }
});
