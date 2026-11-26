// What the published map may carry (operator decisions 3c, 7 and 8, 2026-11-07): no entry the registry marks
// `listed: false`, nothing reached only through one, and no address that is private, a workspace path, not https,
// or under a GitHub name nobody has registered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addressProblem, publicMap, mapProblems, PRIVATE_REPO_HASHES, repoHash, UNREGISTERED_OWNERS } from "../scripts/map-addresses.mjs";

test("an https address to a public place passes", () => {
  assert.equal(addressProblem("https://github.com/regen-coordination/coop"), null);
  assert.equal(addressProblem("https://refidao.com"), null);
  assert.equal(addressProblem("https://github.com/regen-coordination"), null);
});

test("a workspace path, a bare owner/name and any other non-https value are refused", () => {
  for (const v of ["03 Libraries/ReFi DAO", "repos/egregore", "regen-coordination/dao-os", "http://example.org", "obsidian://open?vault=x", "", 42, null]) {
    assert.match(String(addressProblem(v)), /https/, `${JSON.stringify(v)} should be refused as not https`);
  }
});

test("a folder inside another GitHub repository is refused", () => {
  assert.match(addressProblem("https://github.com/someone/big-repo/tree/main/03%20Libraries/X"), /folder inside/);
  assert.match(addressProblem("https://github.com/someone/big-repo/blob/main/README.md"), /folder inside/);
});

test("a private repository is refused, whatever the case, with or without .git or a sub-path", () => {
  const opts = { privateRepoHashes: [repoHash("someone/kept-private")] };
  assert.match(addressProblem("https://github.com/someone/kept-private", opts), /private/);
  assert.match(addressProblem("https://github.com/SOMEONE/kept-private.git", opts), /private/);
  assert.match(addressProblem("https://www.github.com/someone/kept-private/issues", opts), /private/);
  assert.equal(addressProblem("https://github.com/someone/kept-public", opts), null);
});

test("the shipped list of private repositories holds hashes, never names", () => {
  assert.ok(PRIVATE_REPO_HASHES.length > 0);
  for (const h of PRIVATE_REPO_HASHES) assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(addressProblem("https://github.com/someone/kept-private"), null, "the default list is the shipped one");
});

test("an address under an unregistered GitHub name is refused: whoever registers the name would serve it", () => {
  assert.ok(UNREGISTERED_OWNERS.includes("organizational-os"));
  assert.match(addressProblem("https://github.com/organizational-os/organizational-os-template.git"), /registered/);
  assert.match(addressProblem("https://organizational-os.github.io/.well-known/dao.json"), /registered/);
});

const MAP = {
  version: 1,
  self: { id: "org-os", name: "org-os" },
  nodes: [
    { id: "kept", name: "Kept", ring: 1, url: "https://github.com/regen-coordination/coop", repo: "regen-coordination/coop" },
    { id: "hidden", name: "Hidden Coop", ring: 1, url: "https://example.org" },
    { id: "only-via-hidden", name: "Only via hidden", ring: 2, url: "https://example.net" },
    { id: "via-kept", name: "Via kept", ring: 2, repo: "03 Libraries/Thing", url: "https://github.com/someone/big-repo/tree/main/03%20Libraries/Thing" },
    { id: "ring3", name: "A network", ring: 3, url: "https://refidao.com" },
    { id: "no-edges", name: "An ecosystem", ring: 3, url: "https://agentsmd.com" },
  ],
  edges: [
    { from: "org-os", to: "kept", kind: "downstream" },
    { from: "org-os", to: "hidden", kind: "downstream" },
    { from: "hidden", to: "only-via-hidden", kind: "frontier" },
    { from: "kept", to: "via-kept", kind: "frontier" },
    { from: "org-os", to: "ring3", kind: "ecosystem" },
  ],
};

test("publicMap leaves out an unlisted entry, its edges and what was reached only through it", () => {
  const out = publicMap(MAP, ["hidden"]);
  assert.deepEqual(out.nodes.map((n) => n.id), ["kept", "via-kept", "ring3", "no-edges"], "a node no edge reaches stays");
  assert.ok(out.edges.every((e) => e.from !== "hidden" && e.to !== "hidden" && e.to !== "only-via-hidden"));
  assert.equal(out.edges.length, 3);
});

test("publicMap drops each address that fails, and keeps the node", () => {
  const out = publicMap(MAP, []);
  const kept = out.nodes.find((n) => n.id === "kept");
  assert.equal(kept.url, "https://github.com/regen-coordination/coop");
  assert.equal("repo" in kept, false, "a bare owner/name is not an https address");
  const via = out.nodes.find((n) => n.id === "via-kept");
  assert.equal("url" in via, false);
  assert.equal("repo" in via, false);
  assert.equal(via.name, "Via kept");
});

test("publicMap leaves its input alone", () => {
  const before = JSON.stringify(MAP);
  publicMap(MAP, ["hidden"]);
  assert.equal(JSON.stringify(MAP), before);
});

test("mapProblems finds nothing in publicMap's output, and names each thing that slipped through otherwise", () => {
  assert.deepEqual(mapProblems(publicMap(MAP, ["hidden"]), ["hidden"]), []);
  const problems = mapProblems(MAP, ["hidden"]);
  assert.ok(problems.some((p) => /hidden.*listed: false/.test(p)), problems.join("\n"));
  assert.ok(problems.some((p) => /only-via-hidden/.test(p)), problems.join("\n"));
  assert.ok(problems.some((p) => /via-kept.*url.*folder inside/.test(p)), problems.join("\n"));
  assert.ok(problems.some((p) => /kept.*repo.*https/.test(p)), problems.join("\n"));
});

test("mapProblems refuses a map that has no nodes to check", () => {
  assert.match(mapProblems({ self: { id: "org-os" }, nodes: [], edges: [] }, []).join(" "), /no nodes/);
});
