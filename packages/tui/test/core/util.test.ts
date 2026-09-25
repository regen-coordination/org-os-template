import { test, expect } from "bun:test";
import { slug, containsPath, firstLine } from "../../src/core/util";

test("slug", () => {
  expect(slug("ReFi BCN OS!")).toBe("refi-bcn-os");
  expect(slug("🧬")).toBe("ws");
});

test("containsPath respects path boundaries", () => {
  expect(containsPath("/a/b", "/a/b")).toBe(true);
  expect(containsPath("/a/b", "/a/b/c")).toBe(true);
  expect(containsPath("/a/b", "/a/bc")).toBe(false);
});

test("firstLine", () => {
  expect(firstLine("one\ntwo")).toBe("one");
  expect(firstLine("x".repeat(100), 10)).toBe("xxxxxxxxx…");
});
