import { test } from "node:test";
import assert from "node:assert/strict";
import { collapseSkills, dominantStatus, treeLayout } from "../src/scripts/tech-tree/layouts.mjs";

const graph = {
  meta: { root: "r" },
  nodes: [
    { id: "r", type: "capability", label: "R", status: "live", parent: null },
    { id: "cap", type: "capability", label: "Cap", status: "live", parent: "r" },
    { id: "s1", type: "skill", label: "s1", status: "live", parent: "cap" },
    { id: "s2", type: "skill", label: "s2", status: "in-dev", parent: "cap" },
    { id: "m1", type: "module", label: "m1", status: "planned", parent: "cap" },
    { id: "d1", type: "module", label: "d1", status: "dormant", parent: "cap" },
  ],
  edges: [
    { from: "cap", to: "r", kind: "part-of" },
    { from: "s1", to: "cap", kind: "part-of" },
    { from: "s2", to: "cap", kind: "part-of" },
    { from: "m1", to: "cap", kind: "part-of" },
    { from: "d1", to: "cap", kind: "part-of" },
    { from: "m1", to: "s1", kind: "depends-on" },
  ],
};

test("dominantStatus prefers most-real status, then tray", () => {
  assert.equal(dominantStatus(["planned", "live", "ideation"]), "live");
  assert.equal(dominantStatus(["dormant", "retired"]), "dormant");
});

test("collapseSkills replaces skills with one cluster per capability", () => {
  const g = collapseSkills(graph, new Set());
  assert.ok(!g.nodes.some((n) => n.type === "skill"));
  const cluster = g.nodes.find((n) => n.id === "cluster:cap");
  assert.equal(cluster.label, "skills ×2");
  assert.equal(cluster.status, "live");
  assert.deepEqual(cluster.members, ["s1", "s2"]);
  // edges touching hidden skills are dropped; cluster hangs off the capability
  assert.ok(!g.edges.some((e) => e.from === "s1" || e.to === "s1"));
  assert.ok(g.edges.some((e) => e.from === "cluster:cap" && e.to === "cap" && e.kind === "part-of"));
});

test("collapseSkills leaves expanded capabilities alone", () => {
  const g = collapseSkills(graph, new Set(["cap"]));
  assert.ok(g.nodes.some((n) => n.id === "s1"));
  assert.ok(!g.nodes.some((n) => n.id === "cluster:cap"));
});

test("treeLayout: radial — root at centre, deeper nodes farther out", () => {
  const pos = treeLayout(graph, 800, 600, "r");
  const cx = 400;
  const cy = 300;
  const dist = (id) => Math.hypot(pos.get(id).x - cx, pos.get(id).y - cy);
  assert.ok(dist("r") < 1); // root sits at the centre
  assert.ok(dist("cap") > 1); // depth-1 node is off-centre
  assert.ok(dist("s1") > dist("cap")); // depth-2 node is farther out than depth-1
  for (const n of graph.nodes) assert.ok(pos.has(n.id));
});
