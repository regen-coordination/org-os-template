// The declared lifecycles (scripts/lib/lifecycles.mjs): the dashboard's counting, funding and project
// rules, the QUEUE parser, and guards that keep the docs and data headers saying the same thing as
// the table. (The instance copy also checks its own data; the framework has none to check.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ORG_ROOT } from "../helpers/repo-paths.mjs";
import { LIFECYCLES, canonical, classifyFunding, parseQueue, projectIsHidden, projectIsWorking, projectRank, tally, valuesOf } from "../../scripts/lib/lifecycles.mjs";

const read = (rel) => readFileSync(path.join(ORG_ROOT, rel), "utf-8");

test("every lifecycle is well formed: its initial, next and alias targets are its own values", () => {
  for (const [id, l] of Object.entries(LIFECYCLES)) {
    const values = valuesOf(id);
    assert.equal(new Set(values).size, values.length, `${id}: a value repeats`);
    if (l.initial !== null) assert.ok(values.includes(l.initial), `${id}: initial`);
    for (const [from, tos] of Object.entries(l.next ?? {})) {
      assert.ok(values.includes(from), `${id}: next from ${from}`);
      for (const to of tos) assert.ok(values.includes(to), `${id}: ${from} → ${to}`);
    }
    if (l.next) for (const v of values) assert.ok(Object.hasOwn(l.next, v), `${id}: no moves declared for ${v}`);
    for (const to of Object.values(l.alias ?? {})) assert.ok(values.includes(to), `${id}: alias → ${to}`);
  }
});

test("canonical: case and old vocabularies map in; unknown values stay unknown", () => {
  assert.equal(canonical("projects", "develop"), "Develop");
  assert.equal(canonical("projects", "in-progress"), "Develop");
  assert.equal(canonical("projects", "archived"), "Archive");
  assert.equal(canonical("projects", undefined), "Discovery");
  assert.equal(canonical("knowledge", "stub"), "none");
  assert.equal(canonical("funding", "pending"), "monitoring", "the framework template's word");
  assert.equal(canonical("funding", "rejected"), "declined");
  assert.equal(canonical("funding", "maybe"), null);
  assert.equal(canonical("plans", "CLOSED 2026-09-27 — all 28 questions"), null);
});

test("tally accounts for every entry: the total is all of them, not the ones on the line", () => {
  const t = tally("funding", ["monitoring", "monitoring", "open", "closed", "closed", "maybe", undefined]);
  assert.equal(t.total, 7);
  assert.equal(t.line.monitoring, 3, "a missing status is the initial one");
  assert.equal(t.line.awarded, 0, "every stage on the line is present");
  assert.deepEqual(t.aside, { open: 1 });
  assert.deepEqual(t.terminal, { closed: 2 });
  assert.deepEqual(t.unknown, { maybe: 1 });
  const plans = tally("plans", ["CLOSED 2026-09-27 — all 28", "draft", "active"]);
  assert.deepEqual(plans.unknown, { CLOSED: 1, draft: 1 }, "prose statuses are named by their first word");
});

test("funding: a closed or declined opportunity is never upcoming (it was the dashboard's top suggestion)", () => {
  const days = (d) => ({ soon: 3, later: 20, past: -1 })[d];
  const opps = [
    { id: "closed", status: "closed", deadline: "soon" },
    { id: "declined", status: "declined", deadline: "soon" },
    { id: "watch", status: "monitoring", deadline: "later" },
    { id: "open", status: "open", deadline: "soon" },
    { id: "applied", status: "applied", deadline: "later" },
    { id: "gone", status: "researching", deadline: "past" },
    { id: "roster", status: "open" },
    { id: "legacy", status: "active" },
    { id: "idle", status: "monitoring" },
  ];
  const { upcoming, active } = classifyFunding(opps, days);
  assert.deepEqual(upcoming.map((o) => o.id), ["open", "watch"]);
  assert.deepEqual(active.map((o) => o.id), ["applied", "roster", "legacy"]);
});

test("projects: working stages first, unknown last (indexOf's -1 used to sort them first)", () => {
  const order = ["Sunset", "mystery", "Discovery", "Develop", "Deploy"].sort((a, b) => projectRank(a) - projectRank(b));
  assert.deepEqual(order, ["Develop", "Deploy", "Discovery", "Sunset", "mystery"]);
  assert.ok(projectIsWorking("Develop") && projectIsWorking("active") && !projectIsWorking("Discovery"));
  assert.ok(projectIsHidden("Archive") && projectIsHidden("done") && !projectIsHidden("Sunset"));
});

test("parseQueue reads both item shapes, with the plan link on a continuation line", () => {
  const md = [
    "# Queue",
    "## Active",
    "- **Crew — second cycle** (proposed 2026-10-12, not opened). Plan:",
    "  [`crew-cycle-2.md`](crew-cycle-2.md). Part 1 needs only a go.",
    "",
    "- [Site](site.md) — the site system",
    "## Queued",
    "1. **Research programme.** Plan: [`r.md`](r.md)",
    "## Completed",
    "- **Done thing**",
    "## Notes",
    "- **Not a plan**",
  ].join("\n");
  const q = parseQueue(md);
  assert.deepEqual(q.active, [
    { title: "Crew — second cycle", file: "crew-cycle-2.md", description: "" },
    { title: "Site", file: "site.md", description: "the site system" },
  ]);
  assert.deepEqual(q.queued, [{ title: "Research programme", file: "r.md", description: "" }]);
  assert.equal(q.completed.length, 1);
  assert.deepEqual(q.backlog, []);
});

// A fresh instance rewrites some of these docs, so each line is checked where it is still present: a doc
// that names the vocabulary must name this one.
test("docs that name a lifecycle name the same vocabulary as the table", () => {
  const ideas = [...LIFECYCLES.ideas.line, ...LIFECYCLES.ideas.terminal].join(" → ");
  const checks = [
    ["docs/IDEA-HATCHING.md", /^surfaced → [^\n]+$/m, ideas],
    ["data/ideas.yaml", /^# Lifecycle: ([^\n]+)$/m, ideas],
    ["docs/PLANS.md", /^status: \w+\s+# (scoping[^\n]+)$/m, valuesOf("plans").join(" | ")],
  ];
  let seen = 0;
  for (const [file, re, want] of checks) {
    let text;
    try {
      text = read(file);
    } catch {
      continue;
    }
    const m = text.match(re);
    if (!m) continue;
    seen += 1;
    assert.equal((m[1] ?? m[0]).trim(), want, file);
  }
  return seen;
});

test("the framework's funding template words all map onto the lifecycle", () => {
  let text = "";
  try {
    text = read("data/funding-opportunities.yaml");
  } catch {
    return;
  }
  const m = text.match(/#\s+status: \w+\s+# ([^\n]+)/);
  if (!m) return; // an instance that dropped the template comment
  for (const w of m[1].split("|").map((x) => x.trim())) assert.notEqual(canonical("funding", w), null, w);
});
