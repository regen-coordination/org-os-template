// packages/org-os-territory/test/entities.test.mjs — the pack's entity file parses to what it says (a flow-mapping description with commas must be quoted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const doc = yaml.load(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'extension-entities.yaml'), 'utf8'));

test('extension-entities: every entity carries exactly maps_to_core and a full-sentence description', () => {
  for (const [name, e] of Object.entries(doc.entities)) {
    assert.deepEqual(Object.keys(e).sort(), ['description', 'maps_to_core'], `${name}: stray keys mean the description was split on its commas`);
    assert.match(e.description, /\.$/, `${name}: the description must be a whole sentence`);
  }
  assert.match(doc.entities['territorial-unit'].description, /hydrological, custom\)\.$/);
});
