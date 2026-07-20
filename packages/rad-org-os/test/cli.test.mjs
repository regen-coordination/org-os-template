import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../bootstrap/cli.mjs';

test('parseArgs reads targetDir, name, visibility, seed', () => {
  const o = parseArgs(['/tmp/org', '--name', 'my-org', '--public', '--seed', 'https://s.example']);
  assert.equal(o.targetDir, '/tmp/org');
  assert.equal(o.name, 'my-org');
  assert.equal(o.visibility, 'public');
  assert.equal(o.seed, 'https://s.example');
});
