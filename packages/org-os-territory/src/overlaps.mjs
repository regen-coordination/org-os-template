// packages/org-os-territory/src/overlaps.mjs — the contract for data/territory-overlaps.json: cross-layer overlap SHARES.
// Derived and recomputable from geometry, so it is a generated sidecar — never a knowledge object, never published.
// `overlaps_with` on a territorial-unit is the list of the other sides, without shares. Pure: no I/O, no geometry.
export const OVERLAPS_PATH = 'data/territory-overlaps.json';

const share = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1;

/** Validate a sidecar document against an indexUnits() index. Reports every problem, not just the first. */
export function validateOverlaps(doc, index) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { valid: false, errors: ['document must be an object'] };
  const errors = [];
  if (doc.version !== 1) errors.push(`version must be 1, got ${JSON.stringify(doc.version)}`);
  if (typeof doc.method !== 'string' || !doc.method) errors.push('method is required (how the shares were computed)');
  if (!Array.isArray(doc.overlaps)) { errors.push('overlaps must be an array'); return { valid: false, errors }; }
  const seen = new Set();
  doc.overlaps.forEach((o, i) => {
    const at = `overlaps[${i}]`;
    const ua = index.byId.get(o?.a); const ub = index.byId.get(o?.b);
    if (!ua) return errors.push(`${at}: unknown unit_id: ${o?.a}`);
    if (!ub) return errors.push(`${at}: unknown unit_id: ${o?.b}`);
    if (o.a === o.b) return errors.push(`${at}: a and b are the same unit`);
    if (ua.layer === ub.layer) return errors.push(`${at}: same layer (${ua.layer}) — overlaps are cross-layer; same-layer nesting is part_of`);
    const key = [o.a, o.b].sort().join('|');
    if (seen.has(key)) return errors.push(`${at}: duplicate pair ${o.a} / ${o.b}`);
    seen.add(key);
    for (const k of ['share_a', 'share_b']) if (!share(o[k])) errors.push(`${at}: ${k} must be a number in (0, 1]`);
  });
  return { valid: errors.length === 0, errors };
}
