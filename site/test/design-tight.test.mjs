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

test("every command on the home page exists in the repository", () => {
  const scripts = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts;
  for (const { run } of landing.commands ?? []) {
    const npm = run.match(/^npm run ([a-z0-9:-]+)$/);
    const slash = run.match(/^\/([a-z0-9-]+)$/);
    if (npm) assert.ok(scripts[npm[1]], `"${run}": the root package.json has no script "${npm[1]}"`);
    else if (slash) assert.ok(existsSync(join(REPO, ".claude", "commands", `${slash[1]}.md`)), `"${run}": .claude/commands/${slash[1]}.md does not exist`);
    else assert.fail(`"${run}" is neither "npm run <script>" nor "/<command>"`);
  }
});

test("every command on the home page links to a published docs page", async () => {
  const { pageBySlug } = await import("../src/data/docs-manifest.mjs");
  for (const { run, doc } of landing.commands ?? []) {
    const slug = doc.replace(/^\/docs\//, "").split("#")[0];
    assert.ok(pageBySlug(slug), `"${run}" links to ${doc}, which is not in the manifest`);
  }
});
