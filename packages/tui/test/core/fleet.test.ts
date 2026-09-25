import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverFleet, pickActive, readInstanceRegistry } from "../../src/core/fleet";
import { makeFleetFixture, makeWorkspace } from "../helpers/fixtures";

test("discovers hub, framework, instances and extras", () => {
  const { hub, fw, instA } = makeFleetFixture();
  const extra = mkdtempSync(join(tmpdir(), "ck-extra-"));
  makeWorkspace(extra, "Extra");
  const { fleet, errors } = discoverFleet(fw, { workspaces: [{ path: extra, label: "Side" }, { path: hub }] });
  expect(errors).toEqual([]);
  expect(fleet.map((w) => [w.id, w.kind, w.label, w.exists, w.drift])).toEqual([
    ["hub", "hub", "Hub", true, 0],
    ["fw", "framework", "Framework", true, 0],
    ["inst-a", "instance", "Instance A", true, 2],
    ["ghost", "instance", "ghost", false, 0],
    ["side", "extra", "Side", true, 0],
  ]);
  expect(fleet[2].root).toBe(instA);
});

test("framework without a hub or registry still yields itself", () => {
  const lone = mkdtempSync(join(tmpdir(), "ck-lone-"));
  makeWorkspace(lone, "Lone");
  const { fleet } = discoverFleet(lone, { workspaces: [] });
  expect(fleet.map((w) => w.kind)).toEqual(["framework"]);
});

test("a broken registry is reported, not thrown", () => {
  const lone = mkdtempSync(join(tmpdir(), "ck-bad-"));
  makeWorkspace(lone, "Lone", { "data/instances.yaml": "instances: [unclosed" });
  expect(readInstanceRegistry(lone).error).toContain("data/instances.yaml");
  expect(discoverFleet(lone, { workspaces: [] }).errors.length).toBe(1);
});

test("pickActive: flag, then containing path (longest), then remembered, then hub", () => {
  const { hub, fw, instA } = makeFleetFixture();
  const { fleet } = discoverFleet(fw, { workspaces: [] });
  expect(pickActive(fleet, { invokedFrom: "/elsewhere", flag: instA })).toBe("inst-a");
  expect(pickActive(fleet, { invokedFrom: "/elsewhere", flag: "fw" })).toBe("fw");
  expect(pickActive(fleet, { invokedFrom: join(fw, "packages") })).toBe("fw");
  expect(pickActive(fleet, { invokedFrom: hub })).toBe("hub");
  expect(pickActive(fleet, { invokedFrom: "/elsewhere", remembered: "inst-a" })).toBe("inst-a");
  expect(pickActive(fleet, { invokedFrom: "/elsewhere", remembered: "gone" })).toBe("hub");
  expect(pickActive([], { invokedFrom: "/" })).toBe(null);
});
