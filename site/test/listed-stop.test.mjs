// A `listed` that is not true or false stops the two commands of the build that
// read the registry, each with a sentence naming the entry. The rule itself
// (listedProblems, aggregate) is held by test/federation-aggregate.test.mjs;
// these tests hold the lines that call it, by running each command on a scratch
// repository and reading its exit code and what it prints. Before them, the line
// in verify-build.mjs could be deleted and every test still passed (final review
// of 163ffb1, low finding 1).
//
// They need the three installs (site/README.md), as the commands themselves do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(SITE, "..");

const registryWith = (listed) => `instances:
  - id: "shown-one"
    name: "Shown One"
    type: "LocalNode"
    maturity: "production"
    repo: "https://example.com/shown"
  - id: "hidden-one"
    name: "Hidden One"
    type: "Cooperative"
    maturity: "production"
    repo: "https://example.com/hidden"
    listed: ${listed}
`;
const SENTENCE = /^REGISTRY: data\/instances\.yaml: "hidden-one" has listed: "false" \(a string\)\..*Write `listed: false`, without quotes.*Nothing was built/m;
const STACK_TRACE = /^\s+at .*\(?(node:|file:|\/)/m;

// A repository that holds only what the two commands read: the registry, a
// federation.yaml for the map, a package.json for the version, the site's scripts (copied, because the
// aggregator finds the repository from where it is), and the three installs and
// packages/ as links to the real ones.
function scratchRepo(listed) {
  const root = mkdtempSync(join(tmpdir(), "org-os-listed-stop-"));
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, "data", "instances.yaml"), registryWith(listed));
  writeFileSync(join(root, "federation.yaml"), 'identity:\n  name: "scratch"\n  type: "Framework"\n');
  writeFileSync(join(root, "package.json"), '{ "version": "0.0.0" }');
  cpSync(join(SITE, "scripts"), join(root, "site", "scripts"), { recursive: true });
  symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"), "dir");
  symlinkSync(join(REPO, "packages"), join(root, "packages"), "dir");
  symlinkSync(join(SITE, "node_modules"), join(root, "site", "node_modules"), "dir");
  return root;
}

const aggregateIn = (root) =>
  spawnSync(process.execPath, [join(root, "site", "scripts", "aggregate-federation.mjs")], { encoding: "utf8" });

// The verifier takes the repository from the directory it is run in (site/), and
// asks git for the tracked files, so the scratch repository is made one.
function verifyIn(root) {
  const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...env } = process.env;
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8", env });
  assert.equal(init.status, 0, init.stderr);
  return spawnSync(process.execPath, [join(SITE, "scripts", "verify-build.mjs")], {
    cwd: join(root, "site"), encoding: "utf8", env: { ...env, GITHUB_SHA: "0".repeat(40) },
  });
}

test("npm run aggregate stops on a mistyped listed: exit 1, one sentence naming the entry, no stack trace, nothing written", () => {
  const root = scratchRepo('"false"');
  try {
    const run = aggregateIn(root);
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, SENTENCE);
    assert.doesNotMatch(run.stderr, STACK_TRACE);
    assert.equal(run.stdout, "");
    for (const written of ["site/src/data/federation.json", "site/src/data/map.json", "site/public/map.json"]) {
      assert.equal(existsSync(join(root, written)), false, `${written} was written from a registry the site refuses`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// The same scratch repository with the value written properly: the stop above is
// the value's doing and not the scratch repository's.
test("npm run aggregate runs on the same registry with listed: false, and leaves the entry out", () => {
  const root = scratchRepo("false");
  try {
    const run = aggregateIn(root);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /federation\.json: 1 registered, 1 operational; 1 entry marked listed: false left out/);
    const fed = JSON.parse(readFileSync(join(root, "site", "src", "data", "federation.json"), "utf8"));
    assert.deepEqual(fed.nodes.map((node) => node.name), ["Shown One"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Nothing is built in the scratch repository, so the verifier fails there for
// other reasons too and its exit code alone says little. What holds the line is
// the sentence: it is printed for the mistyped value and not for the proper one.
test("npm run verify says the same sentence for a mistyped listed, and exits 1", () => {
  const root = scratchRepo('"false"');
  try {
    const run = verifyIn(root);
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, SENTENCE);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("npm run verify does not say it for listed: false", () => {
  const root = scratchRepo("false");
  try {
    const run = verifyIn(root);
    assert.match(run.stderr, /^(MANIFEST|MISSING): /m, "the verifier did not get as far as its checks");
    assert.doesNotMatch(run.stderr, /has listed:/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
