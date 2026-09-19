// packages/org-os-territory/src/units.mjs — query by place. Pure: index the unit tree, walk part_of. No geometry, no I/O.
// Any object may carry `unit_refs: [<unit_id>…]` (the framework's model is open); an unknown ref is reported, never thrown —
// whether it is an error is the instance's lint to decide.

/** Index territorial-unit objects. Throws on a missing/duplicate unit_id and on a dangling, cross-layer or cyclic part_of. */
export function indexUnits(units = []) {
  const byId = new Map(); const children = new Map();
  for (const unit of units) {
    if (!unit.unit_id) throw new Error(`unit without unit_id: ${JSON.stringify(unit.title ?? null)}`);
    if (byId.has(unit.unit_id)) throw new Error(`duplicate unit_id: ${unit.unit_id}`);
    byId.set(unit.unit_id, unit);
  }
  for (const unit of units) {
    if (!unit.part_of) continue;
    const parent = byId.get(unit.part_of);
    if (!parent) throw new Error(`${unit.unit_id}: part_of names a missing unit: ${unit.part_of}`);
    if (parent.layer !== unit.layer) throw new Error(`${unit.unit_id}: part_of crosses layers (${unit.layer} -> ${parent.layer})`);
    if (!children.has(parent.unit_id)) children.set(parent.unit_id, []);
    children.get(parent.unit_id).push(unit.unit_id);
  }
  for (const unit of units) {
    const seen = new Set([unit.unit_id]);
    for (let p = unit.part_of; p; p = byId.get(p).part_of) {
      if (seen.has(p)) throw new Error(`part_of cycle at ${p}`);
      seen.add(p);
    }
  }
  return { byId, children };
}

const refsOf = (obj) => [...new Set([...(obj.type === 'territorial-unit' && obj.unit_id ? [obj.unit_id] : []), ...(Array.isArray(obj.unit_refs) ? obj.unit_refs : [])])];

/** The object's units plus their part_of ancestors (refs first), and the refs the index does not know. */
export function unitsFor(obj, index) {
  const known = []; const unknown = [];
  for (const ref of refsOf(obj || {})) (index.byId.has(ref) ? known : unknown).push(ref);
  const units = [...known];
  for (const ref of known) {
    for (let p = index.byId.get(ref).part_of; p; p = index.byId.get(p).part_of) if (!units.includes(p)) units.push(p);
  }
  return { units, unknown };
}

/** Objects placed in a unit — by default also those placed in any unit beneath it. */
export function objectsIn(unit_id, objects = [], index, { includeDescendants = true } = {}) {
  if (!index.byId.has(unit_id)) throw new Error(`unknown unit_id: ${unit_id}`);
  return objects.filter((o) => {
    if (!includeDescendants) return refsOf(o).includes(unit_id);
    return unitsFor(o, index).units.includes(unit_id);
  });
}
