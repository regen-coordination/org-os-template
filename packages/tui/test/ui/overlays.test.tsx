import { afterEach, test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../../src/ui/App";
import { fakeCockpit } from "../helpers/fake-cockpit";

const settle = async (t: any) => {
  await new Promise((r) => setTimeout(r, 20));
  await t.renderOnce();
};
const mounted: { renderer: { destroy(): void } }[] = [];
afterEach(() => {
  for (const t of mounted.splice(0)) t.renderer.destroy();
});

async function mount(over = {}, width = 160, height = 45) {
  const f = fakeCockpit(over);
  let quits = 0;
  const t = await testRender(() => <App cockpit={f.cockpit} onQuit={() => quits++} />, { width, height });
  mounted.push(t);
  await t.renderOnce();
  return { ...f, t, quits: () => quits };
}

test("typing into the agent input sends a prompt and never fires shortcuts", async () => {
  const { t, dispatched, quits } = await mount();
  t.mockInput.pressTab(); // page → agent
  await settle(t);
  await t.mockInput.typeText("quit jq 3");
  t.mockInput.pressEnter();
  await settle(t);
  expect(dispatched).toEqual([{ type: "agent-prompt", text: "quit jq 3" }]);
  expect(quits()).toBe(0);
  expect(t.captureCharFrame()).not.toContain("quit jq 3"); // input cleared after send
});

test("agent pane shows transcript, model and status", async () => {
  const { t } = await mount({
    transcript: [
      { kind: "user", text: "run tests" },
      { kind: "tool", callId: "1", tool: "bash", summary: "npm test", status: "error", result: "BLOCKED by guard" },
      { kind: "assistant", text: "Streaming", streaming: true },
    ],
    agentStatus: "working",
  });
  const f = t.captureCharFrame();
  expect(f).toContain("anthropic/claude-opus-5");
  expect(f).toContain("› run tests");
  expect(f).toContain("✗ bash npm test");
  expect(f).toContain("BLOCKED by guard");
  expect(f).toContain("Streaming▍");
});

test("palette filters and runs an entry", async () => {
  const { t, dispatched } = await mount();
  t.mockInput.pressKey("p", { ctrl: true });
  await settle(t);
  expect(t.captureCharFrame()).toContain("Command palette");
  await t.mockInput.typeText("decisions");
  await settle(t);
  t.mockInput.pressEnter();
  await settle(t);
  expect(dispatched).toEqual([{ type: "open-page", ref: { page: "decisions" } }]);
  expect(t.captureCharFrame()).not.toContain("Command palette");
});

test("launch menu passes the terminal width for split direction", async () => {
  const { t, dispatched } = await mount();
  t.mockInput.pressKey("l", { shift: true });
  await settle(t);
  expect(t.captureCharFrame()).toContain("Launch a host");
  t.mockInput.pressEnter();
  await settle(t);
  expect(dispatched).toEqual([{ type: "launch", host: "claude", placement: "split", paneCols: 160 }]);
});

test("escape closes the palette without dispatching", async () => {
  const { t, dispatched } = await mount();
  t.mockInput.pressKey("p", { ctrl: true });
  await settle(t);
  t.mockInput.pressEscape();
  await settle(t);
  expect(t.captureCharFrame()).not.toContain("Command palette");
  expect(dispatched).toEqual([]);
});

test("permission dialog answers by key and blocks other shortcuts", async () => {
  const req = { id: "p1", workspace: "hub", tool: "write", summary: "docs/plan.md", input: {} };
  const { t, dispatched } = await mount({ permissions: [req, { ...req, id: "p2" }] });
  const f = t.captureCharFrame();
  expect(f).toContain("Approval needed");
  expect(f).toContain("docs/plan.md");
  expect(f).toContain("1 more waiting");
  t.mockInput.pressKey("j");
  t.mockInput.pressKey("s");
  await settle(t);
  expect(dispatched).toEqual([{ type: "permission-answer", id: "p1", answer: "session" }]);
});

test("help overlay lists keys and closes on escape", async () => {
  const { t } = await mount();
  t.mockInput.pressKey("?");
  await settle(t);
  expect(t.captureCharFrame()).toContain("ctrl+p");
  t.mockInput.pressEscape();
  await settle(t);
  expect(t.captureCharFrame()).not.toContain("Keys");
});
