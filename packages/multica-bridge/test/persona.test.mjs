import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(pkgRoot, '..', '..');
const personaPath = resolve(pkgRoot, 'personas/org-os-operator.md');

test('persona file exists', () => {
  assert.ok(existsSync(personaPath), `missing ${personaPath}`);
});

test('persona covers the non-negotiable markers', () => {
  const text = readFileSync(personaPath, 'utf8');
  for (const marker of [
    'agent/',            // branch discipline
    'memory/',           // memory append rule
    'generate:schemas',  // schema regen after data changes
    'draft-and-present', // external action gate
    'IDENTITY.md',       // bootstrap context
    'git push',          // must state the push prohibition
  ]) {
    assert.ok(text.includes(marker), `persona missing required marker: ${marker}`);
  }
});

test('every concrete repo file the persona references exists', () => {
  const text = readFileSync(personaPath, 'utf8');
  const refs = [...text.matchAll(/`([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:md|yaml|json))`/g)]
    .map((m) => m[1]);
  assert.ok(refs.length >= 3, 'persona should reference concrete repo files');
  for (const ref of refs) {
    assert.ok(existsSync(resolve(repoRoot, ref)), `persona references missing file: ${ref}`);
  }
});
