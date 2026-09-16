// tests/clone-excludes.test.mjs
//
// The exclusion rules are the contract that keeps the framework's own
// operational content — session log, plans, knowledge graph, secrets — out of
// every instance it generates. Verified 2026-09-13: without them a fresh
// clone carried 10 framework memory days, a 7.7 MB graph, 284 tracked
// framework files and a copy of the framework's .env.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isExcluded, isPathExcluded, topLevelDecision, TOP_LEVEL_ALLOW, TOP_LEVEL_DENY, GENERATED_FILES,
} from "../scripts/lib/clone-excludes.mjs";

const excluded = (rel, isDir = false) => isExcluded(rel, rel.split("/").pop(), isDir);

test("secrets never travel: .env and .env.* are excluded, .env.example is not", () => {
  assert.equal(excluded(".env"), true);
  assert.equal(excluded(".env.local"), true);
  assert.equal(excluded(".env.production.local"), true);
  assert.equal(excluded(".env.example"), false);
});

test("the framework's session log stays with the framework; the memory/ dir itself is kept", () => {
  assert.equal(excluded("memory/2026-04-25.md"), true);
  assert.equal(excluded("memory/sync-2026-08-29.md"), true);
  assert.equal(excluded("memory", true), false);
  assert.equal(excluded("memory/reports", true), true);
});

test("framework operational content dirs are excluded", () => {
  for (const d of [
    "graphify-out", "renders", "docs/agent-plans", "docs/superpowers",
    ".superpowers", ".agents", "data/federation/frontier", "site",
    "tests/buzz-integration", "tests/paper-integration", "tests/instance-doctor",
  ]) {
    assert.equal(excluded(d, true), true, `${d} should be excluded`);
  }
});

test("framework-only files are excluded", () => {
  for (const f of [
    ".buzz-state.json", ".DS_Store", "data/knowledge-gaps.yaml",
    "PAPERCLIP_DEPLOYMENT_GUIDE.md", "RESEARCH_INTELLIGENCE_PLAN.md",
    "tests/clone-genesis.test.mjs", "tests/clone-framework.test.mjs",
    "tests/clone-framework-health.test.mjs", "MASTERPROMPT.md", "README.md",
    "tests/scripts/module-manifests.test.mjs", "tests/scripts/validate-identity-target.test.mjs",
    ".github/workflows/deploy-pages.yml", ".github/workflows/drift.yml", ".github/workflows/validate.yml",
  ]) {
    assert.equal(excluded(f), true, `${f} should be excluded`);
  }
});

test("generic CI workflow is NOT excluded", () => {
  assert.equal(excluded(".github/workflows/generate-schemas.yml"), false);
});

test("instance machinery and structure are NOT excluded", () => {
  for (const p of [
    "scripts/initialize.mjs", "scripts/lib/discover-skills.mjs", "docs/plans",
    "docs/FEDERATION.md", "skills/org-os-init/SKILL.md", ".claude/commands/close.md",
    "data/projects.yaml", "templates/README.instance.md", "tests/render.test.mjs",
    ".well-known/dao.json.template", ".gitignore", ".env.example",
  ]) {
    assert.equal(excluded(p, p === "docs/plans"), false, `${p} must be copied`);
  }
});

test("framework-content excludes are root-anchored, not basename matches at any depth", () => {
  // A nested directory that merely shares a name with a framework dir is instance content.
  assert.equal(excluded("skills/renders", true), false);
  assert.equal(excluded("packages/operations/graphify-out", true), false);
  assert.equal(excluded("docs/.agents", true), false);
  // …while the framework's own root-level ones still go.
  assert.equal(excluded("renders", true), true);
  assert.equal(excluded("graphify-out", true), true);
  assert.equal(excluded(".agents", true), true);
});

test("site/ exclusion is root-anchored: the framework's own root site/ is excluded, an instance's nested site/ is not", () => {
  assert.equal(excluded("site", true), true);
  assert.equal(excluded("packages/operations/site", true), false);
});

test("git, deps, worktrees and .DS_Store are excluded at ANY depth", () => {
  assert.equal(excluded("site/node_modules", true), true);
  assert.equal(excluded("packages/operations/.git", true), true);
  assert.equal(excluded("content/work/.DS_Store"), true);
  assert.equal(excluded(".claude/worktrees", true), true);
});

test("credential-shaped files are excluded at any depth (defence in depth for the non-git fallback)", () => {
  for (const f of [
    ".npmrc", ".netrc", ".pgpass", ".mcp.json", "credentials.json", "credentials.prod.json",
    "server.pem", "packages/operations/deploy.key", "certs/client.p12",
  ]) {
    assert.equal(excluded(f), true, `${f} should be excluded`);
  }
  assert.equal(excluded("docs/credentials-guide.md"), false);
});

test("isPathExcluded: an excluded directory excludes every file beneath it", () => {
  assert.equal(isPathExcluded("site/src/pages/index.astro"), true);
  assert.equal(isPathExcluded("docs/sessions/2026-09-10-one-pager.md"), true);
  assert.equal(isPathExcluded("tests/instance-doctor/assess.test.mjs"), true);
  assert.equal(isPathExcluded("packages/operations/node_modules/x/index.js"), true);
  assert.equal(isPathExcluded(".opencode/agents/build.md"), true);
  assert.equal(isPathExcluded(".claude/worktrees/w/README.md"), true);
  // …and nothing else is dragged along.
  assert.equal(isPathExcluded("scripts/lib/clone-excludes.mjs"), false);
  assert.equal(isPathExcluded(".opencode/commands/close.md"), false);
  assert.equal(isPathExcluded("docs/PLANS.md"), false);
  assert.equal(isPathExcluded("docs/QUEUE.md"), true);
});

test("top-level declarations: allow and deny are disjoint, and every entry has a reason", () => {
  for (const name of TOP_LEVEL_ALLOW.keys()) {
    assert.equal(TOP_LEVEL_DENY.has(name), false, `${name} is both allowed and denied`);
  }
  for (const [name, why] of [...TOP_LEVEL_ALLOW, ...TOP_LEVEL_DENY]) {
    assert.ok(typeof why === "string" && why.length > 10, `${name} needs a one-line reason`);
  }
  assert.equal(topLevelDecision("scripts"), "allow");
  assert.equal(topLevelDecision("instances"), "deny");
  assert.equal(topLevelDecision("some-new-dir"), "undeclared");
});

test("top-level files the generator writes are never also copied", () => {
  for (const f of GENERATED_FILES) {
    if (f.includes("/")) continue;
    assert.notEqual(topLevelDecision(f), "allow", `${f} is generated — it must not be on the copy allow-list`);
  }
});
