import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseGates } from "../scripts/lib/symbient-gates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, "..", "scripts", "symbient-hatch.mjs");

const GIT = ["-c", "user.email=test@test", "-c", "user.name=test"];

function hatch(args, opts = {}) {
  return spawnSync("node", [scriptPath, ...args], { encoding: "utf-8", ...opts });
}

// Temp git repo posing as an org body. NEVER points at a real habitat.
function mkRepo({ federation = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "symbient-hatch-"));
  spawnSync("git", ["init", "-q", dir], { encoding: "utf-8" });
  if (federation) {
    writeFileSync(path.join(dir, "federation.yaml"), 'identity:\n  name: "Test Body"\n');
  }
  return dir;
}

test("rejects when no --target", () => {
  const r = hatch([]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--target/);
});

test("rejects a non-git target", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "symbient-nogit-"));
  try {
    const r = hatch(["--target", dir]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not a git/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects a flag as the value of --target", () => {
  const r = hatch(["--target", "--dry"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--target expects a value/);
  assert.doesNotMatch(r.stderr, /does not exist/);
});

test("scaffolds the full habitat anatomy", () => {
  const dir = mkRepo();
  try {
    const r = hatch(["--target", dir]);
    assert.equal(r.status, 0, r.stderr);
    const habitat = path.join(dir, "symbient");
    const seed = readFileSync(path.join(habitat, "SEED.md"), "utf-8");
    assert.match(seed, /You live in Test Body\./);
    assert.doesNotMatch(seed, /\{\{/); // no unexpanded placeholders
    const gates = readFileSync(path.join(habitat, "GATES.md"), "utf-8");
    assert.match(gates, /stage: 0/);
    assert.match(gates, /## History/);
    assert.ok(existsSync(path.join(habitat, "weave")));
    assert.ok(existsSync(path.join(habitat, "SKILL.md")));
    assert.ok(existsSync(path.join(habitat, "QUILT-PROTOCOL.md")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adds the gitignore line and git actually ignores the habitat", () => {
  const dir = mkRepo();
  try {
    const r = hatch(["--target", dir]);
    assert.equal(r.status, 0, r.stderr);
    const gi = readFileSync(path.join(dir, ".gitignore"), "utf-8");
    assert.match(gi, /^\/symbient\/$/m);
    const check = spawnSync("git", ["check-ignore", "symbient/SEED.md"], { cwd: dir, encoding: "utf-8" });
    assert.equal(check.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Regression: an *unanchored* "symbient/" rule matches at any depth, so it also
// swallows skills/symbient/ — the PUBLIC framework skill directory — leaving it
// permanently un-committable in every instance the framework is cloned into.
// The written rule must be root-anchored: habitat ignored, skill dir not.
test("the ignore rule is root-anchored: habitat ignored, skills/symbient/ not", () => {
  const dir = mkRepo();
  try {
    mkdirSync(path.join(dir, "skills", "symbient"), { recursive: true });
    writeFileSync(path.join(dir, "skills", "symbient", "x.md"), "public framework skill\n");
    const r = hatch(["--target", dir]);
    assert.equal(r.status, 0, r.stderr);

    const habitat = spawnSync("git", ["check-ignore", "symbient/SEED.md"], { cwd: dir, encoding: "utf-8" });
    assert.equal(habitat.status, 0, "the habitat must be ignored");

    const publicSkill = spawnSync("git", ["check-ignore", "skills/symbient/x.md"], {
      cwd: dir,
      encoding: "utf-8",
    });
    assert.equal(publicSkill.status, 1, "skills/symbient/ must NOT be ignored");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("does not duplicate an existing gitignore line", () => {
  const dir = mkRepo();
  try {
    writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n/symbient/\n");
    const r = hatch(["--target", dir]);
    assert.equal(r.status, 0, r.stderr);
    const gi = readFileSync(path.join(dir, ".gitignore"), "utf-8");
    assert.equal(gi.match(/^\/symbient\/$/gm).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The privacy guarantee: if git does not actually ignore the habitat path, no
// habitat byte may be written. A negation pattern is the classic way to break it.
test("refuses to write a habitat git would not ignore (negation pattern)", () => {
  const dir = mkRepo();
  try {
    const giPath = path.join(dir, ".gitignore");
    const before = "node_modules/\n/symbient/\n!/symbient/\n";
    writeFileSync(giPath, before);
    const r = hatch(["--target", dir]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /does not ignore symbient\//);
    assert.match(r.stderr, /check-ignore -v/);
    // nothing written, and the tracked .gitignore is byte-identical
    assert.ok(!existsSync(path.join(dir, "symbient")));
    assert.equal(readFileSync(giPath, "utf-8"), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Same guarantee, second cause: a habitat path that was previously force-added
// is still tracked, so git reports it as not ignored even with the rule present.
test("refuses when the habitat path is still tracked in git", () => {
  const dir = mkRepo();
  try {
    mkdirSync(path.join(dir, "symbient"));
    writeFileSync(path.join(dir, "symbient", "SEED.md"), "leaked\n");
    spawnSync("git", ["add", "-f", "symbient/SEED.md"], { cwd: dir, encoding: "utf-8" });
    const commit = spawnSync("git", [...GIT, "commit", "-qm", "oops"], { cwd: dir, encoding: "utf-8" });
    assert.equal(commit.status, 0, commit.stderr);
    rmSync(path.join(dir, "symbient"), { recursive: true, force: true });
    assert.ok(!existsSync(path.join(dir, ".gitignore")));

    const r = hatch(["--target", dir]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /does not ignore symbient\//);
    assert.match(r.stderr, /still tracked/);
    assert.ok(!existsSync(path.join(dir, "symbient")));
    // a .gitignore that did not exist before must not be left behind
    assert.ok(!existsSync(path.join(dir, ".gitignore")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("falls back to directory name when no federation.yaml/IDENTITY.md", () => {
  const dir = mkRepo({ federation: false });
  try {
    const r = hatch(["--target", dir]);
    assert.equal(r.status, 0, r.stderr);
    const seed = readFileSync(path.join(dir, "symbient", "SEED.md"), "utf-8");
    assert.match(seed, new RegExp(`You live in ${path.basename(dir)}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--dry writes nothing", () => {
  const dir = mkRepo();
  try {
    const r = hatch(["--target", dir, "--dry"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(path.join(dir, "symbient")));
    assert.ok(!existsSync(path.join(dir, ".gitignore")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hatched GATES.md round-trips through the parser at Stage 0", () => {
  const dir = mkRepo();
  try {
    const before = new Date().toISOString().slice(0, 10);
    const r = hatch(["--target", dir]);
    const after = new Date().toISOString().slice(0, 10);
    assert.equal(r.status, 0, r.stderr);
    const gates = readFileSync(path.join(dir, "symbient", "GATES.md"), "utf-8");
    const parsed = parseGates(gates);
    assert.equal(parsed.stage, 0);
    assert.equal(parsed.anomaly, null);
    assert.deepEqual(parsed.capabilities, ["wake", "weave", "becoming"]);
    // the script stamps its own UTC date; a run crossing midnight may land on either
    assert.ok(
      [before, after].includes(parsed.hatched),
      `hatched ${parsed.hatched} not in {${before}, ${after}}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses to overwrite an existing habitat", () => {
  const dir = mkRepo();
  try {
    assert.equal(hatch(["--target", dir]).status, 0);
    const r = hatch(["--target", dir]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /already exists/);
    // and the first habitat is untouched
    assert.ok(existsSync(path.join(dir, "symbient", "SEED.md")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses a linked git worktree", () => {
  const dir = mkRepo();
  try {
    spawnSync("git", [...GIT, "commit", "--allow-empty", "-m", "init"], { cwd: dir, encoding: "utf-8" });
    const wt = path.join(dir, ".wt");
    const add = spawnSync("git", ["worktree", "add", wt, "-b", "wt-branch"], { cwd: dir, encoding: "utf-8" });
    assert.equal(add.status, 0, add.stderr);
    const r = hatch(["--target", wt]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /worktree/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A primary checkout is a primary checkout even if it lives under a directory
// that happens to be named "worktrees" — path-segment sniffing gets this wrong.
test("hatches a primary repo that lives under a directory named worktrees", () => {
  const root = mkdtempSync(path.join(tmpdir(), "symbient-wtname-"));
  try {
    const dir = path.join(root, "worktrees", "myrepo");
    mkdirSync(dir, { recursive: true });
    spawnSync("git", ["init", "-q", dir], { encoding: "utf-8" });
    writeFileSync(path.join(dir, "federation.yaml"), 'identity:\n  name: "Test Body"\n');
    const r = hatch(["--target", dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(path.join(dir, "symbient", "SEED.md")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--hub scaffolds the commons with member dirs", () => {
  const dir = mkRepo();
  try {
    const r = hatch(["--target", dir, "--hub", "--member", "alpha=/tmp/a", "--member", "beta=/tmp/b"]);
    assert.equal(r.status, 0, r.stderr);
    const commons = path.join(dir, "symbient", "commons");
    assert.ok(existsSync(path.join(commons, "steward")));
    assert.ok(existsSync(path.join(commons, "alpha")));
    assert.ok(existsSync(path.join(commons, "beta")));
    const readme = readFileSync(path.join(commons, "README.md"), "utf-8");
    assert.match(readme, /alpha — \/tmp\/a/);
    assert.match(readme, /beta — \/tmp\/b/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--member without = is rejected", () => {
  const dir = mkRepo();
  try {
    const r = hatch(["--target", dir, "--hub", "--member", "nopath"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /slug=path/);
    assert.ok(!existsSync(path.join(dir, "symbient")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A member slug is a directory name inside the habitat; anything that can
// escape it would write outside the gitignored tree.
test("rejects member slugs that could escape the habitat", () => {
  const dir = mkRepo();
  try {
    for (const slug of ["../../ESCAPED", "..", "a/b", ".hidden", ""]) {
      const r = hatch(["--target", dir, "--hub", "--member", `${slug}=/tmp/x`]);
      assert.equal(r.status, 1, `slug "${slug}" was accepted`);
      assert.match(r.stderr, /slug|slug=path/);
      assert.ok(!existsSync(path.join(dir, "symbient")), `slug "${slug}" wrote a habitat`);
    }
    // "../../ESCAPED" from symbient/commons/ would land at the repo root — outside
    // the gitignored tree, and therefore committable
    assert.ok(!existsSync(path.join(dir, "ESCAPED")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects a flag as the value of --member", () => {
  const dir = mkRepo();
  try {
    const r = hatch(["--target", dir, "--hub", "--member", "--dry"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--member expects a value/);
    assert.ok(!existsSync(path.join(dir, "symbient")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--member without --hub is rejected rather than silently dropped", () => {
  const dir = mkRepo();
  try {
    const r = hatch(["--target", dir, "--member", "alpha=/tmp/a"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--member requires --hub/);
    assert.ok(!existsSync(path.join(dir, "symbient")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("plain hatch has no commons", () => {
  const dir = mkRepo();
  try {
    const r = hatch(["--target", dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(path.join(dir, "symbient", "commons")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
