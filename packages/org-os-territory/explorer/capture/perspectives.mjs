// explorer/capture/perspectives.mjs — who sees what. For each share mode the FULL sample is published through the REAL publish op to a fake
// PDS, and exactly those records are served back to the REAL atproto connector (pull, then map) as a peer with the pack and as one without.
import { loadExtensions, createAtprotoConnector, reset, expect, AUTH, makeInstance, runPublish } from '../../demo/capture/env.mjs';
import { EXPLORER_INSTANCE_DATA, DRAFT_STREAM, PRIVATE_FIELD, PRIVATE_VALUE, idOf } from '../sample-extra.mjs';

export const MODES = [
  { id: 'nothing', optIn: [] },
  { id: 'units', optIn: ['territorial-unit'] },
  { id: 'units-streams', optIn: ['territorial-unit', 'data-stream'] },
];
const PUBLISHER = 'did:plc:demo';
const PEER_CFG = { peers: [PUBLISHER], pds: 'https://pds.invalid', nsid_authority: AUTH, self: 'did:plc:reader' };
const KIND = { 'territorial-unit': 'units', 'data-stream': 'streams', resource: 'resources' };
/** Nothing on the wire — any record, any field — may carry the private note's text or the draft stream's title. */
const leakCheck = (value, where) => {
  const text = JSON.stringify(value);
  expect(!text.includes(PRIVATE_VALUE), `the private note's text must never leave (${where})`);
  expect(!text.includes(DRAFT_STREAM.title), `the draft stream must never leave (${where})`);
};
const empty = () => ({ units: [], streams: [], resources: [], fields: {} });

function sort(objects) {
  const out = empty();
  for (const { schema, object } of objects) {
    const kind = KIND[schema];
    expect(kind, `unexpected type on the wire: ${schema}`);
    out[kind].push(idOf(object));
    out.fields[kind] = [...new Set([...(out.fields[kind] || []), ...Object.keys(object)])].sort();
  }
  return out;
}

async function receive(log, withPack) {
  reset();
  if (withPack) loadExtensions({ extensions: ['org-os-territory'] });
  const createClient = () => ({
    async getLatestCommit() { return { rev: 'r1' }; },
    async listAllRecords({ collection }) { return log.filter((op) => op.collection === collection).map((op) => ({ uri: `at://${PUBLISHER}/${op.collection}/${op.rkey}`, value: op.record })); },
  });
  const connector = createAtprotoConnector({ createClient });
  const pulled = await connector.pull(PEER_CFG, { cursor: null });
  expect(pulled.errors.length === 0, `the peer pull must not error: ${JSON.stringify(pulled.errors)}`);
  const objects = pulled.records.flatMap((r) => connector.map(r, PEER_CFG));
  leakCheck(objects, 'received by a peer');
  return sort(objects);
}

export async function perspectives() {
  const all = Object.values(EXPLORER_INSTANCE_DATA).flatMap((e) => Object.values(e)).map(idOf);
  expect(new Set(all).size === all.length, 'sample identities (unit_id / title) must be unique');
  const modes = {};
  for (const m of MODES) {
    reset();
    const r = await runPublish(makeInstance({ extensions: ['org-os-territory'], optIn: m.optIn, data: EXPLORER_INSTANCE_DATA }));
    expect(r.ok, `publishing in mode "${m.id}" must succeed: ${r.error}`);
    leakCheck(r.log.map((op) => op.record), `published, mode ${m.id}`);
    const typeOf = (op) => op.record.type;
    const published = sort(r.log.map((op) => ({ schema: typeOf(op), object: op.record })));
    const peerWithPack = await receive(r.log, true);
    const peerWithout = await receive(r.log, false);
    for (const side of [published, peerWithPack, peerWithout]) {
      expect(!side.streams.includes(DRAFT_STREAM.title), `the draft stream must never leave (mode ${m.id})`);
      expect(!Object.values(side.fields).flat().includes(PRIVATE_FIELD), `the private "${PRIVATE_FIELD}" field must never leave (mode ${m.id})`);
    }
    expect(peerWithout.units.length === 0 && peerWithout.streams.length === 0, 'a peer without the pack must receive no pack type');
    for (const k of ['units', 'streams', 'resources']) expect(peerWithPack[k].every((id) => published[k].includes(id)), `a peer must not receive an unpublished ${k} record`);
    modes[m.id] = { published, peerWithPack, peerWithout };
  }
  expect(modes.nothing.published.units.length === 0 && modes.nothing.published.streams.length === 0, 'sharing nothing must publish no pack type');
  expect(modes.units.published.units.length > 0 && modes.units.published.streams.length === 0, 'sharing units must publish units and no streams');
  expect(modes['units-streams'].published.streams.length > 0, 'sharing units + streams must publish the public streams');
  const resourceRefsTravel = (modes.nothing.peerWithout.fields.resources || []).includes('unit_refs');
  return { modes, neverLeaves: { streams: [DRAFT_STREAM.title], fields: [PRIVATE_FIELD] }, resourceRefsTravel };
}
