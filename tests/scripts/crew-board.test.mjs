// tests/scripts/crew-board.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTrail, trailDir, updateRecord } from '../../scripts/crew/trail.mjs';
import { board, handoff, release, releaseLines, renderBoard, report, seat } from '../../scripts/crew/core.mjs';
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

test('a retried release of a detached copy keeps the recorded branch when nothing new needs saving', () => {
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
});

test('a retried release saves a commit made after the first release, under a new name', () => {
  const { ctx } = crew();
  ctx.git.refs.add('feature');
  const rev = seat(ctx, { roleId: 'reviewer', brief: 'Fix it', on: 'feature' });
  ctx.git.unreachable.add(rev.worktree);
  ctx.git.dirty.set(rev.worktree, ['?? x']);
  release(ctx, { target: rev.id });
  // the operator commits the changes in the worktree: HEAD is on no branch again
  ctx.git.dirty.delete(rev.worktree);
  ctx.git.unreachable.add(rev.worktree);
  const again = release(ctx, { target: rev.id });
  assert.equal(again.rescued, `crew/${rev.id}-2`);
  assert.equal(again.removed, true);
  assert.ok(ctx.git.refs.has(`crew/${rev.id}`), 'the first rescue branch is not touched');
  assert.equal(readTrail(ctx.mainDir).assignments.find((a) => a.id === rev.id).rescued_branch, `crew/${rev.id}-2`);
});

test('a retried release does not remove the worktree when the new commits could not be saved', () => {
  const { ctx } = crew();
  ctx.git.refs.add('feature');
  const rev = seat(ctx, { roleId: 'reviewer', brief: 'Fix it', on: 'feature' });
  ctx.git.unreachable.add(rev.worktree);
  ctx.git.dirty.set(rev.worktree, ['?? x']);
  release(ctx, { target: rev.id });
  ctx.git.dirty.delete(rev.worktree);
  ctx.git.rescueDetached = () => {
    throw new Error('disk full');
  };
  const again = release(ctx, { target: rev.id });
  assert.equal(again.removed, false);
  assert.ok(existsSync(rev.worktree));
  assert.equal(again.assignment.rescued_branch, `crew/${rev.id}`, 'the recorded branch survives a failed save');
});

test('a retry with an outcome that differs from the recorded one is refused; the same one, or none, proceeds', () => {
  const { ctx, eng } = crew();
  const original = ctx.herdr.removeWorktree;
  ctx.herdr.removeWorktree = (ws) => original(ws, eng.worktree);
  ctx.git.dirty.set(eng.worktree, [' M a.mjs']);
  release(ctx, { target: eng.id, outcome: 'abandoned' });
  ctx.herdr.agents = [];
  assert.throws(
    () => release(ctx, { target: eng.id, outcome: 'done' }),
    new RegExp(`${eng.id} is already abandoned; a retry only finishes removing the worktree\.`),
  );
  assert.ok(existsSync(eng.worktree), 'a refused retry touches nothing');
  const same = release(ctx, { target: eng.id, outcome: 'abandoned' });
  assert.equal(same.assignment.status, 'abandoned');
  ctx.git.dirty.delete(eng.worktree);
  assert.equal(release(ctx, { target: eng.id }).removed, true);
});

test('a first release with no outcome means done', () => {
  const { ctx, eng } = crew();
  assert.equal(release(ctx, { target: eng.id }).assignment.status, 'released');
});

test('the closed-assignment fallback does not hide an ambiguous open name', () => {
  const { ctx, eng } = crew();
  const a = readTrail(ctx.mainDir).assignments[0];
  // a closed record of the same agent whose worktree was left behind
  const stale = join(trailDir(ctx.mainDir), 'stale.md');
  const open = readTrail(ctx.mainDir).assignments[0];
  mkdirSync(a.worktree + '-old', { recursive: true });
  writeFileSync(
    stale,
    `---\nid: stale\nagent: ${a.agent}\nrole: engineer\nstatus: released\nworktree: ${a.worktree}-old\nworktree_removed: false\nbranch: b\npane: null\ncreated: '2026-10-10T10:00:00Z'\n---\n## Brief\n\nx\n`,
  );
  // two open assignments sharing the agent name
  writeFileSync(join(trailDir(ctx.mainDir), 'twin.md'), readFileSync(open.file, 'utf-8').replace(`id: ${eng.id}`, 'id: twin'));
  assert.throws(() => release(ctx, { target: a.agent }), /More than one open assignment has an agent named/);
});

test('a retry on a closed assignment does not consult the pane its agent once had', () => {
  const { ctx, eng } = crew();
  const original = ctx.herdr.removeWorktree;
  ctx.herdr.removeWorktree = (ws) => original(ws, eng.worktree);
  ctx.git.dirty.set(eng.worktree, [' M a.mjs']);
  release(ctx, { target: eng.id });
  // herdr now hands that pane id to some other agent that is working
  ctx.herdr.agents = [{ pane_id: eng.pane, name: 'someone-else', state: 'working', workspace_id: 'ws-other' }];
  ctx.git.dirty.delete(eng.worktree);
  const r = release(ctx, { target: eng.id });
  assert.equal(r.removed, true);
});

test('releaseLines says only what is true, one sentence per case', () => {
  const base = { assignment: { id: 'a1', status: 'released', branch: 'crew/a1', detached: false, worktree: '/w/a1' } };
  const say = (over, assignment = {}) => releaseLines({ ...base, branchKept: true, removed: true, worktreeExisted: true, left: [], rescued: null, ...over, assignment: { ...base.assignment, ...assignment } });
  assert.deepEqual(say({}), ['a1 is released.', '  Its branch crew/a1 is kept.', '  The worktree was removed.']);
  assert.match(say({ branchKept: false })[1], /was never created, so there is no branch to keep/);
  assert.deepEqual(say({ worktreeExisted: false, branchKept: false }).slice(2), ['  There was no worktree at /w/a1 to remove.']);
  const det = { detached: true, branch: 'feature' };
  assert.equal(say({}, det)[1], '  It worked on a detached copy of feature; that branch is untouched.');
  assert.match(say({ branchKept: false }, det)[1], /which is not a branch or commit in this repository/);
  // a detached seating that failed had no worktree: it did not work on anything
  const none = say({ worktreeExisted: false }, { ...det, status: 'released' });
  assert.ok(!none.join('\n').includes('detached copy'));
  assert.deepEqual(none.slice(1), ['  There was no worktree at /w/a1 to remove.']);
  assert.ok(say({ rescued: 'crew/a1' }, det).includes('  Commits made in the detached copy were saved as branch crew/a1.'));
  const kept = say({ removed: false, left: [' M x', '?? y'] });
  assert.deepEqual(kept.slice(2), ['  The worktree was left at /w/a1:', '     M x', '    ?? y']);
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

test('a herdr timeout while removing the worktree does not fall through to git; a later release finishes it', () => {
  const { ctx, eng } = crew();
  ctx.herdr.failOn = { method: 'removeWorktree', code: 'herdr_timeout', message: 'herdr did not answer within 60 seconds' };
  const r = release(ctx, { target: eng.id });
  assert.equal(r.assignment.status, 'released');
  assert.equal(r.removed, false);
  assert.ok(existsSync(eng.worktree));
  assert.ok(!ctx.git.calls.some((c) => c[0] === 'removeWorktree'), 'git must not race herdr');
  assert.match(r.left[0], /herdr did not answer/);
  assert.match(r.left[0], /release/);
  assert.equal(board(ctx).leftBehind.length, 1);

  ctx.herdr.failOn = null;
  const original = ctx.herdr.removeWorktree;
  ctx.herdr.removeWorktree = (ws) => original(ws, eng.worktree);
  const again = release(ctx, { target: eng.id });
  assert.equal(again.removed, true);
  assert.ok(!existsSync(eng.worktree));
});

test('a failed save on a retry does not say the commits were saved by this run', () => {
  const { ctx } = crew();
  ctx.git.refs.add('feature');
  const rev = seat(ctx, { roleId: 'reviewer', brief: 'Fix it', on: 'feature' });
  ctx.git.unreachable.add(rev.worktree);
  ctx.git.dirty.set(rev.worktree, ['?? x']);
  release(ctx, { target: rev.id });
  ctx.git.rescueDetached = () => {
    throw new Error('disk full');
  };
  const text = releaseLines(release(ctx, { target: rev.id })).join('\n');
  assert.doesNotMatch(text, /were saved as branch/);
  assert.match(text, new RegExp(`earlier release are on branch crew/${rev.id}`));
  assert.match(text, /could not be saved to a branch: disk full/);
});

test('a sync-conflict copy has its own board line and its own field, apart from unreadable files', () => {
  const { ctx, eng } = crew();
  const name = `${eng.id}.sync-conflict-20261010-203105-ABCDEFG.md`;
  writeFileSync(join(trailDir(ctx.mainDir), name), readFileSync(join(trailDir(ctx.mainDir), `${eng.id}.md`)));
  writeFileSync(join(trailDir(ctx.mainDir), 'mangled.md'), '---\nid: [unclosed\n---\n');
  const b = board(ctx);
  assert.deepEqual(b.conflicts, [name]);
  assert.deepEqual(b.unreadable, ['mangled.md']);
  const text = renderBoard(b, ctx.now());
  assert.match(text, /Could not read: mangled\.md\n/);
  assert.match(text, new RegExp(`Sync conflict copies: 1\\n  ${name.replace(/\./g, '\\.')}`));
  assert.match(text, /merge them by hand/);
  assert.doesNotMatch(text.split('\n').find((l) => l.startsWith('Could not read')), /sync-conflict/);
});

test('a seated agent whose first prompt is unsent or unconfirmed is marked in the table and in --json', () => {
  const { ctx } = crew(); // prompted: true
  ctx.herdr.failOn = { method: 'startAgent', code: 'agent_not_ready', message: 'blocked' };
  const seated = seat(ctx, { roleId: 'reviewer', brief: 'Look' });
  ctx.herdr.failOn = null;
  // herdr does list an agent that stopped at a startup dialog; the fake throws before adding it
  ctx.herdr.agents.push({ name: 'reviewer', pane_id: seated.pane, workspace_id: seated.workspace, state: 'blocked', kind: 'claude' });
  const b = board(ctx);
  assert.deepEqual(b.rows.map((r) => [r.agent, r.prompted]).sort(), [['engineer', true], ['reviewer', false]]);
  const text = renderBoard(b, ctx.now());
  assert.match(text, /^reviewer\s.*working \(first prompt not sent\)/m);
  assert.doesNotMatch(text.split('\n').find((l) => l.startsWith('engineer')), /prompt/);

  const rev = readTrail(ctx.mainDir).assignments.find((a) => a.agent === 'reviewer');
  updateRecord(rev.file, { prompted: 'unconfirmed' });
  const again = board(ctx);
  assert.equal(again.rows.find((r) => r.agent === 'reviewer').prompted, 'unconfirmed');
  assert.match(renderBoard(again, ctx.now()), /^reviewer\s.*working \(first prompt unconfirmed\)/m);
});

test('releasing a seating that timed out at the worktree step says the herdr workspace may remain and release may have raced herdr', () => {
  const { ctx } = crew();
  ctx.herdr.failOn = { method: 'createWorktree', code: 'herdr_timeout', message: 'herdr did not answer within 60 seconds' };
  assert.throws(() => seat(ctx, { roleId: 'reviewer', brief: 'x' }));
  ctx.herdr.failOn = null;
  const failed = readTrail(ctx.mainDir).assignments.find((a) => a.status === 'failed');
  const text = releaseLines(release(ctx, { target: failed.id })).join('\n');
  assert.match(text, /never learned the id of the herdr workspace/);
  assert.match(text, /labelled "reviewer"/);
  assert.match(text, /may still have been creating/);

  // a failure that was not a timeout still names the workspace, but does not claim a race
  ctx.herdr.failOn = { method: 'createWorktree', code: 'worktree_create_failed', message: 'git said no' };
  assert.throws(() => seat(ctx, { roleId: 'reviewer', brief: 'y' }));
  const second = readTrail(ctx.mainDir).assignments.find((a) => a.status === 'failed' && a.id !== failed.id);
  const t2 = releaseLines(release(ctx, { target: second.id })).join('\n');
  assert.match(t2, /never learned the id of the herdr workspace/);
  assert.doesNotMatch(t2, /may still have been creating/);
});

test('a worktree herdr finished removing after a timed-out release is reported as already removed, and the record is closed', () => {
  const { ctx, eng } = crew();
  ctx.herdr.failOn = { method: 'removeWorktree', code: 'herdr_timeout', message: 'herdr did not answer within 60 seconds' };
  const first = release(ctx, { target: eng.id });
  assert.equal(first.removed, false);
  assert.equal(readTrail(ctx.mainDir).assignments[0].worktree_removed, false);

  // herdr finished after crew stopped waiting
  ctx.herdr.failOn = null;
  rmSync(eng.worktree, { recursive: true, force: true });
  ctx.herdr.agents = [];
  assert.deepEqual(board(ctx).leftBehind, []);

  const again = release(ctx, { target: eng.id });
  assert.equal(again.removed, true);
  assert.equal(again.worktreeExisted, false);
  assert.equal(again.assignment.status, 'released');
  assert.equal(readTrail(ctx.mainDir).assignments[0].worktree_removed, true);
  assert.ok(!ctx.git.calls.some((c) => c[0] === 'removeWorktree'), 'nothing was left to remove');
  assert.match(releaseLines(again).join('\n'), /already removed/);

  // the record is closed for good
  assert.throws(() => release(ctx, { target: eng.id }), /No open assignment matches/);
});

test('two closed records of one agent name that are both left or gone ask for the assignment id', () => {
  const { ctx, eng } = crew();
  ctx.herdr.failOn = { method: 'removeWorktree', code: 'herdr_timeout', message: 'no answer' };
  release(ctx, { target: eng.id });
  const second = seat(ctx, { roleId: 'engineer', brief: 'Build another' });
  assert.equal(second.agent, 'engineer-2'); // the first agent is still listed
  updateRecord(second.file ?? join(trailDir(ctx.mainDir), `${second.id}.md`), { agent: 'engineer', status: 'released', worktree_removed: false });
  rmSync(second.worktree, { recursive: true, force: true });
  assert.throws(() => release(ctx, { target: 'engineer' }), /More than one closed assignment of "engineer"/);
});

test('a herdr timeout while looking up the workspace says that was what was asked, not the removal', () => {
  const { ctx, eng } = crew();
  ctx.herdr.failOn = { method: 'workspaceCheckout', code: 'herdr_timeout', message: 'herdr did not answer within 60 seconds' };
  const r = release(ctx, { target: eng.id });
  assert.equal(r.removed, false);
  assert.ok(existsSync(eng.worktree));
  assert.ok(!ctx.git.calls.some((c) => c[0] === 'removeWorktree'));
  assert.match(r.left[0], /asked which worktree/);
  assert.doesNotMatch(r.left[0], /asked to remove/);
  assert.match(r.left[0], /release again/);

  // and a timeout of the removal itself still says so
  const second = crew();
  second.ctx.herdr.failOn = { method: 'removeWorktree', code: 'herdr_timeout', message: 'no answer' };
  assert.match(release(second.ctx, { target: second.eng.id }).left[0], /asked to remove the worktree/);
});

test('the Syncthing line says what Syncthing is and what the file is, without the word trail', () => {
  const { ctx, eng } = crew();
  const name = `${eng.id}.sync-conflict-20261010-203105-ABCDEFG.md`;
  writeFileSync(join(trailDir(ctx.mainDir), name), readFileSync(join(trailDir(ctx.mainDir), `${eng.id}.md`)));
  const text = renderBoard(board(ctx), ctx.now());
  const line = text.split('\n').find((l) => l.includes('Syncthing'));
  assert.ok(line, text);
  assert.match(line, /file-sync tool \(Syncthing\)/);
  assert.match(line, /assignment file in memory\/crew\//);
  assert.doesNotMatch(line, /trail/);
});

test('the board example in spec section 8 is exactly what renderBoard prints', () => {
  const spec = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'superpowers', 'specs', '2026-10-10-org-os-crew-design.md'), 'utf-8');
  const section = spec.slice(spec.indexOf('## 8. The board'));
  const example = section.match(/```\n(AGENT[\s\S]*?)```/)[1];
  const now = new Date('2026-10-10T12:00:00Z');
  const ago = (minutes) => new Date(now.getTime() - minutes * 60000).toISOString();
  const b = {
    rows: [
      { agent: 'reviewer', role: 'reviewer', state: 'blocked', status: 'working', prompted: true, created: ago(3),
        brief: 'Review the cursor fix, and say whether it is safe to merge', branch: 'crew/2026-10-10-engineer-fix-the-cursor-race-in-kms' },
      { agent: 'engineer', role: 'engineer', state: 'idle', status: 'reported', prompted: true, created: ago(18),
        brief: 'Fix the cursor race in the kms ingest', branch: 'crew/2026-10-10-engineer-fix-the-cursor-race-in-kms' },
    ],
    handoffs: [{ from_role: 'engineer', to_role: 'researcher', brief: 'Confirm what the cursor contract promises' }],
    needsRelease: [{ id: '2026-10-09-researcher-ibge-terms', status: 'working' }],
    leftBehind: [{ id: '2026-10-09-engineer-ingest-retry', status: 'released', worktree: '/Users/alex/.org-os/worktrees/org-os/2026-10-09-engineer-ingest-retry' }],
    conflicts: ['2026-10-10-engineer-fix-the-cursor.sync-conflict-20261010-221500-ABCDEFG.md'],
    unreadable: ['notes.md'],
  };
  assert.equal(`${example}`, renderBoard(b, now));
});

test('a worktree step that timed out leaves the record open to a second release, which finishes it', () => {
  const { ctx } = crew();
  ctx.herdr.failOn = { method: 'createWorktree', code: 'herdr_timeout', message: 'herdr did not answer within 60 seconds' };
  assert.throws(() => seat(ctx, { roleId: 'reviewer', brief: 'x' }));
  ctx.herdr.failOn = null;
  const failed = readTrail(ctx.mainDir).assignments.find((a) => a.status === 'failed');

  const first = release(ctx, { target: failed.id });
  const text = releaseLines(first).join('\n');
  // the output does not contradict itself, and does not leave an empty "left at" list
  assert.doesNotMatch(text, /never created/);
  assert.doesNotMatch(text, /was left at/);
  assert.match(text, new RegExp(`branch ${failed.branch} does not exist now`));
  assert.match(text, /run release again/);
  assert.equal(first.assignment.status, 'released');
  assert.equal(first.assignment.worktree_removed, false);

  // herdr finishes after release stopped waiting: the worktree appears
  mkdirSync(failed.worktree, { recursive: true });
  const second = release(ctx, { target: failed.id });
  assert.equal(second.removed, true);
  assert.equal(second.worktreeExisted, true);
  assert.ok(!existsSync(failed.worktree));
  assert.equal(readTrail(ctx.mainDir).assignments.find((a) => a.id === failed.id).worktree_removed, true);
  assert.throws(() => release(ctx, { target: failed.id }), /No open assignment matches/);
});

test('a second release after a timed-out worktree step, with still nothing there, closes the record and says so truthfully', () => {
  const { ctx } = crew();
  ctx.herdr.failOn = { method: 'createWorktree', code: 'herdr_timeout', message: 'herdr did not answer within 60 seconds' };
  assert.throws(() => seat(ctx, { roleId: 'reviewer', brief: 'x' }));
  ctx.herdr.failOn = null;
  const failed = readTrail(ctx.mainDir).assignments.find((a) => a.status === 'failed');
  release(ctx, { target: failed.id });
  const second = release(ctx, { target: failed.id });
  assert.equal(second.removed, true);
  const text = releaseLines(second).join('\n');
  assert.match(text, /still no worktree at/);
  assert.doesNotMatch(text, /after the earlier release stopped waiting for herdr/);
  assert.equal(readTrail(ctx.mainDir).assignments.find((a) => a.id === failed.id).worktree_removed, true);
});
