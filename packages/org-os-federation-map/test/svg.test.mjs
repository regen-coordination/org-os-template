// test/svg.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMap } from '../src/parse.mjs';
import { buildLayout } from '../src/sim.mjs';
import { renderSVG } from '../src/svg.mjs';

const MAP = normalizeMap({
  self: { id: 'org-os', name: 'org-os' },
  nodes: [
    { id: 'peer-a', kind: 'instance', ring: 1, name: 'Peer A', live: true },
    { id: 'far-x', kind: 'frontier', ring: 2, name: 'Far X' },
    { id: 'src-y', kind: 'source', ring: 3, name: 'Src Y' },
  ],
  edges: [
    { from: 'org-os', to: 'peer-a', kind: 'downstream' },
    { from: 'peer-a', to: 'far-x', kind: 'frontier' },
  ],
});
const layout = buildLayout(MAP, { width: 800, height: 600 });

test('renders one <g class="node …"> per node incl. self, with data-id', () => {
  const svg = renderSVG(layout);
  assert.equal((svg.match(/class="node /g) || []).length, 4);
  for (const id of ['org-os', 'peer-a', 'far-x', 'src-y']) assert.ok(svg.includes(`data-id="${id}"`));
});

test('kind + ring classes drive torchlight falloff; frontier is an ember', () => {
  const svg = renderSVG(layout);
  assert.ok(svg.includes('node frontier ring-2'));
  assert.ok(svg.includes('node self ring-0'));
  assert.ok(svg.includes('class="torch-gradient"') || svg.includes('id="torch"'), 'torch radial gradient present');
});

test('renders one edge line per link with kind class + endpoint ids', () => {
  const svg = renderSVG(layout);
  assert.equal((svg.match(/class="edge /g) || []).length, 2);
  assert.ok(svg.includes('data-from="peer-a" data-to="far-x"'));
});

test('accessibility: role=img + label; escapes node names', () => {
  const m = normalizeMap({ self: { id: 's', name: 'a<b&"c"' }, nodes: [], edges: [] });
  const svg = renderSVG(buildLayout(m, { width: 100, height: 100 }));
  assert.ok(svg.includes('role="img"'));
  assert.ok(!svg.includes('a<b&"c"'), 'raw specials never emitted');
  assert.ok(svg.includes('a&lt;b&amp;&quot;c&quot;'));
});
