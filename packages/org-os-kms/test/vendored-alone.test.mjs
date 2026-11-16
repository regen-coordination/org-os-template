// test/vendored-alone.test.mjs — kms still runs vendored alone (spec §9, R-38): an instance that vendors only
// packages/toolkit-framework and packages/org-os-kms (docs/SETUP-PATHS.md) can import the CLI and the ops and
// run every verb that does not draw. The three surfaces that draw — `render map html`, `render pages --preview`
// and `publish` with publish.pages: true — load the map package only when asked, and say plainly when it is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KMS = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = join(KMS, '..');
const SIBLING = 'org-os-federation-map';

// The vendored layout: <root>/packages/{toolkit-framework,org-os-kms} and <root>/node_modules/js-yaml — no map package.
function vendor() {
  const root = mkdtempSync(join(tmpdir(), 'kms-vendored-'));
  const skip = (src) => !src.split(sep).some((p) => p === 'node_modules' || p === 'test');
  for (const p of ['toolkit-framework', 'org-os-kms']) cpSync(join(PACKAGES, p), join(root, 'packages', p), { recursive: true, filter: skip });
  const yamlDir = dirname(createRequire(join(KMS, 'src', 'map.mjs')).resolve('js-yaml/package.json'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(yamlDir, join(root, 'node_modules', 'js-yaml'), 'dir');
  assert.equal(existsSync(join(root, 'packages', SIBLING)), false);
  return root;
}
const load = (root, rel) => import(pathToFileURL(join(root, 'packages', 'org-os-kms', rel)).href);
const PLAIN = new RegExp(`needs the map package ${SIBLING}`);

test('vendored alone: the CLI, the ops and the static surface import without the map package', async () => {
  const root = vendor();
  const cli = await load(root, 'src/cli.mjs');
  const ops = await load(root, 'src/ops.mjs');
  await load(root, 'src/static/surface.mjs');
  assert.ok(ops.OPS.publish && ops.OPS['ingest.pull']);
  assert.deepEqual(cli.dispatch(['publish', '--dry'], { dry: true }), { verb: 'publish', args: [], flags: { dry: true } });
});

test('vendored alone: verbs that do not draw run as before (render map json, a static surface without pages)', async () => {
  const root = vendor();
  const { dispatch } = await load(root, 'src/cli.mjs');
  const inst = mkdtempSync(join(tmpdir(), 'kms-vendored-inst-'));
  writeFileSync(join(inst, 'federation.yaml'), 'identity:\n  name: example-dao-os\n  type: Project\ndownstream:\n  - id: hillside\n    name: Hillside Coop\n');
  const m = await dispatch(['render', 'map', '--dir', inst, '--out', 'out/map.json']);
  assert.equal(m.ok, true);
  assert.equal(JSON.parse(readFileSync(join(inst, 'out', 'map.json'), 'utf8')).nodes.length, 1);

  const { writeStaticSurface } = await load(root, 'src/static/surface.mjs');
  const r = await writeStaticSurface({ dir: inst, items: [], allItems: [], manifest: { version: 1, objects: {} }, config: { publish: { base_url: 'https://kc.example' } } });
  assert.ok(r.files.includes('api/index.json'));
  assert.equal(existsSync(join(inst, 'public', 'index.html')), false);
});

test('vendored alone: the three drawing surfaces say plainly that they need the map package', async () => {
  const root = vendor();
  const { dispatch } = await load(root, 'src/cli.mjs');
  const inst = mkdtempSync(join(tmpdir(), 'kms-vendored-draw-'));
  const html = await dispatch(['render', 'map', 'html', '--dir', inst]);
  assert.match(html.error, PLAIN);
  assert.doesNotMatch(html.error, /ERR_MODULE_NOT_FOUND|Cannot find module/);
  const pages = await dispatch(['render', 'pages', '--preview', '--dir', inst]);
  assert.match(pages.error, PLAIN);

  const { writeStaticSurface } = await load(root, 'src/static/surface.mjs');
  await assert.rejects(
    writeStaticSurface({ dir: inst, items: [], allItems: [], manifest: { version: 1, objects: {} }, config: { publish: { base_url: 'https://kc.example', pages: true } } }),
    (e) => PLAIN.test(e.message) && !/Cannot find module/.test(e.message),
  );
  // the failure comes before anything is written
  assert.equal(existsSync(join(inst, 'public')), false);
});
