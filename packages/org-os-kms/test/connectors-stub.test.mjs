import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fw from '../src/framework.mjs';
import { geoConnector } from '../src/connectors/geo.mjs';
import { radicleConnector } from '../src/connectors/radicle.mjs';
import { atprotoConnector } from '../src/connectors/atproto.mjs';
import { synthefyConnector } from '../src/connectors/synthefy.mjs';

const stubs = [
  ['geo', geoConnector], ['radicle', radicleConnector],
  ['atproto', atprotoConnector], ['synthefy', synthefyConnector],
];

for (const [name, conn] of stubs) {
  test(`${name} stub: describe() is a valid source-system`, () => {
    assert.equal(conn.name, name);
    const card = conn.describe({});
    const v = fw.validateObject('source-system', card);
    assert.ok(v.valid, `invalid card: ${v.errors.join('; ')}`);
  });
  test(`${name} stub: capabilities declare ingest-only, pull throws NOT_IMPLEMENTED`, () => {
    assert.deepEqual(conn.capabilities, { ingest: true, subscribe: false, publish: false });
    assert.throws(() => conn.pull({}, { cursor: null }), /NOT_IMPLEMENTED/);
    assert.deepEqual(conn.map({}, {}), []);
    assert.equal(typeof conn.spec, 'string');
    assert.ok(conn.spec.length > 80, 'stub must carry an implementation spec');
  });
}
