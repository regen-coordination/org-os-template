// tests/scripts/crew-board.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTrail, trailDir } from '../../scripts/crew/trail.mjs';
import { board, handoff, release, renderBoard, report, seat } from '../../scripts/crew/core.mjs';
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
  assert.match(lines[0], /^AGENT\s+ROLE\s+STATE\s+STATUS\s+ASSIGNMENT\s+BRANCH\s+AGE$/);
  assert.match(lines[1], /^engineer\s+engineer\s+idle\s+working\s+Build it\s+crew\/\S+\s+42m$/);
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

test('release saves commits made in a detached copy to a branch before removing it', () => {
  const { ctx, eng } = crew();
  ctx.git.refs.add('feature');
  const rev = seat(ctx, { roleId: 'reviewer', brief: 'Fix what you find', on: 'feature' });
  ctx.git.unreachable.add(rev.worktree); // the agent committed on the detached HEAD
  const r = release(ctx, { target: rev.id });
  assert.equal(r.rescued, `crew/${rev.id}`);
  assert.equal(r.assignment.rescued_branch, `crew/${rev.id}`);
  assert.equal(r.removed, true);
  const order = [...ctx.git.calls.map((c) => c[0]), ...ctx.herdr.calls.map((c) => c[0])];
  assert.ok(order.includes('rescueDetached'));
  // an ordinary seat has its own branch: nothing to rescue, and git is not asked
  const plain = release(ctx, { target: eng.id });
  assert.equal(plain.rescued, null);
  assert.equal(ctx.git.calls.filter((c) => c[0] === 'rescueDetached').length, 1);
});

test('release leaves a detached copy alone when its commits could not be saved', () => {
  const { ctx } = crew();
  ctx.git.refs.add('feature');
  const rev = seat(ctx, { roleId: 'reviewer', brief: 'Fix it', on: 'feature' });
  ctx.git.rescueDetached = () => {
    throw new Error('a branch named crew/x already exists');
  };
  const r = release(ctx, { target: rev.id });
  assert.equal(r.removed, false);
  assert.match(r.left[0], /could not be saved to a branch: a branch named crew\/x already exists/);
  assert.ok(existsSync(rev.worktree));
  assert.ok(!ctx.herdr.calls.some((c) => c[0] === 'removeWorktree'));
});

test('release does not ask herdr to remove a workspace that is no longer this assignment\'s', () => {
  const { ctx, eng } = crew();
  ctx.herdr.agents = [];
  ctx.herdr.workspaces.set(eng.workspace, '/somewhere/else'); // the id now names another workspace
  const r = release(ctx, { target: eng.id });
  assert.equal(r.removed, true);
  assert.ok(!ctx.herdr.calls.some((c) => c[0] === 'removeWorktree'));
  assert.deepEqual(ctx.git.calls.at(-1), ['removeWorktree', { path: eng.worktree }]);
});

test('the board survives a trail file that lost a field', () => {
  const { ctx, eng } = crew();
  const file = readTrail(ctx.mainDir).assignments[0].file;
  writeFileSync(file, `---\nid: ${eng.id}\nstatus: working\npane: ${eng.pane}\n---\n## Brief\n\nx\n`);
  const b = board(ctx);
  assert.deepEqual(b.rows, []);
  assert.equal(b.unreadable.length, 1);
  assert.match(renderBoard(b, ctx.now()), /Could not read: /);
});

test('a row carries the trail status next to the live state, so a reported agent is not mistaken for an idle one', () => {
  const { ctx, eng } = crew();
  assert.equal(board(ctx).rows[0].status, 'working');
  report(asAgent(ctx, eng), { text: 'Done.' });
  const b = board(ctx);
  assert.equal(b.rows[0].state, 'idle'); // live state still comes from herdr alone
  assert.equal(b.rows[0].status, 'reported');
  assert.match(renderBoard(b, ctx.now()).split('\n')[1], /\sidle\s+reported\s/);
});

test('a released assignment whose worktree was left behind is listed, and releasing it again retries the removal', () => {
  const { ctx, eng } = crew();
  const original = ctx.herdr.removeWorktree;
  ctx.herdr.removeWorktree = (ws) => original(ws, eng.worktree); // the real adapter removes the directory
  ctx.git.dirty.set(eng.worktree, [' M a.mjs']);
  const first = release(ctx, { target: eng.id, outcome: 'abandoned' });
  assert.equal(first.removed, false);
  ctx.herdr.agents = [];

  const b = board(ctx);
  assert.deepEqual(b.leftBehind.map((a) => [a.id, a.status, a.worktree]), [[eng.id, 'abandoned', eng.worktree]]);
  assert.match(renderBoard(b, ctx.now()), new RegExp(`Worktrees left behind: 1\\n  ${eng.id} \\(abandoned; its worktree is still at ${eng.worktree}\\)`));

  // still dirty: nothing is forced, what is left is listed, the outcome is kept
  const again = release(ctx, { target: eng.id });
  assert.equal(again.removed, false);
  assert.deepEqual(again.left, [' M a.mjs']);
  assert.equal(again.assignment.status, 'abandoned');
  assert.ok(existsSync(eng.worktree));

  // the operator dealt with the changes: the retry removes it
  ctx.git.dirty.delete(eng.worktree);
  const done = release(ctx, { target: eng.id });
  assert.equal(done.removed, true);
  assert.equal(done.assignment.status, 'abandoned');
  assert.equal(readTrail(ctx.mainDir).assignments[0].worktree_removed, true);
  assert.ok(!existsSync(eng.worktree));
  assert.deepEqual(board(ctx).leftBehind, []);
  assert.throws(() => release(ctx, { target: eng.id }), /No open assignment matches/);
});

test('a closed assignment whose worktree was removed is not on the board and is refused', () => {
  const { ctx, eng } = crew();
  release(ctx, { target: eng.id });
  assert.deepEqual(board(ctx).leftBehind, []);
  assert.throws(() => release(ctx, { target: eng.id }), /No open assignment matches/);
});

test('a retried release of a detached copy does not try to save its commits a second time', () => {
  const { ctx } = crew();
  ctx.git.refs.add('feature');
  const rev = seat(ctx, { roleId: 'reviewer', brief: 'Fix it', on: 'feature' });
  ctx.git.unreachable.add(rev.worktree);
  ctx.git.dirty.set(rev.worktree, ['?? x']);
  const first = release(ctx, { target: rev.id });
  assert.equal(first.rescued, `crew/${rev.id}`);
  ctx.git.dirty.delete(rev.worktree);
  const again = release(ctx, { target: rev.id });
  assert.equal(again.removed, true);
  assert.equal(again.rescued, `crew/${rev.id}`);
  assert.equal(readTrail(ctx.mainDir).assignments.find((a) => a.id === rev.id).rescued_branch, `crew/${rev.id}`);
  assert.equal(ctx.git.calls.filter((c) => c[0] === 'rescueDetached').length, 1);
});

test('releasing a failed seating says what is true: no worktree existed and no branch was made', () => {
  const { ctx } = crew();
  ctx.herdr.failOn = { method: 'createWorktree', message: 'boom' };
  assert.throws(() => seat(ctx, { roleId: 'reviewer', brief: 'x' }));
  ctx.herdr.failOn = null;
  const failed = readTrail(ctx.mainDir).assignments.find((a) => a.status === 'failed');
  const r = release(ctx, { target: failed.id });
  assert.equal(r.worktreeExisted, false);
  assert.equal(r.branchKept, false);
  // an ordinary release does have both
  const eng = readTrail(ctx.mainDir).assignments.find((a) => a.role === 'engineer');
  ctx.git.refs.add(eng.branch);
  const ok = release(ctx, { target: eng.id });
  assert.equal(ok.worktreeExisted, true);
  assert.equal(ok.removed, true);
  assert.equal(ok.branchKept, true);
});
