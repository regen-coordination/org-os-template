// layouts.mjs — pure data transforms + deterministic layouts for the tech-tree
// graph. No DOM, no d3 — testable with node --test. Force layouts (hybrid /
// constellation) live in app.mjs since they need the d3 simulation loop.
export const STATUS_ORDER = ["live", "in-dev", "planned", "ideation"];
export const TRAY = ["dormant", "retired"];

// Fraction of the canvas radius each status sits at in the hybrid view —
// "how real" maps to distance from the core (frontier at the rim).
export const STATUS_RADIUS = {
  live: 0.18,
  "in-dev": 0.38,
  planned: 0.58,
  ideation: 0.85,
  dormant: 0.7,
  retired: 0.95,
};

export function dominantStatus(statuses) {
  for (const s of STATUS_ORDER) if (statuses.includes(s)) return s;
  for (const s of TRAY) if (statuses.includes(s)) return s;
  return "ideation";
}

// Collapse skill nodes into one "skills ×N" supernode per parent capability,
// unless that capability id is in `expanded`. Edges touching hidden skills are
// dropped (skills' own cross-edges reappear when expanded).
export function collapseSkills(graph, expanded = new Set()) {
  const hide = new Set(
    graph.nodes.filter((n) => n.type === "skill" && n.parent && !expanded.has(n.parent)).map((n) => n.id),
  );
  const byParent = new Map();
  for (const n of graph.nodes) {
    if (!hide.has(n.id)) continue;
    if (!byParent.has(n.parent)) byParent.set(n.parent, []);
    byParent.get(n.parent).push(n);
  }
  const nodes = graph.nodes.filter((n) => !hide.has(n.id));
  const edges = graph.edges.filter((e) => !hide.has(e.from) && !hide.has(e.to));
  for (const [parent, members] of byParent) {
    const id = `cluster:${parent}`;
    nodes.push({
      id,
      type: "skill-cluster",
      parent,
      label: `skills ×${members.length}`,
      status: dominantStatus(members.map((m) => m.status)),
      statusSource: "cluster",
      summary: `${members.length} skills — click to expand`,
      members: members.map((m) => m.id),
      ref: null,
      links: [],
      driving: [],
    });
    edges.push({ from: id, to: parent, kind: "part-of" });
  }
  return { ...graph, nodes, edges };
}

// Radial hierarchy from part-of parents: root at the centre, depth → radius
// (growth rings), each subtree owning an angular wedge sized by its leaf count.
// Returns Map id → {x, y}.
export function treeLayout(graph, width, height, rootId) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const childrenOf = new Map();
  for (const n of graph.nodes) {
    if (!n.parent) continue;
    if (!childrenOf.has(n.parent)) childrenOf.set(n.parent, []);
    childrenOf.get(n.parent).push(n.id);
  }
  for (const kids of childrenOf.values()) {
    kids.sort((a, b) => byId.get(a).label.localeCompare(byId.get(b).label));
  }

  // Leaf count per subtree drives each child's share of its parent's wedge.
  const leaves = new Map();
  const countLeaves = (id, seen = new Set()) => {
    if (leaves.has(id)) return leaves.get(id);
    if (seen.has(id)) return 1; // defensive; part-of is validated acyclic upstream
    seen.add(id);
    const kids = childrenOf.get(id) ?? [];
    const c = kids.length ? kids.reduce((s, k) => s + countLeaves(k, seen), 0) : 1;
    leaves.set(id, c);
    return c;
  };
  countLeaves(rootId);

  // Depth per node (radius ring); track the deepest to scale the rings.
  const depth = new Map();
  const setDepth = (id, d, seen = new Set()) => {
    if (seen.has(id)) return;
    seen.add(id);
    depth.set(id, d);
    for (const k of childrenOf.get(id) ?? []) setDepth(k, d + 1, seen);
  };
  setDepth(rootId, 0);
  const maxDepth = Math.max(1, ...depth.values());

  const cx = width / 2;
  const cy = height / 2;
  const ring = (Math.min(width, height) / 2 - 40) / maxDepth;
  const pos = new Map();

  const assign = (id, a0, a1, seen = new Set()) => {
    if (seen.has(id)) return;
    seen.add(id);
    const angle = (a0 + a1) / 2;
    const r = (depth.get(id) ?? 0) * ring;
    pos.set(id, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    const kids = childrenOf.get(id) ?? [];
    const total = kids.reduce((s, k) => s + (leaves.get(k) ?? 1), 0) || 1;
    let a = a0;
    for (const k of kids) {
      const span = (a1 - a0) * ((leaves.get(k) ?? 1) / total);
      assign(k, a, a + span, seen);
      a += span;
    }
  };
  assign(rootId, -Math.PI / 2, (3 * Math.PI) / 2); // start straight up

  // Any node not reached from the root (orphan) falls back to the centre.
  for (const n of graph.nodes) if (!pos.has(n.id)) pos.set(n.id, { x: cx, y: cy });
  return pos;
}
