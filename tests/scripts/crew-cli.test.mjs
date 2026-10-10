// tests/scripts/crew-cli.test.mjs
//
// The command's argument handling and exit codes. Nothing here reaches a real
// herdr: every case is refused before an adapter is called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'crew.mjs');
const run = (args, env = {}) =>
  spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, HERDR_ENV: '', HERDR_PANE_ID: '', ...env },
  });

test('outside herdr every command is refused in one plain sentence', () => {
  for (const args of [[], ['board'], ['seat', 'engineer', 'x'], ['release', 'engineer']]) {
    const r = run(args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /^crew runs inside herdr\./);
    assert.doesNotMatch(r.stderr, /\n\s+at /); // no stack trace
    assert.equal(r.stdout, '');
  }
});

test('an unknown command or flag is a usage error', () => {
  const unknown = run(['dance']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown command "dance"/);
  assert.match(unknown.stderr, /Usage:/);
  const flag = run(['seat', 'engineer', 'x', '--frobnicate']);
  assert.equal(flag.status, 2);
  assert.match(flag.stderr, /Usage:/);
});

test('missing arguments are usage errors that name what is missing', () => {
  assert.match(run(['seat']).stderr, /seat needs a role/);
  assert.match(run(['release']).stderr, /release needs an agent name or assignment id/);
  assert.match(run(['nudge']).stderr, /nudge needs an agent name or assignment id/);
  assert.match(run(['handoff']).stderr, /handoff needs a role/);
  assert.match(run(['handoff-close']).stderr, /handoff-close needs a handoff/);
  assert.equal(run(['seat']).status, 2);
});

test('--help prints the usage and exits 0', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /handoff-close/);
});

test('seat accepts a brief given as several words', () => {
  // Refused for being outside herdr, which proves parsing got that far.
  const r = run(['seat', 'engineer', 'fix', 'the', 'thing', '--task', 't1', '--base', 'main']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /inside herdr/);
});
