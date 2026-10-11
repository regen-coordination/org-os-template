// The verifier's guard: text from a registry field outside the agreed list must
// not reach a built page. These are the pure parts; verify-build.mjs applies them
// to dist/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registryGuard, findLeaks, visibleText, instanceLine, RUN_LENGTH } from "../scripts/registry-leaks.mjs";

const LONG = "Nested instance — lives at another-os/repos/x as a linked repo with its OWN git remote, on branch x-os, and every drift report before this entry was blind to it because the 'instances tracked' count never looked there.";
const ENTRY = {
  id: "refi-x-os", name: "ReFi X", type: "LocalNode", repo: "https://example.com/x",
  maturity: "production", local_path: "../refi-x-os", last_sync: "2026-03-19", cloned: true,
  packages: ["operations"], drift: ["no_masterplan", "stub_identity"],
  notes: "Cooperative-in-formation. Someone is Strategy Lead. The working tree carries ~2,275 uncommitted files — resolve before sync.",
};
const LONG_ENTRY = { name: "Nested", type: "Project", repo: null, notes: LONG };

const guard = registryGuard([ENTRY, LONG_ENTRY]);
const texts = (leaks) => leaks.map((l) => l.text);
const kinds = (leaks) => [...new Set(leaks.map((l) => l.kind))].sort();

// ── what is looked for ───────────────────────────────────────────────────

test("the guard holds the free text of fields outside the public list, in sentences", () => {
  assert.ok(guard.sentences.includes("Someone is Strategy Lead"));
  assert.ok(guard.sentences.includes("The working tree carries ~2,275 uncommitted files — resolve before sync"));
});

test("the guard leaves out public fields, single words and short fragments", () => {
  for (const t of guard.sentences) assert.ok(t.length >= 16, `too short to be evidence: "${t}"`);
  const all = [...guard.sentences, ...guard.tokens];
  for (const ordinary of ["ReFi X", "LocalNode", "https://example.com/x", "production", "operations", "2026-03-19", "true"]) {
    assert.ok(!all.includes(ordinary), `"${ordinary}" must not be looked for`);
  }
});

test("the guard reads free text inside lists too", () => {
  const g = registryGuard([{ name: "A", remarks: ["a private remark about this one"] }]);
  assert.deepEqual(g.sentences, ["a private remark about this one"]);
});

test("the guard holds the values that cannot be mistaken for a word: flags and paths", () => {
  assert.deepEqual([...guard.tokens].sort(), ["../refi-x-os", "no_masterplan", "stub_identity"]);
});

// ── a whole sentence ─────────────────────────────────────────────────────

test("findLeaks finds a private sentence in a page, through HTML entities and line breaks", () => {
  const html = "<p class=\"notes\">Cooperative-in-formation. Someone is  Strategy\nLead. The working tree carries ~2,275 uncommitted files &mdash; resolve before sync.</p>";
  const found = texts(findLeaks(html, guard));
  assert.ok(found.includes("Someone is Strategy Lead"));
  assert.ok(found.some((l) => l.startsWith("The working tree carries")));
});

test("findLeaks finds a private sentence inside JSON, where quotes are escaped", () => {
  const g = registryGuard([{ name: "A", notes: "It has its \"own\" scaffold root and more." }]);
  const json = JSON.stringify({ notes: "It has its \"own\" scaffold root and more." });
  assert.equal(findLeaks(json, g).length, 1);
});

// ── review finding 1: an excerpt ─────────────────────────────────────────

test("findLeaks finds a note cut short with an ellipsis", () => {
  const html = `<p class="card">${LONG.slice(0, 120)}…</p>`;
  const leaks = findLeaks(html, guard);
  assert.deepEqual(kinds(leaks), ["passage"]);
  assert.ok(LONG.startsWith(leaks[0].text.slice(0, 20)), `the report quotes the registry's words: "${leaks[0].text}"`);
});

test("findLeaks finds an excerpt taken from the middle of a note, across a sentence end", () => {
  const html = "<p>…files — resolve before sync. Another line follows</p><p>in-formation. Someone is Strategy Lead. The working tree carries ~2,275 uncom…</p>";
  assert.ok(findLeaks(html, guard).some((l) => l.kind === "passage"));
});

test(`findLeaks does not take a shared phrase shorter than ${RUN_LENGTH} letters for an excerpt`, () => {
  const html = "<p>Commit your work and resolve before sync. It lives at the root as a linked repo.</p>";
  assert.deepEqual(findLeaks(html, guard), []);
});

// ── review finding 2: markup, case, escapes ──────────────────────────────

test("findLeaks reads through markup between the words", () => {
  const html = "<p>Someone is <strong>Strategy</strong> <em>Lead</em></p>";
  assert.deepEqual(texts(findLeaks(html, guard)), ["Someone is Strategy Lead"]);
});

test("findLeaks reads through markup inside a long note", () => {
  const html = `<p>${LONG.slice(0, 90).replace("linked repo", "<a href=\"/x\">linked repo</a>")}</p>`;
  assert.ok(findLeaks(html, guard).some((l) => l.kind === "passage"));
});

test("findLeaks ignores a change of case", () => {
  assert.deepEqual(texts(findLeaks("<p>SOMEONE IS STRATEGY LEAD</p>", guard)), ["Someone is Strategy Lead"]);
  assert.ok(findLeaks(`<p>${LONG.slice(0, 100).toUpperCase()}</p>`, guard).length > 0);
});

test("findLeaks decodes \\uXXXX and \\xNN escapes, as a script or a JSON file may carry them", () => {
  const json = '{"n":"The working tree carries ~2,275 uncommitted files \\u2014 resolve before sync."}';
  assert.ok(texts(findLeaks(json, guard)).some((l) => l.startsWith("The working tree carries")));
  assert.deepEqual(texts(findLeaks('{"n":"\\u0053omeone is \\x53trategy Lead"}', guard)), ["Someone is Strategy Lead"]);
  assert.deepEqual(texts(findLeaks('{"html":"Someone is \\u003cb\\u003eStrategy\\u003c/b\\u003e Lead"}', guard)), ["Someone is Strategy Lead"]);
});

test("findLeaks reads the typographer's quotes and dashes as the plain ones", () => {
  const html = `<p>${LONG.slice(120).replace(/'([^']*)'/, "‘$1’")}</p>`;
  assert.ok(html.includes("‘instances tracked’"));
  assert.ok(findLeaks(html, guard).length > 0);
  assert.ok(texts(findLeaks("<p>The working tree carries ~2,275 uncommitted files - resolve before sync</p>", guard)).length > 0);
});

test("findLeaks reads text held in an attribute, which is not visible text", () => {
  const html = "<meta name=\"description\" content=\"Someone is Strategy Lead\"><p>Nothing here.</p>";
  assert.deepEqual(texts(findLeaks(html, guard)), ["Someone is Strategy Lead"]);
});

// ── review finding 3: one-word values ────────────────────────────────────

test("findLeaks finds a drift flag and a local path", () => {
  assert.deepEqual(findLeaks("<li>ReFi X <span>no_masterplan</span></li>", guard), [{ kind: "token", text: "no_masterplan" }]);
  assert.deepEqual(findLeaks('{"path":"..\\/refi-x-os"}', guard), [{ kind: "token", text: "../refi-x-os" }]);
  assert.deepEqual(findLeaks("<code>cd ../Refi-X-OS/data</code>", guard), [{ kind: "token", text: "../refi-x-os" }]);
});

test("findLeaks does not find a flag inside a longer word", () => {
  assert.deepEqual(findLeaks("<p>no_masterplan_version and has_no_masterplan are other names</p>", guard), []);
});

test("findLeaks leaves the one-word values that are ordinary words alone", () => {
  assert.deepEqual(findLeaks("<p>In production since 2026-03-19, with the operations package. cloned: true</p>", guard), []);
});

// ── no false alarm ───────────────────────────────────────────────────────

test("findLeaks finds nothing in a page that prints only public fields", () => {
  const html = "<li><span>ReFi X</span> <span>LocalNode</span> <a href=\"https://example.com/x\">repository</a></li>";
  assert.deepEqual(findLeaks(html, guard), []);
});

test("findLeaks reports one leak once, however many ways it was read", () => {
  assert.equal(findLeaks("<p>Someone is Strategy Lead</p>", guard).length, 1);
});

test("visibleText strips tags and decodes entities", () => {
  assert.equal(visibleText("<li><b>A &amp; B</b>\n  <i>Hub</i></li>"), "A & B Hub");
});

test("instanceLine is the only text an instance may have on the federation page", () => {
  assert.equal(instanceLine({ name: "ReFi X", type: "LocalNode", repo: "https://example.com/x" }), "ReFi X LocalNode repository");
  assert.equal(instanceLine({ name: "Bare", type: "Project", repo: null }), "Bare Project");
});
