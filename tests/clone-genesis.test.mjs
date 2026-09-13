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
  mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync, rmSync, symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cloneScript = path.join(rootDir, "scripts", "clone-framework.mjs");
const configPath = path.join(rootDir, "tests", "fixtures", "instance-config.yaml");

/**
 * Env for nested spawns, minus node:test's own control variables.
 *
 * `node --test` sets NODE_TEST_CONTEXT / NODE_TEST_WORKER_ID in its process
 * env, and spawnSync inherits the parent env by default. A nested `node --test`
 * that finds them set behaves as a serialized worker of the outer run and
 * returns exit 0 even when its tests fail — verified directly: a failing test
 * file exits 1 normally, and 0 under NODE_TEST_CONTEXT=child-v8. Without this
 * scrub the clone's own `node --test tests/` line inside selftest.mjs is blind,
 * and this test passes vacuously on a broken instance.
 */
function nestedEnv() {
  const { NODE_TEST_CONTEXT, NODE_TEST_WORKER_ID, ...rest } = process.env;
  return rest;
}

/** Clone into a temp dir (no git — nothing here needs a repo) and hand the path to fn. */
function withClone(fn) {
  const dst = mkdtempSync(path.join(tmpdir(), "clone-genesis-"));
  rmSync(dst, { recursive: true, force: true }); // clone-framework wants to create it
  try {
    const r = spawnSync("node", [cloneScript, "--target", dst, "--config", configPath, "--no-git"], {
      encoding: "utf-8",
      timeout: 120_000,
      env: nestedEnv(),
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

/**
 * Clone with a caller-supplied config object (written out as YAML to a temp
 * file) instead of the shared fixture. Use this when a test needs to vary
 * the skills/packages list — tests/clone-framework.test.mjs and
 * clone-framework-health.test.mjs both consume the shared fixture directly,
 * so mutating it would shift their expectations too.
 */
function withCloneConfig(configObject, fn) {
  const dst = mkdtempSync(path.join(tmpdir(), "clone-genesis-"));
  rmSync(dst, { recursive: true, force: true }); // clone-framework wants to create it
  const tmpConfigDir = mkdtempSync(path.join(tmpdir(), "clone-genesis-config-"));
  const tmpConfigPath = path.join(tmpConfigDir, "instance-config.yaml");
  try {
    writeFileSync(tmpConfigPath, yaml.dump(configObject));
    const r = spawnSync("node", [cloneScript, "--target", dst, "--config", tmpConfigPath, "--no-git"], {
      encoding: "utf-8",
      timeout: 120_000,
      env: nestedEnv(),
    });
    assert.equal(r.status, 0, `clone failed: ${r.stderr}${r.stdout}`);
    symlinkSync(path.join(rootDir, "node_modules"), path.join(dst, "node_modules"), "dir");
    return fn(dst);
  } finally {
    rmSync(dst, { recursive: true, force: true });
    rmSync(tmpConfigDir, { recursive: true, force: true });
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
  "tests/scripts/module-manifests.test.mjs", "tests/scripts/validate-identity-target.test.mjs",
  "site",
  ".github/workflows/deploy-pages.yml", ".github/workflows/drift.yml", ".github/workflows/validate.yml",
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

test("the instance gets its own planning structure", () => {
  withClone((dir) => {
    for (const p of [
      "docs/plans/QUEUE.md", "docs/plans/.gitkeep",
      "docs/superpowers/specs/.gitkeep", "docs/superpowers/plans/.gitkeep",
      "docs/superpowers/research/.gitkeep", "memory/.gitkeep", "DECISIONS.md",
    ]) {
      assert.equal(existsSync(path.join(dir, p)), true, `${p} must exist`);
    }
    const queue = readFileSync(path.join(dir, "docs", "plans", "QUEUE.md"), "utf-8");
    assert.match(queue, /^# Plan Queue — test-instance-os/);
    const decisions = readFileSync(path.join(dir, "DECISIONS.md"), "utf-8");
    assert.match(decisions, /test-instance-os/);
    assert.doesNotMatch(decisions, /Buzz lane|org-os framework version/i, "framework decisions leaked");
    const gitignore = readFileSync(path.join(dir, ".gitignore"), "utf-8");
    assert.match(gitignore, /^docs\/temp\/$/m);
  });
});

test("commands point at the instance's plan queue, never the framework's", () => {
  withClone((dir) => {
    const offenders = [];
    const scan = (abs, rel) => {
      if (!existsSync(abs)) return;
      for (const entry of readdirSync(abs, { withFileTypes: true })) {
        const p = path.join(abs, entry.name);
        const r = path.posix.join(rel, entry.name);
        if (entry.isDirectory()) scan(p, r);
        else if (entry.name.endsWith(".md") && readFileSync(p, "utf-8").includes("docs/agent-plans/")) offenders.push(r);
      }
    };
    for (const d of [".claude/commands", ".cursor/commands", ".opencode/commands", "skills/commands"]) {
      scan(path.join(dir, d), d);
    }
    assert.deepEqual(offenders, [], "these command files still reference docs/agent-plans/");
    assert.match(
      readFileSync(path.join(dir, ".claude", "commands", "close.md"), "utf-8"),
      /docs\/plans\/QUEUE\.md/,
    );
  });
});

test("command-skills (Hermes runtime surface) are repointed too, not just dotfile commands", () => {
  const fixtureConfig = yaml.load(readFileSync(configPath, "utf-8"));
  const config = {
    ...fixtureConfig,
    skills: [...fixtureConfig.skills, "commands"],
  };
  withCloneConfig(config, (dir) => {
    const commandsDir = path.join(dir, "skills", "commands");
    assert.equal(existsSync(commandsDir), true, "skills/commands/ must exist when the commands skill is enabled");

    const skillFiles = [];
    const walk = (abs, rel) => {
      for (const entry of readdirSync(abs, { withFileTypes: true })) {
        const p = path.join(abs, entry.name);
        const r = path.posix.join(rel, entry.name);
        if (entry.isDirectory()) walk(p, r);
        else if (entry.name === "SKILL.md") skillFiles.push(r);
      }
    };
    walk(commandsDir, "skills/commands");
    assert.ok(skillFiles.length > 0, "expected at least one skills/commands/*/SKILL.md — test would be vacuous otherwise");

    const offenders = [];
    let repointedSomewhere = false;
    for (const rel of skillFiles) {
      const body = readFileSync(path.join(dir, rel), "utf-8");
      if (body.includes("docs/agent-plans/")) offenders.push(rel);
      if (body.includes("docs/plans/")) repointedSomewhere = true;
    }
    assert.deepEqual(offenders, [], "these command-skills still reference docs/agent-plans/");
    assert.equal(
      repointedSomewhere,
      true,
      "expected at least one skills/commands/*/SKILL.md to contain docs/plans/ — proves the repoint rewrote content, not just that files are silent on the subject",
    );
  });
});

test("the instance's own selftest passes on day one (after generate:schemas)", { timeout: 600_000 }, () => {
  withClone((dir) => {
    const gen = spawnSync("node", ["scripts/generate-all-schemas.mjs"], { cwd: dir, encoding: "utf-8", timeout: 120_000, env: nestedEnv() });
    assert.equal(gen.status, 0, `generate:schemas failed: ${gen.stderr}${gen.stdout}`);
    const st = spawnSync("node", ["scripts/selftest.mjs"], { cwd: dir, encoding: "utf-8", timeout: 540_000, env: nestedEnv() });
    assert.equal(st.status, 0, `selftest failed inside the clone:\n${st.stdout}\n${st.stderr}`);
    assert.match(st.stdout, /analyze:instances\s+SKIP/);
    assert.match(st.stdout, /berd skills mirror in sync\s+SKIP/);
  });
});

test("symbient's coupled script + tests travel only when the symbient skill is selected", () => {
  const fixtureConfig = yaml.load(readFileSync(configPath, "utf-8"));
  const COUPLED = [
    "scripts/symbient-hatch.mjs",
    "scripts/lib/symbient-gates.mjs",
    "tests/symbient-hatch.test.mjs",
    "tests/symbient-gates.test.mjs",
  ];

  // Direction 1: the shared fixture does not list `symbient` — none of the
  // coupled artifacts, nor skills/symbient/ itself, should exist.
  withClone((dir) => {
    assert.equal(existsSync(path.join(dir, "skills", "symbient")), false, "skills/symbient/ must not exist when symbient is not selected");
    for (const rel of COUPLED) {
      assert.equal(existsSync(path.join(dir, rel)), false, `${rel} must not exist when symbient is not selected`);
    }
  });

  // Direction 2: a config that DOES select `symbient` must still receive the
  // skill's own template content and the coupled script — proving the
  // removal above is conditional, not an unconditional drop.
  const withSymbient = { ...fixtureConfig, skills: [...fixtureConfig.skills, "symbient"] };
  withCloneConfig(withSymbient, (dir) => {
    assert.equal(existsSync(path.join(dir, "skills", "symbient", "SEED.template.md")), true, "skills/symbient/SEED.template.md must exist when symbient is selected");
    assert.equal(existsSync(path.join(dir, "scripts", "symbient-hatch.mjs")), true, "scripts/symbient-hatch.mjs must exist when symbient is selected");
  });
});
