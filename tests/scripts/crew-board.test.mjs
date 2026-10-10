// tests/scripts/crew-board.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTrail, trailDir } from '../../scripts/crew/trail.mjs';
import { board, handoff, release, renderBoard, seat } from '../../scripts/crew/core.mjs';
import { asAgent, fakeHerdr, makeCtx, makeRoot } from '../helpers/crew-fixtures.mjs';

function crew() {
  const root = makeRoot();
  const ctx = makeCtx(root);
  const eng = seat(ctx, { roleId: 'engineer', brief: 'Build it' });
  return { root, ctx, eng };
}
const setState = (ctx, name, state) => {
  ctx.herdr.agents.find((a) => a.name === name).state = state;
};

test('release marks the assignment released and removes a clean worktree', () => {
  const { ctx, eng } = crew();
  // The real adapter removes the directory; make the fake do the same.
  const original = ctx.herdr.removeWorktree;
  ctx.herdr.removeWorktree = (ws) => original(ws, eng.worktree);
  const r = release(ctx, { target: 'engineer' });
  assert.equal(r.assignment.status, 'released');
  assert.equal(r.removed, true);
  assert.deepEqual(r.left, []);
  assert.deepEqual(ctx.herdr.calls.at(-1), ['removeWorktree', { workspaceId: eng.workspace }]);
  assert.ok(!existsSync(eng.worktree));
  assert.equal(readTrail(ctx.mainDir).assignments[0].status, 'released');
});

test('release leaves a worktree that has uncommitted work and says what is in it', () => {
  const { ctx, eng } = crew();
  ctx.git.dirty.set(eng.worktree, [' M scripts/x.mjs', '?? notes.md']);
  const r = release(ctx, { target: eng.id });
  assert.equal(r.assignment.status, 'released');
  assert.equal(r.removed, false);
  assert.deepEqual(r.left, [' M scripts/x.mjs', '?? notes.md']);
  assert.ok(existsSync(eng.worktree));
  assert.ok(!ctx.herdr.calls.some((c) => c[0] === 'removeWorktree'));
});

test('release is refused while the agent is working', () => {
  const { ctx } = crew();
  setState(ctx, 'engineer', 'working');
  assert.throws(() => release(ctx, { target: 'engineer' }), /still working/);
  assert.equal(readTrail(ctx.mainDir).assignments[0].status, 'working');
});

test('release falls back to git when herdr no longer knows the workspace', () => {
  const { ctx, eng } = crew();
  ctx.herdr.agents = []; // herdr restarted
  ctx.herdr.failOn = { method: 'removeWorktree', code: 'workspace_not_found', message: 'no such workspace' };
  const r = release(ctx, { target: eng.id });
  assert.equal(r.removed, true);
  assert.deepEqual(ctx.git.calls.at(-1), ['removeWorktree', { path: eng.worktree }]);
});

test('release reports when the worktree could not be removed at all', () => {
  const { ctx, eng } = crew();
  ctx.herdr.failOn = { method: 'removeWorktree', message: 'no such workspace' };
  ctx.git.removeWorktree = () => {
    throw new Error('locked');
  };
  const r = release(ctx, { target: eng.id });
  assert.equal(r.assignment.status, 'released');
  assert.equal(r.removed, false);
  assert.match(r.left[0], /could not be removed: locked/);
});

test('release accepts an abandoned outcome and a failed assignment', () => {
  const { ctx, eng } = crew();
  assert.equal(release(ctx, { target: eng.id, outcome: 'abandoned' }).assignment.status, 'abandoned');
  ctx.herdr.failOn = { method: 'createWorktree', message: 'boom' };
  assert.throws(() => seat(ctx, { roleId: 'reviewer', brief: 'x' }));
  ctx.herdr.failOn = null;
  const failed = readTrail(ctx.mainDir).assignments.find((a) => a.status === 'failed');
  assert.equal(release(ctx, { target: failed.id }).assignment.status, 'released');
});

test('release is refused for an unknown target, a bad outcome and a non-lead agent', () => {
  const { ctx, eng } = crew();
  assert.throws(() => release(ctx, { target: 'nobody' }), /No open assignment matches "nobody"/);
  assert.throws(() => release(ctx, { target: eng.id, outcome: 'won' }), /done or abandoned/);
  assert.throws(() => release(asAgent(ctx, eng), { target: eng.id }), /may not release/);
});

test('the board joins live state with the trail and ignores other agents', () => {
  const root = makeRoot();
  const ctx = makeCtx(root, { herdr: fakeHerdr([{ name: 'someone', pane_id: 'o1:p1', workspace_id: 'o1' }]) });
  const lead = seat(ctx, { roleId: 'lead', brief: 'Coordinate the release\nwith a second line' });
  const eng = seat(asAgent(ctx, lead), { roleId: 'engineer', brief: 'Build it' });
  setState(ctx, 'engineer', 'blocked');
  setState(ctx, 'lead', 'working');
  const b = board(ctx);
  assert.deepEqual(b.rows.map((r) => [r.agent, r.role, r.state]), [
    ['engineer', 'engineer', 'blocked'], // blocked rows come first
    ['lead', 'lead', 'working'],
  ]);
  assert.equal(b.rows[1].brief, 'Coordinate the release');
  assert.equal(b.rows[0].branch, eng.branch);
  assert.deepEqual(b.needsRelease, []);
});

test('an assignment whose agent is gone needs release, and so does a failed seating', () => {
  const { ctx, eng } = crew();
  ctx.herdr.failOn = { method: 'createWorktree', message: 'boom' };
  assert.throws(() => seat(ctx, { roleId: 'reviewer', brief: 'x' }));
  ctx.herdr.agents = [];
  const b = board(ctx);
  assert.deepEqual(b.rows, []);
  assert.deepEqual(b.needsRelease.map((a) => [a.id, a.status]).sort(), [
    [eng.id, 'working'],
    [readTrail(ctx.mainDir).assignments.find((a) => a.status === 'failed').id, 'failed'],
  ].sort());
});

test('the board lists open handoffs and unreadable trail files', () => {
  const { ctx, eng } = crew();
  handoff(asAgent(ctx, eng), { toRole: 'reviewer', brief: 'Review my branch' });
  writeFileSync(join(trailDir(ctx.mainDir), 'mangled.md'), '---\nid: [unclosed\n---\n');
  const b = board(ctx);
  assert.deepEqual(b.handoffs.map((h) => [h.from_role, h.to_role, h.brief]), [['engineer', 'reviewer', 'Review my branch']]);
  assert.deepEqual(b.unreadable, ['mangled.md']);
});

test('board is refused outside herdr', () => {
  const ctx = makeCtx(makeRoot(), { env: {} });
  assert.throws(() => board(ctx), /inside herdr/);
});

test('renderBoard prints a table, the handoffs and what needs attention', () => {
  const { ctx, eng } = crew();
  handoff(asAgent(ctx, eng), { toRole: 'reviewer', brief: 'Review my branch' });
  writeFileSync(join(trailDir(ctx.mainDir), 'mangled.md'), '---\nid: [unclosed\n---\n');
  const later = new Date(ctx.now().getTime() + 42 * 60 * 1000);
  const text = renderBoard(board(ctx), later);
  const lines = text.split('\n');
  assert.match(lines[0], /^AGENT\s+ROLE\s+STATE\s+ASSIGNMENT\s+BRANCH\s+AGE$/);
  assert.match(lines[1], /^engineer\s+engineer\s+idle\s+Build it\s+crew\/\S+\s+42m$/);
  assert.match(text, /Open handoffs: 1\n  engineer → reviewer: "Review my branch"/);
  assert.match(text, /Could not read: mangled\.md/);

  ctx.herdr.agents = [];
  const orphaned = renderBoard(board(ctx), later);
  assert.match(orphaned, /No crew agents are seated\./);
  assert.match(orphaned, new RegExp(`Needs release: 1\\n  ${eng.id} \\(trail says working, no live agent\\)`));
});

test('renderBoard shows hours and days, and an empty board', () => {
  const { ctx } = crew();
  const at = (ms) => renderBoard(board(ctx), new Date(ctx.now().getTime() + ms));
  assert.match(at(3 * 3600 * 1000), /\s3h$/m);
  assert.match(at(50 * 3600 * 1000), /\s2d$/m);
  const empty = makeCtx(makeRoot());
  assert.equal(renderBoard(board(empty), empty.now()), 'No crew agents are seated.\n');
});
