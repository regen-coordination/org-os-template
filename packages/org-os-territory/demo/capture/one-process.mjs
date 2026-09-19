// demo/capture/one-process.mjs — section 3, second panel: the defect the whole-branch review caught. One process, two instances: the
// pack-less one must not publish the other's pack vocabulary. Deliberately does NOT reset between the two publishes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fw, reset, expect, yaml, PACK_TYPES, makeInstance, runPublish, contextPackTypes } from './env.mjs';

const extYaml = (dir) => existsSync(join(dir, 'public', '.well-known', 'extensions.yaml'));
const packTypesOf = (ctx) => Object.keys(ctx['@context']).filter((k) => PACK_TYPES.includes(k));

export async function oneProcess() {
  reset();
  const A = makeInstance({ extensions: ['org-os-territory'], optIn: ['territorial-unit'] });
  const rA = await runPublish(A);
  const B = makeInstance({}); // no extensions; the process registry still holds A's pack
  const rB = await runPublish(B);
  expect(rA.ok && rB.ok, 'both instances must publish');
  const registeredPacks = fw.registeredPacks().map((p) => p.name);
  expect(registeredPacks.includes('org-os-territory'), 'the process must still hold the pack, or this scenario proves nothing');
  const withPack = { contextTypes: contextPackTypes(A), hasExtensionsYaml: extYaml(A) };
  const packless = { contextTypes: contextPackTypes(B), hasExtensionsYaml: extYaml(B) };
  expect(withPack.contextTypes.length === 2 && withPack.hasExtensionsYaml, 'the instance with the pack must publish its vocabulary and extensions.yaml');
  expect(packless.contextTypes.length === 0 && !packless.hasExtensionsYaml, "the pack-less instance must publish none of the other instance's pack vocabulary");
  // The call the static surface made before the fix (unfiltered, process-wide) versus the one it makes now (this instance's packs).
  const surfaceUsedToCall = { unfiltered: packTypesOf(fw.toJsonLdContext()), filtered: packTypesOf(fw.toJsonLdContext(undefined, { packs: [] })) };
  expect(surfaceUsedToCall.unfiltered.length === 2 && surfaceUsedToCall.filtered.length === 0, 'the unfiltered call must show the leak and the filtered call must not');

  // A stale extensions.yaml is removed when an instance drops its packs.
  reset();
  const C = makeInstance({ extensions: ['org-os-territory'] });
  await runPublish(C);
  const before = extYaml(C);
  const cfgPath = join(C, 'kms.yaml');
  const cfg = yaml.load(readFileSync(cfgPath, 'utf8')); delete cfg.extensions;
  writeFileSync(cfgPath, yaml.dump(cfg));
  reset();
  const rC = await runPublish(C);
  const after = extYaml(C);
  expect(rC.ok && before && !after, 'a stale extensions.yaml must be removed once the instance drops its packs');
  return { registeredPacks, withPack, packless, surfaceUsedToCall, stale: { before, after } };
}
