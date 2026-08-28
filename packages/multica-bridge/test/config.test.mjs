import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = resolve(pkgRoot, 'config.example.yaml');

test('config example exists and parses', () => {
  assert.ok(existsSync(examplePath), `missing ${examplePath}`);
  const cfg = yaml.load(readFileSync(examplePath, 'utf8'));
  assert.equal(typeof cfg.multica.baseUrl, 'string');
  assert.equal(typeof cfg.multica.workspace, 'string');
  assert.equal(typeof cfg.multica.agent, 'string');
  assert.equal(typeof cfg.instance.path, 'string');
});
