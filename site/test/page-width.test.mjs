// A page does not scroll sideways on a phone. Two checks hold that (see
// src/lib/page-width.mjs): the stylesheet rule, read here at every `npm test`,
// and the measurement in a browser, `npm run widths`, whose pure parts are
// tested here. The closing review of 6eacb24 found six docs pages wider than a
// 375px screen, each because of a long path or address in inline <code>, and
// noted that no test or verify step looked at page width.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inlineCodeWrapProblems, pagesIn, widthProblems, widthSummary, WIDTHS } from "../src/lib/page-width.mjs";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const layout = readFileSync(join(SITE, "src", "components", "DocsLayout.astro"), "utf8");
const layoutCss = [...layout.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");

test("the docs layout lets inline code break inside a word", () => {
  assert.deepEqual(inlineCodeWrapProblems(layoutCss), []);
});

test("the docs layout does not break the lines of a code block, which scrolls in its own box", () => {
  assert.doesNotMatch(layoutCss, /\.doc :global\((pre|pre code|code)\)\s*\{[^}]*overflow-wrap/);
});

test("the rule is missed when it is absent, on the wrong element or outside the doc", () => {
  const cases = [
    ["no rule at all", ".doc :global(table) { border-collapse: collapse; }"],
    ["on every code, blocks too", ".doc :global(code) { overflow-wrap: anywhere; }"],
    ["on code blocks only", ".doc :global(pre code) { overflow-wrap: anywhere; }"],
    ["outside the doc", ".home :global(:not(pre) > code) { overflow-wrap: anywhere; }"],
    ["a value that does not break a word", ".doc :global(:not(pre) > code) { overflow-wrap: normal; }"],
    ["commented out", "/* .doc :global(:not(pre) > code) { overflow-wrap: anywhere; } */"],
  ];
  for (const [what, css] of cases) {
    const problems = inlineCodeWrapProblems(css);
    assert.equal(problems.length, 1, what);
    assert.match(problems[0], /scroll sideways on a phone/, what);
  }
});

test("the rule is found in the spellings that mean it", () => {
  for (const css of [
    ".doc :global(:not(pre) > code) { overflow-wrap: anywhere; }",
    ".doc :not(pre) > code { color: red; overflow-wrap: break-word }",
    ".doc :global(li), .doc :global(:not(pre)>code) { overflow-wrap:anywhere; }",
    ".doc :global(code:not(pre code)) { overflow-wrap: anywhere; }",
  ]) assert.deepEqual(inlineCodeWrapProblems(css), [], css);
});

test("the pages to measure are every built index.html, as the address it is served at", () => {
  assert.deepEqual(
    pagesIn(["index.html", "docs/setup/index.html", "federation.json", "docs/index.html", "pagefind/pagefind.js", "404.html"]),
    ["/", "/docs/", "/docs/setup/"],
  );
});

test("a page as wide as the screen is no problem; a wider one is named with its width and what reaches past the edge", () => {
  const measured = [
    { page: "/docs/setup/", width: 375, documentWidth: 375 },
    { page: "/docs/federation-map/", width: 375, documentWidth: 534, widest: [{ what: "code “https://raw.githubusercontent.com/<repo>…”", right: 533.6 }] },
  ];
  const problems = widthProblems(measured);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^\/docs\/federation-map\/ at 375px is 534px wide: the page scrolls sideways by 159px\./);
  assert.match(problems[0], /code “https:\/\/raw\.githubusercontent\.com\/<repo>…” \(to 534px\)/);
});

test("a page the browser could not measure is a problem, not a pass", () => {
  assert.match(widthProblems([{ page: "/", width: 320, documentWidth: null }])[0], /could not be measured/);
});

test("the summary fails when nothing was measured, when a width was skipped and when a page is wide", () => {
  assert.deepEqual(WIDTHS, [375, 320]);
  assert.equal(widthSummary([]).ok, false);
  assert.match(widthSummary([]).line, /measured no page/);
  const at375 = [{ page: "/", width: 375, documentWidth: 375 }];
  assert.equal(widthSummary(at375).ok, false);
  assert.match(widthSummary(at375).line, /nothing was measured at 320px/);
  const both = [...at375, { page: "/", width: 320, documentWidth: 320 }];
  assert.deepEqual(widthSummary(both), { ok: true, line: "page widths: 1 pages at 375 and 320px, each exactly as wide as the screen" });
  const wide = [...both, { page: "/docs/x/", width: 375, documentWidth: 380 }, { page: "/docs/x/", width: 320, documentWidth: 320 }];
  assert.deepEqual(widthSummary(wide), { ok: false, line: "page widths: 1 of 2 pages scroll sideways at 375 or 320px" });
});
