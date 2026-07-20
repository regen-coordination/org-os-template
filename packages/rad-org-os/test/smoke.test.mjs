import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

test('read-path fixtures are present and well-formed', () => {
  const repo = JSON.parse(readFileSync(join(here, 'fixtures/repo.json'), 'utf8'));
  assert.equal(typeof repo.threshold, 'number');
  assert.ok(Array.isArray(repo.delegates));
  assert.ok(repo.payloads['xyz.radicle.project'].data.defaultBranch);
  const blob = JSON.parse(readFileSync(join(here, 'fixtures/blob.json'), 'utf8'));
  assert.equal(blob.binary, false);
  assert.equal(typeof blob.content, 'string');
});
