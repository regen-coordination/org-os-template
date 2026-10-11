// tests/scripts/crew-seat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CrewError } from '../../scripts/crew/roles.mjs';
import { localDate, readRecord, readTrail, trailDir, writeRecord } from '../../scripts/crew/trail.mjs';
import { nudge, release, seat } from '../../scripts/crew/core.mjs';
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
  assert.deepEqual(start, { name: 'engineer', kind: 'claude', pane_id: 'x1:p1', args: ['--model', 'sonnet'] });
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

test('an agent name already live on the server gets a numeric suffix', () => {
  const root = makeRoot();
  const ctx = makeCtx(root, { herdr: fakeHerdr([{ name: 'engineer', pane_id: 'o1:p1', workspace_id: 'o1' }]) });
  assert.equal(seat(ctx, { roleId: 'engineer', brief: 'one' }).agent, 'engineer-2');
  assert.equal(seat(ctx, { roleId: 'engineer', brief: 'two' }).agent, 'engineer-3');
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
  assert.deepEqual(ctx.herdr.calls[1][1].args, ['--model', 'opus']);
  writeRole(root, 'reader', { kind: 'gemini', model: 'pro' }); // no known model argument for gemini
  const a = seat(ctx, { roleId: 'reader', brief: 'read' });
  assert.equal(a.kind, 'gemini');
  assert.deepEqual(ctx.herdr.calls.filter((c) => c[0] === 'startAgent')[1][1].args, []);
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
