// map-addresses.mjs — what the published map (public/map.json) may carry. Operator decisions 3c, 7 and 8, 2026-11-07.
//
// The map is drawn from federation.yaml and the committed frontier caches, which have no `listed` flag and record
// whatever address an instance wrote: workspace paths, folders inside a private repository, names nobody owns. The
// aggregator passes the map through publicMap before writing it; the verifier runs mapProblems on the built copy and
// fails the build on anything that slipped through.

import { createHash } from "node:crypto";

// Repositories the map's sources link to that are private, kept as the SHA-256 of `owner/name` in lower case, so
// this file does not itself say which repositories are private. Checked by hand
// (`gh api repos/<owner>/<name> --jq .private`) on 2026-11-08. To add one when a new link turns out private:
//   node -e 'console.log(require("node:crypto").createHash("sha256").update("owner/name").digest("hex"))'
// A hash of a short name is not a secret (anyone who guesses the name can test it); it only keeps the list unlabelled.
export const PRIVATE_REPO_HASHES = [
  "88abf581a09178bbbefbc5557c6dc18973887cdbb2aae436f6a6fd762ff52bf6",
  "f34933f34b270076433123ca872b91bc45cae9365b847398fbf24bacaedb7065",
  "896664959b5529a818d05fe05f3e6697d8d776faf0edc5a0fd3a1a91fed3a43c",
  "2fcde94e1ef34e08dd9fff02778d7d2c2c52efba8354add0bf3f07d46f3467dd",
];

/** The form a repository takes in PRIVATE_REPO_HASHES. */
export const repoHash = (repo) => createHash("sha256").update(String(repo).toLowerCase()).digest("hex");

// GitHub names that nobody has registered (`gh api users/<name>` gives 404, checked 2026-11-08). An address under
// one would be served by whoever registers it. Remove a name once the project holds it.
export const UNREGISTERED_OWNERS = ["organizational-os", "regencoordination"];

const lower = (s) => String(s).toLowerCase();

/** Why `value` may not be published as an address, or null when it may. */
export function addressProblem(value, { privateRepoHashes = PRIVATE_REPO_HASHES } = {}) {
  if (typeof value !== "string" || !/^https:\/\/[^/\s]+/i.test(value.trim())) return "it is not an https address";
  let url;
  try { url = new URL(value.trim()); } catch { return "it is not an https address"; }
  const host = lower(url.hostname).replace(/^www\./, "");
  const pagesOwner = host.endsWith(".github.io") ? host.slice(0, -".github.io".length) : null;
  const [owner = "", name = "", kind = ""] = url.pathname.split("/").filter(Boolean).map((p) => lower(decodeURIComponent(p)));
  const githubOwner = host === "github.com" ? owner : pagesOwner;
  if (githubOwner && UNREGISTERED_OWNERS.includes(githubOwner)) return `GitHub has no account named "${githubOwner}" (the name is not registered): whoever registers it would serve this address`;
  if (host === "github.com" && name) {
    const repo = `${owner}/${name.replace(/\.git$/, "")}`;
    if (privateRepoHashes.includes(repoHash(repo))) return "it is a private repository";
    if (kind === "tree" || kind === "blob") return "it is a folder inside another repository, not an address of its own";
  }
  return null;
}

const ADDRESS_FIELDS = ["url", "repo"];

/** The ids reached from `self` along the edges, never passing through an id in `drop`. */
function reachable(map, drop) {
  const seen = new Set([map.self?.id]);
  const queue = [map.self?.id];
  while (queue.length > 0) {
    const at = queue.shift();
    for (const e of map.edges ?? []) {
      if (e.from === at && !drop.has(e.to) && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
    }
  }
  return seen;
}

/** The ids to leave out: the unlisted entries, and each node reached from `self` only through one of them. A node
 *  no edge reaches (an ecosystem ring) was never reached through an unlisted entry, and stays. */
function leftOut(map, unlistedIds) {
  const drop = new Set(unlistedIds);
  const before = reachable(map, new Set());
  const after = reachable(map, drop);
  for (const id of before) if (!after.has(id)) drop.add(id);
  return drop;
}

/** The map with unlisted entries, what is reached only through them, and every refused address left out. Pure. */
export function publicMap(map, unlistedIds) {
  const drop = leftOut(map, unlistedIds);
  const keep = { has: (id) => !drop.has(id) };
  const nodes = (map.nodes ?? [])
    .filter((n) => keep.has(n.id))
    .map((n) => {
      const out = { ...n };
      for (const field of ADDRESS_FIELDS) if (field in out && addressProblem(out[field]) !== null) delete out[field];
      return out;
    });
  const edges = (map.edges ?? []).filter((e) => keep.has(e.from) && keep.has(e.to));
  return { ...map, nodes, edges };
}

/** One sentence per thing in `map` that publicMap would have left out. */
export function mapProblems(map, unlistedIds) {
  const nodes = map.nodes ?? [];
  if (nodes.length === 0) return ["map.json has no nodes to check"];
  const unlisted = new Set(unlistedIds);
  const drop = leftOut(map, unlistedIds);
  const problems = [];
  for (const n of nodes) {
    if (unlisted.has(n.id)) { problems.push(`map.json draws "${n.id}", which data/instances.yaml marks listed: false`); continue; }
    if (drop.has(n.id)) problems.push(`map.json draws "${n.id}", which is reached only through an entry marked listed: false`);
    for (const field of ADDRESS_FIELDS) {
      if (!(field in n)) continue;
      const why = addressProblem(n[field]);
      if (why) problems.push(`map.json gives "${n.id}" the ${field} ${JSON.stringify(n[field])}: ${why}`);
    }
  }
  return problems;
}
