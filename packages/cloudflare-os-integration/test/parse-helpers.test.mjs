import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCheckboxes, daysUntil, getRelativeAge, parseFrontmatter } from "../src/page-core/parse-helpers.mjs";

const NOW = new Date("2026-08-08T12:00:00Z");

test("extractCheckboxes parses categories, due dates, assignees", () => {
  const md = "## Ops\n- [ ] Ship it (due: 2026-08-10) @luiz\n- [x] Done thing\n### Governance\n- [ ] Vote\n- [ ] _(placeholder)_\n";
  assert.deepEqual(extractCheckboxes(md), [
    { text: "Ship it", done: false, category: "Ops", due: "2026-08-10", assignee: "luiz" },
    { text: "Done thing", done: true, category: "Ops", due: null, assignee: null },
    { text: "Vote", done: false, category: "Governance", due: null, assignee: null },
  ]);
});

test("daysUntil is midnight-based and now-injected", () => {
  assert.equal(daysUntil("2026-08-10", NOW), 2);
  assert.equal(daysUntil("2026-08-08", NOW), 0);
  assert.equal(daysUntil(null, NOW), Infinity);
});

test("getRelativeAge buckets", () => {
  assert.equal(getRelativeAge("2026-08-08T11:30:00Z", NOW), "30m ago");
  assert.equal(getRelativeAge("2026-08-01T12:00:00Z", NOW), "1w ago");
  assert.equal(getRelativeAge(null, NOW), null);
});

test("parseFrontmatter splits yaml and body", () => {
  assert.deepEqual(parseFrontmatter("---\ntitle: X\nstatus: develop\n---\nBody"), {
    data: { title: "X", status: "develop" }, content: "Body",
  });
  assert.deepEqual(parseFrontmatter("no fm"), { data: {}, content: "no fm" });
});

test("getRelativeAge hour and day buckets", () => {
  assert.equal(getRelativeAge("2026-08-08T09:00:00Z", NOW), "3h ago");
  assert.equal(getRelativeAge("2026-08-05T12:00:00Z", NOW), "3d ago");
});

test("daysUntil handles past dates", () => {
  assert.equal(daysUntil("2026-08-01", NOW), -7);
});

test("parseFrontmatter returns empty data for malformed yaml", () => {
  assert.deepEqual(parseFrontmatter("---\n: : bad\n---\nBody"), { data: {}, content: "Body" });
});
