// site/test/fragments.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { idsIn, fragmentOf, fragmentVerdict, stripCode, fragmentCoverage } from "../src/lib/fragments.mjs";

test("idsIn collects id attributes, double- and single-quoted, and anchor names", () => {
  const html = `<h2 id="setup">x</h2><div id='box' class="a"></div><a name="old"></a><p data-id="no">`;
  assert.deepEqual([...idsIn(html)].sort(), ["box", "old", "setup"]);
});

test("a name attribute counts only on <a>", () => {
  assert.equal(idsIn(`<meta name="viewport" content="x"><input name="q">`).size, 0);
});

test("idsIn ignores id-like text inside other attributes", () => {
  const html = `<a href="/x" title='see id="fake" here' data-pid="p1" class="grid">y</a>`;
  assert.equal(idsIn(html).size, 0);
});

test("fragmentOf returns the decoded fragment of an address, or null", () => {
  assert.equal(fragmentOf("/org-os-template/docs/setup/#the-doctor"), "the-doctor");
  assert.equal(fragmentOf("/a/b?x=1#caf%C3%A9"), "café");
  assert.equal(fragmentOf("#top-level"), "top-level");
  assert.equal(fragmentOf("/a/b/"), null);
  assert.equal(fragmentOf("/a/b/#"), null);
  assert.equal(fragmentOf("/a/b/#%E0%A4%A"), "%E0%A4%A", "an undecodable fragment is compared as written");
});

test("fragmentVerdict is ok when the id exists and says why when it does not", () => {
  const ids = new Set(["setup", "the-doctor"]);
  assert.deepEqual(fragmentVerdict("the-doctor", ids), { ok: true });
  const bad = fragmentVerdict("old-heading", ids);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /old-heading/);
});

test("the reserved fragments #top and the empty one always resolve", () => {
  assert.deepEqual(fragmentVerdict("top", new Set()), { ok: true });
  assert.deepEqual(fragmentVerdict("", new Set()), { ok: true });
});

test("stripCode removes the contents of <code> and <pre>, where a page may show an attribute as an example", () => {
  const html = `<p>See <code>src="map.json"</code> and</p><pre class="astro-code" tabindex="0"><code><span>href="rel/x"</span></code></pre><a href="/real">x</a>`;
  const out = stripCode(html);
  assert.ok(!out.includes("map.json") && !out.includes("rel/x"));
  assert.ok(out.includes(`href="/real"`));
});

test("stripCode handles several elements and attributes on the opening tag, and leaves other markup alone", () => {
  const html = `<code class="a">one="1"</code> <a href="/keep">k</a> <code>two="2"</code>`;
  assert.equal(stripCode(html), ` <a href="/keep">k</a> `);
});

test("idsIn ignores ids that appear only inside a script, style, template, textarea or comment", () => {
  const html = `<h2 id="real">x</h2><script>var s = '<h2 id="fake1">';</script><style>/* <p id="fake2"> */</style><template><p id="fake3"></p></template><textarea><p id="fake4"></textarea><!-- <p id="fake5"> -->`;
  assert.deepEqual([...idsIn(html)], ["real"]);
});

test("stripCode keeps a raw-HTML link written inside <code>, and drops only the text around it", () => {
  const out = stripCode(`<p><code>src="x.json" <a href="rel/x" class="k">n</a> href="y"</code></p>`);
  assert.ok(out.includes(`href="rel/x"`), "the nested link must still be checked");
  assert.ok(!out.includes("x.json") && !out.includes(`href="y"`), "the example text goes");
});

test("stripCode keeps a link nested inside <pre><code>", () => {
  const out = stripCode(`<pre class="c"><code><span>href="text"</span><a href="rel/z">z</a></code></pre><a href="/real">r</a>`);
  assert.ok(out.includes(`href="rel/z"`) && out.includes(`href="/real"`));
  assert.ok(!out.includes(`href="text"`));
});

test("stripCode does not treat <code-block> or <pre-x> as code or pre", () => {
  const html = `<code-block><a href="rel/y">z</a></code><a href="/after">a</a>`;
  assert.equal(stripCode(html), html);
  const html2 = `<pre-x data="a" href="rel/q">t</pre-x>`;
  assert.equal(stripCode(html2), html2);
});

test("fragmentCoverage: no cross-page fragment link is fine while same-page links were seen", () => {
  assert.equal(fragmentCoverage(12, 0), null);
  assert.equal(fragmentCoverage(12, 3), null);
});

test("fragmentCoverage fails when the check looked at no fragment link at all", () => {
  assert.match(fragmentCoverage(0, 0), /matched 0 #fragment links/);
});

test("fragmentCoverage fails when same-page links vanish, because the skip link alone keeps that count above zero", () => {
  assert.match(fragmentCoverage(0, 4), /0 same-page/);
});
