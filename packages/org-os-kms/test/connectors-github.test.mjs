import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fw from '../src/framework.mjs';
import { githubConnector } from '../src/connectors/github.mjs';

test('github describe() is a valid source-system of type repo', () => {
  const card = githubConnector.describe({ repos: ['ReFiDAO/refi-dao-os'] });
  assert.equal(card.type, 'repo');
  const v = fw.validateObject('source-system', card);
  assert.ok(v.valid, v.errors.join('; '));
});

test('github maps an issue record to a valid signal', () => {
  const rec = {
    kind: 'issue', repo: 'ReFiDAO/refi-dao-os', number: 5,
    title: 'Clarify local-node onboarding', body: 'We should document the steps.',
    url: 'https://github.com/ReFiDAO/refi-dao-os/issues/5',
    updatedAt: '2026-07-01T12:00:00Z', author: { login: 'alice' },
  };
  const out = githubConnector.map(rec, {});
  assert.equal(out.length, 1);
  assert.equal(out[0].schema, 'signal');
  const o = out[0].object;
  assert.equal(o.type, 'signal');
  assert.equal(o.signal_type, 'content');
  assert.equal(o.title, 'Clarify local-node onboarding');
  assert.equal(o.source_lineage, rec.url);
  assert.ok(fw.validateObject('signal', { ...o, maturity: 'raw' }).valid);
});

test('github maps a release record to a valid resource', () => {
  const rec = { kind: 'release', repo: 'ReFiDAO/refi-dao-os', name: 'v2.0.0', body: 'Notes', url: 'https://github.com/ReFiDAO/refi-dao-os/releases/tag/v2.0.0', publishedAt: '2026-06-01T00:00:00Z' };
  const out = githubConnector.map(rec, {});
  assert.equal(out[0].schema, 'resource');
  assert.equal(out[0].object.type, 'resource');
  assert.ok(fw.validateObject('resource', { ...out[0].object, maturity: 'raw' }).valid);
});

test('github map returns [] for an unknown record kind', () => {
  assert.deepEqual(githubConnector.map({ kind: 'label' }, {}), []);
});
