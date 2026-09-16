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
  mkdirSync, cpSync, renameSync, lstatSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  isPathExcluded, topLevelDecision, GENERATED_FILES, TOP_LEVEL_ALLOW, TOP_LEVEL_DENY,
} from "../scripts/lib/clone-excludes.mjs";

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
  // Closed structurally by the top-level declaration (clone-excludes.mjs).
  "instances", "integrations", "modules", ".hermes", "CHANGELOG.md", "VERSION.md",
  "SKILLS.md", "SYNC-GUIDE.md", "dashboard.yaml",
  // Framework history / self-description inside allowed entries.
  "docs/QUEUE.md", "docs/sessions", "docs/research", ".opencode/agents",
  // Framework self-description, strategy and framework-only fixtures/renderers
  // (fix round 1).
  "docs/POSITIONING.md", "docs/V2-DEVELOPMENT-PLAN.md", "docs/RAD-ORG-OS.md", "docs/ECOSYSTEM.md",
  "docs/integrations/buzz.md", "docs/VAULT-SAFETY-CASE-STUDY.md",
  "tests/fixtures/paper", "tests/fixtures/bread-coop-config.yaml",
  "templates/README.framework.md", "templates/session-one-pager.md", "scripts/render-templates.mjs",
  // Secrets a filesystem walk would have carried.
  ".npmrc", ".netrc", ".mcp.json", "credentials.json",
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

/** Every file under dir (relative posix paths), not following symlinks. */
function listFiles(dir, rel = "") {
  const out = [];
  for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(dir, r));
    else out.push(r);
  }
  return out;
}

/** Paths committed at HEAD — the generator's source set (not the index, not the working tree). */
function gitLsFiles(root) {
  const r = spawnSync("git", ["ls-tree", "-r", "-z", "--name-only", "--full-tree", "HEAD"], { cwd: root, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, `git ls-tree failed: ${r.stderr}`);
  return r.stdout.split("\0").filter(Boolean);
}

test("containment: every file in a fresh clone is a declared, committed framework file or a generator-written one", () => {
  const tracked = new Set(gitLsFiles(rootDir));
  withClone((dir) => {
    const strays = listFiles(dir)
      .filter((rel) => rel !== "node_modules") // the test's own symlink, see withClone
      .filter((rel) => {
        if (GENERATED_FILES.has(rel)) return false;
        const copyable = tracked.has(rel)
          && topLevelDecision(rel.split("/")[0]) === "allow"
          && !isPathExcluded(rel);
        return !copyable;
      });
    assert.deepEqual(strays, [], "these files are neither copyable framework files nor declared generator output");
  });
});

test("every top-level entry the framework tracks is declared (allowed or denied with a reason)", () => {
  const undeclared = [...new Set(gitLsFiles(rootDir).map((f) => f.split("/")[0]))]
    .filter((top) => !TOP_LEVEL_ALLOW.has(top) && !TOP_LEVEL_DENY.has(top));
  assert.deepEqual(undeclared, [], "declare these in TOP_LEVEL_ALLOW or TOP_LEVEL_DENY (scripts/lib/clone-excludes.mjs)");
});

test("genesis dao.json carries one scheme per URI, never https://https://", () => {
  withClone((dir) => {
    const raw = readFileSync(path.join(dir, ".well-known", "dao.json"), "utf-8");
    assert.doesNotMatch(raw, /https?:\/\/https?:\/\//);
    const dao = JSON.parse(raw);
    for (const [k, v] of Object.entries(dao)) {
      if (k.endsWith("URI")) assert.doesNotThrow(() => new URL(v), `${k} is not a valid URL: ${v}`);
    }
    assert.equal(new URL(dao.membersURI).host, "test-instance-os.example.org");
  });
});

test("genesis dao.json accepts org.base_url with or without a scheme", () => {
  const fixtureConfig = yaml.load(readFileSync(configPath, "utf-8"));
  for (const base_url of ["https://org.example.net", "org.example.net"]) {
    withCloneConfig({ ...fixtureConfig, org: { ...fixtureConfig.org, base_url } }, (dir) => {
      const dao = JSON.parse(readFileSync(path.join(dir, ".well-known", "dao.json"), "utf-8"));
      assert.equal(dao.membersURI, "https://org.example.net/.well-known/members.json", `base_url=${base_url}`);
    });
  }
});

test("repos.manifest.json in a clone lists no repositories", () => {
  withClone((dir) => {
    const manifest = JSON.parse(readFileSync(path.join(dir, "repos.manifest.json"), "utf-8"));
    assert.deepEqual(manifest.repositories, []);
    assert.equal(manifest.baseDirectory, "repos", "schema kept");
  });
});

test("a clone's CLAUDE.md describes the instance, not the framework", () => {
  withClone((dir) => {
    const claude = readFileSync(path.join(dir, "CLAUDE.md"), "utf-8");
    assert.doesNotMatch(claude, /org-os framework\*\*/i, "must not call itself the org-os framework");
    assert.doesNotMatch(claude, /This workspace is the \*\*org-os framework/i);
    assert.doesNotMatch(claude, /Framework thinking/);
    assert.match(claude, /\*\*test-instance-os\*\*, an org-os instance/);
    assert.equal(existsSync(path.join(dir, "knowledge", "INDEX.md")), true);
    assert.doesNotMatch(readFileSync(path.join(dir, "knowledge", "INDEX.md"), "utf-8"), /Framework reference/i);
  });
});

test("docs/ in a clone no longer points at docs/agent-plans/", () => {
  withClone((dir) => {
    const offenders = listFiles(dir, "docs")
      .filter((r) => r.endsWith(".md") && readFileSync(path.join(dir, r), "utf-8").includes("docs/agent-plans/"));
    assert.deepEqual(offenders, []);
    assert.match(readFileSync(path.join(dir, "docs", "PLANS.md"), "utf-8"), /docs\/plans\//);
  });
  // The framework's own copy is untouched.
  assert.match(readFileSync(path.join(rootDir, "docs", "PLANS.md"), "utf-8"), /docs\/agent-plans\//);
});

test("no npm script in a clone cd's or --prefix'es into a directory the clone lacks", () => {
  withClone((dir) => {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf-8"));
    const dead = [];
    for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
      const dirs = [
        ...[...cmd.matchAll(/--prefix[=\s]+([\w.@/-]+)/g)].map((m) => m[1]),
        ...[...cmd.matchAll(/(?:^|&&|;|\|\|)\s*cd\s+([\w.@/-]+)/g)].map((m) => m[1]),
      ];
      for (const d of dirs) if (!existsSync(path.join(dir, d))) dead.push(`${name} -> ${d}`);
    }
    assert.deepEqual(dead, []);
    for (const gone of ["build:site", "serve:site", "admin", "admin:dev", "test:admin", "paperclip"]) {
      assert.equal(pkg.scripts[gone], undefined, `${gone} should have been dropped`);
    }
  });
});

/**
 * A disposable git clone of the framework whose tree mirrors this working tree
 * (tracked + untracked-but-not-ignored files, committed there), so the proof
 * exercises the code under test even before it is committed here. The real
 * framework tree is never modified.
 */
function withDisposableFramework(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "clone-structural-"));
  const fw = path.join(base, "framework");
  const git = (args, cwd = fw) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout;
  };
  try {
    git(["clone", "-q", "--no-hardlinks", rootDir, fw], base);
    const ls = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: rootDir, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024,
    }).stdout.split("\0").filter(Boolean);
    for (const rel of ls) {
      const src = path.join(rootDir, rel);
      const dst = path.join(fw, rel);
      if (!existsSync(src)) { rmSync(dst, { force: true }); continue; }
      // Regular files only: a symlinked node_modules (worktrees, test
      // harnesses) is untracked and not matched by the `node_modules/` ignore.
      if (!lstatSync(src).isFile()) continue;
      mkdirSync(path.dirname(dst), { recursive: true });
      cpSync(src, dst);
    }
    const id = ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid"];
    git(["add", "-A"]);
    git([...id, "commit", "-q", "--allow-empty", "-m", "mirror working tree"]);
    return fn(fw, { git, id });
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

function cloneFrom(fw, { git = false, extra = [] } = {}) {
  const dst = mkdtempSync(path.join(tmpdir(), "clone-structural-out-"));
  rmSync(dst, { recursive: true, force: true });
  const r = spawnSync("node", [path.join(fw, "scripts", "clone-framework.mjs"), "--target", dst, "--config", configPath, ...(git ? [] : ["--no-git"]), ...extra], {
    encoding: "utf-8", timeout: 120_000, env: nestedEnv(),
  });
  return { dst, r };
}

const MARKER = "INJECTED-FIXTURE-MARKER-7f3a";

/** Every file in dir whose bytes contain MARKER (relative paths). */
function filesContainingMarker(dir) {
  return listFiles(dir).filter((r) => r !== "node_modules" && readFileSync(path.join(dir, r)).includes(MARKER));
}

test("structural: only COMMITTED content reaches a clone — untracked, staged, intent-to-add, skip-worktree, edited-tracked and symlink-swapped content never does", { timeout: 300_000 }, () => {
  withDisposableFramework((fw, { git, id }) => {
    // Committed first: a directory that will later be swapped for a symlink,
    // a new undeclared top-level dir, and npm scripts whose `cd` target is not
    // a clone directory (6d must keep them).
    mkdirSync(path.join(fw, "docs", "swap"));
    writeFileSync(path.join(fw, "docs", "swap", "a.md"), "# committed content\n");
    mkdirSync(path.join(fw, "brand-new-area"));
    writeFileSync(path.join(fw, "brand-new-area", "notes.md"), "# new\n");
    const pkgPath = path.join(fw, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    pkg.scripts["fixture:cd-dash"] = "cd - && node scripts/selftest.mjs";
    pkg.scripts["fixture:cd-abs"] = "cd /tmp && ls";
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    git(["add", "docs/swap", "brand-new-area", "package.json"]);
    git([...id, "commit", "-q", "-m", "fixture: swap dir, undeclared top-level dir, cd scripts"]);
    symlinkSync(path.join(rootDir, "node_modules"), path.join(fw, "node_modules"), "dir");

    // Never committed:
    // (a) untracked secrets — one on the deny-list, one only the source set stops
    writeFileSync(path.join(fw, ".npmrc"), `//registry.npmjs.org/:_authToken=${MARKER}\n`);
    writeFileSync(path.join(fw, "credentials.json"), `{"token":"${MARKER}"}\n`);
    writeFileSync(path.join(fw, "scripts", "local-token.txt"), `${MARKER}\n`);
    // (b) a secret pasted into the tracked .env.example (working-tree edit)
    writeFileSync(path.join(fw, ".env.example"), readFileSync(path.join(fw, ".env.example"), "utf-8") + `NOTION_API_KEY=${MARKER}\n`);
    // (c) staged but never committed
    writeFileSync(path.join(fw, "scripts", "staged-secret.txt"), `${MARKER}\n`);
    git(["add", "scripts/staged-secret.txt"]);
    // (d) intent-to-add: tracked by name, content never in git
    writeFileSync(path.join(fw, "scripts", "intent-to-add.txt"), `${MARKER}\n`);
    git(["add", "-N", "scripts/intent-to-add.txt"]);
    // (e) skip-worktree: an edit to a tracked file invisible to `git status`
    git(["update-index", "--skip-worktree", "scripts/selftest.mjs"]);
    writeFileSync(path.join(fw, "scripts", "selftest.mjs"), readFileSync(path.join(fw, "scripts", "selftest.mjs"), "utf-8") + `// ${MARKER}\n`);
    // (f) a committed directory replaced on disk by a symlink to outside the repo
    const outside = path.join(path.dirname(fw), "outside");
    mkdirSync(outside);
    writeFileSync(path.join(outside, "a.md"), `# ${MARKER}\n`);
    rmSync(path.join(fw, "docs", "swap"), { recursive: true, force: true });
    symlinkSync(outside, path.join(fw, "docs", "swap"), "dir");

    const { dst, r } = cloneFrom(fw);
    try {
      assert.equal(r.status, 0, `clone failed: ${r.stderr}${r.stdout}`);
      assert.deepEqual(filesContainingMarker(dst), [], "uncommitted content reached the clone");
      for (const p of [".npmrc", "credentials.json", "scripts/local-token.txt", "scripts/staged-secret.txt",
        "scripts/intent-to-add.txt", "brand-new-area"]) {
        assert.equal(existsSync(path.join(dst, p)), false, `${p} reached the clone`);
      }
      assert.equal(readFileSync(path.join(dst, "docs", "swap", "a.md"), "utf-8"), "# committed content\n",
        "the committed blob, not the symlink target, must be written");
      assert.match(r.stdout, /skipped undeclared top-level entry: brand-new-area/);
      assert.doesNotMatch(r.stderr, /not a git work tree/);
      const clonePkg = JSON.parse(readFileSync(path.join(dst, "package.json"), "utf-8"));
      assert.ok(clonePkg.scripts["fixture:cd-dash"], "`cd -` must not count as a missing clone directory");
      assert.ok(clonePkg.scripts["fixture:cd-abs"], "an absolute cd target is not a clone directory");
    } finally {
      rmSync(dst, { recursive: true, force: true });
    }

    // Non-git fallback (zip download): still clones, warns loudly — twice, the
    // second time last — and makes NO genesis commit unless opted in.
    // Moved aside rather than deleted: a git background process can still be
    // writing inside .git, which makes a recursive rm fail with ENOTEMPTY.
    renameSync(path.join(fw, ".git"), path.join(path.dirname(fw), "git-parked"));
    const fb = cloneFrom(fw, { git: true });
    try {
      assert.equal(fb.r.status, 0, `fallback clone failed: ${fb.r.stderr}${fb.r.stdout}`);
      assert.equal((fb.r.stderr.match(/secret-safety guarantee/g) || []).length, 2, "warning printed before AND after the run");
      assert.match(fb.r.stderr.trimEnd(), /--commit-unverified to commit anyway\.$/, "the warning is the last thing printed");
      assert.match(fb.r.stdout, /stage 8\] skipped \(non-git fallback/);
      assert.equal(existsSync(path.join(fb.dst, ".git")), false, "no genesis commit in fallback mode");
      assert.match(fb.r.stdout, /skipped undeclared top-level entry: brand-new-area/);
      assert.equal(existsSync(path.join(fb.dst, ".npmrc")), false, "deny-list still applies in fallback");
    } finally {
      rmSync(fb.dst, { recursive: true, force: true });
    }
    const opt = cloneFrom(fw, { git: true, extra: ["--commit-unverified"] });
    try {
      assert.equal(opt.r.status, 0, `opt-in fallback clone failed: ${opt.r.stderr}${opt.r.stdout}`);
      assert.equal(existsSync(path.join(opt.dst, ".git")), true, "--commit-unverified makes the genesis commit");
    } finally {
      rmSync(opt.dst, { recursive: true, force: true });
    }
  });
});

test("a clone's VAULT-SAFETY.md keeps the rules but not the framework's incident narrative", () => {
  withClone((dir) => {
    const doc = readFileSync(path.join(dir, "docs", "VAULT-SAFETY.md"), "utf-8");
    assert.match(doc, /## The Iron Rules/);
    assert.doesNotMatch(doc, /Case study|stversions\/` \(partial|43 full notes/);
  });
});
