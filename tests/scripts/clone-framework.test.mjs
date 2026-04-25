import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import yamlMod from 'js-yaml';

// Skip the slow npm install + git init stages in tests that only verify
// copy/strip/render/materialize on-disk state. The dedicated dry-run test
// below exercises the full pipeline path.
const SKIP_FINISH_ENV = { ...process.env, ORG_OS_CLONE_SKIP_FINISH: '1' };

test('clone-framework --help prints usage', () => {
  const r = spawnSync('node', ['scripts/clone-framework.mjs', '--help'], { encoding: 'utf-8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: node scripts\/clone-framework\.mjs/);
});

test('clone-framework requires --target', () => {
  const r = spawnSync('node', ['scripts/clone-framework.mjs'], { encoding: 'utf-8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /--target required/);
});

test('clone-framework --dry-run lists planned actions without writing', () => {
  const r = spawnSync('node', [
    'scripts/clone-framework.mjs',
    '--target', '/tmp/never-create-me-' + Date.now(),
    '--type', 'project',
    '--non-interactive',
    '--config', 'tests/fixtures/instance-config.yaml',
    '--dry-run'
  ], { encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[dry-run\]/);
});

test('clone-framework copies framework files into target (Task 20)', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-copy-'));
  try {
    spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target,
      '--type', 'project',
      '--non-interactive',
      '--config', 'tests/fixtures/instance-config.yaml',
      '--force'
    ], { encoding: 'utf-8', env: SKIP_FINISH_ENV });
    assert.ok(existsSync(path.join(target, 'AGENTS.md')), 'AGENTS.md should be copied');
    assert.ok(existsSync(path.join(target, 'data')), 'data/ should be copied');
    assert.ok(!existsSync(path.join(target, 'data', 'instances.yaml')),
      'framework-only data/instances.yaml should be stripped');
    assert.ok(!existsSync(path.join(target, 'scripts', 'clone-framework.mjs')),
      'cloning script itself should be stripped');
    assert.ok(!existsSync(path.join(target, 'templates')),
      'templates/ should be stripped (framework-only)');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('clone-framework resets framework-specific markdown (Task 21)', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-reset-'));
  try {
    spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target, '--type', 'project',
      '--non-interactive', '--config', 'tests/fixtures/instance-config.yaml',
      '--force'
    ], { encoding: 'utf-8', env: SKIP_FINISH_ENV });

    const memContent = readFileSync(path.join(target, 'MEMORY.md'), 'utf-8');
    assert.ok(!memContent.includes('Self-hosting inauguration'),
      'instance MEMORY.md should not contain framework-specific decisions');

    const heartbeatContent = readFileSync(path.join(target, 'HEARTBEAT.md'), 'utf-8');
    assert.match(heartbeatContent, /Run `\/initialize` for the first time/);

    const memDir = fs.readdirSync(path.join(target, 'memory'));
    assert.equal(memDir.length, 1, 'memory/ should contain exactly seed welcome note');
    assert.match(memDir[0], /^\d{4}-\d{2}-\d{2}\.md$/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('clone-framework renders README + GETTING-STARTED into target (Task 23)', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-render-'));
  try {
    spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target, '--type', 'project',
      '--non-interactive', '--config', 'tests/fixtures/instance-config.yaml',
      '--force'
    ], { encoding: 'utf-8', env: SKIP_FINISH_ENV });
    const readme = readFileSync(path.join(target, 'README.md'), 'utf-8');
    assert.match(readme, /Selftest Instance/, 'README rendered with org name from config');
    assert.ok(!readme.includes('{{'), 'no template strings leaked');
    const gs = readFileSync(path.join(target, 'GETTING-STARTED.md'), 'utf-8');
    assert.match(gs, /Selftest Instance/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('clone-framework materializes selected skills (Task 24)', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-skills-'));
  try {
    spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target, '--type', 'project',
      '--non-interactive', '--config', 'tests/fixtures/instance-config.yaml',
      '--force'
    ], { encoding: 'utf-8', env: SKIP_FINISH_ENV });
    // The fixture enables all 10 canonical skills
    assert.ok(fs.existsSync(path.join(target, 'skills', 'bootstrap-interviewer')));
    assert.ok(fs.existsSync(path.join(target, 'skills', 'org-os-init')));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('clone-framework writes federation.yaml with nested schema + selected packages (Task 25)', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-fed-'));
  try {
    spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target, '--type', 'project',
      '--non-interactive', '--config', 'tests/fixtures/instance-config.yaml',
      '--force'
    ], { encoding: 'utf-8', env: SKIP_FINISH_ENV });
    const fed = yamlMod.load(readFileSync(path.join(target, 'federation.yaml'), 'utf-8'));

    // Nested schema sections required by validate-structure.mjs
    assert.ok(fed.identity, 'has identity section');
    assert.equal(fed.identity.name, 'Selftest Instance');
    assert.equal(fed.identity.type, 'Project');
    assert.ok(fed.federation, 'has federation section');
    assert.equal(fed.federation.role, 'standalone-instance');
    assert.ok(fed.agent, 'has agent section');
    assert.equal(fed.agent.runtime, 'claude-code');
    assert.ok(fed.metadata, 'has metadata section');
    assert.match(fed.metadata.framework_version, /^\d+\.\d+$/);

    // Packages stay flat at top level (sync-packages.mjs requires this)
    assert.equal(typeof fed.packages, 'object');

    // dao.json should be rendered into .well-known/ from the template
    const daoRaw = readFileSync(path.join(target, '.well-known', 'dao.json'), 'utf-8');
    const dao = JSON.parse(daoRaw);
    assert.equal(dao.name, 'Selftest Instance');
    assert.ok(!daoRaw.includes('{{'), 'dao.json template placeholders fully substituted');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('clone-framework strips framework identity files (IDENTITY.md regenerated)', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-id-'));
  try {
    spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target, '--type', 'project',
      '--non-interactive', '--config', 'tests/fixtures/instance-config.yaml',
      '--force'
    ], { encoding: 'utf-8', env: SKIP_FINISH_ENV });

    const id = readFileSync(path.join(target, 'IDENTITY.md'), 'utf-8');
    assert.ok(!id.includes('framework + orchestration hub'),
      'IDENTITY.md should not contain framework hub language');
    assert.ok(!id.includes('refi-bcn-os') && !id.includes('refi-dao-os'),
      'IDENTITY.md should not list framework downstream instances');
    assert.match(id, /Selftest Instance/, 'IDENTITY.md should reflect instance name');

    const soul = readFileSync(path.join(target, 'SOUL.md'), 'utf-8');
    assert.ok(!soul.includes('federation of regenerative organizations'),
      'SOUL.md should not contain framework mission language');
    assert.match(soul, /Mission/, 'SOUL.md should be a fresh template');

    const claudeMd = readFileSync(path.join(target, 'CLAUDE.md'), 'utf-8');
    assert.ok(!claudeMd.includes('Framework thinking'),
      'CLAUDE.md should not contain framework-only rules');
    assert.match(claudeMd, /Selftest Instance/, 'CLAUDE.md should reference instance name');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('clone-framework strips framework data registries (projects.yaml empty seed)', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-data-'));
  try {
    spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target, '--type', 'project',
      '--non-interactive', '--config', 'tests/fixtures/instance-config.yaml',
      '--force'
    ], { encoding: 'utf-8', env: SKIP_FINISH_ENV });

    const projContent = readFileSync(path.join(target, 'data/projects.yaml'), 'utf-8');
    assert.ok(!projContent.includes('v2-stabilization'),
      'data/projects.yaml should not contain framework workstreams');
    assert.ok(!projContent.includes('Federation Protocol'),
      'data/projects.yaml should not contain framework projects');
    assert.match(projContent, /projects:\s*\[\]/, 'data/projects.yaml should be empty list seed');

    const ideasContent = readFileSync(path.join(target, 'data/ideas.yaml'), 'utf-8');
    assert.ok(!ideasContent.includes('idea-001-hatching-pipeline'),
      'data/ideas.yaml should not contain framework ideas');

    const govContent = readFileSync(path.join(target, 'data/governance.yaml'), 'utf-8');
    assert.ok(!govContent.includes('Self-hosting inauguration'),
      'data/governance.yaml should not contain framework decisions');
    assert.match(govContent, /decisions:\s*\[\]/, 'governance.yaml decisions should be empty');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('clone-framework strips framework agent plans + bootstrap fixtures', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-plans-'));
  try {
    spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target, '--type', 'project',
      '--non-interactive', '--config', 'tests/fixtures/instance-config.yaml',
      '--force'
    ], { encoding: 'utf-8', env: SKIP_FINISH_ENV });

    const planDir = path.join(target, 'docs/agent-plans');
    if (existsSync(planDir)) {
      const files = fs.readdirSync(planDir);
      for (const f of files) {
        if (f === 'README.md') continue;
        assert.fail(`framework plan leaked into instance: ${f}`);
      }
    }
    // Bootstrap fixtures should not leak
    assert.ok(!existsSync(path.join(target, 'tests/fixtures/bread-coop-os-config.yaml')),
      'tests/fixtures/bread-coop-os-config.yaml should be stripped');
    assert.ok(!existsSync(path.join(target, 'tests/fixtures/instance-config.yaml')),
      'tests/fixtures/instance-config.yaml should be stripped');
    // Framework specs should not leak
    const specsDir = path.join(target, 'docs/superpowers/specs');
    if (existsSync(specsDir)) {
      assert.equal(fs.readdirSync(specsDir).length, 0,
        'docs/superpowers/specs should be empty in instance');
    }
    // memory/reports should not leak (framework-only audit history)
    assert.ok(!existsSync(path.join(target, 'memory/reports')),
      'memory/reports should not exist in instance (framework-only)');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('clone-framework strips framework knowledge index', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-know-'));
  try {
    spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target, '--type', 'project',
      '--non-interactive', '--config', 'tests/fixtures/instance-config.yaml',
      '--force'
    ], { encoding: 'utf-8', env: SKIP_FINISH_ENV });
    const idxPath = path.join(target, 'knowledge/INDEX.md');
    assert.ok(existsSync(idxPath), 'knowledge/INDEX.md should exist as instance stub');
    const idx = readFileSync(idxPath, 'utf-8');
    assert.ok(!idx.includes('Organizational OS Knowledge Commons'),
      'knowledge/INDEX.md should not contain framework index content');
    assert.match(idx, /Selftest Instance/, 'knowledge/INDEX.md should reference instance name');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('clone-framework writes lean instance package.json', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-pkg-'));
  try {
    spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target, '--type', 'project',
      '--non-interactive', '--config', 'tests/fixtures/instance-config.yaml',
      '--force'
    ], { encoding: 'utf-8', env: SKIP_FINISH_ENV });
    const pkg = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf-8'));
    assert.notEqual(pkg.name, 'organizational-os-template',
      'package.json name should be instance slug, not framework template');
    assert.equal(pkg.name, 'selftest-instance');
    // Framework-only scripts should be gone
    assert.ok(!pkg.scripts['clone:framework'], 'clone:framework should be stripped');
    assert.ok(!pkg.scripts['analyze:instances'], 'analyze:instances should be stripped');
    assert.ok(!pkg.scripts['render:self'], 'render:self should be stripped');
    assert.ok(!pkg.scripts['install:hooks'], 'install:hooks should be stripped');
    assert.ok(!pkg.scripts.selftest, 'selftest should be stripped');
    // Essential instance scripts preserved
    assert.ok(pkg.scripts['validate:schemas']);
    assert.ok(pkg.scripts['generate:schemas']);
    assert.ok(pkg.scripts['sync:upstream']);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('clone-framework strips framework repos manifest', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-repos-'));
  try {
    spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target, '--type', 'project',
      '--non-interactive', '--config', 'tests/fixtures/instance-config.yaml',
      '--force'
    ], { encoding: 'utf-8', env: SKIP_FINISH_ENV });
    const manifest = JSON.parse(readFileSync(path.join(target, 'repos.manifest.json'), 'utf-8'));
    assert.deepEqual(manifest.repositories, [],
      'repos.manifest.json should be empty in instance');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('clone-framework dry-run completes all stages (Tasks 26-27)', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-dryrun-'));
  rmSync(target, { recursive: true, force: true });  // delete so it doesn't exist
  try {
    const r = spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target,
      '--type', 'project',
      '--non-interactive',
      '--config', 'tests/fixtures/instance-config.yaml',
      '--dry-run'
    ], { encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\[dry-run\]/);
    assert.match(r.stdout, /npm install \+ generate:schemas \+ validate/);
    assert.match(r.stdout, /git init \+ initial commit/);
    assert.match(r.stdout, /clone\] complete \(dry-run\)/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
