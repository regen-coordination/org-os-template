// tests/scripts/crew-flow.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readRecord, readTrail } from '../../scripts/crew/trail.mjs';
import { closeHandoff, handoff, report, seat } from '../../scripts/crew/core.mjs';
import { asAgent, makeCtx, makeRoot } from '../helpers/crew-fixtures.mjs';

function crew() {
  const root = makeRoot();
  const ctx = makeCtx(root);
  const eng = seat(ctx, { roleId: 'engineer', brief: 'Build it' });
  return { root, ctx, eng };
}

test('report appends the report and marks the assignment reported', () => {
  const { ctx, eng } = crew();
  const a = report(asAgent(ctx, eng), { text: 'Did it.\nTests: 4 pass.\n' });
  assert.equal(a.status, 'reported');
  const { body } = readRecord(eng.file ?? readTrail(ctx.mainDir).assignments[0].file);
  assert.match(body, /## Brief\n\nBuild it/);
  assert.match(body, /## Report — \d{4}-\d\d-\d\dT[^\n]+\n\nDid it\.\nTests: 4 pass\.\n$/);
});

test('a second report is appended, not written over the first', () => {
  const { ctx, eng } = crew();
  report(asAgent(ctx, eng), { text: 'First.' });
  report(asAgent(ctx, eng), { text: 'Second.' });
  const { body } = readRecord(readTrail(ctx.mainDir).assignments[0].file);
  assert.equal(body.match(/## Report — /g).length, 2);
  assert.ok(body.indexOf('First.') < body.indexOf('Second.'));
});

test('report is matched by working directory when the pane id differs', () => {
  const { ctx, eng } = crew();
  const elsewhere = { ...ctx, env: { HERDR_ENV: '1', HERDR_PANE_ID: 'zz:p9' }, cwd: join(eng.worktree, 'scripts') };
  assert.equal(report(elsewhere, { text: 'From a subdirectory.' }).status, 'reported');
});

test('report is refused for the operator and for an empty report', () => {
  const { ctx, eng } = crew();
  assert.throws(() => report(ctx, { text: 'x' }), /seated agent/);
  assert.throws(() => report(asAgent(ctx, eng), { text: '  \n' }), /report is empty/);
});

test('handoff writes an open request from the calling assignment', () => {
  const { ctx, eng } = crew();
  const h = handoff(asAgent(ctx, eng), { toRole: 'reviewer', brief: 'Review my branch', branch: eng.branch });
  assert.match(h.id, /^handoff-\d{4}-\d\d-\d\d-review-my-branch$/);
  assert.equal(h.from, eng.id);
  assert.equal(h.to_role, 'reviewer');
  assert.equal(h.branch, eng.branch);
  assert.equal(h.status, 'open');
  assert.equal(h.taken_by, null);
  const [stored] = readTrail(ctx.mainDir).handoffs;
  assert.equal(stored.brief, 'Review my branch');
});

test('handoff is refused for the operator, an unknown role and an empty brief', () => {
  const { ctx, eng } = crew();
  assert.throws(() => handoff(ctx, { toRole: 'reviewer', brief: 'x' }), /seated agent/);
  assert.throws(() => handoff(asAgent(ctx, eng), { toRole: 'wizard', brief: 'x' }), /No role "wizard"/);
  assert.throws(() => handoff(asAgent(ctx, eng), { toRole: 'reviewer', brief: '' }), /brief is required/);
});

test('seat --handoff takes the handoff, using its brief and its branch', () => {
  const { ctx, eng } = crew();
  ctx.git.refs.add(eng.branch);
  const h = handoff(asAgent(ctx, eng), { toRole: 'reviewer', brief: 'Review my branch', branch: eng.branch });
  const rev = seat(ctx, { roleId: 'reviewer', brief: '', handoff: h.id });
  assert.equal(rev.handoff, h.id);
  assert.equal(rev.branch, eng.branch);
  assert.equal(rev.detached, true);
  assert.match(readRecord(readTrail(ctx.mainDir).assignments.find((a) => a.id === rev.id).file).body, /Review my branch/);
  const [stored] = readTrail(ctx.mainDir).handoffs;
  assert.equal(stored.status, 'taken');
  assert.equal(stored.taken_by, rev.id);
});

test('a handoff can be named by file path, and an explicit brief and --on win', () => {
  const { ctx, eng } = crew();
  ctx.git.refs.add('other');
  const h = handoff(asAgent(ctx, eng), { toRole: 'reviewer', brief: 'Review my branch', branch: eng.branch });
  const file = readTrail(ctx.mainDir).handoffs[0].file;
  const rev = seat(ctx, { roleId: 'reviewer', brief: 'Only the tests', handoff: file, on: 'other' });
  assert.equal(rev.handoff, h.id);
  assert.equal(rev.branch, 'other');
  assert.match(readRecord(readTrail(ctx.mainDir).assignments.find((a) => a.id === rev.id).file).body, /Only the tests/);
});

test('a handoff cannot be taken twice, by the wrong role, or when it does not exist', () => {
  const { ctx, eng } = crew();
  const h = handoff(asAgent(ctx, eng), { toRole: 'reviewer', brief: 'Check the docs' });
  assert.throws(() => seat(ctx, { roleId: 'engineer', brief: '', handoff: h.id }), /is for the reviewer role/);
  ctx.herdr.agents = []; // free the cap
  seat(ctx, { roleId: 'reviewer', brief: '', handoff: h.id });
  ctx.herdr.agents = [];
  assert.throws(() => seat(ctx, { roleId: 'reviewer', brief: '', handoff: h.id }), /already taken/);
  assert.throws(() => seat(ctx, { roleId: 'reviewer', brief: '', handoff: 'handoff-nope' }), /No handoff matches/);
});

test('a handoff stays open when seating fails', () => {
  const { ctx, eng } = crew();
  const h = handoff(asAgent(ctx, eng), { toRole: 'reviewer', brief: 'Check the docs' });
  ctx.herdr.failOn = { method: 'createWorktree', message: 'boom' };
  assert.throws(() => seat(ctx, { roleId: 'reviewer', brief: '', handoff: h.id }), /failed at the worktree step/);
  assert.equal(readTrail(ctx.mainDir).handoffs[0].status, 'open');
});

test('closeHandoff declines with a reason; only the operator or a lead may', () => {
  const { ctx, eng } = crew();
  const h = handoff(asAgent(ctx, eng), { toRole: 'reviewer', brief: 'Check the docs' });
  assert.throws(() => closeHandoff(asAgent(ctx, eng), { target: h.id, reason: 'no' }), /may not close handoffs/);
  assert.throws(() => closeHandoff(ctx, { target: h.id, reason: ' ' }), /reason is required/);
  const closed = closeHandoff(ctx, { target: h.id, reason: 'Out of scope this week' });
  assert.equal(closed.status, 'declined');
  assert.equal(closed.reason, 'Out of scope this week');
  assert.throws(() => closeHandoff(ctx, { target: h.id, reason: 'again' }), /already declined/);
});
