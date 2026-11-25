// federation-aggregate.mjs — PURE, testable aggregation logic. No I/O.
//
// data/instances.yaml is the framework's working registry: it holds the
// maintainer's notes, local paths and drift flags beside each instance's name.
// The site publishes three of its fields and nothing else (operator decision,
// 2026-10-11). scripts/verify-build.mjs fails the build when anything more
// reaches dist/. An entry the registry marks `listed: false` is not published
// at all, and is in neither count (same decision).
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
// take "instances" to mean. The label is the maintainer's judgement, not a
// measurement, and the registry's dates of last sync are not published, so the
// definition says who sets it.
export const OPERATIONAL_DEFINITION =
  "An instance is counted as operational when the framework's registry, data/instances.yaml, records its maturity as production. The maintainer sets that value by hand; the site does not measure it.";

export function isOperational(raw) {
  return raw?.maturity === "production";
}

// `listed` is the registry's own flag for "keep this entry off a public list":
// optional, default true. Only the literal false unlists, and a missing field
// lists. A value that is neither true nor false never gets this far in a build:
// listedProblems, below, stops it. `listed` chooses what is published and is
// not in PUBLIC_FIELDS: it never reaches the output.
export function isListed(raw) {
  return raw?.listed !== false;
}

// A `listed` that is there and is not a boolean is a mistake, and isListed alone
// would publish the entry: `listed: "false"`, `no` and `0` are not the literal
// false. The repository's test of the field does not run in the workflow that
// deploys the site, so the build refuses here: aggregate() throws these
// sentences and verify-build.mjs fails on them. One sentence per entry.
export function listedProblems(registry) {
  const kindOf = (value) =>
    value === null || value === "" ? "empty"
    : Array.isArray(value) ? "a list"
    : typeof value === "object" ? "a mapping"
    : `a ${typeof value}`;
  const problems = [];
  registry.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || !("listed" in raw) || typeof raw.listed === "boolean") return;
    const who = raw.id ?? raw.name;
    const entry = who != null ? `"${who}"` : `entry ${index + 1}`;
    problems.push(`data/instances.yaml: ${entry} has listed: ${JSON.stringify(raw.listed)} (${kindOf(raw.listed)}). \`listed\` must be the bare word true or false. Write \`listed: false\`, without quotes, to keep the entry off the public list, or remove the line to list it. Nothing was built: as written the entry would be published.`);
  });
  return problems;
}

// What the site says about the registry, by one rule, for the aggregator that
// writes it and the verifier that checks it: the listed entries as public nodes,
// how many they are, how many of them are operational, and the entries left out
// (which the verifier looks for in what was built).
export function registryView(registry) {
  const listed = registry.filter(isListed);
  return {
    nodes: listed.map(publicInstance),
    registered: listed.length,
    operational: listed.filter(isOperational).length,
    unlisted: registry.filter((raw) => !isListed(raw)).map(publicInstance),
  };
}

const ROOT_NODE = {
  name: "org-os", type: "Framework", repo: "https://github.com/regen-coordination/org-os-template",
};

export function aggregate({ registryYaml, now }) {
  const registry = parseRegistry(registryYaml);
  const mistyped = listedProblems(registry);
  if (mistyped.length > 0) throw new Error(mistyped.join("\n"));
  const { nodes, registered, operational } = registryView(registry);
  return {
    root: ROOT_NODE,
    nodes,
    registered,
    operational,
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
