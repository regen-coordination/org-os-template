// tech-tree.mjs — pure logic for the tech-tree overlay registry (data/tech-tree.yaml):
// parse the source registries, validate the tree, resolve statuses (refs + rollups),
// compute stats + frontier. No filesystem access — callers pass YAML strings.
// Spec: docs/superpowers/specs/2026-07-19-tech-tree-design.md
import yaml from "js-yaml";

export const STATUSES = ["live", "in-dev", "planned", "ideation", "dormant", "retired"];
export const NODE_TYPES = ["capability", "module", "skill", "integration", "standard", "idea"];
export const EDGE_KINDS = ["part-of", "depends-on", "enables", "supersedes"];

// Rollup considers only "how real" statuses; dormant/retired are excluded (spec §4).
const ROLLUP_RANK = { live: 0, "in-dev": 1, planned: 2, ideation: 3 };

const REF_MAPS = {
  package: { active: "live", dormant: "dormant", planned: "planned", retired: "retired" },
  skill: {
    canonical: "live",
    evaluating: "dormant",
    candidate: "in-dev",
    "instance-specific": "dormant",
    deprecated: "retired",
  },
  idea: {
    surfaced: "ideation",
    proposed: "ideation",
    approved: "planned",
    developing: "in-dev",
    hatched: "live",
    archived: "retired",
  },
};

export function parseRegistries({ packagesYaml, skillsYaml, ideasYaml }) {
  const pkgs = yaml.load(packagesYaml)?.packages ?? [];
  const skills = yaml.load(skillsYaml)?.skills ?? [];
  const ideas = yaml.load(ideasYaml)?.ideas ?? [];
  return {
    package: new Map(pkgs.map((p) => [p.id, p.lifecycle_status])),
    skill: new Map(skills.map((s) => [s.id, s.promotion_status])),
    idea: new Map(ideas.map((i) => [i.id, i.status])),
    // Coverage worklist: what SHOULD be placed in the tree (validator warns on absence).
    coverageIds: {
      package: pkgs.map((p) => p.id),
      skill: skills.filter((s) => s.in_framework).map((s) => s.id),
      idea: ideas.filter((i) => i.status !== "archived").map((i) => i.id),
    },
  };
}

function refParts(ref) {
  const i = ref.indexOf(":");
  return [ref.slice(0, i), ref.slice(i + 1)];
}

export function validateTree({ treeYaml, registries }) {
  const errors = [];
  const warnings = [];
  const doc = yaml.load(treeYaml);
  const nodes = doc?.nodes ?? [];
  const edges = doc?.edges ?? [];
  const root = doc?.meta?.root;
  const byId = new Map();

  for (const n of nodes) {
    if (byId.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    byId.set(n.id, n);
    if (!NODE_TYPES.includes(n.type)) errors.push(`${n.id}: unknown type "${n.type}"`);
    if (n.status && !STATUSES.includes(n.status)) errors.push(`${n.id}: invalid status "${n.status}"`);
    if (n.ref) {
      const [kind, id] = refParts(n.ref);
      if (!REF_MAPS[kind]) errors.push(`${n.id}: unknown ref kind "${kind}"`);
      else if (!registries[kind].has(id)) errors.push(`${n.id}: ref "${n.ref}" not found in ${kind} registry`);
      if (n.status) errors.push(`${n.id}: ref-backed node must not declare status`);
    } else if (!n.status && n.id !== root && !(n.type === "capability" && n.rollup !== false)) {
      // Native nodes need a status — except capabilities left to rollup, and the root.
      errors.push(`${n.id}: native node missing status`);
    }
  }
  if (!root || !byId.has(root)) errors.push(`meta.root "${root}" is not a node`);

  for (const e of edges) {
    if (!byId.has(e.from)) errors.push(`edge ${e.from}→${e.to}: unknown "from"`);
    if (!byId.has(e.to)) errors.push(`edge ${e.from}→${e.to}: unknown "to"`);
    if (!EDGE_KINDS.includes(e.kind)) errors.push(`edge ${e.from}→${e.to}: unknown kind "${e.kind}"`);
  }

  // part-of must be acyclic (child --part-of--> parent chains).
  const parentOf = new Map(edges.filter((e) => e.kind === "part-of").map((e) => [e.from, e.to]));
  for (const start of parentOf.keys()) {
    const seen = new Set([start]);
    let cur = parentOf.get(start);
    while (cur != null) {
      if (seen.has(cur)) {
        errors.push(`part-of cycle involving ${start}`);
        break;
      }
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  }

  return { errors, warnings };
}
