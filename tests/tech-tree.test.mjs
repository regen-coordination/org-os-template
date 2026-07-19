import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRegistries, validateTree, resolveTree } from "../scripts/lib/tech-tree.mjs";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "tech-tree");
const read = (f) => readFileSync(path.join(FIX, f), "utf8");
const registries = () =>
  parseRegistries({
    packagesYaml: read("packages-matrix.yaml"),
    skillsYaml: read("skills-matrix.yaml"),
    ideasYaml: read("ideas.yaml"),
  });
const validYaml = read("tree-valid.yaml");

test("parseRegistries builds id→status maps for all three registries", () => {
  const r = registries();
  assert.equal(r.package.get("org-os-kms"), "active");
  assert.equal(r.skill.get("research"), "canonical");
  assert.equal(r.idea.get("idea-002"), "developing");
});

test("parseRegistries coverageIds: skills only when in_framework, ideas exclude archived", () => {
  const r = registries();
  assert.deepEqual(r.coverageIds.package, ["org-os-kms", "agents-app", "hermes", "old-widget"]);
  assert.deepEqual(r.coverageIds.skill, ["research", "capital-flow"]);
  assert.deepEqual(r.coverageIds.idea, ["idea-001", "idea-002"]);
});

test("validateTree passes the valid fixture with no errors", () => {
  const { errors } = validateTree({ treeYaml: validYaml, registries: registries() });
  assert.deepEqual(errors, []);
});

test("validateTree: duplicate id, unknown type, bad status", () => {
  const bad = `
meta: { root: "a" }
nodes:
  - { id: "a", type: "capability", label: "A", status: "live" }
  - { id: "a", type: "widget", label: "A2", status: "sideways" }
edges: []
`;
  const { errors } = validateTree({ treeYaml: bad, registries: registries() });
  assert.ok(errors.some((e) => e.includes("duplicate node id: a")));
  assert.ok(errors.some((e) => e.includes('unknown type "widget"')));
  assert.ok(errors.some((e) => e.includes('invalid status "sideways"')));
});

test("validateTree: unresolvable ref and ref-backed node declaring status", () => {
  const bad = `
meta: { root: "a" }
nodes:
  - { id: "a", type: "capability", label: "A", status: "live" }
  - { id: "b", type: "module", label: "B", ref: "package:nope" }
  - { id: "c", type: "module", label: "C", ref: "package:org-os-kms", status: "live" }
  - { id: "d", type: "module", label: "D", ref: "gadget:x" }
edges: []
`;
  const { errors } = validateTree({ treeYaml: bad, registries: registries() });
  assert.ok(errors.some((e) => e.includes('ref "package:nope" not found')));
  assert.ok(errors.some((e) => e.includes("ref-backed node must not declare status")));
  assert.ok(errors.some((e) => e.includes('unknown ref kind "gadget"')));
});

test("validateTree: malformed ref missing colon", () => {
  const bad = `
meta: { root: "a" }
nodes:
  - { id: "a", type: "capability", label: "A", status: "live" }
  - { id: "b", type: "module", label: "B", ref: "packageorgoskms" }
edges: []
`;
  const { errors } = validateTree({ treeYaml: bad, registries: registries() });
  assert.ok(errors.some((e) => e.includes('b: malformed ref "packageorgoskms" (missing ":")')));
  // kind/registry checks are skipped for a malformed ref
  assert.ok(!errors.some((e) => e.includes("unknown ref kind")));
});

test("validateTree: node with multiple part-of parents errors", () => {
  const bad = `
meta: { root: "a" }
nodes:
  - { id: "a", type: "capability", label: "A", status: "live" }
  - { id: "b", type: "capability", label: "B", status: "live" }
  - { id: "c", type: "capability", label: "C", status: "live" }
edges:
  - { from: "c", to: "a", kind: "part-of" }
  - { from: "c", to: "b", kind: "part-of" }
`;
  const { errors } = validateTree({ treeYaml: bad, registries: registries() });
  assert.ok(errors.some((e) => e.includes("c: multiple part-of parents")));
});

test("validateTree: native non-capability without status errors; rollup capability does not", () => {
  const bad = `
meta: { root: "a" }
nodes:
  - { id: "a", type: "capability", label: "A" }
  - { id: "b", type: "integration", label: "B" }
  - { id: "c", type: "capability", label: "C", rollup: false }
edges:
  - { from: "b", to: "a", kind: "part-of" }
  - { from: "c", to: "a", kind: "part-of" }
`;
  const { errors } = validateTree({ treeYaml: bad, registries: registries() });
  assert.ok(errors.some((e) => e.includes("b: native node missing status")));
  assert.ok(errors.some((e) => e.includes("c: native node missing status")));
  assert.ok(!errors.some((e) => e.startsWith("a:")));
});

test("validateTree: edge endpoints, edge kind, part-of cycle, missing root", () => {
  const bad = `
meta: { root: "ghost" }
nodes:
  - { id: "a", type: "capability", label: "A", status: "live" }
  - { id: "b", type: "capability", label: "B", status: "live" }
edges:
  - { from: "a", to: "zzz", kind: "part-of" }
  - { from: "nope", to: "a", kind: "part-of" }
  - { from: "a", to: "b", kind: "vibes" }
  - { from: "a", to: "b", kind: "part-of" }
  - { from: "b", to: "a", kind: "part-of" }
`;
  const { errors } = validateTree({ treeYaml: bad, registries: registries() });
  assert.ok(errors.some((e) => e.includes('unknown "to"')));
  assert.ok(errors.some((e) => e.includes('unknown "from"')));
  assert.ok(errors.some((e) => e.includes('unknown kind "vibes"')));
  assert.ok(errors.some((e) => e.includes("part-of cycle")));
  assert.ok(errors.some((e) => e.includes('meta.root "ghost" is not a node')));
});

test("validateTree warns on nodes unreachable from root via part-of", () => {
  const treeYaml = `
meta: { root: "a" }
nodes:
  - { id: "a", type: "capability", label: "A", status: "live" }
  - { id: "b", type: "integration", label: "B", status: "live" }
edges: []
`;
  const { errors, warnings } = validateTree({ treeYaml, registries: registries() });
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes("b: not connected to root via part-of")));
});

test("validateTree warns on coverage drift, honoring coverageIds filters", () => {
  const { warnings } = validateTree({ treeYaml: validYaml, registries: registries() });
  // valid fixture places org-os-kms, research, idea-001 — the rest of the worklist drifts:
  assert.ok(warnings.some((w) => w.includes("coverage: package:agents-app not placed in tree")));
  assert.ok(warnings.some((w) => w.includes("coverage: skill:capital-flow not placed in tree")));
  assert.ok(warnings.some((w) => w.includes("coverage: idea:idea-002 not placed in tree")));
  // NOT warned: in_framework:false skill and archived idea
  assert.ok(!warnings.some((w) => w.includes("dao-module")));
  assert.ok(!warnings.some((w) => w.includes("idea-003")));
});

test("resolveTree maps ref-backed statuses per spec §4", () => {
  const g = resolveTree({ treeYaml: validYaml, registries: registries() });
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  assert.equal(byId.get("mod-kms").status, "live"); // package active → live
  assert.equal(byId.get("mod-kms").statusSource, "package-registry");
  assert.equal(byId.get("skl-research").status, "live"); // skill canonical → live
  assert.equal(byId.get("idea-hatch").status, "ideation"); // idea surfaced → ideation
  assert.equal(byId.get("int-notion").status, "live");
  assert.equal(byId.get("int-notion").statusSource, "declared");
});

test("resolveTree rollup: capability takes most-advanced child; explicit status overrides", () => {
  const g = resolveTree({ treeYaml: validYaml, registries: registries() });
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  // cap-knowledge children: live, live, ideation, live → live
  assert.equal(byId.get("cap-knowledge").status, "live");
  assert.equal(byId.get("cap-knowledge").statusSource, "rollup");
  // explicit status wins over rollup
  assert.equal(byId.get("cap-empty").status, "planned");
  assert.equal(byId.get("cap-empty").statusSource, "declared");
  // root rolls up through capabilities
  assert.equal(byId.get("org-os").status, "live");
});

test("resolveTree rollup ignores dormant/retired children", () => {
  const treeYaml = `
meta: { root: "r" }
nodes:
  - { id: "r", type: "capability", label: "R" }
  - { id: "cap", type: "capability", label: "Cap" }
  - { id: "m1", type: "module", label: "M1", ref: "package:agents-app" }
  - { id: "i1", type: "idea", label: "I1", ref: "idea:idea-001" }
edges:
  - { from: "cap", to: "r", kind: "part-of" }
  - { from: "m1", to: "cap", kind: "part-of" }
  - { from: "i1", to: "cap", kind: "part-of" }
`;
  const g = resolveTree({ treeYaml, registries: registries() });
  const cap = g.nodes.find((n) => n.id === "cap");
  assert.equal(cap.status, "ideation"); // dormant m1 excluded; ideation i1 wins
});

test("resolveTree throws on invalid tree and on rollup with no rankable children", () => {
  assert.throws(
    () => resolveTree({ treeYaml: `meta: { root: "x" }\nnodes: []\nedges: []`, registries: registries() }),
    /tech-tree invalid/,
  );
  const treeYaml = `
meta: { root: "r" }
nodes:
  - { id: "r", type: "capability", label: "R" }
  - { id: "cap", type: "capability", label: "Cap" }
  - { id: "m1", type: "module", label: "M1", ref: "package:agents-app" }
edges:
  - { from: "cap", to: "r", kind: "part-of" }
  - { from: "m1", to: "cap", kind: "part-of" }
`;
  assert.throws(() => resolveTree({ treeYaml, registries: registries() }), /no rankable children/);
});

test("resolveTree stats: counts, and moved vs previous output", () => {
  const g1 = resolveTree({ treeYaml: validYaml, registries: registries() });
  assert.equal(g1.stats.total, 7);
  assert.equal(g1.stats.byStatus.live, 5);
  assert.equal(g1.stats.byStatus.ideation, 1);
  assert.equal(g1.stats.byType.capability, 3);
  assert.deepEqual(g1.stats.moved, []); // no previous
  const previous = {
    nodes: g1.nodes.map((n) => (n.id === "mod-kms" ? { ...n, status: "in-dev" } : n)).filter((n) => n.id !== "int-notion"),
  };
  const g2 = resolveTree({ treeYaml: validYaml, registries: registries(), previous });
  assert.deepEqual(
    g2.stats.moved.sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: "int-notion", from: null, to: "live" },
      { id: "mod-kms", from: "in-dev", to: "live" },
    ],
  );
});

test("resolveTree frontier: clusters by capability ancestor + gap notes", () => {
  const g = resolveTree({ treeYaml: validYaml, registries: registries() });
  const cluster = g.frontier.clusters.find((c) => c.capability === "cap-knowledge");
  assert.deepEqual(cluster.items, ["idea-hatch"]);
  // cap-knowledge has no in-dev child → gap
  assert.ok(g.frontier.gaps.some((gap) => gap.includes("cap-knowledge") && gap.includes("no in-dev child")));
  // cap-empty is itself planned → frontier under its ancestor org-os
  const rootCluster = g.frontier.clusters.find((c) => c.capability === "org-os");
  assert.deepEqual(rootCluster.items, ["cap-empty"]);
});

test("resolveTree output nodes carry parent, ref, links, driving", () => {
  const g = resolveTree({ treeYaml: validYaml, registries: registries() });
  const notion = g.nodes.find((n) => n.id === "int-notion");
  assert.equal(notion.parent, "cap-knowledge");
  assert.deepEqual(notion.driving, ["project:federation-protocol"]);
  assert.equal(g.meta.root, "org-os");
});
