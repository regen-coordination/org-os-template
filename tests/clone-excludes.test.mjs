// tests/clone-excludes.test.mjs
//
// The exclusion rules are the contract that keeps the framework's own
// operational content — session log, plans, knowledge graph, secrets — out of
// every instance it generates. Verified 2026-09-13: without them a fresh
// clone carried 10 framework memory days, a 7.7 MB graph, 284 tracked
// framework files and a copy of the framework's .env.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isExcluded } from "../scripts/lib/clone-excludes.mjs";

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
    ".superpowers", ".agents", "data/federation/frontier",
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
  ]) {
    assert.equal(excluded(f), true, `${f} should be excluded`);
  }
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
