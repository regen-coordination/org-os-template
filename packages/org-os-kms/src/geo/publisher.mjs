// packages/org-os-kms/src/geo/publisher.mjs — the only file that knows the Geo SDK's shapes. One edit per run.
// The SDK and viem are loaded from the INSTANCE at run time (not a dependency of this package).
// DAO spaces get a proposal (FAST voting mode) and are never voted on from here.
import { derivedGeoId } from './ids.mjs';

export async function loadGeoSdk(importer = (m) => import(m)) {
  try { return { sdk: await importer('@geoprotocol/geo-sdk'), accounts: await importer('viem/accounts') }; }
  catch { throw new Error('geo: @geoprotocol/geo-sdk is not installed in this instance — run: npm i -E @geoprotocol/geo-sdk@0.20.3 viem'); }
}

export function buildOps(sdk, entities, geo) {
  const ops = [];
  for (const e of entities) {
    const params = { id: e.geoId, name: e.name, description: e.description, types: [e.typeId] };
    if (e.url) params.values = [{ property: geo.urlProperty, value: e.url }];
    ops.push(...sdk.Ops.entities.create(params).ops);
    for (const r of e.relations) {
      const id = derivedGeoId('kms:relation', `${e.geoId}:${r.propertyId}:${r.toGeoId}`);   // re-sending upserts, never duplicates
      ops.push(...sdk.Ops.relations.create({ id, fromEntity: e.geoId, toEntity: r.toGeoId, type: r.propertyId, ...(r.toSpace ? { toSpace: r.toSpace } : {}) }).ops);
    }
  }
  return ops;
}

export async function publishEdit({ sdk, accounts, privateKey, geo, entities, name }) {
  const ops = buildOps(sdk, entities, geo);
  const network = sdk.GeoTestnetConfig;
  const signer = accounts.privateKeyToAccount(privateKey);
  const wallet = await sdk.createGeoWalletClient({ signer, network });
  const client = sdk.createGeoClient({ network });
  const proposed = geo.spaceKind === 'dao';
  const edit = proposed
    ? await client.daoSpaces.proposeEdit({ name, ops, author: geo.authorSpace, daoSpaceId: geo.space, callerSpaceId: geo.authorSpace, votingMode: 'FAST' })
    : await client.personalSpaces.publishEdit({ name, spaceId: geo.space, author: geo.authorSpace, ops });
  const txHash = await wallet.sendTransaction({ to: edit.to, data: edit.calldata });
  return { editId: edit.editId, cid: edit.cid, txHash, proposed };
}
