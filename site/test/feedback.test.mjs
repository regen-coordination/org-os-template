// site/test/feedback.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { feedbackUrl } from "../src/lib/feedback.mjs";

const base = { title: "Setup", source: "docs/SETUP.md", verified: "abc1234", repoUrl: "https://github.com/o/r" };
const parse = (u) => new URL(u);

test("the link opens a new issue on the repository with the label", () => {
  const u = parse(feedbackUrl({ ...base, kind: "problem" }));
  assert.equal(u.origin + u.pathname, "https://github.com/o/r/issues/new");
  assert.equal(u.searchParams.get("labels"), "docs-feedback");
});

test("the issue names the page, its source and the commit it was checked at", () => {
  const u = parse(feedbackUrl({ ...base, kind: "problem" }));
  assert.equal(u.searchParams.get("title"), "Docs — Problem: Setup");
  const body = u.searchParams.get("body");
  assert.match(body, /Page: Setup/);
  assert.match(body, /Source: docs\/SETUP\.md/);
  assert.match(body, /Checked against: abc1234/);
});

test("each kind has its own title and prompt", () => {
  assert.equal(parse(feedbackUrl({ ...base, kind: "useful" })).searchParams.get("title"), "Docs — Useful: Setup");
  assert.equal(parse(feedbackUrl({ ...base, kind: "not-useful" })).searchParams.get("title"), "Docs — Not useful: Setup");
  assert.match(parse(feedbackUrl({ ...base, kind: "not-useful" })).searchParams.get("body"), /What were you looking for/);
});

test("an unverified page says so instead of printing null", () => {
  const body = parse(feedbackUrl({ ...base, verified: null, kind: "useful" })).searchParams.get("body");
  assert.match(body, /Checked against: not yet verified/);
  assert.doesNotMatch(body, /null/);
});

test("titles with reserved characters survive the round trip", () => {
  const u = parse(feedbackUrl({ ...base, title: "Q&A #1 — 100% + more", kind: "problem" }));
  assert.equal(u.searchParams.get("title"), "Docs — Problem: Q&A #1 — 100% + more");
});

test("an unknown kind is an error, not a silent default", () => {
  assert.throws(() => feedbackUrl({ ...base, kind: "meh" }), /unknown kind/);
});
