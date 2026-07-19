import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { loadKmsConfig, persistConnectorCursors } from '../src/config.mjs';

function tmpInstance(yamlText) {
  const dir = mkdtempSync(join(tmpdir(), 'kms-config-'));
  if (yamlText != null) writeFileSync(join(dir, 'kms.yaml'), yamlText);
  return dir;
}

test('loads a valid kms.yaml and defaults render to {}', () => {
  const dir = tmpInstance('instance: t\nadapter: repo-data\ntarget: "."\n');
  const cfg = loadKmsConfig(dir);
  assert.equal(cfg.instance, 't');
  assert.equal(cfg.adapter, 'repo-data');
  assert.deepEqual(cfg.render, {});
});

test('throws a clear error when kms.yaml is absent', () => {
  const dir = tmpInstance(null);
  assert.throws(() => loadKmsConfig(dir), /no kms.yaml/);
});

test('throws when adapter or target is missing', () => {
  const dir = tmpInstance('instance: t\n');
  assert.throws(() => loadKmsConfig(dir), /missing "adapter"/);
});

test('throws when target is missing but adapter is present', () => {
  const dir = tmpInstance('instance: t\nadapter: repo-data\n');
  assert.throws(() => loadKmsConfig(dir), /missing "target"/);
});

test('persistConnectorCursors updates connector cursors in kms.yaml without clobbering other keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kms-cfg-'));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({
    instance: 'test', adapter: 'repo-data', target: '.',
    connectors: [{ name: 'github', config: { repos: ['a/b'] }, cursor: null }],
  }));
  persistConnectorCursors(dir, [{ name: 'github', config: { repos: ['a/b'] }, cursor: '2026-07-01T00:00:00Z' }]);
  const doc = yaml.load(readFileSync(join(dir, 'kms.yaml'), 'utf8'));
  assert.equal(doc.instance, 'test');
  assert.equal(doc.connectors[0].cursor, '2026-07-01T00:00:00Z');
});
