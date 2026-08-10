// tests/scripts/module-manifests.test.mjs
//
// Guards the real modules/ tree (not fixtures — that's modules.test.mjs). Every
// manifest the framework ships must parse, validate against the engine's
// contract, and live in a directory named after its id. This is what lets v5
// Phase 1's loadRegistry() assume a clean set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { validateManifest } from '../../scripts/modules.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const modulesDir = join(rootDir, 'modules');

function moduleDirs() {
  return readdirSync(modulesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

test('every module directory holds a valid manifest whose id matches the directory', () => {
  const dirs = moduleDirs();
  assert.ok(dirs.length > 0, 'expected at least one module in modules/');
  for (const dir of dirs) {
    const manifestPath = join(modulesDir, dir, 'module.yaml');
    assert.ok(existsSync(manifestPath), `${dir}/module.yaml is missing`);
    const manifest = yaml.load(readFileSync(manifestPath, 'utf-8'));
    assert.deepEqual(validateManifest(manifest), [], `${dir}/module.yaml failed validation`);
    assert.equal(manifest.id, dir, `${dir}/module.yaml declares id "${manifest.id}"`);
  }
});

test('org-os-cloudflare-os owns the integration package and its discovery doc', () => {
  const manifest = yaml.load(
    readFileSync(join(modulesDir, 'org-os-cloudflare-os', 'module.yaml'), 'utf-8'),
  );
  assert.equal(manifest.type, 'integration');
  assert.equal(manifest.npm, '@org-os/cloudflare-os-integration');
  // Identity mapping = "owns these paths in place" (see modules/README.md).
  for (const [src, target] of Object.entries(manifest.files)) {
    assert.equal(src, target, `files["${src}"] must be an identity mapping for an in-place module`);
  }
  assert.ok(Object.keys(manifest.files).includes('docs/integrations/cloudflare-os.md'));
});

test('every non-glob path a manifest claims actually exists', () => {
  for (const dir of moduleDirs()) {
    const manifest = yaml.load(readFileSync(join(modulesDir, dir, 'module.yaml'), 'utf-8'));
    for (const target of Object.values(manifest.files ?? {})) {
      if (target.includes('*')) continue; // globs are resolved by the engine, not here
      assert.ok(existsSync(join(rootDir, target)), `${dir}: claimed path missing — ${target}`);
    }
  }
});
