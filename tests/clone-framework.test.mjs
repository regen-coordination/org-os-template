import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, "..", "scripts", "clone-framework.mjs");
const configPath = path.resolve(__dirname, "fixtures", "instance-config.yaml");

test("clone-framework rejects when no --target", () => {
  const r = spawnSync("node", [scriptPath, "--config", configPath], { encoding: "utf-8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--target/);
});

test("clone-framework rejects when no --config", () => {
  const r = spawnSync("node", [scriptPath, "--target", "/tmp/x"], { encoding: "utf-8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--config/);
});

test("clone-framework --dry doesn't write target dir", () => {
  const dst = path.join(tmpdir(), `clone-dry-${process.pid}-${Date.now()}`);
  const r = spawnSync(
    "node",
    [scriptPath, "--target", dst, "--config", configPath, "--dry", "--no-git"],
    { encoding: "utf-8" },
  );
  assert.equal(r.status, 0, r.stderr);
  // Dry mode shouldn't create the target
  assert.equal(existsSync(dst), false);
});

test("clone-framework creates valid instance from fixture config", () => {
  const dst = mkdtempSync(path.join(tmpdir(), "clone-real-"));
  try {
    rmSync(dst, { recursive: true, force: true });
    const r = spawnSync(
      "node",
      [scriptPath, "--target", dst, "--config", configPath, "--no-git"],
      { encoding: "utf-8" },
    );
    assert.equal(r.status, 0, r.stderr);

    // Required files present
    for (const f of ["IDENTITY.md", "MASTERPLAN.md", "MEMORY.md", "HEARTBEAT.md", "README.md", "GETTING-STARTED.md", "federation.yaml", "package.json"]) {
      assert.ok(existsSync(path.join(dst, f)), `missing ${f}`);
    }

    // Framework-only files stripped
    assert.equal(existsSync(path.join(dst, "data/instances.yaml")), false);
    assert.equal(existsSync(path.join(dst, "data/skills-matrix.yaml")), false);
    assert.equal(existsSync(path.join(dst, "data/packages-matrix.yaml")), false);

    // federation.yaml has lineage stamp
    const fed = yaml.load(readFileSync(path.join(dst, "federation.yaml"), "utf-8"));
    assert.equal(fed.identity.name, "test-instance-os");
    assert.equal(fed.identity.type, "LocalNode");
    assert.equal(fed.metadata.framework_version, "3.5");
    assert.ok(fed.metadata.genesis_commit, "genesis_commit missing");
    assert.equal(fed.metadata.last_sync_commit, null);

    // package.json sanitized
    const pkg = JSON.parse(readFileSync(path.join(dst, "package.json"), "utf-8"));
    assert.equal(pkg.name, "test-instance-os");
    assert.equal(pkg.version, "0.1.0");

    // Skills filtered to only the 4 enabled
    const skillEntries = readdirSync(path.join(dst, "skills"));
    assert.equal(skillEntries.length, 4);
  } finally {
    rmSync(dst, { recursive: true, force: true });
  }
});
