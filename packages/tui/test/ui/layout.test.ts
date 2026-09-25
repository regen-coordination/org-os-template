import { test, expect } from "bun:test";
import { computeLayout, regionsFor } from "../../src/ui/layout";

test("three, two and one column layouts", () => {
  expect(computeLayout(160, true)).toEqual({ showRail: true, rail: 26, agent: 54, agentOverlay: false });
  expect(computeLayout(160, false)).toEqual({ showRail: true, rail: 26, agent: 0, agentOverlay: false });
  expect(computeLayout(120, true)).toEqual({ showRail: true, rail: 24, agent: 60, agentOverlay: true });
  expect(computeLayout(80, true)).toEqual({ showRail: false, rail: 0, agent: 80, agentOverlay: true });
  expect(regionsFor(computeLayout(160, true), true)).toEqual(["rail", "page", "agent"]);
  expect(regionsFor(computeLayout(80, false), false)).toEqual(["page"]);
});
