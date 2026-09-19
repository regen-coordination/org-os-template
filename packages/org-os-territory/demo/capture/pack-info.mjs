// demo/capture/pack-info.mjs — section 2: what loading the pack changes, measured by loading it through the real kms path.
import { fw, registryBindings, loadExtensions, validateKernel, reset, expect, AUTH } from './env.mjs';

const snap = () => ({
  schemas: fw.listSchemas(),
  layerBEntities: fw.extensionEntities(),
  optInTypes: fw.optInTypes(),
  bindings: registryBindings(),
  lexiconCount: Object.keys(fw.generateAll({ authority: AUTH })).length,
});
const missing = (after, before) => after.filter((x) => !before.includes(x));
const only = (after, before) => Object.fromEntries(Object.entries(after).filter(([k]) => !(k in before)));

export function packInfo() {
  reset();
  const coreA = JSON.stringify(fw.loadSchema('core-entities'));
  const none = snap();
  expect(!none.schemas.includes('territorial-unit') && none.lexiconCount === 12, 'baseline must be the 12 core lexicons and no pack schema');

  reset();
  const [pack] = loadExtensions({ extensions: ['org-os-territory'] });
  const t = snap();
  const added = {
    schemas: missing(t.schemas, none.schemas),
    entities: only(t.layerBEntities, none.layerBEntities),
    optInTypes: missing(t.optInTypes, none.optInTypes),
    bindings: only(t.bindings, none.bindings),
    lexicons: t.lexiconCount - none.lexiconCount,
  };
  const lexicon = fw.generateAll({ authority: AUTH })[`${AUTH}.territorialUnit`];
  const kernelValid = validateKernel().valid;
  const layerAUntouched = JSON.stringify(fw.loadSchema('core-entities')) === coreA;
  expect(added.schemas.length === 2 && added.optInTypes.length === 2 && added.lexicons === 2, 'the pack must add exactly two schemas, two opt-in types, two lexicons');
  expect(kernelValid && layerAUntouched, 'the kernel must stay valid and Layer A untouched');
  return { none, territory: { ...t, added, lexicon, manifest: pack.manifest, kernelValid, layerAUntouched } };
}
