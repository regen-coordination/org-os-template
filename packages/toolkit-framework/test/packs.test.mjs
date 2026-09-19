// packages/toolkit-framework/test/packs.test.mjs — extension packs: schema search path, entities, type lists.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSchema, listSchemas, validateObject, registerPack, resetPacks, registeredPacks } from '../src/index.mjs';

export function packDir(schemas = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fw-pack-'));
  mkdirSync(join(dir, 'schemas'), { recursive: true });
  for (const [name, body] of Object.entries(schemas)) writeFileSync(join(dir, 'schemas', `${name}.yaml`), body);
  return join(dir, 'schemas');
}
const WIDGET = 'id: widget\nversion: 0.1.0\nextends: frontmatter\nrequired: [title, size]\nfields:\n  size: { enum: [s, m, l] }\n';

beforeEach(() => resetPacks());

test('no packs: listSchemas and loadSchema behave as before', () => {
  assert.equal(registeredPacks().length, 0);
  assert.ok(listSchemas().includes('resource'));
  assert.ok(!listSchemas().includes('widget'));
  assert.throws(() => loadSchema('widget'), /schema not found: widget/);
});

test('registerPack adds its schema dir to the search path', () => {
  registerPack({ name: 'p1', schemaDir: packDir({ widget: WIDGET }) });
  assert.ok(listSchemas().includes('widget'));
  assert.equal(loadSchema('widget').id, 'widget');
  assert.equal(validateObject('widget', { title: 'W', type: 'widget', size: 'm' }).valid, true);
  assert.equal(validateObject('widget', { title: 'W', type: 'widget', size: 'xl' }).valid, false);
  assert.equal(validateObject('widget', { type: 'widget', size: 'm' }).valid, false, 'inherits frontmatter required: title');
});

test('a pack schema that collides with a core schema is a load error, never a shadow', () => {
  assert.throws(() => registerPack({ name: 'bad', schemaDir: packDir({ resource: WIDGET }) }), /pack schema "resource" \(bad\) collides with core/);
  assert.equal(registeredPacks().length, 0);
  assert.notEqual(loadSchema('resource').id, 'widget');
});

test('two packs cannot define the same schema', () => {
  registerPack({ name: 'p1', schemaDir: packDir({ widget: WIDGET }) });
  assert.throws(() => registerPack({ name: 'p2', schemaDir: packDir({ widget: WIDGET }) }), /pack schema "widget" \(p2\) collides with pack p1/);
});

test('registration is idempotent per pack name + dir, and refuses the same name from another dir', () => {
  const dir = packDir({ widget: WIDGET });
  registerPack({ name: 'p1', schemaDir: dir });
  registerPack({ name: 'p1', schemaDir: dir });
  assert.equal(registeredPacks().length, 1);
  assert.throws(() => registerPack({ name: 'p1', schemaDir: packDir({ gadget: WIDGET }) }), /pack "p1" is already registered/);
});

test('a missing schema dir and a missing name are errors', () => {
  assert.throws(() => registerPack({ name: 'p1', schemaDir: '/nonexistent/schemas' }), /schema dir not found/);
  assert.throws(() => registerPack({ schemaDir: packDir({ widget: WIDGET }) }), /name is required/);
});

test('the schema cache is cleared on register and on reset', () => {
  assert.throws(() => loadSchema('widget'));
  registerPack({ name: 'p1', schemaDir: packDir({ widget: WIDGET }) });
  assert.equal(loadSchema('widget').id, 'widget');
  resetPacks();
  assert.throws(() => loadSchema('widget'), /schema not found/);
});
