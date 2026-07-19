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

// Deterministic civ-style columns: live → in-dev → planned → ideation,
// dormant/retired in a bottom tray. Returns Map id → {x, y}.
export function techtreeLayout(graph, width, height) {
  const pos = new Map();
  const colW = width / STATUS_ORDER.length;
  STATUS_ORDER.forEach((status, c) => {
    const col = graph.nodes
      .filter((n) => n.status === status)
      .sort((a, b) => (a.parent ?? "").localeCompare(b.parent ?? "") || a.label.localeCompare(b.label));
    col.forEach((n, i) => pos.set(n.id, { x: colW * (c + 0.5), y: ((i + 1) * (height - 60)) / (col.length + 1) }));
  });
  const tray = graph.nodes.filter((n) => TRAY.includes(n.status));
  tray.forEach((n, i) => pos.set(n.id, { x: ((i + 1) * width) / (tray.length + 1), y: height - 24 }));
  return pos;
}

// Trunk-up hierarchy from part-of parents: root at the bottom, children rise.
// Returns Map id → {x, y}.
export function treeLayout(graph, width, height, rootId) {
  const depth = new Map([[rootId, 0]]);
  const resolveDepth = (id, seen = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 1; // defensive; part-of is validated acyclic upstream
    seen.add(id);
    const n = graph.nodes.find((x) => x.id === id);
    const d = n?.parent ? resolveDepth(n.parent, seen) + 1 : 1;
    depth.set(id, d);
    return d;
  };
  for (const n of graph.nodes) resolveDepth(n.id);
  const maxDepth = Math.max(...depth.values());
  const rows = new Map();
  for (const n of graph.nodes) {
    const d = depth.get(n.id);
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d).push(n);
  }
  const pos = new Map();
  for (const [d, row] of rows) {
    row.sort((a, b) => (a.parent ?? "").localeCompare(b.parent ?? "") || a.label.localeCompare(b.label));
    row.forEach((n, i) =>
      pos.set(n.id, {
        x: ((i + 1) * width) / (row.length + 1),
        y: height - ((d + 0.5) * height) / (maxDepth + 1),
      }),
    );
  }
  return pos;
}
