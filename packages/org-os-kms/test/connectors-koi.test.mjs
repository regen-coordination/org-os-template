import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fw from '../src/framework.mjs';
import { koiConnector } from '../src/connectors/koi.mjs';

test('koi describe() is a valid source-system of type knowledge-garden', () => {
  const card = koiConnector.describe({ coordinator: 'https://regen.gaiaai.xyz/api/koi' });
  assert.equal(card.type, 'knowledge-garden');
  assert.ok(fw.validateObject('source-system', card).valid);
});

test('koi maps a NEW bundle to a valid resource, preserving the RID', () => {
  const bundle = {
    rid: 'rid:orgos:doc:refi-dao-local-node-model',
    event_type: 'NEW',
    manifest: { timestamp: '2026-07-01T00:00:00Z' },
    contents: { title: 'Local Node Model', text: 'A local node is...' },
  };
  const out = koiConnector.map(bundle, {});
  assert.equal(out.length, 1);
  assert.equal(out[0].schema, 'resource');
  const o = out[0].object;
  assert.equal(o.type, 'resource');
  assert.equal(o.title, 'Local Node Model');
  assert.equal(o.source_lineage, bundle.rid);
  assert.ok(fw.validateObject('resource', { ...o, maturity: 'raw' }).valid);
});

test('koi maps a FORGET event to a review-flagged signal (never a delete)', () => {
  const out = koiConnector.map({ rid: 'rid:orgos:doc:x', event_type: 'FORGET' }, {});
  assert.equal(out[0].schema, 'signal');
  assert.equal(out[0].object.signal_type, 'source-system');
  assert.equal(out[0].object.proposed_intervention, 'review');
  assert.ok(fw.validateObject('signal', { ...out[0].object, maturity: 'raw' }).valid);
});
