import { test, expect } from "bun:test";
import { parseArgs } from "../../src/core/args";

test("defaults and flags", () => {
  expect(parseArgs([])).toEqual({ snapshot: false, width: 160, height: 45 });
  expect(parseArgs(["--workspace", "/w", "--page", "tasks", "--snapshot", "--width", "80", "--height", "24", "--framework", "/fw"]))
    .toEqual({ workspace: "/w", page: "tasks", snapshot: true, width: 80, height: 24, framework: "/fw" });
  expect(parseArgs(["--width", "abc"]).width).toBe(160);
});
