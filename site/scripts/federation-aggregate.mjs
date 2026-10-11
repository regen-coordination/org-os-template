// federation-aggregate.mjs — PURE, testable aggregation logic. No I/O.
//
// data/instances.yaml is the framework's working registry: it holds the
// maintainer's notes, local paths and drift flags beside each instance's name.
// The site publishes three of its fields and nothing else (operator decision,
// 2026-10-11). scripts/verify-build.mjs fails the build when anything more
// reaches dist/.
import yaml from "js-yaml";

export function parseRegistry(registryYaml) {
  const doc = yaml.load(registryYaml);
  return Array.isArray(doc?.instances) ? doc.instances : [];
}

// The agreed list. A field that is not here is not published.
export const PUBLIC_FIELDS = ["name", "type", "repo"];

export function publicInstance(raw) {
  return {
    name: raw.name ?? raw.id,
    type: raw.type ?? "Instance",
    repo: raw.repo ?? null,
  };
}

// What the home page counts. The registry's lifecycle ends at `production`
// (remote → cloned → synced → production); the entries before it include a test
// fixture, an agent runtime and a development platform, which a reader would not
// take "instances" to mean.
export const OPERATIONAL_DEFINITION =
  "An instance is counted as operational when the framework's registry, data/instances.yaml, records its maturity as production.";

export function isOperational(raw) {
  return raw?.maturity === "production";
}

const ROOT_NODE = {
  name: "org-os", type: "Framework", repo: "https://github.com/regen-coordination/org-os-template",
};

export function aggregate({ registryYaml, now }) {
  const registry = parseRegistry(registryYaml);
  return {
    root: ROOT_NODE,
    nodes: registry.map(publicInstance),
    registered: registry.length,
    operational: registry.filter(isOperational).length,
    operationalDefinition: OPERATIONAL_DEFINITION,
    generatedAt: now,
  };
}

// The map data marks a node `live: false` when its checkout was not beside this
// repository at build time, which is always the case in CI, and the map element
// prints that as a status. Not read at build is not a status: drop the false flag
// and the empty `last_seen`, so the element says nothing. A node that was read
// keeps `live: true`.
export function quietMap(map) {
  return {
    ...map,
    nodes: map.nodes.map((node) => {
      const { live, last_seen, ...rest } = node;
      return {
        ...rest,
        ...(live === true ? { live } : {}),
        ...(last_seen != null ? { last_seen } : {}),
      };
    }),
  };
}
