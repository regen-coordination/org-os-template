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
