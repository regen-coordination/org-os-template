// src/layout.mjs
// The house map's layout (spec §5.1, K-3/4/5/9, K-26): layers by the direction knowledge travels.
//
//   beyond-above   one hop beyond, over the upstream instance that reported it
//   feeds          upstream instances and sources (an ecosystem's sources sit inside one group)
//   centre         this instance (big), federation peers on the start side, knowledge peers on the
//                  end side, and their one-hop-beyond nodes further out on the same side
//   fed            downstream instances
//   beyond-below   one hop beyond, under the downstream instance that reported it
//
// Pure and zero-dependency: no DOM, no imports. The same map.json always gives the same picture —
// inputs are sorted before anything is placed, so the order of map.json's arrays never matters.
// Positions are computed here and never stored (the skin cannot move nodes).
//
// Node heights come from the node's wrapped words (K-26: names and facts wrap, hyphenated, never
// cut), measured with `measure` (default: a per-character width table, Mono exact at 0.6em). The
// words come from `text(node, { narrow })` — the map's view model (view.mjs) on real pages.

// Every length is the gallery's (docs/design/kms-house-gallery.html, map §02/§03) unless noted.
const freeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v);
  return Object.freeze(o);
};

export const LAYOUT = freeze({
  layerGap: 64, layerGapNarrow: 52, // between layers (spec §5.1 / L4 §8.2)
  colGap: 40, colGapNarrow: 6,      // K-26 desktop gap; narrow = the gallery's `column-gap: var(--sp-5)`
  node: 192, big: 236,              // K-26 node width; self stays big
  nodeH: 56, bigH: 84,              // minimum heights at desktop (one-line name + one-line facts)
  pad: 24, padNarrow: 8,            // canvas padding; narrow inline padding = gallery `padding-inline: var(--sp-6)`
  narrowAt: 680, wideWidth: 1040, narrowWidth: 358,
  collapseOver: 40,                 // K-9
  labelPad: 16,                     // K-26: a label is kept when the edge holds the measured label + 16
  labelCharW: 6.6, labelH: 18, labelPillX: 5, labelSize: 11, // Mono 11 pill, padding 3px 5px
  labelNarrow: { size: 10, h: 14, pillX: 4 },                 // gallery narrow `.elabel`: 10px, padding 2px 4px
  stackGap: 16, stackGapNarrow: 44, // nodes stacked within one layer: peers beside self; narrow wrap (gallery row-gap)
  colMinNarrow: 64,                 // below this a narrow column stops shrinking and the canvas grows
  displaySmallAt: 300,              // K-26: under 300px of map width the centre name drops to 12px
  border: 1,
  // node anatomy (gallery `.node`, `.node.big`, `.map.kfed .node` and their narrow overrides)
  nodeBox: {
    wide:   { padX: 12, padTop: 10, padBottom: 10, gap: 3, glyph: 14, glyphGap: 6,
              name: { font: 'sans', size: 13, lh: 1.25 }, facts: { font: 'mono', size: 11, lh: 1.3 } },
    narrow: { padX: 6, padTop: 6, padBottom: 8, gap: 3, glyph: 0, glyphGap: 0,
              name: { font: 'sans', size: 12, lh: 1.25 }, facts: { font: 'mono', size: 10, lh: 1.3 } },
  },
  selfBox: {
    wide:   { padX: 16, padTop: 14, padBottom: 14, name: { font: 'display', size: 17, lh: 1.2 } },
    narrow: { padX: 8, padTop: 8, padBottom: 8, name: { font: 'display', size: 15, lh: 1.2 } },
    small:  { padX: 6, padTop: 8, padBottom: 8, name: { font: 'display', size: 12, lh: 1.2 } },
  },
  factsGlyph: 15, // the facts line's clock/alert glyph: 11px + var(--sp-4)
  eyebrow: {      // `.node .nk`: Mono 500 10px/1, uppercase, tracked, 3px below
    wide: { font: 'mono', size: 10, lh: 1, tracking: 0.08, after: 3 },
    narrow: { font: 'mono', size: 10, lh: 1, tracking: 0.04, after: 3 },
  },
  group: {        // `.group`: dashed box, sprout eyebrow, members on a grid
    wide:   { pad: 12, gap: 8, cols: 2, glyph: 12, glyphGap: 4, eyebrow: { font: 'mono', size: 11, lh: 1, tracking: 0.08 } },
    narrow: { pad: 6, gap: 4, cols: 1, glyph: 12, glyphGap: 4, eyebrow: { font: 'mono', size: 10, lh: 1, tracking: 0.04 } },
  },
});

export const EDGE_WORDS = Object.freeze({
  upstream: 'upstream', downstream: 'downstream', federation: 'peers', knowledge: 'reads',
  provenance: 'feeds', frontier: 'one hop',
});

const ROWS = ['beyond-above', 'feeds', 'centre', 'fed', 'beyond-below'];

// ── measuring and wrapping ─────────────────────────────────────────────────────

// Approximate advance widths in em, by character class (Geist; Fraunces ≈ 6% wider). They lean
// generous so a wrapped estimate errs towards one line too many, never one too few.
function sansEm(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 0x1f000) return 1.2;          // emoji
  if (cp >= 0x2e80) return 1;             // CJK and other full-width scripts
  if (ch === ' ') return 0.28;
  if ('il.,:;|!\'ı'.includes(ch)) return 0.26;
  if (ch === 'j') return 0.28;
  if (ch === 'I') return 0.3;
  if ('frt()[]{}/\\-'.includes(ch)) return 0.4;
  if (ch === 'm' || ch === 'w') return 0.84;
  if (ch === 'M') return 0.88;
  if (ch === 'W') return 0.98;
  if (ch === '@' || ch === '%') return 0.95;
  if (/[a-z]/.test(ch)) return 0.57;
  if (/[A-Z]/.test(ch)) return 0.7;
  if (/[0-9]/.test(ch)) return 0.62;
  if (cp < 0x80) return 0.6;              // other ASCII punctuation
  return 0.66;                            // accented Latin and the rest
}

function monoEm(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 0x1f000) return 1.2;
  if (cp >= 0x2e80) return 1;
  return 0.6;                             // Geist Mono: every glyph advances 600/1000
}

export function defaultMeasure(str, { font = 'sans', size = 13 } = {}) {
  let em = 0;
  for (const ch of String(str ?? '')) {
    em += font === 'mono' ? monoEm(ch) : font === 'display' ? sansEm(ch) * 1.06 : sansEm(ch);
  }
  return Math.round(em * size * 1e6) / 1e6; // 10 × 6.6 is 66, not 65.99999999999999
}

// Greedy wrap at spaces; a word longer than the line breaks with a hyphen (the CSS is
// `overflow-wrap: break-word; hyphens: auto`). `tracking` is letter-spacing in em; `indent` narrows
// the first line (an inline glyph). Returns the lines; never drops a character.
export function wrapText(str, maxWidth, { font = 'sans', size = 13, measure = defaultMeasure, tracking = 0, indent = 0 } = {}) {
  const m = (s) => measure(s, { font, size }) + tracking * size * [...s].length;
  const words = String(str ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  const avail = () => maxWidth - (lines.length === 0 ? indent : 0);
  for (const word of words) {
    const cand = line ? `${line} ${word}` : word;
    if (m(cand) <= avail()) { line = cand; continue; }
    if (line) { lines.push(line); line = ''; }
    let rest = word;
    while (m(rest) > avail() && [...rest].length > 1) {
      const chars = [...rest];
      let cut = 1;
      for (let i = 2; i < chars.length; i++) {
        const head = chars.slice(0, i).join('');
        if (m(head.endsWith('-') ? head : `${head}-`) <= avail()) cut = i; else break;
      }
      const head = chars.slice(0, cut).join('');
      lines.push(head.endsWith('-') ? head : `${head}-`);
      rest = chars.slice(cut).join('');
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

// ── labels ─────────────────────────────────────────────────────────────────────

// K-26: a label is kept only when the edge holds the measured label plus 16px (the pill's own
// padding plus 3px a side).
export function labelFits(edgeLength, labelWidth) {
  return edgeLength >= labelWidth + LAYOUT.labelPad;
}

// ── reading the map ────────────────────────────────────────────────────────────

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const nameOf = (n) => String(n?.name ?? n?.id ?? '');
// by name (case-insensitive, then exact), then id — code-point order, so no locale can change it
const cmpName = (a, b) => cmpStr(nameOf(a).toLowerCase(), nameOf(b).toLowerCase()) || cmpStr(nameOf(a), nameOf(b))
  || cmpStr(String(a.id), String(b.id));
const edgeKey = (e) => `${e.from}\u0000${e.to}\u0000${e.kind}`;
const cmpEdge = (a, b) => cmpStr(String(a.from), String(b.from)) || cmpStr(String(a.to), String(b.to))
  || cmpStr(String(a.kind), String(b.kind));

function indexMap(map) {
  const selfId = map.self.id;
  const byId = new Map();
  for (const n of [...(map.nodes || [])].filter((n) => n && n.id != null && n.id !== selfId)
    .sort((a, b) => cmpStr(String(a.id), String(b.id)) || cmpStr(JSON.stringify(a), JSON.stringify(b)))) {
    if (!byId.has(n.id)) byId.set(n.id, n);
  }
  const has = (id) => id === selfId || byId.has(id);
  const seen = new Set();
  const edges = [];
  for (const e of [...(map.edges || [])].filter((e) => e && has(e.from) && has(e.to) && e.from !== e.to).sort(cmpEdge)) {
    const k = edgeKey(e);
    if (!seen.has(k)) { seen.add(k); edges.push({ from: e.from, to: e.to, kind: e.kind }); }
  }
  return { selfId, self: map.self, byId, nodes: [...byId.values()], edges };
}

const SELF_EDGE = { upstream: ['feeds', null], federation: ['centre', 'start'], knowledge: ['centre', 'end'],
  downstream: ['fed', null], provenance: ['feeds', null] };
const SELF_EDGE_ORDER = ['upstream', 'federation', 'knowledge', 'downstream', 'provenance'];
const KIND_ORDER = [...SELF_EDGE_ORDER, 'frontier'];

// id → { row, side, reporter }. A frontier node goes one step further out from its first reporter
// (by reporter name — "first" must not depend on the order of map.json's arrays).
function classify(ix) {
  const cls = new Map([[ix.selfId, { row: 'centre', side: null, reporter: null }]]);
  const selfKinds = new Map();
  for (const e of ix.edges) {
    const other = e.from === ix.selfId ? e.to : e.to === ix.selfId ? e.from : null;
    if (other == null) continue;
    if (!selfKinds.has(other)) selfKinds.set(other, new Set());
    selfKinds.get(other).add(e.kind);
  }
  for (const n of ix.nodes) {
    if (n.kind === 'source' || n.kind === 'ecosystem') { cls.set(n.id, { row: 'feeds', side: null, reporter: null }); continue; }
    const kinds = selfKinds.get(n.id);
    const k = kinds && SELF_EDGE_ORDER.find((x) => kinds.has(x));
    if (k) cls.set(n.id, { row: SELF_EDGE[k][0], side: SELF_EDGE[k][1], reporter: null });
  }
  // one step further out from a reporter that is already placed and not itself one hop beyond
  const byReporter = (n) => {
    const reporters = ix.edges
      .filter((e) => e.kind === 'frontier' && e.to === n.id && e.from !== ix.selfId && cls.has(e.from) && !cls.get(e.from).reporter)
      .map((e) => ix.byId.get(e.from)).sort(cmpName);
    if (!reporters.length) return false;
    const r = cls.get(reporters[0].id);
    const row = r.row === 'feeds' ? 'beyond-above' : r.row === 'fed' ? 'beyond-below' : r.row;
    cls.set(n.id, { row, side: row === 'centre' ? (r.side || 'start') : null, reporter: reporters[0].id });
    return true;
  };
  // passes, not one loop, so the answer never depends on the order the nodes are visited in
  for (const n of ix.nodes) if (!cls.has(n.id)) byReporter(n);
  // nothing says where an unreported instance belongs: it stands beside self
  for (const n of ix.nodes) if (!cls.has(n.id) && n.kind === 'instance') cls.set(n.id, { row: 'centre', side: 'start', reporter: null });
  for (const n of ix.nodes) if (!cls.has(n.id) && !byReporter(n)) cls.set(n.id, { row: 'beyond-below', side: null, reporter: null });
  return cls;
}

export function rowOf(node, map) {
  if (!node || !map?.self) return null;
  if (node.id === map.self.id) return 'centre';
  return classify(indexMap(map)).get(node.id)?.row ?? null;
}

// Groups, the collapse, and the edges as drawn (one edge per group, frontier folded per reporter).
function prepare(map, expanded) {
  const ix = indexMap(map);
  const cls = classify(ix);
  const memberOf = new Map();
  for (const n of ix.nodes) {
    if (n.kind === 'source' && n.ecosystem != null && ix.byId.get(n.ecosystem)?.kind === 'ecosystem') memberOf.set(n.id, n.ecosystem);
  }
  for (const e of ix.edges) {
    const a = ix.byId.get(e.from), b = ix.byId.get(e.to);
    if (a?.kind === 'ecosystem' && b?.kind === 'source' && !memberOf.has(b.id)) memberOf.set(b.id, a.id);
  }
  const groups = ix.nodes.filter((n) => n.kind === 'ecosystem')
    .map((g) => ({ id: g.id, name: nameOf(g), members: ix.nodes.filter((n) => memberOf.get(n.id) === g.id).sort(cmpName) }))
    .filter((g) => g.members.length);

  let drawn = ix.nodes.filter((n) => n.kind !== 'ecosystem');
  const remap = new Map();
  if (drawn.length + 1 > LAYOUT.collapseOver) {
    const open = new Set(expanded || []);
    const per = new Map();
    for (const n of drawn) {
      const c = cls.get(n.id);
      if (n.kind !== 'frontier' || !c.reporter || open.has(c.reporter)) continue;
      if (!per.has(c.reporter)) per.set(c.reporter, []);
      per.get(c.reporter).push(n);
    }
    const folded = [];
    for (const [reporter, list] of [...per].sort((a, b) => cmpStr(String(a[0]), String(b[0])))) {
      if (list.length < 2) continue; // "+1" would only rename a node
      const id = `beyond:${reporter}`;
      const members = list.sort(cmpName).map((n) => n.id);
      folded.push({ id, kind: 'frontier', name: `+${list.length} one hop beyond`, ring: 2, live: false, counts: {},
        collapsed: { reporter, count: list.length, members } });
      cls.set(id, { ...cls.get(list[0].id) });
      for (const m of members) remap.set(m, id);
    }
    drawn = drawn.filter((n) => !remap.has(n.id)).concat(folded);
  }

  const ecoIds = new Set(ix.nodes.filter((n) => n.kind === 'ecosystem').map((n) => n.id));
  const out = new Map();
  const put = (from, to, kind) => {
    if (from === to) return;
    const e = { from, to, kind };
    const k = edgeKey(e);
    if (!out.has(k)) out.set(k, e);
  };
  for (const e of ix.edges) {
    const from = remap.get(e.from) ?? e.from, to = remap.get(e.to) ?? e.to;
    if (ecoIds.has(from) || ecoIds.has(to)) continue;                  // membership is the group itself
    if ((memberOf.has(from) && to === ix.selfId) || (memberOf.has(to) && from === ix.selfId)) continue; // the group's one edge stands for them
    put(from, to, e.kind);
  }
  for (const g of groups) put(g.id, ix.selfId, 'provenance');
  // R-16: two ends joined by more than one relation are drawn once, in the words of the relation that
  // decided the row (upstream, then peers, reads, downstream, feeds, one hop); `kinds` keeps them all
  const pairsOf = new Map();
  for (const e of [...out.values()].sort(cmpEdge)) {
    const k = [String(e.from), String(e.to)].sort().join('\u0000');
    if (!pairsOf.has(k)) pairsOf.set(k, []);
    pairsOf.get(k).push(e);
  }
  const kindRankOf = (k) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? KIND_ORDER.length : i; };
  const edges = [...pairsOf.values()].map((list) => {
    const sorted = [...list].sort((x, y) => kindRankOf(x.kind) - kindRankOf(y.kind) || cmpEdge(x, y));
    return { ...sorted[0], kinds: [...new Set(sorted.map((x) => x.kind))] };
  }).sort(cmpEdge);
  return { ix, cls, groups, drawn, memberOf, edges };
}

// ── placing ────────────────────────────────────────────────────────────────────

const r2 = (v) => Math.round(v * 100) / 100;

// Ordered boxes along one axis: keep the order, keep `gap` between neighbours, and stay as close as
// possible (least squares) to each box's wanted centre — pool-adjacent-violators on the offsets.
// An `anchors[i]` box outweighs every other box in its block (the limit of an infinite weight), so
// the box a tie run puts at the centre lands exactly on its wanted spot.
function pack(sizes, targets, gap, anchors = []) {
  const n = sizes.length;
  const s = new Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) { s[i] = acc; acc += sizes[i] + gap; }
  const t = targets.map((c, i) => c - sizes[i] / 2 - s[i]);
  const val = (b) => (b.na ? b.sa / b.na : b.sum / b.n);
  const blocks = [];
  for (let i = 0; i < n; i++) {
    blocks.push({ sum: t[i], n: 1, sa: anchors[i] ? t[i] : 0, na: anchors[i] ? 1 : 0 });
    while (blocks.length > 1 && val(blocks[blocks.length - 2]) > val(blocks[blocks.length - 1])) {
      const b = blocks.pop(), a = blocks[blocks.length - 1];
      a.sum += b.sum; a.n += b.n; a.sa += b.sa; a.na += b.na;
    }
  }
  const out = [];
  for (const b of blocks) { const v = val(b); for (let k = 0; k < b.n; k++) out.push(v + s[out.length]); }
  return out;
}

// Order within a layer: by the barycentre of the neighbours already placed; equal barycentres fill
// from the centre outward (first at the centre, then start, then end, …) by kind — an instance
// before one hop beyond, a group, then a source — and then by name.
function kindRank(it) {
  if (it.type === 'group') return 2;
  if (it.node.kind === 'source') return 3;
  if (it.reporter || it.node.kind === 'frontier') return 1;
  return it.node.kind === 'instance' ? 0 : 4;
}
const tieCmp = (a, b) => kindRank(a) - kindRank(b) || cmpName(a, b);

function arrange(items, wanted, anchor = new Set()) {
  const keyed = items.map((it) => ({ it, d: Math.round(wanted(it) * 1000) / 1000 }))
    .sort((a, b) => a.d - b.d || tieCmp(a.it, b.it));
  const out = [];
  for (let k = 0; k < keyed.length;) {
    let j = k;
    while (j < keyed.length && keyed[j].d === keyed[k].d) j++;
    const seq = [];
    keyed.slice(k, j).forEach(({ it }, i) => { if (i === 0 || i % 2 === 0) seq.push(it); else seq.unshift(it); });
    anchor.add(keyed[k].it);
    out.push(...seq);
    k = j;
  }
  return out;
}

const defaultText = (selfId) => (node) => ({ name: nameOf(node), facts: '', eyebrow: node.id === selfId ? 'This instance' : null });

// The height of a node box of width `w`, from its wrapped words.
function nodeHeight(node, w, { isSelf, mode, words, measure }) {
  const narrow = mode !== 'wide';
  const base = LAYOUT.nodeBox[narrow ? 'narrow' : 'wide'];
  const box = isSelf ? { ...base, ...LAYOUT.selfBox[mode], glyph: 0, glyphGap: 0 } : base;
  const inner = w - 2 * LAYOUT.border - 2 * box.padX;
  const name = String(words?.name ?? '') || nameOf(node);
  const nameLines = Math.max(1, wrapText(name, inner - (box.glyph ? box.glyph + box.glyphGap : 0), { ...box.name, measure }).length);
  let h = 2 * LAYOUT.border + box.padTop + box.padBottom + nameLines * box.name.size * box.name.lh;
  if (words?.eyebrow) {
    const eb = LAYOUT.eyebrow[narrow ? 'narrow' : 'wide'];
    const lines = wrapText(String(words.eyebrow).toUpperCase(), inner, { ...eb, measure }).length;
    if (lines) h += lines * eb.size * eb.lh + eb.after + box.gap;
  }
  if (words?.facts) {
    const lines = wrapText(String(words.facts), inner, { ...box.facts, measure, indent: words.factsGlyph ? LAYOUT.factsGlyph : 0 }).length;
    if (lines) h += box.gap + lines * box.facts.size * box.facts.lh;
  }
  h = Math.ceil(h);
  if (!narrow) h = Math.max(h, isSelf ? LAYOUT.bigH : LAYOUT.nodeH);
  return h;
}

function groupEyebrowHeight(name, inner, g, measure) {
  const lines = wrapText(String(name).toUpperCase(), inner - g.glyph - g.glyphGap, { ...g.eyebrow, measure }).length || 1;
  return Math.max(g.glyph, lines * g.eyebrow.size * g.eyebrow.lh);
}

// A group's box and its members' offsets inside it, members `mw` wide.
function sizeGroup(it, mw, narrow, measure) {
  const g = LAYOUT.group[narrow ? 'narrow' : 'wide'];
  const cols = Math.min(g.cols, it.members.length);
  const w = cols * mw + (cols - 1) * g.gap + 2 * g.pad + 2 * LAYOUT.border;
  const eyebrowH = groupEyebrowHeight(it.name, w - 2 * g.pad - 2 * LAYOUT.border, g, measure);
  let y = LAYOUT.border + g.pad + eyebrowH + g.gap;
  const offsets = [];
  for (let r = 0; r * cols < it.members.length; r++) {
    const row = it.members.slice(r * cols, r * cols + cols);
    const rh = Math.max(...row.map((m) => m.h));
    row.forEach((m, c) => offsets.push({ m, dx: LAYOUT.border + g.pad + c * (mw + g.gap), dy: y + (rh - m.h) / 2 }));
    y += rh + g.gap;
  }
  it.w = w;
  it.h = Math.ceil(y - g.gap + g.pad + LAYOUT.border);
  it.offsets = offsets;
}

function labelSpec(narrow) {
  return narrow ? LAYOUT.labelNarrow : { size: LAYOUT.labelSize, h: LAYOUT.labelH, pillX: LAYOUT.labelPillX };
}

// ── routing ────────────────────────────────────────────────────────────────────
// A route starts at a point and runs through pieces: ['L', to] or ['C', c1, c2, to]. `main` is the
// piece that carries the label; `reversed` says it was built from `to` to `from`.

const endOf = (r) => (r.pieces.length ? r.pieces[r.pieces.length - 1][r.pieces[r.pieces.length - 1].length - 1] : r.start);
const same = (p, q) => Math.abs(p[0] - q[0]) < 0.005 && Math.abs(p[1] - q[1]) < 0.005;
function lineTo(r, pt) { if (!same(endOf(r), pt)) r.pieces.push(['L', pt]); }

// A polyline from the route's end through `pts` (pts[0] is that end), inner corners rounded.
function polyline(r, pts, radius = 6) {
  for (let i = 1; i < pts.length; i++) {
    const A = pts[i - 1], K = pts[i], B = pts[i + 1];
    const l1 = Math.hypot(K[0] - A[0], K[1] - A[1]), l2 = B ? Math.hypot(B[0] - K[0], B[1] - K[1]) : 0;
    const u1 = [(K[0] - A[0]) / (l1 || 1), (K[1] - A[1]) / (l1 || 1)], u2 = B ? [(B[0] - K[0]) / (l2 || 1), (B[1] - K[1]) / (l2 || 1)] : [0, 0];
    if (!B || l1 < 0.01 || l2 < 0.01 || Math.abs(u1[0] * u2[1] - u1[1] * u2[0]) < 1e-6) { lineTo(r, K); continue; }
    const rr = Math.min(radius, l1 / 2, l2 / 2);
    lineTo(r, [K[0] - u1[0] * rr, K[1] - u1[1] * rr]);
    r.pieces.push(['C', K, K, [K[0] + u2[0] * rr, K[1] + u2[1] * rr]]);
  }
}

function longestLine(r) {
  let best = 0, bestLen = -1, cur = r.start;
  r.pieces.forEach((pc, i) => {
    const end = pc[pc.length - 1];
    const len = pc[0] === 'L' ? Math.hypot(end[0] - cur[0], end[1] - cur[1]) : -1;
    if (len > bestLen) { best = i; bestLen = len; }
    cur = end;
  });
  return best;
}

function reverseRoute(r) {
  const starts = [r.start];
  for (const pc of r.pieces) starts.push(pc[pc.length - 1]);
  const pieces = [];
  for (let i = r.pieces.length - 1; i >= 0; i--) {
    const pc = r.pieces[i];
    pieces.push(pc[0] === 'L' ? ['L', starts[i]] : ['C', pc[2], pc[1], starts[i]]);
  }
  return { start: starts[starts.length - 1], pieces, main: r.pieces.length - 1 - r.main };
}

const fmt = (p) => `${r2(p[0])} ${r2(p[1])}`;
function renderRoute(r) {
  return `M${fmt(r.start)}` + r.pieces.map((pc) => (pc[0] === 'L' ? ` L${fmt(pc[1])}` : ` C${fmt(pc[1])}, ${fmt(pc[2])}, ${fmt(pc[3])}`)).join('');
}

function sampleRoute(r) {
  const out = [r.start];
  let cur = r.start;
  for (const pc of r.pieces) {
    const n = pc[0] === 'L' ? Math.max(2, Math.ceil(Math.hypot(pc[1][0] - cur[0], pc[1][1] - cur[1]) / 4)) : 24;
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push(pc[0] === 'L' ? [cur[0] + (pc[1][0] - cur[0]) * t, cur[1] + (pc[1][1] - cur[1]) * t]
        : [u * u * u * cur[0] + 3 * u * u * t * pc[1][0] + 3 * u * t * t * pc[2][0] + t * t * t * pc[3][0],
          u * u * u * cur[1] + 3 * u * u * t * pc[1][1] + 3 * u * t * t * pc[2][1] + t * t * t * pc[3][1]]);
    }
    cur = pc[pc.length - 1];
  }
  return out;
}

function routeLength(r) {
  const pts = sampleRoute(r);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

// how many boxes the route runs through (1px inside their edge)
function crossings(r, boxes) {
  const pts = sampleRoute(r);
  let n = 0;
  for (const b of boxes) {
    if (pts.some(([x, y]) => x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 1 && y < b.y + b.h - 1)) n++;
  }
  return n;
}

// the midpoint and direction of one piece (t = .5 on a cubic)
function pieceMid(r, i) {
  const p0 = i === 0 ? r.start : r.pieces[i - 1][r.pieces[i - 1].length - 1];
  const pc = r.pieces[i];
  if (pc[0] === 'L') return { mid: { x: (p0[0] + pc[1][0]) / 2, y: (p0[1] + pc[1][1]) / 2 }, tan: { x: pc[1][0] - p0[0], y: pc[1][1] - p0[1] } };
  const [, c1, c2, p3] = pc;
  return {
    mid: { x: (p0[0] + 3 * c1[0] + 3 * c2[0] + p3[0]) / 8, y: (p0[1] + 3 * c1[1] + 3 * c2[1] + p3[1]) / 8 },
    tan: { x: 0.75 * (c1[0] - p0[0]) + 1.5 * (c2[0] - c1[0]) + 0.75 * (p3[0] - c2[0]), y: 0.75 * (c1[1] - p0[1]) + 1.5 * (c2[1] - c1[1]) + 0.75 * (p3[1] - c2[1]) },
  };
}

// Ways out of a box to the line y = edgeY, going `dir`: its top/bottom centre first, then out of a
// side into the column gap and along it (the way past a box stacked above or below in its column).
function ports(box, dir, edgeY, towardX, gh) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const side = (s) => {
    const sx = s === 'start' ? box.x : box.x + box.w, gx = s === 'start' ? box.x - gh : box.x + box.w + gh;
    return [[sx, cy], [gx, cy], [gx, edgeY]];
  };
  const order = towardX < cx ? ['start', 'end'] : ['end', 'start'];
  return [[[cx, dir === 'down' ? box.y + box.h : box.y], [cx, edgeY]], side(order[0]), side(order[1])];
}

// combinations of two port lists, simplest first
function pairs(A, B) {
  const out = [];
  A.forEach((a, i) => B.forEach((b, j) => out.push([i + j, i, j, a, b])));
  return out.sort((x, y) => x[0] - y[0] || x[1] - y[1]).map(([, , , a, b]) => [a, b]);
}

// the x of a free channel through a layer (between its boxes, or beside them), nearest `target`
function channel(row, target, { items, gh, W }) {
  const boxes = items.filter((it) => it.row === row).map((it) => [it.x, it.x + it.w]).sort((p, q) => p[0] - q[0]);
  const free = [];
  let lo = 0;
  for (const [x0, x1] of boxes) { if (x0 > lo) free.push([lo, x0]); lo = Math.max(lo, x1); }
  free.push([lo, Math.max(lo, W)]);
  let best = target, bestD = Infinity;
  for (const [f0, f1] of free) {
    const mgn = Math.min(gh, (f1 - f0) / 2);
    const x = Math.min(Math.max(target, f0 + mgn), f1 - mgn);
    if (Math.abs(x - target) < bestD) { best = x; bestD = Math.abs(x - target); }
  }
  return best;
}

function* candidates(a, b, sameRow, ctx) {
  const { gh, band, padY, rk } = ctx;
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  if (sameRow) {
    // 1. straight: side to side, or top to bottom when one sits above the other in a column
    const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
    let p, q;
    if (overlapX) {
      const x = (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2;
      p = [x, acy < bcy ? a.y + a.h : a.y]; q = [x, acy < bcy ? b.y : b.y + b.h];
    } else {
      p = [acx < bcx ? a.x + a.w : a.x, acy]; q = [acx < bcx ? b.x : b.x + b.w, bcy];
    }
    yield { start: p, pieces: [['L', q]], main: 0 };
    // 2. one above the other: down the column gap beside them
    if (overlapX) {
      for (const s of ['start', 'end']) {
        const gx = s === 'start' ? Math.min(a.x, b.x) - gh : Math.max(a.x + a.w, b.x + b.w) + gh;
        const sx = (bx) => (s === 'start' ? bx.x : bx.x + bx.w);
        const r = { start: [sx(a), acy], pieces: [], main: 0 };
        polyline(r, [[sx(a), acy], [gx, acy], [gx, bcy], [sx(b), bcy]]);
        r.main = longestLine(r);
        yield r;
      }
    }
    // 3. out through the bottom (or top) and an arc through the gap beside the layer
    const bd = band.get(a.row);
    const rowsPresent = [...band.keys()].sort((x, y) => rk(x) - rk(y));
    const i = rowsPresent.indexOf(a.row);
    const below = rowsPresent[i + 1], above = rowsPresent[i - 1];
    const ways = [];
    if (below) ways.push(['down', bd.bottom, band.get(below).top - bd.bottom]);
    if (above) ways.push(['up', bd.top, bd.top - band.get(above).bottom]);
    if (!below) ways.push(['down', bd.bottom, padY]);
    if (!above) ways.push(['up', bd.top, padY]);
    for (const [dir, edgeY, avail] of ways) {
      const ctrlY = edgeY + (dir === 'down' ? 1 : -1) * (avail / 2) / 0.75; // the arc reaches half way across the gap
      for (const [pa, pb] of pairs(ports(a, dir, edgeY, bcx, gh), ports(b, dir, edgeY, acx, gh))) {
        const r = { start: pa[0], pieces: [], main: 0 };
        polyline(r, pa);
        const xa = pa[pa.length - 1][0], xb = pb[pb.length - 1][0];
        r.main = r.pieces.length;
        r.pieces.push(['C', [xa, ctrlY], [xb, ctrlY], [xb, edgeY]]);
        polyline(r, [...pb].reverse());
        yield r;
      }
    }
    return;
  }
  // between layers: built from the upper end down, through each gap between layers present; a layer
  // in between is crossed by a free channel; a bend happens only inside a gap
  const [U, Lo] = rk(a.row) < rk(b.row) ? [a, b] : [b, a];
  const rows = ROWS.slice(rk(U.row), rk(Lo.row) + 1).filter((row) => band.has(row));
  const uBottom = band.get(U.row).bottom, lTop = band.get(Lo.row).top;
  for (const [pu, pl] of pairs(ports(U, 'down', uBottom, Lo.x + Lo.w / 2, gh), ports(Lo, 'up', lTop, U.x + U.w / 2, gh))) {
    const r = { start: pu[0], pieces: [], main: 0, reversed: U !== a };
    polyline(r, pu);
    let x = pu[pu.length - 1][0];
    const xl = pl[pl.length - 1][0];
    let bestDx = -1;
    for (let k = 0; k < rows.length - 1; k++) {
      const top = band.get(rows[k]).bottom, bot = band.get(rows[k + 1]).top, ym = (top + bot) / 2;
      const last = k === rows.length - 2;
      const nx = last ? xl : channel(rows[k + 1], (x + xl) / 2, ctx);
      if (Math.abs(nx - x) > bestDx) { bestDx = Math.abs(nx - x); r.main = r.pieces.length; }
      r.pieces.push(['C', [x, ym], [nx, ym], [nx, bot]]);
      if (!last) lineTo(r, [nx, band.get(rows[k + 1]).bottom]);
      x = nx;
    }
    polyline(r, [...pl].reverse());
    yield r;
  }
}

// ── the layout ─────────────────────────────────────────────────────────────────

export function layoutMap(map, { width = LAYOUT.wideWidth, expanded = [], text, measure = defaultMeasure } = {}) {
  const narrow = width < LAYOUT.narrowAt;
  const padX = narrow ? LAYOUT.padNarrow : LAYOUT.pad;
  const padY = LAYOUT.pad;
  if (!map?.self || map.self.id == null) {
    return { width, height: 2 * padY, narrow, pad: { x: padX, y: padY }, nodes: [], groups: [], edges: [] };
  }
  const prep = prepare(map, expanded);
  const { ix, cls, edges } = prep;
  const words = text || defaultText(ix.selfId);

  // items: one per drawn node outside a group, one per group
  const nodeItems = new Map();
  const mk = (node) => {
    const c = cls.get(node.id) || { row: 'beyond-below', side: null, reporter: null };
    const it = { type: 'node', id: node.id, node, name: nameOf(node), row: c.row, side: c.side, reporter: c.reporter,
      isSelf: node.id === ix.selfId, grouped: prep.memberOf.get(node.id) ?? null, words: words(node, { narrow }) };
    nodeItems.set(node.id, it);
    return it;
  };
  const selfIt = mk(ix.self);
  for (const n of prep.drawn) mk(n);
  const groupItems = prep.groups.map((g) => ({ type: 'group', id: g.id, name: g.name, row: 'feeds', side: null, reporter: null,
    members: g.members.map((m) => nodeItems.get(m.id)) }));
  const items = [...[...nodeItems.values()].filter((it) => !it.grouped), ...groupItems];
  const itemOf = new Map();
  for (const it of items) itemOf.set(it.id, it);
  for (const g of groupItems) for (const m of g.members) itemOf.set(m.id, g);
  const neighbours = new Map(items.map((it) => [it, new Set()]));
  for (const e of edges) {
    const a = itemOf.get(e.from), b = itemOf.get(e.to);
    if (a && b && a !== b) { neighbours.get(a).add(b); neighbours.get(b).add(a); }
  }
  const byRow = (row) => items.filter((it) => it.row === row);

  const m = (s, size) => measure(s, { font: 'mono', size });
  const ls = labelSpec(narrow);
  const labelNeed = (kind) => (EDGE_WORDS[kind] ? m(EDGE_WORDS[kind], ls.size) + LAYOUT.labelPad : 0);
  const sameRowNeed = (aSet, bSet) => {
    let need = 0;
    for (const e of edges) {
      const a = itemOf.get(e.from), b = itemOf.get(e.to);
      if ((aSet.has(a) && bSet.has(b)) || (aSet.has(b) && bSet.has(a))) need = Math.max(need, labelNeed(e.kind));
    }
    return need;
  };

  let W = width;
  let H;
  const band = new Map(); // row → { top, bottom }: the layer's extent, so cubics turn in the gap between layers
  if (!narrow) {
    // ── desktop: free x within each layer, sized nodes ──────────────────────
    const mode = 'wide';
    for (const it of nodeItems.values()) {
      it.w = it.isSelf ? LAYOUT.big : LAYOUT.node;
      it.h = nodeHeight(it.node, it.w, { isSelf: it.isSelf, mode, words: it.words, measure });
    }
    for (const g of groupItems) sizeGroup(g, LAYOUT.node, false, measure);

    // the centre layer, around (0, 0): peers stacked beside self, their one hop beyond further out
    selfIt.x = -selfIt.w / 2; selfIt.y = -selfIt.h / 2;
    for (const side of ['start', 'end']) {
      const sideItems = byRow('centre').filter((it) => it.side === side && !it.isSelf);
      const peers = sideItems.filter((it) => !it.reporter).sort(tieCmp);
      const far = sideItems.filter((it) => it.reporter);
      const g1 = Math.max(LAYOUT.colGap, sameRowNeed(new Set([selfIt]), new Set(peers)));
      const px = side === 'start' ? selfIt.x - g1 - LAYOUT.node : selfIt.x + selfIt.w + g1;
      const total = peers.reduce((s, it) => s + it.h, 0) + Math.max(0, peers.length - 1) * LAYOUT.stackGap;
      let y = -total / 2;
      for (const p of peers) { p.x = px; p.y = y; y += p.h + LAYOUT.stackGap; }
      if (!far.length) continue;
      const at = (it) => peers.findIndex((p) => p.id === it.reporter);
      far.sort((a, b) => (at(a) < 0 ? 1e9 : at(a)) - (at(b) < 0 ? 1e9 : at(b)) || tieCmp(a, b));
      const want = far.map((it) => { const r = peers[at(it)]; return r ? r.y + r.h / 2 : 0; });
      const ys = pack(far.map((it) => it.h), want, LAYOUT.stackGap);
      const g2 = Math.max(LAYOUT.colGap, sameRowNeed(new Set(peers), new Set(far)));
      const fx = side === 'start' ? px - g2 - LAYOUT.node : px + LAYOUT.node + g2;
      far.forEach((it, i) => { it.x = fx; it.y = ys[i]; });
    }

    // the other layers, swept outward from the centre (down for those below, up for those above)
    const placeRow = (row, ref) => {
      const list = byRow(row);
      if (!list.length) return;
      const wanted = (it) => {
        const ns = [...neighbours.get(it)].filter((n) => n.row === ref && n.x != null);
        const any = ns.length ? ns : [...neighbours.get(it)].filter((n) => n.x != null);
        return any.length ? any.reduce((s, n) => s + n.x + n.w / 2, 0) / any.length : 0;
      };
      const anchor = new Set();
      const ordered = arrange(list, wanted, anchor);
      const xs = pack(ordered.map((it) => it.w), ordered.map(wanted), LAYOUT.colGap, ordered.map((it) => anchor.has(it)));
      ordered.forEach((it, i) => { it.x = xs[i]; });
    };
    placeRow('feeds', 'centre'); placeRow('beyond-above', 'feeds');
    placeRow('fed', 'centre'); placeRow('beyond-below', 'fed');

    // stack the layers top to bottom; within a layer, centre each box vertically
    let top = padY;
    for (const row of ROWS) {
      const list = byRow(row);
      if (!list.length) continue;
      if (row === 'centre') {
        const minY = Math.min(...list.map((it) => it.y));
        const maxY = Math.max(...list.map((it) => it.y + it.h));
        for (const it of list) it.y += top - minY;
        band.set(row, { top, bottom: top + maxY - minY });
        top += maxY - minY + LAYOUT.layerGap;
      } else {
        const rh = Math.max(...list.map((it) => it.h));
        for (const it of list) it.y = top + (rh - it.h) / 2;
        band.set(row, { top, bottom: top + rh });
        top += rh + LAYOUT.layerGap;
      }
    }
    H = top - LAYOUT.layerGap + padY;
    const half = Math.max(...items.map((it) => Math.max(-it.x, it.x + it.w)));
    W = Math.max(width, Math.ceil(2 * half + 2 * padX));
    for (const it of items) it.x += W / 2;
    for (const it of items) it.col = null;
    for (const row of ROWS) {
      const xs = [...new Set(byRow(row).map((it) => r2(it.x)))].sort((a, b) => a - b);
      for (const it of byRow(row)) it.col = xs.indexOf(r2(it.x));
    }
  } else {
    // ── narrow: each layer on a three-column grid, self in the middle column ─
    const gap = LAYOUT.colGapNarrow;
    let cw = (width - 2 * padX - 2 * gap) / 3;
    if (cw < LAYOUT.colMinNarrow) { cw = LAYOUT.colMinNarrow; W = Math.ceil(3 * cw + 2 * gap + 2 * padX); }
    const colX = (c) => padX + c * (cw + gap);
    const mode = W <= LAYOUT.displaySmallAt ? 'small' : 'narrow';
    const gm = LAYOUT.group.narrow;
    for (const it of nodeItems.values()) {
      it.w = it.grouped ? cw - 2 * gm.pad - 2 * LAYOUT.border : cw;
      it.h = nodeHeight(it.node, it.w, { isSelf: it.isSelf, mode: it.isSelf ? mode : 'narrow', words: it.words, measure });
    }
    for (const g of groupItems) sizeGroup(g, cw - 2 * gm.pad - 2 * LAYOUT.border, true, measure);

    // a layer is a list of sub-rows, each a list of [item, column]
    const layers = new Map();
    {
      const sub = [];
      const side = (s) => {
        const sideItems = byRow('centre').filter((it) => it.side === s && !it.isSelf);
        const peers = sideItems.filter((it) => !it.reporter).sort(tieCmp);
        const far = sideItems.filter((it) => it.reporter).sort(tieCmp);
        const out = [];
        for (const p of peers) out.push(p, ...far.filter((f) => f.reporter === p.id));
        out.push(...far.filter((f) => !peers.some((p) => p.id === f.reporter)));
        return out;
      };
      const start = side('start'), end = side('end');
      for (let k = 0; k < Math.max(1, start.length, end.length); k++) {
        const r = [];
        if (start[k]) r.push([start[k], 0]);
        if (k === 0) r.push([selfIt, 1]);
        if (end[k]) r.push([end[k], 2]);
        sub.push(r);
      }
      layers.set('centre', sub);
      for (const [it, c] of sub.flat()) it.col = c;
    }
    const placeRow = (row, ref) => {
      const list = byRow(row);
      if (!list.length) return;
      const wanted = (it) => {
        const ns = [...neighbours.get(it)].filter((n) => n.row === ref && n.col != null);
        const any = ns.length ? ns : [...neighbours.get(it)].filter((n) => n.col != null);
        return any.length ? any.reduce((s, n) => s + n.col, 0) / any.length : 1;
      };
      const ordered = arrange(list, wanted);
      const sub = [];
      for (let k = 0; k < ordered.length; k += 3) {
        const chunk = ordered.slice(k, k + 3);
        const want = chunk.map(wanted);
        const combos = { 1: [[0], [1], [2]], 2: [[0, 1], [0, 2], [1, 2]], 3: [[0, 1, 2]] }[chunk.length];
        let best = null, bestCost = Infinity;
        for (const cols of combos) {
          const cost = cols.reduce((s, c, i) => s + (c - want[i]) ** 2, 0);
          if (cost < bestCost - 1e-9) { best = cols; bestCost = cost; }
        }
        sub.push(chunk.map((it, i) => [it, best[i]]));
        chunk.forEach((it, i) => { it.col = best[i]; });
      }
      layers.set(row, sub);
    };
    placeRow('feeds', 'centre'); placeRow('beyond-above', 'feeds');
    placeRow('fed', 'centre'); placeRow('beyond-below', 'fed');

    let top = padY;
    for (const row of ROWS) {
      const sub = layers.get(row);
      if (!sub || !sub.length) continue;
      const layerTop = top;
      for (const r of sub) {
        const rh = Math.max(...r.map(([it]) => it.h));
        for (const [it, c] of r) { it.x = colX(c); it.y = top + (rh - it.h) / 2; }
        top += rh + LAYOUT.stackGapNarrow;
      }
      band.set(row, { top: layerTop, bottom: top - LAYOUT.stackGapNarrow });
      top += LAYOUT.layerGapNarrow - LAYOUT.stackGapNarrow;
    }
    H = top - LAYOUT.layerGapNarrow + padY;
  }

  // members take their place inside their group
  for (const g of groupItems) {
    for (const { m, dx, dy } of g.offsets) { m.x = g.x + dx; m.y = g.y + dy; m.col = g.col; m.row = 'feeds'; }
  }

  // ── edges ─────────────────────────────────────────────────────────────────
  // Each edge tries routes in order of preference and takes the first that crosses no box but its
  // own ends; when none is clear, the one crossing the fewest (first wins a tie).
  const boxOf = (id) => nodeItems.get(id) || groupItems.find((g) => g.id === id);
  const groupOfId = new Map();
  for (const g of groupItems) for (const mm of g.members) groupOfId.set(mm.id, g);
  const placed = [];
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const gh = (narrow ? LAYOUT.colGapNarrow : LAYOUT.colGap) / 2;
  const rk = (row) => ROWS.indexOf(row);
  const ctx = { gh, band, W, H, padY, items, rk };
  const outEdges = edges.map((e) => {
    const a = boxOf(e.from), b = boxOf(e.to);
    const sameRow = a.row === b.row;
    const skip = new Set([a, b, groupOfId.get(e.from), groupOfId.get(e.to)].filter(Boolean));
    const obstacles = items.filter((it) => !skip.has(it));
    for (const g of [groupOfId.get(e.from), groupOfId.get(e.to)]) if (g) for (const mm of g.members) if (mm !== a && mm !== b) obstacles.push(mm);
    let best = null, bestHits = Infinity;
    for (const r of candidates(a, b, sameRow, ctx)) {
      const hits = crossings(r, obstacles);
      if (hits < bestHits) { best = r; bestHits = hits; }
      if (hits === 0) break;
    }
    const drawn = best.reversed ? reverseRoute(best) : best;
    const d = renderRoute(drawn);
    const { mid, tan } = pieceMid(best, best.main);
    const len = routeLength(best);
    const label = EDGE_WORDS[e.kind] ?? null;
    let labelAt = null;
    if (label) {
      const pillW = m(label, ls.size) + 2 * ls.pillX;
      const tl = Math.hypot(tan.x, tan.y) || 1;
      const along = Math.abs(tan.x / tl) * pillW + Math.abs(tan.y / tl) * ls.h; // the pill's extent along the edge
      const box = { x: mid.x - pillW / 2, y: mid.y - ls.h / 2, w: pillW, h: ls.h };
      const inside = box.x >= padX && box.y >= padY && box.x + box.w <= W - padX && box.y + box.h <= H - padY;
      const blocked = placed.some((o) => hit(o, box)) || items.some((o) => hit(o, box)) || [...groupOfId.keys()].some((id) => hit(nodeItems.get(id), box));
      if (labelFits(len, along - 2 * ls.pillX) && inside && !blocked) {
        placed.push(box);
        labelAt = { x: r2(mid.x), y: r2(mid.y), w: r2(pillW), h: ls.h };
      }
    }
    return { from: e.from, to: e.to, kind: e.kind, kinds: [...e.kinds], label, d, sameRow, labelAt };
  });

  const rank = (it) => ROWS.indexOf(it.row);
  const nodes = [...nodeItems.values()]
    .sort((a, b) => rank(a) - rank(b) || a.x - b.x || a.y - b.y || cmpStr(String(a.id), String(b.id)))
    .map((it) => {
      const n = { id: it.id, row: it.row, side: it.row === 'centre' ? it.side : null, col: it.col, x: r2(it.x), y: r2(it.y),
        w: r2(it.w), h: it.h, big: it.isSelf, grouped: it.grouped };
      if (it.node.collapsed) n.collapsed = { ...it.node.collapsed, members: [...it.node.collapsed.members] };
      return n;
    });
  const groups = groupItems.map((g) => ({ id: g.id, name: g.name, x: r2(g.x), y: r2(g.y), w: r2(g.w), h: g.h, members: g.members.map((m) => m.id) }));
  return { width: W, height: r2(H), narrow, pad: { x: padX, y: padY }, nodes, groups, edges: outEdges };
}

// ── keyboard ───────────────────────────────────────────────────────────────────

// The neighbour (along an edge) nearest in a direction: candidates in that half-plane, scored by the
// distance along the direction plus twice the distance across it. A group's edge reaches each of its
// members. Ties break by id.
export function nearestInDirection(fromId, dir, layout) {
  const nodes = new Map((layout?.nodes || []).map((n) => [n.id, n]));
  const from = nodes.get(fromId);
  if (!from) return null;
  const groups = new Map((layout.groups || []).map((g) => [g.id, g]));
  const ends = (id) => (groups.has(id) ? groups.get(id).members : [id]);
  const near = new Set();
  for (const e of layout.edges || []) {
    const A = ends(e.from), B = ends(e.to);
    if (A.includes(fromId)) B.forEach((b) => near.add(b));
    if (B.includes(fromId)) A.forEach((a) => near.add(a));
  }
  near.delete(fromId);
  const fx = from.x + from.w / 2, fy = from.y + from.h / 2;
  const axis = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  if (!axis) return null;
  let best = null, bestScore = Infinity;
  for (const id of [...near].sort()) {
    const n = nodes.get(id);
    if (!n) continue;
    const dx = n.x + n.w / 2 - fx, dy = n.y + n.h / 2 - fy;
    const along = dx * axis[0] + dy * axis[1];
    if (along <= 0.5) continue;
    const across = Math.abs(dx * axis[1]) + Math.abs(dy * axis[0]);
    const score = along + 2 * across;
    if (score < bestScore) { best = id; bestScore = score; }
  }
  return best;
}
