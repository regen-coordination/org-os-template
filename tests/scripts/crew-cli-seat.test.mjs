// tests/scripts/crew-cli-seat.test.mjs
//
// The commands as an operator runs them: the real scripts/crew.mjs, the real herdr
// and git adapters, a stand-in `herdr` that logs the arguments it is given. Each
// case runs from a throwaway copy of the crew's scripts with its own git repository,
// so nothing here touches the checkout the test lives in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRoot, writeRole } from '../helpers/crew-fixtures.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// A stand-in herdr. It keeps the little state the commands read back (the agents
// started, the worktrees made) in a JSON file, makes real git worktrees, logs every
// call, and refuses what the test's `refuse` list names with an error.
const STUB = `#!/usr/bin/env node
const { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const dir = process.env.STUB_DIR;
const argv = process.argv.slice(2);
appendFileSync(dir + '/log.jsonl', JSON.stringify(argv) + '\\n');
const statePath = dir + '/state.json';
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf-8')) : { agents: [], worktrees: {} };
const save = () => writeFileSync(statePath, JSON.stringify(state));
const flag = (name) => argv[argv.indexOf(name) + 1];
const out = (result) => process.stdout.write(JSON.stringify({ result }) + '\\n');
const refuse = (process.env.STUB_REFUSE || '').split(',').filter(Boolean);
const verb = argv.slice(0, 2).join(' ');
if (refuse.includes(verb)) {
  process.stderr.write(JSON.stringify({ error: { code: 'metadata_refused', message: 'metadata refused' } }) + '\\n');
  process.exit(1);
}
if (verb === 'agent list') out({ agents: state.agents });
else if (verb === 'worktree create') {
  const path = flag('--path');
  mkdirSync(require('node:path').dirname(path), { recursive: true });
  execFileSync('git', ['-C', flag('--cwd'), 'worktree', 'add', '-q', '-b', flag('--branch'), path, flag('--base')]);
  state.worktrees['w1'] = path;
  save();
  out({ root_pane: { pane_id: 'w1:p1' }, workspace: { workspace_id: 'w1' } });
} else if (verb === 'agent start') {
  const at = argv.indexOf('--append-system-prompt-file');
  if (at !== -1) copyFileSync(argv[at + 1], dir + '/identity.copy');
  state.agents.push({ name: argv[2], pane_id: flag('--pane'), workspace_id: 'w1', agent_status: 'idle', agent: flag('--kind') });
  save();
  out({});
} else if (verb === 'workspace get') out({ workspace: { worktree: { checkout_path: state.worktrees[argv[2]] } } });
else if (verb === 'worktree remove') {
  rmSync(state.worktrees[flag('--workspace')], { recursive: true, force: true });
  state.agents = [];
  save();
  out({});
} else out({});
`;

function crew() {
  const stubDir = realpathSync(mkdtempSync(join(tmpdir(), 'crew-cli-seat-')));
  writeFileSync(join(stubDir, 'herdr'), STUB);
  chmodSync(join(stubDir, 'herdr'), 0o755);

  // a throwaway checkout: the crew's own scripts, the fixture roles, one commit on main
  const root = realpathSync(makeRoot());
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(join(repo, 'scripts', 'crew.mjs'), join(root, 'scripts', 'crew.mjs'));
  cpSync(join(repo, 'scripts', 'crew'), join(root, 'scripts', 'crew'), { recursive: true });
  symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'));
  writeRole(root, 'reader', { kind: 'codex', model: 'gpt', effort: 'high' }); // a kind that takes no effort and no identity
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, '.gitignore'), 'node_modules\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');

  const worktrees = join(stubDir, 'wt');
  const run = (args, extra = {}) =>
    spawnSync(process.execPath, [join(root, 'scripts', 'crew.mjs'), ...args], {
      cwd: root,
      encoding: 'utf-8',
      env: {
        ...process.env,
        HERDR_ENV: '1',
        HERDR_PANE_ID: 'op:p1',
        PATH: `${stubDir}:${process.env.PATH}`,
        ORG_OS_WORKTREES: worktrees,
        STUB_DIR: stubDir,
        ...extra,
      },
    });
  const calls = () =>
    existsSync(join(stubDir, 'log.jsonl'))
      ? readFileSync(join(stubDir, 'log.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l))
      : [];
  return { root, stubDir, worktrees, run, calls };
}

test('seat prints its effort note first and its label note after, and report prints its label note', () => {
  const c = crew();
  const seated = c.run(['seat', 'reader', 'Read the cursor notes', '--title', 'Cursor notes'], { STUB_REFUSE: 'pane report-metadata' });
  assert.equal(seated.status, 0, seated.stderr);
  const lines = seated.stdout.split('\n');
  assert.equal(lines[0], 'Seated reader as reader.');
  const effort = lines.findIndex((l) => /^ {2}The reader role's effort \(high\) was not applied/.test(l));
  const label = lines.findIndex((l) => /^ {2}The label for reader could not be set in herdr \(metadata refused\)/.test(l));
  assert.ok(effort > 0 && label > effort, seated.stdout);
  // both notes, and nothing else, sit between the worktree line and the end
  assert.deepEqual(
    lines.slice(effort).filter(Boolean).map((l) => l.trim().slice(0, 14)),
    ['The reader rol', 'The label for '],
  );

  // the agent now answers to its name in the pane the stand-in made, so report finds its assignment
  const id = /assignment {2}(\S+)/.exec(seated.stdout)[1];
  const reportFile = join(c.stubDir, 'report.md');
  writeFileSync(reportFile, 'Done.\n');
  const reported = c.run(['report', '--file', reportFile], { HERDR_PANE_ID: 'w1:p1', STUB_REFUSE: 'pane report-metadata' });
  assert.equal(reported.status, 0, reported.stderr);
  const out = reported.stdout.split('\n').filter(Boolean);
  assert.equal(out[0], `Report recorded on ${id}.`);
  assert.match(out[1], /^The label for reader could not be set in herdr \(metadata refused\)/);
  assert.equal(out.length, 2, reported.stdout);
});

test('a claude role is started with model, effort, title and identity as the herdr binary receives them', () => {
  const c = crew();
  writeRole(c.root, 'thinker', { model: 'claude-opus-5-5', effort: 'high' });
  const seated = c.run(['seat', 'thinker', 'Work out the cursor contract', '--title', 'Cursor contract']);
  assert.equal(seated.status, 0, seated.stderr);
  const start = c.calls().find((a) => a[0] === 'agent' && a[1] === 'start');
  const id = /assignment {2}(\S+)/.exec(seated.stdout)[1];
  const identity = join(c.worktrees, c.root.split('/').pop(), '.identity', `${id}.md`);
  assert.deepEqual(start, [
    'agent', 'start', 'thinker', '--kind', 'claude', '--pane', 'w1:p1', '--',
    '--model', 'claude-opus-5-5', '--effort', 'high', '--name', 'thinker: Cursor contract', '--append-system-prompt-file', identity,
  ]);
  // the file existed when herdr was asked, held the role and the seat, and sits outside the worktree
  const copy = readFileSync(join(c.stubDir, 'identity.copy'), 'utf-8');
  assert.match(copy.split('\n')[0], /You are the thinker of the org-os crew: role "thinker", agent name "thinker"\./);
  assert.ok(copy.includes('## Shared boundaries') && copy.includes('## The cooperative charter'));
  assert.ok(existsSync(identity));
  assert.ok(!identity.startsWith(join(c.worktrees, c.root.split('/').pop(), id)));

  // release takes the file away with the worktree
  const released = c.run(['release', 'thinker']);
  assert.equal(released.status, 0, released.stderr);
  assert.ok(!existsSync(identity));
});
