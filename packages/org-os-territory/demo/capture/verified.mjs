// demo/capture/verified.mjs — section 7: the branch's evidence. Real suite counts (each package's `node --test` run as a child process),
// the real diff-filter check over the two pre-existing test directories, and the real commit list. Read-only git.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PACKAGES, expect } from './env.mjs';

const REPO = join(PACKAGES, '..');
function git(...args) {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
  expect(r.status === 0, `the git command "${args.join(' ')}" failed: ${r.stderr}`);
  return r.stdout.trim();
}
const lines = (s) => s.split('\n').filter(Boolean);

function suite(name, dir) {
  const r = spawnSync(process.execPath, ['--test'], { cwd: join(PACKAGES, dir), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const grab = (k) => { const m = new RegExp(`^ℹ ${k} (\\d+)`, 'm').exec(r.stdout); expect(m, `could not read "${k}" from the ${name} suite output`); return Number(m[1]); };
  const s = { name, tests: grab('tests'), pass: grab('pass'), fail: grab('fail'), skipped: grab('skipped') };
  expect(s.fail === 0, `the ${name} suite has ${s.fail} failing tests`);
  return s;
}

export function verified({ skipSuites = false } = {}) {
  const head = git('rev-parse', '--short', 'HEAD');
  const base = git('merge-base', 'main', 'HEAD');
  const commits = lines(git('log', '--oneline', `${base}..HEAD`));
  const changed = lines(git('diff', `${base}..HEAD`, '--name-only', '--diff-filter=MDR', '--', 'packages/toolkit-framework/test', 'packages/org-os-kms/test'));
  expect(changed.length === 0, `a pre-existing test file was modified: ${changed.join(', ')}`);
  const suites = skipSuites ? [] : [suite('toolkit-framework', 'toolkit-framework'), suite('org-os-kms', 'org-os-kms'), suite('org-os-territory', 'org-os-territory')];
  return { skipped: skipSuites, head, base, commits, testDirsUnmodified: true, suites };
}
