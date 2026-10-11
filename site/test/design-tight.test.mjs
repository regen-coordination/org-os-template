// The design's discipline, held by test (spec: docs/superpowers/specs/
// 2026-10-11-site-tight-design.md). These read the source, not a rendered page:
// they prove the rules are kept, not that the page looks right.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(SITE, "..");
const SRC = join(SITE, "src");

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(astro|css)$/.test(name)) files.push(full);
  }
})(SRC);
const sources = files.map((file) => ({ name: relative(SITE, file), text: readFileSync(file, "utf8") }));
// The style rules of a source: a whole .css file, or the <style> blocks of a component.
const styles = sources.map(({ name, text }) => ({
  name,
  css: name.endsWith(".css") ? text : [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n"),
}));
const tokens = readFileSync(join(SRC, "styles", "tokens.css"), "utf8");

test("the sources were found", () => {
  assert.ok(sources.length >= 25, `only ${sources.length} .astro and .css files under src/`);
});

test("the cut decoration is gone: no aura, grain, glow, iridescent gradient, veil, grid or pointer light", () => {
  const CUT = /--aura-|--grain-|--color-glow|--gradient-iris|--surface-veil|--color-grid|--grid-size|--glow-r|--shadow-1\b|--tick\b/;
  for (const { name, text } of sources) {
    const hit = text.match(CUT);
    assert.equal(hit, null, `${name} still uses ${hit?.[0]}`);
  }
});

test("the cut classes are gone: .lit, .ticked, .stagger, .reveal", () => {
  for (const { name, text } of sources) {
    const hit = text.match(/class(?::list)?=[^>]*\b(lit|ticked|stagger|reveal)\b/) ?? text.match(/\.(lit|ticked|stagger|reveal)\b[^{;]*\{/);
    assert.equal(hit, null, `${name} still uses the class ${hit?.[1]}`);
  }
});

test("the canvas of drifting motes is gone", () => {
  assert.equal(existsSync(join(SRC, "components", "Drift.astro")), false);
  for (const { name, text } of sources) assert.doesNotMatch(text, /Drift\b/, `${name} still names Drift`);
});

test("the type scale has eight fixed steps and one fluid one", () => {
  const steps = [...tokens.matchAll(/^\s*(--text-[a-z0-9]+)\s*:/gm)].map((m) => m[1]);
  assert.deepEqual(steps, ["--text-2xs", "--text-xs", "--text-sm", "--text-base", "--text-md", "--text-lg", "--text-xl", "--text-2xl", "--text-display"]);
});

test("every font-size is a step of the scale, or an em relative to its parent", () => {
  let seen = 0;
  for (const { name, css } of styles) {
    for (const m of css.matchAll(/font-size\s*:\s*([^;}]+)/g)) {
      seen++;
      const value = m[1].trim();
      assert.match(value, /^(var\(--text-[a-z0-9]+\)|inherit|[0-9.]+em)$/, `${name}: font-size: ${value}`);
    }
  }
  assert.ok(seen >= 30, `only ${seen} font-size declarations found: the pattern stopped matching`);
});

test("spacing stops at 64px: no step above --space-16 is defined or used", () => {
  const steps = [...tokens.matchAll(/(--space-\d+)\s*:/g)].map((m) => m[1]);
  assert.deepEqual(steps, ["--space-1", "--space-2", "--space-3", "--space-4", "--space-5", "--space-6", "--space-8", "--space-10", "--space-12", "--space-16"]);
  for (const { name, text } of sources) {
    for (const m of text.matchAll(/var\((--space-\d+)\)/g)) assert.ok(steps.includes(m[1]), `${name} uses ${m[1]}, which is not on the scale`);
  }
});

test("flat: a shadow is used only for the focus ring and the search dialog", () => {
  for (const { name, css } of styles) {
    const count = [...css.matchAll(/box-shadow\s*:/g)].length;
    const allowed = name.endsWith("global.css") || name.endsWith("Search.astro") ? 1 : 0;
    assert.ok(count <= allowed, `${name} has ${count} box-shadow declaration(s); ${allowed} allowed`);
  }
  for (const { name, css } of styles) assert.doesNotMatch(css, /text-shadow/, `${name} has a text-shadow`);
});

test("nothing moves on load or lifts on hover", () => {
  for (const { name, css } of styles) {
    assert.doesNotMatch(css, /translateY\(-/, `${name} lifts something`);
    assert.doesNotMatch(css, /@keyframes\s+(rise|ping)\b/, `${name} animates on load`);
  }
});

// ── The other spellings of the same rules ────────────────────────────────
// The tests above read `font-size`, `box-shadow`, `text-shadow` and
// `translateY(-` inside stylesheets and <style> blocks. A rule can be broken in
// other words: in an inline `style` attribute, the `font` shorthand, a gradient
// that is not the cut token, `filter: drop-shadow()`, or `translate(x, -n)`.
// `spellings` reads one source and returns what it finds, so each rule below has
// a case that fails (the review of 461cbe2 found these five let through).
const KNOB = "ThemeToggle.astro";
function spellings(name, text) {
  const css = name.endsWith(".css") ? text : [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  const found = [];
  // No inline style attribute at all: every rule here reads stylesheets, and a
  // `style="…"` or `style={…}` on an element would pass each of them unread.
  if (/\sstyle\s*=\s*["'{]/.test(text)) found.push("an inline style attribute");
  // The `font` shorthand sets a size without the word font-size. Only `inherit` is used.
  for (const m of css.matchAll(/(?<![-\w])font\s*:\s*([^;}]+)/g)) {
    if (m[1].trim() !== "inherit") found.push(`font: ${m[1].trim()}`);
  }
  // Gradients are cut. One is kept on purpose and named: the theme switch's knob
  // in dark is a crescent, drawn by one radial-gradient of two palette colours
  // with a hard edge. It is a shape, not a wash of colour.
  const gradients = [...css.matchAll(/[a-z-]*gradient\(/g)].map((m) => m[0]);
  const allowed = name.endsWith(KNOB) ? ["radial-gradient("] : [];
  if (gradients.join() !== allowed.join()) found.push(`gradient(s): ${gradients.join(" ") || "none"}; allowed here: ${allowed.join(" ") || "none"}`);
  // A shadow by another name.
  if (/drop-shadow\(/.test(css)) found.push("filter: drop-shadow()");
  // A lift by another name: translate(x, -n), translate3d(x, -n, z).
  if (/translate(?:3d)?\(\s*[^,()]+,\s*-/.test(css)) found.push("translate(x, -n)");
  // Hover is a change of colour or of rule: nothing is moved, turned or resized by it.
  for (const m of css.matchAll(/([^{}]*:hover[^{}]*)\{([^{}]*)\}/g)) {
    const moved = m[2].match(/(?<![-\w])(transform|translate|scale|rotate)\s*:/);
    if (moved) found.push(`${m[1].trim()} sets ${moved[1]}`);
  }
  return found;
}

test("the same rules in their other spellings: inline styles, the font shorthand, gradients, drop-shadow, translate(x, -n), movement on hover", () => {
  for (const { name, text } of sources) assert.deepEqual(spellings(name, text), [], name);
  // The allowed gradient is still there: if the knob changes, this sentence and the spec change with it.
  const knob = sources.find(({ name }) => name.endsWith(KNOB));
  assert.match(knob.text, /aria-pressed="true"\] \.orb \{[^}]*radial-gradient\(circle at/);
});

test("each of those spellings is caught when it appears", () => {
  const astro = (css, markup = "<p>x</p>") => `---\n---\n${markup}\n<style>\n${css}\n</style>\n`;
  const cases = [
    ["an inline style attribute", astro("", `<p style="font-size:19px">x</p>`), /inline style/],
    ["an inline style expression", astro("", `<p style={{ fontSize: "19px" }}>x</p>`), /inline style/],
    ["the font shorthand", astro(".a { font: 700 22px/1.2 sans-serif; }"), /font: 700 22px/],
    ["a linear gradient", astro(".a { background: linear-gradient(90deg, red, blue); }"), /linear-gradient\(/],
    ["a drop shadow", astro(".a { filter: drop-shadow(0 2px 4px #000); }"), /drop-shadow/],
    ["a lift written as translate(x, -n)", astro(".a:hover { color: red; } .b { transform: translate(0, -4px); }"), /translate\(x, -n\)/],
    ["a nudge on hover", astro(".a:hover .arr { transform: translateX(3px); }"), /sets transform/],
    ["the translate property on hover", astro(".a:hover { translate: 0 -2px; }"), /sets translate/],
  ];
  for (const [what, text, expected] of cases) {
    assert.match(spellings("src/components/Any.astro", text).join("; "), expected, what);
  }
  // In a plain stylesheet too, and a second gradient on the knob is not covered by the first.
  assert.match(spellings("src/styles/any.css", ".a { background: conic-gradient(red, blue); }").join(), /conic-gradient/);
  assert.match(spellings(`src/components/${KNOB}`, astro(".a { background: radial-gradient(red, blue); } .b { background: linear-gradient(red, blue); }")).join(), /allowed here: radial-gradient\(/);
  assert.match(spellings("src/components/Other.astro", astro(".a { background: radial-gradient(red, blue); }")).join(), /allowed here: none/);
  // What is allowed stays allowed.
  assert.deepEqual(spellings("src/components/Any.astro", astro(".a { font: inherit; --pagefind-ui-font: var(--font-body); translate: 0 -50%; } .a:hover { color: red; border-color: blue; }")), []);
});

// ── The home page's first screen ─────────────────────────────────────────
const landing = yaml.load(readFileSync(join(SRC, "data", "landing.yaml"), "utf8"));
const words = (s) => s.trim().split(/\s+/).length;

test("the first screen is short: a headline of at most 8 words, one sentence of at most 40, at most two links", () => {
  assert.ok(words(landing.title) <= 8, `the headline has ${words(landing.title)} words`);
  assert.ok(words(landing.subtitle) <= 40, `the sentence under it has ${words(landing.subtitle)} words`);
  assert.ok(landing.ctas.length <= 2, `${landing.ctas.length} links`);
});

test("the first screen offers commands: three, each with what it does and where it is documented", () => {
  assert.equal(landing.commands?.length, 3);
  for (const c of landing.commands) {
    assert.ok(c.run && c.does && c.doc, `incomplete command entry: ${JSON.stringify(c)}`);
    assert.ok(words(c.does) <= 14, `"${c.run}" is described in ${words(c.does)} words`);
  }
});

// Whether each command exists, and works where the page says to run it, is held
// by test/command-where.test.mjs: it reads what an instance receives, which the
// framework's package.json alone cannot say.

test("every command on the home page links to a published docs page", async () => {
  const { pageBySlug } = await import("../src/data/docs-manifest.mjs");
  for (const { run, doc } of landing.commands ?? []) {
    const slug = doc.replace(/^\/docs\//, "").split("#")[0];
    assert.ok(pageBySlug(slug), `"${run}" links to ${doc}, which is not in the manifest`);
  }
});
