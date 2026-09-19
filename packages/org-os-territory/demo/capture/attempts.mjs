// demo/capture/attempts.mjs — section 4: eleven ways to break the pack machinery, run for real. The `files` shown on the page are exactly
// the files written to a temp packages dir; the error is what the real loader threw. Each must fail and each must name the pack or the item.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadExtensions, loadPackConnectors, mergeConnectors, reset, expect, temp } from './env.mjs';

const WIDGET = (id) => `id: ${id}\nversion: 0.1.0\nextends: frontmatter\nrequired: [title]\nfields:\n  size: { type: string }\n`;
const PACK = (extra = '', types = '[]') => `name: bad-pack\nversion: 0.1.0\ntypes: ${types}\n${extra}`;
const CONN = (body) => ({ 'connectors/index.mjs': body });

const LIST = [
  { id: 'schema-core-collision', title: 'A pack schema named like a core schema', why: 'Core always wins — a pack can never shadow a core schema.',
    files: { 'pack.yaml': PACK('', '[resource]'), 'schemas/resource.yaml': WIDGET('resource') }, action: 'loadExtensions', expectErr: /pack schema "resource" \(bad-pack\) collides with core/ },
  { id: 'entity-core-collision', title: 'A pack entity named like a core entity', why: 'The frozen Layer-A set cannot be altered by a pack.',
    files: { 'pack.yaml': PACK(), 'extension-entities.yaml': 'entities:\n  place: { maps_to_core: concept }\n' }, action: 'loadExtensions', expectErr: /pack entity "place" \(bad-pack\) collides with core/ },
  { id: 'entity-bad-map', title: 'A pack entity that maps to a type that does not exist', why: 'Every pack entity must map to a real Layer-A type so a peer can downgrade it.',
    files: { 'pack.yaml': PACK(), 'extension-entities.yaml': 'entities:\n  widget: { maps_to_core: gizmo }\n' }, action: 'loadExtensions', expectErr: /pack entity "widget" \(bad-pack\): maps_to_core "gizmo" is not a core type/ },
  { id: 'connector-core-name', title: 'A pack connector named like a core connector', why: 'A pack cannot replace `atproto`. (The error names the connector but not the pack — a known gap.)', item: 'atproto',
    files: { 'pack.yaml': PACK(), ...CONN("export const CONNECTORS = { atproto: { name: 'atproto' } };\n") }, action: 'loadPackConnectors + mergeConnectors', connectors: true, expectErr: /pack connector "atproto" collides with core/ },
  { id: 'binding-core', title: 'A registry binding for a core schema', why: 'A pack may bind only its own schemas to registry files.',
    files: { 'pack.yaml': PACK(), 'profile/profile.yaml': 'registry_bindings:\n  resource: data/hijack.yaml\n' }, action: 'loadExtensions', expectErr: /pack binding for "resource" \(bad-pack\) collides with core/ },
  { id: 'type-no-schema', title: 'A publish-eligible type with no schema in the pack', why: 'Declared types must exist, or lexicon generation would fail later.',
    files: { 'pack.yaml': PACK('', '[gadget]'), 'schemas/widget.yaml': WIDGET('widget') }, action: 'loadExtensions', expectErr: /pack type "gadget" \(bad-pack\) has no schema in the pack/ },
  { id: 'missing-pack', title: 'kms.yaml names a pack that is not installed', why: 'An instance that declares a pack it cannot load does not start.', packName: 'nope',
    files: {}, action: 'loadExtensions', expectErr: /extension pack "nope" not found/ },
  { id: 'unmet-requires', title: 'A pack that needs a newer framework', why: '`requires` is checked against the installed framework and kms versions.',
    files: { 'pack.yaml': PACK('requires:\n  framework: ">=99.0.0"\n') }, action: 'loadExtensions', expectErr: /extension pack "bad-pack" requires framework >=99\.0\.0, found \d+\.\d+\.\d+/ },
  { id: 'path-traversal', title: 'A pack name that tries to leave the packages directory', why: 'Names are restricted to `[a-z0-9-]`; nothing is joined to a path first.', packName: '../evil',
    files: {}, action: 'loadExtensions', expectErr: /invalid extension pack name: "\.\.\/evil"/ },
  { id: 'unquoted-yaml', title: 'An unquoted `>=0.3.0` in pack.yaml', why: 'It is invalid YAML — and the error now names the file.',
    files: { 'pack.yaml': 'name: bad-pack\nrequires:\n  framework: >=0.3.0\n' }, action: 'loadExtensions', expectErr: /pack\.yaml/ },
  { id: 'connector-import-throws', title: 'A pack connector that throws when imported', why: 'The only pack code that runs is `connectors/index.mjs`; a failure names the pack.',
    files: { 'pack.yaml': PACK(), ...CONN("throw new Error('boom');\n") }, action: 'loadPackConnectors', connectors: true, expectErr: /extension pack "bad-pack": connectors\/index\.mjs failed to load: boom/ },
];

async function run(a, root) {
  reset();
  for (const [rel, text] of Object.entries(a.files)) { const p = join(root, 'bad-pack', rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); }
  try {
    const packs = loadExtensions({ extensions: [a.packName ?? 'bad-pack'] }, { packagesDir: root });
    if (a.connectors) mergeConnectors(await loadPackConnectors(packs));
    return null;
  } catch (e) { return e.message.split(root).join('<packages>'); }
}

export async function attempts() {
  const out = [];
  for (const a of LIST) {
    const root = temp('pk');
    const error = await run(a, root);
    expect(error !== null, `attempt "${a.id}" must fail`);
    expect(a.expectErr.test(error), `attempt "${a.id}" failed with an unexpected message: ${error}`);
    const namesPack = error.includes(a.packName ?? 'bad-pack');
    const namesItem = error.includes(a.item ?? a.packName ?? 'bad-pack');
    expect(namesPack || namesItem, `attempt "${a.id}" error names neither the pack nor the item`);
    out.push({ id: a.id, title: a.title, why: a.why, files: a.files, action: a.action, error, namesPack, namesItem });
  }
  return out;
}
