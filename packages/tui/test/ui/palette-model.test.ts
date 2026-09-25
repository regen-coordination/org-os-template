import { test, expect } from "bun:test";
import { buildEntries, filterEntries, launchEntries, scoreEntry } from "../../src/ui/palette-model";
import { actionsFor } from "../../src/core/actions";

const snap: any = { fleet: [{ info: { id: "hub", label: "Hub", kind: "hub" }, summary: { name: "LF Hub" }, agents: [] }] };

test("entries cover pages, workspaces, actions and UI toggles", () => {
  const entries = buildEntries(snap, actionsFor(null));
  const labels = entries.map((e) => e.label);
  expect(labels).toContain("Go to Tasks");
  expect(labels).toContain("Switch to LF Hub");
  expect(labels).toContain("Agent: /close");
  expect(labels).toContain("Launch claude (split)");
  expect(labels).toContain("Toggle agent pane");
  const launch = entries.find((e) => e.label === "Launch claude (split)")!;
  expect(launch.action).toEqual({ kind: "command", command: { type: "launch", host: "claude", placement: "split" } });
  expect(launchEntries(actionsFor(null)).length).toBe(6);
});

test("fuzzy filtering ranks tight matches first", () => {
  expect(scoreEntry("Go to Tasks", "tsk")).not.toBe(null);
  expect(scoreEntry("Go to Tasks", "xyz")).toBe(null);
  const entries = buildEntries(snap, actionsFor(null));
  expect(filterEntries(entries, "tasks")[0].label).toBe("Go to Tasks");
  expect(filterEntries(entries, "").length).toBe(entries.length);
});

test("the palette offers a new agent session", () => {
  const entry = buildEntries(snap, actionsFor(null)).find((e) => e.label === "Agent: new session");
  expect(entry?.action).toEqual({ kind: "command", command: { type: "agent-new-session" } });
});
