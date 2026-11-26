// The README's downstream list: listed entries only, each with its maturity, never "unknown".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { downstreamList } from '../../scripts/lib/readme-downstream.mjs';
import { ORG_ROOT } from '../helpers/repo-paths.mjs';

test('an entry marked listed: false is left out; others keep the registry order', () => {
  const list = downstreamList({ instances: [
    { id: 'a', type: 'DAO', maturity: 'production' },
    { id: 'b', type: 'Hub', maturity: 'beta', listed: false },
    { id: 'c', type: 'Project', maturity: 'alpha', listed: true },
  ] });
  assert.deepEqual(list.map((i) => i.name), ['a', 'c']);
});

test('the maturity is shown when the registry gives one, and nothing stands in for it otherwise', () => {
  const list = downstreamList({ instances: [{ id: 'a', type: 'DAO', maturity: 'beta' }, { id: 'b', type: 'Hub' }] });
  assert.equal(list[0].maturity, 'beta');
  assert.equal(list[1].maturity, '');
});

test('a registry with no instances gives an empty list', () => {
  assert.deepEqual(downstreamList({}), []);
  assert.deepEqual(downstreamList(null), []);
});

test('the README prints every listed instance with its maturity, none marked listed: false, and no "unknown"', () => {
  const registry = yaml.load(readFileSync(resolve(ORG_ROOT, 'data/instances.yaml'), 'utf8'));
  const readme = readFileSync(resolve(ORG_ROOT, 'README.md'), 'utf8');
  const block = readme.split('## Active downstream instances')[1].split('See `data/instances.yaml`')[0];
  assert.doesNotMatch(block, /unknown/);
  for (const i of registry.instances) {
    const line = `- **${i.id}** (${i.type})`;
    if (i.listed === false) assert.ok(!block.includes(line), `${i.id} is listed: false but in the README`);
    else assert.ok(block.includes(i.maturity ? `${line} — ${i.maturity}` : line), `README lacks ${line}`);
  }
});
