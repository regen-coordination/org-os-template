import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runConnector, NOT_IMPLEMENTED } from '../src/connector.mjs';

function memAdapter() {
  const stored = [];
  return {
    name: 'mem',
    store(_target, entries) {
      stored.push(...entries);
      return { stored: entries.map((e, i) => `${e.object.title}#${i}`) };
    },
    _stored: stored,
  };
}

const fakeConnector = {
  name: 'fake',
  protocol: 'Fake',
  capabilities: { ingest: true, subscribe: false, publish: false },
  describe: () => ({ title: 'Fake Source', type: 'repo', steward: 'tester', return_path: 'https://example.org' }),
  pull: async () => ({ records: [{ t: 'Hello' }, { t: 'World' }], cursor: 'c2' }),
  map: (r) => [{ schema: 'signal', object: { title: r.t, type: 'signal', signal_type: 'content' } }],
};

test('runConnector stores the source card + mapped candidates, stamps born-rules, returns next cursor', async () => {
  const a = memAdapter();
  const res = await runConnector(fakeConnector, { config: {}, cursor: null, adapter: a, target: '.' });
  assert.equal(res.cursor, 'c2');
  assert.equal(res.candidates, 2);
  assert.equal(res.errors.length, 0);
  assert.equal(a._stored.length, 3);
  const sig = a._stored.find((e) => e.schema === 'signal');
  assert.equal(sig.object.maturity, 'raw');
  assert.equal(sig.object.provenance.origin, 'Fake Source');
});

test('runConnector propagates a stub NOT_IMPLEMENTED from pull', async () => {
  const stub = {
    name: 'stub', protocol: 'Stub', capabilities: { ingest: true, subscribe: false, publish: false },
    describe: () => ({ title: 'Stub', type: 'repo', steward: 't', return_path: 'https://x.org' }),
    pull() { throw new Error(`${NOT_IMPLEMENTED}: stub`); },
    map: () => [],
  };
  await assert.rejects(() => runConnector(stub, { adapter: memAdapter(), target: '.' }), /NOT_IMPLEMENTED/);
});

test('runConnector rejects a describe() that is not a valid source-system', async () => {
  const bad = { name: 'bad', protocol: 'Bad', capabilities: { ingest: true }, describe: () => ({ title: 'no type' }), pull: async () => ({ records: [] }), map: () => [] };
  await assert.rejects(() => runConnector(bad, { adapter: memAdapter(), target: '.' }), /source-system/);
});

test('runConnector forces maturity:raw even if map emits a different maturity', async () => {
  const stored = [];
  const a = { name: 'mem', store(_t, e) { stored.push(...e); return { stored: e.map((_x, i) => `r${i}`) }; } };
  const conn = {
    name: 'x', protocol: 'X', capabilities: { ingest: true },
    describe: () => ({ title: 'X', type: 'repo', steward: 't', return_path: 'https://x.org' }),
    pull: async () => ({ records: [{}], cursor: null }),
    map: () => [{ schema: 'signal', object: { title: 'canon', type: 'signal', signal_type: 'content', maturity: 'canonical' } }],
  };
  await runConnector(conn, { adapter: a, target: '.' });
  const sig = stored.find((e) => e.schema === 'signal');
  assert.equal(sig.object.maturity, 'raw');
});

test('runConnector dry mode reports candidates without calling adapter.store', async () => {
  const a = { name: 'mem', store() { throw new Error('adapter.store must not be called in dry mode'); } };
  const res = await runConnector(fakeConnector, { config: {}, cursor: null, adapter: a, target: '.', dry: true });
  assert.equal(res.dry, true);
  assert.equal(res.candidates, 2);
  assert.equal(res.stored, 3); // card + 2 signals = would-store count
});
