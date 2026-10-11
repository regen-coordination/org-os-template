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

// The "Before you begin" list is read by every seat. It is prose, so the test
// reads the backticked names in the section and checks each one exists here.
function beforeYouBegin() {
  const text = readFileSync(join(rootDir, 'roles', 'README.md'), 'utf-8');
  const m = text.match(/^## Before you begin\n([\s\S]*?)(?=^## )/m);
  return m ? m[1] : null;
}

test('roles/README.md has a "Before you begin" section that names files which exist', () => {
  const section = beforeYouBegin();
  assert.ok(section, 'roles/README.md has lost its "## Before you begin" section');
  const files = [...section.matchAll(/`([A-Za-z0-9_.\/-]+\.(?:md|yaml))`/g)].map((m) => m[1]);
  assert.ok(files.length >= 3, `the section names ${files.length} files`);
  for (const f of files) assert.ok(existsSync(join(rootDir, f)), `"Before you begin" names ${f}, which does not exist`);
  for (const f of ['MASTERPLAN.md', 'SOUL.md', 'MEMORY.md']) assert.ok(files.includes(f), `the shared list lost ${f}`);
});

test('a role may add to the Before you begin list; lead adds HEARTBEAT.md and AGENTS.md', () => {
  const text = readFileSync(join(rootDir, 'roles', 'lead.md'), 'utf-8');
  assert.match(text, /Before you begin/);
  assert.match(text, /HEARTBEAT\.md/);
  assert.match(text, /AGENTS\.md/);
});

test('every report must name the onboarding files read', () => {
  const text = readFileSync(join(rootDir, 'roles', 'README.md'), 'utf-8');
  assert.match(text, /Report before you stop\.\*\*[^]*?onboarding files/);
});
