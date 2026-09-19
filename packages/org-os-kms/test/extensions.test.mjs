// packages/org-os-kms/test/extensions.test.mjs — kms.yaml `extensions:` resolves sibling packs and registers them before any op.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import * as fw from '../src/framework.mjs';
import { loadExtensions, loadPackConnectors } from '../src/extensions.mjs';
import { loadKmsConfig } from '../src/config.mjs';
import { mergeConnectors, CONNECTORS } from '../src/connectors/index.mjs';
import { REGISTRY_BINDINGS, registryBindings, registerRegistryBindings, resetRegistryBindings } from '../src/bind.mjs';
import { bridge } from '../src/registry-bridge.mjs';
import { OPS } from '../src/ops.mjs';
import { createAtprotoConnector } from '../src/atproto/connector.mjs';
import { writeStaticSurface } from '../src/static/surface.mjs';

const WIDGET = 'id: widget\nversion: 0.1.0\nextends: frontmatter\nrequired: [title]\nfields:\n  size: { type: string }\n';

export function makePack(packagesDir, name, { manifest = {}, schemas = { widget: WIDGET }, entities = { widget: { maps_to_core: 'artifact' } }, profile = null, connectors = null } = {}) {
  const dir = join(packagesDir, name);
  mkdirSync(join(dir, 'schemas'), { recursive: true });
  writeFileSync(join(dir, 'pack.yaml'), yaml.dump({ name, version: '0.1.0', types: Object.keys(schemas), ...manifest }));
  for (const [s, body] of Object.entries(schemas)) writeFileSync(join(dir, 'schemas', `${s}.yaml`), body);
  if (entities) writeFileSync(join(dir, 'extension-entities.yaml'), yaml.dump({ entities }));
  if (profile) { mkdirSync(join(dir, 'profile')); writeFileSync(join(dir, 'profile', 'profile.yaml'), yaml.dump(profile)); }
  if (connectors) { mkdirSync(join(dir, 'connectors')); writeFileSync(join(dir, 'connectors', 'index.mjs'), connectors); }
  return dir;
}
const pkgs = () => mkdtempSync(join(tmpdir(), 'kms-pkgs-'));

beforeEach(() => { fw.resetPacks(); resetRegistryBindings(); });

test('no extensions: nothing is registered and nothing is returned', () => {
  assert.deepEqual(loadExtensions({}), []);
  assert.deepEqual(loadExtensions({ extensions: [] }), []);
  assert.equal(fw.registeredPacks().length, 0);
});

test('a declared pack is resolved as a sibling dir and registered with the framework', () => {
  const p = pkgs(); makePack(p, 'pack-a');
  const packs = loadExtensions({ extensions: ['pack-a'] }, { packagesDir: p });
  assert.equal(packs.length, 1); assert.equal(packs[0].name, 'pack-a'); assert.equal(packs[0].manifest.version, '0.1.0');
  assert.ok(fw.listSchemas().includes('widget'));
  assert.ok(fw.optInTypes().includes('widget'));
  assert.equal(fw.extensionEntities().widget.maps_to_core, 'artifact');
});

test('a missing pack is a hard error that names it', () => {
  assert.throws(() => loadExtensions({ extensions: ['nope'] }, { packagesDir: pkgs() }), /extension pack "nope" not found/);
});

test('extensions must be a list of plain package names', () => {
  assert.throws(() => loadExtensions({ extensions: 'pack-a' }), /kms\.yaml: "extensions" must be a list/);
  assert.throws(() => loadExtensions({ extensions: ['../evil'] }, { packagesDir: pkgs() }), /invalid extension pack name/);
});

test('pack.yaml must exist and carry the directory\'s own name', () => {
  const p = pkgs(); mkdirSync(join(p, 'bare'));
  assert.throws(() => loadExtensions({ extensions: ['bare'] }, { packagesDir: p }), /extension pack "bare": pack\.yaml not found/);
  const q = pkgs(); makePack(q, 'pack-a', { manifest: { name: 'other' } });
  assert.throws(() => loadExtensions({ extensions: ['pack-a'] }, { packagesDir: q }), /pack\.yaml name "other" does not match/);
});

test('requires: an unmet floor states required vs found; an unsupported range is refused', () => {
  const p = pkgs(); makePack(p, 'pack-a', { manifest: { requires: { framework: '>=99.0.0' } } });
  assert.throws(() => loadExtensions({ extensions: ['pack-a'] }, { packagesDir: p }), /extension pack "pack-a" requires framework >=99\.0\.0, found \d+\.\d+\.\d+/);
  const q = pkgs(); makePack(q, 'pack-a', { manifest: { requires: { kms: '^1.0.0' } } });
  assert.throws(() => loadExtensions({ extensions: ['pack-a'] }, { packagesDir: q }), /unsupported requires range "\^1\.0\.0"/);
  const r = pkgs(); makePack(r, 'pack-a', { manifest: { requires: { framework: '>=0.3.0', kms: '>=0.0.1' } } });
  assert.equal(loadExtensions({ extensions: ['pack-a'] }, { packagesDir: r }).length, 1);
});

test('a framework registration failure surfaces with the pack named (collision with core)', () => {
  const p = pkgs(); makePack(p, 'pack-a', { schemas: { resource: WIDGET }, entities: null });
  assert.throws(() => loadExtensions({ extensions: ['pack-a'] }, { packagesDir: p }), /pack schema "resource" \(pack-a\) collides with core/);
  assert.equal(fw.registeredPacks().length, 0);
});

test('loadKmsConfig loads extensions and exposes config.packs; without the key both are empty', () => {
  const p = pkgs(); makePack(p, 'pack-a');
  const inst = mkdtempSync(join(tmpdir(), 'kms-inst-'));
  writeFileSync(join(inst, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', extensions: ['pack-a'] }));
  const cfg = loadKmsConfig(inst, { packagesDir: p });
  assert.deepEqual(cfg.extensions, ['pack-a']); assert.equal(cfg.packs[0].name, 'pack-a');
  loadKmsConfig(inst, { packagesDir: p }); // twice in one process: idempotent
  assert.equal(fw.registeredPacks().length, 1);

  fw.resetPacks();
  const bare = mkdtempSync(join(tmpdir(), 'kms-inst-'));
  writeFileSync(join(bare, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.' }));
  const c2 = loadKmsConfig(bare);
  assert.deepEqual(c2.extensions, []); assert.deepEqual(c2.packs, []);
  assert.equal(fw.registeredPacks().length, 0);
});

test('loadPackConnectors imports each pack\'s connectors/index.mjs; packs cannot share a connector name', async () => {
  const src = (n) => `export const CONNECTORS = { '${n}': { name: '${n}', describe: () => ({}), pull: async () => ({ records: [], cursor: null }), map: () => [] } };\n`;
  const p = pkgs(); makePack(p, 'pack-a', { connectors: src('alpha') }); makePack(p, 'pack-b', { schemas: { gadget: WIDGET.replace('widget', 'gadget') }, entities: { gadget: { maps_to_core: 'artifact' } } });
  const packs = loadExtensions({ extensions: ['pack-a', 'pack-b'] }, { packagesDir: p });
  const c = await loadPackConnectors(packs);
  assert.deepEqual(Object.keys(c), ['alpha']);
  assert.deepEqual(await loadPackConnectors([]), {});

  fw.resetPacks();
  const q = pkgs(); makePack(q, 'pack-a', { connectors: src('alpha') });
  makePack(q, 'pack-b', { schemas: { gadget: WIDGET.replace('widget', 'gadget') }, entities: { gadget: { maps_to_core: 'artifact' } }, connectors: src('alpha') });
  const both = loadExtensions({ extensions: ['pack-a', 'pack-b'] }, { packagesDir: q });
  await assert.rejects(() => loadPackConnectors(both), /pack connector "alpha" \(pack-b\) collides with pack pack-a/);
});

test('mergeConnectors: pack connectors join the registry; a core name is a load error', () => {
  const alpha = { name: 'alpha' };
  const reg = mergeConnectors({ alpha });
  assert.equal(reg.alpha, alpha); assert.equal(reg.atproto, CONNECTORS.atproto);
  assert.deepEqual(mergeConnectors(), CONNECTORS);
  assert.throws(() => mergeConnectors({ atproto: alpha }), /pack connector "atproto" collides with core/);
});

test('registry bindings: packs add their own; a core schema cannot be rebound; two packs cannot bind one schema', () => {
  assert.deepEqual(registryBindings(), REGISTRY_BINDINGS);
  registerRegistryBindings('pack-a', { widget: 'data/widgets.yaml' });
  registerRegistryBindings('pack-a', { widget: 'data/widgets.yaml' }); // idempotent
  assert.equal(registryBindings().widget, 'data/widgets.yaml');
  assert.equal(REGISTRY_BINDINGS.widget, undefined, 'the core constant is never mutated');
  assert.throws(() => registerRegistryBindings('pack-b', { resource: 'data/x.yaml' }), /pack binding for "resource" \(pack-b\) collides with core/);
  assert.throws(() => registerRegistryBindings('pack-b', { widget: 'data/y.yaml' }), /pack binding for "widget" \(pack-b\) collides with pack pack-a/);
});

test('loadExtensions registers the profile\'s registry_bindings, and bridge writes the pack registry', () => {
  const p = pkgs(); makePack(p, 'pack-a', { profile: { registry_bindings: { widget: 'data/widgets.yaml' } } });
  const inst = mkdtempSync(join(tmpdir(), 'kms-inst-'));
  mkdirSync(join(inst, 'data', 'kb'), { recursive: true });
  writeFileSync(join(inst, 'data', 'kb', 'widget.yaml'), yaml.dump({ entries: { w: { title: 'W one', type: 'widget', size: 'm' } } }));
  writeFileSync(join(inst, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', extensions: ['pack-a'] }));
  const config = loadKmsConfig(inst, { packagesDir: p });
  const res = bridge({ dir: inst, config });
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.ok(!res.report.skipped.includes('widget'));
  assert.ok(existsSync(join(inst, 'data', 'widgets.yaml')));
  assert.match(readFileSync(join(inst, 'data', 'widgets.yaml'), 'utf8'), /W one/);
});

test('ingest.pull reaches a pack connector by name', async () => {
  const src = "export const CONNECTORS = { alpha: { name: 'alpha', protocol: 'test', capabilities: { ingest: true },\n" +
    "  describe: () => ({ title: 'Alpha source', type: 'dataset', steward: 's', return_path: 'r' }),\n" +
    "  pull: async () => ({ records: [{ n: 1 }], cursor: 'c1', retracted: [], errors: [] }),\n" +
    "  map: () => [{ schema: 'widget', object: { title: 'From alpha', type: 'widget', sourceUri: 'https://alpha.example/1' } }] } };\n";
  const p = pkgs(); makePack(p, 'pack-a', { connectors: src });
  const inst = mkdtempSync(join(tmpdir(), 'kms-inst-'));
  mkdirSync(join(inst, 'data', 'kb'), { recursive: true });
  writeFileSync(join(inst, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', extensions: ['pack-a'], connectors: [{ name: 'alpha', config: {} }] }));
  const config = loadKmsConfig(inst, { packagesDir: p });
  const res = await OPS['ingest.pull'].run({ dir: inst, config, flags: {} });
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.equal(res.report.failed, 0);
  assert.equal(res.report.connectors[0].status, 'ok', JSON.stringify(res.report.connectors[0]));
  assert.equal(res.report.connectors[0].stored, 1);
});

const AUTH = 'org.example.kb';
function fakePds(collectionsAsked) {
  return () => ({
    async getLatestCommit() { return { rev: 'r1' }; },
    async listAllRecords({ collection }) {
      collectionsAsked.push(collection);
      return collection === `${AUTH}.widget` ? [{ uri: `at://did:plc:peer/${AUTH}.widget/1`, value: { $type: `${AUTH}.widget`, title: 'Peer widget', type: 'widget', notes: 'private' } }] : [];
    },
  });
}

test('atproto connector: a loaded pack\'s collection is listed and mapped; without the pack it is never requested', async () => {
  const cfg = { peers: ['did:plc:peer'], pds: 'https://pds.test', nsid_authority: AUTH, self: 'did:plc:me' };
  const asked0 = []; const c0 = createAtprotoConnector({ createClient: fakePds(asked0) });
  await c0.pull(cfg, { cursor: null });
  assert.ok(!asked0.includes(`${AUTH}.widget`));
  assert.equal(asked0.length, 12);

  const p = pkgs(); makePack(p, 'pack-a');
  loadExtensions({ extensions: ['pack-a'] }, { packagesDir: p });
  const asked1 = []; const c1 = createAtprotoConnector({ createClient: fakePds(asked1) });
  const { records } = await c1.pull(cfg, { cursor: null });
  assert.ok(asked1.includes(`${AUTH}.widget`)); assert.equal(asked1.length, 13);
  const mapped = c1.map(records[0], cfg);
  assert.equal(mapped[0].schema, 'widget');
  assert.equal(mapped[0].object.notes, undefined, 'inbound pack records go through the same projection');
  assert.equal(mapped[0].object.sourceUri, `at://did:plc:peer/${AUTH}.widget/1`);
});

function surfaceInstance(extra = {}) {
  const inst = mkdtempSync(join(tmpdir(), 'kms-inst-'));
  writeFileSync(join(inst, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', publish: { base_url: 'https://t.example' }, ...extra }));
  return inst;
}

test('static surface: extensions.yaml is written for an instance with packs, and federateCheck accepts it', () => {
  const p = pkgs(); makePack(p, 'pack-a');
  const inst = surfaceInstance({ extensions: ['pack-a'] });
  const config = loadKmsConfig(inst, { packagesDir: p });
  const { files } = writeStaticSurface({ dir: inst, items: [], manifest: { objects: {} }, config });
  assert.ok(files.includes('.well-known/extensions.yaml'));
  const path = join(inst, 'public', '.well-known', 'extensions.yaml');
  const doc = yaml.load(readFileSync(path, 'utf8'));
  assert.equal(doc.entities.widget.maps_to_core, 'artifact');
  assert.ok(doc.entities.resource, 'core Layer-B entities are included');
  const check = fw.federateCheck({ extensionsPath: path });
  assert.ok(check.compatible.includes('widget')); assert.deepEqual(check.incompatible, []);
  const ctx = JSON.parse(readFileSync(join(inst, 'public', 'api', 'context.jsonld'), 'utf8'));
  assert.ok(ctx['@context'].widget, 'its own pack vocabulary is in its context');
});

test('static surface: an instance without packs writes no extensions.yaml — even if another instance registered one in this process', () => {
  const p = pkgs(); makePack(p, 'pack-a');
  loadExtensions({ extensions: ['pack-a'] }, { packagesDir: p }); // some other instance, same process
  const inst = surfaceInstance();
  const stale = join(inst, 'public', '.well-known', 'extensions.yaml');
  mkdirSync(join(inst, 'public', '.well-known'), { recursive: true }); writeFileSync(stale, 'entities: {}\n'); // left by an earlier run with packs
  const config = loadKmsConfig(inst);
  const { files } = writeStaticSurface({ dir: inst, items: [], manifest: { objects: {} }, config });
  assert.deepEqual(files.sort(), ['.well-known/knowledge.json', 'api/context.jsonld', 'api/index.json']);
  assert.ok(!existsSync(stale), 'a stale public extensions.yaml is dropped when the instance has no packs');
  assert.ok(existsSync(join(inst, 'public', '.well-known', 'knowledge.json')));
  const ctx = JSON.parse(readFileSync(join(inst, 'public', 'api', 'context.jsonld'), 'utf8'));
  assert.equal(ctx['@context'].widget, undefined, "another instance's pack never reaches this instance's context");
});

test('a malformed pack.yaml error names the file', () => {
  const p = pkgs(); const dir = makePack(p, 'pack-a');
  writeFileSync(join(dir, 'pack.yaml'), 'name: pack-a\nrequires:\n  framework: >=0.3.0\n');
  assert.throws(() => loadExtensions({ extensions: ['pack-a'] }, { packagesDir: p }), /pack\.yaml/);
});

test('a pack whose connectors/index.mjs throws on import is a hard error naming the pack', async () => {
  const p = pkgs(); makePack(p, 'pack-a', { connectors: "throw new Error('boom');\n" });
  const packs = loadExtensions({ extensions: ['pack-a'] }, { packagesDir: p });
  await assert.rejects(() => loadPackConnectors(packs), /extension pack "pack-a": connectors\/index\.mjs failed to load: boom/);
});
