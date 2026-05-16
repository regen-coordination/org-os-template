import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, "..", "scripts", "sync-packages.mjs");

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "sync-packages-"));
  const framework = path.join(root, "framework");
  mkdirSync(path.join(framework, "packages", "dashboard"), { recursive: true });
  writeFileSync(path.join(framework, "packages", "dashboard", "README.md"), "# dashboard package\n");
  mkdirSync(path.join(framework, "packages", "webapps"), { recursive: true });
  writeFileSync(path.join(framework, "packages", "webapps", "README.md"), "# webapps package\n");

  const instance = path.join(root, "instance");
  mkdirSync(instance);
  writeFileSync(
    path.join(instance, "federation.yaml"),
    "packages:\n  dashboard: true\n  webapps: false\n",
  );
  return { root, framework, instance };
}

function runScript(args, env = {}) {
  return spawnSync("node", [scriptPath, ...args], {
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
}

test("sync-packages copies enabled packages from framework into instance", () => {
  const { root, framework, instance } = setup();
  try {
    const result = runScript(["--framework", framework, "--target", instance]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(path.join(instance, "packages", "dashboard", "README.md")));
    assert.ok(!existsSync(path.join(instance, "packages", "webapps")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync-packages warns about disabled-but-locally-present packages", () => {
  const { root, framework, instance } = setup();
  try {
    mkdirSync(path.join(instance, "packages", "webapps"), { recursive: true });
    writeFileSync(path.join(instance, "packages", "webapps", "leftover.md"), "old");
    const result = runScript(["--framework", framework, "--target", instance]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /webapps.*disabled.*present/);
    assert.ok(existsSync(path.join(instance, "packages", "webapps", "leftover.md")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync-packages --prune removes disabled-but-present packages", () => {
  const { root, framework, instance } = setup();
  try {
    mkdirSync(path.join(instance, "packages", "webapps"), { recursive: true });
    writeFileSync(path.join(instance, "packages", "webapps", "leftover.md"), "old");
    const result = runScript(["--framework", framework, "--target", instance, "--prune"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!existsSync(path.join(instance, "packages", "webapps")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync-packages --dry doesn't write anything", () => {
  const { root, framework, instance } = setup();
  try {
    const result = runScript(["--framework", framework, "--target", instance, "--dry"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!existsSync(path.join(instance, "packages", "dashboard")));
    assert.match(result.stdout, /would copy/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync-packages accepts --enabled flag without federation.yaml", () => {
  const { root, framework } = setup();
  try {
    const altInstance = path.join(root, "alt-instance");
    mkdirSync(altInstance);
    const result = runScript([
      "--framework", framework,
      "--target", altInstance,
      "--enabled", "dashboard,webapps",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(path.join(altInstance, "packages", "dashboard", "README.md")));
    assert.ok(existsSync(path.join(altInstance, "packages", "webapps", "README.md")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
