// packages/toolkit-framework/test/packs.test.mjs — extension packs: schema search path, entities, type lists.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSchema, listSchemas, validateObject, registerPack, resetPacks, registeredPacks, validateKernel, toJsonLdContext, extensionEntities } from '../src/index.mjs';

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

const GOOD = { widget: { maps_to_core: 'artifact', description: 'A widget.' } };

test('pack entities are folded into the kernel and the JSON-LD context', () => {
  registerPack({ name: 'p1', schemaDir: packDir({ widget: WIDGET }), entities: GOOD });
  assert.equal(validateKernel().valid, true);
  assert.equal(toJsonLdContext()['@context'].widget, 'https://regen-commons.org/ns/widget');
  assert.equal(extensionEntities().widget.maps_to_core, 'artifact');
  assert.ok(extensionEntities().resource, 'core Layer-B entities are still there');
});

test('no packs: the context and the entity set carry no pack names', () => {
  assert.equal(toJsonLdContext()['@context'].widget, undefined);
  assert.equal(extensionEntities().widget, undefined);
});

test('an entity that does not map to a real Layer-A type refuses to load', () => {
  assert.throws(() => registerPack({ name: 'bad', entities: { widget: { maps_to_core: 'gizmo' } } }), /pack entity "widget" \(bad\): maps_to_core "gizmo" is not a core type/);
  assert.throws(() => registerPack({ name: 'bad', entities: { widget: {} } }), /is not a core type/);
  assert.equal(registeredPacks().length, 0);
});

test('an entity named like a core or Layer-B type, or like another pack\'s, is a load error', () => {
  assert.throws(() => registerPack({ name: 'bad', entities: { place: { maps_to_core: 'concept' } } }), /pack entity "place" \(bad\) collides with core/);
  assert.throws(() => registerPack({ name: 'bad', entities: { resource: { maps_to_core: 'artifact' } } }), /pack entity "resource" \(bad\) collides with core/);
  registerPack({ name: 'p1', entities: GOOD });
  assert.throws(() => registerPack({ name: 'p2', entities: GOOD }), /pack entity "widget" \(p2\) collides with pack p1/);
});

test('extensionEntities({ packs }) keeps only the named packs', () => {
  registerPack({ name: 'p1', entities: GOOD });
  registerPack({ name: 'p2', entities: { gadget: { maps_to_core: 'artifact' } } });
  const only = extensionEntities({ packs: ['p2'] });
  assert.ok(only.gadget); assert.equal(only.widget, undefined); assert.ok(only.resource);
});

import { PUBLISHABLE_TYPES, OPT_IN_TYPES, ALL_TYPES, optInTypes, allTypes, publishableTypes, isPublishable } from '../src/publishable.mjs';
import { nsidFor, typeForNsid, generateAll } from '../src/lexicon.mjs';

const AUTH = 'org.example.kb';
const reg = () => registerPack({ name: 'p1', schemaDir: packDir({ widget: WIDGET }), entities: GOOD, types: ['widget'] });

test('pack types join the opt-in set only; the frozen constants never change', () => {
  reg();
  assert.ok(optInTypes().includes('widget'));
  assert.ok(allTypes().includes('widget'));
  assert.ok(!PUBLISHABLE_TYPES.includes('widget'));
  assert.deepEqual(OPT_IN_TYPES, ['source-system', 'public-use-boundary']);
  assert.equal(ALL_TYPES.length, 12);
});

test('a pack type does not publish until the instance opts in — and does once it has', () => {
  reg();
  const obj = { title: 'W', type: 'widget', size: 'm', public_use: 'ok-with-caveat' };
  assert.ok(!publishableTypes({}).includes('widget'));
  assert.equal(isPublishable(obj, { schema: 'widget', types: publishableTypes({}) }), false);
  const cfg = { publish: { types_opt_in: ['widget'] } };
  assert.ok(publishableTypes(cfg).includes('widget'));
  assert.equal(isPublishable(obj, { schema: 'widget', types: publishableTypes(cfg) }), true);
});

test('no packs: opting in to an unknown type is still an error, and the lists are the core lists', () => {
  assert.throws(() => publishableTypes({ publish: { types_opt_in: ['widget'] } }), /unknown publishable type: widget/);
  assert.deepEqual(allTypes(), [...ALL_TYPES]);
  assert.equal(Object.keys(generateAll({ authority: AUTH })).length, 12);
});

test('lexicons: a pack type resolves by NSID and gets a generated lexicon', () => {
  reg();
  assert.equal(typeForNsid(nsidFor('widget', AUTH), AUTH), 'widget');
  const docs = generateAll({ authority: AUTH });
  assert.equal(Object.keys(docs).length, 13);
  const doc = docs[`${AUTH}.widget`];
  assert.deepEqual(doc.defs.main.record.properties.size, { type: 'string', knownValues: ['s', 'm', 'l'] });
  assert.ok(doc.defs.main.record.required.includes('size') && doc.defs.main.record.required.includes('title'));
});

test('a pack type must have a schema in that pack', () => {
  assert.throws(() => registerPack({ name: 'bad', schemaDir: packDir({ widget: WIDGET }), types: ['gadget'] }), /pack type "gadget" \(bad\) has no schema in the pack/);
});
