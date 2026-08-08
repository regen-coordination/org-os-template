import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPage, SUPPORTED_PAGES } from "../src/page-core/render-page.mjs";
import { buildState } from "../src/page-core/build-state.mjs";

const NOW = new Date("2026-08-08T12:00:00Z");
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

// Walks a fixture instance into the flat { "relative/path": contents } map the page core consumes.
// See test/fixtures/README.md — fixture dates are calibrated to NOW below; change both or neither.
function loadFixture(name = "instance-a") {
  const walk = (dir, prefix = "") => {
    const files = {};
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) Object.assign(files, walk(p, `${prefix}${e.name}/`));
      else files[`${prefix}${e.name}`] = fs.readFileSync(p, "utf-8");
    }
    return files;
  };
  return walk(path.join(fixturesDir, name));
}

const state = buildState(loadFixture(), { now: NOW });

test("catalog", () => {
  assert.deepEqual(SUPPORTED_PAGES, ["dashboard", "projects", "tasks", "instances", "decisions", "plans", "this-week"]);
});

test("projects page renders the shim table shape", () => {
  const md = renderPage("projects", state);
  assert.ok(md.startsWith("# Projects\n\n2 workstreams.\n"));
  assert.ok(md.includes("| Alpha Project | develop |"));
});

test("tasks page renders tiers with checkboxes", () => {
  const md = renderPage("tasks", state);
  assert.ok(md.includes("## Critical (1)"));
  assert.ok(md.includes("- [ ] Overdue thing"));
  assert.ok(md.includes("## Completed (1)"));
});

test("instances / decisions / plans / this-week", () => {
  assert.ok(renderPage("instances", state).includes("| child-1 | Child One |"));
  assert.equal(renderPage("decisions", state), state.decisionsRaw);
  assert.equal(renderPage("plans", state), state.plansRaw);
  const tw = renderPage("this-week", state);
  assert.ok(tw.includes("## Meetings") && tw.includes("Weekly Sync"));
});

test("dashboard composes sections; unknown page throws", () => {
  const md = renderPage("dashboard", state);
  assert.ok(md.includes("# instance-a") && md.includes("## Projects") && md.includes("## This Week"));
  assert.throws(() => renderPage("nope", state), /Unknown page/);
});
