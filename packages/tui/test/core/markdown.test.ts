import { test, expect } from "bun:test";
import { markdownToLines, inline } from "../../src/core/markdown";

test("block structure", () => {
  const lines = markdownToLines("# Title\n\nSome **bold** `code` [link](http://x)\n\n\n- one\n  - two\n> quote\n---\n```\nraw *x*\n```\n1. first");
  expect(lines.map((l) => [l.kind, l.text, l.depth ?? null])).toEqual([
    ["h1", "Title", null],
    ["blank", "", null],
    ["body", "Some bold code link", null],
    ["blank", "", null],
    ["bullet", "one", 0],
    ["bullet", "two", 1],
    ["quote", "quote", null],
    ["rule", "", null],
    ["code", "raw *x*", null],
    ["body", "1. first", null],
  ]);
});

test("inline strips emphasis and links", () => {
  expect(inline("a *b* **c** `d` [e](f)")).toBe("a b c d e");
});
