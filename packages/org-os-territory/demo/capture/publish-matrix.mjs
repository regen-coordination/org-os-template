// demo/capture/publish-matrix.mjs — section 3: the same sample data published five ways through the REAL publish op (fake PDS).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { reset, expect, AUTH, makeInstance, runPublish, tree, contextPackTypes } from './env.mjs';

const COMBOS = [
  { id: 'no-pack', label: 'No pack', pack: false, optIn: [] },
  { id: 'no-pack-optin', label: 'No pack, but an opt-in is listed', pack: false, optIn: ['territorial-unit'] },
  { id: 'pack-closed', label: 'Pack loaded, not opted in', pack: true, optIn: [] },
  { id: 'pack-units', label: 'Pack loaded, units opted in', pack: true, optIn: ['territorial-unit'] },
  { id: 'pack-units-streams', label: 'Pack loaded, units and streams opted in', pack: true, optIn: ['territorial-unit', 'data-stream'] },
];
const short = (c) => c.replace(`${AUTH}.`, '');

export async function publishMatrix() {
  const out = [];
  for (const c of COMBOS) {
    reset();
    const dir = makeInstance({ extensions: c.pack ? ['org-os-territory'] : null, optIn: c.optIn });
    const r = await runPublish(dir);
    const counts = {};
    for (const op of r.log) counts[op.collection] = (counts[op.collection] || 0) + 1;
    const files = r.error ? [] : tree(join(dir, 'public'));
    const unitOp = r.log.find((op) => op.collection === `${AUTH}.territorialUnit`);
    out.push({
      ...c, ok: r.ok, error: r.error,
      collections: Object.entries(counts).map(([collection, count]) => ({ collection, count })).sort((a, b) => a.collection.localeCompare(b.collection)),
      surfaceFiles: files.filter((f) => !/^api\/[^/]+\/[^/]+\.json$/.test(f)),
      perItemFiles: files.filter((f) => /^api\/[^/]+\/[^/]+\.json$/.test(f)).length,
      contextPackTypes: r.error ? [] : contextPackTypes(dir),
      hasExtensionsYaml: r.error ? false : existsSync(join(dir, 'public', '.well-known', 'extensions.yaml')),
      unitRecordKeys: unitOp ? Object.keys(unitOp.record).sort() : null,
    });
  }
  const by = Object.fromEntries(out.map((r) => [r.id, r]));
  const names = (r) => r.collections.map((x) => short(x.collection));
  expect(by['no-pack'].ok && names(by['no-pack']).join() === 'resource', 'no pack must publish the core resource only');
  expect(!by['no-pack-optin'].ok && /unknown publishable type: territorial-unit/.test(by['no-pack-optin'].error || ''), 'an opt-in for an unloaded pack type must be a hard error');
  expect(names(by['pack-closed']).join() === 'resource' && !by['pack-closed'].collections.some((x) => /territorialUnit|dataStream/.test(x.collection)), 'a loaded pack that is not opted in must publish nothing new');
  expect(names(by['pack-units']).join() === 'resource,territorialUnit', 'opting in units must publish the unit');
  expect(!by['pack-units'].unitRecordKeys.includes('notes'), 'the private notes field must not be published');
  expect(names(by['pack-units-streams']).join() === 'dataStream,resource,territorialUnit' && by['pack-units-streams'].collections.find((x) => x.collection.endsWith('dataStream')).count === 1, 'only the public stream must publish; the not-public-yet draft must be withheld');
  return out;
}
