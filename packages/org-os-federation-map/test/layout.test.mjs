// test/layout.test.mjs — the house map's layered layout (spec §5.1, K-3/4/5/9, K-26).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LAYOUT, EDGE_WORDS, rowOf, layoutMap, labelFits, nearestInDirection, defaultMeasure, wrapText,
} from '../src/layout.mjs';
import { normalizeMap } from '../src/parse.mjs';

const HOUSE = normalizeMap(JSON.parse(readFileSync(new URL('./fixtures/house-map.json', import.meta.url), 'utf8')));
const SELF = 'Riverbend Commons';

const byId = (lay, id) => lay.nodes.find((n) => n.id === id);
const cx = (b) => b.x + b.w / 2;
const cy = (b) => b.y + b.h / 2;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const labelBox = (l) => ({ x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h });

// ── synthetic maps ─────────────────────────────────────────────────────────────
function mapOf(selfName, nodes, edges) {
  return normalizeMap({ version: '1', self: { id: selfName, name: selfName }, nodes, edges });
}
const inst = (id, extra = {}) => ({ id, kind: 'instance', name: id, ring: 1, live: true, counts: {}, ...extra });
const front = (id) => ({ id, kind: 'frontier', name: id, ring: 2, live: false, counts: {} });
const src = (id, ecosystem = null) => ({ id, kind: 'source', name: id, ring: 3, ecosystem, counts: {} });

// 60 nodes in map.nodes (59 drawn + one ecosystem), so the frontier collapses (K-9).
function bigMap() {
  const nodes = [], edges = [];
  const H = 'Hub';
  for (let i = 1; i <= 8; i++) {
    nodes.push(inst(`p${i}`)); edges.push({ from: H, to: `p${i}`, kind: 'federation' });
    for (let j = 1; j <= 3; j++) { nodes.push(front(`p${i}f${j}`)); edges.push({ from: `p${i}`, to: `p${i}f${j}`, kind: 'frontier' }); }
  }
  for (let i = 1; i <= 3; i++) { nodes.push(inst(`k${i}`)); edges.push({ from: H, to: `k${i}`, kind: 'knowledge' }); }
  for (let i = 1; i <= 4; i++) {
    nodes.push(inst(`u${i}`)); edges.push({ from: H, to: `u${i}`, kind: 'upstream' });
    for (let j = 1; j <= 2; j++) { nodes.push(front(`u${i}f${j}`)); edges.push({ from: `u${i}`, to: `u${i}f${j}`, kind: 'frontier' }); }
  }
  for (let i = 1; i <= 4; i++) { nodes.push(inst(`d${i}`)); edges.push({ from: H, to: `d${i}`, kind: 'downstream' }); }
  for (let i = 1; i <= 2; i++) {
    for (let j = 1; j <= 2; j++) { nodes.push(front(`d${i}f${j}`)); edges.push({ from: `d${i}`, to: `d${i}f${j}`, kind: 'frontier' }); }
  }
  nodes.push({ id: 'eco', kind: 'ecosystem', name: 'Eco', ring: 3, counts: {} });
  for (let i = 1; i <= 4; i++) {
    nodes.push(src(`s${i}`, i <= 2 ? 'eco' : null)); edges.push({ from: `s${i}`, to: H, kind: 'provenance' });
  }
  edges.push({ from: 'eco', to: 's1', kind: 'provenance' }, { from: 'eco', to: 's2', kind: 'provenance' });
  return mapOf(H, nodes, edges);
}

const LONG_NAME = 'The Long-Standing Cooperative Federation of Upland Watersheds, Seed Libraries and the Commons';
const LONG_FACTS = 'knowledge peer · AT Proto · read from a static mirror that has not answered in nine days';
function longMap() {
  return mapOf('Riverbend Commons', [
    inst('long', { name: LONG_NAME }), inst('short', { name: 'Short' }), inst('down', { name: 'Downstream With A Long Name Too' }),
    front('Far Away Network Of Many Words'),
  ], [
    { from: 'Riverbend Commons', to: 'long', kind: 'federation' },
    { from: 'Riverbend Commons', to: 'short', kind: 'knowledge' },
    { from: 'Riverbend Commons', to: 'down', kind: 'downstream' },
    { from: 'long', to: 'Far Away Network Of Many Words', kind: 'frontier' },
  ]);
}
const longText = (node) => ({
  name: node.name,
  facts: node.id === 'Riverbend Commons' ? '142 entries · 9 sources' : LONG_FACTS,
  eyebrow: node.id === 'Riverbend Commons' ? 'This instance' : null,
});

function shuffled(arr, seed) {
  const a = arr.slice();
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── rows ───────────────────────────────────────────────────────────────────────
test('rows by the direction knowledge travels (house fixture)', () => {
  const lay = layoutMap(HOUSE, { width: LAYOUT.wideWidth });
  const row = (id) => byId(lay, id).row;
  for (const id of ['watershed-network', 'field-notes-archive', 'seed-registry', 'open-data-portal']) assert.equal(row(id), 'feeds', id);
  const self = byId(lay, SELF);
  assert.equal(self.row, 'centre');
  assert.equal(self.big, true);
  assert.equal(self.side, null);
  assert.ok(Math.abs(cx(self) - lay.width / 2) < 0.01, 'self is horizontally centred');
  for (const id of ['hillside-coop', 'lowland-guild']) {
    assert.equal(row(id), 'centre', id); assert.equal(byId(lay, id).side, 'start', id);
  }
  assert.equal(row('open-seed-library'), 'centre'); assert.equal(byId(lay, 'open-seed-library').side, 'end');
  assert.equal(row('youth-circle'), 'fed'); assert.equal(row('market-garden'), 'fed');
  assert.equal(row('Delta Alliance'), 'beyond-above');
  assert.equal(row('Valley Commons'), 'centre');
  assert.equal(byId(lay, 'Valley Commons').side, 'start');
  assert.ok(byId(lay, 'Valley Commons').x + byId(lay, 'Valley Commons').w <= byId(lay, 'hillside-coop').x, 'Valley is further out than Hillside');
  assert.equal(row('Pantry Network'), 'beyond-below');
  // rows sit top to bottom in that order
  const order = ['Delta Alliance', 'watershed-network', SELF, 'youth-circle', 'Pantry Network'].map((id) => cy(byId(lay, id)));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('rowOf agrees with the layout and names the ecosystem row', () => {
  const lay = layoutMap(HOUSE, { width: LAYOUT.wideWidth });
  for (const n of lay.nodes) {
    const node = n.id === SELF ? HOUSE.self : HOUSE.nodes.find((m) => m.id === n.id);
    assert.equal(rowOf(node, HOUSE), n.row, n.id);
  }
  assert.equal(rowOf(HOUSE.nodes.find((n) => n.id === 'watershed-commons'), HOUSE), 'feeds');
});

test('an ecosystem is a group, not a node', () => {
  const lay = layoutMap(HOUSE, { width: LAYOUT.wideWidth });
  assert.equal(lay.groups.length, 1);
  const g = lay.groups[0];
  assert.equal(g.id, 'watershed-commons');
  assert.equal(g.name, 'Watershed Commons');
  assert.deepEqual([...g.members].sort(), ['field-notes-archive', 'seed-registry']);
  assert.equal(byId(lay, 'watershed-commons'), undefined);
  for (const m of g.members) {
    const n = byId(lay, m);
    assert.equal(n.grouped, 'watershed-commons');
    assert.ok(n.x >= g.x && n.y >= g.y && n.x + n.w <= g.x + g.w && n.y + n.h <= g.y + g.h, `${m} inside its group`);
  }
  const toSelf = lay.edges.filter((e) => e.from === 'watershed-commons' && e.to === SELF);
  assert.equal(toSelf.length, 1);
  assert.equal(toSelf[0].kind, 'provenance');
  assert.equal(lay.edges.filter((e) => g.members.includes(e.from) && e.to === SELF).length, 0);
  assert.equal(lay.edges.filter((e) => e.from === 'watershed-commons' && e.to !== SELF).length, 0);
  assert.equal(byId(lay, 'open-data-portal').grouped, null);
});

test('a frontier node reported twice is placed by its first reporter and has an edge from each', () => {
  const map = mapOf('Hub', [inst('Alder'), inst('Birch'), front('Shared')], [
    { from: 'Hub', to: 'Birch', kind: 'upstream' },
    { from: 'Hub', to: 'Alder', kind: 'downstream' },
    { from: 'Birch', to: 'Shared', kind: 'frontier' },
    { from: 'Alder', to: 'Shared', kind: 'frontier' },
  ]);
  const lay = layoutMap(map, { width: LAYOUT.wideWidth });
  // "first" is by reporter name, so the answer never depends on the order of map.json's arrays
  assert.equal(byId(lay, 'Shared').row, 'beyond-below');
  assert.ok(Math.abs(cx(byId(lay, 'Shared')) - cx(byId(lay, 'Alder'))) < 0.01, 'placed under Alder');
  const into = lay.edges.filter((e) => e.to === 'Shared').map((e) => e.from).sort();
  assert.deepEqual(into, ['Alder', 'Birch']);
  const flipped = mapOf('Hub', map.nodes, [...map.edges].reverse());
  assert.equal(byId(layoutMap(flipped, { width: LAYOUT.wideWidth }), 'Shared').row, 'beyond-below');
});

// ── determinism, order ─────────────────────────────────────────────────────────
test('deterministic: two calls deep-equal; shuffling nodes and edges gives the same layout', () => {
  for (const [map, width] of [[HOUSE, LAYOUT.wideWidth], [HOUSE, LAYOUT.narrowWidth], [bigMap(), 1440], [bigMap(), 320]]) {
    const a = layoutMap(map, { width });
    assert.deepEqual(layoutMap(map, { width }), a);
    for (const seed of [1, 7, 42]) {
      const shuffledMap = { ...map, nodes: shuffled(map.nodes, seed), edges: shuffled(map.edges, seed + 1) };
      assert.deepEqual(layoutMap(shuffledMap, { width }), a, `seed ${seed} at ${width}`);
    }
  }
});

test('ties break by name: equal neighbours fill from the centre outward, start before end', () => {
  const map = mapOf('Hub', [src('Cedar'), src('Alder'), src('Birch')], ['Cedar', 'Alder', 'Birch'].map((s) => ({ from: s, to: 'Hub', kind: 'provenance' })));
  const lay = layoutMap(map, { width: LAYOUT.wideWidth });
  const self = byId(lay, 'Hub');
  assert.ok(Math.abs(cx(byId(lay, 'Alder')) - cx(self)) < 0.01, 'first by name sits over the centre');
  assert.ok(cx(byId(lay, 'Birch')) < cx(self), 'second by name on the start side');
  assert.ok(cx(byId(lay, 'Cedar')) > cx(self), 'third by name on the end side');
  // on the house fixture the same rule puts the upstream instance (an instance outranks a group and a source) over self
  const house = layoutMap(HOUSE, { width: LAYOUT.wideWidth });
  assert.ok(Math.abs(cx(byId(house, 'watershed-network')) - cx(byId(house, SELF))) < 0.01);
  // peers beside self: by name
  assert.ok(byId(house, 'hillside-coop').y < byId(house, 'lowland-guild').y);
});

function crossings(lay) {
  const ROWS = ['beyond-above', 'feeds', 'centre', 'fed', 'beyond-below'];
  const box = (id) => byId(lay, id) || lay.groups.find((g) => g.id === id);
  const rowIx = (id) => ROWS.indexOf(byId(lay, id)?.row ?? 'feeds');
  const segs = lay.edges.filter((e) => !e.sameRow && Math.abs(rowIx(e.from) - rowIx(e.to)) === 1).map((e) => {
    const [u, l] = cy(box(e.from)) < cy(box(e.to)) ? [e.from, e.to] : [e.to, e.from];
    return { e, u, l, ux: cx(box(u)), lx: cx(box(l)), rows: [rowIx(u), rowIx(l)].join() };
  });
  const found = [];
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const a = segs[i], b = segs[j];
    if (a.rows !== b.rows || a.u === b.u || a.l === b.l) continue;
    if ((a.ux - b.ux) * (a.lx - b.lx) < 0) found.push(`${a.e.from}→${a.e.to} × ${b.e.from}→${b.e.to}`);
  }
  return found;
}

test('no two adjacent-row edges cross (house fixture, wide and narrow)', () => {
  for (const width of [LAYOUT.wideWidth, 1440, LAYOUT.narrowWidth, 320]) {
    assert.deepEqual(crossings(layoutMap(HOUSE, { width })), [], `at ${width}`);
  }
});

// ── geometry: no overlap, everything inside the canvas ─────────────────────────
function assertNoOverlap(lay, what) {
  const boxes = lay.nodes;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    assert.ok(!overlaps(boxes[i], boxes[j]), `${what}: ${boxes[i].id} overlaps ${boxes[j].id}`);
  }
  // a group overlaps nothing but its own members
  for (const g of lay.groups) for (const n of lay.nodes) {
    if (g.members.includes(n.id)) continue;
    assert.ok(!overlaps(g, n), `${what}: group ${g.id} overlaps ${n.id}`);
  }
}

test('no overlap: no two node boxes intersect (wide, narrow, 60 nodes, a 90-character name)', () => {
  assert.ok(LONG_NAME.length >= 90);
  const cases = [
    ['house', HOUSE, undefined], ['big', bigMap(), undefined], ['long', longMap(), longText],
  ];
  for (const [what, map, text] of cases) {
    for (const width of [LAYOUT.wideWidth, 1440, LAYOUT.narrowWidth, 320]) {
      assertNoOverlap(layoutMap(map, { width, text }), `${what} @${width}`);
    }
  }
});

function assertInside(lay, what) {
  const { x: px, y: py } = lay.pad;
  const inside = (b, label) => {
    assert.ok(b.x >= px - 1e-6 && b.y >= py - 1e-6, `${what}: ${label} starts outside (${b.x}, ${b.y})`);
    assert.ok(b.x + b.w <= lay.width - px + 1e-6, `${what}: ${label} ends past width (${b.x + b.w} > ${lay.width - px})`);
    assert.ok(b.y + b.h <= lay.height - py + 1e-6, `${what}: ${label} ends past height (${b.y + b.h} > ${lay.height - py})`);
  };
  for (const n of lay.nodes) inside(n, n.id);
  for (const g of lay.groups) inside(g, `group ${g.id}`);
  for (const e of lay.edges) if (e.labelAt) inside(labelBox(e.labelAt), `label ${e.from}→${e.to}`);
}

test('everything inside the canvas, with wrapped node heights (the clipping check)', () => {
  assert.equal(LAYOUT.pad, 24);
  const widths = [LAYOUT.wideWidth, 1440, LAYOUT.narrowWidth, 320];
  for (const width of widths) {
    const lay = layoutMap(HOUSE, { width });
    assert.ok(lay.width >= width);
    assert.equal(lay.pad.y, LAYOUT.pad);
    assert.equal(lay.pad.x, width < LAYOUT.narrowAt ? LAYOUT.padNarrow : LAYOUT.pad);
    assertInside(lay, `house @${width}`);
  }
  for (const width of widths) assertInside(layoutMap(bigMap(), { width }), `big @${width}`);
  for (const width of widths) {
    const lay = layoutMap(longMap(), { width, text: longText });
    assertInside(lay, `long @${width}`);
    // the long name wraps: its node is taller than the minimum and wider names never widen a node
    const long = byId(lay, 'long');
    assert.ok(long.h > (width < LAYOUT.narrowAt ? 60 : LAYOUT.nodeH), `long name wraps @${width} (h ${long.h})`);
    if (width >= LAYOUT.narrowAt) assert.equal(long.w, LAYOUT.node);
  }
});

test('heights come from wrapped text; nodes of different heights are centred in their layer', () => {
  const lay = layoutMap(longMap(), { width: 1440, text: longText });
  const self = byId(lay, SELF), long = byId(lay, 'long'), short = byId(lay, 'short');
  assert.ok(self.h >= LAYOUT.bigH);
  assert.ok(short.h >= LAYOUT.nodeH);
  assert.ok(long.h > short.h);
  // a peer stack of one sits centred on self
  assert.ok(Math.abs(cy(long) - cy(self)) < 0.01);
  assert.ok(Math.abs(cy(short) - cy(self)) < 0.01);
  // the same map with the default text (name only) is shorter
  const plain = layoutMap(longMap(), { width: 1440 });
  assert.ok(byId(plain, 'long').h < long.h);
  assert.ok(byId(plain, 'short').h === LAYOUT.nodeH, 'a one-line name with no facts keeps the minimum height');
  // the caller's measure is used
  const wide = layoutMap(longMap(), { width: 1440, measure: (s, { size }) => String(s).length * size * 3 });
  assert.ok(byId(wide, 'long').h > byId(plain, 'long').h, 'a wider measure wraps more');
});

test('text() is told when the layout is narrow (the facts line drops to one word there)', () => {
  const seen = new Set();
  layoutMap(HOUSE, { width: 1440, text: (n, o) => { seen.add(o?.narrow); return { name: n.name, facts: '', eyebrow: null }; } });
  layoutMap(HOUSE, { width: 358, text: (n, o) => { seen.add(o?.narrow); return { name: n.name, facts: 'one', eyebrow: null }; } });
  assert.deepEqual([...seen].sort(), [false, true]);
});

// ── labels ─────────────────────────────────────────────────────────────────────
test('labelFits: the measured label plus 16px', () => {
  assert.equal(LAYOUT.labelPad, 16);
  assert.equal(labelFits(80, 60), true);
  assert.equal(labelFits(76, 60), true);
  assert.equal(labelFits(70, 60), false);
});

test('labels are the words; Mono 11 is measured exactly', () => {
  assert.equal(defaultMeasure('peers', { font: 'mono', size: 11 }), 5 * 6.6);
  assert.equal(defaultMeasure('downstream', { font: 'mono', size: 11 }), 10 * LAYOUT.labelCharW);
  const lay = layoutMap(HOUSE, { width: 1440 });
  for (const e of lay.edges) assert.equal(e.label, EDGE_WORDS[e.kind], `${e.from}→${e.to}`);
  assert.deepEqual(EDGE_WORDS, { upstream: 'upstream', downstream: 'downstream', federation: 'peers', knowledge: 'reads', provenance: 'feeds', frontier: 'one hop' });
});

test('same-layer "peers" and "reads" keep their words at desktop width (K-26)', () => {
  for (const width of [LAYOUT.wideWidth, 1440]) {
    const lay = layoutMap(HOUSE, { width });
    for (const to of ['hillside-coop', 'lowland-guild', 'open-seed-library']) {
      const e = lay.edges.find((x) => x.from === SELF && x.to === to);
      assert.ok(e.sameRow, `${to} is beside self`);
      assert.ok(e.labelAt, `${to}: "${e.label}" kept @${width}`);
      assert.ok(e.labelAt.w >= defaultMeasure(e.label, { font: 'mono', size: 11 }));
    }
    // the gap between self and its nearest peer carries the measured label
    const self = byId(lay, SELF), hill = byId(lay, 'hillside-coop');
    assert.ok(labelFits(self.x - (hill.x + hill.w), defaultMeasure('peers', { font: 'mono', size: 11 })));
  }
});

test('a label that would collide is dropped and the edge stays; no label sits on a node', () => {
  // three upstream instances on a 320 grid: their three labels sit about 50px apart and are 56px wide
  const map = mapOf('Hub', ['U1', 'U2', 'U3'].map((id) => inst(id)), ['U1', 'U2', 'U3'].map((to) => ({ from: 'Hub', to, kind: 'upstream' })));
  const lay = layoutMap(map, { width: 320 });
  const [u1, u2, u3] = ['U1', 'U2', 'U3'].map((to) => lay.edges.find((e) => e.to === to));
  assert.ok(u1.labelAt, 'placed first ((from, to) order)');
  assert.equal(u2.labelAt, null);
  assert.equal(u3.labelAt, null);
  for (const e of [u2, u3]) { assert.equal(e.label, 'upstream'); assert.match(e.d, /^M/); }
  assert.ok(layoutMap(map, { width: 1440 }).edges.every((e) => e.labelAt), 'with room, all three keep their words');
  for (const m of [HOUSE, bigMap()]) for (const width of [1440, 358]) {
    const l = layoutMap(m, { width });
    const placed = l.edges.filter((e) => e.labelAt).map((e) => labelBox(e.labelAt));
    for (const b of placed) for (const n of l.nodes) assert.ok(!overlaps(b, n), `label on ${n.id} @${width}`);
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) assert.ok(!overlaps(placed[i], placed[j]));
  }
});

test('R-16: ends joined by two relations are drawn once, in the words of the relation that decided the row', () => {
  const map = mapOf('Hub', [inst('Alder'), inst('Birch')], [
    { from: 'Hub', to: 'Alder', kind: 'federation' }, { from: 'Hub', to: 'Alder', kind: 'upstream' },
    { from: 'Hub', to: 'Birch', kind: 'knowledge' }, { from: 'Hub', to: 'Birch', kind: 'federation' },
  ]);
  for (const width of [1440, 358]) {
    const lay = layoutMap(map, { width });
    assert.equal(lay.edges.length, 2);
    const alder = lay.edges.find((e) => e.to === 'Alder');
    assert.equal(byId(lay, 'Alder').row, 'feeds');
    assert.equal(alder.kind, 'upstream');
    assert.equal(alder.label, 'upstream');
    assert.deepEqual(alder.kinds, ['upstream', 'federation']);
    assert.ok(alder.labelAt, '"upstream" is not lost');
    const birch = lay.edges.find((e) => e.to === 'Birch');
    assert.equal(byId(lay, 'Birch').side, 'start');
    assert.equal(birch.kind, 'federation');
    assert.deepEqual(birch.kinds, ['federation', 'knowledge']);
    assert.equal(new Set(lay.edges.map((e) => e.d)).size, lay.edges.length, 'no two identical paths');
  }
  const house = layoutMap(HOUSE, { width: 1440 });
  for (const e of house.edges) assert.deepEqual(e.kinds, [e.kind]);
});

test('a too-short edge drops its label', () => {
  const lay = layoutMap(HOUSE, { width: LAYOUT.narrowWidth });
  const e = lay.edges.find((x) => x.from === SELF && x.to === 'hillside-coop');
  assert.ok(e.sameRow);
  assert.equal(e.labelAt, null, 'the narrow gutter is too short for "peers"');
});

test('edge geometry: vertical cubics between layers, straight lines within one', () => {
  const lay = layoutMap(HOUSE, { width: 1440 });
  const up = lay.edges.find((e) => e.to === 'watershed-network' && e.from === SELF);
  assert.equal(up.sameRow, false);
  assert.match(up.d, /^M[\d.-]+ [\d.-]+( L[\d.-]+ [\d.-]+)? C[^LC]+( L[\d.-]+ [\d.-]+)?$/, 'straight lead-ins, one cubic');
  const self = byId(lay, SELF), ws = byId(lay, 'watershed-network');
  const [mx, my] = up.d.slice(1).split(' ').map(Number);
  assert.ok(Math.abs(mx - cx(self)) < 0.01 && Math.abs(my - self.y) < 0.01, 'from the top centre of the lower node');
  assert.ok(up.d.trim().endsWith(`${round(cx(ws))} ${round(ws.y + ws.h)}`), 'to the bottom centre of the upper node');
  const peer = lay.edges.find((e) => e.to === 'hillside-coop');
  assert.equal(peer.sameRow, true);
  assert.match(peer.d, /^M[\d.-]+ [\d.-]+ L[\d.-]+ [\d.-]+$/);
});
const round = (v) => Math.round(v * 100) / 100;

// points along an edge's path (M, then any of L and C segments), for the "through a box" check
function pathPoints(d) {
  const segs = d.match(/[MLC][^MLC]*/g);
  const out = [];
  let cur = null;
  for (const seg of segs) {
    const n = seg.slice(1).match(/-?[\d.]+/g).map(Number);
    if (seg[0] === 'M') { cur = [n[0], n[1]]; out.push(cur); continue; }
    for (let i = 1; i <= 48; i++) {
      const t = i / 48, u = 1 - t;
      out.push(seg[0] === 'L'
        ? [cur[0] + (n[0] - cur[0]) * t, cur[1] + (n[1] - cur[1]) * t]
        : [u * u * u * cur[0] + 3 * u * u * t * n[0] + 3 * u * t * t * n[2] + t * t * t * n[4],
          u * u * u * cur[1] + 3 * u * u * t * n[1] + 3 * u * t * t * n[3] + t * t * t * n[5]]);
    }
    cur = seg[0] === 'L' ? [n[0], n[1]] : [n[4], n[5]];
  }
  return out;
}

// shared one-hop nodes and wrapped layers: the maps the task review found edges crossing boxes on
function oddMaps() {
  const H = 'Hub';
  const fe = (from, to) => ({ from, to, kind: 'frontier' });
  const rel = (to, kind) => ({ from: H, to, kind });
  return {
    'second stacked peer, one hop placed above': mapOf(H, [inst('Alder'), inst('Zinnia'), inst('Birch'), front('F')],
      [rel('Alder', 'federation'), rel('Zinnia', 'federation'), rel('Birch', 'upstream'), fe('Zinnia', 'F'), fe('Birch', 'F')]),
    'second stacked peer, one hop placed below': mapOf(H, [inst('Alder'), inst('Zinnia'), inst('Birch'), front('F')],
      [rel('Alder', 'federation'), rel('Zinnia', 'federation'), rel('Birch', 'downstream'), fe('Zinnia', 'F'), fe('Birch', 'F')]),
    'first stacked peer, one hop placed below': mapOf(H, [inst('Alder'), inst('Zinnia'), inst('Birch'), front('F')],
      [rel('Alder', 'federation'), rel('Zinnia', 'federation'), rel('Birch', 'downstream'), fe('Alder', 'F'), fe('Birch', 'F')]),
    'a peer and a knowledge peer share one hop': mapOf(H, [inst('Alder'), inst('Kale'), front('F')],
      [rel('Alder', 'federation'), rel('Kale', 'knowledge'), fe('Alder', 'F'), fe('Kale', 'F')]),
    'four downstream': mapOf(H, ['D1', 'D2', 'D3', 'D4'].map((id) => inst(id)), ['D1', 'D2', 'D3', 'D4'].map((id) => rel(id, 'downstream'))),
    'three peers share one hop': mapOf(H, [inst('A'), inst('B'), inst('C'), front('F')],
      [rel('A', 'federation'), rel('B', 'federation'), rel('C', 'federation'), fe('A', 'F'), fe('B', 'F'), fe('C', 'F')]),
    'two peers and an upstream share one hop': mapOf(H, [inst('A'), inst('B'), inst('U'), front('F')],
      [rel('A', 'federation'), rel('B', 'federation'), rel('U', 'upstream'), fe('A', 'F'), fe('B', 'F'), fe('U', 'F')]),
    'four peers, two knowledge peers, five sources': mapOf(H,
      [...['P1', 'P2', 'P3', 'P4'].map((id) => inst(id)), inst('K1'), inst('K2'), ...['S1', 'S2', 'S3', 'S4', 'S5'].map((id) => src(id))],
      [...['P1', 'P2', 'P3', 'P4'].map((id) => rel(id, 'federation')), rel('K1', 'knowledge'), rel('K2', 'knowledge'),
        ...['S1', 'S2', 'S3', 'S4', 'S5'].map((id) => ({ from: id, to: H, kind: 'provenance' }))]),
  };
}

function edgesThroughBoxes(lay) {
  const groups = new Map(lay.groups.map((g) => [g.id, g]));
  const found = [];
  for (const e of lay.edges) {
    const ends = new Set([e.from, e.to, ...(groups.get(e.from)?.members || []), ...(groups.get(e.to)?.members || [])]);
    const inGroup = (id) => lay.groups.find((g) => g.members.includes(id))?.id;
    for (const b of [...lay.nodes, ...lay.groups]) {
      if (ends.has(b.id) || b.id === inGroup(e.from) || b.id === inGroup(e.to)) continue;
      if (pathPoints(e.d).some(([x, y]) => x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 1 && y < b.y + b.h - 1)) found.push(`${e.from}→${e.to} through ${b.id}`);
    }
  }
  return found;
}

test('no edge runs through a box that is not its own end (house fixture, the odd maps, wide and narrow)', () => {
  for (const width of [LAYOUT.wideWidth, 1440, LAYOUT.narrowWidth, 390, 320]) {
    assert.deepEqual(edgesThroughBoxes(layoutMap(HOUSE, { width })), [], `house @${width}`);
    for (const [name, map] of Object.entries(oddMaps())) {
      assert.deepEqual(edgesThroughBoxes(layoutMap(map, { width })), [], `${name} @${width}`);
    }
  }
  // and the 60-node map, folded and partly unfolded
  for (const width of [LAYOUT.wideWidth, 1440, LAYOUT.narrowWidth, 320]) {
    for (const expanded of [[], ['p1', 'u1']]) assert.deepEqual(edgesThroughBoxes(layoutMap(bigMap(), { width, expanded })), [], `big @${width}`);
  }
});

// ── narrow ─────────────────────────────────────────────────────────────────────
test('narrow: a three-column grid, self in the middle column', () => {
  for (const width of [LAYOUT.narrowWidth, 320]) {
    const lay = layoutMap(HOUSE, { width });
    assert.equal(lay.narrow, true);
    assert.equal(lay.width, width);
    for (const n of lay.nodes) assert.ok([0, 1, 2].includes(n.col), `${n.id} col ${n.col}`);
    assert.equal(byId(lay, SELF).col, 1);
    for (const row of ['beyond-above', 'feeds', 'centre', 'fed', 'beyond-below']) {
      const xs = new Set(lay.nodes.filter((n) => n.row === row && !n.grouped).map((n) => n.x));
      for (const g of lay.groups) if (row === 'feeds') xs.add(g.x);
      assert.ok(xs.size <= 3, `${row} uses ${xs.size} columns`);
    }
    for (const id of ['hillside-coop', 'lowland-guild', 'Valley Commons']) assert.equal(byId(lay, id).col, 0, id);
    assert.equal(byId(lay, 'open-seed-library').col, 2);
    // the group is one column, its members stacked
    const g = lay.groups[0];
    const [a, b] = g.members.map((m) => byId(lay, m));
    assert.equal(a.x, b.x);
    assert.ok(a.y + a.h <= b.y || b.y + b.h <= a.y);
  }
  assert.equal(layoutMap(HOUSE, { width: 1440 }).narrow, false);
});

test('the layout grows width when its columns need more than given; height contains everything', () => {
  const lay = layoutMap(bigMap(), { width: LAYOUT.wideWidth });
  assert.ok(lay.width > LAYOUT.wideWidth);
  const bottom = Math.max(...lay.nodes.map((n) => n.y + n.h), ...lay.groups.map((g) => g.y + g.h));
  assert.equal(lay.height, round(bottom + LAYOUT.pad));
  const tiny = layoutMap(HOUSE, { width: 120 });
  assert.ok(tiny.width > 120);
});

// ── collapse ───────────────────────────────────────────────────────────────────
test('collapse: over 40 nodes, one hop beyond folds per reporter; expanded unfolds one', () => {
  const lay = layoutMap(bigMap(), { width: 1440 });
  const beyond = lay.nodes.filter((n) => n.id.startsWith('beyond:'));
  const reporters = [...['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'], 'u1', 'u2', 'u3', 'u4', 'd1', 'd2'];
  assert.deepEqual(beyond.map((n) => n.collapsed.reporter).sort(), [...reporters].sort());
  const p1 = beyond.find((n) => n.id === 'beyond:p1');
  assert.deepEqual(p1.collapsed, { reporter: 'p1', count: 3, members: ['p1f1', 'p1f2', 'p1f3'] });
  assert.equal(p1.row, 'centre'); assert.equal(p1.side, 'start');
  assert.equal(byId(lay, 'beyond:u1').row, 'beyond-above');
  assert.equal(byId(lay, 'beyond:d1').row, 'beyond-below');
  assert.equal(byId(lay, 'p1f1'), undefined);
  assert.ok(lay.edges.some((e) => e.from === 'p1' && e.to === 'beyond:p1' && e.kind === 'frontier'));
  const open = layoutMap(bigMap(), { width: 1440, expanded: ['p1'] });
  assert.equal(byId(open, 'beyond:p1'), undefined);
  for (const id of ['p1f1', 'p1f2', 'p1f3']) assert.ok(byId(open, id), id);
  assert.ok(byId(open, 'beyond:p2'));
  // the house fixture is small: nothing collapses
  assert.equal(layoutMap(HOUSE, { width: 1440 }).nodes.filter((n) => n.collapsed).length, 0);
});

// ── empty ──────────────────────────────────────────────────────────────────────
test('empty: self alone is one node, no edges', () => {
  const lay = layoutMap(mapOf('Solo', [], []), { width: LAYOUT.wideWidth });
  assert.equal(lay.nodes.length, 1);
  assert.equal(lay.edges.length, 0);
  assert.equal(lay.groups.length, 0);
  assert.ok(lay.height >= LAYOUT.bigH + 2 * LAYOUT.pad);
  assert.equal(lay.nodes[0].big, true);
  const bad = layoutMap(normalizeMap(null), { width: 600 });
  assert.deepEqual(bad.nodes, []);
});

// ── keyboard ───────────────────────────────────────────────────────────────────
test('nearestInDirection follows edges only', () => {
  const lay = layoutMap(HOUSE, { width: LAYOUT.wideWidth });
  assert.equal(nearestInDirection(SELF, 'up', lay), 'watershed-network');
  assert.equal(nearestInDirection('hillside-coop', 'right', lay), SELF);
  assert.equal(nearestInDirection('hillside-coop', 'left', lay), 'Valley Commons');
  assert.equal(nearestInDirection('Delta Alliance', 'up', lay), null);
  assert.equal(nearestInDirection('Valley Commons', 'left', lay), null);
  // a group's edge reaches its members: from a member, down is self
  assert.equal(nearestInDirection('seed-registry', 'down', lay), SELF);
  assert.equal(nearestInDirection('nobody', 'up', lay), null);
});

// ── text helpers ───────────────────────────────────────────────────────────────
test('wrapText wraps at spaces, hyphenates a word too long for the line, and never drops a character', () => {
  const m = (s) => defaultMeasure(s, { font: 'mono', size: 10 }); // 6px a character
  assert.deepEqual(wrapText('one hop via Hillside', 60, { font: 'mono', size: 10 }), ['one hop', 'via', 'Hillside']);
  const lines = wrapText('Supercalifragilistic', 60, { font: 'mono', size: 10 });
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(m(l) <= 60, l);
  assert.ok(lines.slice(0, -1).every((l) => l.endsWith('-')));
  assert.equal(lines.map((l, i) => (i < lines.length - 1 ? l.slice(0, -1) : l)).join(''), 'Supercalifragilistic');
  assert.deepEqual(wrapText('', 100, {}), []);
  assert.deepEqual(wrapText('x', 1, { font: 'mono', size: 10 }), ['x'], 'a line narrower than a character still holds one');
  const indented = wrapText('aaaa bbbb', 54, { font: 'mono', size: 10, indent: 15 });
  assert.deepEqual(indented, ['aaaa', 'bbbb']);
});

test('defaultMeasure: deterministic, by character class, display wider than sans', () => {
  const s = 'Riverbend Commons';
  assert.equal(defaultMeasure(s, { font: 'sans', size: 13 }), defaultMeasure(s, { font: 'sans', size: 13 }));
  assert.ok(defaultMeasure('iiii', { font: 'sans', size: 13 }) < defaultMeasure('mmmm', { font: 'sans', size: 13 }));
  assert.ok(defaultMeasure(s, { font: 'display', size: 13 }) > defaultMeasure(s, { font: 'sans', size: 13 }));
  assert.equal(defaultMeasure('', { font: 'sans', size: 13 }), 0);
});
