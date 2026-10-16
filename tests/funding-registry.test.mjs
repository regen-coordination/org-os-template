import test from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { fundingRegistry } from '../scripts/lib/funding-registry.mjs';

const funding = yaml.load(`
org: { id: example-node, name: Example Node }
pools:
  - { id: seed-round-1, name: Seed Round 1, rule: direct, started: 2026-09-01, notes: internal }
flows:
  - id: g1
    type: contribution
    pool: seed-round-1
    to: { name: Project A, addresses: ["0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"] }
    amount_usd: 1500
    date: 2026-09-20
    evidence: https://example.org/tx/1
    donors: [alice]
calls:
  - { id: open-1, title: Local regen grants, closes: 2026-11-30, call_type: philanthropic }
`);

test('the registry keeps the published fields, as strings, and nothing else', () => {
  const r = fundingRegistry(funding, { daoURI: 'https://example.org/.well-known/dao.json' });
  assert.equal(r.type, 'FundingRegistry');
  assert.deepEqual(r.org, { id: 'example-node', name: 'Example Node', daoURI: 'https://example.org/.well-known/dao.json' });
  assert.deepEqual(r.pools[0], { id: 'seed-round-1', name: 'Seed Round 1', rule: 'direct', started: '2026-09-01' });
  assert.equal(r.flows[0].date, '2026-09-20');
  assert.equal(r.flows[0].donors, undefined);
  assert.equal(r.calls[0].closes, '2026-11-30');
});

test('no funding file, no registry', () => {
  assert.equal(fundingRegistry(null, {}), null);
});

test('unlisted "to" fields are dropped; org falls back to identity', () => {
  const r = fundingRegistry({
    flows: [{ id: 'b', type: 'pledge', date: '2026-10-01', to: { name: 'X', contact: 'secret@example.org' } }],
  }, { id: 'n', name: 'N' });
  assert.deepEqual(r.flows[0].to, { name: 'X' });
  assert.deepEqual(r.org, { id: 'n', name: 'N' });
  assert.deepEqual(r.pools, []);
});

test('entries that would break the schema are dropped and reported, not published', () => {
  const ok = { id: 'ok', type: 'pledge', date: '2026-10-01', to: { name: 'X' } };
  const r = fundingRegistry({
    pools: [{ id: 'p1', name: 'P', rule: 'lottery' }, { id: 'p2', name: 'P2', rule: 'direct' }],
    flows: [ok, { ...ok, id: 'no-to', to: undefined }, { ...ok, id: 'no-name', to: { url: 'https://x' } }, { ...ok, id: 'bad-type', type: 'gift' }],
    calls: [{ id: 'c1', title: 'C', call_type: 'sponsorship' }, { id: 'c2', title: 'C2', call_type: 'civic' }],
  }, { id: 'n', name: 'N' });
  assert.deepEqual(r.pools.map((p) => p.id), ['p2']);
  assert.deepEqual(r.flows.map((f) => f.id), ['ok']);
  assert.deepEqual(r.calls.map((c) => c.id), ['c2']);
  assert.deepEqual(r.dropped.map((d) => `${d.kind}:${d.id}`), ['pool:p1', 'flow:no-to', 'flow:no-name', 'flow:bad-type', 'call:c1']);
  assert.ok(r.dropped.every((d) => d.reason));
  assert.equal('dropped' in JSON.parse(JSON.stringify(r)), false);
});

test('no org id and name anywhere, no registry', () => {
  assert.equal(fundingRegistry({ flows: [] }, {}), null);
});
