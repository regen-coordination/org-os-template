// tests/clone-genesis.test.mjs
//
// A fresh instance must be CLEAN (no framework content, no secrets),
// STRUCTURED (its own planning directories and queue) and SELF-CONSISTENT
// (its own selftest passes). This is the acceptance test for the genesis
// path; clone-framework-health.test.mjs covers the doctor's view, this one
// covers what the operator sees on day one.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, existsSync, readdirSync, readFileSync, rmSync, symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cloneScript = path.join(rootDir, "scripts", "clone-framework.mjs");
const configPath = path.join(rootDir, "tests", "fixtures", "instance-config.yaml");

/** Clone into a temp dir (no git — nothing here needs a repo) and hand the path to fn. */
function withClone(fn) {
  const dst = mkdtempSync(path.join(tmpdir(), "clone-genesis-"));
  rmSync(dst, { recursive: true, force: true }); // clone-framework wants to create it
  try {
    const r = spawnSync("node", [cloneScript, "--target", dst, "--config", configPath, "--no-git"], {
      encoding: "utf-8",
      timeout: 120_000,
    });
    assert.equal(r.status, 0, `clone failed: ${r.stderr}${r.stdout}`);
    // Reuse the framework's installed deps so the clone's own scripts can run
    // without an npm install per test.
    symlinkSync(path.join(rootDir, "node_modules"), path.join(dst, "node_modules"), "dir");
    return fn(dst);
  } finally {
    rmSync(dst, { recursive: true, force: true });
  }
}

const MUST_NOT_EXIST = [
  ".env", ".buzz-state.json", ".DS_Store",
  "graphify-out", "renders", "docs/agent-plans", ".superpowers", ".agents",
  "data/knowledge-gaps.yaml", "data/federation/frontier",
  "PAPERCLIP_DEPLOYMENT_GUIDE.md", "RESEARCH_INTELLIGENCE_PLAN.md",
  "tests/buzz-integration", "tests/paper-integration", "tests/instance-doctor",
  "tests/clone-genesis.test.mjs", "tests/clone-framework.test.mjs", "tests/clone-framework-health.test.mjs",
  "data/instances.yaml", "data/skills-matrix.yaml", "data/packages-matrix.yaml",
];

test("a fresh clone carries no framework operational content or secrets", () => {
  withClone((dir) => {
    const present = MUST_NOT_EXIST.filter((p) => existsSync(path.join(dir, p)));
    assert.deepEqual(present, [], "these framework paths leaked into the instance");
    // docs/superpowers may exist as structure (Task 3) but never with framework content
    const fwPlans = path.join(dir, "docs", "superpowers", "plans");
    if (existsSync(fwPlans)) {
      const files = readdirSync(fwPlans).filter((f) => f !== ".gitkeep");
      assert.deepEqual(files, [], "framework plans leaked into docs/superpowers/plans");
    }
  });
});

test("memory/ exists and holds nothing but .gitkeep", () => {
  withClone((dir) => {
    const mem = path.join(dir, "memory");
    assert.equal(existsSync(mem), true, "memory/ must exist");
    assert.deepEqual(readdirSync(mem), [".gitkeep"]);
  });
});

test("governance.yaml starts with no framework decisions", () => {
  withClone((dir) => {
    const gov = yaml.load(readFileSync(path.join(dir, "data", "governance.yaml"), "utf-8"));
    assert.deepEqual(gov.governance.decisions, []);
    assert.deepEqual(gov.governance.elections, []);
  });
});
