import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRegistries, validateTree } from "../scripts/lib/tech-tree.mjs";

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
