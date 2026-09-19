// demo/capture/federation.mjs — section 6: what a peer sees. The published extensions.yaml and federateCheck; the collections a peer
// requests with and without the pack; and how an inbound pack record is projected (fake PDS, no network).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fw, loadExtensions, createAtprotoConnector, reset, expect, AUTH, makeInstance, runPublish } from './env.mjs';

const CFG = { peers: ['did:plc:peer'], pds: 'https://pds.invalid', nsid_authority: AUTH, self: 'did:plc:demo' };
const short = (c) => c.replace(`${AUTH}.`, '');

async function peerAsks(withPack) {
  reset();
  if (withPack) loadExtensions({ extensions: ['org-os-territory'] });
  const asked = [];
  const createClient = () => ({ async getLatestCommit() { return { rev: 'r1' }; }, async listAllRecords({ collection }) { asked.push(collection); return []; } });
  await createAtprotoConnector({ createClient }).pull(CFG, { cursor: null });
  return asked.map(short);
}

function inbound(withPack) {
  reset();
  if (withPack) loadExtensions({ extensions: ['org-os-territory'] });
  const record = { uri: `at://did:plc:peer/${AUTH}.territorialUnit/1`, value: { $type: `${AUTH}.territorialUnit`, title: 'Plana de Vic (example unit)', type: 'territorial-unit', unit_id: 'landscape:unit:plana-de-vic', layer: 'landscape', level: 'unit', notes: 'a peer private note' } };
  return createAtprotoConnector({ createClient: () => ({}) }).map(record, CFG);
}

export async function federation() {
  reset();
  const dir = makeInstance({ extensions: ['org-os-territory'], optIn: ['territorial-unit'] });
  expect((await runPublish(dir)).ok, 'the instance with the pack must publish');
  const extPath = join(dir, 'public', '.well-known', 'extensions.yaml');
  const federateCheck = fw.federateCheck({ extensionsPath: extPath });
  expect(federateCheck.incompatible.length === 0 && federateCheck.compatible.includes('territorial-unit'), 'a peer must find the published extensions compatible');

  const withAsked = await peerAsks(true); const withoutAsked = await peerAsks(false);
  const extra = withAsked.filter((c) => !withoutAsked.includes(c));
  expect(withAsked.length === 14 && withoutAsked.length === 12 && extra.join() === 'territorialUnit,dataStream', 'a peer with the pack must ask for exactly the two extra collections');

  const mappedWith = inbound(true); const mappedWithout = inbound(false);
  expect(mappedWith.length === 1 && mappedWith[0].schema === 'territorial-unit' && !('notes' in mappedWith[0].object) && mappedWithout.length === 0, 'an inbound pack record must be projected with the pack and dropped without it');
  return {
    extensionsYaml: readFileSync(extPath, 'utf8'), federateCheck,
    peer: { withPack: { count: withAsked.length, extra }, without: { count: withoutAsked.length } },
    inbound: { withPack: { schema: mappedWith[0].schema, keys: Object.keys(mappedWith[0].object).sort() }, withoutPack: { mapped: mappedWithout.length } },
  };
}
