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

test('github pull keeps per-stream cursors (issue + release watermarks tracked separately)', async () => {
  const fake = (args) => {
    if (args[0] === 'issue') return [{ number: 1, title: 'I', body: '', url: 'u1', updatedAt: '2026-07-10T00:00:00Z', author: { login: 'a' } }];
    if (args[0] === 'release') return [{ name: 'v1', tagName: 'v1', url: 'r1', publishedAt: '2026-06-01T00:00:00Z' }];
    return [];
  };
  const { records, cursor } = await githubConnector.pull(
    { repos: ['o/r'], include: ['issues', 'releases'] }, { cursor: null }, { ghJSON: fake });
  assert.equal(records.length, 2);
  assert.equal(cursor.issues, '2026-07-10T00:00:00Z');
  assert.equal(cursor.releases, '2026-06-01T00:00:00Z');
});

test('github pull: a newer issue does NOT cause a newer release to be skipped (per-stream filtering)', async () => {
  const fake = (args) => {
    if (args[0] === 'issue') return [{ number: 2, title: 'I2', body: '', url: 'u2', updatedAt: '2026-07-15T00:00:00Z', author: { login: 'a' } }];
    if (args[0] === 'release') return [{ name: 'v2', tagName: 'v2', url: 'r2', publishedAt: '2026-07-05T00:00:00Z' }];
    return [];
  };
  const { records } = await githubConnector.pull(
    { repos: ['o/r'], include: ['issues', 'releases'] },
    { cursor: { issues: '2026-07-10T00:00:00Z', releases: '2026-06-01T00:00:00Z' } },
    { ghJSON: fake });
  // issue 07-15 > 07-10 → in; release 07-05 > 06-01 → in (NOT filtered by the issue watermark)
  assert.equal(records.length, 2);
  assert.ok(records.some((r) => r.kind === 'release'));
});

test('github pull requests only valid gh release fields and constructs the release url', async () => {
  const calls = [];
  const fake = (args) => {
    calls.push(args);
    if (args[0] === 'release') return [{ name: 'v1.2.0', tagName: 'v1.2.0', publishedAt: '2026-07-01T00:00:00Z' }];
    return [];
  };
  const { records } = await githubConnector.pull(
    { repos: ['o/r'], include: ['releases'] }, { cursor: null }, { ghJSON: fake });
  const relArgs = calls.find((a) => a[0] === 'release');
  const jsonSpec = relArgs[relArgs.indexOf('--json') + 1];
  // `url` is not a valid gh release-list field — requesting it makes gh exit non-zero.
  assert.ok(!jsonSpec.split(',').includes('url'), `must not request url field, got: ${jsonSpec}`);
  assert.equal(records.length, 1);
  assert.equal(records[0].url, 'https://github.com/o/r/releases/tag/v1.2.0');
});

test('github pull warns on an unhandled include type', async () => {
  const fake = () => [];
  const { warnings } = await githubConnector.pull(
    { repos: ['o/r'], include: ['discussions'] }, { cursor: null }, { ghJSON: fake });
  assert.ok(warnings.some((w) => /unhandled include type "discussions"/.test(w)));
});
