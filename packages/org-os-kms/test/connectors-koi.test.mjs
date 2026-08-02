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

test('koi pull paginates the rids inventory and bounds by max_records', async () => {
  const pages = {
    0: { pagination: { total: 5, limit: 2, offset: 0, has_more: true },
         rids: [{ rid: 'orn:a#c0', context: 'orn:web.page', title: 'A', url: 'http://a', indexed_at: '2026-08-01T00:00:00Z' },
                { rid: 'orn:b#c0', context: 'orn:web.page', title: 'B', url: 'http://b', indexed_at: '2026-08-02T00:00:00Z' }] },
    2: { pagination: { total: 5, limit: 2, offset: 2, has_more: true },
         rids: [{ rid: 'orn:c#c0', context: 'orn:web.page', title: 'C', url: 'http://c', indexed_at: '2026-08-03T00:00:00Z' }] },
  };
  const getJSON = async (url) => { const o = Number(new URL(url).searchParams.get('offset')); return pages[o] || { pagination: { has_more: false }, rids: [] }; };
  const { records, cursor, warnings } = await koiConnector.pull(
    { coordinator: 'https://x/api/koi', page_size: 2, max_records: 3 }, { cursor: null }, { getJSON });
  assert.equal(records.length, 3);
  assert.equal(cursor, '2026-08-03T00:00:00Z');           // highest indexed_at
  assert.ok(warnings.some((w) => /bounded pull/.test(w))); // 3 of 5 → warned
});

test('koi pull skips entries at or below the cursor and filters by context', async () => {
  const getJSON = async () => ({
    pagination: { total: 3, limit: 50, offset: 0, has_more: false },
    rids: [
      { rid: 'orn:old#c0', context: 'orn:web.page', title: 'old', indexed_at: '2026-07-01T00:00:00Z' },
      { rid: 'orn:new#c0', context: 'orn:web.page', title: 'new', indexed_at: '2026-08-01T00:00:00Z' },
      { rid: 'orn:other#c0', context: 'regen.issue', title: 'other', indexed_at: '2026-08-05T00:00:00Z' },
    ],
  });
  const { records } = await koiConnector.pull(
    { contexts: ['orn:web.page'] }, { cursor: '2026-07-15T00:00:00Z' }, { getJSON });
  assert.equal(records.length, 1);
  assert.equal(records[0].rid, 'orn:new#c0');  // old filtered by cursor, other by context
});

test('koi maps a live rid-entry to a valid resource preserving the orn RID', () => {
  const out = koiConnector.map({ kind: 'rid-entry', rid: 'orn:web.page:x#chunk0', context: 'orn:web.page', title: 'Doc X', url: 'http://x' }, {});
  assert.equal(out[0].schema, 'resource');
  const o = out[0].object;
  assert.equal(o.title, 'Doc X');
  assert.equal(o.source_lineage, 'orn:web.page:x#chunk0');
  assert.equal(o.url, 'http://x');
  assert.ok(fw.validateObject('resource', { ...o, maturity: 'raw' }).valid);
});
