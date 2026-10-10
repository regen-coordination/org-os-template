// site/test/theme-color.test.mjs — the <meta name="theme-color"> values come from the theme files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { themeColor } from "../src/lib/theme-color.mjs";

const themes = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", "themes");

test("themeColor reads --color-bg from a theme's css", () => {
  assert.equal(themeColor(":root { --color-bg-2: #111111; --color-bg:   #abcdef;  /* page */ }"), "#abcdef");
});

test("themeColor throws when the theme has no 6-digit --color-bg, so a build cannot ship a blank meta", () => {
  assert.throws(() => themeColor(":root { --color-bg: rgb(1,2,3); }"), /--color-bg/);
});

test("both real themes yield a colour", () => {
  for (const f of ["systems.css", "systems-dark.css"]) assert.match(themeColor(readFileSync(join(themes, f), "utf8")), /^#[0-9a-f]{6}$/i);
});
