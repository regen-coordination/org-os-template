import { test } from "node:test";
import assert from "node:assert/strict";
import { len, patch, pack } from "../scripts/lib/quilt-compose.mjs";
import { pods, organ, organism, stitch, ORGANISM_INNER } from "../scripts/lib/quilt-compose.mjs";

test("patch sizes itself to its widest content line", () => {
  const p = patch("kms █", [" 44/44 ✓ "]);
  assert.equal(p[0], "╭─kms █───╮");
  assert.equal(p[1], "│ 44/44 ✓ │");
  assert.equal(p[2], "╰─────────╯");
  // rectangle: every line same display width
  assert.ok(p.every((l) => len(l) === len(p[0])));
});

test("patch title wider than content stretches the body", () => {
  const p = patch("operations █", [" bcn "]);
  assert.ok(p.every((l) => len(l) === len(p[0])));
  assert.ok(len(p[0]) >= [..."operations █"].length + 4);
});

test("pack wraps blocks into rows and preserves ragged bottoms", () => {
  const a = patch("a", [" x "]); // height 3
  const b = patch("b", [" y ", " z "]); // height 4
  const lines = pack([a, b], 40, 1);
  // one row, height 4: 'a' padded with spaces below its bottom border
  assert.equal(lines.length, 4);
  assert.match(lines[0], /╭─a─+╮ ╭─b─+╮/);
  assert.match(lines[3], /^\s+╰─+╯$/); // a contributes nothing on line 4; only b's closing border shows (b's " z " row is line 3, above)
});

test("pack starts a new row when width is exceeded", () => {
  const blocks = [patch("one", [" .. "]), patch("two", [" .. "])];
  const lines = pack(blocks, 12, 1); // too narrow for both side by side
  assert.equal(lines.length, 6); // two stacked 3-line rows
});

test("pods wraps tokens under a hanging label indent", () => {
  const lines = pods("░ sleeping", ["(a)", "(b)", "(c)"], 20);
  assert.equal(lines[0], "░ sleeping ─ (a) (b)");
  assert.equal(lines[1], "             (c)");
});

test("organ borders content and throws on overflow", () => {
  const o = organ("CORE", ["hello"], 20);
  assert.equal(o[0].length === undefined, false); // array of strings
  assert.ok(o.every((l) => len(l) === 20));
  assert.match(o[0], /^┏━ CORE ━+┓$/);
  assert.match(o[1], /^┃ hello\s+┃$/);
  assert.throws(() => organ("X", ["y".repeat(17)], 20), /overflow/);
});

test("organism packs organs side by side and throws on overflow", () => {
  const a = organ("A", ["1"], 40);
  const b = organ("B", ["2"], 43); // 40+1+43 = 84 = ORGANISM_INNER
  const body = organism("TEST", [[a, b], stitch("∴ flow")]);
  const lines = body.split("\n");
  assert.ok(lines.every((l) => len(l) === ORGANISM_INNER + 4));
  assert.match(lines[0], /^╔═ TEST ═+═╗$/);
  assert.match(lines[1], /┏━ A ━+┓ ┏━ B ━+┓/);
  assert.ok(body.includes("∴ flow"));
  assert.throws(() => organism("T", ["x".repeat(85)]), /overflow/);
});
