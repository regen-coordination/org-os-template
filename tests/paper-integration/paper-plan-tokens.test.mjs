// tests/paper-integration/paper-plan-tokens.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAPER_TYPES,
  loadBrand,
  isColor,
  toPx,
  planTokens,
  normalizeValue,
  diffTokens,
} from "../../packages/paper-integration/lib/tokens.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(
  __dirname,
  "../fixtures/paper/brand.refi-dao.yaml",
);
const brand = loadBrand(FIXTURE);
const plan = planTokens(brand, { canvasWidth: 1080 });
const byName = Object.fromEntries(plan.tokens.map((t) => [t.name, t]));

test("loadBrand: prefix and token count from the fixture", () => {
  assert.equal(brand.prefix, "refi-");
  assert.equal(Object.keys(brand.tokens).length, 79);
});

test("loadBrand: missing tokens block throws a readable error", () => {
  assert.throws(
    () =>
      loadBrand(path.resolve(__dirname, "../fixtures/instance-config.yaml")),
    /tokens/,
  );
});

test("isColor", () => {
  for (const v of [
    "#4571E1",
    "#fff",
    "rgba(255,255,255,0.03)",
    "rgb(1,2,3)",
    "hsl(1 2% 3%)",
    "oklch(0.5 0.1 200)",
  ])
    assert.equal(isColor(v), true, v);
  for (const v of [
    "0.875rem",
    "20px",
    "300",
    '"Switzer", sans-serif',
    "0 8px 32px rgba(0,0,0,0.3)",
  ])
    assert.equal(isColor(v), false, v);
});

test("toPx: rem, px, zero, clamp at width, unconvertible", () => {
  assert.deepEqual(toPx("0.875rem", {}), {
    px: "14px",
    converted: true,
    from: "0.875rem",
  });
  assert.deepEqual(toPx("9999px", {}), { px: "9999px", converted: false });
  assert.deepEqual(toPx("0", {}), { px: "0px", converted: true, from: "0" });
  assert.deepEqual(toPx("clamp(3rem, 8vw, 6rem)", { width: 1080 }), {
    px: "86px",
    converted: true,
    from: "clamp(3rem, 8vw, 6rem)",
  });
  assert.deepEqual(toPx("clamp(3rem, 8vw, 6rem)", { width: 400 }), {
    px: "48px",
    converted: true,
    from: "clamp(3rem, 8vw, 6rem)",
  });
  assert.equal(toPx("auto", {}), null);
});

test("planTokens: every token type is a Paper type; names are prefixed and pattern-valid", () => {
  for (const t of plan.tokens) {
    assert.ok(PAPER_TYPES.includes(t.type), `${t.name} has type ${t.type}`);
    assert.match(t.name, /^--refi-[a-zA-Z0-9_-]+$/);
  }
});

test("planTokens: colours pass through as-is (hex and rgba)", () => {
  assert.deepEqual(byName["--refi-color-blue"], {
    type: "color",
    name: "--refi-color-blue",
    value: "#4571E1",
    description: "brand.yaml color-blue",
  });
  assert.equal(byName["--refi-bg-surface"].type, "color");
  assert.equal(byName["--refi-bg-surface"].value, "rgba(255,255,255,0.03)");
  assert.equal(byName["--refi-text-muted"].type, "color");
  assert.equal(byName["--refi-border-active"].type, "color");
  assert.equal(byName["--refi-series-6"].type, "color");
  assert.equal(byName["--refi-text"].type, "color"); // value-first: "text" family but hex value
});

test("planTokens: font sizes rem→px, hero clamp evaluated at 1080 and flagged", () => {
  assert.equal(byName["--refi-text-base"].type, "fontSize");
  assert.equal(byName["--refi-text-base"].value, "14px");
  assert.equal(byName["--refi-text-5xl"].value, "56px");
  assert.equal(byName["--refi-text-hero"].value, "86px");
  assert.match(
    byName["--refi-text-hero"].description,
    /from clamp\(3rem, 8vw, 6rem\) at 1080px/,
  );
  assert.ok(
    plan.converted.some(
      (c) => c.name === "--refi-text-hero" && c.to === "86px",
    ),
  );
});

test("planTokens: spacing and radius rem→px, zero → 0px, 9999px kept", () => {
  assert.deepEqual(
    [byName["--refi-space-4"].type, byName["--refi-space-4"].value],
    ["spacing", "16px"],
  );
  assert.equal(byName["--refi-space-0"].value, "0px");
  assert.deepEqual(
    [byName["--refi-radius-lg"].type, byName["--refi-radius-lg"].value],
    ["radius", "16px"],
  );
  assert.equal(byName["--refi-radius-full"].value, "9999px");
});

test("planTokens: weights become numbers", () => {
  assert.deepEqual(
    [
      byName["--refi-weight-semibold"].type,
      byName["--refi-weight-semibold"].value,
    ],
    ["fontWeight", 600],
  );
});

test("planTokens: font families → first family, full stack in description", () => {
  const f = byName["--refi-font-sans"];
  assert.equal(f.type, "fontFamily");
  assert.equal(f.value, "Switzer");
  assert.match(f.description, /stack: "Switzer", "Inter"/);
  assert.equal(byName["--refi-font-mono"].value, "ui-monospace");
});

test("planTokens: glow and glass are skipped with a reason, never silently", () => {
  const skippedNames = plan.skipped.map((s) => s.name).sort();
  assert.deepEqual(skippedNames, [
    "--refi-glass-blur",
    "--refi-glass-shadow",
    "--refi-glow-blue",
    "--refi-glow-green",
  ]);
  for (const s of plan.skipped) assert.match(s.reason, /no Paper token type/);
  assert.equal(plan.tokens.length + plan.skipped.length, 79);
});

test("normalizeValue: hex case, rgba whitespace, numeric weights, px trim", () => {
  assert.equal(
    normalizeValue("color", "#4571e1"),
    normalizeValue("color", "#4571E1"),
  );
  assert.equal(
    normalizeValue("color", "rgba(255, 255, 255, 0.03)"),
    normalizeValue("color", "rgba(255,255,255,0.03)"),
  );
  assert.equal(
    normalizeValue("fontWeight", "600"),
    normalizeValue("fontWeight", 600),
  );
  assert.equal(normalizeValue("spacing", " 16px "), "16px");
});

test("diffTokens: create / update / unchanged / extra (prefix-scoped)", () => {
  const planned = [
    {
      type: "color",
      name: "--refi-color-blue",
      value: "#4571E1",
      description: "d",
    },
    {
      type: "spacing",
      name: "--refi-space-4",
      value: "16px",
      description: "d",
    },
    {
      type: "fontWeight",
      name: "--refi-weight-bold",
      value: 700,
      description: "d",
    },
  ];
  const existing = [
    { type: "color", name: "--refi-color-blue", value: "#4571e1" }, // same after normalisation
    { type: "spacing", name: "--refi-space-4", value: "12px" }, // changed
    { type: "color", name: "--refi-old-thing", value: "#000" }, // extra, our prefix
    { type: "color", name: "--color-primary", value: "#111" }, // not ours — ignored
  ];
  const d = diffTokens(planned, existing, { prefix: "refi-" });
  assert.deepEqual(
    d.create.map((t) => t.name),
    ["--refi-weight-bold"],
  );
  assert.deepEqual(d.update, [
    { name: "--refi-space-4", value: "16px", description: "d" },
  ]);
  assert.deepEqual(d.unchanged, ["--refi-color-blue"]);
  assert.deepEqual(d.extra, ["--refi-old-thing"]);
});
