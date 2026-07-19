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
      if (!n.ref.includes(":")) {
        errors.push(`${n.id}: malformed ref "${n.ref}" (missing ":")`);
      } else {
        const [kind, id] = refParts(n.ref);
        if (!REF_MAPS[kind]) errors.push(`${n.id}: unknown ref kind "${kind}"`);
        else if (!registries[kind].has(id)) errors.push(`${n.id}: ref "${n.ref}" not found in ${kind} registry`);
      }
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

  // part-of is a tree hierarchy: each node has ≤1 parent (spec §3).
  const parentOf = new Map();
  const multiParent = new Set();
  for (const e of edges.filter((e) => e.kind === "part-of")) {
    if (parentOf.has(e.from) && !multiParent.has(e.from)) {
      errors.push(`${e.from}: multiple part-of parents`);
      multiParent.add(e.from);
    }
    parentOf.set(e.from, e.to);
  }
  // part-of must be acyclic (child --part-of--> parent chains).
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

  // Reachability warning: every node should hang off the root via part-of.
  if (root && byId.has(root)) {
    for (const n of nodes) {
      if (n.id === root) continue;
      let cur = n.id;
      let hops = 0;
      let reached = false;
      while (parentOf.has(cur) && hops++ < nodes.length) {
        cur = parentOf.get(cur);
        if (cur === root) {
          reached = true;
          break;
        }
      }
      if (!reached) warnings.push(`${n.id}: not connected to root via part-of`);
    }
  }

  // Coverage drift: registry entries that exist but were never placed in the tree.
  const referenced = new Set(nodes.filter((n) => n.ref).map((n) => n.ref));
  for (const [kind, ids] of Object.entries(registries.coverageIds ?? {})) {
    for (const id of ids) {
      if (!referenced.has(`${kind}:${id}`)) warnings.push(`coverage: ${kind}:${id} not placed in tree`);
    }
  }

  return { errors, warnings };
}

export function resolveTree({ treeYaml, registries, previous = null }) {
  const { errors } = validateTree({ treeYaml, registries });
  if (errors.length) throw new Error(`tech-tree invalid:\n  ${errors.join("\n  ")}`);

  const doc = yaml.load(treeYaml);
  const nodes = doc.nodes ?? [];
  const edges = doc.edges ?? [];
  const root = doc.meta.root;

  const childrenOf = new Map();
  const parentOf = new Map();
  for (const e of edges) {
    if (e.kind !== "part-of") continue;
    parentOf.set(e.from, e.to);
    if (!childrenOf.has(e.to)) childrenOf.set(e.to, []);
    childrenOf.get(e.to).push(e.from);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cache = new Map();

  function resolveStatus(id) {
    if (cache.has(id)) return cache.get(id);
    const n = byId.get(id);
    let out;
    if (n.ref) {
      const [kind, rid] = refParts(n.ref);
      const raw = registries[kind].get(rid);
      const status = REF_MAPS[kind][raw];
      if (!status) throw new Error(`${id}: unmappable ${kind} status "${raw}"`);
      out = { status, statusSource: `${kind}-registry` };
    } else if (n.status) {
      out = { status: n.status, statusSource: "declared" };
    } else {
      // Capability (or root) rollup — part-of is acyclic (validated), so this terminates.
      const ranked = (childrenOf.get(id) ?? [])
        .map((k) => resolveStatus(k).status)
        .filter((s) => s in ROLLUP_RANK)
        .sort((a, b) => ROLLUP_RANK[a] - ROLLUP_RANK[b]);
      if (!ranked.length) throw new Error(`${id}: rollup found no rankable children and no explicit status`);
      out = { status: ranked[0], statusSource: "rollup" };
    }
    cache.set(id, out);
    return out;
  }

  const outNodes = nodes.map((n) => {
    const { status, statusSource } = resolveStatus(n.id);
    return {
      id: n.id,
      type: n.type,
      label: n.label,
      summary: n.summary ?? null,
      status,
      statusSource,
      ref: n.ref ?? null,
      links: n.links ?? [],
      driving: n.driving ?? [],
      parent: parentOf.get(n.id) ?? null,
    };
  });

  const byStatus = {};
  const byType = {};
  for (const n of outNodes) {
    byStatus[n.status] = (byStatus[n.status] ?? 0) + 1;
    byType[n.type] = (byType[n.type] ?? 0) + 1;
  }
  const moved = [];
  if (previous?.nodes) {
    const prev = new Map(previous.nodes.map((n) => [n.id, n.status]));
    for (const n of outNodes) {
      const was = prev.get(n.id);
      if (was === undefined) moved.push({ id: n.id, from: null, to: n.status });
      else if (was !== n.status) moved.push({ id: n.id, from: was, to: n.status });
    }
  }

  // Frontier: ideation/planned nodes clustered by nearest capability ancestor.
  const capAncestor = (id) => {
    let cur = parentOf.get(id);
    while (cur && cur !== root && byId.get(cur)?.type !== "capability") cur = parentOf.get(cur);
    return cur ?? root;
  };
  const clusterMap = new Map();
  for (const n of outNodes) {
    if (n.status !== "ideation" && n.status !== "planned") continue;
    const cap = capAncestor(n.id);
    if (!clusterMap.has(cap)) clusterMap.set(cap, []);
    clusterMap.get(cap).push(n.id);
  }
  const gaps = [];
  for (const [cap, items] of clusterMap) {
    const kids = childrenOf.get(cap) ?? [];
    const hasInDev = kids.some((k) => cache.get(k)?.status === "in-dev");
    if (!hasInDev) gaps.push(`${cap}: ${items.length} frontier node(s) but no in-dev child`);
  }

  return {
    meta: { root, schema_version: doc.schema_version ?? "1.0" },
    nodes: outNodes,
    edges,
    stats: { total: outNodes.length, byStatus, byType, moved },
    frontier: {
      clusters: [...clusterMap.entries()].map(([capability, items]) => ({ capability, items })),
      gaps,
    },
  };
}
