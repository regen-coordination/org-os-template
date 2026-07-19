// src/parse.mjs
// Validate + normalize a map.json payload (spec §3). Never throws: bad input →
// { ok:false } so the element can render a quiet empty-state (spec §6).
const EMPTY = Object.freeze({ ok: false, self: null, nodes: [], edges: [] });

export function normalizeMap(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  if (!raw.self || typeof raw.self !== 'object' || !raw.self.id) return { ...EMPTY };
  if (!Array.isArray(raw.nodes)) return { ...EMPTY };
  const nodes = raw.nodes.filter((n) => n && typeof n === 'object' && n.id && n.kind);
  const ids = new Set([raw.self.id, ...nodes.map((n) => n.id)]);
  const edges = (Array.isArray(raw.edges) ? raw.edges : [])
    .filter((e) => e && ids.has(e.from) && ids.has(e.to));
  return { ok: true, self: raw.self, nodes, edges };
}
