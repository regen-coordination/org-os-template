import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPS } from '../src/ops.mjs';
import { LIFECYCLE_BINDINGS } from '../src/bind.mjs';

test('every lifecycle op-name resolves to a registered op', () => {
  const names = new Set([...LIFECYCLE_BINDINGS.initialize, ...LIFECYCLE_BINDINGS.close]);
  for (const n of names) assert.ok(OPS[n], `unregistered op: ${n}`);
});

test('exec ops carry a run() fn; skill ops carry a skill name', () => {
  for (const [name, op] of Object.entries(OPS)) {
    if (op.kind === 'exec') assert.equal(typeof op.run, 'function', `${name} missing run`);
    else { assert.equal(op.kind, 'skill'); assert.ok(op.skill, `${name} missing skill`); }
  }
});

test('csis-review and emit-contributions are skill directives', () => {
  assert.equal(OPS['csis-review'].kind, 'skill');
  assert.equal(OPS['emit-contributions'].kind, 'skill');
});

function fakeAdapterFactory() {
  const stored = [];
  return { name: 'mem', store(_t, e) { stored.push(...e); return { stored: e.map((_x, i) => `r${i}`) }; }, _stored: stored };
}

test('ingest.pull runs declared connectors, reports per-connector, writes cursors back', async () => {
  const adapter = fakeAdapterFactory();
  const good = {
    name: 'good', protocol: 'G', capabilities: { ingest: true },
    describe: () => ({ title: 'Good', type: 'repo', steward: 't', return_path: 'https://x.org' }),
    pull: async () => ({ records: [{ t: 'A' }], cursor: 'cur-1' }),
    map: (r) => [{ schema: 'signal', object: { title: r.t, type: 'signal', signal_type: 'content' } }],
  };
  const persisted = [];
  const ctx = {
    dir: '/tmp/none',
    config: { adapter: 'x', target: '.', connectors: [{ name: 'good', config: {}, cursor: null }] },
    getConnector: (n) => (n === 'good' ? good : (() => { throw new Error(`unknown ${n}`); })()),
    getAdapter: () => adapter,
    persistCursors: (_dir, conns) => persisted.push(...conns),
  };
  const res = await OPS['ingest.pull'].run(ctx);
  assert.equal(res.ok, true);
  assert.equal(res.report.pulled[0].name, 'good');
  assert.equal(res.report.pulled[0].stored, 2); // card + 1 signal
  assert.equal(persisted[0].cursor, 'cur-1');
});

test('ingest.pull skips a NOT_IMPLEMENTED stub without failing the op', async () => {
  const stub = {
    name: 'stub', protocol: 'S', capabilities: { ingest: true },
    describe: () => ({ title: 'S', type: 'repo', steward: 't', return_path: 'https://x.org' }),
    pull() { throw new Error('NOT_IMPLEMENTED: stub'); }, map: () => [],
  };
  const ctx = {
    dir: '/tmp/none',
    config: { adapter: 'x', target: '.', connectors: [{ name: 'stub', config: {}, cursor: null }] },
    getConnector: () => stub,
    getAdapter: () => fakeAdapterFactory(),
    persistCursors: () => {},
  };
  const res = await OPS['ingest.pull'].run(ctx);
  assert.equal(res.ok, true);
  assert.equal(res.report.pulled[0].skipped, 'NOT_IMPLEMENTED');
});

test('ingest.pull: a per-record soft error does NOT fail the op or advance the cursor', async () => {
  const stored = [];
  const adapter = { name: 'mem', store(_t, e) { stored.push(...e); return { stored: e.map((_x, i) => `r${i}`) }; } };
  const flaky = {
    name: 'flaky', protocol: 'F', capabilities: { ingest: true },
    describe: () => ({ title: 'Flaky', type: 'repo', steward: 't', return_path: 'https://x.org' }),
    pull: async () => ({ records: [{ ok: true }], cursor: 'cur-NEW' }),
    map: () => ([
      { schema: 'signal', object: { title: 'good', type: 'signal', signal_type: 'content' } },
      { schema: 'signal', object: { title: 'bad', type: 'signal' } }, // missing signal_type → validation error
    ]),
  };
  const decl = { name: 'flaky', config: {}, cursor: 'cur-OLD' };
  const res = await OPS['ingest.pull'].run({
    dir: '/tmp/none',
    config: { adapter: 'x', target: '.', connectors: [decl] },
    getConnector: () => flaky, getAdapter: () => adapter, persistCursors: () => {},
  });
  assert.equal(res.ok, true);                            // soft error does not fail the op
  assert.equal(decl.cursor, 'cur-OLD');                  // cursor NOT advanced
  assert.equal(res.report.pulled[0].cursor_advanced, false);
  assert.equal(res.report.pulled[0].errors.length, 1);   // the bad record is reported
});

test('ingest.pull: a thrown pull (not NOT_IMPLEMENTED) fails the op hard', async () => {
  const boom = {
    name: 'boom', protocol: 'B', capabilities: { ingest: true },
    describe: () => ({ title: 'B', type: 'repo', steward: 't', return_path: 'https://x.org' }),
    pull: async () => { throw new Error('network down'); }, map: () => [],
  };
  const res = await OPS['ingest.pull'].run({
    dir: '/tmp/none',
    config: { adapter: 'x', target: '.', connectors: [{ name: 'boom', config: {}, cursor: null }] },
    getConnector: () => boom, getAdapter: () => ({ name: 'mem', store: () => ({ stored: [] }) }), persistCursors: () => {},
  });
  assert.equal(res.ok, false);
  assert.match(res.report.errors[0], /boom: network down/);
});
