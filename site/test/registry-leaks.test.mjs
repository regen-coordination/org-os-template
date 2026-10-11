// The verifier's guard: text from a registry field outside the agreed list must
// not reach a built page. These are the pure parts; verify-build.mjs applies them
// to dist/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateTexts, findLeaks, visibleText, instanceLine } from "../scripts/registry-leaks.mjs";

const ENTRY = {
  id: "refi-x-os", name: "ReFi X", type: "LocalNode", repo: "https://example.com/x",
  maturity: "production", local_path: "../refi-x-os", packages: ["operations"], drift: ["no_masterplan"],
  notes: "Cooperative-in-formation. Someone is Strategy Lead. The working tree carries ~2,275 uncommitted files — resolve before sync.",
};

test("privateTexts returns the free text of fields outside the public list, in sentences", () => {
  const texts = privateTexts([ENTRY]);
  assert.ok(texts.includes("Someone is Strategy Lead"));
  assert.ok(texts.includes("The working tree carries ~2,275 uncommitted files — resolve before sync"));
});

test("privateTexts leaves out public fields, single words and short fragments", () => {
  const texts = privateTexts([ENTRY]);
  for (const t of texts) assert.ok(t.length >= 16, `too short to be evidence: "${t}"`);
  assert.ok(!texts.includes("ReFi X"));
  assert.ok(!texts.includes("production"));
  assert.ok(!texts.includes("operations"));
});

test("privateTexts reads free text inside lists too", () => {
  const texts = privateTexts([{ name: "A", remarks: ["a private remark about this one"] }]);
  assert.deepEqual(texts, ["a private remark about this one"]);
});

test("findLeaks finds a private sentence in a page, through HTML entities and line breaks", () => {
  const html = "<p class=\"notes\">Cooperative-in-formation. Someone is  Strategy\nLead. The working tree carries ~2,275 uncommitted files &mdash; resolve before sync.</p>";
  const leaks = findLeaks(html, privateTexts([ENTRY]));
  assert.ok(leaks.includes("Someone is Strategy Lead"));
  assert.ok(leaks.some((l) => l.startsWith("The working tree carries")));
});

test("findLeaks finds a private sentence inside JSON, where quotes are escaped", () => {
  const texts = privateTexts([{ name: "A", notes: "It has its \"own\" scaffold root and more." }]);
  const json = JSON.stringify({ notes: "It has its \"own\" scaffold root and more." });
  assert.equal(findLeaks(json, texts).length, 1);
});

test("findLeaks finds nothing in a page that prints only public fields", () => {
  const html = "<li><span>ReFi X</span> <span>LocalNode</span> <a href=\"https://example.com/x\">repository</a></li>";
  assert.deepEqual(findLeaks(html, privateTexts([ENTRY])), []);
});

test("visibleText strips tags and decodes entities", () => {
  assert.equal(visibleText("<li><b>A &amp; B</b>\n  <i>Hub</i></li>"), "A & B Hub");
});

test("instanceLine is the only text an instance may have on the federation page", () => {
  assert.equal(instanceLine({ name: "ReFi X", type: "LocalNode", repo: "https://example.com/x" }), "ReFi X LocalNode repository");
  assert.equal(instanceLine({ name: "Bare", type: "Project", repo: null }), "Bare Project");
});
