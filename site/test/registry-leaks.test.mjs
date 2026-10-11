// The verifier's guard: text from a registry field outside the agreed list must
// not reach a built page. These are the pure parts; verify-build.mjs applies them
// to dist/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseRegistry } from "../scripts/federation-aggregate.mjs";
import { registryGuard, findLeaks, longestSharedRun, visibleText, instanceLine, RUN_LENGTH } from "../scripts/registry-leaks.mjs";

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

// ── the measurement RUN_LENGTH is set from ───────────────────────────────

test("longestSharedRun measures the longest run of letters a text shares with a note, and quotes the note", () => {
  // "resolve before sync" is 17 letters; with "It lives at the root" nothing longer is shared.
  const short = longestSharedRun("<p>Commit your work and resolve before sync. It lives at the root.</p>", guard);
  assert.equal(short.length, "resolvebeforesync".length);
  assert.equal(short.text, "resolve before sync");
  // through markup, case and an entity, like findLeaks
  const marked = longestSharedRun("<p>THE <b>working</b> tree&nbsp;carries about</p>", guard);
  assert.equal(marked.length, "theworkingtreecarries".length);
  assert.equal(marked.text, "The working tree carries");
  // a note of any length counts, not only those long enough to hold an excerpt
  const g = registryGuard([{ name: "A", notes: "a brief private note" }]);
  assert.equal(longestSharedRun("it was a brief private matter", g).length, "abriefprivate".length);
  assert.deepEqual(longestSharedRun("12345 !!!", g), { length: 0, text: "" });
});

test("a run at the length of an excerpt is a leak, and one letter shorter is not: the measure and the check agree", () => {
  const cut = (letters) => { let n = 0, i = 0; while (n < letters) { if (/[\p{L}\p{N}]/u.test(LONG[i])) n++; i++; } return LONG.slice(0, i); };
  const under = `<p>${cut(RUN_LENGTH - 1)}</p>`;
  const at = `<p>${cut(RUN_LENGTH)}</p>`;
  assert.equal(longestSharedRun(under, guard).length, RUN_LENGTH - 1);
  assert.deepEqual(findLeaks(under, guard), []);
  assert.equal(longestSharedRun(at, guard).length, RUN_LENGTH);
  assert.deepEqual(kinds(findLeaks(at, guard)), ["passage"]);
});

// ── why RUN_LENGTH is what it is ─────────────────────────────────────────
// Measured on 2026-10-11 on the real build, after docs/ECOSYSTEM.md stopped
// restating the registry's notes (b65fd8d): the longest run any built file
// shares with a note is 32 letters, "tests/fixtures/bread-coop-config.yaml" in
// dist/docs/ecosystem/index.html, the path of a public file that the document
// cites and a note also names. `npm run build` prints the current number
// ("registry check: the longest run any built file shares with a note is …").
const MEASURED_ON_THE_BUILD = 32;
// A name is one unbroken word of a note: a path, an address, an identifier. A
// document can cite it without quoting the note, so the check must let it pass.
const JOINING_WORD = 4;

test("RUN_LENGTH is the longest single name in the registry's notes and room for one joining word, no more", () => {
  const real = registryGuard(parseRegistry(readFileSync(new URL("../../data/instances.yaml", import.meta.url), "utf8")));
  assert.ok(real.notes.length >= 8, `only ${real.notes.length} free texts read from data/instances.yaml`);
  const squeezed = (word) => word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").length;
  const longestName = Math.max(...real.notes.flatMap((n) => n.source.split(/\s+/).map(squeezed)));
  assert.equal(longestName, 36, "the longest name in a note changed: set RUN_LENGTH to it plus the joining word, and say so in scripts/registry-leaks.mjs");
  assert.equal(RUN_LENGTH, longestName + JOINING_WORD);
  assert.ok(RUN_LENGTH > MEASURED_ON_THE_BUILD, "the build would fail on what the documents say today");
});

test("a name from a note, cited with one joining word, is not an excerpt; with the note's next words it is", () => {
  const g = registryGuard([{ name: "A", notes: "Nested instance that lives at another-organisation-os/repos/a-long-toolkit as a linked repository of its own." }]);
  assert.equal("anotherorganisationosreposalongtoolkit".length, 38);
  assert.deepEqual(findLeaks("<p>See <code>another-organisation-os/repos/a-long-toolkit</code> in the changelog.</p>", g), []);
  assert.deepEqual(kinds(findLeaks("<p>It lives at another-organisation-os/repos/a-long-toolkit as a linked repository.</p>", g)), ["passage"]);
});
