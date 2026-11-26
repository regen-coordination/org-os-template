// A docs table wider than the screen scrolls sideways inside its own region.
// That region has to be reachable and named, or a keyboard user cannot scroll
// it and a screen reader user is not told what it is (review of 461cbe2,
// finding 3: at 375px the commands table was cut with no cue and no way in).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import rehypeTableScroll, { tableName, tablesOutsideRegion, moreTo, HINTS } from "../src/lib/table-scroll.mjs";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const el = (tagName, children = [], properties = {}) => ({ type: "element", tagName, properties, children });
const text = (value) => ({ type: "text", value });
const table = (...headers) => el("table", [
  el("thead", [el("tr", headers.map((h) => el("th", typeof h === "string" ? [text(h)] : h)))]),
  el("tbody", [el("tr", headers.map(() => el("td", [text("x")])))]),
]);

test("every table is put in a region that can be focused, named after its columns", () => {
  const tree = { type: "root", children: [el("p", [text("before")]), table("Command", "What it does"), el("p", [text("after")])] };
  rehypeTableScroll()(tree);
  const wrap = tree.children[1];
  assert.equal(wrap.tagName, "div");
  assert.deepEqual(wrap.properties, { className: ["table-scroll"], role: "region", ariaLabel: "Table: Command, What it does", tabIndex: 0 });
  assert.equal(wrap.children.length, 1);
  assert.equal(wrap.children[0].tagName, "table");
  assert.equal(tree.children.length, 3);
});

test("a table inside a list or a quote is wrapped too, and a wrapped table is not wrapped twice", () => {
  const tree = { type: "root", children: [el("blockquote", [el("ul", [el("li", [table("A", "B")])])])] };
  rehypeTableScroll()(tree);
  rehypeTableScroll()(tree);
  const li = tree.children[0].children[0].children[0];
  assert.equal(li.children[0].properties.role, "region");
  assert.equal(li.children[0].children[0].tagName, "table");
});

test("the name reads the header cells through their markup, and stays short", () => {
  assert.equal(tableName(table([el("code", [text("npm run x")])], [text("What "), el("em", [text("it")]), text(" does")])), "Table: npm run x, What it does");
  assert.equal(tableName(el("table", [el("tbody", [el("tr", [el("td", [text("x")])])])])), "Table");
  const long = tableName(table(...Array.from({ length: 12 }, (_, i) => `A long column heading number ${i}`)));
  assert.ok(long.length <= 80, `${long.length} characters`);
  assert.match(long, /…$/);
});

test("the built page is checked: a table outside a region is counted, in any spelling", () => {
  const good = `<div class="table-scroll" role="region" aria-label="Table: A" tabindex="0"><table><tr><td>x</td></tr></table></div>`;
  assert.deepEqual(tablesOutsideRegion(good + good), { tables: 2, outside: 0 });
  assert.deepEqual(tablesOutsideRegion(`<table><tr><td>x</td></tr></table>` + good), { tables: 2, outside: 1 });
  // each of the three things a keyboard and a screen reader need
  for (const missing of [` role="region"`, ` aria-label="Table: A"`, ` tabindex="0"`]) {
    assert.equal(tablesOutsideRegion(good.replace(missing, "")).outside, 1, `without${missing}`);
  }
  assert.equal(tablesOutsideRegion(good.replace(`aria-label="Table: A"`, `aria-label=""`)).outside, 1, "an empty name");
  assert.deepEqual(tablesOutsideRegion("<p>no table</p>"), { tables: 0, outside: 0 });
});

test("the cue says which way there is more", () => {
  assert.equal(moreTo({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300 }), "");
  assert.equal(moreTo({ scrollLeft: 0, clientWidth: 300, scrollWidth: 412 }), "right");
  assert.equal(moreTo({ scrollLeft: 60, clientWidth: 300, scrollWidth: 412 }), "both");
  assert.equal(moreTo({ scrollLeft: 112, clientWidth: 300, scrollWidth: 412 }), "left");
  assert.equal(moreTo({ scrollLeft: 111.5, clientWidth: 300, scrollWidth: 412 }), "left", "a fraction of a pixel is not more");
  for (const way of ["right", "both", "left"]) assert.ok(HINTS[way].length > 0);
});

test("the plugin is in the build, and the page styles and scripts the region", () => {
  assert.match(readFileSync(join(SITE, "astro.config.mjs"), "utf8"), /rehypePlugins:\s*\[\s*rehypeTableScroll\s*\]/);
  const layout = readFileSync(join(SITE, "src", "components", "DocsLayout.astro"), "utf8");
  assert.match(layout, /\.table-scroll\)\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(layout, /moreTo\(/);
  assert.match(readFileSync(join(SITE, "scripts", "verify-build.mjs"), "utf8"), /tablesOutsideRegion\(/);
});
