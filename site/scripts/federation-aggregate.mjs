// federation-aggregate.mjs — PURE, testable aggregation logic. No process I/O here
// except the defensive disk reads in enrichFromDisk (which never throw).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";

export function parseRegistry(registryYaml) {
  const doc = yaml.load(registryYaml);
  return Array.isArray(doc?.instances) ? doc.instances : [];
}

export function toNode(raw) {
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    type: raw.type ?? "Instance",
    maturity: raw.maturity ?? null,
    role: raw.federation_role ?? null,
    network: raw.federation_network || null,
    frameworkVersion: raw.framework_version ?? null,
    packages: Array.isArray(raw.packages) ? raw.packages : [],
    drift: Array.isArray(raw.drift) ? raw.drift : [],
    repo: raw.repo ?? null,
    notes: raw.notes ?? "",
    localPath: raw.local_path ?? null,
    available: false,
    counts: {},
  };
}

function safeCount(path, key) {
  try {
    if (!existsSync(path)) return undefined;
    const data = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(data?.[key]) ? data[key].length : undefined;
  } catch {
    return undefined;
  }
}

// Reads <instanceAbsPath>/.well-known/*.json defensively. Never throws.
export function enrichFromDisk(node, instanceAbsPath) {
  const wk = join(instanceAbsPath, ".well-known");
  if (!existsSync(wk)) return { ...node, available: false, counts: {} };
  const counts = {};
  const members = safeCount(join(wk, "members.json"), "members");
  const projects = safeCount(join(wk, "projects.json"), "projects");
  if (members !== undefined) counts.members = members;
  if (projects !== undefined) counts.projects = projects;
  return { ...node, available: true, counts };
}

export function deriveEdges(nodes, rootId) {
  const edges = [];
  const hubByNetwork = new Map();
  for (const n of nodes) if (n.role === "hub" && n.network) hubByNetwork.set(n.network, n.id);
  for (const n of nodes) {
    if (n.frameworkVersion) edges.push({ from: n.id, to: rootId, kind: "framework" });
    if (n.role === "spoke" && n.network && hubByNetwork.has(n.network)) {
      edges.push({ from: n.id, to: hubByNetwork.get(n.network), kind: "federation" });
    }
  }
  return edges;
}

const ROOT_NODE = {
  id: "org-os", name: "org-os", type: "Framework", maturity: "production",
  role: "root", network: null, frameworkVersion: null, packages: [], drift: [],
  repo: "https://github.com/regen-coordination/org-os-template", notes: "Framework + standards + orchestration hub.",
  localPath: ".", available: true, counts: {},
};

// baseDir = the org-os root (instances' local_path is relative to it).
export function aggregate({ registryYaml, baseDir, now }) {
  const nodes = parseRegistry(registryYaml)
    .map(toNode)
    .map((n) => (n.localPath ? enrichFromDisk(n, resolve(baseDir, n.localPath)) : n));
  const edges = deriveEdges(nodes, ROOT_NODE.id);
  return { root: ROOT_NODE, nodes, edges, generatedAt: now };
}
