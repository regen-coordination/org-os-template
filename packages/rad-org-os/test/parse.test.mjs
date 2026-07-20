import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseRepoDoc, parseBlob } from '../src/parse.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = JSON.parse(readFileSync(join(here, 'fixtures/repo.json'), 'utf8'));
const blob = JSON.parse(readFileSync(join(here, 'fixtures/blob.json'), 'utf8'));

test('parseRepoDoc extracts canonical governance shape', () => {
  const r = parseRepoDoc(repo);
  assert.equal(r.defaultBranch, 'master');
  assert.equal(typeof r.threshold, 'number');
  assert.ok(Array.isArray(r.delegates));
  assert.ok(r.delegates.every((d) => typeof d.id === 'string'));
  assert.ok(/^[0-9a-f]{40}$/.test(r.head), 'head is a 40-char sha');
  assert.ok(['public', 'private'].includes(r.visibility));
});

test('parseBlob returns text content only for non-binary blobs', () => {
  assert.equal(typeof parseBlob(blob), 'string');
  assert.equal(parseBlob({ binary: true, content: 'x' }), null);
});
