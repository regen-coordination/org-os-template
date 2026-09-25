import { test, expect } from "bun:test";
import { displayWidth, truncate, pad, padLine, formatTable } from "../../src/ui/format";

test("width-aware truncation handles emoji", () => {
  expect(displayWidth("🧬 org-os")).toBe(9);
  expect(truncate("🧬 org-os framework", 8)).toBe("🧬 org-…");
  expect(displayWidth(truncate("🧬🧬🧬🧬", 5))).toBeLessThanOrEqual(5);
  expect(truncate("short", 10)).toBe("short");
  expect(truncate("x", 0)).toBe("");
  expect(pad("ab", 4)).toBe("ab  ");
  expect(padLine("left", "R", 10)).toBe("left     R");
  expect(displayWidth(padLine("a very long left label", "badge", 12))).toBe(12);
});

test("tables shrink the widest column to fit", () => {
  const t = formatTable(["Name", "Stage"], [["Cockpit project name", "Develop"], ["X", "Idea"]], 20);
  expect(displayWidth(t.header)).toBeLessThanOrEqual(20);
  for (const l of t.lines) expect(displayWidth(l)).toBeLessThanOrEqual(20);
  expect(t.lines[1].startsWith("X")).toBe(true);
});
