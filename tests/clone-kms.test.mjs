import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, "..", "scripts", "clone-framework.mjs");
const kmsConfigPath = path.resolve(__dirname, "fixtures", "instance-config-kms.yaml");
const plainConfigPath = path.resolve(__dirname, "fixtures", "instance-config.yaml");

function clone(configPath, extra = []) {
  const dst = mkdtempSync(path.join(tmpdir(), "clone-kms-"));
  rmSync(dst, { recursive: true, force: true });
  const r = spawnSync("node", [scriptPath, "--target", dst, "--config", configPath, "--no-git", ...extra], { encoding: "utf-8" });
  return { dst, r };
}

// A config derived from the kms fixture, written to a temp file.
function variant(mutate) {
  const cfg = yaml.load(readFileSync(kmsConfigPath, "utf-8"));
  mutate(cfg);
  const dir = mkdtempSync(path.join(tmpdir(), "clone-kms-cfg-"));
  const file = path.join(dir, "config.yaml");
  writeFileSync(file, yaml.dump(cfg));
  return { file, dir };
}

test("a config with a kms block yields an instance that is already a knowledge system", () => {
  const { dst, r } = clone(kmsConfigPath);
  try {
    assert.equal(r.status, 0, r.stderr);
    const kms = yaml.load(readFileSync(path.join(dst, "kms.yaml"), "utf-8"));
    // Named by the config, never by the directory the clone happened to land in.
    assert.equal(kms.instance, "test-commons");
    assert.equal(kms.adapter, "repo-data");
    assert.deepEqual(kms.extensions, ["org-os-territory"]);
    assert.deepEqual(kms.store, { on_collision: "merge" });
    assert.equal(kms.self_ref, "data/kb/source-system.yaml#test-commons");
    // Born a federation citizen: the self card exists.
    const cards = yaml.load(readFileSync(path.join(dst, "data/kb/source-system.yaml"), "utf-8"));
    assert.ok(JSON.stringify(cards).includes("test-commons"), "self card missing");
    // The packages the knowledge system needs sit side by side (CONNECTORS §6).
    for (const p of ["toolkit-framework", "org-os-kms", "org-os-territory"]) {
      assert.ok(existsSync(path.join(dst, "packages", p, "package.json")), `packages/${p} missing`);
    }
  } finally {
    rmSync(dst, { recursive: true, force: true });
  }
});

test("kms.instance defaults to a slug of org.name", () => {
  const v = variant((c) => { delete c.kms.instance; });
  const { dst, r } = clone(v.file);
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(yaml.load(readFileSync(path.join(dst, "kms.yaml"), "utf-8")).instance, "test-commons-os");
  } finally {
    rmSync(dst, { recursive: true, force: true });
    rmSync(v.dir, { recursive: true, force: true });
  }
});

test("a kms block without the two packages it needs is refused before anything is written", () => {
  const v = variant((c) => { c.packages["org-os-kms"] = false; });
  const { dst, r } = clone(v.file);
  try {
    assert.equal(r.status, 1);
    assert.match(r.stderr, /kms.*org-os-kms/s);
    assert.equal(existsSync(dst), false);
  } finally {
    rmSync(dst, { recursive: true, force: true });
    rmSync(v.dir, { recursive: true, force: true });
  }
});

test("an extension that is not an enabled package is refused before anything is written", () => {
  const v = variant((c) => { c.packages["org-os-territory"] = false; });
  const { dst, r } = clone(v.file);
  try {
    assert.equal(r.status, 1);
    assert.match(r.stderr, /org-os-territory/);
    assert.equal(existsSync(dst), false);
  } finally {
    rmSync(dst, { recursive: true, force: true });
    rmSync(v.dir, { recursive: true, force: true });
  }
});

test("--dry with a kms block writes nothing", () => {
  const { dst, r } = clone(kmsConfigPath, ["--dry"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(dst), false);
});

test("a config with no kms block gets no kms.yaml", () => {
  const { dst, r } = clone(plainConfigPath);
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(path.join(dst, "kms.yaml")), false);
  } finally {
    rmSync(dst, { recursive: true, force: true });
  }
});

// — the two planes —

const cli = path.resolve(__dirname, "..", "packages", "org-os-kms", "src", "cli.mjs");
const withPlane = (mutate = () => {}) => variant((c) => {
  c.kms.public_plane = { instance: "test-commons-publico", types_opt_in: ["territorial-unit"] };
  mutate(c);
});

test("a kms.public_plane block yields a canon that names its public plane, and the plane scaffolded beside it", () => {
  const v = withPlane();
  const { dst, r } = clone(v.file);
  try {
    assert.equal(r.status, 0, r.stderr);
    const canon = yaml.load(readFileSync(path.join(dst, "kms.yaml"), "utf-8"));
    assert.deepEqual(canon.planes, { public: { instance: "test-commons-publico" } });
    const planeDir = path.join(dst, "repos", "test-commons-publico");
    const plane = yaml.load(readFileSync(path.join(planeDir, "kms.yaml"), "utf-8"));
    assert.equal(plane.instance, "test-commons-publico");
    assert.equal(plane.self_ref, "data/kb/source-system.yaml#test-commons-publico");
    // The plane loads the same packs as the canon, and publishes only the types it opts into.
    assert.deepEqual(plane.extensions, ["org-os-territory"]);
    assert.deepEqual(plane.publish.types_opt_in, ["territorial-unit"]);
    // The canon's own card is private and claims its own checkout — what the gate requires of every card.
    const self = yaml.load(readFileSync(path.join(dst, "data/kb/source-system.yaml"), "utf-8")).entries["test-commons"];
    assert.equal(self.container_role, "self");
    assert.equal(self.public_use, "internal-only");
    assert.deepEqual(self.origin_prefixes, ["repos/test-commons/"]);
    // The plane's own card is published as it stands, so it is born in a public shape.
    const card = yaml.load(readFileSync(path.join(planeDir, "data/kb/source-system.yaml"), "utf-8")).entries;
    assert.deepEqual(Object.keys(card), ["test-commons-publico"]);
    assert.equal(card["test-commons-publico"].public_use, "ok-with-caveat");
    assert.equal(card["test-commons-publico"].title, "test-commons-os");
    assert.equal(card["test-commons-publico"].maturity, undefined);
    assert.equal(card["test-commons-publico"].notes, undefined);
    // It is a projection: it names no public plane of its own.
    assert.equal(plane.planes, undefined);
  } finally {
    rmSync(dst, { recursive: true, force: true });
    rmSync(v.dir, { recursive: true, force: true });
  }
});

test("a freshly cloned pair exports and re-gates cleanly: nothing to publish, nothing wrong", () => {
  const v = withPlane();
  const { dst, r } = clone(v.file);
  try {
    assert.equal(r.status, 0, r.stderr);
    const run = (verb) => spawnSync("node", [cli, verb, "--dir", dst], { encoding: "utf-8" });
    const exported = run("export");
    assert.equal(exported.status, 0, exported.stderr + exported.stdout);
    assert.deepEqual(JSON.parse(exported.stdout).written, []);
    const validated = run("validate");
    assert.equal(validated.status, 0, validated.stderr + validated.stdout);
    assert.equal(JSON.parse(validated.stdout).ok, true);
  } finally {
    rmSync(dst, { recursive: true, force: true });
    rmSync(v.dir, { recursive: true, force: true });
  }
});

test("the public plane is its own repository: the canon's genesis commit does not contain it", () => {
  const v = withPlane();
  const dst = mkdtempSync(path.join(tmpdir(), "clone-kms-git-"));
  rmSync(dst, { recursive: true, force: true });
  try {
    const r = spawnSync("node", [scriptPath, "--target", dst, "--config", v.file], { encoding: "utf-8" });
    assert.equal(r.status, 0, r.stderr);
    const tracked = spawnSync("git", ["ls-files"], { cwd: dst, encoding: "utf-8" }).stdout.split("\n");
    assert.ok(tracked.includes("kms.yaml"), "the canon's kms.yaml is not in the genesis commit");
    assert.equal(tracked.some((f) => f.startsWith("repos/test-commons-publico/")), false);
    assert.ok(existsSync(path.join(dst, "repos", "test-commons-publico", ".git")), "the public plane is not a repository of its own");
    assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: dst, encoding: "utf-8" }).stdout, "");
  } finally {
    rmSync(dst, { recursive: true, force: true });
    rmSync(v.dir, { recursive: true, force: true });
  }
});

test("a public plane named like the canon, or with a path in its name, is refused before anything is written", () => {
  for (const bad of ["test-commons", "../elsewhere", "a/b", ""]) {
    const v = withPlane((c) => { c.kms.public_plane.instance = bad; });
    const { dst, r } = clone(v.file);
    try {
      assert.equal(r.status, 1, `"${bad}" was accepted`);
      assert.match(r.stderr, /public_plane/);
      assert.equal(existsSync(dst), false);
    } finally {
      rmSync(dst, { recursive: true, force: true });
      rmSync(v.dir, { recursive: true, force: true });
    }
  }
});
