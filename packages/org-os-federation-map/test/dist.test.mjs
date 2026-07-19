import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'federation-map.iife.js');

test('committed standalone bundle exists, is self-contained, defines the element', () => {
  assert.ok(existsSync(dist), 'run `npm run build` in packages/org-os-federation-map');
  const src = readFileSync(dist, 'utf8');
  assert.ok(src.includes('federation-map'), 'defines the custom element');
  assert.ok(!src.includes('from"d3-force"') && !src.includes("from'd3-force'"), 'd3-force is bundled, not imported');
});
