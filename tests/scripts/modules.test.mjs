import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import { validateManifest } from '../../scripts/modules.mjs';

// --- fixtures ------------------------------------------------------------

export function writeModule(fwRoot, dirName, manifest, files = {}) {
  const dir = join(fwRoot, 'modules', dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'module.yaml'), yaml.dump(manifest));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
}

export function makeFramework() {
  const root = mkdtempSync(join(tmpdir(), 'orgos-fw-'));
  writeModule(
    root,
    'org-os-standards',
    {
      id: 'org-os-standards',
      version: '1.0.0',
      type: 'core',
      description: 'test standards',
      dependencies: [],
      files: { 'scripts/hello.mjs': 'scripts/hello.mjs' },
    },
    { 'scripts/hello.mjs': 'console.log("hi");\n' }
  );
  writeModule(
    root,
    'org-os-test',
    {
      id: 'org-os-test',
      version: '1.2.0',
      type: 'operational',
      description: 'test module',
      dependencies: ['org-os-standards'],
      files: { 'skills/test/SKILL.md': 'skills/test/SKILL.md' },
      templates: { 'templates/things.yaml': 'data/things.yaml' },
    },
    { 'skills/test/SKILL.md': '# Test Skill\n', 'templates/things.yaml': 'things: []\n' }
  );
  return root;
}

export function makeInstance() {
  const root = mkdtempSync(join(tmpdir(), 'orgos-inst-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  return root;
}

// --- Task 1: validateManifest --------------------------------------------

test('validateManifest accepts a valid manifest', () => {
  assert.deepEqual(
    validateManifest({ id: 'org-os-pm', version: '1.0.0', type: 'operational', description: 'x' }),
    []
  );
});

test('validateManifest reports missing fields and bad values', () => {
  const errors = validateManifest({ id: 'PM!', version: '1.0', type: 'weird' });
  assert.ok(errors.some((e) => e.includes('description')));
  assert.ok(errors.some((e) => e.includes('invalid id')));
  assert.ok(errors.some((e) => e.includes('invalid version')));
  assert.ok(errors.some((e) => e.includes('invalid type')));
});
