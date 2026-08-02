// tests/scripts/modules.test.mjs
//
// Tests for scripts/modules.mjs (v5 module engine, Phase 1: manifest
// validation). Fixtures build a fake framework `modules/` tree and a fake
// instance root in temp dirs, reused by Tasks 2-5 as the engine grows
// loadRegistry, resolveInstallOrder, addModule, adoptModules and a CLI.
//
// writeModule() takes `dirName` separately from `manifest.id` on purpose:
// the directory a module lives in and the id inside its module.yaml are two
// independent pieces of data, and Task 2's loadRegistry() is specifically
// responsible for catching the case where they disagree (id/directory
// mismatch). Keeping them as separate parameters here lets later tests
// construct that mismatch directly, e.g. writeModule(root, 'org-os-foo', {
// id: 'org-os-bar', ... }).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import { validateManifest, REQUIRED_FIELDS, MODULE_TYPES, KNOWN_FIELDS } from '../../scripts/modules.mjs';

// --- fixtures ------------------------------------------------------------

function writeModule(fwRoot, dirName, manifest, files = {}) {
  const dir = join(fwRoot, 'modules', dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'module.yaml'), yaml.dump(manifest));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
}

function makeFramework() {
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

function makeInstance() {
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
  const expected = [
    'missing required field: description',
    'invalid id: PM!',
    'invalid version: 1.0',
    'invalid type: weird',
  ];
  assert.deepEqual(errors.slice().sort(), expected.slice().sort());
});

test('module.schema.json and validateManifest agree on the field set', () => {
  const schemaPath = new URL('../../schemas/module.schema.json', import.meta.url);
  const s = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  assert.deepEqual(s.required.slice().sort(), [...REQUIRED_FIELDS].sort());
  assert.deepEqual(Object.keys(s.properties).sort(), [...KNOWN_FIELDS].sort());
  assert.deepEqual(s.properties.type.enum, MODULE_TYPES);
});

test('validateManifest rejects unknown fields and non-string leaf values', () => {
  const errors = validateManifest({
    id: 'org-os-x', version: '1.0.0', type: 'core', description: 'd',
    dependancies: ['org-os-standards'],
  });
  assert.ok(errors.some((e) => e.includes('unknown field: dependancies')));
  assert.deepEqual(
    validateManifest({ id: 'org-os-x', version: '1.0.0', type: 'core', description: 'd',
                       files: { 'a.md': { nested: 1 } } }),
    ['files["a.md"] target must be a string']
  );
});
