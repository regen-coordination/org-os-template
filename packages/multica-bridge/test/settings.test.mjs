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
