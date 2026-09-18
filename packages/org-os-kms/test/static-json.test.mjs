// packages/org-os-kms/test/static-json.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticJsonConnector } from '../src/connectors/static-json/index.mjs';
import * as openhaven from '../src/connectors/static-json/openhaven.mjs';
import { validateObject } from '../src/framework.mjs';

const fx = (f) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'openhaven', f), 'utf8');
const fetchImpl = async (url) => new Response(fx(new URL(url).pathname.split('/').pop()), { status: 200 });
const cfg = { base_url: 'https://www.openhaven.net', index: '/api/index.json', mapper: 'openhaven' };

test('openhaven mapper: protocol→resource, affordance→signal; both validate; other collections (incl. domains) map to nothing', () => {
  const p = JSON.parse(fx('protocols.json'))[0];
  const [r] = openhaven.map({ collection: '/api/protocols.json', item: p });
  assert.equal(r.schema, 'resource'); assert.equal(r.object.title, p.name); assert.equal(r.object.url, p.communityLink);
  assert.equal(r.object.resource_type, p.entityType); assert.deepEqual(r.object.related_concepts, p.domainIds);
  assert.equal(validateObject('resource', r.object).valid, true, validateObject('resource', r.object).errors.join());
  const [s] = openhaven.map({ collection: '/api/affordances.json', item: JSON.parse(fx('affordances.json'))[0] });
  assert.equal(s.schema, 'signal'); assert.equal(validateObject('signal', s.object).valid, true, validateObject('signal', s.object).errors.join());
  assert.deepEqual(openhaven.map({ collection: '/api/domains.json', item: { id: 'x', name: 'X' } }), []); // domain→track mapping removed on purpose
  assert.deepEqual(openhaven.map({ collection: '/api/entity-types.json', item: {} }), []);
});

test('connector: pull reads index + 2 collections (3 items each → 6); hash cursor; unchanged → empty', async () => {
  const c = createStaticJsonConnector({ fetchImpl });
  const first = await c.pull(cfg, { cursor: null });
  assert.equal(first.records.length, 6); assert.match(first.cursor, /^[a-f0-9]{64}$/);
  const second = await c.pull(cfg, { cursor: first.cursor });
  assert.equal(second.records.length, 0); assert.equal(second.cursor, first.cursor);
  assert.equal(c.describe(cfg).type, 'dataset'); assert.equal(c.map(first.records[0], cfg)[0].schema, 'resource');
});
