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

// The "Before you begin" list is read by every seat. The files it lists are the
// backticked names on its bullet lines. Prose in the section may mention a file
// too (DECISIONS.md is named in the paragraph after the list), so only the
// bullets count: deleting a bullet must fail the test, not be hidden by prose.
function beforeYouBegin() {
  const text = readFileSync(join(rootDir, 'roles', 'README.md'), 'utf-8');
  const m = text.match(/^## Before you begin\n([\s\S]*?)(?=^## )/m);
  return m ? m[1] : null;
}

function listedFiles(section) {
  return section
    .split('\n')
    .filter((line) => /^\s*[-*] /.test(line))
    .flatMap((line) => [...line.matchAll(/`([A-Za-z0-9_.\/-]+\.(?:md|yaml))`/g)].map((m) => m[1]));
}

const SHARED_LIST = ['MASTERPLAN.md', 'SOUL.md', 'MEMORY.md', 'DECISIONS.md'];

test('roles/README.md has a "Before you begin" section that names files which exist', () => {
  const section = beforeYouBegin();
  assert.ok(section, 'roles/README.md has lost its "## Before you begin" section');
  const files = listedFiles(section);
  assert.ok(files.length >= 3, `the section lists ${files.length} files`);
  for (const f of files) assert.ok(existsSync(join(rootDir, f)), `"Before you begin" lists ${f}, which does not exist`);
  for (const f of SHARED_LIST) assert.ok(files.includes(f), `the shared list lost ${f}`);
});

test('the list check fails when a bullet is removed, even though prose still names the file', () => {
  const section = beforeYouBegin();
  assert.ok(section.includes('`DECISIONS.md` is long'), 'the prose that names DECISIONS.md is gone, so this test proves nothing');
  const withoutBullet = section
    .split('\n')
    .filter((line) => line.trim() !== '- `DECISIONS.md`')
    .join('\n');
  assert.notEqual(withoutBullet, section, 'the DECISIONS.md bullet was not found to remove');
  assert.ok(withoutBullet.includes('`DECISIONS.md`'), 'prose still names the file');
  assert.ok(!listedFiles(withoutBullet).includes('DECISIONS.md'));
  assert.ok(listedFiles(section).includes('DECISIONS.md'));
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

// The website and platform seats are the framework repository's: a new instance does not
// receive their files (scripts/lib/clone-excludes.mjs), yet it does receive this test.
const frameworkSeats = ['website', 'platform'].filter((id) => existsSync(join(rootDir, 'roles', `${id}.md`)));

test('the lead, website and platform roles run on Opus 5.5 at high effort', () => {
  for (const id of ['lead', ...frameworkSeats]) {
    const role = loadRole(rootDir, id);
    assert.equal(role.model, 'claude-opus-5-5', `roles/${id}.md model`);
    assert.equal(role.effort, 'high', `roles/${id}.md effort`);
    assert.equal(role.kind, 'claude', `roles/${id}.md kind`);
  }
});

test('the website and platform roles sit in engineering, may not seat, and name what to read first', () => {
  for (const id of frameworkSeats) {
    const role = loadRole(rootDir, id);
    assert.equal(role.circle, 'engineering');
    assert.equal(role.may_seat, false);
    const text = readFileSync(role.path, 'utf-8');
    assert.match(text, /## Before you begin/, `roles/${id}.md`);
    assert.match(text, /docs\/superpowers\/(specs|plans)\//, `roles/${id}.md names no spec or plan`);
    assert.match(text, /handoff/, `roles/${id}.md does not route other roles' work by handoff`);
    assert.match(text, /deploy/, `roles/${id}.md does not forbid deploying`);
  }
});

test('the specs and plans the platform role names exist in this tree', { skip: !frameworkSeats.includes('platform') }, () => {
  const text = readFileSync(join(rootDir, 'roles', 'platform.md'), 'utf-8');
  const files = [...text.matchAll(/`((?:docs|packages)\/[A-Za-z0-9_.\/-]+\.md)`/g)].map((m) => m[1]);
  assert.ok(files.length >= 3, `names ${files.length} files`);
  for (const f of files) assert.ok(existsSync(join(rootDir, f)), `roles/platform.md names ${f}, which does not exist`);
});
