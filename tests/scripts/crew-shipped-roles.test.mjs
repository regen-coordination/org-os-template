// tests/scripts/crew-shipped-roles.test.mjs
//
// Guards the real roles/ tree (not fixtures): every role the framework ships must
// load, and the roster must keep the shape the crew design relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRoleIds, loadCircles, loadRole } from '../../scripts/crew/roles.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every shipped role loads', () => {
  const ids = listRoleIds(rootDir);
  assert.ok(ids.length >= 5, `expected at least five roles, found ${ids.join(', ')}`);
  for (const id of ids) assert.doesNotThrow(() => loadRole(rootDir, id), `roles/${id}.md`);
});

test('the five circles exist and the cap is a positive number', () => {
  const { circleIds, maxAgents } = loadCircles(rootDir);
  assert.deepEqual(circleIds, ['lead', 'strategy', 'research', 'engineering', 'commons']);
  assert.ok(maxAgents >= 1);
});

test('the lead role exists and may seat', () => {
  assert.equal(loadRole(rootDir, 'lead').may_seat, true);
});

test('every role body has the three sections and points at the shared boundaries', () => {
  for (const id of listRoleIds(rootDir)) {
    const text = readFileSync(join(rootDir, 'roles', `${id}.md`), 'utf-8');
    for (const heading of ['## Mandate', '## Boundaries', '## Done means']) {
      assert.ok(text.includes(heading), `roles/${id}.md is missing "${heading}"`);
    }
    assert.ok(text.includes('roles/README.md'), `roles/${id}.md does not refer to roles/README.md`);
  }
});

test('roles/README.md exists', () => {
  assert.ok(existsSync(join(rootDir, 'roles', 'README.md')));
});
