import { test, expect } from "bun:test";
import { pageLines, selectableIndexes, navCount, selectedLineIndex, windowFor, targetAt } from "../../src/ui/page-model";
import type { PageData } from "../../src/core/types";

const page: PageData = {
  ref: { page: "dashboard" },
  title: "Hub",
  actions: [],
  sources: [],
  errors: [],
  blocks: [
    { kind: "kv", pairs: [["Type", "Hub"], ["Branch", "main"]] },
    { kind: "list", heading: "Urgent", items: [{ key: "a", label: "Pay", badge: "2d", target: { page: "tasks" } }, { key: "b", label: "Plain" }] },
    { kind: "table", heading: "Projects", columns: ["Project", "Stage"], rows: [{ key: "c", cells: ["Cockpit", "Develop"], target: { page: "project", id: "cockpit" } }] },
    { kind: "markdown", text: "# Notes\n- one" },
    { kind: "notice", level: "warn", text: "careful" },
  ],
};

test("lines, styles and selectable targets", () => {
  const lines = pageLines(page, 60);
  expect(lines.map((l) => l.style)).toEqual(["kv", "kv", "blank", "heading", "item", "item", "blank", "heading", "header", "row", "blank", "h1", "bullet", "blank", "warn"]);
  expect(lines[4].text).toContain("Pay");
  expect(lines[4].text).toContain("2d");
  expect(selectableIndexes(lines)).toEqual([4, 9]);
  expect(navCount(lines)).toBe(2);
  expect(selectedLineIndex(lines, 1)).toBe(9);
  expect(targetAt(lines, 1)).toEqual({ page: "project", id: "cockpit" });
});

test("pages without targets scroll", () => {
  const md: PageData = { ...page, blocks: [{ kind: "markdown", text: Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") }] };
  const lines = pageLines(md, 40);
  expect(navCount(lines)).toBe(30);
  expect(selectedLineIndex(lines, 3)).toBe(-1);
  expect(windowFor(lines, 25, 10)).toBe(20);
  expect(windowFor(lines, 4, 10)).toBe(4);
  const sel = pageLines(page, 60);
  expect(windowFor(sel, 1, 5)).toBe(5);
  expect(windowFor(sel, 0, 5)).toBe(0);
});
