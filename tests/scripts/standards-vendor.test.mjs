// tests/scripts/standards-vendor.test.mjs
//
// scripts/lib/standards-vendor.mjs: the set of files an instance carries so it can generate its own .well-known/
// (DAO-OS L8, Q56) — packages/admin/lib/standards/*.mjs less index.mjs and validate.mjs, plus the closure of their
// relative imports, mapped into scripts/lib/. Read-only against this checkout; the in-memory sources need no disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { ORG_ROOT } from '../helpers/repo-paths.mjs';
import {
  standardsVendorSet, importSpecifiers, diskSource, STANDARDS_SOURCE_DIR, STANDARDS_VENDOR_DIR,
} from '../../scripts/lib/standards-vendor.mjs';

/** An in-memory framework: { 'packages/admin/lib/x.mjs': text }. */
function memSource(files) {
  return {
    read: (rel) => files[rel] ?? null,
    list: (relDir) => Object.keys(files).filter((k) => k.startsWith(`${relDir}/`) && !k.slice(relDir.length + 1).includes('/')),
  };
}
const LIB = 'packages/admin/lib';

test('the real builder: every standards module but index.mjs and validate.mjs, and what they import', () => {
  const { files } = standardsVendorSet(diskSource(ORG_ROOT));
  const from = new Set(files.map((f) => f.from));
  const standardsDir = path.join(ORG_ROOT, STANDARDS_SOURCE_DIR, 'standards');
  for (const name of readdirSync(standardsDir).filter((n) => n.endsWith('.mjs'))) {
    const rel = `${STANDARDS_SOURCE_DIR}/standards/${name}`;
    if (name === 'index.mjs' || name === 'validate.mjs') assert.ok(!from.has(rel), `${rel} needs ajv; never vendored`);
    else assert.ok(from.has(rel), `${rel} is vendored`);
  }
  // The closure reaches beyond standards/ (visibility, caip, hats …) — not a vacuous set.
  assert.ok(files.some((f) => f.from === `${LIB}/visibility.mjs`));
  assert.ok(files.length > 12, `only ${files.length} files`);
  for (const f of files) {
    assert.equal(f.to, `${STANDARDS_VENDOR_DIR}/${f.from.slice(STANDARDS_SOURCE_DIR.length + 1)}`, 'the layout is kept');
  }
  assert.deepEqual(files.map((f) => f.to), [...files.map((f) => f.to)].sort(), 'sorted by target');
});

test('the real builder: closed under relative imports, and no package or built-in but load.mjs’s node:fs / node:path', () => {
  const source = diskSource(ORG_ROOT);
  const { files, externals } = standardsVendorSet(source);
  const vendored = new Set(files.map((f) => f.from));
  for (const f of files) {
    for (const spec of importSpecifiers(source.read(f.from))) {
      if (!spec.startsWith('.')) continue;
      const target = path.posix.join(path.posix.dirname(f.from), spec);
      assert.ok(vendored.has(target), `${f.from} imports ${spec}, which is not vendored`);
    }
  }
  assert.deepEqual(externals, [
    { file: 'standards/load.mjs', specifier: 'node:fs' },
    { file: 'standards/load.mjs', specifier: 'node:path' },
  ]);
});

test('no vendored file collides with a file the framework already has under scripts/lib/', () => {
  const { files } = standardsVendorSet(diskSource(ORG_ROOT));
  for (const f of files) assert.equal(existsSync(path.join(ORG_ROOT, f.to)), false, `${f.to} already exists in the framework`);
});

test('importSpecifiers reads multi-line imports, re-exports, bare and dynamic imports — and not prose', () => {
  const text = [
    "import {",
    "  a,",
    "  b,",
    "} from './a.mjs'",
    "export { c } from \"../c.mjs\";",
    "export * as d from './d.mjs'",
    "import './side.mjs'",
    "const e = await import('./e.mjs')",
    "// needs approvals from 'the council'",
    " * import x from './in-a-comment.mjs' (a JSDoc line)",
    "const s = `needs ${n} from the ${by}`",
    "export const F = 1",
    "import { a as again } from './a.mjs'",
  ].join('\n');
  assert.deepEqual(importSpecifiers(text), ['./a.mjs', '../c.mjs', './d.mjs', './side.mjs', './e.mjs']);
});

test('the closure follows imports transitively and maps them into scripts/lib/', () => {
  const { files, externals } = standardsVendorSet(memSource({
    [`${LIB}/standards/build.mjs`]: "import { x } from './project.mjs'\n",
    [`${LIB}/standards/load.mjs`]: "import { readFileSync } from 'node:fs'\nimport { join } from 'node:path'\nimport { r } from '../registries.mjs'\n",
    [`${LIB}/standards/project.mjs`]: "import { v } from '../visibility.mjs'\n",
    [`${LIB}/standards/index.mjs`]: "import Ajv from 'ajv'\n",
    [`${LIB}/standards/validate.mjs`]: "import Ajv from 'ajv'\n",
    [`${LIB}/standards/extra.mjs`]: 'export const E = 1\n',
    [`${LIB}/visibility.mjs`]: "import { k } from './keccak.mjs'\n",
    [`${LIB}/keccak.mjs`]: 'export const k = 1\n',
    [`${LIB}/registries.mjs`]: 'export const r = 1\n',
    [`${LIB}/unrelated.mjs`]: "import yaml from 'yaml'\n",
  }));
  assert.deepEqual(files.map((f) => f.to), [
    'scripts/lib/keccak.mjs', 'scripts/lib/registries.mjs',
    'scripts/lib/standards/build.mjs', 'scripts/lib/standards/extra.mjs', 'scripts/lib/standards/load.mjs',
    'scripts/lib/standards/project.mjs', 'scripts/lib/visibility.mjs',
  ]);
  assert.equal(files.find((f) => f.to === 'scripts/lib/visibility.mjs').from, `${LIB}/visibility.mjs`);
  assert.deepEqual(externals.map((e) => e.specifier), ['node:fs', 'node:path']);
});

test('a framework with no standards builder vendors nothing', () => {
  assert.deepEqual(standardsVendorSet(memSource({ [`${LIB}/visibility.mjs`]: '' })), { files: [], externals: [] });
});

test('it refuses what a vendored copy could not run', () => {
  const base = {
    [`${LIB}/standards/build.mjs`]: '',
    [`${LIB}/standards/load.mjs`]: "import { readFileSync } from 'node:fs'\n",
  };
  const cases = [
    [{ [`${LIB}/standards/build.mjs`]: "import yaml from 'js-yaml'\n" }, /"js-yaml".*no package/],
    [{ [`${LIB}/standards/build.mjs`]: "import { readFileSync } from 'node:fs'\n" }, /"node:fs".*only load\.mjs/],
    [{ [`${LIB}/standards/build.mjs`]: "import { s } from '../../../schemas/x.mjs'\n" }, /outside packages\/admin\/lib/],
    [{ [`${LIB}/standards/build.mjs`]: "import { s } from './gone.mjs'\n" }, /standards\/gone\.mjs, which the framework does not have/],
    [{ [`${LIB}/standards/build.mjs`]: "import { v } from './validate.mjs'\n" }, /needs ajv/],
    [{ [`${LIB}/standards/build.mjs`]: "import s from './schema.json'\n" }, /not a module/],
  ];
  for (const [patch, error] of cases) {
    assert.throws(() => standardsVendorSet(memSource({ ...base, ...patch })), error);
  }
});
