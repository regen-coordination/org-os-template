import { test, expect } from "bun:test";
import { transcriptLines, wrap } from "../../src/ui/transcript-view";

test("wrap", () => {
  expect(wrap("one two three four", 9)).toEqual(["one two", "three", "four"]);
  expect(wrap("a\n\nb", 10)).toEqual(["a", "", "b"]);
  expect(wrap("x".repeat(12), 5)).toEqual(["xxxxx", "xxxxx", "xx"]);
});

test("entries render with prefixes and styles", () => {
  const lines = transcriptLines([
    { kind: "user", text: "hi there" },
    { kind: "assistant", text: "hello", streaming: true },
    { kind: "tool", callId: "1", tool: "bash", summary: "ls", status: "error", result: "BLOCKED" },
    { kind: "notice", level: "info", text: "note" },
  ], 40);
  expect(lines).toEqual([
    { text: "› hi there", style: "user" },
    { text: "hello▍", style: "assistant" },
    { text: "✗ bash ls", style: "tool-error" },
    { text: "  BLOCKED", style: "dim" },
    { text: "· note", style: "info" },
  ]);
});
