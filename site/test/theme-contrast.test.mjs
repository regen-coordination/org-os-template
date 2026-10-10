// site/test/theme-contrast.test.mjs — WCAG AA for both themes, from the theme
// files themselves, so a palette edit that breaks contrast fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const themes = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", "themes");
const tokens = (file) => {
  const out = {};
  for (const m of readFileSync(join(themes, file), "utf8").matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2];
  return out;
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const SURFACES = ["bg", "bg-2", "surface", "surface-2"];
const TEXT = ["ink", "ink-2", "muted", "accent"];

for (const file of ["systems.css", "systems-dark.css"]) {
  const t = tokens(file);

  test(`${file}: defines every token the checks read`, () => {
    for (const name of [...SURFACES, ...TEXT, "faint", "accent-ink"]) assert.ok(t[name], `--color-${name} missing or not a 6-digit hex`);
  });

  test(`${file}: text colours reach 4.5:1 on every surface`, () => {
    for (const fg of TEXT) for (const bg of SURFACES) {
      const r = ratio(t[fg], t[bg]);
      assert.ok(r >= 4.5, `--color-${fg} on --color-${bg} is ${r.toFixed(2)}:1`);
    }
  });

  test(`${file}: text on the accent reaches 4.5:1`, () => {
    const r = ratio(t["accent-ink"], t.accent);
    assert.ok(r >= 4.5, `--color-accent-ink on --color-accent is ${r.toFixed(2)}:1`);
  });

  test(`${file}: the faint colour reaches 3:1 on every surface (non-text use only)`, () => {
    for (const bg of SURFACES) {
      const r = ratio(t.faint, t[bg]);
      assert.ok(r >= 3, `--color-faint on --color-${bg} is ${r.toFixed(2)}:1`);
    }
  });
}

test("the two themes define the same variables", () => {
  const names = (file) => [...readFileSync(join(themes, file), "utf8").matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(names("systems-dark.css"), names("systems.css"));
});
