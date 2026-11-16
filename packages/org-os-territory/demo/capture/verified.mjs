// demo/capture/verified.mjs — section 7: the branch's evidence. Real suite counts (each package's `node --test` run as a child process),
// the real diff-filter check over the two pre-existing test directories, and the real commit list. Read-only git.
// A branch may change pre-existing tests on purpose (its commits name them under "Replaced tests:"), so modified files are reported as
// evidence — `testDirsModified`, exactly what git lists — never a build failure (ruling R-3). Failing suites still fail the build.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PACKAGES, expect } from './env.mjs';

const REPO = join(PACKAGES, '..');
function git(repo, ...args) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  expect(r.status === 0, `the git command "${args.join(' ')}" failed: ${r.stderr}`);
  return r.stdout.trim();
}
const lines = (s) => s.split('\n').filter(Boolean);

function suite(name, dir) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec'], { cwd: join(PACKAGES, dir), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); // pin the reporter: Node 20–22 defaults to TAP off a TTY
  expect(r.status === 0, `the ${name} suite exited with status ${r.status}: ${(r.stderr || '').slice(0, 500)}`);
  const grab = (k) => { const m = new RegExp(`^ℹ ${k} (\\d+)`, 'm').exec(r.stdout); expect(m, `could not read "${k}" from the ${name} suite output`); return Number(m[1]); };
  const s = { name, tests: grab('tests'), pass: grab('pass'), fail: grab('fail'), skipped: grab('skipped') };
  expect(s.fail === 0, `the ${name} suite has ${s.fail} failing tests`);
  return s;
}

// `repo` is for the tests (a fresh repo under os.tmpdir()); the build always reads this repository.
export function verified({ skipSuites = false, repo = REPO } = {}) {
  const head = git(repo, 'rev-parse', '--short', 'HEAD');
  const base = git(repo, 'merge-base', 'main', 'HEAD');
  const commits = lines(git(repo, 'log', '--oneline', `${base}..HEAD`));
  const testDirsModified = lines(git(repo, 'diff', `${base}..HEAD`, '--name-only', '--diff-filter=MDR', '--', 'packages/toolkit-framework/test', 'packages/org-os-kms/test'));
  const suites = skipSuites ? [] : [suite('toolkit-framework', 'toolkit-framework'), suite('org-os-kms', 'org-os-kms'), suite('org-os-territory', 'org-os-territory')];
  return { skipped: skipSuites, head, base, commits, testDirsUnmodified: testDirsModified.length === 0, testDirsModified, suites };
}
