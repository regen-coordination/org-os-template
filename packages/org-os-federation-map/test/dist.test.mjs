import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'federation-map.iife.js');

test('committed standalone bundle exists, is self-contained, defines the element', () => {
  assert.ok(existsSync(dist), 'run `npm run build` in packages/org-os-federation-map');
  const src = readFileSync(dist, 'utf8');
  assert.ok(src.includes('federation-map'), 'defines the custom element');
  assert.ok(!/\bimport\s*\(\s*["'`]|\brequire\s*\(\s*["'`]/.test(src), 'nothing loaded at run time (map.css is inlined)');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'federation-map.iife.js' }));
});

// Replaces "d3-force is bundled, not imported": the house map has no physics (spec §5.2).
test('the bundle carries the house map: no d3, no torch, no ember', () => {
  const src = readFileSync(dist, 'utf8');
  assert.ok(!/d3-(force|dispatch|quadtree|timer)|forceSimulation|forceManyBody/.test(src), 'no d3');
  assert.ok(!/torch/i.test(src), 'no torch');
  assert.ok(!/\bember/i.test(src), 'no ember');
  assert.ok(src.includes('fm-canvas') && src.includes('fm-twin'), 'the static map and its list twin');
});

test('no colour literal outside the token block', () => {
  const src = readFileSync(dist, 'utf8');
  const block = /:host\{--[^}]*\}@media \(prefers-color-scheme: dark\)\{:host\{--[^}]*\}\}/;
  assert.match(src, block, 'the token block is bundled');
  const rest = src.replace(block, '');
  const hex = rest.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hex, [], 'no hex colour');
  assert.ok(!/\b(rgba?|hsla?|oklch|lab|lch)\(/.test(rest), 'no colour function');
});

// 2026-11-05 (PF-R118): the committed bundle names a node's link as src/ does — a link, never a portal
test('the bundle calls a node\'s vault link a link', () => {
  const src = readFileSync(dist, 'utf8');
  assert.ok(src.includes('"Obsidian link \\u2197"') && src.includes('"\\u2192 view inside"'));
  assert.ok(!/Obsidian portal|view inside \(portal\)/.test(src));
});
