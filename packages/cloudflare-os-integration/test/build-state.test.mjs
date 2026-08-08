import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

test("buildState builds the page view-model from raw files", () => {
  const state = buildState(loadFixture(), { now: NOW });
  assert.deepEqual(state.identity, { name: "instance-a", type: "LocalNode" });

  const alpha = state.projects.find((p) => p.name === "Alpha Project");
  assert.equal(alpha.stage, "develop");
  assert.equal(alpha.taskCount, 2);                     // merged from packages/operations/projects/alpha.md
  assert.equal(state.projects.length, 2);

  assert.deepEqual(state.tasks.critical.map((t) => t.text), ["Overdue thing"]);
  assert.deepEqual(state.tasks.urgent.map((t) => t.text).sort(), ["Grant application", "Soon thing"]);
  assert.deepEqual(state.tasks.upcoming.map((t) => t.text), ["Someday thing"]);
  assert.equal(state.tasks.completed.length, 1);

  assert.deepEqual(state.instances, [{ id: "child-1", name: "Child One", type: "LocalNode", maturity: "production",
    framework_version: "0.5", last_sync: "2026-08-01", cloned: true, drift_count: 1 }]);

  assert.equal(state.federation.network, "test-net");
  assert.equal(state.federation.peers.length, 1);
  assert.deepEqual(state.events.thisWeek.map((e) => e.title), ["Community Call"]);
  assert.deepEqual(state.meetings.thisWeek.map((m) => m.title), ["Weekly Sync"]);
  assert.ok(state.decisionsRaw.startsWith("# ") || state.decisionsRaw.startsWith("## "));
  assert.ok(state.plansRaw.length > 0);
  assert.deepEqual(state.funding, { upcoming: [] });
});

test("federation: root-level peers/upstream shape (what real instances actually use)", () => {
  const s = buildState(loadFixture("instance-b"), { now: NOW });
  assert.equal(s.federation.network, "test-net");
  assert.deepEqual(s.federation.peers.map((p) => p.name), ["peer-one", "peer-two"]);
  assert.equal(s.federation.upstream.length, 1);
});

// Boundary regression coverage: `now` (2026-08-08T12:00:00Z) carries a
// time-of-day, but item dates are bare YYYY-MM-DD strings (UTC midnight).
// Without normalizing `now` to a calendar date first, a same-day item's
// midnight sorts *before* `now`'s noon and silently drops out of both
// buckets, and an item at exactly now+7d sorts *before* weekEnd's noon and
// wrongly lands in thisWeek. Pins all four regions of the window using an
// inline files map — events and meetings share loadCalendarItems, so this
// covers meetings' path too; only events is exercised here.
test("events: this-week window pins all four boundary regions", () => {
  const files = {
    "data/events.yaml": [
      "events:",
      "  - title: AtNow",
      '    date: "2026-08-08"', // same calendar day as `now` → in thisWeek
      "  - title: Inside",
      '    date: "2026-08-10"', // strictly inside the window → in thisWeek
      "  - title: AtNowPlus7",
      '    date: "2026-08-15"', // exactly now+7d, exclusive upper bound → NOT in thisWeek, in upcoming
      "  - title: WellPast",
      '    date: "2026-09-01"', // well past the window → in upcoming
      "",
    ].join("\n"),
  };
  const state = buildState(files, { now: NOW });
  assert.deepEqual(state.events.thisWeek.map((e) => e.title), ["AtNow", "Inside"]);
  assert.deepEqual(state.events.upcoming.map((e) => e.title), ["AtNowPlus7", "WellPast"]);
});
