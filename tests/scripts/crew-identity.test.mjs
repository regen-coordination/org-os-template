// tests/scripts/crew-identity.test.mjs
//
// The role as the agent's identity: a claude agent is started with its role, the
// shared sections of roles/README.md and who it is as an appended system prompt
// (spec 4.1 and 5). Other kinds keep the file path in the first prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadReadmeSections, loadRole } from '../../scripts/crew/roles.mjs';
import { readTrail, trailDir } from '../../scripts/crew/trail.mjs';
import { nudge, release, releaseLines, seat } from '../../scripts/crew/core.mjs';
import { makeCtx, makeRoot, writeRole } from '../helpers/crew-fixtures.mjs';

const setup = (overrides) => {
  const root = makeRoot();
  return { root, ctx: makeCtx(root, overrides) };
};
const startCall = (ctx) => ctx.herdr.calls.find((c) => c[0] === 'startAgent')[1];
const promptText = (ctx) => ctx.herdr.calls.find((c) => c[0] === 'promptAgent')[1].text;
const flagValue = (args, flag) => args[args.indexOf(flag) + 1];

test('a claude agent is started with an appended system prompt file that holds its role, the shared sections and its seat', () => {
  const { root, ctx } = setup();
  const a = seat(ctx, { roleId: 'engineer', brief: 'Fix the cursor race', title: 'Cursor race' });
  const args = startCall(ctx).args;
  assert.ok(args.includes('--append-system-prompt-file'), args.join(' '));
  const file = flagValue(args, '--append-system-prompt-file');
  assert.ok(existsSync(file), file);
  const text = readFileSync(file, 'utf-8');

  // who this seat is: role, agent name, assignment id and the assignment file's path
  const [first, second] = text.split('\n');
  assert.ok(first.includes('"engineer"') && first.includes(`"${a.agent}"`), first);
  assert.ok(second.includes(`"${a.id}"`) && second.includes(join(trailDir(root), `${a.id}.md`)), second);
  assert.ok(second.includes(loadRole(root, 'engineer').path), second);
  // the role file's body, without its frontmatter
  assert.ok(text.includes('## Mandate'), text);
  assert.ok(text.includes('Test role.'), text);
  assert.doesNotMatch(text, /may_seat:/);
  // the three shared sections, and nothing else from the README
  for (const heading of ['## Shared boundaries', '## What always needs the operator', '## The cooperative charter']) {
    assert.ok(text.includes(heading), `${heading} missing:\n${text}`);
  }
  assert.ok(text.includes('Work only inside your own worktree.'));
  assert.ok(text.includes('merging into main'));
  assert.ok(text.includes('Commons, not property.'));
  assert.doesNotMatch(text, /^# Roles$/m);
  assert.deepEqual(a.notes.filter((n) => /identity/.test(n)), []);
});

test('the identity file is outside the worktree and is not a record in memory/crew', () => {
  const { root, ctx } = setup();
  const a = seat(ctx, { roleId: 'engineer', brief: 'x' });
  const file = flagValue(startCall(ctx).args, '--append-system-prompt-file');
  assert.ok(!file.startsWith(`${a.worktree}/`), file);
  assert.ok(!file.startsWith(`${trailDir(root)}/`), file);
  const trail = readTrail(root);
  assert.equal(trail.assignments.length, 1);
  assert.deepEqual(trail.unreadable, []);
  assert.deepEqual(readdirSync(trailDir(root)).filter((n) => n.endsWith('.md')), [`${a.id}.md`]);
});

test('release removes the identity file, and a second release is not troubled by its absence', () => {
  const { ctx } = setup();
  const a = seat(ctx, { roleId: 'engineer', brief: 'x' });
  const file = flagValue(startCall(ctx).args, '--append-system-prompt-file');
  assert.ok(existsSync(file));
  ctx.git.dirty.set(a.worktree, ['?? draft.md']); // the worktree is left, the identity file is not
  const r = release(ctx, { target: a.id });
  assert.ok(!existsSync(file));
  assert.equal(r.identityLeft, null);
  assert.doesNotMatch(releaseLines(r).join('\n'), /identity/);
  assert.doesNotThrow(() => release(ctx, { target: a.id })); // a retry of a closed record
});

test('a file that cannot be removed is said in one line and does not undo the release', () => {
  const { ctx } = setup();
  const a = seat(ctx, { roleId: 'engineer', brief: 'x' });
  ctx.identity.remove = () => {
    throw new Error('permission denied');
  };
  const r = release(ctx, { target: a.id });
  assert.equal(r.assignment.status, 'released');
  assert.match(releaseLines(r).join('\n'), /identity prompt file for engineer could not be removed \(permission denied\)/);
});

test('a kind with no verified flag gets no system prompt file and the file path in its first prompt, as before', () => {
  const { root, ctx } = setup();
  writeRole(root, 'reader', { kind: 'codex', model: 'gpt' });
  const a = seat(ctx, { roleId: 'reader', brief: 'read' });
  assert.deepEqual(startCall(ctx).args, ['--model', 'gpt']);
  assert.ok(!existsSync(join(ctx.worktreeRoot, 'identity', `${a.id}.md`)));
  const text = promptText(ctx);
  assert.ok(text.includes(join(root, 'roles', 'reader.md')), text);
  assert.ok(text.includes(join(trailDir(root), `${a.id}.md`)), text);
  assert.ok(text.includes('"Before you begin"'), text);
});

test('for a claude agent the first prompt still names the role file, the assignment file and the reading list', () => {
  const { root, ctx } = setup();
  const a = seat(ctx, { roleId: 'engineer', brief: 'x' });
  const text = promptText(ctx);
  assert.ok(text.includes(join(root, 'roles', 'engineer.md')), text);
  assert.ok(text.includes(join(trailDir(root), `${a.id}.md`)), text);
  assert.ok(text.includes(join(root, 'roles', 'README.md')), text);
  assert.ok(text.includes('"Before you begin"'), text);
  assert.doesNotMatch(text, /\n/);
});

test('the first prompt addresses the seat by the role file\'s own heading, for seat and for nudge', () => {
  const { root, ctx } = setup();
  writeRole(root, 'steward');
  const path = join(root, 'roles', 'steward.md');
  writeFileSync(path, readFileSync(path, 'utf-8').replace('# steward', '# Commons steward'));
  ctx.herdr.failOn = { method: 'startAgent', code: 'agent_not_ready', message: 'blocked' };
  seat(ctx, { roleId: 'steward', brief: 'look after it' });
  ctx.herdr.failOn = null;
  nudge(ctx, { target: 'steward' });
  assert.match(promptText(ctx), /^You are the commons steward of the org-os crew\. Read /);

  const second = setup();
  seat(second.ctx, { roleId: 'reviewer', brief: 'x' });
  assert.match(promptText(second.ctx), /^You are the reviewer of the org-os crew\./);
});

test('a failure to write the identity file is recorded with its step and creates nothing', () => {
  const { root, ctx } = setup();
  ctx.identity.write = () => {
    throw new Error('no space left on device');
  };
  assert.throws(
    () => seat(ctx, { roleId: 'engineer', brief: 'x' }),
    (err) => /failed at the identity step: no space left on device/.test(err.message) && /no worktree or agent was made/.test(err.message),
  );
  const [a] = readTrail(root).assignments;
  assert.equal(a.status, 'failed');
  assert.equal(a.failed_step, 'identity');
  assert.equal(a.error, 'no space left on device');
  assert.equal(a.may_remain, undefined);
  assert.deepEqual(ctx.herdr.calls, []);
  assert.deepEqual(ctx.git.calls, []);
  // the failed record can be released like any other
  assert.equal(release(ctx, { target: a.id }).assignment.status, 'released');
});

test('a README without one of the shared sections still seats the agent and says which is missing', () => {
  const { root, ctx } = setup();
  writeFileSync(join(root, 'roles', 'README.md'), '# Roles\n\n## Shared boundaries\n\n- Be kind.\n');
  const a = seat(ctx, { roleId: 'engineer', brief: 'x' });
  assert.equal(a.status, 'working');
  assert.equal(a.notes.filter((n) => /identity prompt lacks it/.test(n)).length, 2);
  assert.ok(a.notes.some((n) => n.includes('"The cooperative charter"')));
  const text = readFileSync(flagValue(startCall(ctx).args, '--append-system-prompt-file'), 'utf-8');
  assert.ok(text.includes('Be kind.'));
});

test('loadReadmeSections stops a section at the next heading of its level and reports what it did not find', () => {
  const { root } = setup();
  writeFileSync(join(root, 'roles', 'README.md'), '# Roles\n\n## A\n\nalpha\n\n### Inner\n\nbeta\n\n## B\n\ngamma\n');
  const r = loadReadmeSections(root, ['A', 'C']);
  assert.equal(r.found.length, 1);
  assert.equal(r.found[0].text, '## A\n\nalpha\n\n### Inner\n\nbeta');
  assert.deepEqual(r.missing, ['C']);
});

test('a role file with no heading is addressed by its id', () => {
  const { root } = setup();
  writeFileSync(join(root, 'roles', 'plain.md'), '---\nid: plain\ncircle: engineering\nkind: claude\nmay_seat: false\n---\nNo heading here.\n');
  const role = loadRole(root, 'plain');
  assert.equal(role.heading, 'plain');
  assert.equal(role.body, 'No heading here.');
});

test('two seats do not share an identity file', () => {
  const { ctx } = setup();
  seat(ctx, { roleId: 'engineer', brief: 'one' });
  seat(ctx, { roleId: 'reviewer', brief: 'two' });
  const files = ctx.herdr.calls.filter((c) => c[0] === 'startAgent').map((c) => flagValue(c[1].args, '--append-system-prompt-file'));
  assert.equal(files.length, 2);
  assert.notEqual(files[0], files[1]);
});
