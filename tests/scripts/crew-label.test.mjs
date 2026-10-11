// tests/scripts/crew-label.test.mjs
//
// The label crew puts on a seated agent's herdr pane and workspace: role,
// assignment and status, as display-only metadata (spec 5.3 item 13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRecord, writeRecord } from '../../scripts/crew/trail.mjs';
import { report, seat } from '../../scripts/crew/core.mjs';
import { createHerdr } from '../../scripts/crew/herdr.mjs';
import { asAgent, makeCtx, makeRoot } from '../helpers/crew-fixtures.mjs';

const setup = () => {
  const root = makeRoot();
  return { root, ctx: makeCtx(root) };
};

test('seat labels the pane and the workspace with role, a short assignment and the status', () => {
  const { ctx } = setup();
  const a = seat(ctx, { roleId: 'engineer', brief: 'Fix the KMS cursor race\nRepro: tests/kms/cursor.test.mjs' });
  assert.deepEqual(a.notes, []);
  const tokens = { role: 'engineer', assignment: 'Fix the KMS cursor race', status: 'working' };
  assert.deepEqual(ctx.herdr.labels, [
    { on: 'pane', id: 'x1:p1', tokens },
    { on: 'workspace', id: 'x1', tokens: { role: 'engineer', assignment: 'Fix the KMS cursor race' } },
  ]);
});

test('the label carries the title, not a 32-character cut of the brief', () => {
  const { ctx } = setup();
  const brief = 'Label each crew agent in herdr with its role and assignment, and close four small code items';
  seat(ctx, { roleId: 'engineer', brief });
  const { assignment } = ctx.herdr.labels[0].tokens;
  assert.equal(assignment, 'Label each crew agent in');
  assert.ok(assignment.length <= 24);
  assert.ok(brief.startsWith(assignment));
  const workspace = ctx.herdr.labels[1].tokens;
  assert.equal(workspace.assignment, assignment);
});

test('a title the operator gave is the label, whatever the brief says', () => {
  const { ctx } = setup();
  seat(ctx, { roleId: 'engineer', brief: 'Label each crew agent in herdr with its role', title: 'Agent labels' });
  assert.deepEqual(ctx.herdr.labels.map((l) => l.tokens.assignment), ['Agent labels', 'Agent labels']);
});

test('a label that herdr refuses never fails the seat or changes its status, and the output says so in one line', () => {
  for (const method of ['labelPane', 'labelWorkspace']) {
    const { root, ctx } = setup();
    ctx.herdr.failOn = { method, code: 'herdr_error', message: 'metadata refused' };
    const a = seat(ctx, { roleId: 'engineer', brief: 'Fix it' });
    assert.equal(a.status, 'working', method);
    assert.equal(a.prompted, true);
    assert.equal(a.notes.length, 1, method);
    assert.match(a.notes[0], /^The label for engineer could not be set in herdr \(metadata refused\)/);
    assert.doesNotMatch(a.notes[0], /\n/);
    assert.equal(readRecord(join(root, 'memory', 'crew', `${a.id}.md`)).data.status, 'working');
  }
});

test('a seat that failed earlier is never labelled', () => {
  const { ctx } = setup();
  ctx.herdr.failOn = { method: 'startAgent', code: 'agent_start_failed', message: 'no' };
  assert.throws(() => seat(ctx, { roleId: 'engineer', brief: 'x' }), /Seating failed/);
  assert.deepEqual(ctx.herdr.labels, []);
});

test('report moves the pane label to reported, with the whole token set, and a refused label does not undo the report', () => {
  const { ctx } = setup();
  const eng = seat(ctx, { roleId: 'engineer', brief: 'Fix the KMS cursor race' });
  ctx.herdr.labels.length = 0;
  const a = report(asAgent(ctx, eng), { text: 'Done.' });
  assert.equal(a.status, 'reported');
  assert.deepEqual(a.notes, []);
  assert.deepEqual(ctx.herdr.labels, [
    { on: 'pane', id: 'x1:p1', tokens: { role: 'engineer', assignment: 'Fix the KMS cursor race', status: 'reported' } },
  ]);

  ctx.herdr.failOn = { method: 'labelPane', code: 'herdr_timeout', message: 'slow' };
  const b = report(asAgent(ctx, eng), { text: 'Again.' });
  assert.equal(b.status, 'reported');
  assert.deepEqual(b.notes.length, 1);
  assert.match(b.notes[0], /could not be set/);
});

// The adapter against a stand-in binary that logs its arguments.
function logging() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'crew-label-')));
  const bin = join(dir, 'herdr');
  writeFileSync(bin, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done >> '${join(dir, 'log')}'\necho '{"result":{}}'\n`);
  chmodSync(bin, 0o755);
  return { bin, log: () => readFileSync(join(dir, 'log'), 'utf-8').trim().split('\n') };
}

// Observed accepted by the live herdr 0.9.1 (client and server) on 2026-10-11: the
// positional id first, then `--source crew`. The earlier order, options first and
// the id last, was refused with `unknown option: crew`; `--source=crew` with
// `unknown option: --source=crew`. Values with spaces, `:`, `=` and `…` were
// accepted unchanged and read back by `herdr pane get` under `tokens`.
test('the adapter reports metadata with the id first, from source crew, one --token per name, and never sets a ttl', () => {
  const s = logging();
  const herdr = createHerdr({ bin: s.bin });
  herdr.labelPane('w1:p1', { role: 'engineer', assignment: 'Fix a=b', status: 'working' });
  herdr.labelWorkspace('w1', { role: 'engineer' });
  assert.deepEqual(s.log(), [
    'pane', 'report-metadata', 'w1:p1', '--source', 'crew', '--token', 'role=engineer', '--token', 'assignment=Fix a=b', '--token', 'status=working',
    'workspace', 'report-metadata', 'w1', '--source', 'crew', '--token', 'role=engineer',
  ]);
});

test('report labels an assignment made before titles from a title cut from its brief', () => {
  const { root, ctx } = setup();
  const eng = seat(ctx, { roleId: 'engineer', brief: 'Fix the KMS cursor race in the ingest queue' });
  const file = join(root, 'memory', 'crew', `${eng.id}.md`);
  const { data, body } = readRecord(file);
  delete data.title; // a record written before titles existed
  writeRecord(file, data, body);
  ctx.herdr.labels.length = 0;
  report(asAgent(ctx, eng), { text: 'Done.' });
  assert.equal(ctx.herdr.labels[0].tokens.assignment, 'Fix the KMS cursor race');
});
