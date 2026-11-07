// tests/instance-doctor/declare-visibility.test.mjs
//
// DAO-OS L8, Q55 — the `declare-visibility` stage. Pure part: what declaration would this instance get. Effectful
// part: runSync against fresh temporary repositories through the io bag (never the worktree).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import {
  declareVisibility, DECLARED_COLLECTIONS, OUTPUT_FILES, GENERATOR_MARK_KEY as DOCTOR_MARK_KEY, isGeneratedByL8,
} from '../../packages/instance-doctor/src/visibility-declaration.mjs';
import { daoDoc, GENERATOR_MARK_KEY, hasGeneratorMark } from '../../packages/admin/lib/standards/dao.mjs';
import { runSync } from '../../packages/instance-doctor/src/run-sync.mjs';
import { realIo } from '../../packages/instance-doctor/src/io.mjs';
import { validateEntry } from '../../packages/admin/lib/data-validate.mjs';
import { readPolicy } from '../../packages/admin/lib/visibility.mjs';
import { git } from '../helpers/instance-fixtures.mjs';

const MEMBERS = {
  members: [
    { id: 'steward-a', kind: 'person', status: 'active', name: 'Steward A', email: 'a@example.org' },
    { id: 'steward-b', kind: 'person', handles: { matrix: '@b:example.org' }, role: 'steward' },
  ],
};

// --- pure ----------------------------------------------------------------

/** Every 0.6 output file, as .well-known/ would list it. */
const ALL_06 = ['dao.json', ...OUTPUT_FILES];
const decl = (published, registries, more = {}) => declareVisibility({ hasVisibilityFile: false, published, registries, ...more });
const collectionsOf = (text) => yaml.load(text).visibility.collections;

test('an existing data/visibility.yaml, or one with git history, means no declaration', () => {
  assert.equal(decl(ALL_06, { members: MEMBERS }, { hasVisibilityFile: true }), null);
  assert.equal(decl(ALL_06, { members: MEMBERS }, { hasVisibilityHistory: true }), null);
});

test('R31: each 0.6 output file maps to the collections it was built from', () => {
  const registries = Object.fromEntries(DECLARED_COLLECTIONS.map((n) => [n, {}]));
  const cases = [
    ['members.json', ['members']],
    ['proposals.json', ['governance']],
    ['contracts.json', ['systems']],
    ['meetings.json', ['meetings']],
    ['projects.json', ['projects']],
    ['finances.json', ['finances']],
    ['ideas.json', ['ideas']],
    ['knowledge.json', ['knowledge-manifest', 'sources']],
  ];
  for (const [file, names] of cases) {
    assert.deepEqual(Object.keys(collectionsOf(decl([file], registries))), names, file);
  }
  assert.deepEqual(Object.keys(collectionsOf(decl(ALL_06, registries))), DECLARED_COLLECTIONS);
});

test('a collection is declared only when its 0.6 file exists and the instance has its registry', () => {
  // the registries exist, but .well-known/ shows only contracts.json: systems alone
  const all = Object.fromEntries(DECLARED_COLLECTIONS.map((n) => [n, {}]));
  assert.deepEqual(collectionsOf(decl(['contracts.json'], all)), { systems: { default: 'public' } });
  // the 0.6 file is there but the registry is not: nothing for it
  assert.equal(decl(['ideas.json'], { systems: {} }), null);
  assert.deepEqual(Object.keys(collectionsOf(decl(['knowledge.json'], { 'knowledge-manifest': {} }))), ['knowledge-manifest']);
});

test('governance (from proposals.json) is public with its description and rules members: 0.6 published decision rows only', () => {
  assert.deepEqual(collectionsOf(decl(['proposals.json'], { governance: {} })).governance, {
    default: 'public', fields: { description: 'members', rules: 'members' },
  });
});

test('no 0.6 output, no declaration — and dao.json alone (what clone stage 6c renders) declares nothing (I3)', () => {
  const registries = Object.fromEntries(DECLARED_COLLECTIONS.map((n) => [n, {}]));
  assert.equal(decl([], registries), null);
  assert.equal(decl(['dao.json'], registries), null);
  assert.equal(decl(['dao.json', 'skills.json', 'agents.json'], registries), null);
});

test('members: public ids, and every other key seen in the records at members, sorted', () => {
  const m = collectionsOf(decl(['members.json'], { members: MEMBERS })).members;
  assert.equal(m.default, 'public');
  assert.deepEqual(Object.keys(m.fields), ['email', 'handles', 'name', 'role']);
  assert.ok(Object.values(m.fields).every((l) => l === 'members'));
  assert.ok(!('id' in m.fields) && !('kind' in m.fields) && !('status' in m.fields));
});

test('members read from a map keyed by id, and with no extra keys, carry no fields', () => {
  const byId = decl(['members.json'], { members: { members: { 'steward-a': { id: 'steward-a', name: 'A' } } } });
  assert.deepEqual(Object.keys(collectionsOf(byId).members.fields), ['name']);
  const bare = decl(['members.json'], { members: { members: [{ id: 'steward-a', kind: 'person' }] } });
  assert.deepEqual(collectionsOf(bare).members, { default: 'public' });
});

test('the text opens with a comment saying the doctor wrote it, the org owns it, and it is never rewritten', () => {
  const text = decl(['members.json'], { members: MEMBERS });
  assert.match(text, /^# Written by `doctor sync`/);
  assert.match(text, /the org's to change/);
  assert.match(text, /never writes this file again once it has any history/);
  assert.doesNotMatch(text, /publish nothing/);
});

test('the text is deterministic and passes the visibility schema and the policy reader', () => {
  const registries = { members: MEMBERS, governance: {}, projects: {}, ideas: {} };
  const a = decl(ALL_06, registries);
  assert.equal(a, decl(ALL_06, registries));
  const doc = yaml.load(a);
  const errors = validateEntry('visibility', doc.visibility).filter((p) => p.level === 'error');
  assert.deepEqual(errors, []);
  const { policy, problems } = readPolicy(doc);
  assert.deepEqual(problems, []);
  assert.equal(policy.collections.governance.default, 'public');
  assert.equal(policy.collections.governance.fields.rules, 'members');
  assert.equal(policy.collections.members.fields.email, 'members');
});

test('nothing to declare when the instance has none of the registries', () => {
  assert.equal(decl(ALL_06, {}), null);
});

// --- the stage, in fresh temporary repositories ----------------------------

function tempInstance(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'doctor-visibility-'));
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['config', 'user.email', 'fixture@org-os.test']);
  git(dir, ['config', 'user.name', 'org-os fixture']);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  git(dir, ['add', '.']);
  git(dir, ['commit', '--quiet', '-m', 'instance: initial']);
  return dir;
}

/** Real io, with only the stages other than the one under test made inert: handlers are driven through runSync. */
function stageIo() {
  return { ...realIo, run: () => ({ ok: true, out: 'stubbed' }), reassess: () => ({ status: 'OK', summary: { blockers: 0, warnings: 0, checks: 6 } }), today: () => '2026-10-29' };
}

/**
 * runSync's earlier stages need a framework checkout; the stage under test does not. Drive it alone by running the
 * whole plan against a minimal framework, as the neighbouring real-repository tests do.
 */
function runWithFramework(dir) {
  const upstream = mkdtempSync(path.join(tmpdir(), 'doctor-upstream-'));
  const framework = mkdtempSync(path.join(tmpdir(), 'doctor-framework-'));
  try {
    writeFileSync(path.join(upstream, 'README.md'), '# framework\n');
    git(upstream, ['init', '--quiet', '--initial-branch=main']);
    git(upstream, ['config', 'user.email', 'fixture@org-os.test']);
    git(upstream, ['config', 'user.name', 'org-os fixture']);
    git(upstream, ['add', '.']);
    git(upstream, ['commit', '--quiet', '-m', 'framework: initial']);
    mkdirSync(path.join(framework, 'scripts'), { recursive: true });
    for (const f of ['sync-upstream', 'validate-identity', 'migrate']) writeFileSync(path.join(framework, 'scripts', `${f}.mjs`), '// stand-in\n');
    const snapshot = {
      dir,
      name: 'Test DAO',
      federation: { metadata: { framework_version: '0.6' } },
      federationRaw: readFileSync(path.join(dir, 'federation.yaml'), 'utf-8'),
      packageJson: { name: 'test-dao-os' },
      packageJsonRaw: '{"name":"test-dao-os"}',
      versionMd: null,
      git: { isRepo: true, remotes: {}, dirtyCount: 0 },
      machinery: {},
      framework: { dir: framework, version: '0.6.0', headSha: 'f'.repeat(40) },
    };
    return runSync(snapshot, { upstreamUrl: upstream }, stageIo());
  } finally {
    for (const d of [upstream, framework]) rmSync(d, { recursive: true, force: true });
  }
}

const BASE = { 'federation.yaml': 'metadata:\n  framework_version: "0.6"\nupstream: []\n' };
/** 0.6 output files, as an instance's .well-known/ held them. */
const WK = (...files) => Object.fromEntries(files.map((f) => [`.well-known/${f}`, '{}\n']));
const stageOf = (r) => r.stages.find((s) => s.id === 'declare-visibility');
const subjects = (dir) => git(dir, ['log', '--format=%s']).split('\n');

test('the stage writes data/visibility.yaml as its own commit, with the subject and body the org reads', () => {
  const dir = tempInstance({
    ...BASE, ...WK('dao.json', 'members.json', 'proposals.json'),
    'data/members.yaml': yaml.dump(MEMBERS), 'data/governance.yaml': 'governance:\n  model: consensus\n', 'data/ideas.yaml': 'ideas: []\n',
  });
  try {
    const r = runWithFramework(dir);
    assert.equal(r.aborted, false, JSON.stringify(r.stages, null, 2));
    const stage = stageOf(r);
    assert.equal(stage.status, 'ok');
    assert.match(stage.detail, /wrote and committed/);

    const file = readFileSync(path.join(dir, 'data', 'visibility.yaml'), 'utf-8');
    const cols = yaml.load(file).visibility.collections;
    // ideas.yaml exists but .well-known/ has no ideas.json: not declared
    assert.deepEqual(Object.keys(cols), ['members', 'governance']);
    assert.deepEqual(cols.governance, { default: 'public', fields: { description: 'members', rules: 'members' } });

    const log = subjects(dir);
    const at = log.indexOf('chore(visibility): declare what this instance already publishes');
    assert.ok(at >= 0, log.join(' | '));
    assert.deepEqual(git(dir, ['show', '--name-only', '--format=', `HEAD~${at}`]).split('\n'), ['data/visibility.yaml']);
    const body = git(dir, ['log', '-1', '--format=%B', `HEAD~${at}`]);
    assert.match(body, /publication decision for the org to confirm, edit or revert/);
    assert.match(body, /L8 rule 2, Q55/);
    assert.match(body, /a revert stays reverted/);
    assert.doesNotMatch(body, /publish nothing/);

    assert.match(r.receipt, /## Publication decision for the org/);
    assert.match(r.receipt, /confirm it, edit it, or revert that commit/);
    assert.match(readFileSync(r.receiptPath, 'utf-8'), /description: members/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('meetings and projects held as content/<c>/*.md count as their registry', () => {
  const dir = tempInstance({ ...BASE, ...WK('meetings.json', 'projects.json'), 'content/meetings/m-1.md': '---\nid: m-1\n---\nNotes\n' });
  try {
    const r = runWithFramework(dir);
    assert.match(stageOf(r).detail, /wrote and committed/);
    const cols = yaml.load(readFileSync(path.join(dir, 'data', 'visibility.yaml'), 'utf-8')).visibility.collections;
    assert.deepEqual(cols, { meetings: { default: 'public' } });   // no project records anywhere: projects not declared
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a reverted declaration stays reverted when the doctor runs again', () => {
  const dir = tempInstance({ ...BASE, ...WK('contracts.json'), 'data/systems.yaml': 'systems: []\n' });
  try {
    const first = runWithFramework(dir);
    assert.match(stageOf(first).detail, /wrote and committed/);
    const sha = git(dir, ['log', '--format=%H', '-1', '--', 'data/visibility.yaml']);
    git(dir, ['revert', '--no-edit', sha]);
    assert.ok(!existsSync(path.join(dir, 'data', 'visibility.yaml')));

    // a fresh framework stands in for the next sync: the first one's upstream remote named a directory now gone
    git(dir, ['remote', 'remove', 'upstream']);
    const second = runWithFramework(dir);
    assert.equal(second.aborted, false, JSON.stringify(second.stages, null, 2));
    assert.equal(stageOf(second).status, 'ok');
    assert.match(stageOf(second).detail, /has git history/);
    assert.ok(!existsSync(path.join(dir, 'data', 'visibility.yaml')));
    assert.equal(subjects(dir).filter((s) => s.startsWith('chore(visibility)')).length, 1);
    assert.doesNotMatch(second.receipt, /Publication decision for the org/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an instance that already has data/visibility.yaml: the stage is a no-op and says so', () => {
  const mine = 'visibility:\n  collections:\n    ideas: { default: public }\n';
  const dir = tempInstance({ ...BASE, ...WK('proposals.json'), 'data/visibility.yaml': mine, 'data/governance.yaml': 'governance: {}\n' });
  try {
    const before = git(dir, ['rev-list', '--count', 'HEAD']);
    const r = runWithFramework(dir);
    const stage = stageOf(r);
    assert.equal(stage.status, 'ok');
    assert.match(stage.detail, /already exists — nothing to declare/);
    assert.equal(readFileSync(path.join(dir, 'data', 'visibility.yaml'), 'utf-8'), mine);
    assert.ok(!subjects(dir).some((s) => s.startsWith('chore(visibility)')));
    assert.ok(Number(git(dir, ['rev-list', '--count', 'HEAD'])) >= Number(before));
    assert.doesNotMatch(r.receipt, /Publication decision for the org/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no 0.6 output (registries, and only the dao.json a clone renders): a no-op that says why, no commit', () => {
  const dir = tempInstance({
    ...BASE, ...WK('dao.json'), 'data/members.yaml': yaml.dump(MEMBERS), 'data/governance.yaml': 'governance: {}\n', 'data/systems.yaml': 'systems: []\n',
  });
  try {
    const r = runWithFramework(dir);
    const stage = stageOf(r);
    assert.equal(stage.status, 'ok');
    assert.match(stage.detail, /no 0\.6 output in \.well-known\/ .* nothing to declare/);
    assert.ok(!existsSync(path.join(dir, 'data', 'visibility.yaml')));
    assert.ok(!subjects(dir).some((s) => s.startsWith('chore(visibility)')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an instance with no registry to declare: a no-op that says so, no commit', () => {
  const dir = tempInstance({ ...BASE, ...WK('ideas.json') });
  try {
    const r = runWithFramework(dir);
    assert.match(stageOf(r).detail, /maps to no registry this instance has — nothing to declare/);
    assert.ok(!existsSync(path.join(dir, 'data', 'visibility.yaml')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- L8-C18: L8's own output is not 0.6 output ------------------------------

/** dao.json as the L8 generator writes it (its mark included), from the generator itself. */
const L8_DAO_JSON = JSON.stringify(daoDoc({ identity: { name: 'Test DAO', type: 'DAO' }, origin: 'https://dao.example.org' }, new Set()), null, 2) + '\n';
/** dao.json as 0.6 rendered it from the template: no mark. */
const DAO_06_JSON = JSON.stringify({ '@context': 'http://www.daostar.org/schemas', type: 'DAO', name: 'Test DAO' }, null, 2) + '\n';
const REGISTRIES = { 'data/members.yaml': yaml.dump(MEMBERS), 'data/governance.yaml': 'governance: {}\n', 'data/systems.yaml': 'systems: []\n' };

test('L8-C18: the doctor reads the generator\'s own mark: one key, one check, no drift', () => {
  assert.equal(DOCTOR_MARK_KEY, GENERATOR_MARK_KEY);
  assert.equal(isGeneratedByL8(L8_DAO_JSON), true);
  assert.equal(hasGeneratorMark(JSON.parse(L8_DAO_JSON)), true);
  assert.equal(isGeneratedByL8(DAO_06_JSON), false);
  assert.equal(isGeneratedByL8('{}\n'), false);
  assert.equal(isGeneratedByL8('not json'), false);
  assert.equal(isGeneratedByL8(null), false);
});

test('L8-C18: L8 output (dao.json carries the mark) with no data/visibility.yaml and no history: no declaration, no commit', () => {
  const dir = tempInstance({ ...BASE, ...REGISTRIES, ...WK(...OUTPUT_FILES), '.well-known/dao.json': L8_DAO_JSON });
  try {
    assert.equal(git(dir, ['log', '--format=%H', '--', 'data/visibility.yaml']), '');
    const before = subjects(dir);
    const r = runWithFramework(dir);
    assert.equal(r.aborted, false, JSON.stringify(r.stages, null, 2));
    const stage = stageOf(r);
    assert.equal(stage.status, 'ok');
    assert.match(stage.detail, /\.well-known\/dao\.json carries the L8 generator's mark \(x-org-os\)/);
    assert.match(stage.detail, /written by the L8 generator, not by 0\.6/);
    assert.ok(!existsSync(path.join(dir, 'data', 'visibility.yaml')));
    assert.ok(!subjects(dir).some((s) => s.startsWith('chore(visibility)')), subjects(dir).join(' | '));
    assert.ok(subjects(dir).length >= before.length);
    assert.doesNotMatch(r.receipt, /Publication decision for the org/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('L8-C18 converse: the same files with a 0.6 dao.json (no mark), or with no dao.json, are declared', () => {
  for (const dao of [{ '.well-known/dao.json': DAO_06_JSON }, {}]) {
    const dir = tempInstance({ ...BASE, ...REGISTRIES, ...WK(...OUTPUT_FILES), ...dao });
    try {
      const r = runWithFramework(dir);
      assert.equal(r.aborted, false, JSON.stringify(r.stages, null, 2));
      assert.match(stageOf(r).detail, /wrote and committed/);
      const cols = yaml.load(readFileSync(path.join(dir, 'data', 'visibility.yaml'), 'utf-8')).visibility.collections;
      assert.deepEqual(Object.keys(cols), ['members', 'governance', 'systems']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('L8-C18: --dry-run on L8 output declares nothing and touches no git', () => {
  const dir = tempInstance({ ...BASE, ...REGISTRIES, ...WK(...OUTPUT_FILES), '.well-known/dao.json': L8_DAO_JSON });
  try {
    const calls = [];
    const io = { ...stageIo(), git: (d, args) => { calls.push(args); return realIo.git(d, args); } };
    const r = runSync({ dir, name: 'Test DAO', framework: { dir: '/nowhere', version: '0.6.0', headSha: 'f'.repeat(40) }, git: { remotes: {} } }, { dryRun: true }, io);
    assert.equal(r.declarationText, null);
    assert.ok(!calls.some((a) => a[0] === 'log'), JSON.stringify(calls));
    assert.ok(!existsSync(path.join(dir, 'data', 'visibility.yaml')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--dry-run prints the file and writes nothing', () => {
  const dir = tempInstance({ ...BASE, ...WK('contracts.json'), 'data/systems.yaml': 'systems: []\n' });
  try {
    const r = runSync({ dir, name: 'Test DAO', framework: { dir: '/nowhere', version: '0.6.0', headSha: 'f'.repeat(40) }, git: { remotes: {} } }, { dryRun: true }, stageIo());
    assert.equal(r.dryRun, true);
    assert.match(r.declarationText, /systems: \{ default: public \}/);
    assert.ok(!existsSync(path.join(dir, 'data', 'visibility.yaml')));
    assert.equal(git(dir, ['status', '--porcelain']), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
