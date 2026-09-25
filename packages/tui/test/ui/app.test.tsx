import { afterEach, test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../../src/ui/App";
import { fakeCockpit } from "../helpers/fake-cockpit";

const mounted: { renderer: { destroy(): void } }[] = [];
afterEach(() => {
  for (const t of mounted.splice(0)) t.renderer.destroy();
});

async function mount(width: number, height: number, over = {}) {
  const f = fakeCockpit(over);
  let quits = 0;
  const t = await testRender(() => <App cockpit={f.cockpit} onQuit={() => quits++} />, { width, height });
  mounted.push(t);
  await t.renderOnce();
  return { ...f, t, quits: () => quits };
}
const settle = async (t: any) => {
  await new Promise((r) => setTimeout(r, 20));
  await t.renderOnce();
};

test("three-column layout at 160×45", async () => {
  const { t } = await mount(160, 45);
  const f = t.captureCharFrame();
  expect(f).toContain("FLEET");
  expect(f).toContain("ReFi BCN");
  expect(f).toContain("LF Hub · hub");
  expect(f).toContain("Pay invoices");
  expect(f).toContain("AGENT · pi");
  expect(f).toContain("herdr ● 1 agents");
});

test("page selection and drill-down", async () => {
  const { t, dispatched } = await mount(160, 45);
  t.mockInput.pressKey("j");
  t.mockInput.pressEnter();
  await settle(t);
  expect(dispatched).toEqual([{ type: "open-page", ref: { page: "this-week" } }]);
  t.mockInput.pressEscape();
  await settle(t);
  expect(dispatched.at(-1)).toEqual({ type: "back" });
});

test("rail navigation switches workspace", async () => {
  const { t, dispatched } = await mount(160, 45);
  t.mockInput.pressTab({ shift: true });
  await settle(t);
  t.mockInput.pressKey("j");
  t.mockInput.pressEnter();
  await settle(t);
  expect(dispatched).toEqual([{ type: "select-workspace", id: "fw" }]);
});

test("number keys jump; q quits when idle", async () => {
  const { t, dispatched, quits } = await mount(160, 45);
  t.mockInput.pressKey("3");
  await settle(t);
  expect(dispatched).toEqual([{ type: "select-workspace", id: "inst-a" }]);
  t.mockInput.pressKey("q");
  await settle(t);
  expect(quits()).toBe(1);
});

test("q while the agent works asks twice", async () => {
  const { t, quits } = await mount(160, 45, { agentStatus: "working" });
  t.mockInput.pressKey("q");
  await settle(t);
  expect(quits()).toBe(0);
  expect(t.captureCharFrame()).toContain("press q again");
  t.mockInput.pressKey("q");
  await settle(t);
  expect(quits()).toBe(1);
});

test("80×24 hides rail and agent; ctrl+a opens the agent overlay", async () => {
  const { t } = await mount(80, 24);
  let f = t.captureCharFrame();
  expect(f).not.toContain("FLEET");
  expect(f).not.toContain("AGENT · pi");
  t.mockInput.pressKey("a", { ctrl: true });
  await settle(t);
  f = t.captureCharFrame();
  expect(f).toContain("AGENT · pi");
});

test("snapshot updates re-render", async () => {
  const { t, set } = await mount(160, 45);
  set({ activeName: "Renamed WS" });
  await settle(t);
  expect(t.captureCharFrame()).toContain("Renamed WS");
});
