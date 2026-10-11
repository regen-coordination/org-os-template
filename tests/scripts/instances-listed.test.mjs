// `listed` on data/instances.yaml: an optional boolean, default true. `listed: false` means the
// entry is not shown on a public list of registered instances. It is a display flag only: the
// drift analysis, the quilt and the dashboard still read every entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { ORG_ROOT } from '../helpers/repo-paths.mjs';

const registry = yaml.load(readFileSync(resolve(ORG_ROOT, 'data/instances.yaml'), 'utf8'));
const entries = registry.instances;

// The two entries the operator decided on 2026-10-11 are not public.
const UNLISTED = ['bread-coop-os', 'openclaw'];

test('listed, where present, is a boolean', () => {
  for (const e of entries) {
    if (!('listed' in e)) continue;
    assert.equal(typeof e.listed, 'boolean',
      `${e.id}: "listed" must be true or false, found ${JSON.stringify(e.listed)}. Write listed: false to hide the entry from the public list, or remove the line.`);
  }
});

test('exactly bread-coop-os and openclaw are unlisted', () => {
  const unlisted = entries.filter((e) => e.listed === false).map((e) => e.id).sort();
  assert.deepEqual(unlisted, UNLISTED);
});

test('unlisted entries keep their other fields: still registered and analysable', () => {
  for (const id of UNLISTED) {
    const e = entries.find((x) => x.id === id);
    assert.ok(e, `${id} must stay in the registry`);
    assert.ok(e.type && e.local_path, `${id} must keep type and local_path for analyze:instances`);
  }
});
