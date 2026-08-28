// src/hash.mjs
// FNV-1a → stable initial angle per node id. Deterministic start = same data,
// same map (spec §4) — the layout breathes on settle but never reshuffles.
export function hashAngle(id) {
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h / 0x100000000) * Math.PI * 2;
}
