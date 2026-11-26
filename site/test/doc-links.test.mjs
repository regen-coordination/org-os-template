// site/test/doc-links.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDocLink, dirsOf } from "../src/lib/doc-links.mjs";

const pages = [
  { source: "docs/SETUP.md", slug: "setup" },
  { source: "docs/FEDERATION.md", slug: "federation" },
];
const repoFiles = new Set([
  "docs/SETUP.md", "docs/FEDERATION.md", "docs/QUEUE.md", "docs/img/map.png",
  "docs/superpowers/specs/a design.md", "packages/org-os-kms/docs/CONNECTORS.md", "BOOTSTRAP.md",
]);
const ctx = {
  pages, repoFiles, repoDirs: dirsOf(repoFiles),
  base: "/org-os-template", repoUrl: "https://github.com/o/r", ref: "v0.5.1",
};
const from = (sourcePath, url, extra = {}) => resolveDocLink({ ...ctx, sourcePath, url, ...extra });

test("dirsOf lists every ancestor directory", () => {
  assert.deepEqual([...dirsOf(["a/b/c.md", "a/d.md"])].sort(), ["a", "a/b"]);
});

test("a link to a published page becomes its site address", () => {
  assert.deepEqual(from("docs/SETUP.md", "FEDERATION.md"), { kind: "page", href: "/org-os-template/docs/federation" });
  assert.deepEqual(from("docs/SETUP.md", "./FEDERATION.md"), { kind: "page", href: "/org-os-template/docs/federation" });
});

test("fragments and queries survive", () => {
  assert.equal(from("docs/SETUP.md", "FEDERATION.md#trust-levels").href, "/org-os-template/docs/federation#trust-levels");
  assert.equal(from("docs/SETUP.md", "FEDERATION.md?x=1#y").href, "/org-os-template/docs/federation?x=1#y");
});

test("a link from a file outside docs/ resolves from that file's own folder", () => {
  assert.deepEqual(
    from("packages/org-os-kms/docs/CONNECTORS.md", "../../../docs/FEDERATION.md"),
    { kind: "page", href: "/org-os-template/docs/federation" },
  );
});

test("a link to an unpublished repo file goes to GitHub at the release ref", () => {
  assert.deepEqual(from("docs/SETUP.md", "QUEUE.md#next"), { kind: "repo", href: "https://github.com/o/r/blob/v0.5.1/docs/QUEUE.md#next" });
  assert.deepEqual(from("docs/SETUP.md", "../BOOTSTRAP.md"), { kind: "repo", href: "https://github.com/o/r/blob/v0.5.1/BOOTSTRAP.md" });
});

test("a link to a directory goes to GitHub's tree view", () => {
  assert.deepEqual(from("docs/SETUP.md", "superpowers/specs/"), { kind: "repo", href: "https://github.com/o/r/tree/v0.5.1/docs/superpowers/specs" });
  assert.deepEqual(from("docs/SETUP.md", ".."), { kind: "repo", href: "https://github.com/o/r/tree/v0.5.1" });
});

test("an encoded space resolves to the real file and is re-encoded", () => {
  assert.deepEqual(
    from("docs/SETUP.md", "superpowers/specs/a%20design.md"),
    { kind: "repo", href: "https://github.com/o/r/blob/v0.5.1/docs/superpowers/specs/a%20design.md" },
  );
});

test("a link that resolves to nothing is broken", () => {
  assert.equal(from("docs/SETUP.md", "OPERATOR-GUIDEBOOK.md").kind, "broken");
  assert.equal(from("docs/SETUP.md", "03%20Libraries/org-os/docs/EIP4824-GUIDE.md").kind, "broken");
});

test("a link that leaves the repository is broken", () => {
  assert.equal(from("docs/SETUP.md", "../../koi-net/").kind, "broken");
  assert.equal(from("docs/SETUP.md", "../..").kind, "broken");
});

test("a malformed escape is broken, not a crash", () => {
  assert.equal(from("docs/SETUP.md", "bad%ZZ.md").kind, "broken");
});

test("absolute and external links are left alone", () => {
  for (const url of ["https://example.org/x.md", "mailto:a@b.c", "#section", "/docs/setup", "//cdn.example.org/x.js"]) {
    assert.deepEqual(from("docs/SETUP.md", url), { kind: "external", href: url });
  }
});

test("only http, https and mailto pass through; any other scheme is broken", () => {
  for (const url of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "vbscript:x"]) {
    assert.deepEqual(from("docs/SETUP.md", url), { kind: "broken", href: url });
  }
  assert.equal(from("docs/SETUP.md", "HTTPS://example.org").kind, "external");
  assert.equal(from("docs/SETUP.md", "MAILTO:a@b.c").kind, "external");
});

test("an image in the repo is served raw; a page is never used as an image", () => {
  assert.deepEqual(from("docs/SETUP.md", "img/map.png", { image: true }), { kind: "repo", href: "https://raw.githubusercontent.com/o/r/v0.5.1/docs/img/map.png" });
  assert.equal(from("docs/SETUP.md", "FEDERATION.md", { image: true }).href, "https://raw.githubusercontent.com/o/r/v0.5.1/docs/FEDERATION.md");
});

test("an empty base path still gives a root-absolute address", () => {
  assert.equal(from("docs/SETUP.md", "FEDERATION.md", { base: "" }).href, "/docs/federation");
});
