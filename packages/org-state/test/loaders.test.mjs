import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkspaceFiles } from "../read-files.mjs";
import { loadWorkspaceState, yamlErrors, loadHeartbeat, listMemory, parseDecisions, loadQueue, loadFunding } from "../index.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const NOW = new Date("2026-09-25T12:00:00Z");
const ws = readWorkspaceFiles(join(FIX, "ws")).files;
const bad = readWorkspaceFiles(join(FIX, "ws-bad")).files;

test("heartbeat groups tasks by heading", () => {
  const hb = loadHeartbeat(ws);
  assert.equal(hb.present, true);
  assert.deepEqual(hb.sections.map((s) => s.heading), ["Funding", "Technical"]);
  assert.equal(hb.open, 3);
  assert.equal(hb.done, 1);
  assert.deepEqual(loadHeartbeat({}), { present: false, sections: [], open: 0, done: 0 });
});

test("memory entries: newest first, heading and focus", () => {
  const m = listMemory(ws);
  assert.deepEqual(m.map((e) => e.id), ["2026-09-02", "2026-09-01"]);
  assert.equal(m[0].title, "2026-09-02 — Second day");
  assert.equal(m[0].focus, "ship the thing");
  assert.equal(m[1].focus, null);
});

test("decisions: both separators, both status styles, conventions skipped", () => {
  const d = parseDecisions(ws["DECISIONS.md"]);
  assert.deepEqual(d.map((x) => [x.n, x.date, x.title, x.status]), [
    [1, "2026-09-20", "Adopt the cockpit", "active"],
    [2, "2026-09-01", "Older call", "superseded"],
  ]);
  assert.ok(d[0].body.includes("Body one."));
  assert.ok(!d[0].body.includes("Body two."));
  assert.deepEqual(parseDecisions(undefined), []);
});

test("queue prefers the framework path", () => {
  assert.equal(loadQueue(ws).path, "docs/agent-plans/QUEUE.md");
  assert.equal(loadQueue({ "docs/plans/QUEUE.md": "x" }).path, "docs/plans/QUEUE.md");
  assert.equal(loadQueue({}), null);
});

test("funding: upcoming sorted with daysLeft, past dropped, applied is active", () => {
  const f = loadFunding(ws, NOW);
  assert.equal(f.upcoming.length, 1);
  assert.equal(f.upcoming[0].title, "Gitcoin round");
  assert.ok([9, 10, 11].includes(f.upcoming[0].daysLeft));
  assert.deepEqual(f.active.map((o) => o.title), ["Applied grant"]);
  assert.deepEqual(loadFunding({}, NOW), { upcoming: [], active: [] });
});

test("loadWorkspaceState combines page-core state with the new loaders", () => {
  const s = loadWorkspaceState(ws, { now: NOW });
  assert.equal(s.identity.name, "Fixture Org");
  assert.equal(s.projects.length, 2);
  assert.equal(s.heartbeat.open, 3);
  assert.equal(s.decisions.length, 2);
  assert.equal(s.funding.upcoming.length, 1);
  assert.equal(s.events.thisWeek.length, 1);
});

test("malformed workspace degrades instead of throwing", () => {
  const s = loadWorkspaceState(bad, { now: NOW });
  assert.equal(s.identity.name, null);
  assert.deepEqual(s.projects, []);
  assert.equal(s.heartbeat.present, false);
  assert.deepEqual(s.memory, []);
  const errs = yamlErrors(bad);
  assert.equal(errs.length, 2);
  assert.ok(errs.some((e) => e.startsWith("federation.yaml:")));
  assert.ok(errs.some((e) => e.startsWith("data/projects.yaml:")));
  assert.deepEqual(yamlErrors(ws), []);
});
