import { test } from "node:test";
import assert from "node:assert/strict";
import { len, patch, pack } from "../scripts/lib/quilt-compose.mjs";

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
