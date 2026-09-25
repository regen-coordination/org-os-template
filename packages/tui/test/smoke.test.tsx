import { test, expect } from "bun:test";
import { testRender } from "@opentui/solid";

test("OpenTUI Solid renders under the local Bun", async () => {
  const setup = await testRender(() => (
    <box border title="org-os" style={{ width: 30, height: 4 }}>
      <text>cockpit ready</text>
    </box>
  ), { width: 40, height: 6 });
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("cockpit ready");
  setup.renderer.destroy();
});
