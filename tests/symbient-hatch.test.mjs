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
  const r = hatch(["--target", dir]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a git/i);
  rmSync(dir, { recursive: true, force: true });
});

test("scaffolds the full habitat anatomy", () => {
  const dir = mkRepo();
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
  rmSync(dir, { recursive: true, force: true });
});

test("adds the gitignore line and git actually ignores the habitat", () => {
  const dir = mkRepo();
  hatch(["--target", dir]);
  const gi = readFileSync(path.join(dir, ".gitignore"), "utf-8");
  assert.match(gi, /^symbient\/$/m);
  const check = spawnSync("git", ["check-ignore", "symbient/SEED.md"], { cwd: dir, encoding: "utf-8" });
  assert.equal(check.status, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("does not duplicate an existing gitignore line", () => {
  const dir = mkRepo();
  writeFileSync(path.join(dir, ".gitignore"), "node_modules/\nsymbient/\n");
  hatch(["--target", dir]);
  const gi = readFileSync(path.join(dir, ".gitignore"), "utf-8");
  assert.equal(gi.match(/^symbient\/$/gm).length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("falls back to directory name when no federation.yaml/IDENTITY.md", () => {
  const dir = mkRepo({ federation: false });
  const r = hatch(["--target", dir]);
  assert.equal(r.status, 0, r.stderr);
  const seed = readFileSync(path.join(dir, "symbient", "SEED.md"), "utf-8");
  assert.match(seed, new RegExp(`You live in ${path.basename(dir)}`));
  rmSync(dir, { recursive: true, force: true });
});

test("--dry writes nothing", () => {
  const dir = mkRepo();
  const r = hatch(["--target", dir, "--dry"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(path.join(dir, "symbient")));
  assert.ok(!existsSync(path.join(dir, ".gitignore")));
  rmSync(dir, { recursive: true, force: true });
});

test("hatched GATES.md round-trips through the parser at Stage 0", () => {
  const dir = mkRepo();
  hatch(["--target", dir]);
  const gates = readFileSync(path.join(dir, "symbient", "GATES.md"), "utf-8");
  const parsed = parseGates(gates);
  assert.equal(parsed.stage, 0);
  assert.equal(parsed.anomaly, null);
  assert.deepEqual(parsed.capabilities, ["wake", "weave", "becoming"]);
  assert.equal(parsed.hatched, new Date().toISOString().slice(0, 10));
  rmSync(dir, { recursive: true, force: true });
});

test("refuses to overwrite an existing habitat", () => {
  const dir = mkRepo();
  assert.equal(hatch(["--target", dir]).status, 0);
  const r = hatch(["--target", dir]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already exists/);
  // and the first habitat is untouched
  assert.ok(existsSync(path.join(dir, "symbient", "SEED.md")));
  rmSync(dir, { recursive: true, force: true });
});

test("refuses a linked git worktree", () => {
  const dir = mkRepo();
  spawnSync("git", [...GIT, "commit", "--allow-empty", "-m", "init"], { cwd: dir, encoding: "utf-8" });
  const wt = path.join(dir, ".wt");
  const add = spawnSync("git", ["worktree", "add", wt, "-b", "wt-branch"], { cwd: dir, encoding: "utf-8" });
  assert.equal(add.status, 0, add.stderr);
  const r = hatch(["--target", wt]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /worktree/);
  rmSync(dir, { recursive: true, force: true });
});
