// site/test/remark-plugins.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import remarkDocLinks, { rewriteTree } from "../src/lib/remark-doc-links.mjs";
import remarkStripTitle from "../src/lib/remark-strip-title.mjs";
import { dirsOf } from "../src/lib/doc-links.mjs";

const pages = [{ source: "docs/SETUP.md", slug: "setup" }, { source: "docs/FEDERATION.md", slug: "federation" }];
const files = ["docs/SETUP.md", "docs/FEDERATION.md", "docs/QUEUE.md", "docs/img/a.png"];
const ctx = { pages, repoFiles: new Set(files), repoDirs: dirsOf(files), base: "/b", repoUrl: "https://github.com/o/r", ref: "v1" };
const link = (url) => ({ type: "link", url, children: [{ type: "text", value: "x" }] });
const para = (...children) => ({ type: "paragraph", children });
const root = (...children) => ({ type: "root", children });

test("rewriteTree rewrites links, definitions and images at any depth", () => {
  const tree = root(
    para(link("FEDERATION.md#a"), { type: "image", url: "img/a.png" }),
    { type: "list", children: [{ type: "listItem", children: [para(link("QUEUE.md"))] }] },
    { type: "definition", identifier: "s", url: "SETUP.md" },
    para(link("https://example.org")),
  );
  const broken = rewriteTree(tree, { ...ctx, sourcePath: "docs/SETUP.md" });
  assert.deepEqual(broken, []);
  assert.equal(tree.children[0].children[0].url, "/b/docs/federation#a");
  assert.equal(tree.children[0].children[1].url, "https://raw.githubusercontent.com/o/r/v1/docs/img/a.png");
  assert.equal(tree.children[1].children[0].children[0].children[0].url, "https://github.com/o/r/blob/v1/docs/QUEUE.md");
  assert.equal(tree.children[2].url, "/b/docs/setup");
  assert.equal(tree.children[3].children[0].url, "https://example.org");
});

test("rewriteTree returns every broken link and leaves it untouched", () => {
  const tree = root(para(link("NOPE.md"), link("../../outside/")));
  assert.deepEqual(rewriteTree(tree, { ...ctx, sourcePath: "docs/SETUP.md" }), ["NOPE.md", "../../outside/"]);
  assert.equal(tree.children[0].children[0].url, "NOPE.md");
});

const plugin = (over = {}) => remarkDocLinks({ ...ctx, repoRoot: "/repo", listFiles: () => files, ...over });

test("the plugin takes the source path from a file URL, as Astro passes it", () => {
  const tree = root(para(link("FEDERATION.md")));
  plugin()(tree, { path: pathToFileURL(join("/repo", "docs", "SETUP.md")) });
  assert.equal(tree.children[0].children[0].url, "/b/docs/federation");
});

test("the plugin also accepts a plain path string", () => {
  const tree = root(para(link("FEDERATION.md")));
  plugin()(tree, { path: join("/repo", "docs", "SETUP.md") });
  assert.equal(tree.children[0].children[0].url, "/b/docs/federation");
});

test("the plugin fails the build on a broken link, naming file and link", () => {
  const tree = root(para(link("NOPE.md")));
  assert.throws(() => plugin()(tree, { path: join("/repo", "docs", "SETUP.md") }), /docs\/SETUP\.md[\s\S]*NOPE\.md/);
});

test("the plugin refuses to guess when it is given no source path", () => {
  assert.throws(() => plugin()(root(para(link("FEDERATION.md"))), {}), /no source path/);
});

test("the plugin lists the repository's files once, not once per page", () => {
  let calls = 0;
  const p = plugin({ listFiles: () => { calls++; return files; } });
  p(root(), { path: "/repo/docs/SETUP.md" });
  p(root(), { path: "/repo/docs/FEDERATION.md" });
  assert.equal(calls, 1);
});

test("strip-title removes a leading h1 and nothing else", () => {
  const h = (depth, value) => ({ type: "heading", depth, children: [{ type: "text", value }] });
  const a = root(h(1, "Title"), para(), h(2, "Next"));
  remarkStripTitle()(a);
  assert.deepEqual(a.children.map((n) => n.type + (n.depth ?? "")), ["paragraph", "heading2"]);

  const b = root(para(), h(1, "Late title"));
  remarkStripTitle()(b);
  assert.equal(b.children.length, 2, "an h1 that is not first is kept");

  const c = root(h(2, "No h1"));
  remarkStripTitle()(c);
  assert.equal(c.children.length, 1);

  const d = root({ type: "html", value: "<!-- note -->" }, h(1, "Title"), para());
  remarkStripTitle()(d);
  assert.deepEqual(d.children.map((n) => n.type), ["html", "paragraph"], "a leading comment does not hide the title");
});
