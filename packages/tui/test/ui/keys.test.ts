import { test, expect } from "bun:test";
import { routeKey } from "../../src/ui/keys";

const k = (name: string, mods: Record<string, boolean> = {}, sequence?: string) => ({ name, sequence: sequence ?? name, ...mods });

test("global navigation keys when not typing", () => {
  const s = { focus: "page" as const, overlay: false };
  expect(routeKey(k("j"), s)).toEqual({ type: "move", delta: 1 });
  expect(routeKey(k("up"), s)).toEqual({ type: "move", delta: -1 });
  expect(routeKey(k("g"), s)).toEqual({ type: "top" });
  expect(routeKey(k("g", { shift: true }), s)).toEqual({ type: "bottom" });
  expect(routeKey(k("return"), s)).toEqual({ type: "open" });
  expect(routeKey(k("escape"), s)).toEqual({ type: "back" });
  expect(routeKey(k("l", { shift: true }), s)).toEqual({ type: "launch-menu" });
  expect(routeKey(k("?", {}, "?"), s)).toEqual({ type: "help" });
  expect(routeKey(k(":", {}, ":"), s)).toEqual({ type: "palette" });
  expect(routeKey(k("3"), s)).toEqual({ type: "jump", index: 2 });
  expect(routeKey(k("q"), s)).toEqual({ type: "quit" });
  expect(routeKey(k("tab", { shift: true }), s)).toEqual({ type: "focus-prev" });
});

test("typing in the agent input never triggers global shortcuts", () => {
  const s = { focus: "agent" as const, overlay: false };
  for (const name of ["q", "j", "k", "1", "?", "a", "e", "r", "return", "h", "g"]) expect(routeKey(k(name), s)).toBe(null);
  expect(routeKey(k("escape"), s)).toEqual({ type: "blur" });
  expect(routeKey(k("tab"), s)).toEqual({ type: "focus-next" });
  expect(routeKey(k("p", { ctrl: true }), s)).toEqual({ type: "palette" });
  expect(routeKey(k("x", { ctrl: true }), s)).toEqual({ type: "abort" });
});

test("overlays swallow everything but ctrl+c", () => {
  const s = { focus: "page" as const, overlay: true };
  expect(routeKey(k("j"), s)).toBe(null);
  expect(routeKey(k("escape"), s)).toBe(null);
  expect(routeKey(k("c", { ctrl: true }), s)).toEqual({ type: "force-quit" });
});
