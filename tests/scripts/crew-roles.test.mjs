// tests/scripts/crew-roles.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CrewError, listRoleIds, loadCircles, loadRole, validateRole } from '../../scripts/crew/roles.mjs';
import { makeRoot, writeRole } from '../helpers/crew-fixtures.mjs';

const OK = { id: 'engineer', circle: 'engineering', kind: 'claude', may_seat: false };
const CTX = { fileId: 'engineer', circleIds: ['lead', 'engineering'] };

test('loadCircles reads the circles and the cap', () => {
  const root = makeRoot();
  const c = loadCircles(root);
  assert.deepEqual(c.circleIds, ['lead', 'engineering']);
  assert.equal(c.maxAgents, 2);
});

test('loadCircles defaults the cap to 4 and rejects a cap that is not a positive whole number', () => {
  const root = makeRoot();
  writeFileSync(join(root, 'roles', 'circles.yaml'), 'circles:\n  - { id: lead, name: L, purpose: p }\n');
  assert.equal(loadCircles(root).maxAgents, 4);
  writeFileSync(join(root, 'roles', 'circles.yaml'), 'max_agents: 0\ncircles: []\n');
  assert.throws(() => loadCircles(root), CrewError);
});

test('loadCircles says so when the repository has no roles', () => {
  const root = makeRoot();
  rmSync(join(root, 'roles'), { recursive: true });
  assert.throws(() => loadCircles(root), /no crew roles/);
});

test('validateRole accepts a complete role', () => {
  assert.deepEqual(validateRole(OK, CTX), []);
  assert.deepEqual(validateRole({ ...OK, model: 'sonnet', skills: ['crew'] }, CTX), []);
});

test('validateRole names each problem', () => {
  const errs = (data) => validateRole(data, CTX).join(' | ');
  assert.match(errs({ ...OK, id: undefined }), /id/);
  assert.match(errs({ ...OK, id: 'other' }), /file name/);
  assert.match(errs({ ...OK, id: 'Engineer' }), /id/);
  assert.match(errs({ ...OK, circle: 'nowhere' }), /circle "nowhere"/);
  assert.match(errs({ ...OK, kind: 'chatgpt' }), /kind "chatgpt"/);
  assert.match(errs({ ...OK, may_seat: 'yes' }), /may_seat/);
  assert.match(errs({ ...OK, may_seat: undefined }), /may_seat/);
  assert.match(errs({ ...OK, model: '' }), /model/);
  assert.match(errs({ ...OK, skills: 'crew' }), /skills/);
});

test('loadRole returns the role with defaults filled in', () => {
  const root = makeRoot();
  writeRole(root, 'researcher', { model: undefined });
  const role = loadRole(root, 'researcher');
  assert.equal(role.id, 'researcher');
  assert.equal(role.model, null);
  assert.deepEqual(role.skills, []);
  assert.equal(role.path, join(root, 'roles', 'researcher.md'));
  assert.equal(loadRole(root, 'lead').may_seat, true);
});

test('loadRole lists the available roles when asked for one that does not exist', () => {
  const root = makeRoot();
  assert.throws(() => loadRole(root, 'wizard'), /No role "wizard".*engineer, lead, reviewer/);
  assert.throws(() => loadRole(root, '../circles'), /No role/);
});

test('loadRole refuses an invalid role file and one with unreadable frontmatter', () => {
  const root = makeRoot();
  writeRole(root, 'broken', { kind: 'chatgpt' });
  assert.throws(() => loadRole(root, 'broken'), /roles\/broken\.md is not a valid role.*kind/);
  writeFileSync(join(root, 'roles', 'mangled.md'), '---\nid: [unclosed\n---\nbody\n');
  assert.throws(() => loadRole(root, 'mangled'), CrewError);
});

test('listRoleIds ignores the README and non-Markdown files', () => {
  const root = makeRoot();
  writeFileSync(join(root, 'roles', 'README.md'), '# Roles\n');
  assert.deepEqual(listRoleIds(root), ['engineer', 'lead', 'reviewer']);
});
