// src/sim.mjs
// Hybrid layout (spec §4): forceRadial pins rings (orbital), link/charge forces
// settle nodes within them (constellation). Seeded randomSource + hashed initial
// angles keep it deterministic. Pure module — no DOM; testable under node.
import { forceSimulation, forceLink, forceManyBody, forceRadial, forceCollide } from 'd3-force';
import { hashAngle } from './hash.mjs';

export const RING_RADIUS = { 1: 0.28, 2: 0.42, 3: 0.55 }; // fraction of min(width,height)
const NODE_R = { self: 11, instance: 7, frontier: 4, source: 5, ecosystem: 6 };

export function nodeRadius(n) { return NODE_R[n.kind] ?? 5; }

function seededRandom() {
  let s = 0x2f6e2b1; // fixed seed — determinism over novelty
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function buildLayout(map, { width = 900, height = 640, ticks = 220 } = {}) {
  const cx = width / 2, cy = height / 2, unit = Math.min(width, height);
  const ringR = (n) => (RING_RADIUS[n.ring] ?? RING_RADIUS[3]) * unit;
  const nodes = [
    { ...map.self, kind: 'self', ring: 0, x: cx, y: cy, fx: cx, fy: cy },
    ...map.nodes.map((n) => {
      const r = ringR(n), a = hashAngle(n.id);
      return { ...n, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    }),
  ];
  const links = map.edges.map((e) => ({ source: e.from, target: e.to, kind: e.kind }));
  const sim = forceSimulation()
    .randomSource(seededRandom())
    .nodes(nodes)
    .force('link', forceLink(links).id((d) => d.id).strength(0.06).distance(40))
    .force('charge', forceManyBody().strength(-42))
    .force('radial', forceRadial((d) => (d.ring === 0 ? 0 : ringR(d)), cx, cy).strength(0.85))
    .force('collide', forceCollide((d) => nodeRadius(d) + 9))
    .stop();
  sim.tick(ticks);
  return { nodes, links, sim, width, height, cx, cy, unit };
}
