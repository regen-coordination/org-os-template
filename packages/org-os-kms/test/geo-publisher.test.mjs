import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOps, publishEdit, loadGeoSdk } from '../src/geo/publisher.mjs';
import { derivedGeoId } from '../src/geo/ids.mjs';

const H = (c) => c.repeat(32);
function fakeSdk(log) {
  return {
    GeoTestnetConfig: { name: 'testnet' },
    Ops: {
      entities: { create: (p) => { log.push(['entity', p]); return { id: p.id, ops: [{ t: 'entity', id: p.id }] }; } },
      relations: { create: (p) => { log.push(['relation', p]); return { id: p.id, ops: [{ t: 'relation', id: p.id }] }; } },
    },
    createGeoWalletClient: async ({ signer, network }) => { log.push(['wallet', signer.address, network.name]); return { sendTransaction: async (tx) => { log.push(['send', tx]); return '0xtx'; } }; },
    createGeoClient: ({ network }) => ({
      personalSpaces: { publishEdit: async (p) => { log.push(['publishEdit', p]); return { editId: 'e1', cid: 'ipfs://c1', to: '0xto', calldata: '0xdata' }; } },
      daoSpaces: { proposeEdit: async (p) => { log.push(['proposeEdit', p]); return { editId: 'e2', cid: 'ipfs://c2', to: '0xto', calldata: '0xdata' }; } },
    }),
  };
}
const accounts = { privateKeyToAccount: (k) => ({ address: `addr-of-${k.length}` }) };
const geo = (kind = 'personal') => ({ space: H('1'), spaceKind: kind, authorSpace: H('2'), urlProperty: H('3') });
const entities = [
  { key: 'refidao:topic:funding', geoId: H('5'), name: 'Funding', description: 'd', typeId: H('b'), url: null, relations: [{ toGeoId: H('4'), propertyId: H('c'), toSpace: H('e') }] },
  { key: 'encyclopedia-entry:a', geoId: H('6'), name: 'A', description: 'a', typeId: H('a'), url: 'https://k.example/concepts/a', relations: [{ toGeoId: H('5'), propertyId: H('d') }] },
];

test('buildOps: one entity op per entity with its type and url value; deterministic relation ids', () => {
  const log = []; const ops = buildOps(fakeSdk(log), entities, geo());
  assert.equal(ops.length, 4);
  const ents = log.filter(([k]) => k === 'entity').map(([, p]) => p);
  assert.deepEqual(ents[0], { id: H('5'), name: 'Funding', description: 'd', types: [H('b')] });
  assert.deepEqual(ents[1].values, [{ property: H('3'), type: 'text', value: 'https://k.example/concepts/a' }]);
  const rels = log.filter(([k]) => k === 'relation').map(([, p]) => p);
  assert.deepEqual(rels[0], { id: derivedGeoId('kms:relation', `${H('5')}:${H('c')}:${H('4')}`), fromEntity: H('5'), toEntity: H('4'), type: H('c'), toSpace: H('e') });
  assert.equal(rels[1].toSpace, undefined);
});

test('publishEdit: personal space → publishEdit + one transaction', async () => {
  const log = [];
  const r = await publishEdit({ sdk: fakeSdk(log), accounts, privateKey: '0xkey', geo: geo('personal'), entities, name: 'run' });
  assert.deepEqual(r, { editId: 'e1', cid: 'ipfs://c1', txHash: '0xtx', proposed: false });
  const pe = log.find(([k]) => k === 'publishEdit')[1];
  assert.equal(pe.spaceId, H('1')); assert.equal(pe.author, H('2')); assert.equal(pe.name, 'run'); assert.equal(pe.ops.length, 4);
  assert.deepEqual(log.find(([k]) => k === 'send')[1], { to: '0xto', data: '0xdata' });
  assert.equal(log.filter(([k]) => k === 'send').length, 1);
});

test('publishEdit: DAO space → proposeEdit (FAST), proposed: true, never votes', async () => {
  const log = [];
  const r = await publishEdit({ sdk: fakeSdk(log), accounts, privateKey: '0xkey', geo: geo('dao'), entities, name: 'run' });
  assert.equal(r.proposed, true); assert.equal(r.editId, 'e2');
  const pp = log.find(([k]) => k === 'proposeEdit')[1];
  assert.equal(pp.daoSpaceId, H('1')); assert.equal(pp.callerSpaceId, H('2')); assert.equal(pp.votingMode, 'FAST');
  assert.equal(log.some(([k]) => k === 'publishEdit'), false);
});

test('loadGeoSdk: a missing package is a clear, actionable error', async () => {
  await assert.rejects(() => loadGeoSdk(async () => { throw new Error('Cannot find package'); }), /npm i -E @geoprotocol\/geo-sdk@0\.20\.3 viem/);
  await assert.rejects(() => loadGeoSdk(async () => { throw new Error('Cannot find package'); }), /Cannot find package/);
});
