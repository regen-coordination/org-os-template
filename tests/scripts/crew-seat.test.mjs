// tests/scripts/crew-seat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CrewError } from '../../scripts/crew/roles.mjs';
import { localDate, readRecord, readTrail, trailDir, writeRecord } from '../../scripts/crew/trail.mjs';
import { handoff, nudge, release, seat, typeYourself } from '../../scripts/crew/core.mjs';
import { asAgent, fakeHerdr, makeCtx, makeRoot, writeRole } from '../helpers/crew-fixtures.mjs';

const setup = (overrides) => {
  const root = makeRoot();
  return { root, ctx: makeCtx(root, overrides) };
};

test('seat creates the worktree, starts the agent, prompts it and records the assignment', () => {
  const { root, ctx } = setup();
  const a = seat(ctx, { roleId: 'engineer', brief: 'Fix the KMS cursor race', task: 'task-7' });
  const id = `${localDate(ctx.now())}-engineer-fix-the-kms-cursor-race`;
  assert.equal(a.id, id);
  assert.equal(a.status, 'working');
  assert.equal(a.role, 'engineer');
  assert.equal(a.agent, 'engineer');
  assert.equal(a.branch, `crew/${id}`);
  assert.equal(a.detached, false);
  assert.equal(a.pane, 'x1:p1');
  assert.equal(a.workspace, 'x1');
  assert.equal(a.task, 'task-7');
  assert.equal(a.seated_by, 'operator');
  assert.equal(a.prompted, true);
  assert.ok(a.worktree.startsWith(join(root, '.wt')) && a.worktree.endsWith(id), a.worktree);

  assert.deepEqual(ctx.herdr.calls.map((c) => c[0]), ['createWorktree', 'startAgent', 'promptAgent']);
  const [, create] = ctx.herdr.calls[0];
  assert.deepEqual(create, { cwd: root, branch: `crew/${id}`, base: 'main', path: a.worktree, label: 'engineer' });
  const [, start] = ctx.herdr.calls[1];
  assert.deepEqual(start, { name: 'engineer', kind: 'claude', pane_id: 'x1:p1', args: ['--model', 'sonnet', '--name', 'engineer: Fix the KMS cursor race'] });
  const [, prompt] = ctx.herdr.calls[2];
  const file = join(trailDir(root), `${id}.md`);
  assert.ok(prompt.text.includes(join(root, 'roles', 'engineer.md')), prompt.text);
  assert.ok(prompt.text.includes(file), prompt.text);
  assert.doesNotMatch(prompt.text, /\n/);
  // Onboarding: the prompt points at the shared section and at what it lists.
  assert.ok(prompt.text.includes(join(root, 'roles', 'README.md')), prompt.text);
  assert.ok(prompt.text.includes('"Before you begin"'), prompt.text);
  assert.ok(prompt.text.indexOf('Before you begin') < prompt.text.indexOf('begin the work in the brief'), prompt.text);

  const { body } = readRecord(file);
  assert.match(body, /## Brief\n\nFix the KMS cursor race/);
  assert.ok(body.includes(`node "${ctx.scriptPath}" report --file`), body);
  assert.ok(body.includes(`node "${ctx.scriptPath}" handoff`), body);
});

test('seat refuses outside herdr and writes nothing', () => {
  const { root, ctx } = setup({ env: {} });
  assert.throws(() => seat(ctx, { roleId: 'engineer', brief: 'x' }), /inside herdr/);
  assert.ok(!existsSync(trailDir(root)));
  assert.deepEqual(ctx.herdr.calls, []);
});

test('seat refuses when run from a crew worktree copy of the script', () => {
  const { ctx } = setup();
  const inside = { ...ctx, worktreeRoot: join(ctx.mainDir, '..') };
  assert.throws(() => seat(inside, { roleId: 'engineer', brief: 'x' }), /assignment file/);
});

test('seat refuses an empty brief, an unknown role and an unknown base, and writes nothing', () => {
  const { root, ctx } = setup();
  assert.throws(() => seat(ctx, { roleId: 'engineer', brief: '   ' }), /brief is required/);
  assert.throws(() => seat(ctx, { roleId: 'wizard', brief: 'x' }), /No role "wizard"/);
  assert.throws(() => seat(ctx, { roleId: 'engineer', brief: 'x', base: 'nope' }), /"nope" is not a branch or commit/);
  assert.ok(!existsSync(trailDir(root)));
});

test('the cap counts only live crew agents', () => {
  const root = makeRoot(); // max_agents: 2
  const others = Array.from({ length: 5 }, (_, i) => ({ pane_id: `o${i}:p1`, workspace_id: `o${i}` }));
  const ctx = makeCtx(root, { herdr: fakeHerdr(others) });
  seat(ctx, { roleId: 'engineer', brief: 'one' });
  seat(ctx, { roleId: 'reviewer', brief: 'two' });
  assert.throws(() => seat(ctx, { roleId: 'engineer', brief: 'three' }), /2 crew agents are already seated and the cap is 2/);
  // An orphan (its agent is gone from herdr) no longer holds a seat.
  ctx.herdr.agents = ctx.herdr.agents.filter((a) => a.name !== 'reviewer');
  assert.equal(seat(ctx, { roleId: 'engineer', brief: 'three' }).status, 'working');
});

test('a further agent in a role is named from its title, and falls back to a number only when that is taken or empty', () => {
  const root = makeRoot();
  const ctx = makeCtx(root, { herdr: fakeHerdr([{ name: 'engineer', pane_id: 'o1:p1', workspace_id: 'o1' }]) });
  assert.equal(seat(ctx, { roleId: 'engineer', brief: 'one', title: 'Fix the KMS cursor' }).agent, 'engineer-fix-the-kms-cursor');
  // the same title again: that name is taken
  assert.equal(seat(ctx, { roleId: 'engineer', brief: 'two', title: 'Fix the KMS cursor' }).agent, 'engineer-2');
  // a title with nothing a name can hold
  assert.equal(seat({ ...ctx, herdr: fakeHerdr([{ name: 'engineer', pane_id: 'o1:p1', workspace_id: 'o1' }]) }, { roleId: 'engineer', brief: 'three', title: '¡¡¡' }).agent, 'engineer-2');
});

test('the first agent in a role keeps the role id even when it has a title', () => {
  const { ctx } = setup();
  assert.equal(seat(ctx, { roleId: 'engineer', brief: 'x', title: 'Fix the cursor' }).agent, 'engineer');
});

test('a name from a title is cut to herdr\'s name rule', () => {
  const { root, ctx } = setup();
  const long = 'r'.repeat(28); // the longest role id leaves three characters for the title
  writeRole(root, long);
  ctx.herdr.agents.push({ name: long, pane_id: 'o1:p1', workspace_id: 'o1', state: 'idle', kind: 'claude' });
  const a = seat(ctx, { roleId: long, brief: 'x', title: 'Fix: the (KMS) cursor' });
  assert.match(a.agent, /^[a-z][a-z0-9_-]{0,31}$/);
  assert.equal(a.agent, `${long}-fix`);
  // a cut that would end on a dash drops the dash
  const b = seat(ctx, { roleId: long, brief: 'y', title: 'Go on' });
  assert.equal(b.agent, `${long}-go`);
});

test('release and nudge find an agent by either form of its name', () => {
  const root = makeRoot();
  const ctx = makeCtx(root, { herdr: fakeHerdr([{ name: 'engineer', pane_id: 'o1:p1', workspace_id: 'o1' }]) });
  ctx.herdr.failOn = { method: 'startAgent', code: 'agent_not_ready', message: 'blocked at startup' };
  const a = seat(ctx, { roleId: 'engineer', brief: 'x', title: 'Fix the cursor' });
  assert.equal(a.agent, 'engineer-fix-the-cursor');
  ctx.herdr.failOn = null;
  assert.equal(nudge(ctx, { target: 'engineer-fix-the-cursor' }).prompted, true);
  assert.equal(ctx.herdr.calls.find((c) => c[0] === 'promptAgent')[1].name, 'engineer-fix-the-cursor');
  ctx.git.dirty.set(a.worktree, ['?? x']);
  assert.equal(release(ctx, { target: 'engineer-fix-the-cursor' }).assignment.id, a.id);
});

test('a title is stored on the record, trimmed, and shown to the agent as given', () => {
  const { ctx } = setup();
  const a = seat(ctx, { roleId: 'engineer', brief: 'Fix the KMS cursor race', title: '  Fix  the cursor  ' });
  assert.equal(a.title, 'Fix the cursor');
  assert.equal(readTrail(ctx.mainDir).assignments[0].title, 'Fix the cursor');
  assert.deepEqual(ctx.herdr.calls[1][1].args, ['--model', 'sonnet', '--name', 'engineer: Fix the cursor']);
});

test('a title of exactly 24 characters is accepted and 25 is refused in a sentence that says the limit, writing nothing', () => {
  const { root, ctx } = setup();
  const ok = 'a'.repeat(24);
  assert.equal(seat(ctx, { roleId: 'engineer', brief: 'x', title: ok }).title, ok);
  const before = readTrail(root).assignments.length;
  assert.throws(
    () => seat(ctx, { roleId: 'reviewer', brief: 'x', title: 'a'.repeat(25) }),
    (err) => err instanceof CrewError && /25 characters/.test(err.message) && /limit is 24/.test(err.message) && !/\n/.test(err.message),
  );
  assert.equal(readTrail(root).assignments.length, before);
});

test('without a title it is cut from the brief\'s first line at a word boundary', () => {
  const { ctx } = setup();
  const a = seat(ctx, { roleId: 'engineer', brief: 'Label each crew agent in herdr with its role\nand more' });
  assert.equal(a.title, 'Label each crew agent in');
  assert.ok(a.title.length <= 24);
  const short = seat(ctx, { roleId: 'reviewer', brief: 'Review it.\nThen more' });
  assert.equal(short.title, 'Review it.');
});

test('a first word longer than the limit is cut hard and ends in an ellipsis', () => {
  const { ctx } = setup();
  const a = seat(ctx, { roleId: 'engineer', brief: 'Supercalifragilisticexpialidocious plan' });
  assert.equal(a.title.length, 24);
  assert.ok(a.title.endsWith('…'));
});

test('a handoff with no brief of its own gets a title from the handoff brief', () => {
  const { ctx } = setup();
  const lead = seat(ctx, { roleId: 'lead', brief: 'coordinate' });
  const h = handoff(asAgent(ctx, lead), { toRole: 'reviewer', brief: 'Review the cursor fix and say if it is safe' });
  const rev = seat(ctx, { roleId: 'reviewer', brief: '', handoff: h.id });
  assert.equal(rev.title, 'Review the cursor fix');
});

test('the same brief twice gives two assignment ids', () => {
  const { ctx } = setup();
  const a = seat(ctx, { roleId: 'engineer', brief: 'same' });
  const b = seat(ctx, { roleId: 'engineer', brief: 'same' });
  assert.equal(b.id, `${a.id}-2`);
});

test('only the operator and roles with may_seat can seat', () => {
  const { ctx } = setup();
  const lead = seat(ctx, { roleId: 'lead', brief: 'coordinate' });
  const eng = seat(asAgent(ctx, lead), { roleId: 'engineer', brief: 'build' });
  assert.equal(eng.seated_by, lead.id);
  assert.throws(() => seat(asAgent(ctx, eng), { roleId: 'reviewer', brief: 'review' }), /engineer role may not seat.*handoff/);
});

test('an agent is started with its model only when its kind takes one', () => {
  const { root, ctx } = setup();
  seat(ctx, { roleId: 'lead', brief: 'coordinate' });
  assert.deepEqual(ctx.herdr.calls[1][1].args, ['--model', 'opus', '--name', 'lead: coordinate']);
  writeRole(root, 'reader', { kind: 'gemini', model: 'pro' }); // no known model argument for gemini
  const a = seat(ctx, { roleId: 'reader', brief: 'read' });
  assert.equal(a.kind, 'gemini');
  assert.deepEqual(ctx.herdr.calls.filter((c) => c[0] === 'startAgent')[1][1].args, []);
});

test('an agent is started with its effort beside its model, for a kind that takes it', () => {
  const { root, ctx } = setup();
  writeRole(root, 'thinker', { model: 'claude-opus-5-5', effort: 'high' });
  const a = seat(ctx, { roleId: 'thinker', brief: 'think' });
  assert.deepEqual(ctx.herdr.calls[1][1].args, ['--model', 'claude-opus-5-5', '--effort', 'high', '--name', 'thinker: think']);
  assert.deepEqual(a.notes ?? [], []);
});

test('a role that sets no effort is started with no effort argument', () => {
  const { ctx } = setup();
  seat(ctx, { roleId: 'engineer', brief: 'build' });
  assert.deepEqual(ctx.herdr.calls[1][1].args, ['--model', 'sonnet', '--name', 'engineer: build']);
});

test('effort alone, with no model, is still passed to claude', () => {
  const { root, ctx } = setup();
  writeRole(root, 'thinker', { model: undefined, effort: 'max' });
  seat(ctx, { roleId: 'thinker', brief: 'think' });
  assert.deepEqual(ctx.herdr.calls[1][1].args, ['--effort', 'max', '--name', 'thinker: think']);
});

test('a kind whose effort argument is not verified is seated without it and told so in one plain line', () => {
  const { root, ctx } = setup();
  writeRole(root, 'reader', { kind: 'codex', model: 'gpt', effort: 'high' });
  const a = seat(ctx, { roleId: 'reader', brief: 'read' });
  assert.equal(a.status, 'working');
  assert.deepEqual(ctx.herdr.calls[1][1].args, ['--model', 'gpt']);
  assert.deepEqual(a.notes, ["The reader role's effort (high) was not applied: crew does not know how to pass an effort level to a codex agent."]);
});

test('a failure creating the worktree is recorded and nothing later runs', () => {
  const { ctx } = setup();
  ctx.herdr.failOn = { method: 'createWorktree', message: 'branch exists' };
  assert.throws(() => seat(ctx, { roleId: 'engineer', brief: 'x' }), (err) => {
    assert.ok(err instanceof CrewError);
    assert.match(err.message, /failed at the worktree step: branch exists/);
    return true;
  });
  const [a] = readTrail(ctx.mainDir).assignments;
  assert.equal(a.status, 'failed');
  assert.equal(a.failed_step, 'worktree');
  assert.equal(a.error, 'branch exists');
  assert.equal(a.pane, null);
  assert.deepEqual(ctx.herdr.calls.map((c) => c[0]), ['createWorktree']);
});

test('a failure starting the agent is recorded with the pane that was created', () => {
  const { ctx } = setup();
  ctx.herdr.failOn = { method: 'startAgent', code: 'timeout', message: 'not detected' };
  assert.throws(() => seat(ctx, { roleId: 'engineer', brief: 'x' }), /failed at the start step/);
  const [a] = readTrail(ctx.mainDir).assignments;
  assert.equal(a.status, 'failed');
  assert.equal(a.failed_step, 'start');
  assert.equal(a.error_code, 'timeout');
  assert.equal(a.pane, 'x1:p1');
});

test('an agent waiting at a startup dialog is seated but not prompted, and nudge sends the prompt', () => {
  const { ctx } = setup();
  ctx.herdr.failOn = { method: 'startAgent', code: 'agent_not_ready', message: 'blocked at startup' };
  const a = seat(ctx, { roleId: 'engineer', brief: 'x' });
  assert.equal(a.status, 'working');
  assert.equal(a.prompted, false);
  assert.ok(!ctx.herdr.calls.some((c) => c[0] === 'promptAgent'));

  ctx.herdr.failOn = null;
  const b = nudge(ctx, { target: 'engineer' });
  assert.equal(b.prompted, true);
  const prompt = ctx.herdr.calls.find((c) => c[0] === 'promptAgent')[1];
  assert.equal(prompt.name, 'engineer');
  assert.ok(prompt.text.includes(a.id));
  assert.ok(prompt.text.includes(join(ctx.mainDir, 'roles', 'README.md')), prompt.text);
  assert.ok(prompt.text.includes('"Before you begin"'), prompt.text);
  assert.throws(() => nudge(ctx, { target: 'engineer' }), /already been given its first prompt/);
  assert.throws(() => nudge(ctx, { target: 'nobody' }), /No open assignment/);
});

test('the assignment file closes by naming the Before you begin section', () => {
  const { ctx } = setup();
  const a = seat(ctx, { roleId: 'engineer', brief: 'x' });
  const { body } = readRecord(join(trailDir(ctx.mainDir), `${a.id}.md`));
  const last = body.trim().split('\n').pop();
  assert.ok(last.includes(join(ctx.mainDir, 'roles', 'README.md')), last);
  assert.ok(last.includes('Before you begin'), last);
});

test('what an operator is told to type for an unconfirmed prompt also names the section', () => {
  const { ctx } = setup();
  ctx.herdr.failOn = { method: 'promptAgent', code: 'timeout', message: 'no answer' };
  seat(ctx, { roleId: 'engineer', brief: 'x' });
  ctx.herdr.failOn = null;
  assert.throws(
    () => nudge(ctx, { target: 'engineer' }),
    (err) => err.message.includes('Before you begin') && err.message.includes(join(ctx.mainDir, 'roles', 'README.md')),
  );
});

test('a prompt herdr did not confirm is recorded as unconfirmed and is never resent by nudge', () => {
  const { ctx } = setup();
  ctx.herdr.failOn = { method: 'promptAgent', code: 'timeout', message: 'no answer' };
  const a = seat(ctx, { roleId: 'engineer', brief: 'x' });
  assert.equal(a.status, 'working');
  assert.equal(a.prompted, 'unconfirmed');
  ctx.herdr.failOn = null;
  const before = ctx.herdr.calls.length;
  assert.throws(
    () => nudge(ctx, { target: 'engineer' }),
    (err) => {
      assert.ok(err instanceof CrewError);
      assert.match(err.message, /may already have arrived/);
      assert.match(err.message, /pane/);
      return true;
    },
  );
  assert.equal(ctx.herdr.calls.length, before, 'nudge must not send anything');
});

test('a nudge that herdr does not confirm is recorded as unconfirmed, so a second nudge cannot resend', () => {
  const { ctx } = setup();
  ctx.herdr.failOn = { method: 'startAgent', code: 'agent_not_ready', message: 'blocked at startup' };
  seat(ctx, { roleId: 'engineer', brief: 'x' });
  ctx.herdr.failOn = { method: 'promptAgent', code: 'timeout', message: 'no answer' };
  assert.throws(() => nudge(ctx, { target: 'engineer' }), /may already have arrived: herdr did not confirm it/);
  assert.equal(readTrail(ctx.mainDir).assignments[0].prompted, 'unconfirmed');
  ctx.herdr.failOn = null;
  assert.throws(() => nudge(ctx, { target: 'engineer' }), /may already have arrived/);
});

test('a record written with prompted true or false before this change still works', () => {
  const { ctx } = setup();
  ctx.herdr.failOn = { method: 'startAgent', code: 'agent_not_ready', message: 'blocked' };
  const a = seat(ctx, { roleId: 'engineer', brief: 'x' });
  ctx.herdr.failOn = null;
  assert.equal(readRecord(a.file ?? join(trailDir(ctx.mainDir), `${a.id}.md`)).data.prompted, false);
  assert.equal(nudge(ctx, { target: a.id }).prompted, true);
});

test('a role that may seat gets the lead commands in its assignment file, and others do not', () => {
  const { root, ctx } = setup();
  const lead = seat(ctx, { roleId: 'lead', brief: 'coordinate' });
  const { body } = readRecord(join(trailDir(root), `${lead.id}.md`));
  for (const verb of ['seat', 'release', 'nudge', 'handoff-close', 'board']) {
    assert.ok(body.includes(`node "${ctx.scriptPath}" ${verb}`), `${verb} missing:\n${body}`);
  }
  assert.match(body, /--base/);
  assert.match(body, /seat <role> "<brief>" --title "<short title>"/);
  assert.match(body, /at most 24 characters/);
  const eng = seat(ctx, { roleId: 'engineer', brief: 'build' });
  const engBody = readRecord(join(trailDir(root), `${eng.id}.md`)).body;
  for (const verb of ['seat', 'release', 'nudge', 'handoff-close', 'board']) {
    assert.ok(!engBody.includes(`" ${verb}`), `${verb} must not be shown to a role that may not seat`);
  }
  assert.doesNotMatch(engBody, /--base/);
});

test('--on seats a reviewer on a detached copy of an existing branch', () => {
  const { root, ctx } = setup();
  ctx.git.refs.add('crew/some-branch');
  const a = seat(ctx, { roleId: 'reviewer', brief: 'Review it', on: 'crew/some-branch' });
  assert.equal(a.branch, 'crew/some-branch');
  assert.equal(a.detached, true);
  assert.deepEqual(ctx.git.calls, [['addDetached', { path: a.worktree, ref: 'crew/some-branch' }]]);
  assert.deepEqual(ctx.herdr.calls[0], ['openWorktree', { cwd: root, path: a.worktree, label: 'reviewer' }]);
  assert.throws(() => seat(ctx, { roleId: 'reviewer', brief: 'x', on: 'missing' }), /"missing" is not a branch or commit/);
});

test('herdr is pointed at the primary checkout when the main checkout is itself a linked worktree', () => {
  // herdr refuses worktree actions that start from a linked worktree
  // (error code linked_worktree_source), so they are given the repository's
  // primary checkout instead. The trail and the roles stay in the main checkout.
  const { root, ctx } = setup();
  const linked = { ...ctx, repoDir: '/primary/checkout' };
  ctx.git.refs.add('some-branch');
  const a = seat(linked, { roleId: 'engineer', brief: 'x' });
  seat(linked, { roleId: 'reviewer', brief: 'y', on: 'some-branch' });
  assert.equal(ctx.herdr.calls.find((c) => c[0] === 'createWorktree')[1].cwd, '/primary/checkout');
  assert.equal(ctx.herdr.calls.find((c) => c[0] === 'openWorktree')[1].cwd, '/primary/checkout');
  assert.ok(a.worktree.includes(join('.wt', basename(root))), a.worktree);
});

test('a seating that is still in progress counts toward the cap', () => {
  const { root, ctx } = setup(); // max_agents: 2
  seat(ctx, { roleId: 'engineer', brief: 'one' });
  // another seat command has written its record but not yet opened a pane
  writeRecord(
    join(trailDir(root), 'in-flight.md'),
    { id: 'in-flight', status: 'seating', role: 'reviewer', agent: 'reviewer', branch: 'crew/in-flight', pane: null, worktree: '/nowhere' },
    '## Brief\n\nx\n',
  );
  assert.throws(() => seat(ctx, { roleId: 'engineer', brief: 'three' }), /cap is 2/);
});

test('an agent whose assignment was released is still not the operator', () => {
  const { ctx } = setup();
  const eng = seat(ctx, { roleId: 'engineer', brief: 'build' });
  ctx.git.dirty.set(eng.worktree, ['?? draft.md']);
  release(ctx, { target: eng.id }); // worktree left behind, agent still alive in its pane
  // from its worktree
  assert.throws(() => seat(asAgent(ctx, eng), { roleId: 'reviewer', brief: 'x' }), /engineer role may not seat/);
  // from its pane, wherever it has changed directory to
  const wandered = { ...ctx, env: { HERDR_ENV: '1', HERDR_PANE_ID: eng.pane }, cwd: ctx.mainDir };
  assert.throws(() => seat(wandered, { roleId: 'reviewer', brief: 'x' }), /engineer role may not seat/);
});

test('a reused pane id does not turn the operator into a stale assignment\'s agent', () => {
  const { ctx } = setup();
  const eng = seat(ctx, { roleId: 'engineer', brief: 'build' });
  // herdr restarted: the crew agent is gone and the operator's own session now sits in a pane with that id
  ctx.herdr.agents = [{ name: null, pane_id: eng.pane, workspace_id: 'op', state: 'idle', kind: 'claude' }];
  const operator = { ...ctx, env: { HERDR_ENV: '1', HERDR_PANE_ID: eng.pane }, cwd: ctx.mainDir };
  assert.equal(seat(operator, { roleId: 'reviewer', brief: 'x' }).seated_by, 'operator');
});

test('a prompt that provably was not sent (herdr missing) leaves prompted false, and nudge sends it', () => {
  const { ctx } = setup();
  ctx.herdr.failOn = { method: 'promptAgent', code: 'herdr_missing', message: 'the herdr command was not found on PATH' };
  const a = seat(ctx, { roleId: 'engineer', brief: 'x' });
  assert.equal(a.status, 'working');
  assert.equal(a.prompted, false);
  ctx.herdr.failOn = null;
  assert.equal(nudge(ctx, { target: 'engineer' }).prompted, true);
});

test('a nudge that fails because herdr is missing says nothing was sent and may be run again', () => {
  const { ctx } = setup();
  ctx.herdr.failOn = { method: 'startAgent', code: 'agent_not_ready', message: 'blocked' };
  seat(ctx, { roleId: 'engineer', brief: 'x' });
  ctx.herdr.failOn = { method: 'promptAgent', code: 'herdr_missing', message: 'the herdr command was not found on PATH' };
  assert.throws(() => nudge(ctx, { target: 'engineer' }), /nothing was sent/);
  assert.equal(readTrail(ctx.mainDir).assignments[0].prompted, false);
  ctx.herdr.failOn = null;
  assert.equal(nudge(ctx, { target: 'engineer' }).prompted, true);
});

test('a timed-out start or worktree call says the agent or worktree may exist anyway, and points to the board and release', () => {
  for (const method of ['startAgent', 'createWorktree']) {
    const { ctx } = setup();
    ctx.herdr.failOn = { method, code: 'herdr_timeout', message: 'herdr did not answer within 60 seconds' };
    assert.throws(
      () => seat(ctx, { roleId: 'engineer', brief: 'x' }),
      (err) => {
        assert.match(err.message, /may exist anyway/);
        assert.match(err.message, /board/);
        assert.match(err.message, /release/);
        return true;
      },
      method,
    );
    // never retried
    assert.equal(ctx.herdr.calls.filter((c) => c[0] === method).length, 1);
  }
});

test('a failure that is not a timeout does not claim anything may exist', () => {
  const { ctx } = setup();
  ctx.herdr.failOn = { method: 'createWorktree', code: 'herdr_error', message: 'branch exists' };
  assert.throws(() => seat(ctx, { roleId: 'engineer', brief: 'x' }), (err) => !/may exist anyway/.test(err.message));
});

test('every assignment file says a brief that starts with a dash goes after --', () => {
  const { root, ctx } = setup();
  const lead = seat(ctx, { roleId: 'lead', brief: 'coordinate' });
  const leadBody = readRecord(join(trailDir(root), `${lead.id}.md`)).body;
  assert.match(leadBody, /seat <role>[^\n]*-- "<brief>"/);
  assert.match(leadBody, /handoff <role>[^\n]*-- "<brief>"/);
  const eng = seat(ctx, { roleId: 'engineer', brief: 'build' });
  const engBody = readRecord(join(trailDir(root), `${eng.id}.md`)).body;
  assert.match(engBody, /handoff <role>[^\n]*-- "<brief>"/);
  assert.doesNotMatch(engBody, /seat <role>/);
});

test('a prompt refused before anything was queued leaves prompted false, for every code that proves it', () => {
  const codes = ['empty_agent_prompt', 'agent_not_found', 'agent_target_ambiguous', 'agent_blocked', 'agent_not_ready', 'herdr_missing'];
  for (const code of codes) {
    const { ctx } = setup();
    ctx.herdr.failOn = { method: 'promptAgent', code, message: `herdr said ${code}` };
    const a = seat(ctx, { roleId: 'engineer', brief: 'x' });
    assert.equal(a.status, 'working', code);
    assert.equal(a.prompted, false, code);
  }
});

test('a prompt failure that may have been typed stays unconfirmed, and nudge refuses it', () => {
  for (const code of ['agent_prompt_failed', 'timeout', 'agent_prompt_stalled', 'herdr_timeout', 'herdr_error']) {
    const { ctx } = setup();
    ctx.herdr.failOn = { method: 'promptAgent', code, message: `herdr said ${code}` };
    assert.equal(seat(ctx, { roleId: 'engineer', brief: 'x' }).prompted, 'unconfirmed', code);
    ctx.herdr.failOn = null;
    assert.throws(() => nudge(ctx, { target: 'engineer' }), /may already have arrived/, code);
  }
});

test('a nudge refused with a code that proves nothing was sent says so, keeps prompted false, and may be run again', () => {
  const { ctx } = setup();
  ctx.herdr.failOn = { method: 'startAgent', code: 'agent_not_ready', message: 'blocked at startup' };
  seat(ctx, { roleId: 'engineer', brief: 'x' });
  ctx.herdr.failOn = { method: 'promptAgent', code: 'agent_blocked', message: 'agent engineer is waiting at a dialog' };
  assert.throws(
    () => nudge(ctx, { target: 'engineer' }),
    (err) => err instanceof CrewError && /nothing was sent/.test(err.message) && /waiting at a dialog/.test(err.message) && /nudge/.test(err.message),
  );
  assert.equal(readTrail(ctx.mainDir).assignments[0].prompted, false);
  ctx.herdr.failOn = null;
  assert.equal(nudge(ctx, { target: 'engineer' }).prompted, true);
});

test('a failed worktree create names what may be left, in the record and in the message', () => {
  const { ctx } = setup();
  ctx.herdr.failOn = { method: 'createWorktree', code: 'worktree_create_failed', message: 'git said no' };
  let message = '';
  assert.throws(() => seat(ctx, { roleId: 'engineer', brief: 'x' }), (err) => {
    message = err.message;
    return true;
  });
  const [a] = readTrail(ctx.mainDir).assignments;
  assert.deepEqual(a.may_remain, [`branch ${a.branch}`, `checkout directory ${a.worktree}`, 'a herdr workspace labelled "engineer"']);
  for (const piece of a.may_remain) assert.ok(message.includes(piece), `${piece} missing from: ${message}`);
});

test('a timed-out worktree create says herdr may still be creating it and that crew never learned the workspace', () => {
  const { ctx } = setup();
  ctx.herdr.failOn = { method: 'createWorktree', code: 'herdr_timeout', message: 'herdr did not answer within 60 seconds' };
  assert.throws(() => seat(ctx, { roleId: 'engineer', brief: 'x' }), (err) => {
    assert.match(err.message, /never learned/);
    assert.match(err.message, /wait/i);
    return true;
  });
});

test('a failed --on seating lists the checkout and workspace but no branch, and a git failure lists no workspace', () => {
  const { ctx } = setup();
  ctx.git.refs.add('feature');
  ctx.herdr.failOn = { method: 'openWorktree', code: 'worktree_open_failed', message: 'could not open' };
  assert.throws(() => seat(ctx, { roleId: 'reviewer', brief: 'x', on: 'feature' }));
  const [a] = readTrail(ctx.mainDir).assignments;
  assert.deepEqual(a.may_remain, [`checkout directory ${a.worktree}`, 'a herdr workspace labelled "reviewer"']);

  const second = setup();
  second.ctx.git.refs.add('feature');
  second.ctx.git.addDetached = () => {
    throw new Error('git worktree add failed');
  };
  assert.throws(() => seat(second.ctx, { roleId: 'reviewer', brief: 'x', on: 'feature' }));
  const [b] = readTrail(second.ctx.mainDir).assignments;
  assert.deepEqual(b.may_remain, [`checkout directory ${b.worktree}`]);
  assert.deepEqual(second.ctx.herdr.calls, []);
});

test('a failure at the start step does not claim a leftover workspace crew does not know', () => {
  const { ctx } = setup();
  ctx.herdr.failOn = { method: 'startAgent', code: 'timeout', message: 'not detected' };
  assert.throws(() => seat(ctx, { roleId: 'engineer', brief: 'x' }), (err) => !/never learned/.test(err.message));
  assert.equal(readTrail(ctx.mainDir).assignments[0].may_remain, undefined);
});

test('the first prompt, one line, says where the reading list is and what to do when its section is missing', () => {
  const { ctx } = setup();
  seat(ctx, { roleId: 'engineer', brief: 'x' });
  const { text } = ctx.herdr.calls.find((c) => c[0] === 'promptAgent')[1];
  assert.doesNotMatch(text, /\n/);
  assert.match(text, /at the root of your own worktree/);
  assert.match(text, /if that section is missing, say so in your report and begin/);
  // the section is still read before the brief is begun
  assert.ok(text.indexOf('Before you begin') < text.indexOf('begin the work in the brief'), text);
});

test('what an operator is told to type says the same, and so does the sentence the command prints', () => {
  const { ctx } = setup();
  ctx.herdr.failOn = { method: 'promptAgent', code: 'timeout', message: 'no answer' };
  const a = seat(ctx, { roleId: 'engineer', brief: 'x' });
  ctx.herdr.failOn = null;
  const typed = typeYourself(ctx, a);
  assert.ok(typed.includes(join(ctx.mainDir, 'roles', 'README.md')), typed);
  assert.match(typed, /at the root of your own worktree/);
  assert.match(typed, /if that section is missing, say so in your report and begin/);
  assert.throws(() => nudge(ctx, { target: 'engineer' }), (err) => err.message.includes(typed));
});
